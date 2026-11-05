/* Explicit, private AI request review. Editor integration supplies a narrow
 * selection/apply adapter; this panel never reads a whole document or stores
 * a proposal. Closing invalidates both pending requests and later application. */
(function (root) {
  'use strict';
  const life = root.HaedoLife ||= {};
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function open({ selectionText = '', sources = [], tasks = ['polish', 'shorten', 'continue', 'custom'],
    initialInstruction = '', isCurrent, validateCurrent, onApply, onClose = () => {} } = {}) {
    const AI = life.WritingAI, auth = root.HaedoAuth;
    if (!AI || typeof isCurrent !== 'function') throw new Error('AI 제안을 준비하지 못했어요. 새로고침해 주세요.');
    const target = auth?.getAccount(), authEpoch = auth?.epoch, token = {};
    const choices = sources.map(source => ({ text: source.text, label: String(source.label || '자료 발췌') }));
    const allowedTasks = tasks.filter(task => Object.hasOwn(AI.TASKS, task));
    if (!allowedTasks.length) throw new Error(AI.MESSAGES.ai_invalid_task);
    let closed = false, busy = false, prepared = null, response = null, selectedSources = [],
      requestController = null, usageController = null, unsubscribe = null, requestTimer = null;
    const composing = new Set();
    const opener = document.activeElement;
    const dialog = el('dialog', null, 'writing-ai-panel');
    dialog.setAttribute('aria-labelledby', 'writingAITitle');
    const title = el('h2', 'AI 제안'); title.id = 'writingAITitle';
    const closeButton = button('닫기', dispose, 'writing-ai-close');
    const header = el('div', null, 'writing-ai-header'); header.append(title, closeButton);
    const status = el('p', '', 'writing-ai-status'); status.setAttribute('role', 'status');
    const error = el('p', '', 'writing-ai-error'); error.setAttribute('role', 'alert'); error.hidden = true;
    const usage = el('p', '이번 달 남은 금액: 확인 중…', 'writing-ai-usage');
    const usageRetry = button('금액 다시 확인', loadUsage); usageRetry.hidden = true;
    const form = el('div', null, 'writing-ai-form');
    const task = el('select'); task.id = 'writingAITask';
    for (const value of allowedTasks) { const option = el('option', AI.TASKS[value].label); option.value = value; task.append(option); }
    form.append(field('작업', task));
    if (selectionText) {
      const selection = el('details', null, 'writing-ai-selection');
      selection.append(el('summary', '선택한 글'), el('pre', selectionText, 'writing-ai-text'));
      form.append(selection);
    }
    const instruction = el('textarea'); instruction.id = 'writingAIInstruction'; instruction.rows = 3; instruction.maxLength = AI.LIMITS.instruction;
    // A source adapter may restore a question interrupted by a source update.
    // This only restores the input; a new explicit preview/send is still needed.
    instruction.value = typeof initialInstruction === 'string' ? initialInstruction : '';
    const instructionField = field('요청 문장', instruction);
    form.append(instructionField);
    const sourceFields = el('fieldset', null, 'writing-ai-sources');
    sourceFields.append(el('legend', '보낼 자료 발췌'), el('p', '최대 6개, 합계 8,000자까지 고를 수 있어요.', 'life-help'));
    const sourceChecks = choices.map((source, index) => {
      const check = el('input'); check.type = 'checkbox'; check.dataset.aiSource = String(index);
      const label = el('label', null, 'writing-ai-source-choice'); label.append(check, el('span', source.label));
      const item = el('div', null, 'writing-ai-source');
      const original = el('details'); original.append(el('summary', '발췌 보기'), el('pre', source.text, 'writing-ai-text'));
      item.append(label, original); sourceFields.append(item); return check;
    });
    if (!choices.length) sourceFields.append(el('p', '작성 준비에서 자료의 구절을 먼저 골라 주세요.', 'life-help'));
    form.append(sourceFields);
    const guidanceEnabled = el('input'); guidanceEnabled.type = 'checkbox'; guidanceEnabled.id = 'writingAIGuidanceEnabled';
    const guidanceLabel = el('label', null, 'writing-ai-guidance-toggle'); guidanceLabel.append(guidanceEnabled, el('span', '이번 요청에 AI 지침 사용'));
    const guidance = el('textarea'); guidance.id = 'writingAIGuidance'; guidance.rows = 3; guidance.maxLength = AI.LIMITS.guidance;
    const guidanceField = field('AI 지침', guidance); guidanceField.hidden = true;
    const guidanceBox = el('details', null, 'writing-ai-guidance'); guidanceBox.append(el('summary', 'AI 지침'), guidanceLabel, guidanceField);
    form.append(guidanceBox);
    const previewButton = button('보낼 내용 확인', prepareReview, 'writing-ai-preview-button');
    form.append(previewButton);
    const preview = el('section', null, 'writing-ai-preview'); preview.hidden = true;
    const result = el('section', null, 'writing-ai-result'); result.hidden = true;
    const sendButton = button('보내기', send, 'writing-ai-send');
    const retryButton = button('다시 시도', prepareReview, 'writing-ai-retry'); retryButton.hidden = true;
    const applyButton = button('선택한 제안 적용', apply, 'writing-ai-apply'); applyButton.disabled = true;
    const footer = el('div', null, 'writing-ai-actions'); footer.append(retryButton);
    dialog.append(header, usage, usageRetry, form, preview, status, error, result, footer);

    function button(text, action, className) {
      const node = el('button', text, className); node.type = 'button';
      node.addEventListener('click', () => { Promise.resolve().then(action).catch(showError); });
      return node;
    }
    function field(label, input) {
      const node = el('label', null, 'writing-ai-field'); node.append(el('span', label), input); return node;
    }
    function current() {
      const account = auth?.getAccount();
      return !closed && dialog.isConnected && isCurrent() && !!target && account?.userId === target.userId &&
        account.projectUrl === target.projectUrl && auth.epoch === authEpoch;
    }
    function ensureCurrent() {
      if (!current()) throw Object.assign(new Error(AI.MESSAGES.ai_not_current), { code: 'ai_not_current' });
    }
    async function verifyCurrent() {
      ensureCurrent();
      // Source adapters may need a fresh stored snapshot after a change event.
      // Recheck after that await; unrelated writes must not invalidate a panel.
      if (validateCurrent) {
        try { await validateCurrent(); }
        catch (cause) { dispose(); throw cause; }
      }
      ensureCurrent();
    }
    function showError(value) {
      if (closed) return;
      error.textContent = AI.MESSAGES[value?.code] || (value?.message && !value?.code ? value.message : AI.MESSAGES.server_error);
      error.hidden = false;
      if (dialog.isConnected) reveal(error);
    }
    function clearError() { error.textContent = ''; error.hidden = true; }
    function reveal(node) {
      // Scroll only this modal: moving an ancestor scroll container would lose
      // the editor's reading position beneath it. Keep the sticky header clear.
      dialog.scrollTop += node.getBoundingClientRect().top - dialog.getBoundingClientRect().top - header.offsetHeight - 12;
    }
    function dispose() {
      if (closed) return;
      closed = true;
      requestController?.abort(); usageController?.abort(); clearTimeout(requestTimer);
      unsubscribe?.(); root.removeEventListener('pagehide', dispose);
      if (dialog.open) dialog.close(); dialog.remove();
      prepared = response = null; selectedSources = [];
      instruction.value = '';
      onClose();
      if (isCurrent() && opener?.isConnected) opener.focus({ preventScroll: true });
    }
    function setBusy(value) {
      busy = value;
      for (const input of form.querySelectorAll('input, select, textarea, button')) input.disabled = value;
      sendButton.disabled = value;
      dialog.setAttribute('aria-busy', String(value));
    }
    function resetReview() {
      if (busy) return;
      prepared = response = null; selectedSources = [];
      preview.hidden = result.hidden = retryButton.hidden = true;
      preview.replaceChildren(); result.replaceChildren(); status.textContent = ''; clearError();
    }
    function taskChanged() {
      resetReview();
      instructionField.hidden = AI.TASKS[task.value].instruction === 'forbidden';
      sourceFields.hidden = AI.TASKS[task.value].sources === 'forbidden';
    }
    task.addEventListener('change', taskChanged);
    instruction.addEventListener('input', resetReview); guidance.addEventListener('input', resetReview);
    for (const input of [instruction, guidance]) {
      input.addEventListener('compositionstart', () => { composing.add(input); resetReview(); });
      input.addEventListener('compositionend', () => { composing.delete(input); resetReview(); });
    }
    guidanceEnabled.addEventListener('change', () => { guidanceField.hidden = !guidanceEnabled.checked; resetReview(); });
    for (const check of sourceChecks) check.addEventListener('change', resetReview);

    const request = auth?.config ? AI.remoteRequest({ projectUrl: auth.config.url, publicKey: auth.config.key,
      accessToken: async () => {
        ensureCurrent();
        const verified = await auth.verify(); ensureCurrent();
        if (verified?.id !== target.userId) throw Object.assign(new Error(), { code: 'unauthorized' });
        const session = await auth.getClient().auth.getSession(); ensureCurrent();
        if (session.error || session.data?.session?.user?.id !== target.userId) throw Object.assign(new Error(), { code: 'unauthorized' });
        await verifyCurrent();
        return session.data.session.access_token;
      } }) : async () => ({ error: 'ai_not_configured' });
    const ai = AI.create({ request, isCurrent: value => value === token && current() });

    function prepareReview() {
      if (busy) return;
      ensureCurrent(); resetReview();
      if (composing.size) throw new Error('입력을 마친 뒤 다시 눌러 주세요.');
      const spec = AI.TASKS[task.value];
      selectedSources = spec.sources === 'forbidden' ? [] : choices.filter((_, index) => sourceChecks[index].checked);
      prepared = ai.prepare({ task: task.value, selectionText,
        instruction: spec.instruction === 'forbidden' ? '' : instruction.value,
        guidance: guidanceEnabled.checked ? guidance.value : '', sources: selectedSources.map(source => source.text) });
      preview.append(el('h3', '보낼 내용'), el('p', '작업: ' + prepared.label, 'life-meta'));
      for (const [key, name] of [['selection', '선택한 글'], ['instruction', '요청 문장'], ['guidance', 'AI 지침']]) {
        if (prepared.preview[key] !== undefined) preview.append(el('h4', name), el('pre', prepared.preview[key], 'writing-ai-text'));
      }
      (prepared.preview.sources || []).forEach((text, index) => {
        preview.append(el('h4', '자료 발췌 ' + (index + 1) + ' · ' + selectedSources[index].label), el('pre', text, 'writing-ai-text'));
      });
      const sentItems = [];
      if (prepared.preview.selection !== undefined) sentItems.push('고른 글');
      if (prepared.preview.sources?.length) sentItems.push('자료 발췌');
      if (prepared.preview.instruction !== undefined) sentItems.push('요청 문장');
      if (prepared.preview.guidance !== undefined) sentItems.push('AI 지침');
      const subject = sentItems.join('·') + (sentItems.at(-1) === '자료 발췌' ? '를' : '을');
      preview.append(el('p', subject + ' Anthropic에 보내 제안을 받습니다. 입력은 30일 안에 삭제됩니다(정책 위반 표시 시 더 길게 보관). 학습에는 쓰지 않습니다.', 'writing-ai-notice'));
      preview.append(sendButton); sendButton.disabled = false; preview.hidden = false;
      sendButton.focus({ preventScroll: true });
      reveal(preview);
    }
    async function send() {
      if (busy || !prepared) return;
      ensureCurrent();
      if (composing.size) throw new Error('입력을 마친 뒤 다시 눌러 주세요.');
      clearError(); setBusy(true); retryButton.hidden = true;
      // Starting a paid request invalidates the prior balance, even when the
      // eventual response is a refusal, timeout or unreadable result.
      usageController?.abort(); usageController = null;
      usage.textContent = '이번 달 남은 금액: 요청 후 확인할게요.';
      usageRetry.hidden = true;
      const pending = prepared;
      requestController = new AbortController();
      requestTimer = setTimeout(() => requestController?.abort(), 75000);
      status.textContent = '제안을 기다리는 중… 닫아도 이미 보낸 요청의 비용이 발생할 수 있어요.';
      let value;
      try {
        await verifyCurrent();
        value = await ai.send(pending, { token, signal: requestController.signal });
        await verifyCurrent();
      }
      catch (_) { value = { status: 'error', code: 'ai_invalid_response' }; }
      finally { clearTimeout(requestTimer); requestTimer = null; }
      if (!current()) { dispose(); return; }
      setBusy(false); sendButton.disabled = true; prepared = null;
      status.textContent = '';
      if (value.status !== 'ok') {
        if (value.status === 'discarded') { dispose(); return; }
        showError(value);
        retryButton.hidden = ['ai_not_configured', 'setup_required', 'ai_not_allowed', 'origin_not_allowed', 'ai_monthly_limit'].includes(value.code);
        loadUsage();
        return;
      }
      response = value;
      // An earlier usage read may still be in flight. Its pre-request balance
      // must not replace the remaining amount returned by this completion.
      usageController?.abort(); usageController = null;
      if (Number.isSafeInteger(value.remainingMicroUsd) && value.remainingMicroUsd >= 0) showUsage(value.remainingMicroUsd);
      else loadUsage();
      renderResult(value);
    }
    function renderResult(value) {
      preview.hidden = true; result.replaceChildren(); result.hidden = false;
      result.append(el('h3', '제안'), el('pre', value.suggestion, 'writing-ai-text'), el('p', value.reason, 'writing-ai-reason'));
      if (selectedSources.length) {
        const citations = el('div', null, 'writing-ai-citations'); citations.append(el('h4', '인용 대조'));
        if (!value.citations.length) citations.append(el('p', '대조할 인용이 없어요.', 'life-help'));
        for (const citation of value.citations) {
          if (citation.status !== 'quoted') { citations.append(el('p', '출처 미확인', 'writing-ai-unverified')); continue; }
          const source = selectedSources[citation.sourceIndex];
          const quote = el('blockquote', citation.quote);
          const detail = el('details'); detail.append(el('summary', '보낸 발췌 확인 · ' + source.label), el('pre', source.text, 'writing-ai-text'));
          citations.append(quote, detail);
        }
        result.append(citations, el('p', '제안은 아직 글이나 작성 준비에 반영되지 않았어요.', 'life-help'));
      } else if (typeof onApply === 'function') {
        if (!value.ranges.length) result.append(el('p', '선택한 글과 같은 제안이에요. 바꿀 구간이 없어요.', 'life-help'));
        else {
          result.append(el('p', '반영할 구간을 고르세요. 고르지 않은 구간은 그대로 둡니다.', 'life-help'));
          for (const [index, range] of value.ranges.entries()) {
            const item = el('div', null, 'writing-ai-range');
            const check = el('input'); check.type = 'checkbox'; check.dataset.aiRange = range.id;
            const label = el('label'); label.append(check, el('span', '구간 ' + (index + 1) + ' 수락'));
            item.append(label, el('p', '현재 글', 'life-meta'), el('pre', range.before || '(없음)', 'writing-ai-before'),
              el('p', '제안 글', 'life-meta'), el('pre', range.insert || '(삭제)', 'writing-ai-after'));
            check.addEventListener('change', () => { applyButton.disabled = !result.querySelector('[data-ai-range]:checked'); });
            result.append(item);
          }
          applyButton.disabled = true; result.append(applyButton);
        }
      }
      result.append(button('제안 버리기', dispose, 'writing-ai-discard'));
      result.tabIndex = -1; result.focus({ preventScroll: true });
      reveal(result);
    }
    async function apply() {
      if (busy || !response || applyButton.disabled) return;
      ensureCurrent(); clearError();
      const accepted = [...result.querySelectorAll('[data-ai-range]:checked')].map(check => check.dataset.aiRange);
      if (!accepted.length) return;
      applyButton.disabled = true;
      try {
        await onApply(response, accepted, { apply: (ops, options) => ai.apply(ops, { ...options, token }) });
        dispose();
      } catch (value) { applyButton.disabled = false; showError(value); }
    }
    function showUsage(remaining) {
      usage.textContent = '이번 달 남은 금액: $' + (remaining / 1000000).toFixed(2);
      usageRetry.hidden = true;
    }
    async function loadUsage() {
      if (!current() || busy) return;
      usageController?.abort();
      const controller = new AbortController(); usageController = controller;
      const timeout = setTimeout(() => controller.abort(), 10000);
      usage.textContent = '이번 달 남은 금액: 확인 중…';
      usageRetry.hidden = true;
      usageRetry.disabled = true;
      try {
        const answer = await auth.request(auth.config.url + '/rest/v1/rpc/life_ai_usage', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal,
        });
        if (!answer.ok) throw new Error('usage');
        const data = await answer.json();
        if (!current() || usageController !== controller) return;
        const amounts = [data.limit_micro_usd, data.cost_micro_usd, data.reserved_micro_usd];
        if (!amounts.every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('usage');
        showUsage(Math.max(0, amounts[0] - amounts[1] - amounts[2]));
      } catch (_) {
        if (!current() || usageController !== controller) return;
        usage.textContent = '이번 달 남은 금액: 확인하지 못했어요.'; usageRetry.hidden = false;
      } finally { clearTimeout(timeout); if (!closed && usageController === controller) usageRetry.disabled = false; }
    }
    dialog.addEventListener('cancel', event => { event.preventDefault(); dispose(); });
    dialog.addEventListener('close', dispose);
    root.addEventListener('pagehide', dispose);
    document.body.append(dialog); dialog.showModal(); taskChanged();
    unsubscribe = auth?.onAccountChange(() => { if (!current()) dispose(); });
    if (!target || !auth?.config) { showError({ code: 'ai_not_configured' }); previewButton.disabled = true; usage.textContent = '이번 달 남은 금액: 확인할 수 없어요.'; }
    else loadUsage();
    task.focus({ preventScroll: true });
    return Object.freeze({ dispose, getInstruction: () => closed ? '' : instruction.value });
  }
  life.WritingAIUI = Object.freeze({ open });
})(globalThis);

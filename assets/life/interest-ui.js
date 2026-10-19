/* Local interest review. No network or model preparation on import/open/select. */
(function (root) {
  'use strict';
  const node = (tag, text, cls) => { const el = root.document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; };
  function create({ container, storage, getBundle, isCurrent, onOpenEvidence, policy = root.HaedoLife.InterestPolicy, createAnalysis }) {
    const profile = () => root.HaedoLife.InterestProfile;
    const sessions = new Map();
    let active = false, disposed = false, generation = 0, current = null, workspaceId = null, unsubscribe = null;
    let analyzer = null, modelOwner = null, aborter = null, busy = false, surface = null;
    const inScope = () => !disposed && active && isCurrent() && getBundle()?.workspaceId === workspaceId;
    const valid = token => token === generation && inScope();
    function control(text, id, action, primary = false) {
      const el = node('button', text, 'life-button' + (primary ? ' life-primary' : '')); el.type = 'button'; if (id) el.id = id;
      el.addEventListener('click', () => { if (inScope() && !busy) run(action); }); return el;
    }
    function message(text, error = false) {
      if (!inScope()) return;
      const el = surface?.querySelector(error ? '#interestError' : '#interestStatus'); if (el) { el.textContent = text; el.hidden = !text; }
    }
    function errorText(error) {
      if (error?.name === 'AbortError') return '분석을 취소했습니다.';
      if (error?.code === 'interest_profile_conflict') return '다른 탭에서 관심을 변경했습니다. 입력을 복사한 뒤 최신 관심을 확인해 주세요.';
      if (/stale|reference|scope/.test(error?.code || '')) return '원문 또는 계정·공간이 바뀌었습니다. 범위를 다시 확인해 주세요. 기존 관심은 유지했습니다.';
      return '처리하지 못했습니다. 입력과 기존 자료는 유지했습니다. 다시 시도해 주세요.';
    }
    async function run(action) {
      const token = generation; busy = true; message('', true); updateBusy();
      try { await action(token); }
      catch (error) { if (valid(token)) message(errorText(error), true); }
      finally { if (valid(token)) { busy = false; updateBusy(); } }
    }
    function updateBusy() {
      if (!surface?.isConnected) return;
      surface.setAttribute('aria-busy', String(busy));
      surface.querySelectorAll('button,input,textarea').forEach(el => { if (el.id !== 'interestCancel') el.disabled = busy || el.dataset.unavailable === 'true'; });
      const cancel = surface.querySelector('#interestCancel'); if (cancel) cancel.hidden = !busy;
    }
    const confirmationsDirty = slot => !!slot?.confirmedDraft && (slot.confirmedDraft.size !== slot.saved.confirmedIds.length || slot.saved.confirmedIds.some(id => !slot.confirmedDraft.has(id)));
    function dirty() { return !!current && (current.manualText !== current.baseManualText || !!current.pendingResult || confirmationsDirty(current) || !!current.confirmationStale); }
    function lines(text) { return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean); }
    function manualItems() {
      const existing = new Map(current.saved.manual.map(item => [item.label, item.id]));
      return [...new Set(lines(current.manualText))].map(label => ({ id: existing.get(label) || 'manual-' + root.crypto.randomUUID(), label }));
    }
    async function persist(next, token) {
      if (!valid(token)) throw Object.assign(new Error('scope'), { code: 'interest_scope_closed' });
      const result = await storage.saveInterestProfile(workspaceId, next, current.saved.revision);
      if (!valid(token)) return false;
      if (result.status !== 'stored') { current.conflict = true; throw Object.assign(new Error('conflict'), { code: 'interest_profile_conflict' }); }
      const draft = current.manualText, hasDraft = draft !== current.baseManualText;
      current.saved = result.profile; current.conflict = false; message('', true);
      current.baseManualText = result.profile.manual.map(item => item.label).join('\n');
      current.manualText = hasDraft ? draft : current.baseManualText; return true;
    }
    async function saveManual(token) {
      if (current.conflict) throw Object.assign(new Error('conflict'), { code: 'interest_profile_conflict' });
      const next = profile().setManual(current.saved, manualItems(), { expectedRevision: current.saved.revision });
      if (await persist(next, token)) { current.manualText = current.baseManualText; const input = surface?.querySelector('#interestManual'); if(input) input.value = current.manualText; message('관심을 이 브라우저에 보관했습니다.'); }
    }
    async function saveProposed(token) {
      if (!current.pendingResult) return;
      const next = await profile().propose(getBundle(), current.saved, current.pendingResult.result,
        { sourceVersionIds: current.pendingResult.ids, expectedRevision: current.saved.revision });
      if (!valid(token)) return;
      if (await persist(next, token)) { current.pendingResult = null; current.confirmedDraft = null; current.confirmationStale = false; draw(); message('분석 후보를 보관했습니다. 근거를 확인한 뒤 선택해 주세요.'); }
    }
    async function flush() {
      if (disposed) return;
      if (busy) cancel(false);
      if (dirty()) throw Object.assign(new Error('관심 입력 또는 후보 선택이 아직 보관되지 않았습니다. 관심 보관·선택한 후보 확인·입력 되돌리기 중 필요한 행동을 선택해 주세요.'), { code: 'interest_unsaved' });
    }
    function cancel(redraw = true) {
      generation++; aborter?.abort(); aborter = null; analyzer?.cancel();
      Promise.resolve(analyzer?.dispose()).catch(() => {}); analyzer = null;
      Promise.resolve(modelOwner?.dispose()).catch(() => {}); modelOwner = null; busy = false;
      if (redraw && inScope()) { draw(); message('분석을 취소했습니다. 다시 분석하거나 관심을 직접 입력할 수 있습니다.'); }
    }
    async function analyze(token) {
      if (!policy.analysisEnabled) return;
      if (current.conflict) throw Object.assign(new Error('conflict'), { code: 'interest_profile_conflict' });
      const ids = [...current.selected]; if (!ids.length) return;
      aborter = new AbortController();
      if (createAnalysis) analyzer = createAnalysis();
      else { modelOwner = root.HaedoLife.InterestModel.create(); analyzer = root.HaedoLife.InterestAnalysis.create({ loadModel: modelOwner.loadModel }); }
      const ownAnalyzer = analyzer, ownOwner = modelOwner, ownAborter = aborter;
      const progress = value => {
        if (!valid(token)) return;
        const count = value.completed && value.total ? ' ' + value.completed + '/' + value.total : '';
        message(value.phase === 'analysis' ? '선택한 자료를 분석하고 있습니다.' + count : '공개 모델을 받아 이 브라우저에서 준비하고 있습니다.');
      };
      try {
        await ownAnalyzer.prepare({ signal: ownAborter.signal, onProgress: progress }); if (!valid(token)) return;
        const result = await ownAnalyzer.analyze(getBundle(), { sourceVersionIds: ids, signal: ownAborter.signal, onProgress: progress });
        if (!valid(token)) return;
        current.diagnostics = result.diagnostics || null;
        current.pendingResult = { result, ids }; await saveProposed(token);
      } finally {
        if (analyzer === ownAnalyzer) { analyzer = null; aborter = null; }
        if (modelOwner === ownOwner) modelOwner = null;
        await ownAnalyzer?.dispose(); await ownOwner?.dispose();
      }
    }
    function draw() {
      if (!inScope()) return;
      surface = node('section', null, 'interest-review'); surface.id = 'interestReview';
      const intro = node('p', policy.analysisEnabled ? '관심을 직접 적거나, 선택한 자료에서 주제와 질문 후보를 확인합니다. 다른 사람이 쓴 자료는 사용자의 신념으로 판단하지 않습니다.' : '현재는 관심을 직접 적어 보관할 수 있습니다. 자료의 주제·질문 자동 분석은 품질 기준을 충족할 때 연결합니다.', 'life-help');
      const status = node('p', '', 'life-status'); status.id = 'interestStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.hidden = true;
      const error = node('p', '', 'life-error'); error.id = 'interestError'; error.setAttribute('role', 'alert'); error.hidden = true;
      surface.append(intro, status, error);
      const manual = node('section'); manual.append(node('h2', '직접 적은 관심'));
      const label = node('label', null, 'life-field'); label.append(node('span', '관심 주제 · 한 줄에 하나씩'));
      const input = node('textarea'); input.id = 'interestManual'; input.rows = 3; input.maxLength = 3000; input.value = current.manualText;
      input.addEventListener('input', () => { current.manualText = input.value; }); label.append(input);
      manual.append(label, control('관심 보관', 'interestSaveManual', saveManual, true));
      manual.append(control('입력 되돌리기', 'interestRevertManual', async () => { current.manualText = current.baseManualText; current.pendingResult = null; current.confirmedDraft = new Set(current.saved.confirmedIds); current.confirmationStale = false; draw(); }));
      manual.append(node('p', '관심과 분석 후보는 이 계정·작업공간의 이 브라우저에만 보관합니다. 원문 백업·서버 동기화·공개 사본에는 포함하지 않습니다.', 'life-help'));
      surface.append(manual);
      const selection = node('details'); selection.id = 'interestSelection'; selection.open = current.selectionOpen;
      selection.addEventListener('toggle', () => { current.selectionOpen = selection.open; }); selection.append(node('summary', '분석할 자료 선택'));
      const sources = new Map(getBundle().sources.map(source => [source.id, source])); const latest = new Map();
      getBundle().sourceVersions.forEach(version => latest.set(version.sourceId, version));
      const rows = [...latest.values()].filter(v => typeof v.contentText === 'string' && v.contentText.trim());
      const availableIds = new Set(rows.map(v => v.id));
      for (const id of current.selected) if (!availableIds.has(id)) current.selected.delete(id);
      const count = node('p', current.selected.size + '개 선택 · 최대 50개', 'life-meta'); count.id = 'interestSelectionCount'; selection.append(count);
      selection.append(node('p', '선택 가능 ' + rows.length + '개 · 본문이 없거나 빈 자료 ' + (latest.size - rows.length) + '개 제외', 'life-meta'));
      if (!rows.length) selection.append(node('p', '본문이 있는 자료를 자료실에 가져온 뒤 선택할 수 있습니다.', 'life-empty'));
      const list = node('div', null, 'interest-sources');
      rows.forEach(version => {
        const label = node('label', null, 'interest-source'); const box = node('input'); box.type = 'checkbox'; box.value = version.id; box.checked = current.selected.has(version.id); box.dataset.interestVersion = version.id;
        box.addEventListener('change', () => {
          if (box.checked && current.selected.size >= 50) { box.checked = false; message('최대 50개까지 선택할 수 있습니다.', true); return; }
          box.checked ? current.selected.add(version.id) : current.selected.delete(version.id);
          count.textContent = current.selected.size + '개 선택 · 최대 50개';
          const action = surface.querySelector('#interestAnalyze'); if (action && policy.analysisEnabled) { action.dataset.unavailable = String(!current.selected.size); action.disabled = !current.selected.size; }
        });
        const copy = node('span'); copy.append(node('span', sources.get(version.sourceId)?.title || '제목 없는 자료'), node('small', version.originalAuthor?.relation === 'self' ? '직접 작성으로 표시한 자료' : '보관한 자료 · 작성 관계 확인 필요', 'life-meta'));
        label.append(box, copy); list.append(label);
      }); selection.append(list);
      selection.append(node('p', '모델 가중치 약 118MB, 토크나이저 약 17MB와 실행 파일을 받습니다. 분석은 이 브라우저의 CPU에서 처리하며 본문을 외부로 보내지 않습니다. 긴 자료는 일부 구간만 확인합니다.', 'life-help'));
      const actions = node('div', null, 'interest-actions');
      const analyzeButton = control('모델 준비·분석', 'interestAnalyze', analyze, true); analyzeButton.dataset.unavailable = String(!policy.analysisEnabled || !current.selected.size);
      const cancelButton = node('button', '분석 취소', 'life-button'); cancelButton.type = 'button'; cancelButton.id = 'interestCancel'; cancelButton.hidden = !busy; cancelButton.addEventListener('click', () => cancel());
      actions.append(analyzeButton, cancelButton); selection.append(actions);
      if (!policy.analysisEnabled) selection.append(node('p', policy.reason, 'life-help'));
      surface.append(selection);
      if (current.pendingResult) surface.append(control('분석 후보 다시 보관', 'interestRetrySave', saveProposed));
      const analysis = current.saved.analysis;
      if (analysis) {
        const candidates = node('section'); candidates.append(node('h2', '보관 자료의 주제·질문 후보'));
        candidates.append(node('p', '선택한 정확 버전 ' + analysis.selection.sourceVersionIds.length + '개 · 중복 본문을 합친 분석 본문 ' + analysis.documents.length + '개', 'life-meta'));
        if (current.diagnostics) {
          const d = current.diagnostics;
          candidates.append(node('p', '이번 실행에서 확인한 구간 ' + d.sampledCharacters.toLocaleString('ko-KR') + '/' + d.selectedCharacters.toLocaleString('ko-KR') + '자 · 나머지 구간은 분석하지 않았습니다.', 'life-help'));
        } else candidates.append(node('p', '이전에 보관한 후보입니다. 당시 선택 본문 일부만 분석했으며 전체 의미를 확인한 결과가 아닙니다.', 'life-help'));
        candidates.append(node('p', '선택한 본문 일부의 유사성을 바탕으로 제안한 후보입니다. 근거가 정확해도 해석은 틀릴 수 있습니다.', 'life-help'));
        const choices = new Set(current.saved.confirmedIds); current.confirmedDraft ||= choices;
        if (!analysis.interests.length) candidates.append(node('p', '반복되는 후보를 확인하지 못했습니다. 직접 관심을 입력할 수 있습니다.', 'life-empty'));
        analysis.interests.forEach(item => {
          const row = node('article', null, 'interest-candidate'); const label = node('label', null, 'interest-choice'); const check = node('input'); check.type = 'checkbox'; check.value = item.id; check.checked = current.confirmedDraft.has(item.id); check.dataset.interestCandidate = item.id;
          check.addEventListener('change', () => check.checked ? current.confirmedDraft.add(item.id) : current.confirmedDraft.delete(item.id)); label.append(check, node('strong', item.label)); row.append(label);
          row.append(node('p', (item.kind === 'question' ? '보관 자료의 질문' : '보관 자료의 주제') + ' · 서로 다른 본문 ' + item.support + '개', 'life-meta'));
          const evidence = node('details'); evidence.append(node('summary', '근거 확인'));
          item.evidence.forEach((entry, index) => {
            const version = getBundle().sourceVersions.find(v => v.id === entry.sourceVersionId && v.sourceId === entry.sourceId);
            const author = version?.originalAuthor;
            evidence.append(node('p', (sources.get(entry.sourceId)?.title || '정확 버전의 원문') + ' · ' +
              (author?.relation === 'self' ? '직접 작성으로 표시' : author?.relation === 'other' ? '다른 사람이 작성' : '작성자 미확정') +
              (author?.label ? ' · ' + author.label : '') + ' · ' + (version?.coverage?.status === 'full_text' ? '제공한 본문 전체' : version?.coverage?.status === 'partial' ? '본문 일부' : '확보 범위 미확인'), 'life-meta'));
            evidence.append(node('blockquote', entry.quote));
            const open = control('원문에서 확인', null, async () => { await onOpenEvidence(entry, 'interests:' + item.id + ':' + index); }); open.dataset.focusKey = 'interests:' + item.id + ':' + index; open.dataset.interestEvidence = ''; evidence.append(open);
          }); row.append(evidence); candidates.append(row);
        });
        if (analysis.interests.length) candidates.append(control('선택한 후보 확인', 'interestConfirm', async token => {
          if (current.conflict || current.confirmationStale) throw Object.assign(new Error('conflict'), { code: 'interest_profile_conflict' });
          const next = await profile().confirm(getBundle(), current.saved, [...current.confirmedDraft], { expectedRevision: current.saved.revision });
          if (valid(token) && await persist(next, token)) { draw(); message('선택을 보관했습니다. 사용자 신념이나 작성자로 확정한 것은 아닙니다.'); }
        }, true)); surface.append(candidates);
      }
      const reload = control('최신 관심 확인', 'interestReload', async token => {
        const hadManualDraft = current.manualText !== current.baseManualText, hadConfirmationDraft = confirmationsDirty(current);
        const priorFingerprint = current.saved.analysis?.inputFingerprint;
        const saved = await storage.readInterestProfile(workspaceId); if (!valid(token)) return;
        current.saved = saved; current.baseManualText = saved.manual.map(x => x.label).join('\n');
        if (!hadManualDraft) current.manualText = current.baseManualText;
        current.confirmationStale = !!hadConfirmationDraft && (current.confirmationStale || priorFingerprint !== saved.analysis?.inputFingerprint);
        if (!hadConfirmationDraft) current.confirmedDraft = new Set(saved.confirmedIds);
        current.conflict = false;
        draw(); message('최신 관심을 확인했습니다. 작성 중 입력은 남겨 두었습니다.');
        if (current.confirmationStale) message('분석 후보가 바뀌어 이전 선택을 적용하지 않았습니다. 입력 되돌리기로 최신 후보를 다시 확인해 주세요.', true);
      }); reload.hidden = !current.conflict; surface.append(reload);
      const manage = node('details'); manage.append(node('summary', '관심 초기화'));
      manage.append(node('p', '직접 적은 관심과 분석 후보만 지웁니다. 기존 원문과 글은 유지합니다.', 'life-help'));
      manage.append(control('관심 초기화', 'interestReset', async token => {
        const next = profile().clear(current.saved, { expectedRevision: current.saved.revision });
        if (await persist(next, token)) { current.manualText = current.baseManualText; current.pendingResult = null; current.confirmedDraft = null; current.confirmationStale = false; draw(); message('관심을 초기화했습니다. 기존 자료는 유지했습니다.'); }
      })); surface.append(manage); container.replaceChildren(surface); updateBusy();
    }
    async function render() {
      leave(); if (disposed) return;
      active = true; workspaceId = getBundle().workspaceId; const token = generation;
      current = sessions.get(workspaceId);
      const saved = await storage.readInterestProfile(workspaceId); if (!valid(token)) return;
      if (!current) { current = { saved, manualText: saved.manual.map(x => x.label).join('\n'), baseManualText: saved.manual.map(x => x.label).join('\n'), selected: new Set(), selectionOpen: false, conflict: false, pendingResult: null, confirmedDraft: null }; sessions.set(workspaceId, current); }
      else { const untouched = current.manualText === current.baseManualText, untouchedConfirmations = !confirmationsDirty(current), priorFingerprint = current.saved.analysis?.inputFingerprint;
        current.saved = saved; current.baseManualText = saved.manual.map(x => x.label).join('\n'); if (untouched) current.manualText = current.baseManualText;
        if (untouchedConfirmations) current.confirmedDraft = new Set(saved.confirmedIds);
        else if (priorFingerprint !== saved.analysis?.inputFingerprint) current.confirmationStale = true;
      }
      unsubscribe = storage.subscribe(workspaceId, event => { if (event.type === 'interest_profile_changed' && event.revision > current.saved.revision && inScope()) { current.conflict = true; const reload = surface?.querySelector('#interestReload'); if(reload) reload.hidden = false; message('다른 탭에서 관심을 변경했습니다. 입력을 복사한 뒤 최신 관심을 확인해 주세요.', true); } });
      draw();
    }
    function leave() { cancel(false); active = false; unsubscribe?.(); unsubscribe = null; }
    function dispose() { if (disposed) return; leave(); disposed = true; sessions.clear(); current = null; }
    return { render, leave, dispose, dirty, flush };
  }
  root.HaedoLife ||= {}; root.HaedoLife.InterestUI = Object.freeze({ create });
})(globalThis);

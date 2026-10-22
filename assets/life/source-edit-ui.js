/* Editing a private material copy. The stored original versions stay immutable. */
(function (global) {
  'use strict';
  const life = global.HaedoLife = global.HaedoLife || {};
  const copy = value => JSON.parse(JSON.stringify(value));
  const fault = (code, message) => Object.assign(new Error(message), { code });
  function node(tag, text, className) {
    const value = document.createElement(tag);
    if (text != null) value.textContent = String(text);
    if (className) value.className = className;
    return value;
  }
  function create({ host, storage, core, getBundle, getAccountKey = () => null, isDisposed = () => false,
    announce = () => {}, onSaved = () => {}, onClose = () => {} }) {
    const model = life.SourceEdit, sessions = new Map(), urls = new Set();
    let disposed = false, visible = false, generation = 0, current = null;
    let surface, status, errorBox, form, previewHost, titleInput, bodyInput, formatInput, saveButton, previewButton;
    const alive = () => !disposed && !isDisposed();
    const scope = session => alive() && getBundle()?.workspaceId === session.workspaceId && getAccountKey() === session.account;
    const showing = (session, token = generation) => visible && token === generation && current === session && scope(session);
    const dirtySession = session => session.stage.state === 'draft' && session.edit !== session.stored;
    const keyFor = (workspaceId, account) => JSON.stringify([account, workspaceId]);
    function remember(session = current) {
      if (!session || current !== session || !bodyInput || !titleInput) return;
      session.editorPosition = { title: { start: titleInput.selectionStart, end: titleInput.selectionEnd },
        body: { start: bodyInput.selectionStart, end: bodyInput.selectionEnd, direction: bodyInput.selectionDirection, top: bodyInput.scrollTop },
        scrollY: global.scrollY, focus: document.activeElement === titleInput ? 'title' : 'body' };
    }
    function restore(session, focus = false) {
      const position = session.editorPosition;
      if (!position || !showing(session)) return;
      titleInput.setSelectionRange(position.title.start, position.title.end);
      bodyInput.setSelectionRange(position.body.start, position.body.end, position.body.direction);
      bodyInput.scrollTop = position.body.top;
      if (focus) (position.focus === 'title' ? titleInput : bodyInput).focus({ preventScroll: true });
      global.scrollTo({ top: position.scrollY, behavior: 'instant' });
    }
    function fitInputs() {
      if (!visible || !current || !scope(current)) return;
      for (const control of [titleInput, bodyInput]) {
        if (!control?.isConnected || control.closest('[hidden]')) continue;
        control.style.height = 'auto';
        const style = global.getComputedStyle(control), borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
        control.style.height = Math.ceil(control.scrollHeight + borders) + 'px';
      }
    }
    global.addEventListener('resize', fitInputs);
    function message(error) {
      if (error?.code === 'stage_conflict') return '다른 탭에서 수정 초안이 바뀌었습니다. 현재 입력은 유지했습니다.';
      if (error?.code === 'storage_quota') return '저장 공간이 부족합니다. 입력을 파일로 보관한 뒤 다시 시도해 주세요.';
      if (['storage_scope_closed', 'workspace_access_denied', 'source_edit_scope_changed'].includes(error?.code)) return '계정 또는 작업공간이 바뀌어 저장을 멈췄습니다.';
      return error?.message || '저장하지 못했습니다. 입력은 유지했습니다.';
    }
    function action(label, id, task, { primary = false, glyph } = {}) {
      const value = node('button', glyph ? null : label, 'life-button' + (primary ? ' life-primary' : '') + (glyph ? ' life-icon-button' : ''));
      value.type = 'button'; value.id = id;
      if (glyph) { value.setAttribute('aria-label', label); value.append(life.Icons.create(glyph)); const tip = node('span', label, 'life-tooltip'); tip.setAttribute('aria-hidden', 'true'); value.append(tip); }
      const token = generation, session = current;
      value.addEventListener('click', async () => {
        if (!showing(session, token) || !value.isConnected) return;
        value.disabled = true;
        try { await task(); } catch (error) { report(session, error); }
        finally { if (showing(session, token)) { value.disabled = false; update(session); } }
      });
      return value;
    }
    function update(session) {
      if (!showing(session) || !status) return;
      status.textContent = session.stage.state === 'applied' ? '저장됨' : session.recordSaving ? '저장 중' : session.error ? '입력 유지 · 저장 필요' :
        session.saving ? '초안 보관 중' : dirtySession(session) ? '수정 중' : '이 브라우저에 초안 보관됨';
      status.dataset.state = session.error ? 'error' : session.stage.state === 'applied' ? 'stored' : dirtySession(session) ? 'dirty' : 'draft';
      const blocked = !!session.recordSaving || !!session.openingSaved || session.stage.state === 'applied';
      saveButton.disabled = blocked || !!session.composing.size;
      previewButton.disabled = blocked || !!session.composing.size;
      for (const control of [titleInput, bodyInput, formatInput]) control.disabled = blocked;
      surface.querySelector('#lifeSourceEditClose').disabled = blocked || !!session.composing.size;
    }
    function clearError(session) {
      session.error = null;
      if (showing(session) && errorBox) { errorBox.hidden = true; errorBox.replaceChildren(); }
    }
    function download(session) {
      if (!scope(session)) return;
      const input = session.rawInput || session.stage.input, markdown = input.format === 'text/markdown';
      const url = URL.createObjectURL(new Blob([input.text], { type: markdown ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' }));
      urls.add(url); const link = node('a'); link.href = url; link.download = 'haedo-material-edit.' + (markdown ? 'md' : 'txt'); link.hidden = true;
      document.body.append(link); link.click(); link.remove();
      global.setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 30000);
    }
    function report(session, error) {
      session.error = error;
      if (!showing(session) || !errorBox) return;
      errorBox.replaceChildren(node('p', message(error))); errorBox.hidden = false;
      const controls = node('div', null, 'life-actions');
      controls.append(action('다시 저장', 'lifeSourceEditRetry', () => session.stage.state === 'applied' ? onSaved(session.stage.appliedResult) : save(session)),
        action('입력 파일 받기', 'lifeSourceEditDownload', () => download(session)));
      errorBox.append(controls); update(session);
    }
    function schedule(session) {
      clearTimeout(session.timer); session.timer = null;
      if (!scope(session) || session.composing.size || session.error?.code === 'stage_conflict') return;
      session.timer = global.setTimeout(() => { session.timer = null; if (scope(session)) flushSession(session).catch(() => {}); }, 400);
    }
    async function flushSession(session) {
      clearTimeout(session.timer); session.timer = null;
      if (!scope(session)) throw fault('source_edit_scope_changed');
      if (session.stage.state === 'applied') return;
      if (session.invalidInput) throw session.invalidInput;
      if (session.composing.size) throw fault('source_edit_composing', '입력 중인 글자를 완료한 뒤 다시 시도해 주세요.');
      if (session.saving) { await session.saving; return flushSession(session); }
      if (!dirtySession(session)) return;
      if (session.error?.code === 'stage_conflict') throw session.error;
      const tick = session.edit, payload = copy(session.stage);
      model.validate(payload);
      const task = (async () => {
        try {
          const saved = await storage.saveStage(payload);
          if (!scope(session)) throw fault('source_edit_scope_changed');
          // Only acknowledge the saved snapshot; later accepted input stays live.
          session.stage.revision = saved.revision; session.stage.createdAt = saved.createdAt; session.stage.updatedAt = saved.updatedAt;
          session.stored = tick; clearError(session);
        } catch (error) { report(session, error); throw error; }
        finally { session.saving = null; update(session); }
      })();
      session.saving = task; update(session); await task;
      if (dirtySession(session) && !session.composing.size) return flushSession(session);
    }
    async function flush() {
      const session = current;
      if (!session || session.stage.state === 'applied') return;
      if (!scope(session)) {
        if (!dirtySession(session) && !session.saving && !session.recordSaving && !session.composing.size) return;
        throw fault('source_edit_scope_changed');
      }
      if (session.recordSaving) await session.recordSaving;
      remember(session); await flushSession(session);
    }
    async function save(session) {
      if (!scope(session)) throw fault('source_edit_scope_changed');
      if (session.stage.state === 'applied') return onSaved(session.stage.appliedResult);
      if (session.recordSaving) return session.recordSaving;
      if (session.composing.size) throw fault('source_edit_composing', '입력 중인 글자를 완료한 뒤 저장해 주세요.');
      const token = generation;
      const task = (async () => {
        await flushSession(session);
        const bundle = await storage.read(session.workspaceId);
        if (!scope(session)) throw fault('source_edit_scope_changed');
        if (!session.pendingCommit) {
          const prepared = await model.prepare(bundle, copy(session.stage));
          if (!scope(session)) throw fault('source_edit_scope_changed');
          session.pendingCommit = { workspaceId: session.workspaceId, baseRevision: bundle.revision, operationId: core.id(),
            changes: prepared.changes, stageId: session.stage.stageId, stageRevision: session.stage.revision, stageResult: prepared.stageResult };
        }
        const result = await storage.commitLocal(session.pendingCommit, { isCurrent: () => scope(session) });
        if (!scope(session)) throw fault('source_edit_scope_changed');
        if (result.status !== 'stored') {
          if (result.status === 'conflict') session.pendingCommit = null;
          throw Object.assign(new Error(result.error?.message || '자료를 저장하지 못했습니다. 입력은 유지했습니다.'), { code: result.error?.code || 'workspace_conflict' });
        }
        session.stage.state = 'applied'; session.stage.appliedResult = copy(session.pendingCommit.stageResult);
        session.stage.revision += 1; session.stored = session.edit; clearError(session);
        return copy(session.stage.appliedResult);
      })();
      session.recordSaving = task; update(session);
      let result;
      try { result = await task; } catch (error) { report(session, error); throw error; }
      finally { session.recordSaving = null; update(session); }
      if (showing(session, token)) {
        session.openingSaved = true; update(session);
        try { await onSaved(result); announce('자료를 저장했습니다.'); }
        catch (_) { report(session, fault('source_edit_open_failed', '저장한 자료를 열지 못했습니다. 다시 저장을 눌러 자료를 열어 주세요.')); }
        finally { session.openingSaved = false; update(session); }
      }
      return result;
    }
    function render(session) {
      session.preview = false; session.rawInput ||= copy(session.stage.input);
      const actions = node('div', null, 'life-source-edit-actions');
      actions.append(action('자료로 돌아가기', 'lifeSourceEditClose', async () => { await flush(); if (showing(session)) await onClose({ sourceId: session.stage.baseSourceId, sourceVersionId: session.stage.baseSourceVersionId }); }, { glyph: 'back' }));
      status = node('p', '', 'life-meta'); status.id = 'lifeSourceEditStatus'; status.setAttribute('role', 'status');
      saveButton = action('저장', 'lifeSourceEditSave', () => save(session), { primary: true }); actions.append(status, saveButton);
      surface.append(actions);
      errorBox = node('div', null, 'life-source-edit-error'); errorBox.id = 'lifeSourceEditError'; errorBox.setAttribute('role', 'alert'); errorBox.hidden = true; surface.append(errorBox);
      const controls = node('div', null, 'life-source-edit-controls');
      const formatLabel = node('label', null, 'life-field'); formatLabel.append(node('span', '본문 형식', 'life-sr-only'));
      formatInput = node('select'); formatInput.id = 'lifeSourceEditFormat';
      for (const [value, label] of [['text/plain', '일반 텍스트'], ['text/markdown', '마크다운']]) { const option = node('option', label); option.value = value; formatInput.append(option); }
      formatInput.value = session.rawInput.format; formatLabel.append(formatInput);
      previewButton = action('미리보기', 'lifeSourceEditPreview', () => {
        remember(session); session.preview = !session.preview; form.hidden = session.preview; previewHost.hidden = !session.preview;
        previewButton.textContent = session.preview ? '편집' : '미리보기'; previewButton.setAttribute('aria-pressed', String(session.preview));
        if (session.preview) {
          if (session.invalidInput) { session.preview = false; form.hidden = false; previewHost.hidden = true; previewButton.textContent = '미리보기'; previewButton.setAttribute('aria-pressed', 'false'); throw session.invalidInput; }
          previewHost.replaceChildren(node('h1', session.stage.input.title || '제목 없는 자료', 'life-heading'));
          if (session.stage.input.format === 'text/markdown' && life.SourceMarkdown) previewHost.append(life.SourceMarkdown.render(document, session.stage.input.text).element);
          else previewHost.append(node('div', session.stage.input.text, 'life-source-text'));
        } else { fitInputs(); restore(session, true); }
      });
      previewButton.setAttribute('aria-pressed', 'false'); controls.append(formatLabel, previewButton); surface.append(controls);
      form = node('form', null, 'life-source-edit-form'); form.addEventListener('submit', event => event.preventDefault());
      const titleLabel = node('label', null, 'life-writing-field'); titleLabel.append(node('span', '자료 제목', 'life-sr-only'));
      titleInput = node('textarea', null, 'life-writing-title'); titleInput.id = 'lifeSourceEditTitle'; titleInput.rows = 1; titleInput.maxLength = 500; titleInput.value = session.rawInput.title;
      const bodyLabel = node('label', null, 'life-writing-field'); bodyLabel.append(node('span', '자료 본문', 'life-sr-only'));
      bodyInput = node('textarea', null, 'life-writing-body'); bodyInput.id = 'lifeSourceEditText'; bodyInput.rows = 16; bodyInput.value = session.rawInput.text; bodyInput.spellcheck = false;
      titleLabel.append(titleInput); bodyLabel.append(bodyInput); form.append(titleLabel, bodyLabel); surface.append(form);
      previewHost = node('section', null, 'life-source-edit-preview'); previewHost.id = 'lifeSourceEditPreviewBody'; previewHost.hidden = true; previewHost.setAttribute('aria-label', '수정 미리보기'); surface.append(previewHost);
      const changed = field => {
        // Reading a textarea value normalizes CRLF. Keep the untouched original
        // string on title/format-only edits; only a body input changes its text.
        session.rawInput[field] = field === 'title' ? titleInput.value : field === 'format' ? formatInput.value : bodyInput.value;
        session.edit++; session.pendingCommit = null; fitInputs();
        try {
          session.stage = model.edit(session.stage, session.rawInput); session.invalidInput = null;
          if (session.error?.code !== 'stage_conflict') clearError(session);
          update(session); schedule(session);
        } catch (error) { clearTimeout(session.timer); session.timer = null; session.invalidInput = error; report(session, error); }
      };
      for (const [input, field] of [[titleInput, 'title'], [bodyInput, 'text']]) {
        input.addEventListener('input', () => changed(field));
        input.addEventListener('compositionstart', () => { session.composing.add(input); clearTimeout(session.timer); update(session); });
        input.addEventListener('compositionend', () => { session.composing.delete(input); changed(field); });
      }
      formatInput.addEventListener('change', () => changed('format'));
      form.addEventListener('keydown', event => {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
        event.preventDefault(); if (!event.isComposing && !session.composing.size && !saveButton.disabled) saveButton.click();
      });
      fitInputs(); restore(session); update(session);
      if (session.error) report(session, session.error);
    }
    async function open(options = {}) {
      const bundle = getBundle(), account = getAccountKey();
      if (!alive() || !bundle) return;
      const workspaceId = bundle.workspaceId, key = keyFor(workspaceId, account), token = ++generation;
      visible = true; surface = node('section', null, 'life-source-edit'); surface.id = 'lifeSourceEdit'; surface.setAttribute('aria-busy', 'true'); host.replaceChildren(surface);
      let session = sessions.get(key);
      const currentScope = () => alive() && token === generation && getBundle()?.workspaceId === workspaceId && getAccountKey() === account;
      try {
        if (options.stageId) {
          if (session?.stage.stageId !== options.stageId || session.stage.state === 'applied') {
            const stage = await storage.getStage(options.stageId);
            if (!currentScope()) return;
            model.validate(stage); if (stage.workspaceId !== workspaceId) throw fault('source_edit_scope_changed');
            session = { stage: copy(stage), workspaceId, account, edit: 0, stored: 0, composing: new Set(), timer: null };
          }
        } else if (!session || session.stage.state === 'applied' || session.stage.baseSourceId !== options.sourceId ||
            (options.restore ? session.stage.restoreVersionId !== options.versionId : !!session.stage.restoreVersionId)) {
          const rows = await storage.listStages(workspaceId);
          if (!currentScope()) return;
          const saved = rows.find(row => row.kind === 'source-edit' && row.state === 'draft' && row.baseSourceId === options.sourceId &&
            (options.restore ? row.restoreVersionId === options.versionId : !row.restoreVersionId));
          const stage = saved || model.begin(bundle, options.sourceId, options.restore ? { versionId: options.versionId, restore: true } : {});
          model.validate(stage);
          session = { stage: copy(stage), workspaceId, account, edit: saved ? 0 : 1, stored: 0, composing: new Set(), timer: null };
        }
        if (!currentScope()) return;
        current = session; sessions.set(key, session); surface.setAttribute('aria-busy', 'false'); render(session);
        if (!session.stage.revision) schedule(session);
      } catch (error) {
        if (!currentScope()) return;
        surface.setAttribute('aria-busy', 'false'); surface.replaceChildren(node('p', message(error), 'life-error'));
        const back = node('button', '자료로 돌아가기', 'life-button'); back.type = 'button'; back.id = 'lifeSourceEditClose'; back.addEventListener('click', () => { if (currentScope()) onClose(); }); surface.append(back);
      }
    }
    function close() {
      remember(); visible = false; generation++; surface = status = errorBox = form = previewHost = titleInput = bodyInput = formatInput = saveButton = previewButton = null;
    }
    function dispose() {
      close(); disposed = true; global.removeEventListener('resize', fitInputs);
      for (const session of sessions.values()) clearTimeout(session.timer);
      sessions.clear(); current = null;
      for (const url of urls) URL.revokeObjectURL(url); urls.clear();
    }
    const isDirty = () => !!current && (dirtySession(current) || !!current.saving || !!current.recordSaving || !!current.composing.size);
    return Object.freeze({ open, flush, isDirty, close, dispose });
  }
  life.SourceEditUI = Object.freeze({ create });
})(globalThis);

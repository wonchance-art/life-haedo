/* Editing a private material copy. The stored original versions stay immutable. */
(function (global) {
  'use strict';
  const life = global.HaedoLife = global.HaedoLife || {};
  const copy = value => JSON.parse(JSON.stringify(value));
  const fault = (code, message) => Object.assign(new Error(message), { code });
  // The material itself moved under a draft. A retry cannot succeed, so these open the choices instead.
  const BASE_CODES = ['source_edit_conflict', 'source_trashed', 'missing_reference', 'not_imported_source'];
  const DISCARD_QUESTION = '수정 초안을 버릴까요? 보관한 자료와 이전 판은 그대로입니다.';
  function node(tag, text, className) {
    const value = document.createElement(tag);
    if (text != null) value.textContent = String(text);
    if (className) value.className = className;
    return value;
  }
  function create({ host, storage, core, getBundle, getAccountKey = () => null, isDisposed = () => false,
    announce = () => {}, onSaved = () => {}, onClose = () => {}, onDiscarded = () => {}, onDraftsChanged = () => {}, confirm = text => global.confirm(text) }) {
    const model = life.SourceEdit, sessions = new Map(), urls = new Set();
    let disposed = false, visible = false, generation = 0, current = null;
    let surface, status, errorBox, form, previewHost, titleInput, bodyInput, formatInput, saveButton, previewButton, discardButton;
    const alive = () => !disposed && !isDisposed();
    const scope = session => alive() && getBundle()?.workspaceId === session.workspaceId && getAccountKey() === session.account;
    const showing = (session, token = generation) => visible && token === generation && current === session && scope(session);
    const dirtySession = session => session.stage.state === 'draft' && !session.discarded && session.edit !== session.stored;
    // A stage row exists only after the first real input (or an explicit save).
    const hasDraft = session => session.stage.state === 'draft' && (session.stage.revision > 0 || dirtySession(session));
    const keyFor = (workspaceId, account) => JSON.stringify([account, workspaceId]);
    const newSession = (stage, workspaceId, account) => ({ stage: copy(stage), workspaceId, account, edit: 0, stored: 0, composing: new Set(), timer: null });
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
        try { await task(); } catch (error) { if (showing(session, token)) report(session, error); }
        finally { if (showing(session, token) && value.isConnected) { value.disabled = false; update(session); } }
      });
      return value;
    }
    function update(session) {
      if (!showing(session) || !status || !saveButton) return;
      status.textContent = session.stage.state === 'applied' ? '저장됨' : session.recordSaving ? '저장 중' : session.error ? '입력 유지 · 저장 필요' :
        session.saving ? '초안 보관 중' : dirtySession(session) ? '수정 중' : session.stage.revision ? '이 브라우저에 초안 보관됨' : '변경 없음';
      status.dataset.state = session.error ? 'error' : session.stage.state === 'applied' ? 'stored' : dirtySession(session) ? 'dirty' : session.stage.revision ? 'draft' : 'clean';
      const blocked = !!session.recordSaving || !!session.openingSaved || session.stage.state === 'applied';
      saveButton.disabled = blocked || !!session.composing.size;
      previewButton.disabled = blocked || !!session.composing.size;
      discardButton.disabled = blocked || !!session.composing.size || !hasDraft(session);
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
      if (session.panel) { errorBox.replaceChildren(node('p', message(error))); errorBox.hidden = false; return; }
      errorBox.replaceChildren(node('p', message(error))); errorBox.hidden = false;
      const controls = node('div', null, 'life-actions');
      controls.append(action('다시 저장', 'lifeSourceEditRetry', () => session.stage.state === 'applied' ? onSaved(session.stage.appliedResult) : save(session)),
        action('입력 파일 받기', 'lifeSourceEditDownload', () => download(session)));
      errorBox.append(controls); update(session);
      // The material moved under this draft: replace the retry with what can be done with the input.
      if (BASE_CODES.includes(error?.code)) recheck(session);
    }
    function schedule(session) {
      clearTimeout(session.timer); session.timer = null;
      if (!scope(session) || session.discarded || session.composing.size || session.error?.code === 'stage_conflict') return;
      session.timer = global.setTimeout(() => { session.timer = null; if (scope(session)) flushSession(session).catch(() => {}); }, 400);
    }
    async function flushSession(session, { force = false } = {}) {
      clearTimeout(session.timer); session.timer = null;
      if (!scope(session)) throw fault('source_edit_scope_changed');
      if (session.stage.state === 'applied' || session.discarded) return;
      if (session.invalidInput) throw session.invalidInput;
      if (session.composing.size) throw fault('source_edit_composing', '입력 중인 글자를 완료한 뒤 다시 시도해 주세요.');
      if (session.saving) { await session.saving; return flushSession(session, { force }); }
      // Saving the material needs the stage row once, even when nothing was typed (an explicit restore).
      if (!dirtySession(session) && !(force && session.stage.revision === 0)) return;
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
          // The first stored row is a new draft for the list of drafts.
          if (payload.revision === 0) Promise.resolve().then(onDraftsChanged).catch(() => {});
        } catch (error) { report(session, error); throw error; }
        finally { session.saving = null; update(session); }
      })();
      session.saving = task; update(session); await task;
      if (dirtySession(session) && !session.composing.size) return flushSession(session);
    }
    async function flush() {
      const session = current;
      if (!session || session.stage.state === 'applied' || session.discarded) return;
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
        await flushSession(session, { force: true });
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
          if (result.status === 'conflict' || BASE_CODES.includes(result.error?.code)) session.pendingCommit = null;
          throw Object.assign(new Error(result.error?.message || '자료를 저장하지 못했습니다. 입력은 유지했습니다.'), { code: result.error?.code || 'workspace_conflict' });
        }
        session.stage.state = 'applied'; session.stage.appliedResult = copy(session.pendingCommit.stageResult);
        session.stage.revision += 1; session.stored = session.edit; clearError(session);
        return copy(session.stage.appliedResult);
      })();
      session.recordSaving = task; update(session);
      let result;
      try { result = await task; } catch (error) { session.recordSaving = null; report(session, error); throw error; }
      finally { session.recordSaving = null; update(session); }
      if (showing(session, token)) {
        session.openingSaved = true; update(session);
        try { await onSaved(result); announce('자료를 저장했습니다.'); }
        catch (_) { report(session, fault('source_edit_open_failed', '저장한 자료를 열지 못했습니다. 다시 저장을 눌러 자료를 열어 주세요.')); }
        finally { session.openingSaved = false; update(session); }
      }
      return result;
    }
    // Remove a draft: its stage row (when one was ever stored) and the live session. The material is untouched.
    async function drop(session) {
      session.discarded = true; clearTimeout(session.timer); session.timer = null;
      if (session.saving) await session.saving.catch(() => {});
      if (session.stage.state === 'draft' && session.stage.revision > 0) { await storage.deleteStage(session.stage.stageId); Promise.resolve().then(onDraftsChanged).catch(() => {}); }
      const key = keyFor(session.workspaceId, session.account);
      if (sessions.get(key) === session) sessions.delete(key);
      if (current === session) current = null;
    }
    async function discardSession(session, base = null) {
      if (!scope(session)) throw fault('source_edit_scope_changed');
      if (session.recordSaving) await session.recordSaving.catch(() => {});
      if (session.stage.state === 'applied') return;
      const target = { sourceId: session.stage.baseSourceId, sourceVersionId: base?.head?.id || session.stage.baseSourceVersionId, missing: base?.status === 'missing' };
      await drop(session);
      if (!alive()) return;
      await onDiscarded(target); announce('수정 초안을 버렸습니다. 보관한 자료는 그대로입니다.');
    }
    // Discard from a list of drafts (no editor open): the stage row and any live session for it.
    async function discard(stageId) {
      for (const session of [...sessions.values()]) if (session.stage.stageId === stageId) {
        if (session.recordSaving) await session.recordSaving.catch(() => {});
        if (session.stage.state === 'applied') return;
        await drop(session);
      }
      await storage.deleteStage(stageId);
    }
    async function recheck(session) {
      if (session.rechecking) return session.rechecking;
      const token = generation;
      session.rechecking = (async () => {
        try {
          const bundle = await storage.read(session.workspaceId);
          if (!showing(session, token) || session.stage.state !== 'draft' || session.discarded) return;
          const base = model.baseState(bundle, session.stage);
          if (base.status !== 'current') { remember(session); renderBase(session, base); }
        } catch (_) { /* The plain error with 입력 파일 받기 stays. */ }
        finally { session.rechecking = null; }
      })();
      return session.rechecking;
    }
    // The draft no longer matches the material: say what happened and offer every way out. Nothing here
    // changes the input until the person picks one.
    function renderBase(session, base) {
      session.panel = true;
      status = form = previewHost = titleInput = bodyInput = formatInput = saveButton = previewButton = discardButton = null;
      const token = generation, input = session.rawInput || session.stage.input, restoring = session.stage.restoreVersionId !== null;
      const target = { sourceId: session.stage.baseSourceId, sourceVersionId: base.head?.id || session.stage.baseSourceVersionId };
      const choice = (label, id, task, primary = false) => {
        const value = node('button', label, 'life-button' + (primary ? ' life-primary' : '')); value.type = 'button'; value.id = id;
        value.addEventListener('click', async () => {
          if (!showing(session, token) || !session.panel || value.disabled) return;
          const buttons = [...surface.querySelectorAll('button')]; for (const item of buttons) item.disabled = true;
          try { await task(); } catch (error) { if (showing(session, token) && session.panel) report(session, error); }
          finally { if (showing(session, token) && session.panel) for (const item of buttons) item.disabled = false; }
        });
        return value;
      };
      const bar = node('div', null, 'life-source-edit-actions');
      const back = choice(null, 'lifeSourceEditClose', async () => { await flush(); if (showing(session, token)) await onClose(base.status === 'missing' ? {} : target); });
      back.className = 'life-button life-icon-button'; back.setAttribute('aria-label', '자료로 돌아가기'); back.append(life.Icons.create('back'));
      const tip = node('span', '자료로 돌아가기', 'life-tooltip'); tip.setAttribute('aria-hidden', 'true'); back.append(tip);
      const barStatus = node('p', '수정 초안 확인 필요', 'life-meta'); barStatus.id = 'lifeSourceEditStatus'; barStatus.setAttribute('role', 'status'); barStatus.dataset.state = 'error';
      bar.append(back, barStatus);
      const panel = node('section', null, 'life-source-edit-base'); panel.id = 'lifeSourceEditBase'; panel.dataset.state = base.status;
      const heading = node('h2', base.status === 'moved' ? '이 자료에 새 판이 생겼습니다' : base.status === 'trashed' ? '휴지통에 있는 자료의 수정 초안입니다' : '수정하던 자료를 찾을 수 없습니다', 'life-heading');
      heading.id = 'lifeSourceEditBaseTitle'; heading.tabIndex = -1; panel.setAttribute('aria-labelledby', heading.id);
      panel.append(heading, node('p', base.status === 'moved' ? '이 초안은 이전 판에서 시작했습니다. 입력은 그대로 있습니다. 이어서 할 일을 골라 주세요.'
        : base.status === 'trashed' ? '자료를 복원한 뒤 다시 수정할 수 있습니다. 입력은 그대로 있습니다.' : '입력은 그대로 있습니다. 파일로 받아 둘 수 있습니다.', 'life-help'));
      const mine = node('details', null, 'life-details life-source-edit-mine'); mine.id = 'lifeSourceEditMine';
      const body = node('div', input.text, 'life-source-edit-mine-text'); body.tabIndex = 0; body.setAttribute('role', 'group'); body.setAttribute('aria-label', '내 입력 본문');
      mine.append(node('summary', '내 입력 보기'), node('p', input.title || '제목 없는 자료', 'life-meta'), body);
      const choices = node('div', null, 'life-actions life-source-edit-choices');
      if (base.status === 'moved') {
        choices.append(choice(restoring ? '이 버전 복원을 다시 시작' : '최신 판에서 다시 시작', 'lifeSourceEditRestart', async () => {
          if (!confirm('입력한 초안을 지우고 다시 시작할까요? 먼저 입력 파일 받기로 보관할 수 있습니다.')) return;
          const options = restoring ? { sourceId: session.stage.baseSourceId, versionId: session.stage.restoreVersionId, restore: true } : { sourceId: session.stage.baseSourceId };
          await drop(session); if (!alive() || token !== generation) return;
          await open(options);
        }), choice('내 입력을 최신 판 위에 새 판으로 저장', 'lifeSourceEditRebase', async () => {
          await flushSession(session);
          const bundle = await storage.read(session.workspaceId);
          if (!showing(session, token)) return;
          session.stage = model.rebase(bundle, session.stage); session.edit++; session.pendingCommit = null; session.error = null;
          try { await save(session); }
          catch (error) {
            // The base is current now; anything else (an empty body, storage) is fixed in the editor.
            if (!showing(session, token)) return;
            const fresh = model.baseState(await storage.read(session.workspaceId), session.stage);
            if (!showing(session, token)) return;
            if (fresh.status === 'current') render(session); else throw error;
          }
        }, true));
      }
      choices.append(choice('입력 파일 받기', 'lifeSourceEditDownload', () => download(session)),
        choice('초안 버리기', 'lifeSourceEditDiscard', async () => { if (confirm(DISCARD_QUESTION)) await discardSession(session, base); }));
      errorBox = node('div', null, 'life-source-edit-error'); errorBox.id = 'lifeSourceEditError'; errorBox.setAttribute('role', 'alert'); errorBox.hidden = true;
      panel.append(mine, choices, errorBox);
      surface.replaceChildren(bar, panel); surface.setAttribute('aria-busy', 'false');
      heading.focus({ preventScroll: true });
    }
    function render(session) {
      session.panel = false; session.preview = false; session.rawInput ||= copy(session.stage.input);
      surface.replaceChildren();
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
      previewButton.setAttribute('aria-pressed', 'false');
      // Only a draft that exists can be discarded; the material and its versions are never touched here.
      discardButton = action('초안 버리기', 'lifeSourceEditDiscard', async () => { if (confirm(DISCARD_QUESTION)) await discardSession(session); });
      controls.append(formatLabel, discardButton, previewButton); surface.append(controls);
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
        // A composition that ended without changing the text (cancelled, or only focused) is not an edit.
        input.addEventListener('compositionend', () => { session.composing.delete(input); if (input.value !== session.rawInput[field]) changed(field); else { update(session); schedule(session); } });
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
      status = errorBox = form = previewHost = titleInput = bodyInput = formatInput = saveButton = previewButton = discardButton = null;
      const currentScope = () => alive() && token === generation && getBundle()?.workspaceId === workspaceId && getAccountKey() === account;
      let dropped = false;
      try {
        let session = sessions.get(key), target = { sourceId: options.sourceId, versionId: options.versionId, restore: !!options.restore };
        if (session && (session.discarded || (options.stageId ? session.stage.stageId !== options.stageId || session.stage.state === 'applied'
          : session.stage.state === 'applied' || session.stage.baseSourceId !== options.sourceId ||
            (options.restore ? session.stage.restoreVersionId !== options.versionId : !!session.stage.restoreVersionId)))) session = null;
        if (!session) {
          let stage = null;
          if (options.stageId) {
            stage = await storage.getStage(options.stageId);
            if (!currentScope()) return;
            if (!stage) throw fault('source_edit_missing', '수정 초안을 찾을 수 없습니다. 자료에서 다시 수정을 시작해 주세요.');
            model.validate(stage); if (stage.workspaceId !== workspaceId) throw fault('source_edit_scope_changed');
          } else {
            const rows = await storage.listStages(workspaceId);
            if (!currentScope()) return;
            stage = rows.find(row => row.kind === 'source-edit' && row.state === 'draft' && row.baseSourceId === options.sourceId &&
              (options.restore ? row.restoreVersionId === options.versionId : !row.restoreVersionId)) || null;
            if (stage) model.validate(stage);
          }
          if (stage) session = newSession(stage, workspaceId, account);
        }
        // The material may have moved since this draft began (another tab or device, a new version).
        // Check the draft against what is stored now before showing an editor that could not save.
        const fresh = await storage.read(workspaceId);
        if (!currentScope()) return;
        if (session && session.stage.state === 'draft') {
          const base = model.baseState(fresh, session.stage);
          if (base.untouched) {
            // Holds nothing the person typed: remove it quietly and start from the material as it is.
            target = { sourceId: session.stage.baseSourceId, versionId: session.stage.restoreVersionId, restore: session.stage.restoreVersionId !== null };
            await drop(session); session = null; dropped = true;
            if (!currentScope()) return;
          } else if (base.status !== 'current') {
            current = session; sessions.set(key, session); renderBase(session, base); return;
          }
        }
        if (!session) {
          if (!target.sourceId) throw fault('source_edit_missing', '수정할 자료를 찾을 수 없습니다.');
          session = newSession(model.begin(fresh, target.sourceId, target.restore ? { versionId: target.versionId, restore: true } : {}), workspaceId, account);
        }
        current = session; sessions.set(key, session); surface.setAttribute('aria-busy', 'false'); render(session);
      } catch (error) {
        if (!currentScope()) return;
        const text = dropped && error?.code === 'source_trashed' ? '휴지통의 자료는 복원한 뒤 수정해 주세요.' : message(error);
        surface.setAttribute('aria-busy', 'false'); surface.replaceChildren(node('p', text, 'life-error'));
        const back = node('button', '자료로 돌아가기', 'life-button'); back.type = 'button'; back.id = 'lifeSourceEditClose'; back.addEventListener('click', () => { if (currentScope()) onClose(); }); surface.append(back);
      }
    }
    function close() {
      remember(); visible = false; generation++; surface = status = errorBox = form = previewHost = titleInput = bodyInput = formatInput = saveButton = previewButton = discardButton = null;
    }
    function dispose() {
      close(); disposed = true; global.removeEventListener('resize', fitInputs);
      for (const session of sessions.values()) clearTimeout(session.timer);
      sessions.clear(); current = null;
      for (const url of urls) URL.revokeObjectURL(url); urls.clear();
    }
    const isDirty = () => !!current && (dirtySession(current) || !!current.saving || !!current.recordSaving || !!current.composing.size);
    // From the commit until the saved version is open: the workspace change in between is this editor's own.
    const isSaving = () => !!current && (!!current.recordSaving || !!current.openingSaved);
    return Object.freeze({ open, flush, isDirty, isSaving, discard, close, dispose });
  }
  life.SourceEditUI = Object.freeze({ create });
})(globalThis);

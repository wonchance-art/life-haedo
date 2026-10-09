/* Account-scoped writing drafts. Only an explicit save creates a source version. */
(function (global) {
  'use strict';
  const life = global.HaedoLife = global.HaedoLife || {};
  const copy = value => JSON.parse(JSON.stringify(value));
  const fault = (code, message) => Object.assign(new Error(message), { code });
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function create({ host, storage, core, writingSync, getBundle, parentNavigation = false, isDisposed = () => false, announce = () => {}, onSaved = () => {}, onClose = () => {} }) {
    const model = life.Writing;
    const workspaces = new Map(), urls = new Set();
    let disposed = false, visible = false, generation = 0, current = null;
    let surface = null, status = null, errorBox = null, saveButton = null, titleInput = null, bodyInput = null;
    let syncPanel = null, incomingBox = null, titleResize = null;
    const subscriptions = new Map();
    const alive = () => !disposed && !isDisposed();
    const inWorkspace = session => alive() && getBundle()?.workspaceId === session.workspaceId;
    const showing = (session, token = generation) => visible && token === generation && current === session && inWorkspace(session);
    const hasText = session => !!(session.stage.title || session.stage.text);
    const edited = session => session.stage.state === 'draft' && session.edit !== session.stored;
    function rememberEditor(session = current) {
      if (!session || current !== session || !titleInput || !bodyInput) return;
      const position = control => ({ start: control.selectionStart, end: control.selectionEnd,
        direction: control.selectionDirection, top: control.scrollTop, left: control.scrollLeft });
      session.editorPosition = { stageId: session.stage.stageId, title: position(titleInput), body: position(bodyInput) };
    }
    function restoreEditor(session) {
      const position = session.editorPosition;
      if (!position || position.stageId !== session.stage.stageId) return;
      for (const [control, value] of [[titleInput, position.title], [bodyInput, position.body]]) {
        control.setSelectionRange(value.start, value.end, value.direction);
        control.scrollTop = value.top; control.scrollLeft = value.left;
      }
    }
    function fitTitle() {
      if (!titleInput?.isConnected) return;
      const control = titleInput, style = global.getComputedStyle(control);
      control.style.height = 'auto';
      const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      control.style.height = Math.ceil(control.scrollHeight + borders) + 'px';
    }
    function errorMessage(error) {
      if (error?.code === 'stage_conflict') return '다른 탭에서 이 초안이 바뀌었습니다. 입력을 유지했습니다. 새 초안 사본으로 보관해 주세요.';
      if (error?.code === 'writing_conflict') return '보관한 글의 최신 버전이 바뀌었습니다. 입력은 초안에 남아 있습니다. 새 글로 따로 저장할 수 있습니다.';
      if (error?.code === 'workspace_conflict') return '보관한 기록이 바뀌었습니다. 입력을 유지했습니다. 다시 저장하면 최신 작업공간에서 확인합니다.';
      if (error?.code === 'storage_quota') return '저장 공간이 부족합니다. 입력을 유지했습니다. TXT를 받아 보관한 뒤 다시 시도해 주세요.';
      if (['storage_scope_closed', 'workspace_access_denied', 'writing_scope_changed'].includes(error?.code)) return '계정 또는 작업공간이 바뀌어 저장을 멈췄습니다. 원래 공간에서 입력을 확인해 주세요.';
      return error?.message || '저장하지 못했습니다. 입력을 유지했습니다. 다시 시도하거나 TXT로 보관해 주세요.';
    }
    function action(label, task, { id, glyph, primary = false } = {}) {
      const button = el('button', glyph ? null : label, 'life-button' + (glyph ? ' life-icon-button' : '') + (primary ? ' life-primary' : ''));
      button.type = 'button'; if (id) button.id = id;
      if (glyph) {
        button.setAttribute('aria-label', label); button.append(life.Icons.create(glyph));
        const tooltip = el('span', label, 'life-tooltip'); tooltip.setAttribute('aria-hidden', 'true'); button.append(tooltip);
        button.addEventListener('keydown', event => { if (event.key === 'Escape') button.dataset.tooltipDismissed = 'true'; });
        const reset = () => { delete button.dataset.tooltipDismissed; };
        button.addEventListener('blur', reset); button.addEventListener('pointerleave', reset);
      }
      const token = generation, session = current;
      button.addEventListener('click', async () => {
        if (!alive() || token !== generation || !button.isConnected || session && !showing(session, token)) return;
        button.disabled = true;
        try { await task(); }
        catch (error) { if (session && showing(session, token)) report(session, error); }
        finally { if (button.isConnected) { button.disabled = false; updateStatus(session); } }
      });
      return button;
    }
    function updateStatus(session) {
      if (!session || !showing(session) || !status) return;
      const key = session.stage.state === 'applied' ? 'stored' : session.error ? 'error' : session.recordSaving || session.saving ? 'saving' :
        edited(session) ? 'dirty' : session.stage.revision ? 'draft' : 'empty';
      const labels = { stored: '기록으로 저장됨', error: '저장하지 못함 · 입력 유지', saving: session.recordSaving ? '기록으로 저장 중…' : '초안 보관 중…',
        dirty: session.composing.size ? '작성 중' : '초안 보관 대기', draft: '이 브라우저에 초안 보관됨', empty: '새 글' };
      status.dataset.state = key; status.textContent = labels[key];
      if (saveButton) saveButton.disabled = session.stage.state === 'applied' || !!session.recordSaving || !!session.composing.size || !session.stage.text.trim();
      for (const input of [titleInput, bodyInput]) if (input) input.disabled = !!session.recordSaving || session.stage.state === 'applied';
      surface.querySelectorAll('#lifeWritingNew,.life-writing-draft,#lifeWritingRescue,#lifeWritingSaveCopy').forEach(control => {
        control.disabled = !!session.recordSaving || !!session.openingSaved;
      });
    }
    function report(session, error, phase = session.errorPhase || 'draft') {
      session.error = error; session.errorPhase = phase;
      if (!showing(session) || !errorBox) return;
      errorBox.hidden = false; errorBox.replaceChildren(el('p', errorMessage(error)));
      const actions = el('div', null, 'life-actions');
      if (session.stage.state === 'applied') actions.append(action('저장한 글 열기', () => onSaved(session.stage.appliedResult)));
      else if (error?.code === 'stage_conflict') actions.append(action('새 초안 사본으로 보관', () => rescue(session), { id: 'lifeWritingRescue' }));
      else if (error?.code === 'writing_conflict') actions.append(action('새 글로 따로 저장', () => rescue(session, true), { id: 'lifeWritingSaveCopy' }));
      else actions.append(action('다시 저장', () => phase === 'record' ? saveRecord(session) : flushSession(session), { id: 'lifeWritingRetry' }));
      actions.append(action('TXT 받기', () => download(session)));
      errorBox.append(actions); updateStatus(session);
    }
    function clearError(session) {
      session.error = null; session.errorPhase = null;
      if (showing(session) && errorBox) { errorBox.hidden = true; errorBox.replaceChildren(); }
    }
    function schedule(session) {
      clearTimeout(session.timer); session.timer = null;
      if (!inWorkspace(session) || session.composing.size || !edited(session) || session.error?.code === 'stage_conflict') return;
      session.timer = global.setTimeout(() => {
        session.timer = null;
        if (inWorkspace(session)) flushSession(session).catch(() => {});
      }, 400);
    }
    function changed(session) {
      session.edit += 1; session.pendingCommit = null;
      if (!['stage_conflict', 'writing_conflict'].includes(session.error?.code)) clearError(session);
      updateStatus(session); schedule(session);
    }
    function renderIncoming(session) {
      if (!showing(session) || !incomingBox) return;
      incomingBox.replaceChildren();
      const applied = session.stage.state === 'applied', other = session.externalStage;
      incomingBox.hidden = !applied && !other;
      if (applied) {
        incomingBox.append(el('p', '이 초안은 기록으로 저장됐습니다. 원문과 초안의 서버 연결 상태는 별도로 확인합니다.', 'life-help'),
          action('저장한 글 열기', () => onSaved(session.stage.appliedResult), { id: 'lifeWritingSavedOpen' }));
      } else if (other) {
        incomingBox.append(el('p', other.state === 'applied' ? '다른 기기에서 기록으로 저장했습니다. 현재 입력은 그대로 남겨 두었습니다.' : '새로 받은 초안이 있습니다. 현재 입력은 그대로 남겨 두었습니다.', 'life-help'));
        const actions = el('div', null, 'life-actions');
        actions.append(action('새로 받은 내용 열기', () => open({ stageId: session.stage.stageId, syncOpen: true }), { id: 'lifeWritingIncomingOpen' }),
          action('현재 입력을 새 초안으로 보관', () => rescue(session, other.state === 'applied', false), { id: 'lifeWritingIncomingCopy' }));
        incomingBox.append(actions);
      }
    }
    async function checkIncoming(session) {
      const token = generation, stageId = session.stage.stageId, request = (session.incomingRequest || 0) + 1;
      session.incomingRequest = request;
      try {
        const [stage, rows] = await Promise.all([storage.getStage(stageId), storage.listStages(session.workspaceId)]);
        if (!showing(session, token) || session.stage.stageId !== stageId || session.incomingRequest !== request || session.saving || session.recordSaving) return;
        session.rows = rows.filter(model.isDraft); fillDrafts(session, surface.querySelector('#lifeWritingDrafts'));
        if (stage && stage.revision > session.stage.revision) { session.externalStage = stage; renderIncoming(session); }
      } catch (_) { /* Input and the existing recovery actions remain available. */ }
    }
    function watch(workspaceId) {
      if (subscriptions.has(workspaceId)) return;
      subscriptions.set(workspaceId, storage.subscribe(workspaceId, event => {
        if (event.type === 'writing_draft_changed' && current && showing(current)) checkIncoming(current);
      }));
    }
    async function flushSession(session) {
      clearTimeout(session.timer); session.timer = null;
      if (!inWorkspace(session)) throw fault('writing_scope_changed');
      if (session.stage.state === 'applied') return;
      if (session.composing.size) throw fault('writing_composing', '입력 중인 글자를 완료한 뒤 다시 시도해 주세요. 입력은 유지됩니다.');
      if (session.saving) { await session.saving; return flushSession(session); }
      if (!edited(session)) return;
      if (session.error?.code === 'stage_conflict') throw session.error;
      if (!session.stage.revision && !hasText(session)) { session.stored = session.edit; updateStatus(session); return; }
      const tick = session.edit, payload = copy(session.stage);
      try { model.validateDraft(payload); } catch (error) { report(session, error, 'draft'); throw error; }
      const task = (async () => {
        try {
          const saved = await storage.saveStage(payload);
          if (!inWorkspace(session)) throw fault('writing_scope_changed');
          // Preserve text typed while IndexedDB was committing this older snapshot.
          session.stage.revision = saved.revision; session.stage.createdAt = saved.createdAt; session.stage.updatedAt = saved.updatedAt;
          const index = session.rows.findIndex(stage => stage.stageId === saved.stageId);
          if (index < 0) session.rows.unshift(copy(saved)); else session.rows[index] = copy(saved);
          session.stored = tick; clearError(session);
          if (showing(session)) fillDrafts(session, surface.querySelector('#lifeWritingDrafts'));
        } catch (error) { report(session, error, 'draft'); throw error; }
        finally { session.saving = null; updateStatus(session); }
      })();
      session.saving = task; updateStatus(session); await task;
      if (edited(session) && !session.composing.size) return flushSession(session);
    }
    async function flush() {
      const session = current;
      if (!session) return;
      if (!inWorkspace(session)) {
        if (!edited(session) && !session.saving && !session.recordSaving && !session.composing.size) return;
        throw fault('writing_scope_changed');
      }
      if (session.recordSaving) await session.recordSaving;
      await flushSession(session);
    }
    function isDirty() { return !!current && (edited(current) || !!current.saving || !!current.recordSaving); }
    async function saveRecord(session) {
      if (!inWorkspace(session) || session.stage.state === 'applied') return;
      if (session.recordSaving) return session.recordSaving;
      if (session.composing.size) throw fault('writing_composing', '입력 중인 글자를 완료한 뒤 저장해 주세요.');
      const token = generation;
      const task = (async () => {
        await flushSession(session);
        const bundle = await storage.read(session.workspaceId);
        if (!inWorkspace(session)) throw fault('writing_scope_changed');
        if (!session.pendingCommit) {
          const prepared = await model.prepareSave(bundle, copy(session.stage));
          if (!inWorkspace(session)) throw fault('writing_scope_changed');
          session.pendingCommit = { workspaceId: session.workspaceId, baseRevision: bundle.revision, operationId: core.id(),
            stageId: session.stage.stageId, stageRevision: session.stage.revision, changes: prepared.changes, stageResult: prepared.stageResult };
        }
        const result = await storage.commitLocal(session.pendingCommit);
        if (!inWorkspace(session)) throw fault('writing_scope_changed');
        if (result.status !== 'stored') {
          if (result.status === 'conflict') {
            const error = result.error?.code === 'stage_conflict' ? fault('stage_conflict') : fault('workspace_conflict');
            session.pendingCommit = null; throw error;
          }
          throw Object.assign(new Error(result.error?.message || '글을 저장하지 못했습니다.'), { code: result.error?.code || 'writing_save_failed' });
        }
        session.stage.state = 'applied'; session.stage.appliedResult = copy(session.pendingCommit.stageResult);
        session.rows = session.rows.filter(stage => stage.stageId !== session.stage.stageId);
        session.stage.revision += 1; session.stored = session.edit; clearError(session);
        if (showing(session)) fillDrafts(session, surface.querySelector('#lifeWritingDrafts'));
        return copy(session.stage.appliedResult);
      })();
      session.recordSaving = task; updateStatus(session);
      let saved;
      try { saved = await task; }
      catch (error) { report(session, error, 'record'); throw error; }
      finally { session.recordSaving = null; updateStatus(session); }
      // The receipt is settled before onSaved navigates and calls flush again.
      if (!showing(session, token)) return saved;
      announce('글을 이 브라우저의 기록으로 저장했습니다.');
      session.openingSaved = true; updateStatus(session);
      try { await onSaved(saved); }
      catch (_) { report(session, fault('writing_open_failed', '글은 저장됐지만 화면을 열지 못했습니다. 저장한 글을 다시 열어 주세요.'), 'record'); }
      finally { session.openingSaved = false; updateStatus(session); }
      return saved;
    }
    async function rescue(session, asNew = false, saveAsRecord = asNew) {
      if (!inWorkspace(session) || session.recordSaving || session.saving) return;
      if (session.composing.size) throw fault('writing_composing', '입력 중인 글자를 완료한 뒤 다시 시도해 주세요.');
      session.stage = model.recoverDraft(copy(session.stage), asNew ? { asNew: true } : {});
      session.editorPosition = null;
      session.externalStage = null;
      session.edit += 1; session.stored = 0; session.pendingCommit = null; clearError(session);
      renderEditor(session); await flushSession(session);
      if (saveAsRecord) await saveRecord(session);
      else if (showing(session)) { announce('입력을 새 초안 사본으로 보관했습니다.'); titleInput?.focus({ preventScroll: true }); }
    }
    function download(session) {
      if (!inWorkspace(session)) return;
      const url = URL.createObjectURL(new Blob([model.toText(session.stage)], { type: 'text/plain;charset=utf-8' })); urls.add(url);
      const link = el('a'); link.href = url; link.download = 'haedo-writing-draft.txt'; link.hidden = true; document.body.append(link); link.click(); link.remove();
      global.setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 30000);
      announce('TXT 다운로드를 요청했습니다. 파일 보관을 확인해 주세요.');
    }
    function sessionFor(stage, rows) {
      return { workspaceId: stage.workspaceId, stage: copy(stage), rows, edit: stage.revision === 0 && (stage.title || stage.text) ? 1 : 0, stored: 0, timer: null, saving: null,
        recordSaving: null, composing: new Set(), error: null, errorPhase: null, pendingCommit: null };
    }
    function fillDrafts(session, drafts) {
      if (!drafts) return;
      const active = drafts.contains(document.activeElement) ? document.activeElement : null;
      const focusStage = active?.dataset.stageId, focusSummary = active?.tagName === 'SUMMARY';
      const rows = session.rows.filter(stage => stage.state === 'draft'); drafts.replaceChildren(el('summary', '초안 ' + rows.length + '개'));
      rows.forEach(stage => {
        const item = action(stage.title || Array.from(stage.text.split(/\r?\n/, 1)[0]).slice(0, 80).join('') || '제목 없는 초안', () => open({ stageId: stage.stageId }));
        item.classList.add('life-writing-draft'); item.dataset.stageId = stage.stageId;
        if (stage.stageId === session.stage.stageId) item.setAttribute('aria-current', 'true'); drafts.append(item);
      });
      if (focusSummary) drafts.querySelector('summary')?.focus({ preventScroll: true });
      else if (focusStage) ([...drafts.querySelectorAll('[data-stage-id]')].find(item => item.dataset.stageId === focusStage) || drafts.querySelector('summary'))?.focus({ preventScroll: true });
    }
    function renderEditor(session) {
      if (!showing(session)) return;
      syncPanel?.dispose(); syncPanel = null;
      titleResize?.disconnect(); titleResize = null;
      surface.setAttribute('aria-busy', 'false'); surface.replaceChildren();
      const actions = el('div', null, 'life-writing-actions');
      if (!parentNavigation) actions.append(action('기록으로 돌아가기', async () => { await flush(); if (showing(session)) await onClose(); }, { id: 'lifeWritingClose', glyph: 'back' }));
      status = el('p', '', 'life-meta life-writing-status'); status.id = 'lifeWritingStatus'; status.setAttribute('role', 'status'); actions.append(status);
      saveButton = action('기록에 저장', () => saveRecord(session), { id: 'lifeWritingSave', primary: true }); actions.append(saveButton); surface.append(actions);
      incomingBox = el('div', null, 'life-writing-incoming'); incomingBox.id = 'lifeWritingIncoming'; incomingBox.setAttribute('role', 'status'); incomingBox.hidden = true; surface.append(incomingBox);
      errorBox = el('div', null, 'life-writing-error'); errorBox.id = 'lifeWritingError'; errorBox.setAttribute('role', 'alert'); errorBox.hidden = true; surface.append(errorBox);
      const form = el('form'); form.addEventListener('submit', event => event.preventDefault());
      function input(label, field, multiline) {
        const wrapper = el('label', null, 'life-writing-field'); wrapper.append(el('span', label, 'life-sr-only'));
        const control = el('textarea', null, 'life-writing-' + (multiline ? 'body' : 'title'));
        control.rows = multiline ? 14 : 1;
        control.id = multiline ? 'lifeWritingBody' : 'lifeWritingTitle'; control.value = session.stage[field]; control.placeholder = label;
        if (!multiline) control.maxLength = 500;
        const token = generation;
        // Wrap a long title visually, while retaining the former text input's
        // single-line value. Only an inserted line break requires value repair.
        const normalizeTitle = () => {
          if (multiline || session.composing.has(control) || !/[\r\n]/.test(control.value)) return;
          const { selectionStart: start, selectionEnd: end, selectionDirection: direction } = control;
          const clean = value => value.replace(/[\r\n]/g, '');
          const nextStart = clean(control.value.slice(0, start)).length, nextEnd = clean(control.value.slice(0, end)).length;
          control.value = clean(control.value); control.setSelectionRange(nextStart, nextEnd, direction);
        };
        if (!multiline) {
          control.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229 && !session.composing.has(control)) event.preventDefault();
          });
          control.addEventListener('beforeinput', event => {
            if (['insertLineBreak', 'insertParagraph'].includes(event.inputType) && !event.isComposing && !session.composing.has(control)) event.preventDefault();
          });
        }
        control.addEventListener('compositionstart', () => { if (!showing(session, token)) return; session.composing.add(control); clearTimeout(session.timer); updateStatus(session); });
        control.addEventListener('input', () => {
          if (!showing(session, token) || session.recordSaving || session.stage.state !== 'draft') return;
          normalizeTitle(); session.stage[field] = control.value; if (!multiline) fitTitle(); changed(session);
        });
        const finish = () => {
          if (!showing(session, token) || !session.composing.has(control)) return;
          session.composing.delete(control);
          normalizeTitle(); if (!multiline) fitTitle();
          if (session.stage[field] !== control.value) { session.stage[field] = control.value; changed(session); }
          else { updateStatus(session); schedule(session); }
        };
        control.addEventListener('compositionend', finish); control.addEventListener('blur', finish);
        wrapper.append(control); return { wrapper, control };
      }
      const title = input('제목', 'title', false), body = input('본문', 'text', true); titleInput = title.control; bodyInput = body.control;
      form.append(title.wrapper, body.wrapper);
      form.addEventListener('keydown', event => {
        if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
        event.preventDefault(); if (!event.isComposing && !session.composing.size && !saveButton.disabled) saveButton.click();
      });
      surface.append(form);
      fitTitle();
      if (global.ResizeObserver) {
        let width = titleInput.getBoundingClientRect().width;
        titleResize = new global.ResizeObserver(entries => {
          const nextWidth = entries[0].contentRect.width;
          if (nextWidth !== width) { width = nextWidth; fitTitle(); }
        });
        titleResize.observe(titleInput);
      }
      const drafts = el('details', null, 'life-writing-drafts'); drafts.id = 'lifeWritingDrafts';
      fillDrafts(session, drafts);
      const footer = el('div', null, 'life-writing-actions');
      footer.append(action('새 글', () => open({ newDraft: true }), { id: 'lifeWritingNew', glyph: 'plus' }),
        action('TXT 받기', () => download(session), { id: 'lifeWritingDownload', glyph: 'download' }), drafts);
      surface.append(footer);
      if (writingSync && life.WritingSyncUI) {
        const syncHost = el('details'); syncHost.open = !!session.syncOpen; surface.append(syncHost);
        const stageId = session.stage.stageId;
        syncPanel = life.WritingSyncUI.create({ host: syncHost, manager: writingSync, storage,
          workspaceId: session.workspaceId, draftId: stageId, beforeAction: () => flushSession(session),
          isCurrent: () => showing(session) && session.stage.stageId === stageId,
          onOpen: id => open({ stageId: id, syncOpen: true }) });
      }
      const scope = el('details', null, 'life-writing-scope'); scope.append(el('summary', '초안 보관'),
        el('p', '초안은 먼저 이 브라우저에 보관합니다. 초안 이어쓰기에서 고른 글만 별도로 연결할 수 있고 기록 백업에는 포함되지 않습니다. TXT로 따로 받을 수 있습니다. 저장한 글은 기록 백업과 기존 원문 동기화 설정을 따르며 공개 게시와는 별개입니다.', 'life-meta'));
      surface.append(scope); updateStatus(session); renderIncoming(session); if (session.error) report(session, session.error, session.errorPhase);
      restoreEditor(session);
    }
    async function open(options = {}) {
      if (!alive()) return;
      if (current && (isDirty() || current.composing.size)) await flush();
      rememberEditor();
      const bundle = getBundle(); if (!bundle) return;
      const token = ++generation, workspaceId = bundle.workspaceId;
      visible = true; current = workspaces.get(workspaceId) || null;
      surface = el('section', null, 'life-writing'); surface.dataset.workspaceId = workspaceId; surface.setAttribute('aria-busy', 'true');
      surface.append(el('p', '초안을 불러오는 중…', 'life-meta')); host.replaceChildren(surface);
      const active = () => alive() && visible && token === generation && getBundle()?.workspaceId === workspaceId;
      try {
        if (!model) throw fault('writing_unavailable', '글쓰기 기능을 불러오지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.');
        const rows = (await storage.listStages(workspaceId)).filter(stage => model.isDraft(stage) && stage.state === 'draft')
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        if (!active()) return;
        watch(workspaceId);
        let stage = null;
        if (options.stageId) {
          stage = await storage.getStage(options.stageId); if (!active()) return;
          if (!stage || stage.kind !== 'writing' || stage.workspaceId !== workspaceId) throw fault('writing_draft_missing', '이 글쓰기 초안을 찾지 못했습니다. 다른 초안을 선택해 주세요.');
          model.validateDraft(stage);
        } else if (options.sourceId) {
          if (options.sourceVersionId && model.latestVersion(bundle, options.sourceId)?.id !== options.sourceVersionId)
            throw fault('writing_old_version', '이전 버전을 최신 글로 대신 열지 않았습니다. 최신 버전에서 수정해 주세요.');
          stage = rows.find(item => item.sourceId === options.sourceId) || model.createDraft(bundle, { sourceId: options.sourceId });
        } else if (!options.newDraft && current?.stage.state === 'draft') {
          current.rows = rows; renderEditor(current); checkIncoming(current); if (edited(current)) schedule(current); return;
        } else if (!options.newDraft) stage = rows[0] || null;
        stage ||= model.createDraft(bundle);
        model.validateDraft(stage); current = sessionFor(stage, rows); current.syncOpen = !!options.syncOpen; workspaces.set(workspaceId, current); renderEditor(current);
        if (edited(current)) schedule(current);
      } catch (error) {
        if (!active()) return;
        surface.setAttribute('aria-busy', 'false');
        if (!options.stageId && !options.sourceId && !options.newDraft && current && inWorkspace(current) && current.stage.state === 'draft') { renderEditor(current); report(current, error); }
        else {
          current = null; surface.replaceChildren(el('p', errorMessage(error), 'life-writing-error'));
          surface.append(action('다시 불러오기', () => open(options), { id: 'lifeWritingReload' }));
          if (!parentNavigation) surface.append(action('기록으로 돌아가기', onClose, { id: 'lifeWritingClose' }));
        }
      }
    }
    function close() {
      rememberEditor(); titleResize?.disconnect(); titleResize = null;
      syncPanel?.dispose(); syncPanel = null; incomingBox = null;
      visible = false; generation += 1;
      if (current) { clearTimeout(current.timer); current.timer = null; current.composing.clear(); }
      surface = status = errorBox = saveButton = titleInput = bodyInput = null;
    }
    function dispose() {
      disposed = true; close(); workspaces.forEach(session => clearTimeout(session.timer)); workspaces.clear();
      subscriptions.forEach(off => off()); subscriptions.clear();
      urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); current = null;
    }
    return Object.freeze({ open, flush, isDirty, dirty: isDirty, close, leave: close, dispose });
  }
  life.WritingUI = Object.freeze({ create });
})(globalThis);

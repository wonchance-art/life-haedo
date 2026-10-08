(function (global) {
  'use strict';

  const ORIGINS = [['apple_notes', 'Apple 메모'], ['obsidian', 'Obsidian'], ['naver_blog', '네이버 블로그'], ['instagram', 'Instagram'], ['other', '기타']];
  const COVERAGE = { full_text: '제공한 본문 전체', partial: '선택한 본문 일부', link_only: '본문 미확보 · 링크만', unknown: '본문 확보 범위 미확인' };
  const MAX_TEXT_BYTES = 1024 * 1024;
  const SEARCH_PAGE_SIZE = 40;

  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined && text !== null) el.textContent = String(text);
    if (className) el.className = className;
    return el;
  }

  function button(text, action, className) {
    const el = node('button', text, 'life-button' + (className ? ' ' + className : ''));
    el.type = 'button';
    el.addEventListener('click', action);
    return el;
  }

  function iconButton(label, name, action, className) {
    const el = button(null, action, 'life-icon-button' + (className ? ' ' + className : ''));
    el.setAttribute('aria-label', label);
    el.append(global.HaedoLife.Icons.create(name));
    const tooltip = node('span', label, 'life-tooltip');
    tooltip.setAttribute('aria-hidden', 'true');
    el.append(tooltip);
    el.addEventListener('keydown', event => {
      if (event.key === 'Escape') el.dataset.tooltipDismissed = 'true';
    });
    const resetTooltip = () => { delete el.dataset.tooltipDismissed; };
    el.addEventListener('blur', resetTooltip);
    el.addEventListener('pointerleave', resetTooltip);
    return el;
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch (_) { return null; }
  }

  // A host suggests a source label, never the existence or contents of a post.
  // Keep the user's URL untouched: it is also part of the source identity.
  function suggestedWebOrigin(value) {
    const text = String(value || '').trim();
    if (text.length > 8192 || !/^https?:\/\//i.test(text) || /[\s\u0000-\u001f\u007f\\]/.test(text)) return null;
    try {
      const url = new URL(text);
      if (url.username || url.password) return null;
      if (['blog.naver.com', 'm.blog.naver.com'].includes(url.hostname)) return 'naver_blog';
      if (['instagram.com', 'www.instagram.com'].includes(url.hostname)) return 'instagram';
    } catch (_) { /* Invalid URLs remain editable and are checked before review. */ }
    return null;
  }

  function isWebOrigin(origin) { return origin === 'naver_blog' || origin === 'instagram'; }

  function sourceLabel(source) {
    return source.title || source.url || '제목 없는 자료';
  }

  function dateLabel(value) {
    if (!value) return '미상';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('ko-KR');
  }

  // Textareas normalize CRLF (and lone CR) to LF; source locators use unchanged input.
  function displayToRaw(text, offset) {
    let raw = 0;
    let display = 0;
    while (raw < text.length && display < offset) {
      raw += text[raw] === '\r' && text[raw + 1] === '\n' ? 2 : 1;
      display += 1;
    }
    return raw;
  }

  function rawToDisplay(text, offset) {
    let raw = 0;
    let display = 0;
    while (raw < Math.min(text.length, offset)) {
      raw += text[raw] === '\r' && text[raw + 1] === '\n' ? 2 : 1;
      display += 1;
    }
    return display;
  }

  async function mount(container, { storage, core, legacy, sync, compositionSync, writingSync, auth, signal }) {
    if (signal?.aborted) throw new Error('화면 연결이 취소되었습니다.');
    let disposed = false;
    let unsubscribe = null;
    let unsubscribeSync = null;
    let syncRefreshSequence = 0;
    let stageTimer = null;
    let saveChain = Promise.resolve();
    let batchGeneration = 0;
    let workspaceGeneration = 0;
    let dataRefreshSequence = 0;
    let dataRefreshPromise = Promise.resolve(false);
    let readerCleanup = null;
    let readerWatch = null;
    let readingResumeCleanup = null;
    let readingResumePromise = Promise.resolve();
    let focusFrame = null;
    let unbindNavigation = null;
    let lastRecordMode = 'sources';
    let workbenchOpenOptions = null;
    let chapterImport = null;
    let writingOpenOptions = null;
    let navigationGeneration = 0;
    let homeRenderPromise = Promise.resolve();
    const selectedVersions = new Set();
    let selectionReturn = null;
    let relatedOrigin = null;
    let compositionPanel = null;
    const downloadUrls = new Set();
    const state = {
      bundle: null, workspaces: [], mode: 'sources', topic: '', topicsSearch: '', sourcesSearch: '', originFilter: '', returnContext: null, suppressReaderResume: false, sourceId: null,
      sourceVersionId: null, locator: null, stage: null, prepared: null, importMethod: 'text', topicUnassigned: false, topicFilterSearch: '',
      busy: false, editTick: 0, savedTick: 0, stageFailed: false, status: '', error: '',
      pendingOperation: null, stageSelection: null, sourceSelection: null, stages: [], allStages: [], batches: new Map(), batchId: null,
      remoteChanged: false, readerPositions: new Map(), sourceDrafts: new Map(),
      syncAccount: null, syncState: null, syncReadError: null, syncAccountKey: null,
      syncLoading: false, managementOpen: false, sourcesFiltersOpen: false, topicsFiltersOpen: false,
      selecting: false, readerArrangeOpen: false,
      sourcesLimit: SEARCH_PAGE_SIZE, sourcesWindowKey: '', sourcesRevealVersionId: null, ignoreKoreanSpacing: false,
      remoteRows: null, remoteRowsAccountKey: null, conflictView: null, conflictCopyId: null, restoreReturn: null, importResult: null
    };
    const readingPosition = global.HaedoLife.ReadingPosition?.create({ storage });
    const root = node('div', null, 'life-app');
    const status = node('p', '', 'life-status');
    status.id = 'lifeSaveStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const error = node('p', '', 'life-error');
    error.id = 'lifeError';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const header = node('div', null, 'life-header');
    const toolbar = node('div', null, 'life-toolbar');
    const recordSections = node('nav', null, 'life-record-actions');
    recordSections.setAttribute('aria-label', '기록 정리');
    const main = node('main', null, 'life-main');
    main.id = 'lifeMain';
    const skip = node('a', '본문으로 이동', 'life-skip');
    skip.href = '#lifeMain';
    root.append(skip, header, toolbar, recordSections, status, error, main);
    container.replaceChildren(root);
    const workbenchModes = ['activities', 'page', 'discover', 'related', 'reflection', 'books', 'workbench-backup', 'public-pages'];
    const workbench = global.HaedoLife.WorkbenchUI?.create({
      storage, core, host: main, getBundle: () => state.bundle,
      isDisposed: () => disposed, announce,
      onSelectionUsed: ({ workspaceId, versionIds }) => {
        if (disposed || state.bundle?.workspaceId !== workspaceId) return;
        const consumed = selectionReturn?.workspaceId === workspaceId ? selectionReturn.versionIds : versionIds;
        consumed.forEach(id => selectedVersions.delete(id));
        if (!selectedVersions.size) state.selecting = false;
        selectionReturn = null;
      },
      onSelectionCancel: returnFromArrange,
      onChapterImport: beginChapterImport,
      onWorkbenchNavigate: ({ workspaceId, mode, planOpen = false }) => {
        if (disposed || state.bundle?.workspaceId !== workspaceId || !['reflection', 'books'].includes(mode)) return;
        return navigate(mode, { planOpen });
      },
      onArrange: ({ workspaceId, versionIds, focusId }) => {
        if (disposed || state.bundle?.workspaceId !== workspaceId || !['discover', 'related', 'reflection'].includes(state.mode)) return;
        return arrangeRecords('activities', [...new Set(versionIds)], focusId);
      },
      openSource: (sourceId, versionId, options = {}) => navigate('source', {
        sourceId, sourceVersionId: versionId, locator: null,
        returnContext: { mode: state.mode, workspaceId: state.bundle.workspaceId, scrollY: global.scrollY, focusKey: options.focusKey }
      }),
      beforeRestore: () => persistDrafts(),
      onRestored: async ({ bundle }) => {
        if (disposed) return;
        const previousId = state.bundle.workspaceId;
        invalidateBatchContext();
        state.bundle = bundle;
        state.stage = state.prepared = state.sourceId = state.sourceVersionId = null;
        state.sourceDrafts.clear();
        state.readerPositions.clear();
        state.stages = state.allStages = [];
        state.restoreReturn = { previousId, copyId: bundle.workspaceId };
        state.remoteChanged = false;
        resetSearchContext();
        state.mode = 'page';
        connectSubscription();
        // Installation already committed; keep the installed copy open even if list refresh fails.
        try { await refreshData(); }
        catch (_) { announce('사본은 저장됐습니다. 작업공간 목록은 다시 열 때 확인해 주세요.'); }
        if (disposed) return;
        await render();
        announce('자료와 구성을 새 사본으로 열었습니다. 이전 작업공간은 그대로 보관됩니다.');
      }
    });

    const home = global.HaedoLife.HomeUI?.create({
      storage, core, host: main, getBundle: () => state.bundle,
      isDisposed: () => disposed, announce, navigate,
      renderReadingResume: parent => renderReadingResume(parent, 'home', 'home'),
      openSource: (sourceId, versionId) => navigate('source', {
        sourceId, sourceVersionId: versionId, locator: null,
        returnContext: { mode: 'home', workspaceId: state.bundle.workspaceId, scrollY: global.scrollY,
          focusKey: document.activeElement?.dataset.focusKey }
      })
    });

    const writer = global.HaedoLife.WritingUI?.create({
      storage, core, writingSync, host: main, getBundle: () => state.bundle,
      isDisposed: () => disposed, announce,
      onClose: () => navigate('sources'),
      onSaved: async ({ sourceId, sourceVersionId }) => {
        if (disposed) return;
        const token = navigationGeneration, workspaceId = state.bundle?.workspaceId;
        await refreshData();
        if (disposed || state.mode !== 'write' || token !== navigationGeneration || state.bundle?.workspaceId !== workspaceId ||
            !state.bundle?.sourceVersions.some(version => version.id === sourceVersionId && version.sourceId === sourceId)) return;
        state.remoteChanged = false;
        await navigate('source', { sourceId, sourceVersionId, locator: null });
        announce('글을 저장했습니다. 공개하려면 내 페이지에서 별도로 선택해 주세요.');
      }
    });

    // Native focus scrolling does not account for the fixed phone navigation
    // or the focus outline outside a control's rectangle.
    const keepFocusVisible = event => {
      if (focusFrame !== null) global.cancelAnimationFrame(focusFrame);
      const target = event.target;
      focusFrame = global.requestAnimationFrame(() => {
        focusFrame = null;
        if (disposed || !target.isConnected || document.activeElement !== target || !root.contains(target) ||
          !target.matches(':focus-visible') || !global.matchMedia('(max-width: 700px)').matches) return;
        const nav = document.querySelector('.haedo-nav') || toolbar.querySelector('.life-nav');
        if (!nav || nav.contains(target)) return;
        const boundary = nav.getBoundingClientRect().top;
        const rect = target.getBoundingClientRect();
        const style = global.getComputedStyle(target);
        const clearance = Math.max(0, parseFloat(style.outlineWidth) || 0) + Math.max(0, parseFloat(style.outlineOffset) || 0) + 8;
        if (boundary <= 0 || rect.height <= 0 || rect.height + clearance * 2 > boundary) return;
        const covered = rect.bottom + clearance - boundary;
        if (covered > 0) global.scrollBy({ top: Math.ceil(covered), behavior: 'instant' });
      });
    };
    root.addEventListener('focusin', keepFocusVisible);

    function announce(message, { quiet = false } = {}) {
      if (disposed) return;
      state.status = message;
      status.textContent = message;
      status.classList.toggle('life-sr-only', quiet);
    }

    function failure(cause) {
      if (disposed) return;
      const message = cause && cause.message ? cause.message : String(cause || '처리하지 못했습니다.');
      state.error = message;
      error.textContent = message + ' 입력한 내용은 유지됩니다.';
      error.hidden = false;
      if (cause && cause.code === 'stage_conflict' && state.stage) {
        error.append(button('새 검토 사본으로 보관', guarded(rescueStage)));
      }
      if (cause && cause.code === 'schema_missing') {
        const link = node('a', '동기화 설정 도움말', 'life-external');
        link.href = '#lifeSyncHelp';
        link.addEventListener('click', guarded(async () => { await navigate('sync'); main.querySelector('#lifeSyncHelp').open = true; }));
        error.append(link);
      }
    }

    function clearError() {
      if (disposed) return;
      state.error = '';
      error.textContent = '';
      error.hidden = true;
    }

    function guarded(action) {
      return async function (event) {
        if (state.busy || disposed) return;
        state.busy = true;
        root.setAttribute('aria-busy', 'true');
        clearError();
        const target = event && event.currentTarget;
        const editingControls = Array.from(root.querySelectorAll('input,select,textarea')).filter(control => !control.readOnly).map(control => [control, control.disabled]);
        editingControls.forEach(([control]) => { control.disabled = true; });
        if (target && target.tagName === 'BUTTON') target.disabled = true;
        try { await action(event); }
        catch (cause) { failure(cause); }
        finally {
          state.busy = false;
          root.removeAttribute('aria-busy');
          editingControls.forEach(([control, disabled]) => { if (control.isConnected) control.disabled = disabled; });
          if (target && target.isConnected) target.disabled = false;
        }
      };
    }

    function field(labelText, type, id, value) {
      const label = node('label', null, 'life-field');
      label.append(node('span', labelText));
      const input = node(type === 'textarea' ? 'textarea' : 'input');
      input.id = id;
      if (type !== 'textarea') input.type = type;
      input.value = value == null ? '' : String(value);
      label.append(input);
      return { label, input };
    }

    function selectField(labelText, id, options, value) {
      const label = node('label', null, 'life-field');
      label.append(node('span', labelText));
      const input = node('select');
      input.id = id;
      options.forEach(([key, title]) => {
        const option = node('option', title);
        option.value = key;
        input.append(option);
      });
      input.value = value;
      label.append(input);
      return { label, input };
    }

    function title(text) {
      const heading = node('h2', text, 'life-heading');
      heading.tabIndex = -1;
      return heading;
    }

    function empty(text) { return node('p', text, 'life-empty'); }

    function disclosure(trigger, panel, options = {}) {
      trigger.setAttribute('aria-controls', panel.id);
      trigger.setAttribute('aria-expanded', String(!panel.hidden));
      const setOpen = open => {
        panel.hidden = !open;
        trigger.setAttribute('aria-expanded', String(open));
        if (!open && panel.contains(document.activeElement)) trigger.focus({ preventScroll: true });
        options.onChange?.(open);
      };
      trigger.addEventListener('click', () => setOpen(panel.hidden));
      const escape = event => {
        if (event.key !== 'Escape' || panel.hidden) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.focus({ preventScroll: true });
      };
      trigger.addEventListener('keydown', escape);
      panel.addEventListener('keydown', escape);
      return setOpen;
    }

    function originName(value) { return value === 'writing' ? '내 글' : (ORIGINS.find(pair => pair[0] === value) || [value, value])[1]; }
    function isOwnWriting(source) { return !!global.HaedoLife.Writing?.isOwnSource(source, state.bundle); }
    function sourceOrigin(source) { return isOwnWriting(source) ? '내 글' : originName(source.origin); }

    function versionFor(sourceId) {
      return state.bundle.sourceVersions.filter(v => v.sourceId === sourceId).slice(-1)[0];
    }

    function sourceFor(sourceId) { return state.bundle.sources.find(s => s.id === sourceId); }

    function dirty() { return !!state.stage && state.editTick !== state.savedTick; }

    function changedStage() {
      state.editTick += 1;
      state.prepared = null;
      const previous = main.querySelector('.life-review');
      if (previous) previous.remove();
      const form = main.querySelector('#lifeImportForm');
      if (form) form.hidden = false;
      main.querySelector('#lifeImportEdit')?.remove();
      announce('입력 중 · 아직 검토 내용을 보관하지 않았습니다.');
      if (stageTimer) clearTimeout(stageTimer);
      if (!state.stageFailed) stageTimer = setTimeout(() => { persistStage().catch(failure); }, 400);
    }

    function replaceDraftText(text) {
      const previous = state.stage.input.text || '';
      if (previous !== text && state.stage.excerpts.length) {
        const old = state.stage.excerpts.map(excerpt => ({ text: previous.slice(excerpt.start, excerpt.end), topic: excerpt.topic, note: excerpt.note }));
        state.stage.invalidatedExcerpts = (state.stage.invalidatedExcerpts || []).concat(old);
        state.stage.excerpts = [];
        state.stageSelection = null;
      }
      state.stage.input.text = text;
    }

    async function rescueStage() {
      state.stage.stageId = core.id();
      for (const key of ['batchId', 'batchIndex', 'batchTotal', 'fileLabel']) delete state.stage[key];
      state.stage.revision = 0;
      state.stage.createdAt = new Date().toISOString();
      state.stageFailed = false;
      state.editTick += 1;
      await persistStage(true);
      await refreshData();
      render();
    }

    async function persistStage(force) {
      if (stageTimer) clearTimeout(stageTimer);
      stageTimer = null;
      if (!state.stage || (!dirty() && !force)) return saveChain;
      if (state.stageFailed && !force) throw new Error('검토 내용을 보관하지 못했습니다. 다시 보관하거나 내용을 복사해 주세요.');
      const snapshot = JSON.parse(JSON.stringify(state.stage));
      const tick = state.editTick;
      saveChain = saveChain.catch(() => {}).then(async () => {
        if (disposed || !state.stage || state.stage.stageId !== snapshot.stageId) return;
        const request = Object.assign({}, snapshot, { revision: state.stage.revision });
        try {
          const saved = await storage.saveStage(request);
          if (state.stage && state.stage.stageId === saved.stageId) {
            state.stage.revision = saved.revision;
            state.stage.updatedAt = saved.updatedAt;
            state.savedTick = tick;
            state.stageFailed = false;
            markBatchStageSaved(saved);
            if (!dirty()) announce('검토 중 보관됨 · 이 브라우저에 임시 보관했습니다.');
          }
        } catch (cause) {
          state.stageFailed = true;
          announce('검토 내용을 보관하지 못했습니다. 입력은 이 화면에 남아 있습니다.');
          throw cause;
        }
      });
      return saveChain;
    }

    function refreshData() {
      if (disposed || !state.bundle) return Promise.resolve(false);
      const workspaceId = state.bundle.workspaceId, token = workspaceGeneration, sequence = ++dataRefreshSequence;
      const pending = (async () => {
        const bundle = await storage.read(workspaceId);
        const workspaces = await storage.listWorkspaces();
        const stages = await storage.listStages(workspaceId);
        if (!batchContext(workspaceId) || token !== workspaceGeneration) return false;
        if (sequence !== dataRefreshSequence) return dataRefreshPromise;
        if (bundle.revision < state.bundle.revision) return false;
        state.bundle = bundle;
        state.workspaces = workspaces;
        const imports = stages.filter(stage => stage.kind !== 'writing');
        state.allStages = imports;
        state.stages = imports.filter(stage => stage.state === 'draft');
        mergeBatches(imports);
        return true;
      })();
      dataRefreshPromise = pending;
      return pending;
    }

    function batchKey(workspaceId, batchId) { return workspaceId + '|' + batchId; }

    function invalidateBatchContext() { workspaceGeneration += 1; stopBatchReading(); resetSearchContext(); }

    function validBatchStage(stage) {
      return typeof stage.batchId === 'string' && /^[a-f0-9-]{36}$/i.test(stage.batchId) &&
        Number.isInteger(stage.batchIndex) && stage.batchIndex >= 0 && stage.batchIndex < 10 && stage.batchIndex < stage.batchTotal &&
        Number.isInteger(stage.batchTotal) && stage.batchTotal >= 1 && stage.batchTotal <= 10;
    }

    function markBatchStageSaved(saved) {
      for (const batch of state.batches.values()) {
        if (batch.workspaceId !== saved.workspaceId) continue;
        const item = batch.items.find(row => row.stageId === saved.stageId || row.unsaved?.stageId === saved.stageId);
        if (!item) continue;
        item.stageId = saved.stageId;
        item.status = 'draft';
        item.message = '';
        delete item.unsaved;
      }
    }

    function mergeBatches(stages) {
      const existing = new Set(stages.map(stage => stage.stageId));
      for (const batch of state.batches.values()) if (batch.workspaceId === state.bundle.workspaceId) {
        batch.items.forEach(item => {
          if (item.stageId && !existing.has(item.stageId) && !item.unsaved) { item.status = 'removed'; item.result = null; }
        });
      }
      for (const stage of stages) {
        if (!validBatchStage(stage)) continue;
        let batch = state.batches.get(batchKey(stage.workspaceId, stage.batchId));
        if (!batch) {
          batch = { id: stage.batchId, workspaceId: stage.workspaceId, total: stage.batchTotal, items: [], reading: false, recovered: true };
          state.batches.set(batchKey(batch.workspaceId, batch.id), batch);
        }
        let item = batch.items.find(row => row.index === stage.batchIndex);
        if (!item) { item = { index: stage.batchIndex }; batch.items.push(item); }
        Object.assign(item, { label: (typeof stage.fileLabel === 'string' ? stage.fileLabel : '') || stage.input.fileName || stage.input.title || '제목 없는 파일', stageId: stage.stageId,
          result: stage.appliedResult || null, status: stage.state === 'applied' ? 'applied' : item.status === 'skipped' ? 'skipped' : 'draft' });
        delete item.unsaved;
        batch.items.sort((x, y) => x.index - y.index);
      }
    }

    function currentBatch() {
      if (!state.bundle) return null;
      const batch = state.batches.get(batchKey(state.bundle.workspaceId, state.batchId));
      return batch && batch.workspaceId === state.bundle.workspaceId ? batch : null;
    }

    function stopBatchReading() {
      batchGeneration += 1;
      for (const batch of state.batches.values()) if (batch.reading) {
        batch.stopped = true;
        batch.reading = false;
        batch.items.forEach(item => {
          if (item.status === 'reading') { item.status = 'unread'; item.message = '읽기 중단 · 파일 재선택 필요'; }
        });
      }
    }

    function batchContext(workspaceId) { return !disposed && state.bundle && state.bundle.workspaceId === workspaceId; }

    function batchStage(file, batch, index, text, origin) {
      const now = new Date().toISOString();
      return { stageId: core.id(), workspaceId: batch.workspaceId, revision: 0, state: 'draft',
        batchId: batch.id, batchIndex: index, batchTotal: batch.total, fileLabel: file.name,
        input: { origin, title: file.name.replace(/\.(txt|md)$/i, ''), fileName: file.name, text,
          url: '', format: /\.md$/i.test(file.name) ? 'text/markdown' : 'text/plain', authorRelation: 'unknown', coverage: { status: 'unknown', omissions: [] } },
        excerpts: [], createdAt: now, updatedAt: now };
    }

    async function startBatch(files, origin) {
      if (disposed || !files.length) return;
      if (state.busy) throw new Error('현재 검토 처리가 끝난 뒤 파일을 선택해 주세요.');
      if (files.length > 10) throw new Error('한 번에 파일 10개까지 선택할 수 있습니다. 현재 검토는 그대로 유지됩니다.');
      if (files.reduce((total, file) => total + file.size, 0) > 5 * MAX_TEXT_BYTES) throw new Error('선택한 파일의 총용량이 5 MiB를 넘습니다. 파일을 나누어 선택해 주세요.');
      const workspaceId = state.bundle.workspaceId, workspaceToken = workspaceGeneration;
      const contextAlive = () => batchContext(workspaceId) && workspaceToken === workspaceGeneration;
      stopBatchReading();
      const token = ++batchGeneration;
      if (dirty()) await persistStage();
      if (!contextAlive() || token !== batchGeneration) return;
      const batch = { id: core.id(), workspaceId, total: files.length, reading: true, recovered: false,
        items: files.map((file, index) => ({ index, label: file.name, status: 'unread' })) };
      state.batches.set(batchKey(batch.workspaceId, batch.id), batch);
      state.batchId = batch.id;
      state.mode = 'batch';
      render();
      announce('파일을 읽어 검토초안으로 보관합니다. 아직 자료에 반영하지 않습니다.');
      for (let index = 0; index < files.length; index++) {
        if (!contextAlive() || token !== batchGeneration || batch.stopped) break;
        const file = files[index], item = batch.items[index];
        item.status = 'reading'; updateBatchPanel();
        try {
          if (!/\.(txt|md)$/i.test(file.name)) throw new Error('UTF-8 .txt 또는 .md 파일만 지원합니다. 폴더·ZIP·사진은 가져오지 않습니다.');
          if (file.size > MAX_TEXT_BYTES) throw new Error('이 파일이 1 MiB를 넘습니다. 필요한 내용을 나누어 다시 선택해 주세요.');
          let text;
          try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
          catch (_) { throw new Error('UTF-8로 읽을 수 없습니다. 원래 파일은 변경하지 않았습니다.'); }
          if (!contextAlive() || token !== batchGeneration || batch.stopped) break;
          const stage = batchStage(file, batch, index, text, origin);
          item.unsaved = stage;
          item.status = 'saving'; updateBatchPanel();
          const saved = await storage.saveStage(stage);
          if (!contextAlive()) return;
          item.stageId = saved.stageId;
          item.status = 'draft';
          item.message = text ? '' : '빈 파일 · 내용을 보완해야 자료로 보관할 수 있습니다.';
          delete item.unsaved;
        } catch (cause) {
          if (!contextAlive()) return;
          item.status = 'failed';
          item.message = item.unsaved ? '초안 보관 실패 · 입력은 이 화면에만 있습니다. 다시 보관하거나 복사해 주세요.' : (cause?.message || '파일을 읽지 못했습니다. 다시 선택해 주세요.');
        }
        if (!contextAlive()) return;
        if (state.mode === 'batch' && state.batchId === batch.id) updateBatchPanel();
        if (token !== batchGeneration || batch.stopped) break;
      }
      if (!contextAlive()) return;
      batch.reading = false;
      // A stopped save may still have completed atomically; retain its confirmed result.
      if (state.mode === 'batch' && state.batchId === batch.id) updateBatchPanel();
      if (token === batchGeneration) {
        await refreshData();
        if (!contextAlive() || token !== batchGeneration) return;
        renderHeader(); updateBatchPanel();
        announce('선택한 파일의 처리를 마쳤습니다. 각 초안을 확인해 자료로 보관해 주세요.');
      }
    }

    function renderBatchPicker(parent) {
      const details = node('details', null, 'life-details');
      details.id = 'lifeBatchPicker';
      details.append(node('summary', '여러 텍스트 파일 가져오기'));
      details.append(node('p', '한 번에 10개 · 총 5 MiB · 파일당 1 MiB까지. 선택하면 파일별 검토초안을 보관하며, 현재 본문을 바꾸거나 자료를 자동 확정하지 않습니다.', 'life-help'));
      details.append(node('p', 'UTF-8 TXT·Markdown 본문만 가져옵니다. 폴더·ZIP·사진, Obsidian 내부 링크와 첨부를 자동으로 가져오거나 연결하지 않습니다.', 'life-help'));
      const file = field('여러 UTF-8 .txt 또는 .md 파일 선택', 'file', 'lifeBatchFiles', '');
      file.input.multiple = true;
      file.input.accept = '.txt,.md,text/plain,text/markdown';
      file.input.addEventListener('change', async () => {
        const files = Array.from(file.input.files);
        file.input.value = '';
        const origin = main.querySelector('#lifeImportOrigin')?.value || state.stage?.input.origin || 'other';
        clearError();
        try { await startBatch(files, origin); } catch (cause) { failure(cause); }
      });
      details.append(file.label);
      parent.append(details);
    }

    async function openBatchItem(item) {
      if (dirty()) await persistStage();
      if (item.unsaved) {
        state.stage = structuredClone(item.unsaved);
        state.editTick = 1; state.savedTick = 0;
        state.prepared = null; state.stageFailed = true;
        state.importMethod = 'text';
        state.mode = 'import'; render();
        announce('보관하지 못한 초안을 열었습니다. 입력을 복사하거나 검토 내용을 다시 보관해 주세요.');
      } else await openStage(item.stageId);
    }

    async function skipBatchItem(item) {
      if (state.stage?.stageId === item.stageId && dirty()) await persistStage();
      item.status = 'skipped';
      state.mode = 'batch';
      render();
      announce('이번 검토에서 건너뛰었습니다. 보관된 초안은 유지하며 나중에 다시 검토할 수 있습니다.');
    }

    function renderBatch() {
      main.append(title('선택한 파일'), node('p', '파일별 원문을 확인하고 보관하거나 건너뛰세요. 저장된 검토초안과 보관 결과만 다시 열기에서 복구됩니다. 실패·미읽음 파일은 다시 선택해야 합니다.', 'life-help'));
      const batches = [...state.batches.values()].filter(batch => batch.workspaceId === state.bundle.workspaceId);
      if (!currentBatch() && batches.length) state.batchId = batches[batches.length - 1].id;
      if (batches.length > 1) {
        const choice = selectField('선택 파일 묶음', 'lifeBatchChoice', batches.map((batch, index) => [batch.id, '파일 ' + batch.total + '개 · 묶음 ' + (index + 1)]), state.batchId);
        choice.input.addEventListener('change', guarded(() => { state.batchId = choice.input.value; render(); }));
        main.append(choice.label);
      }
      const panel = node('section', null, 'life-batch-list'); panel.id = 'lifeBatchList';
      main.append(panel);
      updateBatchPanel();
      renderBatchPicker(main);
    }

    function updateBatchPanel() {
      if (disposed || state.mode !== 'batch') return;
      const panel = main.querySelector('#lifeBatchList'), batch = currentBatch();
      if (!panel || !batch) return;
      panel.replaceChildren();
      const labels = { unread: '아직 읽지 않음 · 재선택 필요', reading: '파일 읽는 중', saving: '초안 보관 중', draft: '검토 중 보관됨', applied: '자료 보관됨', skipped: '건너뜀 · 초안 유지', failed: '실패 · 자료 미보관', removed: '검토 취소 · 자료 미보관' };
      const count = name => batch.items.filter(item => item.status === name).length;
      const summary = node('div', null, 'life-batch-status');
      summary.id = 'lifeBatchStatus'; summary.setAttribute('role', 'status');
      const progress = node('progress', null, 'life-batch-progress');
      progress.max = batch.total; progress.value = count('applied');
      progress.setAttribute('aria-label', '자료로 보관한 파일');
      summary.append(node('p', '선택 ' + batch.total + '개 중 자료 보관 ' + count('applied') + '개'), progress,
        node('p', '검토초안 ' + count('draft') + '개 · 건너뜀 ' + count('skipped') + '개 · 실패 ' + count('failed') + '개 · 미읽음 ' + count('unread') + '개' + (count('removed') ? ' · 검토 취소 ' + count('removed') + '개' : '') + (count('reading') + count('saving') ? ' · 처리 중 ' + (count('reading') + count('saving')) + '개' : ''), 'life-meta'));
      panel.append(summary);
      if (batch.recovered && batch.items.length < batch.total) panel.append(node('p', '저장되지 않은 파일은 이 목록에서 복구할 수 없습니다. 원래 파일을 다시 선택해 주세요.', 'life-help'));
      if (batch.reading) {
        const stop = button('파일 읽기 중단', () => { stopBatchReading(); updateBatchPanel(); announce('새 파일 읽기를 중단했습니다. 보관된 초안과 자료는 유지합니다. 진행 중인 저장은 결과가 확인되면 표시합니다.'); });
        stop.id = 'lifeBatchStop'; panel.append(stop);
      }
      const next = batch.items.find(item => item.status === 'draft');
      if (next) {
        const nextAction = node('div', null, 'life-batch-next');
        const proceed = button('다음 파일 검토', guarded(() => openBatchItem(next)), 'life-primary');
        proceed.id = 'lifeBatchNext';
        nextAction.append(node('p', next.label, 'life-batch-next-label'), proceed);
        panel.append(nextAction);
      } else if (!batch.reading) {
        panel.append(node('p', count('applied') === batch.total ? '선택한 파일을 모두 자료로 보관했습니다.' : '남은 파일의 상태를 확인하세요. 건너뛴 초안은 다시 검토하고 실패·미읽음 파일은 재선택할 수 있습니다.', 'life-help'));
      }
      const rows = node('div', null, 'life-batch-rows');
      batch.items.forEach(item => {
        const row = node('article', null, 'life-batch-row');
        row.dataset.batchIndex = String(item.index); row.dataset.batchState = item.status;
        if (item.stageId) row.dataset.stageId = item.stageId;
        row.append(node('h3', item.label), node('p', labels[item.status], 'life-meta'));
        if (item.message) row.append(node('p', item.message, 'life-help'));
        const actions = node('div', null, 'life-actions');
        if (['draft', 'skipped'].includes(item.status)) actions.append(button('이 파일 검토', guarded(() => openBatchItem(item))), button('건너뛰기 · 초안 유지', guarded(() => skipBatchItem(item))));
        if (item.unsaved) {
          actions.append(button('입력 확인', guarded(() => openBatchItem(item))), button('다시 초안 보관', guarded(async () => {
            const saved = await storage.saveStage(item.unsaved);
            item.stageId = saved.stageId; item.status = 'draft'; delete item.unsaved; item.message = '';
            await refreshData(); updateBatchPanel(); announce('검토 중 보관됨 · 이 브라우저에 임시 보관했습니다.');
          })));
        }
        if (item.status === 'applied' && item.result) actions.append(button('보관한 원문 열기', guarded(() => navigate('source', { sourceId: item.result.sourceId, sourceVersionId: item.result.sourceVersionId, locator: null }))));
        else if (item.status === 'applied') actions.append(node('p', '이전 보관 결과입니다. 원천 기록 목록에서 자료를 찾아주세요.', 'life-help'));
        row.append(actions); rows.append(row);
      });
      panel.append(rows);
    }

    function syncAccountKey(account) {
      return account ? account.projectUrl + '|' + account.userId : null;
    }

    function syncPresentation() {
      if (!sync) return { key: 'unavailable', label: '기기 간 자동 동기화 미연결', hint: '자료는 이 브라우저에 보관합니다. JSON 백업으로 사본을 옮길 수 있습니다.' };
      if (state.syncReadError) return { key: 'read_error', label: '동기화 상태 확인 실패 · 자료는 이 브라우저에 보관', hint: '기존 연결은 유지합니다. 상태를 다시 확인해 주세요.' };
      if (state.syncLoading) return { key: 'loading', label: '동기화 상태 확인 중', hint: '연결 상태를 확인한 뒤 가능한 작업을 표시합니다.' };
      const item = state.syncState;
      if (!state.syncAccount) return { key: 'auth_required', label: '동기화 로그인 필요 · 자료는 이 브라우저에 보관', hint: '관리에서 계정을 확인한 뒤 다시 시도해 주세요.' };
      if (item?.status === 'account_mismatch' || (item?.binding && (item.binding.userId !== state.syncAccount.userId || item.binding.projectUrl !== state.syncAccount.projectUrl))) return { key: 'mismatch', label: '다른 계정에 연결된 작업공간 · 자동 전송 안 함', hint: '기존 연결은 바꾸지 않습니다. 다른 계정으로 옮기려면 JSON 백업을 새 사본으로 복원하세요.' };
      if (!item?.binding) return { key: 'unbound', label: '기기 간 자동 동기화 미연결', hint: '시작하면 이 작업공간의 확정 자료를 서버에 보냅니다. 검토 초안은 이 브라우저에 남습니다.' };
      if (!item.enabled) return { key: 'paused', label: '기기 간 동기화 중지됨', hint: item.conflict ? '양쪽에 변경이 남아 있습니다. 동기화를 다시 시작한 뒤 비교해 주세요.' : '이 브라우저의 자료와 기존 연결을 유지합니다. 다시 시작하면 양쪽 변경을 확인합니다.' };
      const descriptions = {
        pending: ['동기화 대기', '이 브라우저의 변경을 보관했습니다. 연결되면 전송을 다시 시도합니다.'],
        syncing: ['동기화 중', '서버와 변경을 확인하고 있습니다. 이 브라우저의 자료는 그대로 유지합니다.'],
        synced: ['서버와 동기화됨', '다른 기기에서 같은 계정으로 로그인한 뒤 이 작업공간을 받으세요. 그 기기에서 열었는지는 확인하지 않습니다.'],
        conflict: ['양쪽 변경 확인 필요', '내 변경과 서버 변경을 비교해 선택하세요. 선택하지 않은 쪽도 별도 사본으로 남습니다.'],
        error: ['동기화 실패', '이 브라우저의 자료는 유지합니다. 연결을 확인하고 지금 동기화를 다시 시도해 주세요.']
      };
      const key = item.conflict ? 'conflict' : item.status;
      const [label, hint] = descriptions[key] || ['동기화 상태 확인 필요', '상태를 다시 확인해 주세요. 이 브라우저의 자료는 유지합니다.'];
      return { key, label, hint };
    }

    function syncSummary() { return syncPresentation().label; }

    async function refreshSync() {
      if (!sync || !state.bundle || disposed) return;
      const sequence = ++syncRefreshSequence;
      const workspaceId = state.bundle.workspaceId;
      try {
        const account = await sync.getAccount();
        if (disposed || sequence !== syncRefreshSequence || state.bundle.workspaceId !== workspaceId) return;
        const accountKey = syncAccountKey(account);
        if (accountKey !== state.syncAccountKey) {
          state.remoteRows = null;
          state.remoteRowsAccountKey = null;
          state.conflictView = null;
          state.conflictCopyId = null;

        }
        state.syncAccountKey = accountKey;
        state.syncAccount = account;
        const info = await sync.getState(workspaceId);
        if (disposed || sequence !== syncRefreshSequence || state.bundle.workspaceId !== workspaceId) return;
        state.syncState = info;
        state.syncReadError = null;
        state.syncLoading = false;

      } catch (cause) {
        if (disposed || sequence !== syncRefreshSequence) return;
        state.syncReadError = cause;
        state.syncLoading = false;
      }
      updateSyncPanels();
    }

    function updateSyncPanels() {
      if (disposed) return;
      const scope = main.querySelector('.life-scope');
      if (scope) updateScope(scope);
      if (state.mode === 'sync') {
        if (state.conflictView && state.syncState && (!state.syncState.enabled || !state.syncState.conflict)) {
          state.conflictView = null;
          renderConflict();
        }
        if (!state.conflictView && main.querySelector('#lifeSyncConflict')?.childElementCount) renderConflict();
        const panel = main.querySelector('#lifeSyncState');
        if (panel) fillSyncState(panel);
        const server = main.querySelector('#lifeRemoteList');
        if (server) fillRemoteList(server);
      }
    }

    function updateScope(scope) {
      scope.textContent = '이 브라우저의 개인 작업공간 · ' + syncSummary();
      const item = state.syncState;
      const matching = state.syncAccount && item?.binding && item.binding.userId === state.syncAccount.userId && item.binding.projectUrl === state.syncAccount.projectUrl;
      const mismatched = item?.binding && state.syncAccount && !matching;
      const passive = !state.syncReadError && !state.syncLoading && !item?.error && !item?.conflict && !mismatched && (!item?.binding || !item.enabled || (matching && item.status === 'synced'));
      scope.classList.toggle('life-sr-only', state.mode === 'sync' || (sectionFor(state.mode) !== 'manage' && passive));
    }

    async function syncAction(action, message, refreshLocal) {
      const result = await action();
      if (refreshLocal) await refreshData();
      await refreshSync();
      if (message) announce(message);
      return result;
    }

    function connectSubscription() {
      if (unsubscribe) unsubscribe();
      unsubscribe = storage.subscribe(state.bundle.workspaceId, event => {
        if (event.type === 'error') { failure(event.error); return; }
        if (event.type === 'sync_changed') { refreshSync().catch(failure); return; }
        if (event.type !== 'changed') return;
        if (event.revision <= state.bundle.revision || state.busy) return;
        state.remoteChanged = true;
        announce('보관한 자료가 변경되었습니다. 현재 입력을 유지합니다. 최신 내용 확인을 눌러 주세요.');
        renderHeader();
      });
      if (sync) {
        state.syncState = null;
        state.syncReadError = null;
        state.syncLoading = true;
        state.conflictView = null;
        refreshSync().catch(failure);
      }
    }

    async function commit(changes, stage, stageResult, onStored) {
      const request = {
        workspaceId: state.bundle.workspaceId, baseRevision: state.bundle.revision, changes
      };
      if (stage) { request.stageId = stage.stageId; request.stageRevision = stage.revision; }
      if (stageResult) request.stageResult = stageResult;
      const signature = JSON.stringify(request);
      if (!state.pendingOperation || state.pendingOperation.signature !== signature) {
        state.pendingOperation = { signature, operationId: core.id() };
      }
      request.operationId = state.pendingOperation.operationId;
      announce('이 브라우저에 저장 중');
      const result = await storage.commitLocal(request);
      if (result.status === 'conflict') {
        state.remoteChanged = true;
        renderHeader();
        throw new Error('다른 탭의 변경 확인이 필요합니다. 입력을 유지한 채 최신 내용을 확인하고 다시 검토해 주세요.');
      }
      if (result.status !== 'stored') throw new Error(result.error && result.error.message || '저장하지 못했습니다. 다시 시도하거나 내용을 복사해 주세요.');
      state.pendingOperation = null;
      onStored?.(result);
      await refreshData();
      state.remoteChanged = false;
      return result;
    }

    async function navigate(mode, options) {
      const token = ++navigationGeneration;
      if (dirty()) await persistStage();
      await workbench?.flush();
      await writer?.flush();
      await flushReadingPosition();
      if (disposed || token !== navigationGeneration) return;
      // A previous excerpt/record save does not describe the draft being opened.
      // Clear only after navigation can succeed; failed flushes keep their feedback.
      if (mode === 'write' && state.mode !== 'write') announce('', { quiet: true });
      if (!['tools', 'manage', 'sync', 'transfer', ...workbenchModes].includes(mode) && !options?.preserveContext &&
          (mode !== 'source' || (options?.sourceId && !Object.hasOwn(options, 'returnContext')))) state.returnContext = null;
      state.managementOpen = false;
      if (mode === 'source' && !options?.readerArrangeOpen) state.readerArrangeOpen = false;
      const { selection, groupId, pagePreview, discovery, writing, reimport, book, bookList, chapterImport: chapterImportOptions, ...viewOptions } = options || {};
      if (reimport) {
        if (mode !== 'import' || state.bundle.workspaceId !== reimport.workspaceId) return;
        const source = sourceFor(reimport.sourceId);
        const version = state.bundle.sourceVersions.find(item => item.id === reimport.sourceVersionId && item.sourceId === source?.id);
        if (!source || source.origin !== 'naver_blog' || !version) throw new Error('선택한 원문을 찾을 수 없습니다. 기존 자료를 다시 열어 주세요.');
        newDraft();
        Object.assign(state.stage.input, {
          origin: source.origin, title: source.title, url: source.url || '', existingSourceId: source.id,
          author: version.originalAuthor.label, authorRelation: version.originalAuthor.relation,
          originalCreatedAt: version.originalCreatedAt, format: version.format
        });
        if (source.sourceKey) state.stage.input.fileName = source.sourceKey;
        // A new capture has its own scope; do not inherit full_text or omissions.
        state.editTick = 1;
      }
      if (!['import', 'batch', 'source'].includes(mode) && !chapterImportOptions) chapterImport = null;
      writingOpenOptions = mode === 'write' ? writing || {} : null;
      Object.assign(state, viewOptions, { mode });
      workbenchOpenOptions = workbenchModes.includes(mode) ? options : null;
      if (sectionFor(mode) === 'records') lastRecordMode = mode;
      writeRoute(mode, false);
      // Incoming records are only a review. A slow configuration read must not
      // lock the global navigation; Workbench owns stale-response guards.
      const rendering = render();
      if (!options?.selection) await rendering;
      if (reimport) {
        main.querySelector('#lifeImportText')?.focus();
        await persistStage(true);
      }
      if (mode === 'sync' || mode === 'transfer') global.scrollTo({ top: 0, behavior: 'instant' });
      const heading = (options?.chapterImport && (main.querySelector('#wbChapterImportHeading') || main.querySelector('#wbChapterNote'))) || (options?.book && main.querySelector(options.book.chapterId ? '#wbChapterNote' : '#wbBookHeading')) || main.querySelector('h1,h2') || toolbar.querySelector('h1');
      if (heading && !options?.groupId && !reimport) {
        heading.focus({ preventScroll: true });
        if (options?.book || options?.chapterImport) heading.scrollIntoView({ block: 'nearest' });
      }
    }

    function currentChapterImport(context = chapterImport) {
      return !!context && context === chapterImport && !disposed && context.workspaceId === state.bundle?.workspaceId && context.generation === workspaceGeneration;
    }

    async function beginChapterImport(target, { isCurrent = () => true } = {}) {
      const generation = workspaceGeneration, navigation = navigationGeneration;
      await persistDrafts();
      if (disposed || generation !== workspaceGeneration || navigation !== navigationGeneration || state.mode !== 'books' || !isCurrent() || target.workspaceId !== state.bundle?.workspaceId) return;
      // Existing import notes remain in their saved stages; this chapter starts a fresh review.
      newDraft();
      chapterImport = { ...target, generation, versionIds: [] };
      try { await navigate('import'); }
      catch (cause) { chapterImport = null; throw cause; }
    }

    async function returnToChapterImport() {
      const context = chapterImport;
      if (!currentChapterImport(context)) return;
      await persistDrafts();
      await refreshData();
      if (!currentChapterImport(context)) return;
      await navigate('books', { chapterImport: { workspaceId: context.workspaceId, bookId: context.bookId,
        chapterId: context.chapterId, versionIds: context.versionIds.slice() } });
      if (chapterImport === context) chapterImport = null;
    }

    function renderChapterImportReturn() {
      if (!currentChapterImport() || !['import', 'batch', 'source'].includes(state.mode)) return;
      const context = chapterImport;
      const panel = node('section', null, 'life-chapter-import-return'); panel.id = 'lifeChapterImportContext';
      panel.setAttribute('aria-label', context.bookTitle + ' · ' + context.chapterTitle + '에 자료 가져오기');
      const heading = node('p', context.chapterTitle, 'life-chapter-import-title');
      heading.title = context.bookTitle;
      const back = button(context.versionIds.length ? '보관한 자료 확인' : '장으로 돌아가기', guarded(returnToChapterImport));
      back.id = 'lifeChapterImportReturn';
      panel.append(heading, node('p', context.versionIds.length
        ? '자료 ' + context.versionIds.length + '개 보관 · 아직 장에 연결하지 않았습니다.'
        : '자료를 확인한 뒤 이 장에 연결할 글을 고릅니다. 원고는 저장했습니다.', 'life-meta'), back);
      main.prepend(panel);
    }

    function newDraft() {
      const now = new Date().toISOString();
      state.stage = {
        stageId: core.id(), workspaceId: state.bundle.workspaceId, revision: 0,
        input: { origin: 'apple_notes', title: '', text: '', url: '', format: 'text/plain', authorRelation: 'unknown', coverage: { status: 'unknown', omissions: [] } },
        excerpts: [], createdAt: now, updatedAt: now, state: 'draft'
      };
      state.editTick = 0;
      state.savedTick = 0;
      state.stageFailed = false;
      state.prepared = null;
      state.stageSelection = null;
      state.importMethod = 'text';
    }

    async function openStage(stageId) {
      if (dirty()) await persistStage();
      const stage = await storage.getStage(stageId);
      if (!stage || stage.state !== 'draft' || stage.kind === 'writing') throw new Error('이 검토 항목은 이미 적용됐거나 찾을 수 없습니다.');
      state.stage = stage;
      state.savedTick = state.editTick = 0;
      state.prepared = null;
      state.stageFailed = false;
      state.importMethod = stage.input.text || stage.input.existingSourceId ? 'text' : stage.input.url ? 'link' : stage.input.fileName ? 'file' : 'text';
      await navigate('import');
    }

    function sectionFor(mode) {
      if (mode === 'home') return 'home';
      return ['tools', 'discover', 'reflection', 'books'].includes(mode) ? 'tools' : ['manage', 'sync', 'transfer', 'workbench-backup', 'public-pages'].includes(mode) ? 'manage' : 'records';
    }

    function routeMode() {
      const params = new URLSearchParams(global.location.search);
      const section = params.get('section');
      const view = params.get('view');
      if (section === 'home') return 'home';
      if (section === 'tools') return ['discover', 'reflection', 'books'].includes(view) ? view : 'tools';
      if (section === 'manage') return ['transfer', 'sync', 'workbench-backup', 'public-pages'].includes(view) ? view : 'manage';
      if (!section && ['transfer', 'sync', 'workbench-backup', 'public-pages', 'discover', 'reflection', 'books'].includes(view)) return view;
      if (['topics', 'sources', 'time', 'import', 'write', 'activities', 'page', 'related'].includes(view)) return view;
      return section === 'records' || /\/life\.html$/.test(global.location.pathname) ? 'sources' : 'home';
    }

    function writeRoute(mode, push) {
      if (!global.HaedoNavigation) return;
      const url = new URL(global.location.href);
      const section = sectionFor(mode);
      if (section === 'home' && !/\/life\.html$/.test(url.pathname)) url.searchParams.delete('section');
      else url.searchParams.set('section', section);
      const view = mode === 'source' ? 'sources' : mode === 'batch' ? 'import' : mode;
      if (['topics', 'time', 'import', 'write', 'sync', 'transfer', ...workbenchModes].includes(view)) url.searchParams.set('view', view);
      else url.searchParams.delete('view');
      const destination = url.pathname + url.search + url.hash;
      if (destination !== global.location.pathname + global.location.search + global.location.hash)
        global.history[push ? 'pushState' : 'replaceState'](null, '', destination);
    }

    async function navigateSection(section, push = true) {
      if (!state.bundle) {
        global.requestAnimationFrame(() => { if (!disposed) main.querySelector('#lifeWorkspaceChoice')?.focus(); });
        announce('먼저 보관한 작업공간을 선택해 주세요.');
        return;
      }
      navigationGeneration += 1;
      const previousSection = sectionFor(state.mode);
      if (section === previousSection) return;
      if (previousSection === 'records') lastRecordMode = state.mode;
      const next = section === 'home' ? 'home' : section === 'records' ? lastRecordMode : section === 'tools' ? 'tools' : 'manage';
      // Save before changing URL so a failed draft write keeps the current view.
      if (dirty()) await persistStage();
      await workbench?.flush();
      await writer?.flush();
      if (disposed) return;
      writeRoute(next, push);
      await navigate(next, { preserveContext: true });
    }

    const popstate = guarded(async () => {
      if (!state.bundle) return;
      let mode = routeMode();
      if (sectionFor(state.mode) === 'records') lastRecordMode = state.mode;
      if (mode === 'sources' && lastRecordMode === 'source') mode = 'source';
      if (mode === 'import' && lastRecordMode === 'batch') mode = 'batch';
      try { await navigate(mode, { preserveContext: true }); }
      catch (cause) { writeRoute(state.mode, false); throw cause; }
    });

    function renderHeader() {
      if (disposed) return;
      const section = sectionFor(state.mode);
      global.HaedoNavigation?.activate(section);
      header.replaceChildren();
      toolbar.classList.add('haedo-page-heading');
      toolbar.replaceChildren();
      toolbar.hidden = state.mode === 'source' && !state.remoteChanged;
      recordSections.replaceChildren();
      const focused = ['write', 'source', 'page', 'related'].includes(state.mode);
      recordSections.hidden = section !== 'records' || focused;
      const heading = node('h1', null, 'life-page-title');
      heading.tabIndex = -1;
      const headingGroup = node('div', null, 'haedo-heading-title');
      if (state.mode === 'write') heading.textContent = '글쓰기';
      else if (state.mode === 'page') heading.textContent = '내 페이지';
      else if (state.mode === 'related') heading.textContent = '관련 기록';
      else if (section === 'records') {
        const records = button('기록', guarded(() => navigate('sources')), 'life-title-button');
        records.setAttribute('aria-label', '기록 목록');
        heading.append(records);
      } else heading.textContent = section === 'home' ? '홈' : section === 'tools' ? '도구' : '관리';
      if (section === 'manage' && state.mode !== 'manage') {
        headingGroup.append(iconButton('관리로 돌아가기', 'back', guarded(() => navigate('manage'))));
      }
      if (section === 'tools' && state.mode !== 'tools') {
        headingGroup.append(iconButton('도구로 돌아가기', 'back', guarded(() => navigate('tools'))));
      }
      if (state.mode === 'page') headingGroup.append(iconButton('기록으로 돌아가기', 'back', guarded(() => navigate('sources'))));
      if (state.mode === 'related') {
        const back = iconButton(relatedOrigin?.workspaceId === state.bundle?.workspaceId ? '읽던 글로 돌아가기' : '기록으로 돌아가기', 'back', guarded(returnFromRelated));
        back.id = 'lifeRelatedReturn';
        headingGroup.append(back);
      }
      headingGroup.append(heading);
      if (state.mode !== 'source') toolbar.append(headingGroup);
      if (section === 'records') {
        if (state.mode === 'sources') {
          const select = iconButton('기록 선택', 'check', guarded(() => {
            state.selecting = !state.selecting;
            if (!state.selecting) selectedVersions.clear();
            render();
            main.parentNode.querySelector('#lifeSelectionToggle')?.focus({ preventScroll: true });
          }));
          select.id = 'lifeSelectionToggle';
          select.setAttribute('aria-pressed', String(state.selecting));
          recordSections.append(select);
        }
        [['activities', '묶음'], ['page', '내 페이지']].forEach(([mode, label]) => {
          const tab = button(label, guarded(() => navigate(mode)));
          if (state.mode === mode || (mode === 'sources' && state.mode === 'source')) tab.setAttribute('aria-current', 'page');
          recordSections.append(tab);
        });
      }
      if (!focused && (section === 'records' || section === 'home')) {
        const nav = node('nav', null, 'life-nav life-context-nav');
        nav.setAttribute('aria-label', '기록 보기');
        [['sources', '기록 검색', 'search'], ...(section === 'records' ? [['time', '시간 보기', 'timeline']] : [])].forEach(([mode, label, icon]) => {
          const tab = iconButton(label, icon, guarded(() => navigate(mode)));
          if (state.mode === mode || mode === 'sources' && state.mode === 'source') tab.setAttribute('aria-current', 'page');
          nav.append(tab);
        });
        const add = iconButton('가져오기', 'plus', guarded(async () => {
          if (!state.stage || state.stage.state !== 'draft') newDraft();
          await navigate('import');
        }));
        if (state.mode === 'import' || state.mode === 'batch') add.setAttribute('aria-current', 'page');
        nav.append(add, iconButton('글쓰기', 'edit', guarded(() => navigate('write'))));
        toolbar.append(nav);
      }
      if (state.remoteChanged) {
        const refresh = button('최신 내용 확인', guarded(async () => {
          if (dirty()) await persistStage();
          await workbench?.flush();
          await writer?.flush();
          await refreshData();
          state.remoteChanged = false;
          state.prepared = null;
          render();
          announce('최신 내용을 불러왔습니다. 보관 중인 입력은 유지됩니다. 다시 검토해 주세요.');
        }), 'life-refresh');
        toolbar.append(refresh);
      }
    }

    function destinationRow(label, description, href, glyph) {
      const link = node('a', null, 'life-destination');
      link.href = href;
      link.append(global.HaedoLife.Icons.create(glyph));
      const copy = node('span', null, 'life-destination-copy');
      copy.append(node('strong', label), node('span', description, 'life-meta'));
      link.append(copy, global.HaedoLife.Icons.create('chevron'));
      link.addEventListener('click', event => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        guarded(async () => {
          await persistDrafts();
          if (disposed) return;
          state.sourceDrafts.clear();
          global.location.assign(href);
        })(event);
      });
      return link;
    }

    function actionRow(label, description, glyph, action, displayLabel) {
      const control = button(null, guarded(action), 'life-destination life-action-row');
      control.setAttribute('aria-label', label);
      const copy = node('span', null, 'life-destination-copy');
      copy.append(node('strong', displayLabel || label), node('span', description, 'life-meta'));
      control.append(global.HaedoLife.Icons.create(glyph), copy, global.HaedoLife.Icons.create('chevron'));
      return control;
    }

    function renderTools() {
      const list = node('div', null, 'life-destinations');
      list.append(actionRow('다시 찾기', '검색하고 관련 기록 이어 보기', 'search', () => navigate('discover')),
        actionRow('회고', '고른 자료를 돌아보고 메모', 'book', () => navigate('reflection')),
        actionRow('책 만들기', '주제별로 글을 엮고 장별 원고 쓰기', 'book', () => navigate('books')),
        destinationRow('목표', '진행 중인 일과 다음 계획', 'goals.html', 'target'),
        destinationRow('습관', '반복할 일과 오늘의 체크', 'habits.html', 'check'));
      main.append(list);
    }

    function renderManagement() {
      const manage = actionRow('자료 관리', '자료 ' + state.bundle.sources.length + '개 · 발췌 ' + state.bundle.records.length + '개', 'book', () => {}, state.bundle.title || '내 자료');
      const management = node('section', null, 'life-management');
      management.id = 'lifeManagement';
      management.hidden = !state.managementOpen;
      management.setAttribute('aria-label', '자료 관리');
      const close = iconButton('자료 관리 닫기', 'close', () => setManagement(false));
      const setManagement = disclosure(manage, management, { onChange: open => { state.managementOpen = open; } });
      const managementHeading = node('div', null, 'life-panel-heading');
      managementHeading.append(node('h2', '자료 관리'), close);
      management.append(managementHeading);
      const workspace = selectField('작업공간', 'lifeWorkspace', state.workspaces.map(w => [w.workspaceId, w.title]), state.bundle.workspaceId);
      workspace.input.addEventListener('change', guarded(async () => {
        const selected = workspace.input.value;
        await persistDrafts();
        const bundle = await storage.read(selected);
        if (disposed) return;
        await storage.setActive(selected);
        if (disposed) return;
        invalidateBatchContext();
        state.bundle = bundle;
        state.stage = null;
        state.prepared = null;
        state.sourceId = null;
        state.sourceVersionId = null;
        state.sourceDrafts.clear();
        state.readerPositions.clear();
        state.remoteChanged = false;
        state.mode = 'sources';
        resetSearchContext();
        await refreshData();
        connectSubscription();
        render();
        announce('선택한 작업공간을 열었습니다. 다른 작업공간은 그대로 보관됩니다.');
      }));
      management.append(workspace.label);
      if ([...state.batches.values()].some(batch => batch.workspaceId === state.bundle.workspaceId)) management.append(button('선택 파일 목록', guarded(() => navigate('batch'))));
      main.append(manage, management);
      const destinations = node('div', null, 'life-destinations');
      destinations.append(actionRow('공개 페이지 관리', '이 계정으로 게시한 페이지 확인·철회', 'link', () => navigate('public-pages')));
      destinations.append(actionRow('자료·구성 백업', '원문과 묶음·내 페이지·회고·책을 함께 보관', 'download', () => navigate('workbench-backup')));
      destinations.append(actionRow('내보내기·사본 복원', '원문·발췌·출처를 파일로 보관', 'download', () => navigate('transfer'), '자료 백업·복원'));
      if (sync) destinations.append(actionRow('기기 간 동기화', '연결할 작업공간을 직접 선택', 'cloud', async () => {
        await navigate('sync'); await refreshSync();
      }));
      destinations.append(destinationRow('연표·목표·습관 백업·복원', '자료 백업과 별도로 보관됩니다.', 'workspace.html?section=manage#backupAll', 'timeline'));
      main.append(destinations);
    }

    function renderStages(parent) {
      if (!state.stages.length) return;
      const details = node('details', null, 'life-details');
      details.append(node('summary', '검토 중 ' + state.stages.length + '개 · 이어서 확인'));
      const listedBatches = new Set();
      state.stages.forEach(stage => {
        if (validBatchStage(stage)) {
          if (!listedBatches.has(stage.batchId)) {
            listedBatches.add(stage.batchId);
            details.append(button('파일 ' + stage.batchTotal + '개 · 검토 목록', guarded(() => { state.batchId = stage.batchId; return navigate('batch'); })));
          }
          return;
        }
        const row = node('div', null, 'life-row');
        row.append(button(stage.input.title || stage.input.fileName || '제목 없는 검토 항목', guarded(() => openStage(stage.stageId))), node('span', originName(stage.input.origin), 'life-meta'));
        details.append(row);
      });
      parent.append(details);
    }

    function resetSearchContext() {
      selectedVersions.clear();
      selectionReturn = null;
      chapterImport = null;
      relatedOrigin = null;
      state.selecting = state.readerArrangeOpen = false;
      state.topic = state.topicsSearch = state.sourcesSearch = state.originFilter = '';
      state.topicUnassigned = false;
      state.topicFilterSearch = '';
      state.returnContext = null;
      state.suppressReaderResume = false;
      state.importResult = null;
      state.sourcesLimit = SEARCH_PAGE_SIZE;
      state.sourcesWindowKey = '';
      state.sourcesRevealVersionId = null;
      state.ignoreKoreanSpacing = false;
    }

    async function arrangeRecords(mode, versionIds, returnFocusId) {
      if (!versionIds.length) return;
      const workspaceId = state.bundle.workspaceId;
      if (versionIds.some(id => !state.bundle.sourceVersions.some(version => version.id === id))) {
        throw new Error('선택한 원문 버전을 찾을 수 없습니다. 선택 목록을 확인해 주세요.');
      }
      selectionReturn = { workspaceId, versionIds: [...versionIds], mode: state.mode, sourceId: state.sourceId,
        sourceVersionId: state.sourceVersionId, locator: state.sourceSelection,
        returnContext: state.returnContext, scrollY: global.scrollY,
        focusId: returnFocusId || ({ activities: 'lifeArrangeGroups', page: 'lifeArrangePage', reflection: 'lifeArrangeReflection' }[mode]) };
      await navigate(mode, { selection: { workspaceId, versionIds: [...versionIds] }, pagePreview: false });
    }

    async function returnFromArrange() {
      const context = selectionReturn;
      if (!context || context.workspaceId !== state.bundle?.workspaceId) return navigate('sources');
      await navigate(context.mode, { sourceId: context.sourceId, sourceVersionId: context.sourceVersionId,
        locator: context.locator, returnContext: context.returnContext, preserveContext: true,
        readerArrangeOpen: context.mode === 'source' });
      requestAnimationFrame(() => {
        if (disposed || state.bundle?.workspaceId !== context.workspaceId || state.mode !== context.mode) return;
        main.querySelector('#' + context.focusId)?.focus({ preventScroll: true });
        global.scrollTo({ top: context.scrollY, behavior: 'instant' });
      });
    }

    function arrangeActions(getVersions) {
      const actions = node('div', null, 'life-actions life-arrange-actions');
      [['activities', '묶음에 담기', 'link', 'lifeArrangeGroups', 'life-arrange-groups'],
        ['page', '내 페이지에 담기', 'user', 'lifeArrangePage', 'life-arrange-page'],
        ['reflection', '회고에 담기', 'book', 'lifeArrangeReflection', 'life-arrange-reflection']].forEach(([mode, label, glyph, id, css]) => {
        const control = button(null, guarded(() => arrangeRecords(mode, getVersions())), css);
        control.id = id;
        control.append(global.HaedoLife.Icons.create(glyph), node('span', label));
        control.disabled = !getVersions().length;
        actions.append(control);
      });
      return actions;
    }

    function searchField(parent, placeholder, update, key) {
      const bar = node('div', null, 'life-search-bar');
      const search = field('자료 검색', 'search', 'lifeSearch', state[key]);
      search.label.classList.add('life-search-field');
      search.label.firstChild.className = 'life-sr-only';
      search.input.placeholder = placeholder;
      search.input.maxLength = 500;
      let composing = false;
      let lastValue = state[key];
      const finish = () => {
        const value = search.input.value;
        state[key] = value;
        if (value !== lastValue) { lastValue = value; update(); }
      };
      search.input.addEventListener('compositionstart', () => { composing = true; });
      search.input.addEventListener('input', event => { if (!composing && !event.isComposing) finish(); });
      search.input.addEventListener('compositionend', () => { composing = false; finish(); });
      const clear = iconButton('검색어 지우기', 'close', () => {
        composing = false;
        search.input.value = state[key] = lastValue = '';
        update();
        search.input.focus({ preventScroll: true });
      });
      clear.id = 'lifeSearchClear';
      bar.append(global.HaedoLife.Icons.create('search'), search.label, clear);
      parent.append(bar);
      return bar;
    }

    function matchingText(text, query) {
      const value = query.trim();
      return !value || String(text).toLocaleLowerCase().includes(value.toLocaleLowerCase());
    }

    function resultFocusKey(mode, id, refIndex) { return mode + ':' + id + ':' + (refIndex ?? ''); }

    async function flushReadingPosition() {
      // Resume metadata is optional; its own status reports failures without
      // blocking a draft save, navigation or the account's logout boundary.
      try { await readerWatch?.flush(); } catch (_) { /* watchReader reports onError */ }
    }

    function renderReadingResume(parent, mode, prefix = 'life') {
      readingResumeCleanup?.(); readingResumeCleanup = null;
      const row = node('section', null, 'life-reading-resume');
      row.id = prefix + 'ReadingResume';
      row.setAttribute('aria-label', '이 브라우저의 읽기 위치');
      row.hidden = true;
      parent.append(row);
      if (!readingPosition) return;
      const workspaceId = state.bundle.workspaceId;
      let stopped = false, sequence = 0;
      const showing = () => !disposed && !stopped && row.isConnected && state.mode === mode && state.bundle?.workspaceId === workspaceId;
      const showError = message => {
        if (!showing()) return;
        row.hidden = false;
        let feedback = row.querySelector('.life-reading-resume-status');
        if (!feedback) {
          feedback = node('p', null, 'life-meta life-reading-resume-status');
          feedback.setAttribute('role', 'status');
          row.append(feedback);
        }
        feedback.textContent = message;
      };
      const action = (control, task, failureMessage = '읽기 위치를 확인하지 못했습니다. 다시 시도해 주세요.') => {
        let running = false;
        control.addEventListener('click', async () => {
          if (running || !showing()) return;
          running = true;
          const hadFocus = document.activeElement === control;
          control.disabled = true;
          try { await task(); }
          catch (_) { showError(failureMessage); }
          finally {
            running = false;
            if (control.isConnected) {
              control.disabled = false;
              if (hadFocus && document.activeElement === document.body) control.focus({ preventScroll: true });
            }
          }
        });
        return control;
      };
      const draw = view => {
        const focusId = row.contains(document.activeElement) ? document.activeElement.id : null;
        row.replaceChildren();
        row.hidden = view.status === 'empty';
        if (row.hidden) return;
        const copy = node('div', null, 'life-reading-resume-copy');
        const source = state.bundle.sources.find(item => item.id === view.position?.sourceId);
        const versions = state.bundle.sourceVersions.filter(item => item.sourceId === view.position?.sourceId);
        const versionIndex = versions.findIndex(item => item.id === view.position?.sourceVersionId);
        copy.append(node('p', source ? sourceLabel(source) : '저장한 원문 버전', 'life-reading-resume-title'),
          node('p', '이 브라우저' + (versionIndex >= 0 && versionIndex < versions.length - 1 ? ' · 이전 버전' : ''), 'life-meta'));
        row.append(copy);
        if (view.status === 'available') {
          const open = button('이어 읽기', () => {}, 'life-primary life-reading-resume-open');
          open.prepend(global.HaedoLife.Icons.create('bookmark'));
          open.id = prefix + 'ReadingResumeOpen';
          open.dataset.focusKey = mode + ':reading-resume';
          row.append(action(open, async () => {
            const token = navigationGeneration;
            const fresh = await readingPosition.read(workspaceId);
            if (!showing() || token !== navigationGeneration) return;
            if (fresh.status !== 'available' || !fresh.position) {
              draw(fresh);
              showError(fresh.status === 'empty' ? '읽기 위치가 지워졌습니다. 기록에서 원문을 선택해 주세요.' :
                '저장한 원문 버전을 찾을 수 없습니다. 다른 버전으로 바꾸지 않았습니다.');
              row.querySelector('.life-reading-resume-clear')?.focus({ preventScroll: true });
              return;
            }
            if (fresh.revision !== view.revision || fresh.position.sourceId !== view.position.sourceId || fresh.position.sourceVersionId !== view.position.sourceVersionId ||
                fresh.position.offset !== view.position.offset) {
              draw(fresh);
              showError('읽기 위치가 바뀌었습니다. 확인한 뒤 다시 이어 읽어 주세요.');
              row.querySelector('.life-reading-resume-open')?.focus({ preventScroll: true });
              return;
            }
            const { sourceId, sourceVersionId, offset } = fresh.position;
            const fetched = await storage.read(workspaceId);
            if (!showing() || token !== navigationGeneration) return;
            const bundle = state.bundle.revision > fetched.revision ? state.bundle : fetched;
            const version = bundle.sourceVersions.find(item => item.id === sourceVersionId && item.sourceId === sourceId);
            if (!bundle.sources.some(item => item.id === sourceId) || !version || typeof version.contentText !== 'string' ||
                !Number.isInteger(offset) || offset < 0 || offset > version.contentText.length) {
              showError('저장한 원문 버전을 찾을 수 없습니다. 다른 버전으로 바꾸지 않았습니다.');
              return;
            }
            state.bundle = bundle;
            await navigate('source', { sourceId, sourceVersionId, locator: { start: offset, end: offset },
              returnContext: { workspaceId, mode, scrollY: global.scrollY, focusKey: open.dataset.focusKey } });
          }));
        } else showError('저장한 원문 버전을 찾을 수 없습니다. 다른 버전으로 바꾸지 않았습니다.');
        const clear = iconButton('읽기 위치 지우기', 'close', () => {}, 'life-reading-resume-clear');
        clear.id = prefix + 'ReadingResumeClear';
        row.append(action(clear, async () => {
          const token = navigationGeneration;
          const result = await readingPosition.clear(workspaceId, view.revision);
          if (!showing() || token !== navigationGeneration) return;
          if (result.status === 'conflict') {
            await refresh();
            if (!showing() || token !== navigationGeneration) return;
            showError('읽기 위치가 바뀌었습니다. 확인한 뒤 다시 지워 주세요.');
            row.querySelector('.life-reading-resume-clear')?.focus({ preventScroll: true });
            return;
          }
          draw(result.state);
          main.querySelector(mode === 'home' ? '#homeRecentTitle' : '#lifeSearch')?.focus({ preventScroll: true });
        }, '읽기 위치를 지우지 못했습니다. 다시 시도해 주세요.'));
        if (focusId) (row.querySelector('#' + focusId) || clear).focus({ preventScroll: true });
      };
      const refresh = async () => {
        const token = ++sequence;
        try {
          const view = await readingPosition.read(workspaceId);
          if (!showing() || token !== sequence) return;
          draw(view);
        } catch (_) {
          if (!showing() || token !== sequence) return;
          row.replaceChildren();
          showError('읽기 위치를 불러오지 못했습니다.');
          const retry = button('다시 확인', () => {});
          retry.id = prefix + 'ReadingResumeRetry';
          row.append(action(retry, refresh));
        }
      };
      const unsubscribeReading = readingPosition.subscribe(workspaceId, refresh);
      readingResumeCleanup = () => { stopped = true; sequence += 1; unsubscribeReading?.(); };
      readingResumePromise = refresh();
    }

    function openResult(mode, key, ref) {
      const returnContext = { workspaceId: state.bundle.workspaceId, mode, focusKey: key, sourceVersionId: ref.sourceVersionId, scrollY: global.scrollY };
      return navigate('source', { sourceId: ref.sourceId, sourceVersionId: ref.sourceVersionId, locator: ref.locator || null, suppressReaderResume: mode === 'sources' && !!state.sourcesSearch.trim() && !ref.locator, returnContext });
    }

    async function returnToResults() {
      const context = state.returnContext;
      if (!context || context.workspaceId !== state.bundle.workspaceId) return navigate('sources', { returnContext: null });
      await navigate(context.mode, { returnContext: null, sourcesRevealVersionId: context.mode === 'sources' ? context.sourceVersionId || null : null });
      const restore = () => requestAnimationFrame(() => {
        if (disposed || state.bundle?.workspaceId !== context.workspaceId || state.mode !== context.mode) return;
        const target = Array.from(main.querySelectorAll('[data-focus-key]')).find(el => el.dataset.focusKey === context.focusKey) ||
          (context.mode === 'sources' && Array.from(main.querySelectorAll('.life-source-open')).find(el => el.dataset.versionId === context.sourceVersionId)) || main.querySelector('#lifeSearch,h1,h2');
        const panel = target?.closest('[data-result-panel]');
        let ancestor = target?.parentElement;
        while (ancestor && ancestor !== main) { if (ancestor.tagName === 'DETAILS') ancestor.open = true; ancestor = ancestor.parentElement; }
        if (panel?.hidden) Array.from(main.querySelectorAll('[aria-controls]')).find(el => el.getAttribute('aria-controls') === panel.id)?.click();
        target?.focus({ preventScroll: true });
        global.scrollTo({ top: context.scrollY, behavior: 'instant' });
      });
      if (context.focusKey === context.mode + ':reading-resume') {
        const pending = readingResumePromise;
        pending.then(() => { if (pending === readingResumePromise) restore(); });
      } else if (context.mode === 'home') {
        const pending = homeRenderPromise;
        pending.then(() => { if (pending === homeRenderPromise) restore(); });
      }
      else restore();
    }

    function searchReturnButton() {
      const labels = { home: '홈으로 돌아가기', activities: '묶음으로 돌아가기', page: '내 페이지로 돌아가기', discover: '다시 찾기로 돌아가기', related: '관련 기록으로 돌아가기', reflection: '회고로 돌아가기', books: '책으로 돌아가기' };
      const back = iconButton(labels[state.returnContext?.mode] || '검색 결과로 돌아가기', 'back', guarded(returnToResults));
      back.id = 'lifeSearchReturn';
      return back;
    }

    async function returnFromRelated() {
      const origin = relatedOrigin;
      if (!origin || origin.workspaceId !== state.bundle?.workspaceId) return navigate('sources', { returnContext: null });
      await navigate('source', { sourceId: origin.sourceId, sourceVersionId: origin.sourceVersionId,
        locator: origin.locator, returnContext: origin.returnContext, suppressReaderResume: false });
      requestAnimationFrame(() => {
        if (disposed || state.bundle?.workspaceId !== origin.workspaceId || state.mode !== 'source' || state.sourceVersionId !== origin.sourceVersionId) return;
        main.querySelector('#' + (origin.focusId || 'lifeReaderRelated'))?.focus({ preventScroll: true });
        global.scrollTo({ top: origin.scrollY, behavior: 'instant' });
      });
    }

    function excerptCard(record, { mode = 'topics', instanceId = '', sourceId = null } = {}) {
      const instanceKey = record.id + (instanceId ? '-' + instanceId : '');
      const card = node('article', null, 'life-card life-excerpt-card');
      card.dataset.recordId = record.id;
      card.append(node('blockquote', record.text, 'life-quote'));
      if (record.note) {
        const note = node('div', null, 'life-excerpt-note');
        note.append(global.HaedoLife.Icons.create('user', { size: 16 }), node('span', '내 메모', 'life-sr-only'), node('p', record.note, 'life-note'));
        card.append(note);
      }
      const footer = node('div', null, 'life-feed-footer');
      if (record.topic) footer.append(node('p', record.topic, 'life-tag life-excerpt-topic'));
      const actions = node('div', null, 'life-feed-actions');
      const firstRef = record.sourceRefs.find(ref => ref.sourceVersionId === instanceId) || record.sourceRefs.find(ref => ref.sourceId === sourceId) || record.sourceRefs[0];
      if (firstRef) {
        if (instanceId && firstRef.sourceVersionId !== instanceId) footer.append(node('p', '이전 버전에 저장한 문장', 'life-meta'));
        const firstSource = sourceFor(firstRef.sourceId);
        const firstLabel = firstSource ? sourceLabel(firstSource) : '출처 없음';
        const key = resultFocusKey(mode, instanceKey, 'primary');
        const open = iconButton((record.sourceRefs.length > 1 && !sourceId ? '첫 번째 원문에서 보기 · ' : '원문에서 보기 · ') + firstLabel, 'book', guarded(() => openResult(mode, key, firstRef)), 'life-excerpt-open');
        Object.assign(open.dataset, { sourceId: firstRef.sourceId, versionId: firstRef.sourceVersionId, focusKey: key });
        actions.append(open);
      }
      const sources = node('section', null, 'life-excerpt-sources');
      sources.id = 'lifeExcerptSources-' + instanceKey;
      sources.hidden = true;
      sources.dataset.resultPanel = 'sources';
      sources.setAttribute('aria-label', '발췌의 원문 출처');
      const infoLabel = '발췌 출처 정보' + (record.sourceRefs.length > 1 ? ' · ' + record.sourceRefs.length + '개' : '');
      const info = iconButton(infoLabel, 'info', () => {}, 'life-excerpt-info');
      disclosure(info, sources);
      actions.append(info);
      if (record.sourceRefs.length > 1) sources.append(node('p', '원문 출처 ' + record.sourceRefs.length + '개', 'life-meta'));
      const refs = node('ul', null, 'life-source-refs');
      refs.setAttribute('aria-label', '발췌의 원문 출처');
      record.sourceRefs.forEach((ref, index) => {
        const source = sourceFor(ref.sourceId);
        const label = source ? sourceLabel(source) : '출처 없음';
        const versions = state.bundle.sourceVersions.filter(version => version.sourceId === ref.sourceId);
        const version = versions.find(item => item.id === ref.sourceVersionId);
        const versionIndex = versions.findIndex(version => version.id === ref.sourceVersionId) + 1;
        const versionLabel = versionIndex ? '버전 ' + versionIndex + '/' + versions.length + (versionIndex < versions.length ? ' · 이전 버전' : '') : '요청한 버전 미확인';
        const row = node('li', null, 'life-source-ref');
        const key = resultFocusKey(mode, instanceKey, index);
        const open = button(label, guarded(() => openResult(mode, key, ref)), 'life-source-ref-open');
        open.setAttribute('aria-label', '이 출처의 원문에서 보기 · ' + label);
        Object.assign(open.dataset, { sourceId: ref.sourceId, versionId: ref.sourceVersionId, refIndex: String(index), focusKey: key });
        row.append(open, node('p', versionLabel, 'life-meta'));
        if (source && version) row.append(metadata(source, version, true));
        refs.append(row);
      });
      sources.append(refs);
      const manage = node('section', null, 'life-excerpt-manage');
      manage.id = 'lifeExcerptManage-' + instanceKey;
      manage.hidden = true;
      manage.setAttribute('aria-label', '발췌 관리');
      const management = iconButton('발췌 관리', 'settings', () => {}, 'life-excerpt-manage-toggle');
      disclosure(management, manage);
      actions.append(management);
      manage.append(node('p', '발췌를 제거해도 원문 사본은 유지됩니다.', 'life-help'));
      manage.append(button('발췌 제거', guarded(async () => {
        if (!global.confirm('이 발췌와 주제 연결을 제거할까요? 원문 사본은 그대로 보관됩니다.')) return;
        await commit({ put: {}, remove: { records: [record.id] } });
        render();
        main.querySelector('#lifeSearch')?.focus({ preventScroll: true });
        announce('발췌를 제거했습니다. 원문 사본은 이 브라우저에 보관됩니다.');
      })));
      footer.append(actions);
      card.append(footer, sources, manage);
      return card;
    }

    function searchCount() {
      const count = node('p', '', 'life-meta');
      count.id = 'lifeSearchCount';
      count.setAttribute('role', 'status');
      return count;
    }

    function sourceFeedCard(source, version) {
      const card = node('article', null, 'life-card life-source-card');
      const key = resultFocusKey('topics', source.id, 'original');
      const open = button(sourceLabel(source), guarded(() => openResult('topics', key, { sourceId: source.id, sourceVersionId: version.id })), 'life-source-open');
      open.dataset.focusKey = key;
      card.append(open);
      if (version.contentText) card.append(node('p', version.contentText.slice(0, 240), 'life-search-context'));
      card.append(node('p', sourceOrigin(source) + (version.coverage.status === 'full_text' ? '' : ' · ' + COVERAGE[version.coverage.status]), 'life-meta'));
      return card;
    }

    function renderTopics() {
      renderStages(main);
      const results = node('div', null, 'life-card-grid'); results.id = 'lifeSearchResults';
      const count = searchCount();
      const topics = node('div', null, 'life-topic-list');
      const filters = node('section', null, 'life-filter-panel');
      filters.id = 'lifeSearchFilters';
      filters.hidden = !state.topicsFiltersOpen;
      filters.setAttribute('aria-label', '주제 필터');
      const topicNames = Array.from(new Set(state.bundle.records.map(record => record.topic || ''))).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
      const topicSearch = field('주제 이름 찾기', 'search', 'lifeTopicSearch', state.topicFilterSearch);
      topicSearch.input.placeholder = '주제 이름 찾기';
      topicSearch.input.maxLength = 500;
      topicSearch.label.hidden = topicNames.length < 9 && !state.topicFilterSearch;
      const clearFilter = button('필터 해제', () => {
        state.topic = ''; state.topicUnassigned = false; state.topicFilterSearch = '';
        topicSearch.input.value = '';
        update();
        topics.querySelector('[data-topic-kind="all"]')?.focus({ preventScroll: true });
      });
      clearFilter.id = 'lifeTopicFilterClear';
      const reset = () => {
        state.topic = state.topicsSearch = state.topicFilterSearch = '';
        state.topicUnassigned = false;
        render();
        main.querySelector('#lifeSearch')?.focus({ preventScroll: true });
      };
      const update = () => {
        const activeTopic = topics.contains(document.activeElement) ? { kind: document.activeElement.dataset.topicKind, name: document.activeElement.dataset.topicName } : null;
        topics.replaceChildren();
        const searched = state.bundle.records.filter(record => matchingText([record.text, record.topic, record.note, ...record.sourceRefs.map(ref => sourceLabel(sourceFor(ref.sourceId) || {}))].join(' '), state.topicsSearch));
        const counts = new Map();
        searched.forEach(record => counts.set(record.topic || '', (counts.get(record.topic || '') || 0) + 1));
        const makeFilter = (label, kind, name, total, selected) => {
          const item = button(null, () => {
            state.topic = kind === 'named' ? name : '';
            state.topicUnassigned = kind === 'unassigned';
            update();
          });
          Object.assign(item.dataset, { topicKind: kind, topicName: name || '' });
          item.setAttribute('aria-pressed', String(selected));
          item.setAttribute('aria-label', label);
          item.setAttribute('aria-description', '현재 검색에 맞는 발췌 ' + total + '개');
          const badge = node('span', total, 'life-count');
          badge.setAttribute('aria-hidden', 'true');
          item.append(node('span', label), badge);
          topics.append(item);
        };
        makeFilter('모든 주제', 'all', '', searched.length, !state.topic && !state.topicUnassigned);
        makeFilter('주제 없음', 'unassigned', '', counts.get('') || 0, state.topicUnassigned);
        const matchedNames = topicNames.filter(name => matchingText(name, state.topicFilterSearch));
        matchedNames.forEach(name => makeFilter(['모든 주제', '주제 없음'].includes(name) ? '주제 이름: ' + name : name, 'named', name, counts.get(name) || 0, !state.topicUnassigned && state.topic === name));
        if (state.topicFilterSearch.trim() && !matchedNames.length) topics.append(node('p', '일치하는 주제 이름이 없습니다. 이름 검색을 지우거나 모든 주제를 선택하세요.', 'life-help'));
        clearFilter.hidden = !state.topic && !state.topicUnassigned && !state.topicFilterSearch;
        const records = searched.filter(record => state.topicUnassigned ? !record.topic : !state.topic || record.topic === state.topic);
        count.textContent = '발췌 ' + records.length + '개' + (state.topicUnassigned ? ' · 주제 없음' : state.topic ? ' · ' + state.topic : '');
        results.replaceChildren();
        records.forEach(record => results.append(excerptCard(record)));
        if (!records.length && !state.bundle.records.length && state.bundle.sources.length && !state.topic && !state.topicUnassigned) {
          const sources = state.bundle.sources.slice().reverse().map(source => ({ source, version: state.bundle.sourceVersions.filter(version => version.sourceId === source.id).at(-1) }))
            .filter(({ source, version }) => version && matchingText(sourceLabel(source) + ' ' + (version.contentText || ''), state.topicsSearch));
          count.textContent = '자료 ' + sources.length + '개';
          for (const { source, version } of sources) results.append(sourceFeedCard(source, version));
          if (!sources.length) results.append(empty('조건에 맞는 자료가 없습니다.'), button('검색·필터 초기화', reset));
        } else if (!records.length) {
          const box = node('div', null, 'life-empty-state');
          if (state.topicsSearch || state.topic || state.topicUnassigned) {
            box.append(empty('조건에 맞는 발췌가 없습니다. 검색과 주제 조건을 지워 다시 찾아보세요.'), button('검색·필터 초기화', reset));
          } else {
            box.append(empty('아직 모아 둔 발췌가 없습니다. 보관한 원문에서 필요한 구절을 선택해 모아보세요.'));
            box.append(button('원천 기록에서 발췌하기', guarded(() => navigate('sources'))), button('기록 가져오기', guarded(async () => {
              if (!state.stage || state.stage.state !== 'draft') newDraft();
              await navigate('import');
            })));
          }
          results.append(box);
        }
        if (activeTopic) Array.from(topics.querySelectorAll('button')).find(item => item.dataset.topicKind === activeTopic.kind && item.dataset.topicName === activeTopic.name)?.focus({ preventScroll: true });
      };
      let topicComposing = false;
      topicSearch.input.addEventListener('compositionstart', () => { topicComposing = true; });
      topicSearch.input.addEventListener('input', event => { if (!topicComposing && !event.isComposing) { state.topicFilterSearch = topicSearch.input.value; update(); } });
      topicSearch.input.addEventListener('compositionend', () => { topicComposing = false; state.topicFilterSearch = topicSearch.input.value; update(); });
      const bar = searchField(main, '문장·주제·출처 찾기', update, 'topicsSearch');
      filters.append(topicSearch.label, node('p', '개수는 현재 검색에 맞는 발췌입니다.', 'life-help'), topics, clearFilter);
      const filter = iconButton('검색 필터', 'filter', () => {});
      filter.id = 'lifeFilterToggle';
      disclosure(filter, filters, { onChange: open => { state.topicsFiltersOpen = open; } });
      bar.append(filter);
      main.append(filters, count, results);
      update();
    }

    function renderSources() {
      const heading = title('기록');
      heading.classList.add('life-sr-only');
      main.append(heading);
      renderStages(main);
      const list = node('div', null, 'life-card-grid'); list.id = 'lifeSearchResults';
      const importResult = node('div', null, 'life-actions');
      importResult.id = 'lifeImportResult';
      importResult.hidden = true;
      const count = searchCount();
      const origin = selectField('원천 필터', 'lifeOriginFilter', [['', '모든 원천'], ['writing', '내 글']].concat(ORIGINS), state.originFilter);
      const spacing = field('한글 띄어쓰기 무시', 'checkbox', 'lifeSearchSpacing', '');
      spacing.input.checked = state.ignoreKoreanSpacing;
      const more = button('자료 더 보기', () => {
        const start = list.children.length;
        state.sourcesLimit += SEARCH_PAGE_SIZE;
        update(true);
        list.children[start]?.querySelector('.life-source-open')?.focus({ preventScroll: true });
      });
      more.id = 'lifeSearchMore';
      const selectionBar = node('section', null, 'life-selection-bar');
      selectionBar.id = 'lifeSelectionBar';
      selectionBar.setAttribute('aria-label', '선택한 기록 정리');
      selectionBar.hidden = !state.selecting;
      const selectionDetails = node('details', null, 'life-selection-details');
      const selectionSummary = node('summary');
      const selectionSummaryText = node('span', '선택한 기록 0개');
      selectionSummary.append(selectionSummaryText, global.HaedoLife.Icons.create('chevron'));
      const selectionList = node('ul', null, 'life-selection-list');
      selectionDetails.append(selectionSummary, selectionList);
      const selectionStatus = node('p', null, 'life-meta');
      selectionStatus.id = 'lifeSelectionStatus';
      selectionStatus.setAttribute('role', 'status');
      const controls = arrangeActions(() => [...selectedVersions]);
      controls.append(iconButton('선택 모두 해제', 'close', () => { selectedVersions.clear(); update(); selectionSummary.focus(); }));
      const cancelSelection = button('선택 취소', () => {
        selectedVersions.clear(); state.selecting = false; render();
        recordSections.querySelector('#lifeSelectionToggle')?.focus({ preventScroll: true });
      });
      selectionBar.append(selectionDetails, selectionStatus, controls, cancelSelection);
      function updateSelection(matches) {
        if (!state.selecting) return;
        const visible = new Set(matches.map(hit => hit.sourceVersionId));
        const hiddenCount = [...selectedVersions].filter(id => !visible.has(id)).length;
        selectionSummaryText.textContent = '선택한 기록 ' + selectedVersions.size + '개';
        selectionStatus.textContent = selectedVersions.size ? (hiddenCount ? '현재 검색 결과 밖에서 선택한 기록 ' + hiddenCount + '개 포함' : '담을 곳에서 선택한 원문을 확인합니다.') : '정리할 기록을 선택해 주세요.';
        controls.querySelectorAll('.life-arrange-groups,.life-arrange-page,.life-arrange-reflection').forEach(control => { control.disabled = !selectedVersions.size; });
        selectionList.replaceChildren();
        selectedVersions.forEach(id => {
          const version = state.bundle.sourceVersions.find(item => item.id === id);
          const source = version && sourceFor(version.sourceId);
          const versions = source ? state.bundle.sourceVersions.filter(item => item.sourceId === source.id) : [];
          const row = node('li');
          row.append(node('span', source ? sourceLabel(source) + ' · 버전 ' + (versions.findIndex(item => item.id === id) + 1) + '/' + versions.length : '선택한 원문 없음'));
          row.append(iconButton('선택 해제 · ' + (source ? sourceLabel(source) : '없는 원문'), 'close', () => {
            selectedVersions.delete(id); update(); selectionSummary.focus({ preventScroll: true });
          }));
          selectionList.append(row);
        });
      }
      const update = (append = false) => {
        const query = state.sourcesSearch.trim();
        const windowKey = JSON.stringify([state.bundle.workspaceId, query, state.originFilter, state.ignoreKoreanSpacing]);
        if (state.sourcesWindowKey !== windowKey) {
          state.sourcesWindowKey = windowKey;
          state.sourcesLimit = SEARCH_PAGE_SIZE;
          append = false;
        }
        const start = append ? list.children.length : 0;
        if (!append) list.replaceChildren();
        const searchOptions = { ignoreKoreanSpacing: state.ignoreKoreanSpacing };
        const hits = core.searchSources(state.bundle, query, searchOptions);
        const byVersion = new Map(hits.map(hit => [hit.sourceVersionId, hit]));
        const matchingRecords = query ? state.bundle.records.filter(record => {
          const text = [record.text, record.topic, record.note].join('\n');
          return state.ignoreKoreanSpacing ? core.matchesSearchText(text, query, searchOptions) : matchingText(text, query);
        }) : state.bundle.records;
        // A note can match without the source text matching. Keep its exact version
        // and do not invent a source-text location for a user's own words.
        if (query) matchingRecords.forEach(record => record.sourceRefs.forEach(ref => {
          if (byVersion.has(ref.sourceVersionId)) return;
          const versions = state.bundle.sourceVersions.filter(version => version.sourceId === ref.sourceId);
          const index = versions.findIndex(version => version.id === ref.sourceVersionId);
          if (index < 0 || !sourceFor(ref.sourceId)) return;
          const hit = { sourceId: ref.sourceId, sourceVersionId: ref.sourceVersionId, matchedBy: 'note', versionIndex: index + 1, versionCount: versions.length };
          byVersion.set(ref.sourceVersionId, hit);
          hits.push(hit);
        }));
        const matches = hits.filter(hit => !state.originFilter || (state.originFilter === 'writing' ? isOwnWriting(sourceFor(hit.sourceId)) : sourceFor(hit.sourceId).origin === state.originFilter));
        const revealIndex = matches.findIndex(hit => hit.sourceVersionId === state.sourcesRevealVersionId);
        if (revealIndex >= state.sourcesLimit) state.sourcesLimit = Math.ceil((revealIndex + 1) / SEARCH_PAGE_SIZE) * SEARCH_PAGE_SIZE;
        state.sourcesRevealVersionId = null;
        const imported = state.importResult;
        importResult.replaceChildren();
        const visibleMatches = matches.slice(0, state.sourcesLimit);
        importResult.hidden = !imported || imported.workspaceId !== state.bundle.workspaceId || visibleMatches.some(hit => hit.sourceVersionId === imported.sourceVersionId);
        if (!importResult.hidden) {
          const source = sourceFor(imported.sourceId);
          const key = resultFocusKey('sources', 'import-result-' + imported.sourceVersionId);
          const open = button('보관한 원문 읽기', guarded(() => openResult('sources', key, imported)), 'life-primary');
          open.id = 'lifeImportResultOpen';
          open.dataset.focusKey = key;
          open.prepend(global.HaedoLife.Icons.create('book'));
          importResult.append(node('p', source ? sourceLabel(source) : '보관한 원문', 'life-meta'), open);
        }
        updateSelection(matches);
        count.textContent = '자료 ' + matches.length + '개' + (state.sourcesSearch.trim() ? ' · 일치한 버전별 결과' : ' · 최신 버전') + (state.originFilter ? ' · ' + originName(state.originFilter) : '') + (state.ignoreKoreanSpacing ? ' · 한글 띄어쓰기 무시' : '') + (matches.length > visibleMatches.length ? ' · ' + visibleMatches.length + '개 표시' : '');
        more.hidden = matches.length <= visibleMatches.length;
        visibleMatches.slice(start).forEach(hit => {
          const source = sourceFor(hit.sourceId);
          const version = state.bundle.sourceVersions.find(v => v.id === hit.sourceVersionId);
          const records = (query ? matchingRecords : state.bundle.records).filter(record => record.sourceRefs.some(ref =>
            query ? ref.sourceVersionId === version.id : ref.sourceId === source.id));
          const card = node('article', null, 'life-card life-source-card');
          Object.assign(card.dataset, { sourceId: source.id, versionId: version.id, matchedBy: hit.matchedBy });
          const key = resultFocusKey('sources', version.id);
          const open = button(sourceLabel(source), guarded(() => openResult('sources', key, hit)), 'life-source-open');
          open.setAttribute('aria-label', '자료 읽기: ' + sourceLabel(source));
          Object.assign(open.dataset, { focusKey: key, sourceId: source.id, versionId: version.id });
          const heading = node('h3', null, 'life-record-heading');
          if (state.selecting) {
            const choose = iconButton('기록 선택 · ' + sourceLabel(source) + ' · 버전 ' + hit.versionIndex + '/' + hit.versionCount, 'check', () => {
              if (selectedVersions.has(version.id)) selectedVersions.delete(version.id);
              else {
                if (selectedVersions.size >= global.HaedoLife.Workbench.LIMITS.parts) {
                  announce('한 번에 원문 ' + global.HaedoLife.Workbench.LIMITS.parts + '개까지 선택할 수 있습니다.');
                  return;
                }
                selectedVersions.add(version.id);
              }
              update();
              [...list.querySelectorAll('.life-source-select')].find(control => control.dataset.versionId === version.id)?.focus({ preventScroll: true });
            }, 'life-source-select');
            choose.dataset.versionId = version.id;
            choose.setAttribute('aria-pressed', String(selectedVersions.has(version.id)));
            card.dataset.selected = String(selectedVersions.has(version.id));
            heading.append(choose);
          }
          heading.append(open);
          card.append(heading);
          if (hit.locator) {
            card.dataset.locatorStart = String(hit.locator.start); card.dataset.locatorEnd = String(hit.locator.end);
            const context = node('p', null, 'life-search-context');
            const before = hit.snippet?.before || '', after = hit.snippet?.after || '';
            context.append(document.createTextNode((hit.locator.start > before.length ? '…' : '') + before), node('mark', hit.quote), document.createTextNode(after + (hit.locator.end + after.length < version.contentText.length ? '…' : '')));
            card.append(context);
          } else if (!query && !records.length && version.contentText) {
            card.append(node('p', version.contentText.slice(0, 180) + (version.contentText.length > 180 ? '…' : ''), 'life-search-context'));
          }
          const footer = node('div', null, 'life-feed-footer');
          const facts = [sourceOrigin(source)];
          if (version.coverage.status !== 'full_text') facts.push(({ partial: '본문 일부', link_only: '본문 미확보', unknown: '범위 미확인' })[version.coverage.status] || '범위 미확인');
          if (hit.versionIndex < hit.versionCount) facts.push('이전 버전');
          if (state.sourcesSearch.trim() && hit.matchedBy === 'title') facts.push('제목 일치');
          if (hit.matchedBy === 'note') facts.push('저장한 문장·메모 일치');
          footer.append(node('p', facts.join(' · '), 'life-meta life-source-meta'));
          const details = node('section', null, 'life-result-details');
          details.id = 'lifeResultDetails-' + version.id;
          details.hidden = true;
          details.setAttribute('aria-label', '자료 출처 정보');
          details.append(node('p', '버전 ' + hit.versionIndex + '/' + hit.versionCount + (hit.versionIndex === hit.versionCount ? '' : ' · 이전 버전'), 'life-meta'));
          if (state.sourcesSearch.trim() && hit.matchedBy === 'title') details.append(node('p', '제목에서 일치 · 본문에는 일치하는 구절 없음', 'life-meta'));
          details.append(metadata(source, version, true));
          const info = iconButton('자료 출처 정보 · ' + sourceLabel(source), 'info', () => {}, 'life-result-info');
          disclosure(info, details);
          footer.append(info);
          card.append(footer, details);
          if (records.length) {
            const notes = node('section', null, 'life-record-notes');
            notes.setAttribute('aria-label', '저장한 문장·메모');
            const more = node('details', null, 'life-record-more');
            more.append(node('summary', '문장·메모 ' + Math.max(0, records.length - 3) + '개 더 보기'));
            records.forEach((record, index) => {
              const item = excerptCard(record, { mode: 'sources', instanceId: version.id, sourceId: source.id });
              (index < 3 ? notes : more).append(item);
            });
            if (records.length > 3) notes.append(more);
            card.append(notes);
          }
          list.append(card);
        });
        if (!matches.length) list.append(empty(state.bundle.sources.length ? '조건에 맞는 자료가 없습니다.' : '아직 기록이 없습니다. 글을 쓰거나 다른 곳의 기록을 가져와 보세요.'));
      };
      const bar = searchField(main, '제목·본문·메모 찾기', update, 'sourcesSearch');
      const filters = node('section', null, 'life-filter-panel');
      filters.id = 'lifeSearchFilters';
      filters.hidden = !state.sourcesFiltersOpen;
      filters.setAttribute('aria-label', '원천 필터');
      filters.append(origin.label);
      filters.append(spacing.label);
      filters.append(button('저장한 문장 주제로 찾기', guarded(() => navigate('topics'))));
      const filter = iconButton('검색 필터', 'filter', () => {});
      filter.id = 'lifeFilterToggle';
      disclosure(filter, filters, { onChange: open => { state.sourcesFiltersOpen = open; } });
      bar.append(filter);
      origin.input.addEventListener('change', () => { state.originFilter = origin.input.value; update(); });
      spacing.input.addEventListener('change', () => { state.ignoreKoreanSpacing = spacing.input.checked; update(); });
      main.append(filters);
      main.append(importResult);
      renderReadingResume(main, 'sources');
      main.append(selectionBar, count, list, more);
      update();
    }

    function metadata(source, version, expanded = false) {
      const details = node(expanded ? 'section' : 'details', null, expanded ? 'life-source-details' : 'life-details');
      if (!expanded) details.append(node('summary', '출처와 포함 범위'));
      const authorRelation = { self: '내 기록', other: '다른 사람의 기록', unknown: '작성자 관계 미확인' };
      const lines = [sourceOrigin(source), '원문 작성: ' + (version.originalCreatedAt || '모름'), (isOwnWriting(source) ? '이 버전 저장: ' : '가져온 시각: ') + version.importedAt,
        '작성자: ' + (version.originalAuthor.label || '모름') + ' · ' + (authorRelation[version.originalAuthor.relation] || authorRelation.unknown),
        COVERAGE[version.coverage.status] || COVERAGE.unknown,
        '누락/미확인: ' + (version.coverage.omissions.length ? version.coverage.omissions.join(', ') : (isOwnWriting(source) ? '없음' : '별도 표시 없음 · 사진은 자동 수집하지 않음'))];
      lines.forEach(text => details.append(node('p', text, 'life-meta')));
      if (source.url) {
        const href = safeUrl(source.url);
        if (href) {
          const link = node('a', '원래 앱 또는 사이트 열기', 'life-external');
          link.href = href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          details.append(node('p', source.url, 'life-meta life-source-url'), link, node('p', '외부 출처는 연결이 필요하며 삭제·비공개 상태일 수 있습니다.', 'life-help'));
        }
      }
      return details;
    }

    function renderSource() {
      const suppressResume = state.suppressReaderResume;
      state.suppressReaderResume = false;
      state.sourceSelection = null;
      const source = sourceFor(state.sourceId);
      const versions = state.bundle.sourceVersions.filter(v => v.sourceId === state.sourceId);
      const version = state.sourceVersionId ? versions.find(v => v.id === state.sourceVersionId) : versions.slice(-1)[0];
      if (!source || !version) { main.append(title('요청한 원문 버전을 찾을 수 없습니다.'), node('p', '다른 버전으로 자동 전환하지 않았습니다. 최신 내용 확인 후 다시 찾아 주세요.', 'life-help'), state.returnContext ? searchReturnButton() : button('원천 기록으로 돌아가기', guarded(() => navigate('sources')))); state.locator = null; return; }
      state.sourceVersionId = version.id;
      const batch = currentBatch();
      if (batch && batch.items.some(item => item.result?.sourceVersionId === version.id)) {
        const back = button('파일 목록으로 돌아가기', guarded(() => navigate('batch'))); back.id = 'lifeBatchReturn'; main.append(back);
      }
      const article = node('article', null, 'life-reader');
      const tools = node('div', null, 'life-reader-tools');
      const back = state.returnContext ? searchReturnButton() : iconButton('기록으로 돌아가기', 'back', guarded(() => navigate('sources')));
      const info = iconButton('출처 정보', 'info', () => {});
      info.id = 'lifeSourceInfoToggle';
      const arrange = iconButton('이 원문 담기', 'link', () => {});
      arrange.id = 'lifeReaderArrange';
      const arrangePanel = node('section', null, 'life-reader-arrange');
      arrangePanel.id = 'lifeReaderArrangePanel';
      arrangePanel.setAttribute('aria-label', '읽던 원문 정리');
      arrangePanel.hidden = !state.readerArrangeOpen;
      arrangePanel.append(node('p', '현재 원문 버전을 담습니다.', 'life-meta'), arrangeActions(() => [version.id]));
      disclosure(arrange, arrangePanel, { onChange: open => { state.readerArrangeOpen = open; flushReadingPosition(); readerWatch?.suppress(); } });
      tools.append(back, arrange, info);
      if (isOwnWriting(source) && version.id === versions[versions.length - 1].id) {
        tools.append(iconButton('내 글 수정', 'edit', guarded(() => navigate('write', { writing: { sourceId: source.id, sourceVersionId: version.id } }))));
      }
      const heading = node('h1', sourceLabel(source), 'life-heading life-reader-heading');
      heading.tabIndex = -1;
      const versionIndex = versions.findIndex(item => item.id === version.id) + 1;
      article.append(tools, arrangePanel, heading,
        node('p', sourceOrigin(source) + ' · 원문 작성 ' + (version.originalCreatedAt || '미상'), 'life-reader-meta'),
        node('p', (COVERAGE[version.coverage.status] || COVERAGE.unknown) + ' · 버전 ' + versionIndex + '/' + versions.length + (versionIndex === versions.length ? '' : ' · 이전 버전'), 'life-reader-meta'));
      if (versions.length > 1) {
        const choices = selectField('원문 버전', 'lifeVersion', versions.map((v, index) => [v.id, '버전 ' + (index + 1) + ' · ' + dateLabel(v.importedAt) + ' 보관']), version.id);
        choices.label.classList.add('life-version-field');
        choices.input.addEventListener('change', guarded(() => navigate('source', { sourceVersionId: choices.input.value, locator: null })));
        article.append(choices.label);
      }
      const details = metadata(source, version, true);
      details.id = 'lifeSourceDetails';
      details.hidden = true;
      details.setAttribute('aria-label', '출처와 포함 범위');
      const setDetails = disclosure(info, details, { onChange: () => { flushReadingPosition(); readerWatch?.suppress(); } });
      const detailsHeading = node('div', null, 'life-panel-heading');
      detailsHeading.append(node('h3', '출처와 포함 범위'), iconButton('출처 정보 닫기', 'close', () => setDetails(false)));
      details.prepend(detailsHeading);
      if (source.origin === 'naver_blog') {
        const reimport = button('본문 추가·다시 가져오기', guarded(async () => {
          const workspaceId = state.bundle.workspaceId;
          // Keep any unfinished import and reading notes before creating a new draft.
          await persistDrafts();
          if (disposed || state.bundle.workspaceId !== workspaceId) return;
          await navigate('import', { reimport: { workspaceId, sourceId: source.id, sourceVersionId: version.id } });
        }));
        reimport.id = 'lifeSourceReimport';
        details.append(reimport);
      }
      article.append(details);
      const openRelated = focusId => guarded(async () => {
        const origin = { workspaceId: state.bundle.workspaceId, sourceId: source.id, sourceVersionId: version.id,
          locator: state.sourceSelection ? { ...state.sourceSelection } : null,
          scrollY: global.scrollY, returnContext: state.returnContext, focusId };
        // Do not overwrite the reader context if a failed draft flush blocks navigation.
        await navigate('related', { discovery: { workspaceId: origin.workspaceId, seedVersionId: version.id } });
        if (state.mode !== 'related' || state.bundle?.workspaceId !== origin.workspaceId) return;
        relatedOrigin = origin;
        renderHeader();
        global.scrollTo({ top: 0, behavior: 'instant' });
      });
      const related = button('함께 읽을 기록', openRelated('lifeReaderRelated'), 'life-reader-related');
      related.id = 'lifeReaderRelated';
      article.append(related);
      main.append(article);
      // A list's scroll belongs to its return context, not to a newly opened
      // original. Exact matches and this session's reader positions still win.
      if (!state.locator && (suppressResume || !state.readerPositions.has(version.id))) {
        global.scrollTo({ top: 0, behavior: 'instant' });
      }
      if (version.contentText === null || version.contentText === undefined) {
        article.append(empty('본문 미확보 · 링크만 보관했습니다. 원래 출처를 열거나 본문을 제공해 새 버전으로 보관할 수 있습니다.'));
        state.locator = null;
        return;
      }

      // Keep a single unchanged Text node: DOM offsets are the original UTF-16
      // positions, including CRLF, surrogate pairs and repeated sentences.
      const reader = node('div', null, 'life-source-text');
      reader.id = 'lifeSourceText';
      reader.tabIndex = 0;
      reader.setAttribute('role', 'document');
      reader.setAttribute('aria-label', '보관한 원문');
      const originalText = document.createTextNode(version.contentText);
      reader.append(originalText);
      article.append(reader);
      const relatedEnd = button('함께 읽을 기록', openRelated('lifeReaderRelatedEnd'), 'life-reader-related life-reader-related-end');
      relatedEnd.id = 'lifeReaderRelatedEnd';
      article.append(relatedEnd);
      const panel = node('section', null, 'life-excerpt-panel');
      panel.id = 'lifeExcerptPanel';
      panel.hidden = true;
      panel.setAttribute('aria-label', '발췌와 주제 연결');
      const quote = iconButton('발췌와 주제 연결', 'quote', () => {});
      quote.id = 'lifeExcerptToggle';
      tools.append(quote);
      const sourceDraft = state.sourceDrafts.get(version.id) || { topic: '', note: '' };
      const instruction = '원문에서 발췌할 구절을 선택하세요.';
      const picked = node('blockquote', instruction, 'life-selection');
      picked.id = 'lifeSelectedQuote';
      const topic = field('주제 (선택)', 'text', 'lifeSourceTopic', sourceDraft.topic);
      const note = field('연결 이유 또는 메모 (선택)', 'textarea', 'lifeSourceNote', sourceDraft.note);
      const saveExcerpt = button('선택 구절 모음에 추가', guarded(async () => {
        const range = state.sourceSelection;
        if (!range || range.start === range.end) throw new Error('먼저 원문에서 발췌할 구절을 선택해 주세요.');
        const prepared = { source, version, match: { kind: 'exact_duplicate', sourceId: source.id, sourceVersionId: version.id } };
        const changes = core.buildImportChanges(state.bundle, prepared, [{ start: range.start, end: range.end, topic: topic.input.value, note: note.input.value }]);
        state.readerPositions.set(version.id, { start: range.start, end: range.end, scrollY: readingScrollY });
        await commit(changes);
        state.sourceDrafts.delete(version.id);
        render();
        announce('모음에 반영됨 · 이 브라우저에 저장됨');
      }), 'life-primary');
      saveExcerpt.id = 'lifeSourceExcerptSave';
      saveExcerpt.disabled = true;
      let readingScrollY = global.scrollY;
      let selectionOrigin = 'dom';
      const savePosition = () => {
        state.readerPositions.set(version.id, { ...(state.sourceSelection || { start: 0, end: 0 }), scrollY: panel.hidden ? global.scrollY : readingScrollY });
      };
      const remember = (start, end) => {
        state.sourceSelection = { start, end };
        if (state.sourceDrafts.has(version.id)) state.sourceDrafts.get(version.id).range = { start, end };
        picked.textContent = start < end ? version.contentText.slice(start, end) : instruction;
        quote.dataset.hasSelection = String(start < end);
        saveExcerpt.disabled = start >= end;
        savePosition();
      };
      const capture = event => {
        if (!reader.isConnected || document.activeElement?.matches('input,textarea')) return;
        // A textarea selection leaves the document's earlier Range intact.
        // Keep the keyboard choice when opening/closing tools; only a fresh
        // interaction with the readable body makes that Range authoritative.
        if (selectionOrigin === 'keyboard' && !['pointerup', 'keyup'].includes(event?.type)) return;
        const selection = global.getSelection();
        if (!selection || selection.rangeCount !== 1) return;
        const range = selection.getRangeAt(0);
        if (!reader.contains(range.startContainer) || !reader.contains(range.endContainer)) return;
        const offset = (container, value) => container === originalText ? value : container === reader ? (value === 0 ? 0 : version.contentText.length) : null;
        const start = offset(range.startContainer, range.startOffset), end = offset(range.endContainer, range.endOffset);
        if (start === null || end === null) return;
        selectionOrigin = 'dom';
        remember(start, end);
      };
      const restoreSelection = locator => {
        readerWatch?.suppress();
        const start = Math.max(0, Math.min(version.contentText.length, locator.start));
        const end = Math.max(start, Math.min(version.contentText.length, locator.end));
        const range = document.createRange();
        range.setStart(originalText, start);
        range.setEnd(originalText, end);
        reader.focus({ preventScroll: true });
        const selection = global.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        remember(start, end);
        return range;
      };
      reader.addEventListener('pointerdown', () => { selectionOrigin = 'dom'; });
      reader.addEventListener('pointerup', capture);
      reader.addEventListener('keyup', capture);
      document.addEventListener('selectionchange', capture);
      global.addEventListener('scroll', savePosition, { passive: true });
      readerCleanup = () => {
        savePosition();
        readerWatch?.close();
        readerWatch = null;
        document.removeEventListener('selectionchange', capture);
        global.removeEventListener('scroll', savePosition);
      };
      const setPanel = disclosure(quote, panel, { onChange: open => {
        flushReadingPosition();
        readerWatch?.suppress();
        if (open) {
          capture();
          readingScrollY = global.scrollY;
          topic.input.focus({ preventScroll: true });
          panel.scrollIntoView({ block: 'start', behavior: 'instant' });
        } else {
          quote.focus({ preventScroll: true });
          global.scrollTo({ top: readingScrollY, behavior: 'instant' });
        }
      } });
      const panelHeading = node('div', null, 'life-panel-heading');
      panelHeading.append(node('h3', '발췌와 주제 연결'), iconButton('발췌 닫기', 'close', () => setPanel(false)));
      const editDraft = () => {
        sourceDraft.topic = topic.input.value;
        sourceDraft.note = note.input.value;
        sourceDraft.range = state.sourceSelection && { ...state.sourceSelection };
        state.sourceDrafts.set(version.id, sourceDraft);
        announce('메모 입력 중 · 아직 모음에 반영하지 않았습니다.');
      };
      topic.input.addEventListener('input', editDraft);
      note.input.addEventListener('input', editDraft);
      const keyboard = node('div', null, 'life-keyboard-selection');
      keyboard.id = 'lifeKeyboardSelection';
      keyboard.hidden = true;
      const keyboardReader = field('키보드로 원문 구절 선택', 'textarea', 'lifeSourceSelectionText', version.contentText);
      keyboardReader.input.readOnly = true;
      keyboardReader.input.spellcheck = false;
      keyboardReader.input.className = 'life-keyboard-text';
      const captureKeyboard = () => {
        if (!keyboardReader.input.isConnected) return;
        selectionOrigin = 'keyboard';
        remember(displayToRaw(version.contentText, keyboardReader.input.selectionStart), displayToRaw(version.contentText, keyboardReader.input.selectionEnd));
      };
      ['select', 'keyup', 'pointerup'].forEach(name => keyboardReader.input.addEventListener(name, captureKeyboard));
      keyboard.append(node('p', 'Shift + 화살표로 구절을 선택하세요. 원문 내용은 바뀌지 않습니다.', 'life-help'),
        button('첫 줄 선택', () => {
          keyboardReader.input.focus({ preventScroll: true });
          const lineEnd = keyboardReader.input.value.indexOf('\n');
          keyboardReader.input.setSelectionRange(0, lineEnd < 0 ? keyboardReader.input.value.length : lineEnd + 1);
          captureKeyboard();
        }), keyboardReader.label);
      const keyboardToggle = button('키보드로 구절 선택', () => {});
      disclosure(keyboardToggle, keyboard, { onChange: open => {
        if (!open) return;
        const range = state.sourceSelection || { start: 0, end: 0 };
        keyboardReader.input.focus({ preventScroll: true });
        keyboardReader.input.setSelectionRange(rawToDisplay(version.contentText, range.start), rawToDisplay(version.contentText, range.end));
      } });
      panel.append(panelHeading, picked, keyboardToggle, keyboard, topic.label, note.label, saveExcerpt);
      article.append(panel);
      const positionStatus = node('p', null, 'life-meta life-reading-position-status');
      positionStatus.id = 'lifeReadingPositionStatus';
      positionStatus.hidden = true;
      positionStatus.setAttribute('role', 'status');
      tools.after(positionStatus);
      readerWatch = readingPosition?.watchReader({ workspaceId: state.bundle.workspaceId, sourceId: source.id, sourceVersionId: version.id,
        reader, isReading: () => !disposed && reader.isConnected && state.mode === 'source' && panel.hidden && details.hidden && arrangePanel.hidden,
        onSaved: () => { if (reader.isConnected && !disposed) positionStatus.hidden = true; },
        onError: () => {
          if (!reader.isConnected || disposed) return;
          positionStatus.textContent = '읽기 위치를 보관하지 못했습니다. 원문과 발췌는 그대로 사용할 수 있습니다.';
          positionStatus.hidden = false;
        } });
      const locator = state.locator || (!suppressResume && state.readerPositions.get(version.id));
      if (locator) requestAnimationFrame(() => {
        if (!reader.isConnected) return;
        const range = restoreSelection(locator);
        if (locator.scrollY !== undefined) global.scrollTo({ top: locator.scrollY, behavior: 'instant' });
        else {
          const rect = range.getBoundingClientRect();
          global.scrollTo({ top: Math.max(0, global.scrollY + rect.top - global.innerHeight / 3), behavior: 'instant' });
        }
        readingScrollY = global.scrollY;
      });
      state.locator = null;
    }

    function draftExcerptList(parent) {
      const list = node('div', null, 'life-draft-excerpts');
      list.id = 'lifeDraftExcerpts';
      list.tabIndex = -1;
      list.setAttribute('role', 'region');
      list.setAttribute('aria-label', '발췌 후보 ' + state.stage.excerpts.length + '개');
      state.stage.excerpts.forEach((excerpt, index) => {
        const card = node('article', null, 'life-card');
        card.append(node('p', excerpt.topic || '주제 없음', 'life-tag'), node('blockquote', state.stage.input.text.slice(excerpt.start, excerpt.end), 'life-quote'));
        if (excerpt.note) card.append(node('p', excerpt.note));
        card.append(button('후보 제거', guarded(async () => {
          state.stage.excerpts.splice(index, 1);
          changedStage();
          await persistStage();
          render();
        })));
        list.append(card);
      });
      parent.append(list);
    }

    async function prepareStage() {
      if (state.stage.input.existingSourceId && !state.stage.input.text && state.importMethod !== 'link') {
        throw new Error('새 본문을 붙여 넣거나 파일을 선택해 주세요. 본문 없이 보관하려면 링크 보관을 선택해 주세요.');
      }
      const tick = state.editTick;
      const stageId = state.stage.stageId;
      await persistStage(true);
      if (state.stage.stageId !== stageId || state.editTick !== tick) throw new Error('입력이 바뀌었습니다. 현재 원문을 다시 확인해 주세요.');
      const snapshot = JSON.parse(JSON.stringify(state.stage.input));
      if (!snapshot.text) snapshot.coverage = { status: 'link_only', omissions: snapshot.omissions || snapshot.coverage && snapshot.coverage.omissions || [] };
      const prepared = await core.prepareImport(snapshot, state.bundle);
      if (!state.stage || state.stage.stageId !== stageId || state.editTick !== tick) throw new Error('입력이 바뀌어 이전 확인 결과를 적용하지 않았습니다. 다시 확인해 주세요.');
      state.prepared = prepared;
      render();
      const heading = main.querySelector('h2');
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: 'start', behavior: 'instant' });
      announce('원문과 출처를 확인해 주세요. 아직 자료나 모음에 반영하지 않았습니다.');
    }

    function renderImport() {
      if (!state.stage || state.stage.state !== 'draft') newDraft();
      const input = state.stage.input;
      const linkedSource = input.existingSourceId && sourceFor(input.existingSourceId);
      const linkedNotice = node('p', '', 'life-help');
      linkedNotice.id = 'lifeImportExistingSource';
      const updateLinkNotice = () => {
        linkedNotice.hidden = !linkedSource;
        linkedNotice.textContent = input.existingSourceId
          ? '보관한 자료의 새 본문을 검토합니다. 기존 버전은 그대로 남습니다.'
          : '출처가 바뀌어 기존 자료 연결을 해제했습니다. 검토에서 같은 자료인지 다시 확인해 주세요.';
      };
      updateLinkNotice();
      if (validBatchStage(state.stage)) {
        state.batchId = state.stage.batchId;
        const back = button('파일 목록으로 돌아가기', guarded(() => navigate('batch'))); back.id = 'lifeBatchReturn'; main.append(back, node('p', '현재 검토: ' + (state.stage.fileLabel || input.fileName), 'life-help'));
        const item = currentBatch()?.items.find(row => row.stageId === state.stage.stageId);
        if (item && !item.unsaved) main.append(button('건너뛰기 · 초안 유지', guarded(() => skipBatchItem(item))));
      }
      main.append(title(state.prepared ? '원문·출처 검토' : linkedSource ? '보관한 글에 본문 추가' : '선택한 기록 가져오기'));
      const phase = node('p', state.prepared ? '확인 후 보관 · 아직 자료에 반영하지 않았습니다.' : '본문·텍스트 파일·링크를 선택해 검토합니다.', 'life-import-phase');
      phase.id = 'lifeImportPhase';
      main.append(phase);
      const form = node('form', null, 'life-import-form');
      form.id = 'lifeImportForm';
      form.hidden = !!state.prepared;
      form.addEventListener('submit', event => event.preventDefault());
      const origin = selectField('원천', 'lifeImportOrigin', ORIGINS, input.origin || 'apple_notes');
      const name = field('제목 (선택)', 'text', 'lifeImportTitle', input.title);
      const url = field('원문 링크 (선택)', 'url', 'lifeImportUrl', input.url);
      url.input.placeholder = 'https://';
      url.input.autocapitalize = 'none';
      url.input.spellcheck = false;
      const suggestion = node('div', null, 'life-origin-suggestion');
      suggestion.id = 'lifeImportOriginSuggestion';
      const suggestionText = node('span', '', 'life-help');
      suggestionText.setAttribute('role', 'status');
      const acceptOrigin = button('', () => {
        if (state.busy) return;
        const value = suggestedWebOrigin(input.url);
        if (!value) return;
        input.origin = origin.input.value = value;
        delete input.existingSourceId;
        delete input.forceSeparate;
        updateLinkNotice();
        changedStage();
        updateWebFields();
        origin.input.focus({ preventScroll: true });
      });
      suggestion.append(suggestionText, acceptOrigin);
      const body = field('가져온 본문', 'textarea', 'lifeImportText', input.text);
      body.input.rows = 10;
      body.input.spellcheck = false;
      const file = field(validBatchStage(state.stage) ? '현재 검토의 본문을 파일로 교체 (1 MiB까지)' : 'UTF-8 .txt 또는 .md 파일 (1 MiB까지)', 'file', 'lifeImportFile', '');
      file.input.accept = '.txt,.md,text/plain,text/markdown';
      file.input.addEventListener('change', guarded(async () => {
        const selected = file.input.files[0];
        if (!selected) return;
        if (validBatchStage(state.stage) && !global.confirm('현재 검토 파일의 본문을 바꿀까요? 다른 파일 초안은 그대로 유지됩니다.')) return;
        if (!/\.(txt|md)$/i.test(selected.name)) throw new Error('UTF-8 .txt 또는 .md 파일을 선택해 주세요.');
        if (selected.size > MAX_TEXT_BYTES) throw new Error('파일이 1 MiB를 넘습니다. 필요한 부분을 선택해 나누어 제공해 주세요.');
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(await selected.arrayBuffer()); }
        catch (_) { throw new Error('UTF-8로 읽을 수 없는 파일입니다. 원래 파일은 변경하지 않았습니다.'); }
        if (input.fileName !== selected.name) {
          delete input.existingSourceId;
          delete input.forceSeparate;
          updateLinkNotice();
        }
        replaceDraftText(text);
        input.fileName = selected.name;
        input.format = /\.md$/i.test(selected.name) ? 'text/markdown' : 'text/plain';
        body.input.value = text;
        changedStage();
        await persistStage();
        setMethod('text');
        if (body.input.isConnected) methodButtons.get('text').focus();
      }));
      const methods = node('div', null, 'life-import-methods');
      methods.setAttribute('role', 'group');
      methods.setAttribute('aria-label', '가져오기 방식');
      const textPanel = node('div', null, 'life-import-input');
      textPanel.id = 'lifeImportTextPanel';
      textPanel.append(body.label);
      const filePanel = node('div', null, 'life-import-input');
      filePanel.id = 'lifeImportFilePanel';
      filePanel.append(file.label);
      renderBatchPicker(filePanel);
      const linkHelp = node('p', '링크만으로 원문을 가져오지 않습니다. 본문을 제공하지 않으면 링크만 보관합니다.', 'life-help');
      const retained = node('div', null, 'life-retained-input');
      const retainedText = node('p', '', 'life-help');
      retained.append(retainedText, button('본문 확인', () => { setMethod('text'); body.input.focus(); }));
      const methodButtons = new Map();
      let updateWebFields = () => {};
      const setMethod = method => {
        state.importMethod = method;
        textPanel.hidden = method !== 'text';
        filePanel.hidden = method !== 'file';
        linkHelp.hidden = method !== 'link';
        retained.hidden = method === 'text' || !input.text;
        retainedText.textContent = '기존 본문 ' + (input.text || '').length.toLocaleString('ko-KR') + '자도 함께 보관됩니다. 방식만 바꾸어도 입력한 내용은 유지됩니다.';
        for (const [key, control] of methodButtons) control.setAttribute('aria-pressed', String(key === method));
        updateWebFields();
      };
      [['text', '본문 붙여넣기', 'Text'], ['file', '텍스트 파일', 'File'], ['link', '링크 보관', 'Link']].forEach(([key, label, suffix]) => {
        const method = button(label, () => { if (!state.busy) setMethod(key); });
        method.id = 'lifeImportMethod' + suffix;
        methodButtons.set(key, method);
        methods.append(method);
      });
      const details = node('details', null, 'life-details');
      const detailsSummary = node('summary', '출처 상세·포함 범위 (선택)');
      details.append(detailsSummary);
      const author = field('원문 작성자 (모르면 비워 두기)', 'text', 'lifeImportAuthor', input.author);
      const relation = selectField('작성자 관계', 'lifeImportRelation', [['unknown', '미확인'], ['self', '내 기록 / 내 게시물'], ['other', '다른 사람의 기록 / 내가 저장한 게시물']], input.authorRelation || 'unknown');
      const originalDate = field('원문 작성일 (모르면 비워 두기)', 'date', 'lifeImportDate', input.originalCreatedAt);
      // Existing dates may be free text; never hide a value the native date input rejects.
      if (input.originalCreatedAt && originalDate.input.value !== input.originalCreatedAt) {
        originalDate.input.type = 'text';
        originalDate.input.value = input.originalCreatedAt;
      }
      const coverage = selectField('포함한 본문 범위', 'lifeImportCoverage', [['unknown', '미확인'], ['partial', '선택한 본문 일부'], ['full_text', '제공한 본문 전체']], input.coverage && input.coverage.status === 'link_only' ? 'unknown' : input.coverage && input.coverage.status || 'unknown');
      const omissions = field('누락·미확인 항목 (선택)', 'text', 'lifeImportOmissions', (input.omissions || input.coverage && input.coverage.omissions || []).join(', '));
      omissions.input.placeholder = '예: 사진 미보관, 댓글 미포함';
      details.append(author.label, relation.label, originalDate.label, coverage.label, omissions.label);
      const webHelp = node('details', null, 'life-details');
      webHelp.id = 'lifeImportWebHelp';
      webHelp.append(node('summary', '글·출처 가져오는 방법'));
      const webSteps = node('ol', null, 'life-help');
      const copyBodyStep = node('li');
      webSteps.append(node('li', '원래 게시물에서 링크를 복사해 위에 붙여 넣습니다.'), copyBodyStep,
        node('li', '복사할 수 없다면 링크만 보관하고, 나중에 본문을 추가할 수 있습니다.'));
      webHelp.append(webSteps);
      const webNotice = node('p', '', 'life-help');
      webNotice.id = 'lifeImportWebNotice';
      const webScope = node('div');
      webScope.id = 'lifeImportWebScope';
      updateWebFields = () => {
        const suggested = suggestedWebOrigin(input.url);
        const offer = suggested && suggested !== input.origin;
        suggestion.hidden = !offer;
        if (offer) {
          const label = originName(suggested);
          if (suggestionText.textContent !== label + ' 링크') suggestionText.textContent = label + ' 링크';
          acceptOrigin.textContent = label + (suggested === 'naver_blog' ? '로 설정' : '으로 설정');
        } else suggestionText.textContent = '';
        const social = isWebOrigin(input.origin);
        webHelp.hidden = webNotice.hidden = !social;
        webScope.hidden = !social || !input.text;
        linkHelp.hidden = state.importMethod !== 'link' || social;
        if (social) {
          if (coverage.label.parentNode !== webScope) webScope.append(coverage.label);
          copyBodyStep.textContent = input.origin === 'instagram'
            ? '복사할 수 있는 캡션을 선택해 본문에 붙여 넣습니다. 앱에서 선택되지 않으면 브라우저에서 열어 확인합니다.'
            : '필요한 글 본문을 선택해 복사한 뒤 본문에 붙여 넣습니다.';
          webNotice.textContent = input.text
            ? '제공한 글·캡션만 보관합니다. 사진·영상은 포함되지 않습니다.'
            : '링크만으로 본문·사진·영상을 가져오지 않습니다.';
          detailsSummary.textContent = '작성자·날짜·누락 항목 (선택)';
        } else {
          if (coverage.label.parentNode !== details) details.insertBefore(coverage.label, omissions.label);
          detailsSummary.textContent = '출처 상세·포함 범위 (선택)';
        }
      };
      setMethod(state.importMethod);
      const bindings = [[origin.input, 'origin'], [name.input, 'title'], [url.input, 'url'], [body.input, 'text'], [author.input, 'author'], [relation.input, 'authorRelation'], [originalDate.input, 'originalCreatedAt']];
      bindings.forEach(([element, key]) => element.addEventListener('input', () => {
        const identityChanged = ['origin', 'url'].includes(key) && input[key] !== element.value;
        if (key === 'text') replaceDraftText(element.value);
        else input[key] = element.value;
        if (identityChanged) delete input.existingSourceId;
        delete input.forceSeparate;
        updateLinkNotice();
        changedStage();
        if (['origin', 'url', 'text'].includes(key)) updateWebFields();
      }));
      coverage.input.addEventListener('change', () => { input.coverage = { status: coverage.input.value, omissions: input.omissions || [] }; changedStage(); });
      omissions.input.addEventListener('input', () => { input.omissions = omissions.input.value.split(',').map(x => x.trim()).filter(Boolean); input.coverage = { status: coverage.input.value, omissions: input.omissions }; changedStage(); });
      const actions = node('div', null, 'life-actions');
      actions.append(button('원문·출처 확인', guarded(prepareStage), 'life-primary'), button('검토 내용 보관', guarded(() => persistStage(true))), button('다른 기록 가져오기', guarded(async () => {
        if (dirty()) await persistStage();
        newDraft();
        render();
      })));
      // Reimport starts with the only new input; already known metadata remains editable below.
      if (linkedSource) form.append(linkedNotice, methods, textPanel, filePanel, linkHelp, retained, webNotice, webScope, url.label, suggestion, origin.label, name.label, details, actions, webHelp);
      else if (currentChapterImport()) form.append(methods, textPanel, filePanel, linkHelp, retained, webNotice, webScope, name.label, url.label, suggestion, origin.label, details, actions, webHelp);
      else form.append(methods, url.label, suggestion, origin.label, name.label, textPanel, filePanel, linkHelp, retained, webNotice, webScope, details, actions, webHelp);
      if (state.stageFailed) form.append(button('새 검토 사본으로 보관', guarded(rescueStage)));
      if (state.stage.invalidatedExcerpts && state.stage.invalidatedExcerpts.length) {
        const invalid = node('details', null, 'life-details');
        invalid.append(node('summary', '원문 변경으로 해제한 발췌 · 다시 선택 필요'));
        state.stage.invalidatedExcerpts.forEach(excerpt => {
          const card = node('div', null, 'life-card');
          card.append(node('blockquote', excerpt.text, 'life-quote'), node('p', excerpt.topic || '주제 없음', 'life-meta'));
          if (excerpt.note) card.append(node('p', excerpt.note, 'life-note'));
          invalid.append(card);
        });
        form.append(node('p', '본문이 바뀌어 기존 발췌 후보를 해제했습니다. 이전 문장·보완 메모는 아래에 남겼습니다. 새 원문에서 다시 선택해 주세요.', 'life-help'), invalid);
      }
      main.append(form);
      if (state.prepared) {
        const edit = button('입력 수정', guarded(() => {
          state.prepared = null;
          state.stageSelection = null;
          render();
          main.querySelector('#lifeImportTitle')?.focus();
        }));
        edit.id = 'lifeImportEdit';
        main.append(edit);
        renderPrepared();
      }
      const cancel = button('이 검토 취소', guarded(async () => {
        if (!global.confirm('아직 적용하지 않은 검토 내용을 삭제할까요? 이미 보관한 자료는 그대로 유지됩니다.')) return;
        if (stageTimer) clearTimeout(stageTimer);
        await saveChain.catch(() => {});
        await storage.deleteStage(state.stage.stageId);
        state.stage = null;
        state.prepared = null;
        state.editTick = state.savedTick = 0;
        await refreshData();
        await navigate('sources');
        announce('미적용 검토만 취소했습니다. 보관한 자료는 그대로 유지됩니다.');
      }));
      cancel.classList.add('life-review-cancel');
      main.append(cancel);
    }

    function renderPrepared() {
      const prepared = state.prepared;
      const section = node('section', null, 'life-review');
      section.append(node('h3', sourceLabel(prepared.source), 'life-review-title'),
        node('p', originName(prepared.source.origin) + ' · ' + (COVERAGE[prepared.version.coverage.status] || COVERAGE.unknown), 'life-meta'),
        metadata(prepared.source, prepared.version));
      if (isWebOrigin(prepared.source.origin)) {
        const notice = node('p', prepared.version.contentText === null
          ? '링크만 보관합니다. 본문·사진·영상은 가져오지 않았습니다.'
          : '제공한 글·캡션만 보관합니다. 사진·영상은 포함되지 않습니다.', 'life-help');
        notice.id = 'lifeReviewWebNotice';
        section.append(notice);
      }
      let unresolved = prepared.match.kind === 'overlap' && !state.stage.input.forceSeparate && !state.stage.input.existingSourceId;
      if (unresolved) {
        const prior = sourceFor(prepared.match.sourceId);
        const box = node('div', null, 'life-match');
        box.append(node('h4', '이미 보관한 자료와 겹칠 수 있습니다.'), node('p', prior ? sourceLabel(prior) : '같은 본문이나 링크의 후보가 있습니다.'));
        box.append(button('같은 자료로 확인 · 버전 비교', guarded(async () => {
          state.stage.input.existingSourceId = prepared.match.sourceId;
          delete state.stage.input.forceSeparate;
          state.editTick += 1;
          await prepareStage();
        })), button('별개 자료로 보관', guarded(async () => {
          state.stage.input.forceSeparate = true;
          delete state.stage.input.existingSourceId;
          state.editTick += 1;
          await prepareStage();
        })));
        section.append(box);
      } else if (prepared.match.kind === 'exact_duplicate') {
        section.append(node('p', '기존 자료와 내용·출처가 같습니다. 같은 원문 버전을 재사용하며 발췌는 선택한 주제로 연결합니다.', 'life-help'));
      } else if (prepared.match.kind === 'new_revision') {
        section.append(node('p', '같은 자료의 새 버전으로 보관합니다. 이전 원문 버전은 그대로 유지됩니다.', 'life-help'));
      }
      if (prepared.version.contentText != null) {
        const reader = field('확인할 원문 · 구절 선택', 'textarea', 'lifeReviewText', prepared.version.contentText);
        reader.input.readOnly = true;
        reader.input.className = 'life-source-text';
        const selectionInstruction = '필요한 구절을 선택해 발췌 후보로 추가할 수 있습니다.';
        const selected = node('p', selectionInstruction, 'life-selection');
        state.stageSelection = null;
        const capture = () => {
          // Moving to a note or action must not replace the last intentional
          // source choice with a textarea selection collapsed by focus loss.
          if (document.activeElement !== reader.input && document.activeElement?.matches('input,textarea,select,button')) return;
          state.stageSelection = { start: displayToRaw(prepared.version.contentText, reader.input.selectionStart), end: displayToRaw(prepared.version.contentText, reader.input.selectionEnd) };
          const hasSelection = state.stageSelection.start < state.stageSelection.end;
          selected.textContent = hasSelection ? prepared.version.contentText.slice(state.stageSelection.start, state.stageSelection.end) : selectionInstruction;
          add.disabled = !hasSelection;
        };
        reader.input.addEventListener('select', capture);
        reader.input.addEventListener('keyup', capture);
        reader.input.addEventListener('pointerup', capture);
        const topic = field('주제 (선택)', 'text', 'lifeExcerptTopic', state.stage.draftTopic || '');
        const note = field('연결 이유 또는 메모 (선택)', 'textarea', 'lifeExcerptNote', state.stage.draftNote || '');
        const keepNote = () => {
          state.stage.draftTopic = topic.input.value;
          state.stage.draftNote = note.input.value;
          announce('입력 중 · 주제와 메모는 아직 보관하지 않았습니다.');
          state.editTick += 1;
          if (stageTimer) clearTimeout(stageTimer);
          if (!state.stageFailed) stageTimer = setTimeout(() => persistStage().catch(failure), 400);
        };
        topic.input.addEventListener('input', keepNote);
        note.input.addEventListener('input', keepNote);
        const add = button('발췌 후보 추가', guarded(async () => {
          const range = state.stageSelection;
          if (!range || range.start === range.end) throw new Error('원문에서 구절을 먼저 선택해 주세요.');
          state.stage.excerpts.push({ start: range.start, end: range.end, topic: topic.input.value, note: note.input.value });
          state.stage.draftTopic = state.stage.draftNote = '';
          state.editTick += 1;
          await persistStage();
          render();
          const candidates = main.querySelector('#lifeDraftExcerpts');
          candidates?.focus({ preventScroll: true });
          candidates?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        }));
        add.disabled = true;
        section.append(reader.label, selected, topic.label, note.label, add);
        draftExcerptList(section);
      } else section.append(empty('본문 미확보 · 링크만 보관합니다. 본문을 읽거나 요약했다고 표시하지 않습니다.'));
      const controls = node('div', null, 'life-actions');
      const apply = async excerpts => {
        const tick = state.editTick;
        const snapshot = JSON.parse(JSON.stringify(state.stage));
        const selected = JSON.parse(JSON.stringify(excerpts));
        await persistStage(true);
        if (!state.stage || state.stage.stageId !== snapshot.stageId || state.editTick !== tick) throw new Error('입력이 바뀌었습니다. 선택한 원문을 다시 확인해 주세요.');
        snapshot.revision = state.stage.revision;
        if (!snapshot.input.text) snapshot.input.coverage = { status: 'link_only', omissions: snapshot.input.omissions || snapshot.input.coverage && snapshot.input.coverage.omissions || [] };
        const fresh = await core.prepareImport(snapshot.input, state.bundle);
        if (!state.stage || state.stage.stageId !== snapshot.stageId || state.editTick !== tick) throw new Error('입력이 바뀌어 적용하지 않았습니다. 원문·발췌를 다시 확인해 주세요.');
        if (fresh.match.kind === 'overlap' && !snapshot.input.forceSeparate && !snapshot.input.existingSourceId) throw new Error('겹치는 자료를 비교해 같은 자료인지 별개 자료인지 먼저 선택해 주세요.');
        const changes = core.buildImportChanges(state.bundle, fresh, selected);
        const chapterContext = chapterImport;
        let confirmed = false;
        try {
          await commit(changes, snapshot, (validBatchStage(snapshot) || currentChapterImport(chapterContext))
            ? { sourceId: fresh.source.id, sourceVersionId: fresh.version.id } : undefined, () => {
            if (!currentChapterImport(chapterContext) || snapshot.workspaceId !== chapterContext.workspaceId) return;
            confirmed = true;
            if (!chapterContext.versionIds.includes(fresh.version.id)) chapterContext.versionIds.push(fresh.version.id);
            // The source transaction already committed. A failed subsequent read must not replay it.
            state.stage = state.prepared = null;
            state.savedTick = state.editTick = 0;
          });
        } catch (cause) {
          if (confirmed && currentChapterImport(chapterContext)) {
            render();
            announce('자료는 보관했습니다. 목록을 다시 불러온 뒤 장에 연결할 글을 확인해 주세요.');
          }
          throw cause;
        }
        if (disposed || state.bundle?.workspaceId !== snapshot.workspaceId) return;
        if (!disposed && state.bundle?.workspaceId === snapshot.workspaceId && !validBatchStage(snapshot) && selected.length) state.importResult = {
          workspaceId: snapshot.workspaceId, sourceId: fresh.source.id, sourceVersionId: fresh.version.id,
          locator: { start: selected[0].start, end: selected[0].end }
        };
        const retained = fresh.source.id;
        state.stage = null;
        state.prepared = null;
        state.savedTick = state.editTick = 0;
        if (validBatchStage(snapshot)) { state.batchId = snapshot.batchId; await navigate('batch'); }
        else if (currentChapterImport(chapterContext)) { await returnToChapterImport(); return; }
        else if (excerpts.length) await navigate('sources');
        else await navigate('source', { sourceId: retained, sourceVersionId: fresh.version.id, locator: null });
        announce((excerpts.length ? '모음에 반영됨' : '자료 보관됨') + ' · 이 브라우저에 저장됨');
      };
      const storeOnly = button('자료만 보관', guarded(() => apply([])));
      if (!state.stage.excerpts.length) storeOnly.classList.add('life-primary');
      storeOnly.disabled = unresolved;
      controls.append(storeOnly);
      if (state.stage.excerpts.length) {
        const applyAll = button('선택한 발췌 모음에 반영', guarded(() => apply(state.stage.excerpts.slice())), 'life-primary');
        applyAll.disabled = unresolved;
        controls.append(applyAll);
      }
      const confirmation = node('section', null, 'life-review-confirm');
      confirmation.append(node('h3', '보관할 내용'), node('p', prepared.version.contentText == null ? '링크 1개 · 본문 미확보' : '자료 1개 · 발췌 후보 ' + state.stage.excerpts.length + '개', 'life-meta'));
      if (state.stage.excerpts.length) confirmation.append(node('p', '자료만 보관하면 발췌 후보는 모음에 넣지 않습니다.', 'life-help'));
      confirmation.append(controls);
      section.append(confirmation);
      main.append(section);
    }

    function download(text, name, type) {
      if (disposed) return;
      const url = URL.createObjectURL(new Blob([text], { type }));
      downloadUrls.add(url);
      const link = node('a');
      link.href = url;
      link.download = name;
      root.append(link);
      link.click();
      link.remove();
      setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 60000);
      announce('파일을 만들었습니다. 파일 앱 또는 다운로드에서 저장 위치와 내용을 확인해 주세요.');
    }

    function backupContents(bundle) {
      const details = node('details', null, 'life-details life-backup-contents');
      details.append(node('summary', '백업에 담긴 원문 확인'));
      if (!bundle.sources.length) details.append(empty('보관된 원문이 없는 작업공간입니다.'));
      bundle.sources.forEach(source => {
        const row = node('div', null, 'life-backup-source');
        const versions = bundle.sourceVersions.filter(version => version.sourceId === source.id);
        row.append(node('strong', sourceLabel(source)), node('p', sourceOrigin(source) + ' · 원문 버전 ' + versions.length + '개', 'life-meta'));
        const coverage = [...new Set(versions.map(version => COVERAGE[version.coverage.status] || COVERAGE.unknown))];
        row.append(node('p', coverage.join(' · '), 'life-meta'));
        details.append(row);
      });
      return details;
    }

    function renderRestoreResult() {
      const receipt = state.restoreReturn;
      if (!receipt || receipt.copyId !== state.bundle.workspaceId) return;
      const panel = node('section', null, 'life-restore-result');
      panel.id = 'lifeRestoreResult';
      panel.setAttribute('aria-label', '복원 결과');
      const heading = node('h3', '새 사본을 열었습니다.');
      heading.tabIndex = -1;
      const top = node('div', null, 'life-panel-heading');
      top.append(heading, iconButton('복원 안내 닫기', 'close', guarded(() => {
        state.restoreReturn = null;
        panel.remove();
        toolbar.querySelector('h1')?.focus({ preventScroll: true });
      })));
      panel.append(top, node('p', '이전 작업공간은 그대로 남아 있습니다. 이 사본의 자동 동기화는 연결하지 않았습니다.', 'life-help'));
      panel.append(button('이전 작업공간으로 돌아가기', guarded(async () => {
        await persistDrafts();
        const previous = await storage.read(receipt.previousId);
        if (disposed) return;
        await storage.setActive(previous.workspaceId);
        if (disposed) return;
        invalidateBatchContext();
        state.bundle = previous;
        state.stage = state.prepared = null;
        state.sourceDrafts.clear();
        state.stages = [];
        state.allStages = [];
        state.restoreReturn = null;
        state.mode = 'sources';
        connectSubscription();
        render();
        global.scrollTo({ top: 0, behavior: 'instant' });
        toolbar.querySelector('h1')?.focus({ preventScroll: true });
        announce('이전 작업공간을 열었습니다. 복원한 사본도 그대로 보관됩니다.');
        try { await refreshData(); render(); }
        catch (_) { throw new Error('이전 작업공간을 열었고 복원 사본도 보관돼 있습니다. 목록 갱신에 실패했으니 관리에서 다시 확인해 주세요.'); }
        finally { toolbar.querySelector('h1')?.focus({ preventScroll: true }); }
      })));
      main.prepend(panel);
    }

    function renderTransfer() {
      main.append(title('내보내기·사본 복원'), node('p', '이 작업공간의 원문·발췌·메모·출처를 파일로 보관합니다. 파일에는 개인 자료가 포함됩니다.', 'life-help'));
      main.append(node('p', '검토 초안과 기기에 보관하지 않은 사진·본문은 제외됩니다. 연표·목표·습관은 별도 백업입니다.', 'life-help'));
      main.append(actionRow('묶음·내 페이지도 함께 백업', '아래 자료 전용 파일에는 페이지 구성과 회고가 포함되지 않습니다.', 'download', () => navigate('workbench-backup')));
      const actions = node('section', null, 'life-destinations life-settings-section');
      const stamp = new Date().toISOString().slice(0, 10);
      actions.append(actionRow('JSON 백업', '새 작업공간 사본으로 복원할 수 있는 파일', 'download', async () => {
        const backup = await core.makeBackup(state.bundle);
        download(JSON.stringify(backup, null, 2), 'life-tools-' + stamp + '.json', 'application/json');
      }), actionRow('Markdown 내보내기', '다른 앱에서 읽고 활용할 문서', 'book', async () => {
        download(await core.toMarkdown(state.bundle), 'life-tools-' + stamp + '.md', 'text/markdown;charset=utf-8');
      }));
      main.append(actions);
      const restore = field('JSON 백업을 새 작업공간 사본으로 복원', 'file', 'lifeRestoreFile', '');
      restore.input.accept = '.json,application/json';
      const preview = node('div', null, 'life-restore-preview');
      preview.id = 'lifeRestorePreview';
      preview.setAttribute('aria-live', 'polite');
      let candidate = null;
      restore.input.addEventListener('change', guarded(async () => {
        candidate = null;
        preview.replaceChildren();
        const file = restore.input.files[0];
        if (!file) return;
        preview.append(node('p', '백업의 원문과 참조를 확인하고 있습니다.', 'life-help'));
        let parsed;
        try {
          try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())); }
          catch (_) { throw new Error('JSON 백업을 읽을 수 없습니다. 원래 파일과 현재 작업공간은 그대로 유지됩니다.'); }
          candidate = await core.restoreBackup(parsed);
        } catch (cause) { preview.replaceChildren(); throw cause; }
        if (disposed) return;
        preview.replaceChildren();
        preview.append(node('h4', candidate.title || '제목 없는 작업공간'));
        preview.append(node('p', file.name + ' · 백업 생성 ' + dateLabel(parsed.exportedAt), 'life-meta'));
        preview.append(node('p', '검증된 사본: 자료 ' + candidate.sources.length + '개 · 원문 버전 ' + candidate.sourceVersions.length + '개 · 발췌 ' + candidate.records.length + '개'));
        const counts = { full_text: 0, partial: 0, link_only: 0, unknown: 0 };
        candidate.sourceVersions.forEach(version => { counts[version.coverage.status] += 1; });
        const coverage = Object.entries(counts).filter(([, count]) => count).map(([kind, count]) => COVERAGE[kind] + ' ' + count + '개');
        if (coverage.length) preview.append(node('p', '원문 버전 기준 · ' + coverage.join(' / '), 'life-help'));
        preview.append(backupContents(candidate), node('p', '현재 작업공간을 덮어쓰지 않습니다. 새 사본을 만들고 자동 동기화는 연결하지 않습니다.', 'life-help'));
        const actions = node('div', null, 'life-actions');
        actions.append(button('새 사본으로 복원', guarded(async () => {
          const selected = candidate;
          if (!selected) return;
          await persistDrafts();
          const previousId = state.bundle.workspaceId;
          const installed = await storage.installWorkspace(selected);
          if (disposed) return;
          candidate = null;
          preview.replaceChildren();
          invalidateBatchContext();
          state.bundle = installed;
          state.restoreReturn = { previousId, copyId: installed.workspaceId };
          state.stage = null;
          state.prepared = null;
          state.sourceDrafts.clear();
          state.stages = [];
          state.allStages = [];
          state.workspaces = [...state.workspaces, { workspaceId: installed.workspaceId, title: installed.title }];
          resetSearchContext();
          state.mode = 'sources';
          connectSubscription();
          render();
          global.scrollTo({ top: 0, behavior: 'instant' });
          announce('새 작업공간 사본을 열었습니다. 이전 작업공간은 그대로 유지됩니다. 자동 동기화는 연결하지 않았습니다.', { quiet: true });
          main.querySelector('#lifeRestoreResult h3')?.focus({ preventScroll: true });
          // Installation already committed. A later list/read failure must not offer to install it again.
          try { await refreshData(); render(); }
          catch (_) { throw new Error('사본은 이 브라우저에 보관됐습니다. 작업공간 목록을 갱신하지 못했으니 관리에서 다시 확인해 주세요.'); }
          finally { main.querySelector('#lifeRestoreResult h3')?.focus({ preventScroll: true }); }
        }), 'life-primary'), button('복원 취소', guarded(() => {
          candidate = null;
          preview.replaceChildren();
          restore.input.value = '';
          global.requestAnimationFrame(() => { if (!disposed && restore.input.isConnected) restore.input.focus({ preventScroll: true }); });
          announce('복원을 취소했습니다. 파일과 현재 작업공간은 그대로 유지됩니다.');
        })));
        preview.append(actions);
      }));
      const restoreSection = node('section', null, 'life-settings-section');
      restoreSection.append(node('h3', '백업에서 복원'), restore.label, preview, node('p', '다른 기기로 옮긴 백업은 별도 사본입니다. 여러 기기의 변경이 서로 자동 반영되지 않습니다.', 'life-help'));
      main.append(restoreSection);
      const workspaceName = field('새 작업공간 이름', 'text', 'lifeNewWorkspaceName', '');
      const workspaceSection = node('section', null, 'life-settings-section');
      workspaceSection.append(node('h3', '새 작업공간'), workspaceName.label, button('빈 작업공간 만들기', guarded(async () => {
        await persistDrafts();
        invalidateBatchContext();
        const created = await storage.createWorkspace(workspaceName.input.value || '새 작업공간');
        invalidateBatchContext();
        await storage.setActive(created.workspaceId);
        state.bundle = created;
        state.stage = null;
        state.prepared = null;
        state.sourceDrafts.clear();
        state.readerPositions.clear();
        resetSearchContext();
        state.mode = 'sources';
        await refreshData();
        connectSubscription();
        render();
        announce('빈 작업공간을 만들었습니다. 이전 기록은 유지됩니다.');
      })));
      main.append(workspaceSection);
      if (storage.listUnownedWorkspaces && storage.importUnownedWorkspace) {
        const old = node('details', null, 'life-details');
        old.id = 'lifeUnownedImport';
        old.append(node('summary', '이 브라우저의 기존 자료 가져오기'));
        old.append(node('p', 'Google 계정에 연결하지 않고 이 브라우저에 보관했던 자료만 확인합니다. 원문·발췌·보관된 검토초안을 현재 계정의 새 사본으로 가져오며, 원본을 그대로 남깁니다. 자동 동기화는 연결하지 않습니다.', 'life-help'));
        const list = node('div', null, 'life-restore-preview');
        old.append(button('기존 자료 목록 확인', guarded(async () => {
          const rows = await storage.listUnownedWorkspaces();
          if (disposed) return;
          list.replaceChildren();
          if (!rows.length) { list.append(empty('계정에 연결하지 않은 기존 자료가 없습니다.')); return; }
          const choice = selectField('가져올 기존 작업공간', 'lifeUnownedWorkspace', rows.map(item => [item.workspaceId, item.title]), rows[0].workspaceId);
          const ownership = field('선택한 자료는 내가 이 계정에서 사용할 자료입니다.', 'checkbox', 'lifeUnownedOwnership', '');
          const adopt = button('현재 계정에 자료 사본 만들기', guarded(async () => {
            if (!ownership.input.checked) return;
            if (dirty()) await persistStage();
            invalidateBatchContext();
            const copy = await storage.importUnownedWorkspace(choice.input.value);
            if (disposed) return;
            invalidateBatchContext();
        await storage.setActive(copy.workspaceId);
            state.bundle = copy;
            state.stage = state.prepared = null;
            resetSearchContext();
            state.mode = 'sources';
            await refreshData();
            connectSubscription();
            render();
            announce('현재 계정의 새 사본을 열었습니다. 원본과 검토초안은 보존했으며 자동 동기화는 연결하지 않았습니다.');
          }), 'life-primary');
          adopt.disabled = true;
          ownership.input.addEventListener('change', () => { adopt.disabled = !ownership.input.checked; });
          list.append(choice.label, ownership.label, adopt);
        })), list);
        main.append(old);
      }

    }

    function renderTime() {
      main.append(title('연표'));
      main.append(destinationRow('연표 목록', '보관한 연표를 열거나 새로 만듭니다.', 'workspace.html', 'timeline'));
      const list = node('div', null, 'life-card-grid');
      main.append(button('기존 연표 목록 확인', guarded(async () => {
        const documents = await legacy.listDocuments();
        list.replaceChildren();
        documents.forEach(doc => {
          const card = node('article', null, 'life-card');
          card.append(node('h3', doc.name || '제목 없는 연표'));
          const href = legacy.open(doc);
          const parsed = new URL(href, global.location.href);
          if (parsed.origin === global.location.origin && /\/timeline\.html$/.test(parsed.pathname)) {
            const link = node('a', '기존 연표 열기', 'life-button');
            link.href = parsed.href;
            card.append(link);
          }
          list.append(card);
        });
        if (!documents.length) list.append(empty('현재 계정에 연결된 연표가 없습니다. 내 공간에서 연표를 만들거나 기존 연표의 사본을 가져오세요.'));
      })), list);
    }

    function syncHelp() {
      const details = node('details', null, 'life-details');
      details.id = 'lifeSyncHelp';
      details.append(node('summary', '동기화 설정 도움말'));
      details.append(node('p', '내 공간의 Google 계정으로 필요한 작업공간만 동기화합니다. 로그인만으로 새 작업공간을 서버에 올리지 않습니다.', 'life-help'));
      details.append(node('p', '서버 저장소가 준비되지 않았다는 오류가 나오면 프로젝트 관리자가 자료 동기화용 SQL을 설치해야 합니다. 기존 연표 설정은 가져오거나 변경하지 않습니다.', 'life-help'));
      const sql = node('a', '서버 설정 SQL 보기', 'life-external');
      sql.href = './supabase/migrations/20261003085426_life_sync_workspaces.sql';
      sql.target = '_blank';
      sql.rel = 'noopener noreferrer';
      details.append(sql);
      return details;
    }

    function fillSyncState(panel) {
      if (disposed) return;
      const active = panel.contains(document.activeElement) ? document.activeElement : null;
      const focus = active && { tag: active.tagName, name: active.getAttribute('aria-label') || active.textContent };
      const detailsOpen = panel.querySelector('#lifeSyncDetails')?.open || false;
      panel.replaceChildren();
      const heading = node('h3', state.bundle.title || '현재 작업공간');
      heading.tabIndex = -1;
      panel.append(heading, node('p', '자료 ' + state.bundle.sources.length + '개 · 발췌 ' + state.bundle.records.length + '개 · 이 브라우저에 보관', 'life-meta'));
      const presentation = syncPresentation();
      panel.dataset.syncState = presentation.key;
      const remoteStatus = node('p', null, 'life-sync-status');
      remoteStatus.id = 'lifeSyncStatus';
      remoteStatus.setAttribute('role', 'status');
      remoteStatus.append(global.HaedoLife.Icons.create('cloud'), node('span', presentation.label));
      panel.append(remoteStatus, node('p', presentation.hint, 'life-help'));
      const info = state.syncState;
      const account = state.syncAccount;
      const actions = node('div', null, 'life-actions');
      const restoreFocus = () => {
        if (!focus) return;
        const replacement = [...panel.querySelectorAll('button,summary,a')].find(item => item.tagName === focus.tag && (item.getAttribute('aria-label') || item.textContent) === focus.name && !item.disabled);
        (replacement || heading).focus({ preventScroll: true });
      };
      if (state.syncReadError) {
        panel.append(node('p', state.syncReadError.message || '연결 상태를 읽지 못했습니다.', 'life-error'));
        actions.append(button('동기화 상태 다시 확인', guarded(refreshSync), 'life-primary'));
        panel.append(actions);
        restoreFocus();
        return;
      }
      if (state.syncLoading) { restoreFocus(); return; }
      if (info?.error && presentation.key === 'error') panel.append(node('p', info.error.message || '서버에 연결하지 못했습니다.', 'life-error'));
      const matching = account && presentation.key !== 'mismatch' && (!info?.binding || (info.binding.projectUrl === account.projectUrl && info.binding.userId === account.userId));
      if (matching && (!info?.binding || !info.enabled)) actions.append(button('이 작업공간 동기화 시작', guarded(async () => {
        await syncAction(() => sync.enable(state.bundle.workspaceId), '이 작업공간의 동기화를 시작했습니다. 로컬 저장과 서버 상태는 별도로 확인할 수 있습니다.');
      }), 'life-primary'));
      if (info?.conflict && info.enabled && matching) actions.append(button('양쪽 변경 비교', guarded(async () => {
        if (dirty()) await persistStage();
        await refreshData();
        await refreshSync();
        if (!state.syncState?.conflict) return;
        state.conflictView = { workspaceId: state.bundle.workspaceId, local: structuredClone(state.bundle), remote: structuredClone(state.syncState.conflict), accountKey: state.syncAccountKey };
        renderConflict();
        const comparisonHeading = main.querySelector('#lifeSyncConflict h3');
        if (comparisonHeading) { comparisonHeading.tabIndex = -1; comparisonHeading.focus(); }
      }), 'life-primary'));
      if (matching && info?.binding && info.enabled) {
        if (!info.conflict) {
          const retry = button('지금 동기화', guarded(async () => {
            await syncAction(() => sync.syncNow(state.bundle.workspaceId), '', true);
            announce(syncSummary() + ' · 이 브라우저의 자료는 유지됩니다.');
          }), 'life-primary');
          retry.disabled = presentation.key === 'syncing';
          actions.append(retry);
        }
        actions.append(button('연결 중지', guarded(async () => {
          await syncAction(() => sync.pause(state.bundle.workspaceId), '이 작업공간의 동기화를 중지했습니다. 로컬 자료와 이전 연결 정보는 유지됩니다.');
        })));
      }
      if (presentation.key === 'auth_required') actions.append(button('계정 확인', guarded(() => navigate('manage'))));
      if (presentation.key === 'mismatch' || info?.conflict?.missing) actions.append(button('자료 백업·복원', guarded(() => navigate('transfer'))));
      panel.append(actions);
      if (state.conflictCopyId) {
        const copy = state.workspaces.find(item => item.workspaceId === state.conflictCopyId);
        panel.append(node('p', '선택하지 않은 쪽의 사본: ' + (copy ? copy.title : '작업공간 목록에서 확인'), 'life-help'));
        panel.append(button('보존한 사본 열기', guarded(async () => {
          if (dirty()) await persistStage();
          invalidateBatchContext();
          await storage.setActive(state.conflictCopyId);
          state.bundle = await storage.read(state.conflictCopyId);
          state.stage = state.prepared = null;
          resetSearchContext();
          state.mode = 'sources';
          await refreshData();
          connectSubscription();
          await refreshSync();
          render();
          announce('보존한 사본을 열었습니다. 이 사본을 다른 계정이나 서버에 자동 연결하지 않았습니다.');
        })));
      }
      const details = node('details', null, 'life-details life-sync-account');
      details.id = 'lifeSyncDetails';
      details.open = detailsOpen;
      details.append(node('summary', '계정·연결 정보'));
      if (account) details.append(node('p', account.email || '로그인한 계정'), node('p', '프로젝트: ' + account.projectUrl, 'life-meta'));
      else details.append(node('p', '현재 계정: 로그인하지 않음', 'life-meta'));
      if (info?.binding) details.append(node('p', '연결 프로젝트: ' + info.binding.projectUrl, 'life-meta'), node('p', '서버 버전 ' + info.remoteRevision + ' · 이 브라우저 버전 ' + state.bundle.revision, 'life-meta'));
      details.append(node('p', '계정을 바꾸려면 관리에서 로그아웃한 뒤 다시 로그인하세요.', 'life-help'));
      if (account && !auth) details.append(button('로그아웃', guarded(async () => {
        state.remoteRows = null;
        state.remoteRowsAccountKey = null;
        state.conflictView = null;
        updateSyncPanels();
        await sync.signOut();
      })));
      panel.append(details);
      restoreFocus();
    }

    function fillRemoteList(parent) {
      if (disposed) return;
      const active = parent.contains(document.activeElement) ? document.activeElement : null;
      const focus = active && { rowId: active.closest('[data-remote-id]')?.dataset.remoteId, tag: active.tagName, name: active.textContent };
      const openRows = new Set([...parent.querySelectorAll('[data-remote-id]:has(details[open])')].map(row => row.dataset.remoteId));
      const restoreFocus = () => {
        if (!focus) return;
        const row = focus.rowId ? [...parent.querySelectorAll('[data-remote-id]')].find(item => item.dataset.remoteId === focus.rowId) : parent;
        const control = row && [...row.querySelectorAll('button,summary')].find(item => item.tagName === focus.tag && item.textContent === focus.name);
        (control || parent.querySelector('button'))?.focus({ preventScroll: true });
      };
      parent.replaceChildren();
      const accountKey = state.syncAccountKey;
      if (!state.syncAccount) { parent.append(empty('로그인한 뒤 필요한 서버 작업공간을 선택해 받습니다.')); return; }
      parent.append(button('서버 작업공간 목록 확인', guarded(async () => {
        const before = state.syncAccountKey;
        const rows = await sync.listRemote();
        await refreshSync();
        if (!before || state.syncAccountKey !== before) throw new Error('계정이 바뀌어 이전 목록을 표시하지 않았습니다. 다시 확인해 주세요.');
        state.remoteRows = rows;
        state.remoteRowsAccountKey = before;
        fillRemoteList(parent);
      })));
      if (state.remoteRows === null || state.remoteRowsAccountKey !== accountKey) { restoreFocus(); return; }
      if (!state.remoteRows.length) { parent.append(empty('이 계정에 보관된 서버 작업공간이 없습니다.')); restoreFocus(); return; }
      state.remoteRows.forEach(row => {
        const card = node('article', null, 'life-card');
        card.dataset.remoteId = row.id;
        card.append(node('h4', row.title || '제목 없는 작업공간'), node('p', '서버 저장 ' + dateLabel(row.updated_at), 'life-meta'));
        const details = node('details', null, 'life-details');
        details.open = openRows.has(row.id);
        details.append(node('summary', '서버 정보'), node('p', '서버 버전 ' + row.revision, 'life-meta'));
        card.append(details);
        card.append(button('이 작업공간 받기', guarded(async () => {
          if (dirty()) await persistStage();
          const before = state.syncAccountKey;
          invalidateBatchContext();
          const received = await sync.download(row.id);
          await refreshSync();
          if (before !== state.syncAccountKey) throw new Error('계정이 바뀌어 이전 화면으로 전환하지 않았습니다. 로컬 자료는 유지됩니다.');
          if (!received || !received.workspaceId) throw new Error('받은 작업공간을 확인하지 못했습니다. 기존 자료를 유지합니다.');
          const downloaded = await storage.read(received.workspaceId);
          invalidateBatchContext();
        await storage.setActive(received.workspaceId);
          state.bundle = downloaded;
          state.stage = state.prepared = null;
          resetSearchContext();
          state.mode = 'sources';
          await refreshData();
          connectSubscription();
          await refreshSync();
          render();
          announce('선택한 서버 작업공간을 받았습니다. 기존 로컬 작업공간은 그대로 유지됩니다.');
        })));
        parent.append(card);
      });
      restoreFocus();
    }

    function renderSync() {
      main.append(title('기기 간 동기화'), node('p', 'Mac·iPad·iPhone에서 같은 계정의 자료를 이어 봅니다. 로그인만으로 로컬 자료를 올리지 않습니다.', 'life-help'));
      const panel = node('section', null, 'life-sync-state-panel');
      panel.id = 'lifeSyncState';
      main.append(panel);
      fillSyncState(panel);
      const conflict = node('section', null, 'life-conflict-section');
      conflict.id = 'lifeSyncConflict';
      conflict.hidden = true;
      main.append(conflict);
      if (state.conflictView) renderConflict();
      if (compositionSync && global.HaedoLife.CompositionUI) {
        const compositionHost = node('section'); main.append(compositionHost);
        const workspaceId = state.bundle.workspaceId;
        compositionPanel = global.HaedoLife.CompositionUI.create({ host: compositionHost, manager: compositionSync,
          storage, workspaceId, beforeAction: persistDrafts,
          isCurrent: () => !disposed && state.mode === 'sync' && state.bundle?.workspaceId === workspaceId });
      }
      const remoteSection = node('section', null, 'life-remote-section');
      remoteSection.append(node('h3', '서버 작업공간 받기'), node('p', '같은 계정으로 다른 기기에서 올린 작업공간을 선택해 받습니다.', 'life-help'));
      const list = node('div', null, 'life-remote-list');
      list.id = 'lifeRemoteList';
      remoteSection.append(list);
      main.append(remoteSection);
      fillRemoteList(list);
      main.append(syncHelp());
    }

    function conflictSide(label, bundle) {
      const card = node('section', null, 'life-card');
      card.append(node('h4', label), node('p', bundle.title, 'life-note'), node('p', '원천 ' + bundle.sources.length + '개 · 원문 버전 ' + bundle.sourceVersions.length + '개 · 발췌 ' + bundle.records.length + '개', 'life-meta'));
      bundle.sourceVersions.forEach(version => {
        const source = bundle.sources.find(item => item.id === version.sourceId);
        const details = node('details', null, 'life-details life-conflict-text');
        details.append(node('summary', source ? sourceLabel(source) : '원문'));
        details.append(node('p', '가져온 시각: ' + new Date(version.importedAt).toLocaleString('ko-KR'), 'life-meta'));
        details.append(node('p', '원문 작성: ' + (version.originalCreatedAt || '모름') + ' · ' + (source ? sourceOrigin(source) : '원천 미확인'), 'life-meta'));
        details.append(node('p', COVERAGE[version.coverage.status] || COVERAGE.unknown, 'life-meta'), node('pre', version.contentText == null ? '본문 미확보 · 링크만 보관' : version.contentText, 'life-conflict-content'));
        card.append(details);
      });
      if (bundle.records.length) {
        const excerpts = node('details', null, 'life-details');
        excerpts.append(node('summary', '발췌·주제·메모 내용 확인'));
        bundle.records.forEach(record => { excerpts.append(node('p', record.topic || '주제 없음', 'life-tag'), node('blockquote', record.text, 'life-quote')); if (record.note) excerpts.append(node('p', record.note, 'life-note')); });
        card.append(excerpts);
      }
      return card;
    }

    function renderConflict() {
      const parent = main.querySelector('#lifeSyncConflict');
      if (!parent) return;
      parent.replaceChildren();
      const view = state.conflictView;
      parent.hidden = !view || view.workspaceId !== state.bundle.workspaceId || view.accountKey !== state.syncAccountKey;
      if (parent.hidden) return;
      parent.append(node('h3', '양쪽 변경 비교'));
      if (view.remote.missing || !view.remote.row) { parent.append(empty('서버의 작업공간을 찾을 수 없습니다. 자동으로 다시 생성하지 않습니다. 로컬 백업 또는 연결 중지를 선택해 주세요.')); return; }
      const row = view.remote.row;
      parent.append(node('p', '선택하지 않은 쪽도 이 브라우저의 별도 작업공간 사본으로 보관합니다.', 'life-help'));
      const comparison = node('details', null, 'life-details');
      comparison.append(node('summary', '비교 기준'), node('p', '이 브라우저 버전 ' + view.local.revision + ' · 서버 버전 ' + row.revision, 'life-meta'));
      parent.append(comparison);
      const sides = node('div', null, 'life-conflict-grid');
      sides.append(conflictSide('내 변경', view.local), conflictSide('서버 변경', row.data));
      parent.append(sides);
      const actions = node('div', null, 'life-actions');
      const resolve = async choice => {
        const local = await storage.read(view.workspaceId);
        const current = await sync.getState(view.workspaceId);
        if (syncAccountKey(await sync.getAccount()) !== view.accountKey || local.revision !== view.local.revision || !current.conflict || !current.conflict.row || current.conflict.row.revision !== row.revision) {
          state.conflictView = null;
          await refreshSync();
          renderConflict();
          throw new Error('비교 후 내용이나 계정이 바뀌었습니다. 양쪽 변경을 다시 비교해 주세요.');
        }
        let result;
        try { result = await sync.resolve(view.workspaceId, choice, { expectedLocalRevision: view.local.revision, expectedRemoteRevision: row.revision }); }
        catch (cause) {
          if (['stale_conflict', 'sync_conflict_changed', 'stale_session', 'account_mismatch', 'remote_missing', 'sync_paused', 'auth_required'].includes(cause.code)) {
            state.conflictView = null;
            renderConflict();
            await refreshSync();
            main.querySelector('#lifeSyncState h3')?.focus({ preventScroll: true });
          }
          throw cause;
        }
        state.conflictCopyId = result && result.copyWorkspaceId || null;
        state.conflictView = null;
        await refreshData();
        await refreshSync();
        renderConflict();
        if (result && result.syncError) {
          failure(result.syncError);
          announce('선택한 변경과 사본을 이 브라우저에 보관했습니다. 서버 전송은 완료되지 않았습니다. 동기화 상태를 확인해 주세요.');
        } else announce('선택한 변경을 반영했습니다. 선택하지 않은 쪽은 별도 사본으로 보관됩니다. 서버 상태는 위에서 확인해 주세요.');
      };
      actions.append(button('서버 변경 받기 · 내 변경은 사본 보관', guarded(() => resolve('remote'))), button('내 변경 보내기 · 서버 변경은 사본 보관', guarded(() => resolve('local'))));
      parent.append(actions);
    }

    function render() {
      if (disposed) return;
      compositionPanel?.dispose(); compositionPanel = null;
      homeRenderPromise = Promise.resolve();
      home?.leave();
      workbench?.leave();
      writer?.close();
      if (readerCleanup) { readerCleanup(); readerCleanup = null; }
      readingResumeCleanup?.(); readingResumeCleanup = null;
      if (sectionFor(state.mode) === 'records') lastRecordMode = state.mode;
      writeRoute(state.mode, false);
      renderHeader();
      main.dataset.mode = state.mode;
      main.replaceChildren();
      if (state.mode === 'home' && home) {
        // Home's configuration read must not lock independent navigation.
        homeRenderPromise = home.render().catch(failure);
        return;
      }
      if (state.mode === 'write' && writer) {
        const options = writingOpenOptions || {};
        writingOpenOptions = null;
        return writer.open(options).catch(failure);
      }
      if (workbenchModes.includes(state.mode) && workbench) {
        const options = workbenchOpenOptions || {};
        workbenchOpenOptions = null;
        return Promise.resolve(workbench.render(state.mode, options)).then(() => {
          if (!disposed && state.mode === 'page') renderRestoreResult();
        }).catch(failure);
      }
      renderChapterImportReturn();
      if (state.mode === 'tools') renderTools();
      else if (state.mode === 'manage') renderManagement();
      else if (state.mode === 'batch') renderBatch();
      else if (state.mode === 'import') renderImport();
      else if (state.mode === 'source') renderSource();
      else if (state.mode === 'sources') renderSources();
      else if (state.mode === 'transfer') renderTransfer();
      else if (state.mode === 'time') renderTime();
      else if (state.mode === 'sync' && sync) renderSync();
      else renderTopics();
      if (state.mode === 'topics' || state.mode === 'sources') renderRestoreResult();
      const scope = node('p', null, 'life-scope');
      updateScope(scope);
      main.append(scope);
    }

    const beforeUnload = event => {
      if (dirty() || state.sourceDrafts.size || workbench?.dirty() || writer?.isDirty()) { event.preventDefault(); event.returnValue = ''; }
    };
    const visibility = () => {
      if (!document.hidden) return;
      if (dirty()) persistStage().catch(failure);
      if (workbench?.dirty()) workbench.flush().catch(failure);
      if (writer?.isDirty()) writer.flush().catch(failure);
      flushReadingPosition();
    };
    const pagehideReading = () => { flushReadingPosition(); };
    global.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', visibility);
    global.addEventListener('pagehide', pagehideReading);
    if (sync) unsubscribeSync = sync.subscribe(event => {
      if (disposed) return;
      if (event && event.type === 'error' && event.error) failure(event.error);
      refreshSync().catch(failure);
    });
    signal?.addEventListener('abort', dispose, { once: true });
    await storage.open();
    if (disposed) return { dispose };
    state.workspaces = await storage.listWorkspaces();
    if (disposed) return { dispose };
    let active = await storage.getActive();
    if (!active && !state.workspaces.length) {
      invalidateBatchContext();
      const first = await storage.createWorkspace('내 자료');
      active = first.workspaceId;
      await storage.setActive(active);
    }
    if (disposed) return { dispose };
    state.mode = routeMode();
    if (active) {
      state.bundle = await storage.read(active);
      if (sectionFor(state.mode) === 'records') lastRecordMode = state.mode;
      await refreshData();
      connectSubscription();
      render();
      announce('이 브라우저에 보관한 자료를 열었습니다.', { quiet: true });
      if (sync) await refreshSync();
    } else {
      header.append(node('h1', '자료 모아보기'));
      main.append(title('보관한 작업공간 선택'));
      const choice = selectField('작업공간', 'lifeWorkspaceChoice', state.workspaces.map(w => [w.workspaceId, w.title]), state.workspaces[0].workspaceId);
      main.append(choice.label, button('선택한 작업공간 열기', guarded(async () => {
        invalidateBatchContext();
        await storage.setActive(choice.input.value);
        state.bundle = await storage.read(choice.input.value);
        await refreshData();
        connectSubscription();
        render();
        announce('선택한 작업공간을 열었습니다. 다른 기록은 그대로 유지됩니다.');
      })));
      announce('현재 작업공간을 선택하지 않았습니다. 보관한 목록에서 선택해 주세요.');
    }
    unbindNavigation = global.HaedoNavigation?.bind(section => guarded(() => navigateSection(section))());
    global.addEventListener('popstate', popstate);
    return { dispose, flushDraft };

    async function flushDraft() {
      if (disposed) throw new Error('계정이 바뀌어 이전 초안을 보관할 수 없습니다.');
      if (state.busy) throw new Error('자료를 처리 중입니다. 작업이 끝난 뒤 로그아웃을 다시 선택해 주세요.');
      await persistDrafts();
    }

    // Call inside guarded actions; the public logout hook checks its own boundary.
    async function persistDrafts() {
      if (disposed) throw new Error('계정이 바뀌어 이전 초안을 보관할 수 없습니다.');
      await workbench?.flush();
      await writer?.flush();
      await flushReadingPosition();
      if (disposed) throw new Error('계정이 바뀌어 이전 초안을 보관할 수 없습니다.');
      if (state.stage && dirty()) await persistStage();
      for (const [versionId, draft] of state.sourceDrafts) {
        if (!draft.topic && !draft.note) continue;
        const version = state.bundle.sourceVersions.find(item => item.id === versionId);
        const source = version && sourceFor(version.sourceId);
        if (!source) throw new Error('메모의 원문을 확인하지 못했습니다. 입력을 복사한 뒤 다시 시도해 주세요.');
        const range = draft.range;
        const selected = range && range.start < range.end;
        const now = new Date().toISOString();
        const stage = {
          stageId: draft.stageId || core.id(), workspaceId: state.bundle.workspaceId,
          revision: draft.stageRevision || 0, state: 'draft', createdAt: now, updatedAt: now,
          input: { origin: source.origin, title: source.title, url: source.url || '', text: version.contentText || '', format: version.format,
            existingSourceId: source.id, authorRelation: version.originalAuthor.relation, author: version.originalAuthor.label || '',
            originalCreatedAt: version.originalCreatedAt, coverage: version.coverage },
          excerpts: selected ? [{ ...range, topic: draft.topic, note: draft.note }] : [],
          draftTopic: selected ? '' : draft.topic, draftNote: selected ? '' : draft.note
        };
        const saved = await storage.saveStage(stage);
        draft.stageId = saved.stageId;
        draft.stageRevision = saved.revision;
      }
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      compositionPanel?.dispose(); compositionPanel = null;
      compositionSync?.dispose();
      writingSync?.dispose();
      home?.dispose();
      workbench?.dispose();
      writer?.dispose();
      unbindNavigation?.();
      global.removeEventListener('popstate', popstate);
      root.removeEventListener('focusin', keepFocusVisible);
      if (focusFrame !== null) { global.cancelAnimationFrame(focusFrame); focusFrame = null; }
      if (readerCleanup) { readerCleanup(); readerCleanup = null; }
      readingResumeCleanup?.(); readingResumeCleanup = null;
      readingPosition?.dispose();
      invalidateBatchContext();
      state.batches.clear();
      state.allStages = [];
      root.replaceChildren();
      root.remove();
      state.sourceDrafts.clear();
      state.readerPositions.clear();
      resetSearchContext();
      state.bundle = state.stage = state.prepared = state.conflictView = state.remoteRows = null;
      state.restoreReturn = null;
      if (stageTimer) clearTimeout(stageTimer);
      if (unsubscribe) unsubscribe();
      if (unsubscribeSync) unsubscribeSync();
      if (sync && typeof sync.dispose === 'function') sync.dispose();
      global.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('visibilitychange', visibility);
      global.removeEventListener('pagehide', pagehideReading);
      downloadUrls.forEach(url => URL.revokeObjectURL(url));
      downloadUrls.clear();
      signal?.removeEventListener('abort', dispose);
    }
  }

  global.HaedoLife = global.HaedoLife || {};
  global.HaedoLife.UI = Object.freeze({ mount });
})(globalThis);

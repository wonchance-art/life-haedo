(function (global) {
  'use strict';

  const ORIGINS = [['apple_notes', 'Apple 메모'], ['obsidian', 'Obsidian'], ['naver_blog', '네이버 블로그'], ['instagram', 'Instagram'], ['other', '기타']];
  const COVERAGE = { full_text: '제공한 본문 전체', partial: '선택한 본문 일부', link_only: '본문 미확보 · 링크만', unknown: '본문 확보 범위 미확인' };
  const MAX_TEXT_BYTES = 1024 * 1024;

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

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch (_) { return null; }
  }

  function sourceLabel(source) {
    return source.title || source.url || '제목 없는 자료';
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

  async function mount(container, { storage, core, legacy, sync, auth, signal }) {
    if (signal?.aborted) throw new Error('화면 연결이 취소되었습니다.');
    let disposed = false;
    let unsubscribe = null;
    let unsubscribeSync = null;
    let syncRefreshSequence = 0;
    let stageTimer = null;
    let saveChain = Promise.resolve();
    const downloadUrls = new Set();
    const state = {
      bundle: null, workspaces: [], mode: 'topics', topic: '', search: '', sourceId: null,
      sourceVersionId: null, locator: null, stage: null, prepared: null,
      busy: false, editTick: 0, savedTick: 0, stageFailed: false, status: '', error: '',
      pendingOperation: null, stageSelection: null, sourceSelection: null, stages: [],
      remoteChanged: false, readerPositions: new Map(), sourceDrafts: new Map(),
      syncAccount: null, syncState: null, syncReadError: null, syncAccountKey: null,
      syncLoading: false,
      remoteRows: null, remoteRowsAccountKey: null, conflictView: null, conflictCopyId: null
    };
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
    const main = node('main', null, 'life-main');
    main.id = 'lifeMain';
    const skip = node('a', '본문으로 이동', 'life-skip');
    skip.href = '#lifeMain';
    root.append(skip, header, toolbar, status, error, main);
    container.replaceChildren(root);

    function announce(message) {
      if (disposed) return;
      state.status = message;
      status.textContent = message;
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

    function originName(value) { return (ORIGINS.find(pair => pair[0] === value) || [value, value])[1]; }

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
      state.stage.revision = 0;
      state.stage.createdAt = new Date().toISOString();
      state.stageFailed = false;
      state.editTick += 1;
      await persistStage(true);
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

    async function refreshData() {
      if (disposed) return;
      state.bundle = await storage.read(state.bundle.workspaceId);
      state.workspaces = await storage.listWorkspaces();
      state.stages = (await storage.listStages(state.bundle.workspaceId)).filter(s => s.state === 'draft');
    }

    function syncAccountKey(account) {
      return account ? account.projectUrl + '|' + account.userId : null;
    }

    function syncSummary() {
      if (!sync) return '기기 간 자동 동기화 미연결';
      if (state.syncReadError) return '동기화 상태 확인 실패 · 자료는 이 브라우저에 보관';
      if (state.syncLoading) return '동기화 상태 확인 중';
      const item = state.syncState;
      if (!item || !item.binding) return '기기 간 자동 동기화 미연결';
      if (!item.enabled) return '기기 간 동기화 중지됨';
      if (!state.syncAccount) return '동기화 로그인 필요 · 자료는 이 브라우저에 보관';
      if (item.binding.userId !== state.syncAccount.userId || item.binding.projectUrl !== state.syncAccount.projectUrl) return '다른 계정에 연결된 작업공간 · 자동 전송 안 함';
      const labels = { pending: '동기화 대기', syncing: '동기화 중', synced: '서버와 동기화됨', conflict: '양쪽 변경 확인 필요', error: '동기화 실패', not_configured: '기기 간 자동 동기화 미연결' };
      return labels[item.status] || '동기화 상태 확인 필요';
    }

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
      if (scope) scope.textContent = '이 브라우저의 개인 작업공간 · ' + syncSummary();
      if (state.mode === 'sync') {
        const panel = main.querySelector('#lifeSyncState');
        if (panel) fillSyncState(panel);
        const server = main.querySelector('#lifeRemoteList');
        if (server) fillRemoteList(server);
      }
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

    async function commit(changes, stage) {
      const request = {
        workspaceId: state.bundle.workspaceId, baseRevision: state.bundle.revision, changes
      };
      if (stage) { request.stageId = stage.stageId; request.stageRevision = stage.revision; }
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
      await refreshData();
      state.remoteChanged = false;
      return result;
    }

    async function navigate(mode, options) {
      if (dirty()) await persistStage();
      Object.assign(state, options || {}, { mode });
      render();
      const heading = main.querySelector('h2');
      if (heading) heading.focus({ preventScroll: true });
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
    }

    async function openStage(stageId) {
      if (dirty()) await persistStage();
      const stage = await storage.getStage(stageId);
      if (!stage || stage.state !== 'draft') throw new Error('이 검토 항목은 이미 적용됐거나 찾을 수 없습니다.');
      state.stage = stage;
      state.savedTick = state.editTick = 0;
      state.prepared = null;
      state.stageFailed = false;
      await navigate('import');
    }

    function renderHeader() {
      if (disposed) return;
      header.replaceChildren();
      const introduction = node('div');
      introduction.append(node('h1', '자료 모아보기'), node('p', '선택한 기록을 가져와 관심 주제로 다시 읽습니다.', 'life-subtitle'));
      const workspace = selectField('작업공간', 'lifeWorkspace', state.workspaces.map(w => [w.workspaceId, w.title]), state.bundle.workspaceId);
      workspace.input.addEventListener('change', guarded(async () => {
        const selected = workspace.input.value;
        if (dirty()) await persistStage();
        await storage.setActive(selected);
        state.bundle = await storage.read(selected);
        state.stage = null;
        state.prepared = null;
        state.sourceId = null;
        state.mode = 'topics';
        state.topic = state.search = '';
        await refreshData();
        connectSubscription();
        render();
        announce('선택한 작업공간을 열었습니다. 다른 작업공간은 그대로 보관됩니다.');
      }));
      header.append(introduction, workspace.label);
      toolbar.replaceChildren();
      const nav = node('nav', null, 'life-nav');
      nav.setAttribute('aria-label', '자료 보기');
      [['topics', '모아보기'], ['sources', '원천 기록'], ['time', '시간 보기']].forEach(([mode, label]) => {
        const tab = button(label, guarded(() => navigate(mode)));
        if (state.mode === mode) tab.setAttribute('aria-current', 'page');
        nav.append(tab);
      });
      const actions = node('div', null, 'life-actions');
      actions.append(button('가져오기', guarded(async () => {
        if (state.stage && state.stage.state === 'draft') await navigate('import');
        else { newDraft(); await navigate('import'); }
      }), 'life-primary'), button('내보내기·사본 복원', guarded(() => navigate('transfer'))));
      if (sync) actions.append(button('기기 간 동기화', guarded(async () => {
        await navigate('sync');
        await refreshSync();
      })));
      if (state.remoteChanged) actions.append(button('최신 내용 확인', guarded(async () => {
        if (dirty()) await persistStage();
        await refreshData();
        state.remoteChanged = false;
        state.prepared = null;
        render();
        announce('최신 내용을 불러왔습니다. 보관 중인 입력은 유지됩니다. 다시 검토해 주세요.');
      })));
      toolbar.append(nav, actions);
    }

    function renderStages(parent) {
      if (!state.stages.length) return;
      const details = node('details', null, 'life-details');
      details.append(node('summary', '검토 중 ' + state.stages.length + '개 · 이어서 확인'));
      state.stages.forEach(stage => {
        const row = node('div', null, 'life-row');
        row.append(button(stage.input.title || stage.input.fileName || '제목 없는 검토 항목', guarded(() => openStage(stage.stageId))), node('span', originName(stage.input.origin), 'life-meta'));
        details.append(row);
      });
      parent.append(details);
    }

    function searchField(parent, placeholder, update) {
      const search = field('자료 검색', 'search', 'lifeSearch', state.search);
      search.input.placeholder = placeholder;
      search.input.addEventListener('input', event => {
        state.search = event.target.value;
        if (!event.isComposing) update();
      });
      search.input.addEventListener('compositionend', update);
      parent.append(search.label);
    }

    function matchingText(text) { return !state.search.trim() || String(text).toLocaleLowerCase().includes(state.search.trim().toLocaleLowerCase()); }

    function excerptCard(record) {
      const card = node('article', null, 'life-card');
      const ref = record.sourceRefs[0];
      const source = sourceFor(ref.sourceId);
      card.append(node('p', record.topic || '주제 없음', 'life-tag'), node('blockquote', record.text, 'life-quote'));
      if (record.note) card.append(node('p', record.note, 'life-note'));
      card.append(node('p', (source ? originName(source.origin) + ' · ' + sourceLabel(source) : '출처 없음'), 'life-meta'));
      const actions = node('div', null, 'life-actions');
      actions.append(button('원문에서 보기', guarded(() => navigate('source', { sourceId: ref.sourceId, sourceVersionId: ref.sourceVersionId, locator: ref.locator }))), button('발췌 제거', guarded(async () => {
        if (!global.confirm('이 발췌와 주제 연결을 제거할까요? 원문 사본은 그대로 보관됩니다.')) return;
        await commit({ put: {}, remove: { records: [record.id] } });
        render();
        announce('발췌를 제거했습니다. 원문 사본은 이 브라우저에 보관됩니다.');
      })));
      card.append(actions);
      return card;
    }

    function renderTopics() {
      main.append(title('주제별 모아보기'), node('p', '발췌와 출처를 함께 읽고 원문으로 돌아갈 수 있습니다.', 'life-help'));
      renderStages(main);
      const results = node('div', null, 'life-card-grid');
      const topics = node('div', null, 'life-topic-list');
      const update = () => {
        topics.replaceChildren();
        const topicNames = Array.from(new Set(state.bundle.records.map(r => r.topic || '')));
        const all = button('모든 주제', () => { state.topic = ''; update(); });
        all.setAttribute('aria-pressed', String(!state.topic));
        topics.append(all);
        topicNames.filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko')).forEach(name => {
          const item = button(name, () => { state.topic = name; update(); });
          item.setAttribute('aria-pressed', String(state.topic === name));
          topics.append(item);
        });
        results.replaceChildren();
        const records = state.bundle.records.filter(r => (!state.topic || r.topic === state.topic) && matchingText([r.text, r.topic, r.note, sourceLabel(sourceFor(r.sourceRefs[0].sourceId) || {})].join(' ')));
        records.forEach(record => results.append(excerptCard(record)));
        if (!records.length) results.append(empty(state.bundle.records.length ? '조건에 맞는 발췌가 없습니다. 검색어나 주제를 바꿔 주세요.' : '아직 모아 둔 발췌가 없습니다. 가져오기에서 본문·파일·링크를 선택하거나 원천 기록에서 보관한 자료를 읽어 주세요.'));
      };
      searchField(main, '문장·주제·출처 찾기', update);
      main.append(topics, results);
      update();
    }

    function renderSources() {
      main.append(title('원천 기록'), node('p', '선택해 가져온 자료만 보관합니다. 원래 앱의 기록은 변경하지 않습니다.', 'life-help'));
      renderStages(main);
      const list = node('div', null, 'life-card-grid');
      const origin = selectField('원천 필터', 'lifeOriginFilter', [['', '모든 원천']].concat(ORIGINS), '');
      const update = () => {
        list.replaceChildren();
        const sources = state.bundle.sources.filter(source => (!origin.input.value || source.origin === origin.input.value) && matchingText([sourceLabel(source), ...state.bundle.sourceVersions.filter(v => v.sourceId === source.id).map(v => v.contentText || '')].join(' ')));
        sources.forEach(source => {
          const version = versionFor(source.id);
          const card = node('article', null, 'life-card');
          card.append(node('p', originName(source.origin), 'life-tag'), node('h3', sourceLabel(source)), node('p', COVERAGE[version.coverage.status] || COVERAGE.unknown, 'life-meta'));
          card.append(node('p', '원문 작성: ' + (version.originalCreatedAt || '모름'), 'life-meta'));
          card.append(button('자료 읽기', guarded(() => navigate('source', { sourceId: source.id, sourceVersionId: version.id, locator: null }))));
          list.append(card);
        });
        if (!sources.length) list.append(empty(state.bundle.sources.length ? '조건에 맞는 자료가 없습니다.' : '보관한 자료가 없습니다. 가져오기에서 선택한 본문·텍스트 파일·링크로 시작하세요.'));
      };
      searchField(main, '제목·본문 찾기', update);
      origin.input.addEventListener('change', update);
      main.append(origin.label, list);
      update();
    }

    function metadata(source, version) {
      const details = node('details', null, 'life-details');
      details.append(node('summary', '출처와 포함 범위'));
      const authorRelation = { self: '내 기록', other: '다른 사람의 기록', unknown: '작성자 관계 미확인' };
      const lines = [originName(source.origin), '원문 작성: ' + (version.originalCreatedAt || '모름'), '가져온 시각: ' + version.importedAt,
        '작성자: ' + (version.originalAuthor.label || '모름') + ' · ' + (authorRelation[version.originalAuthor.relation] || authorRelation.unknown),
        COVERAGE[version.coverage.status] || COVERAGE.unknown,
        '누락/미확인: ' + (version.coverage.omissions.length ? version.coverage.omissions.join(', ') : '별도 표시 없음 · 사진은 자동 수집하지 않음')];
      lines.forEach(text => details.append(node('p', text, 'life-meta')));
      if (source.url) {
        const href = safeUrl(source.url);
        if (href) {
          const link = node('a', '원래 앱 또는 사이트 열기', 'life-external');
          link.href = href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          details.append(link, node('p', '외부 출처는 연결이 필요하며 삭제·비공개 상태일 수 있습니다.', 'life-help'));
        }
      }
      return details;
    }

    function renderSource() {
      state.sourceSelection = null;
      const source = sourceFor(state.sourceId);
      const versions = state.bundle.sourceVersions.filter(v => v.sourceId === state.sourceId);
      const version = versions.find(v => v.id === state.sourceVersionId) || versions.slice(-1)[0];
      if (!source || !version) { main.append(title('자료를 찾을 수 없습니다.'), button('원천 기록으로 돌아가기', guarded(() => navigate('sources')))); return; }
      state.sourceVersionId = version.id;
      main.append(title(sourceLabel(source)), node('p', originName(source.origin) + ' · ' + (COVERAGE[version.coverage.status] || COVERAGE.unknown), 'life-help'));
      main.append(button('모음으로 돌아가기', guarded(() => navigate('topics'))));
      if (versions.length > 1) {
        const choices = selectField('원문 버전', 'lifeVersion', versions.map((v, index) => [v.id, '버전 ' + (index + 1) + ' · ' + v.importedAt]), version.id);
        choices.input.addEventListener('change', guarded(() => navigate('source', { sourceVersionId: choices.input.value, locator: null })));
        main.append(choices.label);
      }
      const layout = node('div', null, 'life-reader-layout');
      const reading = node('section', null, 'life-reading');
      reading.append(metadata(source, version));
      if (version.contentText === null || version.contentText === undefined) {
        reading.append(empty('본문 미확보 · 링크만 보관했습니다. 원래 출처를 열거나 본문을 제공해 새 버전으로 보관할 수 있습니다.'));
        layout.append(reading);
        main.append(layout);
        return;
      }
      const reader = field('보관한 원문 · 발췌할 구절을 선택하세요', 'textarea', 'lifeSourceText', version.contentText);
      reader.input.readOnly = true;
      reader.input.className = 'life-source-text';
      reader.input.spellcheck = false;
      reading.append(reader.label);
      const panel = node('section', null, 'life-excerpt-panel');
      panel.append(node('h3', '발췌와 주제 연결'));
      const picked = node('p', '원문에서 문장을 선택하세요. 키보드의 Shift + 화살표로도 선택할 수 있습니다.', 'life-selection');
      const capture = () => {
        state.sourceSelection = { start: displayToRaw(version.contentText, reader.input.selectionStart), end: displayToRaw(version.contentText, reader.input.selectionEnd) };
        if (state.sourceDrafts.has(version.id)) state.sourceDrafts.get(version.id).range = { ...state.sourceSelection };
        if (state.sourceSelection.start < state.sourceSelection.end) picked.textContent = version.contentText.slice(state.sourceSelection.start, state.sourceSelection.end);
      };
      reader.input.addEventListener('select', capture);
      reader.input.addEventListener('keyup', capture);
      reader.input.addEventListener('pointerup', capture);
      const sourceDraft = state.sourceDrafts.get(version.id) || { topic: '', note: '' };
      const topic = field('주제 (선택)', 'text', 'lifeSourceTopic', sourceDraft.topic);
      const note = field('연결 이유 또는 메모 (선택)', 'textarea', 'lifeSourceNote', sourceDraft.note);
      topic.input.addEventListener('input', () => { sourceDraft.topic = topic.input.value; sourceDraft.range = state.sourceSelection && { ...state.sourceSelection }; state.sourceDrafts.set(version.id, sourceDraft); announce('메모 입력 중 · 아직 모음에 반영하지 않았습니다.'); });
      note.input.addEventListener('input', () => { sourceDraft.note = note.input.value; sourceDraft.range = state.sourceSelection && { ...state.sourceSelection }; state.sourceDrafts.set(version.id, sourceDraft); announce('메모 입력 중 · 아직 모음에 반영하지 않았습니다.'); });
      panel.append(picked, topic.label, note.label, button('선택 구절 모음에 추가', guarded(async () => {
        capture();
        const range = state.sourceSelection;
        if (!range || range.start === range.end) throw new Error('먼저 원문에서 발췌할 구절을 선택해 주세요.');
        const prepared = { source, version, match: { kind: 'exact_duplicate', sourceId: source.id, sourceVersionId: version.id } };
        const changes = core.buildImportChanges(state.bundle, prepared, [{ start: range.start, end: range.end, topic: topic.input.value, note: note.input.value }]);
        state.readerPositions.set(version.id, { start: range.start, end: range.end, scrollTop: reader.input.scrollTop });
        await commit(changes);
        state.sourceDrafts.delete(version.id);
        render();
        announce('모음에 반영됨 · 이 브라우저에 저장됨');
      }), 'life-primary'));
      layout.append(reading, panel);
      main.append(layout);
      const locator = state.locator || state.readerPositions.get(version.id);
      if (locator) requestAnimationFrame(() => {
        if (!reader.input.isConnected) return;
        reader.input.focus({ preventScroll: true });
        reader.input.setSelectionRange(rawToDisplay(version.contentText, locator.start), rawToDisplay(version.contentText, locator.end));
        if (locator.scrollTop !== undefined) reader.input.scrollTop = locator.scrollTop;
        capture();
      });
      state.locator = null;
      reader.input.addEventListener('scroll', () => state.readerPositions.set(version.id, { start: displayToRaw(version.contentText, reader.input.selectionStart), end: displayToRaw(version.contentText, reader.input.selectionEnd), scrollTop: reader.input.scrollTop }));
    }

    function draftExcerptList(parent) {
      const list = node('div', null, 'life-draft-excerpts');
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
      announce('원문과 출처를 확인해 주세요. 아직 자료나 모음에 반영하지 않았습니다.');
    }

    function renderImport() {
      if (!state.stage || state.stage.state !== 'draft') newDraft();
      const input = state.stage.input;
      main.append(title('선택한 기록 가져오기'), node('p', '본문·UTF-8 텍스트 파일·링크 중 필요한 내용만 제공합니다. 원래 앱은 그대로 유지됩니다.', 'life-help'));
      const form = node('form', null, 'life-import-form');
      form.addEventListener('submit', event => event.preventDefault());
      const origin = selectField('원천', 'lifeImportOrigin', ORIGINS, input.origin || 'apple_notes');
      const name = field('제목 (선택)', 'text', 'lifeImportTitle', input.title);
      const url = field('원문 링크 (선택)', 'url', 'lifeImportUrl', input.url);
      url.input.placeholder = 'https://';
      const body = field('가져온 본문', 'textarea', 'lifeImportText', input.text);
      body.input.rows = 10;
      body.input.spellcheck = false;
      const file = field('UTF-8 .txt 또는 .md 파일 (1 MiB까지)', 'file', 'lifeImportFile', '');
      file.input.accept = '.txt,.md,text/plain,text/markdown';
      file.input.addEventListener('change', guarded(async () => {
        const selected = file.input.files[0];
        if (!selected) return;
        if (!/\.(txt|md)$/i.test(selected.name)) throw new Error('UTF-8 .txt 또는 .md 파일을 선택해 주세요.');
        if (selected.size > MAX_TEXT_BYTES) throw new Error('파일이 1 MiB를 넘습니다. 필요한 부분을 선택해 나누어 제공해 주세요.');
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(await selected.arrayBuffer()); }
        catch (_) { throw new Error('UTF-8로 읽을 수 없는 파일입니다. 원래 파일은 변경하지 않았습니다.'); }
        replaceDraftText(text);
        input.fileName = selected.name;
        input.format = /\.md$/i.test(selected.name) ? 'text/markdown' : 'text/plain';
        body.input.value = text;
        changedStage();
        await persistStage();
      }));
      const details = node('details', null, 'life-details');
      details.append(node('summary', '출처 상세·포함 범위 (선택)'));
      const author = field('원문 작성자 (모르면 비워 두기)', 'text', 'lifeImportAuthor', input.author);
      const relation = selectField('작성자 관계', 'lifeImportRelation', [['unknown', '미확인'], ['self', '내 기록 / 내 게시물'], ['other', '다른 사람의 기록 / 내가 저장한 게시물']], input.authorRelation || 'unknown');
      const originalDate = field('원문 작성일 (모르면 비워 두기)', 'date', 'lifeImportDate', input.originalCreatedAt);
      const coverage = selectField('포함한 본문 범위', 'lifeImportCoverage', [['unknown', '미확인'], ['partial', '선택한 본문 일부'], ['full_text', '제공한 본문 전체']], input.coverage && input.coverage.status === 'link_only' ? 'unknown' : input.coverage && input.coverage.status || 'unknown');
      const omissions = field('누락·미확인 항목 (선택)', 'text', 'lifeImportOmissions', (input.omissions || input.coverage && input.coverage.omissions || []).join(', '));
      omissions.input.placeholder = '예: 사진 미보관, 댓글 미포함';
      details.append(author.label, relation.label, originalDate.label, coverage.label, omissions.label);
      const bindings = [[origin.input, 'origin'], [name.input, 'title'], [url.input, 'url'], [body.input, 'text'], [author.input, 'author'], [relation.input, 'authorRelation'], [originalDate.input, 'originalCreatedAt']];
      bindings.forEach(([element, key]) => element.addEventListener('input', () => {
        if (key === 'text') replaceDraftText(element.value);
        else input[key] = element.value;
        delete input.existingSourceId;
        delete input.forceSeparate;
        changedStage();
      }));
      coverage.input.addEventListener('change', () => { input.coverage = { status: coverage.input.value, omissions: input.omissions || [] }; changedStage(); });
      omissions.input.addEventListener('input', () => { input.omissions = omissions.input.value.split(',').map(x => x.trim()).filter(Boolean); input.coverage = { status: coverage.input.value, omissions: input.omissions }; changedStage(); });
      const actions = node('div', null, 'life-actions');
      actions.append(button('원문·출처 확인', guarded(prepareStage), 'life-primary'), button('검토 내용 보관', guarded(() => persistStage(true))), button('다른 기록 가져오기', guarded(async () => {
        if (dirty()) await persistStage();
        newDraft();
        render();
      })));
      form.append(origin.label, name.label, file.label, body.label, url.label, details, actions);
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
      if (state.prepared) renderPrepared();
      const cancel = button('이 검토 취소', guarded(async () => {
        if (!global.confirm('아직 적용하지 않은 검토 내용을 삭제할까요? 이미 보관한 자료는 그대로 유지됩니다.')) return;
        if (stageTimer) clearTimeout(stageTimer);
        await saveChain.catch(() => {});
        await storage.deleteStage(state.stage.stageId);
        state.stage = null;
        state.prepared = null;
        state.editTick = state.savedTick = 0;
        await refreshData();
        await navigate('topics');
        announce('미적용 검토만 취소했습니다. 보관한 자료는 그대로 유지됩니다.');
      }));
      main.append(cancel);
    }

    function renderPrepared() {
      const prepared = state.prepared;
      const section = node('section', null, 'life-review');
      section.append(node('h3', '원문과 출처 확인'), metadata(prepared.source, prepared.version));
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
        const selected = node('p', '필요한 구절을 선택해 발췌 후보로 추가할 수 있습니다.', 'life-selection');
        const capture = () => {
          state.stageSelection = { start: displayToRaw(prepared.version.contentText, reader.input.selectionStart), end: displayToRaw(prepared.version.contentText, reader.input.selectionEnd) };
          if (state.stageSelection.start < state.stageSelection.end) selected.textContent = prepared.version.contentText.slice(state.stageSelection.start, state.stageSelection.end);
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
          capture();
          const range = state.stageSelection;
          if (!range || range.start === range.end) throw new Error('원문에서 구절을 먼저 선택해 주세요.');
          state.stage.excerpts.push({ start: range.start, end: range.end, topic: topic.input.value, note: note.input.value });
          state.stage.draftTopic = state.stage.draftNote = '';
          state.editTick += 1;
          await persistStage();
          render();
        }));
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
        await commit(changes, snapshot);
        const retained = fresh.source.id;
        state.stage = null;
        state.prepared = null;
        state.savedTick = state.editTick = 0;
        if (excerpts.length) await navigate('topics');
        else await navigate('source', { sourceId: retained, sourceVersionId: fresh.version.id, locator: null });
        announce((excerpts.length ? '모음에 반영됨' : '자료 보관됨') + ' · 이 브라우저에 저장됨');
      };
      const storeOnly = button('자료만 보관', guarded(() => apply([])));
      storeOnly.disabled = unresolved;
      controls.append(storeOnly);
      if (state.stage.excerpts.length) {
        const applyAll = button('선택한 발췌 모음에 반영', guarded(() => apply(state.stage.excerpts.slice())), 'life-primary');
        applyAll.disabled = unresolved;
        controls.append(applyAll);
      }
      section.append(controls);
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

    function renderTransfer() {
      main.append(title('내보내기·사본 복원'), node('p', '현재 작업공간의 확정 자료·본문·발췌·메모·출처를 파일로 옮깁니다. 개인 내용이 포함되며 자동 공개하지 않습니다.', 'life-help'));
      main.append(node('p', '현재 계정의 이 작업공간만 포함합니다. 미적용 검토 항목과 보관하지 않은 사진·원격 본문, 연표·목표·습관은 포함되지 않습니다. 내 공간 백업과 별개입니다.', 'life-help'));
      const actions = node('div', null, 'life-actions');
      const stamp = new Date().toISOString().slice(0, 10);
      actions.append(button('JSON 백업', guarded(async () => {
        const backup = await core.makeBackup(state.bundle);
        download(JSON.stringify(backup, null, 2), 'life-tools-' + stamp + '.json', 'application/json');
      })), button('Markdown 내보내기', guarded(async () => {
        download(await core.toMarkdown(state.bundle), 'life-tools-' + stamp + '.md', 'text/markdown;charset=utf-8');
      })));
      main.append(actions);
      const restore = field('JSON 백업을 새 작업공간 사본으로 복원', 'file', 'lifeRestoreFile', '');
      restore.input.accept = '.json,application/json';
      const preview = node('div', null, 'life-restore-preview');
      let candidate = null;
      restore.input.addEventListener('change', guarded(async () => {
        candidate = null;
        preview.replaceChildren();
        const file = restore.input.files[0];
        if (!file) return;
        let parsed;
        try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())); }
        catch (_) { throw new Error('JSON 백업을 읽을 수 없습니다. 원래 파일과 현재 작업공간은 그대로 유지됩니다.'); }
        candidate = await core.restoreBackup(parsed);
        preview.append(node('p', '검증된 사본: 자료 ' + candidate.sources.length + '개 · 원문 버전 ' + candidate.sourceVersions.length + '개 · 발췌 ' + candidate.records.length + '개'));
        preview.append(button('새 사본으로 복원', guarded(async () => {
          if (dirty()) await persistStage();
          await storage.installWorkspace(candidate);
          state.bundle = await storage.read(candidate.workspaceId);
          state.stage = null;
          state.prepared = null;
          state.topic = state.search = '';
          state.mode = 'topics';
          await refreshData();
          connectSubscription();
          render();
          announce('새 작업공간 사본을 열었습니다. 이전 작업공간은 그대로 유지됩니다. 자동 동기화는 연결하지 않았습니다.');
        }), 'life-primary'));
      }));
      main.append(restore.label, preview, node('p', '다른 기기로 옮긴 백업은 별도 사본입니다. 여러 기기의 변경이 서로 자동 반영되지 않습니다.', 'life-help'));
      const workspaceName = field('새 작업공간 이름', 'text', 'lifeNewWorkspaceName', '');
      main.append(workspaceName.label, button('빈 작업공간 만들기', guarded(async () => {
        if (dirty()) await persistStage();
        const created = await storage.createWorkspace(workspaceName.input.value || '새 작업공간');
        await storage.setActive(created.workspaceId);
        state.bundle = created;
        state.stage = null;
        state.prepared = null;
        state.topic = state.search = '';
        state.mode = 'topics';
        await refreshData();
        connectSubscription();
        render();
        announce('빈 작업공간을 만들었습니다. 이전 기록은 유지됩니다.');
      })));
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
            const copy = await storage.importUnownedWorkspace(choice.input.value);
            if (disposed) return;
            await storage.setActive(copy.workspaceId);
            state.bundle = copy;
            state.stage = state.prepared = null;
            state.topic = state.search = '';
            state.mode = 'topics';
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
      main.append(title('시간 보기'), node('p', '기존 연표를 별도로 열어 시간의 흐름을 봅니다. 가져온 작성일을 경험일로 자동 변환하지 않습니다.', 'life-help'));
      main.append(node('p', '현재 계정의 연표만 확인합니다. 선택한 연표를 별도 화면에서 엽니다.', 'life-help'));
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
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
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
      const focusedName = panel.contains(document.activeElement) ? document.activeElement.textContent : null;
      panel.replaceChildren();
      const heading = node('h3', '현재 작업공간');
      heading.tabIndex = -1;
      panel.append(heading, node('p', state.bundle.title, 'life-note'));
      panel.append(node('p', '로컬 자료: 이 브라우저에 저장됨 · 검토 중 입력은 별도 임시 보관', 'life-meta'));
      const remoteStatus = node('p', syncSummary(), 'life-sync-status');
      remoteStatus.id = 'lifeSyncStatus';
      remoteStatus.setAttribute('role', 'status');
      panel.append(remoteStatus);
      if (state.syncReadError) {
        panel.append(node('p', state.syncReadError.message || '동기화 상태를 읽지 못했습니다. 미연결 상태로 바꾸지 않았습니다.', 'life-error'));
        if (focusedName) heading.focus({ preventScroll: true });
        return;
      }
      const info = state.syncState;
      const account = state.syncAccount;
      const accountInfo = node('div', null, 'life-sync-account');
      if (account) accountInfo.append(node('p', '현재 계정: ' + (account.email || '로그인한 계정')), node('p', '프로젝트: ' + account.projectUrl, 'life-meta'));
      else accountInfo.append(node('p', '현재 계정: 로그인하지 않음', 'life-meta'));
      panel.append(accountInfo);
      if (info && info.binding) panel.append(node('p', '이 작업공간의 연결 프로젝트: ' + info.binding.projectUrl, 'life-meta'));
      if (account && info && info.binding && (info.binding.userId !== account.userId || info.binding.projectUrl !== account.projectUrl)) panel.append(node('p', '다른 계정에 연결된 자료입니다. 기존 연결을 바꾸지 않습니다. 다른 계정으로 옮기려면 백업을 새 작업공간 사본으로 복원하세요.', 'life-help'));
      if (info && info.error) panel.append(node('p', info.error.message || '동기화에 실패했습니다. 로컬 자료를 유지합니다.', 'life-error'));
      const actions = node('div', null, 'life-actions');
      const matching = account && (!info || !info.binding || (info.binding.projectUrl === account.projectUrl && info.binding.userId === account.userId));
      if (matching && (!info || !info.binding || !info.enabled)) actions.append(button('이 작업공간 동기화 시작', guarded(async () => {
        await syncAction(() => sync.enable(state.bundle.workspaceId), '이 작업공간의 동기화를 시작했습니다. 로컬 저장과 서버 상태는 별도로 확인할 수 있습니다.');
      }), 'life-primary'));
      if (matching && info && info.binding && info.enabled) {
        actions.append(button('지금 동기화', guarded(async () => {
          await syncAction(() => sync.syncNow(state.bundle.workspaceId), '', true);
          announce(syncSummary() + ' · 이 브라우저의 자료는 유지됩니다.');
        })), button('연결 중지', guarded(async () => {
          await syncAction(() => sync.pause(state.bundle.workspaceId), '이 작업공간의 동기화를 중지했습니다. 로컬 자료와 이전 연결 정보는 유지됩니다.');
        })));
      }
      if (account && !auth) actions.append(button('로그아웃', guarded(async () => {
        state.remoteRows = null;
        state.remoteRowsAccountKey = null;
        state.conflictView = null;
        updateSyncPanels();
        await (auth ? auth.signOut() : sync.signOut());
      })));
      panel.append(actions);
      if (info && info.conflict) panel.append(button('양쪽 변경 비교', guarded(async () => {
        if (dirty()) await persistStage();
        await refreshData();
        await refreshSync();
        if (!state.syncState || !state.syncState.conflict) return;
        state.conflictView = { workspaceId: state.bundle.workspaceId, local: structuredClone(state.bundle), remote: structuredClone(state.syncState.conflict), accountKey: state.syncAccountKey };
        renderConflict();
        const comparisonHeading = main.querySelector('#lifeSyncConflict h3');
        if (comparisonHeading) { comparisonHeading.tabIndex = -1; comparisonHeading.focus(); }
      })));
      if (state.conflictCopyId) {
        const copy = state.workspaces.find(item => item.workspaceId === state.conflictCopyId);
        panel.append(node('p', '선택하지 않은 쪽의 사본: ' + (copy ? copy.title : '작업공간 목록에서 확인'), 'life-help'));
        panel.append(button('보존한 사본 열기', guarded(async () => {
          if (dirty()) await persistStage();
          await storage.setActive(state.conflictCopyId);
          state.bundle = await storage.read(state.conflictCopyId);
          state.stage = state.prepared = null;
          state.topic = state.search = '';
          state.mode = 'topics';
          await refreshData();
          connectSubscription();
          await refreshSync();
          render();
          announce('보존한 사본을 열었습니다. 이 사본을 다른 계정이나 서버에 자동 연결하지 않았습니다.');
        })));
      }
      if (focusedName) {
        const replacement = Array.from(panel.querySelectorAll('button')).find(item => item.textContent === focusedName);
        (replacement || heading).focus({ preventScroll: true });
      }
    }

    function fillRemoteList(parent) {
      if (disposed) return;
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
      if (state.remoteRows === null || state.remoteRowsAccountKey !== accountKey) return;
      if (!state.remoteRows.length) { parent.append(empty('이 계정에 보관된 서버 작업공간이 없습니다.')); return; }
      state.remoteRows.forEach(row => {
        const card = node('article', null, 'life-card');
        card.append(node('h4', row.title || '제목 없는 작업공간'), node('p', '서버 버전 ' + row.revision + ' · ' + (row.updated_at || '시각 미확인'), 'life-meta'));
        card.append(button('이 작업공간 받기', guarded(async () => {
          if (dirty()) await persistStage();
          const before = state.syncAccountKey;
          const received = await sync.download(row.id);
          await refreshSync();
          if (before !== state.syncAccountKey) throw new Error('계정이 바뀌어 이전 화면으로 전환하지 않았습니다. 로컬 자료는 유지됩니다.');
          if (!received || !received.workspaceId) throw new Error('받은 작업공간을 확인하지 못했습니다. 기존 자료를 유지합니다.');
          const downloaded = await storage.read(received.workspaceId);
          await storage.setActive(received.workspaceId);
          state.bundle = downloaded;
          state.stage = state.prepared = null;
          state.topic = state.search = '';
          state.mode = 'topics';
          await refreshData();
          connectSubscription();
          await refreshSync();
          render();
          announce('선택한 서버 작업공간을 받았습니다. 기존 로컬 작업공간은 그대로 유지됩니다.');
        })));
        parent.append(card);
      });
    }

    function renderSync() {
      main.append(title('기기 간 동기화'), node('p', 'Mac·iPad·iPhone에서 같은 계정의 자료를 이어 봅니다. 로그인만으로 로컬 자료를 올리지 않습니다.', 'life-help'));
      const panel = node('section', null, 'life-sync-state-panel');
      panel.id = 'lifeSyncState';
      main.append(panel);
      fillSyncState(panel);
      main.append(node('p', '내 공간과 같은 Google 계정을 사용합니다. 계정을 바꾸려면 로그아웃 후 다시 로그인하세요.', 'life-help'), syncHelp());
      const remoteSection = node('section', null, 'life-remote-section');
      remoteSection.append(node('h3', '서버 작업공간'));
      const list = node('div', null, 'life-remote-list');
      list.id = 'lifeRemoteList';
      remoteSection.append(list);
      main.append(remoteSection);
      fillRemoteList(list);
      const conflict = node('section', null, 'life-conflict-section');
      conflict.id = 'lifeSyncConflict';
      main.append(conflict);
      if (state.conflictView) renderConflict();
    }

    function conflictSide(label, bundle) {
      const card = node('section', null, 'life-card');
      card.append(node('h4', label), node('p', bundle.title, 'life-note'), node('p', '원천 ' + bundle.sources.length + '개 · 원문 버전 ' + bundle.sourceVersions.length + '개 · 발췌 ' + bundle.records.length + '개', 'life-meta'));
      bundle.sourceVersions.forEach(version => {
        const source = bundle.sources.find(item => item.id === version.sourceId);
        const details = node('details', null, 'life-details life-conflict-text');
        details.append(node('summary', source ? sourceLabel(source) : '원문'));
        details.append(node('p', '가져온 시각: ' + new Date(version.importedAt).toLocaleString('ko-KR'), 'life-meta'));
        details.append(node('p', '원문 작성: ' + (version.originalCreatedAt || '모름') + ' · ' + (source ? originName(source.origin) : '원천 미확인'), 'life-meta'));
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
      if (!view || view.workspaceId !== state.bundle.workspaceId || view.accountKey !== state.syncAccountKey) return;
      parent.append(node('h3', '양쪽 변경 비교'));
      if (view.remote.missing || !view.remote.row) { parent.append(empty('서버의 작업공간을 찾을 수 없습니다. 자동으로 다시 생성하지 않습니다. 로컬 백업 또는 연결 중지를 선택해 주세요.')); return; }
      const row = view.remote.row;
      parent.append(node('p', '이 브라우저 버전 ' + view.local.revision + ' · 서버 버전 ' + row.revision + '. 선택하지 않은 쪽도 별도 작업공간 사본으로 보관합니다.', 'life-help'));
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
        const result = await sync.resolve(view.workspaceId, choice, { expectedLocalRevision: view.local.revision, expectedRemoteRevision: row.revision });
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
      actions.append(button('서버 변경 받기 · 내 변경은 사본 보관', guarded(() => resolve('remote')), 'life-primary'), button('내 변경 보내기 · 서버 변경은 사본 보관', guarded(() => resolve('local'))));
      parent.append(actions);
    }

    function render() {
      if (disposed) return;
      renderHeader();
      main.replaceChildren();
      if (state.mode === 'import') renderImport();
      else if (state.mode === 'source') renderSource();
      else if (state.mode === 'sources') renderSources();
      else if (state.mode === 'transfer') renderTransfer();
      else if (state.mode === 'time') renderTime();
      else if (state.mode === 'sync' && sync) renderSync();
      else renderTopics();
      const scope = node('p', '이 브라우저의 개인 작업공간 · ' + syncSummary(), 'life-scope');
      main.append(scope);
    }

    const beforeUnload = event => {
      if (dirty() || state.sourceDrafts.size) { event.preventDefault(); event.returnValue = ''; }
    };
    const visibility = () => { if (document.hidden && dirty()) persistStage().catch(failure); };
    global.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', visibility);
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
      const first = await storage.createWorkspace('내 자료');
      active = first.workspaceId;
      await storage.setActive(active);
    }
    if (disposed) return { dispose };
    if (active) {
      state.bundle = await storage.read(active);
      await refreshData();
      connectSubscription();
      render();
      announce('이 브라우저에 보관한 자료를 열었습니다.');
      if (sync) await refreshSync();
    } else {
      header.append(node('h1', '자료 모아보기'));
      main.append(title('보관한 작업공간 선택'));
      const choice = selectField('작업공간', 'lifeWorkspaceChoice', state.workspaces.map(w => [w.workspaceId, w.title]), state.workspaces[0].workspaceId);
      main.append(choice.label, button('선택한 작업공간 열기', guarded(async () => {
        await storage.setActive(choice.input.value);
        state.bundle = await storage.read(choice.input.value);
        await refreshData();
        connectSubscription();
        render();
        announce('선택한 작업공간을 열었습니다. 다른 기록은 그대로 유지됩니다.');
      })));
      announce('현재 작업공간을 선택하지 않았습니다. 보관한 목록에서 선택해 주세요.');
    }
    return { dispose, flushDraft };

    async function flushDraft() {
      if (disposed) throw new Error('계정이 바뀌어 이전 초안을 보관할 수 없습니다.');
      if (state.busy) throw new Error('자료를 처리 중입니다. 작업이 끝난 뒤 로그아웃을 다시 선택해 주세요.');
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
      root.replaceChildren();
      root.remove();
      state.sourceDrafts.clear();
      state.readerPositions.clear();
      state.bundle = state.stage = state.prepared = state.conflictView = state.remoteRows = null;
      if (stageTimer) clearTimeout(stageTimer);
      if (unsubscribe) unsubscribe();
      if (unsubscribeSync) unsubscribeSync();
      if (sync && typeof sync.dispose === 'function') sync.dispose();
      global.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('visibilitychange', visibility);
      downloadUrls.forEach(url => URL.revokeObjectURL(url));
      downloadUrls.clear();
      signal?.removeEventListener('abort', dispose);
    }
  }

  global.HaedoLife = global.HaedoLife || {};
  global.HaedoLife.UI = Object.freeze({ mount });
})(globalThis);

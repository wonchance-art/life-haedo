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

  async function mount(container, { storage, core, legacy, sync, compositionSync, libraryMetaSync, accountLibrary, bootstrap, writingSync, auth, signal }) {
    if (signal?.aborted) throw new Error('화면 연결이 취소되었습니다.');
    let disposed = false;
    let unsubscribe = null;
    let unsubscribeSync = null;
    let unsubscribeLibrary = null, libraryState = null, libraryRefresh = 0;
    let workspaceListRefresh = 0, workspaceListApplied = 0;
    const deferredWorkspaceChoices = new WeakSet();
    const managedLibrary = !!accountLibrary && !bootstrap?.legacy;
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
    let externalImportContext = null;
    let writingOpenOptions = null, sourceEditOpenOptions = null, sourceEditOrigin = null;
    let navigationGeneration = 0;
    let renderGeneration = 0;
    let navigationRender = null, mainRenderPromise = Promise.resolve(), inputGeneration = 0;
    const sectionPositions = new Map();
    let homeRenderPromise = Promise.resolve();
    let homeRenderOptions = null, blogPageTask = false, blogMode = null, blogCommitted = null, materialWritingTask = false;
    const sourceWritingRequests = new Map(), sourceStateRequests = new Map();
    let blogEntryScroll = null;
    let navigationTrigger = null;
    const viewOrigins = new Map();
    let findRenderPromise = Promise.resolve();
    let collectionOpenOptions = null;
    let blogManager = null, blogOpenOptions = null, blogManagerWorkspace = null, blogManagerPostId = null;
    let preservationOpenOptions = null, pendingPostReturn = null;
    let accountBlogUI = null, accountBlogWorkspace = null;
    const accountBlogViews = new Map();
    let preservationUI = null, publicCoverUI = null, naverBlogUI = null, naverBlogService = null, naverBlogWorkspace = null;
    let naverCaptureUI = null, naverCaptureService = null, naverReaderService = null, naverPhotoView = null, naverCaptureTarget = null;
    let obsidianUpdateUI = null, originalAttachmentsUI = null;
    let sourceFoldersUI = null, sourceFoldersWorkspace = null, sourceFoldersMount = null, sourceFoldersUpdate = null;
    let accountMaterials = null, accountMaterialsFailure = null, accountMaterialsSequence = 0;
    const accountMaterialsNotice = '계정 자료를 확인하지 못했습니다. 이 브라우저의 자료는 그대로 사용할 수 있습니다.';
    const accountMaterialsPartialNotice = '일부 계정 자료는 확인했습니다. 나머지는 다시 확인해 주세요. 이 브라우저의 자료는 그대로 유지됩니다.';
    const blogViews = new Map(), naverBlogViews = new Map();
    const blogSync = global.HaedoLife.BlogSync?.create({ storage, auth });
    const parentViews = new Set(['naver-capture', 'naver-blog', 'external-discovery', 'interests', 'blog', 'account-blog', 'find', 'home', 'sources', 'topics', 'tools', 'manage']);
    const subviewTitles = { 'annual-plan': '연간 계획', 'source-trash': '자료 휴지통', 'source-edit': '자료 수정', 'naver-capture': '네이버 본문·사진 검토', 'naver-blog': '네이버 블로그 연결', 'account-blog': '서버에 보관한 글', 'public-cover': '공개 표지', 'external-discovery': '새 글 찾기', interests: '관심 주제 편집', 'obsidian-update': 'Obsidian 갱신', preservation: '보관 범위·근거 파일', blog: '글 공개·보관', find: '통합 검색', collection: '컬렉션', import: '가져오기', write: '자료 작성', time: '연표', activities: '묶음', page: '선택 자료 페이지',
      discover: '다시 찾기', reflection: '회고', books: '내 책', sync: managedLibrary ? '계정 보관' : '기기 간 동기화', transfer: '자료 백업·복원',
      'workbench-backup': '자료·구성 백업', 'public-pages': '공개 페이지 관리' };
    const selectedVersions = new Set();
    let selectionReturn = null;
    let relatedOrigin = null;
    let naverMediaOrigin = null, naverMediaReturn = null;
    const obsidianReaderOrigins = [];
    let compositionPanel = null, metadataCleanup = null;
    const downloadUrls = new Set();
    const state = {
      bundle: null, workspaces: [], mode: 'sources', topic: '', topicsSearch: '', sourcesSearch: '', originFilter: '', folderFilter: 'all', returnContext: null, suppressReaderResume: false, sourceId: null,
      sourceVersionId: null, locator: null, stage: null, prepared: null, importMethod: 'text', topicUnassigned: false, topicFilterSearch: '',
      busy: false, editTick: 0, savedTick: 0, stageFailed: false, status: '', error: '',
      pendingOperation: null, stageSelection: null, sourceSelection: null, stages: [], allStages: [], sourceEditStages: [], batches: new Map(), batchId: null,
      remoteChanged: false, readerPositions: new Map(), sourceDrafts: new Map(), readerModes: new Map(),
      syncAccount: null, syncState: null, syncReadError: null, syncAccountKey: null, syncWorkspaceId: null,
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
    const planningNavigation = node('div', null, 'life-planning-navigation');
    planningNavigation.hidden = true;
    const main = node('main', null, 'life-main');
    main.id = 'lifeMain';
    const skip = node('a', '본문으로 이동', 'life-skip');
    skip.href = '#lifeMain';
    const libraryStatus = node('section', null, 'life-account-storage'); libraryStatus.id = 'lifeAccountStorage'; libraryStatus.hidden = !managedLibrary;
    const libraryStatusText = node('span', '', 'life-meta'); libraryStatusText.id = 'lifeAccountStorageStatus'; libraryStatusText.setAttribute('role', 'status'); libraryStatusText.setAttribute('aria-live', 'polite');
    const libraryRetry = button('다시 시도', guarded(async () => { await accountLibrary.retry(state.bundle?.workspaceId); await refreshLibrary(); })); libraryRetry.id = 'lifeAccountStorageRetry'; libraryRetry.hidden = true;
    const libraryReview = button('변경 확인', guarded(() => navigate('sync'))); libraryReview.id = 'lifeAccountStorageReview'; libraryReview.hidden = true;
    libraryStatus.append(libraryStatusText, libraryRetry, libraryReview);
    root.append(skip, header, toolbar, planningNavigation, libraryStatus, status, error, main);
    container.replaceChildren(root);
    const interestUI = global.HaedoLife.InterestUI?.create({ container: main, storage,
      getBundle: () => state.bundle, isCurrent: () => !disposed && state.mode === 'interests',
      onOpenEvidence: async (entry, focusKey) => {
        const workspaceId = state.bundle.workspaceId, token = navigationGeneration;
        const bundle = await storage.read(workspaceId);
        if (disposed || state.mode !== 'interests' || state.bundle.workspaceId !== workspaceId || token !== navigationGeneration) return;
        const version = bundle.sourceVersions.find(v => v.id === entry.sourceVersionId && v.sourceId === entry.sourceId);
        if (!version || typeof version.contentText !== 'string' || version.contentHash !== entry.sha256 ||
            version.contentText.slice(entry.start, entry.end) !== entry.quote ||
            Array.from(new Uint8Array(await global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(version.contentText))), n => n.toString(16).padStart(2, '0')).join('') !== entry.sha256)
          throw new Error('근거 원문이 바뀌었습니다. 다른 버전으로 열지 않았습니다.');
        if (disposed || state.mode !== 'interests' || token !== navigationGeneration) return;
        state.bundle = bundle;
        return openResult('interests', focusKey, { sourceId: entry.sourceId, sourceVersionId: entry.sourceVersionId,
          locator: { start: entry.start, end: entry.end } });
      }
    });
    const editingInput = () => { naverMediaReturn = null; inputGeneration += 1; global.HaedoMotion?.cancel(main); };
    const annualPlanUI = global.HaedoLife.AnnualPlanUI?.create({ container: main, storage,
      getBundle: () => state.bundle, isCurrent: () => !disposed && state.mode === 'annual-plan' });
    let newsReaderBackPending = false;
    const privateDiscovery = storage.isAccountScoped && global.HaedoLife.DiscoveryPrivateRemote?.create
      ? global.HaedoLife.DiscoveryPrivateRemote.create({ auth, storage,
        isCurrent: workspaceId => !disposed && state.mode === 'external-discovery' && state.bundle?.workspaceId === workspaceId }) : null;
    const externalDiscoveryUI = global.HaedoLife.DiscoveryUI?.create({ container: main, storage,
      getBundle: () => state.bundle, isCurrent: () => !disposed && state.mode === 'external-discovery',
      loadPrivateArticle: privateDiscovery?.loadPrivateArticle,
      onOpenInterests: () => navigate('interests'),
      onReaderOpen: () => {
        if (disposed || state.mode !== 'external-discovery') return;
        // A same-route entry makes browser Back return to the list. Article
        // content and private account/workspace identifiers never enter history.
        global.history.pushState({ haedoNewsReader: true }, '', global.location.href);
      },
      onReaderClose: ({ fromHistory }) => {
        if (fromHistory || disposed || global.history.state?.haedoNewsReader !== true) return;
        newsReaderBackPending = true;
        global.history.back();
      },
      onImport: (article, context = {}) => {
        if (disposed || state.mode !== 'external-discovery') return;
        return navigate('import', { externalImport: { article, workspaceId: state.bundle.workspaceId,
          focusKey: context.focusKey, scrollY: context.scrollY ?? global.scrollY } });
      }
    });
    main.addEventListener('input', editingInput);
    main.addEventListener('compositionstart', editingInput);
    main.addEventListener('pointerdown', editingInput);
    main.addEventListener('keydown', editingInput);
    main.addEventListener('wheel', editingInput, { passive: true });
    const collection = global.HaedoLife.CollectionUI?.create({ storage, host: main, getBundle: () => state.bundle, isDisposed: () => disposed, onSaved: clearError });
    const unifiedSearch = global.HaedoLife.UnifiedSearchUI.create({ storage, host: main, getBundle: () => state.bundle, isDisposed: () => disposed, onReload: clearError,
      onOpen: guarded(async row => {
        const workspaceId = state.bundle.workspaceId;
        if (row.kind === 'source') {
          const workspaceToken = workspaceGeneration, navigationToken = navigationGeneration;
          const fetched = await storage.read(workspaceId);
          if (disposed || workspaceToken !== workspaceGeneration || navigationToken !== navigationGeneration ||
              state.mode !== 'find' || state.bundle?.workspaceId !== workspaceId) return;
          // Exact search reading only needs this workspace's originals. Unrelated
          // workspace/staging failures must not prevent opening a verified version.
          if (fetched.revision >= state.bundle.revision) state.bundle = fetched;
          if (!state.bundle.sourceVersions.some(v => v.id === row.sourceVersionId && v.sourceId === row.sourceId)) throw new Error('이 원문 버전을 찾을 수 없습니다. 검색 결과를 다시 불러와 주세요.');
          return openResult('find', row.key, row);
        }
        if (row.kind === 'page') {
          if (row.photoPostId) {
            const token = navigationGeneration, photo = await storage.readPhotoPost(workspaceId, row.photoPostId);
            if (disposed || token !== navigationGeneration || state.mode !== 'find' || state.bundle?.workspaceId !== workspaceId) return;
            if (photo.status !== 'saved') throw new Error('저장한 사진 글을 찾을 수 없습니다. 검색 결과를 다시 불러와 주세요.');
          }
          return navigate('page', { pagePreview: false, searchTarget: { postId: row.postId, entryId: row.entryId, photoPostId: row.photoPostId } });
        }
        if (row.kind === 'nine') {
          const token = navigationGeneration;
          const values = await storage.readNineBoard(workspaceId);
          if (disposed || token !== navigationGeneration || state.mode !== 'find' || state.bundle?.workspaceId !== workspaceId) return;
          global.HaedoLife.UnifiedSearch.resolveNineTarget(values, row.nineTarget);
          return navigate('page', { nineTarget: row.nineTarget });
        }
        return navigate('collection', { collectionItemId: row.itemId });
      }) });
    const workbenchModes = ['activities', 'page', 'discover', 'related', 'reflection', 'books', 'workbench-backup', 'public-pages'];
    const workbench = global.HaedoLife.WorkbenchUI?.create({
      storage, core, host: main, getBundle: () => state.bundle, blogSync, managed: managedLibrary,
      onManagePost: (postId, options) => openPostAction('blog', postId, options),
      onPreservePost: (postId, options) => openPostAction('preservation', postId, options),
      onOpenAccountBlog: options => navigate('account-blog', { originFocusKey: options?.originFocusKey }),
      isDisposed: () => disposed, announce, onLocalSaved: clearError,
      onBundleUpdated: bundle => {
        if (disposed || state.bundle?.workspaceId !== bundle.workspaceId || bundle.revision < state.bundle.revision) return;
        state.bundle = bundle; state.remoteChanged = false; resetSearchContext(); renderHeader();
      },
      onBlogReturn: returnFromBlog,
      onBlogModeChange: context => {
        if (disposed || state.mode !== 'page') return;
        restorePostReturn(context);
        if (materialWritingTask) {
          blogMode = ['edit', 'read'].includes(context.mode) ? context.mode : null;
          renderHeader(); global.requestAnimationFrame(syncWritingFocus); return;
        }
        if (!blogPageTask || !['edit', 'read', 'profile'].includes(context.mode)) { global.requestAnimationFrame(syncWritingFocus); return; }
        const previousMode = blogMode;
        blogMode = context.mode;
        if (context.committed && context.id) blogCommitted = { kind: context.kind === 'legacy' ? 'plain' : context.kind, id: context.id, committed: true };
        renderHeader();
        const entryScroll = blogEntryScroll;
        blogEntryScroll = null;
        if (entryScroll) requestAnimationFrame(entryScroll);
        // PhotoPostUI owns its internal read/edit surface. Legacy page tasks
        // finish their redraw in this turn, without rebuilding the app chrome.
        if (context.kind !== 'photo' && previousMode && previousMode !== blogMode && navigationRender === null) {
          const navigation = navigationGeneration, generation = renderGeneration, workspace = workspaceGeneration;
          const workspaceId = state.bundle?.workspaceId, account = state.syncAccountKey, input = inputGeneration, mode = blogMode;
          requestAnimationFrame(() => {
            if (disposed || navigation !== navigationGeneration || generation !== renderGeneration || workspace !== workspaceGeneration ||
                state.bundle?.workspaceId !== workspaceId || account !== state.syncAccountKey || state.mode !== 'page' || blogMode !== mode || input !== inputGeneration || state.error) return;
            global.HaedoMotion?.enter(main, { kind: mode === 'edit' || mode === 'profile' ? 'compose' : context.committed ? 'reveal' : 'back' });
          });
        }
      },
      onSelectionUsed: ({ workspaceId, versionIds }) => {
        if (disposed || state.bundle?.workspaceId !== workspaceId) return;
        const consumed = selectionReturn?.workspaceId === workspaceId ? selectionReturn.versionIds : versionIds;
        consumed.forEach(id => selectedVersions.delete(id));
        if (!selectedVersions.size) state.selecting = false;
        selectionReturn = null;
      },
      onSelectionCancel: returnFromArrange,
      onChapterImport: beginChapterImport,
      onWorkbenchNavigate: ({ workspaceId, mode, planOpen = false, pageDraftId = null }) => {
        if (disposed || state.bundle?.workspaceId !== workspaceId || !['reflection', 'books', 'page'].includes(mode)) return;
        return navigate(mode, { planOpen, pageDraftId });
      },
      onArrange: ({ workspaceId, versionIds, focusId }) => {
        if (disposed || state.bundle?.workspaceId !== workspaceId || !['discover', 'related', 'reflection'].includes(state.mode)) return;
        return arrangeRecords('activities', [...new Set(versionIds)], focusId);
      },
      openSource: (sourceId, versionId, options = {}) => navigate('source', {
        sourceId, sourceVersionId: versionId, locator: options.locator || null,
        returnContext: { mode: state.mode, workspaceId: state.bundle.workspaceId, scrollY: global.scrollY, focusKey: options.focusKey }
      }),
      beforeRestore: () => persistDrafts(),
      onRestored: async ({ bundle, workbench: restored }) => {
        if (disposed) return;
        const previousId = state.bundle.workspaceId;
        invalidateBatchContext();
        state.bundle = bundle;
        state.stage = state.prepared = state.sourceId = state.sourceVersionId = null;
        state.sourceDrafts.clear();
        state.readerPositions.clear(); state.readerModes.clear();
        state.stages = state.allStages = []; state.sourceEditStages = [];
        state.restoreReturn = { previousId, copyId: bundle.workspaceId };
        state.remoteChanged = false;
        resetSearchContext();
        const hasBooks = !!restored?.books?.length;
        state.mode = hasBooks ? 'books' : 'page';
        workbenchOpenOptions = hasBooks ? { bookList: true } : null;
        const workspaceToken = workspaceGeneration, navigationToken = navigationGeneration, mode = state.mode;
        const current = () => !disposed && state.bundle?.workspaceId === bundle.workspaceId &&
          workspaceToken === workspaceGeneration && navigationToken === navigationGeneration && state.mode === mode;
        connectSubscription();
        // The transaction already committed. Show its copy before refreshing the
        // workspace list, and never steal a newer screen or its keyboard focus.
        await render();
        if (!current()) return;
        global.scrollTo({ top: 0, behavior: 'instant' });
        main.querySelector('#lifeRestoreResult h3')?.focus({ preventScroll: true });
        announce('자료와 구성을 새 사본으로 열었습니다. 이전 작업공간은 그대로 보관됩니다.', { quiet: true });
        try { await refreshData(); }
        catch (_) { if (current()) announce('사본은 저장됐습니다. 작업공간 목록은 다시 열 때 확인해 주세요.'); }
      }
    });

    const home = global.HaedoLife.HomeUI?.create({
      storage, core, host: main, getBundle: () => state.bundle,
      isDisposed: () => disposed, announce, navigate: (mode, options = {}) => navigate(mode, mode === 'page' && (options.pageCompose || options.pageProfileEdit || options.pageDraftId || options.searchTarget) ? { ...options, blogContext: true } : options),
      renderReadingResume: parent => renderReadingResume(parent, 'home', 'home'),
      openSource: (sourceId, versionId) => navigate('source', {
        sourceId, sourceVersionId: versionId, locator: null,
        returnContext: { mode: 'home', workspaceId: state.bundle.workspaceId, scrollY: global.scrollY,
          focusKey: document.activeElement?.dataset.focusKey, homeState: home?.captureState() }
      })
    });

    const writer = global.HaedoLife.WritingUI?.create({
      storage, core, writingSync, host: main, getBundle: () => state.bundle,
      isDisposed: () => disposed, announce, parentNavigation: true,
      onClose: returnFromSubview,
      onSaved: async ({ sourceId, sourceVersionId }) => {
        if (disposed) return;
        const token = navigationGeneration, workspaceId = state.bundle?.workspaceId;
        await refreshData();
        if (disposed || state.mode !== 'write' || token !== navigationGeneration || state.bundle?.workspaceId !== workspaceId ||
            !state.bundle?.sourceVersions.some(version => version.id === sourceVersionId && version.sourceId === sourceId)) return;
        state.remoteChanged = false;
        const origin = viewOrigins.get('write');
        const returnContext = origin?.mode === 'home' && origin.workspaceId === workspaceId ? { ...origin, homeState: { ...origin.homeState, tab: 'posts' }, homeAnchor: { kind: 'source', id: sourceId, committed: true } } : null;
        await navigate('source', { sourceId, sourceVersionId, locator: null, ...(returnContext ? { returnContext } : {}) });
        announce('비공개 글을 저장했습니다.');
      }
    });


    const sourceEditor = global.HaedoLife.SourceEditUI?.create({
      host: main, storage, core, getBundle: () => state.bundle, getAccountKey: () => state.syncAccountKey,
      isDisposed: () => disposed, announce,
      onClose: closeSourceEditor,
      onSaved: async ({ sourceId, sourceVersionId }) => {
        const workspaceId = state.bundle?.workspaceId, token = navigationGeneration;
        await refreshData();
        if (disposed || state.mode !== 'source-edit' || token !== navigationGeneration || state.bundle?.workspaceId !== workspaceId) return;
        const origin = sourceEditOrigin?.workspaceId === workspaceId ? sourceEditOrigin : null;
        await navigate('source', { sourceId, sourceVersionId, locator: null, returnContext: origin?.returnContext || null });
      }
    });
    async function closeSourceEditor(fallback = {}) {
      const origin = sourceEditOrigin?.workspaceId === state.bundle?.workspaceId ? sourceEditOrigin : null;
      const sourceId = origin?.sourceId || fallback.sourceId || sourceEditOpenOptions?.sourceId;
      if (!sourceId) return navigate('sources');
      const result = await navigate('source', { sourceId, sourceVersionId: origin?.sourceVersionId || fallback.sourceVersionId || null,
        locator: origin?.locator || null, returnContext: origin?.returnContext || null, preserveContext: true, navigationMotion: 'back' });
      if (result === false || !origin || state.mode !== 'source') return;
      requestAnimationFrame(() => { if (state.mode === 'source' && state.sourceId === sourceId) { if (origin.detailsOpen) main.querySelector('#lifeSourceInfoToggle')?.click(); global.scrollTo({ top: origin.scrollY, behavior: 'instant' }); main.querySelector('#lifeSourceInfoToggle')?.focus({ preventScroll: true }); } });
    }
    async function beginSourceEdit(source, version, { restore = false, stageId } = {}) {
      const origin = { workspaceId: state.bundle.workspaceId, sourceId: source.id, sourceVersionId: version.id,
        locator: state.sourceSelection && { ...state.sourceSelection }, scrollY: global.scrollY, returnContext: state.returnContext, detailsOpen: !main.querySelector('#lifeSourceDetails')?.hidden };
      const workspace = workspaceGeneration;
      await persistDrafts();
      if (disposed || workspace !== workspaceGeneration || state.bundle?.workspaceId !== origin.workspaceId) return;
      sourceEditOrigin = origin;
      return navigate('source-edit', { sourceEdit: stageId ? { stageId } : { sourceId: source.id, versionId: version.id, restore } });
    }

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
      const postOrigin = viewOrigins.get(state.mode);
      if (cause?.code === 'post_context_changed' && ['blog', 'preservation'].includes(state.mode) &&
          postOrigin?.workspaceId === state.bundle?.workspaceId && postOrigin.postTarget?.id === cause.postId) {
        const mode = state.mode, workspaceId = state.bundle.workspaceId, workspace = workspaceGeneration,
          navigation = navigationGeneration, account = state.syncAccountKey;
        const current = () => !disposed && state.mode === mode && viewOrigins.get(mode) === postOrigin &&
          state.bundle?.workspaceId === workspaceId && workspaceGeneration === workspace && navigationGeneration === navigation && state.syncAccountKey === account;
        const openCurrent = button('현재 글 확인', guarded(async () => {
          if (!current()) return;
          const post = await storage.readPhotoPost(workspaceId, postOrigin.postTarget.id);
          if (!current()) return;
          if (post.id !== postOrigin.postTarget.id || post.status !== 'saved') throw new Error('같은 저장 글을 찾을 수 없습니다. 홈에서 현재 글을 확인해 주세요.');
          const origin = { ...postOrigin, postTarget: { id: post.id, revision: post.revision } };
          return navigate('page', { preserveContext: true, restoreViewOrigin: origin.parentOrigin, restorePostOrigin: origin,
            exactPost: origin.postTarget, blogContext: origin.blogPageTask,
            searchTarget: { photoPostId: post.id, photoPostRevision: post.revision }, navigationMotion: 'back' });
        }));
        openCurrent.id = 'lifeOpenCurrentPost'; error.append(openCurrent);
      }
      if (cause && cause.code === 'schema_missing' && !managedLibrary) {
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

    function postContextChanged(postId) {
      const cause = new Error('글이 바뀌어 이동을 멈췄습니다. 현재 글을 직접 확인해 주세요.');
      cause.code = 'post_context_changed'; cause.postId = postId; return cause;
    }

    function guarded(action) {
      return async function (event) {
        if (state.busy || disposed) return;
        state.busy = true;
        root.setAttribute('aria-busy', 'true');
        clearError();
        const target = event && event.currentTarget;
        navigationTrigger = target || document.activeElement;
        const editingControls = Array.from(root.querySelectorAll('input,select,textarea')).filter(control => !control.readOnly).map(control => [control, control.disabled]);
        editingControls.forEach(([control]) => { control.disabled = true; });
        if (target && target.tagName === 'BUTTON') target.disabled = true;
        try { await action(event); }
        catch (cause) { failure(cause); }
        finally {
          navigationTrigger = null;
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
    function activeSource(sourceId) { return core.isSourceActive(state.bundle, sourceId); }
    function activeRecord(record) { return !record.sourceRefs.length || record.sourceRefs.some(ref => activeSource(ref.sourceId)); }

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

    function refreshData({ canApply } = {}) {
      if (disposed || !state.bundle) return Promise.resolve(false);
      const workspaceId = state.bundle.workspaceId, token = workspaceGeneration, sequence = ++dataRefreshSequence;
      const pending = (async () => {
        const bundle = await storage.read(workspaceId);
        const listSequence = ++workspaceListRefresh;
        const workspaces = await storage.listWorkspaces();
        const stages = await storage.listStages(workspaceId);
        if (!batchContext(workspaceId) || token !== workspaceGeneration) return false;
        if (sequence !== dataRefreshSequence) return dataRefreshPromise;
        if (bundle.revision < state.bundle.revision) return false;
        if (canApply && canApply() !== true) return false;
        state.bundle = bundle;
        applyWorkspaceList(workspaces, listSequence);
        const imports = stages.filter(stage => stage.kind !== 'writing' && stage.kind !== 'source-edit');
        state.sourceEditStages = stages.filter(stage => stage.kind === 'source-edit' && stage.state === 'draft');
        state.allStages = imports;
        state.stages = imports.filter(stage => stage.state === 'draft');
        mergeBatches(imports);
        return true;
      })();
      dataRefreshPromise = pending;
      return pending;
    }

    function applyWorkspaceList(workspaces, sequence) {
      if (sequence <= workspaceListApplied) return false;
      workspaceListApplied = sequence;
      state.workspaces = workspaces;
      return true;
    }

    async function registerAccountMaterials(workspaceId) {
      const sequence = ++accountMaterialsSequence, workspace = workspaceGeneration;
      const current = () => !disposed && !signal?.aborted && sequence === accountMaterialsSequence &&
        workspace === workspaceGeneration && state.bundle?.workspaceId === workspaceId;
      if (!current()) return false;
      try {
        accountMaterials ||= global.HaedoLife.AccountMaterials?.create({ storage, auth, core });
        if (!accountMaterials) return false;
        const result = await accountMaterials.register(workspaceId, { signal });
        if (!current()) return false;
        if (result?.status === 'stored') {
          const bundle = await storage.read(workspaceId), active = await storage.getActive();
          if (!current() || active !== workspaceId) return false;
          state.bundle = bundle;
        }
        accountMaterialsFailure = null;
        return true;
      } catch (cause) {
        if (current()) {
          const partial = cause?.code === 'account_material_partial';
          accountMaterialsFailure = { workspaceId, partial };
          if (partial) {
            try {
              const bundle = await storage.read(workspaceId), active = await storage.getActive();
              if (current() && active === workspaceId) state.bundle = bundle;
            } catch (_) { /* Retain the last readable local bundle. */ }
          }
        }
        return false;
      }
    }

    function batchKey(workspaceId, batchId) { return workspaceId + '|' + batchId; }

    function invalidateBatchContext() { workspaceGeneration += 1; obsidianReaderOrigins.length = 0; naverMediaOrigin = null; naverMediaReturn = null; sectionPositions.clear(); blogEntryScroll = null; pendingPostReturn = preservationOpenOptions = null; global.HaedoMotion?.cancel(main); stopBatchReading(); resetSearchContext(); }

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

    async function readBatchFile(batch, item, file, origin, token, contextAlive) {
      item.readToken = token; item.status = 'reading'; updateBatchPanel();
      try {
        if (!/\.(txt|md)$/i.test(file.name)) throw new Error('UTF-8 .txt 또는 .md 파일만 지원합니다. 폴더·ZIP·사진은 가져오지 않습니다.');
        if (file.size > MAX_TEXT_BYTES) throw new Error('이 파일이 1 MiB를 넘습니다. 필요한 내용을 나누어 다시 선택해 주세요.');
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()); }
        catch (_) { throw new Error('UTF-8로 읽을 수 없습니다. 원래 파일은 변경하지 않았습니다.'); }
        if (!contextAlive() || token !== batchGeneration || batch.stopped || item.readToken !== token) return;
        const stage = batchStage(file, batch, item.index, text, origin);
        item.unsaved = stage;
        item.status = 'saving'; updateBatchPanel();
        const saved = await storage.saveStage(stage);
        if (!contextAlive()) return;
        item.stageId = saved.stageId;
        item.status = 'draft';
        item.message = text ? '' : '빈 파일 · 내용을 보완해야 자료로 보관할 수 있습니다.';
        delete item.unsaved;
      } catch (cause) {
        if (!contextAlive() || item.readToken !== token || (!item.unsaved && token !== batchGeneration)) return;
        item.status = 'failed';
        item.message = item.unsaved ? '초안 보관 실패 · 입력은 이 화면에만 있습니다. 다시 보관하거나 복사해 주세요.' : (cause?.message || '파일을 읽지 못했습니다. 다시 선택해 주세요.');
      }
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
      const batch = { id: core.id(), workspaceId, total: files.length, reading: true, processToken: token, recovered: false,
        items: files.map((file, index) => ({ index, label: file.name, bytes: file.size, origin, status: 'unread' })) };
      state.batches.set(batchKey(batch.workspaceId, batch.id), batch);
      state.batchId = batch.id;
      state.mode = 'batch';
      render();
      announce('파일을 읽어 검토초안으로 보관합니다. 아직 자료에 반영하지 않습니다.');
      for (let index = 0; index < files.length; index++) {
        if (!contextAlive() || token !== batchGeneration || batch.stopped) break;
        const file = files[index], item = batch.items[index];
        await readBatchFile(batch, item, file, origin, token, contextAlive);
        if (!contextAlive()) return;
        if (state.mode === 'batch' && state.batchId === batch.id) updateBatchPanel();
        if (token !== batchGeneration || batch.stopped) break;
      }
      if (!contextAlive()) return;
      if (batch.processToken === token) batch.reading = false;
      // A stopped save may still have completed atomically; retain its confirmed result.
      if (state.mode === 'batch' && state.batchId === batch.id) updateBatchPanel();
      if (token === batchGeneration) {
        await refreshData();
        if (!contextAlive() || token !== batchGeneration) return;
        renderHeader(); updateBatchPanel();
        announce('선택한 파일의 처리를 마쳤습니다. 각 초안을 확인해 자료로 보관해 주세요.');
      }
    }

    async function retryBatchFile(batch, item, file) {
      if (!file || disposed || !batchContext(batch.workspaceId)) return;
      if (state.busy || batch.reading || item.unsaved || item.stageId || !['failed', 'unread'].includes(item.status)) throw new Error('현재 파일 처리가 끝난 뒤 다시 선택해 주세요. 보관된 초안은 그대로 유지됩니다.');
      const totalBytes = batch.items.reduce((sum, row) => sum + (row === item ? file.size : row.bytes || 0), 0);
      if (file.size > MAX_TEXT_BYTES || totalBytes > 5 * MAX_TEXT_BYTES) throw new Error('파일당 1 MiB, 선택 묶음 전체 5 MiB까지 다시 선택할 수 있습니다. 기존 결과는 유지됩니다.');
      const workspaceToken = workspaceGeneration, token = ++batchGeneration;
      const contextAlive = () => batchContext(batch.workspaceId) && workspaceToken === workspaceGeneration;
      if (dirty()) await persistStage();
      if (!contextAlive() || token !== batchGeneration) return;
      batch.stopped = false; batch.reading = true; batch.processToken = token;
      item.label = file.name; item.bytes = file.size; item.message = '';
      await readBatchFile(batch, item, file, item.origin || 'other', token, contextAlive);
      if (!contextAlive()) return;
      if (state.mode === 'batch' && state.batchId === batch.id) updateBatchPanel();
      // A new selection can supersede a stopped read. Do not stop its active state.
      if (token !== batchGeneration) return;
      batch.reading = false;
      await refreshData();
      if (!contextAlive() || token !== batchGeneration) return;
      renderHeader(); updateBatchPanel();
      announce(item.status === 'draft' ? '이 파일의 검토초안을 보관했습니다. 다른 파일의 결과는 유지됩니다.' : '이 파일을 다시 읽지 못했습니다. 원래 파일과 나머지 결과는 유지됩니다.');
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
      main.append(title('선택한 파일'), node('p', '각 파일을 검토해 보관하세요. 실패한 파일만 다시 선택할 수 있습니다.', 'life-help'));
      const scopeHelp = node('details', null, 'life-details'); scopeHelp.append(node('summary', '파일 보관 범위'), node('p', '선택만으로 자료를 확정하지 않습니다. 저장된 검토초안과 보관 결과는 다시 열 수 있습니다. 새로고침 후에는 저장되지 않은 파일을 다시 선택해야 합니다.', 'life-help'));
      main.append(scopeHelp);
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
        if (!batch.reading && ['failed', 'unread'].includes(item.status) && !item.unsaved && !item.stageId) {
          const retry = field('이 파일 다시 선택', 'file', 'lifeBatchRetry-' + item.index, '');
          retry.input.accept = '.txt,.md,text/plain,text/markdown';
          retry.input.addEventListener('change', async () => {
            const file = retry.input.files[0]; retry.input.value = ''; clearError();
            try { await retryBatchFile(batch, item, file); } catch (cause) { failure(cause); }
          });
          retry.label.hidden = true;
          actions.append(button('이 파일 다시 선택', () => retry.input.click()), retry.label);
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

    function libraryPresentation() {
      const key = libraryState?.status || 'checking';
      const labels = { checking: '계정 자료 확인 중…', pending: '연결되면 보관합니다', syncing: '계정에 보관 중…',
        synced: '계정에 보관됨', conflict: '양쪽 변경 확인 필요', error: '계정 보관 확인 필요' };
      const unsupported = libraryState?.reason === 'unsupported' || bootstrap?.reason === 'unsupported';
      return { key, label: libraryState?.mode === 'unavailable' && unsupported ? '계정 보관을 사용할 수 없습니다' : labels[key] || labels.error,
        hint: libraryState?.error?.message || (key === 'conflict' ? '자료와 구성을 비교한 뒤 보관할 변경을 선택해 주세요.' : '') };
    }

    function updateLibraryStatus() {
      if (!managedLibrary || disposed) return;
      const presentation = libraryPresentation();
      libraryStatus.dataset.state = presentation.key;
      libraryStatusText.textContent = presentation.label;
      libraryRetry.hidden = !['error', 'pending'].includes(presentation.key);
      libraryReview.hidden = presentation.key !== 'conflict';
      const materialView = ['sources', 'topics', 'sync', 'manage', 'activities', 'collection', 'page', 'reflection', 'books'].includes(state.mode);
      libraryStatus.hidden = state.mode === 'manage' || !materialView && !['error', 'conflict'].includes(presentation.key);
      const managementStatus = main.querySelector('#lifeManagementSyncStatus');
      if (managementStatus) managementStatus.textContent = presentation.label;
      const syncStatus = main.querySelector('#lifeSyncStatus');
      if (syncStatus) syncStatus.textContent = presentation.label;
    }

    async function refreshLibrary() {
      if (!managedLibrary || disposed) return;
      const sequence = ++libraryRefresh, workspaceId = state.bundle?.workspaceId;
      try {
        const next = await accountLibrary.getState(workspaceId);
        if (disposed || sequence !== libraryRefresh || workspaceId !== state.bundle?.workspaceId) return;
        libraryState = next;
      } catch (cause) {
        if (disposed || sequence !== libraryRefresh || workspaceId !== state.bundle?.workspaceId) return;
        libraryState = { mode: 'unavailable', status: 'error', error: { code: cause.code, message: cause.message } };
      }
      updateLibraryStatus();
    }

    async function refreshWorkspaceList() {
      const sequence = ++workspaceListRefresh;
      const workspaces = await storage.listWorkspaces();
      if (disposed || !applyWorkspaceList(workspaces, sequence)) return;
      const choice = main.querySelector('#lifeWorkspace');
      if (!choice) return;
      const update = () => {
        if (disposed || !choice.isConnected) return;
        const selected = choice.value;
        const options = new Map([...choice.options].map(option => [option.value, option]));
        for (const workspace of state.workspaces) {
          let option = options.get(workspace.workspaceId);
          if (!option) { option = node('option'); option.value = workspace.workspaceId; choice.append(option); }
          option.textContent = workspace.title;
        }
        choice.value = selected;
      };
      if (document.activeElement === choice) {
        if (!deferredWorkspaceChoices.has(choice)) {
          deferredWorkspaceChoices.add(choice);
          choice.addEventListener('blur', () => { deferredWorkspaceChoices.delete(choice); update(); }, { once: true });
        }
      } else update();
    }

    function syncPresentation() {
      if (managedLibrary) return libraryPresentation();
      if (!sync) return { key: 'unavailable', label: '기기 간 자동 동기화 미연결', hint: '자료는 이 브라우저에 보관합니다. JSON 백업으로 사본을 옮길 수 있습니다.' };
      if (state.syncWorkspaceId !== state.bundle?.workspaceId) return { key: 'loading', label: '동기화 상태 확인 중', hint: '현재 작업공간의 연결 상태를 확인합니다.' };
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
          sectionPositions.clear();
          blogEntryScroll = null;
          global.HaedoMotion?.cancel(main);
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
        state.syncWorkspaceId = workspaceId;
        state.syncReadError = null;
        state.syncLoading = false;

      } catch (cause) {
        if (disposed || sequence !== syncRefreshSequence || state.bundle.workspaceId !== workspaceId) return;
        state.syncWorkspaceId = workspaceId;
        state.syncReadError = cause;
        state.syncLoading = false;
      }
      updateSyncPanels();
    }

    function updateSyncPanels() {
      if (disposed) return;
      updateLibraryStatus();
      const scope = main.querySelector('.life-scope');
      if (scope) updateScope(scope);
      const managementStatus = main.querySelector('#lifeManagementSyncStatus');
      if (managementStatus) {
        const presentation = syncPresentation();
        managementStatus.textContent = (managedLibrary ? '' : '원문·발췌 · ') + presentation.label;
        managementStatus.dataset.syncState = presentation.key;
      }
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
      if (managedLibrary) { scope.hidden = true; return; }
      scope.textContent = '이 브라우저의 개인 작업공간 · ' + syncSummary();
      const item = state.syncState;
      const matching = state.syncAccount && item?.binding && item.binding.userId === state.syncAccount.userId && item.binding.projectUrl === state.syncAccount.projectUrl;
      const mismatched = item?.binding && state.syncAccount && !matching;
      const passive = !state.syncReadError && !state.syncLoading && !item?.error && !item?.conflict && !mismatched && (!item?.binding || !item.enabled || (matching && item.status === 'synced'));
      scope.classList.toggle('life-sr-only', ['sync', 'manage'].includes(state.mode) || (sectionFor(state.mode) !== 'manage' && passive));
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
        if (managedLibrary && state.mode === 'sources' && !dirty() && !sourceEditor?.isDirty() &&
            !main.querySelector('#lifeFolderManage[open],.source-folder-assignment[open]') &&
            !main.contains(document.activeElement)) {
          const workspaceId = state.bundle.workspaceId, workspace = workspaceGeneration, input = inputGeneration;
          const canApply = () => !disposed && workspace === workspaceGeneration && workspaceId === state.bundle?.workspaceId &&
            state.mode === 'sources' && input === inputGeneration && !state.busy && !dirty() && !sourceEditor?.isDirty() &&
            !container.hidden && !main.querySelector('#lifeFolderManage[open],.source-folder-assignment[open]') &&
            !main.contains(document.activeElement);
          refreshData({ canApply }).then(applied => {
            if (applied !== true || !canApply()) return;
            state.remoteChanged = false; render();
          }).catch(failure);
        }
      });
      if (sync) {
        state.syncState = null;
        state.syncReadError = null;
        state.syncLoading = true;
        state.conflictView = null;
        refreshSync().catch(failure);
      }
      if (managedLibrary) {
        libraryState = { mode: libraryState?.mode || bootstrap?.mode, status: 'checking' }; updateLibraryStatus();
        refreshLibrary().catch(failure);
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
      announce(managedLibrary ? '자료 반영 중…' : '이 브라우저에 저장 중');
      if (managedLibrary) { libraryState = { ...libraryState, status: 'pending' }; updateLibraryStatus(); }
      const workspace = workspaceGeneration, account = state.syncAccountKey;
      const isCurrent = () => !disposed && workspace === workspaceGeneration && account === state.syncAccountKey && request.workspaceId === state.bundle?.workspaceId;
      const result = await storage.commitLocal(request, { isCurrent });
      if (!isCurrent()) throw new Error('계정 또는 작업공간이 바뀌어 이전 저장의 화면 반영을 멈췄습니다.');
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
      options ||= {};
      const token = ++navigationGeneration;
      const workspace = workspaceGeneration, workspaceId = state.bundle?.workspaceId, account = state.syncAccountKey;
      const current = () => !disposed && token === navigationGeneration && workspace === workspaceGeneration &&
        workspaceId === state.bundle?.workspaceId && account === state.syncAccountKey;
      const from = state.mode;
      const naverImportOrigin = from === 'naver-blog' ? { mode: 'naver-blog', workspaceId, scrollY: global.scrollY } : state.returnContext?.mode === 'naver-blog' ? { ...state.returnContext } : null;
      const fromSection = sectionFor(from);
      const changedTask = mode !== from || mode === 'source' && (options.sourceId !== undefined && options.sourceId !== state.sourceId ||
        options.sourceVersionId !== undefined && options.sourceVersionId !== state.sourceVersionId) ||
        mode === 'page' && (options.pageCompose || options.pageProfileEdit || options.pageDraftId || options.searchTarget || options.nineTarget) ||
        mode === 'write' && options.writing;
      const focused = main.contains(document.activeElement) && document.activeElement.matches?.('button,a,summary,input') ? document.activeElement : null;
      const requestedTrigger = options?.originFocusKey && Array.from(main.querySelectorAll('[data-focus-key]')).find(el => el.dataset.focusKey === options.originFocusKey);
      const trigger = requestedTrigger || (from === 'reflection' && mode === 'page' && options?.pageDraftId ? main.querySelector('#wbReflectionToPage') : null) || navigationTrigger || focused || Array.from(main.querySelectorAll('[data-home-destination]')).find(el => el.dataset.homeDestination === mode) || document.activeElement;
      const control = trigger?.matches?.('button,a,summary,input') ? trigger : null;
      const origin = options.viewOrigin?.workspaceId === workspaceId ? options.viewOrigin : (parentViews.has(from) || options.featureNavigation === true || from === 'reflection' && mode === 'page' && options?.pageDraftId) ? { mode: from, workspaceId: state.bundle?.workspaceId, scrollY: global.scrollY,
        focusKey: typeof options.originFocusKey === 'string' ? options.originFocusKey : control?.dataset.focusKey, focusId: control?.id,
        focusName: control?.getAttribute('aria-label') || control?.textContent, focusTag: control?.tagName,
        ...(options.featureNavigation === true ? { featureNavigation: true, parentOrigin: viewOrigins.get(from) || null } : {}),
        ...(from === 'home' ? { homeState: home?.captureState() } : {}) } :
        from === 'source' && mode === 'write' && state.returnContext?.mode === 'home' ? { ...state.returnContext } :
        from === 'source' && mode === 'page' && options.materialWritingSeed && state.returnContext?.workspaceId === state.bundle?.workspaceId
          ? (state.returnContext.mode === 'page' ? viewOrigins.get('page') : { ...state.returnContext }) : null;
      const returningFromReader = from === 'source' && state.returnContext?.mode === mode;
      if (dirty()) await persistStage();
      await annualPlanUI?.flush();
      await externalDiscoveryUI?.flush();
      if (mode === 'external-discovery' && currentExternalImport() && externalImportContext.committed) await refreshData();
      await preservationUI?.flush();
      await obsidianUpdateUI?.flush();
      await originalAttachmentsUI?.flush();
      await publicCoverUI?.flush();
      await accountBlogUI?.flush();
      await naverBlogUI?.flush();
      await naverCaptureUI?.flush();
      await blogManager?.flush();
      await workbench?.flush();
      await writer?.flush();
      await sourceEditor?.flush();
      collection?.flush();
      await flushReadingPosition();
      if (!current()) return false;
      if (options.exactPost) {
        const post = await storage.readPhotoPost(workspaceId, options.exactPost.id);
        if (!current()) return false;
        if (post.id !== options.exactPost.id || post.status !== 'saved' || post.revision !== options.exactPost.revision) {
          throw postContextChanged(options.exactPost.id);
        }
      }
      pendingPostReturn = mode === 'page' && options.restorePostOrigin ? { origin: options.restorePostOrigin,
        navigation: token, workspace, workspaceId, account, input: inputGeneration } : null;
      if (Object.hasOwn(options, 'restoreViewOrigin')) {
        if (options.restoreViewOrigin?.workspaceId === workspaceId) viewOrigins.set(mode, options.restoreViewOrigin);
        else viewOrigins.delete(mode);
      }
      if (mode !== 'source' || obsidianReaderOrigins.length && obsidianReaderOrigins.at(-1).navigation !== token) obsidianReaderOrigins.length = 0;
      if (naverMediaOrigin && naverMediaOrigin.workspaceId === workspaceId && naverMediaOrigin.account === account && naverMediaOrigin.workspace === workspace) {
        if (from === 'naver-blog' && mode === 'naver-capture' && naverMediaOrigin.navigation === token - 1) naverMediaOrigin.inCapture = true;
        else if (mode === 'naver-blog' && naverMediaOrigin.inCapture && (from === 'naver-capture' || from === 'source' && state.returnContext?.mode === 'naver-blog')) {
          naverMediaOrigin.navigation = token; naverMediaOrigin.inCapture = false;
        } else if (from === 'naver-blog' && mode !== 'naver-blog' || naverMediaOrigin.inCapture && !['naver-capture', 'source', 'naver-blog'].includes(mode)) naverMediaOrigin = null;
      }
      if (subviewTitles[mode] && mode !== from && !options?.preserveContext && !returningFromReader) {
        const inherited = sectionFor(mode) === sectionFor(from) ? viewOrigins.get(from) : null;
        if (origin || inherited) viewOrigins.set(mode, origin || inherited);
        else viewOrigins.delete(mode);
      }
      if (mode === 'page') {
        materialWritingTask = !!options.materialWritingSeed || (options.preserveContext === true || returningFromReader) && materialWritingTask;
        blogPageTask = options.blogContext === true || options.preserveContext === true && blogPageTask;
        if (options.restorePostOrigin) {
          materialWritingTask = options.restorePostOrigin.materialWritingTask;
          blogPageTask = options.restorePostOrigin.blogPageTask;
        }
        if (options.blogContext === true) options = { ...options, homeTab: origin?.homeState?.tab || 'posts' };
        if (!options.preserveContext) { blogMode = options.pageProfileEdit ? 'profile' : options.pageCompose || options.pageDraftId ? 'edit' : null; blogCommitted = null; }
      }
      if (mode === 'home') homeRenderOptions = { homeState: options.homeState, homeAnchor: options.homeAnchor };
      // A previous excerpt/record save does not describe the draft being opened.
      // Clear only after navigation can succeed; failed flushes keep their feedback.
      if (mode === 'write' && state.mode !== 'write') announce('', { quiet: true });
      if (!['tools', 'manage', 'sync', 'transfer', 'preservation', 'obsidian-update', 'public-cover', ...workbenchModes].includes(mode) && !options?.preserveContext &&
          (mode !== 'source' || (options?.sourceId && !Object.hasOwn(options, 'returnContext')))) state.returnContext = null;
      state.managementOpen = false;
      if (mode === 'source' && !options?.readerArrangeOpen) state.readerArrangeOpen = false;
      const { navigationMotion, sectionPosition, sourceEdit, selection, groupId, pagePreview, discovery, writing, reimport, externalImport, book, bookList, chapterImport: chapterImportOptions, pageDraftId, searchTarget, nineTarget, collectionItemId, originFocusKey, featureNavigation, restoreViewOrigin, viewOrigin, exactPost, restorePostOrigin, ...viewOptions } = options || {};
      if (externalImport) {
        if (mode !== 'import' || externalImport.workspaceId !== state.bundle.workspaceId) return false;
        const input = externalImport.article.privateReader === true
          ? global.HaedoLife.DiscoveryPrivateRemote.toImportInput(externalImport.article)
          : global.HaedoLife.Discovery.toImportInput(externalImport.article);
        newDraft();
        Object.assign(state.stage.input, input);
        state.importMethod = input.text ? 'text' : 'link';
        state.editTick = 1;
        externalImportContext = { workspaceId: state.bundle.workspaceId, generation: workspaceGeneration,
          stageId: state.stage.stageId, committed: null,
          origin: { mode: 'external-discovery', workspaceId: state.bundle.workspaceId,
            focusKey: externalImport.focusKey, scrollY: externalImport.scrollY || 0 } };
      }
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
        if (naverImportOrigin) externalImportContext = { workspaceId, generation: workspaceGeneration, stageId: state.stage.stageId, committed: null, origin: naverImportOrigin };
        // A new capture has its own scope; do not inherit full_text or omissions.
        state.editTick = 1;
      }
      if (!['import', 'batch', 'source'].includes(mode) && !chapterImportOptions) chapterImport = null;
      if (!['import', 'source'].includes(mode)) externalImportContext = null;
      blogOpenOptions = mode === 'blog' ? { evidenceSeed: options?.evidenceSeed, postId: options?.blogPostId,
        expectedRevision: options.exactPost?.revision ?? null } : null;
      preservationOpenOptions = mode === 'preservation' && options.exactPost ? { postIds: [options.exactPost.id], exactPost: options.exactPost } : null;
      collectionOpenOptions = mode === 'collection' ? { itemId: collectionItemId } : null;
      writingOpenOptions = mode === 'write' ? writing || {} : null;
      if (mode === 'source-edit' && options.sourceEdit) sourceEditOpenOptions = options.sourceEdit;
      Object.assign(state, viewOptions, { mode });
      workbenchOpenOptions = workbenchModes.includes(mode) ? options : null;
      if (sectionFor(mode) === 'records') lastRecordMode = mode;
      writeRoute(mode, false);
      // Incoming records are only a review. A slow configuration read must not
      // lock the global navigation; Workbench owns stale-response guards.
      const resetEntryScroll = changedTask && !options.preserveContext && navigationMotion !== 'back' && !sectionPosition &&
        mode !== 'source' && !options.locator && !options.homeAnchor && !searchTarget?.entryId && !nineTarget &&
        !collectionItemId && !groupId && !book && !chapterImportOptions && !selection;
      if (resetEntryScroll) global.scrollTo({ top: 0, behavior: 'instant' });
      const entryInput = inputGeneration, entryGeneration = renderGeneration + 1;
      // Standalone post mounts finish after Workbench's shell render. Their
      // final target reveal must leave the new reader's title and return visible.
      blogEntryScroll = resetEntryScroll && mode === 'page' && blogPageTask ? () => {
        if (current() && state.mode === 'page' && renderGeneration === entryGeneration && inputGeneration === entryInput)
          global.scrollTo({ top: 0, behavior: 'instant' });
      } : null;
      navigationRender = token;
      const rendering = render();
      const generation = renderGeneration, input = inputGeneration;
      const rendered = () => current() && generation === renderGeneration && state.mode === mode;
      // Motion observes a completed navigation; it never holds input or focus.
      // In particular, a late home load must not move content being edited.
      Promise.resolve(mainRenderPromise).then(() => {
        if (navigationRender === token) navigationRender = null;
        if (!rendered()) return;
        if (sectionPosition && input === inputGeneration && !options.homeAnchor && !options.searchTarget && !options.locator)
          global.scrollTo({ top: sectionPosition.scrollY, behavior: 'instant' });
        if (!changedTask || state.error || input !== inputGeneration) return;
        const kind = navigationMotion || (fromSection !== sectionFor(mode) ? 'tab' :
          mode === 'write' || mode === 'import' || mode === 'page' && (options.pageCompose || options.pageProfileEdit || options.pageDraftId) ? 'compose' : 'push');
        const sections = ['home', 'news', 'records', 'tools', 'manage'];
        const direction = kind === 'tab' && sections.indexOf(sectionFor(mode)) < sections.indexOf(fromSection) ? -1 : 1;
        const enter = () => {
          if (rendered() && !state.error && input === inputGeneration) global.HaedoMotion?.enter(main, { kind, direction });
        };
        // Source locators measure an unchanged range in their already queued
        // frame. Start the transform afterwards so its offset cannot leak in.
        if (mode === 'source') requestAnimationFrame(enter);
        else enter();
      }).catch(failure);
      if (!options?.selection) await rendering;
      if (!rendered()) return false;
      if (reimport) {
        main.querySelector('#lifeImportText')?.focus();
        await persistStage(true);
        if (!rendered()) return false;
      }
      if (mode === 'find') main.querySelector('#lifeFindQuery')?.focus();
      if (mode === 'sync' || mode === 'transfer') global.scrollTo({ top: 0, behavior: 'instant' });
      const heading = (options?.chapterImport && (main.querySelector('#wbChapterImportHeading') || main.querySelector('#wbChapterNote'))) || (options?.book && main.querySelector(options.book.chapterId ? '#wbChapterNote' : '#wbBookHeading')) || main.querySelector('h1,h2') || toolbar.querySelector('h1');
      if (heading && mode !== 'find' && mode !== 'write' && !(mode === 'page' && blogPageTask && blogMode === 'edit') && !options?.searchTarget && !options?.nineTarget && !options?.collectionItemId && !options?.groupId && !reimport) {
        heading.focus({ preventScroll: true });
        if (options?.book || options?.chapterImport) heading.scrollIntoView({ block: 'nearest' });
      }
      return true;
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
        chapterId: context.chapterId, versionIds: context.versionIds.slice() }, navigationMotion: 'back' });
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
      externalImportContext = null;
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

    function currentExternalImport(context = externalImportContext) {
      return !!context && context === externalImportContext && !disposed &&
        context.workspaceId === state.bundle?.workspaceId && context.generation === workspaceGeneration;
    }

    async function openExternalImportResult(context = externalImportContext) {
      if (!currentExternalImport(context) || !context.committed) return false;
      return navigate('source', { sourceId: context.committed.sourceId, sourceVersionId: context.committed.sourceVersionId,
        locator: null, returnContext: { ...context.origin, sourceVersionId: context.committed.sourceVersionId } });
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
      if (mode === 'home' || mode === 'account-blog' || mode === 'page' && blogPageTask || mode === 'write' && viewOrigins.get('write')?.mode === 'home' || mode === 'source' && (state.returnContext?.mode === 'home' || state.returnContext?.mode === 'page' && blogPageTask)) return 'home';
      return global.HaedoNavigation?.getSectionForView(mode) || (['tools', 'manage'].includes(mode) ? mode : 'records');
    }

    function routeMode() {
      const params = new URLSearchParams(global.location.search);
      const section = params.get('section');
      const view = params.get('view');
      if (params.get('compose') === '1') return 'page';
      // A known destination survives an old section URL and is normalized on render.
      if (['annual-plan', 'source-trash', 'naver-blog', 'account-blog', 'blog', 'transfer', 'sync', 'preservation', 'obsidian-update', 'public-cover', 'workbench-backup', 'public-pages', 'external-discovery', 'interests', 'discover', 'reflection', 'books', 'topics', 'sources', 'time', 'import', 'write', 'activities', 'page', 'collection', 'find'].includes(view)) return view;
      if (section === 'news') return 'external-discovery';
      if (section === 'home' && !view) return 'home';
      if (section === 'tools') return 'tools';
      if (section === 'manage') return 'manage';
      if (view === 'related') return view;
      return section === 'records' || /\/life\.html$/.test(global.location.pathname) ? 'sources' : 'home';
    }

    function writeRoute(mode, push) {
      if (!global.HaedoNavigation) return;
      const url = new URL(global.location.href);
      const section = sectionFor(mode);
      url.searchParams.delete('compose');
      if (section === 'home' && !/\/life\.html$/.test(url.pathname)) url.searchParams.delete('section');
      else url.searchParams.set('section', section);
      const view = mode === 'naver-capture' ? 'naver-blog' : mode === 'source' ? 'sources' : mode === 'batch' ? 'import' : mode;
      if (mode === 'external-discovery') url.searchParams.delete('view');
      else if (['annual-plan', 'source-trash', 'naver-blog', 'account-blog', 'blog', 'topics', 'time', 'import', 'write', 'sync', 'transfer', 'preservation', 'obsidian-update', 'public-cover', 'interests', 'collection', 'find', ...workbenchModes].includes(view)) url.searchParams.set('view', view);
      else url.searchParams.delete('view');
      const destination = url.pathname + url.search + url.hash;
      if (destination !== global.location.pathname + global.location.search + global.location.hash)
        global.history[push && !(mode !== 'external-discovery' && global.history.state?.haedoNewsReader === true) ? 'pushState' : 'replaceState'](null, '', destination);
    }

    async function navigateSection(section, push = true) {
      if (!state.bundle) {
        global.requestAnimationFrame(() => { if (!disposed) main.querySelector('#lifeWorkspaceChoice')?.focus(); });
        announce('먼저 보관한 작업공간을 선택해 주세요.');
        return;
      }
      const previousSection = sectionFor(state.mode);
      const sectionRoot = section === 'news' ? 'external-discovery' : section === 'records' ? 'sources' : section;
      if (section === previousSection && state.mode === sectionRoot) {
        if (section === 'news') externalDiscoveryUI?.closeReader();
        return;
      }
      if (section === previousSection && state.mode === 'source' && ['sources', 'topics'].includes(state.returnContext?.mode)) return returnToResults();
      const token = ++navigationGeneration, workspace = workspaceGeneration, workspaceId = state.bundle.workspaceId;
      const account = state.syncAccountKey;
      const position = { mode: state.mode, scrollY: global.scrollY,
        ...(state.mode === 'home' ? { homeState: home?.captureState() } : {}) };
      if (previousSection === 'records') lastRecordMode = state.mode;
      const next = section === previousSection ? sectionRoot : section === 'news' ? 'external-discovery' : section === 'home' ? 'home' : section === 'records' ? lastRecordMode : section === 'tools' ? 'tools' : 'manage';
      // Save before changing URL so a failed draft write keeps the current view.
      if (dirty()) await persistStage();
      await annualPlanUI?.flush();
      await externalDiscoveryUI?.flush();
      await preservationUI?.flush();
      await obsidianUpdateUI?.flush();
      await originalAttachmentsUI?.flush();
      await publicCoverUI?.flush();
      await accountBlogUI?.flush();
      await naverBlogUI?.flush();
      await naverCaptureUI?.flush();
      await blogManager?.flush();
      await workbench?.flush();
      await writer?.flush();
      await sourceEditor?.flush();
      collection?.flush();
      if (disposed || token !== navigationGeneration || workspace !== workspaceGeneration ||
          workspaceId !== state.bundle?.workspaceId || account !== state.syncAccountKey) return;
      if (section !== previousSection) sectionPositions.set(previousSection, position);
      const saved = section !== previousSection ? sectionPositions.get(section) : null;
      const sectionPosition = saved?.mode === next ? saved : section !== previousSection && next !== 'source' ? { scrollY: 0 } : null;
      writeRoute(next, push);
      await navigate(next, { preserveContext: true, navigationMotion: section === previousSection ? 'back' : 'tab',
        ...(sectionPosition ? { sectionPosition, homeState: sectionPosition.homeState } : {}) });
    }

    const popstate = guarded(async () => {
      if (!state.bundle) return;
      let mode = routeMode();
      if (newsReaderBackPending) {
        newsReaderBackPending = false;
        if (mode === 'external-discovery' && state.mode === mode) { externalDiscoveryUI?.restorePosition(); return; }
      }
      if (mode === 'external-discovery' && state.mode === mode && externalDiscoveryUI?.hasReader()) {
        externalDiscoveryUI.closeReader({ fromHistory: true });
        return;
      }
      if (sectionFor(state.mode) === 'records') lastRecordMode = state.mode;
      if (mode === 'sources' && lastRecordMode === 'source') mode = 'source';
      if (mode === 'import' && lastRecordMode === 'batch') mode = 'batch';
      try { await navigate(mode, { preserveContext: true, navigationMotion: 'tab' }); }
      catch (cause) { writeRoute(state.mode, false); throw cause; }
    });

    function subviewOrigin() {
      const origin = viewOrigins.get(state.mode);
      if (origin?.workspaceId === state.bundle?.workspaceId) return origin;
      const section = sectionFor(state.mode);
      return { mode: section === 'news' ? 'external-discovery' : section === 'records' ? 'sources' : section, workspaceId: state.bundle?.workspaceId, scrollY: 0 };
    }

    async function returnFromSubview() {
      if (state.mode === 'source-edit') return closeSourceEditor();
      if (state.mode === 'naver-blog' && currentNaverMediaOrigin()) return returnFromNaverMedia();
      const origin = subviewOrigin();
      const anchor = state.mode === 'page' && blogPageTask && origin.mode === 'home' && origin.homeState?.tab !== 'drafts' ? blogCommitted : null;
      if (await navigate(origin.mode, { preserveContext: true, homeState: origin.homeState, homeAnchor: anchor, navigationMotion: 'back',
        ...(origin.featureNavigation ? { restoreViewOrigin: origin.parentOrigin } : {}),
        ...(origin.postTarget ? { restoreViewOrigin: origin.parentOrigin, restorePostOrigin: origin, exactPost: origin.postTarget,
          blogContext: origin.blogPageTask, searchTarget: { photoPostId: origin.postTarget.id, photoPostRevision: origin.postTarget.revision } } : {}) }) === false) return;
      if (origin.postTarget) return;
      const token = navigationGeneration;
      const restore = () => requestAnimationFrame(() => {
        if (disposed || token !== navigationGeneration || state.mode !== origin.mode || state.bundle?.workspaceId !== origin.workspaceId || anchor) return;
        const controls = [...root.querySelectorAll('button,a,summary,input')];
        const remoteId = origin.mode === 'account-blog' && /^account-blog:(?:open|receive|received|manage):([^:]+)(?::[^:]+)?$/.exec(origin.focusKey || '')?.[1];
        const receivedActions = remoteId ? controls.filter(el => el.dataset.remoteId === remoteId && el.dataset.action === 'open') : [];
        const target = (origin.focusKey && controls.find(el => el.dataset.focusKey === origin.focusKey)) ||
          (receivedActions.length === 1 ? receivedActions[0] : null) ||
          (origin.focusId && controls.find(el => el.id === origin.focusId)) || controls.find(el =>
          el.tagName === origin.focusTag && (el.getAttribute('aria-label') || el.textContent) === origin.focusName) || main.querySelector('#lifeFindQuery,#lifeSearch,h1,h2') || toolbar.querySelector('h1');
        for (let parent = target?.parentElement; parent && parent !== main; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
        target?.focus({ preventScroll: true });
        if (!anchor) global.scrollTo({ top: origin.scrollY, behavior: 'instant' });
      });
      if (origin.mode === 'find') findRenderPromise.then(restore);
      else if (origin.mode === 'home') homeRenderPromise.then(restore);
      else if (origin.mode === 'naver-capture' || origin.mode === 'naver-blog' || origin.mode === 'external-discovery' || origin.mode === 'account-blog' || origin.mode === 'blog') mainRenderPromise.then(restore);
      else restore();
    }

    async function returnFromBlog(context = {}) {
      if (disposed || state.mode !== 'page' || !blogPageTask) return;
      const origin = subviewOrigin();
      if (origin.mode !== 'home' || origin.workspaceId !== state.bundle?.workspaceId) return returnFromSubview();
      if (!context.committed || !context.id || context.kind === 'profile') return returnFromSubview();
      const anchor = { kind: context.kind === 'legacy' ? 'plain' : context.kind, id: context.id, committed: true };
      const homeState = { ...origin.homeState, workspaceId: origin.workspaceId, tab: 'posts' };
      await navigate('home', { preserveContext: true, homeState, homeAnchor: anchor, navigationMotion: 'back' });
    }

    function syncWritingFocus() {
      if (disposed) return;
      const editing = state.mode === 'write' || state.mode === 'source-edit' || state.mode === 'page' && (blogPageTask && blogMode === 'edit' ||
        [...main.querySelectorAll('.photo-editor,.pp-composer')].some(element => element.getClientRects().length > 0));
      if (editing) document.body.dataset.writingFocus = 'true';
      else delete document.body.dataset.writingFocus;
    }

    function renderHeader() {
      if (disposed) return;
      updateLibraryStatus();
      const section = sectionFor(state.mode);
      syncWritingFocus();
      global.HaedoNavigation?.activate(section);
      status.hidden = state.mode === 'find';
      header.replaceChildren();
      toolbar.classList.add('haedo-page-heading');
      const openMenuId = main.dataset.mode === state.mode ? toolbar.querySelector('.life-feature-menu[open]')?.id : null;
      const activeMenu = document.activeElement?.closest('.life-feature-menu');
      const menuFocus = activeMenu && toolbar.contains(activeMenu) && main.dataset.mode === state.mode ?
        { id: activeMenu.id, key: document.activeElement.dataset.focusKey, summary: document.activeElement.tagName === 'SUMMARY' } : null;
      toolbar.replaceChildren();
      planningNavigation.replaceChildren();
      planningNavigation.hidden = state.mode !== 'annual-plan';
      if (!planningNavigation.hidden) {
        const workspace = workspaceGeneration, workspaceId = state.bundle?.workspaceId, account = state.syncAccountKey;
        planningNavigation.append(global.HaedoNavigation.createPlanningNavigation({ current: 'annual-plan',
          beforeNavigate: async () => {
            let canLeave = false;
            const navigation = navigationGeneration;
            await guarded(async () => {
              await persistDrafts();
              canLeave = !disposed && workspace === workspaceGeneration && navigation === navigationGeneration &&
                workspaceId === state.bundle?.workspaceId && account === state.syncAccountKey && state.mode === 'annual-plan';
            })();
            return canLeave;
          }, onError: failure }));
      }
      toolbar.hidden = ['source', 'source-edit'].includes(state.mode) && !state.remoteChanged;
      const focused = ['blog', 'write', 'source-edit', 'source', 'page', 'related', 'collection', 'find'].includes(state.mode);
      const heading = node('h1', null, 'life-page-title');
      heading.tabIndex = -1;
      const headingGroup = node('div', null, 'haedo-heading-title');
      if (state.mode === 'page' && materialWritingTask) heading.textContent = blogMode === 'edit' ? '글쓰기' : blogMode === 'read' ? '글 읽기' : '자료로 글쓰기';
      else if (state.mode === 'page' && blogPageTask) heading.textContent = blogMode === 'profile' ? '프로필 편집' : blogMode === 'edit' ? '글쓰기' : '글 읽기';
      else if (state.mode === 'external-discovery') heading.textContent = '뉴스';
      else if (subviewTitles[state.mode]) heading.textContent = subviewTitles[state.mode];
      else if (state.mode === 'books') heading.textContent = '내 책';
      else if (state.mode === 'reflection') heading.textContent = '회고';
      else if (state.mode === 'related') heading.textContent = '관련 기록';
      else if (section === 'records') {
        const records = button('자료실', guarded(() => navigate('sources')), 'life-title-button');
        records.setAttribute('aria-label', '자료실 목록');
        heading.append(records);
      } else heading.textContent = section === 'home' ? '내 블로그' : section === 'tools' ? '계획' : '설정';
      if (subviewTitles[state.mode] && state.mode !== 'external-discovery' && !(state.mode === 'page' && blogPageTask && blogMode === 'edit')) {
        const labels = { 'naver-blog': '네이버 블로그 목록으로 돌아가기', 'naver-capture': '본문·사진 검토로 돌아가기', 'account-blog': '서버 글 목록으로 돌아가기', 'external-discovery': '새 글 찾기로 돌아가기', interests: '관심 주제 편집으로 돌아가기', blog: '글 공개·보관으로 돌아가기', find: '검색 결과로 돌아가기', reflection: '회고로 돌아가기', home: '홈으로 돌아가기', sources: '자료실로 돌아가기', topics: '검색 결과로 돌아가기', tools: '계획으로 돌아가기', manage: '설정으로 돌아가기', collection: '컬렉션으로 돌아가기', activities: '묶음으로 돌아가기', page: '선택 자료 페이지로 돌아가기', books: '책으로 돌아가기', time: '연표로 돌아가기', import: '가져오기로 돌아가기', write: '자료 작성으로 돌아가기', discover: '다시 찾기로 돌아가기', related: '관련 기록으로 돌아가기' };
        const origin = subviewOrigin();
        const back = iconButton(state.mode === 'naver-blog' && currentNaverMediaOrigin() ? '읽던 원문으로 돌아가기' : origin.postTarget ? '읽던 글로 돌아가기' : labels[origin.mode] || labels.sources, 'back', guarded(returnFromSubview));
        back.id = state.mode === 'write' ? 'lifeWritingClose' : 'lifeSubviewReturn';
        back.dataset.subviewReturn = 'true';
        headingGroup.append(back);
      }
      if (section === 'tools' && state.mode !== 'tools' && !subviewTitles[state.mode]) {
        headingGroup.append(iconButton('계획으로 돌아가기', 'back', guarded(() => navigate('tools'))));
      }
      if (state.mode === 'related') {
        const back = iconButton(relatedOrigin?.workspaceId === state.bundle?.workspaceId ? '읽던 글로 돌아가기' : '자료실로 돌아가기', 'back', guarded(returnFromRelated));
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
          toolbar.append(select);
        }
      }
      if (!focused && (section === 'records' || section === 'home')) {
        const nav = node('nav', null, 'life-nav life-context-nav');
        nav.setAttribute('aria-label', '기록 보기');
        const add = iconButton('가져오기', 'plus', guarded(async () => {
          if (!state.stage || state.stage.state !== 'draft') newDraft();
          await navigate('import');
        }));
        if (state.mode === 'import' || state.mode === 'batch') add.setAttribute('aria-current', 'page');
        // Home exposes these actions with labels in its shortcut row.
        if (section === 'records') nav.append(add);
        toolbar.append(nav);
      }
      if (!['source', 'find'].includes(state.mode)) {
        const find = iconButton('통합 검색', 'search', guarded(() => navigate('find'))); find.id = 'lifeFindOpen'; toolbar.append(find);
      }
      if (section === 'records' && (!focused || state.mode === 'collection') || state.mode === 'home') {
        const menu = featureMenu(state.mode === 'home');
        menu.open = menu.id === openMenuId;
        toolbar.append(menu);
      }
      if (state.remoteChanged && state.mode !== 'find') {
        const refresh = button('최신 내용 확인', guarded(async () => {
          if (dirty()) await persistStage();
          await preservationUI?.flush();
      await obsidianUpdateUI?.flush();
      await originalAttachmentsUI?.flush();
      await publicCoverUI?.flush();
          await accountBlogUI?.flush();
      await naverBlogUI?.flush();
      await naverCaptureUI?.flush();
      await blogManager?.flush();
          await workbench?.flush();
          await writer?.flush();
      await sourceEditor?.flush();
          collection?.flush();
          await refreshData();
          state.remoteChanged = false;
          state.prepared = null;
          render();
          announce('최신 내용을 불러왔습니다. 보관 중인 입력은 유지됩니다. 다시 검토해 주세요.');
        }), 'life-refresh');
        toolbar.append(refresh);
      }
      // Background account updates may rebuild the header while its menu is in use.
      // Restore only the exact control in the same screen; navigation owns its own focus.
      if (menuFocus) {
        const menu = [...toolbar.querySelectorAll('.life-feature-menu')].find(item => item.id === menuFocus.id);
        const control = menuFocus.summary ? menu?.querySelector('summary') :
          [...(menu?.querySelectorAll('[data-focus-key]') || [])].find(item => item.dataset.focusKey === menuFocus.key);
        control?.focus({ preventScroll: true });
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
      list.append(actionRow('연간 계획', '연도·나이와 월별 계획', 'timeline', () => navigate('annual-plan')),
        destinationRow('목표', '진행 중인 일과 다음 계획', 'goals.html', 'target'),
        destinationRow('습관', '반복할 일과 오늘의 체크', 'habits.html', 'check'));
      main.append(list);
    }

    function featureMenu(blog) {
      const menu = node('details', null, 'life-feature-menu');
      menu.id = blog ? 'lifeBlogMenu' : 'lifeRecordsMenu';
      const summary = node('summary', null, 'life-icon-button');
      const label = blog ? '블로그 메뉴' : '자료 메뉴';
      summary.setAttribute('aria-label', label);
      summary.append(global.HaedoLife.Icons.create('more'));
      const tooltip = node('span', label, 'life-tooltip'); tooltip.setAttribute('aria-hidden', 'true'); summary.append(tooltip);
      const panel = node('div', null, 'life-feature-menu-panel');
      const group = (name, items) => {
        const section = node('section'); section.setAttribute('aria-label', name);
        section.append(node('h2', name));
        for (const [name, glyph, mode, id] of items) {
          const control = actionRow(name, '', glyph, () => {
            if (state.mode === mode) { menu.open = false; summary.focus({ preventScroll: true }); return; }
            return navigate(mode, { featureNavigation: true });
          });
          if (state.mode === mode) control.setAttribute('aria-current', 'page');
          control.dataset.focusKey = (blog ? 'home:menu:' : 'records:menu:') + mode;
          if (id) control.id = id;
          if (mode === 'blog') { control.dataset.homeDestination = 'blog'; control.dataset.focusKey = 'home:action:blog'; }
          section.append(control);
        }
        panel.append(section);
        return section;
      };
      if (blog) group('글·공개', [
        ['글 공개·보관', 'edit', 'blog'], ['공개한 페이지', 'link', 'public-pages'], ['공개 표지', 'link', 'public-cover']
      ]);
      else {
        group('모아 보기', [['컬렉션', 'bookmark', 'collection'], ['묶음', 'link', 'activities'], ['선택 자료 페이지', 'user', 'page']]);
        group('활용', [['다시 찾기', 'search', 'discover'], ['회고', 'book', 'reflection'], ['책 만들기', 'book', 'books'], ['연표', 'timeline', 'time']]);
        const management = group('가져오기·관리', [
          ['자료 작성', 'edit', 'write'],
          ['네이버 블로그 연결', 'link', 'naver-blog'], ['Obsidian 갱신', 'refresh', 'obsidian-update', 'lifeObsidianUpdateOpen']
        ]);
        const originals = actionRow('원본 첨부 보관', '', 'download', async () => {
          const origin = { mode: state.mode, workspaceId: state.bundle.workspaceId, scrollY: global.scrollY, focusKey: 'records:menu:originals' };
          originalAttachmentsUI?.dispose();
          originalAttachmentsUI = await global.LifeOriginalAttachmentsUI.open({ auth, storage,
            onOpenSource: match => openOriginalSource(match, origin).catch(failure) });
        });
        originals.id = 'lifeOriginalAttachmentsOpen'; originals.dataset.focusKey = 'records:menu:originals';
        const trash = actionRow('자료 휴지통', '', 'trash', () => navigate('source-trash'));
        trash.id = 'lifeSourceTrashOpen'; trash.dataset.focusKey = 'records:menu:source-trash';
        management.append(originals, trash);
      }
      menu.append(summary, panel);
      menu.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !menu.open) return;
        event.preventDefault(); event.stopPropagation(); menu.open = false; summary.focus({ preventScroll: true });
      });
      return menu;
    }

    function closeFeatureMenusOutside(event) {
      naverMediaReturn = null;
      root.querySelectorAll('.life-feature-menu[open]').forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
    }
    document.addEventListener('pointerdown', closeFeatureMenusOutside);

    async function openManagedSource(workspaceId, target, context = {}, reference = null) {
      const workspaceToken = workspaceGeneration, navigationToken = navigationGeneration, postId = blogManagerPostId;
      const fetched = await storage.read(workspaceId);
      const current = () => !disposed && workspaceToken === workspaceGeneration && navigationToken === navigationGeneration &&
        state.mode === 'blog' && state.bundle?.workspaceId === workspaceId;
      if (!current()) return;
      if (fetched.revision >= state.bundle.revision) state.bundle = fetched;
      if (!state.bundle.sourceVersions.some(version => version.id === target.sourceVersionId && version.sourceId === target.sourceId)) throw new Error('이 원문 버전을 찾을 수 없습니다. 다른 버전으로 바꾸지 않았습니다.');
      if (reference) await global.HaedoLife.SourceReference.resolve(state.bundle, reference);
      if (!current()) return;
      return navigate('source', { ...target, returnContext: { mode: 'blog', workspaceId, scrollY: global.scrollY, focusKey: context.focusKey, blogPostId: postId } });
    }

    function currentNaverMediaOrigin() {
      const origin = naverMediaOrigin;
      return origin && !disposed && state.mode === 'naver-blog' && origin.workspaceId === state.bundle?.workspaceId &&
        origin.account === state.syncAccountKey && origin.workspace === workspaceGeneration && origin.navigation === navigationGeneration ? origin : null;
    }
    async function openNaverMediaReview(source, version) {
      const origin = { workspaceId: state.bundle.workspaceId, workspace: workspaceGeneration, account: state.syncAccountKey,
        sourceId: source.id, sourceVersionId: version.id, locator: state.sourceSelection && { ...state.sourceSelection },
        returnContext: state.returnContext, scrollY: global.scrollY, navigation: navigationGeneration + 1, inCapture: false };
      naverMediaOrigin = origin;
      try { if (await navigate('naver-blog') === false && naverMediaOrigin === origin) naverMediaOrigin = null; }
      catch (error) { if (naverMediaOrigin === origin) naverMediaOrigin = null; throw error; }
    }
    function restoreNaverMediaReturn() {
      const context = naverMediaReturn;
      if (!context?.armed || context.frame) return;
      const valid = () => naverMediaReturn === context && !disposed && context.navigation === navigationGeneration &&
        context.render === renderGeneration && context.input === inputGeneration && context.origin.workspace === workspaceGeneration &&
        context.origin.account === state.syncAccountKey && state.bundle?.workspaceId === context.origin.workspaceId &&
        state.mode === 'source' && state.sourceId === context.origin.sourceId && state.sourceVersionId === context.origin.sourceVersionId;
      context.frame = requestAnimationFrame(() => {
        context.frame = null;
        if (!valid() || Math.abs(global.scrollY - context.expectedScroll) > 2) {
          if (naverMediaReturn === context) naverMediaReturn = null;
          return;
        }
        if (!context.positioned) {
          global.scrollTo({ top: context.origin.scrollY, behavior: 'instant' });
          context.expectedScroll = global.scrollY; context.positioned = true;
        }
        // The original reader is usable before its remote photo receipt is
        // known. Restore the originating action only after that action exists.
        if (main.querySelector('#lifeNaverSourceMedia')?.dataset.state === 'loading') return;
        const target = main.querySelector('#lifeNaverMediaReview') || main.querySelector('.life-reader-heading') || main.querySelector('h1,h2');
        target?.focus({ preventScroll: true });
        global.scrollTo({ top: context.origin.scrollY, behavior: 'instant' });
        if (naverMediaReturn === context) naverMediaReturn = null;
      });
    }
    async function returnFromNaverMedia() {
      const origin = currentNaverMediaOrigin(); if (!origin) return navigate('sources');
      const input = inputGeneration;
      naverMediaOrigin = null;
      try {
        if (await navigate('source', { sourceId: origin.sourceId, sourceVersionId: origin.sourceVersionId,
          locator: origin.locator, returnContext: origin.returnContext, preserveContext: true, navigationMotion: 'back' }) === false) {
          origin.navigation = navigationGeneration; naverMediaOrigin = origin; return;
        }
      } catch (error) { origin.navigation = navigationGeneration; naverMediaOrigin = origin; throw error; }
      if (input !== inputGeneration) return;
      const context = { origin, navigation: navigationGeneration, render: renderGeneration, input, armed: false, frame: null };
      naverMediaReturn = context;
      await mainRenderPromise;
      if (naverMediaReturn !== context || input !== inputGeneration) return;
      context.expectedScroll = global.scrollY; context.armed = true;
      restoreNaverMediaReturn();
    }
    async function renderNaverBlog() {
      const workspaceId = state.bundle.workspaceId, workspaceToken = workspaceGeneration;
      const isCurrent = id => !disposed && state.mode === 'naver-blog' && state.bundle?.workspaceId === id && workspaceToken === workspaceGeneration;
      const legacy = global.HaedoLife.NaverBlogSync.create({ storage, auth, core, isCurrent });
      const captures = global.HaedoLife.NaverCaptureSync.create({ storage, auth, core, isCurrent });
      naverBlogService = { ...legacy, ...captures, dispose() { legacy.dispose(); captures.dispose(); } };
      const instance = global.HaedoLife.NaverBlogUI.create({ container: main, service: naverBlogService, workspaceId, viewState: naverBlogViews.get(workspaceId),
        isCurrent: () => !disposed && workspaceToken === workspaceGeneration && state.mode === 'naver-blog' && state.bundle?.workspaceId === workspaceId,
        onOpenSource: async target => {
          await refreshData();
          if (disposed || workspaceToken !== workspaceGeneration || state.mode !== 'naver-blog') return;
          return openResult('naver-blog', 'naver-blog:source:' + target.sourceId, target);
        },
        onImport: async target => {
          await refreshData();
          if (disposed || workspaceToken !== workspaceGeneration || state.mode !== 'naver-blog') return;
          if (target.sourceId) return navigate('import', { reimport: { workspaceId, sourceId: target.sourceId, sourceVersionId: target.sourceVersionId } });
          return navigate('import');
        },
        onReturn: () => currentNaverMediaOrigin() ? returnFromNaverMedia() : navigate('sources'),
        onReview: target => {
          naverCaptureTarget = { ...target, origin: { mode: 'naver-blog', workspaceId, focusKey: target.focusKey, scrollY: global.scrollY } };
          return navigate('naver-capture', { originFocusKey: target.focusKey });
        },
        onImportFile: importNaverFile
      });
      naverBlogUI = instance; naverBlogWorkspace = workspaceId;
      await instance.render();
      if (currentNaverMediaOrigin()) { const back = main.querySelector('#naverBlogReturn'); if (back) back.textContent = '읽던 원문으로 돌아가기'; }
    }

    function naverOrigin() {
      if (state.returnContext?.mode === 'naver-blog') return { ...state.returnContext };
      return { ...(naverCaptureTarget?.origin || viewOrigins.get('naver-capture') || { mode: 'naver-blog', workspaceId: state.bundle.workspaceId, scrollY: 0 }) };
    }
    async function renderNaverCapture() {
      if (!naverCaptureTarget?.captureId) { main.append(node('p', '수집 사본을 선택해 주세요.'), button('네이버 글 목록으로 돌아가기', guarded(() => navigate('naver-blog')))); return; }
      const workspaceId = state.bundle.workspaceId, workspaceToken = workspaceGeneration;
      const isCurrent = id => !disposed && state.mode === 'naver-capture' && state.bundle?.workspaceId === id && workspaceToken === workspaceGeneration;
      const service = global.HaedoLife.NaverCaptureSync.create({ storage, auth, core, isCurrent }); naverCaptureService = service;
      const target = { ...naverCaptureTarget };
      const instance = global.HaedoLife.NaverCaptureUI.create({ container: main, service, workspaceId, captureId: target.captureId,
        isCurrent: () => isCurrent(workspaceId),
        onApply: async value => {
          const result = await service.receiveCapture(workspaceId, target.captureId, {
            existingSourceId: value.existingSourceId || null, expectedSourceVersionId: value.expectedSourceVersionId || null });
          if (isCurrent(workspaceId)) await refreshData(); return result;
        },
        onOpenSource: value => navigate('source', { sourceId: value.sourceId, sourceVersionId: value.sourceVersionId, locator: null, returnContext: naverOrigin() }),
        onWritePhotos: async value => { const read = await service.readCapture(workspaceId, target.captureId); return writeNaverPhotos({ ...value, expectedCaptureHash: read.capture.capture_hash }); },
        onDownload: async value => { const read = await service.readCapture(workspaceId, target.captureId); return downloadNaverFile({ ...value, expectedCaptureHash: read.capture.capture_hash }); }, onReturn: () => returnFromSubview()
      });
      naverCaptureUI = instance; await instance.render();
    }
    async function downloadNaverFile({ sourceId, sourceVersionId, expectedCaptureHash }) {
      const workspaceId = state.bundle.workspaceId, token = navigationGeneration, account = state.syncAccountKey;
      const current = () => !disposed && state.bundle?.workspaceId === workspaceId && token === navigationGeneration && account === state.syncAccountKey;
      const bundle = await storage.read(workspaceId), attachment = await storage.readNaverCapture(workspaceId, sourceVersionId);
      if (!current()) return;
      if (!attachment || attachment.sourceId !== sourceId || expectedCaptureHash && attachment.capture.capture_hash !== expectedCaptureHash) throw new Error('사진을 포함한 정확한 원문 판을 먼저 자료에 반영해 주세요.');
      const file = await global.HaedoLife.NaverMedia.pack({ bundle, attachment }); if (!current()) return;
      const name = (bundle.sources.find(value => value.id === sourceId)?.title || '네이버 원문').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 100);
      download(file, name + '.haedo-naver.zip', 'application/zip');
    }
    async function importNaverFile(file) {
      const workspaceId = state.bundle.workspaceId, token = navigationGeneration, account = state.syncAccountKey;
      const current = () => !disposed && state.bundle?.workspaceId === workspaceId && token === navigationGeneration && account === state.syncAccountKey;
      await persistDrafts(); if (!current()) return;
      const snapshot = await global.HaedoLife.NaverMedia.read(file); if (!current()) return;
      const copy = await global.HaedoLife.NaverMedia.copy(snapshot); if (!current()) return;
      const installed = await storage.installNaverCaptureCopy(copy, { isCurrent: current }); if (!current()) return;
      invalidateBatchContext(); state.bundle = installed.bundle; state.stage = state.prepared = null;
      state.sourceId = state.sourceVersionId = null; state.sourceDrafts.clear(); state.readerPositions.clear(); state.readerModes.clear(); state.remoteChanged = false; resetSearchContext();
      await refreshData(); if (disposed) return; connectSubscription();
      const source = state.bundle.sources[0], version = state.bundle.sourceVersions[0];
      await navigate('source', { sourceId: source.id, sourceVersionId: version.id, locator: null, returnContext: { mode: 'naver-blog', workspaceId: state.bundle.workspaceId } });
      announce(managedLibrary ? '원문과 사진 파일을 새 사본에 복원했습니다.' : '원문과 사진 파일을 새 독립 공간에 복원했습니다. 서버에 자동 전송하지 않았습니다.');
    }
    async function writeNaverPhotos({ sourceId, sourceVersionId, indexes, expectedCaptureHash }) {
      const workspaceId = state.bundle.workspaceId, workspace = workspaceGeneration, token = navigationGeneration, account = state.syncAccountKey;
      const current = () => !disposed && workspace === workspaceGeneration && state.bundle?.workspaceId === workspaceId && token === navigationGeneration && account === state.syncAccountKey;
      if (!Array.isArray(indexes) || !indexes.length || indexes.length > 20 || new Set(indexes).size !== indexes.length) throw new Error('글에 넣을 사진을 선택해 주세요.');
      const [bundle, attachment] = await Promise.all([storage.read(workspaceId), storage.readNaverCapture(workspaceId, sourceVersionId)]);
      if (!current()) return;
      const source = bundle.sources.find(value => value.id === sourceId), version = bundle.sourceVersions.find(value => value.id === sourceVersionId && value.sourceId === sourceId);
      if (!source || !version) throw new Error('선택한 정확한 원문 판을 찾을 수 없습니다.');
      if (!core.isVersionActive(bundle, sourceVersionId)) throw new Error('휴지통의 자료는 복원한 뒤 새 글에 활용해 주세요.');
      if (!attachment || attachment.sourceId !== sourceId || expectedCaptureHash && attachment.capture.capture_hash !== expectedCaptureHash) throw new Error('선택한 수집 판을 먼저 자료에 반영해 주세요.');
      const M = global.HaedoLife.PhotoPost, doc = M.create(core.id), ops = [];
      for (const index of indexes) {
        const entry = attachment.photos.find(value => value.index === index), description = attachment.capture.payload.photos.find(value => value.index === index);
        if (!entry || description?.status !== 'stored') throw new Error('파일로 보관한 사진을 선택해 주세요.');
        const photo = await M.readPhoto(entry.blob, core.id); if (!current()) return;
        doc.photos.push(photo); ops.push({ insert: { photo: { id: photo.id, alt: description.alt, caption: description.caption } } }, { insert: '\n' });
      }
      if (source?.url) ops.push({ insert: '사진 출처: ' + source.url + '\n' });
      doc.ops = ops; M.validate(doc); if (!current()) return;
      await storage.savePhotoPostFromNaverCapture(workspaceId, doc, { sourceId, sourceVersionId, captureHash: attachment.capture.capture_hash }, { isCurrent: current });
      if (!current()) return;
      viewOrigins.set('page', naverOrigin());
      await navigate('page', { blogContext: true, preserveContext: true, searchTarget: { photoPostId: doc.id }, pagePreview: false });
      announce('선택한 사진과 원문 주소로 비공개 초안을 만들었습니다.');
    }

    async function renderAccountBlog() {
      const workspaceId = state.bundle.workspaceId, workspaceToken = workspaceGeneration;
      const host = node('section'); host.id = 'lifeAccountBlogHost'; main.append(host);
      const instance = global.HaedoLife.AccountBlogUI.create({ storage, workspaceId, blogSync,
        viewState: accountBlogViews.get(workspaceId),
        isCurrent: () => !disposed && workspaceToken === workspaceGeneration &&
          state.mode === 'account-blog' && state.bundle?.workspaceId === workspaceId,
        onOpenPost: (postId, options = {}) => navigate('page', { blogContext: true,
          searchTarget: { photoPostId: postId, photoPostRevision: options.expectedRevision },
          pagePreview: false, originFocusKey: options.focusKey }),
        onManagePost: (postId, options = {}) => navigate('blog', { blogPostId: postId, originFocusKey: options.focusKey })
      });
      accountBlogUI = instance; accountBlogWorkspace = workspaceId;
      await instance.mount(host);
    }

    async function openPostAction(mode, postId, options = {}) {
      if (state.mode !== 'page' || !['blog', 'preservation'].includes(mode)) return false;
      const workspaceId = state.bundle?.workspaceId, workspace = workspaceGeneration, navigation = navigationGeneration, account = state.syncAccountKey;
      const current = () => !disposed && state.mode === 'page' && state.bundle?.workspaceId === workspaceId &&
        workspace === workspaceGeneration && navigation === navigationGeneration && account === state.syncAccountKey;
      if (typeof postId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(postId) || !Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 1) {
        throw new Error('읽던 글의 정확한 판을 확인해 주세요.');
      }
      const post = await storage.readPhotoPost(workspaceId, postId);
      if (!current()) return false;
      if (post.id !== postId || post.status !== 'saved' || post.revision !== options.expectedRevision) {
        throw postContextChanged(postId);
      }
      const postTarget = { id: post.id, revision: post.revision };
      const origin = { mode: 'page', workspaceId, scrollY: global.scrollY, focusKey: options.originFocusKey,
        postTarget, blogPageTask, materialWritingTask, parentOrigin: viewOrigins.get('page') || null };
      return navigate(mode, { viewOrigin: origin, exactPost: postTarget, blogPostId: mode === 'blog' ? post.id : undefined });
    }

    function restorePostReturn(context) {
      const pending = pendingPostReturn;
      if (!pending || context.mode !== 'read' || context.id !== pending.origin.postTarget.id) return;
      pendingPostReturn = null;
      requestAnimationFrame(() => {
        if (disposed || state.mode !== 'page' || navigationGeneration !== pending.navigation || workspaceGeneration !== pending.workspace ||
          state.bundle?.workspaceId !== pending.workspaceId || state.syncAccountKey !== pending.account || inputGeneration !== pending.input) return;
        const target = [...main.querySelectorAll('[data-focus-key]')].find(control => control.dataset.focusKey === pending.origin.focusKey);
        for (let parent = target?.parentElement; parent && parent !== main; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
        target?.focus({ preventScroll: true });
        global.scrollTo({ top: pending.origin.scrollY, behavior: 'instant' });
      });
    }

    async function renderBlogManager() {
      const workspaceId = state.bundle.workspaceId;
      const host = node('section'); host.id = 'lifeBlogManager'; main.append(host);
      const instance = global.HaedoLife.BlogManager.create({ storage, workspaceId, auth, blogSync,
        onOpenAccountBlog: options => navigate('account-blog', { originFocusKey: options?.originFocusKey }),
        onOpenEvidence: (reference, context = {}) => openManagedSource(workspaceId, { sourceId: reference.sourceId, sourceVersionId: reference.sourceVersionId, locator: { ...reference.locator } }, context, reference),
        isCurrent: () => !disposed && state.mode === 'blog' && state.bundle?.workspaceId === workspaceId,
        openPost: (postId, options = {}) => navigate('page', { blogContext: true, searchTarget: { photoPostId: postId, photoPostRevision: options.expectedRevision }, pagePreview: false, originFocusKey: options.focusKey }),
        openLegacy: (row, context = {}) => row.kind === 'source' ? openManagedSource(workspaceId, { sourceId: row.id, sourceVersionId: row.versionId, locator: null }, context) :
          row.kind === 'writing-draft' ? navigate('write', { writing: { stageId: row.id }, originFocusKey: context.focusKey }) :
          row.kind === 'page-draft' ? navigate('page', { blogContext: true, pageDraftId: row.id, originFocusKey: context.focusKey }) : navigate('page', { blogContext: true, searchTarget: { postId: row.id }, pagePreview: false, originFocusKey: context.focusKey })
      });
      blogManager = instance; blogManagerWorkspace = workspaceId; const options = { viewState: blogViews.get(workspaceId), ...(blogOpenOptions || {}) }; blogOpenOptions = null;
      blogManagerPostId = options.postId || null;
      await instance.mount(host, options);
    }

    async function renderPreservation() {
      const workspaceId = state.bundle.workspaceId, workspaceToken = workspaceGeneration, navigationToken = navigationGeneration;
      const openOptions = preservationOpenOptions || {}; preservationOpenOptions = null;
      const isCurrent = () => !disposed && workspaceToken === workspaceGeneration && navigationToken === navigationGeneration &&
        state.mode === 'preservation' && state.bundle?.workspaceId === workspaceId;
      if (openOptions.exactPost) {
        const post = await storage.readPhotoPost(workspaceId, openOptions.exactPost.id);
        if (!isCurrent()) return;
        if (post.id !== openOptions.exactPost.id || post.status !== 'saved' || post.revision !== openOptions.exactPost.revision) {
          throw postContextChanged(openOptions.exactPost.id);
        }
      }
      const host = node('section'); host.id = 'lifePreservationHost'; main.append(host);
      const service = global.HaedoLife.Preservation.create({ storage, workspaceId, isCurrent });
      const instance = global.HaedoLife.PreservationUI.create({ service, isCurrent,
        async onRestored() {
          const listSequence = ++workspaceListRefresh;
          const workspaces = await storage.listWorkspaces();
          if (isCurrent()) applyWorkspaceList(workspaces, listSequence);
        },
        async onOpen(id) {
          if (!isCurrent()) return;
          await persistDrafts();
          const listSequence = ++workspaceListRefresh;
          const [bundle, workspaces, stages] = await Promise.all([storage.read(id), storage.listWorkspaces(), storage.listStages(id)]);
          if (!isCurrent()) return;
          await storage.setActive(id);
          if (!isCurrent()) return;
          invalidateBatchContext();
          state.bundle = bundle; state.stage = null; state.prepared = null;
          state.sourceId = state.sourceVersionId = null; state.sourceDrafts.clear();
          state.readerPositions.clear(); state.readerModes.clear(); state.remoteChanged = false; resetSearchContext();
          applyWorkspaceList(workspaces, listSequence);
          const imports = stages.filter(stage => stage.kind !== 'writing' && stage.kind !== 'source-edit');
        state.sourceEditStages = stages.filter(stage => stage.kind === 'source-edit' && stage.state === 'draft');
          state.allStages = imports; state.stages = imports.filter(stage => stage.state === 'draft'); mergeBatches(imports);
          connectSubscription();
          state.mode = 'blog'; render();
          announce('복원한 글과 원문 근거를 열었습니다. 원래 작업공간은 유지됩니다.');
        }
      });
      preservationUI = instance; await instance.mount(host, { postIds: openOptions.postIds || [],
        expectedPostRevisions: openOptions.exactPost ? { [openOptions.exactPost.id]: openOptions.exactPost.revision } : {} });
    }

    async function openOriginalSource(match, origin) {
      if (disposed) return;
      const workspace = workspaceGeneration, navigation = navigationGeneration;
      const current = () => !disposed && workspace === workspaceGeneration && navigation === navigationGeneration;
      await persistDrafts();
      if (!current()) return;
      const bundle = await storage.read(match.workspaceId);
      if (!current()) return;
      const version = bundle.sourceVersions.find(row => row.id === match.versionId);
      if (!version) throw new Error('정확한 원문 버전을 찾지 못했습니다. 원본 파일은 보관됩니다.');
      const sameWorkspace = bundle.workspaceId === state.bundle.workspaceId;
      if (!sameWorkspace) {
        await storage.setActive(bundle.workspaceId);
        if (!current()) return;
        invalidateBatchContext();
        state.stage = state.prepared = null; state.sourceId = state.sourceVersionId = null;
        state.sourceDrafts.clear(); state.readerPositions.clear(); state.readerModes.clear(); resetSearchContext();
      }
      state.bundle = bundle; state.remoteChanged = false;
      const installedWorkspace = workspaceGeneration;
      await refreshData();
      if (disposed || installedWorkspace !== workspaceGeneration || navigation !== navigationGeneration || state.bundle?.workspaceId !== bundle.workspaceId) return;
      connectSubscription();
      return navigate('source', { sourceId: version.sourceId, sourceVersionId: version.id,
        returnContext: { mode: sameWorkspace && origin?.mode ? origin.mode : 'sources', workspaceId: bundle.workspaceId, focusKey: 'records:menu:originals',
          folderFilter: sameWorkspace ? state.folderFilter : 'all', scrollY: origin?.workspaceId === bundle.workspaceId ? origin.scrollY : 0 } });
    }

    async function renderObsidianUpdate() {
      const workspaceToken = workspaceGeneration, workspaceId = state.bundle.workspaceId;
      const isCurrent = () => !disposed && workspaceToken === workspaceGeneration && state.mode === 'obsidian-update';
      const host = node('section'); main.append(host);
      const instance = global.HaedoLife.ObsidianUpdateUI.create({ storage, isCurrent,
        async onRestored() {
          if (!isCurrent()) return;
          await storage.setActive(workspaceId);
          const listSequence = ++workspaceListRefresh;
          const rows = await storage.listWorkspaces(); if (isCurrent()) applyWorkspaceList(rows, listSequence);
        }
      });
      obsidianUpdateUI = instance; await instance.mount(host);
    }

    async function renderPublicCover() {
      const workspaceId = state.bundle.workspaceId, workspaceToken = workspaceGeneration, renderToken = renderGeneration;
      const isCurrent = () => !disposed && workspaceToken === workspaceGeneration && renderToken === renderGeneration &&
        state.bundle?.workspaceId === workspaceId && state.mode === 'public-cover';
      const host = node('section'); host.id = 'lifePublicCover'; main.append(host);
      if (!global.HaedoLife.PublicCoverUI) throw new Error('공개 표지 편집기를 불러오지 못했습니다. 다시 열어 주세요.');
      const instance = global.HaedoLife.PublicCoverUI.create({ host, storage, workspaceId, auth, isCurrent, baseURL: global.location.href });
      publicCoverUI = instance; await instance.ready;
    }

    function renderManagement() {
      const manage = actionRow('현재 자료공간', (managedLibrary ? '자료 ' : '이 브라우저 · 자료 ') + state.bundle.sources.length + '개 · 발췌 ' + state.bundle.records.length + '개', 'book', () => {}, state.bundle.title || '내 자료');
      manage.id = 'lifeCurrentWorkspace';
      manage.setAttribute('aria-label', '현재 자료공간');
      manage.setAttribute('aria-description', '현재 작업공간. 눌러 다른 작업공간을 선택합니다.');
      const management = node('section', null, 'life-management');
      management.id = 'lifeManagement';
      management.hidden = !state.managementOpen;
      management.setAttribute('aria-label', '현재 자료공간');
      const close = iconButton('자료공간 닫기', 'close', () => setManagement(false));
      const setManagement = disclosure(manage, management, { onChange: open => { state.managementOpen = open; } });
      const managementHeading = node('div', null, 'life-panel-heading');
      managementHeading.append(node('h2', '현재 자료공간'), close);
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
        state.readerPositions.clear(); state.readerModes.clear();
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
      if (sync) {
        const connection = actionRow(managedLibrary ? '계정 보관' : '기기 간 동기화', '', 'cloud', async () => {
          await navigate('sync'); await refreshSync();
        });
        const status = connection.querySelector('.life-meta');
        status.id = 'lifeManagementSyncStatus';
        status.setAttribute('role', 'status');
        const presentation = syncPresentation();
        status.textContent = (managedLibrary ? '' : '원문·발췌 · ') + presentation.label;
        status.dataset.syncState = presentation.key;
        main.append(connection);
        if (!managedLibrary) main.append(node('p', '묶음·내 페이지와 글쓰기 초안은 각각 연결합니다.', 'life-help life-management-note'));
        refreshSync().catch(failure);
      }
      const backups = node('section', null, 'life-management-backups');
      backups.setAttribute('aria-labelledby', 'lifeBackupChoices');
      const heading = node('h2', '파일로 보관'); heading.id = 'lifeBackupChoices';
      backups.append(heading);
      const materialFiles = node('section', null, 'life-backup-group'); materialFiles.id = 'lifeBackupMaterials'; materialFiles.setAttribute('aria-label', '자료·글');
      materialFiles.append(node('h3', '자료·글'));
      const planningFiles = node('section', null, 'life-backup-group'); planningFiles.id = 'lifeBackupPlanning'; planningFiles.setAttribute('aria-label', '계획·연표');
      planningFiles.append(node('h3', '계획·연표'));
      const destinations = node('div', null, 'life-destinations');
      destinations.append(actionRow('자료·구성 백업', '원문·발췌와 폴더·묶음·내 페이지·회고·책을 함께', 'download', () => navigate('workbench-backup')));
      destinations.append(actionRow('내보내기·사본 복원', '자료만 JSON·Markdown으로 · 구성 제외', 'book', () => navigate('transfer')));
      destinations.append(actionRow('컬렉션 백업·복구', '컬렉션 정보·비공개 메모를 별도 파일로 보관', 'bookmark', async () => { await navigate('collection'); collection?.showBackup(); }));
      const preservation = actionRow('보관 범위·근거 파일', '선택한 글·9칸과 정확한 원문 근거', 'download', () => navigate('preservation'));
      preservation.id = 'lifePreservationOpen'; destinations.append(preservation);
      materialFiles.append(destinations);
      const planningDestinations = node('div', null, 'life-destinations');
      planningDestinations.append(actionRow('연간 계획 파일', '연간·월별 계획의 전용 백업·복원', 'timeline', async () => {
        if (await navigate('annual-plan') === false) return;
        const panel = main.querySelector('#apSettings');
        if (panel) { panel.open = true; panel.querySelector('summary')?.focus(); panel.scrollIntoView({ block: 'nearest' }); }
      }));
      planningDestinations.append(destinationRow('연표·목표·습관 백업·복원', '연간 계획 파일과 별도 형식', 'workspace.html?section=manage#backupAll', 'timeline'));
      planningFiles.append(planningDestinations);
      backups.append(materialFiles, planningFiles);
      main.append(backups);
    }

    function renderStages(parent) {
      if (!state.stages.length && !state.sourceEditStages.length) return;
      const details = node('details', null, 'life-details');
      details.id = 'lifeImportDrafts';
      details.append(node('summary', '검토 중 ' + (state.stages.length + state.sourceEditStages.length) + '개 · 이어서 확인'));
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
      state.sourceEditStages.forEach(stage => {
        const row = node('div', null, 'life-row');
        const open = button(stage.input.title || '제목 없는 수정 초안', guarded(() => {
          sourceEditOrigin = { workspaceId: state.bundle.workspaceId, sourceId: stage.baseSourceId,
            sourceVersionId: stage.baseSourceVersionId, scrollY: 0, returnContext: { mode: 'sources', workspaceId: state.bundle.workspaceId } };
          return navigate('source-edit', { sourceEdit: { stageId: stage.stageId } });
        }));
        open.dataset.sourceEditStageId = stage.stageId;
        row.append(open, node('span', '자료 수정', 'life-meta')); details.append(row);
      });
      parent.append(details);
    }

    function resetSearchContext() {
      sourceFoldersMount?.dispose(); sourceFoldersMount = null; sourceFoldersUpdate = null;
      sourceFoldersUI?.dispose(); sourceFoldersUI = null; sourceFoldersWorkspace = null;
      state.folderFilter = 'all';
      unifiedSearch?.reset();
      viewOrigins.clear();
      sourceWritingRequests.clear(); sourceStateRequests.clear(); materialWritingTask = false;
      selectedVersions.clear();
      selectionReturn = null;
      chapterImport = null;
      externalImportContext = null;
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
      if (versionIds.some(id => !core.isVersionActive(state.bundle, id))) {
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
      if (!context || context.workspaceId !== state.bundle?.workspaceId) return navigate('sources', { navigationMotion: 'back' });
      if (await navigate(context.mode, { sourceId: context.sourceId, sourceVersionId: context.sourceVersionId,
        locator: context.locator, returnContext: context.returnContext, preserveContext: true,
        readerArrangeOpen: context.mode === 'source', navigationMotion: 'back' }) === false) return;
      const navigation = navigationGeneration;
      requestAnimationFrame(() => {
        if (disposed || navigation !== navigationGeneration || state.bundle?.workspaceId !== context.workspaceId || state.mode !== context.mode) return;
        main.querySelector('#' + context.focusId)?.focus({ preventScroll: true });
        global.scrollTo({ top: context.scrollY, behavior: 'instant' });
      });
    }

    function arrangeActions(getVersions) {
      const actions = node('div', null, 'life-actions life-arrange-actions');
      [['activities', '묶음에 담기', 'link', 'lifeArrangeGroups', 'life-arrange-groups'],
        ['page', '선택 자료 페이지에 담기', 'user', 'lifeArrangePage', 'life-arrange-page'],
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
        row.hidden = view.status === 'empty' || !!view.position && !activeSource(view.position.sourceId);
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
            if (!core.isSourceActive(bundle, sourceId) || !bundle.sources.some(item => item.id === sourceId) || !version || typeof version.contentText !== 'string' ||
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
      if (mode === 'sources') returnContext.folderFilter = state.folderFilter;
      return navigate('source', { sourceId: ref.sourceId, sourceVersionId: ref.sourceVersionId, locator: ref.locator || null, suppressReaderResume: (mode === 'find' || mode === 'sources' && !!state.sourcesSearch.trim()) && !ref.locator, returnContext });
    }

    async function returnToResults() {
      const context = state.returnContext;
      if (!context || context.workspaceId !== state.bundle.workspaceId) return navigate('sources', { returnContext: null, navigationMotion: 'back' });
      if (context.mode === 'sources' && typeof context.folderFilter === 'string') state.folderFilter = context.folderFilter;
      if (await navigate(context.mode, { returnContext: null, homeState: context.homeState, homeAnchor: context.homeAnchor, navigationMotion: 'back', sourcesRevealVersionId: context.mode === 'sources' ? context.sourceVersionId || null : null, blogPostId: context.mode === 'blog' ? context.blogPostId : null }) === false) return;
      const navigation = navigationGeneration;
      const restore = () => requestAnimationFrame(() => {
        if (disposed || navigation !== navigationGeneration || state.bundle?.workspaceId !== context.workspaceId || state.mode !== context.mode || context.homeAnchor) return;
        const target = Array.from(root.querySelectorAll('[data-focus-key]')).find(el => el.dataset.focusKey === context.focusKey) ||
          (context.mode === 'sources' && Array.from(main.querySelectorAll('.life-source-open')).find(el => el.dataset.versionId === context.sourceVersionId)) || main.querySelector('#lifeFindQuery,#lifeSearch,h1,h2');
        const panel = target?.closest('[data-result-panel]');
        let ancestor = target?.parentElement;
        while (ancestor && ancestor !== root) { if (ancestor.tagName === 'DETAILS') ancestor.open = true; ancestor = ancestor.parentElement; }
        if (panel?.hidden) Array.from(main.querySelectorAll('[aria-controls]')).find(el => el.getAttribute('aria-controls') === panel.id)?.click();
        target?.focus({ preventScroll: true });
        if (!context.homeAnchor) global.scrollTo({ top: context.scrollY, behavior: 'instant' });
      });
      if (context.focusKey === context.mode + ':reading-resume') {
        const pending = readingResumePromise;
        pending.then(() => { if (pending === readingResumePromise) restore(); });
      } else if (context.mode === 'home') {
        const pending = homeRenderPromise;
        pending.then(() => { if (pending === homeRenderPromise) restore(); });
      }
      else if (context.mode === 'find') findRenderPromise.then(restore);
      else if (context.mode === 'naver-capture' || context.mode === 'naver-blog' || context.mode === 'interests' || context.mode === 'external-discovery' || context.mode === 'blog') mainRenderPromise.then(restore);
      else restore();
    }

    function searchReturnButton() {
      const labels = { 'naver-capture': '본문·사진 검토로 돌아가기', 'naver-blog': '네이버 블로그 목록으로 돌아가기', 'external-discovery': '새 글 찾기로 돌아가기', interests: '관심 주제 편집으로 돌아가기', blog: '글 공개·보관으로 돌아가기', home: '홈으로 돌아가기', activities: '묶음으로 돌아가기', page: '선택 자료 페이지로 돌아가기', discover: '다시 찾기로 돌아가기', related: '관련 기록으로 돌아가기', reflection: '회고로 돌아가기', books: '책으로 돌아가기' };
      const back = iconButton(labels[state.returnContext?.mode] || '검색 결과로 돌아가기', 'back', guarded(returnToResults));
      back.id = 'lifeSearchReturn';
      return back;
    }

    async function returnFromRelated() {
      const origin = relatedOrigin;
      if (!origin || origin.workspaceId !== state.bundle?.workspaceId) return navigate('sources', { returnContext: null, navigationMotion: 'back' });
      if (await navigate('source', { sourceId: origin.sourceId, sourceVersionId: origin.sourceVersionId,
        locator: origin.locator, returnContext: origin.returnContext, suppressReaderResume: false, navigationMotion: 'back' }) === false) return;
      const navigation = navigationGeneration;
      requestAnimationFrame(() => {
        if (disposed || navigation !== navigationGeneration || state.bundle?.workspaceId !== origin.workspaceId || state.mode !== 'source' || state.sourceVersionId !== origin.sourceVersionId) return;
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
        announce(managedLibrary ? '발췌를 제거했습니다. 원문은 유지됩니다.' : '발췌를 제거했습니다. 원문 사본은 이 브라우저에 보관됩니다.');
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
      const topicNames = Array.from(new Set(state.bundle.records.filter(activeRecord).map(record => record.topic || ''))).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
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
        const searched = state.bundle.records.filter(activeRecord).filter(record => matchingText([record.text, record.topic, record.note, ...record.sourceRefs.map(ref => sourceLabel(sourceFor(ref.sourceId) || {}))].join(' '), state.topicsSearch));
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
        if (!records.length && !state.bundle.records.some(activeRecord) && state.bundle.sources.some(source => activeSource(source.id)) && !state.topic && !state.topicUnassigned) {
          const sources = state.bundle.sources.filter(source => activeSource(source.id)).slice().reverse().map(source => ({ source, version: state.bundle.sourceVersions.filter(version => version.sourceId === source.id).at(-1) }))
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

    async function changeSourceState(sourceId, next, expectedRevision, snapshot = {}) {
      const workspaceId = state.bundle.workspaceId, workspace = workspaceGeneration, account = state.syncAccountKey;
      const isCurrent = () => !disposed && workspace === workspaceGeneration && account === state.syncAccountKey && state.bundle?.workspaceId === workspaceId;
      await persistDrafts();
      if (!isCurrent()) return false;
      const key = JSON.stringify([account, workspaceId, sourceId, next, expectedRevision, snapshot]);
      if (!sourceStateRequests.has(key)) sourceStateRequests.set(key, { workspaceId, baseRevision: state.bundle.revision,
        operationId: core.id(), changes: core.buildSourceStateChanges(state.bundle, sourceId, next, { expectedRevision, ...snapshot }) });
      const result = await storage.commitLocal(sourceStateRequests.get(key), { isCurrent });
      if (!isCurrent()) return false;
      if (result.status !== 'stored') {
        if (result.status === 'conflict') { sourceStateRequests.delete(key); state.remoteChanged = true; renderHeader(); }
        throw Object.assign(new Error(result.error?.message || '자료 상태를 저장하지 못했습니다. 다시 시도해 주세요.'), { code: result.error?.code });
      }
      sourceStateRequests.delete(key); await refreshData(); state.remoteChanged = false;
      if (isCurrent() && next === 'trash') for (const version of state.bundle.sourceVersions) {
        if (version.sourceId === sourceId) selectedVersions.delete(version.id);
      }
      return isCurrent();
    }

    function renderSourceTrash() {
      const list = node('div', null, 'life-card-grid'); list.id = 'lifeSourceTrashList';
      const sources = state.bundle.sources.filter(source => !activeSource(source.id));
      for (const source of sources) {
        const lifecycle = core.sourceState(state.bundle, source.id), version = state.bundle.sourceVersions.filter(value => value.sourceId === source.id).at(-1);
        const row = node('article', null, 'life-card life-source-card'); row.dataset.sourceId = source.id;
        const read = button(sourceLabel(source), guarded(() => openResult('source-trash', 'trash:' + source.id, { sourceId: source.id, sourceVersionId: version.id })), 'life-source-open');
        read.dataset.sourceTrashRead = source.id;
        const restore = button('복원', guarded(async () => {
          if (!await changeSourceState(source.id, 'active', lifecycle.revision, { expectedSourceRevision: source.revision, expectedStatus: 'trash' })) return;
          await navigate('source', { sourceId: source.id, sourceVersionId: version.id, locator: null,
            returnContext: { mode: 'source-trash', workspaceId: state.bundle.workspaceId, scrollY: global.scrollY } });
          announce('자료를 복원했습니다.');
        })); restore.dataset.sourceRestore = source.id;
        row.append(read, restore); list.append(row);
      }
      if (!sources.length) list.append(empty('휴지통이 비어 있습니다.'));
      main.append(list);
    }

    function foldersController() {
      const workspaceId = state.bundle?.workspaceId;
      if (!workspaceId || !global.HaedoLife.SourceFoldersUI) return null;
      if (sourceFoldersWorkspace !== workspaceId) {
        sourceFoldersMount?.dispose(); sourceFoldersMount = null; sourceFoldersUpdate = null;
        sourceFoldersUI?.dispose(); sourceFoldersUI = null;
        sourceFoldersWorkspace = workspaceId;
        const workspace = workspaceGeneration;
        sourceFoldersUI = global.HaedoLife.SourceFoldersUI.create({ document, storage, getBundle: () => state.bundle,
          announce, isCurrent: () => !disposed && workspace === workspaceGeneration && state.bundle?.workspaceId === workspaceId,
          onChange: (_snapshot, change) => { if (!disposed && state.mode === 'sources' && state.bundle?.workspaceId === workspaceId) sourceFoldersUpdate?.(change); }
        });
      }
      return sourceFoldersUI;
    }

    function renderSources() {
      const heading = title('기록');
      heading.classList.add('life-sr-only');
      main.append(heading);
      if (accountMaterialsFailure?.workspaceId === state.bundle.workspaceId) {
        const notice = node('div', null, 'life-help');
        notice.id = 'lifeAccountMaterialsNotice';
        notice.setAttribute('role', 'status');
        const workspaceId = state.bundle.workspaceId, workspace = workspaceGeneration;
        const retry = button('계정 자료 다시 확인', guarded(async () => {
          await persistDrafts();
          if (disposed || signal?.aborted || workspace !== workspaceGeneration || state.bundle?.workspaceId !== workspaceId) return;
          const confirmed = await registerAccountMaterials(workspaceId);
          if (disposed || signal?.aborted || workspace !== workspaceGeneration || state.bundle?.workspaceId !== workspaceId) return;
          if (confirmed || accountMaterialsFailure?.workspaceId === workspaceId && accountMaterialsFailure.partial) await refreshData();
          if (disposed || signal?.aborted || workspace !== workspaceGeneration || state.bundle?.workspaceId !== workspaceId || state.mode !== 'sources') return;
          render();
          announce(confirmed ? '계정 자료를 확인했습니다.' : accountMaterialsFailure?.partial ? accountMaterialsPartialNotice : accountMaterialsNotice);
        }));
        retry.id = 'lifeAccountMaterialsRetry';
        notice.append(node('p', accountMaterialsFailure.partial ? accountMaterialsPartialNotice : accountMaterialsNotice), retry);
        main.append(notice);
      }
      renderStages(main);
      const list = node('div', null, 'life-card-grid'); list.id = 'lifeSearchResults';
      const workspaceId = state.bundle.workspaceId;
      let folderUpdateDeferred = false;
      list.addEventListener('toggle', event => {
        if (!folderUpdateDeferred || !event.target.matches('.source-folder-assignment') || event.target.open) return;
        folderUpdateDeferred = false; sourceFoldersUpdate?.({ reason: 'closed' });
      }, true);
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
      const folders = foldersController();
      let moveSelection = null;
      if (folders) {
        moveSelection = folders.assignmentControl({ sourceIds: () => [...new Set([...selectedVersions].map(id => {
          const version = state.bundle.sourceVersions.find(value => value.id === id);
          if (!version) throw new Error('선택한 원문을 찾을 수 없습니다. 선택 목록을 확인해 주세요.');
          return version.sourceId;
        }))], buttonLabel: '선택한 자료를 폴더로 이동' });
        controls.append(moveSelection);
      }
      controls.append(iconButton('선택 모두 해제', 'close', () => { selectedVersions.clear(); update(); selectionSummary.focus(); }));
      const cancelSelection = button('선택 취소', () => {
        selectedVersions.clear(); state.selecting = false; render();
        toolbar.querySelector('#lifeSelectionToggle')?.focus({ preventScroll: true });
      });
      selectionBar.append(selectionDetails, selectionStatus, controls, cancelSelection);
      function updateSelection(matches) {
        if (!state.selecting) return;
        const visible = new Set(matches.map(hit => hit.sourceVersionId));
        const hiddenCount = [...selectedVersions].filter(id => !visible.has(id)).length;
        selectionSummaryText.textContent = '선택한 기록 ' + selectedVersions.size + '개';
        selectionStatus.textContent = selectedVersions.size ? (hiddenCount ? '현재 검색 결과 밖에서 선택한 기록 ' + hiddenCount + '개 포함' : '담을 곳에서 선택한 원문을 확인합니다.') : '정리할 기록을 선택해 주세요.';
        controls.querySelectorAll('.life-arrange-groups,.life-arrange-page,.life-arrange-reflection').forEach(control => { control.disabled = !selectedVersions.size; });
        if (moveSelection) moveSelection.hidden = !selectedVersions.size;
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
        const windowKey = JSON.stringify([state.bundle.workspaceId, query, state.originFilter, state.ignoreKoreanSpacing, state.folderFilter]);
        if (state.sourcesWindowKey !== windowKey) {
          state.sourcesWindowKey = windowKey;
          state.sourcesLimit = SEARCH_PAGE_SIZE;
          append = false;
        }
        const start = append ? list.children.length : 0;
        if (!append) list.replaceChildren();
        const searchOptions = { ignoreKoreanSpacing: state.ignoreKoreanSpacing };
        const hits = core.searchSources(state.bundle, query, searchOptions).filter(hit => activeSource(hit.sourceId));
        const byVersion = new Map(hits.map(hit => [hit.sourceVersionId, hit]));
        const matchingRecords = query ? state.bundle.records.filter(activeRecord).filter(record => {
          const text = [record.text, record.topic, record.note].join('\n');
          return state.ignoreKoreanSpacing ? core.matchesSearchText(text, query, searchOptions) : matchingText(text, query);
        }) : state.bundle.records.filter(activeRecord);
        // A note can match without the source text matching. Keep its exact version
        // and do not invent a source-text location for a user's own words.
        if (query) matchingRecords.forEach(record => record.sourceRefs.forEach(ref => {
          if (!activeSource(ref.sourceId) || byVersion.has(ref.sourceVersionId)) return;
          const versions = state.bundle.sourceVersions.filter(version => version.sourceId === ref.sourceId);
          const index = versions.findIndex(version => version.id === ref.sourceVersionId);
          if (index < 0 || !sourceFor(ref.sourceId)) return;
          const hit = { sourceId: ref.sourceId, sourceVersionId: ref.sourceVersionId, matchedBy: 'note', versionIndex: index + 1, versionCount: versions.length };
          byVersion.set(ref.sourceVersionId, hit);
          hits.push(hit);
        }));
        const folderState = state.folderFilter === 'all' ? null : folders?.getFolderState();
        const knownFolder = state.folderFilter === 'all' || state.folderFilter === 'unfiled' || folderState?.folders.some(value => value.id === state.folderFilter);
        const matchesFolder = state.folderFilter === 'all' ? () => true : folderState && knownFolder
          ? global.HaedoLife.SourceFolders.compileMatcher(folderState, state.folderFilter) : () => false;
        const matches = hits.filter(hit => (!state.originFilter || (state.originFilter === 'writing' ? isOwnWriting(sourceFor(hit.sourceId)) : sourceFor(hit.sourceId).origin === state.originFilter)) &&
          matchesFolder(hit.sourceId));
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
          const records = matchingRecords.filter(record => record.sourceRefs.some(ref =>
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
          if (folders) footer.append(folders.assignmentControl({ sourceIds: [source.id], buttonLabel: '폴더로 이동 · ' + sourceLabel(source) }));
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
        if (!matches.length) list.append(empty(state.folderFilter !== 'all' && !folderState ? '폴더를 확인하고 있습니다. 폴더 메뉴에서 다시 확인할 수 있습니다.' : !knownFolder ? '선택한 폴더가 없습니다. 다른 폴더를 선택해 주세요.' : state.bundle.sources.length ? '조건에 맞는 자료가 없습니다.' : '아직 기록이 없습니다. 글을 쓰거나 다른 곳의 기록을 가져와 보세요.'));
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
      if (folders) {
        const folderHost = node('section'); folderHost.id = 'lifeFolderBar'; main.append(folderHost);
        sourceFoldersMount = folders.mountList(folderHost, { filter: state.folderFilter, onFilter: value => { state.folderFilter = value; update(); } });
        sourceFoldersUpdate = ({ reason } = {}) => {
          if (!list.isConnected) return;
          // Explicit refresh must keep an open move form and its chosen destination.
          if (reason === 'ready' && list.querySelector('.source-folder-assignment[open]')) { folderUpdateDeferred = true; return; }
          const focused = document.activeElement?.closest('.source-folder-assignment');
          const focusedSource = focused?.closest('[data-source-id]')?.dataset.sourceId;
          folderUpdateDeferred = false; update();
          if (focusedSource) requestAnimationFrame(() => {
            if (disposed || state.mode !== 'sources' || state.bundle?.workspaceId !== workspaceId || !list.isConnected || focused.isConnected) return;
            const target = [...list.querySelectorAll('.life-source-open')].find(control => control.dataset.sourceId === focusedSource) || main.querySelector('#lifeFolderFilter');
            target?.focus({ preventScroll: true });
          });
        };
      }
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
      if (source.sourceKey) details.append(node('p', '원본 경로: ' + source.sourceKey, 'life-meta life-source-url'));
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

    async function openObsidianReference(ref, focusKey) {
      if (obsidianReaderOrigins.length && !obsidianReaderOrigin(sourceFor(state.sourceId), { id: state.sourceVersionId })) obsidianReaderOrigins.length = 0;
      const origin = { workspaceId: state.bundle.workspaceId, account: state.syncAccountKey, workspace: workspaceGeneration,
        sourceId: state.sourceId, sourceVersionId: state.sourceVersionId, locator: state.sourceSelection && { ...state.sourceSelection },
        returnContext: state.returnContext, scrollY: global.scrollY, focusKey,
        targetSourceId: ref.sourceId, targetVersionId: ref.sourceVersionId, navigation: navigationGeneration + 1 };
      obsidianReaderOrigins.push(origin);
      try {
        if (await navigate('source', { sourceId: ref.sourceId, sourceVersionId: ref.sourceVersionId,
          locator: ref.locator || null, returnContext: origin.returnContext, preserveContext: true }) === false) obsidianReaderOrigins.pop();
      } catch (error) { obsidianReaderOrigins.pop(); throw error; }
    }
    function obsidianReaderOrigin(source, version) {
      const origin = obsidianReaderOrigins.at(-1);
      return origin && origin.workspaceId === state.bundle.workspaceId && origin.account === state.syncAccountKey &&
        origin.workspace === workspaceGeneration && origin.navigation === navigationGeneration && origin.targetSourceId === source?.id && origin.targetVersionId === version?.id ? origin : null;
    }
    async function returnFromObsidianReference(origin) {
      if (obsidianReaderOrigins.at(-1) !== origin) return;
      obsidianReaderOrigins.pop();
      const previous = obsidianReaderOrigins.at(-1), oldNavigation = previous?.navigation;
      if (previous) previous.navigation = navigationGeneration + 1;
      try {
        const ok = await navigate('source', { sourceId: origin.sourceId, sourceVersionId: origin.sourceVersionId,
          locator: origin.locator, returnContext: origin.returnContext, preserveContext: true, navigationMotion: 'back' });
        if (ok === false) { if (previous) previous.navigation = oldNavigation; obsidianReaderOrigins.push(origin); return; }
      } catch (error) { if (previous) previous.navigation = oldNavigation; obsidianReaderOrigins.push(origin); throw error; }
      const token = navigationGeneration;
      requestAnimationFrame(() => {
        if (disposed || token !== navigationGeneration || origin.workspace !== workspaceGeneration || origin.account !== state.syncAccountKey ||
            state.bundle?.workspaceId !== origin.workspaceId || state.mode !== 'source' || state.sourceId !== origin.sourceId || state.sourceVersionId !== origin.sourceVersionId) return;
        const panel = main.querySelector('#lifeObsidianCandidates,.life-obsidian-links');
        const all = main.querySelectorAll('#lifeObsidianCandidates,.life-obsidian-links');
        for (const item of all) item.revealObsidianFocus?.(origin.focusKey);
        const target = Array.from(main.querySelectorAll('[data-obsidian-focus]')).find(el => el.dataset.obsidianFocus === origin.focusKey);
        (target || panel?.querySelector('summary') || main.querySelector('.life-reader-heading'))?.focus({ preventScroll: true });
        global.scrollTo({ top: origin.scrollY, behavior: 'instant' });
      });
    }

    function obsidianConnections(versionId) {
      const matches = [];
      const seen = new Set();
      const sources = new Map(state.bundle.sources.map(source => [source.id, source]));
      const versions = new Map(state.bundle.sourceVersions.map(version => [version.id, version]));
      for (const link of state.bundle.links) {
        if (link.kind !== 'obsidian_link' || link.sourceRefs?.length !== 2) continue;
        const [from, to] = link.sourceRefs;
        const outgoing = from.sourceVersionId === versionId;
        if (!outgoing && to.sourceVersionId !== versionId) continue;
        const target = outgoing ? to : from;
        const key = (outgoing ? 'out:' : 'in:') + target.sourceVersionId + ':' + (target.locator ? target.locator.start + ':' + target.locator.end : 'document');
        if (seen.has(key)) continue;
        const source = sources.get(target.sourceId), version = versions.get(target.sourceVersionId);
        if (!source || !version || version.sourceId !== source.id) continue;
        seen.add(key); matches.push({ target, source, version, outgoing, focusKey: 'obsidian-link:' + link.id + ':' + (outgoing ? 'out' : 'in') });
      }
      if (!matches.length) return null;
      const details = node('details', null, 'life-details life-obsidian-links');
      const list = node('div'), more = button('연결된 노트 더 보기', () => append());
      details.append(node('summary', '연결된 노트 ' + matches.length), list, more);
      let count = 0;
      const append = () => {
        for (const item of matches.slice(count, count + SEARCH_PAGE_SIZE)) {
          const row = node('div', null, 'life-backup-source');
          const locationText = item.target.locator && typeof item.version.contentText === 'string' ? item.version.contentText.slice(item.target.locator.start, item.target.locator.end).slice(0, 100) : '';
          const open = button(sourceLabel(item.source), guarded(() => openObsidianReference(item.target, item.focusKey)));
          open.dataset.obsidianFocus = item.focusKey;
          open.dataset.linkedVersion = item.target.sourceVersionId;
          if (item.target.locator) {
            open.dataset.linkedStart = item.target.locator.start;
            open.dataset.linkedEnd = item.target.locator.end;
            if (locationText) open.setAttribute('aria-label', sourceLabel(item.source) + ' · ' + locationText.replace(/\s+/g, ' '));
          }
          row.append(node('p', item.outgoing ? '이 노트에서 연결' : '이 노트를 연결한 원문', 'life-meta'), open);
          if (locationText) row.append(node('p', locationText, 'life-meta'));
          if (item.source.sourceKey) row.append(node('p', item.source.sourceKey, 'life-meta life-source-url'));
          list.append(row);
        }
        count = Math.min(count + SEARCH_PAGE_SIZE, matches.length);
        more.hidden = count >= matches.length;
      };
      let loaded = false;
      details.addEventListener('toggle', () => { if (details.open && !loaded) { loaded = true; append(); } });
      details.revealObsidianFocus = key => {
        const index = matches.findIndex(item => item.focusKey === key);
        if (index < 0) return;
        details.open = true;
        if (!loaded) { loaded = true; append(); }
        while (count <= index) append();
      };
      return details;
    }

    function obsidianCandidates(source, version, article) {
      const model = global.HaedoLife.ObsidianLinkCandidates, UI = global.HaedoLife.ObsidianLinkCandidatesUI, service = global.HaedoLife.ObsidianLinkCommit;
      if (source.origin !== 'obsidian' || !source.sourceKey || typeof version.contentText !== 'string' || !model || !UI || !service) return null;
      const workspaceId = state.bundle.workspaceId, workspace = workspaceGeneration, navigation = navigationGeneration, account = state.syncAccountKey, generation = renderGeneration;
      const current = id => !disposed && workspace === workspaceGeneration && navigation === navigationGeneration && generation === renderGeneration &&
        account === state.syncAccountKey && id === workspaceId && state.bundle?.workspaceId === workspaceId && state.mode === 'source' && state.sourceId === source.id && state.sourceVersionId === version.id;
      const sourceById = new Map(state.bundle.sources.filter(value => value.origin === 'obsidian' && value.sourceKey && core.isSourceActive(state.bundle, value.id)).map(value => [value.id, value]));
      const notes = state.bundle.sourceVersions.filter(value => sourceById.has(value.sourceId)).map(value => {
        const item = sourceById.get(value.sourceId);
        return { path: item.sourceKey, origin: item.origin, sourceId: item.id, sourceVersionId: value.id, text: value.contentText, contentHash: value.contentHash, title: item.title, url: item.url || '', importedAt: value.importedAt };
      });
      const saver = service.create({ storage, core, candidates: model, isCurrent: current }), host = node('section'); host.id = 'lifeObsidianCandidates';
      const focusKey = ({ occurrence, candidate, locator }) => 'obsidian-candidate:' + occurrence.start + ':' + candidate.sourceVersionId + ':' + (locator?.start ?? 'document') + ':open';
      const ui = UI.create({ text: version.contentText, fromPath: source.sourceKey, notes, attachments: null,
        fromSourceId: source.id, fromSourceVersionId: version.id, existingLinks: state.bundle.links,
        isCurrent: () => current(workspaceId),
        onOpenNote: value => openObsidianReference({ sourceId: value.candidate.sourceId, sourceVersionId: value.candidate.sourceVersionId, locator: value.locator }, focusKey(value)),
        onConnectNote: async ({ occurrence, candidate, locator }) => {
          if (!current(workspaceId)) throw new Error('화면이 바뀌어 연결하지 않았습니다.');
          const targetVersion = notes.find(value => value.sourceVersionId === candidate.sourceVersionId && value.sourceId === candidate.sourceId);
          if (!targetVersion) throw new Error('대상 원문을 다시 확인해 주세요.');
          const result = await saver.save({ workspaceId, from: { sourceId: source.id, sourceVersionId: version.id, contentHash: version.contentHash,
            token: occurrence.token, locator: { start: occurrence.start, end: occurrence.end } },
          to: { sourceId: candidate.sourceId, sourceVersionId: candidate.sourceVersionId, contentHash: targetVersion.contentHash, locator }, target: occurrence.target });
          if (!current(workspaceId)) throw new Error('화면이 바뀌어 결과를 표시하지 않았습니다.');
          if (result.status === 'conflict') throw new Error('연결이나 자료가 달라졌습니다. 최신 자료를 확인하고 다시 선택해 주세요.');
          await refreshData(); if (!current(workspaceId)) return;
          state.remoteChanged = false; renderHeader();
          const existing = article.querySelector('.life-obsidian-links'), updated = obsidianConnections(version.id);
          if (updated) { if (existing) existing.replaceWith(updated); else article.insertBefore(updated, host); }
          announce(result.status === 'unchanged' ? '이미 같은 원문 판과 위치로 연결되어 있습니다.' : '선택한 원문 판과 위치를 연결했습니다.');
        }
      });
      ui.mount(host); host.revealObsidianFocus = key => ui.revealFocus?.(key);
      return host;
    }

    function renderSource() {
      const suppressResume = state.suppressReaderResume;
      state.suppressReaderResume = false;
      state.sourceSelection = null;
      const source = sourceFor(state.sourceId);
      const versions = state.bundle.sourceVersions.filter(v => v.sourceId === state.sourceId);
      const version = state.sourceVersionId ? versions.find(v => v.id === state.sourceVersionId) : versions.slice(-1)[0];
      if (!source || !version) { main.append(title('요청한 원문 버전을 찾을 수 없습니다.'), node('p', '다른 버전으로 자동 전환하지 않았습니다. 최신 내용 확인 후 다시 찾아 주세요.', 'life-help'), state.returnContext ? searchReturnButton() : button('자료실로 돌아가기', guarded(() => navigate('sources')))); state.locator = null; return; }
      state.sourceVersionId = version.id;
      const lifecycle = core.sourceState(state.bundle, source.id), sourceActive = lifecycle.status === 'active';
      let changeReaderMode = null, currentReaderOffset = () => null, optionOffset = null;
      const batch = currentBatch();
      if (batch && batch.items.some(item => item.result?.sourceVersionId === version.id)) {
        const back = button('파일 목록으로 돌아가기', guarded(() => navigate('batch'))); back.id = 'lifeBatchReturn'; main.append(back);
      }
      const article = node('article', null, 'life-reader');
      const tools = node('div', null, 'life-reader-tools');
      const linkedOrigin = obsidianReaderOrigin(source, version);
      const back = state.returnContext ? searchReturnButton() : iconButton('자료실로 돌아가기', 'back', guarded(() => navigate('sources')));
      const info = iconButton('출처 정보', 'info', () => {});
      info.setAttribute('aria-description', '자료 옵션 · 보기, 수정, 휴지통');
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
      arrange.disabled = !sourceActive;
      const useQuote = button('선택 구절로 글 쓰기', guarded(() => {
        const locator = state.sourceSelection && { ...state.sourceSelection };
        if (!locator || locator.start >= locator.end) throw new Error('먼저 본문에서 인용할 구절을 선택해 주세요.');
        return navigate('blog', { evidenceSeed: { sourceId: source.id, versionId: version.id, locator } });
      }));
      const useNine = button('선택 구절을 9칸에 담기', guarded(async () => {
        const locator = state.sourceSelection && { ...state.sourceSelection };
        if (!locator || locator.start >= locator.end) throw new Error('먼저 본문에서 담을 구절을 선택해 주세요.');
        const workspaceId = state.bundle.workspaceId, token = navigationGeneration;
        const reference = await global.HaedoLife.SourceReference.build({ bundle: state.bundle, sourceId: source.id, versionId: version.id, locator });
        if (disposed || token !== navigationGeneration || state.bundle?.workspaceId !== workspaceId) return;
        return navigate('page', { nineReference: { kind: 'source', value: reference } });
      }));
      useQuote.id = 'lifeSourceToBlog'; useNine.id = 'lifeSourceToNine';
      useQuote.disabled = useNine.disabled = true;
      arrangePanel.append(useQuote, useNine);
      if (sourceActive && isOwnWriting(source) && version.id === versions[versions.length - 1].id) {
        tools.append(iconButton('내 글 수정', 'edit', guarded(() => navigate('write', { writing: { sourceId: source.id, sourceVersionId: version.id } }))));
      }
      const heading = node('h1', sourceLabel(source), 'life-heading life-reader-heading');
      heading.tabIndex = -1;
      const versionIndex = versions.findIndex(item => item.id === version.id) + 1;
      article.append(tools, arrangePanel, heading,
        node('p', sourceOrigin(source) + ' · 원문 작성 ' + (version.originalCreatedAt || '미상'), 'life-reader-meta'),
        node('p', (COVERAGE[version.coverage.status] || COVERAGE.unknown) + ' · 버전 ' + versionIndex + '/' + versions.length + (versionIndex === versions.length ? '' : ' · 이전 버전') + (core.isEditedCopy(state.bundle, version.id) ? ' · 해도에서 수정한 사본' : ''), 'life-reader-meta'));
      if (linkedOrigin) {
        const previous = button('이전 원문으로 돌아가기', guarded(() => returnFromObsidianReference(linkedOrigin)));
        previous.id = 'lifeObsidianPreviousSource'; article.append(previous);
      }
      const sourceWriting = button('이 자료로 글쓰기', guarded(async () => {
        const workspaceId = state.bundle.workspaceId, workspaceToken = workspaceGeneration, token = navigationGeneration, account = state.syncAccountKey;
        const fresh = await storage.read(workspaceId);
        if (disposed || workspaceToken !== workspaceGeneration || token !== navigationGeneration || state.mode !== 'source' ||
            account !== state.syncAccountKey || state.bundle?.workspaceId !== workspaceId || state.sourceId !== source.id || state.sourceVersionId !== version.id) return;
        const material = global.HaedoLife.MaterialWriting.material(fresh, source.id, version.id, core.id);
        if (material.contentHash !== version.contentHash) throw new Error('선택한 원문 버전이 바뀌었습니다. 다른 자료로 글쓰기를 시작하지 않았습니다.');
        const key = JSON.stringify([workspaceId, source.id, version.id, version.contentHash]);
        if (!sourceWritingRequests.has(key)) sourceWritingRequests.set(key, core.id());
        return navigate('page', { materialWritingSeed: { requestId: sourceWritingRequests.get(key), workspaceId,
          sourceId: source.id, sourceVersionId: version.id, contentHash: version.contentHash } });
      }));
      sourceWriting.id = 'lifeSourceMaterialWriting'; sourceWriting.disabled = !sourceActive;
      const writingActions = node('div', null, 'life-actions life-reader-writing-actions'); writingActions.append(sourceWriting); article.append(writingActions);
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
      const folders = sourceActive && foldersController();
      if (folders) details.append(folders.assignmentControl({ sourceIds: [source.id], buttonLabel: '이 자료를 폴더로 이동' }));
      info.addEventListener('click', () => { if (details.hidden) optionOffset = currentReaderOffset(); }, { capture: true });
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
        reimport.disabled = !sourceActive;
        details.append(reimport);
      }
      if (version.format === 'text/markdown' && typeof version.contentText === 'string') {
        const format = button('원문 텍스트 보기', () => { changeReaderMode?.(); }); format.id = 'lifeSourceFormatToggle';
        details.append(format);
      }
      if (sourceActive && !isOwnWriting(source)) {
        const edit = button(versionIndex === versions.length ? '내 사본 수정' : '이 버전으로 복원', guarded(() => beginSourceEdit(source, version, { restore: versionIndex !== versions.length })));
        edit.id = versionIndex === versions.length ? 'lifeSourceEdit' : 'lifeSourceRestoreVersion'; details.append(edit);
      }
      if (sourceActive) {
        const confirmPanel = node('section', null, 'life-source-trash-confirm'); confirmPanel.id = 'lifeSourceTrashConfirmation'; confirmPanel.hidden = true;
        confirmPanel.setAttribute('aria-label', '자료 휴지통 이동 확인');
        const trash = button('휴지통으로 이동', () => { confirmPanel.hidden = false; confirmPanel.querySelector('#lifeSourceTrashConfirm').focus({ preventScroll: true }); }); trash.id = 'lifeSourceTrash';
        const confirm = button('휴지통으로 이동', guarded(async () => {
          if (!await changeSourceState(source.id, 'trash', lifecycle.revision, { expectedSourceRevision: source.revision, expectedStatus: 'active' })) return;
          if (state.returnContext?.mode === 'source-trash') await navigate('source-trash');
          else await returnToResults();
          announce('자료를 휴지통으로 이동했습니다.');
        })); confirm.id = 'lifeSourceTrashConfirm';
        const cancel = button('취소', () => { confirmPanel.hidden = true; trash.focus({ preventScroll: true }); }); cancel.id = 'lifeSourceTrashCancel';
        confirmPanel.append(node('p', '자료를 휴지통으로 이동할까요? 원문과 기존 인용은 보존합니다.', 'life-help'), confirm, cancel);
        details.append(trash, confirmPanel);
      } else {
        const restore = button('자료 복원', guarded(async () => {
          if (!await changeSourceState(source.id, 'active', lifecycle.revision, { expectedSourceRevision: source.revision, expectedStatus: 'trash' })) return;
          render(); announce('자료를 복원했습니다.');
        })); restore.id = 'lifeSourceRestore';
        details.append(restore);
        article.append(node('p', '휴지통의 자료입니다.', 'life-meta life-source-trash-status'));
      }
      article.append(details);
      const connections = obsidianConnections(version.id);
      if (connections) article.append(connections);
      const candidates = obsidianCandidates(source, version, article);
      if (candidates) article.append(candidates);
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
      let naverMediaHost = null;
      if (source.origin === 'naver_blog' && storage.readNaverCapture) {
        const mediaHost = node('section', null, 'nv-source-media'); mediaHost.id = 'lifeNaverSourceMedia'; naverMediaHost = mediaHost;
        const workspaceId = state.bundle.workspaceId, generation = renderGeneration, account = state.syncAccountKey;
        const current = () => !disposed && generation === renderGeneration && account === state.syncAccountKey && state.mode === 'source' &&
          state.bundle?.workspaceId === workspaceId && state.sourceId === source.id && state.sourceVersionId === version.id;
        const mediaStatus = node('p', '', 'life-help'); mediaStatus.setAttribute('role', 'status');
        const mediaBody = node('div'), mediaActions = node('div', null, 'life-actions');
        const linkStatus = node('p', '', 'life-help'); linkStatus.id = 'lifeNaverMediaSyncStatus'; linkStatus.setAttribute('role', 'status'); linkStatus.hidden = true;
        const linkActions = node('div', null, 'life-actions');
        let working = false, linking = false, readerService = null, review = null, finishInitialRead;
        const initialRead = new Promise(resolve => { finishInitialRead = resolve; });
        const localReadComplete = () => { finishInitialRead?.(); finishInitialRead = null; };
        mediaHost.append(mediaStatus, mediaBody, mediaActions, linkStatus, linkActions);
        const service = () => {
          if (!readerService) {
            if (!storage.isAccountScoped || !global.HaedoLife.NaverCaptureSync?.create) return null;
            readerService = global.HaedoLife.NaverCaptureSync.create({ storage, auth, core,
              isCurrent: id => id === workspaceId && current() });
            naverReaderService = readerService;
          }
          return readerService;
        };
        const restoreFocus = control => {
          if (document.activeElement !== control) return;
          mediaHost.tabIndex = -1; mediaHost.focus({ preventScroll: true });
        };
        const clearReview = () => { if (review) { restoreFocus(review); review.remove(); review = null; } };
        const unverified = (setup = false) => {
          mediaHost.dataset.state = 'unverified'; mediaHost.setAttribute('aria-busy', 'false');
          mediaHost.style.marginBottom = '24px'; mediaStatus.className = 'life-help';
          mediaStatus.textContent = '이 원문 버전의 사진 사본을 이 브라우저에서 확인하지 못했습니다. 원래 글의 사진 유무와 서버 보관 여부는 알 수 없습니다.';
          mediaBody.replaceChildren(node('p', setup
            ? '기기 간 사진 연결의 서버 준비를 확인하지 못했습니다. 원문은 그대로 읽을 수 있습니다.'
            : '네이버 수집 사본이나 전용 ZIP을 확인할 수 있습니다. 수집 사본을 자료에 반영하면 새 원문 버전이 만들어질 수 있습니다.', 'life-help'));
          retry.hidden = !storage.isAccountScoped;
          if (storage.isAccountScoped && !review) {
            review = button('네이버 수집 사본 확인', guarded(() => openNaverMediaReview(source, version)));
            review.id = 'lifeNaverMediaReview'; mediaActions.append(review);
          }
          restoreNaverMediaReturn();
        };
        const linkRetry = button('다른 기기 사진 연결 다시 시도', () => { void register(); });
        linkRetry.id = 'lifeNaverMediaSyncRetry'; linkRetry.hidden = true; linkActions.append(linkRetry);
        async function register() {
          if (!current() || linking) return;
          linking = true; linkRetry.disabled = true;
          try {
            const manager = service();
            if (!manager?.registerForVersion) throw Object.assign(new Error('사진 연결 준비 미확인'), { code: 'naver_schema_missing' });
            const result = await manager.registerForVersion(workspaceId, version.id);
            if (!current()) return;
            if (result?.status === 'confirmed' || result?.status === 'local_only') {
              linkStatus.dataset.state = result.status; linkStatus.hidden = true; linkStatus.textContent = '';
              restoreFocus(linkRetry); linkRetry.hidden = true;
            } else {
              linkStatus.dataset.state = 'pending'; linkStatus.hidden = false;
              linkStatus.textContent = '다른 기기 사진 연결 대기 중입니다. 이 기기의 사진은 그대로 사용할 수 있습니다.';
              linkRetry.hidden = false;
            }
          } catch (_) {
            if (!current()) return;
            linkStatus.dataset.state = 'error'; linkStatus.hidden = false;
            linkStatus.textContent = '다른 기기 사진 연결을 확인하지 못했습니다. 이 기기의 사진은 그대로 사용할 수 있습니다.';
            linkRetry.hidden = false;
          } finally {
            linking = false;
            if (current()) {
              linkRetry.disabled = false;
              mediaHost.style.marginBottom = mediaHost.dataset.state !== 'ready' || !linkRetry.hidden ? '24px' : '';
            }
          }
        }
        function showAttachment(attachment) {
          if (!current()) return;
          if (attachment.sourceId !== source.id || attachment.sourceVersionId !== version.id) throw new Error('사진을 연결할 원문 버전이 일치하지 않습니다.');
          clearReview(); restoreFocus(retry); retry.hidden = true;
          mediaHost.style.marginBottom = ''; mediaHost.dataset.state = 'ready'; mediaHost.setAttribute('aria-busy', 'false');
          mediaStatus.className = 'life-help';
          mediaStatus.textContent = attachment.localOnly ? '파일에서 복원한 원문·사진 사본 · 서버 보관 여부 미확인' : '검증한 수집 사진 사본 · 업로드 당시 원본 여부 미확인';
          const view = global.HaedoLife.NaverCaptureUI.photos({ payload: attachment.capture.payload, photos: attachment.photos,
            onWritePhotos: value => writeNaverPhotos({ sourceId: source.id, sourceVersionId: version.id, indexes: Array.isArray(value) ? value : value.indexes }),
            onDownload: () => downloadNaverFile({ sourceId: source.id, sourceVersionId: version.id }) });
          if (!current()) { view.dispose(); return; }
          naverPhotoView?.dispose(); naverPhotoView = view; mediaBody.replaceChildren(view.node);
          // A file copy is not a server receipt. Verified local photos remain
          // readable while the exact version's account connection is registered.
          if (!attachment.localOnly && storage.isAccountScoped) void register();
          restoreNaverMediaReturn();
        }
        const retry = button('사진 사본 다시 확인', () => { void load(); });
        retry.id = 'lifeNaverSourceMediaRetry'; retry.hidden = true; mediaActions.append(retry);
        async function load() {
          if (!current() || working) return;
          working = true; retry.disabled = true; mediaHost.dataset.state = 'loading'; mediaHost.setAttribute('aria-busy', 'true');
          mediaStatus.className = 'life-help'; mediaStatus.textContent = '이 원문 버전의 사진 사본을 확인하고 있습니다.';
          try {
            let attachment = await storage.readNaverCapture(workspaceId, version.id);
            if (!current()) return;
            if (attachment) { showAttachment(attachment); return; }
            // Remote photo retrieval must not delay original-text navigation,
            // selection restoration or the reader's first usable frame.
            localReadComplete();
            if (storage.isAccountScoped) {
              const manager = service();
              if (manager?.restoreForVersion) attachment = await manager.restoreForVersion(workspaceId, source.id, version.id);
            }
            if (!current()) return;
            if (attachment) showAttachment(attachment); else unverified();
          } catch (error) {
            if (!current()) return;
            if (error?.code === 'naver_schema_missing') unverified(true);
            else {
              clearReview(); mediaHost.dataset.state = 'error'; mediaHost.setAttribute('aria-busy', 'false');
              mediaHost.style.marginBottom = '24px';
              mediaStatus.className = 'life-error'; mediaStatus.textContent = global.navigator?.onLine === false
                ? '오프라인이라 사진 사본을 확인하지 못했습니다. 원문은 그대로 읽을 수 있습니다. 연결한 뒤 다시 시도해 주세요.'
                : '사진 사본을 확인하지 못했습니다. 원문은 유지됩니다. 다시 시도해 주세요.';
              retry.hidden = false; restoreNaverMediaReturn();
            }
          } finally { localReadComplete(); working = false; if (current()) retry.disabled = false; }
        }
        mainRenderPromise = initialRead; void load();
      }
      if (version.contentText === null || version.contentText === undefined) {
        article.append(empty('본문 미확보 · 링크만 보관했습니다. 원래 출처를 열거나 본문을 제공해 새 버전으로 보관할 수 있습니다.'));
        if (naverMediaHost) article.append(naverMediaHost);
        state.locator = null;
        return;
      }

      // Raw quoting still uses one unchanged Text node; formatted DOM never
      // pretends its display offsets are original UTF-16 source positions.
      const rawReader = node('div', null, 'life-source-text');
      const originalText = document.createTextNode(version.contentText); rawReader.append(originalText);
      const markdown = version.format === 'text/markdown' && global.HaedoLife.SourceMarkdown ? global.HaedoLife.SourceMarkdown.render(document, version.contentText) : null;
      const entryLocator = state.locator || (!suppressResume && state.readerPositions.get(version.id));
      const exactRange = !!entryLocator && entryLocator.start !== entryLocator.end;
      const mappedEntry = !entryLocator || markdown?.blocks.some(block => entryLocator.start >= block.start && entryLocator.start < block.end);
      let formattedView = !!markdown?.formatted && !exactRange && mappedEntry && state.readerModes.get(version.id) !== 'raw';
      let reader = formattedView ? markdown.element : rawReader;
      const readerHost = node('div', null, 'life-source-content'); readerHost.id = 'lifeSourceContent';
      function installReader() {
        reader.id = 'lifeSourceText'; reader.tabIndex = 0; reader.dataset.readingMode = formattedView ? 'formatted' : 'raw';
        reader.setAttribute('role', 'document'); reader.setAttribute('aria-label', formattedView ? '서식으로 보는 원문' : '보관한 원문');
        readerHost.replaceChildren(reader);
        const toggle = details.querySelector('#lifeSourceFormatToggle');
        if (toggle) { toggle.textContent = formattedView ? '원문 텍스트 보기' : '서식 보기'; toggle.disabled = !markdown?.formatted; }
      }
      installReader(); article.append(readerHost);
      if (markdown && !markdown.formatted) details.append(node('p', '서식을 표시하지 못해 원문 텍스트로 열었습니다.', 'life-help'));
      if (naverMediaHost) article.append(naverMediaHost);
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
        if (!sourceActive || !core.isSourceActive(state.bundle, source.id)) throw new Error('자료를 복원한 뒤 새 구절을 저장해 주세요.');
        if (!range || range.start === range.end) throw new Error('먼저 원문에서 발췌할 구절을 선택해 주세요.');
        const prepared = { source, version, match: { kind: 'exact_duplicate', sourceId: source.id, sourceVersionId: version.id } };
        const changes = core.buildImportChanges(state.bundle, prepared, [{ start: range.start, end: range.end, topic: topic.input.value, note: note.input.value }]);
        state.readerPositions.set(version.id, { start: range.start, end: range.end, scrollY: readingScrollY });
        await commit(changes);
        state.sourceDrafts.delete(version.id);
        render();
      announce(managedLibrary ? '모음에 반영됨' : '모음에 반영됨 · 이 브라우저에 저장됨');
      }), 'life-primary');
      saveExcerpt.id = 'lifeSourceExcerptSave';
      saveExcerpt.disabled = true;
      let readingScrollY = global.scrollY;
      let readerInteracted = false;
      let selectionOrigin = 'dom';
      const savePosition = () => {
        const previous = state.readerPositions.get(version.id), offset = formattedView ? markdown.adapter?.visibleOffset() ?? previous?.start ?? 0 : null;
        state.readerPositions.set(version.id, { ...(formattedView ? { start: offset, end: offset } : state.sourceSelection || { start: 0, end: 0 }),
          mode: formattedView ? 'formatted' : 'raw', scrollY: panel.hidden ? global.scrollY : readingScrollY });
      };
      const remember = (start, end) => {
        state.sourceSelection = { start, end };
        if (state.sourceDrafts.has(version.id)) state.sourceDrafts.get(version.id).range = { start, end };
        picked.textContent = start < end ? version.contentText.slice(start, end) : instruction;
        quote.dataset.hasSelection = String(start < end);
        saveExcerpt.disabled = !sourceActive || formattedView || start >= end;
        useQuote.disabled = useNine.disabled = !sourceActive || formattedView || start >= end;
        savePosition();
      };
      const capture = event => {
        if (['pointerup', 'keyup'].includes(event?.type)) readerInteracted = true;
        if (formattedView || !sourceActive || !reader.isConnected || document.activeElement?.matches('input,textarea')) return;
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
      for (const body of [rawReader, ...(markdown?.formatted ? [markdown.element] : [])]) {
        body.addEventListener('pointerdown', () => { selectionOrigin = 'dom'; readerInteracted = true; });
        body.addEventListener('pointerup', capture); body.addEventListener('keyup', capture);
      }
      document.addEventListener('selectionchange', capture);
      global.addEventListener('scroll', savePosition, { passive: true });
      readerCleanup = () => {
        savePosition();
        readerWatch?.close();
        readerWatch = null;
        document.removeEventListener('selectionchange', capture);
        global.removeEventListener('scroll', savePosition);
      };
      quote.disabled = !sourceActive;
      quote.addEventListener('click', () => { if (formattedView) changeReaderMode?.('raw', false); }, { capture: true });
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
      function watchReading() {
        readerWatch = readingPosition?.watchReader({ workspaceId: state.bundle.workspaceId, sourceId: source.id, sourceVersionId: version.id,
          reader, ...(formattedView ? { positionAdapter: markdown.adapter } : {}),
          isReading: () => !disposed && sourceActive && reader.isConnected && state.mode === 'source' && panel.hidden && details.hidden && arrangePanel.hidden,
          onSaved: () => { if (reader.isConnected && !disposed) positionStatus.hidden = true; },
          onError: () => {
            if (!reader.isConnected || disposed) return;
            positionStatus.textContent = '읽기 위치를 보관하지 못했습니다. 원문과 발췌는 그대로 사용할 수 있습니다.';
            positionStatus.hidden = false;
          } });
      }
      function rawVisibleOffset() {
        const box = rawReader.getBoundingClientRect(), target = Math.max(box.top, Math.min(global.innerHeight / 3, box.bottom - 1));
        const range = document.createRange(); let low = 0, high = version.contentText.length;
        while (low < high) {
          const mid = Math.floor((low + high) / 2);
          const point = mid > 0 && /[\uD800-\uDBFF]/.test(version.contentText[mid - 1]) && /[\uDC00-\uDFFF]/.test(version.contentText[mid]) ? mid - 1 : mid;
          range.setStart(originalText, point); range.setEnd(originalText, Math.min(version.contentText.length, point + (version.contentText.codePointAt(point) > 0xFFFF ? 2 : 1)));
          if (range.getBoundingClientRect().bottom < target) low = mid + 1; else high = mid;
        }
        return low;
      }
      currentReaderOffset = () => formattedView ? markdown.adapter.visibleOffset() : state.sourceSelection?.start ?? rawVisibleOffset();
      changeReaderMode = (requested, focus = true) => {
        const next = requested || (formattedView ? 'raw' : 'formatted');
        if ((next === 'formatted') === formattedView || next === 'formatted' && !markdown?.formatted) return;
        const offset = !details.hidden && optionOffset !== null ? optionOffset : currentReaderOffset() ?? 0;
        if (next === 'formatted' && !markdown.blocks.some(block => offset >= block.start && offset < block.end)) { announce('선택한 위치는 원문 텍스트로 표시합니다.'); return; }
        optionOffset = offset;
        readerWatch?.suppress(); readerWatch?.close(); readerWatch = null;
        formattedView = next === 'formatted'; state.readerModes.set(version.id, next);
        reader = formattedView ? markdown.element : rawReader; installReader();
        state.sourceSelection = null; picked.textContent = instruction; saveExcerpt.disabled = useQuote.disabled = useNine.disabled = true;
        quote.dataset.hasSelection = 'false';
        if (formattedView) { global.getSelection()?.removeAllRanges(); markdown.adapter.scrollToOffset(offset); }
        else { const range = restoreSelection({ start: offset, end: offset }); const rect = range.getBoundingClientRect(); global.scrollTo({ top: Math.max(0, global.scrollY + rect.top - global.innerHeight / 3), behavior: 'instant' }); }
        watchReading(); readerWatch?.suppress(); if (focus) reader.focus({ preventScroll: true });
      };
      watchReading();
      const locator = state.locator || (!suppressResume && state.readerPositions.get(version.id));
      if (locator) requestAnimationFrame(() => {
        // A fresh user choice takes priority over a navigation restore queued before it.
        if (!reader.isConnected || readerInteracted) return;
        if (formattedView) {
          readerWatch?.suppress(); markdown.adapter.scrollToOffset(locator.start);
          if (locator.scrollY !== undefined && locator.mode === 'formatted') global.scrollTo({ top: locator.scrollY, behavior: 'instant' });
        } else {
          const range = restoreSelection(locator);
          if (locator.scrollY !== undefined && (!locator.mode || locator.mode === 'raw')) global.scrollTo({ top: locator.scrollY, behavior: 'instant' });
          else { const rect = range.getBoundingClientRect(); global.scrollTo({ top: Math.max(0, global.scrollY + rect.top - global.innerHeight / 3), behavior: 'instant' }); }
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
      if (externalImportContext?.committed && currentExternalImport()) {
        const context = externalImportContext;
        main.append(title('자료를 보관했습니다'),
          node('p', '목록을 다시 불러와 보관한 글을 확인해 주세요. 같은 자료를 다시 보관하지 않습니다.', 'life-help'));
        const retry = button('보관한 글 열기', guarded(async () => {
          await refreshData();
          if (!currentExternalImport(context)) return;
          await openExternalImportResult(context);
        }));
        retry.id = 'lifeDiscoveryStoredRetry';
        main.append(retry);
        return;
      }
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
      if (!state.prepared && state.stages.some(stage => stage.stageId !== state.stage.stageId)) {
        const resume = button('보관한 검토 이어서 열기', guarded(async () => {
          // Use the existing navigation flush before exposing another draft.
          // A failed save keeps this form and its current input in place.
          await navigate('sources');
          const token = navigationGeneration;
          await refreshData();
          if (disposed || state.mode !== 'sources' || token !== navigationGeneration) return;
          render();
          const drafts = main.querySelector('#lifeImportDrafts');
          if (drafts) { drafts.open = true; drafts.querySelector('summary')?.focus(); }
        }));
        resume.id = 'lifeImportResume';
        main.append(resume);
      }
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
        try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await selected.arrayBuffer()); }
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
      main.append(button('네이버 블로그 아이디로 연결', guarded(() => navigate('naver-blog'))));
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
        const fromDiscovery = currentExternalImport() && externalImportContext.stageId === state.stage.stageId;
        await storage.deleteStage(state.stage.stageId);
        state.stage = null;
        state.prepared = null;
        state.editTick = state.savedTick = 0;
        await refreshData();
        if (fromDiscovery) await returnFromSubview();
        else await navigate('sources');
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
        const externalContext = currentExternalImport() && externalImportContext.stageId === snapshot.stageId ? externalImportContext : null;
        let confirmed = false;
        try {
          await commit(changes, snapshot, (validBatchStage(snapshot) || currentChapterImport(chapterContext))
            ? { sourceId: fresh.source.id, sourceVersionId: fresh.version.id } : undefined, () => {
            if (externalContext && currentExternalImport(externalContext)) {
              confirmed = true;
              externalContext.committed = { sourceId: fresh.source.id, sourceVersionId: fresh.version.id };
              state.stage = state.prepared = null;
              state.savedTick = state.editTick = 0;
            }
            if (!currentChapterImport(chapterContext) || snapshot.workspaceId !== chapterContext.workspaceId) return;
            confirmed = true;
            if (!chapterContext.versionIds.includes(fresh.version.id)) chapterContext.versionIds.push(fresh.version.id);
            // The source transaction already committed. A failed subsequent read must not replay it.
            state.stage = state.prepared = null;
            state.savedTick = state.editTick = 0;
          });
        } catch (cause) {
          if (confirmed && currentExternalImport(externalContext) && externalContext.committed) {
            render();
            announce('자료는 보관했습니다. 목록을 다시 불러와 보관한 글을 확인해 주세요.');
            throw new Error('자료는 보관했지만 목록을 읽지 못했습니다. 보관한 글 열기를 눌러 다시 확인해 주세요.');
          }
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
        else if (currentExternalImport(externalContext)) await openExternalImportResult(externalContext);
        else if (excerpts.length) await navigate('sources');
        else await navigate('source', { sourceId: retained, sourceVersionId: fresh.version.id, locator: null });
        announce((excerpts.length ? '모음에 반영됨' : '자료 반영됨') + (managedLibrary ? '' : ' · 이 브라우저에 저장됨'));
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

    function backupContents(bundle, label = '백업에 담긴 원문 확인') {
      const details = node('details', null, 'life-details life-backup-contents');
      details.append(node('summary', label));
      if (!bundle.sources.length) { details.append(empty('보관된 원문이 없는 작업공간입니다.')); return details; }
      const bySource = new Map();
      for (const version of bundle.sourceVersions) {
        const versions = bySource.get(version.sourceId) || []; versions.push(version); bySource.set(version.sourceId, versions);
      }
      const list = node('div'), more = button('백업 원문 더 보기', () => append());
      details.append(list, more);
      let count = 0, loaded = false;
      const append = () => {
        for (const source of bundle.sources.slice(count, count + SEARCH_PAGE_SIZE)) {
          const row = node('div', null, 'life-backup-source'), versions = bySource.get(source.id) || [];
          row.append(node('strong', sourceLabel(source)), node('p', sourceOrigin(source) + ' · 원문 버전 ' + versions.length + '개', 'life-meta'));
          if (source.sourceKey) row.append(node('p', source.sourceKey, 'life-meta life-source-url'));
          const coverage = [...new Set(versions.map(version => COVERAGE[version.coverage.status] || COVERAGE.unknown))];
          row.append(node('p', coverage.join(' · '), 'life-meta')); list.append(row);
        }
        count = Math.min(count + SEARCH_PAGE_SIZE, bundle.sources.length); more.hidden = count >= bundle.sources.length;
      };
      details.addEventListener('toggle', () => { if (details.open && !loaded) { loaded = true; append(); } });
      return details;
    }

    function renderRestoreResult() {
      const receipt = state.restoreReturn;
      if (!receipt || receipt.copyId !== state.bundle.workspaceId) return;
      const books = state.mode === 'books';
      const content = books ? main.querySelector('.life-workbench[data-mode="books"] .wb-content') : main;
      if (!content || books && main.querySelector('#wbBookHeading')) return;
      main.querySelector('#lifeRestoreResult')?.remove();
      const panel = node('section', null, 'life-restore-result');
      if (books) panel.classList.add('life-restore-result-books');
      panel.id = 'lifeRestoreResult';
      panel.setAttribute('aria-label', '복원 결과');
      const heading = node('h3', books ? '새 사본으로 복원했습니다' : '새 사본을 열었습니다.');
      heading.tabIndex = -1;
      const top = node('div', null, 'life-panel-heading');
      top.append(heading, iconButton('복원 안내 닫기', 'close', guarded(() => {
        state.restoreReturn = null;
        panel.remove();
        (books ? main.querySelector('#wbBookList') : toolbar.querySelector('h1'))?.focus({ preventScroll: true });
      })));
      panel.append(top);
      const info = books ? node('details', null, 'life-details') : panel;
      if (books) { info.append(node('summary', '복원 정보')); panel.append(info); }
      info.append(node('p', managedLibrary ? '이전 자료는 그대로 남아 있습니다.' : '이전 작업공간은 그대로 남아 있습니다. 이 사본의 자동 동기화는 연결하지 않았습니다.', 'life-help'));
      for (const copy of receipt.copies || []) {
        if (copy.workspaceId === state.bundle.workspaceId) continue;
        info.append(button('함께 복원한 공간 열기: ' + copy.title, guarded(async () => {
          await persistDrafts();
          const target = await storage.read(copy.workspaceId);
          if (disposed) return;
          await storage.setActive(target.workspaceId);
          await openRestoredWorkspaces([target, ...(receipt.copies || []).filter(row => row.workspaceId !== target.workspaceId)], receipt.previousId);
        })));
      }
      info.append(button('이전 작업공간으로 돌아가기', guarded(async () => {
        await persistDrafts();
        const previous = await storage.read(receipt.previousId);
        if (disposed) return;
        await storage.setActive(previous.workspaceId);
        if (disposed) return;
        invalidateBatchContext();
        state.bundle = previous;
        state.stage = state.prepared = null;
        state.sourceDrafts.clear();
        state.stages = []; state.sourceEditStages = [];
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
      content.prepend(panel);
    }

    async function openRestoredWorkspaces(installed, previousId) {
      if (disposed) return;
      const active = installed[0];
      invalidateBatchContext();
      state.bundle = active;
      state.restoreReturn = { previousId, copyId: active.workspaceId, copies: installed.map(copy => ({ workspaceId: copy.workspaceId, title: copy.title })) };
      state.stage = state.prepared = state.sourceId = state.sourceVersionId = null;
      state.sourceDrafts.clear(); state.readerPositions.clear(); state.readerModes.clear(); state.stages = []; state.sourceEditStages = []; state.allStages = [];
      for (const copy of installed) if (!state.workspaces.some(row => row.workspaceId === copy.workspaceId)) state.workspaces.push({ workspaceId: copy.workspaceId, title: copy.title });
      resetSearchContext(); state.mode = 'sources'; connectSubscription(); render();
      global.scrollTo({ top: 0, behavior: 'instant' });
      announce(managedLibrary ? '새 사본을 열었습니다. 이전 자료는 그대로 유지됩니다.' : '새 작업공간 사본을 열었습니다. 이전 작업공간은 그대로 유지됩니다. 자동 동기화는 연결하지 않았습니다.', { quiet: true });
      main.querySelector('#lifeRestoreResult h3')?.focus({ preventScroll: true });
      // Already committed: a later refresh error must never offer another installation.
      try { await refreshData(); render(); }
      catch (_) { throw new Error('사본은 이 브라우저에 보관됐습니다. 작업공간 목록을 갱신하지 못했으니 관리에서 다시 확인해 주세요.'); }
      finally { main.querySelector('#lifeRestoreResult h3')?.focus({ preventScroll: true }); }
    }

    function renderObsidianRestore() {
      const section = node('section', null, 'life-settings-section'); section.id = 'lifeObsidianRestore';
      const picker = field('Obsidian 변환 ZIP 선택', 'file', 'lifeObsidianFile', '');
      picker.input.accept = '.zip,application/zip';
      const preview = node('div', null, 'life-restore-preview'); preview.id = 'lifeObsidianPreview'; preview.setAttribute('aria-live', 'polite');
      let candidate = null;
      picker.input.addEventListener('change', guarded(async () => {
        candidate = null; preview.replaceChildren();
        const file = picker.input.files[0]; if (!file) return;
        preview.append(node('p', 'ZIP의 원문·출처·해시를 확인하고 있습니다. 아직 복원하지 않았습니다.', 'life-help'));
        try { candidate = await global.HaedoLife.ObsidianPackage.read(file); }
        catch (cause) { preview.replaceChildren(); throw cause; }
        if (disposed) return;
        preview.replaceChildren(); const data = candidate, s = data.summary;
        preview.append(node('h4', data.notes.title || 'Obsidian 노트'), node('p', file.name, 'life-meta'),
          node('p', '노트 ' + s.notes + '개 · 보조 파일 ' + s.files + '개 · 노트 연결 ' + s.links + '개'),
          node('p', '최초 감사 기준: 검토 ' + s.reviewGroups + '묶음 / ' + s.reviewOccurrences + '회 · 보관 정보 ' + s.informationalOccurrences + '회. 선택 반영 뒤에도 원래 감사는 유지됩니다.', 'life-help'),
          backupContents(data.notes, '노트 원문 확인'));
        const source = node('details', null, 'life-details');
        source.append(node('summary', 'Git 출처 확인'), node('p', data.repositoryUrl, 'life-meta life-source-url'), node('p', data.ref, 'life-meta life-source-url'));
        preview.append(source);
        const support = field('보조 파일도 별도 작업공간으로 함께 복원', 'checkbox', 'lifeObsidianIncludeFiles', '');
        support.input.checked = s.files > 0; support.input.disabled = !s.files;
        if (s.files) preview.append(support.label, backupContents(data.files, '보조 파일 원문 확인'));
        preview.append(node('p', '선택한 공간을 한 번에 새 사본으로 저장합니다. 원본 ZIP과 기존 작업공간은 유지합니다. 감사·검토 HTML·Git 이력·선택 이력은 원본 ZIP에 남으며 앱에 설치하거나 실행하지 않습니다.', 'life-help'));
        const actions = node('div', null, 'life-actions');
        actions.append(button('Obsidian 새 사본으로 복원', guarded(async () => {
          const selected = candidate; if (!selected) return;
          await persistDrafts();
          const previousId = state.bundle.workspaceId;
          const copies = [selected.notes]; if (support.input.checked && s.files) copies.push(selected.files);
          const installed = await storage.installWorkspaces(copies);
          candidate = null; preview.replaceChildren(); picker.input.value = '';
          await openRestoredWorkspaces(installed, previousId);
        }), 'life-primary'), button('Obsidian 복원 취소', guarded(() => {
          candidate = null; preview.replaceChildren(); picker.input.value = '';
          global.requestAnimationFrame(() => { if (!disposed && picker.input.isConnected) picker.input.focus({ preventScroll: true }); });
          announce('복원을 취소했습니다. ZIP과 현재 작업공간은 그대로 유지됩니다.');
        })));
        preview.append(actions);
      }));
      section.append(node('h3', 'Obsidian 패키지에서 복원'), node('p', '변환기 또는 연결 검토 도구에서 만든 ZIP을 해제하지 않고 엽니다. 일반 보관함 ZIP과 사진 글 ZIP은 각 가져오기 경로를 사용하세요.', 'life-help'), picker.label, preview);
      return section;
    }

    function renderTransfer() {
      main.append(title('내보내기·사본 복원'), node('p', '현재 작업공간의 원문·발췌·메모·출처만 담습니다.', 'life-help'));
      const scope = node('details', null, 'life-details'); scope.id = 'lifeTransferScope';
      scope.append(node('summary', '포함하지 않는 자료'), node('p', '자료 폴더·묶음·내 페이지·회고·책, 글쓰기·가져오기 초안, 읽기 위치, 사진과 미확보 본문, 연표·목표·습관, 이미 게시한 사본은 포함하지 않습니다. 파일에는 개인 자료가 포함되니 보관 위치를 확인하세요.', 'life-help'),
        node('p', '네이버 원문 사진 사본도 이 JSON에는 들어가지 않습니다. 사진 사본이 있는 원문에서는 글·사진 ZIP을 따로 보관할 수 있습니다.', 'life-help'));
      main.append(scope, actionRow('폴더·묶음·내 페이지도 함께 백업', '분류와 구성까지 복원하려면 자료·구성 JSON을 받으세요.', 'download', () => navigate('workbench-backup')));
      const actions = node('section', null, 'life-destinations life-settings-section');
      const stamp = new Date().toISOString().slice(0, 10);
      const includeTrash = field('Markdown에 휴지통 자료 포함', 'checkbox', 'lifeMarkdownIncludeTrash', '');
      includeTrash.input.checked = false;
      actions.append(includeTrash.label);
      actions.append(actionRow('JSON 백업', '새 작업공간 사본으로 복원할 수 있는 파일', 'download', async () => {
        const backup = await core.makeBackup(state.bundle);
        download(JSON.stringify(backup, null, 2), 'life-tools-' + stamp + '.json', 'application/json');
      }), actionRow('Markdown 내보내기', '다른 앱에서 읽고 활용할 문서', 'book', async () => {
        download(await core.toMarkdown(state.bundle, { includeTrash: includeTrash.input.checked }), 'life-tools-' + stamp + '.md', 'text/markdown;charset=utf-8');
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
        preview.append(backupContents(candidate), node('p', managedLibrary ? '현재 자료를 유지하고 새 사본을 만듭니다.' : '현재 작업공간을 덮어쓰지 않습니다. 새 사본을 만들고 자동 동기화는 연결하지 않습니다.', 'life-help'));
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
          await openRestoredWorkspaces([installed], previousId);
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
      main.append(restoreSection, renderObsidianRestore());
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
        state.readerPositions.clear(); state.readerModes.clear();
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
        old.append(node('p', 'Google 계정에 연결하지 않고 이 브라우저에 보관했던 자료만 확인합니다. 원문·발췌·보관된 검토초안을 현재 계정의 새 사본으로 가져오며, 원본을 그대로 남깁니다.' + (managedLibrary ? '' : ' 자동 동기화는 연결하지 않습니다.'), 'life-help'));
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
            announce(managedLibrary ? '현재 계정의 새 사본을 열었습니다. 원본과 검토초안은 보존했습니다.' : '현재 계정의 새 사본을 열었습니다. 원본과 검토초안은 보존했으며 자동 동기화는 연결하지 않았습니다.');
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
      if (managedLibrary) {
        panel.hidden = false;
        panel.replaceChildren(node('h3', '자료'));
        if (state.syncReadError) panel.append(node('p', '자료의 보관 상태를 확인하지 못했습니다.', 'life-error'));
        else if (state.syncState?.conflict) panel.append(button('양쪽 자료 비교', guarded(async () => {
          await persistDrafts(); await refreshData(); await refreshSync();
          if (disposed || state.mode !== 'sync' || !state.syncState?.conflict) return;
          state.conflictView = { workspaceId: state.bundle.workspaceId, local: structuredClone(state.bundle),
            remote: structuredClone(state.syncState.conflict), accountKey: state.syncAccountKey };
          renderConflict();
        }), 'life-primary'));
        else panel.hidden = true;
        return;
      }
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
      if (state.syncLoading || presentation.key === 'loading') { restoreFocus(); return; }
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
          await persistDrafts();
          const before = state.syncAccountKey;
          invalidateBatchContext();
          const received = await sync.download(row.id);
          await refreshSync();
          if (before !== state.syncAccountKey) throw new Error('계정이 바뀌어 이전 화면으로 전환하지 않았습니다. 로컬 자료는 유지됩니다.');
          if (!received || !received.workspaceId) throw new Error('받은 작업공간을 확인하지 못했습니다. 기존 자료를 유지합니다.');
          const downloaded = await storage.read(received.workspaceId);
          if (disposed) return;
          invalidateBatchContext();
          await storage.setActive(received.workspaceId);
          if (disposed) return;
          state.bundle = downloaded;
          state.stage = state.prepared = state.sourceId = state.sourceVersionId = null;
          state.sourceDrafts.clear(); state.readerPositions.clear(); state.readerModes.clear(); state.stages = []; state.sourceEditStages = []; state.allStages = [];
          state.remoteChanged = false; state.restoreReturn = null;
          if (!state.workspaces.some(item => item.workspaceId === downloaded.workspaceId)) state.workspaces.push({ workspaceId: downloaded.workspaceId, title: downloaded.title });
          resetSearchContext();
          state.mode = 'sources';
          writeRoute('sources', false);
          connectSubscription();
          render();
          announce('선택한 서버 작업공간을 받았습니다. 기존 로컬 작업공간은 그대로 유지됩니다.');
          // Receipt is already durable; a later list failure must leave its reading view open.
          try { await refreshData(); render(); }
          catch (_) { throw new Error('받은 자료는 이 브라우저에 보관됐습니다. 작업공간 목록 갱신에 실패했으니 관리에서 다시 확인해 주세요.'); }
        })));
        parent.append(card);
      });
      restoreFocus();
    }

    function renderLibraryMetadata() {
      if (!libraryMetaSync) return;
      const workspaceId = state.bundle.workspaceId, workspace = workspaceGeneration;
      const host = node('section', null, 'life-library-metadata'); host.id = 'lifeLibraryMetadata'; main.append(host);
      let active = true, sequence = 0, working = false, view = null, current = null, copies = [], message = '';
      const live = () => active && !disposed && state.mode === 'sync' && workspace === workspaceGeneration && state.bundle?.workspaceId === workspaceId && host.isConnected;
      const control = (label, id, action) => {
        const result = button(label, async () => {
          if (!live() || working) return;
          working = true; host.setAttribute('aria-busy', 'true'); host.querySelectorAll('button').forEach(value => { value.disabled = true; });
          try { await persistDrafts(); if (!live()) return; await action(); }
          catch (cause) { if (live()) { message = cause.message || '분류 변경을 처리하지 못했습니다. 기존 내용은 유지했습니다.'; view = null; } }
          finally { working = false; if (live()) { await refresh(); host.querySelector('#' + id)?.focus({ preventScroll: true }); } }
        }); result.id = id; return result;
      };
      function side(label, metadata, bundle) {
        const section = node('section', null, 'composition-side'); section.append(node('h4', label));
        const detail = node('details', null, 'life-details'); detail.open = true;
        detail.append(node('summary', '폴더·컬렉션·9칸 내용'));
        const folders = global.HaedoLife.SourceFolders.list(metadata.sourceFolders);
        const sourceNames = new Map(bundle.sources.map(source => [source.id, source.title]));
        const folderNames = new Map(folders.map(value => [value.id, value.label]));
        detail.append(node('h5', '폴더'));
        folders.forEach(value => detail.append(node('p', value.label, 'life-note')));
        metadata.sourceFolders.assignments.forEach(value => {
          detail.append(node('p', (sourceNames.get(value.sourceId) || '확인되지 않은 자료') + ' → ' + folderNames.get(value.folderId), 'life-meta'));
        });
        detail.append(node('h5', '컬렉션'));
        metadata.collection.items.forEach(value => {
          detail.append(node('h6', value.title), node('p', [value.creator, value.url, ...(value.tags || [])].filter(Boolean).join(' · '), 'life-meta'));
          if (value.archived) detail.append(node('p', '보관함', 'life-meta'));
          if (value.note) detail.append(node('p', value.note, 'life-note'));
          Object.values(value.details || {}).filter(Boolean).forEach(text => detail.append(node('p', text, 'life-note')));
        });
        detail.append(node('h5', '9칸'));
        metadata.nineBoard.boards.forEach(board => {
          detail.append(node('h6', board.title), node('p', board.intro, 'life-note'));
          board.areas.forEach(area => {
            detail.append(node('h6', area.title), node('p', area.note, 'life-note'));
            area.items.forEach(item => {
              detail.append(node('p', [item.attachment.title, item.attachment.creator, item.attachment.url].filter(Boolean).join(' · '), 'life-note'), node('p', item.reason, 'life-note'));
              if (item.reference) {
                const reference = node('details', null, 'life-details');
                reference.append(node('summary', '연결한 정확한 근거'), node('pre', JSON.stringify(item.reference.value, null, 2), 'life-conflict-content'));
                detail.append(reference);
              }
            });
          });
        });
        section.append(detail); return section;
      }
      function draw() {
        if (!live()) return;
        const focusId = host.contains(document.activeElement) ? document.activeElement.id : '';
        host.replaceChildren(); host.setAttribute('aria-busy', 'false');
        host.hidden = !current?.conflict && !current?.error && !copies.length && !message;
        if (host.hidden) return;
        host.append(node('h3', '폴더·컬렉션·9칸'));
        if (message || current?.error) host.append(node('p', message || current.error.message, 'life-error'));
        if (current?.conflict?.missing) host.append(node('p', '서버의 분류를 찾을 수 없습니다. 기존 내용과 복구 사본은 유지했습니다.', 'life-help'));
        else if (current?.conflict) host.append(control('양쪽 분류 비교', 'lifeLibraryMetaCompare', async () => { view = await libraryMetaSync.compare(workspaceId); }));
        else if (current?.error) host.append(control('다시 시도', 'lifeLibraryMetaRetry', async () => { await accountLibrary.retry(workspaceId); message = ''; }));
        if (view?.remote && current?.conflict) {
          const comparison = node('section', null, 'composition-comparison'); comparison.id = 'lifeLibraryMetaComparison';
          comparison.append(side('이 기기', view.local, view.bundle), side('계정 보관본', view.remote.data, view.bundle));
          comparison.append(node('p', '선택하지 않은 분류도 정확한 원문과 함께 복구 사본으로 남깁니다.', 'life-help'));
          for (const [choice, label, id] of [['local', '이 기기 분류 유지', 'lifeLibraryMetaUseLocal'], ['remote', '계정 보관본 사용', 'lifeLibraryMetaUseRemote']]) {
            comparison.append(control(label, id, async () => {
              const reviewed = view;
              const result = await libraryMetaSync.resolve(workspaceId, choice, reviewed);
              if (!live()) return;
              view = null; message = result.syncError?.message || '선택하지 않은 분류를 복구 사본으로 보관했습니다.';
              await refreshLibrary();
            }));
          }
          host.append(comparison);
        }
        if (copies.length) {
          const recovery = node('details', null, 'life-details'); recovery.id = 'lifeLibraryMetaRecoveries';
          recovery.append(node('summary', '분류 복구 사본 ' + copies.length + '개'));
          copies.forEach(copy => {
            recovery.append(node('p', copy.title || dateLabel(copy.createdAt), 'life-note'), control('복구 자료 내려받기', 'lifeLibraryMetaRecovery-' + copy.id, async () => {
              const saved = await storage.readLibraryMetaRecovery(workspaceId, copy.id);
              if (!live()) return;
              const payload = { format: 'life-library-meta-recovery-v1', exportedAt: new Date().toISOString(), bundle: saved.bundle, metadata: saved.metadata };
              const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json;charset=utf-8' })); downloadUrls.add(url);
              const link = node('a'); link.href = url; link.download = 'haedo-library-recovery-' + copy.id + '.json'; host.append(link); link.click(); link.remove();
            }));
          }); host.append(recovery);
        }
        if (focusId) host.querySelector('#' + focusId)?.focus({ preventScroll: true });
      }
      async function refresh() {
        if (!live() || working) return;
        const token = ++sequence;
        try {
          const [next, recoveries] = await Promise.all([libraryMetaSync.getState(workspaceId), storage.listLibraryMetaRecoveries(workspaceId)]);
          if (!live() || working || token !== sequence) return;
          current = next; copies = recoveries; draw();
        } catch (cause) { if (live() && token === sequence) { message = cause.message; draw(); } }
      }
      const stop = libraryMetaSync.subscribe(event => { if (!event.workspaceId || event.workspaceId === workspaceId) refresh(); });
      metadataCleanup = () => { active = false; sequence++; stop(); };
      refresh();
    }

    function renderSync() {
      if (!managedLibrary) main.append(title('기기 간 동기화'), node('p', 'Mac·iPad·iPhone에서 같은 계정의 자료를 이어 봅니다. 로그인만으로 로컬 자료를 올리지 않습니다.', 'life-help'));
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
          storage, workspaceId, beforeAction: persistDrafts, managed: managedLibrary,
          onRetry: managedLibrary ? () => accountLibrary.retry(workspaceId) : null,
          isCurrent: () => !disposed && state.mode === 'sync' && state.bundle?.workspaceId === workspaceId });
      }
      if (managedLibrary) {
        renderLibraryMetadata();
        const problem = libraryPresentation();
        if (problem.hint) main.append(node('p', problem.hint, 'life-help'));
        return;
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
      if (view.remote.missing || !view.remote.row) { parent.append(empty(managedLibrary ? '계정의 자료실을 찾을 수 없습니다. 보관한 자료는 유지됩니다. 백업을 내려받아 복구해 주세요.' : '서버의 작업공간을 찾을 수 없습니다. 자동으로 다시 생성하지 않습니다. 로컬 백업 또는 연결 중지를 선택해 주세요.')); return; }
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
      naverMediaReturn = null;
      metadataCleanup?.(); metadataCleanup = null;
      sourceFoldersMount?.dispose(); sourceFoldersMount = null; sourceFoldersUpdate = null;
      if (disposed) return;
      const generation = ++renderGeneration, navigation = navigationGeneration;
      global.HaedoMotion?.cancel(main);
      mainRenderPromise = Promise.resolve();
      compositionPanel?.dispose(); compositionPanel = null;
      if (accountBlogUI && accountBlogWorkspace) accountBlogViews.set(accountBlogWorkspace, accountBlogUI.getView?.());
      accountBlogUI?.dispose(); accountBlogUI = null; accountBlogWorkspace = null;
      if (naverBlogUI && naverBlogWorkspace) naverBlogViews.set(naverBlogWorkspace, naverBlogUI.getView?.());
      naverBlogUI?.destroy(); naverBlogUI = null; naverBlogWorkspace = null;
      naverBlogService?.dispose(); naverBlogService = null;
      naverCaptureUI?.destroy(); naverCaptureUI = null;
      naverCaptureService?.dispose(); naverCaptureService = null;
      naverReaderService?.dispose(); naverReaderService = null;
      naverPhotoView?.dispose(); naverPhotoView = null;
      if (blogManager && blogManagerWorkspace && !blogManagerPostId) blogViews.set(blogManagerWorkspace, blogManager.getView?.());
      blogManager?.dispose(); blogManager = null; blogManagerWorkspace = null; blogManagerPostId = null;
      preservationUI?.dispose(); preservationUI = null;
      publicCoverUI?.dispose(); publicCoverUI = null;
      obsidianUpdateUI?.dispose(); obsidianUpdateUI = null;
      homeRenderPromise = Promise.resolve();
      interestUI?.leave();
      annualPlanUI?.leave();
      externalDiscoveryUI?.leave();
      home?.leave();
      workbench?.leave();
      writer?.close();
      sourceEditor?.close();
      collection?.leave();
      unifiedSearch?.leave();
      if (readerCleanup) { readerCleanup(); readerCleanup = null; }
      readingResumeCleanup?.(); readingResumeCleanup = null;
      if (sectionFor(state.mode) === 'records') lastRecordMode = state.mode;
      writeRoute(state.mode, false);
      renderHeader();
      main.dataset.mode = state.mode;
      main.replaceChildren();
      if (state.mode === 'home' && home) {
        // Home's configuration read must not lock independent navigation.
        const options = homeRenderOptions || {}; homeRenderOptions = null;
        homeRenderPromise = home.render(options).catch(failure);
        mainRenderPromise = homeRenderPromise;
        return;
      }
      if (state.mode === 'naver-capture') { mainRenderPromise = renderNaverCapture().catch(failure); return; }
      if (state.mode === 'naver-blog') { mainRenderPromise = renderNaverBlog().catch(failure); return; }
      if (state.mode === 'interests' && interestUI) return mainRenderPromise = interestUI.render().catch(failure);
      if (state.mode === 'annual-plan' && annualPlanUI) return mainRenderPromise = annualPlanUI.render().catch(failure);
      if (state.mode === 'external-discovery' && externalDiscoveryUI) return mainRenderPromise = externalDiscoveryUI.render().catch(failure);
      if (state.mode === 'public-cover') return mainRenderPromise = renderPublicCover().catch(failure);
      if (state.mode === 'obsidian-update') return mainRenderPromise = renderObsidianUpdate().catch(failure);
      if (state.mode === 'preservation') return mainRenderPromise = renderPreservation().catch(failure);
      if (state.mode === 'account-blog') {
        // Reading a remote list must leave the global navigation available.
        mainRenderPromise = renderAccountBlog().catch(failure);
        return;
      }
      if (state.mode === 'blog') {
        mainRenderPromise = renderBlogManager().catch(failure);
        return;
      }
      if (state.mode === 'find') { findRenderPromise = unifiedSearch.open().catch(failure); mainRenderPromise = findRenderPromise; return; }
      if (state.mode === 'collection' && collection) { const options = collectionOpenOptions || {}; collectionOpenOptions = null; mainRenderPromise = collection.open(options).catch(failure); return; }
      if (state.mode === 'source-edit' && sourceEditor) return mainRenderPromise = sourceEditor.open(sourceEditOpenOptions || {}).catch(failure);
      if (state.mode === 'write' && writer) {
        const options = writingOpenOptions || {};
        writingOpenOptions = null;
        return mainRenderPromise = writer.open(options).catch(failure);
      }
      if (workbenchModes.includes(state.mode) && workbench) {
        const options = workbenchOpenOptions || {};
        workbenchOpenOptions = null;
        return mainRenderPromise = Promise.resolve(workbench.render(state.mode, options)).then(() => {
          if (!disposed && generation === renderGeneration && navigation === navigationGeneration &&
              ['page', 'books'].includes(state.mode)) { syncWritingFocus(); renderRestoreResult(); }
        }).catch(failure);
      }
      renderChapterImportReturn();
      if (state.mode === 'tools') renderTools();
      else if (state.mode === 'manage') renderManagement();
      else if (state.mode === 'batch') renderBatch();
      else if (state.mode === 'import') renderImport();
      else if (state.mode === 'source') renderSource();
      else if (state.mode === 'source-trash') renderSourceTrash();
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
      if (dirty() || state.sourceDrafts.size || workbench?.dirty() || writer?.isDirty() || sourceEditor?.isDirty() || collection?.dirty() || accountBlogUI?.dirty() || blogManager?.dirty() || preservationUI?.dirty() || obsidianUpdateUI?.dirty() || originalAttachmentsUI?.dirty() || publicCoverUI?.dirty() || interestUI?.dirty() || externalDiscoveryUI?.dirty() || annualPlanUI?.dirty()) { event.preventDefault(); event.returnValue = ''; }
    };
    const visibility = () => {
      if (!document.hidden) return;
      if (dirty()) persistStage().catch(failure);
      if (workbench?.dirty()) workbench.checkpoint().catch(failure);
      if (publicCoverUI?.dirty()) publicCoverUI.flush().catch(failure);
      if (writer?.isDirty()) writer.flush().catch(failure);
      if (sourceEditor?.isDirty()) sourceEditor.flush().catch(failure);
      flushReadingPosition();
    };
    const pagehideReading = () => { flushReadingPosition(); if (sourceEditor?.isDirty()) sourceEditor.flush().catch(failure); };
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
    let active = bootstrap?.workspaceId || await storage.getActive();
    if (managedLibrary && !active && state.workspaces.length) active = state.workspaces[0].workspaceId;
    if (managedLibrary && active && await storage.getActive() !== active) await storage.setActive(active);
    if (!active && !state.workspaces.length) {
      if (managedLibrary) throw new Error('계정 자료를 확인하지 못했습니다. 연결 후 다시 시도해 주세요.');
      invalidateBatchContext();
      const first = await storage.createWorkspace('내 자료');
      active = first.workspaceId;
      await storage.setActive(active);
    }
    if (disposed) return { dispose };
    state.mode = routeMode();
    if (new URLSearchParams(global.location.search).get('compose') === '1') {
      blogPageTask = true; blogMode = 'edit';
      workbenchOpenOptions = { pageCompose: true, blogContext: true, homeTab: 'posts' };
      viewOrigins.set('page', { mode: 'home', workspaceId: active, scrollY: 0, homeState: { workspaceId: active, tab: 'posts', query: '', limit: 20 } });
      const url = new URL(global.location.href); url.searchParams.delete('compose');
      global.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    if (active) {
      state.bundle = await storage.read(active);
      if (!managedLibrary) await registerAccountMaterials(active);
      if (disposed || signal?.aborted) return { dispose };
      if (sectionFor(state.mode) === 'records') lastRecordMode = state.mode;
      await refreshData();
      connectSubscription();
      render();
      announce(managedLibrary ? '자료를 열었습니다.' : '이 브라우저에 보관한 자료를 열었습니다.', { quiet: true });
      if (accountMaterialsFailure?.workspaceId === active) announce(accountMaterialsFailure.partial ? accountMaterialsPartialNotice : accountMaterialsNotice);
      if (sync) await refreshSync();
      if (managedLibrary) {
        unsubscribeLibrary = accountLibrary.subscribe(event => {
          if (!disposed && event.type === 'catalog' && !event.workspaceId) refreshWorkspaceList().catch(failure);
          if (disposed || event.workspaceId && event.workspaceId !== state.bundle?.workspaceId) return;
          refreshLibrary().catch(failure);
        });
        await refreshLibrary();
      }
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
    return { dispose, flushDraft, checkpoint };

    async function checkpoint() {
      if (disposed) return;
      await annualPlanUI?.flush();
      await workbench?.checkpoint();
    }

    async function flushDraft() {
      if (disposed) throw new Error('계정이 바뀌어 이전 초안을 보관할 수 없습니다.');
      if (state.busy) throw new Error('자료를 처리 중입니다. 작업이 끝난 뒤 로그아웃을 다시 선택해 주세요.');
      await persistDrafts();
    }

    // Call inside guarded actions; the public logout hook checks its own boundary.
    async function persistDrafts() {
      if (disposed) throw new Error('계정이 바뀌어 이전 초안을 보관할 수 없습니다.');
      await interestUI?.flush();
      await annualPlanUI?.flush();
      await externalDiscoveryUI?.flush();
      await preservationUI?.flush();
      await obsidianUpdateUI?.flush();
      await originalAttachmentsUI?.flush();
      await publicCoverUI?.flush();
      await accountBlogUI?.flush();
      await naverBlogUI?.flush();
      await naverCaptureUI?.flush();
      await blogManager?.flush();
      await workbench?.flush();
      await writer?.flush();
      await sourceEditor?.flush();
      collection?.flush();
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
      delete document.body.dataset.writingFocus;
      disposed = true; naverMediaReturn = null;
      pendingPostReturn = preservationOpenOptions = null;
      libraryRefresh++; unsubscribeLibrary?.(); metadataCleanup?.(); metadataCleanup = null;
      sourceFoldersMount?.dispose(); sourceFoldersMount = null; sourceFoldersUpdate = null;
      sourceFoldersUI?.dispose(); sourceFoldersUI = null; sourceFoldersWorkspace = null;
      accountMaterialsSequence += 1;
      accountMaterials?.dispose(); accountMaterials = null;
      interestUI?.dispose();
      annualPlanUI?.dispose();
      externalDiscoveryUI?.dispose();
      privateDiscovery?.dispose();
      originalAttachmentsUI?.dispose(); originalAttachmentsUI = null;
      compositionPanel?.dispose(); compositionPanel = null;
      if (accountBlogUI && accountBlogWorkspace) accountBlogViews.set(accountBlogWorkspace, accountBlogUI.getView?.());
      accountBlogUI?.dispose(); accountBlogUI = null; accountBlogWorkspace = null;
      if (naverBlogUI && naverBlogWorkspace) naverBlogViews.set(naverBlogWorkspace, naverBlogUI.getView?.());
      naverBlogUI?.destroy(); naverBlogUI = null; naverBlogWorkspace = null;
      naverBlogService?.dispose(); naverBlogService = null;
      naverCaptureUI?.destroy(); naverCaptureUI = null;
      naverCaptureService?.dispose(); naverCaptureService = null;
      naverReaderService?.dispose(); naverReaderService = null;
      naverPhotoView?.dispose(); naverPhotoView = null;
      if (blogManager && blogManagerWorkspace && !blogManagerPostId) blogViews.set(blogManagerWorkspace, blogManager.getView?.());
      blogManager?.dispose(); blogManager = null; blogManagerWorkspace = null; blogManagerPostId = null;
      preservationUI?.dispose(); preservationUI = null;
      publicCoverUI?.dispose(); publicCoverUI = null;
      obsidianUpdateUI?.dispose(); obsidianUpdateUI = null;
      compositionSync?.dispose();
      writingSync?.dispose();
      blogSync?.dispose();
      naverBlogService?.dispose(); naverBlogService = null;
      naverCaptureUI?.destroy(); naverCaptureUI = null;
      naverCaptureService?.dispose(); naverCaptureService = null;
      naverReaderService?.dispose(); naverReaderService = null;
      naverPhotoView?.dispose(); naverPhotoView = null; naverBlogViews.clear(); naverCaptureTarget = null;
      home?.dispose();
      workbench?.dispose();
      writer?.dispose();
      sourceEditor?.dispose();
      collection?.dispose();
      unifiedSearch?.dispose();
      unbindNavigation?.();
      global.removeEventListener('popstate', popstate);
      document.removeEventListener('pointerdown', closeFeatureMenusOutside);
      root.removeEventListener('focusin', keepFocusVisible);
      main.removeEventListener('input', editingInput);
      main.removeEventListener('compositionstart', editingInput);
      main.removeEventListener('pointerdown', editingInput);
      main.removeEventListener('keydown', editingInput);
      main.removeEventListener('wheel', editingInput);
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
      state.readerPositions.clear(); state.readerModes.clear();
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

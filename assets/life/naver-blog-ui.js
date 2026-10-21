/* Naver subscriptions are read-only at the source. No credentials or remote HTML enter this view. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.HaedoLife ||= {}).NaverBlogUI = api;
})(globalThis, function (root) {
  'use strict';
  const labels = { imported: '이미 보관한 글', needs_content: '본문 보완 필요', new: '아직 보관하지 않은 글', ambiguous: '기존 자료 확인 필요' };
  function create({ container, service, workspaceId, onReview, onOpenSource, onWritePhotos, onDownload, onImportFile, onImport, onReturn, isCurrent = () => true, viewState = {} }) {
    viewState ||= {};
    const doc = container.ownerDocument;
    const el = (tag, text, cls) => { const n = doc.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
    let disposed = false, epoch = 0, request = 0, busy = false, composing = false, navigating = false;
    let surface, input, preview, auto, save, status, error, subscriptions, items, more, filter;
    let ready = false, loaded = false, data = { subscriptions: [], items: [] };
    let shown = Number.isSafeInteger(viewState.shown) ? Math.max(20, Math.min(10000, viewState.shown)) : 20;
    let pagesLoaded = Number.isSafeInteger(viewState.pagesLoaded) ? Math.max(1, Math.min(100, viewState.pagesLoaded)) : 1;
    let autoDraft = viewState.autoCollect === true;
    const captureEnabled = typeof service.connections === 'function' && typeof service.publicList === 'function';
    let capturePanel, connectionsList, publicList, publicFilter, publicMore, captureList, captureStatus, captureError, queueButton;
    let connections = [], publicRows = [], jobs = [], captures = [], publicPage = null, capturePage = null, connectionsLoaded = false;
    let selectedSubscription = typeof viewState.subscriptionId === 'string' ? viewState.subscriptionId : '';
    let publicShown = Number.isSafeInteger(viewState.publicShown) ? Math.max(20, Math.min(10000, viewState.publicShown)) : 20;
    let publicPages = Number.isSafeInteger(viewState.publicPages) ? Math.max(1, Math.min(100, viewState.publicPages)) : 1;
    const selectedPosts = new Set(Array.isArray(viewState.selectedLogNos) ? viewState.selectedLogNos.filter(value => /^\d+$/.test(value)).slice(0, 100) : []);
    const current = token => !disposed && isCurrent() && container.isConnected && (token == null || token === epoch);
    const model = () => root.HaedoLife?.NaverBlog;
    function parsed() { try { return model().parseBlog(input.value); } catch (_) { return null; } }
    function message(text, state) { if (!current()) return; status.textContent = text; status.dataset.state = state; }
    function clearError() { error.hidden = true; error.textContent = ''; }
    function fail(cause) {
      if (!current()) return;
      const code = cause?.code;
      const setup = ['naver_setup_required', 'naver_blog_setup_required', 'setup_required'].includes(code);
      error.textContent = code === 'naver_blog_invalid' ? '네이버 블로그 아이디나 블로그 주소를 확인해 주세요. 입력은 그대로 남아 있습니다.' :
        code === 'naver_conflict' || code === 'naver_blog_conflict' || code === 'revision_conflict' ? '다른 화면에서 연결이 바뀌었습니다. 연결 목록을 다시 확인한 뒤 선택해 주세요.' :
        setup ? '서버 수집 기능은 준비 중입니다. 연결 주소는 보관할 수 있으며 실제 수집 범위는 아직 확인하지 않았습니다.' :
        code === 'naver_schema_missing' ? '블로그 연결 저장소가 아직 준비되지 않았습니다. 입력한 아이디는 그대로 있습니다. 준비 후 다시 시도해 주세요.' :
        code === 'naver_ambiguous' || code === 'naver_blog_ambiguous' ? '같은 글일 수 있는 자료가 여러 개입니다. 기존 자료를 먼저 확인해 주세요.' :
        '처리하지 못했습니다. 입력과 기존 자료는 그대로 있습니다. 목록을 다시 확인한 뒤 다시 시도해 주세요.';
      error.hidden = false; message(setup ? '서버 수집 기능 준비 중 · 연결 주소 유지' : '확인하지 못함 · 기존 자료 유지', setup ? 'setup-required' : 'error');
    }
    function controls() {
      if (!surface) return;
      surface.setAttribute('aria-busy', String(busy || navigating));
      surface.querySelectorAll('button').forEach(b => { b.disabled = busy || navigating || b.dataset.unavailable === 'true'; });
      save.disabled = busy || navigating || composing || !parsed() || captureEnabled && !connectionsLoaded;
      const identity = parsed(), existing = captureEnabled && connections.find(row => row.blogId === identity?.blogId && row.workspaceId === workspaceId);
      const canAuto = ready && (!captureEnabled || existing?.baselineComplete === true);
      auto.disabled = busy || navigating || !canAuto;
      auto.checked = canAuto && autoDraft;
      input.disabled = busy || navigating;
      filter.disabled = busy || navigating;
      surface.querySelectorAll('.nv-capture-intake input,.nv-capture-intake select').forEach(node => { node.disabled = busy || navigating; });
      if (queueButton) { queueButton.disabled = busy || navigating || !selectedPosts.size; queueButton.textContent = '선택한 ' + selectedPosts.size + '개 글 본문·사진 수집 요청'; }
    }
    function button(label, action, id, cls) {
      const n = el('button', label, cls || 'life-button'); n.type = 'button'; if (id) n.id = id;
      n.addEventListener('click', () => {
        if (!current() || busy || navigating) return;
        if (composing) { error.textContent = '아이디의 한글 입력을 마친 뒤 다시 선택해 주세요.'; error.hidden = false; input.focus(); return; }
        void action(n).catch(fail);
      });
      return n;
    }
    async function work(action) {
      if (!current() || busy) return;
      const token = epoch; busy = true; clearError(); controls();
      try { await action(token); } catch (cause) { if (current(token)) fail(cause); }
      finally { if (current(token)) { busy = false; controls(); } }
    }
    async function navigate(callback) {
      if (!current() || navigating) return;
      busy = false; navigating = true; controls();
      try { await callback(); } finally { navigating = false; if (current()) controls(); }
    }
    function date(value) {
      const at = new Date(value || '');
      return Number.isFinite(at.getTime()) ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(at) : '아직 없음';
    }
    function safeLink(value, label) {
      try {
        const u = new URL(value);
        if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null;
        const a = el('a', label, 'life-button'); a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
      } catch (_) { return null; }
    }
    function advancedFailure(cause) {
      if (!current() || !captureError) return;
      const setup = cause?.code === 'naver_setup_required';
      captureError.hidden = false; captureError.textContent = setup ? '서버 수집 기능은 준비 중입니다. 연결과 선택은 그대로 있으며 실제 수집 범위는 아직 확인하지 않았습니다.' :
        cause?.code === 'naver_conflict' ? '다른 화면에서 연결이 바뀌었습니다. 연결 목록을 다시 확인한 뒤 같은 선택으로 시도해 주세요.' :
        '목록이나 수집 처리를 완료하지 못했습니다. 선택과 기존 자료는 그대로 있습니다. 다시 확인해 주세요.';
      captureStatus.textContent = setup ? '서버 수집 기능 준비 중 · 선택 유지' : '완료하지 못함 · 선택 유지'; captureStatus.dataset.state = setup ? 'setup-required' : 'error';
    }
    async function advanced(action) {
      await work(async token => { captureError.hidden = true; try { await action(token); } catch (cause) { if (current(token)) advancedFailure(cause); } });
    }
    function jobStatus(value) {
      return ({ queued: '수집 대기', pending: '수집 대기', running: '수집 중', working: '수집 중', failed: '수집 실패 · 재시도 가능', stored: '수집 사본 보관됨', complete: '수집 사본 보관됨', completed: '수집 사본 보관됨', succeeded: '수집 사본 보관됨', cancelled: '수집 중지', blocked: '수집 보류' })[value] || '처리 상태 확인 필요';
    }
    function paintConnections() {
      if (!connectionsList) return;
      connectionsList.replaceChildren();
      if (!connections.length) connectionsList.append(el('p', '이 계정에 등록한 블로그가 없습니다. 위에서 아이디나 주소를 연결해 주세요.', 'life-help'));
      for (const connection of connections) {
        const article = el('article', null, 'nv-connection'); article.dataset.connectionId = connection.id;
        article.append(el('h3', connection.blogId), el('p', '이 계정에 등록된 연결 · 선택한 자료는 현재 공간에 받습니다.', 'life-meta'));
        {
          const show = button('공개 글 목록 보기', () => advanced(async token => {
            if (selectedSubscription !== connection.id) { selectedPosts.clear(); publicPages = 1; publicShown = 20; }
            selectedSubscription = connection.id; publicRows = []; await loadPublic(token); await loadCaptures(token); paintConnections();
          })); show.dataset.action = 'public-list'; show.setAttribute('aria-pressed', String(selectedSubscription === connection.id)); article.append(show);
          const inventory = button(connection.baselineComplete ? '공개 목록 다시 확인' : '과거 공개 글 목록 확인', () => advanced(async token => {
            selectedSubscription = connection.id;
            if (!['pending', 'running'].includes(connection.inventory?.status)) await service.startInventory(workspaceId, connection.id, connection.revision);
            if (!current(token)) return;
            const result = await service.checkCapture(workspaceId, connection.id, { inventory: true });
            if (!current(token)) return;
            await loadConnections(); await loadPublic(token); await loadCaptures(token);
            if (!current(token)) return;
            captureStatus.textContent = result?.status === 'checked' ? '확인한 공개 목록입니다. 필요한 글을 직접 골라 수집할 수 있습니다.' : '서버에서 공개 목록을 확인하고 있습니다. 잠시 뒤 수집 상태를 다시 확인해 주세요.';
            captureStatus.dataset.state = result?.status === 'checked' ? 'ready' : 'pending';
          })); inventory.dataset.action = 'inventory'; article.append(inventory);
          if (connection.baselineComplete && (connection.workspaceId === workspaceId || typeof service.configureConnection === 'function')) {
            const toggle = button(connection.enabled ? '이후 새 글 자동 수집 중지' : '이후 새 글 자동 수집 켜기', () => advanced(async token => {
              if (typeof service.configureConnection === 'function') await service.configureConnection(workspaceId, connection.id, { expectedRevision: connection.revision, enabled: !connection.enabled });
              else await service.save(workspaceId, { blogId: connection.blogId, expectedRevision: connection.revision, enabled: !connection.enabled });
              if (current(token)) { await load(); await loadConnections(); }
            })); toggle.dataset.action = 'new-posts'; toggle.dataset.unavailable = String(!ready); article.append(toggle);
          } else if (!connection.baselineComplete) article.append(el('p', '첫 공개 목록을 확인한 뒤 이후 새 글 자동 수집을 켤 수 있습니다. 과거 글은 직접 선택합니다.', 'life-help'));
        }
        connectionsList.append(article);
      }
    }
    function paintPublic() {
      if (!publicList) return;
      publicList.replaceChildren();
      const rows = publicRows.filter(row => !publicFilter.value || row.status === publicFilter.value);
      for (const row of rows.slice(0, publicShown)) {
        const article = el('article', null, 'nv-public-item'); article.dataset.logNo = row.logNo; article.dataset.state = row.status;
        const label = el('label', null, 'nv-post-choice'); const check = el('input'); check.type = 'checkbox'; check.dataset.logNo = row.logNo; check.checked = selectedPosts.has(row.logNo);
        check.setAttribute('aria-label', (row.title || '제목 없는 글') + ' 수집 선택');
        check.addEventListener('change', () => { if (check.checked && !selectedPosts.has(row.logNo) && selectedPosts.size >= 100) { check.checked = false; captureError.textContent = '한 번에 글 100개까지 선택할 수 있습니다. 일부 선택을 비운 뒤 다시 골라 주세요.'; captureError.hidden = false; return; } if (check.checked) selectedPosts.add(row.logNo); else selectedPosts.delete(row.logNo); controls(); });
        label.append(check, el('span', row.title || '제목 없는 글')); article.append(label, el('p', labels[row.status] || (row.status === 'deferred' ? '수집 보류' : '보관 상태 확인 필요'), 'life-meta'));
        const actions = el('div', null, 'life-actions'); const original = safeLink(row.url, '네이버 원문 열기'); if (original) actions.append(original);
        if (row.sourceId && onOpenSource) { const open = button('보관한 자료 열기', () => navigate(() => onOpenSource({ sourceId: row.sourceId, sourceVersionId: row.sourceVersionId }))); open.dataset.focusKey = 'naver-blog:source:' + row.sourceId; actions.append(open); }
        article.append(actions); publicList.append(article);
      }
      if (!rows.length) publicList.append(el('p', selectedSubscription ? '확인한 범위에 해당 글이 없습니다. 공개 목록을 확인하지 못한 범위는 비어 있음으로 확정하지 않습니다.' : '연결한 블로그에서 공개 글 목록 보기를 선택해 주세요.', 'life-help'));
      publicList.dataset.state = selectedSubscription ? rows.length ? 'ready' : 'empty' : 'idle';
      publicMore.hidden = rows.length <= publicShown && !publicPage?.hasMore;
      controls();
    }
    async function loadPublic(token = epoch, append = false) {
      const page = await service.publicList(workspaceId, selectedSubscription, append ? { before: publicPage?.nextCursor } : {});
      if (!current(token)) return;
      if (!page || !Array.isArray(page.items)) throw new Error('invalid_public_list');
      const rows = append ? publicRows.slice() : [], known = new Set(rows.map(row => row.logNo));
      rows.push(...page.items.filter(row => !known.has(row.logNo)));
      publicRows = rows; publicPage = page; if (Array.isArray(page.jobs)) jobs = page.jobs;
      paintPublic();
      captureStatus.textContent = page.complete ? '확인한 공개 목록입니다. 공개 여부나 이후 변경은 원문에서 다시 확인할 수 있습니다.' : '일부 공개 목록만 확인했습니다. 목록 밖의 글이 없다는 뜻은 아닙니다.';
      captureStatus.dataset.state = page.complete ? 'ready' : 'partial';
    }
    function paintCaptures() {
      captureList.replaceChildren();
      for (const job of jobs) {
        const article = el('article', null, 'nv-job'); article.dataset.jobId = job.id; article.dataset.state = job.status;
        article.append(el('p', (job.title || (job.logNo || job.log_no ? '글 ' + (job.logNo || job.log_no) : '공개 목록')) + ' · ' + jobStatus(job.status), 'life-meta'));
        if (['failed', 'blocked'].includes(job.status) && typeof service.retry === 'function') { const retry = button('이 항목 다시 시도', () => advanced(async token => {
          await service.retry(workspaceId, job.id); if (!current(token)) return; await service.checkCapture(workspaceId, selectedSubscription, { jobId: job.id }); if (current(token)) await loadCaptures(token);
        })); retry.dataset.action = 'retry-job'; article.append(retry); }
        captureList.append(article);
      }
      for (const row of captures) {
        const article = el('article', null, 'nv-capture-row'); article.dataset.captureId = row.id;
        article.append(el('h3', row.payload?.title || '수집한 글'), el('p', '수집 사본 · 본문과 사진 범위 확인 필요', 'life-meta'));
        article.append(el('p', '수집 시각: ' + date(row.created_at || row.payload?.extractedAt), 'life-meta'));
        if (onReview) { const key = 'naver-blog:capture:' + row.id; const review = button('본문·사진 검토', () => navigate(() => onReview({ captureId: row.id, focusKey: key, subscriptionId: selectedSubscription })));
          review.dataset.action = 'review-capture'; review.dataset.focusKey = key; article.append(review); }
        const refresh = button('원문 다시 확인', () => advanced(async token => {
          const connection = connections.find(value => value.id === selectedSubscription);
          if (!connection) return;
          await service.queue(workspaceId, selectedSubscription, { logNos: [row.payload.logNo], expectedRevision: connection.revision, refresh: true });
          if (!current(token)) return;
          const result = await service.checkCapture(workspaceId, selectedSubscription);
          if (!current(token)) return;
          await loadCaptures(token);
          if (current(token)) { captureStatus.textContent = result?.status === 'checked' ? '원문 다시 확인 요청을 처리했습니다. 개별 수집 결과에서 실제 완료 여부를 확인해 주세요.' : '원문 다시 확인이 진행 중입니다. 이전 수집 사본은 그대로 있습니다.'; captureStatus.dataset.state = result?.status === 'checked' ? 'ready' : 'pending'; }
        })); refresh.dataset.action = 'refresh-capture'; article.append(refresh);
        captureList.append(article);
      }
      if (!jobs.length && !captures.length) captureList.append(el('p', '이 블로그에서 확인한 수집 작업이나 사본이 없습니다.', 'life-help'));
    }
    async function loadCaptures(token = epoch, append = false) {
      if (!selectedSubscription || typeof service.captures !== 'function') return;
      const result = await service.captures(workspaceId, { subscriptionId: selectedSubscription, ...(append ? { before: capturePage?.nextCursor } : {}) });
      if (!current(token)) return;
      if (!result || !Array.isArray(result.captures) || !Array.isArray(result.jobs)) throw new Error('invalid_captures');
      const rows = append ? captures.slice() : [], known = new Set(rows.map(row => row.id)); rows.push(...result.captures.filter(row => !known.has(row.id)));
      captures = rows; jobs = result.jobs; capturePage = result; paintCaptures();
      const more = capturePanel.querySelector('#naverCaptureMore'); more.hidden = !result.hasMore;
    }
    async function loadConnections() {
      if (!captureEnabled) return;
      const token = epoch, result = await service.connections(workspaceId);
      if (!current(token)) return;
      if (!result || !Array.isArray(result.connections)) throw new Error('invalid_connections');
      connections = result.connections; connectionsLoaded = true; paintConnections(); controls();
    }
    function initCaptures() {
      capturePanel = el('section', null, 'nv-capture-intake'); capturePanel.id = 'naverCaptureIntake';
      capturePanel.append(el('h2', '과거 글·사진 가져오기'), el('p', '이 계정에 등록한 연결에서 공개 글 목록을 확인하고 필요한 글을 고릅니다. 기존 자료를 자동으로 덮어쓰거나 새 글을 공개하지 않습니다.', 'life-help'));
      connectionsList = el('div', null, 'nv-connections'); connectionsList.id = 'naverAccountConnections';
      captureStatus = el('p', '계정에 등록한 연결을 확인하고 있습니다…', 'life-status'); captureStatus.id = 'naverCaptureIntakeStatus'; captureStatus.setAttribute('role', 'status');
      captureError = el('p', '', 'life-error'); captureError.id = 'naverCaptureIntakeError'; captureError.setAttribute('role', 'alert'); captureError.hidden = true;
      const filterLabel = el('label', null, 'life-field'); filterLabel.htmlFor = 'naverPublicFilter'; filterLabel.append(el('span', '공개 목록 보관 상태'));
      publicFilter = el('select'); publicFilter.id = 'naverPublicFilter';
      for (const [value, label] of [['', '전체'], ...Object.entries(labels), ['deferred', '수집 보류']]) { const option = el('option', label); option.value = value; publicFilter.append(option); }
      publicFilter.value = [...Object.keys(labels), 'deferred'].includes(viewState.publicFilter) ? viewState.publicFilter : '';
      publicFilter.addEventListener('change', () => { publicShown = 20; paintPublic(); }); filterLabel.append(publicFilter);
      publicList = el('div', null, 'nv-public-list'); publicList.id = 'naverPublicList';
      publicMore = button('공개 글 20개 더 보기', () => advanced(async token => {
        const matching = publicRows.filter(row => !publicFilter.value || row.status === publicFilter.value);
        if (publicShown >= matching.length && publicPage?.hasMore) { await loadPublic(token, true); if (!current(token)) return; publicPages++; }
        publicShown += 20; paintPublic();
      }), 'naverPublicMore'); publicMore.hidden = true;
      queueButton = button('선택한 글 본문·사진 수집 요청', () => advanced(async token => {
        const connection = connections.find(row => row.id === selectedSubscription);
        if (!connection || !selectedPosts.size) return;
        const result = await service.queue(workspaceId, selectedSubscription, { logNos: [...selectedPosts], expectedRevision: connection.revision });
        if (!current(token)) return;
        if (Array.isArray(result?.jobs)) jobs = result.jobs;
        captureStatus.textContent = '선택한 글의 수집을 요청했습니다. 개별 결과는 수집 상태에서 확인해 주세요.'; captureStatus.dataset.state = 'pending'; paintCaptures();
        await service.checkCapture(workspaceId, selectedSubscription);
        if (current(token)) await loadCaptures(token);
      }), 'naverCaptureQueue');
      const clear = button('수집 선택 비우기', async () => { selectedPosts.clear(); paintPublic(); }, 'naverCaptureClearSelection');
      const actions = el('div', null, 'life-actions'); actions.append(queueButton, clear);
      const refresh = button('수집 상태 다시 확인', () => advanced(async token => {
        await loadConnections(); if (!current(token)) return;
        if (selectedSubscription) {
          const connection = connections.find(row => row.id === selectedSubscription);
          if (connection) await service.checkCapture(workspaceId, selectedSubscription, { inventory: !connection.baselineComplete });
          if (!current(token)) return;
          await loadConnections(); await loadPublic(token); await loadCaptures(token);
        }
      }), 'naverCaptureRefresh'); actions.append(refresh);
      captureList = el('div', null, 'nv-capture-list'); captureList.id = 'naverCaptureList';
      const more = button('수집 사본 더 보기', () => advanced(token => loadCaptures(token, true)), 'naverCaptureMore'); more.hidden = true;
      capturePanel.append(connectionsList, captureStatus, captureError, filterLabel, publicList, publicMore, actions, el('p', '수집 결과는 일부 본문·실패한 사진을 포함할 수 있습니다. 각 사본에서 실제 보관 범위를 확인해 주세요.', 'life-help'), captureList, more);
      if (onImportFile) {
        const label = el('label', null, 'life-field'); label.htmlFor = 'naverCaptureImportFile'; label.append(el('span', '원문·사진 사본 ZIP 불러오기'));
        const file = el('input'); file.type = 'file'; file.accept = '.zip,application/zip'; file.id = 'naverCaptureImportFile';
        file.addEventListener('change', () => { const selected = file.files?.[0]; if (!selected || busy || !current()) return; void navigate(() => onImportFile(selected)).catch(fail); }); label.append(file); capturePanel.append(label, el('p', '선택한 원문 버전과 보관한 사진의 파일 사본입니다. 개인 메모·발췌·작성한 글은 포함하지 않습니다.', 'life-help'));
      }
      surface.append(capturePanel); paintPublic();
    }
    function paintSubscriptions() {
      subscriptions.replaceChildren();
      if (!data.subscriptions.length) { subscriptions.append(el('p', '연결한 블로그가 없습니다.', 'life-help')); return; }
      for (const row of data.subscriptions) {
        const article = el('article', null, 'nv-subscription'); article.dataset.subscriptionId = row.id;
        article.append(el('h3', row.blogId || row.blog_id || '연결한 블로그'));
        article.append(el('p', !ready ? '연결 주소 보관 · 자동 수집 준비 중' : row.enabled ? '새 공개 글 자동 수집 켜짐' : '자동 수집 중지', 'life-meta'));
        article.append(el('p', '마지막 확인 성공: ' + date(row.lastSuccessAt || row.last_success_at), 'life-meta'));
        if (row.lastError || row.last_error || row.lastErrorCode || row.last_error_code) article.append(el('p', '최근 확인에 실패했습니다. 기존 자료는 유지됩니다. 다시 확인할 수 있습니다.', 'nv-warning'));
        const actions = el('div', null, 'life-actions');
        actions.append(button('지금 확인', () => work(async token => {
          message('새 공개 글을 확인하고 있습니다…', 'checking');
          const result = await service.check(workspaceId, row.id);
          if (current(token)) await load(result?.status === 'busy' ? '서버에서 확인 작업이 진행 중입니다. 현재 보관된 목록을 표시합니다. 잠시 뒤 다시 확인해 주세요.' : '새 글 목록을 확인했습니다.', result?.status === 'busy' ? 'checking' : null);
        })));
        const toggle = button(row.enabled ? '자동 수집 중지' : '자동 수집 켜기', () => work(async token => {
          const result = await service.save(workspaceId, { blogId: row.blogId || row.blog_id, expectedRevision: row.revision, enabled: !row.enabled });
          if (!current(token)) return;
          adoptSubscription(result); paintSubscriptions(); await load('연결 설정을 보관했습니다.');
        }));
        if (!ready) toggle.dataset.unavailable = 'true';
        toggle.dataset.action = row.enabled ? 'pause' : 'resume'; actions.append(toggle); article.append(actions); subscriptions.append(article);
      }
    }
    function paintItems() {
      items.replaceChildren();
      const rows = data.items.filter(row => !filter.value || row.status === filter.value);
      for (const row of rows.slice(0, shown)) {
        const article = el('article', null, 'nv-item'); article.dataset.itemId = row.id; article.dataset.state = row.status;
        article.append(el('h3', row.title || '제목 없는 글'), el('p', labels[row.status] || '보관 상태 확인 필요', 'life-meta'));
        if (row.status === 'needs_content') article.append(el('p', '기존 자료는 일부 본문 또는 링크만 보관되어 있습니다. 원문을 확인하고 본문을 보완할 수 있습니다.', 'life-help'));
        const actions = el('div', null, 'life-actions'); const original = safeLink(row.url, '네이버 원문 열기'); if (original) actions.append(original);
        if (row.sourceId && onOpenSource) {
          const open = button('보관한 자료 열기', () => navigate(() => onOpenSource({ sourceId: row.sourceId, sourceVersionId: row.sourceVersionId }))); open.dataset.action = 'open'; open.dataset.focusKey = 'naver-blog:source:' + row.sourceId; actions.append(open);
        }
        if (row.status === 'needs_content' && onImport) {
          const add = button('본문 보완하기', () => navigate(() => onImport({ item: row, sourceId: row.sourceId, sourceVersionId: row.sourceVersionId, input: model().toImportInput(row) }))); add.dataset.action = 'complete'; actions.append(add);
        }
        if (row.status === 'new') {
          const receive = button('이 공간에 받기', () => work(async token => {
            message('선택한 글을 자료로 보관하고 있습니다…', 'receiving');
            const result = await service.receive(workspaceId, row.id);
            if (!current(token)) return;
            // Keep a committed source receipt if the following list read fails.
            if (result?.sourceId) { row.sourceId = result.sourceId; row.sourceVersionId = result.sourceVersionId || null; row.status = 'needs_content'; paintItems(); }
            await load('선택한 글을 자료로 보관했습니다. 본문 포함 범위를 확인해 주세요.');
          })); receive.dataset.action = 'receive'; actions.append(receive);
        }
        if (row.status === 'ambiguous') {
          article.append(el('p', '기존 자료가 여러 개와 겹쳐 자동으로 합치지 않았습니다.', 'life-help'));
          if (onOpenSource) (row.candidateSourceIds || []).forEach((sourceId, index) => {
            const candidate = button('기존 자료 ' + (index + 1) + ' 확인', () => navigate(() => onOpenSource({ sourceId })));
            candidate.dataset.action = 'candidate'; candidate.dataset.focusKey = 'naver-blog:source:' + sourceId; actions.append(candidate);
          });
        }
        article.append(actions); items.append(article);
      }
      if (!rows.length) items.append(el('p', loaded ? '확인한 목록에 해당하는 글이 없습니다. 목록에 없는 과거 글까지 모두 확인한 결과는 아닙니다.' : '글 목록을 확인하고 있습니다…', 'life-help'));
      more.hidden = rows.length <= shown && !data.hasMore; items.dataset.state = loaded ? rows.length ? 'ready' : 'empty' : 'loading';
    }
    function adoptSubscription(row) {
      if (!row?.id) return;
      const i = data.subscriptions.findIndex(item => item.id === row.id);
      if (i < 0) data.subscriptions.push(row); else data.subscriptions[i] = row;
    }
    function collectionNotice(result, success, displayState) {
      clearError();
      const count = Number.isSafeInteger(result.receivedCount) && result.receivedCount > 0 ? result.receivedCount : 0;
      const received = count ? ' ' + count + '개 글을 이 공간의 자료에 반영했습니다.' : '';
      if (result.autoReceiveError) {
        error.textContent = '일부 글을 이 공간에 반영하지 못했습니다. 이미 보관한 자료는 유지됩니다. 목록을 다시 확인해 주세요.';
        error.hidden = false;
      }
      message((success || (ready ? '확인 가능한 공개 글 목록입니다.' : '연결 주소를 보관할 수 있습니다. 서버 수집 기능은 준비 중이며 실제 수집 범위는 아직 확인하지 않았습니다.')) + received,
        result.autoReceiveError ? 'partial' : ready ? displayState || 'ready' : 'setup-required');
    }
    async function load(success, displayState) {
      const token = epoch, id = ++request; message('연결과 글 목록을 확인하고 있습니다…', 'loading');
      const first = await service.list(workspaceId);
      if (!current(token) || id !== request) return;
      if (!first || !Array.isArray(first.subscriptions) || !Array.isArray(first.items)) throw new Error('invalid_list');
      const result = { ...first, items: first.items.slice() };
      let restoredPages = 1;
      const seen = new Set();
      while (result.hasMore && restoredPages < pagesLoaded) {
        const key = JSON.stringify(result.nextCursor);
        if (!key || seen.has(key)) throw new Error('invalid_cursor');
        seen.add(key);
        const page = await service.list(workspaceId, { before: result.nextCursor });
        if (!current(token) || id !== request) return;
        if (!page || !Array.isArray(page.items)) throw new Error('invalid_list');
        const known = new Set(result.items.map(row => row.id));
        result.items.push(...page.items.filter(row => !known.has(row.id)));
        result.hasMore = page.hasMore; result.nextCursor = page.nextCursor;
        result.receivedCount = (result.receivedCount || 0) + (page.receivedCount || 0);
        result.autoReceiveError ||= page.autoReceiveError;
        restoredPages++;
      }
      pagesLoaded = restoredPages;
      data = { subscriptions: result.subscriptions.map(row => ({ ...row })), items: result.items.map(row => ({ ...row })), hasMore: result.hasMore === true, nextCursor: result.nextCursor }; ready = result.ready === true; loaded = true;
      paintSubscriptions(); paintItems(); controls();
      collectionNotice(result, success, displayState);
    }
    function init() {
      surface = el('section', null, 'naver-blog'); surface.id = 'lifeNaverBlog'; surface.setAttribute('aria-label', '네이버 블로그 연결');
      surface.append(el('p', '공개한 네이버 글을 비공개 자료로 모읍니다. 네이버 원본을 수정하거나 해도에 자동 공개하지 않습니다.', 'life-help'));
      const form = el('form', null, 'nv-form');
      const label = el('label', null, 'life-field'); label.htmlFor = 'naverBlogId'; label.append(el('span', '아이디 또는 블로그 주소'));
      input = el('input'); input.id = 'naverBlogId'; input.type = 'text'; input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = 8192; input.setAttribute('aria-describedby', 'naverBlogHelp naverBlogPreview'); label.append(input);
      input.value = typeof viewState.blogInput === 'string' ? viewState.blogInput.slice(0, 8192) : '';
      const help = el('p', 'blog.naver.com/ 뒤에 오는 아이디나 블로그 주소를 입력해 주세요.', 'life-help'); help.id = 'naverBlogHelp';
      preview = el('p', '블로그 주소를 입력하면 연결할 주소가 여기에 표시됩니다.', 'nv-preview life-meta'); preview.id = 'naverBlogPreview';
      const update = () => { const p = parsed(); preview.textContent = p?.url || (input.value ? '아이디나 블로그 주소를 확인해 주세요.' : '블로그 주소를 입력하면 연결할 주소가 여기에 표시됩니다.'); controls(); };
      input.addEventListener('input', update); input.addEventListener('compositionstart', () => { composing = true; controls(); }); input.addEventListener('compositionend', () => { composing = false; update(); });
      const choice = el('label', null, 'nv-auto'); auto = el('input'); auto.type = 'checkbox'; auto.id = 'naverBlogAuto'; choice.append(auto, el('span', '새로 확인되는 글을 비공개 자료로 수집'));
      auto.addEventListener('change', () => { autoDraft = ready && auto.checked; });
      const autoHelp = el('p', captureEnabled ? '과거 공개 글은 아래에서 직접 고릅니다. 첫 목록 확인 뒤 이후 새 글 자동 수집을 켤 수 있습니다. 앱을 닫아도 서버에 보관하며, 이 화면에서 자료로 받습니다.' : '처음 확인한 목록도 포함합니다. 앱을 닫으면 서버에 보관하고, 이 화면을 열 때 현재 공간에 반영합니다.', 'life-help');
      autoHelp.id = 'naverBlogAutoHelp'; auto.setAttribute('aria-describedby', autoHelp.id);
      save = button('블로그 연결 보관', () => work(async token => {
        const value = model().parseBlog(input.value);
        if (captureEnabled) {
          const known = connections.find(row => row.blogId === value.blogId);
          if (known) {
            if (selectedSubscription !== known.id) { selectedPosts.clear(); publicPages = 1; publicShown = 20; }
            selectedSubscription = known.id; await loadPublic(token); await loadCaptures(token); paintConnections();
            if (current(token)) message('이 계정에 등록된 연결을 찾았습니다. 선택한 자료를 현재 공간에 받을 수 있습니다.', 'ready');
            return;
          }
        }
        const existing = data.subscriptions.find(row => (row.blogId || row.blog_id) === value.blogId);
        const result = await service.save(workspaceId, { blogId: value.blogId, expectedRevision: existing?.revision || 0, enabled: ready && auto.checked });
        if (!current(token)) return;
        adoptSubscription(result); paintSubscriptions(); await load('블로그 연결을 보관했습니다.'); if (captureEnabled) await loadConnections();
      }), 'naverBlogSave');
      form.addEventListener('submit', event => { event.preventDefault(); if (!save.disabled) save.click(); });
      form.append(label, help, preview, choice, autoHelp, save);
      status = el('p', '', 'life-status'); status.id = 'naverBlogStatus'; status.setAttribute('role', 'status');
      error = el('p', '', 'life-error'); error.id = 'naverBlogError'; error.setAttribute('role', 'alert'); error.hidden = true;
      const tools = el('div', null, 'life-actions'); tools.append(button('목록 다시 확인', async () => { clearError(); await load(); }, 'naverBlogRefresh'));
      if (onReturn) tools.append(button('자료 목록으로 돌아가기', () => navigate(onReturn), 'naverBlogReturn'));
      subscriptions = el('div', null, 'nv-subscriptions'); subscriptions.id = 'naverBlogSubscriptions';
      const heading = el('h2', '확인한 글');
      const filterLabel = el('label', null, 'life-field'); filterLabel.htmlFor = 'naverBlogFilter'; filterLabel.append(el('span', '보관 상태'));
      filter = el('select'); filter.id = 'naverBlogFilter';
      for (const [value, text] of [['', '전체'], ...Object.entries(labels)]) { const option = el('option', text); option.value = value; filter.append(option); }
      filter.value = Object.hasOwn(labels, viewState.filter) ? viewState.filter : '';
      filter.addEventListener('change', () => { shown = 20; paintItems(); }); filterLabel.append(filter);
      items = el('div', null, 'nv-items'); items.id = 'naverBlogItems';
      more = button('20개 더 보기', () => work(async token => {
        const matches = data.items.filter(row => !filter.value || row.status === filter.value);
        if (shown >= matches.length && data.hasMore) {
          const page = await service.list(workspaceId, { before: data.nextCursor });
          if (!current(token)) return;
          if (!page || !Array.isArray(page.items)) throw new Error('invalid_list');
          const known = new Set(data.items.map(row => row.id));
          data.items.push(...page.items.filter(row => !known.has(row.id)).map(row => ({ ...row })));
          data.hasMore = page.hasMore === true; data.nextCursor = page.nextCursor;
          pagesLoaded++;
          collectionNotice(page, '글 목록을 더 확인했습니다.');
        }
        const start = shown; shown += 20; paintItems();
        const first = items.children[start]; first?.querySelector('button,a')?.focus({ preventScroll: true }); first?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }), 'naverBlogMore'); more.hidden = true;
      surface.append(form, status, error, tools, subscriptions);
      if (captureEnabled) initCaptures();
      surface.append(heading, el('p', '본문 일부·링크만 보관될 수 있습니다. 이 목록의 RSS 사본에는 사진 파일이 없으며 목록 밖의 과거 글은 확인되지 않았을 수 있습니다.', 'life-help'), filterLabel, items, more);
      container.replaceChildren(surface); update();
    }
    async function render() {
      if (disposed || !isCurrent()) return; if (!surface) init();
      try { await load(); } catch (cause) { fail(cause); }
      if (captureEnabled && current()) try {
        await loadConnections();
        if (!current()) return;
        if (selectedSubscription && connections.some(row => row.id === selectedSubscription)) {
          await loadPublic();
          const pages = publicPages; for (let page = 1; current() && publicPage?.hasMore && page < pages; page++) await loadPublic(epoch, true);
          if (current()) await loadCaptures();
        } else { selectedSubscription = ''; selectedPosts.clear(); }
      } catch (cause) { advancedFailure(cause); }
    }
    async function flush() {
      if (composing) throw new Error('아이디 입력을 마친 뒤 이동해 주세요.');
      if (busy && !navigating) throw new Error('선택한 작업이 끝난 뒤 이동해 주세요.');
    }
    return { render, flush, dirty: () => composing || busy && !navigating,
      getView: () => ({ blogInput: input?.value || '', autoCollect: autoDraft, filter: filter?.value || '', shown, pagesLoaded,
        subscriptionId: selectedSubscription, publicFilter: publicFilter?.value || '', publicShown, publicPages, selectedLogNos: [...selectedPosts] }),
      destroy() { if (disposed) return; disposed = true; epoch++; request++; data = { subscriptions: [], items: [] }; connections = []; publicRows = []; jobs = []; captures = []; publicPage = capturePage = null; selectedPosts.clear(); surface?.replaceChildren(); container.replaceChildren(); } };
  }
  return Object.freeze({ create });
});

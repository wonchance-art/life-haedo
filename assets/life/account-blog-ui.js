/* Private server-post discovery. Bodies and originals are received only on selection. */
(function (root) {
  'use strict';
  const life = root.HaedoLife ||= {};
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
  const labels = {
    server_only: '이 기기에 아직 받지 않은 글', received: '이 기기에 받은 글',
    remote_updated: '서버에 새 내용 있음', local_pending: '이 기기에 서버 보관 전 변경 있음',
    paused: '서버 연결 중지', conflict: '양쪽 변경 확인 필요', error: '보관 상태 확인 필요',
  };
  const attention = new Set(['remote_updated', 'local_pending', 'paused', 'conflict', 'error']);
  function create({ storage, workspaceId, blogSync, isCurrent = () => true, onOpenPost, onManagePost, viewState = {} }) {
    viewState ||= {};
    let host = null, surface, search, status, error, list, more, refresh;
    let disposed = false, epoch = 0, busy = null, navigating = false, composing = false;
    let rows = [], loaded = false, query = typeof viewState.query === 'string' ? viewState.query.slice(0, 1000) : '';
    let shown = Number.isSafeInteger(viewState.shown) ? Math.max(20, Math.min(10000, viewState.shown)) : 20;
    const receipts = new Map();
    const valid = token => !disposed && isCurrent() && !!host?.isConnected && (token == null || token === epoch);
    const fault = text => new Error(text);
    function message(text, state) { if (!valid()) return; status.textContent = text; status.dataset.state = state; }
    function fail(cause, received = false) {
      if (!valid()) return;
      error.hidden = false;
      error.textContent = received ? '글은 이 브라우저에 보관했습니다. 화면을 열지 못했으니 받은 글 다시 열기를 눌러 주세요.' :
        cause?.code === 'blog_copy_selection_required' ? '이 기기의 사본이 여러 개입니다. 목록을 다시 확인하고 열 사본을 골라 주세요.' :
        '처리하지 못했습니다. 이 브라우저의 글은 그대로 있습니다. 목록을 다시 확인한 뒤 다시 시도해 주세요.';
      message(received ? '받은 글을 다시 열 수 있습니다.' : '확인하지 못함 · 기존 글 유지', 'error');
    }
    function clearError() { error.hidden = true; error.textContent = ''; }
    function lock() {
      if (!surface) return;
      surface.setAttribute('aria-busy', String(!!busy));
      surface.querySelectorAll('button').forEach(button => { button.disabled = !!busy; });
      search.disabled = busy === 'receive';
    }
    function button(label, action, { kind, remoteId, localPostId, focusKey } = {}) {
      const node = el('button', label, 'life-button'); node.type = 'button';
      if (kind) node.dataset.action = kind;
      if (remoteId) node.dataset.remoteId = remoteId;
      if (localPostId) node.dataset.localPostId = localPostId;
      if (focusKey) node.dataset.focusKey = focusKey;
      node.addEventListener('click', () => {
        if (!valid() || busy) return;
        if (composing) { error.hidden = false; error.textContent = '검색어의 한글 입력을 마친 뒤 다시 선택해 주세요.'; search.focus(); return; }
        void action(node).catch(fail);
      });
      return node;
    }
    async function navigate(callback) {
      busy = null; navigating = true; lock();
      try { await callback(); } finally { navigating = false; }
    }
    async function openReceipt(receipt, focusKey) {
      if (!valid()) return;
      try {
        await navigate(() => onOpenPost(receipt.localPostId, { expectedRevision: receipt.post.revision, focusKey }));
      } catch (cause) { if (valid()) { renderRows(); fail(cause, true); } }
    }
    async function open(row, copy, focusKey) {
      if (!valid() || busy) return;
      const token = epoch;
      clearError(); busy = 'receive'; lock(); message(copy ? '이 기기의 글을 확인하고 있습니다…' : '선택한 글과 사진 원본을 이 기기에 받고 있습니다…', 'receiving');
      try {
        if (!blogSync?.openRemote) throw fault('server_unavailable');
        const result = await blogSync.openRemote(workspaceId, row.id, { expectedRemoteRevision: row.revision, isCurrent: () => valid(token), ...(copy ? { localPostId: copy.localPostId } : {}) });
        if (!valid(token)) return;
        if (result.workspaceId !== workspaceId || !result.post || result.localPostId !== result.post.id) throw fault('invalid_received_post');
        const receipt = { ...result, post: { id: result.post.id, revision: result.post.revision } };
        receipts.set(row.id, receipt);
        if (!copy) {
          row.copies = [{ localPostId: result.localPostId, revision: result.post.revision, remoteRevision: row.revision, status: 'received', archived: result.post.archived === true }];
          row.status = 'received';
        }
        busy = null; lock(); renderRows();
        message(result.received ? '선택한 글을 이 브라우저에 보관했습니다.' : '이 기기에 보관한 글을 확인했습니다.', 'received');
        await openReceipt(receipt, focusKey);
      } catch (cause) { if (valid(token)) fail(cause); }
      finally { if (valid(token)) { busy = null; lock(); } }
    }
    async function manage(copy, focusKey) {
      if (!valid() || busy) return;
      clearError();
      if (!onManagePost) throw fault('manager_unavailable');
      await navigate(() => onManagePost(copy.localPostId, { focusKey }));
    }
    function renderRows() {
      if (!valid()) return;
      const term = query.trim().toLocaleLowerCase('ko-KR');
      const matching = rows.filter(row => !term || String(row.title || '').toLocaleLowerCase('ko-KR').includes(term));
      const fragment = document.createDocumentFragment();
      matching.slice(0, shown).forEach(row => {
        const article = el('article', null, 'ab-post'); article.dataset.remoteId = row.id; article.dataset.state = row.status;
        article.append(el('h3', row.title?.trim() || '제목 없는 글'));
        const metadata = el('p', labels[row.status] || labels.error, 'life-meta ab-post-state');
        const date = new Date(row.updated_at);
        if (Number.isFinite(date.getTime())) { const time = el('time', new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(date)); time.dateTime = date.toISOString(); metadata.append(document.createTextNode(' · 서버 보관 '), time); }
        article.append(metadata);
        const actions = el('div', null, 'life-actions ab-post-actions'), copies = Array.isArray(row.copies) ? row.copies : [];
        const receipt = receipts.get(row.id);
        if (receipt) {
          const focusKey = 'account-blog:received:' + row.id;
          actions.append(button('받은 글 다시 열기', () => openReceipt(receipt, focusKey), { kind: 'retry-open', remoteId: row.id, localPostId: receipt.localPostId, focusKey }));
        }
        if (!receipt && !copies.length) {
          const focusKey = 'account-blog:receive:' + row.id;
          actions.append(button('이 기기에 받기', () => open(row, null, focusKey), { kind: 'receive', remoteId: row.id, focusKey }));
        } else copies.forEach((copy, index) => {
          if (copy.localPostId === receipt?.localPostId) return;
          const holder = el('div', null, 'ab-copy'); holder.dataset.localPostId = copy.localPostId; holder.dataset.state = copy.status;
          if (copies.length > 1 || copy.archived) holder.append(el('p', (copies.length > 1 ? '사본 ' + (index + 1) + ' · ' : '') + (labels[copy.status] || labels.error) + (copy.archived ? ' · 보관함' : ''), 'life-meta'));
          const suffix = copies.length > 1 ? ' · 사본 ' + (index + 1) : '';
          const focusKey = 'account-blog:open:' + row.id + ':' + copy.localPostId;
          holder.append(button('이 기기의 글 열기' + suffix, () => open(row, copy, focusKey), { kind: 'open', remoteId: row.id, localPostId: copy.localPostId, focusKey }));
          if (attention.has(copy.status)) {
            const manageKey = 'account-blog:manage:' + row.id + ':' + copy.localPostId;
            holder.append(button('글 관리에서 확인' + suffix, () => manage(copy, manageKey), { kind: 'manage', remoteId: row.id, localPostId: copy.localPostId, focusKey: manageKey }));
          }
          actions.append(holder);
        });
        article.append(actions); fragment.append(article);
      });
      if (loaded && !matching.length) fragment.append(el('p', query.trim() ? '이 제목과 일치하는 서버 글이 없습니다.' : '서버에 보관한 글이 없습니다. 이 기기의 글과 초안은 그대로 유지됩니다.', 'life-help ab-empty'));
      list.replaceChildren(fragment); more.hidden = matching.length <= shown;
      list.dataset.state = loaded ? matching.length ? 'ready' : 'empty' : 'loading';
      lock();
    }
    async function load() {
      if (!valid() || busy) return;
      const token = epoch; busy = 'list'; clearError(); lock(); message('서버에 보관한 글 목록을 확인하고 있습니다…', 'loading');
      try {
        if (!blogSync?.catalog) throw fault('server_unavailable');
        const result = await blogSync.catalog(workspaceId);
        if (!valid(token)) return;
        if (!Array.isArray(result)) throw fault('invalid_server_catalog');
        rows = structuredClone(result); loaded = true; receipts.clear(); renderRows(); message(rows.length + '개 서버 글을 확인했습니다. 선택한 글만 이 기기에 받습니다.', 'ready');
      } catch (cause) { if (valid(token)) fail(cause); }
      finally { if (valid(token)) { busy = null; lock(); } }
    }
    async function mount(target) {
      if (disposed) throw fault('disposed');
      host = target; epoch++; busy = null; navigating = false; composing = false; rows = []; loaded = false;
      surface = el('section', null, 'account-blog'); surface.id = 'lifeAccountBlog'; surface.setAttribute('aria-label', '서버에 보관한 글');
      const hint = el('p', '같은 계정으로 다른 기기에서 보관한 글을 확인합니다. 이 기기의 초안은 전송하거나 덮어쓰지 않습니다.', 'life-help');
      const tools = el('div', null, 'ab-tools');
      const label = el('label', '서버 글 제목 검색', 'life-field'); search = el('input'); search.type = 'search'; search.id = 'accountBlogSearch'; search.maxLength = 1000; search.value = query; search.autocomplete = 'off'; label.append(search);
      search.addEventListener('compositionstart', () => { composing = true; });
      search.addEventListener('input', () => { if (!composing && valid()) { query = search.value; shown = 20; renderRows(); } });
      search.addEventListener('compositionend', () => { composing = false; if (valid()) { query = search.value; shown = 20; renderRows(); } });
      refresh = button('목록 다시 확인', load, { kind: 'refresh' }); refresh.id = 'accountBlogRefresh'; tools.append(label, refresh);
      status = el('p', '', 'life-meta ab-status'); status.id = 'accountBlogStatus'; status.setAttribute('role', 'status');
      error = el('p', '', 'life-error ab-error'); error.id = 'accountBlogError'; error.hidden = true; error.setAttribute('role', 'alert');
      list = el('div', null, 'ab-list'); list.id = 'accountBlogList'; list.dataset.state = 'loading';
      more = button('글 20개 더 보기', async () => {
        const start = shown; shown += 20; renderRows();
        const next = list.children[start];
        next?.querySelector('button')?.focus({ preventScroll: true }); next?.scrollIntoView({ block: 'nearest' });
      }, { kind: 'more' }); more.id = 'accountBlogMore'; more.hidden = true;
      surface.append(hint, tools, status, error, list, more); host.replaceChildren(surface);
      await load();
    }
    async function flush() {
      if (disposed) throw fault('화면이 바뀌었습니다.');
      if (composing) throw fault('검색어의 한글 입력을 마친 뒤 이동해 주세요. 입력은 그대로 유지됩니다.');
      if (busy === 'receive' && !navigating) throw fault('선택한 글의 확인이 끝난 뒤 이동해 주세요. 이 기기의 글은 유지됩니다.');
    }
    return { mount, flush, dirty: () => composing || busy === 'receive' && !navigating,
      getView: () => ({ query: search?.value ?? query, shown }),
      dispose() { if (disposed) return; disposed = true; epoch++; rows = []; receipts.clear(); busy = null; surface?.replaceChildren(); host = null; } };
  }
  life.AccountBlogUI = Object.freeze({ create });
})(globalThis);

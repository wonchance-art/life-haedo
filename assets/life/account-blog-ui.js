/* Account blog sync overview: every saved post and draft of this account, on all devices. */
(function (root) {
  'use strict';
  const life = root.HaedoLife ||= {};
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
  // One compact status vocabulary for the whole sync.
  const labels = { synced: '계정에 올림', pending: '계정에 올리기 대기', error: '계정에 올리지 못함 · 다시 시도' };
  function overall(status) {
    if (!status || status.state === 'idle') return { state: 'pending', text: '동기화 확인 중' };
    if (status.state === 'error') return { state: 'error', text: labels.error };
    if (status.state === 'pending') return { state: 'pending', text: labels.pending + ((status.pending || 0) + (status.receiving || 0) ? ' · ' + ((status.pending || 0) + (status.receiving || 0)) + '개' : '') };
    return { state: 'synced', text: labels.synced };
  }
  // The offline shell's cache name tells which release this device runs.
  async function appVersion() {
    try {
      const keys = await root.caches?.keys?.();
      const versions = (keys || []).map(key => /^haedo-v(\d+)$/.exec(key)?.[1]).filter(Boolean).map(Number);
      return versions.length ? 'haedo-v' + Math.max(...versions) : null;
    } catch (_) { return null; }
  }
  function clock(value) {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) return null;
    const today = new Date().toDateString() === date.toDateString();
    return new Intl.DateTimeFormat('ko-KR', today ? { hour: 'numeric', minute: '2-digit' } : { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
  }
  function facts(value, version) {
    const parts = [version || '앱 버전 확인 불가'];
    if (Number.isSafeInteger(value?.posts)) parts.push('글 ' + value.posts + '개' + (value.drafts ? ' · 초안 ' + value.drafts + '개' : ''));
    parts.push('대기 ' + ((value?.pending || 0) + (value?.receiving || 0)) + ' · 실패 ' + (value?.errors || 0));
    const last = clock(value?.lastSyncAt);
    parts.push(last ? '마지막 동기화 ' + last : '아직 동기화 전');
    return parts.join(' · ');
  }
  function create({ storage, workspaceId, blogSync, isCurrent = () => true, onOpenPost, viewState = {} }) {
    viewState ||= {};
    let host = null, surface, search, status, detail, error, list, more, refresh, unsubscribe = null, version = null;
    let disposed = false, epoch = 0, busy = null, navigating = false, composing = false;
    let rows = [], loaded = false, query = typeof viewState.query === 'string' ? viewState.query.slice(0, 1000) : '';
    let shown = Number.isSafeInteger(viewState.shown) ? Math.max(20, Math.min(10000, viewState.shown)) : 20;
    const valid = token => !disposed && isCurrent() && !!host?.isConnected && (token == null || token === epoch);
    const fault = text => new Error(text);
    function showStatus(value) {
      if (!valid()) return;
      const summary = overall(value || blogSync?.getStatus?.());
      status.textContent = summary.text; status.dataset.state = summary.state;
      refresh.textContent = summary.state === 'error' ? '다시 시도' : '지금 동기화';
      detail.textContent = facts(value || blogSync?.getStatus?.(), version);
    }
    function fail(cause) {
      if (!valid()) return;
      error.hidden = false;
      error.textContent = cause?.message && cause.code !== 'network_error' ? cause.message : '서버를 확인하지 못했습니다. 이 기기의 글은 그대로 있고 자동으로 다시 시도합니다.';
      status.textContent = labels.error; status.dataset.state = 'error';
    }
    function clearError() { error.hidden = true; error.textContent = ''; }
    function lock() {
      if (!surface) return;
      surface.setAttribute('aria-busy', String(!!busy));
      surface.querySelectorAll('button').forEach(button => { button.disabled = !!busy; });
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
    async function open(row, focusKey) {
      if (!valid() || busy || !row.localPostId) return;
      clearError(); navigating = true;
      try { await onOpenPost(row.localPostId, { expectedRevision: row.localRevision, focusKey, workspaceId: row.localWorkspaceId || workspaceId }); }
      finally { navigating = false; }
    }
    function renderRows() {
      if (!valid()) return;
      const term = query.trim().toLocaleLowerCase('ko-KR');
      const matching = rows.filter(row => !term || String(row.title || '').toLocaleLowerCase('ko-KR').includes(term));
      const fragment = document.createDocumentFragment();
      matching.slice(0, shown).forEach(row => {
        const article = el('article', null, 'ab-post'); article.dataset.remoteId = row.id; article.dataset.state = row.status;
        article.append(el('h3', row.title?.trim() || (row.draft ? '제목 없는 초안' : '제목 없는 글')));
        const local = !!row.localPostId;
        const parts = [row.draft ? '초안' : row.archived ? '숨긴 글' : '글', !row.localPostId ? '이 기기로 받는 중' : labels[row.status] || labels.error];
        if (row.publication?.active) parts.push('공개 중');
        const metadata = el('p', parts.join(' · '), 'life-meta ab-post-state');
        const date = new Date(row.updated_at);
        if (Number.isFinite(date.getTime())) { const time = el('time', new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(date)); time.dateTime = date.toISOString(); metadata.append(document.createTextNode(' · '), time); }
        article.append(metadata);
        if (local) {
          const actions = el('div', null, 'life-actions ab-post-actions'), focusKey = 'account-blog:open:' + row.id;
          actions.append(button('열기', () => open(row, focusKey), { kind: 'open', remoteId: row.id, localPostId: row.localPostId, focusKey }));
          article.append(actions);
        }
        fragment.append(article);
      });
      if (loaded && !matching.length) fragment.append(el('p', query.trim() ? '이 제목과 일치하는 글이 없습니다.' : '아직 저장한 글이 없습니다.', 'life-help ab-empty'));
      list.replaceChildren(fragment); more.hidden = matching.length <= shown;
      list.dataset.state = loaded ? matching.length ? 'ready' : 'empty' : 'loading';
      lock();
    }
    async function load() {
      if (!valid() || busy) return;
      const token = epoch; busy = 'list'; clearError(); lock();
      try {
        if (!blogSync?.catalog) throw fault('서버 동기화를 준비하지 못했습니다. 이 기기의 글은 그대로 있습니다.');
        const result = await blogSync.catalog(workspaceId);
        if (!valid(token)) return;
        if (!Array.isArray(result)) throw fault('서버 글 목록을 확인하지 못했습니다.');
        rows = structuredClone(result); loaded = true; renderRows(); showStatus();
      } catch (cause) { if (valid(token)) fail(cause); }
      finally { if (valid(token)) { busy = null; lock(); } }
    }
    async function syncNow() {
      if (!valid() || busy) return;
      const token = epoch; busy = 'sync'; clearError(); lock(); status.textContent = '동기화 중…'; status.dataset.state = 'pending';
      try { if (blogSync?.syncNow) await blogSync.syncNow({ force: true }); }
      catch (cause) { if (valid(token)) fail(cause); }
      finally { if (valid(token)) { busy = null; lock(); } }
      if (valid(token)) await load();
    }
    async function mount(target) {
      if (disposed) throw fault('disposed');
      host = target; epoch++; busy = null; navigating = false; composing = false; rows = []; loaded = false;
      surface = el('section', null, 'account-blog'); surface.id = 'lifeAccountBlog'; surface.setAttribute('aria-label', '글 동기화');
      const hint = el('p', '저장한 글과 초안은 사진과 함께 로그인한 모든 기기에 자동으로 저장됩니다. 공개는 글마다 따로 선택합니다.', 'life-help');
      const head = el('div', null, 'ab-tools');
      status = el('p', '', 'life-meta ab-status'); status.id = 'accountBlogStatus'; status.setAttribute('role', 'status');
      refresh = button('지금 동기화', syncNow, { kind: 'refresh' }); refresh.id = 'accountBlogRefresh';
      detail = el('p', '', 'life-meta ab-facts'); detail.id = 'accountBlogFacts';
      head.append(status, refresh);
      const tools = el('div', null, 'ab-tools');
      const label = el('label', '글 제목 검색', 'life-field'); search = el('input'); search.type = 'search'; search.id = 'accountBlogSearch'; search.maxLength = 1000; search.value = query; search.autocomplete = 'off'; label.append(search);
      search.addEventListener('compositionstart', () => { composing = true; });
      search.addEventListener('input', () => { if (!composing && valid()) { query = search.value; shown = 20; renderRows(); } });
      search.addEventListener('compositionend', () => { composing = false; if (valid()) { query = search.value; shown = 20; renderRows(); } });
      tools.append(label);
      error = el('p', '', 'life-error ab-error'); error.id = 'accountBlogError'; error.hidden = true; error.setAttribute('role', 'alert');
      list = el('div', null, 'ab-list'); list.id = 'accountBlogList'; list.dataset.state = 'loading';
      more = button('글 20개 더 보기', async () => {
        const start = shown; shown += 20; renderRows();
        const next = list.children[start];
        next?.querySelector('button')?.focus({ preventScroll: true }); next?.scrollIntoView({ block: 'nearest' });
      }, { kind: 'more' }); more.id = 'accountBlogMore'; more.hidden = true;
      surface.append(hint, head, detail, tools, error, list, more); host.replaceChildren(surface);
      const token = epoch; void appVersion().then(value => { if (valid(token)) { version = value; showStatus(); } });
      unsubscribe?.();
      unsubscribe = blogSync?.subscribe?.(event => { if (event?.type === 'status') showStatus(event.status); });
      showStatus();
      await load();
    }
    async function flush() {
      if (disposed) throw fault('화면이 바뀌었습니다.');
      if (composing) throw fault('검색어의 한글 입력을 마친 뒤 이동해 주세요. 입력은 그대로 유지됩니다.');
    }
    return { mount, flush, dirty: () => composing,
      getView: () => ({ query: search?.value ?? query, shown }),
      dispose() { if (disposed) return; disposed = true; epoch++; unsubscribe?.(); unsubscribe = null; rows = []; busy = null; surface?.replaceChildren(); host = null; } };
  }
  life.AccountBlogUI = Object.freeze({ create, labels: Object.freeze({ ...labels }) });
})(globalThis);

/* Existing page publication CAS/receipts; this adapter never publishes a post. */
(function (root, factory) {
  const api = factory(root); (root.HaedoLife ||= {}).BlogSeriesRemote = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const dependency = (name, file) => root.HaedoLife?.[name] || require('./' + file);
  const fault = code => Object.assign(new Error(({ selection_changed: '공개 글이 바뀌었습니다. 목록을 다시 확인하고 선택해 주세요.',
    invalid_selection: '공개할 목차의 글을 직접 선택해 주세요.', request_cancelled: '계정 또는 화면이 바뀌어 요청을 중단했습니다.' })[code] || '공개 상태를 다시 확인해 주세요.'), { code });
  const check = (value, code = 'invalid_request') => { if (!value) throw fault(code); };
  const token = value => dependency('BlogPublic', 'blog-public.js').token(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  function create(options = {}) {
    const auth = options.auth || root.HaedoAuth, share = options.shareOwner || dependency('ShareRemote', 'share-remote.js').createOwner({ auth, storage: options.storage });
    const blogs = options.blogRemote || dependency('BlogRemote', 'blog-remote.js').create({ auth });
    const publicReader = options.publicReader || dependency('BlogPublic', 'blog-public.js').createReader({ config: auth.config });
    const baseURL = options.baseURL || root.location?.href;
    let disposed = false; const reviews = new WeakMap();
    const context = () => ({ userId: auth.user?.id, epoch: auth.epoch });
    function guard(c) { check(!disposed && (!options.isCurrent || options.isCurrent()) && c.userId && auth.user?.id === c.userId && auth.epoch === c.epoch, 'request_cancelled'); }
    async function ownerListPublished() {
      const c = context(); guard(c); const rows = await blogs.list(null); guard(c);
      const selected = rows.filter(row => row.publication?.active), result = new Array(selected.length); let cursor = 0;
      async function worker() {
        while (cursor < selected.length) {
          const index = cursor++, row = selected[index], publication = row.publication;
          token(row.id); token(publication.token); token(publication.blogToken);
          const post = await publicReader.read(publication.token); guard(c);
          if (!post || post.revision !== publication.revision || post.blogToken !== publication.blogToken) throw fault('selection_changed');
          result[index] = { remoteId: row.id, title: post.snapshot.title || '제목 없는 글', privateRevision: row.revision, publication: clone(publication) };
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, selected.length) }, worker)); guard(c); return freeze(result);
    }
    async function getState(seriesId) {
      const c = context(); guard(c); const state = await share.get(token(seriesId)); guard(c);
      return freeze({ ...state, pending: !!share.pending(seriesId) });
    }
    async function prepare(series, selections) {
      const c = context(); guard(c); const seriesId = token(series?.id);
      check(Array.isArray(series.items) && Array.isArray(selections) && selections.length > 0, 'invalid_selection');
      const requested = new Map();
      for (const value of selections) { check(value && typeof value.entryId === 'string' && !requested.has(value.entryId), 'invalid_selection'); requested.set(value.entryId, token(value.token)); }
      const current = await ownerListPublished(); guard(c); const byToken = new Map(current.map(row => [row.publication.token, row]));
      const selected = [], seen = new Set();
      for (const item of series.items) if (requested.has(item.id)) {
        const id = requested.get(item.id), row = byToken.get(id); check(row && !seen.has(id), 'invalid_selection'); seen.add(id);
        selected.push({ entryId: item.id, token: id, publicationRevision: row.publication.revision });
      }
      check(selected.length === requested.size, 'invalid_selection');
      const snapshot = dependency('BlogSeriesPublic', 'blog-series-public.js').wrapper(series.title, series.intro, selected.map(item => item.token), baseURL);
      const review = freeze({ seriesId, localRevision: Number.isSafeInteger(series.revision) ? series.revision : null, title: series.title, selected, snapshot });
      reviews.set(review, { context: c, payload: clone(review) }); return review;
    }
    async function finish(seriesId, result) {
      const state = await getState(seriesId);
      if (result.status !== 'stored') return freeze({ ...result, state, url: null });
      if (state.revision !== result.revision || state.status !== (result.published ? 'published' : 'revoked') || state.publicId !== result.publicId)
        return freeze({ status: 'conflict', state, revision: state.revision, publicId: state.publicId, url: null });
      const url = state.publicId ? new URL('series.html', baseURL) : null; if (url) url.searchParams.set('series', state.publicId);
      return freeze({ ...result, state, url: url?.href || null });
    }
    async function publish(review, { expectedRevision } = {}) {
      const known = reviews.get(review); check(known, 'invalid_selection'); guard(known.context);
      check(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0);
      const current = await ownerListPublished(); guard(known.context); const active = new Map(current.map(row => [row.publication.token, row]));
      for (const selected of known.payload.selected) check(active.get(selected.token)?.publication.revision === selected.publicationRevision, 'selection_changed');
      const result = await share.put({ workspaceId: known.payload.seriesId, expectedRevision, operationId: root.crypto.randomUUID(), action: 'publish', snapshot: known.payload.snapshot });
      guard(known.context); return finish(known.payload.seriesId, result);
    }
    async function retry(seriesId) { const c = context(); guard(c); seriesId = token(seriesId); const result = await share.retryPending(seriesId); guard(c); return finish(seriesId, result); }
    async function revoke(seriesId, { expectedRevision } = {}) {
      const c = context(); guard(c); seriesId = token(seriesId); check(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0);
      const result = await share.put({ workspaceId: seriesId, expectedRevision, operationId: root.crypto.randomUUID(), action: 'revoke', snapshot: null }); guard(c); return finish(seriesId, result);
    }
    function dispose() { if (disposed) return; disposed = true; share.dispose(); blogs.dispose(); publicReader.dispose(); }
    return Object.freeze({ ownerListPublished, getState, prepare, publish, retry, revoke, dispose });
  }
  return Object.freeze({ create });
});

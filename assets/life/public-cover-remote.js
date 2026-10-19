/* Owner-only selection of current public URL pointers. Existing targets stay independent. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).PublicCoverRemote = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const dependency = (name, file) => root.HaedoLife?.[name] || require('./' + file);
  const messages = {
    invalid_review: '표지 전체를 다시 미리 보고 공개 동의를 선택해 주세요.',
    invalid_request: '공개 표지의 선택과 저장 기준을 확인해 주세요.',
    local_changed: '표지가 바뀌었습니다. 새 미리보기를 확인하고 다시 동의해 주세요.',
    selection_changed: '선택한 공개 항목이 바뀌었거나 공개가 종료됐습니다. 목록을 다시 확인해 주세요.',
    request_cancelled: '계정이나 화면이 바뀌어 이전 공개 표지 요청을 중단했습니다.',
    pending_blocked: '미확인 게시 요청의 항목을 현재 공개 상태에서 확인하지 못했습니다. 기존 요청은 보존했습니다. 항목 상태와 표지 게시 상태를 다시 확인해 주세요.',
    pending_operation: '결과를 확인하지 못한 게시 요청이 있습니다. 현재 상태나 같은 요청을 재확인한 뒤 표지를 철회해 주세요.',
    network_error: '공개 상태를 확인하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.'
  };
  const fault = code => Object.assign(new Error(messages[code] || messages.network_error), { code });
  const check = (value, code = 'invalid_request') => { if (!value) throw fault(code); };
  const clone = value => structuredClone(value);
  const uuid = value => { check(typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)); return value.toLowerCase(); };
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const targetKey = value => value.kind + ':' + value.publicId;
  function create(options = {}) {
    const auth = options.auth || root.HaedoAuth, storage = options.storage, workspaceId = options.workspaceId;
    const model = dependency('PublicCover', 'public-cover.js'), baseURL = options.baseURL || root.location?.href;
    check(auth?.ready && auth.verify && storage?.readPublicCover && typeof workspaceId === 'string');
    let disposed = false, chain = Promise.resolve(), gate = null;
    const reviews = new WeakMap();
    const context = () => ({ userId: auth.user?.id, epoch: auth.epoch });
    function guard(c) { check(!disposed && (!options.isCurrent || options.isCurrent()) && c.userId && auth.user?.id === c.userId && auth.epoch === c.epoch, 'request_cancelled'); }
    function serial(c, action) { const result = chain.then(() => { guard(c); return action(); }); chain = result.catch(() => {}); return result; }
    const facade = {
      get ready() { return auth.ready; }, get config() { return auth.config; }, get user() { return auth.user; },
      get epoch() { return auth.epoch; }, get client() { return auth.client; },
      onAccountChange(listener) { return auth.onAccountChange?.(listener); },
      async verify() {
        const user = await auth.verify(), active = gate;
        if (active && !active.checking) {
          active.checking = true;
          try { await active.check(); } catch (error) { active.error = error; throw error; }
          finally { active.checking = false; }
        }
        return user;
      }
    };
    const share = (options.shareFactory || dependency('ShareRemote', 'share-remote.js').createOwner)({ auth: facade, storage: options.receiptStorage });
    const blogs = options.blogRemote || dependency('BlogRemote', 'blog-remote.js').create({ auth });
    const pages = options.shareReader || dependency('ShareRemote', 'share-remote.js').createReader({ config: auth.config, fetch: options.publicFetch });
    const posts = options.blogReader || dependency('BlogPublic', 'blog-public.js').createReader({ config: auth.config, fetch: options.publicFetch });
    function url(kind, publicId) {
      const [file, parameter] = { post: ['blog.html', 'post'], series: ['series.html', 'series'], nine: ['taste.html', 'nine'] }[kind] || [];
      check(file); const value = new URL(file, baseURL); value.searchParams.set(parameter, uuid(publicId)); return value.href;
    }
    function pageKind(snapshot) {
      try { model.parse(snapshot, baseURL); return null; } catch (_) { /* Covers cannot contain covers. */ }
      try { dependency('BlogSeriesPublic', 'blog-series-public.js').parseWrapper(snapshot, baseURL); return 'series'; } catch (_) { /* Try the bounded nine-compatible grammar. */ }
      try { dependency('NinePublic', 'nine-public.js').parse(snapshot); return 'nine'; } catch (_) { return null; }
    }
    async function pool(values, action) {
      const result = new Array(values.length); let cursor = 0;
      async function worker() { while (cursor < values.length) { const at = cursor++; result[at] = await action(values[at]); } }
      await Promise.all(Array.from({ length: Math.min(4, values.length) }, worker)); return result;
    }
    async function postTargets(c) {
      const rows = await blogs.list(null); guard(c); const result = new Map();
      for (const row of rows) if (row.publication?.active) {
        const publication = row.publication, publicId = uuid(publication.token); uuid(publication.blogToken);
        check(Number.isSafeInteger(publication.revision) && publication.revision > 0 && !result.has(publicId), 'selection_changed');
        result.set(publicId, { kind: 'post', publicId, publicationRevision: publication.revision, blogToken: publication.blogToken });
      }
      return result;
    }
    async function pageTargets(c, selected) {
      const found = new Map(), cursors = new Set(); let after = null;
      while (true) {
        const page = await share.list(after); guard(c);
        for (const row of page.pages) if (selected.has(row.publicId)) {
          check(!found.has(row.publicId), 'selection_changed');
          found.set(row.publicId, { publicId: row.publicId, publicationRevision: row.revision });
        }
        if (found.size === selected.size || page.nextCursor === null) return found;
        check(!cursors.has(page.nextCursor), 'selection_changed'); cursors.add(page.nextCursor); after = page.nextCursor;
      }
    }
    async function membership(c, requested) {
      const selectedPages = new Set(requested.filter(item => item.kind !== 'post').map(item => item.publicId));
      const [postMap, pageMap] = await Promise.all([
        requested.some(item => item.kind === 'post') ? postTargets(c) : new Map(),
        selectedPages.size ? pageTargets(c, selectedPages) : new Map()
      ]); guard(c);
      return requested.map(item => {
        const row = (item.kind === 'post' ? postMap : pageMap).get(item.publicId); check(row, 'selection_changed');
        return { ...row, kind: item.kind };
      });
    }
    async function resolveTarget(c, selected) {
      if (selected.kind === 'post') {
        const value = await posts.read(selected.publicId); guard(c);
        check(value && value.token === selected.publicId && value.blogToken === selected.blogToken && value.revision === selected.publicationRevision, 'selection_changed');
        return { kind: 'post', publicId: selected.publicId, title: value.snapshot.title || '제목 없는 글', intro: '',
          publicationRevision: value.revision, excerpt: dependency('PublicCoverReader', 'public-cover-reader.js').postExcerpt(value.snapshot) };
      }
      const value = await pages.read(selected.publicId); guard(c);
      check(value.status === 'published' && value.publicId === selected.publicId && value.revision === selected.publicationRevision, 'selection_changed');
      const kind = pageKind(value.snapshot);
      if (!kind && !selected.kind) return null;
      check(kind && (!selected.kind || selected.kind === kind), 'selection_changed');
      return { kind, publicId: selected.publicId, title: value.snapshot.title, intro: value.snapshot.intro || '', publicationRevision: value.revision, excerpt: '' };
    }
    function candidate(value) { const { kind, publicId, title, intro, publicationRevision } = value; return { kind, publicId, title, intro, publicationRevision }; }
    function publicItem(value) { return { kind: value.kind, publicId: value.publicId, key: 'cover-entry-' + value.kind + '-' + value.publicId,
      status: 'published', title: value.title, intro: value.intro, excerpt: value.excerpt, url: url(value.kind, value.publicId) }; }
    function errorRow(error, kind, publicId = null) {
      return { kind, publicId, code: typeof error?.code === 'string' ? error.code : 'network_error', message: '이 공개 항목을 확인하지 못했습니다. 목록을 다시 확인해 주세요.' };
    }
    function catalog({ after = null } = {}) {
      const c = context(); if (after !== null) after = uuid(after);
      return serial(c, async () => {
        const errors = [], selections = []; let nextCursor = null;
        const lists = await Promise.allSettled([after === null ? postTargets(c) : Promise.resolve(new Map()), share.list(after)]); guard(c);
        if (lists[0].status === 'fulfilled') selections.push(...lists[0].value.values()); else errors.push(errorRow(lists[0].reason, 'post'));
        if (lists[1].status === 'fulfilled') {
          nextCursor = lists[1].value.nextCursor;
          selections.push(...lists[1].value.pages.map(row => ({ publicId: row.publicId, publicationRevision: row.revision })));
        } else errors.push(errorRow(lists[1].reason, 'pages'));
        const items = await pool(selections, async value => {
          try { const resolved = await resolveTarget(c, value); return resolved ? candidate(resolved) : null; }
          catch (error) { guard(c); errors.push(errorRow(error, value.kind || 'pages', value.publicId)); return null; }
        }); guard(c);
        return freeze({ items: items.filter(Boolean), errors, nextCursor });
      });
    }
    async function local(c, coverId) {
      const state = await storage.readPublicCover(workspaceId); guard(c); model.validateState(state); check(state.workspaceId === workspaceId, 'local_changed');
      const cover = state.covers.find(value => value.id === coverId); check(cover, 'local_changed'); return { state, cover };
    }
    async function selected(c, items) { return pool(await membership(c, items), value => resolveTarget(c, value)); }
    async function fresh(known) {
      guard(known.context); const current = await selected(known.context, known.review.cover.items); guard(known.context);
      check(current.every((value, index) => value.publicationRevision === known.review.targets[index].publicationRevision), 'selection_changed');
      const actual = await local(known.context, known.review.coverId);
      check(actual.state.revision === known.review.localRevision && same(actual.cover, known.review.cover), 'local_changed');
    }
    function prepare(coverId) {
      const c = context(); coverId = uuid(coverId);
      return serial(c, async () => {
        const value = await local(c, coverId), cover = clone(value.cover), snapshot = model.project(cover, baseURL);
        const targets = await selected(c, cover.items); guard(c);
        const after = await local(c, coverId); check(after.state.revision === value.state.revision && same(after.cover, cover), 'local_changed');
        const preview = { status: 'published', publicId: null, revision: 0, title: cover.title, intro: cover.intro || null, items: targets.map(publicItem) };
        const review = freeze({ coverId, localRevision: value.state.revision, cover, snapshot, targets: targets.map(candidate), preview });
        reviews.set(review, { context: c, review }); return review;
      });
    }
    async function state(coverId, c) { guard(c); const value = await share.get(coverId); guard(c); return freeze({ ...value, pending: !!share.pending(coverId) }); }
    function getState(coverId) { const c = context(); coverId = uuid(coverId); return serial(c, () => state(coverId, c)); }
    async function finish(coverId, result, c) {
      const current = await state(coverId, c);
      if (result.status !== 'stored') return freeze({ ...result, state: current, url: null });
      if (current.revision !== result.revision || current.status !== (result.published ? 'published' : 'revoked') || current.publicId !== result.publicId || current.lastOperationId === null)
        return freeze({ status: 'conflict', revision: current.revision, publicId: current.publicId, state: current, url: null });
      const address = current.publicId ? new URL('cover.html', baseURL) : null; if (address) address.searchParams.set('cover', current.publicId);
      return freeze({ ...result, state: current, url: address?.href || null });
    }
    async function gated(checkFresh, action) {
      const active = { check: checkFresh, checking: false, error: null }; gate = active;
      try { return await action(); } catch (error) { throw active.error || error; }
      finally { gate = null; }
    }
    function publish(review, { expectedRevision } = {}) {
      const known = reviews.get(review); check(known, 'invalid_review'); reviews.delete(review);
      check(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0); guard(known.context);
      return serial(known.context, async () => {
        await fresh(known);
        const result = await gated(() => fresh(known), () => share.put({ workspaceId: review.coverId, expectedRevision,
          operationId: root.crypto.randomUUID(), action: 'publish', snapshot: review.snapshot }));
        guard(known.context); return finish(review.coverId, result, known.context);
      });
    }
    function retry(coverId) {
      const c = context(); coverId = uuid(coverId);
      return serial(c, async () => {
        const pending = share.pending(coverId); check(pending);
        if (pending.action === 'publish') model.parse(pending.snapshot, baseURL);
        await share.get(coverId); guard(c);
        // Retry only the approved URL-only request. Withdrawn targets remain
        // missing to visitors; they must not prevent resolving a cover receipt.
        const result = await share.retryPending(coverId);
        guard(c); return finish(coverId, result, c);
      });
    }
    function revoke(coverId, { expectedRevision } = {}) {
      const c = context(); coverId = uuid(coverId); check(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0);
      return serial(c, async () => {
        check(!share.pending(coverId), 'pending_operation');
        const result = await share.put({ workspaceId: coverId, expectedRevision, operationId: root.crypto.randomUUID(), action: 'revoke', snapshot: null });
        guard(c); return finish(coverId, result, c);
      });
    }
    function dispose() { if (disposed) return; disposed = true; share.dispose(); blogs.dispose?.(); pages.dispose?.(); posts.dispose?.(); }
    return Object.freeze({ catalog, prepare, publish, getState, retry, revoke, dispose });
  }
  return Object.freeze({ create });
});

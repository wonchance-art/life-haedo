/* Selected nine-area snapshots use existing page CAS and durable receipts. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).NinePublicRemote = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const dependency = (name, file) => root.HaedoLife?.[name] || require('./' + file);
  const messages = { local_changed: '9칸 구성이 바뀌었습니다. 새 미리보기를 확인하고 다시 동의해 주세요.',
    invalid_review: '새 미리보기를 확인하고 공개 동의를 선택해 주세요.', request_cancelled: '계정 또는 화면이 바뀌어 이전 요청을 중단했습니다.',
    invalid_request: '공개할 영역과 저장 기준을 확인해 주세요.', publication_changed: '공개된 9칸이 바뀌었습니다. 현재 공개 상태를 다시 확인해 주세요.' };
  const fault = code => Object.assign(new Error(messages[code] || messages.invalid_request), { code });
  const check = (value, code = 'invalid_request') => { if (!value) throw fault(code); };
  const uuid = value => { check(typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)); return value.toLowerCase(); };
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  function create(options = {}) {
    const auth = options.auth || root.HaedoAuth, storage = options.storage, workspaceId = options.workspaceId, model = dependency('NinePublic', 'nine-public.js');
    check(auth?.ready && typeof auth.verify === 'function' && storage?.readNineBoard && typeof workspaceId === 'string');
    const baseURL = options.baseURL || root.location?.href;
    let disposed = false, chain = Promise.resolve(), gate = null, publicReader = null;
    const reviews = new WeakMap();
    const context = () => ({ userId: auth.user?.id, epoch: auth.epoch });
    function guard(c) { check(!disposed && (!options.isCurrent || options.isCurrent()) && c.userId && auth.user?.id === c.userId && auth.epoch === c.epoch, 'request_cancelled'); }
    function serial(task) { const result = chain.then(task); chain = result.catch(() => {}); return result; }
    async function fresh(known) {
      guard(known.context); const current = await storage.readNineBoard(workspaceId); guard(known.context);
      check(current.workspaceId === workspaceId && current.revision === known.review.localRevision, 'local_changed');
      let projected; try { projected = model.project(current, known.options); } catch (_) { throw fault('local_changed'); }
      check(same(projected, known.review), 'local_changed');
    }
    // Only this adapter's new publish operation installs a gate. Shared Auth is
    // untouched. The gate runs after verified Auth returns and before the
    // existing ShareRemote can persist or dispatch its request.
    const facade = {
      get ready() { return auth.ready; }, get config() { return auth.config; }, get user() { return auth.user; },
      get epoch() { return auth.epoch; }, get client() { return auth.client; },
      onAccountChange(listener) { return auth.onAccountChange?.(listener); },
      async verify() { const value = await auth.verify(); if (gate) { try { await fresh(gate.known); } catch (error) { gate.error = error; throw error; } } return value; }
    };
    const share = dependency('ShareRemote', 'share-remote.js').createOwner({ auth: facade, storage: options.receiptStorage });
    async function state(areaId, c) { guard(c); const value = await share.get(areaId); guard(c); return freeze({ ...value, pending: !!share.pending(areaId) }); }
    async function finish(areaId, result, c) {
      const current = await state(areaId, c);
      if (result.status !== 'stored') return freeze({ ...result, state: current, url: null });
      if (current.revision !== result.revision || current.status !== (result.published ? 'published' : 'revoked') || current.publicId !== result.publicId)
        return freeze({ status: 'conflict', revision: current.revision, publicId: current.publicId, state: current, url: null });
      const url = current.publicId ? new URL('taste.html', baseURL) : null; if (url) url.searchParams.set('nine', current.publicId);
      return freeze({ ...result, state: current, url: url?.href || null });
    }
    async function prepare(input) {
      const c = context(); guard(c); const selection = structuredClone(input); uuid(selection?.areaId);
      const current = await storage.readNineBoard(workspaceId); guard(c); check(current.workspaceId === workspaceId);
      const review = model.project(current, selection); reviews.set(review, { context: c, options: selection, review }); return review;
    }
    function getState(areaId) { const c = context(); areaId = uuid(areaId); return serial(() => state(areaId, c)); }
    function getPublished(areaId) {
      const c = context(); areaId = uuid(areaId);
      return serial(async () => {
        const before = await state(areaId, c);
        if (before.status !== 'published') return freeze({ state: before, snapshot: null });
        publicReader ||= dependency('ShareRemote', 'share-remote.js').createReader({ config: auth.config, fetch: options.publicFetch });
        let value; try { value = await publicReader.read(before.publicId); } catch (error) { guard(c); throw error; } guard(c);
        check(value.status === 'published' && value.publicId === before.publicId && value.revision === before.revision, 'publication_changed');
        model.parse(value.snapshot);
        const after = await state(areaId, c); guard(c);
        check(after.status === 'published' && after.publicId === before.publicId && after.revision === before.revision, 'publication_changed');
        return freeze({ state: after, snapshot: value.snapshot });
      });
    }
    function publish(review, { expectedRevision } = {}) {
      const known = reviews.get(review); check(known, 'invalid_review'); reviews.delete(review);
      check(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0); guard(known.context);
      return serial(async () => {
        await fresh(known); const activeGate = { known, error: null }; gate = activeGate;
        let result;
        try { result = await share.put({ workspaceId: uuid(review.areaId), expectedRevision, operationId: root.crypto.randomUUID(), action: 'publish', snapshot: review.snapshot }); }
        catch (error) { throw activeGate.error || error; }
        finally { gate = null; }
        guard(known.context); return finish(review.areaId, result, known.context);
      });
    }
    function retry(areaId) { const c = context(); areaId = uuid(areaId); return serial(async () => { guard(c); const result = await share.retryPending(areaId); guard(c); return finish(areaId, result, c); }); }
    function revoke(areaId, { expectedRevision } = {}) {
      const c = context(); areaId = uuid(areaId); check(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0);
      return serial(async () => { guard(c); const result = await share.put({ workspaceId: areaId, expectedRevision, operationId: root.crypto.randomUUID(), action: 'revoke', snapshot: null }); guard(c); return finish(areaId, result, c); });
    }
    function dispose() { if (disposed) return; disposed = true; share.dispose(); publicReader?.dispose(); }
    return Object.freeze({ prepare, getState, getPublished, publish, retry, revoke, dispose });
  }
  return Object.freeze({ create });
});

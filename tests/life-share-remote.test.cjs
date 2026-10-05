const test = require('node:test');
const assert = require('node:assert/strict');
const remote = require('../assets/life/share-remote.js');
const config = { url: 'https://anonymous-fixture.supabase.co', key: 'sb_publishable_fixture' };
const ids = { a: '11111111-1111-4111-8111-111111111111', b: '22222222-2222-4222-8222-222222222222',
  workspace: '33333333-3333-4333-8333-333333333333', operation: '44444444-4444-4444-8444-444444444444', public: '55555555-5555-4555-8555-555555555555' };
const snapshot = () => ({ format: 'life-share-v1', title: '익명 게시 검증', intro: null, entries: [] });
const request = () => ({ workspaceId: ids.workspace, expectedRevision: 0, operationId: ids.operation, action: 'publish', snapshot: snapshot() });
const stored = () => ({ status: 'stored', revision: 1, publicId: ids.public, published: true, updatedAt: '2026-10-05T00:00:00.000Z', action: 'publish' });
const metadata = () => ({ status: 'published', revision: 1, publicId: ids.public, updatedAt: '2026-10-05T00:00:00.000Z', lastOperationId: ids.operation });
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(backing = new Map()) {
  const listeners = new Set(), requests = [], signals = [];
  let next = null, verified = 0, sdkDisposed = 0;
  const storage = { getItem: key => backing.get(key) ?? null, setItem: (key, value) => backing.set(key, value), removeItem: key => backing.delete(key) };
  const auth = { ready: true, config, epoch: 0, user: { id: ids.a }, async verify() { verified++; return auth.user; },
    onAccountChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    client: { auth: { dispose() { sdkDisposed++; } }, rpc(name, args) {
      requests.push({ name, args: JSON.parse(JSON.stringify(args)) });
      const task = next; next = null;
      return { abortSignal(signal) { signals.push(signal); return this; }, then(resolve, reject) {
        return (task ? task() : Promise.resolve({ data: name.endsWith('_get') ? metadata() : stored(), error: null })).then(resolve, reject);
      } };
    } } };
  return { backing, storage, auth, requests, signals, owner: remote.createOwner({ auth, storage }),
    change(id) { auth.epoch++; auth.user = id ? { id } : null; for (const listener of listeners) listener(id ? { userId: id } : null); },
    setNext(task) { next = task; }, get verified() { return verified; }, get sdkDisposed() { return sdkDisposed; }, get listeners() { return listeners.size; } };
}

test('owner borrows the verified SDK, stores before dispatch and clears only a definitive result', async () => {
  const f = fixture(); f.setNext(async () => { assert.equal(f.backing.size, 1); return { data: stored(), error: null }; });
  assert.equal((await f.owner.put(request())).status, 'stored');
  assert.equal(f.verified, 1); assert.equal(f.owner.pending(ids.workspace), null);
  assert.equal(f.requests[0].name, 'life_public_page_put');
  assert.equal(f.requests[0].args.p_operation_id, ids.operation);
  assert.equal((await f.owner.get(ids.workspace)).lastOperationId, ids.operation);
  f.owner.dispose(); assert.equal(f.sdkDisposed, 0); assert.equal(f.listeners, 0);
});

test('unknown outcome survives same-tab reload and retries the identical UUID, revision and copy', async () => {
  const first = fixture(); first.setNext(async () => { throw new TypeError('simulated transport failure'); });
  const input = request(), pending = first.owner.put(input); input.snapshot.title = '후속 편집';
  await assert.rejects(pending, { code: 'publish_unknown' });
  const saved = first.owner.pending(ids.workspace);
  assert.equal(saved.snapshot.title, '익명 게시 검증');
  saved.snapshot.title = '호출자 사본 수정'; assert.equal(first.owner.pending(ids.workspace).snapshot.title, '익명 게시 검증');
  await assert.rejects(first.owner.put({ ...request(), operationId: ids.b }), { code: 'pending_operation' });
  assert.equal(first.requests.length, 1); first.owner.dispose();
  const second = fixture(first.backing); const result = await second.owner.retryPending(ids.workspace);
  assert.equal(result.status, 'stored'); assert.deepEqual(second.requests[0], first.requests[0]);
  assert.equal(second.owner.pending(ids.workspace), null); second.owner.dispose();
});

test('failure to persist an attempt blocks transmission and never overwrites an unresolved operation', async () => {
  const f = fixture(); f.storage.setItem = () => { throw new Error('quota'); };
  await assert.rejects(f.owner.put(request()), { code: 'pending_storage_failed' });
  assert.equal(f.requests.length, 0); f.owner.dispose();
});

test('account changes abort old writes, ignore late success and isolate pending state', async () => {
  const f = fixture(); let finish;
  f.setNext(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.owner.put(request()); await tick();
  const rejected = assert.rejects(pending, { code: 'request_cancelled' }); f.change(ids.b);
  assert.equal(f.signals[0].aborted, true); assert.equal(f.owner.pending(ids.workspace), null);
  finish({ data: stored(), error: null }); await rejected;
  f.change(ids.a); assert.equal(f.owner.pending(ids.workspace).operationId, ids.operation);
  f.owner.dispose();
});

test('stale owner verification cannot dispatch after account switching or disposal', async () => {
  for (const mode of ['switch', 'dispose']) {
    const f = fixture(); let finish; f.auth.verify = () => new Promise(resolve => { finish = resolve; });
    const pending = f.owner.put(request()), rejected = assert.rejects(pending, { code: 'request_cancelled' });
    if (mode === 'switch') f.change(ids.b); else f.owner.dispose();
    finish({ id: ids.a }); await rejected; assert.equal(f.requests.length, 0); assert.equal(f.backing.size, 0); f.owner.dispose();
  }
});

test('conflict is definitive while malformed success preserves the pending attempt', async () => {
  const f = fixture(); f.setNext(async () => ({ data: { status: 'stored', revision: 1 }, error: null }));
  await assert.rejects(f.owner.put(request()), { code: 'publish_unknown' });
  assert(f.owner.pending(ids.workspace));
  f.setNext(async () => ({ data: { status: 'conflict', revision: 7 }, error: null }));
  assert.deepEqual(await f.owner.retryPending(ids.workspace), { status: 'conflict', revision: 7 });
  assert.equal(f.owner.pending(ids.workspace), null); f.owner.dispose();
});

test('proven validation rollback or absent RPC permits a corrected attempt; operation mismatch remains unresolved', async () => {
  for (const [error, code] of [[{ code: '22023', message: 'life_share_invalid_snapshot' }, 'invalid_snapshot'],
    [{ code: '22023', message: 'life_share_invalid_request' }, 'invalid_request'], [{ code: 'PGRST202' }, 'schema_missing']]) {
    const f = fixture(); f.setNext(async () => ({ data: null, error }));
    await assert.rejects(f.owner.put(request()), { code }); assert.equal(f.owner.pending(ids.workspace), null);
    assert.equal((await f.owner.put({ ...request(), operationId: ids.b })).status, 'stored'); f.owner.dispose();
  }
  const f = fixture(); f.setNext(async () => ({ data: null, error: { code: '22023', message: 'life_share_operation_mismatch' } }));
  await assert.rejects(f.owner.put(request()), { code: 'operation_mismatch' });
  assert.equal(f.owner.pending(ids.workspace).operationId, ids.operation); f.owner.dispose();
});

test('revoke uses an explicit empty snapshot and owner metadata distinguishes revoked from missing', async () => {
  const f = fixture(); f.setNext(async () => ({ data: { ...stored(), publicId: null, published: false, action: 'revoke' }, error: null }));
  const result = await f.owner.put({ ...request(), action: 'revoke', snapshot: null });
  assert.equal(result.published, false); assert.equal(f.requests[0].args.p_snapshot, null);
  f.setNext(async () => ({ data: { ...metadata(), status: 'revoked', publicId: null }, error: null }));
  assert.equal((await f.owner.get(ids.workspace)).status, 'revoked');
  f.setNext(async () => ({ data: { status: 'missing', revision: 0, publicId: null, updatedAt: null, lastOperationId: null }, error: null }));
  assert.equal((await f.owner.get(ids.workspace)).status, 'missing'); f.owner.dispose();
});

test('owner listing can find a published workspace absent from this browser without fetching its snapshot', async () => {
  const f = fixture(), row = { workspaceId: ids.workspace, title: '다른 기기에서 게시한 페이지',
    revision: 1, publicId: ids.public, updatedAt: metadata().updatedAt, lastOperationId: ids.operation };
  f.setNext(async () => ({ data: { pages: [row], nextCursor: ids.workspace }, error: null }));
  assert.deepEqual(await f.owner.list(), { pages: [row], nextCursor: ids.workspace });
  assert.deepEqual(f.requests[0], { name: 'life_public_page_list', args: { p_after: null } });
  f.setNext(async () => ({ data: { pages: [], nextCursor: null }, error: null }));
  assert.deepEqual(await f.owner.list(ids.workspace), { pages: [], nextCursor: null });
  f.setNext(async () => ({ data: { pages: [{ ...row, snapshot: snapshot() }], nextCursor: null }, error: null }));
  await assert.rejects(f.owner.list(), { code: 'invalid_remote_data' });
  assert.equal(f.verified, 3); f.owner.dispose();
});

test('anonymous reader sends only its public key with no cookies, bearer token, referrer or cache', async () => {
  let sent;
  const reader = remote.createReader({ config, fetch: async (url, options) => {
    sent = { url, options }; return new Response(JSON.stringify({ status: 'published', publicId: ids.public, revision: 1,
      updatedAt: '2026-10-05T00:00:00.000Z', snapshot: snapshot() }), { status: 200 });
  } });
  assert.equal((await reader.read(ids.public)).snapshot.title, '익명 게시 검증');
  assert.equal(sent.url, config.url + '/rest/v1/rpc/life_public_page_read');
  const headers = new Headers(sent.options.headers); assert.equal(headers.get('apikey'), config.key);
  assert.equal(headers.get('authorization'), null); assert.equal(sent.options.credentials, 'omit');
  assert.equal(sent.options.cache, 'no-store'); assert.equal(sent.options.redirect, 'error'); assert.equal(sent.options.referrerPolicy, 'no-referrer');
  assert.deepEqual(JSON.parse(sent.options.body), { p_public_id: ids.public }); reader.dispose();
});

test('visitor rejects extra private fields, another token response and unsafe configuration', async () => {
  for (const mutate of [value => value.owner_id = ids.a, value => value.publicId = ids.b, value => value.snapshot.workspaceId = ids.workspace]) {
    const value = { status: 'published', publicId: ids.public, revision: 1, updatedAt: '2026-10-05T00:00:00.000Z', snapshot: snapshot() }; mutate(value);
    const reader = remote.createReader({ config, fetch: async () => new Response(JSON.stringify(value)) });
    await assert.rejects(reader.read(ids.public), { code: 'invalid_remote_data' }); reader.dispose();
  }
  assert.throws(() => remote.createReader({ config: { ...config, key: 'sb_secret_forbidden' } }), { code: 'invalid_config' });
  assert.throws(() => remote.createReader({ config: { ...config, url: 'https://u:p@example.org' } }), { code: 'invalid_config' });
});

test('late visitor response after disposal cannot become a visible published page', async () => {
  let finish, signal;
  const reader = remote.createReader({ config, fetch: async (_url, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); } });
  const pending = reader.read(ids.public), rejected = assert.rejects(pending, { code: 'request_cancelled' });
  reader.dispose(); assert.equal(signal.aborted, true);
  finish(new Response(JSON.stringify({ status: 'missing' }))); await rejected;
});

test('valid uppercase visitor UUID normalizes to PostgreSQL canonical UUID form', async () => {
  const id = 'abcdef12-3456-4789-abcd-0123456789ef'; let sent;
  const reader = remote.createReader({ config, fetch: async (_url, options) => {
    sent = JSON.parse(options.body).p_public_id;
    return new Response(JSON.stringify({ status: 'published', publicId: id, revision: 1,
      updatedAt: '2026-10-05T00:00:00.000Z', snapshot: snapshot() }));
  } });
  assert.equal((await reader.read(id.toUpperCase())).publicId, id); assert.equal(sent, id); reader.dispose();
});

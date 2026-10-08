'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Remote = require('../assets/life/composition-remote.js');
const Workbench = require('../assets/life/workbench.js');
const Platform = require('../assets/platform-life-remote.js');
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OP = '33333333-3333-4333-8333-333333333333';
const config = { url: 'https://composition-fixture.supabase.co', key: 'sb_publishable_anonymous_fixture' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const row = () => ({ workspace_id: ID, revision: 1, source_revision: 2, updated_at: '2026-10-06T00:00:00Z', data: Workbench.empty(ID) });
const request = () => ({ workspaceId: ID, expectedRevision: 0, operationId: OP, sourceRevision: 2, data: Workbench.empty(ID) });
function fixture() {
  const state = { authCalls: 0, calls: [], disposed: 0, authResult: { data: { user: { id: ID } }, error: null }, result: { data: row(), error: null } };
  const auth = { ready: true, config };
  const clientFactory = (provided, options) => {
    assert.equal(provided, auth); assert.deepEqual(options, { scope: 'composition' });
    return (url, key) => {
      assert.equal(url, config.url); assert.equal(key, config.key);
      return { auth: { async getUser() { state.authCalls++; return state.authPending || state.authResult; }, dispose() { state.disposed++; } },
        async rpc(name, params) { state.calls.push({ name, params }); return state.pending || state.result; } };
    };
  };
  return { state, adapter: Remote.create({ auth, workbench: Workbench, clientFactory }) };
}

test('composition reads verify shared account, preserve fixed versions and detach returned data', async () => {
  const { state, adapter } = fixture();
  const result = await adapter.read(ID);
  assert.equal(state.authCalls, 1); assert.deepEqual(state.calls, [{ name: 'life_composition_get', params: { p_workspace_id: ID } }]);
  assert.deepEqual(result, state.result.data); result.data.page.title = 'caller change';
  assert.notEqual(result.data.page.title, state.result.data.data.page.title);
  state.result.data = null; assert.equal(await adapter.read(ID), null); adapter.dispose();
});

test('malformed remote identity, revision, time and composition never install', async () => {
  const { state, adapter } = fixture();
  for (const mutate of [value => { value.workspace_id = OTHER; }, value => { value.revision = '1'; },
    value => { value.source_revision = 0; }, value => { value.updated_at = 'invalid'; },
    value => { value.data.workspaceId = OTHER; }, value => { value.data.page.untrusted = true; },
    value => { value.data.page.title = '\ud800'; }]) {
    state.result.data = row(); mutate(state.result.data);
    await assert.rejects(adapter.read(ID), { code: 'invalid_remote_data' });
  }
  adapter.dispose();
});

test('invalid requests and oversized compositions are rejected before network access', async () => {
  const { state, adapter } = fixture();
  for (const overrides of [{ workspaceId: 'no' }, { operationId: 'no' }, { expectedRevision: -1 }, { sourceRevision: 0 }, { sourceRevision: 1.5 }]) {
    await assert.rejects(adapter.write({ ...request(), ...overrides }), { code: 'invalid_request' });
  }
  await assert.rejects(adapter.read('no'), { code: 'invalid_request' });
  const data = Workbench.empty(ID);
  for (let index = 0; index < 60; index++) data.page.entries.push({ id: 'entry_' + index, title: '익명', parts: [], note: '한'.repeat(20000), enabled: true, pinned: false, showBody: true, showNote: true });
  await assert.rejects(adapter.write({ ...request(), data }), { code: 'payload_too_large' });
  assert.equal(state.calls.length, 0); assert.equal(state.authCalls, 0); adapter.dispose();
});

test('write freezes scalar identity and content before awaiting account verification', async () => {
  const { state, adapter } = fixture(), waiting = deferred(), input = request();
  state.authPending = waiting.promise; state.result = { data: { status: 'stored', revision: 1 }, error: null };
  const pending = adapter.write(input);
  input.workspaceId = OTHER; input.operationId = OTHER; input.expectedRevision = 50; input.sourceRevision = 60; input.data.page.title = 'mutated';
  waiting.resolve(state.authResult); assert.deepEqual(await pending, { status: 'stored', revision: 1 });
  assert.deepEqual(state.calls[0], { name: 'life_composition_put', params: { p_workspace_id: ID, p_expected_revision: 0, p_operation_id: OP, p_source_revision: 2, p_data: Workbench.empty(ID) } });
  adapter.dispose();
});

test('CAS conflict and missing stay distinct from stored; malformed replies reject', async () => {
  const { state, adapter } = fixture();
  for (const result of [{ status: 'stored', revision: 1 }, { status: 'conflict', revision: 4 }, { status: 'missing' }]) {
    state.result = { data: result, error: null }; assert.deepEqual(await adapter.write(request()), result);
  }
  for (const result of [{ status: 'stored', revision: 0 }, { status: 'conflict', revision: '2' }, { status: 'unknown', revision: 1 }, null]) {
    state.result = { data: result, error: null }; await assert.rejects(adapter.write(request()), { code: 'invalid_remote_data' });
  }
  adapter.dispose();
});

test('schema, source floor, permissions and network errors redact private diagnostics', async () => {
  const { state, adapter } = fixture();
  for (const [error, code] of [[{ code: 'PGRST202', message: 'private SQL token' }, 'schema_missing'],
    [{ code: '42501', message: 'private owner identity' }, 'permission_denied'],
    [{ message: 'life_composition_source_not_ready' }, 'composition_source_pending'],
    [{ message: 'life_composition_operation_mismatch' }, 'operation_mismatch'],
    [{ status: 401, message: 'private bearer' }, 'auth_required'],
    [{ name: 'AbortError', message: 'private URL' }, 'request_cancelled'],
    [{ message: 'private key transport trace' }, 'network_error']]) {
    state.result = { error, data: null };
    await assert.rejects(adapter.read(ID), failure => failure.code === code && !failure.message.includes('private'));
  }
  state.authResult = { data: { user: null }, error: null }; const calls = state.calls.length;
  await assert.rejects(adapter.write(request()), { code: 'auth_required' }); assert.equal(state.calls.length, calls); adapter.dispose();
});

test('disposing cancels late replies and releases only borrowed transport', async () => {
  const { state, adapter } = fixture(), waiting = deferred(); state.pending = waiting.promise;
  const pending = adapter.read(ID); await new Promise(resolve => setImmediate(resolve));
  adapter.dispose(); adapter.dispose(); waiting.resolve({ data: row(), error: null });
  await assert.rejects(pending, { code: 'request_cancelled' }); assert.equal(state.disposed, 1);
});

function sharedFixture() {
  const listeners = new Set(), state = { calls: [], disposedAuth: 0, signals: [], result: { data: row(), error: null } };
  const auth = { ready: true, config, user: { id: ID }, epoch: 0,
    async verify() { return auth.user; }, async signOut() { throw new Error('Composition must not sign out shared auth'); },
    client: { auth: { onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } }; }, dispose() { state.disposedAuth++; } },
      from() { throw new Error('Composition must not read tables'); },
      rpc(name, params) { state.calls.push({ name, params }); return { abortSignal(signal) { state.signals.push(signal); return this; }, then(resolve, reject) { return (state.pending || Promise.resolve(state.result)).then(resolve, reject); } }; } } };
  return { auth, state, change() { auth.epoch++; auth.user = { id: OTHER }; for (const listener of listeners) listener('SIGNED_IN', { user: auth.user }); }, get listenerCount() { return listeners.size; } };
}

test('platform composition scope admits only private composition RPCs and no direct tables', async () => {
  const shared = sharedFixture(), client = Platform.clientFactory(shared.auth, { scope: 'composition' })(config.url, config.key);
  for (const name of ['life_sync_put', 'life_public_page_put', 'life_public_page_read']) assert.throws(() => client.rpc(name, {}), { code: 'invalid_request' });
  for (const table of ['life_workspaces', 'life_compositions']) assert.throws(() => client.from(table), { code: 'invalid_request' });
  await client.rpc('life_composition_get', { p_workspace_id: ID });
  const originals = Platform.clientFactory(shared.auth)(config.url, config.key);
  assert.throws(() => originals.rpc('life_composition_put', {}), { code: 'invalid_request' });
  await assert.rejects(client.auth.signInWithPassword(), { code: 'auth_required' });
  client.auth.dispose(); originals.auth.dispose(); assert.equal(shared.listenerCount, 0); assert.equal(shared.state.disposedAuth, 0);
});

test('platform account switch rejects late composition read and write responses', async () => {
  for (const method of ['read', 'write']) {
    const shared = sharedFixture(), waiting = deferred(); shared.state.pending = waiting.promise;
    const adapter = Remote.create({ auth: shared.auth, workbench: Workbench, clientFactory: Platform.clientFactory });
    const pending = method === 'read' ? adapter.read(ID) : adapter.write(request());
    await new Promise(resolve => setImmediate(resolve)); shared.change();
    assert.equal(shared.state.signals[0].aborted, true);
    waiting.resolve({ data: method === 'read' ? row() : { status: 'stored', revision: 1 }, error: null });
    await assert.rejects(pending, { code: 'request_cancelled' }); adapter.dispose();
    assert.equal(shared.state.disposedAuth, 0); assert.equal(shared.auth.user.id, OTHER);
  }
});

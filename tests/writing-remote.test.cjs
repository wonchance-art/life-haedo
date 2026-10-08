'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Remote = require('../assets/life/writing-remote.js');
const Writing = require('../assets/life/writing.js');
const Platform = require('../assets/platform-life-remote.js');
const ID = '11111111-1111-4111-8111-111111111111';
const DRAFT = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const OP = '44444444-4444-4444-8444-444444444444';
const config = { url: 'https://writing-fixture.supabase.co', key: 'sb_publishable_anonymous_fixture' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const data = () => ({ kind: 'writing', format: Writing.FORMAT, stageId: DRAFT, workspaceId: ID, revision: 3, state: 'draft', sourceId: null, baseSourceRevision: null, baseSourceVersionId: null, title: '산책 후 다시 쓰는 생각', text: '기록을 모으면서 다시 알아차린 작은 변화. 🌱', createdAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T00:01:00Z' });
const row = () => ({ workspace_id: ID, draft_id: DRAFT, revision: 1, source_revision: 2, updated_at: '2026-10-06T00:02:00Z', data: data() });
const request = () => ({ workspaceId: ID, draftId: DRAFT, expectedRevision: 0, operationId: OP, sourceRevision: 2, data: data() });
const summary = () => ({ draft_id: DRAFT, title: '산책 후 다시 쓰는 생각', state: 'draft', revision: 1, updated_at: '2026-10-06T00:02:00Z' });
function fixture() {
  const state = { authCalls: 0, calls: [], disposed: 0, authResult: { data: { user: { id: ID } }, error: null }, result: { data: row(), error: null } };
  const auth = { ready: true, config };
  const clientFactory = (provided, options) => {
    assert.equal(provided, auth); assert.deepEqual(options, { scope: 'writing' });
    return (url, key) => {
      assert.equal(url, config.url); assert.equal(key, config.key);
      return { auth: { async getUser() { state.authCalls++; return state.authPending || state.authResult; }, dispose() { state.disposed++; } }, async rpc(name, params) { state.calls.push({ name, params }); return state.pending || state.result; } };
    };
  };
  return { state, adapter: Remote.create({ auth, writing: Writing, clientFactory }) };
}
test('selected draft read verifies shared account and returns a detached exact identity', async () => {
  const { state, adapter } = fixture(); const result = await adapter.read(ID, DRAFT);
  assert.equal(state.authCalls, 1); assert.deepEqual(state.calls, [{ name: 'life_writing_draft_get', params: { p_workspace_id: ID, p_draft_id: DRAFT } }]);
  assert.deepEqual(result, state.result.data); result.data.text = 'caller change'; assert.notEqual(state.result.data.data.text, result.data.text);
  state.result.data = null; assert.equal(await adapter.read(ID, DRAFT), null); adapter.dispose();
});
test('malformed identities, revision, encoding and draft payload never install', async () => {
  const { state, adapter } = fixture();
  for (const mutate of [value => { value.workspace_id = OTHER; }, value => { value.draft_id = OTHER; }, value => { value.revision = '1'; }, value => { value.source_revision = 0; }, value => { value.updated_at = 'invalid'; }, value => { value.data.stageId = OTHER; }, value => { value.data.workspaceId = OTHER; }, value => { value.data.untrusted = true; }, value => { value.data.text = '\ud800'; }]) {
    state.result.data = row(); mutate(state.result.data); await assert.rejects(adapter.read(ID, DRAFT), { code: 'invalid_remote_data' });
  }
  adapter.dispose();
});
test('writing list sends a bounded cursor and rejects duplicate, unordered or invalid rows', async () => {
  const { state, adapter } = fixture(); state.result = { data: [summary()], error: null };
  assert.deepEqual(await adapter.list(ID), [summary()]); assert.deepEqual(state.calls[0], { name: 'life_writing_draft_list', params: { p_workspace_id: ID, p_after_draft_id: null } });
  state.result.data = [{ ...summary(), draft_id: OTHER }]; assert.equal((await adapter.list(ID, DRAFT))[0].draft_id, OTHER); assert.equal(state.calls[1].params.p_after_draft_id, DRAFT);
  for (const result of [[summary(), summary()], [{ ...summary(), state: 'import' }], [{ ...summary(), revision: 0 }], [{ ...summary(), updated_at: 'no' }], [{ ...summary(), title: '\ud800' }], Array.from({ length: 101 }, () => summary())]) {
    state.result.data = result; await assert.rejects(adapter.list(ID), { code: 'invalid_remote_data' });
  }
  state.result.data = [summary()]; await assert.rejects(adapter.list(ID, DRAFT), { code: 'invalid_remote_data' });
  adapter.dispose();
});
test('invalid request and oversized body are blocked before account or network access', async () => {
  const { state, adapter } = fixture();
  for (const override of [{ workspaceId: 'bad' }, { draftId: 'bad' }, { operationId: 'bad' }, { expectedRevision: -1 }, { sourceRevision: 0 }, { sourceRevision: 1.5 }]) await assert.rejects(adapter.write({ ...request(), ...override }), { code: 'invalid_request' });
  await assert.rejects(adapter.read(ID, 'bad'), { code: 'invalid_request' }); await assert.rejects(adapter.list(ID, 'bad'), { code: 'invalid_request' });
  await assert.rejects(adapter.write({ ...request(), data: { ...data(), text: '한'.repeat(350000) } }));
  assert.equal(state.calls.length, 0); assert.equal(state.authCalls, 0); adapter.dispose();
});
test('write snapshots payload and scalar identity before asynchronous account verification', async () => {
  const { state, adapter } = fixture(), waiting = deferred(), input = request(); state.authPending = waiting.promise; state.result = { data: { status: 'stored', revision: 1 }, error: null };
  const pending = adapter.write(input); input.workspaceId = OTHER; input.draftId = OTHER; input.operationId = OTHER; input.expectedRevision = 90; input.sourceRevision = 80; input.data.text = 'mutated';
  waiting.resolve(state.authResult); assert.deepEqual(await pending, { status: 'stored', revision: 1 });
  assert.deepEqual(state.calls[0], { name: 'life_writing_draft_put', params: { p_workspace_id: ID, p_draft_id: DRAFT, p_expected_revision: 0, p_operation_id: OP, p_source_revision: 2, p_data: data() } }); adapter.dispose();
});
test('stored conflict missing replies stay distinct and malformed results reject', async () => {
  const { state, adapter } = fixture();
  for (const result of [{ status: 'stored', revision: 1 }, { status: 'conflict', revision: 4 }, { status: 'missing' }]) { state.result = { data: result, error: null }; assert.deepEqual(await adapter.write(request()), result); }
  for (const result of [{ status: 'stored', revision: 0 }, { status: 'conflict', revision: '2' }, { status: 'unknown', revision: 1 }, null]) { state.result = { data: result, error: null }; await assert.rejects(adapter.write(request()), { code: 'invalid_remote_data' }); }
  adapter.dispose();
});
test('remote schema permissions and network errors redact raw private diagnostics', async () => {
  const { state, adapter } = fixture();
  for (const [error, code] of [[{ code: 'PGRST202', message: 'private SQL token' }, 'schema_missing'], [{ code: '42501', message: 'private owner identity' }, 'permission_denied'], [{ message: 'life_writing_draft_source_not_ready' }, 'writing_source_pending'], [{ message: 'life_writing_draft_operation_mismatch' }, 'operation_mismatch'], [{ status: 401, message: 'private bearer' }, 'auth_required'], [{ name: 'AbortError', message: 'private URL' }, 'request_cancelled'], [{ message: 'private transport trace' }, 'network_error']]) {
    state.result = { error, data: null }; await assert.rejects(adapter.read(ID, DRAFT), failure => failure.code === code && !failure.message.includes('private'));
  }
  state.authResult = { data: { user: null }, error: null }; const calls = state.calls.length; await assert.rejects(adapter.write(request()), { code: 'auth_required' }); assert.equal(state.calls.length, calls); adapter.dispose();
});
test('dispose rejects delayed replies and releases only borrowed transport once', async () => {
  const { state, adapter } = fixture(), waiting = deferred(); state.pending = waiting.promise;
  const pending = adapter.read(ID, DRAFT); await new Promise(resolve => setImmediate(resolve)); adapter.dispose(); adapter.dispose(); waiting.resolve({ data: row(), error: null });
  await assert.rejects(pending, { code: 'request_cancelled' }); assert.equal(state.disposed, 1);
});
function sharedFixture() {
  const listeners = new Set(), state = { calls: [], disposedAuth: 0, signals: [], result: { data: row(), error: null } };
  const auth = { ready: true, config, user: { id: ID }, epoch: 0, async verify() { return auth.user; }, async signOut() { throw new Error('Writing must not sign out shared auth'); }, client: { auth: { onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } }; }, dispose() { state.disposedAuth++; } }, from() { throw new Error('Writing must not read tables'); }, rpc(name, params) { state.calls.push({ name, params }); return { abortSignal(signal) { state.signals.push(signal); return this; }, then(resolve, reject) { return (state.pending || Promise.resolve(state.result)).then(resolve, reject); } }; } } };
  return { auth, state, change() { auth.epoch++; auth.user = { id: OTHER }; for (const listener of listeners) listener('SIGNED_IN', { user: auth.user }); }, get listenerCount() { return listeners.size; } };
}
test('writing scope admits only the three writing RPCs and no original composition or public access', async () => {
  const shared = sharedFixture(), client = Platform.clientFactory(shared.auth, { scope: 'writing' })(config.url, config.key);
  for (const name of ['life_sync_put', 'life_composition_get', 'life_composition_put', 'life_public_page_put', 'life_public_page_read']) assert.throws(() => client.rpc(name, {}), { code: 'invalid_request' });
  for (const table of ['life_workspaces', 'life_writing_drafts']) assert.throws(() => client.from(table), { code: 'invalid_request' });
  for (const name of ['life_writing_draft_get', 'life_writing_draft_put', 'life_writing_draft_list']) await client.rpc(name, {});
  const originals = Platform.clientFactory(shared.auth)(config.url, config.key); assert.throws(() => originals.rpc('life_writing_draft_get', {}), { code: 'invalid_request' });
  await assert.rejects(client.auth.signInWithPassword(), { code: 'auth_required' }); client.auth.dispose(); originals.auth.dispose(); assert.equal(shared.listenerCount, 0); assert.equal(shared.state.disposedAuth, 0);
});
test('account switch aborts delayed writing read write and list responses without touching shared session', async () => {
  for (const method of ['read', 'write', 'list']) {
    const shared = sharedFixture(), waiting = deferred(); shared.state.pending = waiting.promise; const adapter = Remote.create({ auth: shared.auth, writing: Writing, clientFactory: Platform.clientFactory });
    const pending = method === 'read' ? adapter.read(ID, DRAFT) : method === 'write' ? adapter.write(request()) : adapter.list(ID);
    await new Promise(resolve => setImmediate(resolve)); shared.change(); assert.equal(shared.state.signals[0].aborted, true);
    waiting.resolve({ data: method === 'read' ? row() : method === 'write' ? { status: 'stored', revision: 1 } : [summary()], error: null });
    await assert.rejects(pending, { code: 'request_cancelled' }); adapter.dispose(); assert.equal(shared.state.disposedAuth, 0); assert.equal(shared.auth.user.id, OTHER);
  }
});

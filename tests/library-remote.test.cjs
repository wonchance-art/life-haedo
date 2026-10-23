'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Remote = require('../assets/life/library-remote.js'), Meta = require('../assets/life/library-meta.js');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', OP = '33333333-3333-4333-8333-333333333333';
const clone = value => structuredClone(value), deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const row = () => ({ workspace_id: A, revision: 1, source_revision: 2, data: Meta.empty(A), updated_at: '2026-10-24T00:00:00Z' });
const request = () => ({ workspaceId: A, expectedRevision: 0, operationId: OP, sourceRevision: 2, data: Meta.empty(A) });
function fixture() {
  const state = { uid: A, epoch: 0, calls: [], authCalls: 0, result: { data: row(), error: null }, disposed: 0 };
  const auth = { ready: true, config: { url: 'https://library-fixture.supabase.co', key: 'sb_publishable_fixture' },
    get epoch() { return state.epoch; }, getAccount: () => ({ userId: state.uid, projectUrl: 'https://library-fixture.supabase.co' }) };
  const factory = (value, options) => {
    assert.equal(value, auth); assert.deepEqual(options, { scope: 'library' });
    return () => ({ auth: { async getUser() { state.authCalls++; return state.authGate?.promise || { data: { user: { id: state.uid } }, error: null }; }, dispose() { state.disposed++; } },
      async rpc(name, params) { state.calls.push({ name, params }); return state.rpcGate?.promise || state.result; } });
  };
  return { state, adapter: Remote.create({ auth, metadata: Meta, clientFactory: factory }) };
}
test('capabilities and owner default opening use fixed RPC shapes and detach returned values', async () => {
  const { state, adapter } = fixture(); state.result.data = { version: 1, metadataVersion: 1, originalsVersion: 1 };
  assert.deepEqual(await adapter.capabilities(), state.result.data);
  state.result.data = { version: 0, metadataVersion: 0, originalsVersion: 0 }; assert.equal((await adapter.capabilities()).version, 0);
  state.result.data = { status: 'ready', workspace_id: A, default_revision: 1, pristine: true };
  const result = await adapter.open(B); result.pristine = false; assert.equal(state.result.data.pristine, true);
  assert.deepEqual(state.calls.at(-1), { name: 'life_library_open', params: { p_preferred_workspace_id: B } });
  state.result.data = { status: 'missing', workspace_id: A, default_revision: 0, pristine: false }; assert.equal((await adapter.open()).status, 'missing'); adapter.dispose();
});
test('catalog rejects unordered, repeated, malformed or nonadvancing cursors instead of silently completing', async () => {
  const { state, adapter } = fixture();
  const item = id => ({ id, title: '자료실', revision: 3, updated_at: '2026-10-24T00:00:00Z' });
  state.result.data = { items: [item(A), item(B)], next: B };
  assert.deepEqual(await adapter.catalog(null, 2), state.result.data);
  assert.deepEqual(state.calls.at(-1), { name: 'life_library_catalog', params: { p_after: null, p_limit: 2 } });
  for (const value of [{ items: [item(B), item(A)], next: A }, { items: [item(A), item(A)], next: A }, { items: [], next: A },
    { items: [item(A)], next: B }, { items: [{ ...item(A), revision: 0 }], next: null }]) {
    state.result.data = value; await assert.rejects(adapter.catalog(), { code: 'invalid_remote_data' });
  }
  state.result.data = { items: [item(A)], next: null }; await assert.rejects(adapter.catalog(A), { code: 'invalid_remote_data' });
  state.result.data = { items: [], next: null }; assert.deepEqual(await adapter.catalog(B), state.result.data); adapter.dispose();
});
test('invalid outbound scalars and private/invalid projections never reach auth or network', async () => {
  const { state, adapter } = fixture();
  for (const patch of [{ workspaceId: 'bad' }, { expectedRevision: -1 }, { sourceRevision: 0 }, { operationId: 'bad' }])
    await assert.rejects(adapter.write({ ...request(), ...patch }), { code: 'invalid_request' });
  const value = request(); value.data.privateDrafts = []; await assert.rejects(adapter.write(value), { code: 'invalid_remote_data' });
  await assert.rejects(adapter.catalog(null, 101), { code: 'invalid_request' }); await assert.rejects(adapter.open('bad'), { code: 'invalid_request' });
  assert.equal(state.calls.length, 0); assert.equal(state.authCalls, 0); adapter.dispose();
});
test('write captures all scalar and child snapshot values before awaiting verified auth', async () => {
  const { state, adapter } = fixture(), input = request(); state.authGate = deferred(); state.result.data = { status: 'stored', revision: 1 };
  const pending = adapter.write(input); input.workspaceId = B; input.operationId = B; input.expectedRevision = 30; input.sourceRevision = 40;
  input.data.sourceFolders.folders.push({ id: 'late', name: '나중 변경', parentId: null });
  state.authGate.resolve({ data: { user: { id: A } }, error: null }); assert.deepEqual(await pending, { status: 'stored', revision: 1 });
  assert.deepEqual(state.calls, [{ name: 'life_library_meta_put', params: { p_workspace_id: A, p_expected_revision: 0, p_operation_id: OP, p_source_revision: 2, p_data: Meta.empty(A) } }]); adapter.dispose();
});
test('read detaches validated metadata, recognizes null, and rejects mismatched rows and unsafe children', async () => {
  const { state, adapter } = fixture(), result = await adapter.read(A);
  result.data.sourceFolders.revision = 99; assert.equal(state.result.data.data.sourceFolders.revision, 0);
  for (const mutate of [r => { r.workspace_id = B; }, r => { r.source_revision = 0; }, r => { r.data.collection.workspaceId = B; }, r => { r.updated_at = 'bad'; }, r => { r.extra = 'unsafe'; }]) {
    state.result.data = row(); mutate(state.result.data); await assert.rejects(adapter.read(A), { code: 'invalid_remote_data' });
  }
  state.result.data = null; assert.equal(await adapter.read(A), null); adapter.dispose();
});
test('owner change or disposal while verified auth/RPC is pending cannot return or send old-account metadata', async () => {
  for (const stage of ['auth', 'rpc', 'dispose']) {
    const { state, adapter } = fixture(), gate = deferred(); if (stage === 'auth') state.authGate = gate; else state.rpcGate = gate;
    const pending = adapter.read(A); if (stage !== 'auth') while (!state.calls.length) await new Promise(setImmediate);
    if (stage === 'dispose') adapter.dispose(); else { state.uid = B; state.epoch++; }
    gate.resolve(stage === 'auth' ? { data: { user: { id: A } }, error: null } : { data: row(), error: null });
    await assert.rejects(pending, { code: 'request_cancelled' }); if (stage === 'auth') assert.equal(state.calls.length, 0); adapter.dispose(); assert.equal(state.disposed, 1);
  }
});
test('CAS outcomes and fixed server failures remain explicit sanitized results', async () => {
  const { state, adapter } = fixture();
  for (const result of [{ status: 'stored', revision: 1 }, { status: 'conflict', revision: 7 }, { status: 'missing' }]) {
    state.result = { data: result, error: null }; assert.deepEqual(await adapter.write(request()), result);
  }
  state.result = { data: { status: 'stored', revision: 5 }, error: null }; await assert.rejects(adapter.write(request()), { code: 'invalid_remote_data' });
  for (const [error, expected] of [[{ code: 'PGRST202' }, 'schema_missing'], [{ message: 'life_library_operation_mismatch' }, 'operation_mismatch'],
    [{ message: 'life_library_source_not_ready' }, 'composition_source_pending'], [{ code: '22001' }, 'payload_too_large'], [{ code: '42501', message: 'PRIVATE DETAIL' }, 'permission_denied']]) {
    state.result = { data: null, error }; await assert.rejects(adapter.write(request()), e => e.code === expected && !e.message.includes('PRIVATE DETAIL'));
  }
  adapter.dispose();
});

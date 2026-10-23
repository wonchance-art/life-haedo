'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Sync = require('../assets/life/library-meta-sync.js'), Meta = require('../assets/life/library-meta.js');
const A = '11111111-1111-4111-8111-111111111111', owner = { userId: A, projectUrl: 'https://library-fixture.supabase.co' };
const clone = value => structuredClone(value);
function fixture() {
  const state = { projection: Meta.empty(A), sync: null, calls: [], row: null, events: null, sent: [], epoch: 0, account: clone(owner) };
  const binding = { ...owner, remoteId: A };
  const storage = { account: clone(owner), async listWorkspaces() { return [{ workspaceId: A }]; },
    async getLibraryMetaState() { return clone(state.sync); },
    async bindLibraryMetaSync() { state.sync ||= { workspaceId: A, binding, enabled: true, remoteRevision: 0, sourceRevision: 1, syncedLocalRevision: -1, outbox: null, conflict: null, status: 'pending', error: null }; state.sync.enabled = true; },
    subscribe(_, listener) { state.events = listener; return () => {}; },
    async adoptLibraryMetaRemote(_, b, row, options) {
      assert.deepEqual(b, binding); state.calls.push('initial');
      if (state.projection.revision !== 0 || state.projection.sourceFolders.revision !== 0) return { status: 'conflict' };
      state.adoptOptions = clone(options || null);
      if (state.sync.outbox) {
        if (options?.outboxOperationId !== state.sync.outbox.operationId) return { status: 'conflict' };
        state.sync.outbox = null;
      }
      state.projection = clone(row.data); state.projection.revision = 1;
      state.sync.remoteRevision = row.revision; state.sync.syncedLocalRevision = 1; state.sync.status = 'synced'; return { status: 'stored' };
    },
    async applyLibraryMetaRemote(_, __, row) { state.calls.push('apply'); if (row.revision !== state.sync.remoteRevision || state.projection.revision !== state.sync.syncedLocalRevision) return { status: 'conflict' }; return { status: 'stored' }; },
    async prepareLibraryMetaUpload() { return clone(state.sync.outbox); }, async ackLibraryMetaSync(_, __, op, rev) { state.calls.push('ack'); assert.equal(op, state.sync.outbox.operationId); state.sync.remoteRevision = rev; state.sync.syncedLocalRevision = state.sync.outbox.localRevision; state.sync.outbox = null; state.sync.status = 'synced'; },
    async setLibraryMetaConflict(_, __, row) { state.sync.conflict = { row: clone(row), remoteRevision: row?.revision, localRevision: state.projection.revision }; state.sync.status = 'conflict'; },
    async setLibraryMetaError(_, __, error) { state.sync.error = clone(error); },
    async readLibraryMetaSnapshot() { return { bundle: { workspaceId: A }, metadata: clone(state.projection) }; },
    async pauseLibraryMetaSync() { state.sync.enabled = false; },
    async resolveLibraryMetaSync(_, __, input) { state.resolved = clone(input); state.sync.conflict = null; return { metadata: clone(state.projection), sync: clone(state.sync), recoveryId: 'recovery' }; }
  };
  const sourceSync = { async getState() { return { enabled: true, status: 'synced', binding, remoteRevision: 2 }; }, async syncNow(_, options) { assert.equal(options.headIfClean, true); state.calls.push('source'); await state.sourceGate; }, subscribe() { return () => {}; } };
  const remote = { async read() { state.calls.push('read'); return clone(state.row); }, async write(value) { state.sent.push(clone(value)); if (state.failSend) throw Object.assign(Error('offline'), { code: 'network_error' }); return state.conflictSend ? { status: 'conflict', revision: 1 } : { status: 'stored', revision: value.expectedRevision + 1 }; }, dispose() {} };
  const auth = { get epoch() { return state.epoch; }, getAccount: () => clone(state.account) };
  return { state, storage, manager: Sync.create({ storage, sourceSync, remote, auth }) };
}
test('fresh metadata receives the known remote only through pristine atomic callback after source readiness', async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  const incoming = Meta.empty(A); incoming.revision = 9; incoming.sourceFolders.folders.push({ id: 'folder', name: '원래 폴더', parentId: null });
  f.state.row = { workspace_id: A, revision: 3, source_revision: 2, data: incoming, updated_at: '2026-10-24T00:00:00Z' };
  const result = await f.manager.enable(A);
  assert.equal(result.status, 'synced'); assert.equal(f.state.projection.sourceFolders.folders[0].id, 'folder'); assert.equal(f.state.sent.length, 0);
  assert.equal(f.state.calls.filter(x => x === 'initial').length, 1); assert.ok(f.state.calls.indexOf('source') < f.state.calls.indexOf('initial'));
});
test('a nonpristine initial projection stays intact and exposes a real comparison, rather than overwriting it', async t => {
  const f = fixture(); t.after(() => f.manager.dispose()); f.state.projection.revision = 1; f.state.projection.sourceFolders.revision = 1;
  const before = clone(f.state.projection); f.state.row = { workspace_id: A, revision: 2, source_revision: 2, data: Meta.empty(A) };
  assert.equal((await f.manager.enable(A)).status, 'conflict'); assert.deepEqual(f.state.projection, before); assert.equal(f.state.sent.length, 0);
  const compared = await f.manager.compare(A); assert.deepEqual(compared.local, before); assert.deepEqual(compared.remote.data, f.state.row.data);
  const resolution = await f.manager.resolve(A, 'remote', compared); assert.equal(resolution.recoveryId, 'recovery'); assert.deepEqual(resolution.workbench, before); assert.equal(resolution.metadata.conflict, null);
});
test('failed metadata upload preserves and replays the exact operation before reading a newer head', async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  await f.storage.bindLibraryMetaSync(); f.state.projection.revision = 1;
  f.state.sync.outbox = { operationId: 'op', expectedRevision: 0, sourceRevision: 2, localRevision: 1, data: clone(f.state.projection) };
  const expected = clone(f.state.sync.outbox); f.state.failSend = true;
  await assert.rejects(f.manager.syncNow(A), { code: 'network_error' }); assert.deepEqual(f.state.sync.outbox, expected);
  f.state.failSend = false; f.state.row = { workspace_id: A, revision: 1, source_revision: 2, data: clone(f.state.projection) };
  await f.manager.syncNow(A); assert.deepEqual(f.state.sent[0], f.state.sent[1]); assert.equal(f.state.sync.outbox, null);
  assert.ok(f.state.calls.indexOf('ack') < f.state.calls.indexOf('read'));
});

test('reviewed conflict scalar revisions are owned before asynchronous source verification', async t => {
  const f = fixture(); t.after(() => f.manager.dispose()); f.state.projection.revision = 1;
  f.state.row = { workspace_id: A, revision: 2, source_revision: 2, data: Meta.empty(A) };
  await f.manager.enable(A); const reviewed = await f.manager.compare(A), originalLocal = reviewed.expectedLocalRevision;
  let release; f.state.sourceGate = new Promise(resolve => { release = resolve; });
  const pending = f.manager.resolve(A, 'remote', reviewed); reviewed.expectedLocalRevision = 999; reviewed.expectedRemoteRevision = 999;
  release(); const result = await pending;
  assert.equal(result.recoveryId, 'recovery'); assert.equal(f.state.resolved.expectedLocalRevision, originalLocal);
});

test('the metadata domain adapter forwards the exact first-write operation to atomic empty-model adoption', async t => {
  const f = fixture(); t.after(() => f.manager.dispose()); await f.storage.bindLibraryMetaSync();
  f.state.sync.outbox = { operationId: 'initial_metadata', expectedRevision: 0, sourceRevision: 2, localRevision: 0, data: clone(f.state.projection) };
  f.state.row = { workspace_id: A, revision: 1, source_revision: 2, data: clone(f.state.projection) }; f.state.conflictSend = true;
  assert.equal((await f.manager.syncNow(A)).status, 'synced');
  assert.deepEqual(f.state.adoptOptions, { outboxOperationId: 'initial_metadata' });
  assert.equal(f.state.sync.outbox, null); assert.equal(f.state.sync.conflict, null); assert.equal(f.state.sent.length, 1);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStorage } = require('../assets/life/storage.js');
const Core = require('../assets/life/core.js');
const Workbench = require('../assets/life/workbench.js');

// This adapter exercises application decisions and failure propagation. Browser tests
// separately prove IndexedDB serialization, durability, and the real idb wrapper.
function memoryAdapter() {
  const schemas = new Map(), rows = new Map();
  const control = { opens: 0, closes: 0, callbacks: null, failWrite: null, failCompletion: false, transactions: [] };
  const encode = key => JSON.stringify(key);
  function connection() {
    let closed = false;
    return {
      objectStoreNames: { contains: name => schemas.has(name) },
      createObjectStore(name, options) {
        schemas.set(name, options.keyPath); rows.set(name, new Map());
        return { createIndex() {} };
      },
      close() { if (!closed) { closed = true; control.closes += 1; } },
      transaction(names, mode) {
        if (closed) throw new DOMException('closed', 'InvalidStateError');
        control.transactions.push({ names: [...names], mode });
        const working = new Map(names.map(name => [name, structuredClone(rows.get(name))]));
        let finished = false, resolve, reject;
        const done = new Promise((yes, no) => { resolve = yes; reject = no; });
        function abort(error = new DOMException('aborted', 'AbortError')) {
          if (finished) return;
          finished = true;
          reject(error);
        }
        function store(name) {
          if (!working.has(name)) throw new Error('store not in transaction');
          const map = working.get(name);
          function keyOf(value) {
            const path = schemas.get(name);
            return Array.isArray(path) ? path.map(key => value[key]) : value[path];
          }
          async function write(method, value) {
            if (finished) throw new DOMException('inactive', 'InvalidStateError');
            if (mode !== 'readwrite') throw new Error('readonly');
            if (control.failWrite?.name === name && control.failWrite.method === method) {
              control.failWrite = null;
              const error = new DOMException('quota', 'QuotaExceededError');
              abort(error);
              throw error;
            }
            const key = method === 'delete' ? value : keyOf(value);
            if (method === 'delete') map.delete(encode(key));
            else {
              if (method === 'add' && map.has(encode(key))) throw new DOMException('duplicate', 'ConstraintError');
              map.set(encode(key), structuredClone(value));
            }
            control.afterWrite?.({ name, method, value });
            return key;
          }
          return {
            async get(key) { return structuredClone(map.get(encode(key))); },
            async getAll() { return structuredClone([...map.values()]); },
            put: value => write('put', value), add: value => write('add', value), delete: key => write('delete', key),
            index(field) { return { async getAll(value) { return structuredClone([...map.values()].filter(row => row[field] === value)); } }; }
          };
        }
        setImmediate(() => {
          if (finished) return;
          if (control.failCompletion) { control.failCompletion = false; abort(); return; }
          finished = true;
          if (mode === 'readwrite') for (const [name, values] of working) rows.set(name, values);
          resolve();
        });
        return { done, objectStore: store, abort };
      }
    };
  }
  return {
    control, rows, schemas,
    idb: {
      async openDB(name, version, callbacks) {
        control.opens += 1; control.callbacks = callbacks;
        const db = connection();
        if (!schemas.size) callbacks.upgrade(db, 0, version);
        return db;
      }
    }
  };
}

function fixture() {
  const adapter = memoryAdapter();
  let next = 0;
  const calls = { apply: 0 };
  const core = {
    createWorkspace({ title = '내 자료' } = {}) {
      return { schemaVersion: 1, workspaceId: `w-${++next}`, title, revision: 0, records: [] };
    },
    validateWorkspace(bundle) {
      if (!bundle?.workspaceId || !Number.isSafeInteger(bundle.revision) || !Array.isArray(bundle.records)) {
        throw Object.assign(new Error('Invalid workspace'), { code: 'invalid_workspace' });
      }
      return true;
    },
    applyChanges(bundle, changes) {
      calls.apply += 1;
      return { ...structuredClone(bundle), revision: bundle.revision + 1,
        records: [...bundle.records, ...(structuredClone(changes.put?.records) || [])] };
    }
  };
  const storage = createStorage({ idb: adapter.idb, core, channelFactory: null });
  return { ...adapter, core, calls, storage };
}
function operation(bundle, id = 'op-1', extra = {}) {
  return { operationId: id, workspaceId: bundle.workspaceId, baseRevision: bundle.revision,
    changes: { put: { records: [{ id: 'r-example', text: '익명 검증 자료' }] } }, ...extra };
}
function draft(bundle, id = 'stage-1') {
  return { stageId: id, workspaceId: bundle.workspaceId, revision: 0, input: { text: '' }, excerpts: [], state: 'draft' };
}

test('opening is shared and never invents a workspace; missing and orphaned reads surface errors', async t => {
  const { storage, control, rows, schemas } = fixture(); t.after(() => storage.close());
  const first = storage.open(), second = storage.open();
  assert.equal(first, second);
  await first;
  assert.equal(control.opens, 1);
  assert.deepEqual([...schemas.keys()], ['bundles', 'operations', 'staging', 'meta', 'recovery']);
  assert.deepEqual(await storage.listWorkspaces(), []);
  assert.equal(await storage.getActive(), null);
  await assert.rejects(storage.read('missing'), { code: 'workspace_not_found' });
  rows.get('meta').set(JSON.stringify('activeWorkspace'), { key: 'activeWorkspace', value: 'missing' });
  await assert.rejects(storage.getActive(), { code: 'workspace_not_found' });
  assert.deepEqual(await storage.listWorkspaces(), []);
});

test('restored workspace and active pointer install together, without overwriting an existing ID', async t => {
  const { storage, core, control } = fixture(); t.after(() => storage.close());
  const original = await storage.createWorkspace('원래 작업공간');
  const restored = core.createWorkspace({ title: '복원 사본' });
  control.failWrite = { name: 'meta', method: 'put' };
  await assert.rejects(storage.installWorkspace(restored), { code: 'storage_quota' });
  assert.equal(await storage.getActive(), original.workspaceId);
  assert.equal((await storage.listWorkspaces()).length, 1);
  await assert.rejects(storage.read(restored.workspaceId), { code: 'workspace_not_found' });
  await storage.installWorkspace(restored);
  assert.equal(await storage.getActive(), restored.workspaceId);
  await assert.rejects(storage.installWorkspace({ ...restored, title: '덮어쓰기 시도' }), { code: 'workspace_exists' });
  assert.equal((await storage.read(restored.workspaceId)).title, '복원 사본');
});

test('successful retry precedes revision comparison, compares stable payload, and is scoped to workspace', async t => {
  const { storage, calls } = fixture(); t.after(() => storage.close());
  const one = await storage.createWorkspace();
  const request = operation(one);
  const receipt = await storage.commitLocal(request);
  assert.equal(receipt.status, 'stored');
  const reordered = { ...request, changes: { put: { records: [{ text: '익명 검증 자료', id: 'r-example' }] } } };
  assert.deepEqual(await storage.commitLocal(reordered), receipt);
  assert.equal(calls.apply, 1);
  const altered = await storage.commitLocal({ ...request, changes: { put: { records: [] } } });
  assert.equal(altered.error.code, 'operation_mismatch');
  const stale = await storage.commitLocal({ ...request, operationId: 'another-operation' });
  assert.equal(stale.status, 'conflict');
  assert.equal(stale.currentRevision, 1);
  const two = await storage.createWorkspace();
  assert.equal((await storage.commitLocal(operation(two))).status, 'stored');
  assert.equal((await storage.read(one.workspaceId)).records.length, 1);
  assert.equal((await storage.read(two.workspaceId)).records.length, 1);
});

test('receipt write failure rolls back bundle and applied stage; identical retry succeeds after recovery', async t => {
  const { storage, control, rows } = fixture(); t.after(() => storage.close());
  const bundle = await storage.createWorkspace();
  const stage = await storage.saveStage(draft(bundle));
  const request = operation(bundle, 'save-with-stage', { stageId: stage.stageId, stageRevision: stage.revision });
  control.failWrite = { name: 'operations', method: 'add' };
  const rejected = await storage.commitLocal(request);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.error.code, 'storage_quota');
  assert.equal((await storage.read(bundle.workspaceId)).revision, 0);
  assert.equal((await storage.getStage(stage.stageId)).state, 'draft');
  assert.equal(rows.get('operations').size, 0);
  assert.equal((await storage.commitLocal(request)).status, 'stored');
  assert.equal((await storage.getStage(stage.stageId)).state, 'applied');
  assert.equal(rows.get('operations').size, 1);
});

test('transaction completion failure cannot leave a successful receipt or emit a changed notification', async t => {
  const { storage, control, rows } = fixture(); t.after(() => storage.close());
  const bundle = await storage.createWorkspace();
  const events = [];
  storage.subscribe(bundle.workspaceId, event => events.push(event));
  control.failCompletion = true;
  const result = await storage.commitLocal(operation(bundle));
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.code, 'storage_aborted');
  assert.equal(rows.get('operations').size, 0);
  assert.equal((await storage.read(bundle.workspaceId)).revision, 0);
  assert.equal(events.length, 0);
});

test('stage compare-and-swap rejects stale review, another workspace, and reopening an applied stage', async t => {
  const { storage, rows } = fixture(); t.after(() => storage.close());
  const bundle = await storage.createWorkspace();
  const stage1 = await storage.saveStage(draft(bundle));
  const stage2 = await storage.saveStage({ ...stage1, input: { text: '수정한 검토 초안' } });
  await assert.rejects(storage.saveStage(stage1), { code: 'stage_conflict' });
  const conflict = await storage.commitLocal(operation(bundle, 'stage-stale', { stageId: stage1.stageId, stageRevision: stage1.revision }));
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.error.code, 'stage_conflict');
  assert.equal(rows.get('operations').size, 0);
  const other = await storage.createWorkspace();
  await assert.rejects(storage.saveStage({ ...stage2, workspaceId: other.workspaceId }), { code: 'stage_conflict' });
  assert.equal((await storage.commitLocal(operation(bundle, 'stage-current', { stageId: stage2.stageId, stageRevision: stage2.revision }))).status, 'stored');
  const applied = await storage.getStage(stage2.stageId);
  await assert.rejects(storage.saveStage({ ...applied, state: 'draft' }), { code: 'stage_conflict' });
  await storage.deleteStage(stage2.stageId);
  assert.equal((await storage.read(bundle.workspaceId)).records.length, 1);
});

test('snapshots isolate caller mutation and listener failures cannot turn successful storage into failure', async t => {
  const { storage } = fixture(); t.after(() => storage.close());
  const bundle = await storage.createWorkspace();
  storage.subscribe(bundle.workspaceId, () => { throw new Error('view failed'); });
  const request = operation(bundle);
  const pending = storage.commitLocal(request);
  request.changes.put.records[0].text = '저장 호출 후 변경';
  assert.equal((await pending).status, 'stored');
  const first = await storage.read(bundle.workspaceId);
  assert.equal(first.records[0].text, '익명 검증 자료');
  first.records[0].text = '읽은 사본 변경';
  assert.equal((await storage.read(bundle.workspaceId)).records[0].text, '익명 검증 자료');
});

test('core validation failure leaves no receipt and bad JSON values do not collide with valid payloads', async t => {
  const { storage, core, rows } = fixture(); t.after(() => storage.close());
  const bundle = await storage.createWorkspace();
  const badJSON = operation(bundle, 'bad-json', { changes: { put: { records: [NaN] } } });
  assert.equal((await storage.commitLocal(badJSON)).error.code, 'invalid_request');
  core.applyChanges = value => ({ ...value, revision: value.revision + 2 });
  assert.equal((await storage.commitLocal(operation(bundle))).error.code, 'invalid_revision');
  assert.equal(rows.get('operations').size, 0);
  assert.equal((await storage.read(bundle.workspaceId)).revision, 0);
});

test('versionchange closes the connection and surfaces the error without creating replacement data', async t => {
  const { storage, control, rows } = fixture(); t.after(() => storage.close());
  const bundle = await storage.createWorkspace();
  const events = [];
  storage.subscribe(bundle.workspaceId, event => events.push(event));
  control.callbacks.blocking(1, 2);
  assert.equal(control.closes, 1);
  assert.equal(events[0].error.code, 'storage_version_changed');
  assert.equal((await storage.commitLocal(operation(bundle))).error.code, 'storage_version_changed');
  await assert.rejects(storage.read(bundle.workspaceId), { code: 'storage_version_changed' });
  assert.equal(rows.get('bundles').size, 1);
  assert.equal(rows.get('operations').size, 0);
});

test('blocked opening rejects promptly and closes a connection that arrives after the rejection', async () => {
  const { core } = fixture();
  let callbacks, resolveDB, closes = 0;
  const idb = { openDB(name, version, handlers) { callbacks = handlers; return new Promise(resolve => { resolveDB = resolve; }); } };
  const storage = createStorage({ idb, core, channelFactory: null });
  const pending = storage.open();
  callbacks.blocked(0, 1);
  await assert.rejects(pending, { code: 'storage_blocked' });
  resolveDB({ close() { closes += 1; } });
  await Promise.resolve();
  assert.equal(closes, 1);
  await assert.rejects(storage.open(), { code: 'storage_blocked' });
  storage.close();
});

function syncFixture() {
  const adapter = memoryAdapter();
  const storage = createStorage({ idb: adapter.idb, core: Core, channelFactory: null });
  return { ...adapter, storage };
}
function bindingFor(bundle, userId = 'account-a') {
  return { projectUrl: 'https://anonymous-test.supabase.co', userId, remoteId: bundle.workspaceId };
}
function serverRow(bundle, revision) {
  return { id: bundle.workspaceId, title: bundle.title, revision, data: structuredClone(bundle), updated_at: '2026-10-03T00:00:00.000Z' };
}
async function initialImport(storage) {
  let bundle = await storage.createWorkspace('익명 동기화 검증');
  const prepared = await Core.prepareImport({ origin: 'obsidian', title: '익명 자료', text: '검증할 원문입니다.' }, bundle);
  const changes = Core.buildImportChanges(bundle, prepared, [{ start: 0, end: 3, topic: '검증', note: '' }]);
  assert.equal((await storage.commitLocal({ workspaceId: bundle.workspaceId, operationId: Core.id(), baseRevision: bundle.revision, changes })).status, 'stored');
  return storage.read(bundle.workspaceId);
}
function noteChanges(bundle, note) {
  return { put: { records: [{ ...bundle.records[0], note, revision: bundle.records[0].revision + 1 }] } };
}
async function editNote(storage, bundle, note) {
  assert.equal((await storage.commitLocal({ workspaceId: bundle.workspaceId, operationId: Core.id(), baseRevision: bundle.revision, changes: noteChanges(bundle, note) })).status, 'stored');
  return storage.read(bundle.workspaceId);
}
async function uploaded(storage, bundle) {
  const binding = bindingFor(bundle);
  await storage.bindSync(bundle.workspaceId, binding);
  const outbox = await storage.prepareSyncUpload(bundle.workspaceId, binding);
  await storage.ackSync(bundle.workspaceId, binding, outbox.operationId, 1);
  return binding;
}

test('durable upload stays fixed across edits and reopen; ack schedules the newer local snapshot', async t => {
  const { storage, control } = syncFixture(); t.after(() => storage.close());
  let bundle = await initialImport(storage);
  const binding = bindingFor(bundle);
  await storage.bindSync(bundle.workspaceId, binding);
  const first = await storage.prepareSyncUpload(bundle.workspaceId, binding);
  bundle = await editNote(storage, bundle, '전송 중 추가한 메모');
  assert.deepEqual(await storage.prepareSyncUpload(bundle.workspaceId, binding), first);
  storage.close(); await storage.open();
  assert.deepEqual((await storage.getSyncState(bundle.workspaceId)).outbox, first);
  control.failWrite = { name: 'meta', method: 'put' };
  await assert.rejects(storage.ackSync(bundle.workspaceId, binding, first.operationId, 1), { code: 'storage_quota' });
  assert.deepEqual((await storage.getSyncState(bundle.workspaceId)).outbox, first);
  const pending = await storage.ackSync(bundle.workspaceId, binding, first.operationId, 1);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.syncedLocalRevision, first.localRevision);
  const second = await storage.prepareSyncUpload(bundle.workspaceId, binding);
  assert.notEqual(second.operationId, first.operationId);
  assert.equal(second.expectedRevision, 1);
  assert.equal(second.data.records[0].note, '전송 중 추가한 메모');
  await assert.rejects(storage.ackSync(bundle.workspaceId, binding, first.operationId, 1), { code: 'stale_sync_result' });
  const synced = await storage.ackSync(bundle.workspaceId, binding, second.operationId, 2);
  assert.equal(synced.status, 'synced');
  assert.equal(await storage.prepareSyncUpload(bundle.workspaceId, binding), null);
});

test('sync metadata failure rolls back local change and receipt; malformed metadata is never hidden', async t => {
  const { storage, control, rows } = syncFixture(); t.after(() => storage.close());
  const bundle = await initialImport(storage), binding = bindingFor(bundle);
  await storage.bindSync(bundle.workspaceId, binding);
  const request = { workspaceId: bundle.workspaceId, operationId: Core.id(), baseRevision: bundle.revision, changes: noteChanges(bundle, '보존할 입력') };
  const receipts = rows.get('operations').size;
  control.failWrite = { name: 'meta', method: 'put' };
  assert.equal((await storage.commitLocal(request)).error.code, 'storage_quota');
  assert.equal((await storage.read(bundle.workspaceId)).revision, bundle.revision);
  assert.equal(rows.get('operations').size, receipts);
  assert.equal((await storage.commitLocal(request)).status, 'stored');
  rows.get('meta').set(JSON.stringify(`sync:${bundle.workspaceId}`), { key: `sync:${bundle.workspaceId}`, value: { enabled: true } });
  await assert.rejects(storage.getSyncState(bundle.workspaceId), { code: 'invalid_sync_metadata' });
  await assert.rejects(storage.bindSync(bundle.workspaceId, binding), { code: 'invalid_sync_metadata' });
  const current = await storage.read(bundle.workspaceId);
  const rejected = await storage.commitLocal({ workspaceId: current.workspaceId, operationId: Core.id(), baseRevision: current.revision, changes: noteChanges(current, '손상 메타를 숨기지 않음') });
  assert.equal(rejected.error.code, 'invalid_sync_metadata');
  assert.equal((await storage.read(bundle.workspaceId)).revision, current.revision);
});

test('pause retains ownership and outbox while rejecting delayed results and another account', async t => {
  const { storage } = syncFixture(); t.after(() => storage.close());
  const bundle = await initialImport(storage), binding = bindingFor(bundle);
  await storage.bindSync(bundle.workspaceId, binding);
  const outbox = await storage.prepareSyncUpload(bundle.workspaceId, binding);
  await storage.pauseSync(bundle.workspaceId, binding);
  await assert.rejects(storage.ackSync(bundle.workspaceId, binding, outbox.operationId, 1), { code: 'sync_paused' });
  await assert.rejects(storage.setSyncConflict(bundle.workspaceId, binding, serverRow(bundle, 1)), { code: 'sync_paused' });
  await assert.rejects(storage.applySyncRemote(bundle.workspaceId, binding, serverRow(bundle, 1)), { code: 'sync_paused' });
  await assert.rejects(storage.setSyncError(bundle.workspaceId, binding, { code: 'network_error', message: '익명 오류' }), { code: 'sync_paused' });
  await assert.rejects(storage.bindSync(bundle.workspaceId, bindingFor(bundle, 'account-b')), { code: 'account_mismatch' });
  const resumed = await storage.bindSync(bundle.workspaceId, binding);
  assert.deepEqual(resumed.outbox, outbox);
  assert.equal(resumed.enabled, true);
  await assert.rejects(storage.prepareSyncUpload(bundle.workspaceId, bindingFor(bundle, 'account-b')), { code: 'account_mismatch' });
});

test('server installation preserves IDs but atomically installs data, binding and active pointer', async t => {
  const { storage, control, rows } = syncFixture(); t.after(() => storage.close());
  const original = await storage.createWorkspace('기존 로컬');
  const remoteBundle = Core.createWorkspace({ title: '서버 자료' });
  const binding = bindingFor(remoteBundle), row = serverRow(remoteBundle, 4);
  control.failWrite = { name: 'meta', method: 'put' };
  await assert.rejects(storage.installSyncRemote(row, binding), { code: 'storage_quota' });
  assert.equal(await storage.getActive(), original.workspaceId);
  await assert.rejects(storage.read(remoteBundle.workspaceId), { code: 'workspace_not_found' });
  assert.equal(rows.get('meta').has(JSON.stringify(`sync:${remoteBundle.workspaceId}`)), false);
  const installed = await storage.installSyncRemote(row, binding);
  assert.equal(installed.workspaceId, remoteBundle.workspaceId);
  assert.equal(installed.revision, 0);
  assert.equal((await storage.getSyncState(installed.workspaceId)).remoteRevision, 4);
  assert.equal(await storage.getActive(), installed.workspaceId);
  await assert.rejects(storage.installSyncRemote(row, binding), { code: 'workspace_exists' });
  const wrong = { ...row, id: original.workspaceId };
  await assert.rejects(storage.installSyncRemote(wrong, binding), { code: 'invalid_remote_snapshot' });
});

test('remote apply requires a clean workspace, preserves staging and rejects immutable or stale versions', async t => {
  const { storage, control } = syncFixture(); t.after(() => storage.close());
  let bundle = await initialImport(storage);
  const binding = await uploaded(storage, bundle);
  const stage = await storage.saveStage(draft(bundle, 'remote-apply-stage'));
  const next = Core.applyChanges(bundle, noteChanges(bundle, '서버의 메모'));
  control.failWrite = { name: 'meta', method: 'put' };
  await assert.rejects(storage.applySyncRemote(bundle.workspaceId, binding, serverRow(next, 2)), { code: 'storage_quota' });
  assert.equal((await storage.read(bundle.workspaceId)).records[0].note, '');
  assert.equal((await storage.getSyncState(bundle.workspaceId)).remoteRevision, 1);
  assert.equal((await storage.applySyncRemote(bundle.workspaceId, binding, serverRow(next, 2))).status, 'stored');
  assert.deepEqual(await storage.getStage(stage.stageId), stage);
  bundle = await storage.read(bundle.workspaceId);
  const corrupt = structuredClone(bundle);
  corrupt.sourceVersions[0].coverage.omissions.push('같은 원문 ID의 내용 변경');
  await assert.rejects(storage.applySyncRemote(bundle.workspaceId, binding, serverRow(corrupt, 3)), { code: 'immutable_source_version' });
  await assert.rejects(storage.applySyncRemote(bundle.workspaceId, binding, serverRow(bundle, 1)), { code: 'stale_sync_result' });
  const equivocation = Core.applyChanges(bundle, noteChanges(bundle, '같은 서버 버전에서 바뀐 내용'));
  await assert.rejects(storage.applySyncRemote(bundle.workspaceId, binding, serverRow(equivocation, 2)), { code: 'remote_revision_mismatch' });
  bundle = await editNote(storage, bundle, '전송 전 로컬 메모');
  assert.equal((await storage.applySyncRemote(bundle.workspaceId, binding, serverRow(next, 3))).status, 'conflict');
  assert.equal((await storage.read(bundle.workspaceId)).records[0].note, '전송 전 로컬 메모');
});

test('conflict keeps the fixed outbox and never lowers an observed server revision; missing cannot resurrect', async t => {
  const { storage } = syncFixture(); t.after(() => storage.close());
  const bundle = await initialImport(storage), binding = bindingFor(bundle);
  await storage.bindSync(bundle.workspaceId, binding);
  const outbox = await storage.prepareSyncUpload(bundle.workspaceId, binding);
  const state = await storage.setSyncConflict(bundle.workspaceId, binding, serverRow(bundle, 5));
  assert.deepEqual(state.outbox, outbox);
  assert.equal(state.conflict.remoteRevision, 5);
  const unchanged = await storage.setSyncConflict(bundle.workspaceId, binding, serverRow(bundle, 3));
  assert.equal(unchanged.conflict.remoteRevision, 5);
  await assert.rejects(storage.prepareSyncUpload(bundle.workspaceId, binding), { code: 'sync_conflict' });
  const missing = await storage.setSyncConflict(bundle.workspaceId, binding, null);
  assert.equal(missing.conflict.missing, true);
  assert.equal(missing.conflict.remoteRevision, 5);
  const copy = await Core.restoreBackup(Core.makeBackup(bundle));
  await assert.rejects(storage.resolveSync(bundle.workspaceId, binding, { choice: 'local', expectedLocalRevision: bundle.revision, remoteRow: null, copy }), { code: 'remote_missing' });
  assert.equal((await storage.listWorkspaces()).length, 1);
});

test('remote resolution preserves the unselected local copy and rolls back every part on failure', async t => {
  const { storage, control, rows } = syncFixture(); t.after(() => storage.close());
  let bundle = await initialImport(storage);
  const binding = await uploaded(storage, bundle);
  const remote = Core.applyChanges(bundle, noteChanges(bundle, '서버 선택 내용'));
  bundle = await editNote(storage, bundle, '별도 보관할 로컬 내용');
  const outbox = await storage.prepareSyncUpload(bundle.workspaceId, binding);
  const row = serverRow(remote, 2);
  await storage.setSyncConflict(bundle.workspaceId, binding, row);
  const copy = await Core.restoreBackup(Core.makeBackup(bundle));
  const request = { choice: 'remote', expectedLocalRevision: bundle.revision, remoteRow: row, copy };
  control.failWrite = { name: 'meta', method: 'put' };
  await assert.rejects(storage.resolveSync(bundle.workspaceId, binding, request), { code: 'storage_quota' });
  assert.equal((await storage.listWorkspaces()).length, 1);
  assert.equal(rows.get('recovery').size, 0);
  assert.deepEqual((await storage.getSyncState(bundle.workspaceId)).outbox, outbox);
  assert.equal((await storage.read(bundle.workspaceId)).records[0].note, '별도 보관할 로컬 내용');
  const result = await storage.resolveSync(bundle.workspaceId, binding, request);
  assert.equal(result.bundle.records[0].note, '서버 선택 내용');
  assert.equal(result.metadata.status, 'synced');
  assert.equal(result.metadata.outbox, null);
  assert.equal((await storage.read(result.copyWorkspaceId)).records[0].note, '별도 보관할 로컬 내용');
  assert.equal(await storage.getSyncState(result.copyWorkspaceId), null);
  assert.equal(rows.get('recovery').size, 1);
  assert.equal(await storage.getActive(), bundle.workspaceId);
});

test('local resolution rejects stale or lossy copies and schedules a new CAS against the reviewed revision', async t => {
  const { storage } = syncFixture(); t.after(() => storage.close());
  let bundle = await initialImport(storage);
  const binding = await uploaded(storage, bundle);
  const remote = Core.applyChanges(bundle, noteChanges(bundle, '사본으로 보관할 서버 내용'));
  bundle = await editNote(storage, bundle, '보낼 로컬 내용');
  const row = serverRow(remote, 2);
  await storage.setSyncConflict(bundle.workspaceId, binding, row);
  const copy = await Core.restoreBackup(Core.makeBackup(remote));
  const request = { choice: 'local', expectedLocalRevision: bundle.revision, remoteRow: row, copy };
  const lossy = structuredClone(copy); lossy.records[0].note = '유실된 서버 내용';
  await assert.rejects(storage.resolveSync(bundle.workspaceId, binding, { ...request, copy: lossy }), { code: 'invalid_recovery_copy' });
  await assert.rejects(storage.resolveSync(bundle.workspaceId, binding, { ...request, expectedLocalRevision: bundle.revision - 1 }), { code: 'sync_conflict_changed' });
  const result = await storage.resolveSync(bundle.workspaceId, binding, request);
  assert.equal(result.bundle.revision, bundle.revision);
  assert.equal(result.bundle.records[0].note, '보낼 로컬 내용');
  assert.equal((await storage.read(result.copyWorkspaceId)).records[0].note, '사본으로 보관할 서버 내용');
  const pending = await storage.prepareSyncUpload(bundle.workspaceId, binding);
  assert.equal(pending.expectedRevision, 2);
  assert.equal(pending.data.records[0].note, '보낼 로컬 내용');
});

test('sync errors retain payload, can clear after successful observation, and remain outside backups', async t => {
  const { storage } = syncFixture(); t.after(() => storage.close());
  const bundle = await initialImport(storage), binding = bindingFor(bundle);
  const events = [];
  storage.subscribe(bundle.workspaceId, event => events.push(event));
  await storage.bindSync(bundle.workspaceId, binding);
  const outbox = await storage.prepareSyncUpload(bundle.workspaceId, binding);
  const failed = await storage.setSyncError(bundle.workspaceId, binding, { code: 'network_error', message: '다시 연결하면 재시도합니다.' });
  assert.deepEqual(failed.outbox, outbox);
  assert.equal(failed.status, 'error');
  assert.equal((await storage.setSyncError(bundle.workspaceId, binding, null)).status, 'pending');
  await storage.ackSync(bundle.workspaceId, binding, outbox.operationId, 1);
  await storage.setSyncError(bundle.workspaceId, binding, { code: 'network_error', message: '연결 확인 필요' });
  assert.equal((await storage.setSyncError(bundle.workspaceId, binding, null)).status, 'synced');
  const backup = Core.makeBackup(await storage.read(bundle.workspaceId));
  assert.equal(JSON.stringify(backup).includes(binding.projectUrl), false);
  assert.equal(JSON.stringify(backup).includes(outbox.operationId), false);
  assert.ok(events.some(event => event.type === 'sync_changed'));
  assert.equal(events.some(event => 'outbox' in event || 'data' in event), false);
});

test('well-shaped but impossible sync revisions surface metadata errors instead of hiding pending edits', async t => {
  const { storage, rows } = syncFixture(); t.after(() => storage.close());
  const bundle = await initialImport(storage), binding = await uploaded(storage, bundle);
  const state = await storage.getSyncState(bundle.workspaceId);
  state.syncedLocalRevision = bundle.revision + 1;
  rows.get('meta').set(JSON.stringify(`sync:${bundle.workspaceId}`), { key: `sync:${bundle.workspaceId}`, value: state });
  await assert.rejects(storage.getSyncState(bundle.workspaceId), { code: 'invalid_sync_metadata' });
  await assert.rejects(storage.prepareSyncUpload(bundle.workspaceId, binding), { code: 'invalid_sync_metadata' });
  assert.equal((await storage.read(bundle.workspaceId)).revision, bundle.revision);
});

const accountA = { projectUrl: 'https://anonymous-test.supabase.co', userId: 'account-a' };
const accountB = { projectUrl: 'https://anonymous-test.supabase.co', userId: 'account-b' };

test('account handles isolate lists, active selection, reads, receipts, stages and backup inputs', async t => {
  const { storage: base } = syncFixture(); t.after(() => base.close());
  const a = base.forAccount(accountA);
  const original = await initialImport(a);
  const stage = await a.saveStage(draft(original, 'account-a-stage'));
  const request = { workspaceId: original.workspaceId, operationId: Core.id(), baseRevision: original.revision, changes: noteChanges(original, 'A의 메모') };
  assert.equal((await a.commitLocal(request)).status, 'stored');
  assert.equal(Object.isFrozen(a.account), true);
  assert.equal(a.isAccountScoped, true);
  const b = base.forAccount(accountB);
  assert.deepEqual(await b.listWorkspaces(), []);
  assert.equal(await b.getActive(), null);
  await assert.rejects(a.read(original.workspaceId), { code: 'storage_scope_closed' });
  await assert.rejects(a.open(), { code: 'storage_scope_closed' });
  await assert.rejects(b.read(original.workspaceId), { code: 'workspace_access_denied' });
  await assert.rejects(b.getSyncState(original.workspaceId), { code: 'workspace_access_denied' });
  assert.equal((await b.commitLocal(request)).error.code, 'workspace_access_denied');
  await assert.rejects(b.getStage(stage.stageId), { code: 'workspace_access_denied' });
  await assert.rejects(b.deleteStage(stage.stageId), { code: 'workspace_access_denied' });
  await assert.rejects(b.listStages(original.workspaceId), { code: 'workspace_access_denied' });
  await assert.rejects(b.setActive(original.workspaceId), { code: 'workspace_access_denied' });
  await assert.rejects(b.installWorkspace(original), { code: 'workspace_exists' });
  const ownB = await b.createWorkspace('B의 자료');
  assert.equal(await b.getActive(), ownB.workspaceId);
  const nextA = base.forAccount(accountA);
  assert.deepEqual((await nextA.listWorkspaces()).map(row => row.workspaceId), [original.workspaceId]);
  assert.equal(await nextA.getActive(), original.workspaceId);
  assert.equal((await nextA.getStage(stage.stageId)).input.text, '');
  assert.equal(Core.makeBackup(await nextA.read(original.workspaceId)).workspace.records[0].note, 'A의 메모');
  await assert.rejects(nextA.read(ownB.workspaceId), { code: 'workspace_access_denied' });
  base.clearAccount();
  await assert.rejects(nextA.listWorkspaces(), { code: 'storage_scope_closed' });
});

test('existing sync binding proves account ownership without altering or claiming unowned data', async t => {
  const { storage: base, rows } = syncFixture(); t.after(() => base.close());
  const owned = await initialImport(base);
  await base.bindSync(owned.workspaceId, bindingFor(owned));
  const unowned = await base.createWorkspace('기존 무소유 자료');
  const before = structuredClone(rows.get('bundles'));
  const a = base.forAccount(accountA);
  assert.deepEqual((await a.listWorkspaces()).map(row => row.workspaceId), [owned.workspaceId]);
  assert.equal(await a.getActive(), null); // Never adopt the old global active pointer.
  assert.deepEqual((await a.listUnownedWorkspaces()).map(row => row.workspaceId), [unowned.workspaceId]);
  await assert.rejects(a.read(unowned.workspaceId), { code: 'workspace_access_denied' });
  await assert.rejects(a.bindSync(unowned.workspaceId, bindingFor(unowned)), { code: 'workspace_access_denied' });
  assert.deepEqual(rows.get('bundles'), before);
  assert.equal(rows.get('meta').has(JSON.stringify(`owner:${unowned.workspaceId}`)), false);
  const b = base.forAccount(accountB);
  assert.deepEqual(await b.listWorkspaces(), []);
  assert.deepEqual((await b.listUnownedWorkspaces()).map(row => row.workspaceId), [unowned.workspaceId]);
  await assert.rejects(b.importUnownedWorkspace(owned.workspaceId), { code: 'workspace_access_denied' });
  const otherProject = base.forAccount({ ...accountA, projectUrl: 'https://another-project.supabase.co' });
  assert.deepEqual(await otherProject.listWorkspaces(), []);
});

test('explicit unowned import remaps source and draft IDs, preserves originals and does not enable upload', async t => {
  const { storage: base } = syncFixture(); t.after(() => base.close());
  const original = await initialImport(base);
  const stage = await base.saveStage({ ...draft(original, 'unowned-draft'), input: {
    text: '새 판본을 검토하는 초안', existingSourceId: original.sources[0].id
  }, invalidatedExcerpts: [{ text: '이전 발췌', note: '보존할 보완 메모' }] });
  const account = base.forAccount(accountA);
  const copy = await account.importUnownedWorkspace(original.workspaceId);
  assert.notEqual(copy.workspaceId, original.workspaceId);
  assert.notEqual(copy.sources[0].id, original.sources[0].id);
  assert.equal(copy.sourceVersions[0].contentText, original.sourceVersions[0].contentText);
  assert.equal(copy.records[0].sourceRefs[0].sourceId, copy.sources[0].id);
  assert.equal(await account.getSyncState(copy.workspaceId), null);
  assert.equal(await account.getActive(), copy.workspaceId);
  const stages = await account.listStages(copy.workspaceId);
  assert.equal(stages.length, 1);
  assert.notEqual(stages[0].stageId, stage.stageId);
  assert.equal(stages[0].input.existingSourceId, copy.sources[0].id);
  assert.deepEqual(stages[0].invalidatedExcerpts, stage.invalidatedExcerpts);
  assert.deepEqual(await base.read(original.workspaceId), original);
  assert.deepEqual(await base.getStage(stage.stageId), stage);
  await assert.rejects(account.read(original.workspaceId), { code: 'workspace_access_denied' });
  assert.deepEqual((await account.listWorkspaces()).map(row => row.workspaceId), [copy.workspaceId]);
});

test('owner and account active pointer install atomically and cannot be retagged through sync APIs', async t => {
  const { storage: base, control, rows } = syncFixture(); t.after(() => base.close());
  const a = base.forAccount(accountA);
  const original = await a.createWorkspace('A의 원본');
  const count = rows.get('meta').size;
  control.failWrite = { name: 'meta', method: 'put' };
  await assert.rejects(a.createWorkspace('실패한 사본'), { code: 'storage_quota' });
  assert.equal((await a.listWorkspaces()).length, 1);
  assert.equal(rows.get('meta').size, count);
  assert.equal(await a.getActive(), original.workspaceId);
  await assert.rejects(a.bindSync(original.workspaceId, bindingFor(original, 'account-b')), { code: 'account_mismatch' });
  assert.equal(await a.getSyncState(original.workspaceId), null);
  const remote = Core.createWorkspace({ title: '서버 입력' });
  await assert.rejects(a.installSyncRemote(serverRow(remote, 1), bindingFor(remote, 'account-b')), { code: 'account_mismatch' });
  const downloaded = await a.installSyncRemote(serverRow(remote, 1), bindingFor(remote));
  assert.equal((await a.read(downloaded.workspaceId)).title, '서버 입력');
  const b = base.forAccount(accountB);
  assert.deepEqual(await b.listWorkspaces(), []);
});

test('changing account aborts an in-flight write and never commits old data or notifications into the new scope', async t => {
  const { storage: base, control, rows } = syncFixture(); t.after(() => base.close());
  const a = base.forAccount(accountA);
  const original = await initialImport(a);
  const events = [];
  a.subscribe(original.workspaceId, event => events.push(event));
  const receiptCount = rows.get('operations').size;
  let b;
  control.afterWrite = event => {
    if (event.name === 'bundles' && event.method === 'put') {
      control.afterWrite = null;
      b = base.forAccount(accountB);
    }
  };
  const result = await a.commitLocal({ workspaceId: original.workspaceId, operationId: Core.id(), baseRevision: original.revision, changes: noteChanges(original, '늦은 A의 쓰기') });
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.code, 'storage_scope_closed');
  assert.equal(rows.get('operations').size, receiptCount);
  assert.equal(events.length, 0);
  assert.deepEqual(await b.listWorkspaces(), []);
  const againA = base.forAccount(accountA);
  assert.deepEqual(await againA.read(original.workspaceId), original);
});

test('a copy finishing validation after logout is discarded and leaves unowned source untouched', async t => {
  const adapter = memoryAdapter();
  let resume, entered;
  const reached = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { resume = resolve; });
  const core = { ...Core, async restoreBackup(data) { entered(); await gate; return Core.restoreBackup(data); } };
  const base = createStorage({ idb: adapter.idb, core, channelFactory: null }); t.after(() => base.close());
  const original = await initialImport(base);
  const a = base.forAccount(accountA);
  const pending = a.importUnownedWorkspace(original.workspaceId);
  await reached;
  const b = base.forAccount(accountB);
  resume();
  await assert.rejects(pending, { code: 'storage_scope_closed' });
  assert.deepEqual(await b.listWorkspaces(), []);
  assert.deepEqual(await base.read(original.workspaceId), original);
  assert.equal((await base.listWorkspaces()).length, 1);
});

async function batchItem(storage, bundle, index = 0, batchId = Core.id()) {
  const input = { origin: 'obsidian', fileName: `anonymous-${index}.md`, text: `보존할 익명 원문 ${index}` };
  const stage = await storage.saveStage({ ...draft(bundle, Core.id()), input,
    batchId, batchIndex: index, batchTotal: 3, fileLabel: input.fileName });
  const prepared = await Core.prepareImport(input, bundle);
  const stageResult = { sourceId: prepared.source.id, sourceVersionId: prepared.version.id };
  const request = { operationId: Core.id(), workspaceId: bundle.workspaceId, baseRevision: bundle.revision,
    changes: Core.buildImportChanges(bundle, prepared), stageId: stage.stageId, stageRevision: stage.revision, stageResult };
  return { stage, request };
}

test('batch item stores its exact source result with the receipt, survives reopen, and stays out of backup', async t => {
  const { storage, rows } = syncFixture(); t.after(() => storage.close());
  const bundle = await storage.createWorkspace('여러 파일 검증');
  const { stage, request } = await batchItem(storage, bundle);
  const stored = await storage.commitLocal(request);
  assert.equal(stored.status, 'stored');
  assert.deepEqual(await storage.commitLocal(request), stored);
  assert.equal((await storage.read(bundle.workspaceId)).revision, 1);
  const receipt = rows.get('operations').get(JSON.stringify([bundle.workspaceId, request.operationId]));
  assert.deepEqual(JSON.parse(receipt.payload).stageResult, request.stageResult);
  storage.close();
  const applied = await storage.getStage(stage.stageId);
  assert.equal(applied.state, 'applied');
  assert.deepEqual(applied.appliedResult, request.stageResult);
  assert.equal(applied.batchId, stage.batchId);
  assert.equal(applied.fileLabel, stage.fileLabel);
  applied.appliedResult.sourceId = Core.id();
  assert.deepEqual((await storage.getStage(stage.stageId)).appliedResult, request.stageResult);
  const backup = Core.makeBackup(await storage.read(bundle.workspaceId));
  assert.equal(backup.manifest.stagingIncluded, false);
  assert.equal(JSON.stringify(backup).includes(stage.batchId), false);
  assert.equal(JSON.stringify(backup).includes('appliedResult'), false);
});

test('legacy receipt payloads and applied stages without results remain compatible', async t => {
  const { storage, rows } = syncFixture(); t.after(() => storage.close());
  const bundle = await storage.createWorkspace();
  const { stage, request } = await batchItem(storage, bundle);
  const legacyRequest = { ...request }; delete legacyRequest.stageResult;
  const stored = await storage.commitLocal(legacyRequest);
  const row = rows.get('operations').get(JSON.stringify([bundle.workspaceId, request.operationId]));
  assert.deepEqual(Object.keys(JSON.parse(row.payload)).sort(), ['baseRevision', 'changes', 'stageId', 'stageRevision', 'workspaceId']);
  assert.deepEqual(await storage.commitLocal({ ...legacyRequest, stageResult: undefined }), stored);
  assert.equal(Object.hasOwn(await storage.getStage(stage.stageId), 'appliedResult'), false);
  assert.equal((await storage.commitLocal(request)).error.code, 'operation_mismatch');

  const next = await batchItem(storage, await storage.read(bundle.workspaceId), 1);
  assert.equal((await storage.commitLocal(next.request)).status, 'stored');
  const changed = { ...next.request, stageResult: { ...next.request.stageResult, sourceId: Core.id() } };
  assert.equal((await storage.commitLocal(changed)).error.code, 'operation_mismatch');
  assert.deepEqual((await storage.getStage(next.stage.stageId)).appliedResult, next.request.stageResult);
});

test('stage result rejects forged drafts, malformed IDs and sources outside the resulting workspace', async t => {
  const { storage, rows } = syncFixture(); t.after(() => storage.close());
  const original = await initialImport(storage);
  const { stage, request } = await batchItem(storage, original);
  await assert.rejects(storage.saveStage({ ...stage, appliedResult: request.stageResult }), { code: 'invalid_stage' });
  await assert.rejects(storage.saveStage({ ...stage, appliedResult: undefined }), { code: 'invalid_stage' });
  const originalReceiptCount = rows.get('operations').size;
  const invalid = [
    { ...request, stageId: undefined, stageRevision: undefined },
    { ...request, stageResult: null },
    { ...request, stageResult: { ...request.stageResult, sourceId: '' } },
    { ...request, stageResult: { ...request.stageResult, sourceId: [request.stageResult.sourceId] } },
    { ...request, stageResult: { sourceId: request.stageResult.sourceId } },
    { ...request, stageResult: { ...request.stageResult, workspaceId: original.workspaceId } },
    { ...request, stageResult: { sourceId: Core.id(), sourceVersionId: Core.id() } },
    { ...request, stageResult: { sourceId: original.sources[0].id, sourceVersionId: request.stageResult.sourceVersionId } }
  ];
  for (const item of invalid) {
    const rejected = await storage.commitLocal({ ...item, operationId: Core.id() });
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.error.code, 'invalid_stage_result');
  }
  assert.deepEqual(await storage.read(original.workspaceId), original);
  assert.deepEqual(await storage.getStage(stage.stageId), stage);
  assert.equal(rows.get('operations').size, originalReceiptCount);
});

test('duplicate import reuses Core-valid opaque IDs without adding a second original', async t => {
  const { storage } = syncFixture(); t.after(() => storage.close());
  const empty = Core.createWorkspace();
  const legacy = await Core.prepareImport({ origin: 'obsidian', title: '익명 자료', text: '검증할 원문입니다.' }, empty);
  legacy.source.id = legacy.version.sourceId = 'src_note';
  legacy.version.id = 'version_note';
  const original = Core.applyChanges(empty, Core.buildImportChanges(empty, legacy));
  await storage.installWorkspace(original);
  const input = { origin: 'obsidian', title: '익명 자료', text: '검증할 원문입니다.', existingSourceId: original.sources[0].id };
  const stage = await storage.saveStage({ ...draft(original, Core.id()), input });
  const prepared = await Core.prepareImport(input, original);
  assert.equal(prepared.match.kind, 'exact_duplicate');
  const request = { operationId: Core.id(), workspaceId: original.workspaceId, baseRevision: original.revision,
    changes: Core.buildImportChanges(original, prepared), stageId: stage.stageId, stageRevision: stage.revision,
    stageResult: { sourceId: prepared.source.id, sourceVersionId: prepared.version.id } };
  assert.equal((await storage.commitLocal(request)).status, 'stored');
  assert.equal((await storage.read(original.workspaceId)).sourceVersions.length, 1);
  assert.deepEqual((await storage.getStage(stage.stageId)).appliedResult, request.stageResult);
});

test('quota and transaction abort retain earlier batch results and pending drafts for identical retry', async t => {
  for (const failure of ['stage_write', 'receipt_write', 'transaction_completion']) await t.test(failure, async () => {
    const { storage, rows, control } = syncFixture();
    try {
      const original = await storage.createWorkspace();
      const first = await batchItem(storage, original);
      assert.equal((await storage.commitLocal(first.request)).status, 'stored');
      const afterFirst = await storage.read(original.workspaceId);
      const second = await batchItem(storage, afterFirst, 1, first.stage.batchId);
      const third = await batchItem(storage, afterFirst, 2, first.stage.batchId);
      if (failure === 'transaction_completion') control.failCompletion = true;
      else control.failWrite = { name: failure === 'stage_write' ? 'staging' : 'operations', method: failure === 'stage_write' ? 'put' : 'add' };
      const rejected = await storage.commitLocal(second.request);
      assert.equal(rejected.status, 'rejected');
      assert.equal(rejected.error.code, failure === 'transaction_completion' ? 'storage_aborted' : 'storage_quota');
      assert.deepEqual(await storage.read(original.workspaceId), afterFirst);
      assert.deepEqual(await storage.getStage(second.stage.stageId), second.stage);
      assert.deepEqual(await storage.getStage(third.stage.stageId), third.stage);
      assert.deepEqual((await storage.getStage(first.stage.stageId)).appliedResult, first.request.stageResult);
      assert.equal(rows.get('operations').size, 1);
      assert.equal((await storage.commitLocal(second.request)).status, 'stored');
      assert.deepEqual((await storage.getStage(second.stage.stageId)).appliedResult, second.request.stageResult);
      assert.equal(rows.get('operations').size, 2);
    } finally { storage.close(); }
  });
});

test('stale batch review cannot persist a result and a changed account aborts the whole item', async t => {
  const { storage: base, control, rows } = syncFixture(); t.after(() => base.close());
  const a = base.forAccount(accountA);
  const bundle = await a.createWorkspace();
  const { stage, request } = await batchItem(a, bundle);
  const edited = await a.saveStage({ ...stage, fileLabel: '검토 후 이름.md' });
  assert.equal((await a.commitLocal(request)).status, 'conflict');
  assert.deepEqual(await a.getStage(stage.stageId), edited);
  const currentRequest = { ...request, operationId: Core.id(), stageRevision: edited.revision };
  let b;
  control.afterWrite = ({ name }) => {
    if (name === 'staging') { control.afterWrite = null; b = base.forAccount(accountB); }
  };
  assert.equal((await a.commitLocal(currentRequest)).error.code, 'storage_scope_closed');
  assert.equal(rows.get('operations').size, 0);
  await assert.rejects(b.getStage(stage.stageId), { code: 'workspace_access_denied' });
  assert.equal((await b.commitLocal(currentRequest)).error.code, 'workspace_access_denied');
  const againA = base.forAccount(accountA);
  assert.deepEqual(await againA.read(bundle.workspaceId), bundle);
  assert.deepEqual(await againA.getStage(stage.stageId), edited);
  assert.equal((await againA.commitLocal(currentRequest)).status, 'stored');
  const againB = base.forAccount(accountB);
  assert.equal((await againB.commitLocal(currentRequest)).error.code, 'workspace_access_denied');
});

test('unowned copy remaps applied result references and preserves the original stage and backup boundary', async t => {
  const { storage: base } = syncFixture(); t.after(() => base.close());
  const original = await base.createWorkspace();
  const { stage, request } = await batchItem(base, original);
  assert.equal((await base.commitLocal(request)).status, 'stored');
  const before = await base.getStage(stage.stageId);
  const account = base.forAccount(accountA);
  const copy = await account.importUnownedWorkspace(original.workspaceId);
  const [copied] = await account.listStages(copy.workspaceId);
  assert.notEqual(copied.stageId, stage.stageId);
  assert.equal(copied.state, 'applied');
  assert.equal(copied.batchId, stage.batchId);
  assert.deepEqual(copied.appliedResult, { sourceId: copy.sources[0].id, sourceVersionId: copy.sourceVersions[0].id });
  assert.notEqual(copied.appliedResult.sourceId, request.stageResult.sourceId);
  assert.notEqual(copied.appliedResult.sourceVersionId, request.stageResult.sourceVersionId);
  assert.deepEqual(await base.getStage(stage.stageId), before);
  assert.equal(await account.getSyncState(copy.workspaceId), null);
  assert.equal(JSON.stringify(Core.makeBackup(copy)).includes('appliedResult'), false);
});

function workbenchFor(bundle) {
  const state = Workbench.empty(bundle.workspaceId);
  state.groups.push({ id: Core.id(), title: '다시 읽는 활동', versionIds: [bundle.sourceVersions[0].id, 'missing_version'] });
  state.page.entries.push({ id: Core.id(), title: '선택한 문장', parts: [{ versionId: bundle.sourceVersions[0].id, enabled: true }],
    note: '이 원문 버전을 다시 읽습니다.', pinned: true, enabled: true, showBody: true, showNote: true });
  return state;
}

test('workbench starts without a write and persists independently of bundle revisions, backups and sync', async t => {
  const { storage, rows } = syncFixture(); t.after(() => storage.close());
  const bundle = await initialImport(storage), binding = await uploaded(storage, bundle);
  const beforeMeta = structuredClone(rows.get('meta')), beforeSync = await storage.getSyncState(bundle.workspaceId);
  assert.deepEqual(await storage.readWorkbench(bundle.workspaceId), Workbench.empty(bundle.workspaceId));
  assert.deepEqual(rows.get('meta'), beforeMeta);
  const input = workbenchFor(bundle), expected = structuredClone(input), events = [];
  storage.subscribe(bundle.workspaceId, event => events.push(event));
  const promise = storage.saveWorkbench(bundle.workspaceId, input, 0);
  input.page.entries[0].note = '저장 요청 뒤 바꾼 값';
  const saved = await promise;
  assert.deepEqual(saved, { ...expected, revision: 1 });
  assert.deepEqual(events, [{ type: 'workbench_changed', workspaceId: bundle.workspaceId, revision: 1 }]);
  assert.deepEqual(await storage.read(bundle.workspaceId), bundle);
  assert.deepEqual(await storage.getSyncState(bundle.workspaceId), beforeSync);
  assert.equal(await storage.prepareSyncUpload(bundle.workspaceId, binding), null);
  assert.equal(JSON.stringify(Core.makeBackup(bundle)).includes(expected.groups[0].id), false);
  storage.close(); assert.deepEqual(await storage.readWorkbench(bundle.workspaceId), saved);
  saved.groups = []; assert.equal((await storage.readWorkbench(bundle.workspaceId)).groups.length, 1);
});

test('workbench snapshot reads both validated halves in one transaction and refuses corrupt metadata', async t => {
  const { storage, rows, control } = syncFixture(); t.after(() => storage.close());
  const bundle = await initialImport(storage), saved = await storage.saveWorkbench(bundle.workspaceId, workbenchFor(bundle), 0);
  const before = control.transactions.length, snapshot = await storage.readWorkbenchSnapshot(bundle.workspaceId);
  assert.deepEqual(snapshot, { bundle, workbench: saved });
  assert.deepEqual(control.transactions.slice(before), [{ names: ['bundles', 'meta'], mode: 'readonly' }]);
  snapshot.workbench.page.title = '반환 사본'; snapshot.bundle.title = '반환 사본';
  assert.deepEqual(await storage.readWorkbenchSnapshot(bundle.workspaceId), { bundle, workbench: saved });
  const key = JSON.stringify(`workbench:${bundle.workspaceId}`), row = structuredClone(rows.get('meta').get(key));
  row.value.workspaceId = 'wrong_workspace'; rows.get('meta').set(key, row);
  await assert.rejects(storage.readWorkbenchSnapshot(bundle.workspaceId), { code: 'workspace_mismatch' });
  await assert.rejects(storage.saveWorkbench(bundle.workspaceId, saved, saved.revision), { code: 'workspace_mismatch' });
  assert.deepEqual(rows.get('meta').get(key), row);
  assert.deepEqual(await storage.read(bundle.workspaceId), bundle);
});

test('two workbench readers cannot overwrite a newer revision or submit another workspace configuration', async t => {
  const { storage, idb } = syncFixture();
  const second = createStorage({ idb, core: Core, workbench: Workbench, channelFactory: null });
  t.after(() => { storage.close(); second.close(); });
  const bundle = await initialImport(storage), first = await storage.readWorkbench(bundle.workspaceId), stale = await second.readWorkbench(bundle.workspaceId);
  first.page.intro = '첫 탭에서 변경'; stale.page.intro = '이전 버전에서 변경';
  const saved = await storage.saveWorkbench(bundle.workspaceId, first, first.revision);
  await assert.rejects(second.saveWorkbench(bundle.workspaceId, stale, stale.revision), { code: 'workbench_conflict' });
  await assert.rejects(second.saveWorkbench(bundle.workspaceId, saved, 0), { code: 'workbench_conflict' });
  await assert.rejects(storage.saveWorkbench(bundle.workspaceId, { ...saved, workspaceId: 'wrong_workspace' }, saved.revision), { code: 'workspace_mismatch' });
  assert.deepEqual(await second.readWorkbench(bundle.workspaceId), saved);
  assert.deepEqual(stale.page.intro, '이전 버전에서 변경');
});

test('failed workbench writes and transaction completion preserve prior data and emit no success event', async t => {
  for (const fail of ['quota', 'completion']) await t.test(fail, async () => {
    const { storage, control } = syncFixture();
    try {
      const bundle = await initialImport(storage), saved = await storage.saveWorkbench(bundle.workspaceId, workbenchFor(bundle), 0), events = [];
      storage.subscribe(bundle.workspaceId, event => events.push(event));
      const input = { ...structuredClone(saved), page: { ...saved.page, intro: '아직 저장되지 않은 메모' } };
      if (fail === 'quota') control.failWrite = { name: 'meta', method: 'put' }; else control.failCompletion = true;
      await assert.rejects(storage.saveWorkbench(bundle.workspaceId, input, saved.revision), { code: fail === 'quota' ? 'storage_quota' : 'storage_aborted' });
      assert.deepEqual(await storage.readWorkbench(bundle.workspaceId), saved); assert.deepEqual(await storage.read(bundle.workspaceId), bundle);
      assert.deepEqual(events, []);
      assert.equal((await storage.saveWorkbench(bundle.workspaceId, input, saved.revision)).revision, saved.revision + 1);
    } finally { storage.close(); }
  });
});

test('combined copy installation atomically owns bundle, workbench and active pointer without replacing originals', async t => {
  const { storage: base, control } = syncFixture(); t.after(() => base.close());
  const storage = base.forAccount(accountA), original = await initialImport(storage);
  const state = await storage.saveWorkbench(original.workspaceId, workbenchFor(original), 0);
  const candidate = await Workbench.restoreBackup(Workbench.makeBackup(original, state));
  for (const point of ['configuration', 'active', 'completion']) {
    if (point === 'completion') control.failCompletion = true;
    else control.afterWrite = ({ name, value }) => {
      if (name === 'meta' && (point === 'configuration' ? value.key.startsWith('workbench:') : value.key.startsWith('activeWorkspace:'))) {
        control.afterWrite = null; throw new DOMException('anonymous interrupted copy', 'AbortError');
      }
    };
    await assert.rejects(storage.installWorkbenchCopy(candidate), { code: 'storage_aborted' });
    assert.equal(await storage.getActive(), original.workspaceId);
    assert.equal((await storage.listWorkspaces()).length, 1);
    assert.deepEqual(await storage.readWorkbenchSnapshot(original.workspaceId), { bundle: original, workbench: state });
  }
  const installed = await storage.installWorkbenchCopy(candidate);
  assert.deepEqual(installed, candidate); assert.equal(await storage.getActive(), candidate.bundle.workspaceId);
  assert.deepEqual(await storage.readWorkbenchSnapshot(candidate.bundle.workspaceId), candidate);
  assert.equal(await storage.getSyncState(candidate.bundle.workspaceId), null);
  await assert.rejects(storage.installWorkbenchCopy(candidate), { code: 'workspace_exists' });
  assert.deepEqual(await storage.readWorkbenchSnapshot(original.workspaceId), { bundle: original, workbench: state });
});

test('workbench account isolation rejects foreign reads and account replacement aborts late writes and copies', async t => {
  const { storage: base, control, rows } = syncFixture(); t.after(() => base.close());
  let a = base.forAccount(accountA), original = await initialImport(a);
  const state = await a.saveWorkbench(original.workspaceId, workbenchFor(original), 0);
  let b = base.forAccount(accountB);
  await assert.rejects(a.readWorkbench(original.workspaceId), { code: 'storage_scope_closed' });
  await assert.rejects(b.readWorkbench(original.workspaceId), { code: 'workspace_access_denied' });
  await assert.rejects(b.readWorkbenchSnapshot(original.workspaceId), { code: 'workspace_access_denied' });
  await assert.rejects(b.saveWorkbench(original.workspaceId, state, state.revision), { code: 'workspace_access_denied' });
  for (const mode of ['save', 'install']) {
    a = base.forAccount(accountA);
    const events = []; a.subscribe(original.workspaceId, event => events.push(event));
    const before = structuredClone(rows.get('meta'));
    const candidate = await Workbench.restoreBackup(Workbench.makeBackup(original, state));
    control.afterWrite = ({ name, value }) => {
      if (name === 'meta' && value.key.startsWith('workbench:')) { control.afterWrite = null; b = base.forAccount(accountB); }
    };
    const pending = mode === 'save' ? a.saveWorkbench(original.workspaceId, { ...state, page: { ...state.page, intro: '늦은 변경' } }, state.revision) : a.installWorkbenchCopy(candidate);
    await assert.rejects(pending, { code: 'storage_scope_closed' });
    assert.deepEqual(rows.get('meta'), before); assert.deepEqual(events, []); assert.deepEqual(await b.listWorkspaces(), []);
    assert.equal(rows.get('bundles').size, 1);
  }
  a = base.forAccount(accountA);
  assert.deepEqual(await a.readWorkbenchSnapshot(original.workspaceId), { bundle: original, workbench: state });
  const anotherProject = base.forAccount({ ...accountA, projectUrl: 'https://different-project.supabase.co' });
  await assert.rejects(anotherProject.readWorkbench(original.workspaceId), { code: 'workspace_access_denied' });
});

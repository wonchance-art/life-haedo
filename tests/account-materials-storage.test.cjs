'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createStorage } = require('../assets/life/storage.js'), Core = require('../assets/life/core.js');
const owner = { projectUrl: 'https://account-materials-test.supabase.co', userId: 'synthetic-owner' };
const copy = value => structuredClone(value), key = value => JSON.stringify(value);

// Decision/rollback fixture, not a substitute for native IndexedDB. Transactions
// serialize, own their working rows and become visible only at completion.
function adapter() {
  const rows = new Map(), paths = new Map(), control = { writes: [], fail: null, afterWrite: null }; let tail = Promise.resolve();
  return { rows, control, idb: { async openDB(_name, _version, callbacks) {
    let closed = false;
    const db = {
      objectStoreNames: { contains: name => rows.has(name) },
      createObjectStore(name, options) { rows.set(name, new Map()); paths.set(name, options.keyPath); return { createIndex() {} }; },
      close() { closed = true; },
      transaction(names, mode) {
        if (closed) throw new DOMException('closed', 'InvalidStateError');
        let resolve, reject, ended = false, working;
        const done = new Promise((yes, no) => { resolve = yes; reject = no; }), previous = tail;
        tail = done.catch(() => {});
        function abort(error = new DOMException('aborted', 'AbortError')) { if (!ended) { ended = true; reject(error); } }
        const ready = previous.then(() => {
          if (ended) return; working = new Map(names.map(name => [name, copy(rows.get(name))]));
          setImmediate(() => { if (ended) return; ended = true; if (mode === 'readwrite') for (const [name, data] of working) rows.set(name, data); resolve(); });
        });
        async function request(name, method, value) {
          await ready; if (ended) throw new DOMException('inactive', 'AbortError');
          const store = working.get(name);
          if (method === 'get') return copy(store.get(key(value)));
          if (method === 'getAll') return copy([...store.values()]);
          assert.equal(mode, 'readwrite');
          const path = paths.get(name), id = Array.isArray(path) ? path.map(field => value[field]) : value[path];
          const write = { name, method, id, value }; control.writes.push(copy(write));
          if (control.fail?.(write)) { control.fail = null; const error = new DOMException('quota', 'QuotaExceededError'); abort(error); throw error; }
          if (method === 'add' && store.has(key(id))) throw new DOMException('duplicate', 'ConstraintError');
          store.set(key(id), copy(value)); control.afterWrite?.(write); return id;
        }
        return { done, abort, objectStore(name) { return {
          get: value => request(name, 'get', value), getAll: () => request(name, 'getAll'),
          put: value => request(name, 'put', value), add: value => request(name, 'add', value)
        }; } };
      }
    };
    if (!rows.size) callbacks.upgrade(db, 0, 1); return db;
  } } };
}
async function fixture(t) {
  const f = adapter(), options = { idb: f.idb, core: Core, channelFactory: null, account: owner };
  const a = createStorage(options), b = createStorage(options), foreign = createStorage({ ...options, account: { ...owner, userId: 'synthetic-other' } });
  t.after(() => { a.close(); b.close(); foreign.close(); });
  const bundle = await a.createWorkspace('기존 내 자료');
  const source = await Core.prepareImport({ origin: 'obsidian', title: '원래 자료', text: '정확한 기존 원문\r\n🌿', authorRelation: 'other', coverage: 'full_text' }, bundle);
  const seed = await a.commitLocal({ workspaceId: bundle.workspaceId, baseRevision: 0, operationId: Core.id(), changes: Core.buildImportChanges(bundle, source) });
  assert.equal(seed.status, 'stored');
  const local = await a.read(bundle.workspaceId), registration = { id: Core.id(), revision: 1, sourceWorkspaceId: Core.id(), sourceRevision: 3, fingerprint: 'ab'.repeat(32) };
  const incoming = await Core.prepareImport({ origin: 'obsidian', title: '등록 자료', text: '정확한 새 원문\r\n🪷', authorRelation: 'other', coverage: 'full_text' }, local);
  const request = { workspaceId: local.workspaceId, baseRevision: local.revision, operationId: Core.id(), changes: { put: { sources: [incoming.source], sourceVersions: [incoming.version], links: [] } }, accountMaterialRegistration: registration };
  return { ...f, a, b, foreign, ws: local.workspaceId, local, incoming, registration, request,
    markerKey: `account-material:${local.workspaceId}:${registration.id}` };
}

test('registration keeps source identities and exact versions while committing its owner receipt with the existing sync path', async t => {
  const f = await fixture(t), notifications = [];
  await f.a.bindSync(f.ws, { ...owner, remoteId: f.ws });
  const sync = await f.a.getSyncState(f.ws);
  f.a.subscribe(f.ws, event => notifications.push(event));
  const stored = await f.a.commitLocal(f.request); assert.equal(stored.status, 'stored');
  const bundle = await f.a.read(f.ws); assert.equal(bundle.revision, f.local.revision + 1);
  assert.deepEqual(bundle.sources[0], f.local.sources[0]); assert.deepEqual(bundle.sourceVersions[0], f.local.sourceVersions[0]);
  assert.deepEqual(bundle.sources[1], f.incoming.source); assert.deepEqual(bundle.sourceVersions[1], f.incoming.version);
  assert.deepEqual((await f.a.getSyncState(f.ws)).outbox, sync.outbox);
  assert.equal((await f.a.getSyncState(f.ws)).enabled, true);
  const marker = await f.a.readAccountMaterialRegistration(f.ws, f.registration.id);
  assert.deepEqual(marker, { owner, descriptor: f.registration, result: stored });
  marker.descriptor.fingerprint = '00'.repeat(32); assert.deepEqual((await f.a.readAccountMaterialRegistration(f.ws, f.registration.id)).descriptor, f.registration);
  assert.equal(notifications.filter(event => event.type === 'changed').length, 1);
});

test('lost response and new-operation replay preserve every row; a changed descriptor cannot reuse the registration', async t => {
  const f = await fixture(t), stored = await f.a.commitLocal(f.request), before = copy(f.rows), writes = f.control.writes.length;
  assert.deepEqual(await f.a.commitLocal(f.request), stored);
  const repeated = await f.b.commitLocal({ ...f.request, operationId: Core.id() });
  assert.equal(repeated.status, 'already_registered'); assert.equal(repeated.revision, stored.revision);
  assert.deepEqual(f.rows, before); assert.equal(f.control.writes.length, writes);
  const changed = await f.b.commitLocal({ ...f.request, operationId: Core.id(), accountMaterialRegistration: { ...f.registration, sourceRevision: 4 } });
  assert.equal(changed.status, 'rejected'); assert.equal(changed.error.code, 'account_material_registration_changed'); assert.deepEqual(f.rows, before);
  const mismatch = await f.a.commitLocal({ ...f.request, changes: {} });
  assert.equal(mismatch.error.code, 'operation_mismatch'); assert.deepEqual(f.rows, before);
});

test('a first marker-only registration does not bump the bundle, change sync state, or notify a material change', async t => {
  const f = await fixture(t), events = [];
  await f.a.bindSync(f.ws, { ...owner, remoteId: f.ws });
  const bundle = await f.a.read(f.ws), sync = await f.a.getSyncState(f.ws), active = await f.a.getActive();
  f.a.subscribe(f.ws, event => events.push(event));
  const stored = await f.a.commitLocal({ ...f.request, changes: { put: { sources: bundle.sources, sourceVersions: bundle.sourceVersions } } });
  assert.equal(stored.status, 'stored'); assert.equal(stored.revision, bundle.revision);
  assert.deepEqual(await f.a.read(f.ws), bundle); assert.deepEqual(await f.a.getSyncState(f.ws), sync); assert.equal(await f.a.getActive(), active);
  assert.deepEqual(events, []); assert.deepEqual((await f.a.readAccountMaterialRegistration(f.ws, f.registration.id)).result, stored);
  const receipt = f.rows.get('operations').get(key([f.ws, f.request.operationId]));
  assert.deepEqual(JSON.parse(receipt.payload).accountMaterialRegistration, f.registration);
  const old = [...f.rows.get('operations').values()].find(row => row.operationId !== f.request.operationId);
  assert.equal(Object.hasOwn(JSON.parse(old.payload), 'accountMaterialRegistration'), false);
});

test('marker and operation failures roll back the original bundle, sync metadata and every new receipt before identical retry', async t => {
  for (const point of ['marker', 'operation']) {
    const f = await fixture(t); await f.a.bindSync(f.ws, { ...owner, remoteId: f.ws });
    const before = copy(f.rows), notifications = []; f.a.subscribe(f.ws, event => notifications.push(event));
    f.control.fail = write => point === 'marker' ? write.name === 'meta' && write.id === f.markerKey : write.name === 'operations';
    const failed = await f.a.commitLocal(f.request); assert.equal(failed.status, 'rejected'); assert.equal(failed.error.code, 'storage_quota');
    assert.deepEqual(f.rows, before); assert.deepEqual(notifications, []); assert.equal(await f.a.readAccountMaterialRegistration(f.ws, f.registration.id), null);
    assert.equal((await f.a.commitLocal(f.request)).status, 'stored'); assert.equal((await f.a.read(f.ws)).sources.length, 2);
  }
});

test('two tabs share the CAS and marker; account disposal aborts the complete registration and foreign access stays denied', async t => {
  const f = await fixture(t), other = { ...f.request, operationId: Core.id(), accountMaterialRegistration: { ...f.registration, id: Core.id() } };
  const results = await Promise.all([f.a.commitLocal(f.request), f.b.commitLocal(other)]);
  assert.deepEqual(results.map(row => row.status).sort(), ['conflict', 'stored']);
  assert.equal((await f.a.read(f.ws)).sources.length, 2); assert.equal(await f.a.readAccountMaterialRegistration(f.ws, other.accountMaterialRegistration.id), null);
  await assert.rejects(f.foreign.readAccountMaterialRegistration(f.ws, f.registration.id), { code: 'workspace_access_denied' });
  assert.equal((await f.foreign.commitLocal(f.request)).error.code, 'workspace_access_denied');
  const g = await fixture(t), before = copy(g.rows);
  g.control.afterWrite = write => { if (write.name === 'meta' && write.id === g.markerKey) g.a.dispose(); };
  const cancelled = await g.a.commitLocal(g.request); assert.equal(cancelled.status, 'rejected'); assert.equal(cancelled.error.code, 'storage_scope_closed');
  assert.deepEqual(g.rows, before); assert.equal((await g.b.commitLocal(g.request)).status, 'stored');
});

test('registration is append-only and cannot remove records, copy private records, replace old metadata or share a stage handoff', async t => {
  const f = await fixture(t), before = copy(f.rows);
  const variants = [
    { changes: { remove: { records: [] } } },
    { changes: { put: { records: [] } } },
    { changes: { put: { sources: [{ ...f.local.sources[0], title: '덮어쓰기', revision: 2 }] } } },
    { stageId: Core.id(), stageRevision: 0 }
  ];
  for (const change of variants) {
    const result = await f.a.commitLocal({ ...f.request, ...change, operationId: Core.id() });
    assert.equal(result.status, 'rejected'); assert.match(result.error.code, /^(invalid_account_material_registration|account_material_registration_changed)$/);
    assert.deepEqual(f.rows, before);
  }
});

test('commit rechecks the active target and pending source sync while a completed receipt remains replayable', async t => {
  const f = await fixture(t); await f.a.createWorkspace('다른 활성 공간');
  const moved = copy(f.rows), rejected = await f.a.commitLocal(f.request);
  assert.equal(rejected.error.code, 'account_material_target_changed'); assert.deepEqual(f.rows, moved);
  const g = await fixture(t); await g.a.bindSync(g.ws, { ...owner, remoteId: g.ws });
  await g.a.prepareSyncUpload(g.ws, { ...owner, remoteId: g.ws });
  const pending = copy(g.rows), busy = await g.a.commitLocal(g.request);
  assert.equal(busy.error.code, 'account_material_sync_busy'); assert.deepEqual(g.rows, pending);
  const h = await fixture(t), stored = await h.a.commitLocal(h.request);
  await h.a.bindSync(h.ws, { ...owner, remoteId: h.ws }); await h.a.prepareSyncUpload(h.ws, { ...owner, remoteId: h.ws });
  await h.a.createWorkspace('완료 뒤 이동한 공간');
  const committed = copy(h.rows);
  assert.deepEqual(await h.a.commitLocal(h.request), stored);
  assert.equal((await h.b.commitLocal({ ...h.request, operationId: Core.id() })).status, 'already_registered');
  assert.deepEqual(h.rows, committed);
});

test('an enabled target cannot acquire an oversized registration after its sync setting changes', async t => {
  const f = await fixture(t), text = 'x'.repeat(Core.MAX_IMPORT_BYTES - 32);
  const prepared = await Core.prepareImport({ origin: 'obsidian', title: '큰 원문', text, authorRelation: 'other', coverage: 'full_text' }, f.local);
  const sources = [], sourceVersions = [];
  for (let i = 0; i < 17; i++) {
    const id = Core.id(); sources.push({ ...prepared.source, id, title: `서로 다른 원천 ${i}` });
    sourceVersions.push({ ...prepared.version, id: Core.id(), sourceId: id });
  }
  // The service may have reviewed an unconnected target before another tab
  // enabled source sync. Its final storage transaction must inspect that state.
  await f.b.bindSync(f.ws, { ...owner, remoteId: f.ws }); const before = copy(f.rows);
  const result = await f.a.commitLocal({ ...f.request, changes: { put: { sources, sourceVersions } } });
  assert.equal(result.status, 'rejected'); assert.equal(result.error.code, 'snapshot_too_large'); assert.deepEqual(f.rows, before);
  assert.equal(await f.a.readAccountMaterialRegistration(f.ws, f.registration.id), null);
});

test('an impossible registration revision or inconsistent operation receipt cannot claim a completed intake', async t => {
  const f = await fixture(t); assert.equal((await f.a.commitLocal(f.request)).status, 'stored');
  const marker = f.rows.get('meta').get(key(f.markerKey)), saved = copy(marker);
  marker.value.result.revision += 1;
  await assert.rejects(f.a.readAccountMaterialRegistration(f.ws, f.registration.id), { code: 'invalid_account_material_registration' });
  assert.equal((await f.a.commitLocal({ ...f.request, operationId: Core.id() })).error.code, 'invalid_account_material_registration');
  f.rows.get('meta').set(key(f.markerKey), saved);
  const receipt = f.rows.get('operations').get(key([f.ws, f.request.operationId])); receipt.result.revision -= 1;
  const before = copy(f.rows), result = await f.a.commitLocal(f.request);
  assert.equal(result.error.code, 'invalid_account_material_registration'); assert.deepEqual(f.rows, before);
});

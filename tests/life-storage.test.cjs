'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStorage } = require('../assets/life/storage.js');
const Core = require('../assets/life/core.js');
const Workbench = require('../assets/life/workbench.js');
const Writing = require('../assets/life/writing.js');

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
          function requestWrite(method, value) {
            // Native IDB requests can throw before returning their promise.
            control.beforeWrite?.({ name, method, value });
            return write(method, value);
          }
          return {
            async get(key) { return structuredClone(map.get(encode(key))); },
            async getAll() { return structuredClone([...map.values()]); },
            async getAllKeys() { return [...map.keys()].map(key => JSON.parse(key)); },
            put: value => requestWrite('put', value), add: value => requestWrite('add', value), delete: key => requestWrite('delete', key),
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
test('rich-post archive CAS, attachment preservation and index writes are atomic; format downgrade and foreign scope cannot erase metadata',async t=>{
 const {storage:base,control}=syncFixture();t.after(()=>base.close());const M=require('../assets/life/photo-post.js'),a=base.forAccount(accountA),bundle=await initialImport(a),w=bundle.workspaceId;
 const d=M.create(Core.id);d.status='saved';d.title='여행과 책';d.ops=[{insert:'보존할 본문\n'}];d.attachments=[{type:'book',title:'산책의 기록',creator:'익명 저자',url:'https://example.org/book'}];const saved=await a.savePhotoPost(w,d,0);
 const legacy=structuredClone(saved);legacy.format='life-photo-post-v1';delete legacy.attachments;delete legacy.archived;await assert.rejects(a.savePhotoPost(w,legacy,saved.revision),{code:'photo_post_update_required'});
 const next=structuredClone(saved);next.archived=true;next.updatedAt=new Date(Date.parse(saved.updatedAt)+1000).toISOString();control.failCompletion=true;await assert.rejects(a.savePhotoPost(w,next,saved.revision),{code:'storage_aborted'});assert.deepEqual(await a.readPhotoPost(w,saved.id),saved);assert.equal((await a.listPhotoPosts(w))[0].archived,false);
 const archived=await a.savePhotoPost(w,next,saved.revision);assert.equal((await a.listPhotoPosts(w))[0].archived,true);assert.deepEqual(archived.attachments,saved.attachments);await assert.rejects(a.savePhotoPost(w,saved,saved.revision),{code:'photo_post_conflict'});
 const restored=structuredClone(archived);restored.archived=false;const active=await a.savePhotoPost(w,restored,archived.revision);assert.equal(active.archived,false);assert.deepEqual(active.ops,saved.ops);assert.deepEqual(active.attachments,saved.attachments);
 const b=base.forAccount(accountB);await assert.rejects(b.readPhotoPost(w,saved.id),{code:'workspace_access_denied'});await assert.rejects(b.savePhotoPost(w,restored,restored.revision),{code:'workspace_access_denied'});
});
test('nine-slot boards have independent atomic CAS, completion rollback and account ownership', async t => {
  const {storage:base,control}=syncFixture();t.after(()=>base.close());
  const M=require('../assets/life/nine-board.js'),a=base.forAccount(accountA),bundle=await initialImport(a),original=await a.readWorkbenchSnapshot(bundle.workspaceId);
  const empty=await a.readNineBoard(bundle.workspaceId);assert.deepEqual(empty,M.empty(bundle.workspaceId));
  const input=structuredClone(empty);input.boards=[M.create(()=>Core.id())];input.boards[0].title='대표 선택';
  const saved=await a.saveNineBoard(bundle.workspaceId,input,0);assert.equal(saved.revision,1);assert.equal(input.revision,0);
  await assert.rejects(a.saveNineBoard(bundle.workspaceId,input,0),{code:'nine_board_conflict'});assert.deepEqual(await a.readNineBoard(bundle.workspaceId),saved);
  const next=structuredClone(saved);next.boards[0].title='실패해도 보존';control.failCompletion=true;await assert.rejects(a.saveNineBoard(bundle.workspaceId,next,1),{code:'storage_aborted'});assert.deepEqual(await a.readNineBoard(bundle.workspaceId),saved);assert.deepEqual(await a.readWorkbenchSnapshot(bundle.workspaceId),original);
  const b=base.forAccount(accountB);await assert.rejects(b.readNineBoard(bundle.workspaceId),{code:'workspace_access_denied'});await assert.rejects(b.saveNineBoard(bundle.workspaceId,next,1),{code:'workspace_access_denied'});
  const again=base.forAccount(accountA),before=await again.readNineBoard(bundle.workspaceId);
  control.afterWrite=({name,value})=>{if(name==='meta'&&value.key.startsWith('nine-board:')){control.afterWrite=null;base.forAccount(accountB);}};
  await assert.rejects(again.saveNineBoard(bundle.workspaceId,next,1),{code:'storage_scope_closed'});
  assert.deepEqual(await base.forAccount(accountA).readNineBoard(bundle.workspaceId),before);
});
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
async function naverStorageFixture() {
  const F = require('./fixtures/naver-media.cjs'), Capture = require('../assets/life/naver-capture.js');
  const fixture = syncFixture(), account = { projectUrl: 'https://synthetic.example.invalid', userId: F.OWNER };
  const storage = fixture.storage.forAccount(account), original = await storage.createWorkspace('기존 자료');
  const old = await Core.prepareImport({ origin: 'naver_blog', title: '옛 일부 원문',
    url: 'http://m.blog.naver.com/fixture_blog/123456789012?from=manual', text: '첫 원문\r\n🌱 옛 구절', coverage: 'partial' }, original);
  const receipt = await storage.commitLocal({ workspaceId: original.workspaceId, baseRevision: original.revision,
    operationId: Core.id(), changes: Core.buildImportChanges(original, old, [{ start: 0, end: 3, note: '보존할 개인 메모' }]) });
  assert.equal(receipt.status, 'stored');
  const before = await storage.read(original.workspaceId), data = await F.fixture(before);
  const prepared = await Core.prepareImport(Capture.toImportInput(data.payload, { existingSourceId: old.source.id, existingSourceUrl: old.source.url }), before);
  data.attachment.sourceId = prepared.source.id; data.attachment.sourceVersionId = prepared.version.id;
  const request = { workspaceId: before.workspaceId, baseRevision: before.revision, operationId: Core.id(),
    changes: Core.buildImportChanges(before, prepared), attachment: data.attachment };
  return { ...fixture, account, scoped: storage, before, data, request };
}
test('Naver source version, original photos and exact receipt commit atomically without changing old quotes', async t => {
  const F = require('./fixtures/naver-media.cjs'), restore = F.installDecoder(); t.after(restore);
  const f = await naverStorageFixture(); t.after(() => f.storage.close());
  const result = await f.scoped.commitNaverCapture(f.request);
  assert.equal(result.status, 'stored');
  assert.deepEqual(await f.scoped.commitNaverCapture(f.request), result);
  const after = await f.scoped.read(f.before.workspaceId);
  assert.equal(after.sources.length, 1); assert.equal(after.sourceVersions.length, 2);
  assert.deepEqual(after.sourceVersions[0], f.before.sourceVersions[0]); assert.deepEqual(after.records, f.before.records);
  const media = await f.scoped.readNaverCapture(after.workspaceId, f.request.attachment.sourceVersionId);
  assert.equal(media.capture.capture_hash, f.data.attachment.capture.capture_hash);
  assert.equal(media.localOnly, false);
  assert.deepEqual(new Uint8Array(await media.photos[0].blob.arrayBuffer()), F.bytes);
  const conflict = await f.scoped.commitNaverCapture({ ...f.request, operationId: Core.id() });
  assert.equal(conflict.status, 'conflict');
  const mismatched = structuredClone(f.request); mismatched.changes.put.sources[0].title = '다른 요청';
  assert.equal((await f.scoped.commitNaverCapture(mismatched)).error.code, 'operation_mismatch');
  const other = f.storage.forAccount({ ...f.account, userId: '99999999-9999-4999-8999-999999999999' });
  await assert.rejects(other.readNaverCapture(after.workspaceId, media.sourceVersionId), { code: 'workspace_access_denied' });
});
test('Naver commit completion abort, write failure and late navigation leave no version, sidecar or receipt', async t => {
  const F = require('./fixtures/naver-media.cjs'), restore = F.installDecoder(); t.after(restore);
  for (const kind of ['completion', 'bundle', 'late']) {
    const f = await naverStorageFixture(); t.after(() => f.storage.close()); let current = true;
    if (kind === 'completion') f.control.failCompletion = true;
    if (kind === 'bundle') f.control.failWrite = { name: 'bundles', method: 'put' };
    if (kind === 'late') f.control.afterWrite = ({ name, value }) => { if (name === 'meta' && value.key?.startsWith('naver-capture:')) current = false; };
    const result = await f.scoped.commitNaverCapture(f.request, { isCurrent: () => current });
    assert.equal(result.status, 'rejected'); f.control.afterWrite = null;
    assert.deepEqual(await f.scoped.read(f.before.workspaceId), f.before);
    assert.equal(await f.scoped.readNaverCapture(f.before.workspaceId, f.request.attachment.sourceVersionId), null);
    assert.equal(f.rows.get('operations').has(JSON.stringify([f.before.workspaceId, f.request.operationId])), false);
    assert.equal((await f.scoped.commitNaverCapture(f.request)).status, 'stored');
  }
});
test('Naver portable installation is a new private workspace and rolls owner/active/media back on abort', async t => {
  const F = require('./fixtures/naver-media.cjs'), restore = F.installDecoder(); t.after(restore);
  const Media = require('../assets/life/naver-media.js'), f = await naverStorageFixture(); t.after(() => f.storage.close());
  assert.equal((await f.scoped.commitNaverCapture(f.request)).status, 'stored');
  const bundle = await f.scoped.read(f.before.workspaceId), attachment = await f.scoped.readNaverCapture(bundle.workspaceId, f.request.attachment.sourceVersionId);
  const archive = await Media.pack({ bundle, attachment }), source = await Media.read(archive), next = await Media.copy(source);
  const previousActive = await f.scoped.getActive(), previousList = await f.scoped.listWorkspaces();
  f.control.failCompletion = true;
  await assert.rejects(f.scoped.installNaverCaptureCopy(next), { code: 'storage_aborted' });
  assert.equal(await f.scoped.getActive(), previousActive); assert.deepEqual(await f.scoped.listWorkspaces(), previousList);
  assert.equal(f.rows.get('meta').has(JSON.stringify('owner:' + next.bundle.workspaceId)), false);
  const restored = await f.scoped.installNaverCaptureCopy(next);
  assert.equal(restored.attachment.localOnly, true); assert.equal(await f.scoped.getActive(), next.bundle.workspaceId);
  const read = await f.scoped.readNaverCapture(next.bundle.workspaceId, next.attachment.sourceVersionId);
  assert.equal(read.capture.payload.photos[0].storagePath, null); assert.deepEqual(restored.bundle.records, []);
  await assert.rejects(f.scoped.installNaverCaptureCopy(next), { code: 'workspace_exists' });
  assert.equal((await f.scoped.commitNaverCapture({ ...f.request, attachment: read })).status, 'rejected');
});
test('a changed Naver photo declaration cannot replace one source version; explicit new version preserves both captures', async t => {
  const F = require('./fixtures/naver-media.cjs'), restore = F.installDecoder(); t.after(restore);
  const Capture = require('../assets/life/naver-capture.js'), f = await naverStorageFixture(); t.after(() => f.storage.close());
  assert.equal((await f.scoped.commitNaverCapture(f.request)).status, 'stored');
  const before = await f.scoped.read(f.before.workspaceId), prior = await f.scoped.readNaverCapture(before.workspaceId, f.request.attachment.sourceVersionId);
  const changed = structuredClone(prior); changed.capture.id = Core.id(); changed.capture.payload.photos[0].caption = '명시적으로 바뀐 사진 설명';
  changed.capture.capture_hash = await Capture.fingerprint(changed.capture.payload);
  const input = Capture.toImportInput(changed.capture.payload, { existingSourceId: changed.sourceId, existingSourceUrl: before.sources[0].url });
  const duplicate = await Core.prepareImport(input, before);
  assert.equal(duplicate.version.id, prior.sourceVersionId);
  const denied = await f.scoped.commitNaverCapture({ workspaceId: before.workspaceId, baseRevision: before.revision,
    operationId: Core.id(), changes: Core.buildImportChanges(before, duplicate), attachment: changed });
  assert.equal(denied.error.code, 'immutable_naver_capture');
  assert.deepEqual(await f.scoped.read(before.workspaceId), before);
  assert.deepEqual(await f.scoped.readNaverCapture(before.workspaceId, prior.sourceVersionId), prior);
  const fresh = await Core.prepareImport(input, before, { forceNewVersion: true });
  changed.sourceVersionId = fresh.version.id;
  assert.equal((await f.scoped.commitNaverCapture({ workspaceId: before.workspaceId, baseRevision: before.revision,
    operationId: Core.id(), changes: Core.buildImportChanges(before, fresh), attachment: changed })).status, 'stored');
  assert.deepEqual(await f.scoped.readNaverCapture(before.workspaceId, prior.sourceVersionId), prior);
  assert.equal((await f.scoped.readNaverCapture(before.workspaceId, fresh.version.id)).capture.capture_hash, changed.capture.capture_hash);
});
test('workspace pair installation is atomic across second-write failure, duplicate IDs and account replacement', async t => {
  const { storage: base, control } = syncFixture(); t.after(() => base.close());
  let a = base.forAccount(accountA); const previous = await a.createWorkspace('기존 자료');
  const pair = [Core.createWorkspace({ title: '노트 사본' }), Core.createWorkspace({ title: '보조 파일 사본' })];
  control.afterWrite = ({ name, method, value }) => {
    if (name === 'bundles' && method === 'add' && value.workspaceId === pair[0].workspaceId) control.failWrite = { name: 'bundles', method: 'add' };
  };
  await assert.rejects(a.installWorkspaces(pair), { code: 'storage_quota' });
  control.afterWrite = null;
  assert.deepEqual((await a.listWorkspaces()).map(w => w.workspaceId), [previous.workspaceId]);
  assert.equal(await a.getActive(), previous.workspaceId);
  await assert.rejects(a.installWorkspaces([pair[0], pair[0]]), { code: 'workspace_exists' });
  await a.installWorkspace(pair[1]);
  await assert.rejects(a.installWorkspaces(pair), { code: 'workspace_exists' });
  await assert.rejects(a.read(pair[0].workspaceId), { code: 'workspace_access_denied' });
  const next = [Core.createWorkspace(), Core.createWorkspace()]; let b;
  control.afterWrite = ({ name, method }) => {
    if (name === 'bundles' && method === 'add') { control.afterWrite = null; b = base.forAccount(accountB); }
  };
  await assert.rejects(a.installWorkspaces(next), { code: 'storage_scope_closed' });
  assert.deepEqual(await b.listWorkspaces(), []);
  a = base.forAccount(accountA);
  for (const copy of next) await assert.rejects(a.read(copy.workspaceId), { code: 'workspace_access_denied' });
  const installed = await a.installWorkspaces(next);
  assert.equal(installed.length, 2); assert.equal(await a.getActive(), next[0].workspaceId);
  for (const copy of installed) assert.equal(await a.getSyncState(copy.workspaceId), null);
});
test('workspace pair failures preserve all rows, account metadata, active selection and notifications before a successful retry', async t => {
  for (const point of ['first_owner', 'second_owner', 'active', 'completion', 'synchronous_second_add']) await t.test(point, async t => {
    const { storage: base, control, rows } = syncFixture(); t.after(() => base.close());
    const a = base.forAccount(accountA), previous = await initialImport(a);
    const pair = [Core.createWorkspace({ title: '노트 사본' }), Core.createWorkspace({ title: '보조 파일 사본' })];
    const originalInput = structuredClone(pair), before = structuredClone(rows), events = [];
    for (const copy of pair) a.subscribe(copy.workspaceId, event => events.push(event));
    if (point === 'completion') control.failCompletion = true;
    else if (point === 'synchronous_second_add') control.beforeWrite = ({ name, method, value }) => {
      if (name === 'bundles' && method === 'add' && value.workspaceId === pair[1].workspaceId) {
        control.beforeWrite = null;
        throw new DOMException('anonymous request failure', 'InvalidStateError');
      }
    };
    else control.afterWrite = ({ name, value }) => {
      const key = point === 'active' ? `activeWorkspace:${JSON.stringify([accountA.projectUrl, accountA.userId])}`
        : `owner:${pair[point === 'first_owner' ? 0 : 1].workspaceId}`;
      if (name === 'meta' && value.key === key) {
        control.afterWrite = null;
        throw new DOMException('anonymous metadata failure', 'AbortError');
      }
    };
    await assert.rejects(a.installWorkspaces(pair), { code: point === 'synchronous_second_add' ? 'storage_unavailable' : 'storage_aborted' });
    assert.deepEqual(rows, before);
    assert.deepEqual(pair, originalInput);
    assert.deepEqual(events, []);
    assert.equal(await a.getActive(), previous.workspaceId);
    assert.deepEqual(await a.read(previous.workspaceId), previous);
    const installed = await a.installWorkspaces(pair);
    assert.deepEqual(installed, originalInput);
    assert.equal(await a.getActive(), pair[0].workspaceId);
    assert.deepEqual(events.map(event => [event.type, event.workspaceId]), pair.map(copy => ['changed', copy.workspaceId]));
    for (const copy of pair) {
      assert.deepEqual(rows.get('meta').get(JSON.stringify(`owner:${copy.workspaceId}`)).value, accountA);
      assert.equal(await a.getSyncState(copy.workspaceId), null);
      assert.deepEqual(await a.read(copy.workspaceId), copy);
    }
    installed[0].title = '호출자가 바꾼 반환 사본';
    assert.equal((await a.read(pair[0].workspaceId)).title, originalInput[0].title);
  });
});
test('account replacement after pair ownership or active-pointer writes rolls back the complete installation', async t => {
  for (const point of ['second_owner', 'active']) await t.test(point, async t => {
    const { storage: base, control, rows } = syncFixture(); t.after(() => base.close());
    const a = base.forAccount(accountA), previous = await a.createWorkspace('기존 자료');
    const pair = [Core.createWorkspace(), Core.createWorkspace()], before = structuredClone(rows), events = [];
    for (const copy of pair) a.subscribe(copy.workspaceId, event => events.push(event));
    let b;
    control.afterWrite = ({ name, value }) => {
      if (name === 'meta' && (point === 'second_owner' ? value.key === `owner:${pair[1].workspaceId}` : value.key.startsWith('activeWorkspace:'))) {
        control.afterWrite = null;
        b = base.forAccount(accountB);
      }
    };
    await assert.rejects(a.installWorkspaces(pair), { code: 'storage_scope_closed' });
    assert.deepEqual(rows, before);
    assert.deepEqual(events, []);
    assert.deepEqual(await b.listWorkspaces(), []);
    assert.equal(await b.getActive(), null);
    const again = base.forAccount(accountA);
    assert.equal(await again.getActive(), previous.workspaceId);
    assert.deepEqual((await again.listWorkspaces()).map(value => value.workspaceId), [previous.workspaceId]);
    assert.equal((await again.installWorkspaces(pair)).length, 2);
  });
});
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
  const retitled = { ...bundle, title: '원문 해시는 같지만 서버 제목이 달라짐' };
  await assert.rejects(storage.applySyncRemote(bundle.workspaceId, binding, serverRow(retitled, 2)), { code: 'remote_revision_mismatch' });
  assert.deepEqual(await storage.read(bundle.workspaceId), bundle);
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

async function writingItem(storage, bundle, sourceId, content = '직접 남긴 한글 글 🌱') {
  const stage = await storage.saveStage({ ...Writing.createDraft(bundle, sourceId ? { sourceId } : {}),
    title: '직접 쓴 제목', text: content });
  const prepared = await Writing.prepareSave(bundle, stage);
  return { stage, prepared, request: { operationId: Core.id(), workspaceId: bundle.workspaceId,
    baseRevision: bundle.revision, changes: prepared.changes, stageId: stage.stageId,
    stageRevision: stage.revision, stageResult: prepared.stageResult } };
}

test('writing commit atomically consumes its typed draft with an idempotent receipt, and rolls back quota failure', async t => {
  const { storage, control } = syncFixture(); t.after(() => storage.close());
  const initial = await storage.createWorkspace(), item = await writingItem(storage, initial);
  control.failWrite = { name: 'operations', method: 'add' };
  assert.equal((await storage.commitLocal(item.request)).error.code, 'storage_quota');
  assert.deepEqual(await storage.read(initial.workspaceId), initial);
  assert.deepEqual(await storage.getStage(item.stage.stageId), item.stage);
  const result = await storage.commitLocal(item.request);
  assert.equal(result.status, 'stored');
  assert.deepEqual(await storage.commitLocal(item.request), result);
  const bundle = await storage.read(initial.workspaceId), applied = await storage.getStage(item.stage.stageId);
  assert.equal(bundle.sourceVersions.length, 1); assert.equal(applied.state, 'applied');
  assert.equal(Writing.validateDraft(applied), true); assert.deepEqual(applied.appliedResult, item.prepared.stageResult);
  assert.equal(await storage.getSyncState(bundle.workspaceId), null);
  assert.equal(Core.makeBackup(bundle).manifest.stagingIncluded, false);
});

test('writing drafts remain local while explicit saves join an existing sync binding without changing fixed upload snapshots', async t => {
  const { storage } = syncFixture(); t.after(() => storage.close());
  const initial = await storage.createWorkspace(), binding = await uploaded(storage, initial);
  const item = await writingItem(storage, initial);
  assert.equal((await storage.getSyncState(initial.workspaceId)).status, 'synced');
  assert.equal((await storage.commitLocal(item.request)).status, 'stored');
  const first = await storage.read(initial.workspaceId), pending = await storage.prepareSyncUpload(first.workspaceId, binding);
  assert.equal(pending.data.sources.length, 1); assert.equal(pending.data.sources[0].sourceKey, item.prepared.source.sourceKey);
  assert.equal(JSON.stringify(pending.data).includes('life-writing-draft-v1'), false);
  const next = await writingItem(storage, first, first.sources[0].id, '수정해서 다시 보관한 본문');
  assert.equal((await storage.commitLocal(next.request)).status, 'stored');
  assert.deepEqual(await storage.prepareSyncUpload(first.workspaceId, binding), pending);
  await storage.ackSync(first.workspaceId, binding, pending.operationId, 2);
  const second = await storage.prepareSyncUpload(first.workspaceId, binding);
  assert.equal(second.data.sourceVersions.length, 2);
  assert.equal(second.data.sourceVersions[0].contentText, item.stage.text);
  assert.equal(second.data.sourceVersions[1].contentText, next.stage.text);
});

test('unowned writing copy remaps edit bases and applied results, retaining stale revisions after copied revisions reset', async t => {
  const { storage: base } = syncFixture(); t.after(() => base.close());
  const initial = await base.createWorkspace(), first = await writingItem(base, initial);
  assert.equal((await base.commitLocal(first.request)).status, 'stored');
  let original = await base.read(initial.workspaceId);
  const stale = await base.saveStage({ ...Writing.createDraft(original, { sourceId: first.prepared.source.id }), text: '보존할 이전 입력' });
  // A source-only title change keeps the same version ID. After a copy resets
  // revision 2 to 1, revision 1 must not make this stale draft current again.
  const renamed = { ...original.sources[0], title: '다른 곳에서 바꾼 제목', revision: 2 };
  assert.equal((await base.commitLocal({ workspaceId: original.workspaceId, operationId: Core.id(),
    baseRevision: original.revision, changes: { put: { sources: [renamed] } } })).status, 'stored');
  original = await base.read(initial.workspaceId);
  const fresh = await base.saveStage(Writing.createDraft(original, { sourceId: first.prepared.source.id }));
  const blank = await base.saveStage(Writing.createDraft(original));
  const before = await base.listStages(original.workspaceId), account = base.forAccount(accountA);
  const copied = await account.importUnownedWorkspace(original.workspaceId);
  const stages = await account.listStages(copied.workspaceId);
  assert.equal(stages.length, 4);
  const applied = stages.find(stage => stage.state === 'applied');
  assert.deepEqual(applied.appliedResult, { sourceId: copied.sources[0].id, sourceVersionId: copied.sourceVersions[0].id });
  const copiedStale = stages.find(stage => stage.text === stale.text);
  assert.equal(copiedStale.sourceId, copied.sources[0].id);
  assert.equal(copiedStale.baseSourceVersionId, copied.sourceVersions[0].id);
  assert.equal(copiedStale.baseSourceRevision, 1); assert.equal(copiedStale.baseChanged, true);
  await assert.rejects(Writing.prepareSave(copied, copiedStale), { code: 'writing_conflict' });
  const preservedAgain = Writing.recoverDraft(copiedStale);
  assert.equal(preservedAgain.baseChanged, true);
  await assert.rejects(Writing.prepareSave(copied, preservedAgain), { code: 'writing_conflict' });
  const separate = Writing.recoverDraft(copiedStale, { asNew: true });
  assert.equal(separate.baseChanged, undefined); assert.equal(separate.sourceId, null);
  assert.notEqual((await Writing.prepareSave(copied, separate)).source.id, copied.sources[0].id);
  const copiedFresh = stages.find(stage => stage.state === 'draft' && stage.title === fresh.title && stage.sourceId !== null);
  assert.equal(copiedFresh.baseChanged, undefined); assert.equal(copiedFresh.baseSourceRevision, 1);
  assert.equal((await Writing.prepareSave(copied, copiedFresh)).source.id, copied.sources[0].id);
  assert.equal(stages.filter(stage => stage.state === 'draft' && stage.sourceId === null).length, 1);
  assert.equal(blank.text, '');
  assert.deepEqual(await base.listStages(original.workspaceId), before);
  assert.equal(await account.getSyncState(copied.workspaceId), null);
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


test('blog state CAS is account scoped and evidence/post/index commits are atomic across late failure', async t => {
  const { storage: base, control } = syncFixture(); t.after(() => base.close());
  const M = require('../assets/life/photo-post.js'), R = require('../assets/life/source-reference.js');
  const a = base.forAccount(accountA), bundle = await initialImport(a), ws = bundle.workspaceId;
  const source = bundle.sources[0], version = bundle.sourceVersions.find(v => v.sourceId === source.id);
  const ref = await R.build({ bundle, sourceId: source.id, versionId: version.id, locator: { start: 0, end: Math.min(3,version.contentText.length) } });
  const doc = M.create(Core.id); doc.title = '근거와 계정 보존'; doc.ops = [{ insert: '작성 중인 본문\n' }];
  assert.deepEqual(await a.readPostEvidence(ws, doc.id), { revision: 0, refs: [] });
  let failed = false;
  control.afterWrite = ({ name, value }) => { if (name === 'meta' && value.key?.startsWith('post-evidence:')) { failed = true; control.afterWrite = null; throw new DOMException('anonymous late evidence failure', 'AbortError'); } };
  await assert.rejects(a.savePhotoPostWithEvidence(ws, doc, 0, [ref], 0), { code: 'storage_aborted' });
  assert.equal(failed, true); assert.deepEqual(await a.listPhotoPosts(ws), []);
  assert.deepEqual(await a.readPostEvidence(ws, doc.id), { revision: 0, refs: [] });
  const saved = await a.savePhotoPostWithEvidence(ws, doc, 0, [ref], 0);
  assert.equal(saved.revision, 1); assert.deepEqual((await a.readPostEvidence(ws, doc.id)).refs, [ref]);
  await assert.rejects(a.savePhotoPostWithEvidence(ws, saved, 1, [], 0), { code: 'post_evidence_conflict' });
  assert.deepEqual(await a.readPhotoPost(ws, doc.id), saved);
  const other = structuredClone(ref); other.quote = 'x'.repeat(other.quote.length);
  await assert.rejects(a.savePostEvidence(ws, doc.id, { refs: [other] }, 1), { code: 'invalid_source_reference' });
  assert.equal(await a.readBlogSyncState(ws, doc.id), null);
  const state = await a.writeBlogSyncState(ws, doc.id, { enabled: true, remoteRevision: 4 }, 0);
  assert.equal(state.revision, 1); assert.equal(state.remoteRevision, 4);
  await assert.rejects(a.writeBlogSyncState(ws, doc.id, { enabled: false }, 0), { code: 'blog_state_conflict' });
  assert.deepEqual(await a.readBlogSyncState(ws, doc.id), state);
  const b = base.forAccount(accountB);
  await assert.rejects(b.readBlogSyncState(ws, doc.id), { code: 'workspace_access_denied' });
  await assert.rejects(b.readPostEvidence(ws, doc.id), { code: 'workspace_access_denied' });
});

test('rich post replacement retains exact evidence and stable remote binding including pending operation receipt', async t => {
  const { storage: base } = syncFixture(); t.after(() => base.close());
  const M = require('../assets/life/photo-post.js'), R = require('../assets/life/source-reference.js');
  const a = base.forAccount(accountA), bundle = await initialImport(a), ws = bundle.workspaceId;
  const source = bundle.sources[0], version = bundle.sourceVersions.find(v => v.sourceId === source.id);
  const ref = await R.build({ bundle, sourceId: source.id, versionId: version.id, locator: { start: 0, end: 3 } });
  const doc = M.create(Core.id); doc.status = 'saved'; doc.title = '원래 글'; doc.ops = [{ insert: '원래 본문\n' }];
  const first = await a.savePhotoPostWithEvidence(ws, doc, 0, [ref], 0);
  const binding = await a.writeBlogSyncState(ws, first.id, { enabled: true, remoteId: Core.id(), remoteRevision: 2, localRevision: first.revision,
    pending: { operationId: Core.id(), localRevision: first.revision, manifest: { title: '응답 유실된 이전 사본' } },
    publishPending: { operationId: Core.id(), photoIds: ['old-photo'] }, unpublishPending: { operationId: Core.id() } }, 0);
  const edit = { ...first, id: Core.id(), revision: 0, replaces: { id: first.id, revision: first.revision }, title: '수정 글' };
  const next = await a.savePhotoPost(ws, edit, 0);
  assert.deepEqual((await a.readPostEvidence(ws, next.id)).refs, [ref]);
  const migrated = await a.readBlogSyncState(ws, next.id);
  assert.equal(migrated.remoteId, binding.remoteId); assert.equal(migrated.pending.operationId, binding.pending.operationId);
  assert.equal(migrated.publishPending, null); assert.equal(migrated.unpublishPending, null);
  assert.equal(migrated.localRevision, 0); assert.equal(migrated.pending.localRevision, 0);
  assert.equal(await a.readBlogSyncState(ws, first.id), null);
  await assert.rejects(a.writeBlogSyncState(ws, first.id, binding, binding.revision), { code: 'blog_state_conflict' });
});

test('independent rich post copies keep exact older evidence atomically without inheriting replacement or server authority', async t => {
  const f = syncFixture(); t.after(() => f.storage.close());
  const a = f.storage.forAccount(accountA), original = await initialImport(a), ws = original.workspaceId;
  const M = require('../assets/life/photo-post.js'), R = require('../assets/life/source-reference.js');
  const source = original.sources[0], version = original.sourceVersions.find(row => row.sourceId === source.id);
  const ref = await R.build({ bundle: original, sourceId: source.id, versionId: version.id, locator: { start: 0, end: 3 } });
  const doc = M.create(Core.id); doc.title = '정확한 예전 원문 근거'; doc.status = 'saved'; doc.ops = [{ insert: ref.quote + '\n' }];
  const saved = await a.savePhotoPostWithEvidence(ws, doc, 0, [ref], 0);
  const remote = await a.writeBlogSyncState(ws, saved.id, { enabled: true, remoteId: Core.id(), remoteRevision: 1 }, 0);
  const prepared = await Core.prepareImport({ origin: source.origin, existingSourceId: source.id, title: source.title, text: '새 원문 버전은 이전 인용을 대신하지 않습니다.' }, original);
  assert.equal((await a.commitLocal({ workspaceId: ws, operationId: Core.id(), baseRevision: original.revision, changes: Core.buildImportChanges(original, prepared, []) })).status, 'stored');
  const editing = { ...structuredClone(saved), id: Core.id(), revision: 0, status: 'draft', replaces: { id: saved.id, revision: saved.revision } };
  const draft = await a.savePhotoPost(ws, editing, 0);
  assert.deepEqual(await a.readPostEvidence(ws, draft.id), { revision: 0, refs: [] });
  const inherited = await a.readPostEvidence(ws, draft.replaces.id), copy = { ...draft, id: Core.id(), revision: 0, replaces: null };
  const before = structuredClone(f.rows);
  f.control.afterWrite = ({ name, value }) => {
    if (name !== 'meta' || value.key !== `post-evidence:${ws}:${copy.id}`) return;
    f.control.afterWrite = null; throw new DOMException('anonymous late sidecar failure', 'AbortError');
  };
  await assert.rejects(a.savePhotoPostWithEvidence(ws, copy, 0, inherited.refs, 0), { code: 'storage_aborted' });
  assert.deepEqual(f.rows, before);
  const independent = await a.savePhotoPostWithEvidence(ws, copy, 0, inherited.refs, 0);
  assert.equal(independent.replaces, null); assert.equal(independent.revision, 1);
  assert.deepEqual((await a.readPostEvidence(ws, independent.id)).refs, [ref]);
  assert.deepEqual(await R.resolve(await a.read(ws), ref), { sourceId: source.id, sourceVersionId: version.id, locator: ref.locator });
  assert.equal(await a.readBlogSyncState(ws, independent.id), null);
  assert.deepEqual(await a.readBlogSyncState(ws, saved.id), remote);
  assert.deepEqual(await a.readPhotoPost(ws, saved.id), saved); assert.deepEqual(await a.readPhotoPost(ws, draft.id), draft);
  await a.savePostEvidence(ws, draft.id, { refs: [] }, 0);
  assert.deepEqual(await a.readPostEvidence(ws, draft.id), { revision: 1, refs: [] });
});

async function preservationFixture(t) {
  const fixture = syncFixture(); t.after(() => fixture.storage.close());
  const base = fixture.storage, a = base.forAccount(accountA), bundle = await initialImport(a), ws = bundle.workspaceId;
  const M = require('../assets/life/photo-post.js'), R = require('../assets/life/source-reference.js'), N = require('../assets/life/nine-board.js');
  const source = bundle.sources[0], version = bundle.sourceVersions.find(v => v.sourceId === source.id);
  const ref = await R.build({ bundle, sourceId: source.id, versionId: version.id, locator: { start: 0, end: 3 } });
  const post = title => { const doc = M.create(Core.id); doc.status = 'saved'; doc.title = title; doc.ops = [{ insert: title + '\n' }]; return doc; };
  const selected = await a.savePhotoPostWithEvidence(ws, post('직접 선택한 글'), 0, [ref], 0);
  const dependency = await a.savePhotoPostWithEvidence(ws, post('9칸의 필수 근거 글'), 0, [ref], 0);
  const draft = post('선택하지 않은 작성 초안'); draft.status = 'draft'; await a.savePhotoPost(ws, draft, 0);
  const state = N.empty(ws), board = N.create(Core.id); board.title = '내가 선택한 근거';
  board.areas[0].items = [N.evidenceSnapshot({ kind: 'post', value: await R.buildPost({ workspaceId: ws, post: dependency }) }), N.evidenceSnapshot({ kind: 'source', value: ref })];
  state.format = 'life-nine-board-v2'; state.boards = [board]; const nine = await a.saveNineBoard(ws, state, 0);
  return { ...fixture, base, a, bundle, ws, selected, dependency, draft, nine, ref };
}

test('preservation catalog avoids blobs and snapshot reads selected saved posts, evidence and required exact board dependencies atomically', async t => {
  const f = await preservationFixture(t), before = f.control.transactions.length;
  const catalog = await f.a.readPreservationCatalog(f.ws);
  assert.deepEqual(catalog.posts.map(row => row.id), [f.selected.id, f.dependency.id]);
  assert.deepEqual(catalog.boards, [{ id: f.nine.boards[0].id, title: '내가 선택한 근거', areas: 1, itemCount: 2 }]);
  assert.equal(f.control.transactions.length, before + 1);
  const count = f.control.transactions.length;
  const snapshot = await f.a.readPreservationSnapshot(f.ws, { postIds: [f.selected.id], boardIds: [f.nine.boards[0].id] });
  assert.equal(f.control.transactions.length, count + 1);
  assert.equal(f.control.transactions.at(-1).mode, 'readonly');
  assert.deepEqual(snapshot.posts.map(({ doc }) => doc.id), [f.selected.id, f.dependency.id]);
  assert.deepEqual(snapshot.posts[0].evidence, { revision: 1, refs: [f.ref] });
  assert.deepEqual(snapshot.bundle, f.bundle); assert.deepEqual(snapshot.nineBoard, f.nine);
  snapshot.posts[0].doc.title = '호출자 변경'; snapshot.posts[0].evidence.refs[0].quote = '변경';
  assert.deepEqual(await f.a.readPhotoPost(f.ws, f.selected.id), f.selected);
  assert.deepEqual((await f.a.readPostEvidence(f.ws, f.selected.id)).refs, [f.ref]);
});

test('preservation snapshot refuses stale exact post versions, draft selection, missing selections and foreign-workspace references', async t => {
  const f = await preservationFixture(t);
  await assert.rejects(f.a.readPreservationSnapshot(f.ws, {}), { code: 'invalid_preservation' });
  await assert.rejects(f.a.readPreservationSnapshot(f.ws, { postIds: [f.selected.id, f.selected.id] }), { code: 'invalid_preservation' });
  await assert.rejects(f.a.readPreservationSnapshot(f.ws, { postIds: [f.draft.id] }), { code: 'invalid_preservation' });
  await assert.rejects(f.a.readPreservationSnapshot(f.ws, { boardIds: [Core.id()] }), { code: 'preservation_source_changed' });
  await f.a.savePhotoPost(f.ws, { ...f.dependency, title: '새 revision' }, f.dependency.revision);
  await assert.rejects(f.a.readPreservationSnapshot(f.ws, { boardIds: [f.nine.boards[0].id] }), { code: 'preservation_source_changed' });
  const foreign = structuredClone(f.nine); foreign.boards[0].areas[0].items = [foreign.boards[0].areas[0].items[1]]; foreign.boards[0].areas[0].items[0].reference.value.workspaceId = Core.id();
  await f.a.saveNineBoard(f.ws, foreign, foreign.revision);
  await assert.rejects(f.a.readPreservationSnapshot(f.ws, { boardIds: [foreign.boards[0].id] }), { code: 'workspace_access_denied' });
  assert.deepEqual(await f.a.readPhotoPost(f.ws, f.selected.id), f.selected);
});

test('preservation unowned catalog and snapshot require explicit access and reject both explicit owners and old sync ownership', async t => {
  const f = await preservationFixture(t), encode = JSON.stringify;
  const b = f.base.forAccount(accountB);
  await assert.rejects(b.readPreservationCatalog(f.ws, { unowned: true }), { code: 'workspace_access_denied' });
  f.rows.get('meta').delete(encode(`owner:${f.ws}`));
  await assert.rejects(b.readPreservationSnapshot(f.ws, { postIds: [f.selected.id] }), { code: 'workspace_access_denied' });
  assert.equal((await b.readPreservationCatalog(f.ws, { unowned: true })).posts.length, 2);
  assert.equal((await b.readPreservationSnapshot(f.ws, { postIds: [f.selected.id], unowned: true })).posts.length, 1);
  assert.equal(f.rows.get('meta').has(encode(`owner:${f.ws}`)), false);
  const sync = { binding: bindingFor(f.bundle) };
  f.rows.get('meta').set(encode(`sync:${f.ws}`), { key: `sync:${f.ws}`, value: sync });
  await assert.rejects(b.readPreservationCatalog(f.ws, { unowned: true }), { code: 'workspace_access_denied' });
  await assert.rejects(b.readPreservationSnapshot(f.ws, { postIds: [f.selected.id], unowned: true }), { code: 'workspace_access_denied' });
  await assert.rejects(f.base.readPreservationCatalog(f.ws), { code: 'auth_scope_required' });
});

test('preservation copy installs exact remapped dependencies into the authenticated account and excludes all original sync/public bindings', async t => {
  const f = await preservationFixture(t), R = require('../assets/life/preservation-references.js');
  const original = structuredClone(f.rows), snapshot = await f.a.readPreservationSnapshot(f.ws, { postIds: [f.selected.id], boardIds: [f.nine.boards[0].id] });
  const selected = await R.select(snapshot, { postIds: [f.selected.id], boardIds: [f.nine.boards[0].id] });
  const copy = await R.copy(selected), b = f.base.forAccount(accountB), installed = await b.installPreservationCopy(copy);
  assert.deepEqual(installed, copy); assert.notEqual(installed.bundle.workspaceId, f.ws);
  assert.equal(await b.getActive(), copy.bundle.workspaceId);
  for (const { doc, evidence } of copy.posts) {
    assert.deepEqual(await b.readPhotoPost(copy.bundle.workspaceId, doc.id), doc);
    assert.deepEqual(await b.readPostEvidence(copy.bundle.workspaceId, doc.id), evidence);
    assert.equal(await b.readBlogSyncState(copy.bundle.workspaceId, doc.id), null);
  }
  assert.deepEqual(await b.readNineBoard(copy.bundle.workspaceId), copy.nineBoard);
  assert.equal(await b.getSyncState(copy.bundle.workspaceId), null);
  assert.deepEqual(f.rows.get('meta').get(JSON.stringify(`owner:${copy.bundle.workspaceId}`)).value, accountB);
  for (const [store, values] of original) for (const [key, value] of values) {
    assert.deepEqual(f.rows.get(store).get(key), value);
  }
  const a = f.base.forAccount(accountA);
  await assert.rejects(a.read(copy.bundle.workspaceId), { code: 'workspace_access_denied' });
  assert.deepEqual(await a.read(f.ws), f.bundle);
});

test('preservation install abort, synchronous failure and account replacement roll back posts, evidence, owners and activation together', async t => {
  const f = await preservationFixture(t), R = require('../assets/life/preservation-references.js');
  const snapshot = await f.a.readPreservationSnapshot(f.ws, { postIds: [f.selected.id], boardIds: [f.nine.boards[0].id] });
  const selected = await R.select(snapshot, { postIds: [f.selected.id], boardIds: [f.nine.boards[0].id] });
  for (const point of ['completion', 'evidence', 'account']) {
    const a = f.base.forAccount(accountA), copy = await R.copy(selected), before = structuredClone(f.rows), events = [];
    a.subscribe(copy.bundle.workspaceId, event => events.push(event));
    if (point === 'completion') f.control.failCompletion = true;
    else f.control.beforeWrite = ({ name, value }) => {
      if (name !== 'meta' || !value?.key?.startsWith(`post-evidence:${copy.bundle.workspaceId}:`)) return;
      f.control.beforeWrite = null;
      if (point === 'account') f.base.forAccount(accountB);
      else throw new DOMException('synchronous evidence failure', 'InvalidStateError');
    };
    await assert.rejects(a.installPreservationCopy(copy), { code: point === 'account' ? 'storage_scope_closed' : point === 'evidence' ? 'storage_unavailable' : 'storage_aborted' });
    assert.deepEqual(f.rows, before); assert.deepEqual(events, []);
    const again = f.base.forAccount(accountA);
    assert.deepEqual(await again.installPreservationCopy(copy), copy);
    await assert.rejects(again.installPreservationCopy(copy), { code: 'workspace_exists' });
  }
});

test('preservation install refuses orphan metadata collisions and non-fresh revision candidates before changing any data', async t => {
  const f = await preservationFixture(t), R = require('../assets/life/preservation-references.js');
  const snapshot = await f.a.readPreservationSnapshot(f.ws, { postIds: [f.selected.id] });
  const copy = await R.copy(await R.select(snapshot, { postIds: [f.selected.id], boardIds: [] }));
  const corrupt = structuredClone(copy); corrupt.posts[0].doc.revision = 2;
  const before = structuredClone(f.rows);
  await assert.rejects(f.a.installPreservationCopy(corrupt), { code: 'invalid_preservation' });
  assert.deepEqual(f.rows, before);
  const orphanKey = `blog-sync:${copy.bundle.workspaceId}:${copy.posts[0].doc.id}`;
  f.rows.get('meta').set(JSON.stringify(orphanKey), { key: orphanKey, value: { publication: { token: Core.id() } } });
  const orphan = structuredClone(f.rows);
  await assert.rejects(f.a.installPreservationCopy(copy), { code: 'workspace_exists' });
  assert.deepEqual(f.rows, orphan);
});

test('preservation installation verifies original photo bytes before any transaction and preserves exact valid bytes', async t => {
  const f = await preservationFixture(t), R = require('../assets/life/preservation-references.js'), M = require('../assets/life/photo-post.js');
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64');
  const blob = new Blob([bytes], { type: 'image/png' }), photo = { id: Core.id(), name: '합성 원본.png', type: 'image/png', size: blob.size, width: 1, height: 1, digest: await M.digest(blob), blob };
  const doc = { ...f.selected, photos: [photo], ops: [{ insert: { photo: { id: photo.id, caption: '원본 설명', alt: '합성 사진' } } }, { insert: '\n' }] };
  const saved = await f.a.savePhotoPost(f.ws, doc, f.selected.revision);
  const snapshot = await f.a.readPreservationSnapshot(f.ws, { postIds: [saved.id] });
  const copy = await R.copy(await R.select(snapshot, { postIds: [saved.id], boardIds: [] }));
  const corrupt = structuredClone(copy), changed = Buffer.from(bytes); changed[30] ^= 1;
  corrupt.posts[0].doc.photos[0].blob = new Blob([changed], { type: 'image/png' });
  const before = structuredClone(f.rows), transactions = f.control.transactions.length;
  await assert.rejects(f.a.installPreservationCopy(corrupt), { code: 'invalid_blog_photo' });
  assert.equal(f.control.transactions.length, transactions); assert.deepEqual(f.rows, before);
  const installed = await f.a.installPreservationCopy(copy);
  const read = await f.a.readPhotoPost(installed.bundle.workspaceId, installed.posts[0].doc.id);
  assert.deepEqual(Buffer.from(await read.photos[0].blob.arrayBuffer()), bytes);
  assert.notEqual(read.photos[0].id, photo.id); assert.equal(read.photos[0].digest, photo.digest);
});

test('preservation async validation owns its input and an account switch before the write transaction cannot install a late copy', async t => {
  const f = await preservationFixture(t), R = require('../assets/life/preservation-references.js');
  const snapshot = await f.a.readPreservationSnapshot(f.ws, { postIds: [f.selected.id] });
  const original = await R.copy(await R.select(snapshot, { postIds: [f.selected.id], boardIds: [] }));
  const previous = globalThis.HaedoLife.PreservationReferences;
  t.after(() => { globalThis.HaedoLife.PreservationReferences = previous; });
  for (const changeAccount of [false, true]) {
    const a = f.base.forAccount(accountA), copy = changeAccount ? await R.copy(await R.select(snapshot, { postIds: [f.selected.id], boardIds: [] })) : structuredClone(original);
    let enter, release; const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
    globalThis.HaedoLife.PreservationReferences = { ...R, async validate(input) { const result = await R.validate(input); enter(); await gate; return result; } };
    const before = structuredClone(f.rows), count = f.control.transactions.length, pending = a.installPreservationCopy(copy);
    await entered;
    copy.posts[0].doc.title = '호출자가 검증 중 바꾼 제목';
    if (changeAccount) f.base.forAccount(accountB);
    release();
    if (changeAccount) { await assert.rejects(pending, { code: 'storage_scope_closed' }); assert.equal(f.control.transactions.length, count); assert.deepEqual(f.rows, before); }
    else { const installed = await pending; assert.equal(installed.posts[0].doc.title, original.posts[0].doc.title); }
    globalThis.HaedoLife.PreservationReferences = previous;
  }
});

test('preservation local copy compares selected posts, evidence and board contents inside its final installation transaction', async t => {
  const f = await preservationFixture(t), R = require('../assets/life/preservation-references.js');
  const other = createStorage({ idb: f.idb, core: Core, channelFactory: null, account: accountA }); t.after(() => other.close());
  const originalReferences = globalThis.HaedoLife.PreservationReferences;
  t.after(() => { globalThis.HaedoLife.PreservationReferences = originalReferences; });
  for (const point of ['post', 'evidence', 'board']) {
    const selection = { postIds: [f.selected.id], boardIds: point === 'board' ? [f.nine.boards[0].id] : [] };
    const expected = await R.select(await f.a.readPreservationSnapshot(f.ws, selection), selection), copy = await R.copy(expected);
    let enter, release; const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
    globalThis.HaedoLife.PreservationReferences = { ...R, async validate(input) {
      const result = await R.validate(input); if (input.bundle.workspaceId === copy.bundle.workspaceId) { enter(); await gate; } return result;
    } };
    const pending = f.a.installPreservationCopy(copy, { source: { workspaceId: f.ws, unowned: false, expected } });
    await entered;
    if (point === 'post') { const doc = await other.readPhotoPost(f.ws, f.selected.id); await other.savePhotoPost(f.ws, { ...doc, title: '최종 검증 중 원본 편집' }, doc.revision); }
    if (point === 'evidence') { const evidence = await other.readPostEvidence(f.ws, f.selected.id); await other.savePostEvidence(f.ws, f.selected.id, { refs: [] }, evidence.revision); }
    if (point === 'board') { const state = await other.readNineBoard(f.ws); state.boards[0].title = '최종 검증 중 구성 편집'; await other.saveNineBoard(f.ws, state, state.revision); }
    const changed = structuredClone(f.rows); release();
    await assert.rejects(pending, { code: 'preservation_source_changed' });
    assert.deepEqual(f.rows, changed); assert.equal(await f.a.getActive(), f.ws);
    globalThis.HaedoLife.PreservationReferences = originalReferences;
  }
});

test('preservation final source CAS permits unrelated records, posts and boards but rejects a newly owned unowned source', async t => {
  const f = await preservationFixture(t), R = require('../assets/life/preservation-references.js'), N = require('../assets/life/nine-board.js');
  const other = createStorage({ idb: f.idb, core: Core, channelFactory: null, account: accountA }); t.after(() => other.close());
  const originalReferences = globalThis.HaedoLife.PreservationReferences;
  t.after(() => { globalThis.HaedoLife.PreservationReferences = originalReferences; });
  for (const point of ['unrelated', 'owner']) {
    if (point === 'owner') f.rows.get('meta').delete(JSON.stringify(`owner:${f.ws}`));
    const selection = { postIds: [f.selected.id], boardIds: [] }, unowned = point === 'owner';
    const expected = await R.select(await f.a.readPreservationSnapshot(f.ws, { ...selection, unowned }), selection), copy = await R.copy(expected);
    let enter, release; const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
    globalThis.HaedoLife.PreservationReferences = { ...R, async validate(input) {
      const result = await R.validate(input); if (input.bundle.workspaceId === copy.bundle.workspaceId) { enter(); await gate; } return result;
    } };
    const pending = f.a.installPreservationCopy(copy, { source: { workspaceId: f.ws, unowned, expected } });
    await entered;
    if (point === 'unrelated') {
      const doc = await other.readPhotoPost(f.ws, f.dependency.id); await other.savePhotoPost(f.ws, { ...doc, title: '선택하지 않은 글 편집' }, doc.revision);
      const state = await other.readNineBoard(f.ws); state.boards.push(N.create(Core.id)); await other.saveNineBoard(f.ws, state, state.revision);
      const bundle = await other.read(f.ws), prepared = await Core.prepareImport({ origin: 'other', title: '별도 원문', text: '선택에 없는 새로운 자료입니다.' }, bundle);
      assert.equal((await other.commitLocal({ workspaceId: f.ws, operationId: Core.id(), baseRevision: bundle.revision, changes: Core.buildImportChanges(bundle, prepared, []) })).status, 'stored');
    } else {
      // A legacy owner-free workspace becomes bound while its review is open.
      f.rows.get('meta').set(JSON.stringify(`owner:${f.ws}`), { key: `owner:${f.ws}`, value: accountB });
    }
    const changed = structuredClone(f.rows); release();
    if (point === 'owner') { await assert.rejects(pending, { code: 'workspace_access_denied' }); assert.deepEqual(f.rows, changed); }
    else {
      const installed = await pending; assert.equal(installed.bundle.workspaceId, copy.bundle.workspaceId);
      assert.deepEqual(await f.a.readPhotoPost(copy.bundle.workspaceId, copy.posts[0].doc.id), copy.posts[0].doc);
    }
    globalThis.HaedoLife.PreservationReferences = originalReferences;
  }
});

test('nine-board draft creation checks the reviewed source inside the same post/index transaction', async t => {
  const { storage: base, control } = syncFixture(); t.after(() => base.close());
  const N = require('../assets/life/nine-board.js'), P = require('../assets/life/photo-post.js');
  const a = base.forAccount(accountA), bundle = await initialImport(a), ws = bundle.workspaceId;
  const board = N.create(Core.id); board.title = '선택한 영역';
  const source = await a.saveNineBoard(ws, { ...N.empty(ws), boards: [board] }, 0);
  const make = () => { const d = P.create(Core.id); d.title = '검토한 결과'; d.ops = [{ insert: '선택한 제목과 출처만\n' }]; return d; };
  const doc = make();
  control.failCompletion = true;
  await assert.rejects(a.savePhotoPostFromNineBoard(ws, doc, source.revision, board.id, board.areas[0].id), { code: 'storage_aborted' });
  control.failCompletion = false;
  assert.deepEqual(await a.listPhotoPosts(ws), []);
  await assert.rejects(a.readPhotoPost(ws, doc.id), { code: 'photo_post_missing' });
  const saved = await a.savePhotoPostFromNineBoard(ws, doc, source.revision, board.id, board.areas[0].id);
  assert.equal(saved.status, 'draft'); assert.equal(saved.revision, 1);
  assert.equal((await a.listPhotoPosts(ws)).length, 1);
  assert.deepEqual(await a.readNineBoard(ws), source); assert.deepEqual(await a.read(ws), bundle);
  assert.equal(await a.readBlogSyncState(ws, saved.id), null);
  assert.deepEqual(await a.readPostEvidence(ws, saved.id), { revision: 0, refs: [] });
  await assert.rejects(a.savePhotoPostFromNineBoard(ws, doc, source.revision, board.id, board.areas[0].id), { code: 'photo_post_conflict' });
  const changed = structuredClone(source); changed.boards[0].title = '다른 탭에서 바뀐 구성';
  await a.saveNineBoard(ws, changed, source.revision);
  await assert.rejects(a.savePhotoPostFromNineBoard(ws, make(), source.revision, board.id, board.areas[0].id), { code: 'nine_board_conflict' });
  await assert.rejects(a.savePhotoPostFromNineBoard(ws, make(), source.revision + 1, board.id, 'missing_area'), { code: 'nine_board_conflict' });
  const publicDoc = make(); publicDoc.status = 'saved';
  await assert.rejects(a.savePhotoPostFromNineBoard(ws, publicDoc, source.revision + 1, board.id, board.areas[0].id), { code: 'invalid_photo_post' });
  assert.equal((await a.listPhotoPosts(ws)).length, 1);
  const foreign = base.forAccount(accountB);
  await assert.rejects(foreign.savePhotoPostFromNineBoard(ws, make(), source.revision + 1, board.id, board.areas[0].id), { code: 'workspace_access_denied' });
});

test('blog series freezes exact selected posts across original replacement and reuses only owned snapshots for a new recovery', async t => {
  const { storage: base } = syncFixture(); t.after(() => base.close());
  const P = require('../assets/life/photo-post.js'), M = require('../assets/life/blog-series.js');
  const a = base.forAccount(accountA), bundle = await initialImport(a), ws = bundle.workspaceId;
  const make = title => { const d = P.create(Core.id); d.status = 'saved'; d.title = title; d.ops = [{ insert: title + '\r\n원래 출처 https://example.org/source\n' }]; return d; };
  const first = await a.savePhotoPost(ws, make('첫 글'), 0), second = await a.savePhotoPost(ws, make('둘째 글'), 0);
  const series = M.create(Core.id); series.title = '고정 목차'; series.items = [M.item(second, Core.id), M.item(first, Core.id)];
  let state = await a.saveBlogSeries(ws, { ...M.empty(ws), series: [series] }, 0);
  const expected = { series, posts: [{ itemId: series.items[0].id, doc: second }, { itemId: series.items[1].id, doc: first }] };
  assert.deepEqual(await a.readBlogSeriesSnapshot(ws, series.id), expected);
  const edited = { ...structuredClone(first), id: Core.id(), revision: 0, title: '새 ID로 고친 글', replaces: { id: first.id, revision: first.revision } };
  await a.savePhotoPost(ws, edited, 0); await assert.rejects(a.readPhotoPost(ws, first.id), { code: 'photo_post_missing' });
  const currentSecond = await a.readPhotoPost(ws, second.id); currentSecond.archived = true; await a.savePhotoPost(ws, currentSecond, currentSecond.revision);
  assert.deepEqual(await a.readBlogSeriesSnapshot(ws, series.id), expected);
  const recovery = { ...structuredClone(series), id: Core.id(), items: series.items.map(item => ({ ...item, id: Core.id() })) };
  state.series.push(recovery); state = await a.saveBlogSeries(ws, state, state.revision);
  assert.deepEqual((await a.readBlogSeriesSnapshot(ws, recovery.id)).posts.map(row => row.doc), [second, first]);
  assert.equal((await a.listPhotoPosts(ws)).length, 2); assert.deepEqual(await a.read(ws), bundle);
  const tampered = structuredClone(state); tampered.series[0].items[0].title = '원본과 다른 제목';
  await assert.rejects(a.saveBlogSeries(ws, tampered, state.revision), { code: 'blog_series_conflict' });
  await assert.rejects(a.saveBlogSeries(ws, state, state.revision - 1), { code: 'blog_series_conflict' });
  const foreign = base.forAccount(accountB);
  await assert.rejects(foreign.readBlogSeries(ws), { code: 'workspace_access_denied' });
  await assert.rejects(foreign.readBlogSeriesSnapshot(ws, series.id), { code: 'workspace_access_denied' });
});

test('blog series capture and removal commit atomically and stale or private posts never become snapshots', async t => {
  const { storage: base, control, rows } = syncFixture(); t.after(() => base.close());
  const P = require('../assets/life/photo-post.js'), M = require('../assets/life/blog-series.js');
  const a = base.forAccount(accountA), ws = (await initialImport(a)).workspaceId;
  const d = P.create(Core.id); d.status = 'saved'; d.title = '보존 원문'; d.ops = [{ insert: '그대로 남을 본문\n' }];
  const doc = await a.savePhotoPost(ws, d, 0), series = M.create(Core.id); series.items = [M.item(doc, Core.id)];
  const input = { ...M.empty(ws), series: [series] }, before = structuredClone(rows);
  control.beforeWrite = ({ value }) => { if (value?.key === `blog-series:${ws}`) throw new DOMException('quota', 'QuotaExceededError'); };
  await assert.rejects(a.saveBlogSeries(ws, input, 0), { code: 'storage_quota' }); control.beforeWrite = null;
  assert.deepEqual(rows, before); assert.deepEqual(await a.readBlogSeries(ws), M.empty(ws));
  const saved = await a.saveBlogSeries(ws, input, 0), snapshot = await a.readBlogSeriesSnapshot(ws, series.id);
  control.failCompletion = true;
  await assert.rejects(a.saveBlogSeries(ws, { ...saved, series: [] }, saved.revision), { code: 'storage_aborted' });
  assert.deepEqual(await a.readBlogSeries(ws), saved); assert.deepEqual(await a.readBlogSeriesSnapshot(ws, series.id), snapshot);
  const stale = M.create(Core.id); stale.items = [{ ...M.item(doc, Core.id), postRevision: doc.revision + 1 }];
  await assert.rejects(a.saveBlogSeries(ws, { ...saved, series: [series, stale] }, saved.revision), { code: 'blog_series_post_changed' });
  const draft = P.create(Core.id); draft.title = '전송하지 않은 초안'; draft.ops = [{ insert: '비공개 초안\n' }];
  const privateDoc = await a.savePhotoPost(ws, draft, 0), privateSeries = M.create(Core.id);
  privateSeries.items = [{ id: Core.id(), postId: privateDoc.id, postRevision: privateDoc.revision, title: privateDoc.title }];
  await assert.rejects(a.saveBlogSeries(ws, { ...saved, series: [series, privateSeries] }, saved.revision), { code: 'blog_series_post_changed' });
  assert.deepEqual(await a.readBlogSeries(ws), saved);
});

test('blog series file installation remaps all IDs and original bytes atomically without adding ordinary posts or server bindings', async t => {
  const { storage: base, control, rows } = syncFixture(); t.after(() => base.close());
  const P = require('../assets/life/photo-post.js'), M = require('../assets/life/blog-series.js');
  const a = base.forAccount(accountA), bundle = await initialImport(a), ws = bundle.workspaceId;
  const doc = P.create(Core.id); doc.status = 'saved'; doc.revision = 8; doc.title = '복원할 정확한 글';
  const blob = new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0])], { type: 'image/png' });
  const photo = { id: Core.id(), name: '원본.png', type: blob.type, width: 1, height: 1, size: blob.size, digest: await P.digest(blob), blob };
  doc.photos = [photo]; doc.ops = [{ insert: '원본 바이트\n' }, { insert: { photo: { id: photo.id, caption: '그대로 설명', alt: '그대로 대체텍스트' } } }, { insert: '\n' }];
  const series = M.create(Core.id); series.items = [M.item(doc, Core.id)]; const payload = { series, posts: [{ itemId: series.items[0].id, doc }] }, original = structuredClone(payload);
  const before = structuredClone(rows);
  control.beforeWrite = ({ value }) => { if (value?.key === `blog-series:${ws}`) throw new DOMException('quota', 'QuotaExceededError'); };
  await assert.rejects(a.installBlogSeriesCopy(ws, payload), { code: 'storage_quota' }); control.beforeWrite = null; assert.deepEqual(rows, before);
  const result = await a.installBlogSeriesCopy(ws, payload), restored = await a.readBlogSeriesSnapshot(ws, result.seriesId);
  assert.notEqual(restored.series.id, series.id); assert.notEqual(restored.series.items[0].id, series.items[0].id);
  const copy = restored.posts[0].doc; assert.notEqual(copy.id, doc.id); assert.notEqual(copy.photos[0].id, photo.id); assert.equal(copy.revision, 1);
  assert.equal(copy.ops[1].insert.photo.id, copy.photos[0].id); assert.equal(await P.digest(copy.photos[0].blob), photo.digest);
  assert.equal(copy.ops[1].insert.photo.caption, '그대로 설명'); assert.equal(copy.ops[1].insert.photo.alt, '그대로 대체텍스트');
  assert.deepEqual(await a.listPhotoPosts(ws), []); assert.equal(await a.readBlogSyncState(ws, copy.id), null); assert.deepEqual(await a.read(ws), bundle); assert.deepEqual(payload, original);
  const damaged = structuredClone(payload); damaged.posts[0].doc.photos[0].blob = new Blob(['corrupted'], { type: 'image/png' });
  const installed = structuredClone(rows); await assert.rejects(a.installBlogSeriesCopy(ws, damaged)); assert.deepEqual(rows, installed);
});

test('blog series installation cannot write after an account switch during asynchronous original verification', async t => {
  const { storage: base, rows } = syncFixture(); t.after(() => base.close());
  const P = require('../assets/life/photo-post.js'), M = require('../assets/life/blog-series.js'), B = require('../assets/life/blog.js');
  const a = base.forAccount(accountA), ws = (await initialImport(a)).workspaceId;
  const doc = P.create(Core.id); doc.status = 'saved'; doc.revision = 1; doc.title = '지연 검증'; doc.ops = [{ insert: '유지할 글\n' }];
  const series = M.create(Core.id); series.items = [M.item(doc, Core.id)];
  let release, enter; const held = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { enter = resolve; });
  const previous = globalThis.HaedoLife.Blog;
  globalThis.HaedoLife.Blog = { ...B, async hydrate(...args) { enter(); await held; return B.hydrate(...args); } };
  try {
    const before = structuredClone(rows), pending = a.installBlogSeriesCopy(ws, { series, posts: [{ itemId: series.items[0].id, doc }] });
    await entered; base.forAccount(accountB); release(); await assert.rejects(pending, { code: 'storage_scope_closed' }); assert.deepEqual(rows, before);
  } finally { release(); globalThis.HaedoLife.Blog = previous; }
});

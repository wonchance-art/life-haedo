'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createStorage } = require('../assets/life/storage.js'), Core = require('../assets/life/core.js');
const M = require('../assets/life/material-writing.js'), R = require('../assets/life/source-reference.js');
const accountA = { projectUrl: 'https://material-test.supabase.co', userId: 'synthetic-a' }, accountB = { ...accountA, userId: 'synthetic-b' };
const copy = value => structuredClone(value), key = value => JSON.stringify(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };

// Application-level fixture: transactions serialize, own their working copies,
// and publish no writes until done. Native IndexedDB is checked independently in
// the browser journey; this adapter does not claim to emulate its event loop.
function adapter() {
  const rows = new Map(), paths = new Map(), control = { fail: null, failCompletion: false, writes: [] }; let tail = Promise.resolve();
  const idb = { async openDB(_name, _version, callbacks) {
    let closed = false;
    const db = {
      objectStoreNames: { contains: name => rows.has(name) },
      createObjectStore(name, options) { rows.set(name, new Map()); paths.set(name, options.keyPath); return { createIndex() {} }; },
      close() { closed = true; },
      transaction(names, mode) {
        if (closed) throw new DOMException('closed', 'InvalidStateError');
        let resolve, reject, ended = false, written = 0, working;
        const done = new Promise((yes, no) => { resolve = yes; reject = no; }), previous = tail;
        tail = done.catch(() => {});
        function abort(error = new DOMException('aborted', 'AbortError')) { if (!ended) { ended = true; reject(error); } }
        const ready = previous.then(() => {
          if (ended) return;
          working = new Map(names.map(name => [name, copy(rows.get(name))]));
          setImmediate(() => {
            if (ended) return;
            if (mode === 'readwrite' && written && control.failCompletion) { control.failCompletion = false; abort(); return; }
            ended = true; if (mode === 'readwrite') for (const [name, data] of working) rows.set(name, data); resolve();
          });
        });
        async function run(name, method, value) {
          await ready; if (ended) throw new DOMException('inactive', 'AbortError');
          const store = working.get(name);
          if (method === 'get') return copy(store.get(key(value)));
          if (method === 'getAll') return copy([...store.values()]);
          if (method === 'getAllKeys') return [...store.keys()].map(value => JSON.parse(value));
          assert.equal(mode, 'readwrite'); const path = paths.get(name), id = method === 'delete' ? value : Array.isArray(path) ? path.map(field => value[field]) : value[path];
          control.writes.push({ name, method, id }); written++;
          if (control.fail?.({ name, method, id, value })) { control.fail = null; const error = new DOMException('quota', 'QuotaExceededError'); abort(error); throw error; }
          if (method === 'delete') store.delete(key(id));
          else { if (method === 'add' && store.has(key(id))) throw new DOMException('duplicate', 'ConstraintError'); store.set(key(id), copy(value)); }
          return id;
        }
        return { done, abort, objectStore(name) { return { get: value => run(name, 'get', value), getAll: () => run(name, 'getAll'), getAllKeys: () => run(name, 'getAllKeys'),
          put: value => run(name, 'put', value), add: value => run(name, 'add', value), delete: value => run(name, 'delete', value),
          index(field) { return { async getAll(value) { return (await run(name, 'getAll')).filter(row => row[field] === value); } }; } }; } };
      }
    };
    if (!rows.size) callbacks.upgrade(db, 0, 1); return db;
  } };
  return { rows, control, idb };
}
async function fixture() {
  const f = adapter(), options = { idb: f.idb, core: Core, channelFactory: null, account: accountA };
  const a = createStorage(options), b = createStorage(options), foreign = createStorage({ ...options, account: accountB });
  let bundle = await a.createWorkspace('익명 자료 글쓰기'), ws = bundle.workspaceId;
  const prepared = await Core.prepareImport({ origin: 'obsidian', title: '정확한 옛 자료',
    text: '🌿\r\n선택한 구절\r\n채택하지 않은 원문 끝', author: '원저자', authorRelation: 'other', coverage: 'partial' }, bundle);
  await a.commitLocal({ workspaceId: ws, operationId: Core.id(), baseRevision: bundle.revision, changes: Core.buildImportChanges(bundle, prepared) });
  bundle = await a.read(ws);
  const material = M.material(bundle, prepared.source.id, prepared.version.id, Core.id); material.note = '자료별 비공개 메모';
  const start = prepared.version.contentText.indexOf('선택한'), reference = await R.build({ bundle, sourceId: material.sourceId, versionId: material.sourceVersionId, locator: { start, end: start + '선택한 구절'.length } });
  const plan = M.create(Core.id); plan.title = '내 글의 제목'; plan.question = '비공개 질문'; plan.materials = [material];
  plan.blocks = [{ id: Core.id(), kind: 'heading', text: '내 개요' }, { id: Core.id(), kind: 'quote', materialId: material.id, reference }, { id: Core.id(), kind: 'paragraph', text: '내가 직접 쓴 문단' }];
  const state = await a.saveMaterialWriting(ws, { ...M.empty(ws), plans: [plan] }, 0);
  return { ...f, a, b, foreign, ws, bundle, plan, state, reference, close() { a.close(); b.close(); foreign.close(); } };
}
test('handoff atomically creates only adopted content and exact evidence; lost replies resume the same current post', async t => {
  const f = await fixture(); t.after(f.close);
  const source = copy(await f.a.read(f.ws)), result = await f.a.createMaterialWritingPost(f.ws, f.plan.id, f.state.revision);
  assert.equal(result.created, true); assert.equal(result.revision, 1); assert.equal(result.planRevision, 2);
  const doc = await f.a.readPhotoPost(f.ws, result.postId), evidence = await f.a.readPostEvidence(f.ws, result.postId), wire = JSON.stringify(doc);
  assert.equal(doc.status, 'draft'); assert.equal(doc.replaces, null); assert.deepEqual(evidence, { revision: 1, refs: [f.reference] });
  assert(wire.includes('내가 직접 쓴 문단')); assert(!wire.includes('자료별 비공개 메모')); assert(!wire.includes('비공개 질문')); assert(!wire.includes('채택하지 않은 원문 끝'));
  const retry = await f.a.createMaterialWritingPost(f.ws, f.plan.id, f.state.revision);
  assert.deepEqual(retry, { ...result, created: false }); assert.equal((await f.a.listPhotoPosts(f.ws)).length, 1); assert.deepEqual(await f.a.read(f.ws), source);
  const current = await f.a.readMaterialWriting(f.ws); current.plans[0].blocks[2].text = '준비에서만 고친 생각';
  const saved = await f.a.saveMaterialWriting(f.ws, current, current.revision);
  assert.equal((await f.a.createMaterialWritingPost(f.ws, f.plan.id, saved.revision)).postId, result.postId);
  assert.deepEqual(await f.a.readPhotoPost(f.ws, result.postId), doc);
});
test('two independent tabs create at most one result and stale plan writes lose CAS without erasing either input', async t => {
  const f = await fixture(); t.after(f.close);
  const first = copy(f.state), second = copy(f.state); first.plans[0].question = 'A 입력'; second.plans[0].question = 'B 입력';
  const writes = await Promise.allSettled([f.a.saveMaterialWriting(f.ws, first, first.revision), f.b.saveMaterialWriting(f.ws, second, second.revision)]);
  assert.equal(writes.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(writes.find(value => value.status === 'rejected').reason.code, 'material_writing_conflict'); assert.equal(second.plans[0].question, 'B 입력');
  const state = await f.a.readMaterialWriting(f.ws), results = await Promise.all([f.a.createMaterialWritingPost(f.ws, f.plan.id, state.revision), f.b.createMaterialWritingPost(f.ws, f.plan.id, state.revision)]);
  assert.equal(results.filter(value => value.created).length, 1); assert.equal(results[0].postId, results[1].postId); assert.equal((await f.a.listPhotoPosts(f.ws)).length, 1);
});
test('each failed handoff write and transaction completion leave plan, index, evidence and receipt wholly unchanged', async () => {
  for (const point of ['post', 'index', 'evidence', 'plan', 'receipt', 'completion']) {
    const f = await fixture();
    try {
      const before = copy(f.rows), offset = f.control.writes.length;
      if (point === 'completion') f.control.failCompletion = true;
      else f.control.fail = ({ name, id }) => name === 'meta' && typeof id === 'string' &&
        (point === 'post' ? id.startsWith(`photo-post:${f.ws}:`) : point === 'index' ? id === `photo-posts:${f.ws}` :
          point === 'evidence' ? id.startsWith(`post-evidence:${f.ws}:`) : point === 'plan' ? id === `material-writing:${f.ws}` : id.startsWith(`material-writing-output:${f.ws}:`));
      await assert.rejects(f.a.createMaterialWritingPost(f.ws, f.plan.id, f.state.revision), { code: point === 'completion' ? 'storage_aborted' : 'storage_quota' });
      assert(f.control.writes.length > offset, 'failure must occur after reaching the write transaction');
      if (point === 'receipt' || point === 'completion') assert(f.control.writes.slice(offset).some(row => row.id === `material-writing:${f.ws}`));
      assert.deepEqual(f.rows, before); const retry = await f.a.createMaterialWritingPost(f.ws, f.plan.id, f.state.revision);
      assert.equal(retry.created, true); assert.equal((await f.a.listPhotoPosts(f.ws)).length, 1);
    } finally { f.close(); }
  }
});
test('forged or reset outputs and deleted-plan identity reuse cannot bypass the committed handoff receipt', async t => {
  const f = await fixture(); t.after(f.close); const before = copy(f.rows), forged = copy(f.state); forged.plans[0].output = { postId: Core.id() };
  await assert.rejects(f.a.saveMaterialWriting(f.ws, forged, forged.revision), { code: 'material_writing_conflict' }); assert.deepEqual(f.rows, before);
  const result = await f.a.createMaterialWritingPost(f.ws, f.plan.id, f.state.revision), state = await f.a.readMaterialWriting(f.ws), reset = copy(state); reset.plans[0].output = null;
  await assert.rejects(f.a.saveMaterialWriting(f.ws, reset, reset.revision), { code: 'material_writing_conflict' });
  const removed = await f.a.saveMaterialWriting(f.ws, { ...state, plans: [] }, state.revision), reused = { ...removed, plans: [copy(f.plan)] };
  await assert.rejects(f.a.saveMaterialWriting(f.ws, reused, reused.revision), { code: 'material_writing_conflict' });
  const explicit = copy(f.plan); explicit.id = Core.id(); explicit.materials[0].id = Core.id(); for (const block of explicit.blocks) { block.id = Core.id(); if (block.kind === 'quote') block.materialId = explicit.materials[0].id; }
  const next = await f.a.saveMaterialWriting(f.ws, { ...removed, plans: [explicit] }, removed.revision), created = await f.a.createMaterialWritingPost(f.ws, explicit.id, next.revision);
  assert.notEqual(created.postId, result.postId); assert.equal((await f.a.listPhotoPosts(f.ws)).length, 2);
});
test('saved replacement migrates every matching plan and historical receipt in the same atomic post transaction', async t => {
  const f = await fixture(); t.after(f.close); const created = await f.a.createMaterialWritingPost(f.ws, f.plan.id, f.state.revision);
  let doc = await f.a.readPhotoPost(f.ws, created.postId); doc.status = 'saved'; doc = await f.a.savePhotoPost(f.ws, doc, doc.revision);
  const raw = f.rows.get('meta').get(key(`material-writing:${f.ws}`)).value, second = copy(raw.plans[0]);
  second.id = Core.id(); second.materials[0].id = Core.id(); for (const block of second.blocks) { block.id = Core.id(); if (block.kind === 'quote') block.materialId = second.materials[0].id; }
  raw.plans.push(second); M.validate(raw); f.rows.get('meta').set(key(`material-writing-output:${f.ws}:${second.id}`), { key: `material-writing-output:${f.ws}:${second.id}`, value: { postId: doc.id } });
  const historicalId = Core.id(); f.rows.get('meta').set(key(`material-writing-output:${f.ws}:${historicalId}`), { key: `material-writing-output:${f.ws}:${historicalId}`, value: { postId: doc.id } });
  const foreignKey = `material-writing-output:${Core.id()}:${Core.id()}`; f.rows.get('meta').set(key(foreignKey), { key: foreignKey, value: { postId: doc.id } });
  const edited = { ...copy(doc), id: Core.id(), revision: 0, title: '새 ID 편집 결과', replaces: { id: doc.id, revision: doc.revision } }, before = copy(f.rows);
  f.control.fail = ({ id }) => id === `material-writing:${f.ws}`;
  await assert.rejects(f.a.savePhotoPost(f.ws, edited, 0), { code: 'storage_quota' }); assert.deepEqual(f.rows, before);
  const saved = await f.a.savePhotoPost(f.ws, edited, 0), state = await f.a.readMaterialWriting(f.ws);
  assert(state.plans.every(plan => plan.output.postId === saved.id));
  assert.equal(f.rows.get('meta').get(key(`material-writing-output:${f.ws}:${historicalId}`)).value.postId, saved.id);
  assert.equal(f.rows.get('meta').get(key(foreignKey)).value.postId, doc.id);
  assert.equal((await f.a.createMaterialWritingPost(f.ws, f.plan.id, f.state.revision)).postId, saved.id);
  assert.equal((await f.a.createMaterialWritingPost(f.ws, second.id, f.state.revision)).postId, saved.id);
  await assert.rejects(f.a.readPhotoPost(f.ws, doc.id), { code: 'photo_post_missing' }); assert.deepEqual((await f.a.readPostEvidence(f.ws, saved.id)).refs, [f.reference]);
});
test('missing output and inconsistent persisted receipt stop resuming without automatically generating another post', async t => {
  const f = await fixture(); t.after(f.close); const result = await f.a.createMaterialWritingPost(f.ws, f.plan.id, f.state.revision);
  f.rows.get('meta').delete(key(`photo-post:${f.ws}:${result.postId}`)); const missing = copy(f.rows);
  await assert.rejects(f.a.createMaterialWritingPost(f.ws, f.plan.id, f.state.revision), { code: 'material_writing_output_missing' }); assert.deepEqual(f.rows, missing);
  f.rows.get('meta').get(key(`material-writing-output:${f.ws}:${f.plan.id}`)).value.postId = Core.id(); const changed = copy(f.rows);
  await assert.rejects(f.a.readMaterialWriting(f.ws), { code: 'invalid_material_writing' }); assert.deepEqual(f.rows, changed);
});
test('source, plan and account changes during asynchronous exact-source verification cannot install a stale result', async () => {
  for (const point of ['source', 'plan', 'account']) {
    const f = await fixture(), entered = deferred(), held = deferred(), prior = globalThis.HaedoLife.SourceReference;
    globalThis.HaedoLife.SourceReference = { ...R, async resolve(...args) { const result = await R.resolve(...args); entered.resolve(); await held.promise; return result; } };
    try {
      const pending = f.a.createMaterialWritingPost(f.ws, f.plan.id, f.state.revision); await entered.promise;
      if (point === 'source') f.rows.get('bundles').get(key(f.ws)).sourceVersions[0].contentText += '\n구절 밖에서 바뀐 내용';
      else if (point === 'plan') { const next = copy(f.state); next.plans[0].blocks[2].text = '다른 탭이 새로 쓴 입력'; await f.b.saveMaterialWriting(f.ws, next, next.revision); }
      else f.a.dispose();
      const before = copy(f.rows); held.resolve(); await assert.rejects(pending, { code: point === 'source' ? 'invalid_source_reference' : point === 'plan' ? 'material_writing_conflict' : 'storage_scope_closed' });
      assert.deepEqual(f.rows, before);
    } finally { held.resolve(); globalThis.HaedoLife.SourceReference = prior; f.close(); }
  }
});
test('owner checks and late transaction cancellation preserve the source and reject a foreign account', async t => {
  const f = await fixture(); t.after(f.close); const before = copy(f.rows);
  await assert.rejects(f.foreign.readMaterialWriting(f.ws), { code: 'workspace_access_denied' });
  await assert.rejects(f.foreign.saveMaterialWriting(f.ws, f.state, f.state.revision), { code: 'workspace_access_denied' });
  await assert.rejects(f.foreign.createMaterialWritingPost(f.ws, f.plan.id, f.state.revision), { code: 'workspace_access_denied' }); assert.deepEqual(f.rows, before);
});
test('declared source hashes cannot certify changed raw text and empty outlines cannot create a document', async t => {
  const f = await fixture(); t.after(f.close);
  const raw = f.rows.get('bundles').get(key(f.ws)); raw.sourceVersions[0].contentText += '\n해시를 바꾸지 않은 손상';
  const before = copy(f.rows);
  await assert.rejects(f.a.createMaterialWritingPost(f.ws, f.plan.id, f.state.revision), { code: 'invalid_source_reference' }); assert.deepEqual(f.rows, before);
  const blank = copy(f.state); blank.plans[0].blocks = []; const saved = await f.a.saveMaterialWriting(f.ws, blank, blank.revision), changed = copy(f.rows);
  await assert.rejects(f.a.createMaterialWritingPost(f.ws, f.plan.id, saved.revision), { code: 'invalid_material_writing' }); assert.deepEqual(f.rows, changed);
});

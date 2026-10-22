'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createStorage } = require('../assets/life/storage.js'), Core = require('../assets/life/core.js');
const C = require('../assets/life/material-continuity.js'), P = require('../assets/life/photo-post.js'), Blog = require('../assets/life/blog.js');
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
function rowFor(f, output = null, revision = 1) { return { id: Core.id(), revision, data: C.snapshot(f.bundle, f.plan, output), updated_at: new Date().toISOString() }; }
async function connect(f, output = null, own = false) {
  const row = rowFor(f, output), state = { revision: 0, binding: accountA, enabled: true, remoteId: row.id, remoteRevision: row.revision, head: row, mapping: null, output,
    pending: null, conflict: null, localClaim: own ? { postId: output.postId, claimId: output.claimId } : null, error: null };
  return { row, state: await f.a.writeMaterialContinuityState(f.ws, f.plan.id, state, 0) };
}
function writing() { return { state: 'writing', postId: Core.id(), claimId: Core.id() }; }
function savedPost(f, output) { const doc = P.create(Core.id); doc.id = output.postId; doc.title = '기존 완성 글'; doc.ops = [{ insert: '선택한 구절과 내 글\n' }]; doc.status = 'saved'; doc.revision = 4; return doc; }
test('first receive atomically creates an account-owned independent exact closure and canonical roundtrip stays clean', async t => {
  const f = await fixture(); t.after(f.close); const row = rowFor(f), before = copy(await f.a.read(f.ws));
  const result = await f.a.installMaterialContinuity(row);
  assert.notEqual(result.workspaceId, f.ws); assert.notEqual(result.planId, f.plan.id); assert.equal(result.bundle.records.length, 0);
  assert.notEqual(result.bundle.sources[0].id, f.bundle.sources[0].id); assert.equal(result.bundle.sourceVersions[0].contentText, f.bundle.sourceVersions[0].contentText);
  const value = await f.a.readMaterialContinuitySnapshot(result.workspaceId, result.planId);
  assert.equal(value.fingerprint, await C.fingerprint(row.data)); assert.deepEqual(value.data, row.data); assert.equal(value.plan.output, null);
  assert.deepEqual(await f.a.findMaterialContinuity(row.id), { workspaceId: result.workspaceId, planId: result.planId });
  const retry = await f.a.installMaterialContinuity(row, { target: result && { workspaceId: result.workspaceId, planId: result.planId }, expectedFingerprint: value.fingerprint });
  assert.equal(retry.existing, true); assert.equal((await f.a.listWorkspaces()).length, 2); assert.deepEqual(await f.a.read(f.ws), before);
  await assert.rejects(f.foreign.readMaterialWriting(result.workspaceId), { code: 'workspace_access_denied' }); assert.equal(await f.foreign.findMaterialContinuity(row.id), null);
});
test('every installation write and transaction completion roll back owner, closure, plan, binding and global receipt', async () => {
  for (const point of ['bundles', 'owner:', 'material-writing:', 'material-continuity:', 'material-continuity-install:', 'completion']) {
    const f = await fixture();
    try {
      const row = rowFor(f), before = copy(f.rows), offset = f.control.writes.length;
      if (point === 'completion') f.control.failCompletion = true;
      else f.control.fail = ({ name, id }) => point === 'bundles' ? name === 'bundles' : name === 'meta' && id.startsWith(point);
      await assert.rejects(f.a.installMaterialContinuity(row), { code: point === 'completion' ? 'storage_aborted' : 'storage_quota' });
      assert(f.control.writes.length > offset); assert.deepEqual(f.rows, before); assert.equal(await f.a.findMaterialContinuity(row.id), null);
      const retry = await f.a.installMaterialContinuity(row); assert.equal((await f.a.listWorkspaces()).length, 2); assert.equal(retry.existing, false);
    } finally { f.close(); }
  }
});
test('connected handoff requires acknowledged locally owned claim and its retry creates one canonical post with a paused blog binding', async t => {
  const f = await fixture(); t.after(f.close); const output = writing(), { row } = await connect(f, output, true);
  await assert.rejects(f.a.createMaterialWritingPost(f.ws, f.plan.id, f.state.revision), { code: 'material_claim_required' });
  const result = await f.a.finishMaterialContinuityClaim(f.ws, f.plan.id, f.state.revision);
  assert.equal(result.postId, output.postId); assert.equal(result.created, true); assert.deepEqual((await f.a.readPostEvidence(f.ws, result.postId)).refs, [f.reference]);
  const binding = await f.a.readBlogSyncState(f.ws, result.postId); assert.equal(binding.remoteId, output.postId); assert.equal(binding.remoteRevision, 0); assert.equal(binding.enabled, false); assert.equal(binding.enableOnSave, true);
  assert.equal((await f.a.finishMaterialContinuityClaim(f.ws, f.plan.id, f.state.revision)).created, false); assert.equal((await f.a.listPhotoPosts(f.ws)).length, 1);
  const receiver = await f.b.installMaterialContinuity({ ...row, id: Core.id() });
  await assert.rejects(f.b.finishMaterialContinuityClaim(receiver.workspaceId, receiver.planId, receiver.planRevision), { code: 'material_output_elsewhere' });
  await assert.rejects(f.b.createMaterialWritingPost(receiver.workspaceId, receiver.planId, receiver.planRevision), { code: 'material_claim_required' });
  assert.equal((await f.b.listPhotoPosts(receiver.workspaceId)).length, 0);
});
test('claim handoff abort includes the canonical binding and retries exactly once; saved replacement retains that identity', async t => {
  const f = await fixture(); t.after(f.close); const output = writing(); await connect(f, output, true); const before = copy(f.rows);
  f.control.fail = ({ id }) => id === `blog-sync:${f.ws}:${output.postId}`;
  await assert.rejects(f.a.finishMaterialContinuityClaim(f.ws, f.plan.id, f.state.revision), { code: 'storage_quota' }); assert.deepEqual(f.rows, before);
  const result = await f.a.finishMaterialContinuityClaim(f.ws, f.plan.id, f.state.revision);
  let doc = await f.a.readPhotoPost(f.ws, result.postId); doc.status = 'saved'; doc = await f.a.savePhotoPost(f.ws, doc, doc.revision);
  const replacement = { ...copy(doc), id: Core.id(), revision: 0, replaces: { id: doc.id, revision: doc.revision } }, changed = await f.a.savePhotoPost(f.ws, replacement, 0);
  assert.equal((await f.a.readMaterialWriting(f.ws)).plans[0].output.postId, changed.id);
  assert.equal((await f.a.readBlogSyncState(f.ws, changed.id)).remoteId, output.postId);
  assert.equal((await f.a.finishMaterialContinuityClaim(f.ws, f.plan.id, 0)).postId, changed.id);
});
test('saved output installs exact evidence, post and public CAS metadata in one transaction without transporting local IDs', async t => {
  const f = await fixture(); t.after(f.close); const output = { ...writing(), state: 'saved', revision: 3, refs: [f.reference] }, row = rowFor(f, output), post = savedPost(f, output);
  const blogRow = { id: output.postId, workspace_id: f.ws, revision: 3, data: Blog.pack(post), publication: { revision: 9, active: false, token: Core.id() } };
  const before = copy(f.rows); f.control.fail = ({ id }) => typeof id === 'string' && id.startsWith('material-continuity-install:');
  await assert.rejects(f.a.installMaterialContinuity(row, { post, blogRow }), { code: 'storage_quota' }); assert.deepEqual(f.rows, before);
  const result = await f.a.installMaterialContinuity(row, { post, blogRow }), doc = await f.a.readPhotoPost(result.workspaceId, result.postId), ev = await f.a.readPostEvidence(result.workspaceId, result.postId);
  assert.notEqual(doc.id, post.id); assert.equal(doc.revision, 1); assert.deepEqual(doc.ops, post.ops); assert.equal(ev.refs[0].workspaceId, result.workspaceId);
  await R.resolve(result.bundle, ev.refs[0]);
  const binding = await f.a.readBlogSyncState(result.workspaceId, doc.id); assert.equal(binding.remoteId, output.postId); assert.equal(binding.remoteRevision, 3); assert.deepEqual(binding.publication, blogRow.publication);
  const actual = await f.a.readMaterialContinuitySnapshot(result.workspaceId, result.planId); assert.deepEqual(actual.refs, output.refs); assert.equal(actual.fingerprint, await C.fingerprint(row.data));
});
test('selected preparation changes block apply, while unrelated preparations do not change its fingerprint', async t => {
  const f = await fixture(); t.after(f.close); const { row } = await connect(f), before = await f.a.readMaterialContinuitySnapshot(f.ws, f.plan.id);
  let wrapper = await f.a.readMaterialWriting(f.ws); wrapper.plans.push(M.create(Core.id)); wrapper = await f.a.saveMaterialWriting(f.ws, wrapper, wrapper.revision);
  assert.equal((await f.a.readMaterialContinuitySnapshot(f.ws, f.plan.id)).fingerprint, before.fingerprint);
  wrapper.plans[0].question = '검토 뒤 바뀐 입력'; await f.a.saveMaterialWriting(f.ws, wrapper, wrapper.revision); const original = copy(f.rows);
  await assert.rejects(f.a.installMaterialContinuity({ ...row, revision: 2 }, { target: { workspaceId: f.ws, planId: f.plan.id }, expectedFingerprint: before.fingerprint }), { code: 'material_continuity_changed' }); assert.deepEqual(f.rows, original);
});
test('same-revision tampering, output regression and foreign bindings are refused with no writes', async t => {
  const f = await fixture(); t.after(f.close); const output = writing(), connected = await connect(f, output, true), before = copy(f.rows);
  const tampered = copy(connected.state); tampered.head.data.plan.question += ' changed';
  await assert.rejects(f.a.writeMaterialContinuityState(f.ws, f.plan.id, tampered, tampered.revision), { code: 'remote_revision_mismatch' });
  const regress = copy(connected.state); regress.remoteRevision++; regress.output = null; regress.localClaim = null; regress.head.revision++; regress.head.data.output = null;
  await assert.rejects(f.a.writeMaterialContinuityState(f.ws, f.plan.id, regress, regress.revision), { code: 'invalid_material_continuity' });
  await assert.rejects(f.foreign.readMaterialContinuitySnapshot(f.ws, f.plan.id), { code: 'workspace_access_denied' }); assert.deepEqual(f.rows, before);
});
test('late account disposal during verification installs no partial copy', async t => {
  const f = await fixture(); t.after(f.close); const row = rowFor(f), before = copy(f.rows), gate = deferred(), entered = deferred(), original = globalThis.HaedoLife.MaterialContinuity;
  globalThis.HaedoLife.MaterialContinuity = { ...C, async verify(value) { entered.resolve(); await gate.promise; return C.verify(value); } };
  try { const installing = f.b.installMaterialContinuity(row); await entered.promise; f.b.dispose(); gate.resolve(); await assert.rejects(installing, { code: 'storage_scope_closed' }); assert.deepEqual(f.rows, before); }
  finally { globalThis.HaedoLife.MaterialContinuity = original; gate.resolve(); }
});
test('first connect can resume an existing saved replacement through its older canonical Blog identity', async t => {
  const f = await fixture(); t.after(f.close); const result = await f.a.createMaterialWritingPost(f.ws, f.plan.id, f.state.revision);
  let doc = await f.a.readPhotoPost(f.ws, result.postId); doc.status = 'saved'; doc = await f.a.savePhotoPost(f.ws, doc, doc.revision);
  await f.a.writeBlogSyncState(f.ws, doc.id, { enabled: true, remoteId: doc.id, remoteRevision: 2, localRevision: doc.revision, remoteWorkspaceId: f.ws, remoteManifest: Blog.pack(doc), publication: { active: true, revision: 3 }, pending: null }, 0);
  const replacement = await f.a.savePhotoPost(f.ws, { ...copy(doc), id: Core.id(), revision: 0, replaces: { id: doc.id, revision: doc.revision } }, 0);
  const output = { ...writing(), postId: doc.id }; await connect(f, output, true);
  const resumed = await f.a.finishMaterialContinuityClaim(f.ws, f.plan.id, 0);
  assert.equal(resumed.postId, replacement.id); assert.equal(resumed.created, false); assert.equal((await f.a.readBlogSyncState(f.ws, replacement.id)).remoteId, doc.id);
});
test('explicit conflict choices preserve both completed local result and winning foreign claim without granting its authority', async () => {
  for (const choice of ['preserveLocal', 'preserveRemote']) {
    const f = await fixture();
    try {
      const result = await f.a.createMaterialWritingPost(f.ws, f.plan.id, f.state.revision), originalPost = await f.a.readPhotoPost(f.ws, result.postId);
      const connected = await connect(f), remote = copy(connected.row); remote.revision++; remote.data.output = writing(); remote.data.plan.question = '서버 쪽 질문';
      const before = await f.a.readMaterialContinuitySnapshot(f.ws, f.plan.id);
      const installed = await f.a.installMaterialContinuity(remote, { target: { workspaceId: f.ws, planId: f.plan.id }, expectedFingerprint: before.fingerprint, [choice]: true });
      const state = await f.a.readMaterialContinuityState(f.ws, f.plan.id), wrapper = await f.a.readMaterialWriting(f.ws);
      assert.equal(state.localClaim, null); assert.equal(wrapper.plans[0].output, null); assert.deepEqual(await f.a.readPhotoPost(f.ws, originalPost.id), originalPost);
      assert.equal(wrapper.plans[0].question, choice === 'preserveLocal' ? '서버 쪽 질문' : f.plan.question);
      const recoveryWorkspace = choice === 'preserveLocal' ? installed.recoveryWorkspaceId : installed.localRecoveryWorkspaceId;
      const recoveryPlanId = choice === 'preserveLocal' ? installed.recoveryPlanId : installed.localRecoveryPlanId;
      const recovered = await f.a.readMaterialWriting(recoveryWorkspace), localPost = await f.a.readPhotoPost(recoveryWorkspace, recovered.plans[0].output.postId);
      assert.equal(recovered.plans[0].id, recoveryPlanId); assert.notEqual(localPost.id, originalPost.id); assert.deepEqual(localPost.ops, originalPost.ops);
      assert.equal(await f.a.readMaterialContinuityState(recoveryWorkspace, recoveryPlanId), null); assert.equal(await f.a.readBlogSyncState(recoveryWorkspace, localPost.id), null);
      const evidence = await f.a.readPostEvidence(recoveryWorkspace, localPost.id); await R.resolve(await f.a.read(recoveryWorkspace), evidence.refs[0]);
      await assert.rejects(f.a.createMaterialWritingPost(f.ws, f.plan.id, wrapper.revision), { code: 'material_claim_required' });
      await assert.rejects(f.a.finishMaterialContinuityClaim(f.ws, f.plan.id, wrapper.revision), { code: 'material_output_elsewhere' });
      await f.a.readMaterialContinuitySnapshot(f.ws, f.plan.id);
    } finally { f.close(); }
  }
});
test('edited local output cannot be overwritten by clean receive; explicit preservation keeps the exact loser and sidecar', async t => {
  const f = await fixture(); t.after(f.close); const output = { ...writing(), state: 'saved', revision: 2, refs: [f.reference] }, row = rowFor(f, output), post = savedPost(f, output);
  const installed = await f.a.installMaterialContinuity(row, { post }), target = { workspaceId: installed.workspaceId, planId: installed.planId };
  let local = await f.a.readPhotoPost(target.workspaceId, installed.postId); local.ops = [{ insert: '이 기기 미보관 글\n' }]; local = await f.a.savePhotoPost(target.workspaceId, local, local.revision);
  const latest = copy(row); latest.revision++; latest.data.output.revision++; const newPost = copy(post); newPost.ops = [{ insert: '서버의 새 완성글\n' }]; newPost.revision++;
  const before = await f.a.readMaterialContinuitySnapshot(target.workspaceId, target.planId), raw = copy(f.rows);
  await assert.rejects(f.a.installMaterialContinuity(latest, { target, expectedFingerprint: before.fingerprint, post: newPost }), { code: 'local_changed' }); assert.deepEqual(f.rows, raw);
  const result = await f.a.installMaterialContinuity(latest, { target, expectedFingerprint: before.fingerprint, post: newPost, preserveLocal: true });
  assert.notEqual(result.postId, local.id); assert.deepEqual(await f.a.readPhotoPost(target.workspaceId, local.id), local);
  const recovered = await f.a.readMaterialWriting(result.recoveryWorkspaceId), recoveryPost = await f.a.readPhotoPost(result.recoveryWorkspaceId, recovered.plans[0].output.postId);
  assert.deepEqual(recoveryPost.ops, local.ops); assert.equal(await f.a.readBlogSyncState(result.recoveryWorkspaceId, recoveryPost.id), null);
  assert.deepEqual((await f.a.readPhotoPost(target.workspaceId, result.postId)).ops, newPost.ops);
});
test('simultaneous receives install at most one durable account binding and repeat resumes its existing tuple', async t => {
  const f = await fixture(); t.after(f.close); const row = rowFor(f), results = await Promise.allSettled([f.a.installMaterialContinuity(row), f.b.installMaterialContinuity(row)]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1); assert(['material_continuity_exists', 'material_continuity_changed'].includes(results.find(value => value.status === 'rejected').reason.code));
  const tuple = await f.b.findMaterialContinuity(row.id); assert(tuple); assert.equal((await f.a.listWorkspaces()).length, 2);
});
test('an edit after reviewed snapshot hashing but before the final transaction cannot install stale data', async t => {
  const f = await fixture(); t.after(f.close); const { row } = await connect(f), before = await f.a.readMaterialContinuitySnapshot(f.ws, f.plan.id), gate = deferred(), entered = deferred();
  const module = globalThis.HaedoLife.MaterialContinuity; let gated = false;
  globalThis.HaedoLife.MaterialContinuity = { ...C, async fingerprint(value) { const hash = await C.fingerprint(value); if (!gated) { gated = true; entered.resolve(); await gate.promise; } return hash; } };
  try {
    const applying = f.a.installMaterialContinuity({ ...row, revision: 2 }, { target: { workspaceId: f.ws, planId: f.plan.id }, expectedFingerprint: before.fingerprint });
    await entered.promise; const edited = await f.b.readMaterialWriting(f.ws); edited.plans[0].question = '해시 대기 중 다른 탭 입력'; await f.b.saveMaterialWriting(f.ws, edited, edited.revision);
    const preserved = copy(f.rows); gate.resolve(); await assert.rejects(applying, { code: 'material_continuity_changed' }); assert.deepEqual(f.rows, preserved);
  } finally { globalThis.HaedoLife.MaterialContinuity = module; gate.resolve(); }
});

async function editedMaterialFixture() {
  const f = await fixture(), Edit = require('../assets/life/source-edit.js'), original = f.bundle.sourceVersions[0];
  const stage = Edit.edit(Edit.begin(f.bundle, original.sourceId), { text: original.contentText + '\n내가 수정한 사본 끝' });
  const prepared = await Edit.prepare(f.bundle, stage);
  assert.equal((await f.a.commitLocal({ workspaceId: f.ws, baseRevision: f.bundle.revision, operationId: Core.id(), changes: prepared.changes })).status, 'stored');
  f.bundle = await f.a.read(f.ws);
  const plan = copy(f.plan), material = plan.materials[0], quote = plan.blocks.find(block => block.kind === 'quote');
  material.sourceVersionId = prepared.version.id; material.contentHash = prepared.version.contentHash;
  const reference = await R.build({ bundle: f.bundle, sourceId: material.sourceId, versionId: material.sourceVersionId, locator: quote.reference.locator });
  quote.reference = reference;
  const wrapper = await f.a.readMaterialWriting(f.ws); wrapper.plans[0] = plan;
  f.state = await f.a.saveMaterialWriting(f.ws, wrapper, wrapper.revision); f.plan = plan; f.reference = reference;
  return { ...f, prepared };
}
test('edited-source markers are atomically remapped, installed and canonically fingerprinted without transferring base history or trash state', async t => {
  const f = await editedMaterialFixture(); t.after(f.close);
  assert.equal((await f.a.commitLocal({ workspaceId: f.ws, baseRevision: f.bundle.revision, operationId: Core.id(),
    changes: Core.buildSourceStateChanges(f.bundle, f.bundle.sources[0].id, 'trash') })).status, 'stored');
  f.bundle = await f.a.read(f.ws);
  const row = rowFor(f), marker = row.data.bundle.links[0];
  assert.equal(row.data.bundle.links.length, 1); assert.equal(marker.kind, 'source_edited_copy');
  const raw = copy(f.rows); f.control.fail = ({ id }) => typeof id === 'string' && id.startsWith('material-continuity-install:');
  await assert.rejects(f.a.installMaterialContinuity(row), { code: 'storage_quota' }); assert.deepEqual(f.rows, raw);
  const result = await f.a.installMaterialContinuity(row), installed = await f.a.read(result.workspaceId);
  assert.equal(installed.links.length, 1); assert.notEqual(installed.links[0].id, marker.id);
  assert(Core.isEditedCopy(installed, installed.sourceVersions[0].id)); assert(Core.isSourceActive(installed, installed.sources[0].id));
  assert.equal(installed.links.some(link => link.kind === 'source_edit_base'), false);
  const state = await f.a.readMaterialContinuityState(result.workspaceId, result.planId);
  assert.equal(state.mapping.linkIds[marker.id], installed.links[0].id);
  const snapshot = await f.a.readMaterialContinuitySnapshot(result.workspaceId, result.planId);
  assert.deepEqual(snapshot.data, row.data); assert.equal(snapshot.fingerprint, await C.fingerprint(row.data));
  const repeat = await f.a.installMaterialContinuity(row, { target: { workspaceId: result.workspaceId, planId: result.planId }, expectedFingerprint: snapshot.fingerprint });
  assert.equal(repeat.existing, true); assert.equal(repeat.bundle.links.length, 1);
});
test('a partial receive cannot strip a marker from an edited version already known to the receiving workspace', async t => {
  const f = await editedMaterialFixture(); t.after(f.close); const row = rowFor(f), result = await f.a.installMaterialContinuity(row);
  const target = { workspaceId: result.workspaceId, planId: result.planId }, baseline = await f.a.readMaterialContinuitySnapshot(target.workspaceId, target.planId);
  const stripped = copy(row); stripped.revision++; stripped.data.bundle.links = [];
  await C.verify(stripped.data);
  const before = copy(f.rows);
  await assert.rejects(f.a.installMaterialContinuity(stripped, { target, expectedFingerprint: baseline.fingerprint }), { code: 'immutable_source_marker' });
  assert.deepEqual(f.rows, before);
  assert(Core.isEditedCopy(await f.a.read(target.workspaceId), result.bundle.sourceVersions[0].id));
});
test('local conflict choice retains its outline while appending exact dependencies required by the already-saved winning output', async t => {
  const f = await fixture(); t.after(f.close); const { row } = await connect(f); const serverBundle = copy(f.bundle);
  const imported = await Core.prepareImport({ origin: 'obsidian', title: '완성 글에서 추가 인용한 자료', text: '새 원문의 정확한 구절' }, serverBundle);
  const expanded = Core.applyChanges(serverBundle, Core.buildImportChanges(serverBundle, imported));
  const reference = await R.build({ bundle: expanded, sourceId: imported.source.id, versionId: imported.version.id, locator: { start: 0, end: '새 원문의 정확한 구절'.length } });
  const output = { ...writing(), state: 'saved', revision: 1, refs: [reference] }, newer = { ...row, revision: 2, data: C.snapshot(expanded, f.plan, output) }, post = savedPost(f, output);
  const local = await f.a.readMaterialWriting(f.ws); local.plans[0].question = '이 기기의 선택'; await f.a.saveMaterialWriting(f.ws, local, local.revision);
  const before = await f.a.readMaterialContinuitySnapshot(f.ws, f.plan.id), result = await f.a.installMaterialContinuity(newer, { target: { workspaceId: f.ws, planId: f.plan.id }, expectedFingerprint: before.fingerprint, preserveRemote: true, post });
  const actual = await f.a.readMaterialContinuitySnapshot(f.ws, f.plan.id); assert.equal(actual.plan.question, '이 기기의 선택'); assert.equal(actual.data.bundle.sourceVersions.length, 2);
  assert.deepEqual(actual.data.output.refs, [reference]); await R.resolve(actual.data.bundle, actual.data.output.refs[0]);
  const recovery = await f.a.readMaterialWriting(result.recoveryWorkspaceId); assert.equal(await f.a.readBlogSyncState(result.recoveryWorkspaceId, recovery.plans[0].output.postId), null);
});
test('a paused local binding cannot be updated by a receive that reaches storage after pause', async t => {
  const f = await fixture(); t.after(f.close); const { row, state } = await connect(f); await f.b.writeMaterialContinuityState(f.ws, f.plan.id, { ...state, enabled: false }, state.revision);
  const local = await f.a.readMaterialContinuitySnapshot(f.ws, f.plan.id), before = copy(f.rows);
  await assert.rejects(f.a.installMaterialContinuity({ ...row, revision: 2 }, { target: { workspaceId: f.ws, planId: f.plan.id }, expectedFingerprint: local.fingerprint }), { code: 'material_paused' }); assert.deepEqual(f.rows, before);
});
test('the reviewed post and actual sidecar are checked even when a late edit leaves the preparation fingerprint unchanged', async () => {
  for (const point of ['post', 'refs']) {
    const f = await fixture(), gate = deferred(), entered = deferred(), module = globalThis.HaedoLife.MaterialContinuity;
    try {
      const output = writing(), { row } = await connect(f, output, true); await f.a.finishMaterialContinuityClaim(f.ws, f.plan.id, f.state.revision);
      const baseline = await f.a.readMaterialContinuitySnapshot(f.ws, f.plan.id), expectedReview = { post: Blog.pack(P.compact(baseline.post)), refs: baseline.refs };
      let held = false;
      globalThis.HaedoLife.MaterialContinuity = { ...C, async verify(value) { if (!held) { held = true; entered.resolve(); await gate.promise; } return C.verify(value); } };
      const applying = f.a.installMaterialContinuity({ ...row, revision: 2 }, { target: { workspaceId: f.ws, planId: f.plan.id }, expectedFingerprint: baseline.fingerprint, expectedReview });
      await entered.promise;
      if (point === 'post') { const edited = await f.b.readPhotoPost(f.ws, baseline.post.id); edited.ops = [{ insert: '사진 다운로드 중 바뀐 글 전체\n' }]; await f.b.savePhotoPost(f.ws, edited, edited.revision); }
      else { const evidence = await f.b.readPostEvidence(f.ws, baseline.post.id); await f.b.savePostEvidence(f.ws, baseline.post.id, { refs: [] }, evidence.revision); }
      const unchangedPlan = await f.b.readMaterialWriting(f.ws); assert.equal(unchangedPlan.revision, baseline.localRevision);
      const preserved = copy(f.rows); gate.resolve(); await assert.rejects(applying, { code: 'material_continuity_changed' }); assert.deepEqual(f.rows, preserved);
    } finally { globalThis.HaedoLife.MaterialContinuity = module; gate.resolve(); f.close(); }
  }
});
test('separate editing drafts block clean receive and explicit remote choice atomically preserves each exact draft and effective sidecar', async t => {
  const f = await fixture(); t.after(f.close); const output = { ...writing(), state: 'saved', revision: 1, refs: [f.reference] }, row = rowFor(f, output), post = savedPost(f, output);
  const installed = await f.a.installMaterialContinuity(row, { post }), target = { workspaceId: installed.workspaceId, planId: installed.planId }, original = await f.a.readPhotoPost(target.workspaceId, installed.postId);
  const makeDraft = text => ({ ...copy(original), id: Core.id(), revision: 0, status: 'draft', replaces: { id: original.id, revision: original.revision }, ops: [{ insert: text + '\n' }] });
  const inherited = await f.a.savePhotoPost(target.workspaceId, makeDraft('별도 수정 초안 A'), 0), empty = await f.a.savePhotoPost(target.workspaceId, makeDraft('명시 빈 근거 초안 B'), 0);
  await f.a.savePostEvidence(target.workspaceId, empty.id, { refs: [] }, 0);
  const reviewed = await f.a.readMaterialContinuitySnapshot(target.workspaceId, target.planId); assert.equal(reviewed.editingDrafts.length, 2);
  assert.equal(reviewed.editingDrafts.find(value => value.post.id === inherited.id).refs.length, 1); assert.deepEqual(reviewed.editingDrafts.find(value => value.post.id === empty.id).refs, []);
  const newer = copy(row); newer.revision++; newer.data.output.revision++; const remotePost = copy(post); remotePost.ops = [{ insert: '다른 기기 완성 글\n' }]; remotePost.revision++;
  const before = copy(f.rows);
  await assert.rejects(f.a.installMaterialContinuity(newer, { target, expectedFingerprint: reviewed.fingerprint, post: remotePost }), { code: 'local_changed' }); assert.deepEqual(f.rows, before);
  f.control.fail = ({ id }) => id === `material-continuity:${target.workspaceId}:${target.planId}`;
  await assert.rejects(f.a.installMaterialContinuity(newer, { target, expectedFingerprint: reviewed.fingerprint, post: remotePost, preserveLocal: true }), { code: 'storage_quota' }); assert.deepEqual(f.rows, before);
  const result = await f.a.installMaterialContinuity(newer, { target, expectedFingerprint: reviewed.fingerprint, post: remotePost, preserveLocal: true }); assert.equal(result.editingRecovery.length, 2);
  const recovered = [];
  for (const tuple of result.editingRecovery) {
    const draft = await f.a.readPhotoPost(tuple.workspaceId, tuple.postId), evidence = await f.a.readPostEvidence(tuple.workspaceId, tuple.postId);
    assert.equal(draft.status, 'draft'); assert.equal(draft.replaces, null); assert.equal(await f.a.readBlogSyncState(tuple.workspaceId, draft.id), null);
    assert.equal((await f.a.readMaterialWriting(tuple.workspaceId)).plans[0].output.postId, draft.id);
    for (const ref of evidence.refs) await R.resolve(await f.a.read(tuple.workspaceId), ref);
    recovered.push({ text: P.plainText(draft), refs: evidence.refs.length });
  }
  assert.deepEqual(recovered.sort((a, b) => a.text.localeCompare(b.text)), [{ text: P.plainText(inherited), refs: 1 }, { text: P.plainText(empty), refs: 0 }].sort((a, b) => a.text.localeCompare(b.text)));
  assert.deepEqual(await f.a.readPhotoPost(target.workspaceId, inherited.id), inherited); assert.deepEqual(await f.a.readPhotoPost(target.workspaceId, empty.id), empty);
});
test('a separate editing draft created during received-photo verification invalidates the reviewed output before any writes', async t => {
  const f = await fixture(); t.after(f.close); const output = { ...writing(), state: 'saved', revision: 1, refs: [f.reference] }, row = rowFor(f, output), post = savedPost(f, output);
  const installed = await f.a.installMaterialContinuity(row, { post }), target = { workspaceId: installed.workspaceId, planId: installed.planId }, baseline = await f.a.readMaterialContinuitySnapshot(target.workspaceId, target.planId);
  const expectedReview = { post: Blog.pack(P.compact(baseline.post)), refs: baseline.refs, editingDrafts: [] }, newer = copy(row); newer.revision++; newer.data.output.revision++;
  const module = globalThis.HaedoLife.MaterialContinuity, gate = deferred(), entered = deferred(); let held = false;
  globalThis.HaedoLife.MaterialContinuity = { ...C, async verify(value) { if (!held) { held = true; entered.resolve(); await gate.promise; } return C.verify(value); } };
  try {
    const applying = f.a.installMaterialContinuity(newer, { target, expectedFingerprint: baseline.fingerprint, expectedReview, post });
    await entered.promise;
    const draft = { ...copy(baseline.post), id: Core.id(), revision: 0, status: 'draft', replaces: { id: baseline.post.id, revision: baseline.post.revision }, ops: [{ insert: '대조 뒤 새 수정 초안\n' }] };
    await f.b.savePhotoPost(target.workspaceId, draft, 0); const before = copy(f.rows); gate.resolve();
    await assert.rejects(applying, { code: 'material_continuity_changed' }); assert.deepEqual(f.rows, before);
  } finally { globalThis.HaedoLife.MaterialContinuity = module; gate.resolve(); }
});

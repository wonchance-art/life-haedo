'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createStorage } = require('../assets/life/storage.js'), Core = require('../assets/life/core.js');
const M = require('../assets/life/material-writing.js'), R = require('../assets/life/source-reference.js');
const accountA = { projectUrl: 'https://material-test.supabase.co', userId: 'synthetic-a' }, accountB = { ...accountA, userId: 'synthetic-b' };
const copy = value => structuredClone(value), key = value => JSON.stringify(value);
const C = require('../assets/life/material-continuity.js'), P = require('../assets/life/photo-post.js');
const Sync = require('../assets/life/account-docs-sync.js');

// Application-level fixture: transactions serialize, own their working copies,
// and publish no writes until done. Native IndexedDB is checked independently in
// the browser journey; this adapter does not claim to emulate its event loop.
function adapter() {
  const rows = new Map(), paths = new Map(), control = { fail: null, readFault: null, failCompletion: false, writes: [] }; let tail = Promise.resolve();
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
          if (method === 'get') {
            // A read-wrapper exception must reach the application transaction
            // boundary; do not abort here or a catch-all mutation goes unnoticed.
            const error = control.readFault?.({ name, id: value });
            if (error) { control.readFault = null; throw error; }
            return copy(store.get(key(value)));
          }
          if (method === 'getAll') return copy([...store.values()]);
          if (method === 'getAllKeys') return [...store.keys()].map(value => JSON.parse(value));
          if (method === 'getKey') return store.has(key(value)) ? copy(value) : undefined;
          assert.equal(mode, 'readwrite'); const path = paths.get(name), id = method === 'delete' ? value : Array.isArray(path) ? path.map(field => value[field]) : value[path];
          control.writes.push({ name, method, id }); written++;
          if (control.fail?.({ name, method, id, value })) { control.fail = null; const error = new DOMException('quota', 'QuotaExceededError'); abort(error); throw error; }
          if (method === 'delete') store.delete(key(id));
          else { if (method === 'add' && store.has(key(id))) throw new DOMException('duplicate', 'ConstraintError'); store.set(key(id), copy(value)); }
          return id;
        }
        return { done, abort, objectStore(name) { return { get: value => run(name, 'get', value), getAll: () => run(name, 'getAll'), getAllKeys: () => run(name, 'getAllKeys'), getKey: value => run(name, 'getKey', value),
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

const accountKey = account => JSON.stringify([account.projectUrl, account.userId]);
const markerKey = (planId, account = accountA) => `materialOutputDeleted:${accountKey(account)}:${planId}`;
const markerValue = row => ({ version: 1, workspaceId: row.data.bundle.workspaceId, planId: row.data.plan.id, postId: row.data.output.postId });
function savedRow(f) {
  const post = P.create(Core.id); post.title = '익명 완성 글'; post.ops = [{ insert: '정확한 글 본문\n' }]; post.status = 'saved'; post.revision = 4;
  const output = { state: 'saved', postId: post.id, claimId: Core.id(), revision: post.revision, refs: [f.reference] };
  return { post, row: { id: Core.id(), revision: 2, data: C.snapshot(f.bundle, f.plan, output), updated_at: '2026-11-05T00:00:00.000Z' } };
}
const deletionProof = row => ({ binding: copy(accountA), remoteId: row.id, revision: row.revision,
  workspaceId: row.data.bundle.workspaceId, planId: row.data.plan.id, output: copy(row.data.output) });
async function prepareAdoption(f) {
  await f.a.saveMaterialWriting(f.ws, { ...M.empty(f.ws), revision: f.state.revision, plans: [] }, f.state.revision);
}
function blank(account = accountA) {
  const f = adapter(), a = createStorage({ idb: f.idb, core: Core, channelFactory: null, account });
  return { ...f, a, close() { a.close(); } };
}
async function applyMarker(storage, row, value = markerValue(row), docKey = markerKey(value.planId)) {
  const current = await storage.readAccountDocRecord(docKey);
  return storage.applyAccountDoc(docKey, { value, expectedHash: current.hash });
}
async function handoff(f) {
  const result = await f.a.createMaterialWritingPost(f.ws, f.plan.id, f.state.revision);
  return f.a.readPhotoPost(f.ws, result.postId);
}
function accountServer() {
  const owners = new Map(); let sequence = 0;
  const rows = owner => { if (!owners.has(owner)) owners.set(owner, new Map()); return owners.get(owner); };
  return { owners, remote(owner) { return {
    PAGE_LIMIT: 20, dispose() {},
    async changes(after) { return [...rows(owner)].map(([docKey, value]) => ({ docKey, ...copy(value) })).filter(value => value.seq > after).sort((a, b) => a.seq - b.seq); },
    async put(request) {
      const prior = rows(owner).get(request.docKey);
      if ((prior?.revision || 0) !== request.expectedRevision) return { status: 'conflict', revision: prior?.revision || 0, seq: prior?.seq || null, current: prior ? copy(prior) : null };
      const value = { revision: request.expectedRevision + 1, seq: ++sequence, data: copy(request.data), deleted: request.deleted, client_updated_at: request.clientUpdatedAt };
      rows(owner).set(request.docKey, value); return { status: 'stored', revision: value.revision, seq: value.seq };
    }
  }; } };
}

test('offline deletion of a claimed draft reaches a fresh device through account documents without a saved-post fallback', async t => {
  const f = await fixture(), fresh = blank(); t.after(f.close); t.after(fresh.close);
  const output = { state: 'writing', postId: Core.id(), claimId: Core.id() };
  const row = { id: Core.id(), revision: 1, data: C.snapshot(f.bundle, f.plan, output), updated_at: '2026-11-05T00:00:00.000Z' };
  await f.a.writeMaterialContinuityState(f.ws, f.plan.id, { revision: 0, binding: accountA, enabled: true, remoteId: row.id,
    remoteRevision: row.revision, head: row, mapping: null, output, pending: null, conflict: null,
    localClaim: { postId: output.postId, claimId: output.claimId }, error: null }, 0);
  const made = await f.a.finishMaterialContinuityClaim(f.ws, f.plan.id, f.state.revision), post = await f.a.readPhotoPost(f.ws, made.postId);
  assert.equal(post.status, 'draft');
  const server = accountServer(); let online = false;
  const a = Sync.create({ storage: f.a, auth: { getAccount: () => accountA }, remote: server.remote(accountA.userId), online: () => online, polling: false, locks: null });
  const b = Sync.create({ storage: fresh.a, auth: { getAccount: () => accountA }, remote: server.remote(accountA.userId), polling: false, locks: null });
  t.after(() => { a.dispose(); b.dispose(); });
  await f.a.deletePhotoPost(f.ws, post.id, post.revision); await a.syncNow();
  assert.equal(a.getStatus().state, 'offline'); assert.equal(server.owners.size, 0, 'offline deletion sends no request');
  online = true; await a.syncNow(); assert.equal(a.getStatus().state, 'synced');
  assert.deepEqual(server.owners.get(accountA.userId)?.get(markerKey(f.plan.id))?.data, markerValue(row),
    'the claimed output deletion must actually reach account-document transport');
  await b.syncNow(); assert.equal(b.getStatus().state, 'synced');
  const received = await fresh.a.installMaterialContinuity(row);
  assert.equal((await fresh.a.readMaterialWritingOutput(received.workspaceId, received.planId)).status, 'deleted');
  assert.equal((await fresh.a.listPhotoPosts(received.workspaceId)).length, 0);
  const before = copy(fresh.rows);
  await assert.rejects(fresh.a.finishMaterialContinuityClaim(received.workspaceId, received.planId, received.planRevision));
  assert.deepEqual(fresh.rows, before, 'a deleted remote claim is never completed into another post');
});

test('account deletion receipt arrives before any workspace, then installs the exact remapped preparation without recreating its post', async t => {
  const origin = await fixture(), fresh = blank(); t.after(origin.close); t.after(fresh.close);
  const { row } = savedRow(origin), value = markerValue(row), source = copy(row.data);
  assert.deepEqual(await fresh.a.listWorkspaces(), []);
  assert.equal((await applyMarker(fresh.a, row)).status, 'applied');
  assert.equal(await fresh.a.readMaterialContinuityOutputDeletion(row), true);
  const installed = await fresh.a.installMaterialContinuity(row);
  assert.notEqual(installed.workspaceId, source.bundle.workspaceId);
  assert.notEqual(installed.planId, source.plan.id);
  const plan = (await fresh.a.readMaterialWriting(installed.workspaceId)).plans.find(item => item.id === installed.planId);
  assert.equal((await fresh.a.readMaterialWritingOutput(installed.workspaceId, installed.planId)).status, 'deleted');
  assert.equal((await fresh.a.listPhotoPosts(installed.workspaceId)).length, 0);
  await assert.rejects(fresh.a.createMaterialWritingPost(installed.workspaceId, installed.planId, installed.planRevision), { code: 'material_writing_output_deleted' });
  assert.equal(plan.question, source.plan.question);
  assert.equal(plan.materials[0].note, source.plan.materials[0].note);
  assert.deepEqual((await fresh.a.read(installed.workspaceId)).sourceVersions.map(v => v.contentText), source.bundle.sourceVersions.map(v => v.contentText));
  assert.deepEqual((await fresh.a.readAccountDocRecord(markerKey(value.planId))).value, value);
  assert.deepEqual(row.data, source, 'receiving does not mutate canonical source IDs or source text');
});

test('a marker arriving after a writing preparation retires only its exact output without creating a post', async t => {
  const origin = await fixture(), fresh = blank(); t.after(origin.close); t.after(fresh.close);
  const output = { state: 'writing', postId: Core.id(), claimId: Core.id() };
  const row = { id: Core.id(), revision: 1, data: C.snapshot(origin.bundle, origin.plan, output), updated_at: '2026-11-05T00:00:00.000Z' };
  const received = await fresh.a.installMaterialContinuity(row);
  const before = await fresh.a.readMaterialWriting(received.workspaceId), source = await fresh.a.read(received.workspaceId);
  assert.equal(before.plans[0].output, null);
  const events = [], off = fresh.a.subscribeAll(event => events.push(event)); t.after(off);
  assert.equal((await applyMarker(fresh.a, row)).status, 'applied');
  const after = await fresh.a.readMaterialWriting(received.workspaceId);
  assert(after.revision > before.revision);
  assert(after.plans[0].output, 'the confirmed deletion must retire the pending handoff');
  assert.equal((await fresh.a.readMaterialWritingOutput(received.workspaceId, received.planId)).status, 'deleted');
  assert.equal((await fresh.a.listPhotoPosts(received.workspaceId)).length, 0);
  assert(events.some(event => event.type === 'material_writing_changed' && event.workspaceId === received.workspaceId && event.revision === after.revision));
  const { output: ignoredBefore, ...oldPlan } = before.plans[0], { output: ignoredAfter, ...newPlan } = after.plans[0];
  assert.deepEqual(newPlan, oldPlan); assert.deepEqual(await fresh.a.read(received.workspaceId), source);
  const settled = copy(fresh.rows); await applyMarker(fresh.a, row);
  assert.deepEqual(fresh.rows, settled, 'reapplying the same receipt cannot retire another target or increment the preparation again');
});

for (const field of ['workspaceId', 'planId', 'postId']) {
  test(`a deletion receipt for another ${field} cannot unlock missing-post installation`, async t => {
    const f = await fixture(), fresh = blank(); t.after(f.close); t.after(fresh.close);
    const { row } = savedRow(f), wrong = { ...markerValue(row), [field]: Core.id() };
    assert.equal((await applyMarker(fresh.a, row, wrong)).status, 'applied');
    assert.equal(await fresh.a.readMaterialContinuityOutputDeletion(row), false);
    const before = copy(fresh.rows);
    await assert.rejects(fresh.a.installMaterialContinuity(row), { code: 'material_output_pending' });
    assert.deepEqual(fresh.rows, before, 'no workspace, original, handoff or installation receipt is partially written');
  });
}

test('malformed and key-mismatched account receipts are rejected atomically', async t => {
  const f = await fixture(), fresh = blank(); t.after(f.close); t.after(fresh.close);
  const { row } = savedRow(f), valid = markerValue(row), docKey = markerKey(valid.planId);
  await fresh.a.listWorkspaces();
  for (const malformed of [{ ...valid, extra: true }, { ...valid, version: 2 }, { ...valid, planId: Core.id() }, { ...valid, postId: '' }]) {
    const before = copy(fresh.rows);
    assert.equal((await applyMarker(fresh.a, row, malformed, docKey)).status, 'rejected');
    assert.deepEqual(fresh.rows, before);
  }
  assert.equal((await fresh.a.readAccountDocRecord(docKey)).exists, false);
});

test('deleting unrelated posts creates no local or account material tombstone', async t => {
  const f = await fixture(); t.after(f.close);
  const related = await handoff(f), unrelated = await f.a.savePhotoPost(f.ws, P.create(Core.id), 0);
  const planBefore = await f.a.readMaterialWriting(f.ws), sourceBefore = await f.a.read(f.ws);
  await f.a.deletePhotoPost(f.ws, unrelated.id, unrelated.revision);
  assert.equal(f.rows.get('meta').has(key(`material-writing-output-deleted:${f.ws}:${unrelated.id}`)), false);
  assert.equal((await f.a.listAccountDocs()).filter(doc => doc.prefix === 'materialOutputDeleted').length, 0);
  assert.deepEqual(await f.a.readMaterialWriting(f.ws), planBefore);
  assert.deepEqual(await f.a.read(f.ws), sourceBefore);
  assert.deepEqual(await f.a.readPhotoPost(f.ws, related.id), related);
});

for (const operation of ['deletePhotoPost', 'commitBlogSync']) {
  test(`${operation} preserves a different prior output marker without vetoing confirmed deletion`, async t => {
    const f = await fixture(); t.after(f.close);
    const post = await handoff(f), other = await f.a.savePhotoPost(f.ws, P.create(Core.id), 0);
    const value = { version: 1, workspaceId: f.ws, planId: f.plan.id, postId: other.id }, docKey = markerKey(f.plan.id);
    assert.equal((await f.a.applyAccountDoc(docKey, { value, expectedHash: (await f.a.readAccountDocRecord(docKey)).hash })).status, 'applied');
    // A prior canonical marker may arrive before this device's continuity state.
    assert.equal(await f.a.readMaterialContinuityState(f.ws, f.plan.id), null);
    const binding = operation === 'commitBlogSync' ? await f.a.writeBlogSyncState(f.ws, post.id,
      { enabled: true, remoteId: post.id, remoteRevision: 1, localRevision: post.revision }) : null;
    const remove = () => operation === 'deletePhotoPost' ? f.a.deletePhotoPost(f.ws, post.id, post.revision) :
      f.a.commitBlogSync(f.ws, { postId: post.id, baseRevision: post.revision, bindingRevision: binding.revision, remove: true });
    const before = copy(f.rows), source = await f.a.read(f.ws), preparation = await f.a.readMaterialWriting(f.ws);
    const markerBytes = JSON.stringify(f.rows.get('meta').get(key(docKey)));
    const evidenceKey = key(`post-evidence:${f.ws}:${post.id}`);
    assert(f.rows.get('meta').has(evidenceKey), 'the handed-off post has evidence to remove');
    let hit = false;
    f.control.readFault = ({ id }) => {
      if (id === docKey) { hit = true; return new DOMException('synthetic marker read failure', 'UnknownError'); }
    };
    await assert.rejects(remove(), { code: 'storage_error' });
    assert(hit, 'a real marker read error still reaches the transaction boundary');
    assert.deepEqual(f.rows, before, 'failed marker reads roll back the local marker and post deletion together');
    await remove();
    await assert.rejects(f.a.readPhotoPost(f.ws, post.id), { code: 'photo_post_missing' });
    assert.equal(await f.a.readBlogSyncState(f.ws, post.id), null);
    assert.equal(f.rows.get('meta').has(evidenceKey), false);
    assert.deepEqual(await f.a.readMaterialWritingOutput(f.ws, f.plan.id), { status: 'deleted', postId: post.id });
    assert.deepEqual(f.rows.get('meta').get(key(`material-writing-output-deleted:${f.ws}:${post.id}`))?.value, { postId: post.id });
    assert.equal(JSON.stringify(f.rows.get('meta').get(key(docKey))), markerBytes, 'the different canonical marker stays byte-for-byte unchanged');
    assert.deepEqual((await f.a.readAccountDocRecord(docKey)).value, value);
    assert.deepEqual(await f.a.readPhotoPost(f.ws, other.id), other, 'the post named by the prior marker is untouched');
    assert.deepEqual(await f.a.read(f.ws), source);
    assert.deepEqual((await f.a.readMaterialWriting(f.ws)).plans, preparation.plans);
    assert.deepEqual((await f.a.listPhotoPosts(f.ws)).map(item => item.id), [other.id]);
  });
}

test('received deletion proof still rejects a different prior canonical output marker atomically', async t => {
  const origin = await fixture(), fresh = blank(); t.after(origin.close); t.after(fresh.close);
  const { row } = savedRow(origin), prior = { ...markerValue(row), postId: Core.id() };
  assert.equal((await applyMarker(fresh.a, row, prior)).status, 'applied');
  const before = copy(fresh.rows);
  await assert.rejects(fresh.a.installMaterialContinuity(row, { deletedOutput: deletionProof(row) }), { code: 'invalid_material_output_deletion' });
  assert.deepEqual(fresh.rows, before, 'the retire-only exception must not let received proof overwrite or ignore mismatched evidence');
});

test('a surviving handoff receipt preserves deletion evidence when the preparation body arrives later', async t => {
  const f = await fixture(); t.after(f.close);
  const post = await handoff(f), stateKey = key(`material-writing:${f.ws}`), state = copy(f.rows.get('meta').get(stateKey));
  f.rows.get('meta').delete(stateKey);
  await f.a.deletePhotoPost(f.ws, post.id, post.revision);
  const value = (await f.a.readAccountDocRecord(markerKey(f.plan.id))).value;
  assert.deepEqual(value, { version: 1, workspaceId: f.ws, planId: f.plan.id, postId: post.id });
  f.rows.get('meta').set(stateKey, state);
  assert.deepEqual(await f.a.readMaterialWritingOutput(f.ws, f.plan.id), { status: 'deleted', postId: post.id });
});

test('deleting a received remapped post writes the canonical preparation identity, never the local copy identity', async t => {
  const origin = await fixture(), receiver = blank(); t.after(origin.close); t.after(receiver.close);
  const { row, post } = savedRow(origin), installed = await receiver.a.installMaterialContinuity(row, { post });
  const local = await receiver.a.readPhotoPost(installed.workspaceId, installed.postId);
  assert.notEqual(installed.workspaceId, row.data.bundle.workspaceId); assert.notEqual(installed.planId, row.data.plan.id);
  assert.notEqual(local.id, row.data.output.postId);
  const sources = copy(await receiver.a.read(installed.workspaceId));
  await receiver.a.deletePhotoPost(installed.workspaceId, local.id, local.revision);
  assert.deepEqual((await receiver.a.readAccountDocRecord(markerKey(row.data.plan.id))).value, markerValue(row));
  assert.equal((await receiver.a.readAccountDocRecord(markerKey(installed.planId))).exists, false);
  assert.equal((await receiver.a.readMaterialWritingOutput(installed.workspaceId, installed.planId)).status, 'deleted');
  assert.deepEqual(await receiver.a.read(installed.workspaceId), sources);
});

test('deleting a conflicting local output never marks the different canonical remote output as deleted', async t => {
  const f = await fixture(), other = blank(); t.after(f.close); t.after(other.close);
  const local = await handoff(f), before = await f.a.readMaterialContinuitySnapshot(f.ws, f.plan.id);
  const { row, post: remotePost } = savedRow(f);
  assert.notEqual(local.id, row.data.output.postId);
  // This is the ordinary conflict state: a local handoff exists while a separately
  // received server preparation points at another output. Merely sharing plan IDs
  // does not establish that the local post is that remote output.
  await f.a.writeMaterialContinuityState(f.ws, f.plan.id, { revision: 0, binding: accountA, enabled: true,
    remoteId: row.id, remoteRevision: row.revision, head: row, mapping: null, output: row.data.output,
    pending: null, conflict: { row, localFingerprint: before.fingerprint }, localClaim: null, error: null }, 0);
  const serverDescriptor = copy((await f.a.readMaterialContinuityState(f.ws, f.plan.id)).head);
  await f.a.deletePhotoPost(f.ws, local.id, local.revision);
  assert.equal((await f.a.readMaterialWritingOutput(f.ws, f.plan.id)).status, 'deleted');
  assert.equal(await f.a.readMaterialContinuityOutputDeletion(row), false);
  assert.equal((await f.a.listAccountDocs()).some(doc => doc.prefix === 'materialOutputDeleted'), false,
    'an unmatched local output must not acquire a canonical deletion identity');
  assert.deepEqual((await f.a.readMaterialContinuityState(f.ws, f.plan.id)).head, serverDescriptor);
  const installed = await other.a.installMaterialContinuity(row, { post: remotePost });
  assert.equal((await other.a.readMaterialWritingOutput(installed.workspaceId, installed.planId)).status, 'available');
  assert.equal((await other.a.readPhotoPost(installed.workspaceId, installed.postId)).title, remotePost.title);
});

for (const outputState of ['saved', 'writing']) {
  test(`accepting a deleted ${outputState} remote output preserves the different local post as recovery, never as the main output`, async t => {
    const f = await fixture(); t.after(f.close); const local = await handoff(f);
    const localEvidence = await f.a.readPostEvidence(f.ws, local.id), first = await f.a.readMaterialContinuitySnapshot(f.ws, f.plan.id);
    const { row } = savedRow(f);
    if (outputState === 'writing') row.data.output = { state: 'writing', postId: row.data.output.postId, claimId: row.data.output.claimId };
    await f.a.writeMaterialContinuityState(f.ws, f.plan.id, { revision: 0, binding: accountA, enabled: true,
      remoteId: row.id, remoteRevision: row.revision, head: row, mapping: null, output: row.data.output,
      pending: null, conflict: { row, localFingerprint: first.fingerprint }, localClaim: null, error: null }, 0);
    if (outputState === 'writing') assert.equal((await applyMarker(f.a, row)).status, 'applied');
    const current = await f.a.readMaterialContinuitySnapshot(f.ws, f.plan.id);
    const installed = await f.a.installMaterialContinuity(row, { target: { workspaceId: f.ws, planId: f.plan.id },
      expectedFingerprint: current.fingerprint, preserveLocal: true, ...(outputState === 'saved' ? { deletedOutput: deletionProof(row) } : {}) });
    assert.equal((await f.a.readMaterialWritingOutput(f.ws, f.plan.id)).status, 'deleted');
    assert.notEqual(installed.postId, local.id, 'a different local output cannot stand in for the deleted canonical output');
    const recovery = await f.a.readMaterialWritingOutput(installed.recoveryWorkspaceId, installed.recoveryPlanId);
    assert.equal(recovery.status, 'available');
    const kept = await f.a.readPhotoPost(installed.recoveryWorkspaceId, recovery.postId);
    assert.deepEqual(kept.ops, local.ops); assert.equal(kept.title, local.title); assert.equal(kept.status, local.status);
    const evidence = await f.a.readPostEvidence(installed.recoveryWorkspaceId, recovery.postId);
    assert.deepEqual(evidence.refs.map(ref => [ref.quote, ref.contentHash, ref.locator]),
      localEvidence.refs.map(ref => [ref.quote, ref.contentHash, ref.locator]));
    for (const ref of evidence.refs) await R.resolve(await f.a.read(installed.recoveryWorkspaceId), ref);
    assert.equal(await f.a.readMaterialContinuityState(installed.recoveryWorkspaceId, installed.recoveryPlanId), null);
    assert.deepEqual((await f.a.readAccountDocRecord(markerKey(row.data.plan.id))).value, markerValue(row));
  });
}

test('legacy local evidence is promoted with its surviving receipt and preserves unrelated data', async t => {
  const f = await fixture(); t.after(f.close); const post = await handoff(f);
  await f.a.deletePhotoPost(f.ws, post.id, post.revision);
  const docKey = markerKey(f.plan.id); f.rows.get('meta').delete(key(docKey));
  // A previous release wrote this local marker and handoff receipt, but no account document.
  const legacy = copy(f.rows.get('meta').get(key(`material-writing-output-deleted:${f.ws}:${post.id}`)));
  const unlinked = Core.id(), unlinkedKey = `material-writing-output-deleted:${f.ws}:${unlinked}`;
  f.rows.get('meta').set(key(unlinkedKey), { key: unlinkedKey, value: { postId: unlinked } });
  const source = await f.a.read(f.ws), prepared = await f.a.readMaterialWriting(f.ws);
  assert.equal((await f.a.listAccountDocs()).filter(doc => doc.prefix === 'materialOutputDeleted').length, 1);
  assert.deepEqual((await f.a.readAccountDocRecord(docKey)).value, { version: 1, workspaceId: f.ws, planId: f.plan.id, postId: post.id });
  assert.deepEqual(f.rows.get('meta').get(key(`material-writing-output-deleted:${f.ws}:${post.id}`)), legacy);
  assert.deepEqual(await f.a.readMaterialWriting(f.ws), prepared);
  assert.deepEqual(await f.a.read(f.ws), source);
  const after = copy(f.rows); await f.a.listAccountDocs(); assert.deepEqual(f.rows, after, 'repeat listing does not create or revise evidence');
});

async function legacyOwnedReplacement(f) {
  const output = { state: 'writing', postId: Core.id(), claimId: Core.id() };
  const row = { id: Core.id(), revision: 1, data: C.snapshot(f.bundle, f.plan, output), updated_at: '2026-11-05T00:00:00.000Z' };
  await f.a.writeMaterialContinuityState(f.ws, f.plan.id, { revision: 0, binding: accountA, enabled: true, remoteId: row.id,
    remoteRevision: row.revision, head: row, mapping: null, output, pending: null, conflict: null,
    localClaim: { postId: output.postId, claimId: output.claimId }, error: null }, 0);
  const created = await f.a.finishMaterialContinuityClaim(f.ws, f.plan.id, f.state.revision);
  let post = await f.a.readPhotoPost(f.ws, created.postId); post.status = 'saved'; post = await f.a.savePhotoPost(f.ws, post, post.revision);
  const edited = { ...copy(post), id: Core.id(), revision: 0, replaces: { id: post.id, revision: post.revision }, title: '이전 앱에서 바꾼 글' };
  const replacement = await f.a.savePhotoPost(f.ws, edited, 0);
  assert.notEqual(replacement.id, output.postId);
  await f.a.deletePhotoPost(f.ws, replacement.id, replacement.revision);
  assert.equal(await f.a.readBlogSyncState(f.ws, replacement.id), null);
  // Old E releases committed exactly the surviving local deletion and handoff
  // receipts; the canonical account receipt did not exist yet.
  f.rows.get('meta').delete(key(markerKey(f.plan.id)));
  return { row, replacement };
}

test('a legacy deletion of an owned claimed output promotes its canonical identity after saved-post replacement removed the binding', async t => {
  const f = await fixture(), fresh = blank(); t.after(f.close); t.after(fresh.close);
  const { row } = await legacyOwnedReplacement(f);
  const before = await f.a.readMaterialWriting(f.ws);
  await f.a.listAccountDocs();
  assert.deepEqual((await f.a.readAccountDocRecord(markerKey(f.plan.id))).value, markerValue(row));
  assert.deepEqual(await f.a.readMaterialWriting(f.ws), before);
  assert.equal((await applyMarker(fresh.a, row)).status, 'applied');
  const received = await fresh.a.installMaterialContinuity(row);
  assert.equal((await fresh.a.readMaterialWritingOutput(received.workspaceId, received.planId)).status, 'deleted');
  assert.equal((await fresh.a.listPhotoPosts(received.workspaceId)).length, 0);
});

for (const condition of ['conflict', 'pending', 'contradictory_binding']) {
  test(`legacy own-claim evidence with ${condition} cannot guess a canonical deletion`, async t => {
    const f = await fixture(); t.after(f.close); const { row, replacement } = await legacyOwnedReplacement(f);
    const state = await f.a.readMaterialContinuityState(f.ws, f.plan.id), fingerprint = await C.fingerprint(row.data);
    if (condition === 'contradictory_binding') {
      await f.a.writeBlogSyncState(f.ws, replacement.id, { enabled: true, remoteId: Core.id(), remoteRevision: 1, localRevision: replacement.revision });
    } else {
      const next = condition === 'conflict' ? { ...state, conflict: { row, localFingerprint: fingerprint } } :
        { ...state, pending: { operationId: Core.id(), expectedRevision: row.revision, data: copy(row.data), fingerprint } };
      await f.a.writeMaterialContinuityState(f.ws, f.plan.id, next, state.revision);
    }
    const prepared = await f.a.readMaterialWriting(f.ws);
    await f.a.listAccountDocs();
    assert.equal((await f.a.readAccountDocRecord(markerKey(f.plan.id))).exists, false);
    assert.deepEqual(await f.a.readMaterialWriting(f.ws), prepared);
    assert.equal((await f.a.readMaterialWritingOutput(f.ws, f.plan.id)).status, 'deleted', 'the local confirmed deletion is still retained');
  });
}

for (const outputState of ['saved', 'writing']) {
  test(`keeping the local preparation retains both recoveries while its ${outputState} canonical output stays deleted`, async t => {
    const f = await fixture(); t.after(f.close); const local = await handoff(f), first = await f.a.readMaterialContinuitySnapshot(f.ws, f.plan.id);
    const { row } = savedRow(f); row.data.plan.question = '서버 쪽 준비 질문';
    if (outputState === 'writing') row.data.output = { state: 'writing', postId: row.data.output.postId, claimId: row.data.output.claimId };
    await f.a.writeMaterialContinuityState(f.ws, f.plan.id, { revision: 0, binding: accountA, enabled: true,
      remoteId: row.id, remoteRevision: row.revision, head: row, mapping: null, output: row.data.output,
      pending: null, conflict: { row, localFingerprint: first.fingerprint }, localClaim: null, error: null }, 0);
    if (outputState === 'writing') assert.equal((await applyMarker(f.a, row)).status, 'applied');
    const current = await f.a.readMaterialContinuitySnapshot(f.ws, f.plan.id);
    const result = await f.a.installMaterialContinuity(row, { target: { workspaceId: f.ws, planId: f.plan.id },
      expectedFingerprint: current.fingerprint, preserveRemote: true, ...(outputState === 'saved' ? { deletedOutput: deletionProof(row) } : {}) });
    const main = (await f.a.readMaterialWriting(f.ws)).plans.find(plan => plan.id === f.plan.id);
    assert.equal(main.question, current.plan.question); assert.deepEqual(main.blocks, current.plan.blocks);
    assert.equal((await f.a.readMaterialWritingOutput(f.ws, f.plan.id)).status, 'deleted');
    assert.notEqual(main.output.postId, local.id);
    await assert.rejects(f.a.createMaterialWritingPost(f.ws, f.plan.id, result.planRevision), { code: 'material_writing_output_deleted' });
    const remoteRecovery = await f.a.readMaterialWritingOutput(result.recoveryWorkspaceId, result.recoveryPlanId);
    assert.equal(remoteRecovery.status, 'deleted');
    assert.equal((await f.a.listPhotoPosts(result.recoveryWorkspaceId)).length, 0);
    const localRecovery = await f.a.readMaterialWritingOutput(result.localRecoveryWorkspaceId, result.localRecoveryPlanId);
    assert.equal(localRecovery.status, 'available');
    const kept = await f.a.readPhotoPost(result.localRecoveryWorkspaceId, localRecovery.postId);
    assert.deepEqual(kept.ops, local.ops); assert.equal(kept.title, local.title);
    const evidence = await f.a.readPostEvidence(result.localRecoveryWorkspaceId, localRecovery.postId);
    for (const ref of evidence.refs) await R.resolve(await f.a.read(result.localRecoveryWorkspaceId), ref);
    assert.equal(await f.a.readMaterialContinuityState(result.recoveryWorkspaceId, result.recoveryPlanId), null);
    assert.equal(await f.a.readMaterialContinuityState(result.localRecoveryWorkspaceId, result.localRecoveryPlanId), null);
    assert.deepEqual(await f.a.readPhotoPost(f.ws, local.id), local, 'the original local document is not deleted by remote evidence');
  });
}

for (const point of ['local_marker', 'account_marker', 'preparation', 'post', 'index', 'completion']) {
  test(`failed ${point} during deletion rolls back both evidence and the original post`, async t => {
    const f = await fixture(); t.after(f.close); const post = await handoff(f), before = copy(f.rows), events = [];
    const off = f.a.subscribeAll(event => events.push(event)); t.after(off);
    const targets = { local_marker: `material-writing-output-deleted:${f.ws}:${post.id}`, account_marker: markerKey(f.plan.id),
      preparation: `material-writing:${f.ws}`, post: `photo-post:${f.ws}:${post.id}`, index: `photo-posts:${f.ws}` };
    let hit = false;
    if (point === 'completion') f.control.failCompletion = true;
    else f.control.fail = ({ id }) => { if (id === targets[point]) { hit = true; return true; } return false; };
    await assert.rejects(f.a.deletePhotoPost(f.ws, post.id, post.revision), { code: point === 'completion' ? 'storage_aborted' : 'storage_quota' });
    if (point !== 'completion') assert(hit, 'failure reached the intended persistence operation');
    assert.deepEqual(f.rows, before); assert.deepEqual(events, []);
    assert.deepEqual(await f.a.readPhotoPost(f.ws, post.id), post);
    assert.equal((await f.a.readMaterialWritingOutput(f.ws, f.plan.id)).status, 'available');
  });
}

test('a damaged unrelated receipt does not veto deletion or fabricate material linkage', async t => {
  const f = await fixture(); t.after(f.close); const related = await handoff(f), unrelated = await f.a.savePhotoPost(f.ws, P.create(Core.id), 0);
  const receiptKey = key(`material-writing-output:${f.ws}:${f.plan.id}`), broken = { key: `material-writing-output:${f.ws}:${f.plan.id}`, value: { postId: related.id, damaged: true } };
  f.rows.get('meta').set(receiptKey, broken);
  await f.a.deletePhotoPost(f.ws, unrelated.id, unrelated.revision);
  await assert.rejects(f.a.readPhotoPost(f.ws, unrelated.id), { code: 'photo_post_missing' });
  assert.deepEqual(f.rows.get('meta').get(receiptKey), broken);
  assert.deepEqual(await f.a.readPhotoPost(f.ws, related.id), related);
  assert.equal((await f.a.listAccountDocs()).filter(doc => doc.prefix === 'materialOutputDeleted').length, 0);
});

test('a genuine storage read error while finding the preparation aborts the entire deletion', async t => {
  const f = await fixture(); t.after(f.close); const post = await handoff(f), before = copy(f.rows); let hit = false;
  f.control.readFault = ({ id }) => {
    if (id === `material-writing:${f.ws}`) { hit = true; return new DOMException('synthetic IDB read failure', 'UnknownError'); }
  };
  await assert.rejects(f.a.deletePhotoPost(f.ws, post.id, post.revision), { code: 'storage_error' });
  assert(hit); assert.deepEqual(f.rows, before);
});

test('a verified existing post stays available when deletion history arrives', async t => {
  const f = await fixture(), fresh = blank(); t.after(f.close); t.after(fresh.close);
  const { row, post } = savedRow(f), installed = await fresh.a.installMaterialContinuity(row, { post });
  const held = await fresh.a.readPhotoPost(installed.workspaceId, installed.postId);
  assert.equal((await applyMarker(fresh.a, row)).status, 'applied');
  assert.equal((await fresh.a.readMaterialWritingOutput(installed.workspaceId, installed.planId)).status, 'available');
  assert.deepEqual(await fresh.a.readPhotoPost(installed.workspaceId, installed.postId), held);
  assert.equal((await fresh.a.listPhotoPosts(installed.workspaceId)).length, 1);
});

test('a delayed deletion marker cannot retire a remapped writing preparation whose live BlogSync copy arrived first', async t => {
  const origin = await fixture(), receiver = blank(); t.after(origin.close); t.after(receiver.close);
  const { row, post } = savedRow(origin), writing = copy(row), Blog = require('../assets/life/blog.js');
  writing.revision = row.revision - 1;
  writing.data.output = { state: 'writing', postId: post.id, claimId: row.data.output.claimId };
  const installed = await receiver.a.installMaterialContinuity(writing);
  assert.notEqual(installed.workspaceId, row.data.bundle.workspaceId);
  assert.notEqual(installed.planId, row.data.plan.id);
  assert.equal((await receiver.a.readMaterialWritingOutput(installed.workspaceId, installed.planId)).status, 'none');
  // BlogSync and preparation sync are independent: the saved blog can arrive
  // before the saved preparation and a delayed historical deletion marker.
  const local = { ...copy(post), id: Core.id(), revision: 0 };
  const received = await receiver.a.installReceivedBlogPost(installed.workspaceId, local, {
    enabled: true, remoteId: post.id, remoteWorkspaceId: row.data.bundle.workspaceId,
    remoteRevision: post.revision, localRevision: 0, remoteManifest: Blog.pack(post),
    publication: null, pending: null, conflict: null, status: 'synced', error: null
  });
  assert.equal(received.received, true); assert.notEqual(received.post.id, post.id);
  const before = await receiver.a.readMaterialWriting(installed.workspaceId), source = await receiver.a.read(installed.workspaceId);
  const continuity = await receiver.a.readMaterialContinuityState(installed.workspaceId, installed.planId);
  const binding = await receiver.a.readBlogSyncState(installed.workspaceId, received.post.id);
  assert.equal(before.plans[0].output, null);
  assert.equal(continuity.mapping.planIds[row.data.plan.id], installed.planId);
  assert.equal(binding.remoteId, post.id); assert.equal(binding.remoteRevision, row.data.output.revision);
  assert.deepEqual((await receiver.a.listBlogCopies(installed.workspaceId)).map(value => value.status), ['received']);
  assert.equal((await applyMarker(receiver.a, row)).status, 'applied');
  assert.deepEqual(await receiver.a.readMaterialWriting(installed.workspaceId), before,
    'a live received post prevents a fabricated deleted output and preparation revision');
  assert.deepEqual(await receiver.a.readMaterialWritingOutput(installed.workspaceId, installed.planId), { status: 'none' });
  assert.deepEqual(await receiver.a.readPhotoPost(installed.workspaceId, received.post.id), received.post);
  assert.deepEqual(await receiver.a.readBlogSyncState(installed.workspaceId, received.post.id), binding);
  assert.deepEqual(await receiver.a.readMaterialContinuityState(installed.workspaceId, installed.planId), continuity);
  assert.deepEqual(await receiver.a.read(installed.workspaceId), source);
  assert.equal(receiver.rows.get('meta').has(key(`material-writing-output:${installed.workspaceId}:${installed.planId}`)), false);
  assert.equal([...receiver.rows.get('meta').values()].some(value => value.key.startsWith(`material-writing-output-deleted:${installed.workspaceId}:`)), false);
  assert.deepEqual((await receiver.a.readAccountDocRecord(markerKey(row.data.plan.id))).value, markerValue(row));

  const snapshot = await receiver.a.readMaterialContinuitySnapshot(installed.workspaceId, installed.planId);
  const linked = await receiver.a.installMaterialContinuity(row, { expectedFingerprint: snapshot.fingerprint });
  assert.equal(linked.postId, received.post.id, 'the saved preparation must reuse the live remapped copy');
  assert.equal((await receiver.a.readMaterialWritingOutput(installed.workspaceId, installed.planId)).status, 'available');
  assert.deepEqual((await receiver.a.listPhotoPosts(installed.workspaceId)).map(value => value.id), [received.post.id]);
  assert.deepEqual(await receiver.a.readPhotoPost(installed.workspaceId, received.post.id), received.post);
  assert.deepEqual(await receiver.a.readBlogSyncState(installed.workspaceId, received.post.id), binding);
  assert.deepEqual((await receiver.a.readMaterialWriting(installed.workspaceId)).plans,
    before.plans.map(plan => ({ ...plan, output: { postId: received.post.id } })));
  const { revision, updatedAt, ...afterSource } = await receiver.a.read(installed.workspaceId);
  const { revision: priorRevision, updatedAt: priorUpdatedAt, ...beforeSource } = source;
  assert.equal(revision, priorRevision + 1); assert(Date.parse(updatedAt) >= Date.parse(priorUpdatedAt));
  assert.deepEqual(afterSource, beforeSource, 'saved preparation receipt advances the bundle revision without rewriting exact sources');
  const evidence = await receiver.a.readPostEvidence(installed.workspaceId, received.post.id);
  assert.deepEqual(evidence.refs.map(ref => [ref.quote, ref.contentHash, ref.locator]),
    row.data.output.refs.map(ref => [ref.quote, ref.contentHash, ref.locator]));
  for (const ref of evidence.refs) await R.resolve(source, ref);
});

test('a deletion marker stored before BlogSync receipt preserves the later live copy and reconnects the saved preparation to it', async t => {
  const origin = await fixture(), receiver = blank(); t.after(origin.close); t.after(receiver.close);
  const { row, post } = savedRow(origin), writing = copy(row), Blog = require('../assets/life/blog.js');
  writing.revision = row.revision - 1;
  writing.data.output = { state: 'writing', postId: post.id, claimId: row.data.output.claimId };
  const installed = await receiver.a.installMaterialContinuity(writing);
  assert.notEqual(installed.workspaceId, row.data.bundle.workspaceId); assert.notEqual(installed.planId, row.data.plan.id);
  const source = await receiver.a.read(installed.workspaceId);
  assert.equal((await applyMarker(receiver.a, row)).status, 'applied');
  const marked = await receiver.a.readMaterialWriting(installed.workspaceId);
  const deleted = await receiver.a.readMaterialWritingOutput(installed.workspaceId, installed.planId);
  assert.equal(deleted.status, 'deleted');
  assert.deepEqual(await receiver.a.listBlogCopies(installed.workspaceId), []);
  assert.deepEqual(await receiver.a.listPhotoPosts(installed.workspaceId), []);
  assert.deepEqual((await receiver.a.readAccountDocRecord(markerKey(row.data.plan.id))).value, markerValue(row));
  // This order is deliberate: the marker is committed before BlogSync creates
  // its independently received live copy, while the preparation is still writing.
  const received = await receiver.a.installReceivedBlogPost(installed.workspaceId, { ...copy(post), id: Core.id(), revision: 0 }, {
    enabled: true, remoteId: post.id, remoteWorkspaceId: row.data.bundle.workspaceId,
    remoteRevision: post.revision, localRevision: 0, remoteManifest: Blog.pack(post),
    publication: null, pending: null, conflict: null, status: 'synced', error: null
  });
  assert.equal(received.received, true); assert.notEqual(received.post.id, post.id); assert.notEqual(received.post.id, deleted.postId);
  const binding = await receiver.a.readBlogSyncState(installed.workspaceId, received.post.id);
  assert.equal(binding.remoteId, post.id); assert.equal(binding.remoteRevision, row.data.output.revision);
  assert.deepEqual(await receiver.a.readMaterialWriting(installed.workspaceId), marked, 'BlogSync receipt preserves the preparation until its saved descriptor arrives');
  assert.deepEqual(await receiver.a.read(installed.workspaceId), source);
  const snapshot = await receiver.a.readMaterialContinuitySnapshot(installed.workspaceId, installed.planId);
  const linked = await receiver.a.installMaterialContinuity(row, { expectedFingerprint: snapshot.fingerprint });
  assert.equal(linked.postId, received.post.id, 'a confirmed live copy wins over the earlier marker when the saved output is connected');
  assert.equal((await receiver.a.readMaterialWritingOutput(installed.workspaceId, installed.planId)).status, 'available');
  assert.deepEqual((await receiver.a.listPhotoPosts(installed.workspaceId)).map(value => value.id), [received.post.id]);
  assert.deepEqual(await receiver.a.readPhotoPost(installed.workspaceId, received.post.id), received.post);
  assert.deepEqual(await receiver.a.readBlogSyncState(installed.workspaceId, received.post.id), binding);
  assert.deepEqual((await receiver.a.readMaterialWriting(installed.workspaceId)).plans,
    marked.plans.map(plan => ({ ...plan, output: { postId: received.post.id } })));
  const { revision, updatedAt, ...afterSource } = await receiver.a.read(installed.workspaceId);
  const { revision: priorRevision, updatedAt: priorUpdatedAt, ...beforeSource } = source;
  assert.equal(revision, priorRevision + 1); assert(Date.parse(updatedAt) >= Date.parse(priorUpdatedAt));
  assert.deepEqual(afterSource, beforeSource);
  const evidence = await receiver.a.readPostEvidence(installed.workspaceId, received.post.id);
  assert.deepEqual(evidence.refs.map(ref => [ref.quote, ref.contentHash, ref.locator]),
    row.data.output.refs.map(ref => [ref.quote, ref.contentHash, ref.locator]));
  for (const ref of evidence.refs) await R.resolve(source, ref);
});

test('remote receipt wakes the exact remapped preparation without rewriting its notes or originals', async t => {
  const origin = await fixture(), receiver = blank(); t.after(origin.close); t.after(receiver.close);
  const { row, post } = savedRow(origin), installed = await receiver.a.installMaterialContinuity(row, { post });
  // Model a preparation whose formerly received output is absent, with no prior deletion evidence.
  receiver.rows.get('meta').delete(key(`photo-post:${installed.workspaceId}:${installed.postId}`));
  assert.equal((await receiver.a.readMaterialWritingOutput(installed.workspaceId, installed.planId)).status, 'missing');
  const before = await receiver.a.readMaterialWriting(installed.workspaceId), source = await receiver.a.read(installed.workspaceId), events = [];
  const off = receiver.a.subscribeAll(event => events.push(event)); t.after(off);
  assert.equal((await applyMarker(receiver.a, row)).status, 'applied');
  const after = await receiver.a.readMaterialWriting(installed.workspaceId);
  assert(after.revision > before.revision);
  assert.deepEqual(after.plans, before.plans);
  assert(events.some(event => event.type === 'material_writing_changed' && event.workspaceId === installed.workspaceId && event.revision === after.revision));
  assert.equal((await receiver.a.readMaterialWritingOutput(installed.workspaceId, installed.planId)).status, 'deleted');
  assert.deepEqual(await receiver.a.read(installed.workspaceId), source);
});

test('canonical receipts remain account-private even on a shared IndexedDB', async t => {
  const f = await fixture(); t.after(f.close); const post = await handoff(f);
  await f.a.deletePhotoPost(f.ws, post.id, post.revision);
  const own = markerKey(f.plan.id), theirs = markerKey(f.plan.id, accountB);
  assert.equal((await f.a.readAccountDocRecord(own)).exists, true);
  assert.equal((await f.foreign.readAccountDocRecord(theirs)).exists, false);
  await assert.rejects(f.foreign.readAccountDocRecord(own), { code: 'account_doc_invalid_key' });
  assert.equal((await f.foreign.listAccountDocs()).filter(doc => doc.prefix === 'materialOutputDeleted').length, 0);
  assert.equal((await f.a.readMaterialWritingOutput(f.ws, f.plan.id)).status, 'deleted');
});

test('schema 4 cursor that skipped deletion receipts replays them once on schema 5', async t => {
  const origin = await fixture(), fresh = blank(); t.after(origin.close); t.after(fresh.close);
  const { row } = savedRow(origin), docKey = markerKey(row.data.plan.id), value = markerValue(row), calls = [];
  const remote = { PAGE_LIMIT: 20, dispose() {}, async put() { assert.fail('unchanged received marker must not be uploaded'); },
    async changes(after) { calls.push(after); return after < 7 ? [{ docKey, seq: 7, revision: 1, data: value, deleted: false, client_updated_at: null }] : []; } };
  await fresh.a.writeAccountDocCursor(7);
  fresh.rows.get('meta').set(key(`accountDocSchema:${accountKey(accountA)}`), { key: `accountDocSchema:${accountKey(accountA)}`, value: 4 });
  assert.equal((await fresh.a.readAccountDocRecord(docKey)).exists, false);
  const sync = Sync.create({ storage: fresh.a, auth: { getAccount: () => accountA }, remote, polling: false, locks: null }); t.after(() => sync.dispose());
  await sync.syncNow(); assert.equal(sync.getStatus().state, 'synced');
  assert.deepEqual((await fresh.a.readAccountDocRecord(docKey)).value, value);
  assert.equal(await fresh.a.readMaterialContinuityOutputDeletion(row), true);
  assert.deepEqual(calls, [0]);
  await sync.syncNow(); assert.deepEqual(calls, [0, 7]);
  assert.deepEqual(await fresh.a.upgradeAccountDocSchema(), { schema: 5, rewound: false });
});

for (const mode of ['install', 'adopt']) {
  test(`${mode}: authenticated saved-output deletion proof commits with the preparation and never recreates the post`, async t => {
    const origin = await fixture(), fresh = mode === 'adopt' ? origin : blank(); t.after(origin.close); if (fresh !== origin) t.after(fresh.close);
    const { row } = savedRow(origin); if (mode === 'adopt') await prepareAdoption(origin);
    const api = mode === 'adopt' ? 'adoptMaterialContinuity' : 'installMaterialContinuity';
    const before = copy(row.data), result = await fresh.a[api](row, { deletedOutput: deletionProof(row) });
    assert.deepEqual((await fresh.a.readAccountDocRecord(markerKey(row.data.plan.id))).value, markerValue(row));
    assert.equal((await fresh.a.readMaterialWritingOutput(result.workspaceId, result.planId)).status, 'deleted');
    assert.deepEqual((await fresh.a.readMaterialWriting(result.workspaceId)).plans[0].question, before.plan.question);
    assert.deepEqual((await fresh.a.read(result.workspaceId)).sourceVersions.map(v => v.contentText), before.bundle.sourceVersions.map(v => v.contentText));
    assert.equal((await fresh.a.listPhotoPosts(result.workspaceId)).length, 0);
    await assert.rejects(fresh.a.createMaterialWritingPost(result.workspaceId, result.planId, result.planRevision), { code: 'material_writing_output_deleted' });
    const snapshot = await fresh.a.readMaterialContinuitySnapshot(result.workspaceId, result.planId);
    assert.deepEqual(snapshot.data, before, 'the immutable output descriptor survives without output:null');
    assert.equal(snapshot.post, null);
  });

  test(`${mode}: missing original without a receipt or authenticated proof remains rejected`, async t => {
    const origin = await fixture(), fresh = mode === 'adopt' ? origin : blank(); t.after(origin.close); if (fresh !== origin) t.after(fresh.close);
    const { row } = savedRow(origin); if (mode === 'adopt') await prepareAdoption(origin);
    const api = mode === 'adopt' ? 'adoptMaterialContinuity' : 'installMaterialContinuity';
    // Open the DB before taking the rollback snapshot: schema creation is not part of install.
    await fresh.a.listWorkspaces(); const before = copy(fresh.rows);
    await assert.rejects(fresh.a[api](row), { code: 'material_output_pending' });
    assert.deepEqual(fresh.rows, before);
  });
}

const proofMutations = {
  owner: proof => { proof.binding.userId = accountB.userId; },
  project: proof => { proof.binding.projectUrl = 'https://another-project.supabase.co'; },
  remoteId: proof => { proof.remoteId = Core.id(); },
  revision: proof => { proof.revision++; },
  workspaceId: proof => { proof.workspaceId = Core.id(); },
  planId: proof => { proof.planId = Core.id(); },
  outputPostId: proof => { proof.output.postId = Core.id(); },
  outputRevision: proof => { proof.output.revision++; },
  outputClaim: proof => { proof.output.claimId = Core.id(); },
  partial: proof => { delete proof.output; }
};
for (const [field, change] of Object.entries(proofMutations)) {
  test(`a saved-output proof with changed ${field} cannot create a marker or a preparation`, async t => {
    const origin = await fixture(), fresh = blank(); t.after(origin.close); t.after(fresh.close);
    const { row } = savedRow(origin), proof = deletionProof(row); change(proof);
    await fresh.a.listWorkspaces(); const before = copy(fresh.rows);
    await assert.rejects(fresh.a.installMaterialContinuity(row, { deletedOutput: proof }), error =>
      ['invalid_material_output_deletion', 'account_mismatch', 'invalid_account_binding'].includes(error?.code) ||
      field === 'partial' && error?.code === 'invalid_request');
    assert.deepEqual(fresh.rows, before, 'mismatched evidence cannot leave even a standalone account receipt');
  });
}

test('a writing claim cannot infer deletion from a missing original without an existing account receipt', async t => {
  const origin = await fixture(), fresh = blank(); t.after(origin.close); t.after(fresh.close);
  const { row } = savedRow(origin); row.data.output = { state: 'writing', postId: row.data.output.postId, claimId: row.data.output.claimId };
  await fresh.a.listWorkspaces(); const before = copy(fresh.rows);
  await assert.rejects(fresh.a.installMaterialContinuity(row, { deletedOutput: deletionProof(row) }), { code: 'invalid_material_output_deletion' });
  assert.deepEqual(fresh.rows, before);
});

test('deleted-output proof does not waive exact source-content verification', async t => {
  const origin = await fixture(), fresh = blank(); t.after(origin.close); t.after(fresh.close);
  const { row } = savedRow(origin), proof = deletionProof(row);
  row.data.bundle.sourceVersions[0].contentText += '\r\n이 원문은 검증된 해시와 다릅니다.';
  await fresh.a.listWorkspaces(); const before = copy(fresh.rows);
  await assert.rejects(fresh.a.installMaterialContinuity(row, { deletedOutput: proof }), { code: 'invalid_material_continuity' });
  assert.deepEqual(fresh.rows, before);
});

for (const point of ['account_marker', 'workspace', 'local_marker', 'preparation', 'handoff', 'binding', 'installation_receipt', 'completion']) {
  test(`failed ${point} during deleted-output receive rolls back its proof and all installed content`, async t => {
    const origin = await fixture(), fresh = blank(); t.after(origin.close); t.after(fresh.close);
    const { row } = savedRow(origin); await fresh.a.listWorkspaces(); const before = copy(fresh.rows), events = [];
    const off = fresh.a.subscribeAll(event => events.push(event)); t.after(off);
    const prefixes = { account_marker: 'materialOutputDeleted:', local_marker: 'material-writing-output-deleted:', preparation: 'material-writing:',
      handoff: 'material-writing-output:', binding: 'material-continuity:', installation_receipt: 'material-continuity-install:' };
    let hit = false;
    if (point === 'completion') fresh.control.failCompletion = true;
    else fresh.control.fail = ({ name, id }) => {
      if (point === 'workspace' ? name === 'bundles' : typeof id === 'string' && id.startsWith(prefixes[point])) { hit = true; return true; }
      return false;
    };
    await assert.rejects(fresh.a.installMaterialContinuity(row, { deletedOutput: deletionProof(row) }),
      { code: point === 'completion' ? 'storage_aborted' : 'storage_quota' });
    if (point !== 'completion') assert(hit, 'the fault was reached in the intended write');
    assert.deepEqual(fresh.rows, before); assert.deepEqual(events, []);
  });
}

test('a legacy marker created after this account already listed documents still becomes a canonical receipt', async t => {
  const f = await fixture(); t.after(f.close);
  // Earlier sync passes, including a completed schema migration, cannot cause a later old tab to be ignored.
  await f.a.listAccountDocs(); await f.a.writeAccountDocCursor(50);
  const post = await handoff(f); await f.a.deletePhotoPost(f.ws, post.id, post.revision);
  f.rows.get('meta').delete(key(markerKey(f.plan.id)));
  const legacyKey = key(`material-writing-output-deleted:${f.ws}:${post.id}`), legacy = copy(f.rows.get('meta').get(legacyKey));
  const before = await f.a.readMaterialWriting(f.ws);
  const docs = await f.a.listAccountDocs();
  assert(docs.some(item => item.key === markerKey(f.plan.id)));
  assert.deepEqual((await f.a.readAccountDocRecord(markerKey(f.plan.id))).value,
    { version: 1, workspaceId: f.ws, planId: f.plan.id, postId: post.id });
  assert.deepEqual(f.rows.get('meta').get(legacyKey), legacy);
  assert.deepEqual(await f.a.readMaterialWriting(f.ws), before);
});

test('first-sync deletion without a remote claim stays local and never exports a cleared output', async t => {
  const f = await fixture(); t.after(f.close); const post = await handoff(f);
  await f.a.deletePhotoPost(f.ws, post.id, post.revision);
  const before = await f.a.readMaterialWriting(f.ws), source = await f.a.read(f.ws);
  assert.equal(await f.a.readMaterialContinuityState(f.ws, f.plan.id), null);
  await assert.rejects(f.a.readMaterialContinuitySnapshot(f.ws, f.plan.id), { code: 'material_writing_output_deleted',
    message: '이 기기에만 있는 준비입니다. 첫 동기화 전에 완성 글을 삭제해 다른 기기로 보내지 못했습니다. 준비와 자료는 남아 있습니다. 새 준비 사본으로 다시 시작해 주세요.' });
  assert.deepEqual(await f.a.readMaterialWriting(f.ws), before);
  assert.deepEqual(await f.a.read(f.ws), source);
  assert.deepEqual(before.plans[0].output, { postId: post.id });
  assert.equal((await f.a.readMaterialWritingOutput(f.ws, f.plan.id)).status, 'deleted');
});

test('a deleted local output with a remote preparation head keeps the shared notice and its rejection contract', async t => {
  const f = await fixture(); t.after(f.close); const post = await handoff(f);
  await f.a.deletePhotoPost(f.ws, post.id, post.revision);
  const before = await f.a.readMaterialWriting(f.ws), source = await f.a.read(f.ws);
  const plan = before.plans.find(value => value.id === f.plan.id);
  const row = { id: Core.id(), revision: 1, data: C.snapshot(source, plan, null) };
  await f.a.writeMaterialContinuityState(f.ws, f.plan.id, { binding: accountA, enabled: true, remoteId: row.id,
    remoteRevision: row.revision, head: row, mapping: null, output: null, pending: null, conflict: null, localClaim: null, error: null }, 0);
  const continuity = await f.a.readMaterialContinuityState(f.ws, f.plan.id), rows = copy(f.rows);
  assert.deepEqual(continuity.head, row); assert.equal(continuity.output, null);
  await assert.rejects(f.a.readMaterialContinuitySnapshot(f.ws, f.plan.id), { code: 'material_writing_output_deleted',
    message: '이 준비에서 만든 글을 삭제했습니다. 준비와 자료는 남아 있습니다. 새 준비 사본을 만들어 다시 시작할 수 있습니다.' });
  assert.deepEqual(f.rows, rows, 'the rejected snapshot must not change any persisted row');
  assert.deepEqual(await f.a.readMaterialContinuityState(f.ws, f.plan.id), continuity);
  assert.deepEqual(await f.a.readMaterialWriting(f.ws), before);
  assert.deepEqual(await f.a.read(f.ws), source);
  assert.deepEqual(plan.output, { postId: post.id });
  assert.deepEqual(await f.a.readMaterialWritingOutput(f.ws, f.plan.id), { status: 'deleted', postId: post.id });
});

test('a received receipt cannot replace the canonical output identity already confirmed for its preparation', async t => {
  const f = await fixture(), fresh = blank(); t.after(f.close); t.after(fresh.close);
  const { row } = savedRow(f), original = markerValue(row);
  assert.equal((await applyMarker(fresh.a, row)).status, 'applied');
  const before = copy(fresh.rows);
  assert.equal((await applyMarker(fresh.a, row, { ...original, postId: Core.id() })).status, 'rejected');
  assert.deepEqual(fresh.rows, before);
  assert.deepEqual((await fresh.a.readAccountDocRecord(markerKey(original.planId))).value, original);
});

test('account synchronization receipts stay out of exported account documents', async t => {
  const f = await fixture(); t.after(f.close); const post = await handoff(f);
  await f.a.deletePhotoPost(f.ws, post.id, post.revision);
  assert((await f.a.listAccountDocs()).some(row => row.prefix === 'materialOutputDeleted'));
  const Full = require('../assets/life/full-backup.js'), Fflate = require('../vendor/fflate/fflate.js');
  const context = { storage: f.a }, planned = await Full.plan(context);
  planned.tasks = planned.tasks.filter(task => task.kind === 'accountDocuments');
  const writer = Full.writer(planned, context, { appVersion: 'synthetic-c3' });
  assert.deepEqual(await writer.collect(), []);
  const built = writer.finish(), files = Fflate.unzipSync(new Uint8Array(await built.blob.arrayBuffer()));
  const documents = JSON.parse(new TextDecoder().decode(files['account-documents.json'])).documents;
  assert.equal(documents.some(row => row.prefix === 'materialOutputDeleted'), false);
  assert.equal(JSON.stringify(documents).includes('material-writing-output-deleted:'), false);
  assert.equal((await f.a.readMaterialWritingOutput(f.ws, f.plan.id)).status, 'deleted');
});

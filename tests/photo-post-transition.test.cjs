'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createStorage } = require('../assets/life/storage.js');
const Photo = require('../assets/life/photo-post.js'), Markdown = require('../assets/life/post-markdown.js');
const Material = require('../assets/life/material-writing.js'), Reference = require('../assets/life/source-reference.js');
const { memoryIdb, owner, Core, png } = require('./helpers/blog-sync-cloud.cjs');
const copy = value => structuredClone(value), key = value => JSON.stringify(value);
async function fixture(t, { ownEvidence = false, draft = false } = {}) {
  const memory = memoryIdb(), options = { idb: memory.idb, core: Core, channelFactory: null, account: owner };
  const storage = createStorage(options), other = createStorage(options);
  t.after(() => { storage.close(); other.close(); });
  let bundle = await storage.createWorkspace('전환 검수'), ws = bundle.workspaceId;
  const imported = await Core.prepareImport({ origin: 'obsidian', title: '원문', text: '🌿\r\n정확한 구절\r\n나머지', author: '저자', authorRelation: 'other', coverage: 'partial' }, bundle);
  await storage.commitLocal({ workspaceId: ws, operationId: Core.id(), baseRevision: bundle.revision, changes: Core.buildImportChanges(bundle, imported) });
  bundle = await storage.read(ws);
  const start = imported.version.contentText.indexOf('정확한'), refs = [await Reference.build({ bundle, sourceId: imported.source.id, versionId: imported.version.id, locator: { start, end: start + 6 } })];
  const legacy = Photo.create(Core.id, '2026-11-05T00:00:00.000Z'); legacy.title = '원래 제목'; legacy.status = draft ? 'draft' : 'saved';
  legacy.photos = [await png(91)]; legacy.ops = [{ insert: '정확한 본문', attributes: { bold: true, author: 'ai' } }, { insert: '\n' }, { insert: { photo: { id: legacy.photos[0].id, caption: '설명', alt: '나무' } } }, { insert: '\n' }];
  const source = await storage.savePhotoPostWithEvidence(ws, legacy, 0, refs, 0);
  let candidate = Markdown.fromV2(source).document;
  if (!draft) candidate = await storage.savePhotoPost(ws, { ...candidate, id: Core.id(), revision: 0, status: 'draft', replaces: { id: source.id, revision: source.revision } }, 0);
  if (ownEvidence) await storage.savePostEvidence(ws, candidate.id, { refs: [] }, 0);
  const input = { ...candidate, status: draft ? 'draft' : 'saved' }, request = { sourceId: source.id, sourceRevision: source.revision, recoveryId: Core.id() };
  return { memory, storage, other, ws, source, input, request, refs, bundle, run: () => storage.savePostTransition(ws, input, input.revision, request) };
}

test('explicit replacement preserves exact stored body, photos and evidence; inherits final evidence', async t => {
  const f = await fixture(t), before = copy(f.input), bundle = await f.storage.read(f.ws);
  const result = await f.run(), recovery = await f.storage.readPhotoPost(f.ws, result.recoveryId);
  assert.equal(result.post.format, 'life-post-md-v1'); assert.equal(result.post.replaces, null);
  assert.equal(result.post.createdAt, f.source.createdAt); assert.equal(recovery.title, '복구 사본 · 원래 제목');
  assert.deepEqual(recovery, { ...f.source, id: result.recoveryId, title: recovery.title, revision: 1, status: 'draft', replaces: null, archived: false });
  assert.deepEqual(await f.storage.readPostEvidence(f.ws, result.recoveryId), { revision: 1, refs: f.refs });
  assert.deepEqual(await f.storage.readPostEvidence(f.ws, result.post.id), { revision: 1, refs: f.refs });
  assert.deepEqual(await f.storage.read(f.ws), bundle); assert.deepEqual(f.input, before);
  assert.equal((await f.storage.listPhotoPosts(f.ws)).length, 2);
  await assert.rejects(f.storage.readPhotoPost(f.ws, f.source.id), { code: 'photo_post_missing' });
});

test('recovery copies the commit-time sidecar even for trashed sources; explicit empty draft evidence stays empty', async t => {
  const f = await fixture(t, { ownEvidence: true });
  await f.storage.savePostEvidence(f.ws, f.source.id, { refs: [...f.refs, ...f.refs] }, 1);
  await f.storage.commitLocal({ workspaceId: f.ws, operationId: Core.id(), baseRevision: f.bundle.revision, changes: Core.buildSourceStateChanges(f.bundle, f.refs[0].sourceId, 'trash') });
  const result = await f.run();
  assert.deepEqual(await f.storage.readPostEvidence(f.ws, result.recoveryId), { revision: 1, refs: [...f.refs, ...f.refs] });
  assert.deepEqual(await f.storage.readPostEvidence(f.ws, result.post.id), { revision: 1, refs: [] });
});

test('a stored unused photo and HEIC original/view bytes survive without compacting the recovery', async t => {
  const f = await fixture(t), source = copy(f.source), original = new Blob([Uint8Array.from([0, 1, 2, 3, 4])], { type: 'image/heic' });
  const viewBlob = new Blob([Uint8Array.from([255, 216, 255, 7, 255, 217])], { type: 'image/jpeg' });
  source.photos.push({ id: Core.id(), name: 'unused.HEIC', type: original.type, size: original.size, width: 100, height: 80, digest: await Photo.digest(original), blob: original,
    view: { type: viewBlob.type, size: viewBlob.size, width: 100, height: 80, digest: await Photo.digest(viewBlob), blob: viewBlob } });
  Photo.validate(source);
  const rowKey = `photo-post:${f.ws}:${source.id}`; f.memory.rows.get('meta').set(key(rowKey), { key: rowKey, value: source });
  const result = await f.run(), recovery = await f.storage.readPhotoPost(f.ws, result.recoveryId);
  assert.equal(result.post.photos.length, 1); assert.deepEqual(recovery.photos, source.photos);
  assert.deepEqual(await recovery.photos[1].blob.arrayBuffer(), await original.arrayBuffer());
  assert.deepEqual(await recovery.photos[1].view.blob.arrayBuffer(), await viewBlob.arrayBuffer());
});

for (const point of ['final', 'recovery', 'recovery-evidence', 'receipt']) test(`failure at ${point} rolls back every row and sends no success notification`, async t => {
  const f = await fixture(t), before = copy(f.memory.rows), events = [];
  t.after(f.storage.subscribe(f.ws, event => events.push(event)));
  const target = point === 'final' ? `photo-post:${f.ws}:${f.input.id}` : point === 'recovery' ? `photo-post:${f.ws}:${f.request.recoveryId}` : point === 'recovery-evidence' ? `post-evidence:${f.ws}:${f.request.recoveryId}` : `photo-transition:${f.ws}:${f.source.id}:${f.source.revision}`;
  f.memory.control.fail = write => write.method === 'put' && write.id === target;
  await assert.rejects(f.run(), { code: 'storage_quota' }); assert.deepEqual(f.memory.rows, before); assert.deepEqual(events, []);
  assert.equal((await f.run()).post.format, 'life-post-md-v1', 'same explicit request succeeds after quota is resolved');
});

test('exact successful retries from two tabs return one result, while changed payloads cannot reuse the receipt', async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.run(), f.other.savePostTransition(f.ws, f.input, f.input.revision, f.request)]);
  assert.equal(results.filter(result => result.replayed).length, 1); assert.deepEqual(results[0].post, results[1].post);
  assert.equal((await f.storage.listPhotoPosts(f.ws)).length, 2);
  const before = copy(f.memory.rows);
  await assert.rejects(f.storage.savePostTransition(f.ws, { ...f.input, title: '변경 입력' }, f.input.revision, f.request), { code: 'operation_mismatch' });
  const changedBytes = copy(f.input); changedBytes.photos[0].blob = new Blob([new Uint8Array(changedBytes.photos[0].size).fill(7)], { type: changedBytes.photos[0].type });
  await assert.rejects(f.storage.savePostTransition(f.ws, changedBytes, changedBytes.revision, f.request), { code: 'operation_mismatch' });
  assert.deepEqual(f.memory.rows, before);
  await f.storage.deletePhotoPost(f.ws, results[0].post.id, results[0].post.revision);
  await assert.rejects(f.run(), { code: 'photo_post_conflict' });
});

test('different concurrent first edits have one winner and preserve the losing editing draft', async t => {
  const f = await fixture(t), second = await f.other.savePhotoPost(f.ws, { ...f.input, id: Core.id(), revision: 0, status: 'draft' }, 0);
  const secondInput = { ...second, status: 'saved', title: '다른 탭 입력' }, otherRequest = { ...f.request, recoveryId: Core.id() };
  const results = await Promise.allSettled([f.run(), f.other.savePostTransition(f.ws, secondInput, second.revision, otherRequest)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'operation_mismatch');
  const posts = await f.storage.listPhotoPosts(f.ws); assert.equal(posts.length, 3);
  assert.equal(posts.filter(post => post.title.startsWith('복구 사본 · ')).length, 1);
  const winner = results.find(result => result.status === 'fulfilled').value.post;
  assert.equal((await f.storage.readPhotoPost(f.ws, winner.id === second.id ? f.input.id : second.id)).status, 'draft');
});

test('explicit existing-draft conversion works in place and v1 recovery keeps its original format', async t => {
  const f = await fixture(t, { draft: true }), source = copy(f.source); source.format = 'life-photo-post-v1'; delete source.attachments; delete source.archived;
  Photo.validate(source); const rowKey = `photo-post:${f.ws}:${source.id}`;
  f.memory.rows.get('meta').set(key(rowKey), { key: rowKey, value: source });
  const result = await f.run(); assert.equal(result.post.id, source.id); assert.equal(result.post.status, 'draft'); assert.equal(result.post.revision, 2);
  const recovery = await f.storage.readPhotoPost(f.ws, result.recoveryId); assert.equal(recovery.format, source.format); assert.deepEqual(recovery.ops, source.ops);
});

test('stale source revision, malformed evidence and occupied recovery IDs leave all data untouched', async t => {
  const f = await fixture(t), before = copy(f.memory.rows);
  await assert.rejects(f.storage.savePostTransition(f.ws, f.input, f.input.revision, { ...f.request, sourceRevision: 8 }), { code: 'invalid_photo_post' });
  assert.deepEqual(f.memory.rows, before);
  const evidenceKey = `post-evidence:${f.ws}:${f.source.id}`, row = f.memory.rows.get('meta').get(key(evidenceKey)); row.value.refs[0].quote = '다른 구절';
  const damaged = copy(f.memory.rows); await assert.rejects(f.run()); assert.deepEqual(f.memory.rows, damaged);
  f.memory.rows.get('meta').set(key(evidenceKey), before.get('meta').get(key(evidenceKey)));
  const collisionKey = `post-evidence:${f.ws}:${f.request.recoveryId}`; f.memory.rows.get('meta').set(key(collisionKey), { key: collisionKey, value: { revision: 1, refs: [] } });
  const collision = copy(f.memory.rows); await assert.rejects(f.run(), { code: 'photo_post_conflict' }); assert.deepEqual(f.memory.rows, collision);
});

test('replacement at the 200-post limit succeeds, but an in-place draft at the limit rolls back', async t => {
  for (const draft of [false, true]) {
    const f = await fixture(t, { draft }), indexKey = `photo-posts:${f.ws}`, index = f.memory.rows.get('meta').get(key(indexKey)).value;
    while (index.length < 200) index.push({ ...index[0], id: Core.id() });
    const before = copy(f.memory.rows);
    if (draft) { await assert.rejects(f.run(), { code: 'photo_post_limit' }); assert.deepEqual(f.memory.rows, before); }
    else { await f.run(); assert.equal((await f.storage.listPhotoPosts(f.ws)).length, 200); }
  }
});

test('material output follows the finished Markdown ID and C3 deletion marks that exact result', async t => {
  const f = await fixture(t), material = Material.material(f.bundle, f.refs[0].sourceId, f.refs[0].sourceVersionId, Core.id), plan = Material.create(Core.id);
  plan.title = '준비'; plan.materials = [material]; plan.blocks = [{ id: Core.id(), kind: 'quote', materialId: material.id, reference: f.refs[0] }];
  const state = await f.storage.saveMaterialWriting(f.ws, { ...Material.empty(f.ws), plans: [plan] }, 0), created = await f.storage.createMaterialWritingPost(f.ws, plan.id, state.revision);
  let post = await f.storage.readPhotoPost(f.ws, created.postId); post = await f.storage.savePhotoPost(f.ws, { ...post, status: 'saved' }, post.revision);
  const candidate = await f.storage.savePhotoPost(f.ws, { ...Markdown.fromV2(post).document, id: Core.id(), revision: 0, status: 'draft', replaces: { id: post.id, revision: post.revision } }, 0);
  const result = await f.storage.savePostTransition(f.ws, { ...candidate, status: 'saved' }, candidate.revision, { sourceId: post.id, sourceRevision: post.revision, recoveryId: Core.id() });
  assert.equal((await f.storage.readMaterialWritingOutput(f.ws, plan.id)).postId, result.post.id);
  assert.equal((await f.storage.readMaterialWritingOutput(f.ws, plan.id)).status, 'available');
  await f.storage.deletePhotoPost(f.ws, result.post.id, result.post.revision);
  assert.deepEqual(await f.storage.readMaterialWritingOutput(f.ws, plan.id), { status: 'deleted', postId: result.post.id });
  const after = await f.storage.readMaterialWriting(f.ws);
  await assert.rejects(f.storage.createMaterialWritingPost(f.ws, plan.id, after.revision), { code: 'material_writing_output_deleted' });
  assert.equal((await f.storage.readPhotoPost(f.ws, result.recoveryId)).status, 'draft');
});

test('replacement transfers remote identity and receipt, retires its synced draft, and leaves recovery unbound', async t => {
  const f = await fixture(t), remoteId = Core.id(), ownRemoteId = Core.id();
  const prior = await f.storage.writeBlogSyncState(f.ws, f.source.id, { enabled: true, remoteId, remoteRevision: 4, localRevision: f.source.revision, publication: { active: false }, status: 'synced' });
  await f.storage.writeBlogSyncState(f.ws, f.input.id, { enabled: true, remoteId: ownRemoteId, remoteRevision: 2, localRevision: f.input.revision, status: 'synced' });
  const receiptKey = `blog-received:${f.ws}:${remoteId}`, receipt = { owner, remoteId, localPostId: f.source.id };
  f.memory.rows.get('meta').set(key(receiptKey), { key: receiptKey, value: receipt });
  const before = copy(f.memory.rows);
  f.memory.control.fail = write => write.id === `photo-post:${f.ws}:${f.request.recoveryId}`;
  await assert.rejects(f.run(), { code: 'storage_quota' }); assert.deepEqual(f.memory.rows, before);
  const result = await f.run(), rows = f.memory.rows.get('meta'), binding = rows.get(key(`blog-sync:${f.ws}:${result.post.id}`)).value;
  assert.equal(binding.remoteId, remoteId); assert.equal(binding.remoteRevision, prior.remoteRevision);
  assert.equal(rows.get(key(receiptKey)).value.localPostId, result.post.id);
  assert.equal(rows.has(key(`blog-sync:${f.ws}:${f.source.id}`)), false);
  assert.equal(rows.has(key(`blog-sync:${f.ws}:${result.recoveryId}`)), false);
  assert.equal((await f.storage.listBlogSyncStates(f.ws)).tombstones.some(item => item.remoteId === ownRemoteId && item.reason === 'replaced'), true);
});

test('explicit conversion of an existing editing draft retains its exact replacement pointer and evidence', async t => {
  const f = await fixture(t), oldDraft = await f.storage.savePhotoPostWithEvidence(f.ws,
    { ...f.source, id: Core.id(), revision: 0, status: 'draft', replaces: { id: f.source.id, revision: f.source.revision } }, 0, f.refs, 0);
  const input = Markdown.fromV2(oldDraft).document, request = { sourceId: oldDraft.id, sourceRevision: oldDraft.revision, recoveryId: Core.id() };
  const result = await f.storage.savePostTransition(f.ws, input, input.revision, request);
  assert.equal(result.post.status, 'draft'); assert.deepEqual(result.post.replaces, oldDraft.replaces);
  assert.deepEqual(await f.storage.readPhotoPost(f.ws, f.source.id), f.source);
  assert.deepEqual(await f.storage.readPostEvidence(f.ws, result.post.id), { revision: 1, refs: f.refs });
  assert.deepEqual(await f.storage.readPostEvidence(f.ws, result.recoveryId), { revision: 1, refs: f.refs });
});

test('in-place draft conversion cannot finish or retarget an unrelated saved source without its recovery', async t => {
  const f = await fixture(t), oldDraft = await f.storage.savePhotoPost(f.ws,
    { ...f.source, id: Core.id(), revision: 0, status: 'draft', replaces: { id: f.source.id, revision: f.source.revision } }, 0);
  const input = Markdown.fromV2(oldDraft).document, request = { sourceId: oldDraft.id, sourceRevision: oldDraft.revision, recoveryId: Core.id() }, before = copy(f.memory.rows);
  await assert.rejects(f.storage.savePostTransition(f.ws, { ...input, status: 'saved' }, input.revision, request), { code: 'invalid_photo_post' });
  await assert.rejects(f.storage.savePostTransition(f.ws, { ...input, replaces: null }, input.revision, request), { code: 'invalid_photo_post' });
  assert.deepEqual(f.memory.rows, before);
});

test('closing the account scope during byte hashing rejects late completion without writes or notifications', async t => {
  const f = await fixture(t), before = copy(f.memory.rows), events = [];
  f.storage.subscribe(f.ws, event => events.push(event));
  const digest = crypto.subtle.digest;
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  crypto.subtle.digest = async function(...args) { entered(); await gate; return digest.apply(this, args); };
  let pending;
  try {
    pending = f.run(); await started; f.storage.close(); release();
    await assert.rejects(pending, { code: 'storage_scope_closed' });
  } finally { release(); crypto.subtle.digest = digest; }
  assert.deepEqual(f.memory.rows, before); assert.deepEqual(events, []);
});

test('a source edit committed during asynchronous hashing loses source CAS without creating a recovery', async t => {
  const f = await fixture(t), digest = crypto.subtle.digest;
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  crypto.subtle.digest = async function(...args) { entered(); await gate; return digest.apply(this, args); };
  let before;
  try {
    const pending = f.run(); await started;
    await f.other.savePhotoPost(f.ws, { ...f.source, title: '먼저 저장한 다른 탭' }, f.source.revision);
    before = copy(f.memory.rows); release();
    await assert.rejects(pending, { code: 'photo_post_conflict' });
  } finally { release(); crypto.subtle.digest = digest; }
  assert.deepEqual(f.memory.rows, before);
});

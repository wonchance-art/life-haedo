'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../assets/life/core.js'), M = require('../assets/life/material-writing.js');
const R = require('../assets/life/source-reference.js'), Model = require('../assets/life/material-continuity.js');
const Blog = require('../assets/life/blog.js'), Photo = require('../assets/life/photo-post.js');
const Service = require(process.env.MATERIAL_CONTINUITY_SYNC_MODULE || '../assets/life/material-continuity-sync.js');
const copy = value => structuredClone(value), fault = code => Object.assign(Error(code), { code });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function fixture({ savedOutput = false, photos = false } = {}) {
  let bundle = C.createWorkspace();
  const imported = await C.prepareImport({ origin: 'other', title: '합성 원문', text: '\ufeff정확 원문🌱\r\n선택 구절🌿', url: 'https://example.org/source' }, bundle);
  bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, imported));
  const ref = await R.build({ bundle, sourceId: imported.source.id, versionId: imported.version.id, locator: { start: 1, end: imported.version.contentText.length } });
  const plan = M.create(C.id); plan.title = '기기 간 준비'; plan.question = '검토한 비공개 질문';
  plan.materials = [M.material(bundle, imported.source.id, imported.version.id, C.id)]; plan.materials[0].note = '검토한 비공개 메모';
  plan.blocks = [{ id: C.id(), kind: 'quote', materialId: plan.materials[0].id, reference: ref }];
  const post = M.project({ ...M.empty(bundle.workspaceId), plans: [plan] }, plan.id, C.id).doc; post.status = 'saved'; post.revision = 1;
  if (photos) {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], { type: 'image/png' });
    const photo = { id: C.id(), name: '합성 사진.png', type: blob.type, width: 1, height: 1, size: blob.size, digest: await Photo.digest(blob), blob };
    post.photos.push(photo); post.ops.push({ insert: { photo: { id: photo.id, caption: '', alt: '' } } }, { insert: '\n' });
  }
  plan.output = { postId: post.id };
  const output = { state: 'writing', postId: post.id, claimId: C.id() };
  if (savedOutput) Object.assign(output, { state: 'saved', revision: 1, refs: [ref] });
  let row = { id: C.id(), revision: 1, data: Model.snapshot(bundle, plan, output), updated_at: post.updatedAt };
  let state = { revision: 1, binding: { userId: C.id(), projectUrl: 'https://synthetic.example.org' }, enabled: true, remoteId: row.id, remoteRevision: 1,
    head: copy(row), mapping: null, output: copy(output), pending: null, conflict: null, localClaim: { postId: post.id, claimId: output.claimId }, error: null };
  const owner = copy(state.binding), stats = { writes: [], installs: [], reads: 0, blogReads: 0, saved: false };
  const auth = { epoch: 1, getAccount: () => owner, verify: async () => ({ id: owner.userId }) };
  const storage = { account: owner,
    async readMaterialContinuityState() { return copy(state); },
    async writeMaterialContinuityState(ws, id, input, base) {
      if (base !== (state?.revision || 0)) throw fault('material_continuity_conflict');
      state = { ...copy(input), revision: base + 1 }; return copy(state);
    },
    async readMaterialContinuitySnapshot(ws, id, options = {}) {
      const data = Model.snapshot(bundle, plan, options.output === undefined ? state?.output || null : options.output);
      const result = { data, fingerprint: await Model.fingerprint(data), state: copy(state), post: copy(post), refs: [copy(ref)], plan: copy(plan), localRevision: 1 };
      if (stats.saved && stats.mutateAfterSavedSnapshot && options.output === undefined) {
        stats.mutateAfterSavedSnapshot = false; plan.question = 'UNREVIEWED_PRIVATE_QUESTION';
      }
      return result;
    },
    async findMaterialContinuity() { return { workspaceId: bundle.workspaceId, planId: plan.id }; },
    async readBlogSyncState() { return copy(stats.existingBlogState || null); },
    async finishMaterialContinuityClaim(ws, id, revision) {
      assert.equal(ws, bundle.workspaceId); assert.equal(id, plan.id); assert.equal(revision, 1);
      stats.seedCalls = (stats.seedCalls || 0) + 1;
      return { postId: post.id, revision: post.revision, planRevision: 1, created: false };
    },
    async installMaterialContinuity(value, options) { stats.installs.push({ row: copy(value), options: copy(options) }); return { workspaceId: bundle.workspaceId, planId: plan.id }; }
  };
  const remote = {
    async read() { stats.reads++; if (stats.holdRead) { const hold = stats.holdRead; stats.holdRead = null; hold.started.resolve(); await hold.release.promise; } return copy(row); },
    async write(request) {
      stats.writes.push(copy(request));
      if (stats.historicalAck) return copy(stats.historicalAck);
      if (request.expectedRevision !== (row?.revision || 0)) return { status: 'conflict', revision: row.revision };
      row = { id: request.remoteId, updated_at: post.updatedAt, ...row, data: copy(request.data), revision: (row?.revision || 0) + 1 }; return { status: 'stored', revision: row.revision };
    }
  };
  const blogRemote = {
    async read() { stats.blogReads++; const data = Blog.pack(post); if (stats.changedBlogManifest) data.title = '다른 기기의 본문'; return { id: post.id, workspace_id: bundle.workspaceId,
      revision: stats.advancedBlogHead ? 2 : 1, data, assets: Object.fromEntries(post.photos.map(photo => [photo.id, { path: photo.id }])), publication: null }; },
    async downloadAsset(asset) { if (stats.holdPhoto) { stats.holdPhoto.started.resolve(); await stats.holdPhoto.release.promise; } return post.photos.find(photo => photo.id === asset.path).blob; }
  };
  const blogSync = { async save() { stats.saved = true; return { status: 'synced', remoteId: post.id, remoteRevision: 1 }; } };
  const manager = Service.create({ storage, auth, model: Model, remote, blogSync, blogRemote, blog: Blog, photoPost: Photo, makeId: C.id });
  return { manager, stats, plan, post, bundle, ref, auth, remote, state: () => state, row: () => row,
    setRow(value) { row = value; }, setPending(value) { state.pending = value; }, disconnect() { state = null; row = null; } };
}
test('pausing an existing preparation during original-photo receive cancels the install', async () => {
  const f = await fixture({ savedOutput: true, photos: true }), held = { started: deferred(), release: deferred() }; f.stats.holdPhoto = held;
  const receiving = f.manager.receive(f.row().id, 1), rejected = assert.rejects(receiving, { code: 'request_cancelled' });
  await held.started.promise; await f.manager.pause(f.bundle.workspaceId, f.plan.id); held.release.resolve(); await rejected;
  assert.equal(f.stats.installs.length, 0); assert.equal(f.state().enabled, false); f.manager.dispose();
});
test('a replayed historical preparation ACK cannot establish a newer, different remote head', async () => {
  const f = await fixture(), pendingData = copy(f.row().data); pendingData.plan.question = '이전 승인 전송';
  f.setPending({ operationId: C.id(), expectedRevision: 1, data: pendingData, fingerprint: await Model.fingerprint(pendingData) });
  const advanced = copy(f.row()); advanced.revision = 3; advanced.data.plan.question = '다른 기기의 더 최신 질문'; f.setRow(advanced);
  f.stats.historicalAck = { status: 'stored', revision: 2 };
  const result = await f.manager.sync(f.bundle.workspaceId, f.plan.id);
  assert.equal(result.status, 'conflict'); assert.equal(f.state().remoteRevision, 1); assert.equal(f.state().head.revision, 1);
  assert.equal(f.state().conflict.row.revision, 3); assert.equal(f.state().pending.fingerprint, await Model.fingerprint(pendingData));
  assert.equal(f.plan.question, '검토한 비공개 질문'); assert.equal(f.stats.installs.length, 0); f.manager.dispose();
});
test('a private preparation edit between review snapshots requires fresh consent and is never added to the saved-output upload', async () => {
  const f = await fixture(), preview = await f.manager.preview(f.bundle.workspaceId, f.plan.id); f.stats.mutateAfterSavedSnapshot = true;
  await assert.rejects(f.manager.shareOutput(f.bundle.workspaceId, f.plan.id, preview.fingerprint), { code: 'material_review_required' });
  assert.equal(f.plan.question, 'UNREVIEWED_PRIVATE_QUESTION'); assert.equal(f.stats.writes.length, 0); assert.equal(f.state().output.state, 'writing'); f.manager.dispose();
});
test('saved-output linkage verifies the current blog revision and exact manifest after a historical blog ACK', async () => {
  for (const change of ['advancedBlogHead', 'changedBlogManifest']) {
    const f = await fixture(), preview = await f.manager.preview(f.bundle.workspaceId, f.plan.id); f.stats[change] = true;
    await assert.rejects(f.manager.shareOutput(f.bundle.workspaceId, f.plan.id, preview.fingerprint), { code: 'material_output_changed' });
    assert.equal(f.stats.blogReads, 1); assert.equal(f.stats.writes.length, 0); assert.equal(f.state().output.state, 'writing'); f.manager.dispose();
  }
});
test('a connect queued before pause cannot later re-enable the paused preparation', async () => {
  const f = await fixture(), preview = await f.manager.preview(f.bundle.workspaceId, f.plan.id), held = { started: deferred(), release: deferred() }; f.stats.holdRead = held;
  const active = f.manager.sync(f.bundle.workspaceId, f.plan.id), activeRejected = assert.rejects(active, { code: 'request_cancelled' });
  await held.started.promise;
  const queued = f.manager.connect(f.bundle.workspaceId, f.plan.id, preview.fingerprint), queuedRejected = assert.rejects(queued, { code: 'request_cancelled' });
  await f.manager.pause(f.bundle.workspaceId, f.plan.id); held.release.resolve(); await Promise.all([activeRejected, queuedRejected]);
  assert.equal(f.state().enabled, false); assert.equal(f.stats.reads, 1); assert.equal(f.stats.writes.length, 0); f.manager.dispose();
});
test('connecting an existing saved replacement preserves its earlier blog identity and resumes the same local article', async () => {
  const f = await fixture(), remotePostId = C.id(); f.disconnect();
  f.stats.existingBlogState = { remoteId: remotePostId, remoteRevision: 4, enabled: true };
  const preview = await f.manager.preview(f.bundle.workspaceId, f.plan.id), original = copy(f.post);
  const result = await f.manager.connect(f.bundle.workspaceId, f.plan.id, preview.fingerprint);
  assert.equal(result.output.postId, remotePostId); assert.equal(f.row().data.output.postId, remotePostId);
  assert.equal(f.state().localClaim.postId, remotePostId); assert.equal(f.stats.seedCalls, 1);
  assert.equal(f.plan.output.postId, original.id); assert.deepEqual(f.post, original); assert.equal(f.stats.installs.length, 0);
  f.manager.dispose();
});
test('a compare waiting for the server keeps the displayed article and approval stamp together; a newer local article cannot be resolved unseen', async () => {
  const f = await fixture(); f.post.revision = 4;
  const reviewed = await f.manager.preview(f.bundle.workspaceId, f.plan.id), displayed = Blog.pack(f.post);
  const held = { started: deferred(), release: deferred() }; f.stats.holdRead = held;
  const comparing = f.manager.compare(f.bundle.workspaceId, f.plan.id);
  await held.started.promise;
  f.post.revision = 5; f.post.ops.push({ insert: '검토 화면에 아직 보이지 않은 새 문단\n' });
  held.release.resolve(); const comparison = await comparing;
  assert.deepEqual(comparison.local.post, displayed); assert.equal(comparison.local.post.revision, 4);
  assert.equal(comparison.expected.reviewFingerprint, reviewed.fingerprint);
  assert.notEqual(comparison.expected.reviewFingerprint, (await f.manager.preview(f.bundle.workspaceId, f.plan.id)).fingerprint);
  await assert.rejects(f.manager.resolve(f.bundle.workspaceId, f.plan.id, 'remote', comparison.expected), { code: 'material_review_required' });
  assert.equal(f.stats.installs.length, 0); assert.equal(f.post.revision, 5);
  assert(f.post.ops.some(op => typeof op.insert === 'string' && op.insert.includes('보이지 않은 새 문단'))); f.manager.dispose();
});

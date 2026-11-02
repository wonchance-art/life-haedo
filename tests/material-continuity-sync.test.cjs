'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../assets/life/core.js'), M = require('../assets/life/material-writing.js');
const R = require('../assets/life/source-reference.js'), Model = require('../assets/life/material-continuity.js');
const Blog = require('../assets/life/blog.js'), Photo = require('../assets/life/photo-post.js');
const Service = require(process.env.MATERIAL_CONTINUITY_SYNC_MODULE || '../assets/life/material-continuity-sync.js');
const copy = value => structuredClone(value), fault = code => Object.assign(Error(code), { code });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function fixture({ savedOutput = false, photos = false, pageBlogSync = false } = {}) {
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
  const auth = { epoch: 1, user: { id: owner.userId }, getAccount: () => owner, verify: async () => { throw new Error('background steps must not verify per call'); } };
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
    async findMaterialContinuity() { return stats.unlinked ? null : { workspaceId: bundle.workspaceId, planId: plan.id }; },
    async forgetMaterialContinuity(ws, id, options) { stats.forgot = copy(options); assert.equal(options.expectedRevision, state.revision); state = null; stats.onForget?.(); return { removed: !!options.removePlan }; },
    async listMaterialContinuityOrphans() { return stats.orphan ? [copy(stats.orphan)] : []; },
    async listWorkspaces() { return [{ workspaceId: bundle.workspaceId }]; },
    async readMaterialWriting() { return { ...M.empty(bundle.workspaceId), revision: 1, plans: stats.planAbsent ? [] : [copy(plan)] }; },
    async adoptMaterialContinuity(value, options) { stats.adopted = { row: copy(value), options: copy(options) }; return { workspaceId: value.data.bundle.workspaceId, planId: value.data.plan.id, adopted: true }; },
    async readBlogSyncState() { return copy(stats.existingBlogState || null); },
    async finishMaterialContinuityClaim(ws, id, revision) {
      assert.equal(ws, bundle.workspaceId); assert.equal(id, plan.id); assert.equal(revision, 1);
      stats.seedCalls = (stats.seedCalls || 0) + 1;
      return { postId: post.id, revision: post.revision, planRevision: 1, created: false };
    },
    async installMaterialContinuity(value, options) {
      stats.installs.push({ row: copy(value), options: copy(options) });
      // Like the real transaction, a resolved conflict advances the link to the server head.
      if (options?.target && (options.preserveLocal || options.preserveRemote)) state = { ...state, revision: state.revision + 1, remoteRevision: value.revision, head: copy(value), output: copy(value.data.output), pending: null, conflict: null, error: null };
      return { workspaceId: bundle.workspaceId, planId: plan.id };
    }
  };
  const remote = {
    async list() { stats.lists = (stats.lists || 0) + 1; return { items: row ? [{ id: row.id, revision: row.revision, title: '', updated_at: row.updated_at }] : [], next: null }; },
    async remove(request) { stats.removed = copy(request); return { status: stats.removeStatus || 'deleted', revision: request.expectedRevision + 1 }; },
    async read() { stats.reads++; if (stats.deletedRemote) return { id: row.id, revision: row.revision + 1, deleted: true, data: null, updated_at: row.updated_at }; if (stats.holdRead) { const hold = stats.holdRead; stats.holdRead = null; hold.started.resolve(); await hold.release.promise; } return copy(row); },
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
  const blogSync = { async save() { stats.saved = true; stats.existingBlogState ||= { remoteId: post.id, remoteRevision: 1, localRevision: post.revision, enabled: true }; return { status: 'synced', remoteId: post.id, remoteRevision: 1 }; } };
  // pageBlogSync: no injected instance; the engine resolves the page's BlogSync itself.
  const manager = Service.create({ storage, auth, model: Model, remote, ...(pageBlogSync ? {} : { blogSync }), blogRemote, blog: Blog, photoPost: Photo, makeId: C.id });
  return { manager, stats, storage, blogSync, plan, post, bundle, ref, auth, remote, state: () => state, row: () => row,
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
test('the saved-output share stores its post through the page automatic BlogSync queue, never through a second instance', async () => {
  // A second instance races the editor's in-flight save of the same post on the binding CAS; its
  // blog_state_conflict left the other device without the finished post until a later pass.
  const life = globalThis.HaedoLife ||= {}, prior = life.BlogSync; let created = 0;
  try {
    let f = null; const shared = [];
    life.BlogSync = {
      forStorage: storage => f && storage === f.storage ? { save: (...args) => { shared.push(args[1]); return f.blogSync.save(...args); }, dispose() { throw new Error('the page BlogSync is shared and must never be disposed by material continuity'); } } : null,
      create() { created++; return { async save() { throw fault('blog_state_conflict'); }, dispose() {} }; }
    };
    f = await fixture({ pageBlogSync: true });
    await f.manager.autoSync(f.bundle.workspaceId, f.plan.id);
    assert.deepEqual(shared, [f.post.id]); assert.equal(created, 0, 'no private BlogSync while the page has one');
    assert.equal(f.row().data.output.state, 'saved'); assert.equal(f.row().data.output.revision, 1); assert.equal(f.state().error, null);
    f.manager.dispose();
    // Without an automatic instance for this storage (e.g. a non-account page) a private one is used.
    let g = null, ownDisposed = 0; life.BlogSync = { forStorage: () => null, create() { created++; return { save: (...args) => g.blogSync.save(...args), dispose() { ownDisposed++; } }; } }; g = await fixture({ pageBlogSync: true });
    await g.manager.autoSync(g.bundle.workspaceId, g.plan.id);
    assert.equal(created, 1); assert.equal(g.row().data.output.state, 'saved'); g.manager.dispose(); assert.equal(ownDisposed, 1, 'the private BlogSync is disposed with the manager');
  } finally { if (prior === undefined) delete life.BlogSync; else life.BlogSync = prior; }
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

async function conflicted(f, { localTime, remoteTime }) {
  f.plan.question = '이 기기에서 고친 질문'; f.plan.updatedAt = localTime;
  const advanced = copy(f.row()); advanced.revision = 2; advanced.data.plan.question = '다른 기기에서 고친 질문'; advanced.data.plan.updatedAt = remoteTime; f.setRow(advanced);
}
test('automatic sync keeps the newer server preparation and installs it with the local side kept as a recovery copy', async () => {
  const f = await fixture(); await conflicted(f, { localTime: '2099-01-01T00:00:00.000Z', remoteTime: '2099-01-02T00:00:00.000Z' });
  const result = await f.manager.autoSync(f.bundle.workspaceId, f.plan.id);
  assert.equal(result.resolved, 'remote'); assert.equal(f.stats.installs.length, 1);
  assert.equal(f.stats.installs[0].options.preserveLocal, true); assert.equal(f.stats.installs[0].row.data.plan.question, '다른 기기에서 고친 질문');
  assert.deepEqual(f.stats.writes, []);
  const state = await f.manager.getState(f.bundle.workspaceId, f.plan.id); assert.equal(state.notice.choice, 'remote');
  f.manager.dismissNotice(f.bundle.workspaceId, f.plan.id); assert.equal((await f.manager.getState(f.bundle.workspaceId, f.plan.id)).notice, null);
  f.manager.dispose();
});
test('automatic sync keeps a newer local preparation, stores the server side as a recovery copy and uploads the local plan', async () => {
  const f = await fixture(); await conflicted(f, { localTime: '2099-01-03T00:00:00.000Z', remoteTime: '2099-01-02T00:00:00.000Z' });
  const result = await f.manager.autoSync(f.bundle.workspaceId, f.plan.id);
  assert.equal(result.resolved, 'local'); assert.equal(f.stats.installs[0].options.preserveRemote, true);
  assert.equal(f.stats.writes.at(-1).data.plan.question, '이 기기에서 고친 질문'); assert.equal(f.stats.writes.at(-1).expectedRevision, 2);
  f.manager.dispose();
});
test('automatic sync uploads a changed preparation without a consent step and leaves an unchanged one to a read-only check', async () => {
  const f = await fixture(); f.plan.question = '자동으로 보낼 질문';
  await f.manager.autoSync(f.bundle.workspaceId, f.plan.id);
  // The changed plan goes first; the already saved post claimed on this device follows with its exact revision.
  assert.equal(f.stats.writes.length, 2); assert.equal(f.stats.writes[0].data.plan.question, '자동으로 보낼 질문');
  assert.equal(f.stats.writes[1].data.output.state, 'saved'); assert.equal(f.stats.writes[1].data.output.revision, 1); assert.equal(f.stats.saved, true);
  const writes = f.stats.writes.length; await f.manager.autoSync(f.bundle.workspaceId, f.plan.id);
  assert.equal(f.stats.writes.length, writes); assert.equal(f.stats.installs.length, 0); f.manager.dispose();
});
test('a server preparation missing on this device is adopted into the same workspace and preparation ID', async () => {
  const f = await fixture(); f.stats.unlinked = true; f.stats.planAbsent = true;
  const result = await f.manager.adopt({ id: f.row().id, revision: 1 });
  assert.equal(result.adopted, true); assert.equal(f.stats.adopted.row.data.plan.id, f.plan.id);
  assert.equal(f.stats.adopted.row.data.bundle.workspaceId, f.bundle.workspaceId); assert.deepEqual(f.stats.installs, []);
  f.stats.unlinked = false; assert.equal(await f.manager.adopt({ id: f.row().id, revision: 1 }), null); f.manager.dispose();
});
test('the background loop syncs every preparation, adopts server-only ones and skips a workspace with unsaved editor input', async () => {
  const ws = C.id(), plans = [{ id: 'p1' }, { id: 'p2' }], calls = [];
  const manager = { autoSync: async (w, id) => { calls.push(['auto', w, id]); return {}; }, list: async () => ({ items: [{ id: 'r1', revision: 1 }], next: null }),
    adopt: async item => { calls.push(['adopt', item.id]); return null; }, dispose() {} };
  const storage = { account: { userId: 'u', projectUrl: 'p' }, readMaterialWriting: async () => ({ plans }), adoptMaterialContinuity() {},
    listAccountLibraries: async () => [{ workspaceId: ws, eligible: true }, { workspaceId: 'recovery', eligible: false }] };
  const loop = Service.automatic({ storage, auth: {}, manager, every: 3600000 });
  await loop.refresh();
  assert.deepEqual(calls, [['auto', ws, 'p1'], ['auto', ws, 'p2'], ['adopt', 'r1']]);
  calls.length = 0; let dirty = true; const unwatch = Service.watch(ws, { busy: () => dirty });
  // The server-only item that could not be installed is not fetched again at the same revision.
  await loop.refresh(); assert.deepEqual(calls, []);
  dirty = false; unwatch(); calls.length = 0; await loop.refresh(); assert.equal(calls.filter(call => call[0] === 'auto').length, 2);
  loop.dispose();
});
test('latest plan edit wins and an unknown local time yields to the server copy', () => {
  assert.equal(Service.latest({ plan: { updatedAt: '2099-01-02T00:00:00.000Z' } }, { plan: { updatedAt: '2099-01-01T00:00:00.000Z' } }), 'local');
  assert.equal(Service.latest({ plan: { updatedAt: '2099-01-01T00:00:00.000Z' } }, { plan: { updatedAt: '2099-01-01T00:00:00.000Z' } }), 'remote');
  assert.equal(Service.latest({ plan: {} }, { plan: { updatedAt: '2099-01-01T00:00:00.000Z' } }), 'remote');
});

test('a preparation deleted on another device is removed here when this device has nothing unsent', async () => {
  const f = await fixture(); f.stats.deletedRemote = true;
  const result = await f.manager.autoSync(f.bundle.workspaceId, f.plan.id);
  assert.equal(result.deleted, true); assert.equal(f.stats.forgot.removePlan, true); assert.ok(f.stats.forgot.expectedFingerprint);
  assert.deepEqual(f.stats.writes, []); f.manager.dispose();
});
test('a preparation deleted elsewhere but edited here is kept and recreated on the server under a new link', async () => {
  const f = await fixture(); f.stats.deletedRemote = true; f.plan.question = '삭제 전에 이 기기에서 고친 질문';
  // The single-row fake server: the recreated preparation is a new, empty server id.
  f.stats.onForget = () => { f.stats.deletedRemote = false; f.setRow(null); };
  const result = await f.manager.autoSync(f.bundle.workspaceId, f.plan.id);
  assert.equal(result.recreated, true); assert.equal(f.stats.forgot.removePlan, undefined);
  const sent = f.stats.writes.find(write => write.data.plan.question === '삭제 전에 이 기기에서 고친 질문');
  assert.ok(sent); assert.equal(sent.expectedRevision, 0); f.manager.dispose();
});
test('a preparation deleted on this device deletes its server head with compare-and-delete and drops only the link', async () => {
  const f = await fixture(); f.stats.orphan = { planId: f.plan.id, remoteId: f.row().id, revision: 1, remoteRevision: 1 };
  const result = await f.manager.propagateDelete(f.bundle.workspaceId, f.plan.id);
  assert.equal(result.status, 'deleted'); assert.equal(f.stats.removed.remoteId, f.row().id); assert.equal(f.stats.removed.expectedRevision, 1);
  assert.deepEqual(f.stats.forgot, { expectedRevision: 1 }); f.manager.dispose();
});
test('a missing server schema is recorded as unavailable and not retried every cycle', async () => {
  let lists = 0; const manager = { list: async () => { lists++; throw Object.assign(Error('missing'), { code: 'schema_missing' }); }, autoSync: async () => { throw Error('must not run'); }, dispose() {} };
  const storage = { account: { userId: 'u', projectUrl: 'p' }, readMaterialWriting: async () => ({ plans: [{ id: 'p1' }] }), adoptMaterialContinuity() {}, listAccountLibraries: async () => [{ workspaceId: 'w', eligible: true }] };
  const loop = Service.automatic({ storage, auth: {}, manager, every: 3600000 });
  await loop.refresh(); await loop.refresh(); await loop.refresh();
  assert.equal(lists, 1); assert.equal(loop.availability().status, 'unavailable'); assert.ok(loop.availability().until > Date.now());
  loop.dispose();
});

test('unchanged linked preparations cost one list call per cycle and no body reads', async () => {
  // A preparation whose completed post is already stored at its exact revision: nothing is due.
  const f = await fixture({ savedOutput: true }); f.stats.existingBlogState = { remoteId: f.post.id, remoteRevision: 1, localRevision: f.post.revision, enabled: true };
  const storage = { account: f.manager && { userId: 'u' }, readMaterialWriting: async () => ({ plans: [{ id: f.plan.id }] }), adoptMaterialContinuity() {},
    listWorkspaces: async () => [{ workspaceId: f.bundle.workspaceId }], listMaterialContinuityOrphans: async () => [] };
  const loop = Service.automatic({ storage, auth: {}, manager: f.manager, every: 3600000 });
  for (let cycle = 1; cycle <= 3; cycle++) {
    await loop.refresh();
    assert.equal(f.stats.lists, cycle, 'one list per cycle'); assert.equal(f.stats.reads, 0, 'no preparation body read'); assert.deepEqual(f.stats.writes, []);
  }
  const advanced = copy(f.row()); advanced.revision = 2; advanced.data.plan.question = '다른 기기에서 바뀐 질문'; f.setRow(advanced);
  await loop.refresh(); assert.equal(f.stats.reads, 1, 'only the preparation whose listed revision moved is read');
  loop.dispose(); f.manager.dispose();
});

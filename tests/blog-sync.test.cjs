'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Remote = require('../assets/life/blog-remote.js'), Sync = require('../assets/life/blog-sync.js'), Blog = require('../assets/life/blog.js'), Photo = require('../assets/life/photo-post.js'), Core = require('../assets/life/core.js');
const UID = Core.id(), WS = Core.id(), OTHER = Core.id(), PROJECT = 'https://blog-test.supabase.co';
const copy = value => structuredClone(value), fault = code => Object.assign(Error(code), { code });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
test('a reserved preparation identity starts only on explicit saved transfer and keeps its canonical server identity', async () => {
  const f = await fixture(), remoteId = Core.id();
  try {
    f.states.set(f.d.id, { revision: 1, enabled: false, enableOnSave: true, remoteId, remoteWorkspaceId: OTHER,
      remoteRevision: 0, localRevision: 0, remoteManifest: null, pending: null, conflict: null, publication: null, status: 'paused', error: null });
    assert.equal((await f.manager.getState(WS, f.d.id)).status, 'pending');
    f.posts.get(f.d.id).status = 'draft';
    await assert.rejects(f.manager.saveDefault(WS, f.d.id, { expectedLocalRevision: 1 }), { code: 'invalid_request' });
    assert.equal(f.stats.saves.length, 0); assert.equal(f.stats.uploads, 0); assert.equal(f.states.get(f.d.id).enabled, false);
    f.posts.get(f.d.id).status = 'saved';
    const stored = await f.manager.saveDefault(WS, f.d.id, { expectedLocalRevision: 1 });
    assert.equal(stored.status, 'synced'); assert.equal(stored.enableOnSave, false);
    assert.equal(stored.remoteId, remoteId); assert.equal(f.stats.saves[0].postId, remoteId);
    assert.equal(f.stats.saves[0].workspaceId, OTHER); assert.equal(f.stats.saves[0].data.id, remoteId);
    assert.equal(f.stats.uploads, 2); assert.equal(f.stats.publishes.length, 0);
  } finally { f.manager.dispose(); }
});
test('an explicit pause clears the initial preparation reservation and default save never resumes it', async () => {
  const f = await fixture();
  try {
    f.states.set(f.d.id, { revision: 1, enabled: false, enableOnSave: true, remoteId: f.d.id, remoteWorkspaceId: WS,
      remoteRevision: 0, localRevision: 0, pending: null, conflict: null, publication: null, status: 'paused', error: null });
    await f.manager.pause(WS, f.d.id);
    const before = copy(f.states.get(f.d.id));
    assert.equal(before.enableOnSave, false);
    const result = await f.manager.saveDefault(WS, f.d.id, { expectedLocalRevision: 1 });
    assert.equal(result.status, 'paused'); assert.deepEqual(f.states.get(f.d.id), before);
    assert.equal(f.stats.saves.length, 0); assert.equal(f.stats.uploads, 0);
  } finally { f.manager.dispose(); }
});
async function fixture(count = 2, shared = null) {
  const d = Photo.create(Core.id); d.status = 'saved'; d.revision = 1; d.title = '여행 기록'; d.ops = [{ insert: '출발한 날 🌿\n' }];
  for (let n = 0; n < count; n++) {
    const blob = new Blob([new Uint8Array([137,80,78,71,13,10,26,10,n])], { type: 'image/png' });
    const photo = { id: Core.id(), name: '익명 사진.png', type: blob.type, width: 1, height: 1, size: blob.size, digest: await Photo.digest(blob), blob };
    d.photos.push(photo); d.ops.push({ insert: { photo: { id: photo.id, caption: '사진 설명 ' + n, alt: '' } } }, { insert: '\n' });
  }
  const posts = new Map(shared ? [] : [[d.id, copy(d)]]), states = new Map(), rows = shared?.rows || new Map(), assets = shared?.assets || new Map(), receipts = shared?.receipts || new Map(), publicReceipts = shared?.publicReceipts || new Map();
  const stats = shared?.stats || { uploads: 0, saves: [], prepares: 0, publishes: [], failPhoto: null, loseSave: false, failInstall: false };
  const auth = { ready: true, epoch: 0, user: { id: UID }, getAccount() { return { projectUrl: PROJECT, userId: auth.user.id }; }, async verify() { return auth.user; } };
  const storage = { account: { projectUrl: PROJECT, userId: UID }, async read() { return { workspaceId: WS }; },
    async readPhotoPost(ws, id) { if (!posts.has(id)) throw fault('photo_post_missing'); return copy(posts.get(id)); },
    async savePhotoPost(ws, value, base) { if (stats.failInstall) throw fault('storage_quota'); if (posts.has(value.id) || base !== 0) throw fault('photo_post_conflict'); const next = { ...copy(value), revision: 1 }; posts.set(next.id, next); return copy(next); },
    async readBlogSyncState(ws, id) { return copy(states.get(id) || null); },
    async writeBlogSyncState(ws, id, input, base) { if ((states.get(id)?.revision || 0) !== base) throw fault('blog_sync_conflict'); const next = { ...copy(input), revision: base + 1 }; states.set(id, next); return copy(next); },
    async listBlogCopies() { return [...states].map(([id, state]) => { const post = posts.get(id); return {
      localPostId: id, remoteId: state.remoteId, revision: post?.revision || 0, remoteRevision: state.remoteRevision,
      status: !post ? 'error' : state.conflict ? 'conflict' : state.error ? 'error' : !state.enabled ? 'paused' : state.pending || state.localRevision !== post.revision ? 'local_pending' : 'received', archived: post?.archived === true
    }; }); },
    async installReceivedBlogPost(ws, post, state) {
      const existing = [...states].filter(([,value]) => value.remoteId === state.remoteId);
      if (existing.length > 1) throw fault('blog_copy_selection_required');
      if (existing.length) return { post: copy(posts.get(existing[0][0])), received: false };
      if (stats.failInstall) throw fault('storage_quota');
      const saved = { ...copy(post), revision: 1 }; posts.set(saved.id, saved); states.set(saved.id, { ...copy(state), revision: 1, localRevision: 1 });
      return { post: copy(saved), received: true };
    }
  };
  const remote = {
    async list() { return [...rows.values()].map(row => ({ id: row.id, title: row.data.title, workspace_id: row.workspace_id, revision: row.revision })); },
    async read(id) { return copy(rows.get(id) || null); },
    async prepareAsset(id, photo) { const path = id + '/' + photo.id + '/' + photo.digest; return { bucket: 'haedo-blog-originals', path, exists: assets.has(path) }; },
    async uploadAsset(id, photo, blob) { stats.prepares++; if (stats.holdPhoto) await stats.holdPhoto.promise;
      if (stats.failPhoto === photo.id) throw fault('network_error'); const path = id + '/' + photo.id + '/' + photo.digest;
      if (!assets.has(path)) { assets.set(path, blob); stats.uploads++; } return { bucket: 'haedo-blog-originals', path, exists: true }; },
    async downloadAsset(asset) { if (!assets.has(asset.path)) throw fault('remote_missing'); return assets.get(asset.path); },
    async save(request) { stats.saves.push(copy(request)); const prior = receipts.get(request.operationId);
      if (prior) { assert.deepEqual(request, prior.request); return copy(prior.result); }
      const existing = rows.get(request.postId); if ((existing?.revision || 0) !== request.expectedRevision) return { status: 'conflict', revision: existing.revision };
      const revision = request.expectedRevision + 1, mapping = {};
      for (const photo of request.data.photos) { const path = request.postId + '/' + photo.id + '/' + photo.digest; assert(assets.has(path)); mapping[photo.id] = { bucket: 'haedo-blog-originals', path }; }
      const result = { status: 'stored', revision };
      rows.set(request.postId, { id: request.postId, workspace_id: request.workspaceId, revision, data: copy(request.data), assets: mapping, publication: existing?.publication || null, updated_at: request.data.updatedAt });
      receipts.set(request.operationId, { request: copy(request), result }); if (stats.loseSave) { stats.loseSave = false; throw fault('network_error'); } return result;
    },
    async publish(id, revision, operation, options) { stats.publishes.push({ id, revision, operation, options: copy(options) }); const row = rows.get(id);
      if (publicReceipts.has(operation)) return copy(publicReceipts.get(operation));
      if (row.revision !== revision || (row.publication?.revision || 0) !== options.expectedPublicRevision) throw fault('blog_conflict');
      if (options.photoIds.some(id => !row.data.photos.some(photo => photo.id === id))) throw fault('invalid_request');
      row.publication = { token: row.publication?.token || Core.id(), blogToken: WS, revision: options.expectedPublicRevision + 1, active: true };
      const result = { status: 'published', ...row.publication }; publicReceipts.set(operation, copy(result));
      if (stats.losePublish) { stats.losePublish = false; throw fault('network_error'); } return result;
    },
    async unpublish(id, revision) { const row = rows.get(id); if (row.publication.revision !== revision) throw fault('blog_conflict'); row.publication = { ...row.publication, revision: revision + 1, active: false }; return { status: 'unpublished', revision: revision + 1 }; }, dispose() {}
  };
  const manager = Sync.create({ storage, auth, blog: Blog, photoPost: Photo, remote, makeId: Core.id });
  return { d, posts, states, rows, assets, receipts, publicReceipts, stats, auth, storage, remote, manager };
}
// Saved edits use a new local ID and retain the original remote identity, as
// Storage.savePhotoPost's replacement transaction does. Devices share no local
// documents, metadata or authentication epoch; only the synthetic server is shared.
function savedEdit(device, id, title) {
  const original = device.posts.get(id), edited = { ...copy(original), id: Core.id(), revision: 1, title, updatedAt: new Date(Date.parse(original.updatedAt) + 1000).toISOString() };
  device.posts.delete(id); device.posts.set(edited.id, edited);
  const prior = device.states.get(id);
  if (prior) {
    const next = { ...copy(prior), revision: 1, localRevision: 0, publishPending: null, unpublishPending: null, status: prior.enabled ? 'pending' : 'paused' };
    if (next.pending) next.pending.localRevision = 0;
    device.states.delete(id); device.states.set(edited.id, next);
  }
  return edited;
}
test('selected saved post uploads exact originals before one CAS document commit and never edits local data', async () => {
  const f = await fixture(), before = copy(f.d); const state = await f.manager.connect(WS, f.d.id);
  assert.equal(state.status, 'synced'); assert.equal(f.stats.uploads, 2); assert.equal(f.stats.saves.length, 1); assert.deepEqual(f.posts.get(f.d.id), before);
  assert.equal(f.rows.size, 1); assert.equal(f.states.size, 1); assert.equal(f.rows.get(f.d.id).data.photos.some(p => p.blob), false);
  await f.manager.sync(WS, f.d.id); assert.equal(f.stats.saves.length, 1); assert.equal(f.stats.uploads, 2); f.manager.dispose();
});

test('default private storage accepts saved text and original photos without publishing or editing the local document', async () => {
  for (const count of [0, 2]) {
    const f = await fixture(count), before = copy(f.d);
    const result = await f.manager.saveDefault(WS, f.d.id, { expectedLocalRevision: f.d.revision });
    assert.equal(result.status, 'synced'); assert.equal(f.stats.uploads, count); assert.equal(f.stats.saves.length, 1);
    assert.deepEqual(f.rows.get(f.d.id).data, Blog.pack(Photo.compact(before))); assert.deepEqual(f.posts.get(f.d.id), before);
    assert.equal(f.rows.get(f.d.id).publication, null); assert.equal(f.stats.publishes.length, 0);
    await f.manager.saveDefault(WS, f.d.id, { expectedLocalRevision: f.d.revision });
    assert.equal(f.stats.saves.length, 1); assert.equal(f.stats.uploads, count); f.manager.dispose();
  }
});

test('default storage rejects drafts and preserves an explicit pause or conflict without remote access or metadata writes', async () => {
  const draft = await fixture(); draft.posts.get(draft.d.id).status = 'draft';
  await assert.rejects(draft.manager.saveDefault(WS, draft.d.id, { expectedLocalRevision: 1 }), { code: 'invalid_request' });
  assert.equal(draft.states.size, 0); assert.equal(draft.stats.prepares, 0); assert.equal(draft.stats.saves.length, 0); draft.manager.dispose();
  for (const action of ['pause', 'conflict']) {
    const f = await fixture(0); await f.manager.connect(WS, f.d.id);
    if (action === 'pause') await f.manager.pause(WS, f.d.id);
    else {
      const row = f.rows.get(f.d.id); row.revision++; row.data.title = '다른 기기의 글';
      f.posts.get(f.d.id).title = '이 기기의 글'; f.posts.get(f.d.id).revision++;
      assert.equal((await f.manager.sync(WS, f.d.id)).status, 'conflict');
    }
    const state = copy(f.states), posts = copy(f.posts), rows = copy(f.rows), saves = f.stats.saves.length;
    f.auth.verify = async () => { throw Error('paused/conflicted default storage must not verify or transfer'); };
    f.remote.read = async () => { throw Error('paused/conflicted default storage must not read the remote document'); };
    const result = await f.manager.saveDefault(WS, f.d.id, { expectedLocalRevision: 1 });
    assert.equal(result.status, action === 'pause' ? 'paused' : 'conflict');
    assert.deepEqual(f.states, state); assert.deepEqual(f.posts, posts); assert.deepEqual(f.rows, rows);
    assert.equal(f.stats.saves.length, saves); assert.equal(f.stats.publishes.length, 0); f.manager.dispose();
  }
});

test('offline verification leaves a durable default intent visible after reopen and retry stores the same saved originals', async () => {
  const f = await fixture(), before = copy(f.d), verify = f.auth.verify;
  f.auth.verify = async () => { throw fault('network_error'); };
  await assert.rejects(f.manager.saveDefault(WS, f.d.id, { expectedLocalRevision: 1 }), { code: 'network_error' });
  assert.equal(f.stats.prepares, 0); assert.equal(f.stats.saves.length, 0); assert.equal(f.rows.size, 0);
  const persisted = f.states.get(f.d.id); assert.equal(persisted.enabled, true); assert.equal(persisted.error, 'network_error');
  assert.equal(persisted.pending, null); assert.deepEqual(f.posts.get(f.d.id), before); f.manager.dispose();
  const reopened = Sync.create({ storage: f.storage, auth: f.auth, blog: Blog, photoPost: Photo, remote: f.remote, makeId: Core.id });
  assert.equal((await reopened.getState(WS, f.d.id)).status, 'error');
  f.auth.verify = verify; assert.equal((await reopened.saveDefault(WS, f.d.id, { expectedLocalRevision: 1 })).status, 'synced');
  assert.equal(f.stats.uploads, 2); assert.equal(f.rows.size, 1); assert.equal(f.stats.publishes.length, 0); reopened.dispose();
});

test('a saved post changed while default verification awaits cannot upload the newer revision', async () => {
  const f = await fixture(), held = deferred(), started = deferred();
  f.auth.verify = async () => { started.resolve(); await held.promise; return f.auth.user; };
  const pending = f.manager.saveDefault(WS, f.d.id, { expectedLocalRevision: 1 }); await started.promise;
  const changed = f.posts.get(f.d.id); changed.title = '저장 확인 뒤 바뀐 글'; changed.revision++;
  held.resolve(); await assert.rejects(pending, { code: 'local_changed' });
  assert.equal(f.stats.prepares, 0); assert.equal(f.stats.saves.length, 0); assert.equal(f.stats.publishes.length, 0);
  assert.equal(f.posts.get(f.d.id).title, changed.title); assert.equal((await f.manager.getState(WS, f.d.id)).status, 'error'); f.manager.dispose();
});

test('default partial upload and lost acknowledgement replay their durable operations across reopen without duplicating originals', async () => {
  for (const failure of ['photo', 'ack']) {
    const f = await fixture(); if (failure === 'photo') f.stats.failPhoto = f.d.photos[1].id; else f.stats.loseSave = true;
    await assert.rejects(f.manager.saveDefault(WS, f.d.id, { expectedLocalRevision: 1 }), { code: 'network_error' });
    const pending = copy(f.states.get(f.d.id).pending), before = copy(f.posts); assert(pending.operationId);
    f.manager.dispose(); f.stats.failPhoto = null;
    const reopened = Sync.create({ storage: f.storage, auth: f.auth, blog: Blog, photoPost: Photo, remote: f.remote, makeId: Core.id });
    assert.equal((await reopened.saveDefault(WS, f.d.id, { expectedLocalRevision: 1 })).status, 'synced');
    assert.equal(f.rows.size, 1); assert.equal(f.rows.get(f.d.id).revision, 1); assert.equal(f.stats.uploads, 2);
    assert.equal(f.stats.saves.at(-1).operationId, pending.operationId); assert.deepEqual(f.stats.saves.at(-1).data, pending.manifest);
    if (failure === 'ack') assert.deepEqual(f.stats.saves[0], f.stats.saves[1]);
    assert.deepEqual(f.posts, before); assert.equal(f.stats.publishes.length, 0); reopened.dispose();
  }
});

test('default storage acknowledges an older retained operation before storing the newly accepted saved replacement', async () => {
  const f = await fixture(); f.stats.loseSave = true;
  await assert.rejects(f.manager.saveDefault(WS, f.d.id, { expectedLocalRevision: 1 }), { code: 'network_error' });
  const pending = copy(f.states.get(f.d.id).pending), edited = savedEdit(f, f.d.id, '새로 명시 저장한 글');
  const result = await f.manager.saveDefault(WS, edited.id, { expectedLocalRevision: edited.revision });
  assert.equal(result.status, 'synced'); assert.equal(result.localRevision, edited.revision);
  assert.equal(f.stats.saves.length, 3); assert.deepEqual(f.stats.saves[0], f.stats.saves[1]);
  assert.equal(f.stats.saves[1].operationId, pending.operationId); assert.notEqual(f.stats.saves[2].operationId, pending.operationId);
  assert.equal(f.rows.get(f.d.id).revision, 2); assert.equal(f.rows.get(f.d.id).data.title, edited.title);
  assert.deepEqual(f.posts.get(edited.id), edited); assert.equal(f.stats.uploads, 2); assert.equal(f.stats.publishes.length, 0); f.manager.dispose();
});

test('default storage has a bounded accepted revision and never drains a later edit made during upload', async () => {
  const f = await fixture(), held = deferred(), started = deferred(), upload = f.remote.uploadAsset;
  f.remote.uploadAsset = async (...args) => { started.resolve(); await held.promise; return upload(...args); };
  const saving = f.manager.saveDefault(WS, f.d.id, { expectedLocalRevision: 1 }); await started.promise;
  const local = f.posts.get(f.d.id); local.title = '첫 저장 이후의 새 입력'; local.revision++;
  held.resolve(); const result = await saving;
  assert.equal(result.status, 'pending'); assert.equal(result.localRevision, 1); assert.equal(f.stats.saves.length, 1);
  assert.equal(f.rows.get(f.d.id).data.title, f.d.title); assert.equal(f.posts.get(f.d.id).title, local.title);
  assert.equal(f.stats.publishes.length, 0); f.manager.dispose();
});

test('pause or account replacement during a default original transfer prevents a late document commit', async () => {
  for (const action of ['pause', 'account']) {
    const f = await fixture(), held = deferred(), started = deferred(), upload = f.remote.uploadAsset, before = copy(f.posts);
    f.remote.uploadAsset = async (...args) => { started.resolve(); await held.promise; return upload(...args); };
    const pending = f.manager.saveDefault(WS, f.d.id, { expectedLocalRevision: 1 }); await started.promise;
    if (action === 'pause') await f.manager.pause(WS, f.d.id); else { f.auth.epoch++; f.auth.user = { id: OTHER }; }
    held.resolve(); await assert.rejects(pending, { code: 'request_cancelled' });
    assert.equal(f.stats.saves.length, 0); assert.equal(f.stats.publishes.length, 0); assert.deepEqual(f.posts, before);
    if (action === 'pause') {
      const state = copy(f.states);
      assert.equal((await f.manager.saveDefault(WS, f.d.id, { expectedLocalRevision: 1 })).status, 'paused'); assert.deepEqual(f.states, state);
    }
    f.manager.dispose();
  }
});

test('a default save queued before pause keeps its original generation and cannot re-enable the paused transfer', async () => {
  const f = await fixture(), held = deferred(), started = deferred(), upload = f.remote.uploadAsset;
  f.remote.uploadAsset = async (...args) => { started.resolve(); await held.promise; return upload(...args); };
  const first = f.manager.saveDefault(WS, f.d.id, { expectedLocalRevision: 1 }); await started.promise;
  const queued = f.manager.saveDefault(WS, f.d.id, { expectedLocalRevision: 1 });
  const rejected = Promise.all([assert.rejects(first, { code: 'request_cancelled' }), assert.rejects(queued, { code: 'request_cancelled' })]);
  await f.manager.pause(WS, f.d.id); const paused = copy(f.states.get(f.d.id));
  held.resolve(); await rejected;
  assert.deepEqual(f.states.get(f.d.id), paused); assert.equal(f.stats.saves.length, 0); assert.equal(f.stats.publishes.length, 0); f.manager.dispose();
});

test('an explicit reviewed manifest rejects another tab edit during authentication before uploading any original', async () => {
  const f = await fixture(), expectedManifest = Blog.pack(Photo.compact(f.d)), held = deferred(), started = deferred();
  f.auth.verify = async () => { started.resolve(); await held.promise; return { id: UID }; };
  const saving = f.manager.save(WS, f.d.id, { expectedManifest });
  await started.promise; const changed = f.posts.get(f.d.id); changed.title = '검토 뒤 새 비공개 본문'; changed.revision++;
  held.resolve(); await assert.rejects(saving, { code: 'local_changed' });
  assert.equal(f.stats.uploads, 0); assert.equal(f.stats.prepares, 0); assert.equal(f.stats.saves.length, 0);
  f.manager.dispose();
});

test('a post edited during original upload sends only the frozen reviewed content and leaves the newer local post pending', async () => {
  const f = await fixture(), expectedManifest = Blog.pack(Photo.compact(f.d)), held = deferred(), started = deferred();
  const upload = f.remote.uploadAsset; f.remote.uploadAsset = async (...args) => { started.resolve(); await held.promise; return upload(...args); };
  const saving = f.manager.save(WS, f.d.id, { expectedManifest }); await started.promise;
  const changed = f.posts.get(f.d.id); changed.title = 'UNREVIEWED_PRIVATE_TEXT'; changed.revision++;
  held.resolve(); const result = await saving;
  assert.deepEqual(f.rows.get(f.d.id).data, expectedManifest); assert.equal(result.status, 'pending');
  assert.equal(f.posts.get(f.d.id).title, 'UNREVIEWED_PRIVATE_TEXT'); f.manager.dispose();
});

test('reviewing a different post version cannot silently replay a pending original transfer from the older review', async () => {
  const f = await fixture(), first = Blog.pack(Photo.compact(f.d)); f.stats.failPhoto = f.d.photos[0].id;
  await assert.rejects(f.manager.save(WS, f.d.id, { expectedManifest: first }), { code: 'network_error' });
  const operation = f.states.get(f.d.id).pending.operationId, prepared = f.stats.prepares;
  const changed = f.posts.get(f.d.id); changed.title = '새 검토의 다른 본문'; changed.revision++; f.stats.failPhoto = null;
  await assert.rejects(f.manager.save(WS, f.d.id, { expectedManifest: Blog.pack(Photo.compact(changed)) }), { code: 'local_changed' });
  assert.equal(f.states.get(f.d.id).pending.operationId, operation); assert.equal(f.stats.prepares, prepared); assert.equal(f.stats.saves.length, 0);
  f.manager.dispose();
});
test('partial photo failure leaves only private prepared assets and durable request; retry reuses completed originals', async () => {
  const f = await fixture(); f.stats.failPhoto = f.d.photos[1].id;
  await assert.rejects(f.manager.connect(WS, f.d.id), { code: 'network_error' }); assert.equal(f.rows.size, 0); assert.equal(f.stats.uploads, 1);
  const operation = f.states.get(f.d.id).pending.operationId; f.stats.failPhoto = null;
  await f.manager.sync(WS, f.d.id); assert.equal(f.stats.uploads, 2); assert.equal(f.stats.saves[0].operationId, operation); assert.equal((await f.manager.getState(WS, f.d.id)).status, 'synced'); f.manager.dispose();
});
test('a lost CAS response replays the same operation and payload without creating a second revision', async () => {
  const f = await fixture(); f.stats.loseSave = true;
  await assert.rejects(f.manager.connect(WS, f.d.id), { code: 'network_error' }); assert.equal(f.rows.get(f.d.id).revision, 1);
  await f.manager.sync(WS, f.d.id); assert.equal(f.rows.get(f.d.id).revision, 1); assert.deepEqual(f.stats.saves[0], f.stats.saves[1]); assert.equal(f.stats.uploads, 2); f.manager.dispose();
});
test('receive validates every original, then creates an independent atomic local copy with remapped references', async () => {
  const f = await fixture(); await f.manager.connect(WS, f.d.id); const asset = f.rows.get(f.d.id).assets[f.d.photos[0].id], original = f.assets.get(asset.path);
  f.assets.set(asset.path, new Blob(['corrupted'], { type: 'image/png' })); await assert.rejects(f.manager.receive(WS, f.d.id)); assert.equal(f.posts.size, 1);
  f.assets.set(asset.path, original); f.stats.failInstall = true; await assert.rejects(f.manager.receive(WS, f.d.id)); assert.equal(f.posts.size, 1); f.stats.failInstall = false;
  const received = await f.manager.receive(WS, f.d.id); assert.notEqual(received.post.id, f.d.id); assert.notEqual(received.post.photos[0].id, f.d.photos[0].id);
  assert.equal(received.post.ops[1].insert.photo.id, received.post.photos[0].id); assert.equal(await Photo.digest(received.post.photos[0].blob), f.d.photos[0].digest);
  assert.deepEqual(f.posts.get(f.d.id), f.d); await f.manager.sync(WS, received.localPostId); assert.equal(f.stats.saves.length, 2);
  assert.deepEqual(f.rows.get(f.d.id).data.photos.map(photo => photo.id), received.post.photos.map(photo => photo.id)); f.manager.dispose();
});
test('received photos can be published immediately using their remapped IDs, then identical manifests skip further private writes', async () => {
  const f = await fixture(); await f.manager.connect(WS, f.d.id); const original = copy(f.posts.get(f.d.id));
  const received = await f.manager.receive(WS, f.d.id), before = copy(received.post);
  const published = await f.manager.publish(WS, received.localPostId, { photoIds: [received.post.photos[0].id], expectedLocalRevision: received.post.revision, expectedRemoteRevision: 1, expectedPublicRevision: 0 });
  assert.equal(published.active, true); assert.equal(f.stats.saves.length, 2); assert.equal(f.rows.size, 1); assert.equal(f.rows.get(f.d.id).revision, 2);
  assert.deepEqual(f.stats.publishes[0].options.photoIds, [received.post.photos[0].id]); assert.equal(f.stats.publishes[0].revision, 2);
  assert.equal(f.stats.uploads, 4); assert.equal(f.assets.size, 4);
  assert.deepEqual(f.posts.get(received.localPostId), before); assert.deepEqual(f.posts.get(f.d.id), original);
  await f.manager.sync(WS, received.localPostId); assert.equal(f.stats.saves.length, 2); assert.equal(f.stats.uploads, 4);
  f.manager.dispose();
});
test('receiving two identical originals preserves both distinct photo IDs, captions and exact selected publication', async () => {
  const f = await fixture(), first = f.d.photos[0];
  Object.assign(f.d.photos[1], { blob: first.blob, digest: first.digest, size: first.size }); f.posts.set(f.d.id, copy(f.d));
  await f.manager.connect(WS, f.d.id); const received = await f.manager.receive(WS, f.d.id), ids = received.post.photos.map(photo => photo.id);
  assert.notEqual(ids[0], ids[1]); assert.equal(received.post.photos[0].digest, received.post.photos[1].digest);
  await f.manager.publish(WS, received.localPostId, { photoIds: [ids[1]], expectedLocalRevision: 1, expectedRemoteRevision: 1, expectedPublicRevision: 0 });
  const manifest = f.rows.get(f.d.id).data;
  assert.deepEqual(manifest.photos.map(photo => photo.id), ids); assert.deepEqual(manifest.ops.filter(op => op.insert?.photo).map(op => [op.insert.photo.id, op.insert.photo.caption]), [[ids[0], '사진 설명 0'], [ids[1], '사진 설명 1']]);
  assert.deepEqual(f.stats.publishes[0].options.photoIds, [ids[1]]); assert.equal(f.assets.size, 4); f.manager.dispose();
});
test('received photo alignment retains remote CAS conflicts and rejects same-version server mutation before uploading', async () => {
  for (const change of ['same-version', 'new-revision']) {
    const f = await fixture(); await f.manager.connect(WS, f.d.id); const received = await f.manager.receive(WS, f.d.id), before = copy(received.post);
    const row = f.rows.get(f.d.id); row.data.title = '다른 기기의 보존할 원문'; if (change === 'new-revision') row.revision++;
    await assert.rejects(f.manager.publish(WS, received.localPostId, { photoIds: [received.post.photos[0].id], expectedLocalRevision: 1, expectedRemoteRevision: 1, expectedPublicRevision: 0 }), { code: change === 'same-version' ? 'invalid_remote_data' : 'blog_conflict' });
    assert.equal(f.stats.saves.length, 1); assert.equal(f.stats.uploads, 2); assert.equal(f.stats.publishes.length, 0);
    assert.equal(row.data.title, '다른 기기의 보존할 원문'); assert.deepEqual(f.posts.get(received.localPostId), before);
    if (change === 'new-revision') assert.equal(f.states.get(received.localPostId).conflict.remoteRevision, 2);
    f.manager.dispose();
  }
});
test('received photo alignment preserves an intervening remote edit and replays a lost response with the same durable operation', async () => {
  for (const change of ['during-upload', 'lost-response']) {
    const f = await fixture(); await f.manager.connect(WS, f.d.id); const received = await f.manager.receive(WS, f.d.id), before = copy(received.post);
    const options = { photoIds: [received.post.photos[0].id], expectedLocalRevision: 1, expectedRemoteRevision: 1, expectedPublicRevision: 0 };
    if (change === 'during-upload') {
      const entered = deferred(), held = deferred(), upload = f.remote.uploadAsset;
      f.remote.uploadAsset = async (...args) => { entered.resolve(); await held.promise; return upload(...args); };
      const publishing = f.manager.publish(WS, received.localPostId, options); await entered.promise;
      const row = f.rows.get(f.d.id); row.revision++; row.data.title = '전송 중 다른 기기의 변경'; held.resolve();
      await assert.rejects(publishing, { code: 'blog_conflict' });
      assert.equal(row.revision, 2); assert.equal(row.data.title, '전송 중 다른 기기의 변경'); assert.equal(f.stats.publishes.length, 0);
      assert.equal(f.states.get(received.localPostId).conflict.remoteRevision, 2);
    } else {
      f.stats.loseSave = true; await assert.rejects(f.manager.publish(WS, received.localPostId, options), { code: 'network_error' });
      const operation = f.states.get(received.localPostId).pending.operationId;
      await f.manager.publish(WS, received.localPostId, options);
      assert.equal(f.stats.saves.at(-1).operationId, operation); assert.deepEqual(f.stats.saves.at(-1), f.stats.saves.at(-2));
      assert.equal(f.rows.get(f.d.id).revision, 2); assert.equal(f.stats.publishes.length, 1); assert.equal(f.stats.uploads, 4);
    }
    assert.deepEqual(f.posts.get(received.localPostId), before); assert.deepEqual(f.posts.get(f.d.id), f.d); f.manager.dispose();
  }
});
test('CAS conflict changes neither side; choosing local first retains a full remote recovery copy', async () => {
  const f = await fixture(0); await f.manager.connect(WS, f.d.id);
  const row = f.rows.get(f.d.id); row.revision++; row.data.title = '다른 기기의 글';
  const local = f.posts.get(f.d.id); local.revision++; local.title = '이 기기의 글';
  assert.equal((await f.manager.sync(WS, f.d.id)).status, 'conflict'); assert.equal(row.data.title, '다른 기기의 글'); assert.equal(local.title, '이 기기의 글');
  const resolved = await f.manager.resolve(WS, f.d.id, 'local'); assert.equal(f.rows.get(f.d.id).data.title, local.title);
  assert.equal(f.posts.get(resolved.recoveryLocalPostId).title, '다른 기기의 글'); assert.equal(f.states.get(resolved.recoveryLocalPostId).enabled, false); f.manager.dispose();
});
test('pause and account change during photo transfer cannot commit a late document or erase originals', async () => {
  for (const action of ['pause', 'account']) {
    const f = await fixture(), held = deferred(); f.stats.holdPhoto = held;
    const pending = f.manager.connect(WS, f.d.id); await new Promise(done => setTimeout(done, 10));
    if (action === 'pause') await f.manager.pause(WS, f.d.id); else { f.auth.epoch++; f.auth.user = { id: OTHER }; }
    held.resolve(); await assert.rejects(pending, { code: 'request_cancelled' }); assert.equal(f.stats.saves.length, 0); assert.equal(f.posts.size, 1);
    if (action === 'pause') assert.equal(f.states.get(f.d.id).enabled, false); f.manager.dispose();
  }
});
test('publishing uses explicit photos and preview revisions; withdrawal retains its publication CAS tombstone', async () => {
  const f = await fixture(); const result = await f.manager.publish(WS, f.d.id, { photoIds: [f.d.photos[0].id], expectedLocalRevision: 1, expectedRemoteRevision: 0, expectedPublicRevision: 0 });
  assert.match(result.publicUrl, /blog.html\?post=/); assert.deepEqual(f.stats.publishes[0].options.photoIds, [f.d.photos[0].id]);
  assert.equal(f.stats.publishes[0].options.expectedPublicRevision, 0); await f.manager.unpublish(WS, f.d.id);
  const state = await f.manager.getState(WS, f.d.id); assert.equal(state.publication.active, false); assert.equal(state.publication.revision, 2);
  await assert.rejects(f.manager.publish(WS, f.d.id, { expectedLocalRevision: 1, expectedRemoteRevision: 1, expectedPublicRevision: 0 }), { code: 'local_changed' });
  assert.equal(f.stats.publishes.length, 1); f.manager.dispose();
});
test('saved-post replacement retains the pending operation and never marks the new edited content as already synced', async () => {
  const f = await fixture(); f.stats.loseSave = true; await assert.rejects(f.manager.connect(WS, f.d.id));
  const next = copy(f.d); next.id = Core.id(); next.title = '다시 편집한 여행'; next.photos.pop(); next.ops.splice(3, 2);
  f.posts.delete(f.d.id); f.posts.set(next.id, next);
  const transferred = copy(f.states.get(f.d.id)); transferred.localRevision = 0; transferred.pending.localRevision = 0; transferred.revision = 1;
  f.states.delete(f.d.id); f.states.set(next.id, transferred);
  assert.equal((await f.manager.sync(WS, next.id)).status, 'pending'); assert.equal(f.rows.get(f.d.id).revision, 1);
  const final = await f.manager.sync(WS, next.id); assert.equal(final.status, 'synced'); assert.equal(f.rows.get(f.d.id).revision, 2);
  assert.equal(f.rows.get(f.d.id).data.title, next.title); assert.equal(f.rows.get(f.d.id).data.photos.length, 1); assert.equal(f.stats.uploads, 2); f.manager.dispose();
});
test('same-version remote payload mutation is rejected while harmless JSON key order remains valid', async () => {
  const f = await fixture(0); await f.manager.connect(WS, f.d.id); const row = f.rows.get(f.d.id);
  row.data = Object.fromEntries(Object.entries(row.data).reverse()); assert.equal((await f.manager.sync(WS, f.d.id)).status, 'synced');
  row.data.title = '같은 버전에 몰래 바뀐 본문'; await assert.rejects(f.manager.sync(WS, f.d.id), { code: 'invalid_remote_data' });
  assert.equal(f.posts.get(f.d.id).title, '여행 기록'); f.manager.dispose();
});
test('lost publication response retries the same explicit operation and stale withdrawal preview cannot withdraw a newer publication', async () => {
  const f = await fixture(0), options = { expectedLocalRevision: 1, expectedRemoteRevision: 0, expectedPublicRevision: 0 };
  f.stats.losePublish = true; await assert.rejects(f.manager.publish(WS, f.d.id, options), { code: 'network_error' });
  const firstOperation = f.stats.publishes[0].operation; const result = await f.manager.publish(WS, f.d.id, options);
  assert.equal(f.stats.publishes[1].operation, firstOperation); assert.equal(result.revision, 1); assert.equal(f.stats.saves.length, 1);
  await assert.rejects(f.manager.unpublish(WS, f.d.id, { expectedPublicRevision: 0 }), { code: 'local_changed' });
  assert.equal(f.rows.get(f.d.id).publication.active, true); f.manager.dispose();
});
test('A-B-A local conflict resolution preserves both photo documents and the already published selection', async () => {
  const a = await fixture(), b = await fixture(0, a); const remoteId = a.d.id;
  try {
    await a.manager.connect(WS, remoteId);
    const received = await b.manager.receive(OTHER, remoteId); assert.equal(a.posts.has(received.localPostId), false);
    const editedB = savedEdit(b, received.localPostId, 'B에서 이어 쓴 여행 글');
    await b.manager.save(OTHER, editedB.id);
    const published = await b.manager.publish(OTHER, editedB.id, { expectedLocalRevision: 1, expectedRemoteRevision: 2, expectedPublicRevision: 0, photoIds: [editedB.photos[1].id] });
    const publication = copy(a.rows.get(remoteId).publication), publishedChoice = copy(a.stats.publishes[0]);
    const editedA = savedEdit(a, remoteId, 'A에서 다시 쓴 내 변경');
    assert.equal((await a.manager.save(WS, editedA.id)).status, 'conflict');
    const remoteBefore = copy(a.rows.get(remoteId)), localBefore = copy(a.posts.get(editedA.id)), otherBefore = copy(b.posts.get(editedB.id));
    const result = await a.manager.resolve(WS, editedA.id, 'local');
    assert.equal(result.status, 'synced'); assert.equal(a.rows.size, 1); assert.equal(a.rows.get(remoteId).revision, 3);
    assert.equal(a.rows.get(remoteId).data.title, editedA.title); assert.deepEqual(a.posts.get(editedA.id), localBefore); assert.deepEqual(b.posts.get(editedB.id), otherBefore);
    const recovery = a.posts.get(result.recoveryLocalPostId);
    assert.equal(recovery.title, remoteBefore.data.title); assert.notEqual(recovery.id, editedB.id);
    assert.equal(a.states.get(recovery.id).enabled, false);
    for (let i = 0; i < recovery.photos.length; i++) {
      assert.notEqual(recovery.photos[i].id, remoteBefore.data.photos[i].id);
      assert.equal(await Photo.digest(recovery.photos[i].blob), remoteBefore.data.photos[i].digest);
    }
    assert.deepEqual(a.rows.get(remoteId).publication, publication); assert.deepEqual(a.stats.publishes, [publishedChoice]);
    assert.equal(published.publicUrl, 'https://blog-test.supabase.co/blog.html?post=' + publication.token);
    // Resolution has just read the publication along with the competing private
    // document; its resulting owner state must retain that observed revision.
    assert.deepEqual(result.publication, publication);
    const saves = a.stats.saves.length; await a.manager.sync(WS, editedA.id); assert.equal(a.stats.saves.length, saves);
  } finally { a.manager.dispose(); b.manager.dispose(); }
});
test('A-B-A choosing the server retains the local edit and originals without writing or changing publication', async () => {
  const a = await fixture(), b = await fixture(0, a), remoteId = a.d.id;
  try {
    await a.manager.connect(WS, remoteId); const received = await b.manager.receive(OTHER, remoteId);
    const editedB = savedEdit(b, received.localPostId, 'B의 보관한 결과'); await b.manager.save(OTHER, editedB.id);
    await b.manager.publish(OTHER, editedB.id, { expectedLocalRevision: 1, expectedRemoteRevision: 2, expectedPublicRevision: 0, photoIds: [editedB.photos[0].id] });
    const editedA = savedEdit(a, remoteId, 'A의 아직 선택하지 않은 결과'); await a.manager.save(WS, editedA.id);
    const local = copy(a.posts.get(editedA.id)), remote = copy(a.rows.get(remoteId)), saves = a.stats.saves.length, publishes = a.stats.publishes.length;
    const result = await a.manager.resolve(WS, editedA.id, 'remote');
    assert.deepEqual(a.posts.get(editedA.id), local); assert.equal(a.states.get(editedA.id).enabled, false);
    assert.equal(result.post.title, editedB.title); assert.notEqual(result.localPostId, editedA.id);
    assert.deepEqual(a.rows.get(remoteId), remote); assert.equal(a.stats.saves.length, saves); assert.equal(a.stats.publishes.length, publishes);
    assert.equal(a.states.get(result.localPostId).remoteId, remoteId); assert.deepEqual(a.states.get(result.localPostId).publication, remote.publication);
    for (let i = 0; i < result.post.photos.length; i++) assert.equal(await Photo.digest(result.post.photos[i].blob), editedB.photos[i].digest);
  } finally { a.manager.dispose(); b.manager.dispose(); }
});
test('a newer B revision invalidates A conflict review and requires another explicit local choice', async () => {
  const a = await fixture(), b = await fixture(0, a), remoteId = a.d.id;
  try {
    await a.manager.connect(WS, remoteId); const received = await b.manager.receive(OTHER, remoteId);
    const firstB = savedEdit(b, received.localPostId, '먼저 보관한 B'); await b.manager.save(OTHER, firstB.id);
    const editedA = savedEdit(a, remoteId, '지킬 A의 입력'); await a.manager.save(WS, editedA.id);
    assert.equal(a.states.get(editedA.id).conflict.remoteRevision, 2);
    const latestB = savedEdit(b, firstB.id, '검토 뒤 다시 보관한 B'); await b.manager.save(OTHER, latestB.id);
    const localBefore = copy(a.posts.get(editedA.id)), remoteBefore = copy(a.rows.get(remoteId)), saves = a.stats.saves.length;
    await assert.rejects(a.manager.resolve(WS, editedA.id, 'local'), { code: 'local_changed' });
    assert.equal(a.posts.size, 1); assert.deepEqual(a.posts.get(editedA.id), localBefore);
    assert.deepEqual(a.rows.get(remoteId), remoteBefore); assert.equal(a.stats.saves.length, saves);
    const review = await a.manager.getState(WS, editedA.id);
    assert.equal(review.status, 'conflict'); assert.equal(review.conflict.remoteRevision, 3); assert.equal(review.conflict.remoteTitle, latestB.title);
    const result = await a.manager.resolve(WS, editedA.id, 'local');
    assert.equal(result.status, 'synced'); assert.equal(a.rows.get(remoteId).revision, 4); assert.equal(a.rows.get(remoteId).data.title, editedA.title);
    const recovery = a.posts.get(result.recoveryLocalPostId);
    assert.equal(recovery.title, latestB.title); assert.equal(a.states.get(recovery.id).enabled, false);
    assert.deepEqual(a.posts.get(editedA.id), localBefore); assert.deepEqual(b.posts.get(latestB.id), latestB);
    assert.equal(a.stats.publishes.length, 0); assert.equal(a.rows.get(remoteId).publication, null);
    for (let i = 0; i < recovery.photos.length; i++) assert.equal(await Photo.digest(recovery.photos[i].blob), latestB.photos[i].digest);
  } finally { a.manager.dispose(); b.manager.dispose(); }
});
test('pausing A during conflict recovery leaves any installed B recovery paused and cannot write the server', async () => {
  const a = await fixture(), b = await fixture(0, a), remoteId = a.d.id, entered = deferred(), held = deferred();
  try {
    await a.manager.connect(WS, remoteId); const received = await b.manager.receive(OTHER, remoteId);
    const editedB = savedEdit(b, received.localPostId, '보존할 B 원본'); await b.manager.save(OTHER, editedB.id);
    const editedA = savedEdit(a, remoteId, '보존할 A 입력'); await a.manager.save(WS, editedA.id);
    const originalDownload = a.remote.downloadAsset; let first = true;
    a.remote.downloadAsset = async asset => { if (first) { first = false; entered.resolve(); await held.promise; } return originalDownload(asset); };
    const before = copy(a.rows.get(remoteId)), saves = a.stats.saves.length, local = copy(a.posts.get(editedA.id));
    const resolving = a.manager.resolve(WS, editedA.id, 'local'); await entered.promise;
    await a.manager.pause(WS, editedA.id); held.resolve(); await assert.rejects(resolving, { code: 'request_cancelled' });
    assert.equal(a.stats.saves.length, saves); assert.deepEqual(a.rows.get(remoteId), before); assert.deepEqual(a.posts.get(editedA.id), local);
    assert.equal(a.states.get(editedA.id).enabled, false);
    for (const [id, post] of a.posts) if (id !== editedA.id) {
      assert.equal(post.title, editedB.title); assert.equal(a.states.get(id).enabled, false);
      for (let i = 0; i < post.photos.length; i++) assert.equal(await Photo.digest(post.photos[i].blob), editedB.photos[i].digest);
    }
    assert.equal(a.stats.publishes.length, 0);
  } finally { held.resolve(); a.manager.dispose(); b.manager.dispose(); }
});
test('explicit conflict comparison refreshes a newer B revision and publication without uploading either side', async () => {
  const a = await fixture(), b = await fixture(0, a), remoteId = a.d.id;
  try {
    await a.manager.connect(WS, remoteId); const received = await b.manager.receive(OTHER, remoteId);
    const firstB = savedEdit(b, received.localPostId, '처음 비교할 B'); await b.manager.save(OTHER, firstB.id);
    const editedA = savedEdit(a, remoteId, '남겨 둘 A'); await a.manager.save(WS, editedA.id);
    const latestB = savedEdit(b, firstB.id, '새로 비교할 B'); await b.manager.save(OTHER, latestB.id);
    await b.manager.publish(OTHER, latestB.id, { expectedLocalRevision: 1, expectedRemoteRevision: 3, expectedPublicRevision: 0, photoIds: [latestB.photos[1].id] });
    const local = copy(a.posts.get(editedA.id)), row = copy(a.rows.get(remoteId)), saves = a.stats.saves.length, uploads = a.stats.uploads, publishes = a.stats.publishes.length;
    const compared = await a.manager.sync(WS, editedA.id);
    assert.equal(compared.status, 'conflict'); assert.equal(compared.conflict.remoteRevision, 3); assert.equal(compared.conflict.remoteTitle, latestB.title);
    assert.deepEqual(compared.publication, row.publication); assert.deepEqual(a.posts.get(editedA.id), local); assert.deepEqual(a.rows.get(remoteId), row);
    assert.equal(a.stats.saves.length, saves); assert.equal(a.stats.uploads, uploads); assert.equal(a.stats.publishes.length, publishes); assert.equal(a.posts.size, 1);
    a.remote.read = async () => { throw fault('network_error'); };
    await assert.rejects(a.manager.sync(WS, editedA.id), { code: 'network_error' });
    assert.equal(a.states.get(editedA.id).conflict.remoteRevision, 3); assert.deepEqual(a.posts.get(editedA.id), local); assert.deepEqual(a.rows.get(remoteId), row);
  } finally { a.manager.dispose(); b.manager.dispose(); }
});
test('both stale conflict buttons reject before remote access or recovery installation after another comparison', async () => {
  const a = await fixture(), b = await fixture(0, a), remoteId = a.d.id;
  try {
    await a.manager.connect(WS, remoteId); const received = await b.manager.receive(OTHER, remoteId);
    const firstB = savedEdit(b, received.localPostId, '옛 비교 B'); await b.manager.save(OTHER, firstB.id);
    const editedA = savedEdit(a, remoteId, 'A의 현재 입력'); await a.manager.save(WS, editedA.id);
    const oldReview = copy(a.states.get(editedA.id).conflict);
    const latestB = savedEdit(b, firstB.id, '다시 확인한 B'); await b.manager.save(OTHER, latestB.id); await a.manager.sync(WS, editedA.id);
    const currentReview = copy(a.states.get(editedA.id).conflict), row = copy(a.rows.get(remoteId)), local = copy(a.posts.get(editedA.id));
    const originalRead = a.remote.read; let reads = 0; a.remote.read = async id => { reads++; return originalRead(id); };
    for (const choice of ['local', 'remote']) await assert.rejects(a.manager.resolve(WS, editedA.id, choice, oldReview), { code: 'local_changed' });
    assert.equal(reads, 0); assert.equal(a.posts.size, 1); assert.deepEqual(a.posts.get(editedA.id), local); assert.deepEqual(a.rows.get(remoteId), row);
    assert.deepEqual(a.states.get(editedA.id).conflict, currentReview);
    const accepted = await a.manager.resolve(WS, editedA.id, 'remote', currentReview);
    assert.equal(accepted.post.title, latestB.title); assert.equal(a.states.get(editedA.id).enabled, false); assert.deepEqual(a.rows.get(remoteId), row);
  } finally { a.manager.dispose(); b.manager.dispose(); }
});
test('A-B-A lost save and publication receipts replay exact operations without duplicating copies or reverting newer publication', async () => {
  const a = await fixture(), b = await fixture(0, a), remoteId = a.d.id;
  try {
    await a.manager.connect(WS, remoteId); const received = await b.manager.receive(OTHER, remoteId);
    const editedB = savedEdit(b, received.localPostId, 'B에서 보관하고 게시한 글'); await b.manager.save(OTHER, editedB.id);
    await b.manager.publish(OTHER, editedB.id, { expectedLocalRevision: 1, expectedRemoteRevision: 2, expectedPublicRevision: 0, photoIds: [editedB.photos[1].id] });
    const editedA = savedEdit(a, remoteId, 'A가 명시해서 채택한 글'); await a.manager.save(WS, editedA.id);
    a.stats.loseSave = true; await assert.rejects(a.manager.resolve(WS, editedA.id, 'local'), { code: 'network_error' });
    const request = copy(a.stats.saves.at(-1)), assets = a.assets.size, postIds = [...a.posts.keys()];
    assert.equal(a.rows.get(remoteId).revision, 3); assert.equal(a.posts.size, 2);
    const retried = await a.manager.sync(WS, editedA.id);
    assert.equal(retried.status, 'synced'); assert.deepEqual(a.stats.saves.at(-1), request); assert.equal(a.rows.get(remoteId).revision, 3);
    assert.equal(a.rows.size, 1); assert.equal(a.assets.size, assets); assert.deepEqual([...a.posts.keys()], postIds); assert.equal(retried.publication.revision, 1);
    const optionsA = { expectedLocalRevision: 1, expectedRemoteRevision: 3, expectedPublicRevision: 1, photoIds: [editedA.photos[0].id] };
    a.stats.losePublish = true; await assert.rejects(a.manager.publish(WS, editedA.id, optionsA), { code: 'network_error' });
    const pendingPublication = copy(a.stats.publishes.at(-1)), token = a.rows.get(remoteId).publication.token;
    const latestB = await b.manager.receive(OTHER, remoteId);
    await b.manager.publish(OTHER, latestB.localPostId, { expectedLocalRevision: 1, expectedRemoteRevision: 3, expectedPublicRevision: 2, photoIds: [latestB.post.photos[1].id] });
    const newer = copy(a.rows.get(remoteId)), bSelection = copy(a.stats.publishes.at(-1)), saves = a.stats.saves.length, uploads = a.stats.uploads;
    await assert.rejects(a.manager.publish(WS, editedA.id, optionsA), { code: 'blog_conflict' });
    assert.deepEqual(a.stats.publishes.at(-1), pendingPublication); assert.deepEqual(a.rows.get(remoteId), newer);
    assert.equal(newer.publication.token, token); assert.equal(newer.publication.revision, 3); assert.equal(newer.publication.active, true);
    assert.deepEqual(bSelection.options.photoIds, [latestB.post.photos[1].id]); assert.equal(a.stats.saves.length, saves); assert.equal(a.stats.uploads, uploads);
    const final = await a.manager.getState(WS, editedA.id); assert.deepEqual(final.publication, newer.publication); assert.equal(final.publishPending, null);
    assert.deepEqual(a.posts.get(editedA.id), editedA); assert.deepEqual(b.posts.get(editedB.id), editedB);
  } finally { a.manager.dispose(); b.manager.dispose(); }
});

test('account catalog detects an originating binding, clean remote updates, local pending and pause without uploads or publications', async () => {
  const f = await fixture();
  try {
    await f.manager.connect(WS, f.d.id);
    const writes = f.stats.saves.length, uploads = f.stats.uploads;
    let rows = await f.manager.catalog(WS);
    assert.equal(rows[0].status, 'received'); assert.equal(rows[0].copies[0].localPostId, f.d.id);
    f.rows.get(f.d.id).revision++;
    rows = await f.manager.catalog(WS); assert.equal(rows[0].status, 'remote_updated');
    f.posts.get(f.d.id).revision++;
    assert.equal((await f.manager.catalog(WS))[0].status, 'conflict');
    await f.manager.pause(WS, f.d.id); assert.equal((await f.manager.catalog(WS))[0].status, 'paused');
    assert.equal(f.stats.saves.length, writes); assert.equal(f.stats.uploads, uploads); assert.equal(f.stats.publishes.length, 0);
  } finally { f.manager.dispose(); }
});

test('openRemote reopens the exact originating or paused archived local document without reading the remote body', async () => {
  const f = await fixture();
  try {
    await f.manager.connect(WS, f.d.id); await f.manager.pause(WS, f.d.id);
    f.posts.get(f.d.id).archived = true; const before = copy(f.posts), states = copy(f.states);
    f.remote.read = async () => { throw Error('Existing copy must not download a remote body'); };
    const result = await f.manager.openRemote(WS, f.d.id, { expectedRemoteRevision: 99 });
    assert.equal(result.received, false); assert.equal(result.localPostId, f.d.id); assert.equal(result.workspaceId, WS); assert.equal(result.post.archived, true);
    assert.deepEqual(f.posts, before); assert.deepEqual(f.states, states);
  } finally { f.manager.dispose(); }
});

test('first open validates the reviewed server revision and originals; repeating and two services reopen the same installed copy', async () => {
  const a = await fixture(), b = await fixture(0, a);
  const second = Sync.create({ storage: b.storage, auth: b.auth, remote: b.remote, blog: Blog, photoPost: Photo, makeId: Core.id });
  try {
    await a.manager.connect(WS, a.d.id); assert.equal((await b.manager.catalog(WS))[0].status, 'server_only');
    await assert.rejects(b.manager.openRemote(WS, a.d.id, { expectedRemoteRevision: 2 }), { code: 'local_changed' }); assert.equal(b.posts.size, 0);
    const path = Object.values(a.rows.get(a.d.id).assets)[0].path, original = a.assets.get(path);
    a.assets.set(path, new Blob(['bad'], { type: 'image/png' }));
    await assert.rejects(b.manager.openRemote(WS, a.d.id, { expectedRemoteRevision: 1 })); assert.equal(b.posts.size, 0); assert.equal(b.states.size, 0);
    a.assets.set(path, original);
    const [one, two] = await Promise.all([b.manager.openRemote(WS, a.d.id, { expectedRemoteRevision: 1 }), second.openRemote(WS, a.d.id, { expectedRemoteRevision: 1 })]);
    assert.equal(one.localPostId, two.localPostId); assert.equal(Number(one.received) + Number(two.received), 1); assert.equal(b.posts.size, 1);
    assert.notEqual(one.post.id, a.d.id); assert.notEqual(one.post.photos[0].id, a.d.photos[0].id);
    assert.equal(await Photo.digest(one.post.photos[0].blob), a.d.photos[0].digest);
    assert.equal((await b.manager.openRemote(WS, a.d.id, { expectedRemoteRevision: 1 })).localPostId, one.localPostId);
    assert.equal(a.stats.saves.length, 1); assert.equal(a.stats.publishes.length, 0);
  } finally { a.manager.dispose(); b.manager.dispose(); second.dispose(); }
});

test('multiple explicit copies require a local choice; catalog and open never merge or replace them', async () => {
  const a = await fixture(), b = await fixture(0, a);
  try {
    await a.manager.connect(WS, a.d.id);
    const first = await b.manager.receive(WS, a.d.id), second = await b.manager.receive(WS, a.d.id), before = copy(b.posts), states = copy(b.states);
    await assert.rejects(b.manager.openRemote(WS, a.d.id, { expectedRemoteRevision: 1 }), error => error.code === 'blog_copy_selection_required' && error.choices.length === 2);
    await assert.rejects(b.manager.openRemote(WS, a.d.id, { localPostId: Core.id() }), { code: 'local_changed' });
    const opened = await b.manager.openRemote(WS, a.d.id, { localPostId: second.localPostId });
    assert.equal(opened.localPostId, second.localPostId); assert.notEqual(opened.localPostId, first.localPostId); assert.equal(opened.received, false);
    assert.equal((await b.manager.catalog(WS))[0].copies.length, 2); assert.deepEqual(b.posts, before); assert.deepEqual(b.states, states);
  } finally { a.manager.dispose(); b.manager.dispose(); }
});

test('account change during original download and an installation failure leave a first open retryable with no local copy', async () => {
  for (const mode of ['account', 'storage']) {
    const a = await fixture(), b = await fixture(0, a);
    try {
      await a.manager.connect(WS, a.d.id);
      if (mode === 'account') { const original = b.remote.downloadAsset; b.remote.downloadAsset = async asset => { const blob = await original(asset); b.auth.epoch++; b.auth.user = { id: OTHER }; return blob; }; }
      else b.stats.failInstall = true;
      await assert.rejects(b.manager.openRemote(WS, a.d.id, { expectedRemoteRevision: 1 }));
      assert.equal(b.posts.size, 0); assert.equal(b.states.size, 0); assert.equal(a.stats.saves.length, 1); assert.equal(a.stats.publishes.length, 0);
      if (mode === 'storage') { b.stats.failInstall = false; assert.equal((await b.manager.openRemote(WS, a.d.id, { expectedRemoteRevision: 1 })).received, true); }
    } finally { a.manager.dispose(); b.manager.dispose(); }
  }
});

async function conflictPair() {
  const a = await fixture(), b = await fixture(0, a), remoteId = a.d.id;
  await a.manager.connect(WS, remoteId); const received = await b.manager.receive(WS, remoteId);
  const editedB = savedEdit(b, received.localPostId, '서버에서 검토한 판'); await b.manager.save(WS, editedB.id);
  const editedA = savedEdit(a, remoteId, '로컬에서 지킬 판'); await a.manager.save(WS, editedA.id);
  return { a, b, remoteId, editedA, editedB, reviewed: copy(a.states.get(editedA.id).conflict) };
}

test('reviewed remote conflict choice rejects a changed local document or a newer server head before installing a copy', async () => {
  for (const change of ['local', 'remote']) {
    const f = await conflictPair();
    try {
      if (change === 'local') { f.a.posts.get(f.editedA.id).revision++; f.a.posts.get(f.editedA.id).title = '검토 뒤 수정된 입력'; }
      else { const next = savedEdit(f.b, f.editedB.id, '검토 뒤 갱신된 서버'); await f.b.manager.save(WS, next.id); }
      const before = copy(f.a.posts), saves = f.a.stats.saves.length;
      await assert.rejects(f.a.manager.resolve(WS, f.editedA.id, 'remote', f.reviewed), { code: 'local_changed' });
      assert.deepEqual(f.a.posts, before); assert.equal(f.a.stats.saves.length, saves); assert.equal(f.a.stats.publishes.length, 0);
    } finally { f.a.manager.dispose(); f.b.manager.dispose(); }
  }
});

test('pause during a remote conflict choice cannot leave a newly enabled competing copy', async () => {
  const f = await conflictPair(), entered = deferred(), release = deferred();
  try {
    const original = f.a.remote.downloadAsset; let first = true;
    f.a.remote.downloadAsset = async asset => { if (first) { first = false; entered.resolve(); await release.promise; } return original(asset); };
    const choosing = f.a.manager.resolve(WS, f.editedA.id, 'remote', f.reviewed); await entered.promise;
    await f.a.manager.pause(WS, f.editedA.id); release.resolve(); await assert.rejects(choosing, { code: 'request_cancelled' });
    for (const state of f.a.states.values()) assert.equal(state.enabled, false);
    assert.deepEqual(f.a.posts.get(f.editedA.id), f.editedA); assert.equal(f.a.stats.publishes.length, 0);
  } finally { release.resolve(); f.a.manager.dispose(); f.b.manager.dispose(); }
});

test('first open rechecks a held server head and caller currentness before any local installation', async () => {
  for (const change of ['head', 'payload', 'workspace', 'navigation']) {
    const a = await fixture(), b = await fixture(0, a); let current = true;
    try {
      await a.manager.connect(WS, a.d.id); const original = b.remote.downloadAsset; let first = true;
      b.remote.downloadAsset = async asset => {
        const blob = await original(asset);
        if (first) { first = false; const head = a.rows.get(a.d.id);
          if (change === 'head') head.revision++;
          if (change === 'payload') head.data.title = '같은 판의 변조';
          if (change === 'workspace') head.workspace_id = OTHER;
          if (change === 'navigation') current = false;
        }
        return blob;
      };
      await assert.rejects(b.manager.openRemote(WS, a.d.id, { expectedRemoteRevision: 1, isCurrent: () => current }), { code: change === 'navigation' ? 'request_cancelled' : change === 'head' ? 'local_changed' : 'invalid_remote_data' });
      assert.equal(b.posts.size, 0); assert.equal(b.states.size, 0); assert.equal(a.stats.saves.length, 1); assert.equal(a.stats.publishes.length, 0);
    } finally { a.manager.dispose(); b.manager.dispose(); }
  }
});

test('focused inspection discovers and refreshes remote changes without sending the local post, originals or publication', async () => {
  const f = await fixture();
  try {
    await f.manager.connect(WS, f.d.id);
    const before = copy(f.posts), saves = f.stats.saves.length, uploads = f.stats.uploads;
    const row = f.rows.get(f.d.id); row.revision++; row.data.title = '다른 기기에서 갱신';
    row.publication = { token: Core.id(), blogToken: WS, revision: 2, active: true };
    assert.equal((await f.manager.getState(WS, f.d.id)).status, 'synced', 'Local-only state cannot discover another device update');
    const inspected = await f.manager.inspectRemote(WS, f.d.id);
    assert.equal(inspected.status, 'conflict'); assert.equal(inspected.conflict.remoteRevision, 2); assert.equal(inspected.conflict.localRevision, f.d.revision);
    assert.equal(inspected.conflict.remoteTitle, row.data.title); assert.deepEqual(inspected.publication, row.publication);
    row.revision++; row.data.title = '비교 중 다시 갱신';
    const refreshed = await f.manager.inspectRemote(WS, f.d.id); assert.equal(refreshed.conflict.remoteRevision, 3); assert.equal(refreshed.conflict.remoteTitle, row.data.title);
    assert.deepEqual(f.posts, before); assert.equal(f.stats.saves.length, saves); assert.equal(f.stats.uploads, uploads); assert.equal(f.stats.publishes.length, 0);
  } finally { f.manager.dispose(); }
});

test('focused inspection verifies an equal head without metadata writes and rejects same-revision manifest mutation', async () => {
  const f = await fixture();
  try {
    await f.manager.connect(WS, f.d.id); const before = copy(f.states), saves = f.stats.saves.length, uploads = f.stats.uploads;
    assert.equal((await f.manager.inspectRemote(WS, f.d.id)).status, 'synced'); assert.deepEqual(f.states, before);
    f.rows.get(f.d.id).data.title = '같은 판의 변조';
    await assert.rejects(f.manager.inspectRemote(WS, f.d.id), { code: 'invalid_remote_data' });
    assert.deepEqual(f.states, before); assert.equal(f.stats.saves.length, saves); assert.equal(f.stats.uploads, uploads); assert.equal(f.stats.publishes.length, 0);
    f.rows.get(f.d.id).data.title = f.d.title; f.states.get(f.d.id).remoteManifest = null;
    const legacy = copy(f.states); assert.equal((await f.manager.inspectRemote(WS, f.d.id)).status, 'synced'); assert.deepEqual(f.states, legacy);
  } finally { f.manager.dispose(); }
});

test('focused inspection preserves pause and every unacknowledged operation without reading or resubmitting the remote head', async () => {
  for (const phase of ['paused', 'pending', 'publishPending', 'unpublishPending']) {
    const f = await fixture();
    try {
      await f.manager.connect(WS, f.d.id);
      if (phase === 'paused') await f.manager.pause(WS, f.d.id);
      else f.states.get(f.d.id)[phase] = { operationId: Core.id(), frozen: 'same operation stays pending' };
      const before = copy(f.states), saves = f.stats.saves.length, uploads = f.stats.uploads;
      f.remote.read = async () => { throw Error('Paused or unacknowledged operations must not be inspected'); };
      const result = await f.manager.inspectRemote(WS, f.d.id);
      assert.equal(result.enabled, phase !== 'paused'); assert.deepEqual(f.states, before);
      assert.equal(f.stats.saves.length, saves); assert.equal(f.stats.uploads, uploads); assert.equal(f.stats.publishes.length, 0);
    } finally { f.manager.dispose(); }
  }
});

test('focused inspection discards a delayed head after pause, account replacement, local edit or competing metadata update', async () => {
  for (const change of ['pause', 'account', 'post', 'state', 'navigation']) {
    const f = await fixture(), entered = deferred(), release = deferred();
    let current = true;
    try {
      await f.manager.connect(WS, f.d.id); f.rows.get(f.d.id).revision++;
      const read = f.remote.read; f.remote.read = async id => { const row = await read(id); entered.resolve(); await release.promise; return row; };
      const inspecting = f.manager.inspectRemote(WS, f.d.id, { isCurrent: () => current }); await entered.promise;
      if (change === 'pause') await f.manager.pause(WS, f.d.id);
      if (change === 'account') { f.auth.epoch++; f.auth.user = { id: OTHER }; }
      if (change === 'post') { f.posts.get(f.d.id).revision++; f.posts.get(f.d.id).title = '확인 중 로컬 편집'; }
      if (change === 'state') { const state = f.states.get(f.d.id); state.revision++; state.error = 'other tab update'; }
      if (change === 'navigation') current = false;
      const before = copy(f.states), local = copy(f.posts), saves = f.stats.saves.length, uploads = f.stats.uploads;
      release.resolve(); await assert.rejects(inspecting, { code: ['pause', 'account', 'navigation'].includes(change) ? 'request_cancelled' : 'local_changed' });
      assert.deepEqual(f.states, before); assert.deepEqual(f.posts, local); assert.equal(f.stats.saves.length, saves); assert.equal(f.stats.uploads, uploads); assert.equal(f.stats.publishes.length, 0);
    } finally { release.resolve(); f.manager.dispose(); }
  }
});

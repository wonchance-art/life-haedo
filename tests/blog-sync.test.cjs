'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Remote = require('../assets/life/blog-remote.js'), Sync = require('../assets/life/blog-sync.js'), Blog = require('../assets/life/blog.js'), Photo = require('../assets/life/photo-post.js'), Core = require('../assets/life/core.js');
const UID = Core.id(), WS = Core.id(), OTHER = Core.id(), PROJECT = 'https://blog-test.supabase.co';
const copy = value => structuredClone(value), fault = code => Object.assign(Error(code), { code });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
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
    async writeBlogSyncState(ws, id, input, base) { if ((states.get(id)?.revision || 0) !== base) throw fault('blog_sync_conflict'); const next = { ...copy(input), revision: base + 1 }; states.set(id, next); return copy(next); }
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

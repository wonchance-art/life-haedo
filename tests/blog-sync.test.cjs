'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Remote = require('../assets/life/blog-remote.js'), Sync = require('../assets/life/blog-sync.js'), Blog = require('../assets/life/blog.js'), Photo = require('../assets/life/photo-post.js'), Core = require('../assets/life/core.js');
const UID = Core.id(), WS = Core.id(), OTHER = Core.id(), PROJECT = 'https://blog-test.supabase.co';
const copy = value => structuredClone(value), fault = code => Object.assign(Error(code), { code });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
async function fixture(count = 2) {
  const d = Photo.create(Core.id); d.status = 'saved'; d.revision = 1; d.title = '여행 기록'; d.ops = [{ insert: '출발한 날 🌿\n' }];
  for (let n = 0; n < count; n++) {
    const blob = new Blob([new Uint8Array([137,80,78,71,13,10,26,10,n])], { type: 'image/png' });
    const photo = { id: Core.id(), name: '익명 사진.png', type: blob.type, width: 1, height: 1, size: blob.size, digest: await Photo.digest(blob), blob };
    d.photos.push(photo); d.ops.push({ insert: { photo: { id: photo.id, caption: '사진 설명 ' + n, alt: '' } } }, { insert: '\n' });
  }
  const posts = new Map([[d.id, copy(d)]]), states = new Map(), rows = new Map(), assets = new Map(), receipts = new Map(), publicReceipts = new Map();
  const stats = { uploads: 0, saves: [], prepares: 0, publishes: [], failPhoto: null, loseSave: false, failInstall: false };
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
      row.publication = { token: row.publication?.token || Core.id(), blogToken: WS, revision: options.expectedPublicRevision + 1, active: true };
      const result = { status: 'published', ...row.publication }; publicReceipts.set(operation, copy(result));
      if (stats.losePublish) { stats.losePublish = false; throw fault('network_error'); } return result;
    },
    async unpublish(id, revision) { const row = rows.get(id); if (row.publication.revision !== revision) throw fault('blog_conflict'); row.publication = { ...row.publication, revision: revision + 1, active: false }; return { status: 'unpublished', revision: revision + 1 }; }, dispose() {}
  };
  const manager = Sync.create({ storage, auth, blog: Blog, photoPost: Photo, remote, makeId: Core.id });
  return { d, posts, states, rows, assets, stats, auth, storage, remote, manager };
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
  assert.deepEqual(f.posts.get(f.d.id), f.d); await f.manager.sync(WS, received.localPostId); assert.equal(f.stats.saves.length, 1); f.manager.dispose();
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

'use strict';
// One account, one blog (2026-11-01): every device lists the posts of every
// library of the account, and posts written before the account existed are
// copied into the adopted library so that they are synchronized too.
const test = require('node:test'), assert = require('node:assert/strict');
const { owner, memoryIdb, server, device, clock, post, Core, Photo } = require('./helpers/blog-sync-cloud.cjs');
const { createStorage } = require('../assets/life/storage.js');
const Reference = require('../assets/life/source-reference.js');
require('../assets/life/home.js');
const { listAccountPosts } = globalThis.HaedoLife.HomeUI;

async function bytes(blob) { return Buffer.from(await blob.arrayBuffer()).toString('hex'); }
const ids = value => value.posts.map(row => row.workspaceId + '/' + row.id).sort();
const postIds = value => value.posts.map(row => row.id).sort();

async function heic() {
  const original = new Blob([Buffer.from('000000186674797068656963000000006d69663168656963', 'hex'), new Uint8Array(24)], { type: 'image/heic' });
  const view = new Blob([Uint8Array.from([255, 216, 255, 224, 7, 1, 255, 217])], { type: 'image/jpeg' });
  const id = Core.id();
  return { original, view, photo: { id, name: 'IMG_0001.HEIC', type: 'image/heic', width: 4032, height: 3024, size: original.size, digest: await Photo.digest(original), blob: original,
    view: { type: 'image/jpeg', size: view.size, digest: await Photo.digest(view), width: 4032, height: 3024, blob: view } } };
}
async function legacyLibrary(memory) {
  const base = createStorage({ idb: memory.idb, core: Core, channelFactory: null });
  let bundle = await base.createWorkspace('계정 연결 전 자료');
  const prepared = await Core.prepareImport({ origin: 'obsidian', title: '익명 원문', text: '근거로 남길 원문입니다.' }, bundle);
  const changes = Core.buildImportChanges(bundle, prepared, [{ start: 0, end: 2, topic: '검증', note: '' }]);
  assert.equal((await base.commitLocal({ workspaceId: bundle.workspaceId, operationId: Core.id(), baseRevision: bundle.revision, changes })).status, 'stored');
  bundle = await base.read(bundle.workspaceId);
  const ws = bundle.workspaceId;
  // Posts kept by an earlier release in a library without an account. Today's
  // storage only writes posts for an account, so the rows are placed directly.
  async function write(doc, refs = null) {
    const meta = memory.rows.get('meta'), saved = { ...structuredClone(doc), revision: (doc.revision || 0) + 1 };
    Photo.validate(saved);
    meta.set(JSON.stringify(`photo-post:${ws}:${saved.id}`), { key: `photo-post:${ws}:${saved.id}`, value: saved });
    const indexKey = JSON.stringify(`photo-posts:${ws}`), index = (meta.get(indexKey)?.value || []).filter(row => row.id !== saved.id);
    index.push({ id: saved.id, title: saved.title, status: saved.status, revision: saved.revision, updatedAt: saved.updatedAt, body: Photo.plainText(saved), photos: saved.photos.length, attachments: 0, archived: false });
    meta.set(indexKey, { key: `photo-posts:${ws}`, value: index });
    if (refs) meta.set(JSON.stringify(`post-evidence:${ws}:${saved.id}`), { key: `post-evidence:${ws}:${saved.id}`, value: { revision: 1, refs } });
    return saved;
  }
  const raw = id => structuredClone(memory.rows.get('meta').get(JSON.stringify(`photo-post:${ws}:${id}`))?.value);
  const listed = () => (memory.rows.get('meta').get(JSON.stringify(`photo-posts:${ws}`))?.value || []).map(row => row.id).sort();
  return { base, bundle, ws, write, raw, listed };
}

test('the home lists every eligible library of the account; devices with different active libraries see the same posts', async () => {
  const cloud = server(), time = clock(), mac = await device(cloud, 'mac', { time }), iphone = await device(cloud, 'iphone', { time });
  // Mac also keeps a second library (e.g. an adopted earlier one) and opens it.
  const second = (await mac.storage.createWorkspace('두 번째 자료공간')).workspaceId;
  await mac.storage.setActive(second); await iphone.storage.setActive(iphone.ws);
  const first = await mac.storage.savePhotoPost(mac.ws, await post({ title: 'Mac 첫 공간의 글' }), 0);
  const other = await mac.storage.savePhotoPost(second, await post({ title: 'Mac 두 번째 공간의 글', time: '2026-11-01T09:01:00.000Z' }), 0);
  const draft = await iphone.storage.savePhotoPost(iphone.ws, await post({ title: 'iPhone 초안', status: 'draft', time: '2026-11-01T09:02:00.000Z' }), 0);
  // Before this change the home read only the open library.
  assert.deepEqual((await mac.storage.listPhotoPosts(second)).map(row => row.id), [other.id]);
  const before = await listAccountPosts(mac.storage, second);
  assert.deepEqual(ids(before), [mac.ws + '/' + first.id, second + '/' + other.id].sort());
  assert.equal(before.failed, false); assert.deepEqual(before.workspaces[0], second);

  await mac.sync.syncNow({ flushDrafts: true }); await iphone.sync.syncNow({ flushDrafts: true }); await mac.sync.syncNow();
  const onMac = await listAccountPosts(mac.storage, second), onPhone = await listAccountPosts(iphone.storage, iphone.ws);
  assert.deepEqual(postIds(onMac), [first.id, other.id, draft.id].sort());
  assert.deepEqual(postIds(onPhone), postIds(onMac));
  // Each row names the library that holds it, so it opens and saves there.
  for (const row of onMac.posts) assert.equal((await mac.storage.readPhotoPost(row.workspaceId, row.id)).id, row.id);
  for (const row of onPhone.posts) assert.equal((await iphone.storage.readPhotoPost(row.workspaceId, row.id)).id, row.id);
  // The sync status counts the same account blog on both devices.
  assert.deepEqual([mac.sync.getStatus().posts, mac.sync.getStatus().drafts], [2, 1]);
  await iphone.sync.syncNow();
  assert.deepEqual([iphone.sync.getStatus().posts, iphone.sync.getStatus().drafts], [2, 1]);
  assert.equal(iphone.sync.getStatus().pending + iphone.sync.getStatus().errors, 0);
  assert.ok(Date.parse(iphone.sync.getStatus().lastSyncAt) > 0);
});

test('recovery copies stay out of the account list; an unreadable library is reported without hiding the others', async () => {
  const memory = memoryIdb(), storage = createStorage({ idb: memory.idb, core: Core, channelFactory: null, account: owner });
  const main = (await storage.createWorkspace('기본 자료')).workspaceId, kept = (await storage.createWorkspace('복구 사본')).workspaceId;
  const visible = await storage.savePhotoPost(main, await post({ title: '보이는 글' }), 0);
  const hidden = await storage.savePhotoPost(kept, await post({ title: '복구 사본의 글' }), 0);
  const scoped = { ...storage, listAccountLibraries: async () => (await storage.listAccountLibraries()).map(row => row.workspaceId === kept ? { ...row, eligible: false, exclusion: 'recovery' } : row) };
  assert.deepEqual(postIds(await listAccountPosts(scoped, main)), [visible.id]);
  // Opened directly, a recovery copy still shows its own posts.
  assert.deepEqual(postIds(await listAccountPosts(scoped, kept)), [hidden.id, visible.id].sort());
  const failing = { ...storage }; failing.listPhotoPosts = id => id === kept ? Promise.reject(Object.assign(new Error('읽기 실패'), { code: 'storage_aborted' })) : storage.listPhotoPosts(id);
  const partial = await listAccountPosts(failing, main);
  assert.equal(partial.failed, true); assert.deepEqual(postIds(partial), [visible.id]);
  await assert.rejects(listAccountPosts(failing, kept), { code: 'storage_aborted' });
  // Without an account scope only the open library is listed, as before.
  const local = { ...storage, listAccountLibraries: () => Promise.reject(Object.assign(new Error('계정 없음'), { code: 'auth_scope_required' })) };
  assert.deepEqual(ids(await listAccountPosts(local, kept)), [kept + '/' + hidden.id]);
  // A library this account does not own is listed alone.
  const foreign = { ...storage, listAccountLibraries: async () => (await storage.listAccountLibraries()).filter(row => row.workspaceId !== kept) };
  assert.deepEqual(ids(await listAccountPosts(foreign, kept)), [kept + '/' + hidden.id]);
});

test('adopting an account-less library copies its posts, photos, HEIC views and evidence with the same ids; originals stay', async () => {
  const memory = memoryIdb(), legacy = await legacyLibrary(memory);
  const { photo, original, view } = await heic();
  const withPhoto = await post({ title: '계정 전 사진 글' }); withPhoto.photos = [photo];
  withPhoto.ops = [{ insert: '본문\n' }, { insert: { photo: { id: photo.id, caption: '', alt: '아이폰 사진' } } }, { insert: '\n' }];
  const savedPhoto = await legacy.write(withPhoto);
  const draft = await legacy.write(await post({ title: '계정 전 초안', status: 'draft' }));
  const version = legacy.bundle.sourceVersions[0];
  const ref = await Reference.build({ bundle: legacy.bundle, sourceId: version.sourceId, versionId: version.id, locator: { start: 0, end: 4 } });
  const cited = await legacy.write(await post({ title: '근거가 있는 글' }), [ref]);
  const originals = [savedPhoto, draft, cited].map(doc => legacy.raw(doc.id));

  const account = legacy.base.forAccount(owner);
  const result = await account.adoptUnownedWorkspaces();
  assert.deepEqual(result.failed, []); assert.deepEqual(result.repaired, []); assert.equal(result.adopted.length, 1);
  const copyId = result.adopted[0].workspaceId, copyBundle = await account.read(copyId);
  assert.deepEqual((await account.listPhotoPosts(copyId)).map(row => row.id).sort(), [savedPhoto.id, draft.id, cited.id].sort());
  const copied = await account.readPhotoPost(copyId, savedPhoto.id);
  assert.equal(copied.revision, savedPhoto.revision); assert.deepEqual(copied.ops, savedPhoto.ops);
  assert.equal(await bytes(copied.photos[0].blob), await bytes(original)); assert.equal(copied.photos[0].blob.type, 'image/heic');
  assert.equal(await bytes(copied.photos[0].view.blob), await bytes(view)); assert.equal(copied.photos[0].view.blob.type, 'image/jpeg');
  assert.equal((await account.readPhotoPost(copyId, draft.id)).status, 'draft');
  // The evidence names the copy's own exact source version, never the account-less one.
  const evidence = await account.readPostEvidence(copyId, cited.id), copyVersion = copyBundle.sourceVersions[0];
  assert.equal(evidence.refs.length, 1);
  assert.deepEqual([evidence.refs[0].workspaceId, evidence.refs[0].sourceVersionId, evidence.refs[0].quote, evidence.refs[0].contentHash],
    [copyId, copyVersion.id, ref.quote, ref.contentHash]);
  assert.notEqual(copyVersion.id, version.id);
  // The account-less originals are unchanged and still readable there.
  assert.deepEqual(originals.map(doc => legacy.raw(doc.id)), originals);
  assert.deepEqual(legacy.listed(), [savedPhoto.id, draft.id, cited.id].sort());
  assert.deepEqual(memory.rows.get('meta').get(JSON.stringify(`post-evidence:${legacy.ws}:${cited.id}`)).value.refs, [ref]);
  // A second run changes nothing.
  assert.deepEqual(await account.adoptUnownedWorkspaces(), { adopted: [], failed: [], repaired: [] });
  assert.equal((await account.listPhotoPosts(copyId)).length, 3);
});

test('an earlier adoption without posts is repaired once; posts deleted from the copy are not copied again', async () => {
  const memory = memoryIdb(), legacy = await legacyLibrary(memory), account = legacy.base.forAccount(owner);
  const kept = await legacy.write(await post({ title: '이전 채택 전에 쓴 글' }));
  const first = await account.adoptUnownedWorkspaces(), copyId = first.adopted[0].workspaceId;
  // Simulate the earlier release: the marker had no `posts` and the copy no posts.
  const meta = memory.rows.get('meta'), markerKey = [...meta.keys()].find(entry => JSON.parse(entry).startsWith('unownedAdoption:'));
  const marker = meta.get(markerKey); delete marker.value.posts;
  meta.delete(JSON.stringify(`photo-post:${copyId}:${kept.id}`)); meta.set(JSON.stringify(`photo-posts:${copyId}`), { key: `photo-posts:${copyId}`, value: [] });
  assert.deepEqual(await account.listPhotoPosts(copyId), []);
  // A post written there later, with evidence that needs the copy's version id.
  const version = legacy.bundle.sourceVersions[0];
  const ref = await Reference.build({ bundle: legacy.bundle, sourceId: version.sourceId, versionId: version.id, locator: { start: 0, end: 4 } });
  const later = await legacy.write(await post({ title: '채택 뒤 계정 없이 쓴 글', time: '2026-11-01T10:00:00.000Z' }), [ref]);
  const events = []; account.subscribeAll(event => events.push(event));

  const repair = await account.adoptUnownedWorkspaces();
  assert.deepEqual(repair.adopted, []); assert.deepEqual(repair.failed, []);
  assert.deepEqual(repair.repaired, [{ from: legacy.ws, workspaceId: copyId, posts: 2 }]);
  assert.deepEqual((await account.listPhotoPosts(copyId)).map(row => row.id).sort(), [kept.id, later.id].sort());
  assert.equal((await account.readPostEvidence(copyId, later.id)).refs[0].sourceVersionId, (await account.read(copyId)).sourceVersions[0].id);
  assert.ok(events.some(event => event.type === 'photo_posts_changed' && event.workspaceId === copyId));
  assert.equal((await account.listWorkspaces()).length, 1);

  assert.deepEqual(await account.adoptUnownedWorkspaces(), { adopted: [], failed: [], repaired: [] });
  await account.deletePhotoPost(copyId, kept.id, kept.revision);
  assert.deepEqual(await account.adoptUnownedWorkspaces(), { adopted: [], failed: [], repaired: [] });
  assert.deepEqual((await account.listPhotoPosts(copyId)).map(row => row.id), [later.id]);
  // The account-less original keeps both posts.
  assert.deepEqual(legacy.listed(), [kept.id, later.id].sort()); assert.equal(legacy.raw(kept.id).title, kept.title);
  // A post added there afterwards is copied on the next run.
  const third = await legacy.write(await post({ title: '세 번째 글', time: '2026-11-01T11:00:00.000Z' }));
  assert.deepEqual((await account.adoptUnownedWorkspaces()).repaired, [{ from: legacy.ws, workspaceId: copyId, posts: 1 }]);
  assert.deepEqual((await account.listPhotoPosts(copyId)).map(row => row.id).sort(), [later.id, third.id].sort());
});

test('adopted posts are uploaded by the account sync and reach another device', async () => {
  const cloud = server(), time = clock(), memory = memoryIdb(), legacy = await legacyLibrary(memory);
  const old = await legacy.write(await post({ title: '계정 전에 쓴 글', photos: 1 }));
  const account = legacy.base.forAccount(owner), copyId = (await account.adoptUnownedWorkspaces()).adopted[0].workspaceId;
  const Sync = require('./helpers/blog-sync-cloud.cjs').Sync, Blog = require('../assets/life/blog.js');
  const auth = { epoch: 0, verifications: 0, getAccount: () => owner, async verify() { return { id: require('./helpers/blog-sync-cloud.cjs').USER }; } };
  const sync = Sync.create({ storage: account, auth, blog: Blog, photoPost: Photo, remote: cloud.client('mac'), makeId: Core.id, locks: null, now: () => time.now, timers: { setTimeout: () => 0, clearTimeout() {} }, interval: 30000 });
  await sync.syncNow();
  assert.equal(cloud.rows.size, 1); assert.equal((await sync.getState(copyId, old.id)).status, 'synced');
  const iphone = await device(cloud, 'iphone', { time });
  await iphone.sync.syncNow();
  const received = await listAccountPosts(iphone.storage, iphone.ws);
  assert.deepEqual(received.posts.map(row => row.title), ['계정 전에 쓴 글']);
  const doc = await iphone.storage.readPhotoPost(received.posts[0].workspaceId, received.posts[0].id);
  assert.equal(await bytes(doc.photos[0].blob), await bytes(old.photos[0].blob));
});

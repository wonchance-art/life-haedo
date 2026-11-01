'use strict';
// Account-wide blog sync (2026-11-01 owner directive): every saved post and draft
// reaches every device of the account automatically; local data is never dropped.
// Real Storage per device (in-memory IDB adapter); only the synthetic server is shared.
const test = require('node:test'), assert = require('node:assert/strict');
const { server, device, clock, png, post, edit, finish, copy, Core, Photo, Blog, Sync } = require('./helpers/blog-sync-cloud.cjs');

async function pair(options = {}) {
  const cloud = server(), time = clock();
  const a = await device(cloud, 'mac', { time, ...options.a }), b = await device(cloud, 'ipad', { time, ...options.b });
  return { cloud, time, a, b };
}
async function bytes(blob) { return Buffer.from(await blob.arrayBuffer()).toString('hex'); }
async function save(dev, doc) { return dev.storage.savePhotoPost(dev.ws, doc, 0); }
const list = dev => dev.storage.listPhotoPosts(dev.ws);

test('a saved post with photos reaches the other device in place with exact originals, without publication', async () => {
  const { cloud, a, b } = await pair();
  const doc = await save(a, await post({ photos: 2 }));
  assert.equal((await a.sync.saveDefault(a.ws, doc.id, { expectedLocalRevision: doc.revision })).status, 'synced');
  assert.equal(cloud.stats.saves.length, 1); assert.equal(cloud.stats.uploads.length, 2); assert.equal(cloud.stats.publishes.length, 0);
  const status = await b.sync.syncNow();
  assert.equal(status.state, 'synced'); assert.equal(status.pending, 0);
  const rows = await list(b); assert.equal(rows.length, 1);
  assert.equal(rows[0].id, doc.id, 'received post keeps the server identity');
  const received = await b.storage.readPhotoPost(b.ws, doc.id);
  assert.equal(received.title, doc.title); assert.deepEqual(received.ops, doc.ops);
  for (const [index, photo] of doc.photos.entries()) assert.equal(await bytes(received.photos[index].blob), await bytes(photo.blob));
  assert.deepEqual(await b.sync.statuses(b.ws), { [doc.id]: 'synced' });
  assert.equal((await b.storage.readBlogSyncState(b.ws, doc.id)).publication, null);
  // A second cycle is idle: no new document writes or downloads.
  const downloads = cloud.stats.downloads; await b.sync.syncNow(); await a.sync.syncNow();
  assert.equal(cloud.stats.saves.length, 1); assert.equal(cloud.stats.downloads, downloads);
});

test('the periodic cycle uploads saved posts that were never sent, including ones paused or reserved by earlier choices', async () => {
  const { cloud, a, b } = await pair();
  const plain = await save(a, await post({ title: '그냥 저장한 글' }));
  const paused = await save(a, await post({ title: '서버 보관을 중지했던 글' }));
  await a.storage.writeBlogSyncState(a.ws, paused.id, { enabled: false, enableOnSave: false, remoteId: paused.id, remoteWorkspaceId: a.ws, remoteRevision: 0, localRevision: 0,
    remoteManifest: null, publication: null, pending: null, conflict: null, status: 'paused', error: null }, 0);
  assert.equal((await a.sync.syncNow()).state, 'synced');
  assert.deepEqual(new Set(cloud.rows.keys()), new Set([plain.id, paused.id]));
  await b.sync.syncNow();
  assert.deepEqual(new Set((await list(b)).map(row => row.title)), new Set(['그냥 저장한 글', '서버 보관을 중지했던 글']));
});

test('a later edit on one device replaces the clean copy on the other device in place', async () => {
  const { cloud, time, a, b } = await pair();
  const doc = await save(a, await post({ photos: 1 })); await a.sync.syncNow(); await b.sync.syncNow();
  const before = await b.storage.readPhotoPost(b.ws, doc.id);
  // The writer's saved-post edit is a new local identity replacing the old one.
  const draft = await edit(a, doc.id, { title: '고친 제목' }, '2026-11-01T10:00:00.000Z');
  const edited = await finish(a, draft, '2026-11-01T10:00:00.000Z');
  assert.notEqual(edited.id, doc.id);
  time.advance(60000); await a.sync.syncNow();
  assert.equal(cloud.rows.get(doc.id).data.title, '고친 제목', 'the server identity is kept across local replacement');
  assert.equal(cloud.rows.size, 1, 'the editing draft never remains as a separate server post');
  await b.sync.syncNow();
  const rows = await list(b); assert.equal(rows.length, 1); assert.equal(rows[0].id, doc.id);
  const after = await b.storage.readPhotoPost(b.ws, doc.id);
  assert.equal(after.title, '고친 제목'); assert.equal(after.revision, before.revision + 1);
  assert.equal(await bytes(after.photos[0].blob), await bytes(doc.photos[0].blob));
});

test('drafts with photos sync after the autosave quiet period, never on each keystroke, and immediately when the page hides', async () => {
  const { cloud, time, a, b } = await pair();
  const doc = await save(a, await post({ title: '쓰는 중', status: 'draft', photos: 1, time: new Date(time.now).toISOString() }));
  a.sync.noteLocalDraftSaved(doc.id);
  await a.sync.syncNow({ uploadOnly: true });
  assert.equal(cloud.stats.saves.length, 0, 'a draft committed moments ago waits');
  time.advance(3000); await a.sync.syncNow({ uploadOnly: true });
  assert.equal(cloud.stats.saves.length, 0);
  time.advance(2500); await a.sync.syncNow({ uploadOnly: true });
  assert.equal(cloud.stats.saves.length, 1); assert.equal(cloud.rows.get(doc.id).data.status, 'draft');
  const next = await a.storage.savePhotoPost(a.ws, { ...copy(await a.storage.readPhotoPost(a.ws, doc.id)), title: '쓰는 중 2', updatedAt: new Date(time.now).toISOString() }, 1);
  a.sync.noteLocalDraftSaved(next.id);
  await a.sync.syncNow({ uploadOnly: true, flushDrafts: true });
  assert.equal(cloud.rows.get(doc.id).data.title, '쓰는 중 2', 'visibility hidden flushes the waiting draft');
  await b.sync.syncNow();
  const received = await b.storage.readPhotoPost(b.ws, doc.id);
  assert.equal(received.status, 'draft'); assert.equal(received.title, '쓰는 중 2'); assert.equal(received.photos.length, 1);
  assert.equal(Sync.noteLocalDraftSaved('unknown-id'), undefined, 'the module-level editor hook is safe without live instances');
});

test('an editing draft names its target on other devices; saving it retires the draft everywhere and updates the post', async () => {
  const { cloud, time, a, b } = await pair();
  const doc = await save(a, await post()); await a.sync.syncNow(); await b.sync.syncNow();
  const draft = await edit(a, doc.id, { title: '수정 중' }, '2026-11-01T10:00:00.000Z');
  time.advance(10000); await a.sync.syncNow();
  assert.deepEqual(cloud.rows.get(draft.id).data.replaces, { id: doc.id, revision: 1 }, 'server form uses the target server identity and revision');
  await b.sync.syncNow();
  const mirrored = await b.storage.readPhotoPost(b.ws, draft.id);
  const target = await b.storage.readPhotoPost(b.ws, doc.id);
  assert.deepEqual(mirrored.replaces, { id: doc.id, revision: target.revision }, 'other device continues the same edit of its own copy');
  await finish(a, draft, '2026-11-01T10:05:00.000Z');
  time.advance(10000); await a.sync.syncNow();
  assert.equal(cloud.rows.has(draft.id), false, 'the replaced editing draft is deleted on the server');
  assert.equal(cloud.rows.get(doc.id).data.title, '수정 중');
  await b.sync.syncNow();
  const rows = await list(b); assert.deepEqual(rows.map(row => [row.id, row.status, row.title]), [[doc.id, 'saved', '수정 중']]);
});

test('both devices changed: the later document stays, the other is kept as a separate draft on every device', async () => {
  const { cloud, time, a, b } = await pair();
  const doc = await save(a, await post({ title: '원래 글' })); await a.sync.syncNow(); await b.sync.syncNow();
  const aDraft = await edit(a, doc.id, { title: '맥에서 고침' }, '2026-11-01T10:00:00.000Z'); await finish(a, aDraft, '2026-11-01T10:00:00.000Z');
  const bDraft = await edit(b, doc.id, { title: '아이패드에서 나중에 고침' }, '2026-11-01T10:30:00.000Z'); await finish(b, bDraft, '2026-11-01T10:30:00.000Z');
  time.advance(60000);
  await a.sync.syncNow(); assert.equal(cloud.rows.get(doc.id).data.title, '맥에서 고침');
  await b.sync.syncNow();
  assert.equal(cloud.rows.get(doc.id).data.title, '아이패드에서 나중에 고침', 'the later local edit wins on the server');
  const bRows = await list(b);
  assert.equal(bRows.length, 2);
  const kept = bRows.find(row => row.status === 'draft');
  assert.equal(kept.title, Sync.CONFLICT_PREFIX + '맥에서 고침', 'the earlier server version is kept as a local draft');
  await a.sync.syncNow(); await b.sync.syncNow(); await a.sync.syncNow();
  const aRows = await list(a);
  assert.deepEqual(aRows.map(row => row.title).sort(), [Sync.CONFLICT_PREFIX + '맥에서 고침', '아이패드에서 나중에 고침'].sort(), 'device A shows the winner in place and the kept draft');
  assert.equal((await a.sync.getStatus()).state, 'synced');
});

test('a newer server version wins over an older local edit, which stays as a draft copy', async () => {
  const { cloud, time, a, b } = await pair();
  const doc = await save(a, await post({ title: '원래 글' })); await a.sync.syncNow(); await b.sync.syncNow();
  const bDraft = await edit(b, doc.id, { title: '아이패드 이른 수정' }, '2026-11-01T10:00:00.000Z'); const bSaved = await finish(b, bDraft, '2026-11-01T10:00:00.000Z');
  const aDraft = await edit(a, doc.id, { title: '맥 늦은 수정' }, '2026-11-01T11:00:00.000Z'); await finish(a, aDraft, '2026-11-01T11:00:00.000Z');
  time.advance(60000); await a.sync.syncNow(); await b.sync.syncNow();
  const current = await b.storage.readPhotoPost(b.ws, bSaved.id);
  assert.equal(current.title, '맥 늦은 수정', 'remote winner applied in place of the local edit');
  const copyRow = (await list(b)).find(row => row.status === 'draft');
  assert.equal(copyRow.title, Sync.CONFLICT_PREFIX + '아이패드 이른 수정');
  assert.equal(cloud.rows.get(doc.id).data.title, '맥 늦은 수정');
});

test('an open editor holds its post: a remote edit waits and is applied after release', async () => {
  const { time, a, b } = await pair();
  const doc = await save(a, await post({ title: '초안', status: 'draft' })); time.advance(10000);
  await a.sync.syncNow(); await b.sync.syncNow();
  const release = b.sync.holdPost(b.ws, doc.id);
  await a.storage.savePhotoPost(a.ws, { ...copy(await a.storage.readPhotoPost(a.ws, doc.id)), title: '다른 기기에서 계속', updatedAt: '2026-11-01T09:30:00.000Z' }, 1);
  time.advance(10000); await a.sync.syncNow(); await b.sync.syncNow();
  assert.equal((await b.storage.readPhotoPost(b.ws, doc.id)).title, '초안', 'held document is untouched');
  release(); await b.sync.syncNow();
  assert.equal((await b.storage.readPhotoPost(b.ws, doc.id)).title, '다른 기기에서 계속');
});

test('explicit deletion removes the post and its originals on the server and on other clean devices', async () => {
  const { cloud, a, b } = await pair();
  const doc = await save(a, await post({ photos: 2 })); await a.sync.syncNow(); await b.sync.syncNow();
  assert.equal((await list(b)).length, 1);
  await a.sync.deletePost(a.ws, doc.id, { expectedRevision: doc.revision });
  assert.equal((await list(a)).length, 0);
  await a.sync.syncNow();
  assert.equal(cloud.rows.has(doc.id), false); assert.equal(cloud.stats.removed.length, 2);
  assert.equal([...cloud.assets.keys()].some(path => path.includes(doc.id)), false);
  await b.sync.syncNow();
  assert.equal((await list(b)).length, 0); assert.equal(await b.storage.readBlogSyncState(b.ws, doc.id), null);
  await a.sync.syncNow(); assert.equal((await list(a)).length, 0, 'a deleted post is never received again');
});

test('a post deleted elsewhere while this device changed it is recreated instead of dropped', async () => {
  const { cloud, time, a, b } = await pair();
  const doc = await save(a, await post()); await a.sync.syncNow(); await b.sync.syncNow();
  const draft = await edit(b, doc.id, { title: '삭제 중에 고친 내용' }, '2026-11-01T10:00:00.000Z'); const kept = await finish(b, draft, '2026-11-01T10:00:00.000Z');
  await a.sync.deletePost(a.ws, doc.id); await a.sync.syncNow(); assert.equal(cloud.rows.size, 0);
  time.advance(60000); await b.sync.syncNow();
  assert.equal((await b.storage.readPhotoPost(b.ws, kept.id)).title, '삭제 중에 고친 내용');
  assert.equal(cloud.rows.get(doc.id).data.title, '삭제 중에 고친 내용');
  await a.sync.syncNow(); assert.equal((await list(a))[0].title, '삭제 중에 고친 내용');
});

test('a published post cannot be deleted before withdrawal; publication stays explicit with no photos by default', async () => {
  const { cloud, a } = await pair();
  const doc = await save(a, await post({ photos: 1 })); await a.sync.syncNow();
  const published = await a.sync.publish(a.ws, doc.id, { expectedLocalRevision: doc.revision });
  assert.ok(published.publicUrl.includes(published.token)); assert.deepEqual(cloud.stats.publishes[0].options.photoIds, []);
  await assert.rejects(a.sync.deletePost(a.ws, doc.id), { code: 'blog_post_published' });
  assert.equal((await list(a)).length, 1);
});

test('failed uploads stay local with an error status and retry with backoff in the same loop', async () => {
  const { cloud, time, a } = await pair();
  const doc = await save(a, await post({ photos: 2 }));
  cloud.control.failUpload = () => true;
  await assert.rejects(a.sync.saveDefault(a.ws, doc.id, { expectedLocalRevision: doc.revision }), { code: 'network_error' });
  assert.equal((await a.sync.getState(a.ws, doc.id)).status, 'error');
  cloud.control.failUpload = null;
  await a.sync.syncNow(); assert.equal(cloud.rows.size, 0, 'backoff delays the next attempt');
  assert.equal(a.sync.getStatus().state, 'error');
  time.advance(31000); await a.sync.syncNow();
  assert.equal(cloud.rows.size, 1); assert.equal((await a.sync.getState(a.ws, doc.id)).status, 'synced'); assert.equal(a.sync.getStatus().state, 'synced');
  assert.equal((await a.storage.readPhotoPost(a.ws, doc.id)).revision, doc.revision, 'sync never edits the local document');
});

test('a lost save acknowledgement replays the same operation without a second revision', async () => {
  const { cloud, a } = await pair();
  const doc = await save(a, await post({ photos: 1 }));
  cloud.control.loseSave = true;
  await assert.rejects(a.sync.saveDefault(a.ws, doc.id, { expectedLocalRevision: doc.revision }), { code: 'network_error' });
  const pending = (await a.storage.readBlogSyncState(a.ws, doc.id)).pending;
  a.time.advance(31000); await a.sync.syncNow();
  assert.equal(cloud.rows.get(doc.id).revision, 1);
  assert.equal(cloud.stats.saves.at(-1).operationId, pending.operationId);
  assert.equal(cloud.stats.uploads.length, 1, 'originals are not uploaded twice');
});

test('legacy received copies keep their local id; duplicate copies of one server post become separate posts', async () => {
  const { cloud, a, b } = await pair();
  const doc = await save(a, await post({ title: '서버 글' })); await a.sync.syncNow();
  const row = cloud.rows.get(doc.id);
  const legacy = await save(b, { ...copy(doc), id: Core.id(), revision: 0 });
  const extra = await save(b, { ...copy(doc), id: Core.id(), revision: 0, title: '예전에 새 사본으로 받은 글' });
  const binding = { enabled: true, remoteId: doc.id, remoteWorkspaceId: row.workspace_id, remoteRevision: 1, remoteManifest: row.data, publication: null, pending: null, conflict: null, status: 'synced', error: null };
  await b.storage.writeBlogSyncState(b.ws, legacy.id, { ...binding, localRevision: legacy.revision }, 0);
  await b.storage.writeBlogSyncState(b.ws, extra.id, { ...binding, enabled: false, status: 'paused', localRevision: 0 }, 0);
  await b.sync.syncNow();
  assert.equal((await list(b)).length, 2, 'no new installation of an already received post');
  assert.equal((await b.storage.readBlogSyncState(b.ws, legacy.id)).remoteId, doc.id);
  assert.equal((await b.storage.readBlogSyncState(b.ws, extra.id)).remoteId, extra.id);
  assert.equal(cloud.rows.get(extra.id).data.title, '예전에 새 사본으로 받은 글');
  await a.sync.syncNow(); assert.equal((await list(a)).length, 2);
});

test('an account change during an upload cancels the commit and keeps the post queued', async () => {
  const { cloud, a } = await pair();
  const doc = await save(a, await post({ photos: 1 }));
  let release; cloud.control.holdUpload = { promise: new Promise(done => { release = done; }) };
  const running = a.sync.saveDefault(a.ws, doc.id, { expectedLocalRevision: doc.revision });
  await new Promise(done => setImmediate(done)); a.auth.epoch++; release();
  await assert.rejects(running, { code: 'request_cancelled' });
  assert.equal(cloud.stats.saves.length, 0); assert.equal((await list(a)).length, 1);
});

test('one network account check per cycle, independent of the number of posts and photos', async () => {
  const { a, b } = await pair();
  for (let n = 0; n < 3; n++) await save(a, await post({ title: '글 ' + n, photos: 3 }));
  const before = a.auth.verifications; await a.sync.syncNow();
  assert.equal(a.auth.verifications - before, 1);
  const received = b.auth.verifications; await b.sync.syncNow();
  assert.equal(b.auth.verifications - received, 1); assert.equal((await list(b)).length, 3);
});

test('HEIC originals upload with their JPEG view as separate assets and are restored together', async () => {
  const { cloud, a, b } = await pair();
  const original = new Blob([Buffer.from('000000186674797068656963000000006d69663168656963', 'hex'), new Uint8Array(40)], { type: 'image/heic' });
  const view = new Blob([Uint8Array.from([255, 216, 255, 224, 9, 1, 2, 3, 255, 217])], { type: 'image/jpeg' });
  const photoId = Core.id(), doc = await post({ title: '아이폰 사진' });
  doc.photos = [{ id: photoId, name: 'IMG_0001.HEIC', type: 'image/heic', width: 4032, height: 3024, size: original.size, digest: await Photo.digest(original), blob: original,
    view: { type: 'image/jpeg', size: view.size, digest: await Photo.digest(view), width: 4032, height: 3024, blob: view } }];
  doc.ops = [{ insert: '본문\n' }, { insert: { photo: { id: photoId, caption: '', alt: '' } } }, { insert: '\n' }];
  const saved = await save(a, doc); await a.sync.syncNow();
  assert.deepEqual(cloud.stats.uploads.map(item => [item.id, item.type]), [[photoId, 'image/heic'], [photoId, 'image/jpeg']]);
  assert.equal(cloud.rows.get(saved.id).data.photos[0].view.digest, doc.photos[0].view.digest);
  assert.equal(Object.hasOwn(cloud.rows.get(saved.id).data.photos[0].view, 'blob'), false);
  await b.sync.syncNow();
  const received = await b.storage.readPhotoPost(b.ws, saved.id);
  assert.equal(await bytes(received.photos[0].blob), await bytes(original));
  assert.equal(await bytes(received.photos[0].view.blob), await bytes(view)); assert.equal(received.photos[0].view.blob.type, 'image/jpeg');
});

test('same-workspace devices receive into that workspace; a corrupted server original is refused and retried later', async () => {
  const cloud = server(), time = clock(), a = await device(cloud, 'mac', { time });
  const b = await device(cloud, 'iphone', { time, workspace: await a.storage.read(a.ws) });
  assert.equal(b.ws, a.ws);
  const doc = await save(a, await post({ photos: 1 })); await a.sync.syncNow();
  const path = [...cloud.assets.keys()][0], good = cloud.assets.get(path).blob;
  cloud.assets.get(path).blob = new Blob([new Uint8Array(good.size)], { type: 'image/png' });
  await b.sync.syncNow(); assert.equal((await list(b)).length, 0); assert.equal(b.sync.getStatus().state, 'error');
  cloud.assets.get(path).blob = good; time.advance(31000); await b.sync.syncNow();
  assert.equal((await list(b))[0].id, doc.id);
});

test('a page entering the back/forward cache starts no transfer or account check until pageshow', async () => {
  // Work begun at a persisted pagehide (or the visibility changes around it)
  // runs script in the cached page, which evicts it, and starts an account check
  // that the resumed page could share before its own verification.
  const { cloud, time, a } = await pair();
  const events = new EventTarget(); events.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const sync = Sync.create({ storage: a.storage, auth: a.auth, blog: Blog, photoPost: Photo, remote: cloud.client('mac-page'), makeId: Core.id,
    locks: null, now: () => time.now, timers: { setTimeout: () => 0, clearTimeout() {} }, events, interval: 30000 });
  const page = (type, persisted) => events.dispatchEvent(Object.assign(new Event(type), { persisted }));
  const settle = async () => { for (let n = 0; n < 20; n++) await new Promise(done => setImmediate(done)); };
  sync.start();
  // The first cycle starts with start(); let it finish so its account check is
  // not counted as one begun by the cached page.
  await sync.syncNow(); await settle();
  const doc = await save(a, await post({ title: '떠나기 직전 초안', status: 'draft', photos: 1, time: new Date(time.now).toISOString() }));
  await settle();
  const before = a.auth.verifications;
  page('pagehide', true);
  events.document.visibilityState = 'hidden'; events.document.dispatchEvent(new Event('visibilitychange'));
  await sync.syncNow({ uploadOnly: true, flushDrafts: true }); await settle();
  assert.equal(a.auth.verifications, before, 'no account check from the cached page');
  assert.equal(cloud.stats.saves.length, 0, 'no transfer from the cached page');
  page('pageshow', true); events.document.visibilityState = 'visible';
  await sync.syncNow({ uploadOnly: true, flushDrafts: true });
  assert.equal(a.auth.verifications, before + 1); assert.equal(cloud.rows.get(doc.id).data.title, '떠나기 직전 초안');
  // An ordinary (non-cached) pagehide still flushes the waiting draft.
  const next = await a.storage.savePhotoPost(a.ws, { ...copy(await a.storage.readPhotoPost(a.ws, doc.id)), title: '닫기 직전 초안', updatedAt: new Date(time.now).toISOString() }, 1);
  page('pagehide', false);
  // The flush is asynchronous (photo transfer, then the document); wait for the
  // stored result itself rather than a fixed number of turns.
  for (let n = 0; n < 2000 && cloud.rows.get(next.id)?.data.title !== '닫기 직전 초안'; n++) await new Promise(done => setImmediate(done));
  assert.equal(cloud.rows.get(next.id).data.title, '닫기 직전 초안');
  sync.dispose();
});

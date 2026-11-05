'use strict';
// 2026-11-01 independent review of automatic account blog sync: deletion only
// of the exact revision a device saw (B1), a draft finished on another device
// (M1, decided by latest wins since 2026-11-02), conflict state cleared when
// the server wins (M2), no hidden polling (m2).
const test = require('node:test'), assert = require('node:assert/strict');
const { server, device, clock, post, edit, finish, Core, Photo, Blog, Sync, memoryIdb, owner, USER } = require('./helpers/blog-sync-cloud.cjs');
const { createStorage } = require('../assets/life/storage.js');

async function pair() {
  const cloud = server(), time = clock();
  return { cloud, time, a: await device(cloud, 'mac', { time }), b: await device(cloud, 'ipad', { time }) };
}
const save = (dev, doc) => dev.storage.savePhotoPost(dev.ws, doc, 0);
const list = dev => dev.storage.listPhotoPosts(dev.ws);

test('B1: a stale device deletes only the revision it saw; the newer edit survives and returns to the deleting device', async () => {
  const { cloud, time, a, b } = await pair();
  const doc = await save(a, await post({ title: '원래 글' })); await a.sync.syncNow(); await b.sync.syncNow();
  const bDraft = await edit(b, doc.id, { title: '아이패드 새 수정' }, '2026-11-01T11:00:00.000Z'); await finish(b, bDraft, '2026-11-01T11:00:00.000Z');
  await b.sync.syncNow(); assert.equal(cloud.rows.get(doc.id).revision, 2);
  await a.sync.deletePost(a.ws, doc.id);
  await a.sync.syncNow();
  assert.deepEqual(cloud.stats.deletes.map(call => [call.postId, call.expected]), [[doc.id, 1]], 'deletion names the exact revision 1 the deleting device saw');
  assert.equal(cloud.rows.get(doc.id).data.title, '아이패드 새 수정', 'the newer edit is never erased');
  assert.deepEqual((await a.storage.listBlogSyncStates(a.ws)).tombstones, [], 'the refused deletion is dropped');
  await a.sync.syncNow();
  assert.deepEqual((await list(a)).map(row => row.title), ['아이패드 새 수정'], 'the deleting device receives the newer version again');
  time.advance(60000); await b.sync.syncNow();
  assert.deepEqual((await list(b)).map(row => row.title), ['아이패드 새 수정']);
});

test('B1: a post published on another device is never deleted by a device that thinks it is private', async () => {
  const { cloud, a, b } = await pair();
  const doc = await save(a, await post({ title: '공개될 글' })); await a.sync.syncNow(); await b.sync.syncNow();
  await b.sync.publish(b.ws, doc.id, { expectedLocalRevision: (await b.storage.readPhotoPost(b.ws, doc.id)).revision });
  assert.equal(cloud.rows.get(doc.id).publication.active, true);
  assert.equal((await a.storage.readBlogSyncState(a.ws, doc.id)).publication, null, 'A has not seen the publication yet');
  await a.sync.deletePost(a.ws, doc.id); await a.sync.syncNow();
  assert.equal(cloud.rows.has(doc.id), true); assert.equal(cloud.rows.get(doc.id).publication.active, true);
  await a.sync.syncNow();
  assert((await list(a)).some(row => row.id === doc.id), 'the public post returns to the deleting device');
  assert.equal((await a.storage.readBlogSyncState(a.ws, doc.id)).publication.active, true);
  await assert.rejects(a.sync.deletePost(a.ws, doc.id), { code: 'blog_post_published' }, 'now refused locally too until withdrawn');
});

test('B1: the deleting device\'s own unacknowledged revision is still deleted', async () => {
  const { cloud, a } = await pair();
  const doc = await save(a, await post({ title: '보낸 직후 지울 글' })); await a.sync.syncNow();
  const draft = await edit(a, doc.id, { title: '응답을 못 받은 수정' }, '2026-11-01T11:00:00.000Z'); const edited = await finish(a, draft, '2026-11-01T11:00:00.000Z');
  cloud.control.loseSave = true;
  await assert.rejects(a.sync.saveDefault(a.ws, edited.id, { expectedLocalRevision: edited.revision }), { code: 'network_error' });
  assert.equal(cloud.rows.get(doc.id).revision, 2);
  await a.sync.deletePost(a.ws, edited.id); await a.sync.syncNow();
  assert.equal(cloud.rows.has(doc.id), false, 'revision 2 was this device\'s own request');
  assert.deepEqual(cloud.stats.deletes.map(call => call.expected), [1, 2]);
});

// 2026-11-02 owner decision: latest wins with no exception for saved posts.
// These two cases used to assert the removed exception (a post finished on
// another device always beat a later draft, `finishedElsewhere`). They now
// assert the latest-wins outcome for the same situations: the saved post stays
// in place, the later draft becomes its editing draft and the saved content is
// also kept as a recovery copy. They keep their original purpose: the server's
// refusal to turn a saved post back into a draft is decided once, without an
// error or a retry loop.
test('M1: a later draft wins over a post finished on another device as that post\'s editing draft, without an error loop', async () => {
  const { cloud, time, a, b } = await pair();
  const draft = await save(a, await post({ title: '쓰는 중', status: 'draft', time: '2026-11-01T09:00:00.000Z' }));
  time.advance(60000); await a.sync.syncNow({ flushDrafts: true }); await b.sync.syncNow();
  const aCur = await a.storage.readPhotoPost(a.ws, draft.id);
  const finished = await a.storage.savePhotoPost(a.ws, { ...aCur, status: 'saved', title: '완성', updatedAt: '2026-11-01T10:00:00.000Z' }, aCur.revision);
  await a.sync.saveDefault(a.ws, finished.id, { expectedLocalRevision: finished.revision });
  const bCur = await b.storage.readPhotoPost(b.ws, draft.id);
  await b.storage.savePhotoPost(b.ws, { ...bCur, title: '맥에서 더 쓴 초안', updatedAt: '2026-11-01T10:05:00.000Z' }, bCur.revision);
  for (let i = 0; i < 3; i++) { time.advance(20 * 60000); await b.sync.syncNow({ flushDrafts: true }); }
  const rows = await list(b), x = await b.storage.readPhotoPost(b.ws, draft.id);
  assert.deepEqual(rows.map(row => [row.status, row.title]).sort(), [['draft', '맥에서 더 쓴 초안'], ['draft', '복구 사본 · 완성'], ['saved', '완성']]);
  assert.equal(x.status, 'saved', 'the server identity never returns to a draft'); assert.equal(x.title, '완성', 'the saved post keeps its place and title');
  const winner = await b.storage.readPhotoPost(b.ws, rows.find(row => row.title === '맥에서 더 쓴 초안').id);
  assert.deepEqual(winner.replaces, { id: draft.id, revision: x.revision }, 'the later draft edits the saved post');
  assert.equal((await b.sync.getState(b.ws, draft.id)).status, 'synced'); assert.equal(b.sync.getStatus().state, 'synced');
  assert.equal(cloud.rows.get(draft.id).data.status, 'saved'); assert.equal(cloud.rows.get(draft.id).data.title, '완성');
  assert.deepEqual(cloud.rows.get(winner.id).data.replaces, { id: draft.id, revision: cloud.rows.get(draft.id).revision }, 'the server copy of the draft names the exact saved revision');
  const count = () => cloud.stats.saves.filter(call => call.device === 'ipad').length, saves = count();
  time.advance(20 * 60000); await b.sync.syncNow();
  assert.equal(count(), saves, 'no repeated rejected request');
  await a.sync.syncNow({ flushDrafts: true });
  assert.deepEqual((await list(a)).map(row => [row.status, row.title]).sort(), [['draft', '맥에서 더 쓴 초안'], ['draft', '복구 사본 · 완성'], ['saved', '완성']], 'the finishing device ends with the same posts');
  const atA = await a.storage.readPhotoPost(a.ws, winner.id);
  assert.deepEqual(atA.replaces, { id: draft.id, revision: (await a.storage.readPhotoPost(a.ws, draft.id)).revision }, 'and the same editing link');
});

test('M1: the same refusal reached without a revision conflict is decided once, not retried forever', async () => {
  const { cloud, time, a, b } = await pair();
  const draft = await save(a, await post({ title: '쓰는 중', status: 'draft', time: '2026-11-01T09:00:00.000Z' }));
  time.advance(60000); await a.sync.syncNow({ flushDrafts: true }); await b.sync.syncNow();
  // The server row turns saved without B's binding noticing a new revision.
  const row = cloud.rows.get(draft.id); row.data = { ...row.data, status: 'saved', title: '다른 기기 완성', updatedAt: '2026-11-01T09:30:00.000Z' };
  const bCur = await b.storage.readPhotoPost(b.ws, draft.id);
  await b.storage.savePhotoPost(b.ws, { ...bCur, title: '이 기기 초안', updatedAt: '2026-11-01T10:05:00.000Z' }, bCur.revision);
  time.advance(20 * 60000); await b.sync.syncNow({ flushDrafts: true });
  const rows = await list(b);
  assert.equal(rows.find(r => r.id === draft.id).status, 'saved'); assert.equal(rows.find(r => r.id === draft.id).title, '다른 기기 완성');
  assert(rows.some(r => r.status === 'draft' && r.title === '이 기기 초안'), 'the later draft stays current');
  assert(rows.some(r => r.status === 'draft' && r.title === '복구 사본 · 다른 기기 완성'));
  assert.notEqual(b.sync.getStatus().state, 'error');
  time.advance(20 * 60000); await b.sync.syncNow();
  assert.equal(cloud.rows.get(draft.id).data.title, '다른 기기 완성', 'the saved server version stays in place, unrenamed');
  assert.equal(cloud.rows.get(draft.id).data.status, 'saved');
  const refused =() => cloud.stats.saves.filter(call => call.device === 'ipad' && call.postId === draft.id && call.data.status === 'draft').length;
  const count = () => cloud.stats.saves.filter(call => call.device === 'ipad').length, saves = count();
  time.advance(20 * 60000); await b.sync.syncNow();
  assert.equal(count(), saves, 'nothing is sent again once decided');
  assert.equal(refused(), 1, 'the refused draft request was sent once');
});

test('M2: when the server version wins, the conflict clears its retry state and ends synced', async () => {
  const { cloud, time, a, b } = await pair();
  const doc = await save(a, await post({ title: '원래 글' })); await a.sync.syncNow(); await b.sync.syncNow();
  const bDraft = await edit(b, doc.id, { title: '아이패드 이른 수정' }, '2026-11-01T10:00:00.000Z'); const bSaved = await finish(b, bDraft, '2026-11-01T10:00:00.000Z');
  cloud.control.failSave = () => true; await b.sync.syncNow(); cloud.control.failSave = null;
  assert.equal((await b.sync.getState(b.ws, bSaved.id)).status, 'error');
  const aDraft = await edit(a, doc.id, { title: '맥 늦은 수정' }, '2026-11-01T11:00:00.000Z'); await finish(a, aDraft, '2026-11-01T11:00:00.000Z'); await a.sync.syncNow();
  time.advance(10 * 60000);
  const state = await b.sync.save(b.ws, bSaved.id);
  assert.equal(state.status, 'synced'); assert.equal((await b.storage.readPhotoPost(b.ws, bSaved.id)).title, '맥 늦은 수정');
  await b.sync.syncNow(); assert.equal(b.sync.getStatus().state, 'synced'); assert.equal(b.sync.getStatus().errors, 0);
});

test('m2: no polling while the page is hidden; the hidden flush runs once and visibility resumes the cycle', async () => {
  const { a } = await pair(), timers = [], listeners = {};
  const doc = { visibilityState: 'visible', addEventListener(name, handler) { listeners['doc:' + name] = handler; }, removeEventListener() {} };
  const events = { document: doc, addEventListener(name, handler) { listeners[name] = handler; }, removeEventListener() {} };
  const sync = Sync.create({ storage: a.storage, auth: a.auth, blog: Blog, photoPost: Photo, remote: a.remote, makeId: Core.id, locks: null, now: () => a.time.now, events,
    timers: { setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {} } });
  sync.start();
  const before = a.auth.verifications;
  doc.visibilityState = 'hidden'; timers.at(-1)(); await new Promise(done => setTimeout(done, 20));
  assert.equal(a.auth.verifications, before, 'a hidden page does not poll');
  listeners['doc:visibilitychange'](); await new Promise(done => setTimeout(done, 100));
  assert.equal(a.auth.verifications, before + 1, 'hiding flushes once');
  doc.visibilityState = 'visible'; listeners['doc:visibilitychange'](); timers.at(-1)(); await new Promise(done => setTimeout(done, 100));
  assert(a.auth.verifications > before + 1, 'becoming visible resumes the cycle');
  sync.dispose();
});

test('m2: a hidden page still uploads a kept conflict copy and other waiting changes, without pulling the server list', async () => {
  const { cloud, time, a, b } = await pair(), timers = [];
  const doc = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  const events = { document: doc, addEventListener() {}, removeEventListener() {} };
  const post0 = await save(a, await post({ title: '원래 글' })); await a.sync.syncNow(); await b.sync.syncNow();
  // B saves later; A's earlier edit loses and is kept as a separate draft on A.
  const aDraft = await edit(a, post0.id, { title: '맥 이른 수정' }, '2026-11-01T10:00:00.000Z'); const aSaved = await finish(a, aDraft, '2026-11-01T10:00:00.000Z');
  const bDraft = await edit(b, post0.id, { title: '아이패드 늦은 수정' }, '2026-11-01T11:00:00.000Z'); await finish(b, bDraft, '2026-11-01T11:00:00.000Z'); await b.sync.syncNow();
  const sync = Sync.create({ storage: a.storage, auth: a.auth, blog: Blog, photoPost: Photo, remote: a.remote, makeId: Core.id, locks: null, now: () => time.now, events,
    timers: { setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {} } });
  sync.start(); doc.visibilityState = 'hidden';
  const originalList = a.remote.syncList; let listCalls = 0; a.remote.syncList = async (...args) => { listCalls++; return originalList.apply(a.remote, args); };
  const kept = Sync.CONFLICT_PREFIX + '맥 이른 수정';
  for (let n = 0; n < 6 && ![...cloud.rows.values()].some(row => row.data.title === kept); n++) { timers.at(-1)(); await new Promise(done => setTimeout(done, 60)); }
  assert.equal(cloud.rows.get(post0.id).data.title, '아이패드 늦은 수정', 'the later edit stays on the server');
  assert([...cloud.rows.values()].some(row => row.data.status === 'draft' && row.data.title === kept), 'the kept conflict copy reached the account while hidden');
  assert.equal((await a.storage.readPhotoPost(a.ws, aSaved.id)).title, '아이패드 늦은 수정');
  assert.equal(listCalls, 0, 'a hidden page never pulls the server list');
  const quiet = a.auth.verifications; timers.at(-1)(); await new Promise(done => setTimeout(done, 60));
  assert.equal(a.auth.verifications, quiet, 'with nothing waiting, a hidden page makes no request');
  a.remote.syncList = originalList; sync.dispose();
});

test('an upload-only request that arrives while a cycle runs stays upload-only; a full request still wins the merge', async () => {
  // Reproduces the loaded-CI failure of the hidden-page test deterministically:
  // a second hidden flush landing on a running cycle used to queue a full rerun
  // (rerun was null, so `!!rerun?.uploadOnly` read false) and pulled the list.
  const { time, a } = await pair(), timers = [];
  const events = { document: { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} }, addEventListener() {}, removeEventListener() {} };
  const make = () => Sync.create({ storage: a.storage, auth: a.auth, blog: Blog, photoPost: Photo, remote: a.remote, makeId: Core.id, locks: null, now: () => time.now, events,
    timers: { setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {} } });
  const originalList = a.remote.syncList; let listCalls = 0; a.remote.syncList = async (...args) => { listCalls++; return originalList.apply(a.remote, args); };
  let sync = make(), checks = a.auth.verifications;
  const first = sync.syncNow({ uploadOnly: true, flushDrafts: true }), second = sync.syncNow({ uploadOnly: true });
  await first; await second;
  assert.equal(listCalls, 0, 'two overlapping upload-only requests never pull the server list');
  assert.equal(a.auth.verifications - checks, 2, 'the queued upload-only request still runs its own cycle');
  sync.dispose();
  sync = make(); listCalls = 0;
  const upload = sync.syncNow({ uploadOnly: true }), full = sync.syncNow();
  await upload; await full;
  assert.equal(listCalls, 1, 'a full request queued behind an upload-only cycle still pulls the list once');
  sync.dispose();
  sync = make(); listCalls = 0; checks = a.auth.verifications;
  const fullFirst = sync.syncNow(), uploadAfter = sync.syncNow({ uploadOnly: true });
  await fullFirst; await uploadAfter;
  assert.equal(listCalls, 1, 'an upload-only request queued behind a full cycle does not pull the list again');
  assert.equal(a.auth.verifications - checks, 2, 'the queued upload-only request still runs its own cycle');
  sync.dispose();
  a.remote.syncList = originalList;
});

test('a conflict copy made during a cycle is uploaded by the next cycle at once, not after the regular interval', async () => {
  const { cloud, time, a, b } = await pair(), timers = [];
  const events = { document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }, addEventListener() {}, removeEventListener() {} };
  const post0 = await save(a, await post({ title: '원래 글' })); await a.sync.syncNow(); await b.sync.syncNow();
  const aDraft = await edit(a, post0.id, { title: '맥 이른 수정' }, '2026-11-01T10:00:00.000Z'); await finish(a, aDraft, '2026-11-01T10:00:00.000Z');
  const bDraft = await edit(b, post0.id, { title: '아이패드 늦은 수정' }, '2026-11-01T11:00:00.000Z'); await finish(b, bDraft, '2026-11-01T11:00:00.000Z'); await b.sync.syncNow();
  const sync = Sync.create({ storage: a.storage, auth: a.auth, blog: Blog, photoPost: Photo, remote: a.remote, makeId: Core.id, locks: null, now: () => time.now, events,
    timers: { setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {} } });
  sync.start();
  await sync.syncNow(); // resolves the conflict and keeps A's edit as a new local draft
  const kept = Sync.CONFLICT_PREFIX + '맥 이른 수정';
  assert((await list(a)).some(row => row.title === kept));
  assert.equal(timers.at(-1).delay, 1000, 'the follow-up cycle is scheduled within a second');
  timers.at(-1).fn(); for (let n = 0; n < 40 && ![...cloud.rows.values()].some(row => row.data.title === kept); n++) await new Promise(done => setTimeout(done, 25));
  assert([...cloud.rows.values()].some(row => row.data.status === 'draft' && row.data.title === kept), 'the kept draft reached the account');
  sync.dispose();
});

// 2026-11-03 CI (PR #183): a new device listed the account's posts before its
// first library was stored, skipped them and waited the whole 30 s interval.
test('posts listed before this device has a library are looked for again within a second, backing off, then received', async () => {
  const cloud = server(), time = clock(), a = await device(cloud, 'mac', { time });
  const doc = await save(a, await post({ title: '다른 기기의 글', photos: 1 })); await a.sync.syncNow();
  const storage = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: owner }), timers = [];
  const auth = { epoch: 0, getAccount: () => owner, async verify() { return { id: USER }; } };
  const events = { document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }, addEventListener() {}, removeEventListener() {} };
  const sync = Sync.create({ storage, auth, blog: Blog, photoPost: Photo, remote: cloud.client('new-phone'), makeId: Core.id, locks: null, now: () => time.now, events, interval: 30000,
    timers: { setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {} } });
  sync.start();
  await sync.syncNow(); assert.equal(timers.at(-1).delay, 500, 'no library yet: the next look is soon');
  await sync.syncNow(); assert.equal(timers.at(-1).delay, 1000, 'still none: it backs off');
  const ws = (await storage.createWorkspace('새 기기 자료')).workspaceId;
  await sync.syncNow();
  assert.deepEqual((await storage.listPhotoPosts(ws)).map(row => row.id), [doc.id], 'the post arrives once a library exists');
  assert.equal(timers.at(-1).delay, 30000, 'nothing waiting: the regular interval again');
  sync.dispose();
});

// 2026-11-03 independent review (M1): the bounded receive keeps its limits, frees them on
// failure and takes the newest saved posts first. Each case fails when that rule is removed.
const within = (promise, ms, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Error(label + ' stalled')), ms))]);
async function seeded(n, photos) {
  const cloud = server(), time = clock(), a = await device(cloud, 'mac', { time }), b = await device(cloud, 'ipad', { time }), docs = [];
  for (let i = 0; i < n; i++) docs.push(await save(a, await post({ title: '글 ' + i, photos, time: new Date(Date.UTC(2026, 10, 1, 9, i)).toISOString() })));
  assert.equal((await a.sync.syncNow()).state, 'synced');
  return { cloud, time, a, b, docs };
}
const hex = async blob => Buffer.from(await blob.arrayBuffer()).toString('hex');

test('receive: failed photo downloads free every transfer slot, never exceed the limit, and a later cycle receives each post exactly', async () => {
  const { time, b, docs } = await seeded(9, 2), original = b.remote.downloadAsset;
  let live = 0, peak = 0;
  b.remote.downloadAsset = async () => { live++; peak = Math.max(peak, live); try { await new Promise(done => setTimeout(done, 2)); throw Object.assign(Error('offline'), { code: 'network_error' }); } finally { live--; } };
  await within(b.sync.syncNow(), 5000, 'failing cycle');
  assert.equal((await list(b)).length, 0, 'nothing is half installed');
  b.remote.downloadAsset = async asset => { live++; peak = Math.max(peak, live); try { await new Promise(done => setTimeout(done, 2)); return await original.call(b.remote, asset); } finally { live--; } };
  time.advance(10 * 60 * 1000);
  assert.equal((await within(b.sync.syncNow({ force: true }), 5000, 'retry cycle')).state, 'synced', 'slots released by the failures serve the retry');
  assert(peak <= 6, 'at most six photo transfers at once, saw ' + peak); assert(peak > 2, 'photos of several posts are fetched together, saw ' + peak);
  for (const doc of docs) { const got = await b.storage.readPhotoPost(b.ws, doc.id); for (const [i, photo] of doc.photos.entries()) assert.equal(await hex(got.photos[i].blob), await hex(photo.blob)); }
});

test('receive: saved posts arrive newest first', async () => {
  const { b, docs } = await seeded(6, 0), order = [], read = b.remote.read;
  b.remote.read = async id => { order.push(id); return read.call(b.remote, id); };
  await b.sync.syncNow();
  assert.deepEqual(order.slice(0, 4), [...docs].reverse().map(doc => doc.id).slice(0, 4));
});

test('receive: a byte budget makes further posts wait while the ones being received hold it', async () => {
  const { cloud, time, b, docs } = await seeded(5, 2);
  const make = receiveBytes => Sync.create({ storage: b.storage, auth: b.auth, blog: Blog, photoPost: Photo, remote: b.remote, makeId: Core.id, locks: null, now: () => time.now, timers: { setTimeout: () => 0, clearTimeout() {} }, interval: 30000, receiveBytes });
  const original = b.remote.downloadAsset, active = new Map(); let peakPosts = 0, peakFiles = 0, live = 0, failing = true;
  b.remote.downloadAsset = async asset => {
    const post = asset.path.split('/')[1]; active.set(post, (active.get(post) || 0) + 1); peakPosts = Math.max(peakPosts, active.size); live++; peakFiles = Math.max(peakFiles, live);
    try { await new Promise(done => setTimeout(done, 3)); if (failing) throw Object.assign(Error('offline'), { code: 'network_error' }); return await original.call(b.remote, asset); }
    finally { live--; const left = active.get(post) - 1; if (left) active.set(post, left); else active.delete(post); }
  };
  const tight = make(1);
  await within(tight.syncNow(), 5000, 'failing cycle'); assert.equal((await list(b)).length, 0);
  failing = false; time.advance(10 * 60 * 1000);
  await within(tight.syncNow({ force: true }), 5000, 'retry after failures (the budget was given back)'); tight.dispose();
  assert.equal(peakPosts, 1, 'over the budget one post is received at a time');
  assert.equal(peakFiles, 2, 'the photos of that one post still download together');
  assert.equal((await list(b)).length, docs.length); assert.equal(cloud.rows.size, docs.length);
});

// 2026-11-04 (PR183 re-review minor): after dispose, files still waiting for a transfer slot
// are not fetched; only those already started finish. Fails when the slot check is removed.
test('receive: dispose stops queued photo downloads; only the ones already started finish', async () => {
  const { b } = await seeded(6, 2), original = b.remote.downloadAsset, gates = [];
  let started = 0;
  b.remote.downloadAsset = async asset => { started++; await new Promise(done => gates.push(done)); return original.call(b.remote, asset); };
  const cycle = b.sync.syncNow();
  for (let i = 0; i < 200 && started < 6; i++) await new Promise(done => setTimeout(done, 1));
  assert.equal(started, 6, 'six transfers start, the rest wait for a slot');
  b.sync.dispose();
  gates.splice(0).forEach(done => done());
  await within(cycle, 5000, 'disposed cycle');
  for (let i = 0; i < 20; i++) await new Promise(done => setTimeout(done, 1));
  assert.equal(started, 6, 'no queued file is fetched after dispose');
  assert.equal(gates.length, 0);
});

const deferredValue = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
// 2026-11-04 startup latency: the server list is requested together with the cycle's account
// check, read only after the check passes, and requested again when the cycle sent anything first.
test('receive: the post list overlaps the account check and is used only after it passes', async () => {
  const { b, docs } = await seeded(2, 0), order = [], gate = deferredValue();
  const listed = b.remote.syncList, verify = b.auth.verify;
  b.remote.syncList = async () => { order.push('list'); return listed.call(b.remote); };
  b.auth.verify = async () => { order.push('verify:start'); await gate.promise; order.push('verify:end'); return verify.call(b.auth); };
  const cycle = b.sync.syncNow();
  for (let i = 0; i < 20 && !order.includes('list'); i++) await new Promise(done => setTimeout(done, 1));
  assert.deepEqual(order, ['list', 'verify:start'], 'the list is on its way while the account is checked');
  assert.equal((await list(b)).length, 0, 'nothing is installed before the check passes');
  gate.resolve(); await cycle;
  assert.equal(order.filter(x => x === 'list').length, 1, 'one list request per cycle');
  assert.deepEqual((await list(b)).map(row => row.id).sort(), docs.map(doc => doc.id).sort());
});
test('receive: a cycle that sends a post first lists again after sending', async () => {
  const { b, docs } = await seeded(1, 0), order = [];
  await b.sync.syncNow();
  await save(b, await post({ title: '이 기기의 새 글', photos: 0 }));
  const listed = b.remote.syncList, saveRemote = b.remote.save;
  b.remote.syncList = async () => { order.push('list'); return listed.call(b.remote); };
  b.remote.save = async (...args) => { order.push('save'); return saveRemote.apply(b.remote, args); };
  assert.equal((await b.sync.syncNow()).state, 'synced');
  assert.deepEqual(order, ['list', 'save', 'list'], 'the early list is set aside once this cycle sent a post');
  assert.equal((await list(b)).length, docs.length + 1);
});
test('receive: when the account check fails nothing from the early list is installed', async () => {
  const { b } = await seeded(2, 0);
  b.auth.verify = async () => ({ id: '99999999-9999-4999-8999-999999999999' });
  await b.sync.syncNow();
  assert.equal((await list(b)).length, 0);
  assert.notEqual(b.sync.getStatus().lastError, null);
});

// #185 review minor 3: publishing and withdrawing keep the post's remoteRevision, so a list read
// before this device withdrew (the early list, or any list racing the change) must not put the
// older publication back.
test('receive: a list row with an older publication never replaces the one this device recorded later', async () => {
  const cloud = server(), time = clock(), a = await device(cloud, 'mac', { time });
  const doc = await save(a, await post({ title: '공개했다가 철회한 글' })); await a.sync.syncNow();
  await a.sync.publish(a.ws, doc.id, { expectedLocalRevision: doc.revision });
  const listed = a.remote.syncList, stale = await listed.call(a.remote);
  assert.equal(stale[0].publication.active, true);
  await a.sync.unpublish(a.ws, doc.id);
  const withdrawn = (await a.storage.readBlogSyncState(a.ws, doc.id)).publication;
  assert.equal(withdrawn.active, false);
  a.remote.syncList = async () => structuredClone(stale);
  await a.sync.syncNow();
  const after = (await a.storage.readBlogSyncState(a.ws, doc.id)).publication;
  assert.equal(after.active, false, 'the withdrawn post is not shown as public again');
  assert.equal(after.revision, withdrawn.revision);
  // A newer publication from another device is still taken from the list.
  a.remote.syncList = listed;
  const row = cloud.rows.get(stale[0].id); row.publication = { ...row.publication, active: true, revision: withdrawn.revision + 1 };
  await a.sync.syncNow();
  assert.equal((await a.storage.readBlogSyncState(a.ws, doc.id)).publication.revision, withdrawn.revision + 1);
});
// #185 review minor 2: a cycle that sends a deletion lists again after it (the early list still
// names the deleted post, which would be received again), and a failed early list is requested again.
test('receive: a cycle that sends a deletion lists again, so the deleted post is not received back', async () => {
  const cloud = server(), time = clock(), a = await device(cloud, 'mac', { time }), order = [];
  const doc = await save(a, await post({ title: '지울 글' })); await a.sync.syncNow();
  await a.sync.deletePost(a.ws, doc.id);
  const listed = a.remote.syncList, removed = a.remote.deletePost;
  a.remote.syncList = async () => { order.push('list'); return listed.call(a.remote); };
  a.remote.deletePost = async (...args) => { order.push('delete'); return removed.apply(a.remote, args); };
  await a.sync.syncNow();
  assert.deepEqual(order, ['list', 'delete', 'list']);
  assert.equal(cloud.rows.has(doc.id), false);
  assert.equal((await list(a)).length, 0, 'the deleted post is not received again from the early list');
});
test('receive: a failed early list is requested again after the account check', async () => {
  const { b, docs } = await seeded(2, 0), listed = b.remote.syncList; let calls = 0;
  b.remote.syncList = async () => { if (!calls++) throw Object.assign(Error('offline'), { code: 'network_error' }); return listed.call(b.remote); };
  assert.equal((await b.sync.syncNow()).state, 'synced');
  assert.equal(calls, 2);
  assert.equal((await list(b)).length, docs.length);
});

// 2026-11-05 CI (run 42073312877): the editor's draft timer fired inside the second after
// the cycle that kept a conflict copy. That upload-only pass skipped the copy (a draft
// still in its quiet period: it keeps its content time), cancelled the one-second
// follow-up and scheduled the regular interval, so the copy waited 30 s on a hidden tab.
test('an upload-only pass right after a conflict cycle does not postpone the kept copy to the regular interval', async () => {
  const { cloud, time, a, b } = await pair(), timers = [];
  const doc = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  const events = { document: doc, addEventListener() {}, removeEventListener() {} };
  const post0 = await save(a, await post({ title: '원래 글' })); await a.sync.syncNow(); await b.sync.syncNow();
  // A's losing edit was written two seconds ago, so its kept copy is inside a draft's quiet period.
  const aDraft = await edit(a, post0.id, { title: '맥 이른 수정' }, '2026-11-01T11:59:58.000Z'); await finish(a, aDraft, '2026-11-01T11:59:58.000Z');
  const bDraft = await edit(b, post0.id, { title: '아이패드 늦은 수정' }, '2026-11-01T11:59:59.000Z'); await finish(b, bDraft, '2026-11-01T11:59:59.000Z'); await b.sync.syncNow();
  const sync = Sync.create({ storage: a.storage, auth: a.auth, blog: Blog, photoPost: Photo, remote: a.remote, makeId: Core.id, locks: null, now: () => time.now, events,
    timers: { setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {} } });
  sync.start();
  await sync.syncNow(); // keeps A's edit as a new local draft and asks for a follow-up within a second
  const kept = Sync.CONFLICT_PREFIX + '맥 이른 수정';
  const onServer = () => [...cloud.rows.values()].some(row => row.data.status === 'draft' && row.data.title === kept);
  assert((await list(a)).some(row => row.title === kept)); assert.equal(onServer(), false);
  assert.equal(timers.at(-1).delay, 1000);
  doc.visibilityState = 'hidden'; time.advance(250);
  await sync.syncNow({ uploadOnly: true }); // the editor's draft timer: upload-only, no draft flush
  assert.equal(onServer(), false, 'the draft timer pass leaves a draft in its quiet period');
  assert(timers.at(-1).delay <= 750, 'the follow-up stays due one second after the conflict cycle, not after the interval: ' + timers.at(-1).delay);
  timers.at(-1).fn(); for (let n = 0; n < 40 && !onServer(); n++) await new Promise(done => setTimeout(done, 25));
  assert(onServer(), 'the hidden page flush uploads the kept copy');
  sync.dispose();
});

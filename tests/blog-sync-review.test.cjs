'use strict';
// 2026-11-01 independent review of automatic account blog sync: deletion only
// of the exact revision a device saw (B1), a draft finished on another device
// (M1, decided by latest wins since 2026-11-02), conflict state cleared when
// the server wins (M2), no hidden polling (m2).
const test = require('node:test'), assert = require('node:assert/strict');
const { server, device, clock, post, edit, finish, Core, Photo, Blog, Sync } = require('./helpers/blog-sync-cloud.cjs');

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
// assert the latest-wins outcome for the same situations, and keep their
// original purpose: the server's refusal to turn a saved post back into a
// draft is decided once, without an error or a retry loop.
test('M1: a later draft wins over a post finished on another device; the saved version stays saved as the recovery copy, without an error loop', async () => {
  const { cloud, time, a, b } = await pair();
  const draft = await save(a, await post({ title: '쓰는 중', status: 'draft', time: '2026-11-01T09:00:00.000Z' }));
  time.advance(60000); await a.sync.syncNow({ flushDrafts: true }); await b.sync.syncNow();
  const aCur = await a.storage.readPhotoPost(a.ws, draft.id);
  const finished = await a.storage.savePhotoPost(a.ws, { ...aCur, status: 'saved', title: '완성', updatedAt: '2026-11-01T10:00:00.000Z' }, aCur.revision);
  await a.sync.saveDefault(a.ws, finished.id, { expectedLocalRevision: finished.revision });
  const bCur = await b.storage.readPhotoPost(b.ws, draft.id);
  await b.storage.savePhotoPost(b.ws, { ...bCur, title: '맥에서 더 쓴 초안', updatedAt: '2026-11-01T10:05:00.000Z' }, bCur.revision);
  for (let i = 0; i < 3; i++) { time.advance(20 * 60000); await b.sync.syncNow({ flushDrafts: true }); }
  const rows = await list(b), x = rows.find(row => row.id === draft.id), winner = rows.find(row => row.id !== draft.id);
  assert.equal(rows.length, 2);
  assert.equal(x.status, 'saved', 'the server identity never returns to a draft'); assert.equal(x.title, '복구 사본 · 완성');
  assert.equal(winner.status, 'draft'); assert.equal(winner.title, '맥에서 더 쓴 초안', 'the later draft text is the current draft, under its own name');
  assert.equal((await b.sync.getState(b.ws, draft.id)).status, 'synced'); assert.equal(b.sync.getStatus().state, 'synced');
  assert.equal(cloud.rows.get(draft.id).data.status, 'saved'); assert.equal(cloud.rows.get(draft.id).data.title, '복구 사본 · 완성');
  assert.equal(cloud.rows.get(winner.id).data.status, 'draft'); assert.equal(cloud.rows.get(winner.id).data.title, '맥에서 더 쓴 초안');
  const count = () => cloud.stats.saves.filter(call => call.device === 'ipad').length, saves = count();
  time.advance(20 * 60000); await b.sync.syncNow();
  assert.equal(count(), saves, 'no repeated rejected request');
  await a.sync.syncNow({ flushDrafts: true });
  assert.deepEqual((await list(a)).map(row => [row.status, row.title]).sort(), [['draft', '맥에서 더 쓴 초안'], ['saved', '복구 사본 · 완성']], 'the finishing device ends with the same two posts');
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
  assert.equal(rows.find(r => r.id === draft.id).status, 'saved'); assert.equal(rows.find(r => r.id === draft.id).title, '복구 사본 · 다른 기기 완성');
  assert(rows.some(r => r.id !== draft.id && r.status === 'draft' && r.title === '이 기기 초안'), 'the later draft stays current');
  assert.notEqual(b.sync.getStatus().state, 'error');
  // The renamed saved version and the winning draft go up on the next cycle.
  time.advance(20 * 60000); await b.sync.syncNow();
  assert.equal(cloud.rows.get(draft.id).data.title, '복구 사본 · 다른 기기 완성');
  const refused = () => cloud.stats.saves.filter(call => call.device === 'ipad' && call.postId === draft.id && call.data.status === 'draft').length;
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

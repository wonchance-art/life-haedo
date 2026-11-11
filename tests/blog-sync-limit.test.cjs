'use strict';
// The 200 posts+drafts cap stops a new post or draft the person starts on this device. It never stops
// what already exists: a post account sync brings, the copies a sync conflict keeps, a received
// preparation's finished post, a backup restored into its copy, saving a post that is already here, or
// the one editing draft through which the editor changes a saved post (core review M6, 2026-11-11, and
// its review). Real Storage (in-memory IndexedDB adapter) and BlogSync per device; the private blog
// server is the tests' SQL-rule fixture.
const test = require('node:test'), assert = require('node:assert/strict');
const { server, device, clock, post, edit, finish, owner, memoryIdb, Core } = require('./helpers/blog-sync-cloud.cjs');
const { createStorage } = require('../assets/life/storage.js');
require('../assets/life/source-folders.js'); require('../assets/life/workbench.js'); require('../assets/life/collection.js'); require('../assets/life/nine-board.js');
const PlatformData = require('../assets/platform-data.js'), Full = require('../assets/life/full-backup.js');

const KEPT = '복구 사본 · ';
const iso = ms => new Date(ms).toISOString();
const list = dev => dev.storage.listPhotoPosts(dev.ws);
// What a device shows: every post's status, title and text, in one comparable order.
const shown = async dev => (await list(dev)).map(row => [row.status, row.title, row.body].join('|')).sort();
const write = (dev, title, time, status = 'saved') => post({ title, time, status }).then(doc => dev.storage.savePhotoPost(dev.ws, doc, 0));
const capped = error => { assert.equal(error.code, 'photo_post_limit'); assert.match(error.message, /합계 200개/); assert.match(error.message, /초안이나 복구 사본을 지운 뒤 다시 저장/); return true; };
async function pair(shared) {
  const cloud = server(), time = clock(Date.UTC(2026, 10, 11, 12));
  const a = await device(cloud, 'mac', { time }), b = await device(cloud, 'phone', { time }), first = [];
  for (let i = 0; i < shared; i++) first.push(await write(a, '글 ' + i, iso(time.now - 30 * 86400000 + i * 1000)));
  time.advance(60000); await a.sync.syncNow(); time.advance(60000); await b.sync.syncNow(); time.advance(60000); await b.sync.syncNow();
  assert.equal((await list(a)).length, shared); assert.equal((await list(b)).length, shared); assert.equal(cloud.rows.size, shared);
  return { cloud, time, a, b, first };
}
async function settle(time, ...devices) {
  let states;
  for (let round = 0; round < 4; round++) { time.advance(20 * 60000); states = []; for (const dev of devices) states.push(await dev.sync.syncNow({ force: true, flushDrafts: true })); }
  return states;
}
const clean = (...states) => { for (const state of states) { assert.equal(state.state, 'synced', JSON.stringify(state)); assert.equal(state.errors, 0); assert.equal(state.pending, 0); } };
// Two devices that each wrote 4 posts apart on top of 196 shared ones: 204 on both and on the account.
async function above() {
  const env = await pair(196), { time, a, b } = env;
  for (let i = 0; i < 4; i++) await write(a, '맥에서 쓴 새 글 ' + i, iso(time.now));
  for (let i = 0; i < 4; i++) await write(b, '폰에서 쓴 새 글 ' + i, iso(time.now));
  clean(...await settle(time, a, b));
  return env;
}

test('both devices at 200: the same post edited on both converges, and the losing edit is kept as a recovery copy', async () => {
  const { cloud, time, a, b, first } = await pair(200);
  let doc = await a.storage.readPhotoPost(a.ws, first[0].id);
  await a.storage.savePhotoPost(a.ws, { ...doc, title: '맥이 먼저 고친 글', updatedAt: iso(time.now) }, doc.revision);
  time.advance(5 * 60000);
  const there = (await b.storage.listBlogSyncStates(b.ws)).states.find(row => row.state.remoteId === first[0].id).localPostId;
  doc = await b.storage.readPhotoPost(b.ws, there);
  await b.storage.savePhotoPost(b.ws, { ...doc, title: '폰이 나중에 고친 글', updatedAt: iso(time.now) }, doc.revision);
  time.advance(60000); assert.equal((await b.sync.syncNow()).state, 'synced');
  clean(...await settle(time, a, b));
  assert.equal((await a.storage.readPhotoPost(a.ws, first[0].id)).title, '폰이 나중에 고친 글', 'the later edit reached the device at the cap');
  assert.equal((await a.sync.getState(a.ws, first[0].id)).error, null);
  assert.deepEqual(await shown(a), await shown(b), 'both devices show the same list');
  const titles = (await list(a)).map(row => row.title);
  assert.equal(titles.length, 201); assert.equal(cloud.rows.size, 201);
  assert.deepEqual(titles.filter(title => title.startsWith(KEPT)), [KEPT + '맥이 먼저 고친 글'], 'the losing edit is a recovery copy above the cap, under the one name');
});

test('196 shared, 4 new on each device while apart: the account has 204 and both devices receive all of them', async () => {
  const { cloud, a, b } = await above();
  assert.equal(cloud.rows.size, 204); assert.equal((await list(a)).length, 204);
  assert.equal((await list(a)).filter(row => row.title.startsWith('폰에서')).length, 4); assert.equal((await list(b)).filter(row => row.title.startsWith('맥에서')).length, 4);
  assert.deepEqual(await shown(a), await shown(b), 'both devices show the same 204 posts');
});

test('above the cap the editor still changes a saved post: its one editing draft is stored and finishing it restores the count', async () => {
  const { time, a, b } = await above();
  const row = (await list(a)).find(item => item.title === '폰에서 쓴 새 글 0'), saved = await a.storage.readPhotoPost(a.ws, row.id);
  time.advance(60000);
  // The editor's own path: a new draft that names the saved post (tests/helpers edit()), then finishing it.
  const draft = await edit(a, row.id, { title: '맥에서 고치는 폰 글' }, iso(time.now));
  assert.equal(draft.status, 'draft'); assert.deepEqual(draft.replaces, { id: saved.id, revision: saved.revision }); assert.equal((await list(a)).length, 205);
  // The draft autosaves again (same draft: the list does not grow).
  const typed = await a.storage.savePhotoPost(a.ws, { ...draft, title: '맥에서 고친 폰 글', updatedAt: iso(time.now + 1000) }, draft.revision);
  // The exception is exactly that one draft. A second draft of the same post, a draft naming another
  // revision or a post that is not here, and any new post or draft are refused as before.
  await assert.rejects(edit(a, row.id, { title: '같은 글의 두 번째 수정 초안' }, iso(time.now)), capped);
  const other = (await list(a)).find(item => item.title === '글 3'), stale = await a.storage.readPhotoPost(a.ws, other.id);
  await assert.rejects(a.storage.savePhotoPost(a.ws, { ...stale, id: Core.id(), revision: 0, status: 'draft', replaces: { id: stale.id, revision: stale.revision + 1 } }, 0), capped);
  await assert.rejects(a.storage.savePhotoPost(a.ws, { ...stale, id: Core.id(), revision: 0, status: 'draft', replaces: { id: Core.id(), revision: 1 } }, 0), capped);
  await assert.rejects(write(a, '205번째 새 글', iso(time.now)), capped); await assert.rejects(write(a, '205번째 새 초안', iso(time.now), 'draft'), capped);
  assert.equal((await list(a)).length, 205, 'nothing refused was stored');
  time.advance(60000);
  const done = await finish(a, typed, iso(time.now));
  assert.equal(done.status, 'saved'); assert.equal(done.title, '맥에서 고친 폰 글'); assert.equal((await list(a)).length, 204, 'finishing the draft replaces the post: the count is back');
  clean(...await settle(time, a, b));
  assert.equal((await list(b)).some(item => item.title === '맥에서 고친 폰 글'), true, 'the edit made above the cap reached the other device');
  assert.deepEqual(await shown(a), await shown(b)); assert.equal((await list(b)).length, 204);
});

test('a new post or draft made on this device is still refused at 200 and says what to do', async () => {
  const { time, a } = await pair(200), before = await shown(a);
  for (const status of ['saved', 'draft']) await assert.rejects(write(a, '201번째 ' + status, iso(time.now), status), capped);
  assert.deepEqual(await shown(a), before, 'a refused post changes nothing');
  // Deleting one makes room again.
  const row = (await list(a))[0]; await a.storage.deletePhotoPost(a.ws, row.id, row.revision);
  await write(a, '자리를 비운 뒤 새 글', iso(time.now)); assert.equal((await list(a)).length, 200);
});

// A draft on both devices; the phone finishes it; the Mac, at the cap, keeps writing its draft later.
// The Mac's sync then stores, in one transaction: the saved version in place, the Mac's later draft as
// that post's editing draft, and the saved content as a recovery copy (blog-sync resolveConflict).
// `stray`: a draft that already names the post is on the Mac, so the edit-draft exception of the cap
// cannot be what lets the conflict's editing draft through: sync writes never meet the cap.
for (const stray of [false, true]) test('at the cap a later draft over a finished post is stored with its editing draft and recovery copy' + (stray ? ', also beside a draft that already names the post' : ''), async () => {
  const { cloud, time, a, b } = await pair(stray ? 198 : 199);
  const draft = await write(a, '쓰는 중', iso(time.now), 'draft');
  if (stray) await a.storage.savePhotoPost(a.ws, { ...(await post({ title: '그 글을 가리키는 다른 초안', time: iso(time.now), status: 'draft' })), replaces: { id: draft.id, revision: draft.revision } }, 0);
  assert.equal((await list(a)).length, 200);
  time.advance(60000); await a.sync.syncNow({ flushDrafts: true }); time.advance(60000); await b.sync.syncNow();
  const there = await b.storage.readPhotoPost(b.ws, draft.id);
  time.advance(60000);
  const finished = await b.storage.savePhotoPost(b.ws, { ...there, status: 'saved', title: '완성', updatedAt: iso(time.now) }, there.revision);
  await b.sync.saveDefault(b.ws, finished.id, { expectedLocalRevision: finished.revision });
  time.advance(5 * 60000);
  const mine = await a.storage.readPhotoPost(a.ws, draft.id);
  await a.storage.savePhotoPost(a.ws, { ...mine, title: '맥에서 더 쓴 초안', updatedAt: iso(time.now) }, mine.revision);
  clean(...await settle(time, a, b));
  const rows = await list(a), mineNow = rows.filter(item => ['완성', '맥에서 더 쓴 초안', KEPT + '완성'].includes(item.title)).map(item => item.status + ':' + item.title).sort();
  assert.deepEqual(mineNow, ['draft:' + KEPT + '완성', 'draft:맥에서 더 쓴 초안', 'saved:완성'].sort(), 'saved post, its editing draft and the recovery copy are all on the device at the cap');
  assert.equal(rows.length, 202); assert.equal((await a.sync.getState(a.ws, draft.id)).error, null);
  const editing = await a.storage.readPhotoPost(a.ws, rows.find(item => item.title === '맥에서 더 쓴 초안').id);
  assert.equal(editing.replaces.id, draft.id, 'the later draft is the finished post\'s editing draft');
  assert.deepEqual(await shown(a), await shown(b), 'both devices show the same list'); assert.equal(cloud.rows.size, 202);
});

test('a backup made above the cap restores every post into its copy; the restore entry point serves only a restore copy', async () => {
  const { a } = await above();
  const data = new Map([[PlatformData.keys(owner.userId).registry, JSON.stringify({ docs: [], current: null })]]);
  const context = { storage: a.storage, timeline: () => Full.timelineSnapshot({ platformData: PlatformData, localStorage: { getItem: key => data.has(key) ? data.get(key) : null }, uid: owner.userId }), originals: null };
  const writer = Full.writer(await Full.plan(context), context, { appVersion: 'haedo-test' });
  assert.deepEqual(await writer.collect(), [], 'everything was read into the backup');
  const built = writer.finish({ partial: false });
  assert.equal(built.manifest.files.filter(file => file.kind === 'photoPosts').length, 204);
  const target = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: { projectUrl: owner.projectUrl, userId: '99999999-2222-4333-8444-555555555555' } });
  const report = await Full.restore(await Full.open(built.blob), { storage: target, kinds: new Set(['photoPosts']), verifyPhoto: null });
  assert.deepEqual(report.items.filter(item => item.status !== 'restored'), [], 'no post failed to restore');
  const copies = await target.listWorkspaces(); assert.equal(copies.length, 1);
  const restored = await target.listPhotoPosts(copies[0].workspaceId);
  assert.equal(restored.length, 204, 'all 204 posts are in the restore copy');
  assert.deepEqual(restored.map(row => [row.status, row.title, row.body].join('|')).sort(), await shown(a), 'with the same state, title and text');
  // In the copy, as anywhere: a post the person starts is refused above the cap.
  await assert.rejects(target.savePhotoPost(copies[0].workspaceId, await post({ title: '복원 사본에서 새로 쓰는 글' }), 0), capped);
  // The entry point is not a way around the cap in an ordinary workspace.
  const ordinary = (await target.createWorkspace('보통 자료공간')).workspaceId;
  await assert.rejects(target.restorePhotoPost(ordinary, await post({ title: '복원이 아닌 글' })), { code: 'restored_copy_invalid' });
  assert.deepEqual(await target.listPhotoPosts(ordinary), []);
  target.close();
});

'use strict';
// The 200 posts+drafts cap stops a new post or draft made on this device. It never stops account
// sync from storing a post that already exists on another device or the recovery copy a conflict
// keeps: a device that refused those stayed different from the account for good (core review M6,
// 2026-11-11). Real Storage (in-memory IndexedDB adapter) and BlogSync per device; the private blog
// server is the tests' SQL-rule fixture.
const test = require('node:test'), assert = require('node:assert/strict');
const { server, device, clock, post } = require('./helpers/blog-sync-cloud.cjs');

const KEPT = '복구 사본 · ';
const iso = ms => new Date(ms).toISOString();
const list = dev => dev.storage.listPhotoPosts(dev.ws);
// What a device shows: every post's status, title and text, in one comparable order.
const shown = async dev => (await list(dev)).map(row => [row.status, row.title, row.body].join('|')).sort();
const write = (dev, title, time) => post({ title, time }).then(doc => dev.storage.savePhotoPost(dev.ws, doc, 0));
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
  for (let round = 0; round < 4; round++) { time.advance(20 * 60000); states = []; for (const dev of devices) states.push(await dev.sync.syncNow({ force: true })); }
  return states;
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
  const [sa, sb] = await settle(time, a, b);
  for (const state of [sa, sb]) { assert.equal(state.state, 'synced', JSON.stringify(state)); assert.equal(state.errors, 0); assert.equal(state.pending, 0); }
  assert.equal((await a.storage.readPhotoPost(a.ws, first[0].id)).title, '폰이 나중에 고친 글', 'the later edit reached the device at the cap');
  assert.equal((await a.sync.getState(a.ws, first[0].id)).error, null);
  assert.deepEqual(await shown(a), await shown(b), 'both devices show the same list');
  const titles = (await list(a)).map(row => row.title);
  assert.equal(titles.length, 201); assert.equal(cloud.rows.size, 201);
  assert.deepEqual(titles.filter(title => title.startsWith(KEPT)), [KEPT + '맥이 먼저 고친 글'], 'the losing edit is a recovery copy above the cap, under the one name');
});

test('196 shared, 4 new on each device while apart: the account has 204 and both devices receive all of them', async () => {
  const { cloud, time, a, b } = await pair(196);
  for (let i = 0; i < 4; i++) await write(a, '맥에서 쓴 새 글 ' + i, iso(time.now));
  for (let i = 0; i < 4; i++) await write(b, '폰에서 쓴 새 글 ' + i, iso(time.now));
  const [sa, sb] = await settle(time, a, b);
  for (const state of [sa, sb]) { assert.equal(state.state, 'synced', JSON.stringify(state)); assert.equal(state.errors, 0); assert.equal(state.pending, 0); assert.equal(state.posts, 204); }
  assert.equal(cloud.rows.size, 204);
  assert.equal((await list(a)).filter(row => row.title.startsWith('폰에서')).length, 4); assert.equal((await list(b)).filter(row => row.title.startsWith('맥에서')).length, 4);
  assert.deepEqual(await shown(a), await shown(b), 'both devices show the same 204 posts');
  // Above the cap a post that is already here can still be edited and sent; only a new one is refused.
  const row = (await list(a)).find(item => item.title === '폰에서 쓴 새 글 0'), doc = await a.storage.readPhotoPost(a.ws, row.id);
  time.advance(60000);
  await a.storage.savePhotoPost(a.ws, { ...doc, title: '맥에서 고친 폰 글', updatedAt: iso(time.now) }, doc.revision);
  await assert.rejects(write(a, '205번째 새 글', iso(time.now)), error => error.code === 'photo_post_limit' && /지운 뒤 다시 저장/.test(error.message));
  await settle(time, a, b);
  assert.equal((await list(b)).some(item => item.title === '맥에서 고친 폰 글'), true, 'the edit made above the cap reached the other device');
  assert.deepEqual(await shown(a), await shown(b)); assert.equal((await list(a)).length, 204);
});

test('a new post or draft made on this device is still refused at 200 and says what to do', async () => {
  const { time, a } = await pair(200), before = await shown(a);
  for (const status of ['saved', 'draft']) {
    const doc = await post({ title: '201번째 ' + status, time: iso(time.now), status });
    await assert.rejects(a.storage.savePhotoPost(a.ws, doc, 0), error => {
      assert.equal(error.code, 'photo_post_limit'); assert.match(error.message, /합계 200개/); assert.match(error.message, /초안이나 복구 사본을 지운 뒤 다시 저장/); return true;
    });
  }
  assert.deepEqual(await shown(a), before, 'a refused post changes nothing');
  // Deleting one makes room again.
  const row = (await list(a))[0]; await a.storage.deletePhotoPost(a.ws, row.id, row.revision);
  await write(a, '자리를 비운 뒤 새 글', iso(time.now)); assert.equal((await list(a)).length, 200);
});

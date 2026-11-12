'use strict';
// The home list's notice near the 200 posts-and-drafts cap (home.js postCapacity, 2026-11-12) counts
// what the cap counts and says exactly how many to delete: one library's whole list (empty and hidden
// rows too), the cap at 200 for a new post or draft started here, and a list that account sync took
// over 200. The cap itself is storage's (tests/blog-sync-limit.test.cjs); the screen is
// tests/post-limit-notice-browser.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const { server, device, post } = require('./helpers/blog-sync-cloud.cjs');
require('../assets/life/home.js');
const Home = globalThis.HaedoLife.HomeUI;

test('postCapacity: nothing below 190, the count left up to 200, how many to delete from 200 on', () => {
  assert.equal(Home.POST_LIMIT, 200);
  for (const value of [0, 189, -1, 1.5, NaN, undefined, null, '195']) assert.equal(Home.postCapacity(value), null, String(value));
  assert.deepEqual(Home.postCapacity(190), { count: 190, limit: 200, remaining: 10, full: false, toDelete: 0 });
  assert.deepEqual(Home.postCapacity(199), { count: 199, limit: 200, remaining: 1, full: false, toDelete: 0 });
  assert.deepEqual(Home.postCapacity(200), { count: 200, limit: 200, remaining: 0, full: true, toDelete: 1 });
  assert.deepEqual(Home.postCapacity(204), { count: 204, limit: 200, remaining: 0, full: true, toDelete: 5 });
});

test('the count is the library\'s whole list as the cap counts it, and the numbers match what storage refuses', async () => {
  const cloud = server(), dev = await device(cloud, 'mac');
  const save = async (title, extra = {}) => { const doc = await post({ title, status: 'saved', ...extra }); Object.assign(doc, extra); return dev.storage.savePhotoPost(dev.ws, doc, 0); };
  for (let index = 0; index < 196; index++) await save('글 ' + index);
  await save('숨긴 글', { archived: true });
  // An empty draft (not shown in the list) still counts.
  const empty = await post({ title: '', status: 'draft' }); empty.title = ''; empty.ops = [{ insert: '\n' }]; await dev.storage.savePhotoPost(dev.ws, empty, 0);
  await save('복구 사본 · 메모', { status: 'draft' });
  const listed = await Home.listAccountPosts(dev.storage, dev.ws);
  assert.equal(listed.counts[dev.ws], 199);
  assert.deepEqual(Home.postCapacity(listed.counts[dev.ws]), { count: 199, limit: 200, remaining: 1, full: false, toDelete: 0 });
  await save('200번째 글');
  const full = Home.postCapacity((await Home.listAccountPosts(dev.storage, dev.ws)).counts[dev.ws]);
  assert.deepEqual([full.full, full.toDelete], [true, 1]);
  await assert.rejects(save('201번째 글'), { code: 'photo_post_limit' });
  // Deleting the number it names makes room for one.
  const copy = (await dev.storage.listPhotoPosts(dev.ws)).find(row => row.title.startsWith('복구 사본 · '));
  await dev.storage.deletePhotoPost(dev.ws, copy.id, copy.revision);
  assert.equal(Home.postCapacity((await Home.listAccountPosts(dev.storage, dev.ws)).counts[dev.ws]).remaining, 1);
  await save('자리가 난 뒤의 글');
});

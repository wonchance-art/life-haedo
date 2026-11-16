'use strict';
// Rule change (owner decision 10, 2026-11-16): there is no cap on posts and drafts, so the home list has
// no notice near one. Until then (2026-11-12) the list counted a library's whole list from 190 on and
// said at 200 how many to delete (home.js postCapacity, limitText, POST_LIMIT; these checks asserted
// those numbers and storage's photo_post_limit at the 201st post). Now: no cap numbers in the home
// module, the account list carries every row with when it was first written, and the 201st and later
// posts are stored. The screen is tests/post-limit-notice-browser.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const { server, device, post } = require('./helpers/blog-sync-cloud.cjs');
require('../assets/life/home.js');
const Home = globalThis.HaedoLife.HomeUI;

test('the home module has no cap numbers left', () => {
  for (const name of ['postCapacity', 'limitText', 'POST_LIMIT']) assert.equal(Object.hasOwn(Home, name), false, name);
});

test('the account list carries every post and draft past 200 (hidden and empty ones too) with createdAt', async () => {
  const cloud = server(), dev = await device(cloud, 'mac');
  const save = async (title, extra = {}) => { const doc = await post({ title, status: 'saved', ...extra }); Object.assign(doc, extra); return dev.storage.savePhotoPost(dev.ws, doc, 0); };
  for (let index = 0; index < 198; index++) await save('글 ' + index);
  await save('숨긴 글', { archived: true });
  const empty = await post({ title: '', status: 'draft' }); empty.title = ''; empty.ops = [{ insert: '\n' }]; await dev.storage.savePhotoPost(dev.ws, empty, 0);
  await save('복구 사본 · 메모', { status: 'draft' });
  const extra = [await save('201번째 글'), await save('202번째 초안', { status: 'draft' })];
  const listed = await Home.listAccountPosts(dev.storage, dev.ws);
  assert.equal(listed.posts.length, 203);
  assert.equal(Object.hasOwn(listed, 'counts'), false); assert.equal(Object.hasOwn(listed, 'drafts'), false);
  for (const saved of extra) assert.equal(listed.posts.find(row => row.id === saved.id)?.createdAt, saved.createdAt);
  assert.ok(listed.posts.every(row => typeof row.createdAt === 'string' && row.workspaceId === dev.ws));
});

test('writtenAt: the first-written time, or the update time for a row without a valid one', () => {
  assert.equal(Home.writtenAt({ createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-11-16T00:00:00.000Z' }), '2026-01-02T00:00:00.000Z');
  for (const createdAt of [undefined, null, '', 'not a date', 7]) assert.equal(Home.writtenAt({ createdAt, updatedAt: '2026-11-16T00:00:00.000Z' }), '2026-11-16T00:00:00.000Z', String(createdAt));
});

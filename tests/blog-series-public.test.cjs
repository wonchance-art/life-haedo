'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const Series = require('../assets/life/blog-series-public.js');
const origin = 'https://anonymous.example/haedo/index.html', ids = [randomUUID(), randomUUID(), randomUUID()], publicId = randomUUID(), author = randomUUID();
const snapshot = () => Series.wrapper('여행 연재', '선택한 공개 글의 목차', ids, origin);
function fixture() {
  let page = { status: 'published', publicId, revision: 1, snapshot: snapshot() }, after = null, reads = 0, disposed = false;
  const posts = new Map(ids.map((id, index) => [id, { token: id, blogToken: author, snapshot: { title: '현재 공개 제목 ' + index } }])), calls = [];
  const reader = Series.createReader({ baseURL: origin,
    shareReader: { async read(id) { assert.equal(id, publicId); calls.push('wrapper'); return ++reads > 1 && after ? after : page; }, dispose() { disposed = true; } },
    blogReader: { async read(id) { calls.push(id); return posts.get(id) || null; }, photoURL: (id, photo) => id + '/' + photo, dispose() {} } });
  return { reader, posts, calls, setAfter(value) { after = value; }, setPage(value) { page = value; }, get disposed() { return disposed; } };
}
test('existing share-v1 wrapper preserves explicit token order and contains no private body, IDs or copied post title', () => {
  const value = snapshot(); assert.deepEqual(Series.parseWrapper(value, origin), ids);
  assert.deepEqual(value.entries.map(entry => entry.title), ['1편', '2편', '3편']);
  assert(value.entries.every(entry => entry.parts.length === 0 && entry.note === null && entry.attachments[0].creator === ''));
  assert(!JSON.stringify(value).includes('현재 공개 제목'));
  for (const change of [v => v.workspaceId = randomUUID(), v => v.entries[0].note = '개인 본문',
    v => v.entries[0].attachments[0].url = 'https://other.example/blog.html?post=' + ids[0],
    v => v.entries[0].attachments[0].url += '&post=' + ids[0], v => v.entries[0].title = '옛 비공개 제목',
    v => v.entries[1].attachments[0].url = v.entries[0].attachments[0].url]) {
    const bad = snapshot(); change(bad); assert.throws(() => Series.parseWrapper(bad, origin));
  }
});
test('visitor reads only chosen current public tokens; revoked titles disappear and an unrelated post cannot be selected', async () => {
  const f = fixture(); f.posts.delete(ids[1]);
  const value = await f.reader.read(publicId, { post: ids[0] });
  assert.equal(value.post.token, ids[0]); assert.deepEqual(value.entries.map(entry => entry.available), [true, false, true]);
  assert.equal(value.entries[1].title, null); assert.equal(value.entries[0].title, '현재 공개 제목 0');
  assert.equal(f.calls.filter(id => id === 'wrapper').length, 2); assert.equal(f.calls.filter(id => id === ids[0]).length, 2);
  const before = f.calls.length; await assert.rejects(f.reader.read(publicId, { post: randomUUID() }), { code: 'invalid_request' });
  assert.equal(f.calls.length, before + 1); f.reader.dispose(); assert(f.disposed);
});
test('wrapper revocation or membership changes during child reads suppress the old whole result', async () => {
  const revoked = fixture(); revoked.setAfter({ status: 'missing' }); assert.deepEqual(await revoked.reader.read(publicId), { status: 'missing' }); revoked.reader.dispose();
  const changed = fixture(); changed.setAfter({ status: 'published', revision: 2, snapshot: snapshot() });
  await assert.rejects(changed.reader.read(publicId), { code: 'series_changed' }); changed.reader.dispose();
  const other = fixture(); other.posts.get(ids[2]).blogToken = randomUUID(); await assert.rejects(other.reader.read(publicId), { code: 'invalid_series' }); other.reader.dispose();
});
test('child network failure is an error, and disposal prevents a delayed public body from escaping', async () => {
  const f = fixture(); f.posts.set(ids[0], null);
  const current = await f.reader.read(publicId, { post: ids[0] }); assert.equal(current.post, null); assert.equal(current.entries[0].title, null); f.reader.dispose();
  let release;
  const reader = Series.createReader({ baseURL: origin, shareReader: { read: () => new Promise(resolve => { release = resolve; }), dispose() {} }, blogReader: { dispose() {} } });
  const pending = reader.read(publicId); reader.dispose(); release({ status: 'published', revision: 1, snapshot: snapshot() });
  await assert.rejects(pending, { code: 'request_cancelled' });
  const broken = Series.createReader({ baseURL: origin, shareReader: { async read() { return { status: 'published', revision: 1, snapshot: snapshot() }; }, dispose() {} }, blogReader: { async read() { throw Error('offline'); }, dispose() {} } });
  await assert.rejects(broken.read(publicId), /offline/); broken.dispose();
});

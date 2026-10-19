'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const M = require('../assets/life/blog-series.js'), P = require('../assets/life/photo-post.js'), Core = require('../assets/life/core.js');
function sample() {
  const doc = P.create(Core.id); doc.status = 'saved'; doc.revision = 4; doc.title = '원래 제목 🌿'; doc.ops = [{ insert: '원래 본문\r\n출처 https://example.org/old\n' }];
  const series = M.create(Core.id); series.title = '여행 모음'; series.intro = '서로 다른 날의 기록'; series.items = [M.item(doc, Core.id)];
  return { series, posts: [{ itemId: series.items[0].id, doc }] };
}
test('ordered exact snapshots preserve source IDs, revision and text without mutation', () => {
  const value = sample(), before = structuredClone(value); assert(M.validateSnapshot(value));
  const state = { ...M.empty(Core.id()), series: [value.series] }; assert(M.validate(state));
  const owned = M.clone(value); owned.posts[0].doc.title = '사본 변경'; assert.deepEqual(value, before);
  assert.equal(value.series.items[0].postRevision, 4); assert.match(value.posts[0].doc.ops[0].insert, /\r\n/);
});
test('strict snapshot validation rejects missing, reordered, stale and injected content', () => {
  for (const mutate of [v => v.posts.pop(), v => v.posts[0].itemId = Core.id(), v => v.posts[0].doc.id = Core.id(),
    v => v.posts[0].doc.revision++, v => v.posts[0].doc.title += ' 다름', v => v.posts[0].doc.status = 'draft',
    v => v.posts[0].doc.archived = true, v => v.posts[0].evidence = [], v => v.series.owner = 'hidden',
    v => v.series.items[0].publicToken = Core.id(), v => v.series.items[0].title = '\ud800']) {
    const value = sample(); mutate(value); assert.throws(() => M.validateSnapshot(value));
  }
  const value = sample(), second = structuredClone(value.posts[0].doc); second.id = Core.id(); second.title = '두번째';
  const item = M.item(second, Core.id); value.series.items.push(item); value.posts.push({ itemId: item.id, doc: second }); assert(M.validateSnapshot(value));
  value.posts.reverse(); assert.throws(() => M.validateSnapshot(value));
});
test('private metadata limits, unique origins and saved-only selection fail without trimming input', () => {
  const value = sample(), state = { ...M.empty(Core.id()), series: [value.series] };
  value.series.intro = '한'.repeat(M.LIMITS.intro + 1); assert.throws(() => M.validate(state)); assert.equal(value.series.intro.length, M.LIMITS.intro + 1);
  value.series.intro = ''; value.series.items.push({ ...value.series.items[0], id: Core.id() }); assert.throws(() => M.validate(state));
  const draft = P.create(Core.id); assert.throws(() => M.item(draft, Core.id));
  const archived = sample().posts[0].doc; archived.archived = true; assert.throws(() => M.item(archived, Core.id));
  const extra = M.empty(Core.id()); extra.publication = {}; assert.throws(() => M.validate(extra));
  const state2 = M.empty(Core.id()); for (let i = 0; i < M.LIMITS.series; i++) state2.series.push(M.create(Core.id)); assert(M.validate(state2));
  state2.series.push(M.create(Core.id)); assert.throws(() => M.validate(state2));
});

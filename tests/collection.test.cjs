'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../assets/life/collection.js');
const item = (change = {}) => ({ id: 'item_1', type: 'book', title: '일상의 작은 발견', creator: '익명 저자', url: 'https://example.org/book', note: '나의 생각\r\n🌱', tags: ['관찰'], details: { year: '2020년경' }, archived: false, createdAt: '2026-10-12T01:00:00.000Z', updatedAt: '2026-10-12T01:00:00.000Z', ...change });
const library = () => ({ ...C.empty('workspace_1'), items: [item()] });
test('Collection backup preserves private notes, uncertain metadata and archived entries; import makes separate identities', () => {
  const state = library(); state.items.push(item({ id: 'archived', type: 'person', title: '서윤', creator: '', details: { field: '회화' }, archived: true }));
  const backup = C.readBackup(JSON.stringify(C.makeBackup(state))); let n = 0;
  const restored = C.appendBackup(state, backup, () => 'copy_' + ++n);
  assert.equal(restored.items.length, 4); assert.deepEqual(restored.items.slice(0, 2), state.items);
  assert.equal(restored.items[2].note, '나의 생각\r\n🌱'); assert.equal(restored.items[3].archived, true);
  assert.deepEqual(C.readBackup(JSON.stringify(C.makeBackup(restored))).items, restored.items);
  assert.deepEqual(Object.keys(backup).sort(), ['exportedAt', 'format', 'items']);
});
test('Collection search separates broad category, type, topic and archived state', () => {
  const value = item(); assert(C.matches(value, { category: 'content', type: 'book', tag: '관찰', query: '2020' }));
  assert(!C.matches(value, { category: 'people' })); assert(!C.matches(value, { archived: true }));
  assert(C.matches(item({ type: 'person', creator: '', details: { field: '회화' } }), { query: '회화' }));
});
test('Collection rejects unsafe URLs, unknown metadata, malformed text and duplicate identifiers', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'https://user:pass@example.org', 'https://example.org/a b', 'https:\\example.org']) assert.throws(() => C.validateItem(item({ url })));
  for (const patch of [{ details: { secret: 'x' } }, { title: '\ud800' }, { title: '' }, { note: 'x'.repeat(10001) }, { tags: ['x','x'] }, { updatedAt: '2020-00-00T00:00:00.000Z' }, { type: 'person', creator: '혼동된 작가', details: {} }]) assert.throws(() => C.validateItem(item(patch)));
  const state = library(); state.items.push(item()); assert.throws(() => C.validate(state));
  assert.throws(() => C.validate({ ...library(), sources: [] }));
});
test('Wrong backup versions and oversized imports fail before changing the original', () => {
  const state = library(), before = JSON.stringify(state), backup = C.makeBackup(state);
  for (const bad of [{ ...backup, format: 'life-backup-v1' }, { ...backup, extra: true }, { ...backup, items: [item(), item()] }, 'x'.repeat(C.LIMITS.bytes + 1), '{broken']) assert.throws(() => C.appendBackup(state, bad, () => 'new'));
  assert.equal(JSON.stringify(state), before);
  assert.throws(() => C.appendBackup(state, backup, () => 'item_1'));
});
test('Collection capacity rejection preserves both source and backup', () => {
  const state = library(); state.items = Array.from({length:1000}, (_,i) => item({id:'item_'+i}));
  C.validate(state); const before = JSON.stringify(state); assert.throws(() => C.appendBackup(state, C.makeBackup(library()), () => 'new'), {code:'collection_limit'});
  assert.equal(JSON.stringify(state), before);
});

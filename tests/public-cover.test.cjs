'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const M = require('../assets/life/public-cover.js'), Core = require('../assets/life/core.js'), Share = require('../assets/life/share.js');
const copy = value => structuredClone(value), BASE = 'https://example.test/haedo/cover.html?cover=private-query#private-fragment';
function cover() { return { ...M.create(Core.id), title: '대표 결과 🌿', intro: '직접 쓴 소개\r\n두 번째 줄', items: ['post', 'series', 'nine'].map(kind => M.item(kind, Core.id(), Core.id)) }; }
test('ordered mixed pointers roundtrip through existing Share while excluding all local IDs and private data', () => {
  const c = cover(), before = copy(c), snapshot = M.project(c, BASE), parsed = M.parse(snapshot, BASE), wire = JSON.stringify(snapshot);
  assert(Share.validate(snapshot)); assert.deepEqual(parsed, { title: c.title, intro: c.intro, items: c.items.map(({ kind, publicId }) => ({ kind, publicId })) });
  assert.deepEqual(snapshot.entries.map(entry => entry.title), ['1. 글', '2. 연재', '3. 9칸']);
  assert.deepEqual(snapshot.entries.map(entry => entry.attachments[0].url), c.items.map((item, i) => 'https://example.test/haedo/' + ['blog.html?post=', 'series.html?series=', 'taste.html?nine='][i] + item.publicId));
  for (const privateValue of [c.id, ...c.items.map(item => item.id), 'private-query', 'private-fragment', 'workspaceId', 'body', 'blob', 'photos', 'reference']) assert(!wire.includes(privateValue), privateValue);
  assert.deepEqual(c, before); assert(Object.isFrozen(snapshot.entries[0].attachments[0])); assert(Object.isFrozen(parsed.items[0])); assert(!Object.isFrozen(c));
  c.title = '원본만 바꿈'; assert.equal(snapshot.title, before.title);
});
test('blank drafts remain editable, bounded Unicode input is preserved and only nonempty selections can publish', () => {
  const c = M.create(Core.id); assert.equal(M.validate(c), c); assert.throws(() => M.project(c, BASE));
  c.title = '가'.repeat(200); c.intro = '나'.repeat(2000); c.items = Array.from({ length: 20 }, () => M.item('post', Core.id()));
  assert.equal(M.parse(M.project(c, BASE), BASE).items.length, 20);
  for (const mutate of [c => c.title += '가', c => c.intro += '나', c => c.items.push(M.item('nine', Core.id())), c => c.title = '\ud800', c => c.intro = 'bad\0secret']) { const x = copy(c); mutate(x); assert.throws(() => M.validate(x)); }
  const blank = cover(); blank.title = ' \n'; assert.throws(() => M.project(blank, BASE)); blank.title = '제목'; blank.intro = ''; assert.equal(M.project(blank, BASE).intro, null);
});
test('draft state rejects hidden private fields, sparse lists, duplicate identity and repeated targets while permitting an independent conflict copy', () => {
  const c = cover(), state = { ...M.empty(Core.id()), covers: [c] }; assert.equal(M.validateState(state), state);
  for (const mutate of [s => s.owner = 'private', s => s.covers[0].note = 'private', s => s.covers[0].items[0].url = 'https://evil.test',
    s => delete s.covers[0].items[1], s => s.covers.hidden = 'private', s => s.covers[0].items.push({ ...s.covers[0].items[0], id: Core.id() }),
    s => s.covers[0].items[1].id = s.covers[0].items[0].id.toUpperCase(), s => s.covers.push(copy(s.covers[0])), s => s.revision = -1]) {
    const x = copy(state); mutate(x); assert.throws(() => M.validateState(x));
  }
  const recovered = copy(c); recovered.id = Core.id(); recovered.items.forEach(item => item.id = Core.id()); state.covers.push(recovered); M.validateState(state);
  const same = M.item('post', c.items[0].publicId.toUpperCase()); const dup = cover(); dup.items = [c.items[0], same]; assert.throws(() => M.validate(dup));
});
test('strict wrapper rejects external, wrong-directory, aliased and augmented destinations before any visitor can navigate', () => {
  const valid = M.project(cover(), BASE), good = valid.entries[0].attachments[0].url, id = valid.entries[0].attachments[0].url.split('=').at(-1);
  const urls = [good.replace('example.test', 'evil.test'), good.replace('/haedo/', '/other/'), good.replace('/blog.html', '/a/../blog.html'),
    good + '#private', good + '#', good + '&next=https://evil.test', good + '&', good + '&post=' + id, good.replace(id, id.toUpperCase()), good.replace('post=', 'post=%20'),
    good.replace('https://', 'https://user:password@'), good.replace('blog.html', 'BLOG.HTML'), good.replace('post=', 'token='), good.replace('https:', 'http:'),
    good.replace('/haedo/', '/haedo//'), good.replace('blog.html', '%62log.html'), '/haedo/blog.html?post=' + id, 'javascript:alert(1)'];
  for (const url of urls) { const bad = copy(valid); bad.entries[0].attachments[0].url = url; assert.throws(() => M.parse(bad, BASE), url); }
});
test('generic pages cannot turn notes, original content, extra attachments or spoofed kinds into a cover', () => {
  const valid = M.project(cover(), BASE);
  for (const mutate of [s => s.entries[0].note = 'private note', s => s.entries[0].pinned = true, s => s.entries[0].parts.push({ text: 'private body' }),
    s => s.entries[0].attachments.push(copy(s.entries[0].attachments[0])), s => s.entries[0].attachments[0].creator = 'private author',
    s => s.entries[0].title = '1편', s => s.entries[0].attachments[0].title = 'private target title', s => s.entries[0].attachments[0].type = 'photo',
    s => s.entries[0].attachments[0].reason = 'private', s => s.entries[0].workspaceId = Core.id(), s => s.entries.reverse(), s => s.entries = []]) {
    const bad = copy(valid); mutate(bad); assert.throws(() => M.parse(bad, BASE));
  }
});

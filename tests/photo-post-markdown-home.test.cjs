'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Photo = require('../assets/life/photo-post.js'), Markdown = require('../assets/life/post-markdown.js');
const Core = require('../assets/life/core.js');
require('../assets/life/home.js');
const Home = globalThis.HaedoLife.HomeUI;

function fixture() {
  const doc = Photo.create(Core.id); doc.title = '같은 제목'; doc.status = 'saved';
  doc.ops = [{ insert: '글이 달라지면 둘 다 보여야 한다', attributes: { bold: true, author: 'ai' } }, { insert: '\n' }];
  return Markdown.fromV2(doc).document;
}

test('restored-content matching includes Markdown body and formatting instead of treating every md body as empty', () => {
  const doc = fixture(), identical = structuredClone(doc);
  identical.id = Core.id(); identical.revision = 9; identical.updatedAt = '2030-01-01T00:00:00.000Z';
  assert.equal(Home.restoredContent(doc), Home.restoredContent(identical));
  const changedText = { ...identical, markdown: '다른 글의 정확한 본문\n' };
  const changedMarks = { ...identical, markdown: '글이 달라지면 둘 다 보여야 한다\n' };
  assert.notEqual(Home.restoredContent(doc), Home.restoredContent(changedText));
  assert.notEqual(Home.restoredContent(doc), Home.restoredContent(changedMarks));
});

test('restored-content matching normalizes photo identity while preserving Markdown caption and alt text', () => {
  const doc = fixture();
  const p = { id: 'original-photo', name: '산책.png', type: 'image/png', width: 1, height: 1, size: 8, digest: 'a'.repeat(64) };
  doc.photos = [p];
  doc.markdown = Markdown.fromDelta([{ insert: { photo: { id: p.id, alt: '나무', caption: '해질 무렵' } } }, { insert: '\n' }]).markdown;
  const copy = structuredClone(doc); copy.id = Core.id(); copy.photos[0].id = 'restored-photo';
  Object.assign(copy, Photo.remapBody(copy, new Map([[p.id, copy.photos[0].id]])));
  assert.equal(Home.restoredContent(doc), Home.restoredContent(copy));
  copy.markdown = copy.markdown.replace('해질 무렵', '정오');
  assert.notEqual(Home.restoredContent(doc), Home.restoredContent(copy));
});

'use strict';
// What the editor and read view rely on for a life-post-md-v1 post (2026-11-24, before B2):
// - Reading: the Delta projection (PhotoPost.contentOps) draws the same blocks, marks, photos and
//   captions as the v2 document of the same content, and gives the same text, cover photo and
//   photo-viewer order.
// - Editing: the editing buffer (PostMarkdown.toV2) stored again through fromV2 is the exact
//   stored Markdown, so an unchanged edit stores nothing new and a changed one stays md-v1.
// The DOM read view itself is checked in tests/photo-post-markdown-edit-browser.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const M = require('../assets/life/photo-post.js');
const Markdown = require('../assets/life/post-markdown.js');
const C = require('../assets/life/core.js');

async function photo(bytes) {
  const blob = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...bytes])], { type: 'image/png' });
  return { id: C.id(), name: '익명.png', type: blob.type, width: 320, height: 200, size: blob.size, digest: await M.digest(blob), blob };
}
async function fixture() {
  const photos = [await photo([1]), await photo([2])];
  const doc = M.create(C.id, '2026-11-20T03:00:00.000Z');
  Object.assign(doc, { status: 'saved', title: '익명 Markdown 글', photos,
    attachments: [{ type: 'book', title: '익명 책', creator: '익명 저자', url: 'https://example.org/book' }],
    ops: [{ insert: '첫 문단 ' }, { insert: '굵게', attributes: { bold: true } }, { insert: ' 와 ' }, { insert: '기울임', attributes: { italic: true } },
      { insert: ' 그리고 ' }, { insert: '링크', attributes: { link: 'https://example.org/a?b=1&c=2' } }, { insert: '.\n' },
      { insert: '작은 제목' }, { insert: '\n', attributes: { header: 2 } },
      { insert: 'AI가 쓴 문장', attributes: { author: 'ai' } }, { insert: ' 뒤의 내 문장.\n' },
      { insert: '목록 하나' }, { insert: '\n', attributes: { list: 'bullet' } }, { insert: '목록 둘' }, { insert: '\n', attributes: { list: 'ordered' } },
      { insert: '인용 문장' }, { insert: '\n', attributes: { blockquote: true } },
      { insert: { photo: { id: photos[1].id, caption: '첫 사진 설명', alt: '익명 풍경 2' } } },
      { insert: '사진 사이 문단\n' },
      { insert: { photo: { id: photos[0].id, caption: '둘째 설명\n줄바꿈 & <b>', alt: '익명 풍경 1' } } }, { insert: '\n' }] });
  M.validate(doc);
  return { v2: doc, md: Markdown.fromV2(doc).document };
}
// The read view's model (photo-post-ui renderRead): lines with their block attributes and inline
// runs, photos as their own blocks with caption and alt. Adjacent runs with the same marks join,
// as the drawn DOM text does.
function drawn(ops) {
  const blocks = []; let line = [];
  const push = (text, attrs) => {
    const marks = JSON.stringify(['bold', 'italic', 'underline', 'link', 'author'].map(k => attrs?.[k] ?? null));
    const last = line.at(-1);
    if (last && last.marks === marks) last.text += text; else line.push({ text, marks });
  };
  for (const op of ops) {
    if (typeof op.insert !== 'string') {
      if (line.length) { blocks.push({ line, block: {} }); line = []; }
      blocks.push({ photo: op.insert.photo });
      continue;
    }
    op.insert.split('\n').forEach((text, index, pieces) => {
      if (text) push(text, op.attributes);
      if (index < pieces.length - 1) {
        const { header = null, list = null, blockquote = null, align = null } = op.attributes || {};
        blocks.push({ line, block: { header, list, blockquote, align } }); line = [];
      }
    });
  }
  if (line.length) blocks.push({ line, block: {} });
  return blocks;
}

test('an md-v1 post reads, searches and shows photos the way the v2 post of the same content does', async () => {
  const { v2, md } = await fixture();
  assert.equal(md.format, 'life-post-md-v1'); assert.equal(Object.hasOwn(md, 'ops'), false);
  assert.deepEqual(drawn(M.contentOps(md)), drawn(M.contentOps(v2)), 'read view blocks, marks, photos and captions');
  assert.equal(M.plainText(md), M.plainText(v2), 'search and list text');
  const photosOf = d => M.contentOps(d).filter(op => op.insert?.photo).map(op => op.insert.photo);
  assert.deepEqual(photosOf(md), photosOf(v2), 'photo viewer order and captions');
  assert.equal(photosOf(md)[0].id, v2.photos[1].id, 'the list cover is the first photo of the body, not of the photo list');
  assert.deepEqual(md.attachments, v2.attachments);
  assert.equal(drawn(M.contentOps(md)).flatMap(b => b.line || []).find(run => run.text === 'AI가 쓴 문장').marks, JSON.stringify([null, null, null, null, 'ai']));
});

test('the editing buffer of an md-v1 post stores the same Markdown again, and an edit stays md-v1', async () => {
  const { md } = await fixture();
  const buffer = Markdown.toV2(md);
  assert.equal(buffer.format, 'life-photo-post-v2');
  M.validate(buffer);
  const again = Markdown.fromV2({ ...M.normalize(buffer).doc, format: 'life-photo-post-v2' }).document;
  M.validate(again);
  assert.equal(again.markdown, md.markdown, 'an unchanged edit is the stored body');
  assert.equal(M.contentKey(again), M.contentKey(md), 'and compares equal to it');
  assert.deepEqual(again.photos.map(p => p.digest), md.photos.map(p => p.digest));
  const edited = structuredClone(buffer);
  edited.ops[0] = { insert: '고친 첫 문단 ' };
  const stored = Markdown.fromV2({ ...M.normalize(edited).doc, format: 'life-photo-post-v2' }).document;
  M.validate(stored);
  assert.equal(stored.format, 'life-post-md-v1');
  assert.equal(stored.markdown, md.markdown.replace(/^첫 문단 /, '고친 첫 문단 '));
  assert.equal(M.contentOps(stored).find(op => op.attributes?.author === 'ai').insert, 'AI가 쓴 문장');
});

test('a body the codec refuses is never returned in another format: the refusal carries its code', async () => {
  const { v2 } = await fixture();
  const boundary = structuredClone(v2);
  boundary.ops.splice(boundary.ops.findIndex(op => op.insert?.photo), 0, { insert: '줄바꿈 없는 글' });
  M.validate(boundary);
  assert.throws(() => Markdown.fromV2(boundary), error => error.code === 'post_markdown_conversion_boundary');
});

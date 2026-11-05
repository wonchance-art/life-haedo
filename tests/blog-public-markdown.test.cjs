'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Photo = require('../assets/life/photo-post.js'), Blog = require('../assets/life/blog.js');
const Markdown = require('../assets/life/post-markdown.js'), Public = require('../assets/life/blog-public.js');

async function fixture() {
  const doc = Photo.create(randomUUID, '2026-11-05T00:00:00.000Z');
  doc.title = '한글 글과 사진'; doc.status = 'saved';
  for (const [name, byte] of [['선택한 원본.png', 1], ['숨긴 원본.png', 2]]) {
    const blob = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, byte])], { type: 'image/png' });
    doc.photos.push({ id: randomUUID(), name, type: blob.type, width: 8, height: 8, size: blob.size, digest: await Photo.digest(blob), blob });
  }
  doc.ops = [
    { insert: '제목' }, { insert: '\n', attributes: { header: 1 } },
    { insert: '직접 쓴 글. ' }, { insert: 'AI 문장', attributes: { bold: true, author: 'ai' } }, { insert: '\n' },
    { insert: '<span data-author="ai">는 글자</span> haedo-photo:' + doc.photos[1].id + '\n' },
    { insert: { photo: { id: doc.photos[0].id, caption: '설명\n둘째 줄', alt: '첫 사진' } } },
    { insert: { photo: { id: doc.photos[1].id, caption: '선택 안 한 사진 설명', alt: '숨긴 대체 글' } } },
    { insert: '끝', attributes: { link: 'https://example.org/a?x=&amp;' } }, { insert: '\n' },
  ];
  doc.attachments = [{ type: 'book', title: '읽은 책', creator: '저자', url: 'https://example.org/book' }];
  return { old: doc, md: Markdown.fromV2(doc).document };
}
const body = value => value.ops;
const hasAI = ops => ops.some(op => op.attributes?.author === 'ai');

test('Markdown private manifests preserve their canonical string, metadata and original bytes through pack/hydrate', async () => {
  const { md } = await fixture(), before = structuredClone(md), manifest = Blog.pack(md);
  assert.equal(manifest.format, 'life-post-md-v1');
  assert.equal(manifest.markdown, md.markdown); assert.equal(Object.hasOwn(manifest, 'ops'), false);
  assert.deepEqual(Blog.validateManifest(JSON.parse(JSON.stringify(manifest))), manifest);
  const hydrated = await Blog.hydrate(JSON.parse(JSON.stringify(manifest)), md.photos);
  assert.deepEqual(hydrated, before); assert.deepEqual(md, before);
  for (let i = 0; i < md.photos.length; i++) assert.deepEqual(await hydrated.photos[i].blob.arrayBuffer(), await md.photos[i].blob.arrayBuffer());
  for (const mutate of [x => x.ops = [], x => x.markdown = '![remote](https://example.org/private.png)\n', x => x.format = 'life-post-md-v2']) {
    const bad = structuredClone(manifest); mutate(bad); assert.throws(() => Blog.validateManifest(bad));
  }
});

test('Markdown public snapshots default to no photos, strip AI marks only, and keep escaped tag text', async () => {
  const { md } = await fixture(), before = structuredClone(md), snapshot = Blog.publicSnapshot(md);
  assert.equal(snapshot.format, 'life-blog-public-v1'); assert.equal(Object.hasOwn(snapshot, 'markdown'), false);
  assert.deepEqual(snapshot.photos, []); assert.equal(hasAI(body(snapshot)), false);
  assert(!body(snapshot).some(op => typeof op.insert !== 'string'));
  const text = body(snapshot).map(op => op.insert).join('');
  assert(text.includes('AI 문장')); assert(text.includes('<span data-author="ai">는 글자</span>'));
  assert(text.includes('haedo-photo:' + md.photos[1].id), 'literal photo-like text is preserved');
  assert(!JSON.stringify(snapshot).includes('선택 안 한 사진 설명'));
  assert(!JSON.stringify(snapshot).includes('숨긴 대체 글')); assert(!JSON.stringify(snapshot).includes('선택한 원본.png'));
  assert.deepEqual(md, before);
  assert.equal(Blog.validateSnapshot(snapshot), snapshot);
});

test('selected Markdown photo references use new public IDs and sanitized copy metadata', async () => {
  const { md } = await fixture(), original = md.photos[0];
  const copy = { id: original.id, type: 'image/png', width: 4, height: 4, size: 42, digest: 'f'.repeat(64) };
  const snapshot = Blog.publicSnapshot(md, { photoIds: [original.id], copies: [copy] });
  assert.equal(snapshot.photos.length, 1); assert.notEqual(snapshot.photos[0].id, original.id);
  assert.equal(snapshot.photos[0].digest, copy.digest); assert.equal(snapshot.photos[0].width, copy.width);
  const image = body(snapshot).filter(op => typeof op.insert !== 'string'); assert.equal(image.length, 1);
  assert.deepEqual(image[0].insert.photo, { id: snapshot.photos[0].id, caption: '설명\n둘째 줄', alt: '첫 사진' });
  assert(!JSON.stringify(snapshot).includes(original.digest)); assert(!JSON.stringify(snapshot).includes(original.id));
  for (const copies of [[], [{ ...copy, digest: original.digest }], [{ ...copy, id: md.photos[1].id }]])
    assert.throws(() => Blog.publicSnapshot(md, { photoIds: [original.id], copies }), { code: 'invalid_blog_selection' });
  assert.throws(() => Blog.publicSnapshot(md, { photoIds: [original.id, original.id], copies: [copy] }), { code: 'invalid_blog_selection' });
});

test('Markdown private reading keeps AI and rejects public/private format confusion and hidden payloads', async () => {
  const { md } = await fixture();
  const reading = Blog.privateReadingSnapshot(md, { photoIds: md.photos.map(p => p.id) });
  assert.equal(reading.format, 'life-blog-private-reading-v1'); assert.equal(hasAI(body(reading)), true);
  assert.equal(Blog.validateReadingSnapshot(reading), reading);
  assert.throws(() => Blog.validateSnapshot(reading), { code: 'invalid_blog_snapshot' });
  const snapshot = Blog.publicSnapshot(md);
  assert.throws(() => Blog.validateReadingSnapshot(snapshot), { code: 'invalid_blog_snapshot' });
  for (const mutate of [
    x => x.ops = [{ insert: '표시\n', attributes: { author: 'ai' } }], x => x.ops = [{ insert: { image: 'https://example.org/private.png' } }],
    x => x.markdown = 'another body\n', x => x.author.email = 'private@example.invalid',
    x => x.photos.push({ id: randomUUID(), type: 'image/png', size: 1, width: 1, height: 1, digest: 'a'.repeat(64) }),
  ]) {
    const bad = structuredClone(snapshot); mutate(bad);
    assert.throws(() => Blog.validateSnapshot(bad), { code: 'invalid_blog_snapshot' });
  }
});

test('anonymous transport accepts a valid Markdown public copy but rejects private reading and body tampering', async () => {
  const { md } = await fixture(), token = randomUUID();
  let snapshot = Blog.publicSnapshot(md);
  const reader = Public.createReader({ config: { url: 'https://anonymous.supabase.co', key: 'sb_publishable_fixture' },
    fetch: async () => Response.json({ token, blogToken: randomUUID(), revision: 1, createdAt: md.createdAt, updatedAt: md.updatedAt, snapshot }) });
  try {
    assert.deepEqual((await reader.read(token)).snapshot, snapshot);
    snapshot = Blog.privateReadingSnapshot(md); await assert.rejects(reader.read(token), { code: 'invalid_remote_data' });
    snapshot = Blog.publicSnapshot(md); snapshot.markdown = 'another body\n'; await assert.rejects(reader.read(token), { code: 'invalid_remote_data' });
  } finally { reader.dispose(); }
});

test('photo-ending Markdown projections do not invent a visible blank paragraph', async () => {
  const { md } = await fixture(), photo = md.photos[0];
  md.photos = [photo]; md.markdown = '![한 장](haedo-photo:' + photo.id + ' "끝 사진")\n';
  Photo.validate(md);
  const omitted = Blog.publicSnapshot(md);
  assert.deepEqual(omitted.ops, []); assert.deepEqual(omitted.photos, []);
  assert.equal(Blog.validateSnapshot(omitted), omitted);
  const selected = Blog.publicSnapshot(md, { photoIds: [photo.id] });
  assert.equal(selected.ops.length, 1); assert.equal(typeof selected.ops[0].insert, 'object');
  assert.equal(Blog.validateSnapshot(selected), selected);
  const reading = Blog.privateReadingSnapshot(md, { photoIds: [photo.id] });
  assert.equal(reading.ops.length, 1); assert.equal(Blog.validateReadingSnapshot(reading), reading);
  assert.equal(md.markdown, '![한 장](haedo-photo:' + photo.id + ' "끝 사진")\n');
  const unfinished = { ...omitted, ops: [{ insert: '끝나지 않은 줄' }] };
  assert.throws(() => Blog.validateSnapshot(unfinished), { code: 'invalid_blog_snapshot' }, 'legacy text termination is still checked');
});

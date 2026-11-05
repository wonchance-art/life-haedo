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

// A real Delta may combine several paragraphs, split a marked run arbitrarily,
// or attach inline marks to the newline as well. These all render identically.
async function equivalentFixture() {
  const { old } = await fixture();
  old.ops = [
    { insert: '산책 기록\n', attributes: { header: 1, align: 'center' } },
    { insert: '첫 문단\n둘째 문단\n' },
    { insert: '굵은', attributes: { bold: true, link: 'https://example.org/walk?a=1&b=2', underline: true } },
    { insert: ' 링크', attributes: { link: 'https://example.org/walk?a=1&b=2', bold: true, underline: true } },
    { insert: '\n' },
    { insert: '직접 쓴 문장. ' }, { insert: 'AI가 도운 문장.', attributes: { author: 'ai' } }, { insert: '\n' },
    { insert: 'AI 첫 줄\nAI 둘째 줄\n', attributes: { italic: true, author: 'ai' } },
    { insert: '첫 항목\n둘째 항목\n', attributes: { list: 'bullet' } },
    { insert: { photo: { id: old.photos[0].id, caption: '공개한 산책\n사진 설명', alt: '산책 사진' } } },
    { insert: { photo: { id: old.photos[1].id, caption: '숨긴 사진 설명', alt: '숨긴 대체 글' } } },
    { insert: '마지막 인용\n', attributes: { blockquote: true } },
  ];
  const md = Markdown.fromV2(old).document, comparable = structuredClone(old);
  // D2 intentionally drops only these two styles; do not normalize the expected
  // body through the codec under test or discard any text/AI/photo differences.
  for (const op of comparable.ops) if (op.attributes) {
    delete op.attributes.underline; delete op.attributes.align;
    if (!Object.keys(op.attributes).length) delete op.attributes;
  }
  return { old, comparable, md };
}

test('equivalent multiline v2 and Markdown public snapshots have identical serialized bytes', async t => {
  const { old, comparable, md } = await equivalentFixture(), before = structuredClone({ old, comparable, md });
  const publicId = '11111111-1111-4111-8111-111111111111';
  t.mock.method(globalThis.crypto || require('node:crypto').webcrypto, 'randomUUID', () => publicId);
  const selected = old.photos[0], copy = { id: selected.id, type: 'image/png', width: 4, height: 4, size: 42, digest: 'f'.repeat(64) };
  for (const options of [{}, { photoIds: [selected.id], copies: [copy], author: { name: '산책하는 사람', intro: '날마다 기록' } }]) {
    const legacy = Blog.publicSnapshot(comparable, options), markdown = Blog.publicSnapshot(md, options);
    assert.equal(JSON.stringify(markdown), JSON.stringify(legacy), 'wire bytes match, including op boundaries and attribute order');
    assert.equal(markdown.ops.filter(op => typeof op.insert === 'string').map(op => op.insert).join(''),
      '산책 기록\n첫 문단\n둘째 문단\n굵은 링크\n직접 쓴 문장. AI가 도운 문장.\nAI 첫 줄\nAI 둘째 줄\n첫 항목\n둘째 항목\n마지막 인용\n');
    assert.deepEqual(markdown.ops.find(op => op.insert === '굵은 링크'),
      { insert: '굵은 링크', attributes: { bold: true, link: 'https://example.org/walk?a=1&b=2' } });
    assert.deepEqual(markdown.ops.filter(op => op.attributes?.italic), [
      { insert: 'AI 첫 줄', attributes: { italic: true } }, { insert: 'AI 둘째 줄', attributes: { italic: true } },
    ]);
    assert.deepEqual(markdown.ops.filter(op => op.attributes?.header || op.attributes?.list || op.attributes?.blockquote), [
      { insert: '\n', attributes: { header: 1 } }, { insert: '\n', attributes: { list: 'bullet' } },
      { insert: '\n', attributes: { list: 'bullet' } }, { insert: '\n', attributes: { blockquote: true } },
    ]);
    assert.equal(hasAI(markdown.ops), false);
    assert.equal(markdown.ops.filter(op => typeof op.insert !== 'string').length, options.photoIds ? 1 : 0);
    assert(!JSON.stringify(markdown).includes('숨긴 사진 설명'));
    assert(!JSON.stringify(markdown).includes('숨긴 대체 글'));
    if (options.photoIds) {
      assert.equal(markdown.photos[0].id, publicId); assert.equal(markdown.photos[0].digest, copy.digest);
      assert(!JSON.stringify(markdown).includes(selected.digest));
      assert(!JSON.stringify(markdown).includes(selected.id));
    }
  }
  const legacy = Blog.publicSnapshot(old);
  assert(legacy.ops.some(op => op.attributes?.underline === true), 'legacy public underline remains supported');
  assert(legacy.ops.some(op => op.attributes?.align === 'center'), 'legacy public alignment remains supported');
  assert.deepEqual({ old, comparable, md }, before, 'projection never rewrites either stored source');
});

test('legacy multiline public copies stay readable when semantic normalization exceeds the existing envelope', () => {
  const cases = [
    { insert: '가\n'.repeat(3000), attributes: { bold: true, author: 'ai' } },
    { insert: '나\n'.repeat(1500), attributes: { link: 'https://example.org/' + 'a'.repeat(1500), author: 'ai' } },
  ];
  for (const original of cases) {
    const doc = Photo.create(randomUUID, '2026-11-05T00:00:00.000Z');
    doc.status = 'saved'; doc.ops = [structuredClone(original)];
    Photo.validate(doc); const before = structuredClone(doc);
    const { author: _private, ...attributes } = original.attributes;
    const expected = [{ insert: original.insert, attributes }], normalized = Markdown.normalizeDelta(expected);
    const snapshot = Blog.publicSnapshot(doc);
    assert(normalized.length > Photo.LIMITS.ops || new TextEncoder().encode(JSON.stringify({ ...snapshot, ops: normalized })).length > Blog.LIMITS.bytes,
      'the fixture actually reaches a pre-existing projection bound');
    assert.deepEqual(snapshot.ops, expected, 'legacy fallback keeps every character and style, still strips AI');
    assert.equal(hasAI(snapshot.ops), false); assert.equal(Blog.validateSnapshot(snapshot), snapshot);
    assert.deepEqual(doc, before, 'stored legacy source is untouched');
  }
});

test('public photo metadata and fresh IDs follow body order regardless of legacy metadata order', async t => {
  const { old } = await fixture(), bodyPhotos = old.photos.slice(); old.photos.reverse();
  const md = Markdown.fromV2(old).document, before = structuredClone(old);
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  let next = 0;
  t.mock.method(globalThis.crypto || require('node:crypto').webcrypto, 'randomUUID', () => ids[next++]);
  const copies = bodyPhotos.map((p, i) => ({ id: p.id, type: 'image/png', width: 4, height: 4, size: 40 + i, digest: String(i + 3).repeat(64) }));
  const options = { photoIds: old.photos.map(p => p.id), copies };
  const legacy = Blog.publicSnapshot(old, options); next = 0;
  const markdown = Blog.publicSnapshot(md, options);
  assert.equal(JSON.stringify(legacy), JSON.stringify(markdown));
  assert.deepEqual(legacy.photos.map(p => p.id), ids);
  assert.deepEqual(legacy.photos.map(p => p.digest), copies.map(p => p.digest));
  assert.deepEqual(legacy.ops.filter(op => typeof op.insert !== 'string').map(op => op.insert.photo.id), ids);
  next = 0;
  const privateCopy = Blog.privateReadingSnapshot(old, { photoIds: options.photoIds });
  assert.deepEqual(privateCopy.photos.map(p => p.digest), old.photos.map(p => p.digest), 'private reading metadata order stays exact');
  assert.deepEqual(old, before);
});

test('an implicit paragraph at the legacy text limit keeps a readable public projection', async () => {
  const { old } = await fixture(), photo = old.photos[0]; old.photos = [photo];
  old.ops = [{ insert: '가'.repeat(Photo.LIMITS.text - 1) },
    { insert: { photo: { id: photo.id, caption: '끝 사진', alt: '대체 글' } } }, { insert: '\n' }];
  Photo.validate(old); const before = structuredClone(old);
  const snapshot = Blog.publicSnapshot(old, { photoIds: [photo.id] });
  assert.equal(snapshot.ops.length, 3);
  assert.equal(snapshot.ops[0].insert, old.ops[0].insert);
  assert.equal(snapshot.ops[2].insert, '\n');
  assert.equal(snapshot.ops[1].insert.photo.id, snapshot.photos[0].id);
  assert.notEqual(snapshot.photos[0].id, photo.id);
  assert.equal(Blog.validateSnapshot(snapshot), snapshot);
  assert.deepEqual(old, before);
});

test('omitting a photo preserves the source paragraph boundary in both v2 and Markdown public copies', async () => {
  const { old } = await fixture(), photo = old.photos[0]; old.photos = [photo];
  old.ops = [{ insert: '사진 앞' }, { insert: { photo: { id: photo.id, caption: '숨긴 설명', alt: '숨긴 대체 글' } } }, { insert: '사진 뒤\n' }];
  const md = Markdown.fromV2(old).document, before = structuredClone(old);
  const legacy = Blog.publicSnapshot(old), markdown = Blog.publicSnapshot(md);
  assert.equal(JSON.stringify(legacy), JSON.stringify(markdown));
  assert.deepEqual(legacy.ops, [{ insert: '사진 앞\n사진 뒤\n' }]);
  assert.deepEqual(legacy.photos, []);
  assert(!JSON.stringify(legacy).includes('숨긴 설명')); assert(!JSON.stringify(legacy).includes('숨긴 대체 글'));
  assert.deepEqual(old, before);
});

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

test('photo-ending snapshots retain the actual 5000-op and 50000-character limits without counting a validation sentinel', async () => {
  const { md } = await fixture(), photo = md.photos[0]; md.photos = [photo];
  const end = { insert: { photo: { id: photo.id, caption: '', alt: '' } } };
  const atOps = [{ insert: '앞' }];
  for (let i = 0; i < 2499; i++) atOps.push({ insert: '가', attributes: { bold: true } }, { insert: '\n' });
  atOps.push(end); assert.equal(atOps.length, Photo.LIMITS.ops);
  const atText = [{ insert: '나'.repeat(Photo.LIMITS.text - 1) + '\n' }, end];
  for (const ops of [atOps, atText]) {
    md.markdown = Markdown.fromDelta(ops).markdown; Photo.validate(md);
    const before = structuredClone(md), snapshot = Blog.publicSnapshot(md, { photoIds: [photo.id] });
    const serialized = JSON.stringify(snapshot);
    const reading = Blog.privateReadingSnapshot(md, { photoIds: [photo.id] });
    assert.equal(Blog.validateReadingSnapshot(reading), reading);
    if (ops === atOps) assert.equal(snapshot.ops.length, Photo.LIMITS.ops);
    else assert.equal(snapshot.ops.reduce((n, op) => n + (typeof op.insert === 'string' ? op.insert.length : 0), 0), Photo.LIMITS.text);
    assert.equal(typeof snapshot.ops.at(-1).insert, 'object');
    assert.equal(Blog.validateSnapshot(snapshot), snapshot);
    assert.equal(JSON.stringify(snapshot), serialized, 'validation never reorders visible ops');
    assert.deepEqual(md, before);
    const over = structuredClone(snapshot);
    if (ops === atOps) over.ops.splice(1, 0, { insert: '추가' });
    else over.ops[0].insert = '추가' + over.ops[0].insert.slice(1);
    if (ops === atOps) assert.equal(over.ops.length, Photo.LIMITS.ops + 1);
    else assert.equal(over.ops.reduce((n, op) => n + (typeof op.insert === 'string' ? op.insert.length : 0), 0), Photo.LIMITS.text + 1);
    assert.throws(() => Blog.validateSnapshot(over), { code: 'invalid_blog_snapshot' }, 'actual wire limits remain unchanged');
  }
});

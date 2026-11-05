'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/life/post-markdown.js');
const text = markdown => M.toDelta(markdown).filter(op => typeof op.insert === 'string').map(op => op.insert).join('');

test('supported Markdown parses into explicit blocks, marks and canonical text', () => {
  const raw = '# 제목\n\n**굵게**와 _기울임_\n\n> 인용\n>\n> 둘\n\n* 하나\n* 둘\n';
  const parsed = M.parse(raw);
  assert.deepEqual(parsed.ops, [
    { insert: '제목' }, { insert: '\n', attributes: { header: 1 } },
    { insert: '굵게', attributes: { bold: true } }, { insert: '와 ' }, { insert: '기울임', attributes: { italic: true } }, { insert: '\n인용' }, { insert: '\n', attributes: { blockquote: true } }, { insert: '둘' }, { insert: '\n', attributes: { blockquote: true } },
    { insert: '하나' }, { insert: '\n', attributes: { list: 'bullet' } }, { insert: '둘' }, { insert: '\n', attributes: { list: 'bullet' } }
  ]);
  assert.equal(M.canonicalize(parsed.markdown), parsed.markdown);
  assert.deepEqual(M.toDelta(''), [{ insert: '\n' }]);
  assert.deepEqual(M.toDelta('\n'), [{ insert: '\n' }]);
});

test('only exact paired inline HTML tags become marks; other tags remain literal text', () => {
  for (const raw of ['<img src="https://tracker.example/a" onerror="alert(1)">', '<STRONG>x</STRONG>', '<strong class="x">x</strong>',
    '<span data-author="ai" onclick="x">x</span>', '<strong>unclosed', 'closed</strong>', '<strong><em>x</strong></em>']) {
    assert.equal(text(raw), raw + '\n');
    assert(M.toDelta(raw).every(op => !op.attributes));
    assert.doesNotMatch(M.canonicalize(raw), /(?<!\\)<(?:img|span|strong|em|STRONG)/);
  }
  assert.deepEqual(M.toDelta('<strong><em>한글</em></strong>'), [{ insert: '한글', attributes: { bold: true, italic: true } }, { insert: '\n' }]);
  assert.deepEqual(M.toDelta('<strong>가<strong>나</strong>다</strong>'), [{ insert: '가나다', attributes: { bold: true } }, { insert: '\n' }]);
  assert.deepEqual(M.toDelta('<span data-author="ai">AI **글**</span>'), [
    { insert: 'AI ', attributes: { author: 'ai' } }, { insert: '글', attributes: { bold: true, author: 'ai' } }, { insert: '\n' }
  ]);
  assert.equal(text('\\<span data-author="ai"\\>내 글\\</span\\>'), '<span data-author="ai">내 글</span>\n');
});

test('unsafe links never become active links and external images are rejected', () => {
  for (const raw of ['[x](javascript:alert(1))', '[x](data:text/html,x)', '[x](file:///etc/passwd)', '<script>alert(1)</script>'])
    assert(M.toDelta(raw).every(op => !op.attributes?.link));
  for (const raw of ['[x](../private)', '[x](https://user:secret@example.org)', '[x](mailto:x@example.org)',
    '![](https://tracker.example/a.png)', '![](https://a.coabc)', '![](data:image/png;base64,AA)', '![](haedo-photo:../x)']) assert.throws(() => M.parse(raw), { code: 'invalid_post_markdown' }, raw);
  const link = 'https://example.org/한글?q=%zz&amp;literal=1|2';
  const md = M.fromDelta([{ insert: '연결', attributes: { link } }, { insert: '\n' }]).markdown;
  assert.equal(M.toDelta(md)[0].attributes.link, link);
});

test('unsupported constructs and ambiguous photo placement fail without discarding content', () => {
  for (const raw of ['### 세 번째', '```js\nx\n```', '`code`', '---', 'a\nb', 'a  \nb', '- a\n  - b', '> - a', '2. starts at two',
    '- a\n\n  b', '[x](https://example.org "title")', '![](haedo-photo:a) 말', '**![](haedo-photo:a)**',
    '![](haedo-photo:a)\n\n![](haedo-photo:a)', '# ![](haedo-photo:a)']) assert.throws(() => M.parse(raw), { code: 'invalid_post_markdown' }, raw);
  assert.throws(() => M.parse('x'.repeat(M.LIMITS.markdown + 1)), { code: 'invalid_post_markdown' });
  assert.throws(() => M.parse('\ud800'), { code: 'invalid_post_markdown' });
  assert.throws(() => M.parse('\u0000'), { code: 'invalid_post_markdown' });
});

test('photo remapping changes references only, retaining caption, alt, AI and image-like text', () => {
  const ops = [{ insert: '![가짜](haedo-photo:a)\n' }, { insert: { photo: { id: 'a', alt: '대체\n글', caption: '설명\n& "인용"' } } },
    { insert: '뒤', attributes: { author: 'ai' } }, { insert: '\n' }];
  const raw = M.fromDelta(ops).markdown;
  const changed = M.remapPhotos(raw, new Map([['a', 'b']]));
  assert.deepEqual(M.parse(changed).photos, ['b']);
  assert.equal(M.toDelta(changed)[0].insert, '![가짜](haedo-photo:a)\n');
  assert.deepEqual(M.toDelta(changed)[1].insert.photo, { id: 'b', alt: '대체\n글', caption: '설명\n& "인용"' });
  assert.equal(M.toDelta(changed)[2].attributes.author, 'ai');
  assert.throws(() => M.remapPhotos(raw, {}), { code: 'invalid_post_markdown' });
  assert.throws(() => M.remapPhotos('![](haedo-photo:a)\n\n![](haedo-photo:b)\n', { a: 'c', b: 'c' }), { code: 'invalid_post_markdown' });
  assert.deepEqual(M.toDelta('![](haedo-photo:a)\n'), [{ insert: { photo: { id: 'a', caption: '', alt: '' } } }]);
});

test('compatibility projection clones metadata without rewriting the stored Markdown document', () => {
  const original = { format: M.FORMAT, id: 'p', markdown: '**글**\n', photos: [], attachments: [{ title: '보존' }] };
  const before = structuredClone(original), projected = M.toV2(original);
  assert.equal(projected.format, 'life-photo-post-v2');
  assert.equal('markdown' in projected, false);
  assert.deepEqual(projected.ops, [{ insert: '글', attributes: { bold: true } }, { insert: '\n' }]);
  projected.attachments[0].title = '수정';
  assert.deepEqual(original, before);
});

// A single legacy Delta insert can contain thousands of lines. Parsing each
// paragraph into two operations must not turn a valid old post into >5000 ops.
for (const lines of [2600, 25000]) test('legacy ' + lines + '-line body stays within the original text/operation limits after conversion', () => {
  const PhotoPost = require('../assets/life/photo-post.js');
  const legacy = PhotoPost.create(() => 'long-post');
  legacy.ops = [{ insert: '가\n'.repeat(lines) }];
  assert.doesNotThrow(() => PhotoPost.validate(legacy));
  const converted = M.fromV2(legacy).document;
  const parsed = M.parse(converted.markdown);
  assert.equal(parsed.ops.length, legacy.ops.length);
  assert.deepEqual(parsed.ops, legacy.ops);
  assert.equal(parsed.markdown, converted.markdown);
  assert.doesNotThrow(() => PhotoPost.validate(converted));
  assert.equal(PhotoPost.plainText(converted), PhotoPost.plainText(legacy));
});

test('50,000 empty list lines keep the same single block-format operation and original capacity', () => {
  const PhotoPost = require('../assets/life/photo-post.js');
  const legacy = PhotoPost.create(() => 'long-list');
  legacy.ops = [{ insert: '\n'.repeat(50000), attributes: { list: 'bullet' } }];
  assert.doesNotThrow(() => PhotoPost.validate(legacy));
  const converted = M.fromV2(legacy).document;
  assert.deepEqual(M.toDelta(converted.markdown), legacy.ops);
  assert.doesNotThrow(() => PhotoPost.validate(converted));
});

test('conversion that exceeds existing operation capacity fails before returning or changing the legacy document', () => {
  const PhotoPost = require('../assets/life/photo-post.js');
  const legacy = PhotoPost.create(() => 'styled-long');
  legacy.ops = [{ insert: 'a\n'.repeat(3000), attributes: { bold: true } }];
  const before = structuredClone(legacy);
  assert.doesNotThrow(() => PhotoPost.validate(legacy));
  assert.throws(() => M.fromV2(legacy), { code: 'post_markdown_conversion_limit' });
  assert.deepEqual(legacy, before);
  assert.doesNotThrow(() => PhotoPost.validate(legacy));
});


for (const [name, attributes] of [['heading', { header: 1 }], ['quote', { blockquote: true }], ['list', { list: 'bullet' }]]) {
  test('oversized ' + name + ' conversion preserves the valid legacy body without returning an invalid candidate', () => {
    const PhotoPost = require('../assets/life/photo-post.js');
    const legacy = PhotoPost.create(() => 'long-formatted');
    legacy.ops = [{ insert: '가\n'.repeat(2600), attributes }];
    const before = structuredClone(legacy);
    assert.doesNotThrow(() => PhotoPost.validate(legacy));
    assert.throws(() => M.fromV2(legacy), { code: 'post_markdown_conversion_limit' });
    assert.deepEqual(legacy, before);
  });
}

test('near-limit implicit photo paragraph is refused before returning or changing a valid legacy document', () => {
  const PhotoPost = require('../assets/life/photo-post.js');
  const legacy = PhotoPost.create(() => 'long-photo');
  const blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
  legacy.photos = [{ id: 'photo', name: 'p.png', type: blob.type, size: blob.size, width: 1, height: 1, digest: 'a'.repeat(64), blob }];
  legacy.ops = [{ insert: 'a'.repeat(49999) }, { insert: { photo: { id: 'photo', caption: '', alt: '' } } }, { insert: '\n' }];
  const before = structuredClone(legacy);
  assert.doesNotThrow(() => PhotoPost.validate(legacy));
  assert.throws(() => M.fromV2(legacy), { code: 'post_markdown_conversion_boundary' });
  assert.deepEqual(legacy, before);
});

test('ambiguous implicit photo paragraph boundaries fail closed while explicit newlines convert', () => {
  const PhotoPost = require('../assets/life/photo-post.js');
  const doc = PhotoPost.create(() => 'boundary');
  const blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
  doc.photos = [{ id: 'photo', name: 'p.png', type: blob.type, size: blob.size, width: 1, height: 1, digest: 'a'.repeat(64), blob }];
  const photo = { insert: { photo: { id: 'photo', caption: '설명', alt: '대체' } } };
  const explicit = { ...doc, ops: [{ insert: '사진 앞\n' }, photo, { insert: '사진 뒤\n' }] };
  PhotoPost.validate(explicit);
  const explicitBefore = structuredClone(explicit), converted = M.fromV2(explicit).document;
  assert.doesNotThrow(() => PhotoPost.validate(converted));
  assert.deepEqual(explicit, explicitBefore);
  for (const prefix of [
    [{ insert: '사진 앞' }],
    [{ insert: '사진 ' }, { insert: '앞', attributes: { bold: true } }],
    [{ insert: '첫 문단\n사진 앞' }],
    [{ insert: '사진 앞' }, { insert: '' }]
  ]) {
    const implicit = { ...doc, ops: [...prefix, photo, { insert: '사진 뒤\n' }] };
    PhotoPost.validate(implicit);
    const before = structuredClone(implicit);
    if (prefix.length === 1 && prefix[0].insert === '사진 앞')
      assert.equal(M.fromDelta(implicit.ops).markdown, M.fromDelta(explicit.ops).markdown,
        'the same Markdown cannot encode the two different legacy publication boundaries');
    assert.throws(() => M.fromV2(implicit), { code: 'post_markdown_conversion_boundary' });
    assert.deepEqual(implicit, before);
    assert.doesNotThrow(() => PhotoPost.validate(implicit));
  }
  const endedInSeparateOp = { ...doc, ops: [{ insert: '사진 앞' }, { insert: '\n', attributes: { header: 1 } }, photo, { insert: '\n' }] };
  assert.doesNotThrow(() => PhotoPost.validate(M.fromV2(endedInSeparateOp).document));
});

test('defensive conversion text guard rejects an over-capacity candidate even when the supplied Delta has no terminal newline', () => {
  const PhotoPost = require('../assets/life/photo-post.js');
  const incomplete = { ...PhotoPost.create(() => 'incomplete'), ops: [{ insert: 'a'.repeat(50000) }] };
  const before = structuredClone(incomplete);
  assert.throws(() => PhotoPost.validate(incomplete), 'this is not a valid legacy document');
  assert.throws(() => M.fromV2(incomplete), { code: 'post_markdown_conversion_limit' });
  assert.deepEqual(incomplete, before);
});

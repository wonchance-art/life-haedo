'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), { createRequire } = require('node:module');
const M = require('../assets/life/post-markdown.js'), P = require('../assets/life/photo-post.js');
const codecPath = require.resolve('../assets/life/post-markdown.js');
const source = fs.readFileSync(codecPath, 'utf8');
// Execute the real parser with only packing removed. This is both the previous
// projection oracle and a mutation check that exercises the unchanged model cap.
const originalReturn = 'ops: packCapacity(ops), photos, markdown: fromDelta(ops).markdown';
assert.equal(source.split(originalReturn).length, 2, 'packing mutation must change exactly one return');
const sandbox = { module: { exports: {} }, require: createRequire(codecPath), URL, TextEncoder, structuredClone };
vm.runInNewContext(source.replace(originalReturn, 'ops, photos, markdown: fromDelta(ops).markdown'), sandbox);
const unpacked = sandbox.module.exports;

// Independently observe each visible character and each paragraph ending. Marks
// on a newline and block attributes on text have no rendering meaning; absent
// attributes on a visible character absolutely do (especially the AI boundary).
function meaning(ops) {
  const out = [];
  for (const op of ops) {
    if (typeof op.insert !== 'string') { out.push(['photo', op.insert.photo]); continue; }
    const a = op.attributes || {};
    for (const character of op.insert) out.push(character === '\n'
      ? ['end', a.header || null, a.list || null, a.blockquote === true]
      : ['text', character, a.bold === true, a.italic === true, a.author === 'ai', a.link || null]);
  }
  return out;
}

function check(ops, label, photos = []) {
  const legacy = P.create(() => 'capacity'); legacy.ops = ops; legacy.photos = photos;
  const before = structuredClone(legacy); P.validate(legacy);
  const markdown = M.fromDelta(ops).markdown, decoded = M.parse(markdown), baseline = unpacked.parse(markdown);
  assert(baseline.ops.length > P.LIMITS.ops, label + ': fixture must actually require packing');
  assert(decoded.ops.length <= P.LIMITS.ops, label + ': unchanged operation limit');
  assert.equal(decoded.markdown, baseline.markdown, label + ': exact canonical bytes');
  assert.equal(decoded.markdown, markdown, label + ': stored Markdown unchanged');
  assert.deepEqual(meaning(decoded.ops), meaning(ops), label + ': every character, mark and block');
  assert.equal(M.fromDelta(decoded.ops).markdown, markdown, label + ': packed roundtrip');
  const converted = M.fromV2(legacy).document;
  assert.equal(converted.markdown, markdown); P.validate(converted);
  assert.throws(() => unpacked.fromV2(legacy), { code: 'post_markdown_conversion_limit' },
    label + ': removing packing must fail the real conversion capacity guard');
  assert.deepEqual(legacy, before, label + ': original document remains exact');
  return decoded.ops;
}

test('projections at or below 5,000 operations retain their exact previous bytes', () => {
  for (const lines of [1, 2499, 2500]) {
    const markdown = M.fromDelta([{ insert: '가\n'.repeat(lines), attributes: { author: 'ai', bold: true } }]).markdown;
    const baseline = unpacked.parse(markdown), current = M.parse(markdown);
    assert.equal(baseline.ops.length, lines * 2);
    assert.equal(JSON.stringify(current), JSON.stringify(baseline));
  }
});

test('50,000-character marked and block-formatted legacy bodies fit the unchanged limits', () => {
  assert.equal(P.LIMITS.ops, 5000); assert.equal(P.LIMITS.text, 50000);
  for (const attributes of [{ bold: true }, { author: 'ai', bold: true }, { list: 'bullet' },
    { list: 'ordered', italic: true }, { header: 2 }, { blockquote: true, author: 'ai' }]) {
    const result = check([{ insert: ('가'.repeat(9) + '\n').repeat(5000), attributes }], JSON.stringify(attributes));
    assert.equal(result.length, 1);
  }
});

test('blank lines between opposing marks preserve absent AI, bold and link attributes', () => {
  const ops = [];
  for (let i = 0; i < 2000; i++) {
    ops.push({ insert: '가', attributes: { bold: true, author: 'ai', link: 'https://example.org/ai' } },
      { insert: '\n\n나\n', attributes: { italic: true } });
  }
  const packed = check(ops, 'blank line between AI and human');
  assert.equal(packed.length, 4000, 'empty paragraphs must not force a third op per pair');
});

test('photos remain exact barriers between packed AI and human text', () => {
  const photo = { id: 'photo', name: 'original.png', type: 'image/png', width: 1, height: 1,
    size: 1, digest: 'a'.repeat(64), blob: new Blob(['x'], { type: 'image/png' }) };
  const ops = [{ insert: '가\n'.repeat(1300), attributes: { author: 'ai', bold: true } },
    { insert: { photo: { id: 'photo', alt: '대체 글', caption: '사진\n설명' } } },
    { insert: '나\n'.repeat(1300), attributes: { italic: true, list: 'bullet' } }];
  const packed = check(ops, 'photo barrier', [photo]);
  assert.equal(packed.length, 3);
  assert.deepEqual(packed[1], ops[1]);
});

test('large seeded random documents retain every inline boundary, empty line and block kind', () => {
  let seed = 0xb2c0dec;
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const inlines = [{}, { bold: true }, { italic: true }, { author: 'ai' }, { author: 'ai', bold: true },
    { link: 'https://example.org/a?b=1&c=2' }, { italic: true, link: 'https://example.org/나' }];
  const blocks = [{}, { list: 'bullet' }, { list: 'ordered' }, { header: 1 }, { header: 2 }, { blockquote: true }];
  for (let document = 0; document < 16; document++) {
    const ops = Array.from({ length: 3500 }, () => ({
      insert: ['가\n', '\n나\n', '문장\n\n', 'a&*\n'][random(4)],
      attributes: { ...inlines[random(inlines.length)], ...blocks[random(blocks.length)] }
    }));
    check(ops, 'seed b2c0dec document ' + document);
  }
});

test('packing cannot bypass genuine operation or text limits', () => {
  const legacy = P.create(() => 'over-capacity');
  legacy.ops = Array.from({ length: 5001 }, (_, i) => ({ insert: '가', attributes: i % 2 ? { italic: true } : { bold: true } }));
  legacy.ops.push({ insert: '\n' });
  assert.throws(() => P.validate(legacy));
  assert.throws(() => M.fromV2(legacy), { code: 'post_markdown_conversion_limit' });
  const markdown = M.fromDelta(legacy.ops).markdown;
  assert(M.toDelta(markdown).length > P.LIMITS.ops);
  const { ops, ...envelope } = legacy;
  assert.throws(() => P.validate({ ...envelope, format: M.FORMAT, markdown }), /본문 길이/);
  legacy.ops = [{ insert: ('가'.repeat(9) + '\n').repeat(5001), attributes: { author: 'ai', bold: true } }];
  assert.throws(() => P.validate(legacy));
  assert.throws(() => M.fromV2(legacy), { code: 'post_markdown_conversion_limit' });
});

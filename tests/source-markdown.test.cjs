'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/life/source-markdown');

test('block maps preserve raw BOM, CRLF/CR, emoji, repeated paragraphs and skipped duplicate definitions', () => {
  const raw = '\uFEFF# 제목\r\n\r\n반복 **강조** 😀\r\n\r\n[x]: https://example.org/a\r\n[x]: https://example.org/b\r\n\r\n반복 **강조** 😀\r\r```js\rx < 1\r```\r';
  const before = raw, plan = M.prepare(raw);
  assert.equal(plan.formatted, true); assert.equal(raw, before);
  assert.match(plan.html, /^<h1[^>]*>제목<\/h1>/);
  assert.equal(plan.blocks.length, 4);
  const slices = plan.blocks.map(b => raw.slice(b.start, b.end));
  assert.equal(slices[0], '\uFEFF# 제목\r\n');
  assert.equal(slices[1], '반복 **강조** 😀\r\n');
  assert.equal(slices[2], '반복 **강조** 😀\r');
  assert.equal(slices[3], '```js\rx < 1\r```\r');
  assert(plan.blocks[2].start > plan.blocks[1].end, 'reference definitions never shift later anchors to an earlier repeated paragraph');
});

test('render plan keeps raw HTML literal and never emits images, media, internal or dangerous URL anchors', () => {
  const raw = '<img src="https://example.org/tracker" onerror="alert(1)">\n\n![alt](https://example.org/image.png) ![local](../private.png)\n\n[relative](file.md) [fragment](#title) [bad](javascript:alert(1)) [safe](https://example.org/a?q=1&b=2)\n\n```html\n<script>alert(2)</script>\n```';
  const plan = M.prepare(raw); assert(plan.formatted);
  assert(!/<(?:img|script|iframe|video|audio|svg|input)\b/.test(plan.html));
  assert.match(plan.html, /&lt;img/); assert.match(plan.html, /&lt;script&gt;/);
  assert.match(plan.html, /\[이미지: alt\]/); assert.match(plan.html, /\[이미지: local\]/);
  assert.equal((plan.html.match(/<a /g) || []).length, 1);
  assert.match(plan.html, /href="https:\/\/example.org\/a\?q=1&amp;b=2" target="_blank" rel="noopener noreferrer"/);
  for (const value of ['#title', '/path', '../x', 'file:///x', 'data:text/html,x', 'javascript:alert(1)', 'https://user:secret@example.org', 'https://example.org/\n']) assert.equal(M.safeLink(value), false, value);
});

test('headings, code, table and nested lists receive ordered bounded top-level source anchors', () => {
  const raw = '# H\n\n> quote\n>\n> * item\n\n| a | b |\n|---|---|\n| c | d |\n\n    code\n\n---\n';
  const plan = M.prepare(raw); assert(plan.formatted);
  assert.equal(plan.blocks.length, 5);
  assert.match(plan.html, /<table data-source-block="2">/);
  assert.match(plan.html, /<pre data-source-block="3">/);
  for (let i = 0; i < plan.blocks.length; i++) {
    const b = plan.blocks[i]; assert(b.start >= 0 && b.end <= raw.length && b.end > b.start);
    if (i) assert(b.start >= plan.blocks[i - 1].end);
  }
});

test('UTF-8 byte, token and nesting budgets fail to raw rather than silently clipping source', () => {
  assert.equal(M.prepare('가'.repeat(Math.floor(M.LIMITS.bytes / 3) + 1)).reason, 'too_large');
  assert.equal(M.prepare('> '.repeat(100) + 'end').reason, 'too_deep');
  assert.equal(M.prepare('a\n\n'.repeat(13000)).reason, 'too_many_tokens');
  assert.equal(M.prepare('').formatted, true);
});

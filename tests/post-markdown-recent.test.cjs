'use strict';
// PostMarkdown.parse keeps the decoded body of the last few exact strings in a browser page only
// (2026-11-24): every caller gets a copy of its own, refusals are never kept, the strict checks
// still run on every new string, and a server isolate (no document) keeps nothing.
// This file runs in its own process: a page-like `document` is set before the codec loads.
const test = require('node:test'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
globalThis.document = {};
const P = require('../assets/life/post-markdown.js');

const body = '첫 문단 **굵게**\n\n<span data-author="ai">AI 문장</span> 끝\n';
test('a repeated exact string gives an equal result that is a copy of its own', () => {
  const a = P.parse(body), b = P.parse(body);
  assert.deepEqual(a, b);
  assert.notEqual(a, b); assert.notEqual(a.ops, b.ops);
  a.ops[0].insert = '바뀐 글'; a.ops.push({ insert: 'x\n' });
  assert.deepEqual(P.parse(body), b, 'a caller changing its copy changes nothing kept');
  assert.equal(P.toDelta(body)[0].insert, b.ops[0].insert);
  assert.equal(P.canonicalize(body), body);
});

test('a refused string is refused every time and a non-canonical one keeps its own canonical form', () => {
  for (let i = 0; i < 2; i++) assert.throws(() => P.parse('- a\n  - b\n'), /중첩/);
  const loose = '첫 문단 __굵게__\n';
  assert.notEqual(P.parse(loose).markdown, loose);
  assert.equal(P.parse(loose).markdown, P.parse(P.parse(loose).markdown).markdown);
});

test('only the last few strings are kept and other strings are decoded on their own', () => {
  const many = Array.from({ length: 8 }, (_, i) => '문단 ' + i + '\n');
  for (const text of many) assert.equal(P.toDelta(text)[0].insert, '문단 ' + many.indexOf(text) + '\n');
  for (const text of many) assert.equal(P.canonicalize(text), text);
});

test('without a document (a server isolate) nothing is kept', () => {
  const script = "const P = require(" + JSON.stringify(require.resolve('../assets/life/post-markdown.js')) + ");" +
    "const m = require(" + JSON.stringify(require.resolve('../vendor/markdown-it/markdown-it.umd.min.js')) + ");" +
    "let n = 0; const parse = m.prototype.parse; m.prototype.parse = function (...a) { n++; return parse.apply(this, a); };" +
    "P.parse('가\\n'); P.parse('가\\n'); process.stdout.write(String(n));";
  const run = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, '2');
});

test('in a page the same string is decoded once', () => {
  const m = require('../vendor/markdown-it/markdown-it.umd.min.js');
  let n = 0; const parse = m.prototype.parse;
  m.prototype.parse = function (...a) { n++; return parse.apply(this, a); };
  try {
    const text = '한 번만 읽는 글 ' + Date.now() + '\n';
    P.parse(text); P.toDelta(text); P.canonicalize(text);
    assert.equal(n, 1);
  } finally { m.prototype.parse = parse; }
});

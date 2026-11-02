'use strict';
// Playwright's page.waitForFunction resolves as soon as its predicate returns a truthy value,
// and a Promise object is truthy: `async () => false` or `() => x.then(v => false)` returns at
// once without waiting (checked on Playwright 1.63.0: Promise.resolve(false) resolved in ~12ms).
// Conditions that read async storage must use tests/helpers/await-condition.cjs instead.
//
// Limits of this guard (a text scan, deliberately without a parser dependency):
// - It reads only the literal first argument. A predicate passed by reference
//   (`const c = async () => …; waitForFunction(c)`) or an arrow that returns a Promise
//   without these words (`() => s.getActive()`) is not caught; review those by hand.
// - The argument splitter knows strings and line comments only. A quote inside a block
//   comment or a regex literal can cut the argument at the wrong place, and the words
//   async/await/.then( inside a string literal are reported as a violation.
// - PENDING entries are file:line. Each one hides any new violation written on that same
//   line, so remove an entry as soon as its fix reaches main.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname);
// Fixed on a separate worker branch (worktree-agent-a4ab360da380bab84). Remove this entry once that
// fix is on main; a listed site that no longer violates is reported below, not failed, so merge order
// between the two changes does not matter.
const PENDING = new Set(['writing-sync-browser.cjs:42']);

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(path.join(dir, entry.name))
    : entry.name.endsWith('.cjs') ? [path.join(dir, entry.name)] : []);
}

// Returns the first call argument starting at index `start` (just after the opening parenthesis).
function firstArgument(source, start) {
  let depth = 0, quote = null;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return source.slice(start, i); depth--; }
    else if (c === ',' && depth === 0) return source.slice(start, i);
  }
  return source.slice(start);
}

const ASYNC = /\basync\b|\.then\(|\bawait\b/;

function scan(source) {
  const hits = [];
  const marker = 'waitForFunction(';
  for (let at = source.indexOf(marker); at !== -1; at = source.indexOf(marker, at + marker.length)) {
    const predicate = firstArgument(source, at + marker.length);
    if (ASYNC.test(predicate)) hits.push({ line: source.slice(0, at).split('\n').length, predicate: predicate.replace(/\s+/g, ' ').trim().slice(0, 120) });
  }
  return hits;
}

test('scanner flags async, then and await predicates and accepts synchronous ones', () => {
  assert.equal(scan("page.waitForFunction(async () => false)").length, 1);
  assert.equal(scan("page.waitForFunction(id => s.getActive().then(v => v === id), x)").length, 1);
  assert.equal(scan("page.waitForFunction(async q => (await s.read()).ok, q)").length, 1);
  assert.equal(scan("page.waitForFunction(() => document.body.dataset.ready === 'true')").length, 0);
  assert.equal(scan("page.waitForFunction(() => globalThis.HaedoLife?.Shell?.ready)").length, 0, 'existence of the ready Promise is a synchronous check');
  assert.equal(scan("page.waitForFunction(() => x === ')' , 'async')").length, 0, 'strings and later arguments are not the predicate');
});

test('no browser test waits on a Promise-returning waitForFunction predicate', () => {
  const found = [], pendingSeen = new Set();
  for (const file of files(ROOT)) {
    if (file === __filename) continue;
    for (const hit of scan(fs.readFileSync(file, 'utf8'))) {
      const key = path.relative(ROOT, file) + ':' + hit.line;
      if (PENDING.has(key)) { pendingSeen.add(key); continue; }
      found.push(key + '  ' + hit.predicate);
    }
  }
  for (const key of PENDING) if (!pendingSeen.has(key)) console.log('# pending entry already fixed, remove it: ' + key);
  assert.deepEqual(found, [], 'use awaitCondition from tests/helpers/await-condition.cjs for async conditions');
});

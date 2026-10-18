'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../assets/life/source-classification.js');
const commit = 'a'.repeat(40), otherCommit = 'b'.repeat(40);
const text = '\ufeff# 합성 원문 🌱\r\n첫 줄\r\n두 번째 줄\r\n';
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
function row(path = 'notes/합성 원문.md', body = text) {
  return { path, sha256: digest(body), isContent: true,
    source: { id: 'blog', label: '블로그' }, kind: { id: 'essay', label: '에세이' },
    topics: [{ id: 'reading', label: '독서', score: 10 }], primaryTopic: 'reading', reviewReasons: [] };
}
function full(records = [row()]) {
  return { schemaVersion: 1, sourceCommit: commit, taxonomy: [{ id: 'reading', label: '독서' }], records };
}
function source(id, path = row().path, ref = commit, repository = 'synthetic/vault') {
  return { id, origin: 'obsidian', sourceKey: path, title: '같은 합성 제목',
    url: 'https://github.com/' + repository + '/blob/' + ref + '/' + path.split('/').map(encodeURIComponent).join('/') };
}
function version(id, sourceId, body = text) { return { id, sourceId, contentText: body, contentHash: '0'.repeat(64) }; }
const invalid = task => assert.throws(task, { code: 'source_classification_invalid' });

test('full classification is reduced to bounded metadata without title, preview, body or authorship', () => {
  const raw = full();
  Object.assign(raw, { preview: 'synthetic-private-text', authorshipConfirmed: true });
  Object.assign(raw.records[0], { title: 'synthetic-private-text', preview: 'synthetic-private-text',
    contentText: 'synthetic-private-text', authorship: { confirmed: true } });
  raw.records[0].source.title = 'synthetic-private-text';
  const result = C.parse(JSON.stringify(raw));
  assert.deepEqual(Object.keys(result), ['format', 'sourceCommit', 'taxonomy', 'records']);
  assert.equal(result.format, C.FORMAT);
  assert.deepEqual(Object.keys(result.records[0]), ['path', 'sha256', 'isContent', 'source', 'kind', 'topicIds', 'primaryTopic', 'reviewReasons']);
  assert.deepEqual(result.records[0].topicIds, ['reading']);
  assert.equal(JSON.stringify(result).includes('synthetic-private-text'), false);
  assert.equal(raw.records[0].source.title, 'synthetic-private-text');
});

test('validate returns a clean independent manifest and accepts plain null-prototype JSON objects', () => {
  const manifest = C.parse(full()); manifest.records[0].preview = 'drop this';
  const result = C.validate(manifest); result.records[0].source.label = '다른 표시';
  assert.equal(manifest.records[0].source.label, '블로그');
  assert.equal(Object.hasOwn(result.records[0], 'preview'), false);
  assert.equal(C.parse(Object.assign(Object.create(null), full())).records.length, 1);
  invalid(() => C.validate(full()));
  invalid(() => C.parse({ ...full(), sourceCommit: 'main' }));
});

test('paths reject traversal, absolute names, controls and malformed Unicode without rewriting spelling', () => {
  for (const path of ['../a.md', '/a.md', 'C:/a.md', 'C:\\a.md', 'a/./b.md', 'a//b.md', 'a/../b.md',
    'a\\b.md', 'a/\u0000.md', 'a/\u0085.md', 'a/\ud800.md']) invalid(() => C.parse(full([row(path)])));
  for (const path of ['notes/가나다 e\u0301.md', 'notes/100% 준비 #1?.md'])
    assert.equal(C.parse(full([row(path)])).records[0].path, path);
  invalid(() => C.parse(full([row(), row()])));
});

test('topic references, descriptors and review labels are validated, including discarded nested labels', () => {
  const changed = change => { const value = full(); change(value); invalid(() => C.parse(value)); };
  changed(v => v.taxonomy.push(v.taxonomy[0]));
  changed(v => v.records[0].topics[0].id = 'missing');
  changed(v => v.records[0].primaryTopic = 'missing');
  changed(v => v.records[0].topics.push(v.records[0].topics[0]));
  changed(v => v.records[0].source.label = 'x'.repeat(161));
  changed(v => v.records[0].kind.label = {});
  changed(v => v.records[0].topics[0].label = 'x'.repeat(161));
  changed(v => v.records[0].reviewReasons = ['bad\nlabel']);
  changed(v => v.records[0].sha256 = 'short');
  changed(v => v.records[0].isContent = 'true');
  const unclassified = row(); unclassified.topics = []; unclassified.primaryTopic = 'unclassified';
  assert.deepEqual(C.parse(full([unclassified])).records[0].topicIds, []);
  unclassified.isContent = false; unclassified.primaryTopic = 'not_applicable';
  assert.equal(C.parse(full([unclassified])).records[0].isContent, false);
});

test('unknown prototypes, accessors, cycles and non-JSON values cannot execute or enter storage', () => {
  let called = 0;
  const accessor = full(); Object.defineProperty(accessor, 'ignored', { enumerable: true, get() { called++; return 1; } });
  invalid(() => C.parse(accessor)); assert.equal(called, 0);
  const cycle = full(); cycle.ignored = cycle; invalid(() => C.parse(cycle));
  const custom = full(); Object.setPrototypeOf(custom.records[0].source, { attack: true }); invalid(() => C.parse(custom));
  for (const extra of [new Date(), new Map(), undefined, NaN, Infinity, () => 1, 1n, Symbol('x')]) {
    const value = full(); value.extra = extra; invalid(() => C.parse(value));
  }
  invalid(() => C.parse('{"__proto__":{"polluted":true},"schemaVersion":1}'));
  assert.equal({}.polluted, undefined);
  const sparse = full(); sparse.extra = Array(2); invalid(() => C.parse(sparse));
});

test('bounds support the full 6,899-record scale while enforcing 10,000 records and 32MiB UTF-8', () => {
  const records = Array.from({ length: 6899 }, (_, i) => row('notes/' + i + '.md'));
  assert.equal(C.parse(full(records)).records.length, 6899);
  assert.throws(() => C.parse(full(Array.from({ length: 10001 }, (_, i) => row('notes/' + i + '.md')))),
    { code: 'source_classification_too_large' });
  assert.throws(() => C.parse(' '.repeat(C.MAX_BYTES + 1)), { code: 'source_classification_too_large' });
  assert.throws(() => C.parse(JSON.stringify({ ...full(), extra: '가'.repeat(Math.ceil(C.MAX_BYTES / 3)) })),
    { code: 'source_classification_too_large' });
});

test('projection binds actual BOM/CRLF/emoji bytes to each exact version and ignores cached contentHash', async () => {
  const manifest = C.parse(full()), originalManifest = clone(manifest);
  const bundle = { sources: [source('s')], sourceVersions: [version('original', 's'),
    version('changed-lines', 's', text.replace(/\r\n/g, '\n')), version('changed-bom', 's', text.slice(1))] };
  const originalBundle = clone(bundle), result = await C.project(bundle, manifest);
  assert.deepEqual([...result.byVersion.keys()], ['original']);
  assert.equal(result.byVersion.get('original').primaryTopic, 'reading');
  assert.deepEqual(new Set(result.staleVersionIds), new Set(['changed-lines', 'changed-bom']));
  assert.deepEqual([result.matched, result.unmatched, result.stale, result.ambiguous], [1, 0, 0, 0]);
  assert.deepEqual(bundle, originalBundle); assert.deepEqual(manifest, originalManifest);
});

test('same title, wrong origin, another path or another commit never supplies identity', async () => {
  const sources = [source('wrong-path', 'notes/other.md'), source('wrong-commit', row().path, otherCommit),
    { ...source('wrong-origin'), origin: 'other' }, { ...source('no-url'), url: undefined },
    { ...source('no-key'), sourceKey: undefined }];
  const result = await C.project({ sources, sourceVersions: sources.map(s => version('v-' + s.id, s.id)) }, C.parse(full()));
  assert.equal(result.byVersion.size, 0); assert.equal(result.unmatched, 1);
  assert.equal(result.staleVersionIds.size, 0);
});

test('source URL cannot smuggle query, fragments, credentials, encoded slashes or traversal', async () => {
  const valid = source('s'), prefix = 'https://github.com/synthetic/vault/blob/' + commit + '/';
  const urls = [valid.url + '?code=secret', valid.url + '#L1', valid.url.replace('github.com', 'github.com.attacker.invalid'),
    valid.url.replace('https://', 'https://name@'), valid.url.replace('/notes/', '/notes%2F'),
    prefix + 'notes/%2e%2e/notes/' + encodeURIComponent('합성 원문.md')];
  for (const url of urls) {
    const result = await C.project({ sources: [{ ...valid, url }], sourceVersions: [version('v', 's')] }, C.parse(full()));
    assert.equal(result.byVersion.size, 0); assert.equal(result.unmatched, 1);
  }
  // A literal reserved filename must use the encoded URL path, not an empty query/fragment suffix.
  const path = 'notes/literal?.md', manifest = C.parse(full([row(path)])), s = source('s', path);
  assert.equal((await C.project({ sources: [s], sourceVersions: [version('v', 's')] }, manifest)).matched, 1);
  assert.equal((await C.project({ sources: [{ ...s, url: prefix + path }], sourceVersions: [version('v', 's')] }, manifest)).matched, 0);
});

test('different repositories with the same commit/path are ambiguous; copies in one repository remain exact', async () => {
  const manifest = C.parse(full());
  const ambiguous = await C.project({ sources: [source('one'), source('two', row().path, commit, 'another/vault')],
    sourceVersions: [version('v1', 'one'), version('v2', 'two')] }, manifest);
  assert.equal(ambiguous.ambiguous, 1); assert.equal(ambiguous.byVersion.size, 0);
  const copies = await C.project({ sources: [source('one'), source('two')],
    sourceVersions: [version('v1', 'one'), version('v2', 'two')] }, manifest);
  assert.equal(copies.matched, 1); assert.equal(copies.byVersion.size, 2);
});

test('unavailable null text cannot establish an empty original, while an explicitly present empty string can', async () => {
  const path = 'notes/empty.md', manifest = C.parse(full([row(path, '')])), s = source('s', path);
  const link = { ...version('link', 's', null), contentHash: null, coverage: { status: 'link_only', omissions: ['빈 원본 파일 · 본문 바이트 0개'] } };
  const missing = await C.project({ sources: [s], sourceVersions: [link] }, manifest);
  assert.equal(missing.byVersion.size, 0); assert.equal(missing.stale, 1); assert.equal(missing.staleVersionIds.has('link'), true);
  const present = await C.project({ sources: [s], sourceVersions: [version('empty', 's', '')] }, manifest);
  assert.equal(present.matched, 1); assert.equal(present.byVersion.size, 1);
});

test('counts partition all manifest records without source mutation or order-based version substitution', async () => {
  const manifest = C.parse(full([row('notes/matched.md'), row('notes/absent.md'), row('notes/stale.md'), row('notes/ambiguous.md')]));
  const bundle = { sources: [source('m', 'notes/matched.md'), source('s', 'notes/stale.md'), source('a', 'notes/ambiguous.md'),
    source('b', 'notes/ambiguous.md', commit, 'another/vault')], sourceVersions: [version('new', 's', 'changed'),
    version('exact', 'm'), version('a-v', 'a'), version('b-v', 'b')] };
  const result = await C.project(bundle, manifest);
  assert.deepEqual([result.matched, result.unmatched, result.stale, result.ambiguous], [1, 1, 1, 1]);
  assert.deepEqual([...result.byVersion.keys()], ['exact']);
  assert.equal(result.staleVersionIds.has('new'), true);
  await assert.rejects(C.project({ sources: [source('s'), source('s')], sourceVersions: [] }, manifest), { code: 'source_classification_invalid' });
});

test('the standalone browser UMD exposes the same pure API without requiring DOM or network', () => {
  const context = vm.createContext({ TextEncoder, URL, crypto: require('node:crypto').webcrypto });
  vm.runInContext(fs.readFileSync(require.resolve('../assets/life/source-classification.js'), 'utf8'), context);
  assert.equal(typeof context.HaedoLife.SourceClassification.project, 'function');
  assert.equal(context.HaedoLife.SourceClassification.MAX_RECORDS, 10000);
  assert.equal(vm.runInContext(`HaedoLife.SourceClassification.parse(${JSON.stringify(JSON.stringify(full()))}).records.length`, context), 1);
});

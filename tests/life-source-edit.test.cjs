'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const C = require('../assets/life/core.js');
const E = require('../assets/life/source-edit.js');
const W = require('../assets/life/writing.js');
const clone = value => structuredClone(value);
const raw = '\uFEFF# 제목\r\n\r\n반복 😀 **문장**\r\n반복 😀 **문장**\n';
async function fixture(input = {}) {
  const empty = C.createWorkspace(), prepared = await C.prepareImport({ origin: 'obsidian', title: '원문 제목', text: raw,
    format: 'text/markdown', author: '원 작성자', authorRelation: 'other', originalCreatedAt: '오래전 봄',
    coverage: { status: 'partial', omissions: ['사진 미포함'] }, ...input }, empty);
  const bundle = C.applyChanges(empty, C.buildImportChanges(empty, prepared, prepared.version.contentText === null ? [] : [{ start: raw.indexOf('반복'), end: raw.indexOf('반복') + 5, topic: '처음 문장', note: '이전 판 메모' }]));
  return { bundle, source: prepared.source, version: prepared.version };
}
async function edited(f, patch = { text: raw + '\n내 사본 편집' }, options) {
  const stage = E.edit(E.begin(f.bundle, f.source.id, options), patch), prepared = await E.prepare(f.bundle, stage);
  return { stage, prepared, bundle: C.applyChanges(f.bundle, prepared.changes), source: prepared.source, version: prepared.version };
}
test('standalone source-copy editor exposes the same browser/CommonJS contract without Writing or a network', () => {
  const context = vm.createContext({ crypto: webcrypto, TextEncoder, URL, Date, structuredClone });
  for (const name of ['core', 'source-edit']) vm.runInContext(fs.readFileSync(require.resolve('../assets/life/' + name + '.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.HaedoLife.SourceEdit), Object.keys(E));
});
test('begin owns exact raw text and immutable author metadata while retaining a strict separate local stage', async () => {
  const f = await fixture(), before = clone(f.bundle), stage = E.begin(f.bundle, f.source.id);
  assert.equal(stage.input.text, raw); assert.equal(stage.baseHash, createHash('sha256').update(raw).digest('hex'));
  assert.equal(stage.baseSourceVersionId, f.version.id); assert.equal(stage.lifecycleRevision, 0); assert.equal(E.validate(stage), true);
  stage.input.text += '未저장'; assert.deepEqual(f.bundle, before);
  for (const patch of [{ kind: 'writing' }, { format: 'life-writing-draft-v1' }, { baseChanged: false }, { input: { title: '', text: raw, format: 'text/html' } }, { input: { title: '', text: raw, format: 'text/markdown', authorRelation: 'self' } }, { input: { title: '', text: '\ud800', format: 'text/plain' } }]) {
    assert.throws(() => E.validate({ ...E.begin(f.bundle, f.source.id), ...patch }));
  }
});
test('editing app-authored sources stays on the existing own-writing contract', async () => {
  let bundle = C.createWorkspace(); const draft = W.createDraft(bundle); draft.text = '앱에서 쓴 내 글';
  const saved = await W.prepareSave(bundle, draft); bundle = C.applyChanges(bundle, saved.changes);
  assert.equal(W.isOwnSource(saved.source, bundle), true);
  assert.throws(() => E.begin(bundle, saved.source.id), { code: 'not_imported_source' });
  const f = await fixture({ authorRelation: 'self' }); assert.doesNotThrow(() => E.begin(f.bundle, f.source.id));
});
test('an untouched source or whitespace-only title correction creates no version or edit marker', async () => {
  const f = await fixture(); const p = await E.prepare(f.bundle, E.edit(E.begin(f.bundle, f.source.id), { title: '  원문 제목  ' }));
  assert.equal(p.unchanged, true); assert.deepEqual(p.changes, { put: {} }); assert.equal(p.stageResult.sourceVersionId, f.version.id);
  const result = C.applyChanges(f.bundle, p.changes); assert.deepEqual(result.sourceVersions, f.bundle.sourceVersions); assert.deepEqual(result.links, f.bundle.links);
});
test('new copy edits preserve original bytes/quotes, never infer authorship/full coverage, and atomically mark the new exact version', async () => {
  const f = await fixture(), result = await edited(f), p = result.prepared;
  assert.equal(p.unchanged, false); assert.equal(p.version.contentText, raw + '\n내 사본 편집'); assert.equal(p.version.coverage.status, 'unknown');
  assert.deepEqual(p.version.originalAuthor, f.version.originalAuthor); assert.equal(p.version.originalCreatedAt, '오래전 봄'); assert.deepEqual(p.version.coverage.omissions, ['사진 미포함']);
  assert.deepEqual(result.bundle.sourceVersions[0], f.version); assert.deepEqual(result.bundle.records, f.bundle.records);
  assert.equal(C.isEditedCopy(result.bundle, f.version.id), false); assert.equal(C.isEditedCopy(result.bundle, p.version.id), true);
  assert.equal(C.editedCopyMarkers(result.bundle, [p.version.id, 'new-incoming-unknown']).length, 1);
  assert.equal(result.bundle.links.find(link => link.kind === 'source_edit_base').entityRefs[0].entityId, f.version.id);
});
test('format/title-only edits retain the raw body and existing scope without overwriting source identity', async () => {
  const f = await fixture({ origin: 'naver_blog', url: 'https://example.org/original?tag=a#part' });
  const result = await edited(f, { title: '고친 자료 제목', format: 'text/plain' });
  assert.equal(result.version.contentText, raw); assert.equal(result.version.contentHash, f.version.contentHash);
  assert.deepEqual(result.version.coverage, f.version.coverage); assert.equal(result.source.url, f.source.url); assert.equal(result.source.origin, 'naver_blog');
  assert.equal(result.bundle.sources[0].title, '고친 자료 제목'); assert.equal(f.bundle.sources[0].title, '원문 제목');
  assert.throws(() => E.edit(result.stage, { url: 'https://elsewhere.org' }));
});
test('a previous version needs explicit restoration and becomes a fresh latest version even when its body matches history', async () => {
  const first = await fixture(), second = await edited(first);
  assert.throws(() => E.begin(second.bundle, first.source.id, { versionId: first.version.id }), { code: 'source_edit_old_version' });
  const restored = await edited(second, {}, { versionId: first.version.id, restore: true });
  assert.equal(restored.bundle.sourceVersions.length, 3); assert.equal(restored.version.contentText, raw);
  assert.notEqual(restored.version.id, first.version.id); assert.equal(restored.bundle.sourceVersions.at(-1).id, restored.version.id);
  assert.equal(restored.bundle.links.find(link => link.kind === 'source_edit_base' && link.entityRefs[1].entityId === restored.version.id).entityRefs[0].entityId, first.version.id);
});
test('head, title, lifecycle roundtrip and changed-account base differences keep stale editing inputs instead of adopting a new head', async () => {
  const f = await fixture(), stage = E.edit(E.begin(f.bundle, f.source.id), { text: '작성 중 입력' });
  const newer = await edited(f); assert.throws(() => E.validateCurrent(newer.bundle, stage), { code: 'source_edit_conflict' });
  let trash = C.applyChanges(f.bundle, C.buildSourceStateChanges(f.bundle, f.source.id, 'trash'));
  assert.throws(() => E.validateCurrent(trash, stage), { code: 'source_trashed' });
  trash = C.applyChanges(trash, C.buildSourceStateChanges(trash, f.source.id, 'active'));
  assert.throws(() => E.validateCurrent(trash, stage), { code: 'source_edit_conflict' });
  assert.throws(() => E.validateCurrent(f.bundle, { ...stage, baseChanged: true }), { code: 'source_edit_conflict' });
  assert.throws(() => E.validateCurrent({ ...f.bundle, workspaceId: C.id() }, stage), { code: 'workspace_mismatch' });
  assert.equal(stage.input.text, '작성 중 입력');
});
test('checkPrepared rejects extra records, different input/source/author/result and missing marker or base edges before the transaction', async () => {
  const f = await fixture(), result = await edited(f), p = result.prepared;
  assert.equal(E.checkPrepared(f.bundle, result.stage, p.changes, p.stageResult), true);
  const mutations = [c => { c.put.records = []; }, c => { c.put.sourceVersions[0].contentText += '변조'; }, c => { c.put.sources[0].url = 'https://bad.example'; },
    c => { c.put.sourceVersions[0].originalAuthor.relation = 'self'; }, c => { c.put.links.pop(); }, c => { c.put.links[0].entityRefs[0].entityId = f.version.id; }];
  for (const mutate of mutations) { const changes = clone(p.changes); mutate(changes); assert.throws(() => E.checkPrepared(f.bundle, result.stage, changes, p.stageResult)); }
  assert.throws(() => E.checkPrepared(f.bundle, result.stage, p.changes, { ...p.stageResult, sourceVersionId: f.version.id }));
});
test('an async prepare owns raw inputs and does not accept a body-less edit as deletion', async () => {
  const f = await fixture(), stage = E.edit(E.begin(f.bundle, f.source.id), { text: raw + '\n요청 순간' });
  const promise = E.prepare(f.bundle, stage); stage.input.text = '나중 입력'; f.bundle.sources[0].title = '나중 제목';
  const p = await promise; assert.equal(p.version.contentText, raw + '\n요청 순간'); assert.equal(p.source.title, '원문 제목');
  const link = await fixture({ origin: 'other', url: 'https://example.org/link', text: null, coverage: 'link_only' });
  const p2 = await E.prepare(link.bundle, E.edit(E.begin(link.bundle, link.source.id), { text: '직접 제공한 본문' }));
  assert.equal(p2.version.coverage.status, 'unknown'); assert.equal(p2.version.originalAuthor.relation, 'other');
  const body = await fixture({ url: 'https://example.org/source' });
  await assert.rejects(E.prepare(body.bundle, E.edit(E.begin(body.bundle, body.source.id), { text: '' })), { code: 'missing_text' });
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../assets/life/core.js'), R = require('../assets/life/source-reference.js'), E = require('../assets/life/blog-evidence.js'), P = require('../assets/life/photo-post.js');
async function fixture() {
  let bundle = C.createWorkspace();
  const body = '\ufeff🌱 첫 줄\r\n정확한 원문 구절\r\n다음 줄';
  const first = await C.prepareImport({ origin: 'obsidian', title: '익명 원문', text: body, fileName: 'notes/익명.md', url: 'https://example.org/original', authorRelation: 'unknown' }, bundle);
  bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, first));
  const second = await C.prepareImport({ origin: 'obsidian', title: '현재 제목', existingSourceId: first.source.id, text: '최신 본문에는 예전 구절이 없다.', authorRelation: 'unknown' }, bundle);
  bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, second));
  const locator = { start: body.indexOf('정확한'), end: body.indexOf('다음') + 2 };
  return { bundle, body, first, second, locator, ref: await R.build({ bundle, sourceId: first.source.id, versionId: first.version.id, locator }) };
}
test('source evidence freezes the exact old version, raw CRLF/UTF-16 quote and hash without mutating its workspace', async () => {
  const { bundle, first, ref, body, locator } = await fixture(), before = structuredClone(bundle);
  assert.equal(ref.sourceVersionId, first.version.id); assert.equal(ref.quote, body.slice(locator.start, locator.end));
  assert(Object.isFrozen(ref)); assert(Object.isFrozen(ref.locator));
  assert.deepEqual(await R.resolve(bundle, ref), { sourceId: first.source.id, sourceVersionId: first.version.id, locator });
  assert.deepEqual(bundle, before); assert(!Object.hasOwn(ref, 'note')); assert(!Object.hasOwn(ref, 'author'));
  const changedTitle = structuredClone(bundle); changedTitle.sources[0].title = '나중 제목'; await R.resolve(changedTitle, ref); assert.equal(ref.title, before.sources[0].title);
});
test('missing versions, changed bytes, cross-workspace targets and split surrogate boundaries fail without latest substitution', async () => {
  const { bundle, first, ref } = await fixture();
  for (const change of [b => b.sourceVersions.splice(b.sourceVersions.findIndex(v => v.id === first.version.id), 1), b => b.sourceVersions[0].contentText += '변조', b => b.workspaceId = C.id()]) {
    const copy = structuredClone(bundle); change(copy); await assert.rejects(R.resolve(copy, ref));
  }
  await assert.rejects(R.build({ bundle, sourceId: first.source.id, versionId: first.version.id, locator: { start: 1, end: 2 } }));
  await assert.rejects(R.build({ bundle, sourceId: first.source.id, versionId: first.version.id, locator: { start: 0, end: 0 } }));
  assert.throws(() => R.validate({ ...ref, hidden: 'private data' }));
});
test('source URL whitelist excludes credentials, executable protocols and parser ambiguity', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,x', 'https://u:p@example.org', 'https://example.org/a\\b', 'https://example.org/\n']) assert.throws(() => R.safeUrl(value));
  for (const value of ['', 'https://example.org/source#heading', 'http://example.org/source']) assert.equal(R.safeUrl(value), value);
});
test('reference remapping requires explicit complete ID maps and preserves the original frozen evidence', async () => {
  const { ref } = await fixture(), before = structuredClone(ref), workspaceId = C.id(), sourceId = C.id(), versionId = C.id();
  const copy = R.remap(ref, { workspaceId, sourceIds: { [ref.sourceId]: sourceId }, versionIds: { [ref.sourceVersionId]: versionId } });
  assert.equal(copy.workspaceId, workspaceId); assert.equal(copy.sourceId, sourceId); assert.equal(copy.sourceVersionId, versionId);
  assert.equal(copy.quote, ref.quote); assert.equal(copy.contentHash, ref.contentHash); assert.deepEqual(ref, before);
  assert.throws(() => R.remap(ref, { workspaceId, sourceIds: {}, versionIds: {} }));
});
test('rich quote projection preserves exact evidence separately from user thought and stays within existing PhotoPost v2 ops', async () => {
  const { ref } = await fixture(), value = E.draft(ref, '직접 쓴 생각\n둘째 문단');
  const doc = P.create(C.id); doc.ops = value.ops; assert(P.validate(doc));
  assert.equal(doc.format, 'life-photo-post-v2'); assert(!Object.hasOwn(doc, 'evidence'));
  assert.equal(value.reference.quote, ref.quote); assert(value.ops.some(op => op.attributes?.blockquote));
  assert.match(P.plainText(doc), /직접 쓴 생각\n둘째 문단/); assert.match(P.plainText(doc), /출처: /);
  const raw = '🌱\r\n구절\r다음';
  for (let index = 0; index <= raw.replace(/\r\n?/g, '\n').length; index++) assert.equal(raw.slice(0, E.rawOffset(raw, index)).replace(/\r\n?/g, '\n').length, index);
  assert.throws(() => E.draft(ref, 'x'.repeat(50000)), /50,000|길이/);
});
test('saved-post evidence captures a selected revision and refuses drafts, archive and changed revisions', async () => {
  const workspaceId = C.id(), post = P.create(C.id); post.title = '저장한 글'; post.ops = [{ insert: '보관한 본문🌱\n' }]; post.status = 'saved'; post.revision = 2;
  const ref = await R.buildPost({ workspaceId, post }); assert(Object.isFrozen(ref));
  assert.equal(ref.quote, P.plainText(post)); assert.equal((await R.resolvePost({ workspaceId, post }, ref)).postRevision, 2);
  await assert.rejects(R.resolvePost({ workspaceId, post: { ...post, revision: 3 } }, ref));
  for (const changed of [{ ...post, status: 'draft' }, { ...post, archived: true }]) await assert.rejects(R.buildPost({ workspaceId, post: changed }));
});

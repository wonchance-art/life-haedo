'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const Core = require('../assets/life/core.js'), Meta = require('../assets/life/library-meta.js');
const Reference = require('../assets/life/source-reference.js'), Folders = require('../assets/life/source-folders.js');
const Nine = require('../assets/life/nine-board.js');
const clone = value => structuredClone(value);
async function fixture() {
  const initial = Core.createWorkspace(), prepared = await Core.prepareImport({ origin: 'obsidian', title: '합성 원문', text: '\ufeff# 원문\r\n🌱 정확한 구절\r\n끝', format: 'text/markdown' }, initial);
  const bundle = Core.applyChanges(initial, Core.buildImportChanges(initial, prepared, []));
  const metadata = Meta.empty(bundle.workspaceId), start = prepared.version.contentText.indexOf('🌱');
  const ref = await Reference.build({ bundle, sourceId: prepared.source.id, versionId: prepared.version.id, locator: { start, end: start + '🌱 정확한 구절'.length } });
  metadata.nineBoard.format = 'life-nine-board-v2';
  const board = Nine.create(Core.id); board.areas[0].items.push(Nine.evidenceSnapshot({ kind: 'source', value: ref })); metadata.nineBoard.boards.push(board);
  metadata.sourceFolders = Folders.createFolder(metadata.sourceFolders, { name: '학습', parentId: null });
  metadata.sourceFolders = Folders.assignSources(metadata.sourceFolders, [prepared.source.id], metadata.sourceFolders.folders[0].id);
  return { bundle, metadata, ref };
}
test('metadata projection validates child domains, independent defaults and a browser namespace without added private fields', () => {
  const one = Meta.empty('workspace'), two = Meta.empty('workspace');
  assert.equal(Meta.validate(one), one); one.sourceFolders.folders.push({ id: 'folder', name: '폴더', parentId: null }); assert.equal(two.sourceFolders.folders.length, 0);
  const context = vm.createContext({ structuredClone, TextEncoder, URL });
  for (const name of ['source-folders', 'collection', 'nine-board', 'library-meta']) vm.runInContext(fs.readFileSync(require.resolve('../assets/life/' + name + '.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.HaedoLife.LibraryMeta), Object.keys(Meta));
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(HaedoLife.LibraryMeta.empty('workspace'))", context)), two);
  assert.equal(Meta.MAX_BYTES, 8 * 1024 * 1024);
});
test('unknown private fields, child workspace changes and non-JSON metadata are rejected before projection', () => {
  for (const mutate of [
    v => { v.drafts = []; }, v => { v.collection.workspaceId = 'other'; }, v => { v.revision = -1; },
    v => { v.sourceFolders.assignments.length = 1; }, v => { v.nineBoard[Symbol('private')] = true; },
    v => { v.collection.extra = undefined; }, v => { v.collection.items.push(v); },
    v => { Object.setPrototypeOf(v.sourceFolders, { unsafe: true }); },
    v => { Object.defineProperty(v, 'collection', { enumerable: true, get() { throw Error('must not execute'); } }); }
  ]) { const value = Meta.empty('workspace'); mutate(value); assert.throws(() => Meta.validate(value)); }
  const tooMany = Meta.empty('workspace'); tooMany.sourceFolders.assignments = Array.from({ length: 20001 }, (_, i) => ({ sourceId: 's' + i, folderId: 'f' }));
  assert.throws(() => Meta.validate(tooMany));
});
test('available exact source references validate raw UTF16 offsets without changing source or metadata snapshots', async () => {
  const value = await fixture(), before = clone(value);
  assert.equal(Meta.validateReferences(value.bundle, value.metadata), value.metadata); assert.deepEqual(value, before);
  for (const mutate of [r => { r.contentHash = '0'.repeat(64); }, r => { r.sourceId = 'other'; },
    r => { r.quote = r.quote.replace('정확', '다른'); }, r => { r.locator.start++; r.locator.end++; }]) {
    const metadata = clone(value.metadata); mutate(metadata.nineBoard.boards[0].areas[0].items[0].reference.value);
    assert.throws(() => Meta.validateReferences(value.bundle, metadata), { code: 'library_meta_reference_mismatch' });
  }
});
test('intentional missing and cross-workspace source references stay exact; post references do not assert available binaries', async () => {
  const value = await fixture(), metadata = clone(value.metadata), ref = metadata.nineBoard.boards[0].areas[0].items[0].reference.value;
  ref.sourceVersionId = 'missing_version'; ref.sourceId = 'missing_source';
  metadata.sourceFolders.assignments[0].sourceId = 'missing_source';
  const before = clone(metadata); assert.equal(Meta.validateReferences(value.bundle, metadata), metadata); assert.deepEqual(metadata, before);
  ref.sourceVersionId = value.ref.sourceVersionId; ref.workspaceId = 'external_workspace';
  assert.equal(Meta.validateReferences(value.bundle, metadata), metadata);
  const post = { format: 'life-post-reference-v1', workspaceId: value.bundle.workspaceId, postId: 'unavailable_saved_post', postRevision: 4,
    locator: { start: 0, end: 2 }, quote: '원문', contentHash: 'a'.repeat(64), title: '정확한 저장 글' };
  metadata.nineBoard.boards[0].areas[0].items.push(Nine.evidenceSnapshot({ kind: 'post', value: post }));
  assert.equal(Meta.validateReferences(value.bundle, metadata), metadata);
});

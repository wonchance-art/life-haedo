'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const Core = require('../assets/life/core.js');
const Workbench = require('../assets/life/workbench.js');
const Folders = require('../assets/life/source-folders.js');
const clone = value => structuredClone(value);
const invalid = run => assert.throws(run, { code: 'source_folders_invalid' });
const state = () => Folders.empty('workspace');
function add(previous, name, parentId = null) {
  const next = Folders.createFolder(previous, { name, parentId });
  return { state: next, id: next.folders.at(-1).id };
}
function tree() {
  const root = add(state(), '학습'), child = add(root.state, '언어', root.id), other = add(child.state, '독서');
  return { state: other.state, root: root.id, child: child.id, other: other.id };
}
async function library() {
  let bundle = Core.createWorkspace({ title: '합성 자료실' });
  const first = await Core.prepareImport({ origin: 'obsidian', title: '합성 원문', fileName: 'original/one.md',
    text: '\ufeff---\r\ntitle: 합성 예제\r\n---\r\n\r\n🌱 인용 문장\r\n끝', format: 'text/markdown' }, bundle);
  const start = first.version.contentText.indexOf('🌱');
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, first, [{ start, end: start + '🌱 인용 문장'.length, topic: '원래 주제', note: '보존할 메모' }]));
  const second = await Core.prepareImport({ origin: 'obsidian', title: '합성 원문 새 판', fileName: 'original/one.md',
    text: '바뀐 새 판\r\n🌱 다른 문장', existingSourceId: first.source.id, forceSeparate: false, format: 'text/markdown' }, bundle);
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, second));
  const workbench = Workbench.empty(bundle.workspaceId);
  workbench.revision = 7;
  workbench.groups.push({ id: 'group', title: '정확판 묶음', versionIds: [first.version.id, 'missing_version'] });
  workbench.discovery = { excludedPairs: [{ seedSourceId: first.source.id, candidateSourceId: 'missing_source' }] };
  const parent = add(Folders.empty(bundle.workspaceId), '학습'), child = add(parent.state, '언어', parent.id);
  const sourceFolders = Folders.assignSources(child.state, [first.source.id], child.id);
  sourceFolders.revision = 11;
  return { bundle, workbench, sourceFolders, first, second };
}

test('browser and CommonJS expose the same local-only model; empty profiles are independent', () => {
  const context = vm.createContext({ TextEncoder, structuredClone, Date, crypto: crypto.webcrypto });
  for (const file of ['core', 'workbench', 'source-folders'])
    vm.runInContext(fs.readFileSync(require.resolve('../assets/life/' + file + '.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.HaedoLife.SourceFolders), Object.keys(Folders));
  const browser = vm.runInContext("HaedoLife.SourceFolders.empty('workspace')", context);
  assert.deepEqual(JSON.parse(JSON.stringify(browser)), state());
  const one = state(), two = state(); one.folders.push({ id: 'folder', name: '폴더', parentId: null });
  assert.equal(two.folders.length, 0); assert.equal(Folders.validate(two), two);
  assert.ok(Object.isFrozen(Folders)); assert.ok(Object.isFrozen(Folders.LIMITS));
});

test('strict state shapes reject malformed IDs, unknown fields, accessors, sparse arrays and non-JSON data', () => {
  const mutators = [
    value => { value.format = 'other'; }, value => { value.workspaceId = '../workspace'; },
    value => { value.revision = -1; }, value => { value.revision = 0.5; }, value => { value.revision = Infinity; },
    value => { value.extra = true; }, value => { value[Symbol('extra')] = true; }, value => { delete value.assignments; },
    value => { value.folders.length = 1; }, value => { value.assignments.extra = true; },
    value => { Object.setPrototypeOf(value, { inherited: true }); },
    value => { Object.defineProperty(value, 'revision', { enumerable: true, get() { throw Error('must not execute'); } }); },
    value => { Object.defineProperty(value.assignments, '0', { enumerable: true, get() { throw Error('must not execute'); } }); }
  ];
  for (const mutate of mutators) { const value = state(); mutate(value); invalid(() => Folders.validate(value)); }
  for (const id of ['all', 'unfiled', 'a/b', '', null]) {
    const value = state(); value.folders.push({ id, name: '폴더', parentId: null }); invalid(() => Folders.validate(value));
  }
});

test('saved names trim, sibling names normalize NFC and case, and Unicode remains exact', () => {
  const first = add(state(), '  Cafe\u0301  ');
  assert.equal(first.state.folders[0].name, 'Cafe\u0301');
  invalid(() => add(first.state, 'CAFÉ'));
  const child = add(first.state, 'CAFÉ', first.id);
  assert.equal(Folders.list(child.state)[1].label, 'Cafe\u0301 / CAFÉ');
  for (const name of ['', '  ', 'a/b', 'a\\b', 'a\n', '\u0000', '\u007f', '\u0085', '\ud800', '\udc00', 'x'.repeat(121)])
    invalid(() => add(state(), name));
  assert.equal(add(state(), '🌱'.repeat(60)).state.folders[0].name.length, 120);
  const unsupported = clone(first.state); unsupported.folders[0].name = ' untrimmed'; invalid(() => Folders.validate(unsupported));
});

test('deterministic preorder preserves sibling order and lists exact ancestor labels', () => {
  const value = tree();
  assert.deepEqual(Folders.list(value.state), [
    { id: value.root, name: '학습', parentId: null, depth: 1, label: '학습' },
    { id: value.child, name: '언어', parentId: value.root, depth: 2, label: '학습 / 언어' },
    { id: value.other, name: '독서', parentId: null, depth: 1, label: '독서' }
  ]);
  const listed = Folders.list(value.state); listed[0].name = '외부 수정'; assert.equal(value.state.folders[0].name, '학습');
  const reordered = clone(value.state); reordered.folders.reverse();
  assert.deepEqual(Folders.list(reordered).map(item => item.id), [value.other, value.root, value.child]);
});

test('reparenting and renaming validate the entire moved subtree without mutating prior state', () => {
  const value = tree(), original = clone(value.state);
  value.state.revision = 9; original.revision = 9;
  const moved = Folders.updateFolder(value.state, value.root, { name: '새 학습', parentId: value.other });
  assert.deepEqual(Folders.list(moved).map(item => item.label), ['독서', '독서 / 새 학습', '독서 / 새 학습 / 언어']);
  assert.equal(moved.revision, 9); assert.deepEqual(value.state, original);
  invalid(() => Folders.updateFolder(value.state, value.root, { name: '학습', parentId: value.child }));
  invalid(() => Folders.updateFolder(value.state, value.root, { name: '학습', parentId: value.root }));
  invalid(() => Folders.updateFolder(value.state, value.root, { name: '학습', parentId: 'missing' }));
  invalid(() => Folders.updateFolder(value.state, value.root, { name: '독서', parentId: null }));
  let deep = state(), parent = null;
  for (let depth = 1; depth <= 5; depth++) { const next = add(deep, '깊이' + depth, parent); deep = next.state; parent = next.id; }
  invalid(() => add(deep, '여섯째', parent));
  const branch = add(deep, '가지'); const leaf = add(branch.state, '잎', branch.id);
  invalid(() => Folders.updateFolder(leaf.state, branch.id, { name: '가지', parentId: deep.folders[3].id }));
  assert.equal(Folders.list(leaf.state).at(-1).depth, 2);
});

test('structural validation rejects dangling parents, cycles, duplicates and duplicate memberships', () => {
  const value = tree();
  const variants = [
    s => { s.folders[0].parentId = 'missing'; }, s => { s.folders[0].parentId = s.folders[1].id; },
    s => { s.folders.push(clone(s.folders[0])); },
    s => { s.assignments.push({ sourceId: 'source', folderId: 'missing' }); },
    s => { s.assignments.push({ sourceId: 'source', folderId: value.root }, { sourceId: 'source', folderId: value.child }); },
    s => { s.folders[0].extra = true; }, s => { s.assignments.push({ sourceId: '../source', folderId: value.root }); }
  ];
  for (const mutate of variants) { const candidate = clone(value.state); mutate(candidate); invalid(() => Folders.validate(candidate)); }
});

test('one-source membership, descendant filtering and explicit unfiling preserve revisions and input snapshots', () => {
  const value = tree(); value.state.revision = 4;
  const input = clone(value.state), sourceIds = ['source', 'other_source'];
  const assigned = Folders.assignSources(value.state, sourceIds, value.child); sourceIds.push('late_source');
  assert.deepEqual(value.state, input); assert.equal(assigned.revision, 4); assert.equal(assigned.assignments.length, 2);
  assert.equal(Folders.folderFor(assigned, 'source'), value.child); assert.equal(Folders.folderFor(assigned, 'absent'), null);
  assert.equal(Folders.matches(assigned, 'source', value.root), true); assert.equal(Folders.matches(assigned, 'source', value.child), true);
  assert.equal(Folders.matches(assigned, 'source', value.other), false); assert.equal(Folders.matches(assigned, 'absent', 'all'), true);
  assert.equal(Folders.matches(assigned, 'absent', 'unfiled'), true); assert.equal(Folders.matches(assigned, 'source', 'unfiled'), false);
  const moved = Folders.assignSources(assigned, ['source'], value.other);
  assert.equal(moved.assignments.filter(item => item.sourceId === 'source').length, 1);
  const unfiled = Folders.assignSources(moved, ['source'], null);
  assert.equal(Folders.folderFor(unfiled, 'source'), null); assert.equal(Folders.folderFor(assigned, 'source'), value.child);
  invalid(() => Folders.matches(assigned, 'absent', 'missing'));
  invalid(() => Folders.assignSources(assigned, ['source'], 'missing'));
  invalid(() => Folders.assignSources(assigned, ['source', 'source'], value.root));
});

test('only leaf deletion is allowed and it removes metadata only, leaving direct sources unfiled', () => {
  const value = tree(); const assigned = Folders.assignSources(value.state, ['source'], value.child), before = clone(assigned);
  assert.throws(() => Folders.removeFolder(assigned, value.root), { code: 'source_folders_not_empty' });
  const removed = Folders.removeFolder(assigned, value.child);
  assert.equal(Folders.folderFor(removed, 'source'), null); assert.equal(removed.folders.length, 2);
  assert.deepEqual(assigned, before); assert.equal(removed.revision, before.revision);
  invalid(() => Folders.removeFolder(assigned, 'missing'));
});

test('compiled filters snapshot descendants and membership once for independent repeated lookups', () => {
  const value = tree(), assigned = Folders.assignSources(value.state, ['source', 'other_source'], value.child);
  const root = Folders.compileMatcher(assigned, value.root), unfiled = Folders.compileMatcher(assigned, 'unfiled');
  const all = Folders.compileMatcher(assigned, 'all'), other = Folders.compileMatcher(assigned, value.other);
  for (const id of ['source', 'other_source', 'absent']) {
    assert.equal(root(id), Folders.matches(assigned, id, value.root));
    assert.equal(unfiled(id), Folders.matches(assigned, id, 'unfiled'));
    assert.equal(all(id), true); assert.equal(other(id), false);
  }
  assigned.folders[1].parentId = null; assigned.assignments[0].folderId = value.other;
  assigned.assignments.push({ sourceId: 'absent', folderId: value.other });
  assert.equal(root('source'), true); assert.equal(root('absent'), false);
  assert.equal(unfiled('source'), false); assert.equal(unfiled('absent'), true); assert.equal(other('source'), false);
  invalid(() => root('../invalid')); invalid(() => all(null));
  invalid(() => Folders.compileMatcher(assigned, 'missing'));
});

test('limits reject excessive folders, bulk, assignments and actual or restored UTF8 bytes without truncation', () => {
  const value = state(); value.folders = Array.from({ length: 200 }, (_, index) => ({ id: 'f' + index, name: '폴더' + index, parentId: null }));
  assert.equal(Folders.validate(value), value);
  assert.throws(() => add(value, '초과'), { code: 'source_folders_too_large' });
  const sourceIds = Array.from({ length: 200 }, (_, index) => 'source' + index);
  assert.equal(Folders.assignSources(value, sourceIds, 'f0').assignments.length, 200);
  assert.throws(() => Folders.assignSources(value, [...sourceIds, 'extra'], 'f0'), { code: 'source_folders_too_large' });
  const max = state(); max.folders = [{ id: 'f', name: '폴더', parentId: null }];
  max.assignments = Array.from({ length: 20000 }, (_, index) => ({ sourceId: 's' + index, folderId: 'f' }));
  assert.equal(Folders.validate(max), max);
  const tooMany = clone(max); tooMany.assignments.push({ sourceId: 'extra', folderId: 'f' });
  assert.throws(() => Folders.validate(tooMany), { code: 'source_folders_too_large' });
  const long = clone(max); for (const item of long.assignments) item.sourceId += 'x'.repeat(110);
  assert.ok(Buffer.byteLength(JSON.stringify(long)) > Folders.MAX_BYTES);
  assert.throws(() => Folders.validate(long), { code: 'source_folders_too_large' });
  const inflated = clone(value); inflated.assignments = clone(max.assignments).map(item => ({ ...item, folderId: 'f0' }));
  for (let index = 0; index < inflated.folders.length; index++) inflated.folders[index].name = '가'.repeat(117) + String(index).padStart(3, '0');
  assert.ok(Buffer.byteLength(JSON.stringify(inflated)) < Folders.MAX_BYTES);
  assert.throws(() => Folders.validate(inflated), { code: 'source_folders_too_large' });
});

test('structural reads preserve unavailable sources; explicit bundle validation rejects foreign references', async () => {
  const value = await library();
  const dangling = Folders.assignSources(value.sourceFolders, ['not_in_bundle'], value.sourceFolders.folders[0].id);
  assert.equal(Folders.validate(dangling), dangling); assert.equal(dangling.assignments.length, 2);
  assert.throws(() => Folders.validateReferences(value.bundle, dangling), { code: 'source_folders_missing_reference' });
  assert.throws(() => Folders.makeBackup(value.bundle, value.workbench, dangling), { code: 'source_folders_missing_reference' });
  const foreign = clone(value.sourceFolders); foreign.workspaceId = 'another_workspace';
  assert.throws(() => Folders.validateReferences(value.bundle, foreign), { code: 'workspace_mismatch' });
  const trashed = Core.applyChanges(value.bundle, Core.buildSourceStateChanges(value.bundle, value.first.source.id, 'trash'));
  assert.equal(Folders.validateReferences(trashed, value.sourceFolders), value.sourceFolders);
  assert.equal(Folders.folderFor(value.sourceFolders, value.first.source.id), value.sourceFolders.folders[1].id);
});

test('new common backup restores fresh source/folder IDs while preserving raw, exact versions, excerpts and existing missing refs', async () => {
  const value = await library(), original = clone(value);
  const backup = Folders.makeBackup(value.bundle, value.workbench, value.sourceFolders);
  assert.equal(backup.format, 'life-material-library-backup-v1'); assert.equal(backup.schemaVersion, 1);
  assert.deepEqual(backup.sourceFolders, value.sourceFolders);
  const restored = await Folders.restoreBackup(JSON.stringify(backup));
  assert.deepEqual(value, original); assert.notEqual(restored.bundle.workspaceId, value.bundle.workspaceId);
  assert.equal(restored.sourceFolders.workspaceId, restored.bundle.workspaceId); assert.equal(restored.sourceFolders.revision, 0);
  assert.equal(restored.workbench.revision, 0);
  const newSource = restored.bundle.sources[0].id, newVersion = restored.bundle.sourceVersions[0].id;
  assert.notEqual(newSource, value.first.source.id); assert.notEqual(newVersion, value.first.version.id);
  assert.notEqual(restored.sourceFolders.folders[0].id, value.sourceFolders.folders[0].id);
  assert.equal(restored.sourceFolders.folders[1].parentId, restored.sourceFolders.folders[0].id);
  assert.deepEqual(restored.sourceFolders.assignments, [{ sourceId: newSource, folderId: restored.sourceFolders.folders[1].id }]);
  assert.equal(restored.bundle.sources[0].sourceKey, 'original/one.md');
  assert.equal(restored.bundle.sourceVersions[0].contentText, value.first.version.contentText);
  assert.equal(restored.bundle.sourceVersions[0].contentHash, value.first.version.contentHash);
  assert.equal(restored.bundle.sourceVersions[1].contentText, value.second.version.contentText);
  assert.equal(restored.bundle.records[0].text, value.bundle.records[0].text);
  assert.deepEqual(restored.bundle.records[0].sourceRefs[0].locator, value.bundle.records[0].sourceRefs[0].locator);
  assert.equal(restored.bundle.records[0].sourceRefs[0].sourceVersionId, newVersion);
  assert.equal(restored.workbench.groups[0].versionIds[0], newVersion);
  const missing = restored.workbench.groups[0].versionIds[1];
  assert.notEqual(missing, 'missing_version'); assert.ok(!restored.bundle.sourceVersions.some(version => version.id === missing));
  assert.notEqual(restored.workbench.discovery.excludedPairs[0].candidateSourceId, 'missing_source');
  assert.ok(!restored.bundle.sources.some(source => source.id === restored.workbench.discovery.excludedPairs[0].candidateSourceId));
  backup.sourceFolders.folders[0].name = '수정'; assert.equal(value.sourceFolders.folders[0].name, '학습');
});

test('legacy Workbench backup restores with an empty independent folder profile', async () => {
  const value = await library(), legacy = Workbench.makeBackup(value.bundle, value.workbench);
  const restored = await Folders.restoreBackup(legacy);
  assert.deepEqual(restored.sourceFolders, Folders.empty(restored.bundle.workspaceId));
  assert.equal(restored.bundle.sourceVersions[0].contentText, value.first.version.contentText);
  assert.notEqual(restored.workbench.groups[0].id, value.workbench.groups[0].id);
});

test('async restoration owns wrapper, folders and original library snapshots before hashing yields', async () => {
  const value = await library(), backup = Folders.makeBackup(value.bundle, value.workbench, value.sourceFolders);
  const pending = Folders.restoreBackup(backup);
  backup.sourceFolders.folders[0].name = '나중 변경'; backup.sourceFolders.assignments.length = 0;
  backup.libraryBackup.sourceBackup.workspace.sourceVersions[0].contentText = '나중 본문';
  backup.libraryBackup.workbench.groups.length = 0;
  const restored = await pending;
  assert.equal(restored.sourceFolders.folders[0].name, '학습'); assert.equal(restored.sourceFolders.assignments.length, 1);
  assert.equal(restored.bundle.sourceVersions[0].contentText, value.first.version.contentText); assert.equal(restored.workbench.groups.length, 1);
});

test('invalid wrappers, unavailable assignments and corrupted original hashes are rejected before installation', async () => {
  const value = await library(), original = Folders.makeBackup(value.bundle, value.workbench, value.sourceFolders);
  const changes = [
    data => { data.schemaVersion = 2; }, data => { data.extra = true; }, data => { data.exportedAt = 'yesterday'; },
    data => { data.sourceFolders.assignments[0].sourceId = 'missing'; },
    data => { data.sourceFolders.folders[0].parentId = data.sourceFolders.folders[1].id; },
    data => { data.sourceFolders.workspaceId = 'foreign'; },
    data => { data.libraryBackup.sourceBackup.workspace.sourceVersions[0].contentText = '변조'; },
    data => { data.libraryBackup.sourceBackup.manifest.sourceVersions = 9000; },
    data => { data[Symbol('extra')] = true; },
    data => { Object.setPrototypeOf(data.sourceFolders, { unsupported: true }); }
  ];
  for (const change of changes) { const candidate = clone(original); change(candidate); await assert.rejects(Folders.restoreBackup(candidate)); }
  let accessed = false; const accessor = clone(original);
  Object.defineProperty(accessor, 'sourceFolders', { enumerable: true, get() { accessed = true; return value.sourceFolders; } });
  await assert.rejects(Folders.restoreBackup(accessor), { code: 'invalid_backup' }); assert.equal(accessed, false);
  await assert.rejects(Folders.restoreBackup('{'), { code: 'invalid_backup' });
  await assert.rejects(Folders.restoreBackup(Core.makeBackup(value.bundle)), { code: 'invalid_backup' });
  assert.equal(value.bundle.sourceVersions[0].contentText, original.libraryBackup.sourceBackup.workspace.sourceVersions[0].contentText);
});

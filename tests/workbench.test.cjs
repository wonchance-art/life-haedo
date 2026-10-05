'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const Core = require('../assets/life/core.js');
const Workbench = require('../assets/life/workbench.js');
const copy = value => structuredClone(value);
const entry = (versionId, extra = {}) => ({ id: Core.id(), title: '선택한 문장', parts: [{ versionId, enabled: true }],
  note: '다음에 다시 읽을 이유\r\n🌱 e\u0301', pinned: false, enabled: true, showBody: true, showNote: true, ...extra });
async function fixture() {
  let bundle = Core.createWorkspace({ title: '익명 구성 원본' });
  const first = await Core.prepareImport({ origin: 'naver_blog', title: '같은 자료의 첫 원문',
    text: '원래 문장\r\n🌱 발췌할 문장\r\n끝', url: 'https://blog.naver.com/example/1?query=a%2Bb#part', coverage: 'partial' }, bundle);
  const start = first.version.contentText.indexOf('🌱');
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, first, [{ start, end: start + '🌱 발췌할 문장'.length, topic: '다시 읽기' }]));
  const next = await Core.prepareImport({ origin: first.source.origin, title: first.source.title,
    text: '같은 자료지만 달라진 새 원문', url: first.source.url, existingSourceId: first.source.id, coverage: 'full_text' }, bundle);
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, next));
  const state = Workbench.empty(bundle.workspaceId), missing = 'missing_version';
  state.revision = 4;
  state.groups.push({ id: 'group_reading', title: '한글 활동', versionIds: [first.version.id, missing] });
  state.page.intro = '첫 문장\r\n🌱 소개';
  state.page.entries.push(entry(first.version.id, { parts: [{ versionId: first.version.id, enabled: true }, { versionId: missing, enabled: false }] }));
  state.reflection = { versionIds: [first.version.id, missing], note: '누락한 원문도 자동 대체하지 않습니다.' };
  return { bundle, state, missing };
}

test('browser and CommonJS models expose independent empty local configurations', () => {
  const context = vm.createContext({ TextEncoder, structuredClone, Date, crypto: crypto.webcrypto });
  vm.runInContext(fs.readFileSync(require.resolve('../assets/life/core.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../assets/life/workbench.js'), 'utf8'), context);
  assert.equal(typeof context.HaedoLife.Workbench.restoreBackup, 'function');
  const one = Workbench.empty('workspace_legacy'), two = Workbench.empty('workspace_legacy');
  assert.equal(Workbench.validate(one), true); one.page.title = '바뀐 제목';
  assert.equal(two.page.title, '내 페이지'); assert.equal(two.revision, 0);
  assert.deepEqual(Object.keys(Workbench).sort(), ['LIMITS', 'empty', 'makeBackup', 'restoreBackup', 'validate'].sort());
});

test('strict validation rejects unknown fields, incorrect types, duplicate IDs and malformed Unicode', async () => {
  const { state } = await fixture();
  const invalid = [
    value => { value.unknown = true; }, value => { delete value.reflection; }, value => { value.revision = 0.5; },
    value => { value.page.entries[0].enabled = 'true'; }, value => { value.page.intro = null; },
    value => { value.page.entries[0].parts[0].versionId = '../path'; },
    value => { value.groups.push(copy(value.groups[0])); }, value => { value.page.entries[0].id = value.groups[0].id; },
    value => { value.groups[0].versionIds.push(value.groups[0].versionIds[0]); },
    value => { value.page.entries[0].parts.push(copy(value.page.entries[0].parts[0])); },
    value => { value.reflection.versionIds.push(value.reflection.versionIds[0]); },
    value => { value.groups[0].title = '   '; }, value => { value.page.title = ''; },
    value => { value.reflection.note = '\ud800'; }, value => { value.page.intro = '\udc00'; },
    value => { value.page.entries[0].note = '메모\0'; }, value => { value.groups.length += 1; },
    value => { value.groups.extra = 'unsupported'; }, value => { value.page.entries[0].extra = undefined; }
  ];
  for (const mutate of invalid) { const value = copy(state); mutate(value); assert.throws(() => Workbench.validate(value)); }
  assert.equal(Workbench.validate(state), true);
});

test('bounded collections, text and aggregate UTF-8 budget reject rather than truncate', () => {
  const state = Workbench.empty('workspace_legacy');
  const tooMany = copy(state); tooMany.groups = Array.from({ length: Workbench.LIMITS.groups + 1 }, (_, index) => ({ id: `g_${index}`, title: '활동', versionIds: [] }));
  assert.throws(() => Workbench.validate(tooMany), { code: 'invalid_workbench' });
  const tooLong = copy(state); tooLong.page.intro = '글'.repeat(Workbench.LIMITS.text + 1);
  assert.throws(() => Workbench.validate(tooLong), { code: 'invalid_workbench' });
  const tooLarge = copy(state); tooLarge.page.entries = Array.from({ length: 120 }, () => entry('fixed_version', { note: '글'.repeat(10000) }));
  assert.throws(() => Workbench.validate(tooLarge), { code: 'workbench_too_large' });
  assert.equal(tooLarge.page.entries[0].note.length, 10000);
});

test('activity deletion cannot alter an independent page entry and missing fixed references remain valid', async () => {
  const { state } = await fixture(), page = copy(state.page);
  state.groups = [];
  assert.deepEqual(state.page, page); assert.equal(Workbench.validate(state), true);
  state.page.entries[0].parts[0].versionId = 'deliberately_absent_version';
  assert.equal(Workbench.validate(state), true);
});

test('combined backup preserves originals and remaps every fixed version and missing gap consistently', async () => {
  const { bundle, state, missing } = await fixture(), before = copy({ bundle, state });
  const backup = Workbench.makeBackup(bundle, state), restored = await Workbench.restoreBackup(JSON.stringify(backup));
  assert.equal(backup.format, 'life-workbench-backup-v1'); assert.equal(backup.sourceBackup.format, 'life-tools-backup-v1');
  assert.deepEqual({ bundle, state }, before); assert.equal(restored.bundle.workspaceId, restored.workbench.workspaceId);
  assert.notEqual(restored.bundle.workspaceId, bundle.workspaceId); assert.equal(restored.workbench.revision, 0);
  const oldVersion = restored.bundle.sourceVersions[0].id, missingCopy = restored.workbench.groups[0].versionIds[1];
  assert.notEqual(oldVersion, bundle.sourceVersions[0].id); assert.notEqual(missingCopy, missing);
  assert.deepEqual(restored.workbench.groups[0].versionIds, [oldVersion, missingCopy]);
  assert.deepEqual(restored.workbench.page.entries[0].parts, [{ versionId: oldVersion, enabled: true }, { versionId: missingCopy, enabled: false }]);
  assert.deepEqual(restored.workbench.reflection.versionIds, [oldVersion, missingCopy]);
  assert.ok(!restored.bundle.sourceVersions.some(version => version.id === missingCopy));
  assert.notEqual(restored.workbench.groups[0].id, state.groups[0].id);
  assert.notEqual(restored.workbench.page.entries[0].id, state.page.entries[0].id);
  assert.equal(restored.workbench.page.entries[0].note, state.page.entries[0].note);
  assert.equal(restored.bundle.sources[0].url, bundle.sources[0].url);
  assert.deepEqual(restored.bundle.sourceVersions.map(version => version.contentText), bundle.sourceVersions.map(version => version.contentText));
  const record = restored.bundle.records[0], ref = record.sourceRefs[0];
  assert.equal(ref.sourceVersionId, oldVersion);
  assert.equal(restored.bundle.sourceVersions[0].contentText.slice(ref.locator.start, ref.locator.end), record.text);
  const second = await Workbench.restoreBackup(backup);
  assert.notEqual(second.workbench.groups[0].versionIds[1], missingCopy);
});

test('backup owns both snapshots before hashing yields and never accepts changed metadata or body silently', async () => {
  const { bundle, state } = await fixture(), backup = Workbench.makeBackup(bundle, state), before = copy(backup);
  const promise = Workbench.restoreBackup(backup);
  backup.workbench.page.entries[0].note = '비동기 중 덮어쓰기';
  backup.sourceBackup.workspace.sourceVersions[0].contentText = '비동기 중 원문 변경';
  const restored = await promise;
  assert.equal(restored.workbench.page.entries[0].note, before.workbench.page.entries[0].note);
  assert.equal(restored.bundle.sourceVersions[0].contentText, before.sourceBackup.workspace.sourceVersions[0].contentText);
  before.sourceBackup.workspace.sourceVersions[1].contentText = before.sourceBackup.workspace.sourceVersions[1].contentText.replace('같', '다');
  await assert.rejects(Workbench.restoreBackup(before), { code: 'hash_mismatch' });
});

test('mismatched and unsupported backups fail without manufacturing a replacement configuration', async () => {
  const { bundle, state } = await fixture();
  assert.throws(() => Workbench.makeBackup(bundle, { ...state, workspaceId: 'other_workspace' }), { code: 'workspace_mismatch' });
  const unknown = Workbench.makeBackup(bundle, state); unknown.sourceBackup.unknown = undefined;
  await assert.rejects(Workbench.restoreBackup(unknown), { code: 'unsupported_field' });
  const wrong = Workbench.makeBackup(bundle, state); wrong.workbench.workspaceId = 'other_workspace';
  await assert.rejects(Workbench.restoreBackup(wrong), { code: 'workspace_mismatch' });
  const format = Workbench.makeBackup(bundle, state); format.format = 'other';
  await assert.rejects(Workbench.restoreBackup(format), { code: 'unsupported_backup' });
  await assert.rejects(Workbench.restoreBackup('{invalid'), { code: 'invalid_backup' });
  await assert.rejects(Workbench.restoreBackup(Core.makeBackup(bundle)));
});

async function discoveryFixture() {
  const { bundle: original, state, missing } = await fixture();
  const prepared = await Core.prepareImport({ origin: 'obsidian', title: '다른 글에서 다시 읽을 문장',
    text: '책방에서 책을 읽으며 남긴 다른 생각입니다.', coverage: 'full_text' }, original);
  const bundle = Core.applyChanges(original, Core.buildImportChanges(original, prepared));
  const seedSourceId = bundle.sources[0].id, candidateSourceId = prepared.source.id;
  state.discovery = { excludedPairs: [{ seedSourceId, candidateSourceId }] };
  return { bundle, state, seedSourceId, candidateSourceId, missing };
}

test('old v1 configurations and backups stay unchanged without an implicit discovery default', async () => {
  const { bundle, state } = await fixture(), before = copy(state);
  assert.equal(Object.hasOwn(state, 'discovery'), false);
  assert.equal(Workbench.validate(Object.freeze(state)), true);
  const backup = Workbench.makeBackup(bundle, state);
  assert.equal(Object.hasOwn(backup.workbench, 'discovery'), false);
  const restored = await Workbench.restoreBackup(backup);
  assert.equal(restored.workbench.format, 'life-workbench-v1');
  assert.equal(Object.hasOwn(restored.workbench, 'discovery'), false);
  assert.deepEqual(state, before);
  const explicit = copy(before); explicit.discovery = { excludedPairs: [] };
  assert.equal(Workbench.validate(explicit), true);
  assert.deepEqual((await Workbench.restoreBackup(Workbench.makeBackup(bundle, explicit))).workbench.discovery, { excludedPairs: [] });
});

test('discovery accepts only strict directional source pairs and never silently sanitizes invalid exclusions', async () => {
  const { state } = await discoveryFixture();
  const first = state.discovery.excludedPairs[0];
  state.discovery.excludedPairs.push({ seedSourceId: first.candidateSourceId, candidateSourceId: first.seedSourceId });
  assert.equal(Workbench.validate(state), true);
  const invalid = [
    value => { value.discovery = null; }, value => { value.discovery = undefined; },
    value => { value.discovery = {}; }, value => { value.discovery.excludedPairs = {}; },
    value => { value.discovery.excludedPairs = null; }, value => { value.discovery.unknown = true; },
    value => { value.discovery.excludedPairs[0].global = true; },
    value => { value.discovery.excludedPairs[0].seedVersionId = 'version'; },
    value => { delete value.discovery.excludedPairs[0].candidateSourceId; },
    value => { value.discovery.excludedPairs[0].seedSourceId = '../source'; },
    value => { value.discovery.excludedPairs[0].seedSourceId = ''; },
    value => { value.discovery.excludedPairs[0].seedSourceId = 'a'.repeat(129); },
    value => { value.discovery.excludedPairs[0].candidateSourceId = null; },
    value => { value.discovery.excludedPairs[0].candidateSourceId = 1; },
    value => { value.discovery.excludedPairs[0].candidateSourceId = 'line\nbreak'; },
    value => { value.discovery.excludedPairs[0].candidateSourceId = value.discovery.excludedPairs[0].seedSourceId; },
    value => { value.discovery.excludedPairs.push(copy(value.discovery.excludedPairs[0])); },
    value => { value.discovery.excludedPairs.length += 1; },
    value => { value.discovery.excludedPairs.extra = true; },
    value => { value.discovery.excludedPairs[0][Symbol('unsupported')] = true; }
  ];
  for (const mutate of invalid) {
    const value = copy(state); mutate(value);
    assert.throws(() => Workbench.validate(value));
  }
  assert.equal(Workbench.validate(state), true);
});

test('discovery exclusions allow exactly 1000 pairs and count toward the existing configuration budget', () => {
  const state = Workbench.empty('workspace_legacy');
  state.discovery = { excludedPairs: Array.from({ length: 1000 }, (_, index) => ({ seedSourceId: 'seed', candidateSourceId: 'candidate_' + index })) };
  assert.equal(Workbench.LIMITS.excludedPairs, 1000);
  assert.equal(Workbench.validate(state), true);
  state.discovery.excludedPairs.push({ seedSourceId: 'seed', candidateSourceId: 'last_candidate' });
  assert.throws(() => Workbench.validate(state), { code: 'invalid_workbench' });
  assert.equal(state.discovery.excludedPairs.length, 1001);
  state.discovery.excludedPairs.pop();
  state.page.entries = Array.from({ length: 120 }, () => entry('fixed_version', { note: '글'.repeat(10000) }));
  assert.throws(() => Workbench.validate(state), { code: 'workbench_too_large' });
});

test('source exclusions survive newer original versions and round-trip independently of fixed excerpt/group/page references', async () => {
  const { bundle: original, state, seedSourceId, candidateSourceId } = await discoveryFixture();
  const before = copy({ bundle: original, state });
  const next = await Core.prepareImport({ origin: 'obsidian', title: '수정한 후보 제목', text: '나중에 고쳐 쓴 다른 본문',
    existingSourceId: candidateSourceId, coverage: 'full_text' }, original);
  const bundle = Core.applyChanges(original, Core.buildImportChanges(original, next));
  assert.deepEqual(state.discovery.excludedPairs, [{ seedSourceId, candidateSourceId }]);
  const restored = await Workbench.restoreBackup(Workbench.makeBackup(bundle, state));
  const pair = restored.workbench.discovery.excludedPairs[0];
  assert.deepEqual(pair, { seedSourceId: restored.bundle.sources[0].id, candidateSourceId: restored.bundle.sources[1].id });
  assert.notEqual(pair.seedSourceId, seedSourceId); assert.notEqual(pair.candidateSourceId, candidateSourceId);
  assert.equal(restored.bundle.sourceVersions.filter(version => version.sourceId === pair.candidateSourceId).length, 2);
  assert.equal(restored.workbench.groups[0].versionIds[0], restored.bundle.sourceVersions[0].id);
  assert.equal(restored.workbench.page.entries[0].parts[0].versionId, restored.bundle.sourceVersions[0].id);
  assert.equal(restored.bundle.records[0].sourceRefs[0].sourceVersionId, restored.bundle.sourceVersions[0].id);
  assert.deepEqual(restored.bundle.sourceVersions.map(version => version.contentText), bundle.sourceVersions.map(version => version.contentText));
  assert.deepEqual({ bundle: original, state }, before);
  const twice = await Workbench.restoreBackup(Workbench.makeBackup(restored.bundle, restored.workbench));
  assert.deepEqual(twice.workbench.discovery.excludedPairs, [{ seedSourceId: twice.bundle.sources[0].id, candidateSourceId: twice.bundle.sources[1].id }]);
});

test('missing discovery sources receive consistent fresh gaps without attaching to source versions or unrelated originals', async () => {
  const { bundle, state, seedSourceId, candidateSourceId, missing } = await discoveryFixture();
  // One absent source ID is also an absent version ID; another is a real
  // version ID. Typed source references must not become references to versions.
  const missingOne = missing, missingTwo = bundle.sourceVersions[0].id;
  state.discovery.excludedPairs = [
    { seedSourceId, candidateSourceId: missingOne },
    { seedSourceId: missingOne, candidateSourceId },
    { seedSourceId: missingOne, candidateSourceId: missingTwo },
    { seedSourceId: missingTwo, candidateSourceId: missingOne }
  ];
  const backup = Workbench.makeBackup(bundle, state), restored = await Workbench.restoreBackup(backup);
  const pairs = restored.workbench.discovery.excludedPairs;
  const firstGap = pairs[0].candidateSourceId, secondGap = pairs[2].candidateSourceId;
  assert.equal(pairs[0].seedSourceId, restored.bundle.sources[0].id);
  assert.equal(pairs[1].candidateSourceId, restored.bundle.sources[1].id);
  assert.equal(pairs[1].seedSourceId, firstGap); assert.equal(pairs[2].seedSourceId, firstGap);
  assert.equal(pairs[3].candidateSourceId, firstGap); assert.equal(pairs[3].seedSourceId, secondGap);
  assert.notEqual(firstGap, secondGap); assert.notEqual(firstGap, missingOne); assert.notEqual(secondGap, missingTwo);
  for (const gap of [firstGap, secondGap]) {
    assert.equal(restored.bundle.sources.some(source => source.id === gap), false);
    assert.equal(restored.bundle.sourceVersions.some(version => version.id === gap), false);
    assert.equal(restored.workbench.groups.some(group => group.id === gap), false);
  }
  assert.notEqual(firstGap, restored.workbench.groups[0].versionIds[1]);
  const second = await Workbench.restoreBackup(backup);
  assert.notEqual(second.workbench.discovery.excludedPairs[0].candidateSourceId, firstGap);
  assert.deepEqual(backup.workbench.discovery, state.discovery);
});

test('backup and async restore own discovery snapshots before caller mutation and preserve original data', async () => {
  const { bundle, state } = await discoveryFixture();
  const backup = Workbench.makeBackup(bundle, state), originalPairs = copy(backup.workbench.discovery.excludedPairs);
  state.discovery.excludedPairs[0].candidateSourceId = 'caller_replaced_source';
  assert.deepEqual(backup.workbench.discovery.excludedPairs, originalPairs);
  const pending = Workbench.restoreBackup(backup);
  backup.workbench.discovery.excludedPairs[0].seedSourceId = 'changed_while_hashing';
  backup.workbench.discovery.excludedPairs.push({ seedSourceId: 'new_seed', candidateSourceId: 'new_candidate' });
  const restored = await pending;
  assert.deepEqual(restored.workbench.discovery.excludedPairs, [{
    seedSourceId: restored.bundle.sources[0].id, candidateSourceId: restored.bundle.sources[1].id
  }]);
  assert.equal(bundle.sources.length, 2); assert.equal(bundle.sourceVersions.length, 3);
  const invalid = Workbench.makeBackup(bundle, state);
  invalid.workbench.discovery.excludedPairs.push(copy(invalid.workbench.discovery.excludedPairs[0]));
  await assert.rejects(Workbench.restoreBackup(invalid), { code: 'duplicate_id' });
});

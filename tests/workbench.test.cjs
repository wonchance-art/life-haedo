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

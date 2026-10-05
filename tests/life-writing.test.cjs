'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../assets/life/core.js');
const Writing = require('../assets/life/writing.js');
const Workbench = require('../assets/life/workbench.js');
const Share = require('../assets/life/share.js');
const { createStorage } = require('../assets/life/storage.js');

const copy = value => structuredClone(value);
const body = '  서울의 작은 책방\r\n🌱 오늘 읽은 문장과 내 생각\r\ne\u0301와 é를 그대로 남긴다.\n';
async function stored(overrides = {}) {
  const initial = Core.createWorkspace();
  const stage = Object.assign(Writing.createDraft(initial), { title: '책방에서 쓴 글', text: body }, overrides);
  const prepared = await Writing.prepareSave(initial, stage);
  return { initial, stage, prepared, bundle: Core.applyChanges(initial, prepared.changes) };
}
async function edit(bundle, sourceId, overrides = {}) {
  const stage = Object.assign(Writing.createDraft(bundle, { sourceId }), overrides);
  const prepared = await Writing.prepareSave(bundle, stage);
  return { stage, prepared, bundle: Core.applyChanges(bundle, prepared.changes) };
}
function composition(bundle, versionId) {
  const state = Workbench.empty(bundle.workspaceId);
  state.groups.push({ id: Core.id(), title: '책방에서', versionIds: [versionId] });
  state.page.entries.push({ id: Core.id(), title: '책과 생각', parts: [{ versionId, enabled: true }],
    note: '', pinned: false, enabled: true, showBody: true, showNote: false });
  state.reflection.versionIds.push(versionId);
  Workbench.validate(state);
  return state;
}

test('Writing exposes the same standalone browser and CommonJS API', () => {
  const context = vm.createContext({ crypto: crypto.webcrypto, TextEncoder, URL, Date, structuredClone });
  for (const name of ['core', 'writing']) vm.runInContext(fs.readFileSync(require.resolve('../assets/life/' + name + '.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.HaedoLife.Writing), Object.keys(Writing));
  assert.equal(vm.runInContext('HaedoLife.Writing.isDraft(HaedoLife.Writing.createDraft(HaedoLife.Core.createWorkspace()))', context), true);
});

test('blank drafts are resumable local staging with a strict separate format', () => {
  const bundle = Core.createWorkspace(), original = copy(bundle);
  const stage = Writing.createDraft(bundle);
  assert.equal(stage.kind, 'writing'); assert.equal(stage.format, 'life-writing-draft-v1');
  assert.equal(stage.title, ''); assert.equal(stage.text, ''); assert.equal(stage.revision, 0);
  assert.equal(stage.sourceId, null); assert.equal(stage.baseSourceVersionId, null); assert.equal(stage.baseSourceRevision, null);
  assert.equal(Writing.validateDraft(stage), true); assert.equal(Writing.isDraft(stage), true);
  assert.equal(Writing.isDraft({ stageId: Core.id(), input: {}, state: 'draft' }), false);
  assert.deepEqual(bundle, original);
});

test('malformed draft fields, mixed import metadata and invalid bases are rejected before persistence', async () => {
  const original = Writing.createDraft(Core.createWorkspace());
  const variants = [
    { input: { origin: 'other', authorRelation: 'self' } }, { format: 'life-writing-draft-v2' }, { kind: 'import' },
    { baseSourceVersionId: 'version' }, { baseSourceRevision: 1 }, { revision: -1 }, { state: 'lost' },
    { createdAt: 'today' }, { updatedAt: null }, { title: '가'.repeat(501) }, { text: 42 },
    { sourceId: 'source', baseSourceVersionId: 'version', baseSourceRevision: null },
    { appliedResult: { sourceId: 'source', sourceVersionId: 'version' } }
  ];
  for (const change of variants) assert.throws(() => Writing.validateDraft({ ...original, ...change }), { code: 'invalid_writing' });
  const missing = copy(original); delete missing.title;
  assert.throws(() => Writing.validateDraft(missing), { code: 'invalid_writing' });
  let opened = 0;
  const storage = createStorage({ core: Core, writing: Writing, channelFactory: null,
    idb: { openDB() { opened += 1; throw new Error('must not open'); } } });
  await assert.rejects(storage.saveStage({ ...original, input: {} }), { code: 'invalid_writing' });
  assert.equal(opened, 0);
});

test('draft and final text preserve Korean, CRLF, Unicode composition and exact UTF-8 hashing', async () => {
  const { stage, prepared, bundle } = await stored();
  assert.equal(stage.text, body); assert.equal(prepared.version.contentText, body);
  assert.equal(prepared.version.contentHash, crypto.createHash('sha256').update(body, 'utf8').digest('hex'));
  assert.equal(prepared.source.origin, 'other'); assert.equal(prepared.source.url, undefined);
  assert.match(prepared.source.sourceKey, /^haedo:writing:[a-f0-9-]+$/);
  assert.equal(prepared.version.format, 'text/plain');
  assert.deepEqual(prepared.version.coverage, { status: 'full_text', omissions: [] });
  assert.deepEqual(prepared.version.originalAuthor, { label: '', relation: 'self' });
  assert.equal(prepared.version.originalCreatedAt, stage.createdAt);
  assert.equal(Writing.isOwnSource(prepared.source, bundle), true);
  assert.equal(Core.validateWorkspace(bundle), true);
});

test('empty draft, invalid Unicode, NUL and UTF-8 overflow fail without truncation', async () => {
  const bundle = Core.createWorkspace(), stage = Writing.createDraft(bundle);
  for (const value of ['', ' \r\n\t ']) await assert.rejects(Writing.prepareSave(bundle, { ...stage, text: value }), { code: 'missing_text' });
  for (const value of ['안녕\0', '\ud800', '\udfff', '🌱\ud800a']) {
    assert.throws(() => Writing.validateDraft({ ...stage, text: value }), { code: 'invalid_encoding' });
  }
  const exact = '한'.repeat(Math.floor(Writing.LIMITS.bytes / 3)) + 'x';
  assert.equal(new TextEncoder().encode(exact).length, Writing.LIMITS.bytes);
  assert.equal(Writing.validateDraft({ ...stage, text: exact }), true);
  assert.throws(() => Writing.validateDraft({ ...stage, text: exact + 'x' }), { code: 'text_too_large' });
  assert.equal(stage.text, '');
});

test('only the app marker and authored version invariants permit editing, never a self import alone', async () => {
  const initial = Core.createWorkspace();
  const imported = await Core.prepareImport({ origin: 'other', title: '외부에서 가져온 내 글', text: body,
    authorRelation: 'self', format: 'text/plain', coverage: 'full_text' }, initial);
  const bundle = Core.applyChanges(initial, Core.buildImportChanges(initial, imported));
  assert.equal(Writing.isOwnSource(imported.source, bundle), false);
  assert.throws(() => Writing.createDraft(bundle, { sourceId: imported.source.id }), { code: 'not_own_writing' });
  await assert.rejects(Core.prepareImport({ origin: 'other', title: '파일', text: body,
    fileName: Writing.SOURCE_KEY_PREFIX + Core.id() }, initial), { code: 'unsupported_format' });
  const own = await stored();
  for (const mutate of [
    value => { value.sources[0].sourceKey += '.txt'; },
    value => { value.sources[0].origin = 'obsidian'; },
    value => { value.sources[0].url = 'https://example.org/original'; },
    value => { value.sourceVersions[0].originalAuthor.relation = 'other'; },
    value => { value.sourceVersions[0].format = 'text/markdown'; },
    value => { value.sourceVersions[0].coverage.status = 'partial'; },
    value => { value.sourceVersions[0].coverage.omissions = ['사진']; }
  ]) {
    const value = copy(own.bundle); mutate(value);
    assert.equal(Core.validateWorkspace(value), true);
    assert.equal(Writing.isOwnSource(value.sources[0], value), false);
    assert.throws(() => Writing.createDraft(value, { sourceId: value.sources[0].id }), { code: 'not_own_writing' });
  }
});

test('edit creates a fresh version and preserves source identity, creation date, old text and exact excerpts', async () => {
  const first = await stored(), sourceId = first.prepared.source.id;
  let bundle = Core.applyChanges(first.bundle, Core.buildImportChanges(first.bundle,
    { source: first.prepared.source, version: first.prepared.version, match: { kind: 'exact_duplicate' } },
    [{ start: 2, end: 11, note: '내 메모' }]));
  const before = copy(bundle), stage = Writing.createDraft(bundle, { sourceId });
  stage.title = '수정한 제목'; stage.text = '앞에 새 문장을 넣었다.\n' + body;
  const prepared = await Writing.prepareSave(bundle, stage);
  bundle = Core.applyChanges(bundle, prepared.changes);
  assert.equal(bundle.sources.length, 1); assert.equal(bundle.sourceVersions.length, 2);
  assert.equal(bundle.sources[0].id, sourceId); assert.equal(bundle.sources[0].sourceKey, before.sources[0].sourceKey);
  assert.equal(bundle.sources[0].createdAt, before.sources[0].createdAt);
  assert.equal(bundle.sources[0].revision, before.sources[0].revision + 1);
  assert.equal(bundle.sources[0].title, '수정한 제목');
  assert.deepEqual(bundle.sourceVersions[0], before.sourceVersions[0]); assert.deepEqual(bundle.records, before.records);
  assert.equal(prepared.version.originalCreatedAt, before.sourceVersions[0].originalCreatedAt);
  assert.notEqual(prepared.version.id, before.sourceVersions[0].id);
  assert.equal(bundle.records[0].sourceRefs[0].sourceVersionId, before.sourceVersions[0].id);
  assert.equal(Writing.latestVersion(bundle, sourceId).id, prepared.version.id);
});

test('a reverted or unchanged body still makes a new immutable head instead of selecting historical import duplicates', async () => {
  const first = await stored(), id = first.prepared.source.id;
  const second = await edit(first.bundle, id, { text: '두 번째 본문' });
  const reverted = await edit(second.bundle, id, { text: body });
  assert.equal(reverted.bundle.sourceVersions.length, 3);
  assert.equal(Writing.latestVersion(reverted.bundle, id).contentText, body);
  assert.notEqual(reverted.prepared.version.id, first.prepared.version.id);
  assert.equal(reverted.prepared.version.contentHash, first.prepared.version.contentHash);
  const again = await edit(reverted.bundle, id);
  assert.equal(again.bundle.sourceVersions.length, 4);
  assert.notEqual(again.prepared.version.id, reverted.prepared.version.id);
});

test('editing rejects both a changed source revision and a changed latest version, keeping draft input intact', async () => {
  const first = await stored(), id = first.prepared.source.id;
  const draft = Writing.createDraft(first.bundle, { sourceId: id }); draft.text = '다른 탭의 입력';
  const before = copy(draft), second = await edit(first.bundle, id, { text: '먼저 보관한 수정' });
  await assert.rejects(Writing.prepareSave(second.bundle, draft), { code: 'writing_conflict' });
  await assert.rejects(Writing.prepareSave(second.bundle, { ...draft, baseSourceRevision: second.prepared.source.revision }), { code: 'writing_conflict' });
  await assert.rejects(Writing.prepareSave(second.bundle, { ...draft, baseSourceVersionId: second.prepared.version.id }), { code: 'writing_conflict' });
  assert.deepEqual(draft, before);
  const other = Core.createWorkspace();
  await assert.rejects(Writing.prepareSave(other, draft), { code: 'workspace_mismatch' });
});

test('unrelated workspace changes do not reject an unchanged edit base; commit still carries current workspace CAS', async () => {
  const first = await stored(), stage = Writing.createDraft(first.bundle, { sourceId: first.prepared.source.id });
  stage.text = '이 글만 수정';
  const unrelated = await Core.prepareImport({ origin: 'obsidian', title: '다른 자료', text: '별개 내용' }, first.bundle);
  const current = Core.applyChanges(first.bundle, Core.buildImportChanges(first.bundle, unrelated));
  const prepared = await Writing.prepareSave(current, stage);
  const next = Core.applyChanges(current, prepared.changes);
  assert.equal(next.sources.length, 2); assert.equal(next.sourceVersions.length, 3);
  assert.equal(next.revision, current.revision + 1);
});

test('preparing a save snapshots mutable inputs before hashing yields', async () => {
  const first = await stored(), original = copy(first.bundle);
  const stage = Writing.createDraft(first.bundle, { sourceId: first.prepared.source.id }); stage.text = '확정할 원래 입력';
  const pending = Writing.prepareSave(first.bundle, stage);
  stage.text = '대기 중 바뀐 입력'; stage.title = '대기 중 바뀐 제목';
  first.bundle.sources[0].sourceKey = 'tampered'; first.bundle.sourceVersions[0].contentText = 'tampered';
  const prepared = await pending;
  assert.equal(prepared.version.contentText, '확정할 원래 입력'); assert.equal(prepared.source.title, original.sources[0].title);
  assert.equal(prepared.source.sourceKey, original.sources[0].sourceKey);
  assert.equal(Core.validateWorkspace(Core.applyChanges(original, prepared.changes)), true);
});

test('draft conflict recovery preserves the edit base until an explicit new-writing choice', async () => {
  const first = await stored(), stage = Writing.createDraft(first.bundle, { sourceId: first.prepared.source.id });
  stage.text = '복구할 입력'; stage.revision = 8;
  const recovered = Writing.recoverDraft(stage);
  assert.notEqual(recovered.stageId, stage.stageId); assert.equal(recovered.revision, 0);
  assert.equal(recovered.sourceId, stage.sourceId); assert.equal(recovered.baseSourceVersionId, stage.baseSourceVersionId);
  assert.equal(recovered.baseSourceRevision, stage.baseSourceRevision); assert.equal(recovered.text, stage.text);
  const separate = Writing.recoverDraft(stage, { asNew: true });
  assert.equal(separate.sourceId, null); assert.equal(separate.baseSourceRevision, null); assert.equal(separate.baseSourceVersionId, null);
  const saved = await Writing.prepareSave(first.bundle, separate);
  assert.notEqual(saved.source.id, stage.sourceId);
  assert.notEqual(saved.source.sourceKey, first.prepared.source.sourceKey);
});

test('applied drafts can be read and exported but cannot be edited or recovered as uncommitted drafts', async () => {
  const first = await stored();
  const applied = { ...first.stage, state: 'applied', revision: 2, appliedResult: first.prepared.stageResult };
  assert.equal(Writing.validateDraft(applied), true); assert.equal(Writing.isDraft(applied), false);
  await assert.rejects(Writing.prepareSave(first.bundle, applied), { code: 'invalid_writing' });
  assert.throws(() => Writing.recoverDraft(applied), { code: 'invalid_writing' });
  assert.equal(Writing.toText(applied), first.stage.title + '\n\n' + body);
  assert.equal(Writing.toText({ ...first.stage, title: '' }), body);
});

test('TXT recovery exports over-limit input intact while malformed encoding is explicitly rejected', () => {
  const stage = Writing.createDraft(Core.createWorkspace());
  stage.text = '한'.repeat(Math.floor(Writing.LIMITS.bytes / 3) + 1);
  assert.throws(() => Writing.validateDraft(stage), { code: 'text_too_large' });
  assert.equal(Writing.toText(stage), stage.text);
  stage.title = '제목'.repeat(300);
  assert.equal(Writing.toText(stage), stage.title + '\n\n' + stage.text);
  assert.throws(() => Writing.toText({ title: '', text: '\ud800' }), { code: 'invalid_encoding' });
  assert.throws(() => Writing.toText({ title: '\u0000', text: body }), { code: 'invalid_encoding' });
});

test('JSON backup remaps internal references while authored markers and editability survive without schema changes', async () => {
  const first = await stored(), second = await edit(first.bundle, first.prepared.source.id, { text: '백업 후 다시 읽을 글' });
  const backup = Core.makeBackup(second.bundle);
  assert.equal(backup.schemaVersion, 1); assert.equal(backup.manifest.stagingIncluded, false);
  const restored = await Core.restoreBackup(backup);
  assert.notEqual(restored.workspaceId, second.bundle.workspaceId);
  assert.notEqual(restored.sources[0].id, second.bundle.sources[0].id);
  assert.equal(restored.sources[0].sourceKey, second.bundle.sources[0].sourceKey);
  assert.equal(Writing.isOwnSource(restored.sources[0], restored), true);
  const draft = Writing.createDraft(restored, { sourceId: restored.sources[0].id });
  assert.equal(draft.text, '백업 후 다시 읽을 글'); assert.equal(draft.baseSourceRevision, 1);
  const changed = await edit(restored, restored.sources[0].id, { text: '복원한 사본에서 수정' });
  assert.equal(changed.bundle.sourceVersions.length, 3);
  assert.equal(second.bundle.sourceVersions.length, 2);
});

test('search, fixed group/page references and explicit publication work with authored text', async () => {
  const first = await stored(), state = composition(first.bundle, first.prepared.version.id), preserved = copy(state);
  const second = await edit(first.bundle, first.prepared.source.id, { text: '새로 쓴 뒤의 다른 본문' });
  assert.ok(Core.searchSources(second.bundle, '새로 쓴').some(row => row.sourceVersionId === second.prepared.version.id));
  const defaultCopy = Share.makeDraft(second.bundle, state).snapshot;
  assert.equal(defaultCopy.entries[0].parts[0].text, null);
  assert.equal(defaultCopy.entries[0].parts[0].textKind, 'none');
  const publicCopy = Share.makeDraft(second.bundle, state, { bodyVersionIds: [first.prepared.version.id] }).snapshot;
  assert.equal(publicCopy.entries[0].parts[0].text, body);
  assert.equal(publicCopy.entries[0].parts[0].origin, 'other');
  assert.equal(publicCopy.entries[0].parts[0].author.relation, 'self');
  assert.equal(JSON.stringify(publicCopy).includes(first.prepared.source.sourceKey), false);
  assert.deepEqual(state, preserved);
  const restored = await Workbench.restoreBackup(Workbench.makeBackup(second.bundle, state));
  assert.equal(Writing.isOwnSource(restored.bundle.sources[0], restored.bundle), true);
  const oldRef = restored.workbench.page.entries[0].parts[0].versionId;
  assert.equal(restored.bundle.sourceVersions.find(version => version.id === oldRef).contentText, body);
});

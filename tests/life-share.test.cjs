const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../assets/life/core.js');
const workbench = require('../assets/life/workbench.js');
const share = require('../assets/life/share.js');
const copy = value => JSON.parse(JSON.stringify(value));

async function fixture() {
  let bundle = core.createWorkspace({ title: '공개하지 않을 작업공간 이름' });
  const imported = await core.prepareImport({ origin: 'naver_blog', title: '읽고 나서 떠오른 질문',
    text: '첫 문장. 🌱 오래 남은 생각. 마지막 문장.', url: 'https://example.org/source?chapter=2',
    author: '원래 글쓴이', authorRelation: 'other', originalCreatedAt: '지난 봄',
    coverage: { status: 'partial', omissions: ['사진 미보관'] } }, bundle);
  bundle = core.applyChanges(bundle, core.buildImportChanges(bundle, imported,
    [{ start: 0, end: 3, topic: '공개하지 않을 개인 주제', note: '공개하지 않을 원문 메모' }]), 1);
  const state = workbench.empty(bundle.workspaceId);
  state.page.title = '내가 골라 둔 기록'; state.page.intro = '내 페이지 소개';
  state.page.entries = [{ id: core.id(), title: '다시 생각한 문장', pinned: false, enabled: true,
    parts: [{ versionId: imported.version.id, enabled: true }], note: '페이지에 남길 내 코멘트', showBody: true, showNote: true }];
  state.reflection.note = '공개하면 안 되는 개인 회고';
  return { bundle, state, versionId: imported.version.id };
}

test('default public copy includes only selected presentation metadata and its own page comment', async () => {
  const { bundle, state, versionId } = await fixture();
  const before = JSON.stringify({ bundle, state });
  const { snapshot, reviewRows } = share.makeDraft(bundle, state);
  assert.equal(snapshot.entries[0].parts[0].text, null); assert.equal(snapshot.entries[0].parts[0].textKind, 'none');
  assert.equal(snapshot.entries[0].note, state.page.entries[0].note);
  assert.equal(snapshot.entries[0].parts[0].originalCreatedAt, '지난 봄');
  assert.equal(reviewRows[0].versionId, versionId); assert.equal(reviewRows[0].text, bundle.sourceVersions[0].contentText);
  assert.equal(reviewRows[0].canIncludeBody, true);
  const wire = JSON.stringify(snapshot);
  for (const value of [bundle.workspaceId, state.page.entries[0].id, versionId, bundle.sources[0].id,
    bundle.title, state.reflection.note, bundle.records[0].id, bundle.records[0].note,
    bundle.records[0].topic, bundle.sourceVersions[0].contentHash, 'importedAt']) assert(!wire.includes(value));
  assert.equal(JSON.stringify({ bundle, state }), before);
  assert(Object.isFrozen(snapshot.entries[0].parts[0].author));
  assert(!Object.isFrozen(bundle.sourceVersions[0]));
});

test('other people and unknown authors are never republished merely because preview shows bodies', async () => {
  for (const relation of ['other', 'unknown', 'self']) {
    const { bundle, state, versionId } = await fixture(); bundle.sourceVersions[0].originalAuthor.relation = relation;
    assert.equal(share.makeDraft(bundle, state).snapshot.entries[0].parts[0].textKind, 'none');
    const result = share.makeDraft(bundle, state, { bodyVersionIds: [versionId] });
    assert.equal(result.snapshot.entries[0].parts[0].text, bundle.sourceVersions[0].contentText);
    assert.equal(result.snapshot.entries[0].parts[0].textKind, 'body');
  }
});

test('exact UTF-16 excerpts preserve source coverage while identifying the public text as an excerpt', async () => {
  const { bundle, state, versionId } = await fixture(); const body = bundle.sourceVersions[0].contentText;
  const start = body.indexOf('🌱'), end = body.indexOf(' 마지막');
  const part = share.makeDraft(bundle, state, { excerpts: [{ versionId, start, end }] }).snapshot.entries[0].parts[0];
  assert.equal(part.text, body.slice(start, end)); assert.equal(part.textKind, 'excerpt');
  assert.equal(part.coverage.status, 'partial');
  assert.throws(() => share.makeDraft(bundle, state, { excerpts: [{ versionId, start: start + 1, end }] }), { code: 'invalid_snapshot' });
  assert.throws(() => share.makeDraft(bundle, state, { bodyVersionIds: [versionId], excerpts: [{ versionId, start, end }] }), { code: 'invalid_snapshot' });
  assert.throws(() => share.makeDraft(bundle, state, { excerpts: [{ versionId, start, end: body.length + 1 }] }), { code: 'invalid_snapshot' });
});

test('hidden parts and entries never leak, and missing visible references stop publication', async () => {
  const { bundle, state, versionId } = await fixture();
  state.page.entries.push({ ...copy(state.page.entries[0]), id: core.id(), enabled: false,
    parts: [{ versionId: 'missing-disabled', enabled: true }], note: '숨긴 항목의 코멘트' });
  state.page.entries[0].parts.push({ versionId: 'missing-hidden-part', enabled: false });
  state.page.showIntro = false; state.page.entries[0].showNote = false;
  let result = share.makeDraft(bundle, state);
  assert.equal(result.snapshot.intro, null); assert.equal(result.snapshot.entries[0].note, null);
  assert.equal(result.snapshot.entries.length, 1); assert.equal(result.snapshot.entries[0].parts.length, 1);
  state.page.entries[0].parts[1].enabled = true;
  assert.throws(() => share.makeDraft(bundle, state), { code: 'missing_reference' });
  state.page.entries[0].parts[1].enabled = false; state.page.entries[0].showBody = false;
  assert.equal(share.makeDraft(bundle, state).reviewRows[0].canIncludeBody, false);
  assert.throws(() => share.makeDraft(bundle, state, { bodyVersionIds: [versionId] }), { code: 'invalid_snapshot' });
  state.page.showRecent = false;
  assert.equal(share.makeDraft(bundle, state).snapshot.entries.length, 0);
  state.page.entries[0].pinned = true;
  assert.equal(share.makeDraft(bundle, state).snapshot.entries.length, 1);
});

test('one version appearing in multiple entries is reviewed once and each body switch is respected', async () => {
  const { bundle, state, versionId } = await fixture();
  state.page.entries.push({ ...copy(state.page.entries[0]), id: core.id(), showBody: false, pinned: true });
  const { snapshot, reviewRows } = share.makeDraft(bundle, state, { bodyVersionIds: [versionId] });
  assert.equal(reviewRows.length, 1); assert.equal(reviewRows[0].canIncludeBody, true);
  assert.equal(snapshot.entries[0].pinned, true); assert.equal(snapshot.entries[0].parts[0].text, null);
  assert.equal(snapshot.entries[1].parts[0].textKind, 'body');
});

test('unknown fields, unsafe URLs and mismatched text kind fail closed', async () => {
  const { bundle, state } = await fixture(); const snapshot = share.makeDraft(bundle, state).snapshot;
  for (const mutate of [value => value.ownerId = 'private', value => value.entries[0].id = 'private',
    value => value.entries[0].parts[0].sourceVersionId = 'private', value => value.entries[0].parts[0].textKind = 'body',
    value => value.entries[0].parts[0].author.label = '\u0000secret', value => value.entries[0].parts[0].text = 'hidden']) {
    const modified = copy(snapshot); mutate(modified); assert.throws(() => share.validate(modified), { code: 'invalid_snapshot' });
  }
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'https://user:password@example.org/', 'https://@example.org/', 'https://example.org/ a', 'https://example.org\\x']) {
    const modified = copy(snapshot); modified.entries[0].parts[0].url = url;
    assert.throws(() => share.validate(modified), { code: 'unsafe_url' });
  }
  assert.equal(share.safeURL(''), null);
  assert.equal(share.safeURL('https://example.org/a?chosen=value#original'), 'https://example.org/a?chosen=value#original');
  const modified = copy(snapshot); modified.entries[0].parts[0].url = ''; assert.throws(() => share.validate(modified));
});

test('publication limits reject excess data instead of silently changing the selected copy', async () => {
  const { bundle, state, versionId } = await fixture(); const draft = share.makeDraft(bundle, state).snapshot;
  const oversizedText = copy(draft); oversizedText.intro = '가'.repeat(50001);
  assert.throws(() => share.validate(oversizedText), { code: 'invalid_snapshot' });
  const oversizedBytes = copy(draft); oversizedBytes.entries = Array.from({ length: 30 }, () => ({ ...copy(draft.entries[0]), note: '가'.repeat(20000) }));
  assert.throws(() => share.validate(oversizedBytes), { code: 'snapshot_too_large' });
  const parts = copy(draft); parts.entries = Array.from({ length: 3 }, () => ({ ...copy(draft.entries[0]), parts: Array.from({ length: 100 }, () => copy(draft.entries[0].parts[0])) }));
  assert.throws(() => share.validate(parts), { code: 'invalid_snapshot' });
  assert.throws(() => share.makeDraft(bundle, state, { bodyVersionIds: [versionId, versionId] }), { code: 'invalid_snapshot' });
  assert.throws(() => share.makeDraft(bundle, state, { bodyVersionIds: ['not-visible'] }), { code: 'invalid_snapshot' });
  for (const invalid of [null, undefined, false, 0, '']) for (const key of ['bodyVersionIds', 'excerpts'])
    assert.throws(() => share.makeDraft(bundle, state, { [key]: invalid }), { code: 'invalid_snapshot' });
});

module.exports = { fixture };

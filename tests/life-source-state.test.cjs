'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/life/core.js');
const E = require('../assets/life/source-edit.js');
const clone = value => structuredClone(value);
async function sample() {
  let bundle = C.createWorkspace();
  const prepared = await C.prepareImport({ origin: 'other', title: '사라지면 안 되는 제목', text: '정확한 원문 😀\r\n옛 문장', format: 'text/markdown', authorRelation: 'other', coverage: 'partial' }, bundle);
  bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, prepared, [{ start: 0, end: 6, topic: '기존 발췌', note: '남길 메모' }]));
  return { bundle, source: prepared.source, version: prepared.version };
}
test('trash/restore preserves original graph and uses one stable state ID with optimistic revision and source checks', async () => {
  const f = await sample(); assert.deepEqual(C.sourceState(f.bundle, f.source.id), { status: 'active', revision: 0, link: null });
  let bundle = C.applyChanges(f.bundle, C.buildSourceStateChanges(f.bundle, f.source.id, 'trash', { expectedRevision: 0, expectedSourceRevision: 1, expectedStatus: 'active' }));
  const state = C.sourceState(bundle, f.source.id); assert.equal(state.status, 'trash'); assert.equal(state.revision, 1);
  assert.deepEqual(bundle.sources, f.bundle.sources); assert.deepEqual(bundle.sourceVersions, f.bundle.sourceVersions); assert.deepEqual(bundle.records, f.bundle.records);
  assert.equal(C.isVersionActive(bundle, f.version.id), false); assert.equal(C.isSourceActive(bundle, 'missing'), false);
  for (const options of [{ expectedRevision: 0 }, { expectedSourceRevision: 2 }, { expectedStatus: 'active' }]) assert.throws(() => C.buildSourceStateChanges(bundle, f.source.id, 'active', options), { code: 'source_state_conflict' });
  state.link.kind = 'tampered'; assert.equal(C.sourceState(bundle, f.source.id).status, 'trash');
  bundle = C.applyChanges(bundle, C.buildSourceStateChanges(bundle, f.source.id, 'active', { expectedRevision: 1 }));
  assert.equal(C.sourceState(bundle, f.source.id).link.id, state.link.id); assert.equal(C.sourceState(bundle, f.source.id).revision, 2); assert.equal(C.isVersionActive(bundle, f.version.id), true);
  assert.deepEqual(C.buildSourceStateChanges(bundle, f.source.id, 'active'), { put: { links: [] } });
});
test('duplicate, extra-field, missing-time and wrong-target reserved source rows fail validation', async () => {
  const f = await sample(), changes = C.buildSourceStateChanges(f.bundle, f.source.id, 'trash');
  const valid = C.applyChanges(f.bundle, changes);
  const mutations = [b => b.links.push({ ...clone(b.links[0]), id: C.id() }), b => { b.links[0].note = ''; }, b => { delete b.links[0].createdAt; },
    b => { b.links[0].entityRefs[0].revision = 1; }, b => { b.links[0].entityRefs[0].entityType = 'sourceVersion'; b.links[0].entityRefs[0].entityId = f.version.id; }, b => { b.links[0].revision = 0; }];
  for (const mutate of mutations) { const b = clone(valid); mutate(b); assert.throws(() => C.validateWorkspace(b)); }
});
test('late updates and new source uses cannot bypass old trash state by combining restore and edit', async () => {
  const f = await sample(), stage = E.edit(E.begin(f.bundle, f.source.id), { text: '삭제 직전 수정 입력' }), edit = await E.prepare(f.bundle, stage);
  const trash = C.applyChanges(f.bundle, C.buildSourceStateChanges(f.bundle, f.source.id, 'trash'));
  assert.throws(() => C.applyChanges(trash, edit.changes), { code: 'source_trashed' });
  const combined = clone(edit.changes); combined.put.links.push(...C.buildSourceStateChanges(trash, f.source.id, 'active').put.links);
  assert.throws(() => C.applyChanges(trash, combined), { code: 'source_trashed' });
  await assert.rejects(C.prepareImport({ origin: f.source.origin, title: f.source.title, text: '새 취득 본문', existingSourceId: f.source.id }, trash), { code: 'source_trashed' });
  const record = { ...clone(f.bundle.records[0]), id: C.id() };
  assert.throws(() => C.applyChanges(trash, { put: { records: [record] } }), { code: 'source_trashed' });
  assert.throws(() => C.applyChanges(trash, { put: { links: [{ id: C.id(), kind: 'new_use', entityRefs: [{ entityType: 'sourceVersion', entityId: f.version.id }] }] } }), { code: 'source_trashed' });
  assert.doesNotThrow(() => C.applyChanges(trash, { remove: { records: [record.id] } }));
});
test('known edit markers/base edges are immutable and cannot be replaced by a generic link or another marker ID', async () => {
  const f = await sample(), p = await E.prepare(f.bundle, E.edit(E.begin(f.bundle, f.source.id), { text: '고친 사본' }));
  const edited = C.applyChanges(f.bundle, p.changes), marker = edited.links.find(link => link.kind === 'source_edited_copy');
  for (const patch of [{ kind: 'ordinary' }, { updatedAt: '2030-01-01T00:00:00Z' }, { entityRefs: [{ entityType: 'sourceVersion', entityId: f.version.id }] }]) {
    assert.throws(() => C.applyChanges(edited, { put: { links: [{ ...clone(marker), ...patch }] } }));
  }
  const lost = clone(edited); lost.links = [];
  assert.throws(() => C.assertSourceLinkPreservation(edited, lost), { code: 'source_history_missing' });
  const replaced = clone(edited); replaced.links.find(link => link.id === marker.id).id = C.id();
  assert.throws(() => C.assertSourceLinkPreservation(edited, replaced), { code: 'source_history_missing' });
  const detached = C.editedCopyMarkers(edited, [p.version.id]); detached[0].kind = 'changed'; assert.equal(C.isEditedCopy(edited, p.version.id), true);
});
test('edit-base edges require one marker, an earlier distinct version of the same source and no extra payload', async () => {
  const f = await sample(), p = await E.prepare(f.bundle, E.edit(E.begin(f.bundle, f.source.id), { text: '수정 본문' }));
  const valid = C.applyChanges(f.bundle, p.changes), mutations = [b => { b.links = b.links.filter(link => link.kind !== 'source_edited_copy'); },
    b => { const edge = b.links.find(link => link.kind === 'source_edit_base'); edge.entityRefs.reverse(); },
    b => { const edge = b.links.find(link => link.kind === 'source_edit_base'); edge.entityRefs[0].entityId = edge.entityRefs[1].entityId; },
    b => { b.links.push({ ...clone(b.links.find(link => link.kind === 'source_edited_copy')), id: C.id() }); },
    b => { b.links.find(link => link.kind === 'source_edit_base').sourceRefs = []; }];
  for (const mutate of mutations) { const b = clone(valid); mutate(b); assert.throws(() => C.validateWorkspace(b)); }
});
test('full JSON copy remaps lifecycle/edit history and selected markers never drag in base edges or old bodies', async () => {
  const f = await sample(), p = await E.prepare(f.bundle, E.edit(E.begin(f.bundle, f.source.id), { text: '최신 사본' }));
  let b = C.applyChanges(f.bundle, p.changes); b = C.applyChanges(b, C.buildSourceStateChanges(b, f.source.id, 'trash'));
  const restored = await C.restoreBackup(C.makeBackup(b));
  assert.equal(restored.sourceVersions.length, 2); assert.deepEqual(restored.sourceVersions.map(v => v.contentText), b.sourceVersions.map(v => v.contentText));
  assert.equal(C.sourceState(restored, restored.sources[0].id).status, 'trash'); assert.equal(C.sourceState(restored, restored.sources[0].id).revision, 1);
  assert.equal(C.isEditedCopy(restored, restored.sourceVersions[1].id), true); assert.equal(restored.links.filter(link => link.kind === 'source_edit_base').length, 1);
  assert(restored.links.every(link => !b.links.some(old => old.id === link.id)));
  const selected = C.editedCopyMarkers(b, [p.version.id]); assert.equal(selected.length, 1); assert.equal(selected[0].kind, 'source_edited_copy');
});
test('search and reading export omit trash by default, retain existing exact records, and label edited copies', async () => {
  const f = await sample(), p = await E.prepare(f.bundle, E.edit(E.begin(f.bundle, f.source.id), { text: '새 사본 본문' }));
  let b = C.applyChanges(f.bundle, p.changes); assert(C.toMarkdown(b).includes('해도에서 수정한 사본'));
  b = C.applyChanges(b, C.buildSourceStateChanges(b, f.source.id, 'trash'));
  assert.deepEqual(C.searchSources(b, '원문'), []); assert(!C.toMarkdown(b).includes(f.source.title)); assert(!C.toMarkdown(b).includes('남길 메모'));
  const included = C.toMarkdown(b, { includeTrash: true }); assert(included.includes(f.source.title)); assert(included.includes('휴지통의 자료')); assert(included.includes('해도에서 수정한 사본'));
  assert.equal(b.records[0].sourceRefs[0].sourceVersionId, f.version.id); assert.equal(b.sourceVersions[0].contentText, f.version.contentText);
  assert.throws(() => C.toMarkdown(b, { includeTrash: 'yes' }));
});
test('a stale snapshot cannot silently erase the source lifecycle while a newer explicit same-ID restoration can advance it', async () => {
  const f = await sample(), trash = C.applyChanges(f.bundle, C.buildSourceStateChanges(f.bundle, f.source.id, 'trash'));
  assert.throws(() => C.assertSourceLinkPreservation(trash, f.bundle), { code: 'source_history_missing' });
  const restored = C.applyChanges(trash, C.buildSourceStateChanges(trash, f.source.id, 'active'));
  assert.equal(C.assertSourceLinkPreservation(trash, restored), true);
  assert.throws(() => C.assertSourceLinkPreservation(restored, trash), { code: 'source_state_conflict' });
});

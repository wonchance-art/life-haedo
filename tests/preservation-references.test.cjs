'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../assets/life/core.js'), P = require('../assets/life/photo-post.js');
const R = require('../assets/life/source-reference.js'), N = require('../assets/life/nine-board.js');
const A = require('../assets/life/preservation-references.js');
async function fixture() {
  let bundle = C.createWorkspace({ title: '선택하지 않은 개인 작업공간 이름' });
  const add = async input => { const result = await C.prepareImport(input, bundle); bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, result)); return result; };
  const body = '\ufeff🌱\r\n예전 원문의 구절\r\n원문 전체는 변경하지 않는다.';
  const old = await add({ origin: 'obsidian', title: '정확한 원문', fileName: 'notes/선택.md', url: 'https://example.org/frozen-commit/notes', text: body, authorRelation: 'unknown' });
  const latest = await add({ origin: 'obsidian', title: '현재 제목', existingSourceId: old.source.id, text: '최신 원문으로 대체하면 안 된다.', authorRelation: 'unknown' });
  const second = await add({ origin: 'obsidian', title: '의존 글의 원문', text: '두 번째 정확한 원문\r\n다음 줄', authorRelation: 'unknown' });
  const unrelated = await add({ origin: 'obsidian', title: '고르지 않은 원문', text: '절대로 포함하지 않을 개인 원문', authorRelation: 'unknown' });
  const ref = await R.build({ bundle, sourceId: old.source.id, versionId: old.version.id, locator: { start: body.indexOf('예전'), end: body.indexOf('원문 전체') } });
  const secondRef = await R.build({ bundle, sourceId: second.source.id, versionId: second.version.id, locator: { start: 0, end: 10 } });
  const unrelatedRef = await R.build({ bundle, sourceId: unrelated.source.id, versionId: unrelated.version.id, locator: { start: 0, end: 5 } });
  const time = bundle.createdAt;
  bundle.records.push({ id: C.id(), kind: 'excerpt', text: ref.quote, topic: '개인 분류', note: '선택하지 않은 개인 메모', sourceRefs: [{ sourceId: ref.sourceId, sourceVersionId: ref.sourceVersionId, locator: ref.locator }], provenance: { kind: 'user' }, revision: 1, createdAt: time, updatedAt: time });
  C.validateWorkspace(bundle);
  const doc = P.create(C.id); doc.status = 'saved'; doc.revision = 7; doc.title = '선택한 글'; doc.ops = [{ insert: '보존할 글의 본문🌱\r\n' }];
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2qkAAAAASUVORK5CYII=', 'base64');
  const blob = new Blob([bytes], { type: 'image/png' }), photo = { id: C.id(), name: '익명.png', type: 'image/png', width: 1, height: 1, size: blob.size, digest: await P.digest(blob), blob };
  doc.photos = [photo]; doc.ops.push({ insert: { photo: { id: photo.id, caption: '원본 설명', alt: '원본 대체 텍스트' } } }, { insert: '\n' });
  const dependency = P.create(C.id); dependency.status = 'saved'; dependency.revision = 4; dependency.title = '9칸이 참조한 저장 글'; dependency.ops = [{ insert: '정확히 이 revision의 글\n' }];
  const other = P.create(C.id); other.status = 'saved'; other.revision = 2; other.title = '고르지 않은 개인 글'; other.ops = [{ insert: '선택 범위 밖의 개인 본문\n' }];
  const postRef = await R.buildPost({ workspaceId: bundle.workspaceId, post: dependency });
  const board = N.create(C.id); board.title = '선택한 9칸'; board.areas[0].items = [N.evidenceSnapshot({ kind: 'source', value: ref }), N.evidenceSnapshot({ kind: 'post', value: postRef })];
  board.areas[0].items[0].reason = '내가 직접 쓴 선택 이유';
  const excludedBoard = N.create(C.id); excludedBoard.title = '포함하지 않을 구성'; excludedBoard.areas[0].items = [N.evidenceSnapshot({ kind: 'source', value: unrelatedRef })];
  const snapshot = { bundle, posts: [{ doc, evidence: { revision: 3, refs: [ref] } }, { doc: dependency, evidence: { revision: 1, refs: [secondRef] } }, { doc: other, evidence: { revision: 0, refs: [] } }], nineBoard: { ...N.empty(bundle.workspaceId), format: 'life-nine-board-v2', revision: 8, boards: [board, excludedBoard] } };
  const selection = { postIds: [doc.id], boardIds: [board.id] };
  return { snapshot, selection, ref, secondRef, postRef, old, latest, second, unrelated, doc, dependency, other, board, body };
}
test('selected edited evidence keeps its marker through fresh-copy restoration without leaking the base or unrelated markers', async () => {
  const f = await fixture(), bundle = f.snapshot.bundle, time = bundle.updatedAt;
  const marker = { id: C.id(), kind: 'source_edited_copy', entityRefs: [{ entityType: 'sourceVersion', entityId: f.latest.version.id }], revision: 1, createdAt: time, updatedAt: time };
  bundle.links.push(marker, { ...structuredClone(marker), id: C.id(), kind: 'source_edit_base', entityRefs: [
    { entityType: 'sourceVersion', entityId: f.old.version.id }, { entityType: 'sourceVersion', entityId: f.latest.version.id }] },
    { ...structuredClone(marker), id: C.id(), entityRefs: [{ entityType: 'sourceVersion', entityId: f.unrelated.version.id }] });
  const ref = await R.build({ bundle, sourceId: f.old.source.id, versionId: f.latest.version.id, locator: { start: 0, end: 10 } });
  f.snapshot.posts[0].evidence.refs = [ref]; f.board.areas[0].items[0] = N.evidenceSnapshot({ kind: 'source', value: ref });
  const selected = await A.select(f.snapshot, f.selection);
  assert.deepEqual(selected.bundle.links, [marker]); assert(!selected.bundle.sourceVersions.some(v => v.id === f.old.version.id));
  assert(!JSON.stringify(selected).includes(f.body)); assert(!JSON.stringify(selected).includes('source_edit_base'));
  const restored = await A.copy(selected), editedVersion = restored.bundle.sourceVersions.find(v => v.contentText === f.latest.version.contentText);
  assert(editedVersion); assert.equal(C.isEditedCopy(restored.bundle, editedVersion.id), true);
  assert.notEqual(restored.bundle.links[0].id, marker.id); assert.equal(restored.bundle.links[0].entityRefs[0].entityId, editedVersion.id);
  await R.resolve(restored.bundle, restored.posts[0].evidence.refs[0]);
  const polluted = structuredClone(selected); polluted.bundle.links.push({ id: C.id(), kind: 'private_link', entityRefs: [{ entityType: 'sourceVersion', entityId: f.latest.version.id }] });
  await assert.rejects(A.validate(polluted), /필요하지 않은/);
});
test('selection follows exact board → post → evidence dependencies and excludes unrelated versions, notes and workspace metadata', async () => {
  const f = await fixture(), before = structuredClone(f.snapshot), value = await A.select(f.snapshot, f.selection);
  assert.deepEqual(f.snapshot, before);
  assert.equal(value.bundle.title, '선택한 원문');
  assert.deepEqual(value.posts.map(row => row.doc.id), [f.doc.id, f.dependency.id]);
  assert.deepEqual(value.bundle.sourceVersions.map(v => v.id), [f.old.version.id, f.second.version.id]);
  assert.deepEqual(value.nineBoard.boards.map(board => board.id), [f.board.id]);
  for (const key of ['records', 'links', 'resumeHints', 'tombstones']) assert.deepEqual(value.bundle[key], []);
  assert(!JSON.stringify(value).includes('선택하지 않은 개인'));
  assert(!JSON.stringify(value).includes(f.latest.version.contentText));
  assert(!JSON.stringify(value).includes(f.other.id));
  assert.equal(value.bundle.sourceVersions[0].contentText, f.body);
  assert.deepEqual(await A.validate(value), value);
});
test('copy regenerates every identity and restores exact source/post references, original bytes and independent revisions', async () => {
  const f = await fixture(), selected = await A.select(f.snapshot, f.selection), before = structuredClone(selected);
  let id = 0; const copy = await A.copy(selected, { fresh: () => 'copy_' + ++id, title: '복원한 익명 글·근거' });
  assert.deepEqual(selected, before); assert.notEqual(copy.bundle.workspaceId, selected.bundle.workspaceId);
  assert.equal(copy.bundle.title, '복원한 익명 글·근거'); assert.equal(copy.bundle.revision, 0); assert.equal(copy.nineBoard.revision, 0);
  assert.deepEqual(copy.bundle.sourceVersions.map(v => v.contentText), selected.bundle.sourceVersions.map(v => v.contentText));
  for (const row of copy.posts) {
    assert.equal(row.doc.revision, 1); assert.equal(row.doc.replaces, null); assert.equal(row.evidence.revision, 1);
    assert(!selected.posts.some(original => original.doc.id === row.doc.id));
    for (const ref of row.evidence.refs) { await R.resolve(copy.bundle, ref); assert.equal(ref.workspaceId, copy.bundle.workspaceId); }
  }
  const originalPhoto = selected.posts[0].doc.photos[0], photo = copy.posts[0].doc.photos[0];
  assert.notEqual(photo.id, originalPhoto.id); assert.equal(copy.posts[0].doc.ops[1].insert.photo.id, photo.id);
  assert.deepEqual(Buffer.from(await photo.blob.arrayBuffer()), Buffer.from(await originalPhoto.blob.arrayBuffer()));
  assert.equal(photo.digest, originalPhoto.digest);
  const board = copy.nineBoard.boards[0]; assert.notEqual(board.id, selected.nineBoard.boards[0].id); assert.notEqual(board.areas[0].id, selected.nineBoard.boards[0].areas[0].id);
  const source = board.areas[0].items[0].reference.value, post = board.areas[0].items[1].reference.value;
  await R.resolve(copy.bundle, source); assert.equal(source.quote, f.ref.quote); assert.deepEqual(source.locator, f.ref.locator);
  const dependency = copy.posts.find(row => row.doc.id === post.postId).doc;
  assert.equal(post.postRevision, 1); await R.resolvePost({ workspaceId: copy.bundle.workspaceId, post: dependency }, post);
});
test('stale post revision/body, missing dependencies and foreign workspaces fail instead of substituting current data', async () => {
  const f = await fixture();
  const changes = [
    value => value.posts[1].doc.revision++,
    value => value.posts[1].doc.ops = [{ insert: '변경된 같은 revision의 본문\n' }],
    value => value.posts.splice(1, 1),
    value => value.nineBoard.boards[0].areas[0].items[1].reference.value.workspaceId = C.id(),
    value => value.posts[0].evidence.refs[0].workspaceId = C.id(),
    value => value.bundle.sourceVersions.splice(0, 1),
    value => value.bundle.sourceVersions[0].contentText += '변조',
  ];
  for (const change of changes) { const value = structuredClone(f.snapshot); change(value); await assert.rejects(A.select(value, f.selection)); }
});
test('package validation rejects surplus original records, versions, sources and hidden fields', async () => {
  const f = await fixture(), selected = await A.select(f.snapshot, f.selection);
  for (const change of [
    value => value.bundle.records = structuredClone(f.snapshot.bundle.records),
    value => value.bundle.sourceVersions.push(structuredClone(f.latest.version)),
    value => { value.bundle.sources.push(structuredClone(f.unrelated.source)); value.bundle.sourceVersions.push(structuredClone(f.unrelated.version)); },
    value => value.posts[0].evidence.note = '숨은 개인 메모',
    value => value.posts[0].evidence.refs[0].url = false,
    value => value.posts[0].doc.privateNote = '숨은 개인 메모',
    value => value.nineBoard.boards[0].areas[0].items[0].attachment.note = '숨은 개인 메모',
    value => value.publicSnapshot = {},
  ]) { const value = structuredClone(selected); change(value); await assert.rejects(A.validate(value)); }
});
test('empty and duplicate selections are rejected; legacy boards and explicitly selected archived saved posts remain usable', async () => {
  const f = await fixture();
  for (const selection of [{ postIds: [], boardIds: [] }, { postIds: [f.doc.id, f.doc.id], boardIds: [] }, { postIds: [], boardIds: ['missing'] }]) await assert.rejects(A.select(f.snapshot, selection));
  const board = N.create(C.id); board.areas[0].items.push(N.snapshot({ type: 'book', title: '기존 외부 대상' }));
  const snapshot = { bundle: f.snapshot.bundle, posts: [], nineBoard: { ...N.empty(f.snapshot.bundle.workspaceId), boards: [board] } };
  const legacy = await A.select(snapshot, { postIds: [], boardIds: [board.id] });
  assert.equal(legacy.nineBoard.format, 'life-nine-board-v1'); assert.deepEqual(legacy.bundle.sources, []); await A.copy(legacy);
  f.snapshot.posts[2].doc.archived = true;
  const archived = await A.select(f.snapshot, { postIds: [f.other.id], boardIds: [] });
  assert.equal((await A.copy(archived)).posts[0].doc.archived, true);
  f.snapshot.posts[2].doc.status = 'draft'; await assert.rejects(A.select(f.snapshot, { postIds: [f.other.id], boardIds: [] }));
});
test('selection and copy own snapshots before asynchronous hashes and require fresh collision-free identities', async () => {
  const f = await fixture(), original = f.snapshot.posts[0].doc.ops[0].insert;
  const pending = A.select(f.snapshot, f.selection);
  f.snapshot.posts[0].doc.ops[0].insert = '검증 중 바뀐 입력\n'; f.snapshot.bundle.sourceVersions[0].contentText += '변조'; f.selection.postIds.length = 0;
  const selected = await pending; assert.equal(selected.posts[0].doc.ops[0].insert, original);
  await assert.rejects(A.copy(selected, { fresh: () => selected.bundle.workspaceId }));
  await assert.rejects(A.copy(selected, { fresh: () => 'same' }));
  await assert.rejects(A.copy(selected, { fresh: () => '../unsafe' }));
});
test('dependency posts count toward the explicit twenty-post preservation limit', async () => {
  const f = await fixture(), rows = Array.from({ length: 20 }, () => {
    const doc = P.create(C.id); doc.status = 'saved'; doc.revision = 1; doc.ops = [{ insert: '선택한 저장 글\n' }]; return { doc, evidence: { revision: 0, refs: [] } };
  });
  const snapshot = { ...f.snapshot, posts: [...rows, f.snapshot.posts[1]] };
  await assert.rejects(A.select(snapshot, { postIds: rows.map(row => row.doc.id), boardIds: [f.board.id] }), /20개/);
});
test('a 3479-source pool minimizes by exact selected identity even when unrelated originals have the same body hash', async () => {
  const f = await fixture();
  for (let index = f.snapshot.bundle.sources.length; index < 3479; index++) {
    const sourceId = 'scale_source_' + index;
    f.snapshot.bundle.sources.push({ ...f.unrelated.source, id: sourceId, title: '고르지 않은 합성 원문 ' + index, sourceKey: 'synthetic/' + index + '.md' });
    f.snapshot.bundle.sourceVersions.push({ ...f.old.version, id: 'scale_version_' + index, sourceId });
  }
  const value = await A.select(f.snapshot, f.selection);
  assert.equal(value.bundle.sources.length, 2); assert.equal(value.bundle.sourceVersions.length, 2);
  assert.deepEqual(value.bundle.sourceVersions.map(v => v.id), [f.old.version.id, f.second.version.id]);
  assert(!JSON.stringify(value).includes('scale_source_'));
  await A.validate(value);
});
test('unselected workspace, source and post edits do not leak metadata or invalidate the selected preservation snapshot', async () => {
  const f = await fixture(), original = await A.select(f.snapshot, f.selection);
  f.snapshot.bundle.title = '나중에 바꾼 비공개 공간 이름';
  f.snapshot.bundle.updatedAt = '2026-10-20T00:00:00.000Z';
  const source = f.snapshot.bundle.sources.find(source => source.id === f.unrelated.source.id);
  source.title = '다른 원문의 수정'; source.updatedAt = '2026-10-20T00:00:00.000Z';
  f.snapshot.posts[2].doc.ops = [{ insert: '다른 글에서 계속 쓰는 본문\n' }]; f.snapshot.posts[2].doc.updatedAt = '2026-10-20T00:00:00.000Z';
  assert.deepEqual(await A.select(f.snapshot, f.selection), original);
});

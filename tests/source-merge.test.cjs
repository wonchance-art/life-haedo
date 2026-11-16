'use strict';
// Originals merge (SyncCommon.mergeWorkspace): two devices changed the same workspace and meet.
// Pure function only. The storage transaction: tests/life-storage.test.cjs. The CAS loop with the
// real storage and engine: tests/source-merge-devices.test.cjs. Two real pages: tests/source-merge-browser.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const Core = require('../assets/life/core.js');
const { mergeWorkspace, mergeBase, replacedSourceLinks, wellFormed, RECOVERY_TOPIC, PREVIOUS_TITLE, PREVIOUS_KEY } = require('../assets/life/sync-common.js');
const copy = value => structuredClone(value);
const tick = () => new Promise(resolve => setTimeout(resolve, 3)); // later ISO millisecond
const titles = bundle => bundle.sources.map(source => source.title);
const content = bundle => JSON.stringify({ ...bundle, revision: 0 });

async function imp(bundle, title, text, excerpts = [], extra = {}) {
  await tick();
  const prepared = await Core.prepareImport({ origin: 'other', title, text, authorRelation: 'self', forceSeparate: !extra.existingSourceId, ...extra }, bundle);
  return Core.applyChanges(bundle, Core.buildImportChanges(bundle, prepared, excerpts));
}
async function newVersion(bundle, sourceId, title, text) { return imp(bundle, title, text, [], { existingSourceId: sourceId }); }
async function editRecord(bundle, id, patch) {
  await tick();
  const record = bundle.records.find(value => value.id === id);
  return Core.applyChanges(bundle, { put: { records: [{ ...copy(record), ...patch, revision: record.revision + 1, updatedAt: new Date().toISOString() }] } });
}
async function removeRecord(bundle, id) { await tick(); return Core.applyChanges(bundle, { remove: { records: [id] } }); }
async function setState(bundle, sourceId, status) { await tick(); return Core.applyChanges(bundle, Core.buildSourceStateChanges(bundle, sourceId, status)); }
// Both directions give the same content, the result is a valid workspace without half surrogate
// pairs, each side can take it, and merging the result again changes nothing: with either side
// under the same base (the other device merges too), and with a side as the new base (the upload
// was refused and the server still holds that side).
function merged(base, a, b) {
  const one = mergeWorkspace({ base: base && mergeBase(base), local: a, remote: b }), other = mergeWorkspace({ base: base && mergeBase(base), local: b, remote: a });
  Core.validateWorkspace(one.bundle);
  assert.equal(wellFormed({ ...one.bundle, sourceVersions: null }), true);
  assert.equal(content(one.bundle), content(other.bundle), 'the same result whichever device merges');
  assert.deepEqual(one.notice, other.notice);
  for (const side of [a, b]) {
    for (const version of side.sourceVersions) assert.deepEqual(one.bundle.sourceVersions.find(value => value.id === version.id), version, 'every exact version stays');
    const replaced = replacedSourceLinks(side, one.bundle);
    Core.assertSourceLinkPreservation({ ...side, links: side.links.filter(link => !replaced.has(link.id)) }, one.bundle);
    for (const [label, known] of [['the same base', base && mergeBase(base)], ['that side as the base', mergeBase(side)]]) {
      const again = mergeWorkspace({ base: known, local: one.bundle, remote: side }), swapped = mergeWorkspace({ base: known, local: side, remote: one.bundle });
      assert.equal(content(again.bundle), content(one.bundle), 'merged again with ' + label + ': nothing changes');
      assert.equal(content(swapped.bundle), content(one.bundle), 'merged again with ' + label + ' (other device): nothing changes');
      assert.equal(again.equalsLocal, true);
    }
  }
  return one;
}
async function seed() {
  let base = Core.createWorkspace({ title: '익명 자료' });
  base = await imp(base, '공통 자료', '공통 본문 첫 줄\n둘째 줄 😀 끝', [{ start: 0, end: 5, topic: '주제', note: '처음 메모' }]);
  return base;
}

test('both sides added different sources: both stay, in one order, and nothing is announced', async () => {
  const base = await seed();
  const phone = await imp(base, '폰에서 가져온 자료', '폰 원문'), mac = await imp(base, '맥에서 가져온 자료', '맥 원문');
  const result = merged(base, phone, mac);
  assert.deepEqual(titles(result.bundle), ['공통 자료', '폰에서 가져온 자료', '맥에서 가져온 자료']);
  assert.equal(result.bundle.sourceVersions.length, 3); assert.equal(result.notice, null);
  assert.equal(result.equalsLocal, false); assert.equal(result.equalsRemote, false);
  assert.equal(content(merged(null, phone, mac).bundle), content(result.bundle), 'additions need no base');
});

test('only one side changed: taken as is, and the result is exactly that side', async () => {
  const base = await seed();
  const ahead = await imp(base, '새 자료', '새 본문');
  const result = mergeWorkspace({ base: mergeBase(base), local: base, remote: ahead });
  assert.equal(result.equalsRemote, true); assert.equal(result.equalsLocal, false);
  assert.equal(content(result.bundle), content(ahead), 'timestamps included: nothing to send');
  const back = mergeWorkspace({ base: mergeBase(base), local: ahead, remote: base });
  assert.equal(back.equalsLocal, true); assert.equal(back.equalsRemote, false); assert.equal(content(back.bundle), content(ahead));
});

test('a change on one side wins over the unchanged side even with an older clock', async () => {
  const base = await seed(), id = base.records[0].id;
  const edited = copy(base); Object.assign(edited.records[0], { note: '느린 시계의 수정', revision: 2, updatedAt: '2001-01-01T00:00:00.000Z', createdAt: '2001-01-01T00:00:00.000Z' });
  base.records[0].createdAt = '2001-01-01T00:00:00.000Z'; edited.revision++;
  const other = await imp(base, '다른 자료', '다른 본문');
  const result = merged(base, edited, other);
  assert.equal(result.bundle.records.find(record => record.id === id).note, '느린 시계의 수정'); assert.equal(result.notice, null);
  assert.equal(result.bundle.records.length, 1, 'no recovery copy: only one side changed it');
});

test('both sides edited the same source: both exact versions stay, the later one is current, the excerpt keeps its exact version', async () => {
  const base = await seed(), sourceId = base.sources[0].id, first = base.sourceVersions[0], excerpt = base.records[0];
  const mac = await newVersion(base, sourceId, '맥에서 고친 제목', '맥에서 고친 본문');
  const phone = await newVersion(base, sourceId, '폰에서 고친 제목', '폰에서 나중에 고친 본문');
  const result = merged(base, mac, phone), versions = result.bundle.sourceVersions.filter(version => version.sourceId === sourceId);
  assert.deepEqual(versions.map(version => version.contentText), [first.contentText, '맥에서 고친 본문', '폰에서 나중에 고친 본문']);
  assert.equal(result.bundle.sources[0].title, '폰에서 고친 제목', 'the later edit is the current one');
  assert.equal(result.bundle.sources[0].revision, 2);
  assert.deepEqual(result.notice, { sourceIds: [sourceId], recordIds: [], restoredIds: [] }, 'the earlier body is findable as a previous version');
  // The title that lost stays on the exact version the losing device saved, on every device.
  const row = result.bundle.links.find(link => link.kind === PREVIOUS_TITLE);
  assert.deepEqual([row.note, row.sourceRefs], ['맥에서 고친 제목', [{ sourceId, sourceVersionId: versions[1].id, locator: null }]]);
  assert.equal(result.bundle.links.length, 1);
  const kept = result.bundle.records.find(record => record.id === excerpt.id);
  assert.deepEqual(kept.sourceRefs, excerpt.sourceRefs); // exact version and UTF-16 range
  assert.equal(first.contentText.slice(kept.sourceRefs[0].locator.start, kept.sourceRefs[0].locator.end), kept.text);
});

test('both sides edited the same excerpt: the later edit stays and the other is a 복구 사본 excerpt on the same exact range', async () => {
  const base = await seed(), id = base.records[0].id;
  const mac = await editRecord(base, id, { note: '맥 메모' }), phone = await editRecord(base, id, { note: '폰 메모(나중)', topic: '새 주제' });
  const result = merged(base, mac, phone), records = result.bundle.records;
  assert.equal(records.length, 2);
  assert.deepEqual([records[0].id, records[0].note, records[0].topic, records[0].revision], [id, '폰 메모(나중)', '새 주제', 2]);
  const recovery = records[1];
  assert.deepEqual([recovery.note, recovery.topic, recovery.text, recovery.revision], ['맥 메모', RECOVERY_TOPIC + ' · 주제', base.records[0].text, 1]);
  assert.deepEqual(recovery.sourceRefs, base.records[0].sourceRefs); assert.match(recovery.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(result.notice, { sourceIds: [], recordIds: [recovery.id], restoredIds: [] });
  // Merging again (a CAS retry, or the other device still holding its edit) adds no second copy.
  for (const side of [mac, phone]) {
    const again = merged(base, result.bundle, side);
    assert.equal(content(again.bundle), content(result.bundle)); assert.equal(again.notice, null);
  }
  // The person deleted the recovery copy; a device that still holds the losing edit does not bring it back.
  const cleaned = await removeRecord(result.bundle, recovery.id);
  assert.deepEqual(merged(base, cleaned, mac).bundle.records.map(record => record.id), [id]);
});

test('the same edit on both sides (only the save differs) keeps no recovery copy', async () => {
  const base = await seed(), id = base.records[0].id;
  const mac = await editRecord(base, id, { note: '같은 메모' }), phone = await editRecord(base, id, { note: '같은 메모' });
  const result = merged(base, mac, phone);
  assert.equal(result.bundle.records.length, 1); assert.equal(result.notice, null);
});

test('deleted on one side: gone when the other side left it alone, kept when the other side changed it', async () => {
  const base = await seed(), id = base.records[0].id;
  const deleted = await removeRecord(base, id);
  const untouched = await imp(base, '다른 자료', '다른 본문');
  const gone = merged(base, deleted, untouched);
  assert.deepEqual(gone.bundle.records, []); assert.deepEqual(gone.bundle.tombstones.map(item => item.entityId), [id]);
  const edited = await editRecord(base, id, { note: '지우기 전에 다른 기기에서 고친 메모' });
  const kept = merged(base, deleted, edited);
  assert.equal(kept.bundle.records[0].note, '지우기 전에 다른 기기에서 고친 메모'); assert.deepEqual(kept.bundle.tombstones, []);
  // The deleting device already sent the deletion (its base has no such excerpt): the edit still survives.
  assert.equal(merged(deleted, deleted, edited).bundle.records.length, 1);
  // Deleted on both: one deletion mark.
  const both = merged(base, deleted, await removeRecord(base, id));
  assert.deepEqual(both.bundle.records, []); assert.equal(both.bundle.tombstones.length, 1);
});

test('what pointed at a deleted excerpt goes with it', async () => {
  let base = await seed(); const id = base.records[0].id;
  base = Core.applyChanges(base, { put: { links: [{ id: Core.id(), kind: 'note_link', note: '발췌 연결', entityRefs: [{ entityType: 'record', entityId: id }], revision: 1, createdAt: base.createdAt, updatedAt: base.createdAt }] } });
  const deleted = await removeRecord(base, id), other = await imp(base, '다른 자료', '다른 본문');
  assert.equal(other.links.length, 1);
  assert.deepEqual(merged(base, deleted, other).bundle.links, []);
});

test('without a base nothing is deleted: both sides are joined and a differing item keeps the later edit', async () => {
  const base = await seed(), id = base.records[0].id;
  const deleted = await removeRecord(await imp(base, '폰 자료', '폰 본문'), id), other = await imp(base, '맥 자료', '맥 본문');
  const result = merged(null, deleted, other);
  assert.deepEqual(titles(result.bundle), ['공통 자료', '폰 자료', '맥 자료']);
  assert.equal(result.bundle.records.length, 1, 'the excerpt one side still holds stays'); assert.deepEqual(result.bundle.tombstones, []);
  const mac = await editRecord(base, id, { note: '맥' }), phone = await editRecord(base, id, { note: '폰(나중)' });
  const edited = merged(null, mac, phone);
  assert.deepEqual(edited.bundle.records.map(record => record.note), ['폰(나중)', '맥']);
});

test('trash and restore: the later state wins; a source the other side kept working on is not left in the trash', async () => {
  const base = await seed(), sourceId = base.sources[0].id;
  const trashed = await setState(base, sourceId, 'trash');
  const idle = await imp(base, '다른 자료', '다른 본문');
  const stays = merged(base, trashed, idle);
  assert.equal(Core.sourceState(stays.bundle, sourceId).status, 'trash', 'nothing else happened to it: the trash stands');
  const worked = await newVersion(base, sourceId, '계속 쓴 제목', '다른 기기에서 계속 쓴 본문');
  const revived = merged(base, trashed, worked), state = Core.sourceState(revived.bundle, sourceId);
  assert.deepEqual([state.status, state.revision], ['active', 2]);
  assert.equal(revived.bundle.sourceVersions.filter(version => version.sourceId === sourceId).length, 2);
  // Restored on one device after both had it in the trash: only that side changed.
  const restored = await setState(trashed, sourceId, 'active');
  assert.equal(Core.sourceState(merged(trashed, restored, trashed).bundle, sourceId).status, 'active');
  // Both moved the never-trashed source to the trash: one row, and each device can take it.
  const alsoTrashed = await setState(base, sourceId, 'trash');
  assert.notEqual(trashed.links[0].id, alsoTrashed.links[0].id);
  const one = merged(base, trashed, alsoTrashed);
  assert.equal(one.bundle.links.length, 1); assert.deepEqual([one.bundle.links[0].id, one.bundle.links[0].kind, one.bundle.links[0].revision], [trashed.links[0].id, 'source_trash', 2]);
  assert.deepEqual([...replacedSourceLinks(alsoTrashed, one.bundle)], [alsoTrashed.links[0].id]);
  assert.deepEqual([...replacedSourceLinks(trashed, one.bundle)], []);
});

test('the same version identifier with other text is damage, never merged', async () => {
  const base = await seed(), damaged = copy(base);
  damaged.sourceVersions[0].contentText = '바뀐 본문'; damaged.records = [];
  assert.throws(() => mergeWorkspace({ base: mergeBase(base), local: base, remote: damaged }), error => error.code === 'immutable_source_version');
});

test('workspace title: the side that changed it, or the later of two changes', async () => {
  const base = await seed();
  const renamed = { ...copy(base), title: '새 이름', revision: base.revision + 1, updatedAt: new Date(Date.parse(base.updatedAt) + 1000).toISOString() };
  const other = await imp(base, '다른 자료', '본문');
  assert.equal(merged(base, renamed, other).bundle.title, '새 이름');
  const later = { ...copy(base), title: '나중 이름', revision: base.revision + 1, updatedAt: new Date(Date.parse(base.updatedAt) + 5000).toISOString() };
  assert.equal(merged(base, renamed, later).bundle.title, '나중 이름');
});

test('equal edit times: the same winner whichever device merges, and the other edit is kept', async () => {
  const base = await seed(), record = base.records[0], at = new Date(Date.now() + 5000).toISOString();
  const put = note => Core.applyChanges(base, { put: { records: [{ ...copy(record), note, revision: 2, updatedAt: at }] } });
  const a = put('가'), b = put('나');
  const result = merged(base, a, b); // both directions are compared inside
  assert.deepEqual(result.bundle.records.map(value => value.note).sort(), ['가', '나']);
  assert.equal(result.bundle.records.filter(value => value.topic.startsWith(RECOVERY_TOPIC)).length, 1);
  // Which one wins a tie is fixed (the greater content): devices on different versions of the
  // application must pick the same one, or they would keep replacing each other's result.
  assert.equal(result.bundle.records.find(value => value.id === record.id).note, '나');
  // The same without a base, and for a source's title.
  assert.equal(content(merged(null, a, b).bundle.records), content(result.bundle.records));
  const source = base.sources[0], rename = title => Core.applyChanges(base, { put: { sources: [{ ...copy(source), title, revision: 2, updatedAt: at }] } });
  const titled = merged(base, rename('가 제목'), rename('나 제목'));
  assert.deepEqual([titled.bundle.sources[0].title, titled.bundle.links.map(link => link.note)].flat(), ['나 제목', '가 제목']);
});

// The winner of a tie takes the other side's file path when it has none. The tie is decided
// without the path, or the merged source would compare differently from the side that won and
// a second merge would turn the title around (found by the review's fuzzing, seed 529).
test('equal times and a file path only one side has: merging the result again with either side changes nothing', async () => {
  const base = await seed(), source = base.sources[0], at = new Date(Date.now() + 5000).toISOString();
  const put = fields => Core.applyChanges(base, { put: { sources: [{ ...copy(source), ...fields, revision: 2, updatedAt: at }] } });
  for (const [a, b] of [[{ title: '가' }, { title: '한글 조합', sourceKey: 'k.md' }], [{ title: '가', sourceKey: 'k.md' }, { title: '한글 조합' }]]) {
    const result = merged(base, put(a), put(b)).bundle; // merged() merges the result again with each side, in both roles
    assert.deepEqual([result.sources[0].title, result.sources[0].sourceKey, result.links.map(link => link.note)], ['한글 조합', 'k.md', ['가']]);
  }
});

test('both sides moved the same excerpt to another range: the recovery copy keeps the losing side\'s own exact range and text', async () => {
  const base = await seed(), record = base.records[0], version = base.sourceVersions[0];
  const move = async (start, end, note) => { await tick(); return Core.applyChanges(base, { put: { records: [{ ...copy(record), text: version.contentText.slice(start, end), note,
    sourceRefs: [{ sourceId: version.sourceId, sourceVersionId: version.id, locator: { start, end } }], revision: 2, updatedAt: new Date().toISOString() }] } }); };
  const first = await move(6, 8, '먼저 옮긴 쪽'), later = await move(9, 12, '나중에 옮긴 쪽');
  const result = merged(base, first, later), [winner, recovery] = result.bundle.records;
  assert.deepEqual([winner.note, winner.sourceRefs[0].locator], ['나중에 옮긴 쪽', { start: 9, end: 12 }]);
  assert.deepEqual([recovery.note, recovery.sourceRefs[0].locator, recovery.text], ['먼저 옮긴 쪽', { start: 6, end: 8 }, version.contentText.slice(6, 8)]);
});

test('a file path only the losing side set is kept on the source; two different paths keep the losing one beside it', async () => {
  const base = await seed(), source = base.sources[0];
  const change = async patch => { await tick(); return Core.applyChanges(base, { put: { sources: [{ ...copy(source), ...patch, revision: 2, updatedAt: new Date().toISOString() }] } }); };
  const keyed = await change({ sourceKey: 'early-file.md' }), renamed = await change({ title: '나중에 바꾼 제목' });
  const one = merged(base, keyed, renamed);
  assert.deepEqual([one.bundle.sources[0].title, one.bundle.sources[0].sourceKey], ['나중에 바꾼 제목', 'early-file.md'], 'the later title, and the only file path there is');
  assert.deepEqual(one.bundle.links.map(link => [link.kind, link.note]), [[PREVIOUS_TITLE, '공통 자료']]);
  const a = await change({ sourceKey: 'a-file.md', title: 'A 제목' }), b = await change({ sourceKey: 'b-file.md', title: 'B 제목(나중)' });
  const two = merged(base, a, b);
  assert.deepEqual([two.bundle.sources[0].title, two.bundle.sources[0].sourceKey], ['B 제목(나중)', 'b-file.md']);
  assert.deepEqual(two.bundle.links.map(link => [link.kind, link.note]).sort(), [[PREVIOUS_KEY, 'a-file.md'], [PREVIOUS_TITLE, 'A 제목']]);
  assert.deepEqual(two.notice.sourceIds, [source.id]);
  for (const link of two.bundle.links) assert.deepEqual(link.sourceRefs, [{ sourceId: source.id, sourceVersionId: base.sourceVersions[0].id, locator: null }]);
});

test('a losing title is one row per source and text, whichever version it is kept beside', async () => {
  const base = await seed(), source = base.sources[0];
  const rename = async (bundle, title) => { await tick(); const current = bundle.sources.find(value => value.id === source.id);
    return Core.applyChanges(bundle, { put: { sources: [{ ...copy(current), title, revision: current.revision + 1, updatedAt: new Date().toISOString() }] } }); };
  // The same title lost on a device that only renamed the source, and on one that had kept a new version first.
  const plain = await rename(base, '진 제목'), versioned = await rename(await newVersion(base, source.id, '중간 제목', '새 본문'), '진 제목');
  const row = async loser => {
    const result = merged(base, loser, await rename(base, '이긴 제목')).bundle; assert.equal(result.sources[0].title, '이긴 제목');
    const rows = result.links.filter(link => link.kind === PREVIOUS_TITLE); assert.deepEqual(rows.map(link => link.note), ['진 제목']); return rows[0];
  };
  const one = await row(plain), two = await row(versioned);
  assert.equal(one.id, two.id, 'devices that meet in another order make the same row');
  assert.deepEqual([one.sourceRefs[0].sourceVersionId, two.sourceRefs[0].sourceVersionId], [base.sourceVersions[0].id, versioned.sourceVersions.at(-1).id],
    'each beside the version that was current when its device renamed the source');
});

// The row's time is the source's creation time, not when the losing device renamed it: two merges
// on other devices that lose the same title at other moments make the very same row, so the rows
// meet as one when those devices sync (11-11 review: a mutation to the losing edit's time survived).
test('a losing title row carries the source\'s creation time: the same title lost at other moments is one identical row', async () => {
  const base = await seed(), source = base.sources[0];
  const rename = async (bundle, title) => { await tick(); const current = bundle.sources.find(value => value.id === source.id);
    return Core.applyChanges(bundle, { put: { sources: [{ ...copy(current), title, revision: current.revision + 1, updatedAt: new Date().toISOString() }] } }); };
  const row = bundle => bundle.links.filter(link => link.kind === PREVIOUS_TITLE && link.note === '진 제목');
  // Phone and Mac meet: the phone's 진 제목 loses. Later iPad and a fourth device meet: the iPad's 진 제목 (renamed later) loses.
  const phone = await rename(base, '진 제목'), mac = await rename(base, '이긴 제목'), ipad = await rename(base, '진 제목'), other = await rename(base, '더 나중 제목');
  assert.notEqual(phone.sources[0].updatedAt, ipad.sources[0].updatedAt);
  const first = merged(base, phone, mac).bundle, second = merged(base, ipad, other).bundle;
  const [one] = row(first), [two] = row(second);
  assert.ok(Date.parse(source.createdAt) < Date.parse(phone.sources[0].updatedAt), 'the source was made before it was renamed');
  assert.deepEqual([one.createdAt, one.updatedAt, row(first).length], [source.createdAt, source.createdAt, 1], 'the row\'s time is when the source was made');
  assert.deepEqual(two, one, 'the same row, whichever merge made it and when the title lost');
  // The two merged workspaces meet (both still against the first base): one such row, exactly as made, and it is not changed again.
  const met = mergeWorkspace({ base: mergeBase(base), local: first, remote: second }).bundle;
  assert.deepEqual(row(met), [one]);
  assert.deepEqual(row(mergeWorkspace({ base: mergeBase(first), local: met, remote: first }).bundle), [one], 'merged again: unchanged');
});

test('both sides added a version without renaming the source: announced, nothing else to keep', async () => {
  const base = await seed(), sourceId = base.sources[0].id;
  const a = await newVersion(base, sourceId, '공통 자료', '한쪽의 새 본문'), b = await newVersion(base, sourceId, '공통 자료', '다른 쪽의 나중 본문');
  const result = merged(base, a, b);
  assert.deepEqual(result.notice, { sourceIds: [sourceId], recordIds: [], restoredIds: [] });
  assert.deepEqual(result.bundle.links, []); assert.equal(result.bundle.sourceVersions.at(-1).contentText, '다른 쪽의 나중 본문');
  // One side only: nothing to announce.
  assert.equal(merged(base, a, await imp(base, '다른 자료', '본문')).notice, null);
});

test('a recovery topic is cut at a whole character and stays text a server stores', async () => {
  assert.equal(wellFormed({ a: ['가😀', { b: '😀' }] }), true);
  assert.equal(wellFormed({ a: ['가\ud83d'] }), false); assert.equal(wellFormed({ a: '\ude00가' }), false); assert.equal(wellFormed({ '\ud83d': 1 }), false);
  for (const lead of [489, 490, 491, 492, 493]) {
    const topic = 'ㄱ'.repeat(lead) + '😀' + 'ㄴ'.repeat(498 - lead); // 500 UTF-16 units; the pair sits around the cut
    let base = Core.createWorkspace({ title: '익명 자료' });
    base = await imp(base, '공통 자료', '공통 본문 첫 줄', [{ start: 0, end: 2, topic, note: '' }]);
    const id = base.records[0].id, a = await editRecord(base, id, { note: 'A 메모' }), b = await editRecord(base, id, { note: 'B 메모(나중)' });
    const recovery = merged(base, a, b).bundle.records[1];
    assert.ok(recovery.topic.startsWith(RECOVERY_TOPIC + ' · ㄱ') && recovery.topic.length <= 500 && recovery.topic.length >= 499, 'lead ' + lead + ': ' + recovery.topic.length);
    assert.equal(wellFormed(recovery.topic), true, 'lead ' + lead);
  }
});

test('a deletion that is not applied is announced; a state row made by a merge keeps its own time and revision', async () => {
  const base = await seed(), id = base.records[0].id, sourceId = base.sources[0].id;
  const kept = merged(base, await removeRecord(base, id), await editRecord(base, id, { note: '다른 기기에서 고친 메모' }));
  assert.deepEqual(kept.notice, { sourceIds: [], recordIds: [], restoredIds: [id] });
  assert.deepEqual(merged(null, await removeRecord(base, id), base).notice.restoredIds, [id], 'without a base nothing is deleted, and that is said');
  // Said once. The base after that merge is the snapshot it merged with, which already counts the
  // excerpt as deleted: meeting the same deletion again (a refused upload, the next server row) is not news.
  const removed = await removeRecord(base, id);
  const again = mergeWorkspace({ base: mergeBase(removed), local: kept.bundle, remote: await imp(removed, '그사이 올라온 자료', '본문') });
  assert.equal(again.notice, null); assert.equal(again.bundle.records.find(record => record.id === id).note, '다른 기기에서 고친 메모');
  // The other device's clock is ten minutes ahead when it adds an excerpt to a source this device trashed.
  const trashed = await setState(base, sourceId, 'trash'), row = trashed.links[0], ahead = new Date(Date.now() + 600000).toISOString();
  const version = base.sourceVersions[0];
  const worked = Core.applyChanges(base, { put: { records: [{ id: Core.id(), kind: 'excerpt', text: version.contentText.slice(6, 8), topic: '', note: '', sourceRefs: [{ sourceId, sourceVersionId: version.id, locator: { start: 6, end: 8 } }],
    provenance: { kind: 'user' }, revision: 1, createdAt: ahead, updatedAt: ahead }] } });
  const revived = merged(base, trashed, worked).bundle, state = revived.links[0];
  assert.deepEqual([state.id, state.kind, state.revision, state.updatedAt], [row.id, 'source_active', 2, row.updatedAt], 'restored as the next state of the same row, at the row\'s own time');
  // This device can move it to the trash again at once (its clock is not behind the row's).
  assert.equal(Core.sourceState(Core.applyChanges(revived, Core.buildSourceStateChanges(revived, sourceId, 'trash')), sourceId).status, 'trash');
  // Both rows of one source and a restore on one device: revisions do not grow with every merge (merged() merges again).
  const also = await setState(base, sourceId, 'trash'), both = merged(base, trashed, also).bundle.links[0];
  assert.deepEqual([both.id, both.revision], [row.id, 2]);
  const restored = await setState(trashed, sourceId, 'active');
  assert.deepEqual(merged(trashed, restored, await imp(trashed, '다른 자료', '본문')).bundle.links.map(link => [link.kind, link.revision]), [['source_active', 2]]);
});

// Three devices and one server row with compare-and-swap, as the engine runs it: a refused upload
// reads the row, merges against the device's last agreed snapshot and sends again.
test('three devices converge on the same workspace under CAS, in any order', async () => {
  const start = await seed(), recordId = start.records[0].id, sourceId = start.sources[0].id;
  async function scenario(order) {
    const server = { revision: 1, data: copy(start) };
    const device = () => ({ local: copy(start), base: copy(start), remoteRevision: 1, synced: start.revision });
    const d = { a: device(), b: device(), c: device() };
    function sync(x) {
      for (let pass = 0; pass < 8; pass++) {
        const dirty = x.local.revision !== x.synced;
        if (!dirty && server.revision === x.remoteRevision) return;
        if (!dirty) { x.local = { ...copy(server.data), revision: x.local.revision + 1 }; x.base = copy(server.data); x.remoteRevision = server.revision; x.synced = x.local.revision; continue; }
        if (server.revision === x.remoteRevision) { server.data = copy(x.local); server.revision++; x.base = copy(x.local); x.remoteRevision = server.revision; x.synced = x.local.revision; continue; }
        const result = mergeWorkspace({ base: mergeBase(x.base), local: x.local, remote: server.data });
        Core.validateWorkspace(result.bundle);
        x.base = copy(server.data); x.remoteRevision = server.revision;
        if (!result.equalsLocal) x.local = { ...copy(result.bundle), revision: x.local.revision + 1 };
        if (result.equalsRemote) x.synced = x.local.revision;
      }
      assert.fail('did not settle');
    }
    d.a.local = await imp(await editRecord(d.a.local, recordId, { note: 'A 메모' }), 'A 자료', 'A 본문');
    d.b.local = await newVersion(await editRecord(d.b.local, recordId, { note: 'B 메모' }), sourceId, 'B 제목', 'B 본문');
    d.c.local = await imp(await removeRecord(d.c.local, recordId), 'C 자료', 'C 본문');
    for (const name of order) sync(d[name]);
    for (const name of ['a', 'b', 'c']) sync(d[name]);
    for (const name of ['a', 'b', 'c']) sync(d[name]);
    for (const name of ['a', 'b', 'c']) assert.equal(content(d[name].local), content(server.data), name + ' holds the server snapshot');
    return server.data;
  }
  const results = [];
  for (const order of [['a', 'b', 'c'], ['c', 'b', 'a'], ['b', 'c', 'a']]) results.push(await scenario(order));
  for (const data of results) {
    assert.deepEqual(titles(data).sort(), ['A 자료', 'B 제목', 'C 자료'].sort());
    assert.equal(data.sourceVersions.length, 4, 'every device\'s exact versions');
    assert.deepEqual(data.tombstones, [], 'the excerpt two devices edited is not deleted by the third');
    assert.deepEqual(data.records.map(record => record.note).sort(), ['A 메모', 'B 메모'], 'the later edit and the other as a recovery copy');
    assert.equal(data.records.filter(record => record.topic.startsWith(RECOVERY_TOPIC)).length, 1);
  }
});

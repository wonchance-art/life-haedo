'use strict';
// Originals merge (SyncCommon.mergeWorkspace): two devices changed the same workspace and meet.
// Pure function only. The storage transaction, the CAS loop and two real devices are covered by
// tests/source-merge-browser.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const Core = require('../assets/life/core.js');
const { mergeWorkspace, mergeBase, replacedSourceLinks, RECOVERY_TOPIC } = require('../assets/life/sync-common.js');
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
// Both directions give the same content, the result is a valid workspace and each side can take it.
function merged(base, a, b) {
  const one = mergeWorkspace({ base: base && mergeBase(base), local: a, remote: b }), other = mergeWorkspace({ base: base && mergeBase(base), local: b, remote: a });
  Core.validateWorkspace(one.bundle);
  assert.equal(content(one.bundle), content(other.bundle), 'the same result whichever device merges');
  assert.deepEqual(one.notice, other.notice);
  for (const side of [a, b]) {
    for (const version of side.sourceVersions) assert.deepEqual(one.bundle.sourceVersions.find(value => value.id === version.id), version, 'every exact version stays');
    const replaced = replacedSourceLinks(side, one.bundle);
    Core.assertSourceLinkPreservation({ ...side, links: side.links.filter(link => !replaced.has(link.id)) }, one.bundle);
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
  assert.deepEqual(result.notice, { sourceIds: [sourceId], recordIds: [] }, 'the earlier body is findable as a previous version');
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
  assert.deepEqual(result.notice, { sourceIds: [], recordIds: [recovery.id] });
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

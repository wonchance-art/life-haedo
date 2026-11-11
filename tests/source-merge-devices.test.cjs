'use strict';
// Originals merge with the real storage.js and the real sync.js on every device (memory IndexedDB,
// one compare-and-swap server row; tests/helpers/sync-devices.cjs). The merge rules themselves:
// tests/source-merge.test.cjs. The storage transaction: tests/life-storage.test.cjs. Two real
// pages: tests/source-merge-browser.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const { Core, createServer, createDevice, content, clone } = require('./helpers/sync-devices.cjs');
const SyncCommon = require('../assets/life/sync-common.js');
const previous = require('./fixtures/source-merge/previous-version-device.json');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { exportRows } = require('./helpers/sync-devices.cjs');
const { COMMIT: PREVIOUS_COMMIT, FILES: PREVIOUS_FILES, previousFile, previousTree } = require('./helpers/previous-version.cjs');
const tick = () => new Promise(resolve => setTimeout(resolve, 3));
const titles = bundle => bundle.sources.map(source => source.title).sort();
const copies = bundle => bundle.records.filter(record => record.topic.startsWith(SyncCommon.RECOVERY_TOPIC));

async function pair(t, excerpts = 2) {
  const server = createServer(), a = createDevice('A', server), b = createDevice('B', server);
  t.after(() => { a.close(); b.close(); });
  await a.login(); await b.login();
  a.ws = (await a.storage.createWorkspace('익명 자료')).workspaceId;
  const bundle = await a.read(), body = '가나다라마바사아자차카타파하 발췌를 위한 본문입니다';
  const prepared = await Core.prepareImport({ origin: 'other', title: '공통 자료', text: body, authorRelation: 'self', forceSeparate: true }, bundle);
  await a.commit(Core.buildImportChanges(bundle, prepared, Array.from({ length: excerpts }, (_, index) => ({ start: index, end: index + 2, topic: '주제', note: '처음 ' + index }))));
  await a.manager.enable(a.ws); b.ws = a.ws; await b.manager.download(a.ws);
  return { server, a, b, ids: (await a.read()).records.map(record => record.id) };
}
async function note(device, id, text) {
  await tick(); const record = (await device.read()).records.find(value => value.id === id);
  return device.commit({ put: { records: [{ ...clone(record), note: text, revision: record.revision + 1, updatedAt: new Date().toISOString() }] } });
}
async function add(device, title, text = title + ' 본문') {
  await tick(); const bundle = await device.read();
  return device.commit(Core.buildImportChanges(bundle, await Core.prepareImport({ origin: 'other', title, text, authorRelation: 'self', forceSeparate: true }, bundle), []));
}
const noteOf = (bundle, id) => bundle.records.find(record => record.id === id)?.note;

// ---- The previous version's files are kept as fixtures: no Git history is read (CI clones one commit) ----
test('the fixtures of the previous version are that commit\'s files (length and SHA-256), and its recorded device data names the same commit', () => {
  assert.deepEqual(Object.keys(PREVIOUS_FILES).sort(), ['account-library.js', 'composition-sync.js', 'storage.js', 'sync-common.js', 'sync-lifecycle.js', 'sync.js', 'ui.js', 'writing-sync.js']);
  for (const name of Object.keys(PREVIOUS_FILES)) assert.equal(Buffer.byteLength(previousFile(name)), PREVIOUS_FILES[name].bytes, name); // previousFile() checks the SHA-256 constant
  assert.ok(PREVIOUS_COMMIT.startsWith(previous.commit));
  assert.match(previousFile('sync-common.js'), /canonical/); assert.doesNotMatch(previousFile('storage.js'), /mergeSyncRemote/);
});

// ---- A device that carries the previous version's data (the fixture was written by that version's code) ----
// The same-number cases: the server item has the number this device started from and another
// device's content. Only content shows who changed what (the device's own older receipts).
for (const fixture of previous.cases) {
  test('a device that changed its workspace on the previous version merges by its commit receipts: ' + fixture.name, async t => {
    const server = createServer(); server.row = clone(fixture.server);
    const device = createDevice('updated', server, { rows: fixture.rows }), mac = createDevice('Mac', server);
    t.after(() => { device.close(); mac.close(); });
    device.ws = mac.ws = fixture.workspaceId;
    assert.equal(device.base(), null, 'the previous version kept no merge base'); assert.equal((await device.state()).status, 'conflict');
    await device.login(); await mac.login(); await mac.manager.download(mac.ws);
    const before = await device.read();
    const result = await device.sync();
    assert.equal(result.status, 'synced'); assert.equal(result.conflict, null);
    assert.equal((await mac.sync()).status, 'synced');
    const final = server.row.data, expected = fixture.expected, id = index => fixture.ids[index];
    assert.equal(content(await device.read()), content(final)); assert.equal(content(await mac.read()), content(final));
    assert.equal(final.records.length, expected.records, 'excerpts on the server');
    assert.equal(copies(final).length, expected.copies, 'recovery copies');
    assert.deepEqual(final.tombstones.map(mark => fixture.ids.indexOf(mark.entityId)).sort(), expected.deleted, 'each device\'s deletions stand');
    for (const [index, text] of Object.entries(expected.notes)) assert.equal(noteOf(final, id(Number(index))), text, 'excerpt ' + index);
    if (expected.copy) assert.equal(copies(final)[0].note, expected.copy);
    if (expected.copyNotes) assert.deepEqual(copies(final).map(record => record.note).sort(), [...expected.copyNotes].sort(), 'what each device wrote and lost is a recovery copy');
    if (expected.sources) assert.equal(final.sources.length, expected.sources);
    if (expected.title) assert.equal(final.sources[0].title, expected.title);
    if (expected.previousTitles) assert.deepEqual(final.links.filter(link => link.kind === SyncCommon.PREVIOUS_TITLE).map(link => link.note).sort(), [...expected.previousTitles].sort(), 'every title that lost is kept');
    for (const version of before.sourceVersions) assert.deepEqual(final.sourceVersions.find(value => value.id === version.id), version);
    const notice = await device.storage.getSyncNotice(device.ws);
    assert.deepEqual([(notice?.recordIds || []).length, (notice?.restoredIds || []).map(value => fixture.ids.indexOf(value)), !!notice?.uncertain], [expected.announced ?? expected.copies, expected.restored, false]);
    assert.equal(device.base().remoteRevision, server.row.revision, 'from here on the device keeps a base');
  });
}

test('a device that already differed keeps no base when it changes again on this version: the receipts still decide', async t => {
  const fixture = previous.cases.find(value => value.name === 'apart'), server = createServer(); server.row = clone(fixture.server);
  const device = createDevice('updated', server, { rows: fixture.rows }); t.after(() => device.close());
  device.ws = fixture.workspaceId; await device.login();
  await note(device, fixture.ids[8], '새 판에서 한 번 더 고친 메모');
  assert.equal(device.base(), null, 'the workspace was not the acknowledged snapshot: it is not a base');
  assert.equal((await device.sync()).status, 'synced');
  const final = server.row.data, expected = fixture.expected;
  assert.deepEqual([final.records.length, copies(final).length, final.tombstones.map(mark => fixture.ids.indexOf(mark.entityId)).sort()], [expected.records, 0, expected.deleted]);
  for (const [index, text] of Object.entries({ ...expected.notes, 8: '새 판에서 한 번 더 고친 메모' })) assert.equal(noteOf(final, fixture.ids[Number(index)]), text, 'excerpt ' + index);
  assert.equal(await device.storage.getSyncNotice(device.ws), null);
});

test('a device that opens this version while equal to the server keeps the base before anything changes, and merges exactly', async t => {
  const { server, a, b, ids } = await pair(t, 3);
  // B as carried over from the previous version: synced, no base record. It is opened (login), nothing else.
  b.rows.get('meta').delete(JSON.stringify('syncBase:' + b.ws));
  const reopened = createDevice('B reopened', server, { rows: Object.fromEntries([...b.rows].map(([name, map]) => [name, [...map]])) }); t.after(() => reopened.close());
  reopened.ws = b.ws; assert.equal(reopened.base(), null);
  const requests = JSON.stringify(server.calls); await reopened.login();
  assert.equal(reopened.base().remoteRevision, server.row.revision, 'kept at opening: no run, no change yet');
  assert.equal(JSON.stringify(server.calls), requests, 'no request was needed for it');
  await note(reopened, ids[0], 'B가 고친 메모'); await reopened.commit({ remove: { records: [ids[1]] } });
  await note(a, ids[2], 'A가 고친 메모'); await a.sync();
  assert.equal((await reopened.sync()).status, 'synced'); await a.sync();
  const final = server.row.data;
  assert.deepEqual(final.records.map(record => record.note), ['B가 고친 메모', 'A가 고친 메모']); assert.equal(copies(final).length, 0);
  assert.deepEqual(final.tombstones.map(mark => mark.entityId), [ids[1]]);
  assert.equal(await reopened.storage.getSyncNotice(reopened.ws), null);
});

// ---- The base across a refused upload and an upload in flight (the two silent-loss paths) ----
test('a merge whose upload is refused merges again against the server row it had merged with: this device\'s edit stays', async t => {
  const { server, a, b, ids } = await pair(t);
  await note(b, ids[0], 'B가 고친 메모'); await add(a, 'A 자료'); await a.sync();
  let moves = 1;
  server.beforeWrite = async device => { if (device === b && moves-- > 0) { await note(a, ids[1], 'A가 다른 발췌를 고침'); server.beforeWrite = null; await a.sync(); } };
  assert.equal((await b.sync()).status, 'synced'); await a.sync();
  assert.equal(server.calls.refused, 1, 'the first upload of the merged snapshot was refused');
  const final = server.row.data;
  assert.deepEqual([noteOf(final, ids[0]), noteOf(final, ids[1])], ['B가 고친 메모', 'A가 다른 발췌를 고침']);
  assert.equal(copies(final).length, 0); assert.deepEqual(titles(final), ['A 자료', '공통 자료']);
  assert.equal(content(await a.read()), content(final)); assert.equal(content(await b.read()), content(final));
});

test('an edit made while an upload is on its way is not taken for part of what was acknowledged', async t => {
  const { server, a, b, ids } = await pair(t);
  await add(b, 'B 자료');
  // B's first upload is on its way when B edits an excerpt; the run sends that edit next, and A stores
  // first. The base of B's merge is what the server acknowledged (without the edit), so the edit counts
  // as B's change. Were the base B's snapshot at the acknowledgement, the edit would look unchanged and
  // A's older note would replace it.
  let writes = 0;
  server.beforeWrite = async device => {
    if (device !== b) return;
    if (++writes === 1) await note(b, ids[0], '보내는 동안 B가 고친 메모');
    else if (writes === 2) { assert.equal(noteOf(server.row.data, ids[0]), '처음 0'); await a.sync(); await note(a, ids[1], 'A가 다른 발췌를 고침'); await a.sync(); }
  };
  assert.equal((await b.sync()).status, 'synced'); server.beforeWrite = null; await a.sync();
  assert.deepEqual([writes, server.calls.refused], [3, 1], 'upload, refused upload of the edit, upload of the merge');
  const final = server.row.data;
  assert.deepEqual([noteOf(final, ids[0]), noteOf(final, ids[1])], ['보내는 동안 B가 고친 메모', 'A가 다른 발췌를 고침']);
  assert.equal(copies(final).length, 0); assert.equal(content(await a.read()), content(final)); assert.equal(content(await b.read()), content(final));
});

// ---- What still reaches the manual comparison, by its real cause ----
test('a merged snapshot over the size limit is recorded for the comparison, costs no further download, and the manual choice still works', async t => {
  const { server, a, b } = await pair(t, 0);
  // Nine originals of 1 MB on each device, saved by one commit each: 18 MB together.
  const big = async (device, label) => {
    const bundle = await device.read(), put = {};
    for (let index = 0; index < 9; index++) {
      const prepared = await Core.prepareImport({ origin: 'other', title: label + ' 큰 자료 ' + index, text: (label + index + ' ').padEnd(1000 * 1000, 'x'), authorRelation: 'self', forceSeparate: true }, bundle);
      for (const [name, items] of Object.entries(Core.buildImportChanges(bundle, prepared, []).put)) put[name] = (put[name] || []).concat(items);
    }
    await device.commit({ put });
  };
  await big(a, 'A'); await big(b, 'B'); await a.sync();
  const before = content(await b.read()), written = server.calls.write;
  const result = await b.sync();
  assert.equal(result.status, 'conflict'); assert.equal(result.conflict.missing, false);
  assert.equal(content(await b.read()), before); assert.equal(server.calls.write, written, 'nothing was sent');
  const reads = server.calls.read, heads = server.calls.head;
  for (let run = 0; run < 2; run++) assert.equal((await b.sync({ headIfClean: run === 0 })).status, 'conflict');
  assert.deepEqual([server.calls.read - reads, server.calls.head - heads], [0, 2], 'later runs ask for the revision only');
  const choice = await b.manager.resolve(b.ws, 'remote');
  assert.ok(choice.copyWorkspaceId); assert.equal((await b.state()).status, 'synced'); assert.equal((await b.read()).sources.length, 10);
  assert.equal((await b.storage.read(choice.copyWorkspaceId)).sources.length, 10, 'this device\'s side is kept as a copy');
});

test('a merged snapshot the server would refuse (half of a surrogate pair in a note) is recorded for the comparison and nothing is written', async t => {
  const { server, a, b, ids } = await pair(t);
  await note(b, ids[0], '끊긴 글자 \ud83d'); await add(a, 'A 자료'); await a.sync();
  const before = content(await b.read()), written = server.calls.write;
  const result = await b.sync();
  assert.equal(result.status, 'conflict'); assert.equal(result.conflict.missing, false);
  assert.equal(content(await b.read()), before); assert.equal(server.calls.write, written);
  // Once the note is whole again the same device merges by itself.
  await note(b, ids[0], '고친 글자 \ud83d\ude00');
  assert.equal((await b.sync()).status, 'synced');
  assert.deepEqual([noteOf(server.row.data, ids[0]), titles(server.row.data)], ['고친 글자 \ud83d\ude00', ['A 자료', '공통 자료']]);
});

// History rows are never dropped by a receive. A server row that lacks one of this device's
// (two devices each marked the same exact version as an edited copy: no product path does this)
// ends the run with an error; this device's data and the server are untouched.
test('a server row that lacks this device\'s edit history stops the run without writing anything', async t => {
  const { server, a, b } = await pair(t);
  const version = (await a.read()).sourceVersions[0];
  const mark = () => ({ id: Core.id(), kind: 'source_edited_copy', entityRefs: [{ entityType: 'sourceVersion', entityId: version.id }], revision: 1, createdAt: version.importedAt, updatedAt: version.importedAt });
  await a.commit({ put: { links: [mark()] } }); await b.commit({ put: { links: [mark()] } }); await a.sync();
  const before = content(await b.read()), written = server.calls.write, row = JSON.stringify(server.row);
  assert.deepEqual(await b.sync(), { error: 'source_history_missing' });
  assert.equal(content(await b.read()), before); assert.equal(server.calls.write, written); assert.equal(JSON.stringify(server.row), row);
});

test('a deleted server copy is recorded as missing: never merged, never created again', async t => {
  const { server, a, b } = await pair(t);
  await add(b, 'B 자료'); server.row = null;
  const result = await b.sync();
  assert.equal(result.conflict.missing, true); assert.equal(server.row, null); assert.equal(server.calls.stored, 1, 'only the first upload of A');
  assert.equal((await b.sync()).conflict.missing, true); assert.equal(server.row, null);
});

test('a page that still runs the previous shared module records the difference; with this version\'s module the same device merges', async t => {
  const { server, a, b } = await pair(t);
  // The module file of the commit before the merge, as a cache that kept it would hand it to a newer page.
  const module_ = { exports: {} };
  new Function('module', 'globalThis', previousFile('sync-common.js'))(module_, {});
  assert.deepEqual(Object.keys(module_.exports), ['canonical']);
  const mixed = createDevice('B with the previous module', server, { rows: Object.fromEntries([...b.rows].map(([name, map]) => [name, [...map]])), syncCommon: module_.exports });
  t.after(() => mixed.close()); mixed.ws = b.ws; await mixed.login();
  await add(mixed, '이 페이지 자료'); await add(a, '다른 기기 자료'); await a.sync();
  const written = server.calls.write;
  assert.equal((await mixed.sync()).status, 'conflict'); assert.equal(mixed.base(), null);
  assert.equal(server.calls.write, written); assert.deepEqual(titles(await mixed.read()), ['공통 자료', '이 페이지 자료']);
  // After a reload the page has this version's module: the recorded difference is merged (by the commit receipt, no base was kept).
  const reloaded = createDevice('B reloaded', server, { rows: Object.fromEntries([...mixed.rows].map(([name, map]) => [name, [...map]])) }); t.after(() => reloaded.close());
  reloaded.ws = b.ws; await reloaded.login();
  assert.equal((await reloaded.sync()).status, 'synced');
  assert.deepEqual(titles(server.row.data), ['공통 자료', '다른 기기 자료', '이 페이지 자료']);
});

// ---- Random interleavings, fixed seeds: nothing a person wrote disappears without a copy ----
function random(seed) { let state = seed >>> 0; return n => { state = Math.imul(state ^ state >>> 15, 0x2c1b3c6d) + 0x9e3779b9 | 0; return ((state ^ state >>> 13) >>> 0) % n; }; }
test('random edits and syncs on three devices: every note survives (on its excerpt or as a recovery copy), every exact version stays, all devices converge', async t => {
  for (let seed = 1; seed <= 120; seed++) {
    const next = random(seed), server = createServer();
    const devices = ['A', 'B', 'C'].map(name => createDevice(name + seed, server));
    try {
      for (const device of devices) await device.login();
      const [first] = devices; first.ws = (await first.storage.createWorkspace('익명 자료')).workspaceId;
      const body = '가나다라마바사아자차카타파하 발췌를 위한 본문입니다', start = await first.read();
      await first.commit(Core.buildImportChanges(start, await Core.prepareImport({ origin: 'other', title: '공통 자료', text: body, authorRelation: 'self', forceSeparate: true }, start),
        Array.from({ length: 4 }, (_, index) => ({ start: index, end: index + 2, topic: '주제', note: '처음 ' + index }))));
      await first.manager.enable(first.ws);
      for (const device of devices.slice(1)) { device.ws = first.ws; await device.manager.download(first.ws); }
      // written: every note a device wrote (each text once). replaced: note texts a device overwrote or
      // deleted while it held them, on the excerpt or on its recovery copy.
      const written = [], replaced = new Set(), versions = new Map();
      let stamp = Date.now(), serial = 0;
      for (let step = 0; step < 28; step++) {
        const device = devices[next(3)], bundle = await device.read(), kind = next(10);
        stamp += [0, 1, 1000][next(3)];
        if (kind < 4 && bundle.records.length) {
          const record = bundle.records[next(bundle.records.length)], text = seed + '-' + (++serial);
          replaced.add(record.note); written.push({ id: record.id, note: text, text: record.text });
          await device.commit({ put: { records: [{ ...clone(record), note: text, revision: record.revision + 1, updatedAt: new Date(stamp).toISOString() }] } });
        } else if (kind === 4 && bundle.records.length) {
          const record = bundle.records[next(bundle.records.length)];
          replaced.add(record.note); await device.commit({ remove: { records: [record.id] } });
        } else if (kind === 5) {
          const prepared = await Core.prepareImport({ origin: 'other', title: '자료 ' + (++serial), text: '본문 ' + serial, authorRelation: 'self', forceSeparate: true }, bundle);
          await device.commit(Core.buildImportChanges(bundle, prepared, [])); versions.set(prepared.version.id, prepared.version.contentText);
        } else if (kind === 6) {
          const source = bundle.sources[next(bundle.sources.length)];
          if (Core.isSourceActive(bundle, source.id)) {
            const prepared = await Core.prepareImport({ origin: 'other', title: source.title + '′', text: '새 판 ' + (++serial), authorRelation: 'self', existingSourceId: source.id }, bundle);
            await device.commit(Core.buildImportChanges(bundle, prepared, [])); versions.set(prepared.version.id, prepared.version.contentText);
          }
        } else if (kind === 7) {
          const source = bundle.sources[next(bundle.sources.length)];
          await device.commit(Core.buildSourceStateChanges(bundle, source.id, Core.isSourceActive(bundle, source.id) ? 'trash' : 'active'));
        } else {
          // A run; sometimes another device stores first, between this device's read and its upload.
          if (next(4) === 0) { const other = devices[next(3)]; server.beforeWrite = async who => { if (who === device && other !== device) { server.beforeWrite = null; await other.sync(); } }; }
          const result = await device.sync(); server.beforeWrite = null;
          assert.ok(!result.error && !result.conflict, 'seed ' + seed + ' step ' + step + ': ' + JSON.stringify(result.error || result.status));
        }
      }
      for (let round = 0; round < 4; round++) for (const device of devices) { const result = await device.sync(); assert.ok(!result.error && !result.conflict, 'seed ' + seed + ' settle: ' + JSON.stringify(result.error || result.status)); }
      const final = server.row.data; Core.validateWorkspace(final);
      for (const device of devices) assert.equal(content(await device.read()), content(final), 'seed ' + seed + ': ' + device.name + ' holds the server snapshot');
      for (const [id, text] of versions) assert.equal(final.sourceVersions.find(version => version.id === id)?.contentText, text, 'seed ' + seed + ': an exact version is gone');
      for (const entry of written) {
        if (replaced.has(entry.note)) continue;
        const kept = final.records.some(record => record.note === entry.note && (record.id === entry.id || record.topic.startsWith(SyncCommon.RECOVERY_TOPIC) && record.text === entry.text));
        assert.ok(kept, 'seed ' + seed + ': the note "' + entry.note + '" nobody replaced is gone');
      }
    } finally { for (const device of devices) device.close(); }
  }
});

// ---- Devices that diverged on the previous version (its real storage and engine wrote their
// receipts), random edits, fixed seeds. The same starting state is settled on this version twice:
//   receipts: as the application does it (no stored base, the commit receipts decide);
//   truth:    each device is handed the server snapshot it last agreed on as its stored base.
// The receipts may keep more than the true base (a deletion they cannot confirm, a recovery copy
// of text the device had in fact seen). They must never keep less or choose another winner.
test('devices that diverged on the previous version: merging by receipts never keeps less than the true base', async t => {
  const old = previousTree(fs.mkdtempSync(path.join(os.tmpdir(), 'haedo-previous-')));
  t.after(() => fs.rmSync(old, { recursive: true, force: true }));
  const facts = record => JSON.stringify([record.text, record.topic, record.note, record.sourceRefs]);
  let merged = 0;
  async function settle(snapshot, truth) {
    const server = createServer(); server.row = clone(snapshot.row); server.receipts = new Map(snapshot.receipts); server.history = snapshot.history;
    const devices = [];
    try {
      for (const saved of snapshot.devices) {
        const rows = clone(saved.rows);
        if (truth && saved.old) {
          const state = rows.meta.find(([, row]) => row.key === 'sync:' + snapshot.ws)?.[1].value, agreed = state && state.remoteRevision >= 1 && state.syncedLocalRevision >= 0 && snapshot.history.get(state.remoteRevision);
          if (agreed) rows.meta.push([JSON.stringify('syncBase:' + snapshot.ws), { key: 'syncBase:' + snapshot.ws, value: { format: 'life-sync-base-v1', remoteRevision: state.remoteRevision, base: SyncCommon.mergeBase(agreed), notice: null } }]);
        }
        const device = createDevice(saved.name, server, { rows }); device.ws = snapshot.ws; devices.push(device); await device.login();
      }
      for (let round = 0; round < 6; round++) for (const device of devices) { const result = await device.sync(); assert.ok(!result.error && !result.conflict, 'settle: ' + JSON.stringify(result.error || result.status)); }
      const final = server.row.data; Core.validateWorkspace(final);
      for (const device of devices) assert.equal(content(await device.read()), content(final), device.name + ' holds the server snapshot');
      return final;
    } finally { for (const device of devices) device.close(); }
  }
  for (let seed = 1; seed <= 36; seed++) {
    const next = random(seed * 7919), server = createServer();
    // Device 0 runs this version (its merges move the server meanwhile); the others the previous one.
    const devices = [createDevice('new', server), createDevice('previous 1', server, { tree: old }), createDevice('previous 2', server, { tree: old })];
    let snapshot;
    try {
      for (const device of devices) await device.login();
      const [first] = devices; first.ws = (await first.storage.createWorkspace('익명 자료')).workspaceId;
      const start = await first.read(), body = '가나다라마바사아자차카타파하 발췌를 위한 본문입니다';
      await first.commit(Core.buildImportChanges(start, await Core.prepareImport({ origin: 'other', title: '공통 자료', text: body, authorRelation: 'self', forceSeparate: true }, start),
        Array.from({ length: 5 }, (_, index) => ({ start: index, end: index + 2, topic: '주제', note: '처음 ' + index }))));
      await first.manager.enable(first.ws);
      for (const device of devices.slice(1)) { device.ws = first.ws; await device.manager.download(first.ws); }
      let stamp = Date.now(), serial = 0;
      for (let step = 0; step < 26; step++) {
        const device = devices[next(3)], bundle = await device.read(), kind = next(10), at = new Date(stamp += [1, 1, 1000][next(3)]).toISOString();
        if (kind < 4 && bundle.records.length) {
          const record = bundle.records[next(bundle.records.length)];
          await device.commit({ put: { records: [{ ...clone(record), note: seed + '-' + (++serial), revision: record.revision + 1, updatedAt: at }] } });
        } else if (kind === 4 && bundle.records.length) {
          await device.commit({ remove: { records: [bundle.records[next(bundle.records.length)].id] } });
        } else if (kind === 5) {
          const source = bundle.sources[0];
          await device.commit({ put: { sources: [{ ...clone(source), title: '제목 ' + seed + '-' + (++serial), revision: source.revision + 1, updatedAt: at }] } });
        } else await device.sync();          // a device on the previous version stops at a difference and waits
      }
      snapshot = { ws: first.ws, row: clone(server.row), receipts: new Map(server.receipts), history: server.history,
        devices: devices.map((device, index) => ({ name: device.name, old: index > 0, rows: exportRows(device.rows) })) };
    } finally { for (const device of devices) device.close(); }
    const receipts = await settle(snapshot, false), truth = await settle(snapshot, true);
    if (content(receipts) !== content(truth)) merged++;
    const mine = new Map(receipts.records.map(record => [record.id, record]));
    for (const record of truth.records) {
      assert.ok(mine.has(record.id), 'seed ' + seed + ': the true base keeps ' + JSON.stringify([record.topic, record.note]) + ', the receipts do not');
      assert.equal(facts(mine.get(record.id)), facts(record), 'seed ' + seed + ': another winner than with the true base');
    }
    assert.equal(receipts.sources[0].title, truth.sources[0].title, 'seed ' + seed + ': another title than with the true base');
    const rows = new Set(receipts.links.map(link => link.id));
    for (const link of truth.links) if ([SyncCommon.PREVIOUS_TITLE, SyncCommon.PREVIOUS_KEY].includes(link.kind)) assert.ok(rows.has(link.id), 'seed ' + seed + ': the title that lost (' + link.note + ') is kept with the true base only');
  }
  assert.ok(merged > 0, 'some seeds must reach a case where the receipts keep more');
});

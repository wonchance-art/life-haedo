'use strict';
// Writes previous-version-device.json: the database of a device that changed its workspace on the
// version before the originals merge (commit a423773, which recorded a conflict and waited for a
// manual choice and stored no merge base), together with the server row it then met.
// The device runs that commit's own storage.js and sync.js, so its sync record and its commit
// receipts are exactly what a real device carries into this version.
// That commit's files are read from the fixtures beside this file (a423773/, checked by SHA-256):
// no Git history is needed.
//   node tests/fixtures/source-merge/make-previous-version-device.cjs [output.json]
// Anonymous sample text only. tests/source-merge-devices.test.cjs loads the result.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { ROOT, Core, createServer, createDevice, exportRows, clone } = require('../../helpers/sync-devices.cjs');
const { COMMIT: FULL, previousTree } = require('../../helpers/previous-version.cjs');
const COMMIT = FULL.slice(0, 7);
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

// current: the Mac runs this version (it merges by itself; the server row is what the iPad then meets).
async function scenario(name, old, run, { current = false } = {}) {
  const server = createServer(), device = createDevice('iPad on ' + COMMIT, server, { tree: old }), mac = createDevice('Mac', server, current ? {} : { tree: old });
  try {
    await device.login(); await mac.login();
    const workspace = await mac.storage.createWorkspace('익명 자료'); mac.ws = workspace.workspaceId;
    const body = '가나다라마바사아자차카타파하 열 개의 발췌를 위한 본문입니다';
    const prepared = await Core.prepareImport({ origin: 'other', title: '공통 자료', text: body, authorRelation: 'self', forceSeparate: true }, await mac.read());
    await mac.commit(Core.buildImportChanges(await mac.read(), prepared, Array.from({ length: 10 }, (_, index) => ({ start: index, end: index + 2, topic: '주제', note: '처음 ' + index }))));
    await mac.manager.enable(mac.ws); device.ws = mac.ws; await device.manager.download(mac.ws);
    const ids = (await mac.read()).records.map(record => record.id);
    const note = async (who, index, text) => { await tick(); const record = (await who.read()).records.find(value => value.id === ids[index]);
      await who.commit({ put: { records: [{ ...clone(record), note: text, revision: record.revision + 1, updatedAt: new Date().toISOString() }] } }); };
    const remove = async (who, index) => { await tick(); await who.commit({ remove: { records: [ids[index]] } }); };
    const add = async (who, title) => { await tick(); const bundle = await who.read();
      await who.commit(Core.buildImportChanges(bundle, await Core.prepareImport({ origin: 'other', title, text: title + ' 본문', authorRelation: 'self', forceSeparate: true }, bundle), [])); };
    const rename = async (who, title) => { await tick(); const source = (await who.read()).sources[0];
      await who.commit({ put: { sources: [{ ...clone(source), title, revision: source.revision + 1, updatedAt: new Date().toISOString() }] } }); };
    const expected = await run({ device, mac, note, remove, add, rename, ids });
    const first = await device.sync();
    if (first.status !== 'conflict' || device.base()) throw new Error(name + ': the previous version should record a conflict and keep no base');
    return { name, workspaceId: device.ws, ids, expected, rows: exportRows(device.rows), server: clone(server.row) };
  } finally { device.close(); mac.close(); }
}

(async () => {
  const old = previousTree(fs.mkdtempSync(path.join(os.tmpdir(), 'haedo-' + COMMIT + '-')));
  const cases = [];
  // The reviewer's case: no excerpt was changed on both devices.
  cases.push(await scenario('apart', old, async ({ device, mac, note, remove }) => {
    await note(device, 0, 'iPad에서 고친 메모'); await remove(device, 1);
    for (let index = 2; index <= 6; index++) await note(mac, index, 'Mac에서 고친 메모 ' + index);
    await remove(mac, 7); await mac.sync();
    return { records: 8, copies: 0, deleted: [1, 7], restored: [], notes: { 0: 'iPad에서 고친 메모', 2: 'Mac에서 고친 메모 2', 6: 'Mac에서 고친 메모 6', 8: '처음 8' } };
  }));
  // Everything a receipt has to decide: a real double edit, a deletion of an excerpt the other device
  // edited, a deletion of an excerpt this device itself had edited before, additions on both.
  cases.push(await scenario('mixed', old, async ({ device, mac, note, remove, add }) => {
    await note(device, 9, 'iPad가 먼저 고쳐 올린 메모'); await device.sync(); await mac.sync();   // agreed by both before they part
    await note(device, 0, 'iPad에서 고친 메모'); await remove(device, 1); await note(device, 6, 'iPad도 고친 메모'); await remove(device, 8); await remove(device, 9);
    await add(device, 'iPad에서 가져온 자료');
    for (let index = 2; index <= 6; index++) await note(mac, index, 'Mac에서 고친 메모 ' + index);
    await remove(mac, 7); await note(mac, 8, 'iPad가 지운 발췌를 Mac이 고침'); await add(mac, 'Mac에서 가져온 자료'); await mac.sync();
    return { records: 8, copies: 1, deleted: [1, 7, 9], restored: [8], sources: 3,
      notes: { 0: 'iPad에서 고친 메모', 2: 'Mac에서 고친 메모 2', 6: 'Mac에서 고친 메모 6', 8: 'iPad가 지운 발췌를 Mac이 고침' }, copy: 'iPad도 고친 메모' };
  }));
  // Two devices changed the same item from the same revision: both changes carry the same number.
  // The iPad sent its first edit (2), the Mac edited without having received it (2, merged: the
  // Mac's later edit stays on the server under 2), and the iPad changed the item again, unsent.
  const first = async ({ device, mac, note }) => { await note(device, 0, 'iPad 1차 메모'); await device.sync(); await note(mac, 0, 'Mac이 동시에 고친 메모'); await mac.sync(); };
  cases.push(await scenario('same-number-edit', old, async tools => {
    await first(tools); await tools.note(tools.device, 0, 'iPad 2차 메모');
    return { records: 12, copies: 2, announced: 1, copyNotes: ['Mac이 동시에 고친 메모', 'iPad 1차 메모'], deleted: [], restored: [], notes: { 0: 'iPad 2차 메모', 1: '처음 1' } };
  }, { current: true }));
  cases.push(await scenario('same-number-edit-then-delete', old, async tools => {
    await first(tools); await tools.note(tools.device, 0, 'iPad 2차 메모'); await tools.remove(tools.device, 0);
    return { records: 11, copies: 1, announced: 0, copyNotes: ['iPad 1차 메모'], deleted: [], restored: [0], notes: { 0: 'Mac이 동시에 고친 메모' } };
  }, { current: true }));
  cases.push(await scenario('same-number-delete-only', old, async tools => {
    await first(tools); await tools.remove(tools.device, 0);
    return { records: 11, copies: 1, announced: 0, copyNotes: ['iPad 1차 메모'], deleted: [], restored: [0], notes: { 0: 'Mac이 동시에 고친 메모' } };
  }, { current: true }));
  cases.push(await scenario('same-number-title', old, async ({ device, mac, rename }) => {
    await rename(device, 'iPad 1차 제목'); await device.sync(); await rename(mac, 'Mac 제목'); await mac.sync(); await rename(device, 'iPad 2차 제목');
    return { records: 10, copies: 0, deleted: [], restored: [], notes: { 0: '처음 0' }, title: 'iPad 2차 제목', previousTitles: ['Mac 제목', 'iPad 1차 제목'] };
  }, { current: true }));
  const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'previous-version-device.json');
  fs.writeFileSync(file, JSON.stringify({ commit: COMMIT, note: 'Generated by make-previous-version-device.cjs from that commit\'s storage.js and sync.js. Anonymous sample text.', cases }, null, 1) + '\n');
  console.log('wrote', path.relative(ROOT, file), cases.map(value => value.name + ':' + value.rows.operations.length + ' receipts').join(', '));
  fs.rmSync(old, { recursive: true, force: true });
})().catch(error => { console.error(error.stack); process.exitCode = 1; });

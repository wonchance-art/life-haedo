'use strict';
// The originals' state without its snapshots (storage.getSyncSummary, sync.getState({ light: true }),
// 2026-11-12): in every state it says what the full read says, minus the waiting request's data and
// the recorded server row; it stops on the same damaged records; it reads no workspace; and the
// engine still sends exactly the stored request. Real storage.js and sync.js over a memory
// IndexedDB and one CAS server row (tests/helpers/sync-devices.cjs). The time it saves on a large
// library in Chromium: tests/sync-state-read-performance-browser.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const { Core, CONFIG, createServer, createDevice, memoryIdb, clone } = require('./helpers/sync-devices.cjs');
const { createStorage } = require('../assets/life/storage.js');

const project = full => full && { ...full, binding: { ...full.binding },
  outbox: full.outbox && { operationId: full.outbox.operationId, expectedRevision: full.outbox.expectedRevision, localRevision: full.outbox.localRevision },
  conflict: full.conflict && { missing: full.conflict.missing, remoteRevision: full.conflict.remoteRevision, localRevision: full.conflict.localRevision } };
const binding = ws => ({ projectUrl: CONFIG.url, userId: 'a', remoteId: ws });
async function add(device, title) {
  const bundle = await device.read();
  return device.commit(Core.buildImportChanges(bundle, await Core.prepareImport({ origin: 'other', title, text: title + ' 본문입니다', authorRelation: 'self', forceSeparate: true }, bundle), []));
}
// Storage, engine (full) and engine (light) agree; the light forms carry no snapshot.
async function same(device, label) {
  const full = await device.storage.getSyncState(device.ws), light = await device.storage.getSyncSummary(device.ws);
  assert.deepEqual(light, project(full), label + ': storage');
  if (light) { assert.equal(Object.hasOwn(light.outbox || {}, 'data'), false); assert.equal(Object.hasOwn(light.conflict || {}, 'row'), false); }
  const engine = await device.manager.getState(device.ws), engineLight = await device.manager.getState(device.ws, { light: true });
  assert.deepEqual(engineLight, { ...engine, conflict: engine.conflict && { missing: engine.conflict.missing, remoteRevision: engine.conflict.remoteRevision, localRevision: engine.conflict.localRevision } }, label + ': engine');
  return { full, light, engine: engineLight };
}

test('the summary is the full state without its snapshots, in every state the originals pass through', async t => {
  const server = createServer(), a = createDevice('A', server), b = createDevice('B', server);
  t.after(() => { a.close(); b.close(); });
  await a.login(); await b.login();
  a.ws = (await a.storage.createWorkspace('익명 자료')).workspaceId; await add(a, '첫 자료');
  assert.equal((await same(a, 'not connected')).light, null);
  await a.manager.enable(a.ws); b.ws = a.ws; await b.manager.download(a.ws);
  assert.equal((await same(a, 'synced')).engine.status, 'synced');
  await add(a, '올리기 전 자료');
  assert.equal((await same(a, 'changed here')).engine.status, 'pending');
  // A request that could not be sent stays stored (and is sent as stored, below).
  server.beforeWrite = () => { throw Object.assign(new Error('offline'), { code: 'network_error' }); };
  assert.equal((await a.sync()).error, 'network_error');
  const waiting = await same(a, 'request waiting, error recorded');
  assert.ok(waiting.full.outbox?.data && waiting.light.outbox.operationId === waiting.full.outbox.operationId);
  assert.equal(waiting.engine.status, 'error');
  // A recorded difference with the server's copy, then a deleted server copy.
  server.beforeWrite = null;
  const row = { id: a.ws, title: server.row.title, revision: server.row.revision + 1, data: { ...clone(server.row.data), title: server.row.title }, updated_at: '2026-11-12T00:00:00Z' };
  await a.storage.setSyncConflict(a.ws, binding(a.ws), row);
  const recorded = await same(a, 'difference recorded');
  assert.equal(recorded.full.conflict.row.revision, row.revision); assert.equal(recorded.engine.status, 'conflict');
  assert.deepEqual(recorded.light.conflict, { missing: false, remoteRevision: row.revision, localRevision: (await a.read()).revision });
  await a.storage.setSyncConflict(a.ws, binding(a.ws), null);
  assert.equal((await same(a, 'server copy deleted')).light.conflict.missing, true);
  await a.manager.pause(a.ws);
  assert.equal((await same(a, 'paused')).engine.status, 'paused');
  await same(b, 'the other device, synced');
});

test('a waiting request is sent exactly as stored when the run starts from the summary', async t => {
  const server = createServer(), a = createDevice('A', server); t.after(() => a.close());
  await a.login(); a.ws = (await a.storage.createWorkspace('익명 자료')).workspaceId; await add(a, '첫 자료');
  await a.manager.enable(a.ws); await add(a, '두 번째 자료');
  const sent = [];
  server.beforeWrite = (_device, request) => { sent.push(clone(request)); if (sent.length === 1) throw Object.assign(new Error('offline'), { code: 'network_error' }); };
  assert.equal((await a.sync()).error, 'network_error');
  const stored = (await a.storage.getSyncState(a.ws)).outbox;
  await add(a, '기다리는 동안 저장한 자료');
  assert.equal((await a.sync()).status, 'synced');
  assert.deepEqual([sent[1].operationId, sent[1].expectedRevision, sent[1].data], [stored.operationId, stored.expectedRevision, stored.data], 'the stored request, not a new snapshot');
  assert.equal(server.row.data.sources.length, 3, 'the later save followed in the next request');
  assert.equal((await a.storage.getSyncSummary(a.ws)).status, 'synced');
});

test('the summary reads no workspace and stops on the same damaged or foreign records as the full read', async t => {
  const adapter = memoryIdb(), counts = { bundles: 0 };
  const openDB = adapter.idb.openDB;
  adapter.idb.openDB = async (...args) => {
    const db = await openDB(...args), transaction = db.transaction.bind(db);
    db.transaction = (names, mode) => {
      const tx = transaction(names, mode), objectStore = tx.objectStore;
      tx.objectStore = name => { const store = objectStore(name); if (name !== 'bundles') return store; return { ...store, get: key => { counts.bundles++; return store.get(key); }, getAll: () => { counts.bundles++; return store.getAll(); } }; };
      return tx;
    };
    return db;
  };
  const storage = createStorage({ idb: adapter.idb, core: Core, channelFactory: null }); t.after(() => storage.close());
  const ws = (await storage.createWorkspace('익명 자료')).workspaceId;
  await storage.bindSync(ws, binding(ws));
  counts.bundles = 0; assert.equal((await storage.getSyncSummary(ws)).status, 'pending'); assert.equal(counts.bundles, 0, 'no workspace read');
  await storage.getSyncState(ws); assert.equal(counts.bundles, 1, 'the full read reads it');
  await assert.rejects(storage.getSyncSummary(Core.id()), { code: 'workspace_not_found' });
  await assert.rejects(storage.getSyncState(Core.id()), { code: 'workspace_not_found' });
  const meta = adapter.rows.get('meta'), key = JSON.stringify(`sync:${ws}`), good = clone(meta.get(key));
  const damaged = async (label, value) => {
    meta.set(key, { key: `sync:${ws}`, value });
    await assert.rejects(storage.getSyncSummary(ws), { code: 'invalid_sync_metadata' }, label + ': summary');
    await assert.rejects(storage.getSyncState(ws), { code: 'invalid_sync_metadata' }, label + ': full');
  };
  await damaged('a record without its fields', { enabled: true });
  await damaged('a status that contradicts the record', { ...good.value, status: 'conflict' });
  const bundle = await storage.read(ws);
  await damaged('a request for another workspace', { ...good.value, outbox: { operationId: Core.id(), expectedRevision: 0, localRevision: bundle.revision, data: { ...clone(bundle), workspaceId: Core.id() } } });
  await damaged('a request whose revision is not its snapshot\'s', { ...good.value, outbox: { operationId: Core.id(), expectedRevision: 0, localRevision: bundle.revision, data: { ...clone(bundle), revision: bundle.revision + 3 } } });
  const row = { id: ws, title: bundle.title, revision: 2, data: clone(bundle) };
  await damaged('a recorded row of another revision', { ...good.value, status: 'conflict', conflict: { missing: false, row, remoteRevision: 3, localRevision: bundle.revision } });
  await damaged('a recorded row of another workspace', { ...good.value, status: 'conflict', conflict: { missing: false, row: { ...row, id: Core.id() }, remoteRevision: 2, localRevision: bundle.revision } });
  // The one difference, by design: the content of a carried snapshot is checked by the paths that use it.
  meta.set(key, { key: `sync:${ws}`, value: { ...good.value, status: 'conflict', conflict: { missing: false, row: { ...row, data: { ...row.data, sources: 'damaged' } }, remoteRevision: 2, localRevision: bundle.revision } } });
  assert.equal((await storage.getSyncSummary(ws)).status, 'conflict');
  await assert.rejects(storage.getSyncState(ws), { code: 'invalid_sync_metadata' });
  await assert.rejects(storage.setSyncConflict(ws, binding(ws), null), { code: 'invalid_sync_metadata' }, 'writing over it stops');
  meta.set(key, good);
  // Another account sees neither form.
  const other = createStorage({ idb: adapter.idb, core: Core, channelFactory: null, account: { projectUrl: CONFIG.url, userId: 'b' } }); t.after(() => other.close());
  await assert.rejects(other.getSyncSummary(ws), { code: 'workspace_access_denied' });
  await assert.rejects(other.getSyncState(ws), { code: 'workspace_access_denied' });
});

test('an engine on a storage without the summary (an older cached module) reads the full state as before', async t => {
  const server = createServer(), a = createDevice('A', server); t.after(() => a.close());
  await a.login(); a.ws = (await a.storage.createWorkspace('익명 자료')).workspaceId; await add(a, '첫 자료');
  const reads = [];
  const storage = { ...a.storage, getSyncSummary: undefined, getSyncState: id => { reads.push(id); return a.storage.getSyncState(id); } };
  const { create } = require(path.join(__dirname, '../assets/life/sync.js'));
  const factory = () => server.adapter(a); factory.loadConfig = () => clone(CONFIG); factory.saveConfig = () => {};
  const manager = create({ storage, core: Core, remoteFactory: factory, automatic: false }); t.after(() => manager.dispose());
  await manager.connect({ ...CONFIG, email: 'a@example.invalid', password: 'fixture-only' });
  await manager.enable(a.ws);
  assert.equal((await manager.getState(a.ws, { light: true })).status, 'synced');
  assert.ok(reads.length >= 3, 'every read went to the full state');
  await assert.rejects(manager.getState(a.ws, { light: 'yes' }), { code: 'remote_invalid' });
});

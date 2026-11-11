'use strict';
// Devices of one account for Node tests: each has the real storage.js and the real sync.js over
// a memory IndexedDB, and all share one compare-and-swap server row (life_sync_put's contract:
// receipt first, then the expected revision). No browser, no network. Real IndexedDB, the SDK and
// two pages are covered by tests/source-merge-browser.cjs.
//   tree: the directory whose assets/life modules a device runs (default: this repository; the
//         fixture generator passes an export of an earlier commit).
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const Core = require(path.join(ROOT, 'assets/life/core.js'));
const CONFIG = { url: 'https://sync-fixture.example.invalid', key: 'sb_publishable_fixture_only' };
const account = id => ({ userId: id, email: `${id}@example.invalid`, projectUrl: CONFIG.url });
const clone = value => JSON.parse(JSON.stringify(value));

// The same decisions as the adapter in tests/life-storage.test.cjs: a transaction works on a
// copy of its stores and commits it on the next turn of the event loop.
function memoryIdb(seed = null) {
  const schemas = new Map(), rows = new Map();
  const encode = key => JSON.stringify(key);
  function connection() {
    let closed = false;
    return {
      objectStoreNames: { contains: name => schemas.has(name) },
      createObjectStore(name, options) { schemas.set(name, options.keyPath); if (!rows.has(name)) rows.set(name, new Map()); return { createIndex() {} }; },
      close() { closed = true; },
      transaction(names, mode) {
        if (closed) throw new DOMException('closed', 'InvalidStateError');
        const working = new Map(names.map(name => [name, structuredClone(rows.get(name))]));
        let finished = false, resolve, reject;
        const done = new Promise((yes, no) => { resolve = yes; reject = no; });
        const abort = (error = new DOMException('aborted', 'AbortError')) => { if (!finished) { finished = true; reject(error); } };
        function store(name) {
          if (!working.has(name)) throw new Error('store not in transaction');
          const map = working.get(name), keyPath = schemas.get(name);
          const keyOf = value => Array.isArray(keyPath) ? keyPath.map(key => value[key]) : value[keyPath];
          async function write(method, value) {
            if (finished) throw new DOMException('inactive', 'InvalidStateError');
            if (mode !== 'readwrite') throw new Error('readonly');
            const key = method === 'delete' ? value : keyOf(value);
            if (method === 'delete') map.delete(encode(key));
            else { if (method === 'add' && map.has(encode(key))) throw new DOMException('duplicate', 'ConstraintError'); map.set(encode(key), structuredClone(value)); }
            return key;
          }
          return {
            async get(key) { return structuredClone(map.get(encode(key))); },
            async getAll() { return structuredClone([...map.values()]); },
            async getAllKeys() { return [...map.keys()].map(key => JSON.parse(key)); },
            async getKey(key) { return map.has(encode(key)) ? structuredClone(key) : undefined; },
            put: value => write('put', value), add: value => write('add', value), delete: key => write('delete', key),
            index(field) { return { async getAll(value) { return structuredClone([...map.values()].filter(row => row[field] === value)); } }; },
          };
        }
        setImmediate(() => { if (finished) return; finished = true; if (mode === 'readwrite') for (const [name, values] of working) rows.set(name, values); resolve(); });
        return { done, objectStore: store, abort };
      },
    };
  }
  // seed: stores as written by exportRows (a device's database carried over to another version).
  if (seed) for (const [name, entries] of Object.entries(seed)) rows.set(name, new Map(entries.map(([key, value]) => [key, structuredClone(value)])));
  return { rows, idb: { async openDB(_name, version, callbacks) { const db = connection(); callbacks.upgrade(db, 0, version); return db; } } };
}
const exportRows = rows => Object.fromEntries([...rows].map(([name, map]) => [name, [...map].map(([key, value]) => [key, structuredClone(value)])]));

function createServer() {
  const server = { row: null, receipts: new Map(), calls: { read: 0, write: 0, head: 0, stored: 0, refused: 0 }, beforeWrite: null };
  server.adapter = device => ({
    async getAccount() { return account(device.user); },
    async signIn() { return account(device.user); },
    async signOut() {},
    onAuthChange() { return () => {}; },
    async list() { return server.row ? [{ id: server.row.id, title: server.row.title, revision: server.row.revision }] : []; },
    async read() { server.calls.read++; return server.row ? clone(server.row) : null; },
    async head() { server.calls.head++; return server.row ? { id: server.row.id, revision: server.row.revision, title: server.row.title } : null; },
    async write(request) {
      server.calls.write++;
      if (server.beforeWrite) await server.beforeWrite(device, request);
      if (server.receipts.has(request.operationId)) return { status: 'stored', revision: server.receipts.get(request.operationId) };
      const current = server.row ? server.row.revision : 0;
      if (current !== request.expectedRevision) { server.calls.refused++; return { status: 'conflict', revision: current }; }
      server.row = { id: request.workspaceId, title: request.data.title, revision: current + 1, data: clone(request.data), updated_at: '2026-11-01T00:00:00Z' };
      server.receipts.set(request.operationId, server.row.revision); server.calls.stored++;
      return { status: 'stored', revision: server.row.revision };
    },
    dispose() {},
  });
  return server;
}
// options.rows: a database exported from another device object (the same device after an update).
// options.syncCommon: the shared module this page loaded (an older cached one during an update).
function createDevice(name, server, { tree = ROOT, user = 'a', rows = null, syncCommon = undefined } = {}) {
  const adapter = memoryIdb(rows);
  const { createStorage } = require(path.join(tree, 'assets/life/storage.js'));
  const storage = createStorage({ idb: adapter.idb, core: Core, channelFactory: null, ...(syncCommon ? { syncCommon } : {}) });
  const device = { name, user, storage, rows: adapter.rows, ws: null };
  const factory = () => server.adapter(device);
  factory.loadConfig = () => clone(CONFIG); factory.saveConfig = () => {};
  require(path.join(tree, 'assets/life/sync-lifecycle.js'));
  device.manager = require(path.join(tree, 'assets/life/sync.js')).create({ storage, core: Core, remoteFactory: factory, automatic: false });
  device.login = () => device.manager.connect({ ...CONFIG, email: `${user}@example.invalid`, password: 'fixture-only' });
  device.close = () => { try { device.manager.dispose(); } catch (_) {} try { storage.close(); } catch (_) {} };
  device.read = () => storage.read(device.ws);
  device.state = () => storage.getSyncState(device.ws);
  device.base = () => adapter.rows.get('meta')?.get(JSON.stringify('syncBase:' + device.ws))?.value || null;
  device.commit = async changes => {
    const bundle = await storage.read(device.ws);
    const result = await storage.commitLocal({ workspaceId: device.ws, operationId: Core.id(), baseRevision: bundle.revision, changes });
    if (result.status !== 'stored') throw Object.assign(new Error('commit ' + result.status + ' ' + (result.error?.code || '')), { code: result.error?.code || result.status });
    return storage.read(device.ws);
  };
  // One full engine run: the state it ends in, or { error } with the engine's code.
  device.sync = async (options = {}) => { try { return await device.manager.syncNow(device.ws, options); } catch (error) { return { error: error.code || error.message }; } };
  return device;
}
const content = bundle => JSON.stringify({ ...bundle, revision: 0 });
module.exports = { ROOT, Core, CONFIG, memoryIdb, exportRows, createServer, createDevice, content, clone };

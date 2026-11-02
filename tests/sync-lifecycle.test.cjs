'use strict';
// S2 (structure review 4-5): the page-lifecycle wiring of the sync engines. Each engine's
// "event -> handler" table is pinned from main before the change (2a224dc). The engines keep their
// own handlers; only who calls addEventListener/setInterval changed, so the same named handler
// must be bound to the same event on the same target, with the same poll interval, and every
// binding must be gone after dispose (or after LifeSync.setAutomatic(false)).
// Behaviour of the handlers themselves (parking on a persisted pagehide, hidden/visible) stays
// covered by the engines' own tests (writing-sync, account-docs-sync, life-sync, ...).
const test = require('node:test');
const assert = require('node:assert/strict');

require('../assets/life/sync-common.js');
try { require('../assets/life/sync-lifecycle.js'); } catch (error) { if (error?.code !== 'MODULE_NOT_FOUND') throw error; }
const LifeSync = require('../assets/life/sync.js');
const CompositionSync = require('../assets/life/composition-sync.js');
const WritingSync = require('../assets/life/writing-sync.js');
const MaterialContinuitySync = require('../assets/life/material-continuity-sync.js');
const AccountDocsSync = require('../assets/life/account-docs-sync.js');
const AccountLibrary = require('../assets/life/account-library.js');

const owner = { projectUrl: 'https://example.invalid', userId: '00000000-0000-4000-8000-00000000000a' };
const never = () => new Promise(() => {});
const failing = () => Promise.reject(Object.assign(new Error('offline'), { code: 'network_error' }));
const settle = () => new Promise(done => setImmediate(done));

// Records bindings on globalThis (the engines' root) and its document while a test runs.
function record(t) {
  const saved = {}, keys = ['addEventListener', 'removeEventListener', 'document', 'setInterval', 'clearInterval'];
  for (const key of keys) saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  const bound = [], log = [], timers = new Map();
  let next = 0;
  const target = name => ({
    addEventListener(type, fn) { bound.push([name, type, fn]); log.push(['add', name, type, fn.name]); },
    removeEventListener(type, fn) {
      const at = bound.findIndex(([n, t2, f]) => n === name && t2 === type && f === fn);
      if (at >= 0) bound.splice(at, 1);
    },
  });
  const page = target('window'), doc = { ...target('document'), visibilityState: 'visible' };
  Object.assign(globalThis, {
    addEventListener: page.addEventListener, removeEventListener: page.removeEventListener, document: doc,
    setInterval(fn, every) { const id = { id: ++next, unref() {} }; timers.set(id, [every, fn.name]); log.push(['interval', every, fn.name]); return id; },
    clearInterval(id) { timers.delete(id); },
  });
  t.after(() => {
    for (const key of keys) { if (saved[key]) Object.defineProperty(globalThis, key, saved[key]); else delete globalThis[key]; }
  });
  return {
    // Bindings in registration order: [target, event, handler name]; the poll as [every, handler name].
    table: () => ({ events: bound.map(([n, type, fn]) => [n, type, fn.name]), polls: [...timers.values()] }),
    log,
  };
}

const EMPTY = { events: [], polls: [] };

test('LifeSync: online and visibility, one 60 s poll; setAutomatic(false) and dispose remove them', async t => {
  const r = record(t);
  const storage = new Proxy({}, { get: () => failing });
  const sync = LifeSync.create({ storage, core: {}, remoteFactory: Object.assign(() => ({}), { loadConfig: async () => null }), automatic: false });
  sync.setAutomatic(true); await settle();
  assert.deepEqual(r.table(), {
    events: [['window', 'online', 'automatic'], ['document', 'visibilitychange', 'visible']],
    polls: [[60000, 'visible']],
  });
  sync.setAutomatic(false);
  assert.deepEqual(r.table(), EMPTY);
  sync.setAutomatic(true);
  assert.equal(r.table().events.length, 2, 'turning it back on binds again');
  sync.dispose();
  assert.deepEqual(r.table(), EMPTY);
});

test('CompositionSync: online, focus, visibility, back/forward cache and a 30 s poll', async t => {
  const r = record(t);
  const auth = { getAccount: () => owner, epoch: 1 };
  const sourceSync = { subscribe: () => () => {}, getState: failing };
  const storage = new Proxy({ account: owner }, { get: (target, key) => key in target ? target[key] : failing });
  const sync = CompositionSync.create({ storage, sourceSync, auth, remote: { dispose() {} } });
  sync.start(); await settle();
  assert.deepEqual(r.table(), {
    events: [['window', 'online', 'automatic'], ['window', 'focus', 'automatic'], ['document', 'visibilitychange', 'automatic'],
      ['window', 'pagehide', 'pagehide'], ['window', 'pageshow', 'pageshow']],
    polls: [[30000, 'automatic']],
  });
  sync.dispose();
  assert.deepEqual(r.table(), EMPTY);
});

test('WritingSync: online, focus, visibility, page suspend/ready, back/forward cache and its poll', async t => {
  const r = record(t);
  const auth = { getAccount: () => owner, epoch: 1 };
  const storage = new Proxy({ account: owner }, { get: (target, key) => key in target ? target[key] : key === 'subscribeAll' ? undefined : failing });
  const sync = WritingSync.create({ storage, sourceSync: { subscribe: () => () => {} }, auth, remote: { dispose() {} }, engine: {}, materials: null, interval: 45000 });
  sync.start(); await settle();
  assert.deepEqual(r.table(), {
    events: [['window', 'online', 'automatic'], ['window', 'focus', 'automatic'], ['document', 'visibilitychange', 'automatic'],
      ['document', 'haedo:page-suspend', 'suspend'], ['document', 'haedo:page-ready', 'resume'],
      ['window', 'pagehide', 'pagehide'], ['window', 'pageshow', 'pageshow']],
    polls: [[45000, 'automatic']],
  });
  sync.dispose();
  assert.deepEqual(r.table(), EMPTY);
});

test('MaterialContinuitySync.automatic: online, focus, visibility, page suspend/ready, back/forward cache and its poll', async t => {
  const r = record(t);
  const storage = { account: owner, readMaterialWriting: failing, adoptMaterialContinuity: failing, listWorkspaces: failing };
  const manager = { dispose() {} };
  const background = MaterialContinuitySync.automatic({ storage, auth: { getAccount: () => owner, epoch: 1 }, every: 90000, manager });
  background.start(); await settle();
  const table = {
    events: [['window', 'online', 'pass'], ['window', 'focus', 'pass'], ['document', 'visibilitychange', 'pass'],
      ['document', 'haedo:page-suspend', 'suspend'], ['document', 'haedo:page-ready', 'resume'],
      ['window', 'pagehide', 'pagehide'], ['window', 'pageshow', 'pageshow']],
    polls: [[90000, 'pass']],
  };
  assert.deepEqual(r.table(), table);
  background.start();
  assert.deepEqual(r.table(), table, 'a second start binds nothing more');
  background.dispose();
  assert.deepEqual(r.table(), EMPTY);
});

test('AccountDocsSync: online, focus, visibility, page suspend/ready, back/forward cache and a visible-only poll', async t => {
  const r = record(t);
  const storage = { account: owner, listAccountDocs: never, subscribeAll: () => () => {} };
  const sync = AccountDocsSync.create({ storage, auth: { getAccount: () => owner, epoch: 1 }, remote: { dispose() {} }, intervalMs: 20000 });
  sync.start(); await settle();
  assert.deepEqual(r.table(), {
    events: [['window', 'online', 'wake'], ['window', 'focus', 'wake'], ['document', 'visibilitychange', 'visibility'],
      ['document', 'haedo:page-suspend', 'suspend'], ['document', 'haedo:page-ready', 'ready'],
      ['window', 'pagehide', 'pagehide'], ['window', 'pageshow', 'pageshow']],
    polls: [[20000, '']],
  });
  sync.dispose();
  assert.deepEqual(r.table(), EMPTY);
});

test('AccountLibrary: online, focus, visibility and a 30 s poll once its lifecycle starts', async t => {
  const r = record(t);
  const manager = { subscribe: () => () => {}, setAutomatic() {}, start: failing, getAccount: () => owner };
  const auth = { epoch: 1, user: { id: owner.userId }, getAccount: () => owner, verify: failing };
  const storage = new Proxy({ isAccountScoped: true, account: owner, subscribeAll: () => () => {} },
    { get: (target, key) => key in target ? target[key] : failing });
  const library = AccountLibrary.create({ storage, core: {}, sync: manager, compositionSync: manager, libraryMetaSync: manager, auth,
    remote: { dispose() {}, capabilities: failing } });
  await library.bootstrap().catch(() => {});
  assert.deepEqual(r.table(), {
    events: [['window', 'online', 'lifecycle'], ['window', 'focus', 'lifecycle'], ['document', 'visibilitychange', 'visible']],
    polls: [[30000, 'lifecycle']],
  });
  library.dispose();
  assert.deepEqual(r.table(), EMPTY);
});

test('SyncLifecycle.attach binds in the given order, starts the poll after them, and detach removes exactly that once', () => {
  const SyncLifecycle = require('../assets/life/sync-lifecycle.js');
  const log = [];
  const target = name => ({ addEventListener: (type, fn) => log.push(['add', name, type, fn]), removeEventListener: (type, fn) => log.push(['remove', name, type, fn]) });
  const host = { ...target('window'), document: target('document'),
    setInterval: (fn, every) => { log.push(['interval', every, fn]); return 7; }, clearInterval: id => log.push(['clear', id]) };
  const a = () => {}, b = () => {}, c = () => {};
  const wiring = SyncLifecycle.attach(host, { listen: [['window', 'online', a], ['document', 'visibilitychange', b], ['window', 'pagehide', c]], poll: [30000, a] });
  assert.deepEqual(log, [['add', 'window', 'online', a], ['add', 'document', 'visibilitychange', b], ['add', 'window', 'pagehide', c], ['interval', 30000, a]]);
  log.length = 0; wiring.detach(); wiring.detach();
  assert.deepEqual(log, [['clear', 7], ['remove', 'window', 'online', a], ['remove', 'document', 'visibilitychange', b], ['remove', 'window', 'pagehide', c]]);
  log.length = 0;
  SyncLifecycle.attach(host, { listen: [['window', 'focus', a]] }).detach();
  assert.deepEqual(log, [['add', 'window', 'focus', a], ['remove', 'window', 'focus', a]], 'no poll: no interval and nothing to clear');
  // A host without a document (a worker-like or test root) skips document listeners, as the engines' ?. did.
  assert.doesNotThrow(() => SyncLifecycle.attach({ ...target('window'), setInterval() {}, clearInterval() {} }, { listen: [['document', 'visibilitychange', a]] }).detach());
  assert.throws(() => SyncLifecycle.attach(host, { listen: [['body', 'click', a]] }), TypeError);
  assert.throws(() => SyncLifecycle.attach(host, { listen: [['window', 'online', null]] }), TypeError);
});

test('an older cached page without sync-lifecycle.js still starts the engine, with no automatic wake-ups', async () => {
  // Browser-like: no require, no HaedoLife.SyncLifecycle. The engine binds nothing, throws nothing,
  // and its start-up pass still runs.
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const bound = [], context = vm.createContext({
    addEventListener: (type) => bound.push(type), removeEventListener() {}, document: { visibilityState: 'visible', addEventListener: type => bound.push(type), removeEventListener() {} },
    setInterval: () => { bound.push('interval'); return 1; }, clearInterval() {}, setTimeout, clearTimeout, Promise, Date, Map, Set, Error, Object, Array, JSON, console,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/life/account-docs-sync.js'), 'utf8'), context);
  let runs = 0;
  const storage = { account: owner, listAccountDocs: () => { runs++; return never(); }, subscribeAll: () => () => {} };
  const sync = context.HaedoLife.AccountDocsSync.create({ storage, auth: { getAccount: () => owner, epoch: 1 }, remote: { dispose() {} }, locks: null });
  sync.start(); await settle();
  assert.deepEqual(bound, []);
  assert.equal(runs, 1, 'the start-up pass ran');
  assert.doesNotThrow(() => sync.dispose());
});

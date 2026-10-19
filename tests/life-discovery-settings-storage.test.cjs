'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStorage } = require('../assets/life/storage.js');
const Core = require('../assets/life/core.js');
const Interest = require('../assets/life/interest-profile.js');
const Feedback = require('../assets/life/discovery-profile.js');
const Settings = require('../assets/life/discovery-settings.js');

// Transactional fault injection; independent browser tests use real IndexedDB.
function memoryAdapter() {
  const schemas = new Map(), rows = new Map();
  const control = { transactions: [], failRead: null, failWrite: null, failCompletion: false };
  const key = value => JSON.stringify(value);
  function connection() {
    let closed = false;
    return {
      objectStoreNames: { contains: name => schemas.has(name) },
      createObjectStore(name, options) { schemas.set(name, options.keyPath); rows.set(name, new Map()); return { createIndex() {} }; },
      close() { closed = true; },
      transaction(names, mode) {
        if (closed) throw new DOMException('closed', 'InvalidStateError');
        control.transactions.push({ names: [...names], mode });
        const working = new Map(names.map(name => [name, structuredClone(rows.get(name))]));
        let finished = false, resolve, reject;
        const done = new Promise((yes, no) => { resolve = yes; reject = no; });
        const abort = (error = new DOMException('aborted', 'AbortError')) => { if (!finished) { finished = true; reject(error); } };
        function store(name) {
          const map = working.get(name); if (!map) throw Error('store missing');
          const valueKey = value => Array.isArray(schemas.get(name)) ? schemas.get(name).map(field => value[field]) : value[schemas.get(name)];
          async function write(method, value) {
            if (finished) throw new DOMException('inactive', 'InvalidStateError');
            assert.equal(mode, 'readwrite');
            control.beforeWrite?.({ name, method, value });
            if (control.failWrite?.name === name && control.failWrite.method === method) {
              control.failWrite = null; const error = new DOMException('quota', 'QuotaExceededError'); abort(error); throw error;
            }
            const encoded = key(method === 'delete' ? value : valueKey(value));
            if (method === 'delete') map.delete(encoded);
            else { if (method === 'add' && map.has(encoded)) throw new DOMException('duplicate', 'ConstraintError'); map.set(encoded, structuredClone(value)); }
            control.afterWrite?.({ name, method, value }); return method === 'delete' ? value : valueKey(value);
          }
          return {
            async get(value) {
              if (control.failRead?.name === name && (!control.failRead.key || control.failRead.key === value)) {
                control.failRead = null; throw new DOMException('read failed', 'UnknownError');
              }
              return structuredClone(map.get(key(value)));
            },
            async getAll() { return structuredClone([...map.values()]); },
            async getAllKeys() { return [...map.keys()].map(JSON.parse); },
            put: value => write('put', value), add: value => write('add', value), delete: value => write('delete', value),
            index(field) { return { async getAll(value) { return structuredClone([...map.values()].filter(row => row[field] === value)); } }; }
          };
        }
        setImmediate(() => {
          if (finished) return;
          if (control.failCompletion) { control.failCompletion = false; abort(); return; }
          finished = true;
          if (mode === 'readwrite') for (const [name, values] of working) rows.set(name, values);
          resolve();
        });
        return { done, objectStore: store, abort };
      }
    };
  }
  return { rows, schemas, control, idb: { async openDB(name, version, callbacks) { const db = connection(); if (!schemas.size) callbacks.upgrade(db, 0, version); return db; } } };
}
const accountA = { projectUrl: 'https://discovery-test.supabase.co', userId: 'anonymous-a' };
const accountB = { projectUrl: 'https://discovery-test.supabase.co', userId: 'anonymous-b' };
const otherProject = { projectUrl: 'https://other-discovery-test.supabase.co', userId: 'anonymous-a' };
const article = { id: 'public-article', canonicalUrl: 'https://example.org/article?id=1' };
const opts = expectedRevision => ({ expectedRevision, now: '2026-10-19T05:00:00.000Z' });
const rowKey = (workspaceId, account = accountA) => `discoverySettings:${JSON.stringify([account.projectUrl, account.userId])}:${workspaceId}`;
function fixture() {
  const adapter = memoryAdapter();
  return { ...adapter, storage: createStorage({ idb: adapter.idb, core: Core, interestProfile: Interest, discoveryProfile: Feedback, discoverySettings: Settings, channelFactory: null }) };
}
async function imported(storage) {
  let bundle = await storage.createWorkspace('익명 발견 피드백 검증');
  const prepared = await Core.prepareImport({ origin: 'other', title: '보존할 원문', text: '\ufeff가😀나\r\nCafe\u0301  저장할 원문입니다.', url: article.canonicalUrl, authorRelation: 'unknown' }, bundle);
  await storage.commitLocal({ workspaceId: bundle.workspaceId, operationId: Core.id(), baseRevision: bundle.revision, changes: Core.buildImportChanges(bundle, prepared) });
  return storage.read(bundle.workspaceId);
}
test('settings stay private; off/reset retain revisions and preserve all existing data', async t => {
  const { storage: base, rows, control } = fixture(); t.after(() => base.close());
  const store = base.forAccount(accountA), bundle = await imported(store), w = bundle.workspaceId;
  const interest = Interest.setManual(Interest.empty(w), [{ id: 'manual-book', label: '독서' }], opts(0));
  await store.saveInterestProfile(w, interest, 0);
  const feedback = Feedback.setFeedback(Feedback.empty(w), article, 'already_read', opts(0));
  await store.saveDiscoveryProfile(w, feedback, 0);
  const metaBefore = structuredClone(rows.get('meta'));
  const readsBefore = control.transactions.length;
  assert.deepEqual(await store.readDiscoverySettings(w), Settings.empty(w));
  await store.readDiscoverySettings(w);
  assert.deepEqual(rows.get('meta'), metaBefore);
  assert.ok(control.transactions.slice(readsBefore).every(tx => tx.mode === 'readonly'));
  const candidate = Settings.update(Settings.empty(w), { autoRefresh: true, disabledInterestIds: ['manual-book'], disabledSourceIds: ['source-one'] }, opts(0));
  const saved = await store.saveDiscoverySettings(w, candidate, 0); assert.equal(saved.status, 'stored');
  saved.settings.autoRefresh = false;
  assert.deepEqual(await store.readDiscoverySettings(w), candidate);
  const undo = Settings.update(candidate, { autoRefresh: false }, opts(1));
  assert.equal((await store.saveDiscoverySettings(w, undo, 1)).status, 'stored');
  assert.deepEqual(await store.saveDiscoverySettings(w, candidate, 0), { status: 'conflict', settings: undo });
  const reset = Settings.clear(undo, opts(2)); await store.saveDiscoverySettings(w, reset, 2);
  assert.deepEqual(await store.saveDiscoverySettings(w, candidate, 0), { status: 'conflict', settings: reset });
  assert.deepEqual(rows.get('meta').get(JSON.stringify(rowKey(w))).value, reset);
  assert.deepEqual(await store.read(w), bundle);
  assert.deepEqual(await store.readInterestProfile(w), interest);
  assert.deepEqual(await store.readDiscoveryProfile(w), feedback);
  for (const [key, row] of metaBefore) assert.deepEqual(rows.get('meta').get(key), row);
  assert.equal(JSON.stringify(Core.makeBackup(await store.read(w))).includes('discoverySettings'), false);
  const binding = { projectUrl: accountA.projectUrl, userId: accountA.userId, remoteId: w };
  await store.bindSync(w, binding);
  const upload = await store.prepareSyncUpload(w, binding);
  assert.deepEqual(upload.data, bundle); assert.equal(JSON.stringify(upload).includes('discoverySettings'), false);
});
test('owner user, project, workspace and closed-scope boundaries reject foreign or delayed writes', async t => {
  const { storage: base } = fixture(); t.after(() => base.close());
  const a = base.forAccount(accountA), bundle = await imported(a), w = bundle.workspaceId;
  const second = await a.createWorkspace('두 번째 공간');
  const candidate = Settings.update(Settings.empty(w), { autoRefresh: true, disabledSourceIds: ['source-one'] }, opts(0));
  await assert.rejects(a.saveDiscoverySettings(second.workspaceId, candidate, 0), { code: 'workspace_mismatch' });
  assert.deepEqual(await a.readDiscoverySettings(second.workspaceId), Settings.empty(second.workspaceId));
  for (const other of [accountB, otherProject]) {
    const foreign = base.forAccount(other);
    await assert.rejects(foreign.readDiscoverySettings(w), { code: 'workspace_access_denied' });
    await assert.rejects(foreign.saveDiscoverySettings(w, candidate, 0), { code: 'workspace_access_denied' });
  }
  await assert.rejects(a.readDiscoverySettings(w), { code: 'storage_scope_closed' });
  await assert.rejects(a.saveDiscoverySettings(w, candidate, 0), { code: 'storage_scope_closed' });
  await assert.rejects(base.readDiscoverySettings(w), { code: 'auth_scope_required' });
  const current = base.forAccount(accountA); assert.deepEqual(await current.readDiscoverySettings(w), Settings.empty(w));
});
test('lookup failure and corrupt metadata are errors, while only a missing row means empty', async t => {
  const { storage: base, control, rows } = fixture(); t.after(() => base.close());
  const store = base.forAccount(accountA), bundle = await imported(store), w = bundle.workspaceId;
  control.failRead = { name: 'meta', key: rowKey(w) };
  await assert.rejects(store.readDiscoverySettings(w), { code: 'storage_error' });
  assert.deepEqual(await store.readDiscoverySettings(w), Settings.empty(w));
  rows.get('meta').set(JSON.stringify(rowKey(w)), { key: rowKey(w), value: { malformed: true } });
  await assert.rejects(store.readDiscoverySettings(w), { code: 'discovery_settings_invalid' });
  const candidate = Settings.update(Settings.empty(w), { autoRefresh: true, disabledSourceIds: ['source-one'] }, opts(0));
  await assert.rejects(store.saveDiscoverySettings(w, candidate, 0), { code: 'discovery_settings_invalid' });
});
test('write and transaction completion failures preserve old settings and permit an explicit retry', async t => {
  for (const failure of ['put', 'completion']) await t.test(failure, async t => {
    const { storage: base, control } = fixture(); t.after(() => base.close());
    const store = base.forAccount(accountA), bundle = await imported(store), w = bundle.workspaceId;
    const candidate = Settings.update(Settings.empty(w), { autoRefresh: true, disabledSourceIds: ['source-one'] }, opts(0)), events = [];
    store.subscribe(w, event => events.push(event));
    if (failure === 'put') control.failWrite = { name: 'meta', method: 'put' };
    else control.afterWrite = ({ name, value }) => { if (name === 'meta' && value.key === rowKey(w)) { control.failCompletion = true; control.afterWrite = null; } };
    await assert.rejects(store.saveDiscoverySettings(w, candidate, 0), { code: failure === 'put' ? 'storage_quota' : 'storage_aborted' });
    assert.deepEqual(await store.readDiscoverySettings(w), Settings.empty(w)); assert.deepEqual(events, []);
    assert.equal((await store.saveDiscoverySettings(w, candidate, 0)).status, 'stored');
    assert.deepEqual(events, [{ type: 'discovery_settings_changed', workspaceId: w, revision: 1 }]);
    assert.deepEqual(await store.read(w), bundle);
  });
});
test('save snapshots its candidate, requires a single revision step and does not silently replace malformed data', async t => {
  const { storage: base } = fixture(); t.after(() => base.close());
  const store = base.forAccount(accountA), bundle = await imported(store), w = bundle.workspaceId;
  const candidate = Settings.update(Settings.empty(w), { autoRefresh: true, disabledSourceIds: ['source-one'] }, opts(0)), original = structuredClone(candidate);
  await assert.rejects(store.saveDiscoverySettings(w, { ...candidate, revision: 2 }, 0), { code: 'discovery_settings_conflict' });
  const pending = store.saveDiscoverySettings(w, candidate, 0);
  candidate.disabledSourceIds[0] = 'mutated-after-save';
  const saved = await pending;
  assert.deepEqual(saved.settings, original); assert.deepEqual(await store.readDiscoverySettings(w), original);
});
test('account-scoped broadcast contains workspace/revision only and ignores foreign or malformed events', async t => {
  const adapter = memoryAdapter(), channels = [];
  function channelFactory(name) {
    const channel = { name, closed: false, onmessage: null, close() { this.closed = true; },
      postMessage(data) { for (const peer of channels) if (!peer.closed && peer !== channel && peer.name === name) peer.onmessage?.({ data }); } };
    channels.push(channel); return channel;
  }
  const common = { idb: adapter.idb, core: Core, discoverySettings: Settings, channelFactory };
  const first = createStorage({ ...common, account: accountA }), second = createStorage({ ...common, account: accountA }), foreign = createStorage({ ...common, account: accountB });
  t.after(() => { first.close(); second.close(); foreign.close(); });
  const bundle = await imported(first), w = bundle.workspaceId;
  await second.open(); await foreign.open();
  const received = [], outside = []; second.subscribe(w, event => received.push(event)); foreign.subscribe(w, event => outside.push(event));
  const candidate = Settings.update(Settings.empty(w), { autoRefresh: true, disabledSourceIds: ['source-one'] }, opts(0));
  await first.saveDiscoverySettings(w, candidate, 0);
  assert.deepEqual(received, [{ type: 'discovery_settings_changed', workspaceId: w, revision: 1 }]); assert.deepEqual(outside, []);
  const sender = channels.find(channel => channel.name.endsWith(':' + JSON.stringify([accountA.projectUrl, accountA.userId])));
  for (const revision of [0, -1, NaN, '2']) sender.postMessage({ sender: 'invalid', type: 'discovery_settings_changed', workspaceId: w, revision });
  assert.equal(received.length, 1);
});
test('account replacement before a settings transaction commits aborts the old write', async t => {
  const { storage: base, control, rows } = fixture(); t.after(() => base.close());
  const prior = base.forAccount(accountA), bundle = await imported(prior), w = bundle.workspaceId;
  const candidate = Settings.update(Settings.empty(w), { autoRefresh: true, disabledSourceIds: ['source-one'] }, opts(0));
  control.beforeWrite = ({ name, value }) => {
    if (name === 'meta' && value.key === rowKey(w)) { control.beforeWrite = null; base.forAccount(accountB); }
  };
  await assert.rejects(prior.saveDiscoverySettings(w, candidate, 0), { code: 'storage_scope_closed' });
  assert.equal(rows.get('meta').has(JSON.stringify(rowKey(w))), false);
  const reopened = base.forAccount(accountA);
  assert.deepEqual(await reopened.readDiscoverySettings(w), Settings.empty(w));
  assert.deepEqual(await reopened.read(w), bundle);
});

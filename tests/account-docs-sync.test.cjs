'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStorage } = require('../assets/life/storage.js');
const Core = require('../assets/life/core.js');
const Settings = require('../assets/life/discovery-settings.js');
const PagePosts = require('../assets/life/page-posts.js');
const Sync = require('../assets/life/account-docs-sync.js');
const Remote = require('../assets/life/account-docs-remote.js');

// Transactional in-memory IndexedDB (same shape as the other storage tests).
function memoryAdapter() {
  const schemas = new Map(), rows = new Map();
  const key = value => JSON.stringify(value);
  function connection() {
    return {
      objectStoreNames: { contains: name => schemas.has(name) },
      createObjectStore(name, options) { schemas.set(name, options.keyPath); rows.set(name, new Map()); return { createIndex() {} }; },
      close() {},
      transaction(names, mode) {
        const working = new Map(names.map(name => [name, structuredClone(rows.get(name))]));
        let finished = false, resolve, reject;
        const done = new Promise((yes, no) => { resolve = yes; reject = no; });
        const abort = (error = new DOMException('aborted', 'AbortError')) => { if (!finished) { finished = true; reject(error); } };
        function store(name) {
          const map = working.get(name);
          const valueKey = value => Array.isArray(schemas.get(name)) ? schemas.get(name).map(field => value[field]) : value[schemas.get(name)];
          async function write(method, value) {
            if (finished) throw new DOMException('inactive', 'InvalidStateError');
            assert.equal(mode, 'readwrite');
            const encoded = key(method === 'delete' ? value : valueKey(value));
            if (method === 'delete') map.delete(encoded);
            else { if (method === 'add' && map.has(encoded)) throw new DOMException('duplicate', 'ConstraintError'); map.set(encoded, structuredClone(value)); }
            return method === 'delete' ? value : valueKey(value);
          }
          return {
            async get(value) { return structuredClone(map.get(key(value))); },
            async getAll() { return structuredClone([...map.values()]); },
            async getAllKeys() { return [...map.keys()].map(JSON.parse); },
            put: value => write('put', value), add: value => write('add', value), delete: value => write('delete', value),
            index(field) { return { async getAll(value) { return structuredClone([...map.values()].filter(row => row[field] === value)); } }; }
          };
        }
        setImmediate(() => {
          if (finished) return;
          finished = true;
          if (mode === 'readwrite') for (const [name, values] of working) rows.set(name, values);
          resolve();
        });
        return { done, objectStore: store, abort };
      }
    };
  }
  return { rows, idb: { async openDB(name, version, callbacks) { const db = connection(); if (!schemas.size) callbacks.upgrade(db, 0, version); return db; } } };
}

// In-memory model of life_account_document_put/changes (per owner, CAS, receipts, seq).
function fakeServer() {
  const owners = new Map(), receipts = new Map(); let seq = 0;
  const docs = owner => { if (!owners.has(owner)) owners.set(owner, new Map()); return owners.get(owner); };
  function client(owner, control = {}) {
    return {
      PAGE_LIMIT: 2, calls: [],
      async put(request) {
        this.calls.push({ type: 'put', ...structuredClone(request) });
        if (control.offline) throw Object.assign(new Error('offline'), { code: 'network_error' });
        const receiptKey = owner + '|' + request.operationId, hash = JSON.stringify([request.docKey, request.expectedRevision, request.data, request.clientUpdatedAt]);
        let result;
        if (receipts.has(receiptKey)) {
          assert.equal(receipts.get(receiptKey).hash, hash, 'replayed operation must be identical');
          result = structuredClone(receipts.get(receiptKey).result);
        } else {
          const store = docs(owner), current = store.get(request.docKey);
          if ((current?.revision || 0) !== request.expectedRevision) {
            return { status: 'conflict', revision: current?.revision || 0, seq: current?.seq || null,
              current: current ? { revision: current.revision, data: structuredClone(current.data), deleted: current.deleted, client_updated_at: current.client_updated_at } : null };
          }
          const row = { revision: (current?.revision || 0) + 1, data: JSON.parse(JSON.stringify(request.data)), deleted: false, client_updated_at: request.clientUpdatedAt, seq: ++seq };
          store.set(request.docKey, row);
          result = { status: 'stored', revision: row.revision, seq: row.seq };
          receipts.set(receiptKey, { hash, result });
        }
        if (control.loseReply) { control.loseReply = false; throw Object.assign(new Error('lost'), { code: 'network_error' }); }
        return result;
      },
      async changes(after, limit) {
        this.calls.push({ type: 'changes', after });
        if (control.offline) throw Object.assign(new Error('offline'), { code: 'network_error' });
        if (control.noChanges) { control.noChanges = false; return []; }
        return [...docs(owner).entries()].map(([docKey, row]) => ({ docKey, ...structuredClone(row) }))
          .filter(row => row.seq > after).sort((a, b) => a.seq - b.seq).slice(0, limit);
      },
      dispose() {}
    };
  }
  return { owners, docs, client, inject(owner, docKey, row) { docs(owner).set(docKey, { deleted: false, client_updated_at: null, ...row, seq: ++seq }); } };
}

const accountA = { projectUrl: 'https://account-docs-test.supabase.co', userId: 'anonymous-a' };
const accountB = { projectUrl: 'https://account-docs-test.supabase.co', userId: 'anonymous-b' };
const accountKey = account => JSON.stringify([account.projectUrl, account.userId]);
const settingsKey = (w, account = accountA) => `discoverySettings:${accountKey(account)}:${w}`;
function clock(start = '2026-11-01T00:00:00.000Z') {
  let at = Date.parse(start);
  const now = () => new Date(at).toISOString();
  now.advance = (ms = 1000) => { at += ms; };
  return now;
}
function device() {
  const adapter = memoryAdapter();
  return { ...adapter, base: createStorage({ idb: adapter.idb, core: Core, discoverySettings: Settings, channelFactory: null }) };
}
async function workspaceOn(store, bundle) {
  if (bundle) {
    await store.installSyncRemote({ id: bundle.workspaceId, revision: 1, data: bundle }, { ...store.account, remoteId: bundle.workspaceId });
    return store.read(bundle.workspaceId);
  }
  return store.createWorkspace('계정 자동 저장 검증');
}
function engine(store, server, owner = accountA, { now = clock(), control = {} } = {}) {
  const remote = server.client(owner.userId, control);
  const sync = Sync.create({ storage: store, auth: { getAccount: () => owner }, remote, polling: false, now, locks: null, debounceMs: 1e7 });
  sync.start(); // Subscribes to local saves (edit times); the debounced timer never fires in tests.
  return { sync, remote, control, now };
}
async function draft(store, w, body, revision) {
  const current = await store.readPageDrafts(w);
  assert.equal(current.revision, revision ?? current.revision);
  const next = current.posts.length ? structuredClone(current) : { revision: current.revision, posts: [PagePosts.draft([], Core.id(), '2026-11-01T00:00:00.000Z')] };
  next.posts[0].body = body;
  return store.savePageDrafts(w, next, current.revision);
}
const settings = (w, revision, autoRefresh) => Settings.update(Settings.empty(w), { autoRefresh }, { expectedRevision: 0, now: '2026-11-01T00:00:00.000Z' });

test('first sync uploads every local-only document and a fresh device receives them', async t => {
  const server = fakeServer(), mac = device(), ipad = device();
  t.after(() => { mac.base.close(); ipad.base.close(); });
  const a = mac.base.forAccount(accountA), bundle = await workspaceOn(a), w = bundle.workspaceId;
  await a.saveDiscoverySettings(w, settings(w, 0, true), 0);
  await draft(a, w, '맥에서 쓴 초안 한글');
  assert.deepEqual((await a.listAccountDocKeys()).sort(), [settingsKey(w), `page-drafts:${w}`].sort());
  const macSync = engine(a, server); await macSync.sync.syncNow();
  const stored = server.docs(accountA.userId);
  assert.equal(stored.get(settingsKey(w)).revision, 1); assert.equal(stored.get(`page-drafts:${w}`).revision, 1);
  assert.equal(stored.get(settingsKey(w)).client_updated_at, '1970-01-01T00:00:00.000Z', 'pre-sync content counts as the oldest edit');
  assert.equal(macSync.sync.getStatus().state, 'synced');
  for (const doc of await a.listAccountDocs()) assert.equal(doc.hash, doc.sync.hash);

  const b = ipad.base.forAccount(accountA); await workspaceOn(b, bundle);
  const events = []; b.subscribeAll(event => events.push(event));
  const ipadSync = engine(b, server); await ipadSync.sync.syncNow();
  assert.equal((await b.readDiscoverySettings(w)).autoRefresh, true);
  assert.equal((await b.readPageDrafts(w)).posts[0].body, '맥에서 쓴 초안 한글');
  assert(events.some(event => event.type === 'account_doc_applied' && event.key === settingsKey(w) && event.workspaceId === w));
  assert(events.some(event => event.type === 'discovery_settings_changed' && event.workspaceId === w));
  assert.equal(ipadSync.remote.calls.filter(call => call.type === 'put').length, 0, 'applied documents are not echoed back');
  // Existing data on the device was never removed.
  assert.deepEqual((await b.read(w)).sources, bundle.sources);
});

test('CAS conflict: the later edit wins on both devices and the losing content is kept as a recovery copy', async t => {
  const server = fakeServer(), mac = device(), ipad = device(), now = clock();
  t.after(() => { mac.base.close(); ipad.base.close(); });
  const a = mac.base.forAccount(accountA), bundle = await workspaceOn(a), w = bundle.workspaceId;
  const b = ipad.base.forAccount(accountA); await workspaceOn(b, bundle);
  await draft(a, w, '처음 초안');
  const macSync = engine(a, server, accountA, { now }), ipadSync = engine(b, server, accountA, { now });
  await macSync.sync.syncNow(); await ipadSync.sync.syncNow();
  assert.equal((await b.readPageDrafts(w)).posts[0].body, '처음 초안');

  now.advance(); await draft(a, w, '맥에서 먼저 고친 초안');
  now.advance(); await draft(b, w, '아이패드에서 나중에 고친 초안');
  await macSync.sync.syncNow();
  assert.equal(server.docs(accountA.userId).get(`page-drafts:${w}`).data.posts[0].body, '맥에서 먼저 고친 초안');
  await ipadSync.sync.syncNow();
  assert.equal(server.docs(accountA.userId).get(`page-drafts:${w}`).data.posts[0].body, '아이패드에서 나중에 고친 초안');
  const kept = await b.listAccountDocRecoveries(`page-drafts:${w}`);
  assert.equal(kept.length, 1); assert.equal(kept[0].value.posts[0].body, '맥에서 먼저 고친 초안'); assert.equal(kept[0].reason, 'conflict_remote');
  await macSync.sync.syncNow();
  assert.equal((await a.readPageDrafts(w)).posts[0].body, '아이패드에서 나중에 고친 초안');

  // Reverse order: the remote edit is newer, so the local pending edit becomes the recovery copy.
  now.advance(); await draft(a, w, '맥의 오래된 수정');
  now.advance(); await draft(b, w, '아이패드의 최신 수정');
  await ipadSync.sync.syncNow(); await macSync.sync.syncNow();
  assert.equal((await a.readPageDrafts(w)).posts[0].body, '아이패드의 최신 수정');
  const macRecovery = await a.listAccountDocRecoveries(`page-drafts:${w}`);
  assert(macRecovery.some(item => item.value.posts[0].body === '맥의 오래된 수정' && item.reason === 'conflict'));
  // The applied revision moved past the local one: an editor holding the old base conflicts instead of overwriting.
  const current = await a.readPageDrafts(w), stale = structuredClone(current); stale.revision = current.revision - 1;
  await assert.rejects(a.savePageDrafts(w, stale, stale.revision), { code: 'page_draft_conflict' });

  // Settings are not content: the winner is taken without a recovery copy.
  now.advance(); await a.saveDiscoverySettings(w, settings(w, 0, true), 0);
  now.advance(); await b.saveDiscoverySettings(w, settings(w, 0, false), 0);
  await macSync.sync.syncNow(); await ipadSync.sync.syncNow(); await macSync.sync.syncNow();
  assert.equal((await a.readDiscoverySettings(w)).autoRefresh, false); assert.equal((await b.readDiscoverySettings(w)).autoRefresh, false);
});

test('offline changes stay pending across a reload and a lost reply is replayed with the same operation', async t => {
  const server = fakeServer(), mac = device();
  t.after(() => mac.base.close());
  const a = mac.base.forAccount(accountA), bundle = await workspaceOn(a), w = bundle.workspaceId;
  const first = engine(a, server, accountA, { control: { offline: true } });
  await draft(a, w, '오프라인에서 쓴 초안');
  await first.sync.syncNow();
  assert.notEqual(first.sync.getStatus().state, 'synced');
  let [doc] = (await a.listAccountDocs()).filter(item => item.key === `page-drafts:${w}`);
  assert.notEqual(doc.hash, doc.sync?.hash); assert.equal(server.docs(accountA.userId).size, 0);
  first.sync.dispose();

  // Reload: a new engine over the same IndexedDB. The reply of the first put is lost.
  const control = { loseReply: true }, second = engine(a, server, accountA, { control });
  await second.sync.syncNow();
  const puts = second.remote.calls.filter(call => call.type === 'put');
  assert.equal(puts.length, 1); assert.equal(server.docs(accountA.userId).get(`page-drafts:${w}`).revision, 1);
  [doc] = (await a.listAccountDocs()).filter(item => item.key === `page-drafts:${w}`);
  assert.equal(doc.sync.operationId, puts[0].operationId, 'the pending operation is durable');
  control.noChanges = true; // Force the push path instead of adopting the stored row from the change feed.
  await second.sync.syncNow();
  const replay = second.remote.calls.filter(call => call.type === 'put');
  assert.equal(replay.length, 2); assert.equal(replay[1].operationId, replay[0].operationId);
  assert.equal(server.docs(accountA.userId).get(`page-drafts:${w}`).revision, 1, 'replay does not create a second revision');
  [doc] = (await a.listAccountDocs()).filter(item => item.key === `page-drafts:${w}`);
  assert.equal(doc.hash, doc.sync.hash); assert.equal(doc.sync.revision, 1);
});

test('a remote apply never overwrites a concurrent local save', async t => {
  const server = fakeServer(), mac = device(), ipad = device(), now = clock();
  t.after(() => { mac.base.close(); ipad.base.close(); });
  const a = mac.base.forAccount(accountA), bundle = await workspaceOn(a), w = bundle.workspaceId;
  const b = ipad.base.forAccount(accountA); await workspaceOn(b, bundle);
  await draft(a, w, '공통 초안');
  const macSync = engine(a, server, accountA, { now }); await macSync.sync.syncNow();
  await engine(b, server, accountA, { now }).sync.syncNow();
  now.advance(); await draft(b, w, '다른 기기에서 바뀐 초안');
  await engine(b, server, accountA, { now }).sync.syncNow();

  // Storage-level CAS: a stale expected hash is refused and the local row is untouched.
  const before = await a.readAccountDocRecord(`page-drafts:${w}`);
  const refused = await a.applyAccountDoc(`page-drafts:${w}`, { value: { revision: 9, posts: [] }, expectedHash: 'stale' });
  assert.equal(refused.status, 'changed'); assert.deepEqual((await a.readAccountDocRecord(`page-drafts:${w}`)).value, before.value);

  // Engine-level race: the user saves between the engine's read and its apply.
  let raced = false;
  const racing = Object.freeze({ ...a, account: a.account, async readAccountDocRecord(key) {
    const record = await a.readAccountDocRecord(key);
    if (!raced && key === `page-drafts:${w}`) { raced = true; now.advance(); await draft(a, w, '맥에서 지금 입력해 저장한 초안'); }
    return record;
  } });
  const sync = Sync.create({ storage: racing, auth: { getAccount: () => accountA }, remote: server.client(accountA.userId), polling: false, now, locks: null });
  await sync.syncNow();
  assert(raced);
  assert.equal((await a.readPageDrafts(w)).posts[0].body, '맥에서 지금 입력해 저장한 초안');
  await sync.syncNow();
  assert.equal((await a.readPageDrafts(w)).posts[0].body, '맥에서 지금 입력해 저장한 초안', 'the newer local save wins');
  assert.equal(server.docs(accountA.userId).get(`page-drafts:${w}`).data.posts[0].body, '맥에서 지금 입력해 저장한 초안');
  const kept = await a.listAccountDocRecoveries(`page-drafts:${w}`);
  assert(kept.some(item => item.value.posts[0].body === '다른 기기에서 바뀐 초안'));
});

test('account isolation: another account on the same device never lists, reads or applies these documents', async t => {
  const server = fakeServer(), shared = device();
  t.after(() => shared.base.close());
  const a = shared.base.forAccount(accountA), bundle = await workspaceOn(a), w = bundle.workspaceId;
  await a.saveDiscoverySettings(w, settings(w, 0, true), 0); await draft(a, w, 'A 계정의 초안');
  const other = createStorage({ idb: shared.idb, core: Core, discoverySettings: Settings, channelFactory: null }); t.after(() => other.close());
  const b = other.forAccount(accountB), own = await workspaceOn(b);
  assert.deepEqual(await b.listAccountDocKeys(), []);
  await assert.rejects(b.readAccountDocRecord(settingsKey(w)), { code: 'account_doc_invalid_key' });
  await assert.rejects(b.readAccountDocRecord(`page-drafts:${w}`), { code: 'workspace_access_denied' });
  await assert.rejects(b.applyAccountDoc(`page-drafts:${w}`, { value: { revision: 1, posts: [] }, expectedHash: null }), { code: 'workspace_access_denied' });
  // A server row naming account A's documents is ignored by account B's engine.
  server.inject(accountB.userId, settingsKey(w), { revision: 1, data: Settings.empty(w) });
  server.inject(accountB.userId, `page-drafts:${w}`, { revision: 1, data: { revision: 1, posts: [] } });
  const sync = engine(b, server, accountB); await sync.sync.syncNow();
  const a2 = a;
  assert.equal((await a2.readDiscoverySettings(w)).autoRefresh, true);
  assert.equal((await a2.readPageDrafts(w)).posts[0].body, 'A 계정의 초안');
  assert.deepEqual(sync.remote.calls.filter(call => call.type === 'put'), []);
  assert.equal((await b.readPageDrafts(own.workspaceId)).posts.length, 0);
  // An engine whose auth now reports a different account stops before any request.
  const wrong = Sync.create({ storage: a2, auth: { getAccount: () => accountB }, remote: server.client(accountA.userId), polling: false, locks: null });
  await wrong.syncNow(); assert.equal(wrong.getStatus().error.code, 'request_cancelled');
});

test('remote content this version cannot validate is deferred and the local document is kept', async t => {
  const server = fakeServer(), mac = device();
  t.after(() => mac.base.close());
  const a = mac.base.forAccount(accountA), bundle = await workspaceOn(a), w = bundle.workspaceId;
  await a.saveDiscoverySettings(w, settings(w, 0, true), 0);
  const sync = engine(a, server); await sync.sync.syncNow();
  server.inject(accountA.userId, settingsKey(w), { revision: 2, data: { format: 'future-settings-v9', workspaceId: w } });
  await sync.sync.syncNow();
  assert.equal((await a.readDiscoverySettings(w)).autoRefresh, true);
  const record = await a.readAccountDocRecord(settingsKey(w));
  assert.equal(record.sync.deferred.revision, 2); assert.equal(typeof record.sync.error.code, 'string');
  assert.equal(server.docs(accountA.userId).get(settingsKey(w)).revision, 2, 'a deferred newer format is not overwritten');
});

test('the remote client sends exact RPC arguments and refuses non-JSON data', async () => {
  const calls = [];
  const auth = { ready: true, config: { url: 'https://x.supabase.co', key: 'k' } };
  const clientFactory = (_auth, options) => { assert.deepEqual(options, { scope: 'account-docs' }); return () => ({
    auth: { async getUser() { return { data: { user: { id: 'u' } }, error: null }; }, dispose() {} },
    async rpc(name, params) { calls.push({ name, params }); return name === 'life_account_document_put'
      ? { data: { status: 'stored', revision: 1, seq: 5 }, error: null }
      : { data: [{ doc_key: 'k', revision: 1, data: { a: 1 }, deleted: false, client_updated_at: null, seq: '7', updated_at: '2026-11-01T00:00:00Z' }], error: null }; } }); };
  const remote = Remote.create({ auth, clientFactory });
  const op = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(await remote.put({ docKey: 'k', expectedRevision: 0, operationId: op, data: { a: 1 }, clientUpdatedAt: null }), { status: 'stored', revision: 1, seq: 5 });
  assert.deepEqual(calls[0], { name: 'life_account_document_put', params: { p_doc_key: 'k', p_expected_revision: 0, p_operation_id: op, p_data: { a: 1 }, p_deleted: false, p_client_updated_at: null } });
  const rows = await remote.changes(0); assert.equal(rows[0].seq, 7); assert.deepEqual(rows[0].data, { a: 1 });
  await assert.rejects(remote.put({ docKey: 'k', expectedRevision: 0, operationId: op, data: { big: 'a'.repeat(2 * 1024 * 1024) } }), { code: 'payload_too_large' });
  await assert.rejects(remote.put({ docKey: 'k\n', expectedRevision: 0, operationId: op, data: {} }), { code: 'invalid_request' });
  assert.equal(Remote.clean({ message: 'life_account_document_operation_mismatch', code: '22023' }).code, 'operation_mismatch');
  assert.equal(Remote.clean({ code: 'PGRST202' }).code, 'schema_missing');
});

test('a server without the account-document RPCs is unavailable and is not asked again every pass', async t => {
  const mac = device(); t.after(() => mac.base.close());
  const a = mac.base.forAccount(accountA), bundle = await workspaceOn(a), w = bundle.workspaceId;
  await draft(a, w, '서버 준비 전 초안');
  let calls = 0, at = 1000;
  const missing = () => { calls++; throw Object.assign(new Error('missing'), { code: 'schema_missing' }); };
  const sync = Sync.create({ storage: a, auth: { getAccount: () => accountA }, remote: { PAGE_LIMIT: 2, changes: missing, put: missing, dispose() {} },
    polling: false, locks: null, debounceMs: 1e7, clock: () => at });
  await sync.syncNow();
  assert.equal(sync.getStatus().state, 'unavailable'); assert.equal(calls, 1);
  await sync.syncNow(); await sync.syncNow();
  assert.equal(calls, 1, 'no repeated calls while backing off');
  at += 5 * 60 * 1000 + 1; await sync.syncNow();
  assert.equal(calls, 2); assert.equal(sync.getStatus().state, 'unavailable');
  at += 5 * 60 * 1000 + 1; await sync.syncNow();
  assert.equal(calls, 2, 'the pause grows after another miss');
  const [doc] = (await a.listAccountDocs()).filter(item => item.key === `page-drafts:${w}`);
  assert.notEqual(doc.hash, doc.sync?.hash, 'the local draft stays pending');
  assert.equal((await a.readPageDrafts(w)).posts[0].body, '서버 준비 전 초안');
});

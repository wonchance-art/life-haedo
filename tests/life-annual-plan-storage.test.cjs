'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStorage } = require('../assets/life/storage.js');
const Core = require('../assets/life/core.js');
const Annual = require('../assets/life/annual-plan.js');

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
const accountA = { projectUrl: 'https://annual-test.supabase.co', userId: 'anonymous-a' };
const accountB = { projectUrl: 'https://annual-test.supabase.co', userId: 'anonymous-b' };
const otherProject = { projectUrl: 'https://other-annual-test.supabase.co', userId: 'anonymous-a' };
const opts = expectedRevision => ({ expectedRevision, now: '2026-10-23T01:00:00.000Z' });
const rowKey = (workspaceId, account = accountA) => `annualPlan:${JSON.stringify([account.projectUrl, account.userId])}:${workspaceId}`;
function fixture() {
  const adapter = memoryAdapter();
  return { ...adapter, storage: createStorage({ idb: adapter.idb, core: Core, annualPlan: Annual, channelFactory: null }) };
}
async function imported(storage) {
  const bundle = await storage.createWorkspace('익명 연간 계획 검증');
  const prepared = await Core.prepareImport({ origin: 'other', title: '보존할 원문', text: '\ufeff가😀나\r\nCafe\u0301  연간 계획과 분리된 원문입니다.', authorRelation: 'unknown' }, bundle);
  await storage.commitLocal({ workspaceId: bundle.workspaceId, operationId: Core.id(), baseRevision: bundle.revision, changes: Core.buildImportChanges(bundle, prepared) });
  return storage.read(bundle.workspaceId);
}
function candidate(w) {
  return Annual.update(Annual.empty(w), { birthDate: '2000-02-29', basis: 'birthday', ageMode: 'both', quarters: true,
    rows: [{ year: 2026, text: '합성 연간 계획 😀\r\n다음 줄' }],
    entries: [{ id: 'anonymous-month-one', date: '2026-07-23', text: '익명 월 계획 Cafe\u0301' }] }, opts(0));
}

test('annual plan lookup is read-only; an independent CAS row leaves originals and ordinary backups/sync unchanged', async t => {
  const { storage: base, rows, control } = fixture(); t.after(() => base.close());
  const store = base.forAccount(accountA), bundle = await imported(store), w = bundle.workspaceId;
  const metaBefore = structuredClone(rows.get('meta')), count = control.transactions.length;
  const empty = Annual.empty(w);
  assert.deepEqual(await store.readAnnualPlan(w), empty);
  await store.readAnnualPlan(w);
  assert.deepEqual(rows.get('meta'), metaBefore);
  assert.ok(control.transactions.slice(count).every(tx => tx.mode === 'readonly'));
  const input = candidate(w), result = await store.saveAnnualPlan(w, input, 0);
  assert.equal(result.status, 'stored');
  result.profile.birthDate = '1999-01-01';
  assert.deepEqual(await store.readAnnualPlan(w), input);
  assert.deepEqual(rows.get('meta').get(JSON.stringify(rowKey(w))).value, input);
  assert.deepEqual(await store.read(w), bundle);
  for (const [key, value] of metaBefore) assert.deepEqual(rows.get('meta').get(key), value);
  assert.equal(rows.get('meta').size, metaBefore.size + 1);
  const backup = JSON.stringify(Core.makeBackup(await store.read(w)));
  assert.equal(backup.includes('annualPlan'), false);
  assert.equal(backup.includes(input.birthDate), false);
  const binding = { projectUrl: accountA.projectUrl, userId: accountA.userId, remoteId: w };
  await store.bindSync(w, binding);
  const upload = await store.prepareSyncUpload(w, binding);
  assert.deepEqual(upload.data, bundle);
  assert.equal(JSON.stringify(upload).includes(input.entries[0].text), false);
});

test('stale annual plan saves return the exact newer profile without overwriting its dates or text', async t => {
  const { storage: base } = fixture(); t.after(() => base.close());
  const store = base.forAccount(accountA), { workspaceId: w } = await imported(store), first = candidate(w);
  await store.saveAnnualPlan(w, first, 0);
  const second = Annual.update(first, { basis: 'year', rows: [{ year: 2026, text: '새 탭에서 수정한 계획' }] }, opts(1));
  assert.equal((await store.saveAnnualPlan(w, second, 1)).status, 'stored');
  const result = await store.saveAnnualPlan(w, first, 0);
  assert.deepEqual(result, { status: 'conflict', profile: second });
  result.profile.entries[0].text = '반환 값 변경';
  assert.deepEqual(await store.readAnnualPlan(w), second);
});

test('annual plans reject foreign workspace/user/project and closed scopes before reading or writing private rows', async t => {
  const { storage: base } = fixture(); t.after(() => base.close());
  const store = base.forAccount(accountA), { workspaceId: w } = await imported(store), second = await store.createWorkspace('별도 공간'), input = candidate(w);
  await assert.rejects(store.saveAnnualPlan(second.workspaceId, input, 0), { code: 'workspace_mismatch' });
  assert.deepEqual(await store.readAnnualPlan(second.workspaceId), Annual.empty(second.workspaceId));
  for (const account of [accountB, otherProject]) {
    const foreign = base.forAccount(account);
    await assert.rejects(foreign.readAnnualPlan(w), { code: 'workspace_access_denied' });
    await assert.rejects(foreign.saveAnnualPlan(w, input, 0), { code: 'workspace_access_denied' });
  }
  await assert.rejects(store.readAnnualPlan(w), { code: 'storage_scope_closed' });
  await assert.rejects(store.saveAnnualPlan(w, input, 0), { code: 'storage_scope_closed' });
  await assert.rejects(base.readAnnualPlan(w), { code: 'auth_scope_required' });
  await assert.rejects(base.saveAnnualPlan(w, input, 0), { code: 'auth_scope_required' });
  const reopened = base.forAccount(accountA);
  assert.deepEqual(await reopened.readAnnualPlan(w), Annual.empty(w));
});

test('failed reads and corrupt annual metadata are not presented as an empty plan and cannot be silently replaced', async t => {
  const { storage: base, rows, control } = fixture(); t.after(() => base.close());
  const store = base.forAccount(accountA), { workspaceId: w } = await imported(store);
  control.failRead = { name: 'meta', key: rowKey(w) };
  await assert.rejects(store.readAnnualPlan(w), { code: 'storage_error' });
  const corrupt = { key: rowKey(w), value: { malformed: true } };
  rows.get('meta').set(JSON.stringify(rowKey(w)), corrupt);
  await assert.rejects(store.readAnnualPlan(w), { code: 'annual_plan_invalid' });
  await assert.rejects(store.saveAnnualPlan(w, candidate(w), 0), { code: 'annual_plan_invalid' });
  assert.deepEqual(rows.get('meta').get(JSON.stringify(rowKey(w))), corrupt);
});

test('write/commit failures retain the previous plan, emit no success event and allow explicit retry', async t => {
  for (const failure of ['put', 'completion']) await t.test(failure, async t => {
    const { storage: base, control } = fixture(); t.after(() => base.close());
    const store = base.forAccount(accountA), { workspaceId: w } = await imported(store), first = candidate(w);
    await store.saveAnnualPlan(w, first, 0);
    const next = Annual.update(first, { quarters: false }, opts(1)), events = [];
    store.subscribe(w, event => events.push(event));
    if (failure === 'put') control.failWrite = { name: 'meta', method: 'put' };
    else control.afterWrite = ({ name, value }) => { if (name === 'meta' && value.key === rowKey(w)) { control.failCompletion = true; control.afterWrite = null; } };
    await assert.rejects(store.saveAnnualPlan(w, next, 1), { code: failure === 'put' ? 'storage_quota' : 'storage_aborted' });
    assert.deepEqual(await store.readAnnualPlan(w), first); assert.deepEqual(events, []);
    assert.equal((await store.saveAnnualPlan(w, next, 1)).status, 'stored');
    assert.deepEqual(events, [{ type: 'annual_plan_changed', workspaceId: w, revision: 2, local: true }]);
  });
});

test('save snapshots annual input and requires exactly the next revision', async t => {
  const { storage: base } = fixture(); t.after(() => base.close());
  const store = base.forAccount(accountA), { workspaceId: w } = await imported(store), input = candidate(w), original = structuredClone(input);
  await assert.rejects(store.saveAnnualPlan(w, { ...input, revision: 2 }, 0), { code: 'annual_plan_conflict' });
  const pending = store.saveAnnualPlan(w, input, 0);
  input.rows[0].text = '저장 요청 뒤 원본 객체 변경'; input.entries[0].date = '2027-01-01';
  assert.deepEqual((await pending).profile, original);
  assert.deepEqual(await store.readAnnualPlan(w), original);
});

test('account-scoped annual broadcasts expose only workspace and positive revision; malformed/foreign notices are ignored', async t => {
  const adapter = memoryAdapter(), channels = [];
  function channelFactory(name) {
    const channel = { name, closed: false, onmessage: null, close() { this.closed = true; },
      postMessage(data) { for (const peer of channels) if (!peer.closed && peer !== channel && peer.name === name) peer.onmessage?.({ data }); } };
    channels.push(channel); return channel;
  }
  const common = { idb: adapter.idb, core: Core, annualPlan: Annual, channelFactory };
  const first = createStorage({ ...common, account: accountA }), second = createStorage({ ...common, account: accountA }), foreign = createStorage({ ...common, account: accountB });
  t.after(() => { first.close(); second.close(); foreign.close(); });
  const { workspaceId: w } = await imported(first);
  await second.open(); await foreign.open();
  const received = [], outside = []; second.subscribe(w, event => received.push(event)); foreign.subscribe(w, event => outside.push(event));
  await first.saveAnnualPlan(w, candidate(w), 0);
  assert.deepEqual(received, [{ type: 'annual_plan_changed', workspaceId: w, revision: 1 }]); assert.deepEqual(outside, []);
  const sender = channels.find(channel => channel.name.endsWith(':' + JSON.stringify([accountA.projectUrl, accountA.userId])));
  for (const revision of [0, -1, NaN, '2']) sender.postMessage({ sender: 'invalid', type: 'annual_plan_changed', workspaceId: w, revision });
  assert.equal(received.length, 1);
});

test('changing account before annual transaction completion aborts the old write and cannot install it in the new account', async t => {
  const { storage: base, control, rows } = fixture(); t.after(() => base.close());
  const prior = base.forAccount(accountA), { workspaceId: w } = await imported(prior), input = candidate(w);
  control.beforeWrite = ({ name, value }) => {
    if (name === 'meta' && value.key === rowKey(w)) { control.beforeWrite = null; base.forAccount(accountB); }
  };
  await assert.rejects(prior.saveAnnualPlan(w, input, 0), { code: 'storage_scope_closed' });
  assert.equal(rows.get('meta').has(JSON.stringify(rowKey(w))), false);
  const reopened = base.forAccount(accountA);
  assert.deepEqual(await reopened.readAnnualPlan(w), Annual.empty(w));
});

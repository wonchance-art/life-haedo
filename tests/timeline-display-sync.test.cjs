'use strict';
// 연표 표시 설정(행복도 곡선·나이)의 계정 자동 연동(2026-11-16, docs/design-review/account-sync-everywhere.md의
// 같은 날짜 절). 계정 문서 timelineDisplay와 이 브라우저 사본(caeyeon_life_ma·caeyeon_life_age, 연표 편집기가 읽음)
// 사이: 첫 동기화가 기존 값을 올리고 지우지 않음, 두 기기 반영, 항목별 늦은 쪽, 연표 편집기 변경을 다음 진입 때
// 올림, 계정 전환·늦은 응답에서 섞이지 않음.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createStorage } = require('../assets/life/storage.js');
const Core = require('../assets/life/core.js');
const Sync = require('../assets/life/account-docs-sync.js');

const EPOCH = '1970-01-01T00:00:00.000Z';
const MA = 'caeyeon_life_ma', AGE = 'caeyeon_life_age', RECORD = 'caeyeon_life_display_sync';

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
            async getKey(value) { return map.has(key(value)) ? structuredClone(value) : undefined; },
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

// In-memory life_account_document_put/changes (per owner, CAS, seq).
function fakeServer() {
  const owners = new Map(); let seq = 0;
  const docs = owner => { if (!owners.has(owner)) owners.set(owner, new Map()); return owners.get(owner); };
  function client(owner) {
    return {
      PAGE_LIMIT: 50,
      async put(request) {
        const store = docs(owner), current = store.get(request.docKey);
        if ((current?.revision || 0) !== request.expectedRevision)
          return { status: 'conflict', revision: current?.revision || 0, seq: current?.seq || null,
            current: current ? { revision: current.revision, data: structuredClone(current.data), deleted: false, client_updated_at: current.client_updated_at } : null };
        const row = { revision: (current?.revision || 0) + 1, data: JSON.parse(JSON.stringify(request.data)), deleted: false, client_updated_at: request.clientUpdatedAt, seq: ++seq };
        store.set(request.docKey, row);
        return { status: 'stored', revision: row.revision, seq: row.seq };
      },
      async changes(after, limit) {
        return [...docs(owner).entries()].map(([docKey, row]) => ({ docKey, ...structuredClone(row) }))
          .filter(row => row.seq > after).sort((a, b) => a.seq - b.seq).slice(0, limit);
      },
      dispose() {}
    };
  }
  return { docs, client };
}

const accountA = { projectUrl: 'https://display-test.supabase.co', userId: 'anonymous-a' };
const accountB = { projectUrl: 'https://display-test.supabase.co', userId: 'anonymous-b' };
const docKey = (account = accountA) => `timelineDisplay:${JSON.stringify([account.projectUrl, account.userId])}:settings`;
function memoryLocal(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k), map };
}
function device(initial) {
  const adapter = memoryAdapter(), local = memoryLocal(initial);
  return { ...adapter, local, base: createStorage({ idb: adapter.idb, core: Core, channelFactory: null, localStorage: local }) };
}
function engine(store, server, owner = accountA) {
  const sync = Sync.create({ storage: store, auth: { getAccount: () => owner }, remote: server.client(owner.userId), polling: false, locks: null, debounceMs: 1e7 });
  sync.start();
  return sync;
}
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const record = local => JSON.parse(local.getItem(RECORD));
const serverItems = (server, account = accountA) => Object.fromEntries(server.docs(account.userId).get(docKey(account)).data.items.map(item => [item.key, item.v]));
// The timeline editor's own writer (assets/app.js markDisplay), run as the editor runs it: without storage.js.
function timelineEditor(local) {
  const source = fs.readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
  const start = source.indexOf('function markDisplay('), end = source.indexOf('\n}\n', start) + 2;
  assert.ok(start > 0 && end > start, 'app.js defines markDisplay');
  const context = vm.createContext({ localStorage: local, Date, JSON, Math, isFinite, Array });
  vm.runInContext(source.slice(start, end), context);
  return {
    curve(v) { local.setItem(MA, v); context.markDisplay('curve', v); },
    age(v) { local.setItem(AGE, v); context.markDisplay('age', v); }
  };
}

test('first sync uploads the values this browser already had, keeps them, and a fresh device receives them', async t => {
  const server = fakeServer(), mac = device({ [MA]: '60', [AGE]: 'kr' }), ipad = device();
  t.after(() => { mac.base.close(); ipad.base.close(); });
  const a = mac.base.forAccount(accountA), b = ipad.base.forAccount(accountA);
  await engine(a, server).syncNow();
  assert.deepEqual(serverItems(server), { age: 'kr', curve: 60 });
  assert.equal(server.docs(accountA.userId).get(docKey()).data.items[0].at, EPOCH, 'a value from before this release counts as the oldest edit');
  assert.equal(mac.local.getItem(MA), '60'); assert.equal(mac.local.getItem(AGE), 'kr');
  assert.equal(record(mac.local).curve.up, true);
  await engine(b, server).syncNow();
  assert.equal(ipad.local.getItem(MA), '60', 'the iPad timeline reads the account value');
  assert.equal(ipad.local.getItem(AGE), 'kr');
  assert.deepEqual((await b.readTimelineDisplay()).items.map(item => [item.key, item.v]), [['age', 'kr'], ['curve', 60]]);
});

test('an older stored step (18) is read as the timeline reads it and is not rewritten', async t => {
  const server = fakeServer(), mac = device({ [MA]: '18' });
  t.after(() => mac.base.close());
  const a = mac.base.forAccount(accountA);
  await engine(a, server).syncNow();
  assert.deepEqual(serverItems(server), { curve: 36 });
  assert.equal(mac.local.getItem(MA), '18');
});

test('a choice in 설정 writes the copy at once and reaches the other device', async t => {
  const server = fakeServer(), mac = device(), ipad = device();
  t.after(() => { mac.base.close(); ipad.base.close(); });
  const a = mac.base.forAccount(accountA), b = ipad.base.forAccount(accountA);
  const ma = engine(a, server), pb = engine(b, server);
  const pending = b.saveTimelineDisplay({ curve: 0 });
  assert.equal(ipad.local.getItem(MA), '0', 'the copy is written before the promise settles');
  assert.equal(record(ipad.local).curve.up, false);
  assert.equal((await pending).localSaved, true);
  assert.equal(record(ipad.local).curve.up, true);
  await pb.syncNow(); await ma.syncNow();
  assert.equal(mac.local.getItem(MA), '0');
  await a.saveTimelineDisplay({ age: 'kr' });
  await ma.syncNow(); await pb.syncNow();
  assert.equal(ipad.local.getItem(AGE), 'kr'); assert.equal(ipad.local.getItem(MA), '0');
  assert.throws(() => a.saveTimelineDisplay({ curve: 18 }), { code: 'invalid_request' });
  assert.throws(() => a.saveTimelineDisplay({ grid: 1 }), { code: 'invalid_request' });
});

test('a value this browser had before is not lost when the account already has a newer one', async t => {
  const server = fakeServer(), mac = device(), ipad = device({ [MA]: '0' });
  t.after(() => { mac.base.close(); ipad.base.close(); });
  const a = mac.base.forAccount(accountA), b = ipad.base.forAccount(accountA);
  await a.saveTimelineDisplay({ curve: 60 }); await engine(a, server).syncNow();
  await engine(b, server).syncNow();
  assert.equal(ipad.local.getItem(MA), '60', 'the account value (a real edit) wins over the pre-sync value');
  assert.deepEqual(serverItems(server), { curve: 60 });
  const kept = await b.listAccountDocRecoveries(docKey());
  assert.ok(kept.some(row => JSON.stringify(row.value).includes('"v":0')), 'the iPad value is kept as a recovery copy');
  assert.equal(mac.local.getItem(MA), '60');
});

test('both devices changed before syncing: each item keeps its later edit', async t => {
  const server = fakeServer(), mac = device(), ipad = device();
  t.after(() => { mac.base.close(); ipad.base.close(); });
  const a = mac.base.forAccount(accountA), b = ipad.base.forAccount(accountA);
  const ma = engine(a, server), pb = engine(b, server);
  await ma.syncNow(); await pb.syncNow();
  await a.saveTimelineDisplay({ curve: 60 }); await tick();
  await b.saveTimelineDisplay({ curve: 0 }); await tick();
  await a.saveTimelineDisplay({ age: 'kr' });
  await ma.syncNow(); await pb.syncNow(); await ma.syncNow();
  for (const local of [mac.local, ipad.local]) { assert.equal(local.getItem(MA), '0'); assert.equal(local.getItem(AGE), 'kr'); }
  assert.deepEqual(serverItems(server), { age: 'kr', curve: 0 });
  // Reversed order of syncing: the later edit still wins.
  await tick(); await b.saveTimelineDisplay({ curve: 60 }); await tick(); await a.saveTimelineDisplay({ curve: 36 });
  await pb.syncNow(); await ma.syncNow(); await pb.syncNow();
  for (const local of [mac.local, ipad.local]) assert.equal(local.getItem(MA), '36');
  // Choosing the value a device already shows is no new edit: the other device's real change stays.
  await tick(); await b.saveTimelineDisplay({ age: 'intl' }); await tick(); await a.saveTimelineDisplay({ age: 'kr' });
  await pb.syncNow(); await ma.syncNow(); await pb.syncNow();
  for (const local of [mac.local, ipad.local]) assert.equal(local.getItem(AGE), 'intl');
});

test('a change made in the timeline editor goes up on the next 해도 pass, compared by its time', async t => {
  const server = fakeServer(), mac = device(), ipad = device();
  t.after(() => { mac.base.close(); ipad.base.close(); });
  const a = mac.base.forAccount(accountA), b = ipad.base.forAccount(accountA);
  const ma = engine(a, server), pb = engine(b, server);
  await a.saveTimelineDisplay({ curve: 60 }); await ma.syncNow(); await pb.syncNow();
  assert.equal(ipad.local.getItem(MA), '60');
  // The iPad timeline editor (no storage.js) changes both values.
  await tick(); const editor = timelineEditor(ipad.local); editor.curve(0); editor.age('kr');
  assert.equal(record(ipad.local).curve.up, false);
  await pb.syncNow(); await ma.syncNow();
  assert.deepEqual(serverItems(server), { age: 'kr', curve: 0 });
  assert.equal(mac.local.getItem(MA), '0'); assert.equal(mac.local.getItem(AGE), 'kr');
  // An editor change older than a later 설정 choice on the Mac loses (latest wins) and is kept as a recovery copy.
  editor.curve(36); await tick(); await a.saveTimelineDisplay({ curve: 60 });
  await ma.syncNow(); await pb.syncNow();
  assert.equal(ipad.local.getItem(MA), '60');
  assert.ok((await b.listAccountDocRecoveries(docKey())).some(row => JSON.stringify(row.value).includes('"v":36')));
  // An earlier release of the editor writes only the value: it is seen as changed when 해도 next reads it.
  ipad.local.setItem(AGE, 'intl');
  await pb.syncNow(); await ma.syncNow();
  assert.equal(mac.local.getItem(AGE), 'intl');
});

test('account switch: one account\'s values never reach the other, and unsent ones wait for their account', async t => {
  const server = fakeServer(), shared = device(), other = device();
  t.after(() => { shared.base.close(); other.base.close(); });
  let a = shared.base.forAccount(accountA);
  await a.saveTimelineDisplay({ curve: 60, age: 'kr' }); await engine(a, server).syncNow();
  // Account B already chose its own curve on another device.
  const bElsewhere = other.base.forAccount(accountB);
  await bElsewhere.saveTimelineDisplay({ curve: 0 }); await engine(bElsewhere, server, accountB).syncNow();
  // The timeline editor changes the age while A was last signed in; then B signs in on this browser.
  await tick(); timelineEditor(shared.local).age('intl');
  const b = shared.base.forAccount(accountB);
  await engine(b, server, accountB).syncNow();
  assert.deepEqual(serverItems(server, accountB), { curve: 0 }, 'A\'s unsent age is not sent to B');
  assert.deepEqual(serverItems(server, accountA), { age: 'kr', curve: 60 }, 'nor to A while B is signed in');
  assert.equal(shared.local.getItem(MA), '0', 'B\'s own value reaches the copy');
  assert.equal(shared.local.getItem(AGE), 'intl', 'B has no age of its own: the copy is left as it is');
  assert.equal(record(shared.local).held.items[0].key, 'age');
  // A signs in again: its held age goes up to A only.
  a = shared.base.forAccount(accountA);
  await engine(a, server).syncNow();
  assert.deepEqual(serverItems(server, accountA), { age: 'intl', curve: 60 });
  assert.deepEqual(serverItems(server, accountB), { curve: 0 });
  assert.equal(shared.local.getItem(MA), '60');
  assert.equal(record(shared.local).held, undefined);
});

test('late response: a pass of a closed account scope never writes that account\'s values to the copy', async t => {
  const local = device(); t.after(() => local.base.close());
  const a = local.base.forAccount(accountA);
  await a.saveTimelineDisplay({ curve: 60 });
  local.local.removeItem(MA);
  const rec = record(local.local); delete rec.curve; local.local.setItem(RECORD, JSON.stringify(rec));
  const pass = a.absorbTimelineDisplay().catch(error => error);
  local.base.forAccount(accountB); // The account changed: A's scope closes while its pass is out.
  await pass;
  assert.equal(local.local.getItem(MA), null, 'A\'s curve was not written after the switch');
});

test('a copy changed while the pass ran is not overwritten; the next pass takes it', async t => {
  const server = fakeServer(), mac = device(); t.after(() => mac.base.close());
  const a = mac.base.forAccount(accountA);
  await a.saveTimelineDisplay({ curve: 60 }); await engine(a, server).syncNow();
  const pass = a.absorbTimelineDisplay();
  await tick(); timelineEditor(mac.local).curve(0); // Another tab (the editor) writes during the pass.
  const result = await pass;
  assert.equal(mac.local.getItem(MA), '0');
  if (result.status === 'retry') assert.equal(record(mac.local).curve.up, false);
  await engine(a, server).syncNow();
  assert.deepEqual(serverItems(server), { curve: 0 });
});

test('validator: unknown steps are refused, a newer format is not written over, newer items are kept', async t => {
  const local = device(); t.after(() => local.base.close());
  const a = local.base.forAccount(accountA);
  const bad = await a.applyAccountDoc(docKey(), { value: { revision: 1, format: 1, items: [{ key: 'curve', v: 18, at: EPOCH }] }, expectedHash: null });
  assert.equal(bad.status, 'rejected');
  const newer = { revision: 1, format: 1, items: [{ key: 'curve', v: 36, at: EPOCH }, { key: 'mapFilter', v: 'all', at: EPOCH }] };
  assert.equal((await a.applyAccountDoc(docKey(), { value: newer, expectedHash: null })).status, 'applied');
  await a.saveTimelineDisplay({ curve: 60 });
  assert.deepEqual((await a.readTimelineDisplay()).items.map(item => item.key), ['curve', 'mapFilter']);
  assert.equal(local.local.getItem('caeyeon_life_mapfilter'), null, 'an item of a newer release is not written to a copy');
  const record0 = await a.readAccountDocRecord(docKey());
  const future = await a.applyAccountDoc(docKey(), { value: { revision: 9, format: 2, items: [] }, expectedHash: record0.hash });
  assert.equal(future.status, 'rejected');
});

test('without browser storage the choice still goes to the account document', async t => {
  const adapter = memoryAdapter(), broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const base = createStorage({ idb: adapter.idb, core: Core, channelFactory: null, localStorage: broken }); t.after(() => base.close());
  const a = base.forAccount(accountA);
  const result = await a.saveTimelineDisplay({ age: 'kr' });
  assert.equal(result.localSaved, false); assert.equal(result.status, 'unavailable');
  assert.deepEqual((await a.readTimelineDisplay()).items.map(item => [item.key, item.v]), [['age', 'kr']]);
});

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
  assert.deepEqual(Object.values(record(shared.local).held).map(items => items.map(item => [item.key, item.v])), [[['age', 'intl']]], 'held for A');
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

// Deterministic race (review m7, 2026-11-16): the timeline editor writes right after the pass read the copies
// (a microtask queued at that read), before the pass writes them back.
test('a copy changed while the pass ran is not overwritten; the next pass takes it', async t => {
  const server = fakeServer(), mac = device(); t.after(() => mac.base.close());
  const a = mac.base.forAccount(accountA);
  await a.saveTimelineDisplay({ curve: 60 }); await engine(a, server).syncNow();
  const editor = timelineEditor(mac.local), realGet = mac.local.getItem;
  let armed = true;
  mac.local.getItem = key => { const value = realGet(key); if (armed && key === RECORD) { armed = false; Promise.resolve().then(() => editor.curve(0)); } return value; };
  const result = await a.absorbTimelineDisplay();
  mac.local.getItem = realGet;
  assert.equal(armed, false, 'the editor wrote during the pass');
  assert.equal(result.status, 'retry', 'the pass saw the copy change and wrote nothing back');
  assert.equal(mac.local.getItem(MA), '0', 'the editor value stays');
  assert.equal(record(mac.local).curve.up, false, 'still to be put into the account');
  await engine(a, server).syncNow();
  assert.deepEqual(serverItems(server), { curve: 0 });
  assert.equal(record(mac.local).curve.up, true);
});

// Review M1 (2026-11-16): with nothing chosen, A's pass still records A as the owner, so a later timeline-editor
// change is A's and the next account to sign in (B) never takes it.
test('M1: nothing chosen, A signs in, the editor changes the age, B signs in: the age goes to A only', async t => {
  const server = fakeServer(), shared = device(); t.after(() => shared.base.close());
  const a = shared.base.forAccount(accountA); await engine(a, server).syncNow();
  assert.equal(typeof record(shared.local).owner, 'string', 'a signed-in pass writes the owner even with nothing chosen');
  timelineEditor(shared.local).age('kr');
  const b = shared.base.forAccount(accountB); await engine(b, server, accountB).syncNow();
  assert.equal(server.docs(accountB.userId).has(docKey(accountB)), false, 'nothing reaches B');
  assert.equal(server.docs(accountA.userId).has(docKey(accountA)), false, 'nor A while B is signed in');
  const back = shared.base.forAccount(accountA); await engine(back, server).syncNow();
  assert.deepEqual(serverItems(server, accountA), { age: 'kr' });
  assert.equal(server.docs(accountB.userId).has(docKey(accountB)), false);
});

// Values without an owner (the editor wrote them before any pass of this release ran here) belong to the first
// account that signed in on this browser, told by the account-document change cursors (storage displayClaim).
test('values without an owner go to the first account of this browser only', async t => {
  // B signs in first after the update, but A had synced here before: the values are held for A.
  const server = fakeServer(), shared = device(); t.after(() => shared.base.close());
  await shared.base.forAccount(accountA).writeAccountDocCursor(0); // A synced account documents here before.
  timelineEditor(shared.local).age('kr');
  assert.equal(record(shared.local).owner, undefined, 'the editor writes no owner');
  const b = shared.base.forAccount(accountB); await engine(b, server, accountB).syncNow();
  assert.equal(server.docs(accountB.userId).has(docKey(accountB)), false, 'not sent to B');
  const a = shared.base.forAccount(accountA); await engine(a, server).syncNow();
  assert.deepEqual(serverItems(server, accountA), { age: 'kr' }, 'sent to A');
  // The only account of this browser claims them.
  const server2 = fakeServer(), single = device(); t.after(() => single.base.close());
  timelineEditor(single.local).curve(0);
  const only = single.base.forAccount(accountA); await engine(only, server2).syncNow();
  assert.deepEqual(serverItems(server2), { curve: 0 });
  // Both accounts synced here before: the first one cannot be told. Rule change (2026-11-16 coordinator decision,
  // replacing 930ca00's held.unknown): the signed-in account takes them at 1970, so any real value of that account
  // wins and nothing waits unseen in the record.
  const server3 = fakeServer(), both = device(); t.after(() => both.base.close());
  await both.base.forAccount(accountB).writeAccountDocCursor(0); await both.base.forAccount(accountA).writeAccountDocCursor(0);
  timelineEditor(both.local).curve(60);
  const again = both.base.forAccount(accountA); await engine(again, server3).syncNow();
  assert.deepEqual(server3.docs(accountA.userId).get(docKey(accountA)).data.items.map(item => [item.key, item.v, item.at]), [['curve', 60, EPOCH]]);
  assert.equal(record(both.local).held, undefined, 'nothing is left unknown');
  assert.equal(both.local.getItem(MA), '60');
  // A 930ca00 record still holding 'unknown' values: they go to the signed-in account at 1970 and leave 'unknown'.
  const server4 = fakeServer(), dev = device(); t.after(() => dev.base.close());
  const four = dev.base.forAccount(accountA); await engine(four, server4).syncNow();
  const old = record(dev.local); old.held = { unknown: [{ key: 'age', v: 'kr', at: '2026-11-16T00:00:00.000Z' }] }; dev.local.setItem(RECORD, JSON.stringify(old));
  await engine(four, server4).syncNow();
  assert.deepEqual(server4.docs(accountA.userId).get(docKey(accountA)).data.items.map(item => [item.key, item.v, item.at]), [['age', 'kr', EPOCH]]);
  assert.equal(record(dev.local).held, undefined);
  assert.equal(dev.local.getItem(AGE), 'kr');
});

// Coordinator decision 2026-11-16 (reviewer p12-1): a browser where two accounts synced before still has copy values
// from the earlier release (no record at all, shared by the whole browser). The signed-in account takes them at 1970:
// a real value of that account from another device wins, and the copy value is kept as one recovery copy.
test('earlier-release copy values on a browser two accounts used go to the signed-in account at 1970', async t => {
  const server = fakeServer(), shared = device({ [MA]: '0', [AGE]: 'kr' }), ipad = device();
  t.after(() => { shared.base.close(); ipad.base.close(); });
  await shared.base.forAccount(accountB).writeAccountDocCursor(0); await shared.base.forAccount(accountA).writeAccountDocCursor(0);
  // No real value yet: the 1970 values become the account's.
  const a = shared.base.forAccount(accountA); await engine(a, server).syncNow();
  assert.deepEqual(server.docs(accountA.userId).get(docKey(accountA)).data.items.map(item => [item.key, item.v, item.at]), [['age', 'kr', EPOCH], ['curve', 0, EPOCH]]);
  assert.equal(record(shared.local).held, undefined);
  const i = ipad.base.forAccount(accountA); await engine(i, server).syncNow();
  assert.equal(ipad.local.getItem(MA), '0'); assert.equal(ipad.local.getItem(AGE), 'kr');
  // The same scene with a real value of the account already there (another device): that value wins.
  const server2 = fakeServer(), mac = device(), other = device({ [MA]: '0' });
  t.after(() => { mac.base.close(); other.base.close(); });
  const m = mac.base.forAccount(accountA); await m.saveTimelineDisplay({ curve: 60 }); await engine(m, server2).syncNow();
  await other.base.forAccount(accountB).writeAccountDocCursor(0); await other.base.forAccount(accountA).writeAccountDocCursor(0);
  const o = other.base.forAccount(accountA); await engine(o, server2).syncNow();
  assert.deepEqual(serverItems(server2), { curve: 60 }, 'the real value wins');
  assert.equal(other.local.getItem(MA), '60');
  const kept = await o.listAccountDocRecoveries(docKey());
  assert.equal(kept.filter(row => JSON.stringify(row.value).includes('"v":0')).length, 1, 'the copy value is kept as one recovery copy');
  assert.equal(record(other.local).held, undefined);
});

// Review 2 m2 (2026-11-16): a 설정 choice that could not be written to the copy at once goes through the pass; when
// another writer changed the copy during that pass ('retry'), the copy does not hold the choice: localSaved is false.
test('a choice that the pass could not write back because the copy changed reports localSaved false', async t => {
  const local = device(); t.after(() => local.base.close());
  await local.base.forAccount(accountB).writeAccountDocCursor(0); await local.base.forAccount(accountA).writeAccountDocCursor(0);
  timelineEditor(local.local).curve(60); // A timed value without an owner: the choice takes the pass path (first-account check).
  const a = local.base.forAccount(accountA), editor = timelineEditor(local.local), realGet = local.local.getItem;
  let reads = 0;
  local.local.getItem = key => { const value = realGet(key); if (key === RECORD && ++reads === 2) Promise.resolve().then(() => editor.curve(0)); return value; };
  const result = await a.saveTimelineDisplay({ age: 'kr' });
  local.local.getItem = realGet;
  assert.equal(reads >= 2, true);
  assert.equal(result.status, 'retry'); assert.equal(result.accountSaved, true);
  assert.equal(result.localSaved, false, 'the copy does not hold the choice yet');
  assert.equal(local.local.getItem(AGE), null);
  assert.deepEqual((await a.readTimelineDisplay()).items.find(item => item.key === 'age').v, 'kr', 'the account document holds it');
  await a.absorbTimelineDisplay();
  assert.equal(local.local.getItem(AGE), 'kr', 'the next pass writes it');
});

// Review m2 (2026-11-16): three accounts on one browser. A and B left unsent values; C signs in and chooses.
test('three accounts: C\'s choice reaches the copy at once, A\'s and B\'s waiting values stay held for each', async t => {
  const server = fakeServer(), shared = device(); t.after(() => shared.base.close());
  const accountC = { ...accountA, userId: 'anonymous-c' };
  let s = shared.base.forAccount(accountA);
  await s.saveTimelineDisplay({ curve: 60 }); await engine(s, server).syncNow();
  timelineEditor(shared.local).age('kr'); // A, unsent
  s = shared.base.forAccount(accountB); await engine(s, server, accountB).syncNow();
  timelineEditor(shared.local).curve(0); // B, unsent
  s = shared.base.forAccount(accountC);
  assert.equal((await s.absorbTimelineDisplay()).status, 'synced');
  const pending = s.saveTimelineDisplay({ curve: 36 });
  assert.equal(shared.local.getItem(MA), '36', 'the copy holds C\'s choice at once');
  const result = await pending;
  assert.equal(result.localSaved, true); assert.equal(result.accountSaved, true);
  await engine(s, server, accountC).syncNow();
  assert.deepEqual(serverItems(server, accountC), { curve: 36 });
  assert.equal(Object.keys(record(shared.local).held).length, 2, 'A\'s and B\'s values are held apart');
  s = shared.base.forAccount(accountB); await engine(s, server, accountB).syncNow();
  assert.deepEqual(serverItems(server, accountB), { curve: 0 });
  s = shared.base.forAccount(accountA); await engine(s, server).syncNow();
  assert.deepEqual(serverItems(server, accountA), { age: 'kr', curve: 60 });
  assert.deepEqual(serverItems(server, accountC), { curve: 36 });
});

// Review m1 (2026-11-16): the copy cannot be written, so the same losing value loses again every pass. It is kept
// once; other recovery copies of the document are not pushed out.
test('a losing value that cannot leave the copy is kept as one recovery copy, not one per pass', async t => {
  const server = fakeServer(), mac = device(), ipad = device();
  t.after(() => { mac.base.close(); ipad.base.close(); });
  const a = mac.base.forAccount(accountA), b = ipad.base.forAccount(accountA);
  const ma = engine(a, server), pb = engine(b, server);
  await a.saveTimelineDisplay({ curve: 60 }); await ma.syncNow(); await pb.syncNow();
  for (let i = 0; i < 2; i++) await b.saveAccountDocRecovery(docKey(), { items: [{ key: 'age', v: 'kr', at: EPOCH }], marker: i }, 'conflict');
  timelineEditor(ipad.local).curve(0); await tick();
  await a.saveTimelineDisplay({ curve: 36 }); await ma.syncNow();
  const realSet = ipad.local.setItem;
  ipad.local.setItem = (key, value) => { if (key === RECORD || key === MA) throw new Error('quota'); return realSet(key, value); };
  for (let i = 0; i < 5; i++) await pb.syncNow();
  ipad.local.setItem = realSet;
  const kept = await b.listAccountDocRecoveries(docKey());
  // Kept once: the engine's merge already kept it (merge_conflict); the later passes find that same copy.
  assert.equal(kept.filter(row => JSON.stringify(row.value).includes('"v":0')).length, 1, 'the losing value is kept once');
  assert.equal(kept.filter(row => row.reason === 'conflict').length, 2, 'the earlier recovery copies remain');
});

test('a 설정 choice reports what was saved: the copy and the account document separately', async t => {
  const local = device(); t.after(() => local.base.close());
  const a = local.base.forAccount(accountA);
  const ok = await a.saveTimelineDisplay({ curve: 60 });
  assert.equal(ok.localSaved, true); assert.equal(ok.accountSaved, true);
  // The account scope closes before its document write: the copy holds the choice, the document does not.
  const pending = a.saveTimelineDisplay({ curve: 0 });
  local.base.forAccount(accountB);
  const closed = await pending;
  assert.equal(closed.localSaved, true); assert.equal(closed.accountSaved, false);
  assert.equal(local.local.getItem(MA), '0'); assert.equal(record(local.local).curve.up, false, 'sent on a later pass of A');
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

'use strict';
// 하루 행복도 단일 쓰기 1단계(docs/life-tools-design/happiness-single-writer.md "검사 계획").
// 계정 문서 happinessDays의 검증기·쓰기·이행·받아들이기·동률 맞추기, 기기 사이 병합, 합친 점.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStorage } = require('../assets/life/storage.js');
const Core = require('../assets/life/core.js');
const Sync = require('../assets/life/account-docs-sync.js');
const Model = require('../assets/platform-data.js');

const EPOCH = '1970-01-01T00:00:00.000Z';

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
      PAGE_LIMIT: 50, puts: 0,
      async put(request) {
        this.puts++;
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
  return { owners, docs, client };
}

const accountA = { projectUrl: 'https://happiness-test.supabase.co', userId: 'anonymous-a' };
const accountB = { projectUrl: 'https://happiness-test.supabase.co', userId: 'anonymous-b' };
const docKey = (account = accountA) => `happinessDays:${JSON.stringify([account.projectUrl, account.userId])}:days`;
function clock(start = '2026-11-04T00:00:00.000Z') {
  let at = Date.parse(start);
  const now = () => new Date(at).toISOString();
  now.advance = (ms = 1000) => { at += ms; };
  return now;
}
function device() {
  const adapter = memoryAdapter();
  return { ...adapter, base: createStorage({ idb: adapter.idb, core: Core, channelFactory: null }) };
}
function engine(store, server, owner = accountA, now = clock()) {
  const remote = server.client(owner.userId);
  const sync = Sync.create({ storage: store, auth: { getAccount: () => owner }, remote, polling: false, now, locks: null, debounceMs: 1e7 });
  sync.start();
  return { sync, remote };
}
function memoryLocal() {
  const map = new Map();
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k),
    key: i => [...map.keys()][i] ?? null, get length() { return map.size; }, map };
}
// One account's timelines in a device's localStorage (the editor's registry shape).
function timelines(local, uid, docs) {
  const k = Model.keys(uid);
  local.setItem(k.registry, JSON.stringify({ docs: docs.map(({ body, ...meta }) => meta), current: docs[0]?.id || null }));
  for (const doc of docs) local.setItem(k.docs + doc.id, JSON.stringify(doc.body));
}
const doc = (happiness, scale = 'signed1') => ({ profile: { name: '연표', birth: '1990-01' }, scale, events: [], spans: [], eras: [], happiness, thoughts: [], records: [], trips: [], layers: [] });
const entryOf = async (store, date) => (await store.readHappinessDays()).entries.find(entry => entry.date === date);
const absorb = (store, docId, points, stamp, account = accountA) => store.absorbTimelineDays({ account, docId, points, stamp });

// ── 검증기 ──
test('validator: real dates, range, one entry per date, src only on migrated values, newer format refused', async t => {
  const local = device(); t.after(() => local.base.close());
  const store = local.base.forAccount(accountA);
  await assert.rejects(store.writeHappinessDay('2026-02-30', 0.2), { code: 'invalid_request' });
  await assert.rejects(store.writeHappinessDay('2026-11-4', 0.2), { code: 'invalid_request' });
  await assert.rejects(store.writeHappinessDay('2026-11-04', 1.5), { code: 'invalid_request' });
  await assert.rejects(store.writeHappinessDay('2026-11-04', Number.NaN), { code: 'invalid_request' });
  const ok = await store.writeHappinessDay('2026-11-04', 0.456);
  assert.equal(ok.entry.v, 0.46, 'two decimals');
  const key = docKey(), record = await store.readAccountDocRecord(key);
  const apply = value => store.applyAccountDoc(key, { value, expectedHash: record.hash });
  const base = record.value;
  for (const [value, code] of [
    [{ ...base, entries: [...base.entries, { ...base.entries[0] }] }, 'invalid_happiness_days'], // duplicate date
    [{ ...base, entries: [{ date: '2026-11-05', v: 0.2, at: '2026-11-05T00:00:00.000Z', src: 'd1' }] }, 'invalid_happiness_days'], // src on a human value
    [{ ...base, entries: [{ date: '2026-11-05', v: 0.2, at: '2026-11-05T00:00:00.000Z', future: 'yes' }] }, 'invalid_happiness_days'],
    [{ ...base, migrated: [{ docId: 'd1', at: EPOCH, seenAt: null, localSeenAt: null, dates: { '2026-02-30': 0.1 } }] }, 'invalid_happiness_days'],
    [{ ...base, format: 2 }, 'app_refresh_required']
  ]) {
    const result = await apply(value);
    assert.equal(result.status, 'rejected'); assert.equal(result.error.code, code);
  }
  // The 2 MB limit is checked on the canonical JSON.
  const big = { ...base, migrated: Array.from({ length: 900 }, (_, i) => ({ docId: 'd' + i, at: EPOCH, seenAt: null, localSeenAt: null,
    dates: Object.fromEntries(Array.from({ length: 160 }, (_, j) => [new Date(Date.UTC(2000, 0, 1 + j)).toISOString().slice(0, 10), 0.11])) })) };
  assert.equal((await apply(big)).error.code, 'happiness_days_too_large');
  assert.deepEqual((await store.readHappinessDays()).entries.map(entry => entry.date), ['2026-11-04'], 'refused values change nothing');
});

test('a newer document format: this page neither writes nor absorbs and asks for a refresh', async t => {
  const local = device(); t.after(() => local.base.close());
  const store = local.base.forAccount(accountA);
  await store.writeHappinessDay('2026-11-03', 0.2);
  const key = docKey(), record = await store.readAccountDocRecord(key);
  // A newer release's row lands raw (e.g. a store write from that release).
  local.rows.get('meta').set(JSON.stringify(key), { key, value: { ...record.value, format: 2, revision: 9 } });
  await assert.rejects(store.writeHappinessDay('2026-11-04', 0.4), { code: 'app_refresh_required' });
  await assert.rejects(absorb(store, 'd1', { '2026-11-01': { v: 0.1 } }, { local: EPOCH }), { code: 'app_refresh_required' });
  assert.equal(local.rows.get('meta').get(JSON.stringify(key)).value.revision, 9, 'nothing written over it');
});

// ── 쓰기 API와 기기 사이 병합 ──
test('writeHappinessDay changes only that date; two tabs writing other dates both stay', async t => {
  const shared = device(); t.after(() => shared.base.close());
  const other = createStorage({ idb: shared.idb, core: Core, channelFactory: null }); t.after(() => other.close());
  const one = shared.base.forAccount(accountA), two = other.forAccount(accountA);
  // Real IndexedDB serializes two tabs' readwrite transactions (the browser test runs them at once);
  // this in-memory store does not, so here they take turns.
  await one.writeHappinessDay('2026-11-01', 0.2); await two.writeHappinessDay('2026-11-02', -0.4);
  await one.writeHappinessDay('2026-11-03', 0.6);
  assert.deepEqual((await two.readHappinessDays()).entries.map(e => [e.date, e.v]), [['2026-11-01', 0.2], ['2026-11-02', -0.4], ['2026-11-03', 0.6]]);
  const again = await one.writeHappinessDay('2026-11-03', 0.6);
  assert.equal(again.status, 'unchanged', 'the same value is not written twice');
  const cleared = await one.writeHappinessDay('2026-11-03', null);
  assert.equal(cleared.entry.v, null, 'clearing keeps a deletion mark');
  assert.ok(Date.parse(cleared.entry.at) > Date.parse((await one.readHappinessDays()).entries[0].at) - 1);
});

test('two devices: different dates both stay; the same date keeps the later edit and the loser is kept on the device; deletion vs value by time', async t => {
  const server = fakeServer(), mac = device(), phone = device();
  t.after(() => { mac.base.close(); phone.base.close(); });
  const a = mac.base.forAccount(accountA), b = phone.base.forAccount(accountA);
  const now = clock(), ma = engine(a, server, accountA, now), pb = engine(b, server, accountA, now);
  await a.writeHappinessDay('2026-11-01', 0.2); await b.writeHappinessDay('2026-11-02', 0.4);
  await ma.sync.syncNow(); now.advance(); await pb.sync.syncNow(); now.advance(); await ma.sync.syncNow();
  for (const store of [a, b]) assert.deepEqual((await store.readHappinessDays()).entries.map(e => e.date), ['2026-11-01', '2026-11-02']);
  // Same date on both: b edits later (its at is later).
  await a.writeHappinessDay('2026-11-03', -0.2);
  await new Promise(resolve => setTimeout(resolve, 5));
  await b.writeHappinessDay('2026-11-03', 0.8);
  await ma.sync.syncNow(); now.advance(); await pb.sync.syncNow(); now.advance(); await ma.sync.syncNow();
  for (const store of [a, b]) assert.equal((await entryOf(store, '2026-11-03')).v, 0.8);
  const kept = await b.listAccountDocRecoveries(docKey());
  assert.ok(kept.some(row => JSON.stringify(row.value).includes('-0.2')), 'the losing value is kept as a recovery copy on a device');
  // A deletion later than a value wins; a value later than a deletion wins.
  await b.writeHappinessDay('2026-11-01', 0.5);
  await new Promise(resolve => setTimeout(resolve, 5));
  await a.writeHappinessDay('2026-11-01', null);
  await pb.sync.syncNow(); now.advance(); await ma.sync.syncNow(); now.advance(); await pb.sync.syncNow();
  for (const store of [a, b]) assert.equal((await entryOf(store, '2026-11-01')).v, null);
});

test('schema 4 is recorded and an older device reads the change list again once', async t => {
  const local = device(); t.after(() => local.base.close());
  const store = local.base.forAccount(accountA);
  assert.equal(store.accountDocKinds.schema, 4);
  assert.ok(store.accountDocKinds.account.includes('happinessDays'));
  await store.writeAccountDocCursor(7);
  const k = JSON.stringify(`accountDocSchema:${JSON.stringify([accountA.projectUrl, accountA.userId])}`);
  local.rows.get('meta').set(k, { key: JSON.parse(k), value: 3 });
  assert.deepEqual(await store.upgradeAccountDocSchema(), { schema: 4, rewound: true });
  assert.deepEqual(await store.upgradeAccountDocSchema(), { schema: 4, rewound: false });
});

// ── 이행 ──
test('first migration: only dates the account lacks, at 1970 with src; the row records every daily point and the server time', async t => {
  const local = device(); t.after(() => local.base.close());
  const store = local.base.forAccount(accountA);
  await store.writeHappinessDay('2026-10-02', 0.9);          // already entered in 일정 D
  await store.writeHappinessDay('2026-10-03', null);         // already deleted
  const T = '2026-11-01T09:00:00.000Z';
  const result = await absorb(store, 'd1', { '2026-10-01': { v: 0.1 }, '2026-10-02': { v: -0.5 }, '2026-10-03': { v: 0.3 }, '2026-10-04': { v: 0.2, future: true } }, { server: T });
  assert.deepEqual([result.status, result.added, result.overlap], ['migrated', 2, 2]);
  const value = await store.readHappinessDays();
  assert.deepEqual(value.entries.map(e => [e.date, e.v, e.at === EPOCH, e.src ?? null, !!e.future]),
    [['2026-10-01', 0.1, true, 'd1', false], ['2026-10-02', 0.9, false, null, false], ['2026-10-03', null, false, null, false], ['2026-10-04', 0.2, true, 'd1', true]]);
  assert.deepEqual(value.migrated, [{ docId: 'd1', at: T, seenAt: T, localSeenAt: null,
    dates: { '2026-10-01': 0.1, '2026-10-02': -0.5, '2026-10-03': 0.3, '2026-10-04': 0.2 } }], 'moved and skipped dates are both recorded');
  // Repeating the same version writes nothing.
  const revision = value.revision;
  assert.equal((await absorb(store, 'd1', { '2026-10-01': { v: 0.1 }, '2026-10-02': { v: -0.5 }, '2026-10-03': { v: 0.3 }, '2026-10-04': { v: 0.2, future: true } }, { server: T })).status, 'unchanged');
  assert.equal((await store.readHappinessDays()).revision, revision);
});

test('migration on two devices: same version converges without recovery copies; a real edit elsewhere beats a migrated value', async t => {
  const server = fakeServer(), mac = device(), phone = device();
  t.after(() => { mac.base.close(); phone.base.close(); });
  const a = mac.base.forAccount(accountA), b = phone.base.forAccount(accountA);
  const now = clock(), ma = engine(a, server, accountA, now), pb = engine(b, server, accountA, now);
  const T = '2026-11-01T09:00:00.000Z', points = { '2026-10-01': { v: 0.1 }, '2026-10-02': { v: 0.2 } };
  await absorb(a, 'd1', points, { server: T }); await absorb(b, 'd1', points, { server: T });
  await b.writeHappinessDay('2026-10-02', -0.7); // phone corrects a migrated day
  await ma.sync.syncNow(); now.advance(); await pb.sync.syncNow(); now.advance(); await ma.sync.syncNow();
  for (const store of [a, b]) {
    const value = await store.readHappinessDays();
    assert.deepEqual(value.entries.map(e => [e.date, e.v]), [['2026-10-01', 0.1], ['2026-10-02', -0.7]]);
    assert.equal(value.migrated.length, 1);
  }
  assert.equal((await a.listAccountDocRecoveries(docKey())).length, 0, 'identical migrations leave no recovery copy');
  assert.equal((await entryOf(a, '2026-10-02')).src, undefined, 'the human edit carries no src');
});

test('happinessSources: unsent, unknown and server-listed timelines wait; never-sent ones use their device time; recovery copies are skipped', () => {
  const read = id => ({ d1: doc([{ date: '2026-10-01', v: 0.1 }]), d2: doc([]), d3: doc([]), d4: doc([]), d5: doc([]), d6: doc([]) })[id] || null;
  const reg = { docs: [
    { id: 'd1', name: '연표', updated: '2026-11-01T00:00:00.000Z', syncedAt: '2026-11-01T00:00:00.000Z' },
    { id: 'd2', name: '바뀜', updated: '2026-11-02T00:00:00.000Z', syncedAt: '2026-11-01T00:00:00.000Z' }, // unsent change
    { id: 'd3', name: '처음', updated: '2026-11-03T00:00:00.000Z' },                                         // never sent
    { id: 'd4', name: '모름', updated: '2026-11-03T00:00:00.000Z' },                                         // on the server, registry save failed
    { id: 'd5', name: '연표 복구 사본', updated: '2026-11-03T00:00:00.000Z', syncedAt: '2026-11-03T00:00:00.000Z' },
    { id: 'd6', name: '새 문서' }                                                                             // no updated yet
  ] };
  const withList = Model.happinessSources(reg, { read, serverIds: new Set(['d1', 'd2', 'd4']) });
  assert.deepEqual(withList.ready.map(r => [r.id, r.stamp]), [['d1', { server: '2026-11-01T00:00:00.000Z' }], ['d3', { local: '2026-11-03T00:00:00.000Z' }], ['d6', { local: EPOCH }]]);
  assert.deepEqual(withList.waiting, [{ id: 'd2', reason: 'unsent' }, { id: 'd4', reason: 'unknown' }]);
  const offline = Model.happinessSources(reg, { read, serverIds: null });
  assert.deepEqual(offline.ready.map(r => r.id), ['d1'], 'without a server list, never-sent timelines wait');
});

test('timelineDays: signed1 two decimals, the last of a date, future kept, months ignored, old scales converted', () => {
  assert.deepEqual(Model.timelineDays(doc([{ date: '2026-10-01', v: 0.1 }, { date: '2026-10-01', v: 0.333 }, { date: '2026-10', v: 0.5 }, { date: '2026-10-02', v: -0.2, future: true }])),
    { '2026-10-01': { v: 0.33 }, '2026-10-02': { v: -0.2, future: true } });
  assert.deepEqual(Model.timelineDays(doc([{ date: '2026-10-01', v: 7 }], null)), { '2026-10-01': { v: 0.4 } }, 'scale-less (0–10)');
  assert.deepEqual(Model.timelineDays(doc([{ date: '2026-10-01', v: -3 }], 'signed10')), { '2026-10-01': { v: -0.3 } });
});

test('no server timelines: a never-sent local timeline migrates (seenAt null, device time), and after it is sent the old-editor change is absorbed even with a device clock ahead', async t => {
  const local = device(); t.after(() => local.base.close());
  const store = local.base.forAccount(accountA), ls = memoryLocal(), uid = accountA.userId;
  // Device clock 1 hour ahead of the server.
  const ahead = '2026-11-04T10:00:00.000Z';
  timelines(ls, uid, [{ id: 'd1', name: '연표', updated: ahead, body: doc([{ date: '2026-10-01', v: 0.1 }]) }]);
  const pass = () => Model.absorbHappiness({ storage: store, localStorage: ls, uid, account: accountA, serverIds: new Set() });
  await pass();
  assert.deepEqual((await store.readHappinessDays()).migrated, [{ docId: 'd1', at: EPOCH, seenAt: null, localSeenAt: ahead, dates: { '2026-10-01': 0.1 } }]);
  // An old editor then changes a day and sends the timeline: the server time is earlier than the device's.
  const T = '2026-11-04T09:01:00.000Z';
  timelines(ls, uid, [{ id: 'd1', name: '연표', updated: T, syncedAt: T, body: doc([{ date: '2026-10-01', v: 0.6 }]) }]);
  const result = await pass();
  assert.equal(result.results[0].status, 'absorbed');
  const value = await store.readHappinessDays();
  assert.deepEqual([value.entries[0].v, value.entries[0].at], [0.6, T], 'absorbed although the server time is earlier than the device time');
  assert.deepEqual([value.migrated[0].seenAt, value.migrated[0].localSeenAt, value.migrated[0].at], [T, null, T]);
});

test('a never-sent timeline without updated migrates at 1970; the next save makes later old-editor changes newer', async t => {
  const local = device(); t.after(() => local.base.close());
  const store = local.base.forAccount(accountA), ls = memoryLocal(), uid = accountA.userId;
  timelines(ls, uid, [{ id: 'd1', name: '새 문서', body: doc([{ date: '2026-10-01', v: 0.1 }]) }]);
  const pass = () => Model.absorbHappiness({ storage: store, localStorage: ls, uid, account: accountA, serverIds: new Set() });
  await pass();
  assert.equal((await store.readHappinessDays()).migrated[0].localSeenAt, EPOCH);
  timelines(ls, uid, [{ id: 'd1', name: '새 문서', updated: '2026-11-04T01:00:00.000Z', body: doc([{ date: '2026-10-01', v: 0.1 }, { date: '2026-10-05', v: 0.7 }]) }]);
  await pass();
  assert.equal((await entryOf(store, '2026-10-05')).v, 0.7);
});

test('unsent, unknown and offline timelines are not migrated; the pre-account list is out of scope', async t => {
  const local = device(); t.after(() => local.base.close());
  const store = local.base.forAccount(accountA), ls = memoryLocal(), uid = accountA.userId;
  timelines(ls, uid, [
    { id: 'd1', name: '바뀜', updated: '2026-11-02T00:00:00.000Z', syncedAt: '2026-11-01T00:00:00.000Z', body: doc([{ date: '2026-10-01', v: 0.1 }]) },
    { id: 'd2', name: '모름', updated: '2026-11-02T00:00:00.000Z', body: doc([{ date: '2026-10-02', v: 0.2 }]) }
  ]);
  ls.setItem('caeyeon_life_registry', JSON.stringify({ docs: [{ id: 'old', name: '옛 연표' }] }));
  ls.setItem('caeyeon_life_doc_old', JSON.stringify(doc([{ date: '2026-10-03', v: 0.3 }])));
  const offline = await Model.absorbHappiness({ storage: store, localStorage: ls, uid, account: accountA, serverIds: null });
  assert.equal(offline.results.length, 0);
  const listed = await Model.absorbHappiness({ storage: store, localStorage: ls, uid, account: accountA, serverIds: new Set(['d2']) });
  assert.equal(listed.results.length, 0);
  assert.deepEqual(listed.waiting.map(w => w.reason), ['unsent', 'unknown']);
  assert.equal((await store.readHappinessDays()).revision, 0, 'nothing written');
});

test('a pass begun for another account writes nothing', async t => {
  const local = device(); t.after(() => local.base.close());
  const store = local.base.forAccount(accountA);
  await assert.rejects(absorb(store, 'd1', { '2026-10-01': { v: 0.1 } }, { server: '2026-11-01T00:00:00.000Z' }, accountB), { code: 'account_changed' });
  assert.equal((await store.readHappinessDays()).revision, 0);
});

test('two timelines with different values on a date: the smaller id stays, the overlap is counted, and rereading either writes nothing', async t => {
  const local = device(); t.after(() => local.base.close());
  const store = local.base.forAccount(accountA), ls = memoryLocal(), uid = accountA.userId;
  const T = '2026-11-01T00:00:00.000Z';
  timelines(ls, uid, [
    { id: 'dB', name: 'B', updated: T, syncedAt: T, body: doc([{ date: '2026-10-01', v: -0.5 }]) },
    { id: 'dA', name: 'A', updated: T, syncedAt: T, body: doc([{ date: '2026-10-01', v: 0.5 }]) }
  ]);
  const pass = () => Model.absorbHappiness({ storage: store, localStorage: ls, uid, account: accountA, serverIds: new Set(['dA', 'dB']) });
  const first = await pass();
  assert.deepEqual(first.results.map(r => [r.id, r.status, r.overlap]), [['dA', 'migrated', 0], ['dB', 'migrated', 1]]);
  const revision = (await store.readHappinessDays()).revision;
  for (let i = 0; i < 4; i++) await pass();
  const value = await store.readHappinessDays();
  assert.equal(value.revision, revision, 'repeated reads write nothing');
  assert.deepEqual([value.entries[0].v, value.entries[0].src], [0.5, 'dA']);
});

test('a recovery-copy timeline is not migrated', async t => {
  const local = device(); t.after(() => local.base.close());
  const store = local.base.forAccount(accountA), ls = memoryLocal(), uid = accountA.userId, T = '2026-11-01T00:00:00.000Z';
  timelines(ls, uid, [{ id: 'd1', name: '연표 복구 사본', updated: T, syncedAt: T, body: doc([{ date: '2026-10-01', v: 0.5 }]) }]);
  await Model.absorbHappiness({ storage: store, localStorage: ls, uid, account: accountA, serverIds: new Set(['d1']) });
  assert.equal((await store.readHappinessDays()).revision, 0);
});

test('a migrated date corrected in 일정 D stays through the same and a newer timeline version, without src', async t => {
  const local = device(); t.after(() => local.base.close());
  const store = local.base.forAccount(accountA);
  const T1 = '2026-11-01T00:00:00.000Z', T2 = '2026-11-02T00:00:00.000Z';
  await absorb(store, 'd1', { '2026-10-01': { v: 0.1 }, '2026-10-02': { v: 0.2 } }, { server: T1 });
  await store.writeHappinessDay('2026-10-01', 0.9);
  await absorb(store, 'd1', { '2026-10-01': { v: 0.1 }, '2026-10-02': { v: 0.2 } }, { server: T1 });
  await absorb(store, 'd1', { '2026-10-01': { v: 0.1 }, '2026-10-02': { v: 0.2 }, '2026-10-03': { v: 0.3 } }, { server: T2 });
  const entry = await entryOf(store, '2026-10-01');
  assert.deepEqual([entry.v, entry.src], [0.9, undefined]);
  assert.equal((await entryOf(store, '2026-10-03')).v, 0.3);
});

// ── 섞인 판: 옛 편집기의 하루 점 받아들이기 ──
test('old editor: new and changed days are absorbed, deletions and skipped dates are not, and a later 일정 D value is never overwritten', async t => {
  const local = device(); t.after(() => local.base.close());
  const store = local.base.forAccount(accountA);
  const T1 = '2026-11-01T00:00:00.000Z', T2 = '2026-11-02T00:00:00.000Z';
  await store.writeHappinessDay('2026-10-09', 0.9); // exists before migration → skipped
  await absorb(store, 'd1', { '2026-10-01': { v: 0.1 }, '2026-10-02': { v: 0.2 }, '2026-10-09': { v: -0.9 } }, { server: T1 });
  // After T2 a human edit in 일정 D (its at is now, later than T2's absorb below? no: write first, then absorb older T2).
  const result = await absorb(store, 'd1', { '2026-10-01': { v: 0.6 }, '2026-10-03': { v: 0.3 }, '2026-10-09': { v: -0.9 } }, { server: T2 });
  assert.equal(result.accepted, 2);
  const value = await store.readHappinessDays();
  assert.deepEqual(value.entries.map(e => [e.date, e.v]), [['2026-10-01', 0.6], ['2026-10-02', 0.2], ['2026-10-03', 0.3], ['2026-10-09', 0.9]],
    'changed and new days absorbed; the deleted day stays; the skipped date keeps the 일정 D value');
  assert.equal(value.entries[0].at, T2);
  assert.equal(value.entries[0].src, undefined, 'an absorbed value carries no src');
  assert.deepEqual(value.migrated[0].dates, { '2026-10-01': 0.6, '2026-10-03': 0.3, '2026-10-09': -0.9 });
  // 일정 D edits a day after T2; the editor then saves (T3) without touching that day: it stays.
  await store.writeHappinessDay('2026-10-03', -0.1);
  const T3 = '2026-11-03T00:00:00.000Z';
  await absorb(store, 'd1', { '2026-10-01': { v: 0.6 }, '2026-10-03': { v: 0.3 }, '2026-10-09': { v: -0.9 }, '2026-10-10': { v: 0.1 } }, { server: T3 });
  assert.equal((await entryOf(store, '2026-10-03')).v, -0.1);
});

test('absorbing writes only when an entry is absent or older than T; skipping still records the version; no change → no write', async t => {
  const local = device(); t.after(() => local.base.close());
  const store = local.base.forAccount(accountA);
  const T1 = '2026-11-01T00:00:00.000Z', T2 = '2026-11-02T00:00:00.000Z';
  await absorb(store, 'd1', { '2026-10-01': { v: 0.1 } }, { server: T1 });
  // A 일정 D value later than T2 (its at is the real clock, after 2026-11-02).
  await store.writeHappinessDay('2026-10-01', 0.5);
  const result = await absorb(store, 'd1', { '2026-10-01': { v: -0.3 } }, { server: T2 });
  assert.deepEqual([result.status, result.accepted], ['absorbed', 0]);
  const value = await store.readHappinessDays();
  assert.equal(value.entries[0].v, 0.5);
  assert.deepEqual([value.migrated[0].dates, value.migrated[0].seenAt], [{ '2026-10-01': -0.3 }, T2], 'the skipped version is still recorded');
  const revision = value.revision;
  assert.equal((await absorb(store, 'd1', { '2026-10-01': { v: -0.3 } }, { server: '2026-11-03T00:00:00.000Z' })).status, 'unchanged');
  assert.equal((await store.readHappinessDays()).revision, revision, 'a newer time alone writes nothing');
  assert.equal((await absorb(store, 'd1', { '2026-10-01': { v: 0.7 } }, { server: T1 })).status, 'stale', 'an older version is not read again');
});

test('overwriting a human value keeps a recovery copy; overwriting a migrated value does not', async t => {
  const local = device(); t.after(() => local.base.close());
  const store = local.base.forAccount(accountA);
  await absorb(store, 'd1', { '2026-10-01': { v: 0.1 }, '2026-10-02': { v: 0.2 } }, { server: '2026-11-01T00:00:00.000Z' });
  // A human value with an old time (from a device whose clock is behind).
  const key = docKey(), record = await store.readAccountDocRecord(key);
  const value = structuredClone(record.value);
  value.entries[0] = { date: '2026-10-01', v: 0.8, at: '2026-11-01T00:30:00.000Z' };
  assert.equal((await store.applyAccountDoc(key, { value, expectedHash: record.hash })).status, 'applied');
  await absorb(store, 'd1', { '2026-10-01': { v: -0.2 }, '2026-10-02': { v: -0.4 } }, { server: '2026-11-02T00:00:00.000Z' });
  assert.deepEqual((await store.readHappinessDays()).entries.map(e => e.v), [-0.2, -0.4]);
  const kept = await store.listAccountDocRecoveries(key);
  assert.equal(kept.length, 1);
  assert.deepEqual(kept[0].value.items.map(e => [e.date, e.v]), [['2026-10-01', 0.8]]);
});

test('tie alignment: a device with the newer version aligns its timeline\'s 1970 values; values from another timeline are left alone', async t => {
  const local = device(); t.after(() => local.base.close());
  const store = local.base.forAccount(accountA), key = docKey();
  const T2 = '2026-11-02T00:00:00.000Z';
  // As after a concurrent migration of R1 (one device) and R2 (another): R2's row won, R1's values won.
  const record = await store.readAccountDocRecord(key);
  const value = { revision: 3, format: 1,
    entries: [{ date: '2026-10-01', v: 0.1, at: EPOCH, src: 'd1' }, { date: '2026-10-02', v: 0.5, at: EPOCH, src: 'd0' }],
    migrated: [{ docId: 'd1', at: T2, seenAt: T2, localSeenAt: null, dates: { '2026-10-01': 0.4, '2026-10-02': -0.5 } },
      { docId: 'd0', at: T2, seenAt: T2, localSeenAt: null, dates: { '2026-10-02': 0.5 } }] };
  assert.equal((await store.applyAccountDoc(key, { value, expectedHash: record.hash })).status, 'applied');
  const result = await absorb(store, 'd1', { '2026-10-01': { v: 0.4 }, '2026-10-02': { v: -0.5 } }, { server: T2 });
  assert.equal(result.aligned, 1);
  const after = await store.readHappinessDays();
  assert.deepEqual(after.entries.map(e => [e.date, e.v, e.at, e.src]), [['2026-10-01', 0.4, EPOCH, 'd1'], ['2026-10-02', 0.5, EPOCH, 'd0']]);
  assert.equal((await absorb(store, 'd1', { '2026-10-01': { v: 0.4 }, '2026-10-02': { v: -0.5 } }, { server: T2 })).status, 'unchanged');
  assert.equal((await absorb(store, 'd0', { '2026-10-02': { v: 0.5 } }, { server: T2 })).status, 'unchanged');
});

test('a value changed only in scale is not a change; an old editor drag adds the new date and keeps the old one; future-only edits are not absorbed', async t => {
  const local = device(); t.after(() => local.base.close());
  const store = local.base.forAccount(accountA), ls = memoryLocal(), uid = accountA.userId;
  const T1 = '2026-11-01T00:00:00.000Z', T2 = '2026-11-02T00:00:00.000Z', T3 = '2026-11-03T00:00:00.000Z';
  timelines(ls, uid, [{ id: 'd1', name: '연표', updated: T1, syncedAt: T1, body: doc([{ date: '2026-10-01', v: 7 }], null) }]);
  const pass = () => Model.absorbHappiness({ storage: store, localStorage: ls, uid, account: accountA, serverIds: new Set(['d1']) });
  await pass();
  assert.equal((await entryOf(store, '2026-10-01')).v, 0.4);
  // The editor converted the timeline to signed1 (7 → 0.4): no change.
  timelines(ls, uid, [{ id: 'd1', name: '연표', updated: T2, syncedAt: T2, body: doc([{ date: '2026-10-01', v: 0.4 }]) }]);
  const revision = (await store.readHappinessDays()).revision;
  assert.equal((await pass()).results[0].status, 'unchanged');
  assert.equal((await store.readHappinessDays()).revision, revision);
  // Dragged to the 5th (old editor): the 5th is added, the 1st stays.
  timelines(ls, uid, [{ id: 'd1', name: '연표', updated: T3, syncedAt: T3, body: doc([{ date: '2026-10-05', v: 0.4, future: true }]) }]);
  await pass();
  assert.deepEqual((await store.readHappinessDays()).entries.map(e => e.date), ['2026-10-01', '2026-10-05']);
  // Only the future flag changed: not absorbed (dates compare values only).
  const T4 = '2026-11-04T00:00:00.000Z';
  timelines(ls, uid, [{ id: 'd1', name: '연표', updated: T4, syncedAt: T4, body: doc([{ date: '2026-10-05', v: 0.4 }]) }]);
  assert.equal((await pass()).results[0].status, 'unchanged');
  assert.equal((await entryOf(store, '2026-10-05')).future, true);
});

// ── 합친 점 ──
test('curvePoints: the account document hides daily points (a deletion too), keeps months and the future flag, converts the scale; copies only', () => {
  const timeline = doc([{ date: '2026-10', v: 0.3 }, { date: '2026-10-01', v: 0.1 }, { date: '2026-10-02', v: 0.2 }, { date: '2026-10-03', v: 0.4, future: true }]);
  const entries = [{ date: '2026-10-01', v: 0.9, at: EPOCH, src: 'd1' }, { date: '2026-10-02', v: null, at: '2026-11-01T00:00:00.000Z' },
    { date: '2026-10-07', v: -0.5, at: '2026-11-01T00:00:00.000Z', future: true }];
  const points = Model.curvePoints(timeline, entries);
  assert.deepEqual(points.map(p => [p.date, p.v, p.future, p.day, p.account]),
    [['2026-10', 0.3, false, false, false], ['2026-10-03', 0.4, true, true, false], ['2026-10-01', 0.9, false, true, true], ['2026-10-07', -0.5, true, true, true]]);
  points[0].v = 99;
  assert.equal(timeline.happiness[0].v, 0.3, 'the result is a copy of the values, the timeline is untouched');
  const old = doc([{ date: '2026-10', v: 7 }, { date: '2026-10-04', v: 3 }], null);
  assert.deepEqual(Model.curvePoints(old, []).map(p => p.v), [0.4, -0.4]);
  assert.deepEqual(Model.curvePoints(timeline, null).length, 4, 'no account document: the timeline points as they are');
});

test('happinessFor: the account entry first (a deletion shows nothing), else a daily point still only in the timeline', () => {
  const timeline = doc([{ date: '2026-10-01', v: 0.2 }, { date: '2026-10-02', v: 0.4 }]);
  const entries = [{ date: '2026-10-01', v: 0.8, at: EPOCH }, { date: '2026-10-03', v: null, at: EPOCH }];
  assert.deepEqual(Model.happinessFor(entries, timeline, '2026-10-01'), { v: 0.8, score: 9, account: true });
  assert.deepEqual(Model.happinessFor(entries, timeline, '2026-10-02'), { v: 0.4, score: 7 });
  assert.equal(Model.happinessFor(entries, timeline, '2026-10-03'), null);
});

// Review MINOR-4: a row recorded from a server version is not read again with a device time (an older
// page, or a registry whose syncedAt was lost): stale, nothing written.
test('a timeline recorded from its server version refuses a device-time pass', async t => {
  const local = device(); t.after(() => local.base.close());
  const store = local.base.forAccount(accountA);
  await absorb(store, 'd1', { '2026-10-01': { v: 0.1 } }, { server: '2026-11-01T00:00:00.000Z' });
  const revision = (await store.readHappinessDays()).revision;
  const result = await absorb(store, 'd1', { '2026-10-01': { v: 0.9 }, '2026-10-02': { v: 0.5 } }, { local: '2026-12-01T00:00:00.000Z' });
  assert.equal(result.status, 'stale');
  const value = await store.readHappinessDays();
  assert.equal(value.revision, revision);
  assert.deepEqual(value.entries.map(e => [e.date, e.v]), [['2026-10-01', 0.1]]);
});

test('validator: at most 1000 migrated rows', async t => {
  const local = device(); t.after(() => local.base.close());
  const store = local.base.forAccount(accountA), key = docKey(), record = await store.readAccountDocRecord(key);
  const rows = n => Array.from({ length: n }, (_, i) => ({ docId: 'd' + i, at: EPOCH, seenAt: null, localSeenAt: null, dates: {} }));
  const base = { revision: 1, format: 1, entries: [] };
  assert.equal((await store.applyAccountDoc(key, { value: { ...base, migrated: rows(1001) }, expectedHash: record.hash })).error.code, 'invalid_happiness_days');
  assert.equal((await store.applyAccountDoc(key, { value: { ...base, migrated: rows(1000) }, expectedHash: record.hash })).status, 'applied');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const model = require('../assets/platform-data.js');
const data = require('../assets/data.js');
const Sync = require('../assets/sync.js');
const script = fs.readFileSync(require.resolve('../assets/platform-store.js'), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const changed = value => { assert.equal(value.code, 'account_changed'); return true; };
const goal = (id, progress) => ({ id, kind: 'goal', data: { title: '익명 검증', progress, target: '' } });
const doc = count => ({ profile: { name: '익명 연표', birth: '1990-01' },
  events: Array.from({ length: count }, (_, i) => ({ date: '2020-01', title: '검증 ' + i })), spans: [] });
const response = rows => ({ ok: true, status: 200, async json() { return rows; } });

function fixture(t, request) {
  const values = new Map(), listeners = new Map(), notices = [];
  const local = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key), get length() { return values.size; }, key: index => [...values.keys()][index] };
  const auth = { user: { id: 'A' }, epoch: 0, config: { url: 'https://test.supabase.co' }, request };
  const context = { HaedoPlatformData: model, HaedoAuth: auth, HaedoData: data, HaedoSync: Sync,
    localStorage: local, structuredClone, Event, Date, setTimeout, clearTimeout, addEventListener() {},
    document: { hidden: false, addEventListener: (name, listener) => listeners.set(name, listener),
      dispatchEvent: event => notices.push({ type: event.type, owner: auth.user?.id }) } };
  vm.runInNewContext(script, context);
  const store = context.HaedoPlatformStore.init('A');
  function logout() { auth.user = null; auth.epoch++; listeners.get('haedo:signed-out')(); }
  function switchTo(id) { auth.user = { id }; auth.epoch++; store.init(id); }
  t.after(logout);
  return { store, auth, local, values, notices, logout, switchTo };
}

test('old pull cannot populate B and its finally cannot unlock an already running B pull', async t => {
  const heldA = deferred(), heldB = deferred(); let h, requests = 0;
  h = fixture(t, async () => {
    requests++; const owner = h.auth.user.id;
    await (owner === 'A' ? heldA.promise : heldB.promise);
    return response([{ ...goal('remote-' + owner, owner === 'A' ? 10 : 20), updated_at: '2026-10-03T00:00:00Z' }]);
  });
  const pullingA = h.store.pull(), rejected = assert.rejects(pullingA, changed);
  h.switchTo('B'); const pullingB = h.store.pull(); const before = [...h.values], notices = h.notices.length;
  heldA.resolve(); await rejected;
  assert.deepEqual([...h.values], before); assert.equal(h.notices.length, notices);
  await h.store.pull(); assert.equal(requests, 2);
  heldB.resolve(); await pullingB;
  assert.deepEqual(Array.from(h.store.items, item => item.id), ['remote-B']);
  assert.equal(h.local.getItem(model.keys('A').items), null);
});

test('syncDocuments rejects a former owner response even when account changes while JSON is being read', async t => {
  const json = deferred(), started = deferred();
  const h = fixture(t, async () => ({ ok: true, async json() { started.resolve(); return json.promise; } }));
  const syncing = h.store.syncDocuments(), rejected = assert.rejects(syncing, changed); await started.promise;
  h.switchTo('B'); const before = [...h.values], notices = h.notices.length;
  json.resolve([{ id: 'remote-A', name: '익명 연표', data: doc(2), updated_at: '2026-10-03T00:00:00Z' }]);
  await rejected; assert.deepEqual([...h.values], before); assert.equal(h.notices.length, notices);
});

test('old queue cannot POST its former owner body with B auth or mark a same-ID B item as an error', async t => {
  const json = deferred(), started = deferred(); let h, held = true; const writes = [];
  h = fixture(t, async (_url, options = {}) => {
    if (!options.method && held) { held = false; return { ok: true, async json() { started.resolve(); return json.promise; } }; }
    if (!options.method) return response([]);
    writes.push({ owner: h.auth.user.id, body: JSON.parse(options.body) });
    return response([{ updated_at: '2026-10-03T00:00:01Z' }]);
  });
  h.store.change('same-id', 'goal', goal('same-id', 10).data);
  const flushing = h.store.flush(), rejected = assert.rejects(flushing, changed); await started.promise;
  h.switchTo('B'); h.store.change('same-id', 'goal', goal('same-id', 80).data);
  const before = h.local.getItem(model.keys('B').items), notices = h.notices.length;
  json.resolve([]); await rejected;
  assert.equal(writes.length, 0); assert.equal(h.local.getItem(model.keys('B').items), before);
  assert.equal(h.notices.length, notices); assert.equal(h.store.items[0].state, 'sync');
  await h.store.flush(); assert.equal(writes.length, 1);
  assert.equal(writes[0].owner, 'B'); assert.equal(writes[0].body[0].user_id, 'B');
  assert.equal(writes[0].body[0].data.progress, 80);
});

test('a late document upload receipt does not update either registry after B has initialized', async t => {
  const held = deferred(), started = deferred();
  const h = fixture(t, async (_url, options = {}) => {
    if (!options.method) return response([]);
    started.resolve(); await held.promise; return response([{ updated_at: '2026-10-03T00:00:02Z' }]);
  });
  model.importDocs(h.local, 'A', doc(1), () => 'same-doc');
  model.importDocs(h.local, 'B', doc(3), () => 'same-doc');
  const upload = h.store.uploadDocuments(['same-doc']), rejected = assert.rejects(upload, changed); await started.promise;
  h.switchTo('B'); const before = [...h.values], notices = h.notices.length;
  held.resolve(); await rejected;
  assert.deepEqual([...h.values], before); assert.equal(h.notices.length, notices);
});

test('late conflict JSON does not replace a new owner same-ID item or schedule its old data', async t => {
  const json = deferred(), started = deferred();
  const h = fixture(t, async () => ({ ok: true, async json() { started.resolve(); return json.promise; } }));
  h.store.change('same-id', 'goal', goal('same-id', 10).data);
  const resolving = h.store.resolve('same-id', 'remote'), rejected = assert.rejects(resolving, changed); await started.promise;
  h.switchTo('B'); h.store.change('same-id', 'goal', goal('same-id', 80).data);
  const before = [...h.values], notices = h.notices.length;
  json.resolve([{ ...goal('same-id', 99), updated_at: '2026-10-03T00:00:02Z' }]); await rejected;
  assert.deepEqual([...h.values], before); assert.equal(h.notices.length, notices);
  assert.equal(h.store.items[0].data.progress, 80);
});

test('captureAccount invalidates an old import/create handler across A to B to A without changing source copies', t => {
  const h = fixture(t, async () => response([])); const check = h.store.captureAccount();
  model.importDocs(h.local, 'A', doc(2), () => 'existing'); const before = [...h.values];
  h.switchTo('B'); h.switchTo('A');
  assert.throws(check, changed); assert.deepEqual([...h.values], before);
  const fresh = h.store.captureAccount(); fresh(); h.auth.epoch++;
  assert.throws(fresh, changed); // Logout/login with the same uid also invalidates pending file reads.
});

test('backup and items fail closed before reinitialization and a damaged B copy cannot expose prior A memory', t => {
  const h = fixture(t, async () => response([]));
  h.store.change('private-A', 'goal', goal('private-A', 20).data);
  h.auth.user = { id: 'B' }; h.auth.epoch++;
  assert.equal(h.store.items.length, 0); assert.throws(() => h.store.backup(), changed);
  h.local.setItem(model.keys('B').items, '{'); const before = [...h.values];
  assert.throws(() => h.store.init('B')); assert.equal(h.store.items.length, 0);
  assert.throws(() => h.store.backup(), changed); assert.deepEqual([...h.values], before);
});

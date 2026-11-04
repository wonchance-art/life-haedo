'use strict';
// B2 (2026-11-04): goals, habits and timeline documents follow the 11-01 owner rule. When both
// sides changed, the newest edit wins and the other side is kept: losing items in the account's
// recovery list (caeyeon_life_account_<uid>_items_recovery), losing documents as
// "<이름> 복구 사본". The fake server stamps updated_at itself (like the haedo_stamp trigger) and
// applies the conditional PATCH, so conflicts here are real compare-and-set failures.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const model = require('../assets/platform-data.js');
const data = require('../assets/data.js');
const Sync = require('../assets/sync.js');
const script = fs.readFileSync(require.resolve('../assets/platform-store.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function server() {
  const tables = { haedo_items: new Map(), haedo_documents: new Map() };
  let clock = Date.parse('2026-11-04T00:00:00.000Z');
  const calls = [];
  const stamp = () => new Date(clock += 1000).toISOString();
  const json = rows => ({ ok: true, status: 200, async json() { return plain(rows); } });
  async function request(url, options = {}) {
    const u = new URL(url), table = u.pathname.split('/').pop(), rows = tables[table];
    const id = u.searchParams.get('id')?.replace(/^eq\./, ''), seen = u.searchParams.get('updated_at')?.replace(/^eq\./, '');
    calls.push({ method: options.method || 'GET', table, id: id || null });
    if (server.hold) await server.hold;
    if (!options.method) return json(id ? (rows.has(id) ? [rows.get(id)] : []) : [...rows.values()]);
    const body = JSON.parse(options.body);
    if (options.method === 'POST') {
      const row = { ...body[0], updated_at: stamp() };
      if (rows.has(row.id)) return { ok: false, status: 409, async json() { return {}; } };
      rows.set(row.id, row); return json([row]);
    }
    if (options.method === 'PATCH') {
      const row = rows.get(id);
      if (!row || row.updated_at !== seen) return json([]);
      const next = { ...row, ...body, updated_at: stamp() }; rows.set(id, next); return json([next]);
    }
    throw new Error('unexpected ' + options.method);
  }
  const server = { tables, calls, request, stamp, hold: null,
    // Another device's write, stamped now (later than every earlier server write).
    write(table, row) { const next = { ...row, user_id: 'A', updated_at: stamp() }; tables[table].set(row.id, next); return next; },
    advance(ms) { clock += ms; } };
  return server;
}

function fixture(t, cloud, { failRecovery = false } = {}) {
  const values = new Map(), listeners = new Map();
  const local = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { if (failRecovery && key.endsWith('_items_recovery')) throw new Error('quota'); values.set(key, value); },
    removeItem: key => values.delete(key), get length() { return values.size; }, key: index => [...values.keys()][index] };
  const auth = { user: { id: 'A' }, epoch: 0, config: { url: 'https://test.supabase.co' }, request: (url, options) => cloud.request(url, options) };
  const context = { HaedoPlatformData: model, HaedoAuth: auth, HaedoData: data, HaedoSync: Sync, localStorage: local, structuredClone, Event, Date,
    setTimeout, clearTimeout, addEventListener() {}, crypto: globalThis.crypto,
    document: { hidden: false, addEventListener: (name, listener) => listeners.set(name, listener), dispatchEvent() {} } };
  vm.runInNewContext(script, context);
  const store = context.HaedoPlatformStore.init('A');
  const logout = () => { auth.user = null; auth.epoch++; listeners.get('haedo:signed-out')(); };
  t.after(() => { if (auth.user) logout(); });
  return { store, auth, values, local, logout, context,
    recovery: () => JSON.parse(values.get(model.keys('A').recovery) || '[]'),
    registry: () => model.registry(local, 'A'),
    doc: id => JSON.parse(values.get(model.keys('A').docs + id)) };
}
const goal = progress => ({ title: '익명 목표', progress, target: '' });
const habit = checks => ({ title: '익명 습관', days: [0, 1, 2, 3, 4, 5, 6], created: '2026-11-01', checks });

async function syncedGoal(h, cloud, progress = 10) {
  const id = h.store.change(null, 'goal', goal(progress));
  await h.store.flush();
  assert.equal(h.store.items[0].state, 'ok');
  return id;
}

test('pull: when the server copy is newer it wins and the local edit is kept in recovery first', async t => {
  const cloud = server(), h = fixture(t, cloud), id = await syncedGoal(h, cloud);
  h.store.change(id, 'goal', goal(30));                  // local edit, not yet sent…
  h.store.items[0].updated = '2026-01-01T00:00:00.000Z'; // …made before the other device's write
  cloud.write('haedo_items', { id, kind: 'goal', name: '익명 목표', data: goal(70) });
  await h.store.pull();
  assert.equal(h.store.items[0].data.progress, 70);
  assert.equal(h.store.items[0].state, 'ok');
  const kept = h.recovery();
  assert.equal(kept.length, 1); assert.equal(kept[0].reason, 'remote_newer'); assert.equal(kept[0].data.progress, 30);
  await h.store.flush();
  assert.equal(cloud.tables.haedo_items.get(id).data.progress, 70, 'nothing is sent back over the newer copy');
});

test('pull: when the local edit is newer it wins, the server copy is kept, and the edit is sent', async t => {
  const cloud = server(), h = fixture(t, cloud), id = await syncedGoal(h, cloud);
  cloud.write('haedo_items', { id, kind: 'goal', name: '익명 목표', data: goal(40) });  // another device first
  h.store.change(id, 'goal', goal(90));                  // then this device, later
  h.store.items[0].updated = new Date(Date.parse(cloud.tables.haedo_items.get(id).updated_at) + 3600000).toISOString();
  await h.store.pull();
  assert.equal(h.store.items[0].data.progress, 90);
  const kept = h.recovery();
  assert.equal(kept.length, 1); assert.equal(kept[0].reason, 'local_newer'); assert.equal(kept[0].data.progress, 40);
  await h.store.flush();
  assert.equal(cloud.tables.haedo_items.get(id).data.progress, 90);
});

test('push: a compare-and-set failure is settled by the newest edit (server newer: the local edit is kept, not sent)', async t => {
  const cloud = server(), h = fixture(t, cloud), id = await syncedGoal(h, cloud);
  h.store.change(id, 'goal', goal(20));
  h.store.items[0].updated = '2026-01-01T00:00:00.000Z';  // an old edit (e.g. made offline long ago)
  cloud.write('haedo_items', { id, kind: 'goal', name: '익명 목표', data: goal(55) });
  await h.store.flush();
  assert.equal(h.store.items[0].data.progress, 55);
  assert.equal(h.recovery()[0].data.progress, 20);
  assert.equal(cloud.tables.haedo_items.get(id).data.progress, 55);
});

test('push: a compare-and-set failure with a newer local edit keeps the server copy and sends the edit', async t => {
  const cloud = server(), h = fixture(t, cloud), id = await syncedGoal(h, cloud);
  cloud.write('haedo_items', { id, kind: 'goal', name: '익명 목표', data: goal(55) });
  h.store.change(id, 'goal', goal(80));
  h.store.items[0].updated = '2030-01-01T00:00:00.000Z';
  await h.store.flush();
  await h.store.flush();
  assert.equal(cloud.tables.haedo_items.get(id).data.progress, 80);
  assert.equal(h.recovery()[0].data.progress, 55); assert.equal(h.recovery()[0].reason, 'local_newer');
});

test('an item left in the older manual conflict state is settled on the next pull, its loser kept first', async t => {
  const cloud = server(), h = fixture(t, cloud), id = await syncedGoal(h, cloud);
  h.store.change(id, 'goal', goal(25));
  cloud.write('haedo_items', { id, kind: 'goal', name: '익명 목표', data: goal(65) });
  const item = h.store.items[0]; item.state = 'conflict'; item.updated = '2026-01-01T00:00:00.000Z';
  await h.store.pull();
  assert.equal(h.store.items[0].state, 'ok'); assert.equal(h.store.items[0].data.progress, 65);
  assert.equal(h.recovery()[0].data.progress, 25);
});

test('if the recovery copy cannot be written nothing is replaced and the item stays in conflict', async t => {
  const cloud = server(), h = fixture(t, cloud, { failRecovery: true }), id = await syncedGoal(h, cloud);
  h.store.change(id, 'goal', goal(35));
  h.store.items[0].updated = '2026-01-01T00:00:00.000Z';
  cloud.write('haedo_items', { id, kind: 'goal', name: '익명 목표', data: goal(75) });
  await h.store.pull();
  assert.equal(h.store.items[0].state, 'conflict');
  assert.equal(h.store.items[0].data.progress, 35, 'the local edit is not overwritten');
  assert.equal(cloud.tables.haedo_items.get(id).data.progress, 75, 'the server copy is not overwritten');
  await h.store.flush();
  assert.equal(cloud.tables.haedo_items.get(id).data.progress, 75, 'a conflict item is not sent');
});

test('a server row that is gone: an unchanged copy follows (kept in recovery), a newer local edit is sent again', async t => {
  const cloud = server(), h = fixture(t, cloud);
  const kept = await syncedGoal(h, cloud, 10);
  const edited = h.store.change(null, 'habit', habit([])); await h.store.flush();
  h.store.change(edited, 'habit', habit(['2026-11-03']));
  cloud.tables.haedo_items.clear();
  await h.store.pull();
  assert.deepEqual(plain(h.store.items.map(item => item.id)), [edited]);
  assert.equal(h.recovery()[0].id, kept); assert.equal(h.recovery()[0].reason, 'remote_deleted');
  await h.store.flush();
  assert.deepEqual(cloud.tables.haedo_items.get(edited).data.checks, ['2026-11-03']);
});

test('backup carries the recovery list; restoring adds without duplicates and rejects malformed copies', async t => {
  const cloud = server(), h = fixture(t, cloud), id = await syncedGoal(h, cloud);
  h.store.change(id, 'goal', goal(30)); h.store.items[0].updated = '2026-01-01T00:00:00.000Z';
  cloud.write('haedo_items', { id, kind: 'goal', name: '익명 목표', data: goal(70) });
  await h.store.pull();
  const backup = plain(h.store.backup());
  assert.equal(backup.recovery.length, 1); assert.equal(backup.recovery[0].data.progress, 30);
  h.store.restoreRecovery(backup.recovery);
  assert.equal(h.recovery().length, 1, 'the same copy is not added twice');
  h.values.delete(model.keys('A').recovery);
  h.store.restoreRecovery(backup.recovery);
  assert.equal(h.recovery()[0].data.progress, 30, 'a restored backup brings the copy back');
  assert.throws(() => h.store.restoreRecovery([{ id: 'x', kind: 'goal', data: { title: 1 } }]), /형식/);
  assert.equal(h.recovery().length, 1);
});

test('viewing 행복도 creates nothing; the first saved value creates "내 연표" and is uploaded', async t => {
  const cloud = server(), h = fixture(t, cloud);
  assert.equal(h.store.happiness('2026-11-04'), null);
  assert.equal(h.registry().docs.length, 0, 'viewing does not create a timeline');
  const id = h.store.setHappiness('2026-11-04', 8);
  assert.equal(h.registry().docs.length, 1); assert.equal(h.registry().current, id); assert.equal(h.registry().docs[0].name, '내 연표');
  assert.deepEqual(plain(h.store.happiness('2026-11-04')), { v: 0.6, score: 8 });
  assert.equal(h.store.happinessState(), 'pending');
  await h.store.uploadDocuments([id]);
  assert.equal(h.store.happinessState(), 'ok');
  assert.deepEqual(cloud.tables.haedo_documents.get(id).data.happiness, [{ date: '2026-11-04', v: 0.6 }]);
  h.store.setHappiness('2026-11-04', null);
  assert.equal(h.store.happiness('2026-11-04'), null);
});

test('a timeline document changed on both sides: the newer copy wins, the other becomes "<이름> 복구 사본"', async t => {
  const cloud = server(), h = fixture(t, cloud);
  const id = h.store.setHappiness('2026-11-03', 5); await h.store.uploadDocuments([id]);
  // Server newer: another device changed the document after this device's edit.
  h.store.setHappiness('2026-11-04', 9);
  { const reg = h.registry(); reg.docs[0].updated = '2026-01-01T00:00:00.000Z'; h.local.setItem(model.keys('A').registry, JSON.stringify(reg)); }
  const other = h.doc(id); other.happiness = [{ date: '2026-11-03', v: -0.6 }];
  cloud.write('haedo_documents', { id, name: '내 연표', data: other });
  await h.store.uploadDocuments([id]);
  let reg = h.registry();
  assert.equal(reg.docs.length, 2);
  const copy = reg.docs.find(doc => doc.id !== id);
  assert.equal(copy.name, '내 연표 복구 사본');
  assert.deepEqual(h.doc(copy.id).happiness.map(e => e.date), ['2026-11-03', '2026-11-04'], 'the losing local copy keeps its 11-04 value');
  assert.deepEqual(h.doc(id).happiness, [{ date: '2026-11-03', v: -0.6 }]);
  // Local newer: this device edits after another device's write.
  cloud.write('haedo_documents', { id, name: '내 연표', data: { ...other, happiness: [{ date: '2026-11-01', v: 0.2 }] } });
  h.store.setHappiness('2026-11-05', 10);
  reg = h.registry(); reg.docs.find(doc => doc.id === id).updated = '2030-01-01T00:00:00.000Z'; h.local.setItem(model.keys('A').registry, JSON.stringify(reg));
  await h.store.uploadDocuments([id]);
  reg = h.registry();
  assert.equal(reg.docs.filter(doc => doc.name === '내 연표 복구 사본').length, 2);
  assert.ok(cloud.tables.haedo_documents.get(id).data.happiness.some(e => e.date === '2026-11-05'));
  const second = reg.docs.filter(doc => doc.name === '내 연표 복구 사본').map(doc => h.doc(doc.id));
  assert.ok(second.some(d => d.happiness.length === 1 && d.happiness[0].date === '2026-11-01'), 'the overwritten server copy is kept');
});

test('syncDocuments settles a document changed on both sides instead of leaving it unsent', async t => {
  const cloud = server(), h = fixture(t, cloud);
  const id = h.store.setHappiness('2026-11-03', 5); await h.store.uploadDocuments([id]);
  h.store.setHappiness('2026-11-04', 1);
  const reg = h.registry(); reg.docs[0].updated = '2026-01-01T00:00:00.000Z'; h.local.setItem(model.keys('A').registry, JSON.stringify(reg));
  cloud.write('haedo_documents', { id, name: '내 연표', data: { ...h.doc(id), happiness: [] } });
  await h.store.syncDocuments();
  const after = h.registry();
  assert.equal(after.docs.length, 2);
  assert.deepEqual(h.doc(id).happiness, []);
  assert.ok(h.doc(after.docs.find(doc => doc.id !== id).id).happiness.some(e => e.date === '2026-11-04'));
});

test('a document upload that returns after the account changed does not touch the new account', async t => {
  const cloud = server(), h = fixture(t, cloud);
  const id = h.store.setHappiness('2026-11-04', 6);
  const held = deferred(); cloud.hold = held.promise;
  const upload = h.store.uploadDocuments([id]);
  h.auth.user = { id: 'B' }; h.auth.epoch++; h.store.init('B');
  const before = [...h.values.entries()];
  cloud.hold = null; held.resolve();
  await assert.rejects(upload, error => error.code === 'account_changed');
  assert.deepEqual([...h.values.entries()], before);
  assert.equal(model.registry(h.local, 'B').docs.length, 0);
});

test('ensure() keeps the open account (and its queue); a different account re-initialises', async t => {
  const cloud = server(), h = fixture(t, cloud);
  h.store.change(null, 'goal', goal(5));
  assert.equal(h.store.ensure('A'), h.store);
  assert.equal(h.store.items.length, 1);
  h.auth.user = { id: 'B' }; h.auth.epoch++;
  h.store.ensure('B');
  assert.equal(h.store.items.length, 0);
  assert.equal(h.store.account, 'B');
});

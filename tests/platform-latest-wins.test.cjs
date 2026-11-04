'use strict';
// B2 (2026-11-04): goals and habits follow the 11-01 owner rule. When both sides changed, the
// newest edit wins and the other side is kept in the account's recovery list
// (caeyeon_life_account_<uid>_items_recovery). Timeline documents are only read by the 일정 screen
// (2026-11-04 owner decision: 행복도 is entered in the timeline editor). The fake server stamps updated_at itself (like the haedo_stamp trigger) and
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
    // Offline for documents (an iPhone without network): every document request fails.
    if (server.failDocs && table === 'haedo_documents') return { ok: false, status: 503, async json() { return {}; } };
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
  const server = { tables, calls, request, stamp, hold: null, failDocs: false,
    // Another device's write, stamped now (later than every earlier server write).
    write(table, row) { const next = { ...row, user_id: 'A', updated_at: stamp() }; tables[table].set(row.id, next); return next; },
    advance(ms) { clock += ms; } };
  return server;
}

function fixture(t, cloud, { failRecovery = false, values = new Map() } = {}) {
  const listeners = new Map();
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

test('an item written while a pull\'s list is in flight is not treated as deleted on the server', async t => {
  const cloud = server(), h = fixture(t, cloud);
  let release; const held = new Promise(done => { release = done; });
  const original = cloud.request;
  cloud.request = async (url, options = {}) => {
    if (!options.method && !new URL(url).searchParams.get('id') && new URL(url).pathname.endsWith('haedo_items')) { const rows = await original(url, options); await held; return rows; }
    return original(url, options);
  };
  const pulling = h.store.pull();                       // the list is read before the item exists
  const id = h.store.change(null, 'goal', goal(15));
  await h.store.flush();                                // the new item reaches the server
  release(); await pulling;
  assert.deepEqual(plain(h.store.items.map(item => item.id)), [id], 'the new goal stays');
  assert.equal(h.recovery().length, 0, 'no false "deleted on the server" copy');
});

test('a damaged recovery list is set aside: conflicts still settle, backup and restore still work', async t => {
  const cloud = server(), h = fixture(t, cloud), id = await syncedGoal(h, cloud);
  h.local.setItem(model.keys('A').recovery, '{not json');
  h.store.change(id, 'goal', goal(30)); h.store.items[0].updated = '2026-01-01T00:00:00.000Z';
  cloud.write('haedo_items', { id, kind: 'goal', name: '익명 목표', data: goal(70) });
  await h.store.pull();
  assert.equal(h.store.items[0].data.progress, 70);
  assert.equal(h.recovery().length, 1, 'a new list holds the loser');
  assert.deepEqual(JSON.parse(h.values.get(model.keys('A').recoveryDamaged)), ['{not json'], 'the damaged value is kept aside');
  const backup = plain(h.store.backup());
  assert.equal(backup.recovery.length, 1); assert.deepEqual(backup.recoveryDamaged, ['{not json']);
});

test('the recovery list grows: two conflicts keep two copies, the same conflict once, and a restore adds (M-mutants)', async t => {
  const cloud = server(), h = fixture(t, cloud), id = await syncedGoal(h, cloud);
  for (const [mine, theirs] of [[30, 70], [35, 75]]) {
    h.store.change(id, 'goal', goal(mine)); h.store.items[0].updated = '2026-01-01T00:00:00.000Z';
    cloud.write('haedo_items', { id, kind: 'goal', name: '익명 목표', data: goal(theirs) });
    await h.store.pull();
  }
  assert.deepEqual(h.recovery().map(row => row.data.progress), [30, 35], 'appended, not replaced');
  // The same losing version settled again (pull, then a push path) is not kept twice.
  const same = h.recovery()[1];
  h.context.HaedoPlatformStore.restoreRecovery([{ ...same, rid: undefined, keptAt: 'later' }]);
  assert.equal(h.recovery().length, 2);
  // A restore from another source adds next to what is kept.
  const added = h.store.restoreRecovery([{ id: 'other', kind: 'goal', data: goal(5), updated: '2026-10-01T00:00:00.000Z', keptAt: '2026-10-02T00:00:00.000Z', reason: 'remote_newer' }]);
  assert.equal(added, 1); assert.deepEqual(h.recovery().map(row => row.data.progress), [30, 35, 5]);
});

test('push path: if the recovery copy cannot be written the server copy is not applied (item stays in conflict)', async t => {
  const cloud = server(), h = fixture(t, cloud, { failRecovery: true }), id = await syncedGoal(h, cloud);
  cloud.write('haedo_items', { id, kind: 'goal', name: '익명 목표', data: goal(75) });
  h.store.change(id, 'goal', goal(35)); h.store.items[0].updated = '2026-01-01T00:00:00.000Z';
  await h.store.flush();
  assert.equal(h.store.items[0].state, 'conflict'); assert.equal(h.store.items[0].data.progress, 35);
  assert.equal(cloud.tables.haedo_items.get(id).data.progress, 75);
});

test('retry() settles an item left in conflict and sends what is unsent', async t => {
  const cloud = server(), h = fixture(t, cloud), id = await syncedGoal(h, cloud);
  h.store.change(id, 'goal', goal(80)); h.store.items[0].updated = '2030-01-01T00:00:00.000Z'; h.store.items[0].state = 'conflict';
  cloud.write('haedo_items', { id, kind: 'goal', name: '익명 목표', data: goal(55) });
  await h.store.retry(); await h.store.flush();
  assert.equal(h.store.items[0].state, 'ok');
  assert.equal(cloud.tables.haedo_items.get(id).data.progress, 80);
  assert.equal(h.recovery()[0].data.progress, 55);
});

test('recovery notice: unseen copies until acknowledged; a copy can be put back as a new item', async t => {
  const cloud = server(), h = fixture(t, cloud), id = await syncedGoal(h, cloud);
  h.store.change(id, 'goal', goal(30)); h.store.items[0].updated = '2026-01-01T00:00:00.000Z';
  cloud.write('haedo_items', { id, kind: 'goal', name: '익명 목표', data: goal(70) });
  await h.store.pull();
  assert.equal(h.store.recoveryUnseen, 1);
  h.store.acknowledgeRecovery();
  assert.equal(h.store.recoveryUnseen, 0);
  const revived = h.store.reviveRecovery(h.store.recovery[0].rid);
  assert.notEqual(revived, id);
  assert.deepEqual(plain(h.store.items.map(item => [item.id === id ? 'old' : 'new', item.data.progress])).sort(), [['new', 30], ['old', 70]]);
});


test('the recovery notice counts copies by id: one that arrives later with an earlier time is still new (re-review minor 5)', async t => {
  const cloud = server(), h = fixture(t, cloud), id = await syncedGoal(h, cloud);
  h.store.change(id, 'goal', goal(30)); h.store.items[0].updated = '2026-01-01T00:00:00.000Z';
  cloud.write('haedo_items', { id, kind: 'goal', name: '익명 목표', data: goal(70) });
  await h.store.pull();
  h.store.acknowledgeRecovery();
  assert.equal(h.store.recoveryUnseen, 0);
  h.store.restoreRecovery([{ rid: 'from-ipad', id: 'g_other', kind: 'goal', data: goal(5), updated: null, keptAt: '2020-01-01T00:00:00.000Z', reason: 'remote_newer' }]);
  assert.equal(h.store.recoveryUnseen, 1);
});


test('the 일정 store only reads timelines: 행복도 is read from one timeline chosen the same way everywhere, nothing is sent', async t => {
  const cloud = server(), h = fixture(t, cloud);
  assert.equal(typeof h.store.setHappiness, 'undefined', 'no 행복도 write path');
  assert.equal(typeof h.store.followDocuments, 'undefined'); assert.equal(typeof h.store.retryDocuments, 'undefined');
  cloud.write('haedo_documents', { id: 'd_a', name: '여행 연표', data: { ...model.emptyDocument('여행 연표'), scale: 'signed1' } });
  cloud.write('haedo_documents', { id: 'd_b', name: '내 연표', data: { ...model.emptyDocument('내 연표'), scale: 'signed1', happiness: [{ date: '2026-11-03', v: 0.4 }] } });
  cloud.write('haedo_documents', { id: 'd_c', name: '내 연표 복구 사본', data: { ...model.emptyDocument('사본'), scale: 'signed1', happiness: [{ date: '2026-11-03', v: -1 }, { date: '2026-11-04', v: -1 }] } });
  await h.store.syncDocuments();
  // The timeline with the most daily 행복도 (recovery copies never), not the smallest id.
  assert.deepEqual(plain(h.store.happiness('2026-11-03')), { v: 0.4, score: 7 });
  assert.deepEqual(plain(h.store.happinessSource), { id: 'd_b', name: '내 연표' });
  assert.equal(h.store.happiness('2026-11-04'), null);
  // An older document without a scale is read on its own 0–10 scale.
  cloud.write('haedo_documents', { id: 'd_b', name: '내 연표', data: { ...model.emptyDocument('내 연표'), happiness: [{ date: '2026-11-03', v: 9 }] } });
  delete cloud.tables.haedo_documents.get('d_b').data.scale;
  await h.store.syncDocuments();
  assert.equal(h.store.happiness('2026-11-03').score, 9);
  assert.equal(cloud.calls.filter(call => call.table === 'haedo_documents' && call.method !== 'GET').length, 0, 'nothing sent');
});

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

const RECOVERY = /^내 연표 복구 사본 \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/;
test('a 행복도 change meeting a newer server copy is applied day by day on top of it: nothing is pushed out (M1)', async t => {
  const cloud = server(), h = fixture(t, cloud);
  const id = h.store.setHappiness('2026-11-03', 5); await h.store.uploadDocuments([id]);
  h.store.setHappiness('2026-11-04', 9);                          // a day changed here…
  const other = h.doc(id); other.happiness = [{ date: '2026-11-03', v: 0 }]; other.events = [{ date: '2026-11-04', title: '다른 기기 사건' }];
  cloud.write('haedo_documents', { id, name: '내 연표', data: other });   // …while another device edited the timeline
  await h.store.uploadDocuments([id]);
  const row = cloud.tables.haedo_documents.get(id).data;
  assert.deepEqual(row.events.map(e => e.title), ['다른 기기 사건'], 'the other device\'s event stays in the main document');
  assert.deepEqual(row.happiness.map(e => [e.date, e.v]), [['2026-11-03', 0], ['2026-11-04', 0.8]]);
  assert.equal(h.registry().docs.length, 1, 'no recovery copy');
  assert.deepEqual(plain(h.doc(id)), plain(row));
});

test('a document changed here outside the 행복도 path and on the server: the newer copy wins, the other is kept (dated name, once)', async t => {
  const cloud = server(), h = fixture(t, cloud);
  const id = h.store.setHappiness('2026-11-03', 5); await h.store.uploadDocuments([id]);
  // Server newer: this device's older edit (made by another page, e.g. the timeline editor) loses.
  const mine = h.doc(id); mine.events = [{ date: '2026-01-01', title: '이 기기 편집' }];
  h.local.setItem(model.keys('A').docs + id, JSON.stringify(mine));
  { const reg = h.registry(); reg.docs[0].updated = '2026-01-01T00:00:00.000Z'; h.local.setItem(model.keys('A').registry, JSON.stringify(reg)); }
  const other = h.doc(id); other.events = [{ date: '2026-11-04', title: '다른 기기 편집' }];
  cloud.write('haedo_documents', { id, name: '내 연표', data: other });
  await h.store.uploadDocuments([id]);
  let reg = h.registry();
  const copy = reg.docs.find(doc => doc.id !== id);
  assert.match(copy.name, RECOVERY); assert.equal(h.doc(copy.id).profile.name, copy.name);
  assert.deepEqual(h.doc(copy.id).events.map(e => e.title), ['이 기기 편집']);
  assert.deepEqual(h.doc(id).events.map(e => e.title), ['다른 기기 편집']);
  // Local newer: the overwritten server copy is kept; the same content is not kept twice.
  const again = h.doc(id); again.events.push({ date: '2026-11-05', title: '이 기기 새 편집' });
  h.local.setItem(model.keys('A').docs + id, JSON.stringify(again));
  reg = h.registry(); reg.docs.find(doc => doc.id === id).updated = '2030-01-01T00:00:00.000Z'; h.local.setItem(model.keys('A').registry, JSON.stringify(reg));
  cloud.write('haedo_documents', { id, name: '내 연표', data: { ...other, events: [{ date: '2026-11-01', title: '서버 편집' }] } });
  await h.store.uploadDocuments([id]);
  reg = h.registry();
  assert.equal(reg.docs.filter(doc => RECOVERY.test(doc.name)).length, 2);
  assert.ok(cloud.tables.haedo_documents.get(id).data.events.some(e => e.title === '이 기기 새 편집'));
});

test('syncDocuments settles a document changed on both sides instead of leaving it unsent', async t => {
  const cloud = server(), h = fixture(t, cloud);
  const id = h.store.setHappiness('2026-11-03', 5); await h.store.uploadDocuments([id]);
  const mine = h.doc(id); mine.events = [{ date: '2026-01-01', title: '이 기기 편집' }];
  h.local.setItem(model.keys('A').docs + id, JSON.stringify(mine));
  const reg = h.registry(); reg.docs[0].updated = '2026-01-01T00:00:00.000Z'; h.local.setItem(model.keys('A').registry, JSON.stringify(reg));
  cloud.write('haedo_documents', { id, name: '내 연표', data: { ...h.doc(id), events: [], happiness: [] } });
  await h.store.syncDocuments();
  const after = h.registry();
  assert.equal(after.docs.length, 2);
  assert.deepEqual(h.doc(id).happiness, []);
  assert.ok(h.doc(after.docs.find(doc => doc.id !== id).id).events.some(e => e.title === '이 기기 편집'));
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

test('one uploader per document: clean documents are not sent, and documents this store did not write are left to their editor (B1)', async t => {
  const cloud = server(), h = fixture(t, cloud);
  const id = h.store.setHappiness('2026-11-03', 5); await h.store.uploadDocuments([id]);
  const writes = () => cloud.calls.filter(call => call.method !== 'GET' && call.table === 'haedo_documents').length;
  const before = writes();
  await h.store.uploadDocuments([id]);
  assert.equal(writes(), before, 'a clean document is not sent again');
  // Another page (the timeline editor) changes a different document: this store does not send it.
  const other = h.store.setHappiness === undefined ? null : 'd_editor';
  h.local.setItem(model.keys('A').docs + other, JSON.stringify(model.emptyDocument('편집기 문서')));
  { const reg = h.registry(); reg.docs.push({ id: other, name: '편집기 문서', updated: '2026-11-04T00:00:00.000Z' }); h.local.setItem(model.keys('A').registry, JSON.stringify(reg)); }
  h.store.retryDocuments();
  await new Promise(done => setTimeout(done, 1700));
  assert.equal(writes(), before, 'not owned: not sent');
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

// Re-review (3e9ecfb) M1 and minors. A reopened page is a new store over the same device storage.
const reopen = (t, cloud, h) => { h.logout(); return fixture(t, cloud, { values: h.values }); };
const queueDelay = () => new Promise(done => setTimeout(done, 1700));

test('a 행복도 that failed to upload is sent by the 일정 page after a reopen (re-review M1)', async t => {
  const cloud = server(), h = fixture(t, cloud);
  const id = h.store.setHappiness('2026-11-02', 5); await h.store.uploadDocuments([id]);
  cloud.failDocs = true;
  h.store.setHappiness('2026-11-03', 7);
  await assert.rejects(h.store.uploadDocuments([id]));
  const again = reopen(t, cloud, h);
  cloud.failDocs = false;
  again.store.followDocuments();
  await again.store.syncDocuments(); await queueDelay();
  assert.deepEqual(cloud.tables.haedo_documents.get(id).data.happiness.map(e => [e.date, e.v]), [['2026-11-02', 0], ['2026-11-03', 0.4]]);
  assert.equal(again.store.happinessState(), 'ok');
});

test('after a reopen a 행복도 conflict is still rebased day by day (the pending days are kept on the device)', async t => {
  const cloud = server(), h = fixture(t, cloud);
  const id = h.store.setHappiness('2026-11-02', 5); await h.store.uploadDocuments([id]);
  cloud.failDocs = true;
  h.store.setHappiness('2026-11-04', 9);
  await assert.rejects(h.store.uploadDocuments([id]));
  const again = reopen(t, cloud, h);
  cloud.failDocs = false;
  const other = again.doc(id); other.happiness = [{ date: '2026-11-02', v: 0 }]; other.events = [{ date: '2026-11-03', title: '다른 기기 사건' }];
  cloud.write('haedo_documents', { id, name: '내 연표', data: other });
  again.store.followDocuments();
  await again.store.syncDocuments(); await queueDelay();
  const row = cloud.tables.haedo_documents.get(id).data;
  assert.deepEqual(row.events.map(e => e.title), ['다른 기기 사건']);
  assert.deepEqual(row.happiness.map(e => [e.date, e.v]), [['2026-11-02', 0], ['2026-11-04', 0.8]]);
  assert.equal(again.registry().docs.length, 1, 'no recovery copy');
});

test('the same day changed on both sides: the later value wins and the other is kept as a recovery copy (re-review minor 1)', async t => {
  // Server newer: another device's later 9 beats this device's earlier 3.
  { const cloud = server(), h = fixture(t, cloud);
    const id = h.store.setHappiness('2026-11-03', 5); await h.store.uploadDocuments([id]);
    h.store.setHappiness('2026-11-03', 3);
    cloud.advance(3 * 86400000);                                    // the other device's upload is later than the press here
    const other = h.doc(id); other.happiness = [{ date: '2026-11-03', v: 0.8 }]; cloud.write('haedo_documents', { id, name: '내 연표', data: other });
    await h.store.uploadDocuments([id]);
    assert.deepEqual(cloud.tables.haedo_documents.get(id).data.happiness, [{ date: '2026-11-03', v: 0.8 }], 'the later 9 stays');
    const copy = h.registry().docs.find(doc => RECOVERY.test(doc.name));
    assert.ok(copy, 'the losing 3 is kept'); assert.deepEqual(h.doc(copy.id).happiness, [{ date: '2026-11-03', v: -0.4 }]); }
  // This device newer: its 3 wins; the server's 9 is kept.
  { const cloud = server(), h = fixture(t, cloud);
    const id = h.store.setHappiness('2026-11-03', 5); await h.store.uploadDocuments([id]);
    const other = h.doc(id); other.happiness = [{ date: '2026-11-03', v: 0.8 }]; cloud.write('haedo_documents', { id, name: '내 연표', data: other });
    h.store.setHappiness('2026-11-03', 3);                           // pressed after (the server clock is behind this device)
    await h.store.uploadDocuments([id]);
    assert.deepEqual(cloud.tables.haedo_documents.get(id).data.happiness, [{ date: '2026-11-03', v: -0.4 }]);
    const copy = h.registry().docs.find(doc => RECOVERY.test(doc.name));
    assert.ok(copy); assert.deepEqual(h.doc(copy.id).happiness, [{ date: '2026-11-03', v: 0.8 }]); }
});

test('the timeline 행복도 goes to is recorded once and followed; one deleted elsewhere is not sent again (re-review minor 2)', async t => {
  const cloud = server(), h = fixture(t, cloud);
  const put = (id, name, happiness = []) => {
    h.local.setItem(model.keys('A').docs + id, JSON.stringify({ ...model.emptyDocument(name), happiness }));
    const reg = h.registry(); reg.docs.push({ id, name, updated: '2026-11-01T00:00:00.000Z' }); h.local.setItem(model.keys('A').registry, JSON.stringify(reg));
  };
  put('d_a', '여행 연표'); put('d_b', '내 연표', [{ date: '2026-10-01', v: 0.2 }]);
  // Nothing recorded: the timeline that already has daily 행복도 (not the smallest id).
  assert.equal(h.store.base.docId, 'd_b');
  // Another device recorded d_a (later choice): this device follows it.
  assert.equal(h.store.adoptBase({ docId: 'd_a', chosenAt: '2026-11-04T09:00:00.000Z' }), true);
  assert.equal(h.store.setHappiness('2026-11-03', 6), 'd_a');
  assert.equal(h.store.adoptBase({ docId: 'd_b', chosenAt: '2026-11-04T08:00:00.000Z' }), false, 'an earlier choice does not replace it');
  await h.store.uploadDocuments(['d_a', 'd_b']);
  // d_a is deleted on another device while this device has an unsent value in it.
  h.store.setHappiness('2026-11-04', 2);
  cloud.tables.haedo_documents.delete('d_a');
  await h.store.uploadDocuments(['d_a']);
  assert.equal(cloud.tables.haedo_documents.has('d_a'), false, 'not brought back');
  assert.equal(h.registry().docs.some(doc => doc.id === 'd_a'), false);
  const copy = h.registry().docs.find(doc => / 복구 사본/.test(doc.name));
  assert.ok(copy, 'the unsent version is kept'); assert.ok(h.doc(copy.id).happiness.some(e => e.date === '2026-11-04'));
  assert.equal(h.store.base.docId, 'd_b', 'chosen again'); assert.equal(h.store.base.record.docId, 'd_b');
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

// Third re-review (0b328f7) minors.
test('a recorded timeline not on this device yet is waited for: 행복도 is kept and applied when it arrives (minor 1)', async t => {
  const cloud = server(), h = fixture(t, cloud);
  // Another device chose d_far and uploaded it; this device has an older "내 연표" of its own.
  h.local.setItem(model.keys('A').docs + 'd_near', JSON.stringify(model.emptyDocument('내 연표')));
  h.local.setItem(model.keys('A').registry, JSON.stringify({ docs: [{ id: 'd_near', name: '내 연표', updated: '2026-11-01T00:00:00.000Z' }], current: 'd_near' }));
  h.store.adoptBase({ docId: 'd_far', chosenAt: '2026-11-04T09:00:00.000Z' });
  assert.equal(h.store.base.waiting, true);
  assert.equal(h.store.setHappiness('2026-11-03', 8), 'd_far');
  assert.deepEqual(plain(h.store.happiness('2026-11-03')), { score: 8 }, 'shown from the queue');
  assert.equal(h.store.happinessState(), 'pending');
  assert.equal(h.doc('d_near').happiness.length, 0, 'not written to another timeline');
  await h.store.syncDocuments();
  assert.equal(h.store.base.record.docId, 'd_far', 'not chosen again while it has not arrived');
  cloud.write('haedo_documents', { id: 'd_far', name: '여행 연표', data: { ...model.emptyDocument('여행 연표'), scale: 'signed1' } });
  h.store.followDocuments();
  await h.store.syncDocuments(); await queueDelay();
  assert.deepEqual(cloud.tables.haedo_documents.get('d_far').data.happiness, [{ date: '2026-11-03', v: 0.6 }]);
  assert.equal(h.store.base.docId, 'd_far'); assert.equal(h.store.happinessState(), 'ok');
});

test('a recovery copy the 일정 store made but could not send is sent after a reopen (minor 3)', async t => {
  const cloud = server(), h = fixture(t, cloud);
  const id = h.store.setHappiness('2026-11-03', 5); await h.store.uploadDocuments([id]);
  h.store.setHappiness('2026-11-03', 3);
  cloud.advance(3 * 86400000);
  const other = h.doc(id); other.happiness = [{ date: '2026-11-03', v: 0.8 }]; cloud.write('haedo_documents', { id, name: '내 연표', data: other });
  cloud.failDocs = true;
  await assert.rejects(h.store.uploadDocuments([id]));
  cloud.failDocs = false;
  await h.store.uploadDocuments([id]);                               // settles: the server's later 9 wins, a copy is made…
  const copy = h.registry().docs.find(doc => RECOVERY.test(doc.name));
  assert.ok(copy); assert.equal(cloud.tables.haedo_documents.has(copy.id), false, '…but not sent yet');
  const again = reopen(t, cloud, h);
  again.store.followDocuments();
  await again.store.syncDocuments(); await queueDelay();
  assert.equal(cloud.tables.haedo_documents.has(copy.id), true, 'the reopened 일정 page sends it');
});

test('a stalled upload times out and is left waiting, not failed; the next send goes through (minor 4)', async t => {
  const cloud = server(), h = fixture(t, cloud), before = Sync.timeoutMs;
  t.after(() => { Sync.timeoutMs = before; cloud.hold = null; });
  const id = h.store.setHappiness('2026-11-03', 5); await h.store.uploadDocuments([id]);
  Sync.timeoutMs = 150; cloud.hold = new Promise(() => {});        // the network never answers
  h.store.setHappiness('2026-11-04', 7);
  await new Promise(done => setTimeout(done, 2000));             // the queued upload runs and times out
  assert.equal(h.store.happinessState(), 'pending', 'waiting, not "failed"');
  await assert.rejects(h.store.uploadDocuments([id]), { code: 'timeout' });
  cloud.hold = null;
  await h.store.uploadDocuments([id]);
  assert.equal(h.store.happinessState(), 'ok');
  assert.deepEqual(cloud.tables.haedo_documents.get(id).data.happiness.map(e => e.date), ['2026-11-03', '2026-11-04']);
});

test('two timelines with the same name are told apart in the schedule label (minor 2)', async t => {
  const cloud = server(), h = fixture(t, cloud);
  h.local.setItem(model.keys('A').docs + 'd_1', JSON.stringify(model.emptyDocument('내 연표')));
  h.local.setItem(model.keys('A').docs + 'd_2', JSON.stringify(model.emptyDocument('내 연표')));
  h.local.setItem(model.keys('A').registry, JSON.stringify({ docs: [{ id: 'd_1', name: '내 연표', updated: '2026-11-02T00:00:00.000Z' }, { id: 'd_2', name: '내 연표', updated: '2026-11-03T00:00:00.000Z' }], current: 'd_1' }));
  assert.match(h.store.base.name, /^내 연표 \(.+ 수정\)$/);
});

test('syncDocuments does not write the document list back when nothing changed (a lagging copy would hide another tab\'s edit)', async t => {
  const cloud = server(), h = fixture(t, cloud);
  const id = h.store.setHappiness('2026-11-03', 5); await h.store.uploadDocuments([id]);
  const key = model.keys('A').registry, writes = [];
  const setItem = h.local.setItem; h.local.setItem = (k, v) => { if (k === key) writes.push(v); return setItem(k, v); };
  await h.store.syncDocuments();
  assert.deepEqual(writes, [], 'unchanged: not written');
  cloud.write('haedo_documents', { id, name: '내 연표', data: { ...h.doc(id), events: [{ date: '2026-11-02', title: '다른 기기' }] } });
  await h.store.syncDocuments();
  assert.equal(writes.length, 1, 'a real change is written');
});

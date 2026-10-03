'use strict';
// Cross-product contracts: the platform and source-workspace backups remain
// separate formats. These exercise the real exporters/importers, not conversions.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const core = require('../assets/life/core.js');
const model = require('../assets/platform-data.js');
const timeline = require('../assets/data.js');
const sync = require('../assets/sync.js');

function localStorage() {
  const values = new Map();
  return {
    values, get length() { return values.size; }, key: i => [...values.keys()][i],
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}
function fixture() {
  const local = localStorage(), uid = 'synthetic-owner-A';
  const keys = model.keys(uid);
  const doc = { profile: { name: '익명 연표', birth: '1990-01' },
    events: [{ date: '2020-01', title: '익명 사건' }], spans: [] };
  local.setItem(keys.docs + 'doc-A', JSON.stringify(doc));
  local.setItem(keys.registry, JSON.stringify({ current: 'doc-A', docs: [{
    id: 'doc-A', name: '익명 연표', cloudAccount: 'synthetic-private-binding',
    syncedAt: '2026-10-01T00:00:00Z', updated: '2026-10-01T00:00:00Z',
  }] }));
  local.setItem(keys.items, JSON.stringify([{ id: 'goal-A', kind: 'goal',
    data: { title: '익명 목표', progress: 20 }, state: 'ok',
    updated: '2026-10-01T00:00:00Z', syncedAt: '2026-10-01T00:00:00Z' }]));
  for (const key of ['caeyeon_life_cloud', 'haedo-platform-auth-v1', 'life_tools_sync_config']) {
    local.setItem(key, JSON.stringify({ access_token: 'synthetic-private-token', email: 'synthetic-private-email' }));
  }
  const auth = { user: { id: uid }, config: { url: 'https://example.invalid' },
    request: () => { throw new Error('Backup must not make a request'); } };
  const context = {
    HaedoPlatformData: model, HaedoAuth: auth, HaedoData: timeline, HaedoSync: sync,
    localStorage: local, structuredClone, Event, Date, setTimeout, clearTimeout,
    document: { addEventListener() {}, dispatchEvent() {} }, addEventListener() {},
  };
  vm.runInNewContext(readFileSync(require.resolve('../assets/platform-store.js'), 'utf8'), context);
  return { local, auth, store: context.HaedoPlatformStore.init(uid), uid, doc };
}

test('platform backup exports document copies without account identity, auth session or registry binding', () => {
  const { store, local, uid } = fixture(), before = [...local.values];
  const backup = store.backup();
  assert.equal(backup.format, 'haedo-platform-backup-v1');
  assert.equal(backup.docs.length, 1); assert.equal(backup.items.length, 1);
  const encoded = JSON.stringify(backup);
  for (const privateValue of [uid, 'synthetic-private-binding', 'synthetic-private-token', 'synthetic-private-email']) {
    assert.ok(!encoded.includes(privateValue));
  }
  backup.docs[0].data.events[0].title = '사본만 수정';
  backup.items[0].data.title = '사본만 수정';
  assert.deepEqual([...local.values], before);
});

test('real platform and source-workspace backups reject each other without changing either source', async () => {
  const { store, local } = fixture();
  const platformBackup = store.backup(), sourceBackup = core.makeBackup(core.createWorkspace());
  const beforePlatform = JSON.stringify(platformBackup), beforeSource = JSON.stringify(sourceBackup), beforeLocal = [...local.values];
  await assert.rejects(core.restoreBackup(platformBackup));
  assert.throws(() => model.importDocs(local, 'synthetic-owner-B', sourceBackup));
  assert.deepEqual([...local.values], beforeLocal);
  assert.equal(JSON.stringify(platformBackup), beforePlatform);
  assert.equal(JSON.stringify(sourceBackup), beforeSource);
});

test('explicit foreign backup format cannot be silently treated as timeline copies by adding docs', () => {
  const { local, doc } = fixture();
  const otherFormat = core.makeBackup(core.createWorkspace());
  otherFormat.docs = [{ id: 'misleading-original-id', data: doc }];
  const before = [...local.values];
  assert.throws(() => model.importDocs(local, 'synthetic-owner-B', otherFormat, () => 'wrong-copy'));
  assert.deepEqual([...local.values], before);
});

test('shared format guard covers goal-only envelopes and keeps supported legacy copies compatible', () => {
  const { local, doc } = fixture();
  const goal = { id: 'old-goal', kind: 'goal', data: { title: '익명 목표', progress: 0 } };
  for (const format of ['life-tools-backup-v1', 'haedo-platform-backup-v2', '', null, 1, true, {}, []]) {
    assert.throws(() => model.assertBackupFormat({ format, items: [goal] }));
  }
  for (const invalid of [null, false, 1, 'backup', [], [doc]]) assert.throws(() => model.assertBackupFormat(invalid));
  for (const format of ['haedo-backup-v1', 'haedo-platform-backup-v1']) {
    assert.equal(model.assertBackupFormat({ format, items: [goal] }), true);
    const copied = model.importDocs(local, 'synthetic-owner-B', { format, docs: [{ id: 'old', data: doc }] }, () => 'new-' + format);
    assert.notEqual(copied[0].id, 'old');
    assert.deepEqual(copied[0].data, doc);
  }
  assert.equal(model.assertBackupFormat(doc), true);
  const plain = model.importDocs(local, 'synthetic-owner-B', doc, () => 'plain-copy');
  assert.equal(plain[0].id, 'plain-copy');
  const before = [...local.values];
  assert.throws(() => model.importDocs(local, 'synthetic-owner-B', { format: 'haedo-platform-backup-v1', docs: [{ data: null }] }));
  assert.deepEqual([...local.values], before);
});

test('platform exporter rejects stale account ownership instead of exporting the previous account', () => {
  const { store, auth, local } = fixture(), before = [...local.values];
  auth.user = { id: 'synthetic-owner-B' };
  assert.throws(() => store.backup());
  auth.user = null;
  assert.throws(() => store.backup());
  assert.deepEqual([...local.values], before);
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { create } = require('../assets/life/account-library.js'), Core = require('../assets/life/core.js');
const owner = { projectUrl: 'https://library.example.invalid', userId: '11111111-1111-4111-8111-111111111111' };
const workspaceId = '22222222-2222-4222-8222-222222222222';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
// Same anonymous source/domain contracts as account-library.test.cjs. That file's
// harness is deliberately private; this smaller fixture exposes media effects
// without executing the unrelated suite or changing production constructors.
function harness({ sourceStatus = 'synced', metadataFailure = false, capabilities = 1 } = {}) {
  const log = [], listeners = new Set(); let creates = 0, disposals = 0, mediaOptions;
  const row = { workspaceId, title: '익명 자료', revision: 1, eligible: true };
  const state = { enabled: true, binding: { ...owner, remoteId: workspaceId }, status: sourceStatus, remoteRevision: 1 };
  const auth = { epoch: 1, user: { id: owner.userId }, getAccount: () => owner, verify: async () => ({ id: owner.userId }) };
  const storage = { isAccountScoped: true, account: owner, open: async () => {},
    listWorkspaces: async () => [row], listAccountLibraries: async () => [row], getActive: async () => workspaceId,
    setActive: async () => assert.fail('Existing active workspace must not be replaced'),
    getSyncState: async () => state, getLibraryMetaState: async () => ({ ...state, sourceRevision: 1 }),
    listNaverMediaReceipts: async () => [], subscribeAll: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
  const sync = { setAutomatic: () => {}, start: async () => {}, getAccount: () => owner,
    getState: async () => state, subscribe: () => () => {}, syncNow: async () => { log.push('source:' + sourceStatus); return state; } };
  function domain(name, fail) {
    return { getState: async () => ({ enabled: true, status: 'synced' }), subscribe: () => () => {},
      syncNow: async () => { log.push(name); if (fail) throw Object.assign(new Error('offline'), { code: 'network_error' }); return { status: 'synced' }; } };
  }
  const service = { publishPending: async id => { assert.equal(id, workspaceId); assert.equal(mediaOptions.isCurrent(), true); log.push('media:publish'); return { status: 'confirmed', confirmed: 1 }; },
    dispose: () => { disposals++; log.push('media:dispose'); } };
  const args = { storage, core: Core, sync, compositionSync: domain('composition', false), libraryMetaSync: domain('metadata', metadataFailure), auth,
    remote: { capabilities: async () => ({ version: capabilities, metadataVersion: capabilities, originalsVersion: capabilities }),
      open: async () => ({ status: 'ready', workspace_id: workspaceId, default_revision: 1, pristine: false }),
      catalog: async () => ({ items: [{ id: workspaceId, title: row.title, revision: 1, updated_at: '2026-10-29T00:00:00Z' }], next: null }), dispose: () => {} },
    originalsFactory: () => ({ start() {}, subscribe: () => () => {}, getState: () => ({ mode: 'account', status: 'saved', pending: 0 }), dispose() {} }),
    naverMediaFactory: options => { creates++; mediaOptions = options; return service; }, polling: false };
  return { args, log, listeners, state, auth, service, get creates() { return creates; }, get disposals() { return disposals; }, get mediaOptions() { return mediaOptions; } };
}
test('media publishing starts only after the exact source synchronization reports acknowledgement', async () => {
  const h = harness(), manager = create(h.args);
  try {
    await manager.bootstrap();
    assert.equal(h.log.filter(value => value === 'media:publish').length, 1);
    assert.ok(h.log.indexOf('source:synced') < h.log.indexOf('media:publish'));
    assert.equal(h.creates, 1); assert.equal((await manager.getState()).status, 'synced');
  } finally { manager.dispose(); }
  assert.equal(h.disposals, 1);
});
test('pending, failed and conflicted source states never publish media receipts', async () => {
  for (const sourceStatus of ['pending', 'error', 'conflict']) {
    const h = harness({ sourceStatus }), manager = create(h.args);
    try { await manager.bootstrap(); assert.equal(h.creates, 0, sourceStatus); assert.equal(h.log.includes('media:publish'), false, sourceStatus); }
    finally { manager.dispose(); }
  }
});
test('an unrelated metadata failure does not block acknowledged source media and remains visible as an error', async () => {
  const h = harness({ metadataFailure: true }), manager = create(h.args);
  try {
    await manager.bootstrap();
    assert.equal(h.log.filter(value => value === 'media:publish').length, 1);
    assert.ok(h.log.indexOf('source:synced') < h.log.indexOf('media:publish'));
    assert.equal((await manager.getState()).status, 'error', 'Metadata failure must not disappear because media succeeded');
  } finally { manager.dispose(); }
});
test('disposing while metadata is outstanding prevents later media creation or publication', async () => {
  const h = harness(), gate = deferred(), entered = deferred();
  h.args.libraryMetaSync.syncNow = async () => { entered.resolve(); await gate.promise; return { status: 'synced' }; };
  const manager = create(h.args), pending = manager.bootstrap();
  try {
    await entered.promise; manager.dispose(); gate.resolve();
    await assert.rejects(pending, { code: 'request_cancelled' });
    assert.equal(h.creates, 0); assert.equal(h.log.includes('media:publish'), false);
  } finally { gate.resolve(); manager.dispose(); }
});
test('disposing an outstanding media publisher invalidates its current guard and closes it once', async () => {
  const h = harness(), gate = deferred(), entered = deferred(); let lateAcks = 0;
  h.service.publishPending = async () => { entered.resolve(); await gate.promise; if (h.mediaOptions.isCurrent()) lateAcks++; };
  const manager = create(h.args), pending = manager.bootstrap();
  try {
    await entered.promise; manager.dispose(); assert.equal(h.mediaOptions.isCurrent(), false); gate.resolve();
    await assert.rejects(pending, { code: 'request_cancelled' }); assert.equal(lateAcks, 0); assert.equal(h.disposals, 1);
  } finally { gate.resolve(); manager.dispose(); }
});
test('older storage or backend without the media service preserves the existing account and legacy paths', async () => {
  for (const kind of ['storage-missing', 'factory-missing', 'legacy-backend']) {
    const h = harness({ capabilities: kind === 'legacy-backend' ? 0 : 1 });
    if (kind === 'storage-missing') delete h.args.storage.listNaverMediaReceipts;
    if (kind === 'factory-missing') delete h.args.naverMediaFactory;
    const manager = create(h.args);
    try {
      const result = await manager.bootstrap();
      assert.equal(h.creates, 0, kind); assert.equal(h.log.includes('media:publish'), false, kind);
      if (kind === 'legacy-backend') { assert.equal(result.legacy, true); assert.equal(result.mode, 'unavailable'); }
      else assert.equal((await manager.getState()).status, 'synced', kind);
    } finally { manager.dispose(); }
  }
});

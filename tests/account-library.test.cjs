'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { create } = require('../assets/life/account-library.js');
const Core = require('../assets/life/core.js');
const owner = { projectUrl: 'https://library.example.invalid', userId: '11111111-1111-4111-8111-111111111111' };
const first = '22222222-2222-4222-8222-222222222222', second = '33333333-3333-4333-8333-333333333333';
function harness({ local = [], active = null, rows = [first], recovery = [], capabilities = 1, fileStatus = 'saved' } = {}) {
  const log = [], spaces = new Map(local.map(id => [id, { workspaceId: id, title: '익명 자료', revision: 0 }]));
  const states = new Map(), callbacks = new Set(); let pointer = active, originalStarts = 0;
  const auth = { epoch: 1, user: { id: owner.userId }, getAccount: () => owner, verify: async () => ({ id: auth.user.id }) };
  const storage = { isAccountScoped: true, account: owner,
    open: async () => { log.push('storage:open'); },
    listWorkspaces: async () => [...spaces.values()],
    listAccountLibraries: async () => [...spaces.values()].map(row => ({ ...row, eligible: !recovery.includes(row.workspaceId), exclusion: recovery.includes(row.workspaceId) ? 'recovery' : null })),
    getActive: async () => pointer, setActive: async id => { log.push('active:' + id); pointer = id; },
    subscribeAll: fn => { callbacks.add(fn); return () => callbacks.delete(fn); }
  };
  const state = id => states.get(id) || { enabled: false, binding: null, status: 'not_enabled', remoteRevision: 0 };
  const sync = { setAutomatic: enabled => log.push('automatic:' + enabled), start: async () => log.push('source:start'), getAccount: () => owner,
    getState: async id => state(id), subscribe: () => () => {},
    download: async (id, options) => { assert.equal(options.activate, false); log.push('receive:' + id); spaces.set(id, { workspaceId: id, title: '서버 자료', revision: 0 }); states.set(id, { enabled: true, binding: { ...owner, remoteId: id }, status: 'synced', remoteRevision: 1 }); },
    adoptExisting: async (id, options) => { log.push('adopt:' + id); if (id === first) assert.deepEqual(options, { pristine: true, pristineRevision: 1 }); states.set(id, { enabled: true, binding: { ...owner, remoteId: id }, status: 'pending', remoteRevision: 1 }); },
    enable: async id => { log.push('enable:' + id); states.set(id, { enabled: true, binding: { ...owner, remoteId: id }, status: 'synced', remoteRevision: 1 }); },
    syncNow: async (id, options) => { assert.equal(options.headIfClean, true); log.push('source:' + id); const value = { ...state(id), status: 'synced' }; states.set(id, value); return value; }
  };
  function domain(name) {
    const enabled = new Set();
    return { getState: async id => ({ enabled: enabled.has(id), status: enabled.has(id) ? 'synced' : 'not_enabled' }),
      enable: async id => { assert.equal(state(id).status, 'synced'); log.push(name + ':' + id); enabled.add(id); return { status: 'synced' }; },
      syncNow: async id => { log.push(name + ':' + id); return { status: 'synced' }; }, start: () => log.push(name + ':start'), subscribe: () => () => {} };
  }
  const remote = { capabilities: async () => ({ version: capabilities, metadataVersion: capabilities, originalsVersion: capabilities }),
    open: async preferred => { log.push('open:' + preferred); return { status: 'ready', workspace_id: first, default_revision: 1, pristine: true }; },
    catalog: async () => { log.push('catalog'); return { items: rows.map(id => ({ id, title: '익명 서버 자료', revision: 1, updated_at: '2026-10-23T00:00:00Z' })), next: null }; }, dispose: () => log.push('remote:dispose') };
  const originals = { start: () => { originalStarts++; }, getState: () => ({ mode: 'account', status: fileStatus, pending: fileStatus === 'saved' ? 0 : 1, error: null }), subscribe: () => () => {}, dispose: () => {} };
  const args = { storage, core: Core, sync, compositionSync: domain('composition'), libraryMetaSync: domain('metadata'), auth, remote, originalsFactory: () => originals, polling: false };
  return { args, log, spaces, states, auth, remote, callbacks, originals, get active() { return pointer; }, get originalStarts() { return originalStarts; } };
}
test('fresh account receives every catalog workspace silently before choosing the canonical default', async () => {
  const h = harness({ rows: [first, second] }), manager = create(h.args);
  try {
    const result = await manager.bootstrap(); assert.equal(result.workspaceId, first); assert.equal(h.active, first);
    assert.deepEqual(h.log.filter(s => s.startsWith('receive:')), ['receive:' + first, 'receive:' + second]);
    assert(h.log.indexOf('catalog') < h.log.indexOf('receive:' + first));
    assert(h.log.indexOf('source:' + first) < h.log.indexOf('metadata:' + first));
    assert.deepEqual(h.log.filter(s => s.startsWith('active:')), ['active:' + first]);
    assert.equal(h.originalStarts, 1); assert.equal((await manager.getState()).status, 'synced');
  } finally { manager.dispose(); }
});
test('existing owned library adopts only the observed pristine base and excludes automatic recovery copies', async () => {
  const h = harness({ local: [first, second], active: first, recovery: [second] }), manager = create(h.args);
  try {
    await manager.bootstrap(); assert(h.log.includes('adopt:' + first));
    assert(!h.log.some(value => value.endsWith(second))); assert.equal(h.active, first);
  } finally { manager.dispose(); }
});
test('a failed catalog bootstrap retries the default barrier and starts originals instead of falsely finishing', async () => {
  const h = harness({ local: [first], active: first }); let calls = 0;
  const catalog = h.remote.catalog; h.remote.catalog = async (...args) => { if (++calls === 1) throw Object.assign(new Error('offline'), { code: 'network_error' }); return catalog(...args); };
  const manager = create(h.args);
  try {
    const failed = await manager.bootstrap(); assert.equal(failed.cached, true); assert.equal(failed.error.code, 'network_error');
    assert.equal(h.originalStarts, 0); assert.equal((await manager.getState()).status, 'error');
    await manager.retry(); assert.equal(calls, 2); assert.equal(h.log.filter(value => value.startsWith('open:')).length, 2);
    assert.equal(h.originalStarts, 1); assert.equal((await manager.getState()).status, 'synced');
  } finally { manager.dispose(); }
});
test('an incomplete repeated catalog cursor never uploads local data or installs a partial received set', async () => {
  const h = harness({ local: [first], active: first });
  h.remote.catalog = async () => ({ items: [{ id: first }], next: first });
  const manager = create(h.args);
  try {
    const result = await manager.bootstrap(); assert.equal(result.error.code, 'invalid_remote_data');
    assert(!h.log.some(value => /^(receive|adopt|enable|source|metadata):[0-9a-f-]{36}$/.test(value))); assert.equal(h.active, first);
  } finally { manager.dispose(); }
});
test('a missing established default never creates or uploads a replacement', async () => {
  const h = harness({ local: [first], active: first });
  h.remote.open = async () => ({ status: 'missing', workspace_id: first, default_revision: 0, pristine: false });
  const manager = create(h.args);
  try {
    const result = await manager.bootstrap(); assert.equal(result.error.code, 'remote_missing');
    assert(!h.log.includes('catalog')); assert(!h.log.some(value => /^(adopt|enable|receive):/.test(value))); assert.equal(h.active, first);
  } finally { manager.dispose(); }
});
test('original archive cached/pending status is never represented as acknowledged account storage', async () => {
  const h = harness({ fileStatus: 'cached' }), manager = create(h.args);
  try { await manager.bootstrap(); assert.equal((await manager.getState()).status, 'pending'); }
  finally { manager.dispose(); }
});
test('explicit older-backend capability preserves legacy behavior without opening or claiming an account library', async () => {
  const h = harness({ capabilities: 0 }), manager = create(h.args);
  try {
    const result = await manager.bootstrap(); assert.equal(result.mode, 'unavailable'); assert.equal(result.legacy, true);
    assert(h.log.includes('automatic:true')); assert(!h.log.some(value => value.startsWith('open:'))); assert.equal(h.originalStarts, 0);
    assert.notEqual((await manager.getState()).status, 'synced');
  } finally { manager.dispose(); }
});
test('an account switch while catalog is outstanding prevents receipt, upload and activation in the old scope', async () => {
  const h = harness(); let release, entered;
  const reached = new Promise(resolve => entered = resolve);
  h.remote.catalog = async () => { entered(); return new Promise(resolve => release = resolve); };
  const manager = create(h.args), pending = manager.bootstrap();
  try {
    await reached; h.auth.epoch++; h.auth.user = { id: second }; release({ items: [], next: null });
    await assert.rejects(pending, { code: 'request_cancelled' });
    assert(!h.log.some(value => /^(receive|adopt|enable|active):/.test(value)));
  } finally { manager.dispose(); }
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { create } = require('../assets/life/account-library.js');
const Core = require('../assets/life/core.js');
const owner = { projectUrl: 'https://library.example.invalid', userId: '11111111-1111-4111-8111-111111111111' };
const first = '22222222-2222-4222-8222-222222222222', second = '33333333-3333-4333-8333-333333333333';
function harness({ local = [], active = null, rows = [first], recovery = [], capabilities = 1, fileStatus = 'saved' } = {}) {
  const log = [], spaces = new Map(local.map(id => [id, { workspaceId: id, title: '익명 자료', revision: 0 }]));
  const states = new Map(), metadataStates = new Map(), callbacks = new Set();
  let pointer = active, originalCreates = 0, originalStarts = 0, originalDisposals = 0;
  const auth = { epoch: 1, user: { id: owner.userId }, getAccount: () => owner, verify: async () => ({ id: auth.user.id }) };
  const storage = { isAccountScoped: true, account: owner,
    open: async () => { log.push('storage:open'); },
    listWorkspaces: async () => [...spaces.values()],
    listAccountLibraries: async () => [...spaces.values()].map(row => ({ ...row, eligible: !recovery.includes(row.workspaceId), exclusion: recovery.includes(row.workspaceId) ? 'recovery' : null })),
    getActive: async () => pointer, setActive: async id => { log.push('active:' + id); pointer = id; },
    getSyncState: async id => states.get(id) || null,
    getLibraryMetaState: async id => metadataStates.get(id) || null,
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
  const originals = { start: () => { originalStarts++; }, getState: () => ({ mode: 'account', status: fileStatus, pending: fileStatus === 'saved' ? 0 : 1, error: null }), subscribe: () => () => {}, dispose: () => { originalDisposals++; } };
  const args = { storage, core: Core, sync, compositionSync: domain('composition'), libraryMetaSync: domain('metadata'), auth, remote, originalsFactory: () => { originalCreates++; return originals; }, polling: false };
  return { args, log, spaces, states, metadataStates, auth, remote, callbacks, originals, get active() { return pointer; },
    get originalCreates() { return originalCreates; }, get originalStarts() { return originalStarts; }, get originalDisposals() { return originalDisposals; } };
}
function acknowledgedCache(h, id = first) {
  const value = { enabled: true, binding: { ...owner, remoteId: id }, status: 'synced', remoteRevision: 4, syncedLocalRevision: 0 };
  h.states.set(id, structuredClone(value)); h.metadataStates.set(id, { ...structuredClone(value), sourceRevision: 4 });
}
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
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
const storageNotices = [
  ['storage_version_changed', '다른 버전의 저장소입니다. 이 화면을 새로고침하세요.'],
  ['storage_blocked', '다른 탭이 저장소 열기를 막고 있습니다. 다른 탭을 닫고 다시 여세요.'],
  ['storage_quota', '브라우저 저장 공간이 부족합니다. 입력을 보존하고 백업을 내려받으세요.'],
  ['storage_unavailable', '이 브라우저에서 저장소를 사용할 수 없습니다. 입력을 보존하고 브라우저 저장소 설정을 확인하세요.'],
  ...['storage_terminated', 'storage_aborted', 'storage_error', 'storage_future'].map(code =>
    [code, '브라우저 저장소를 읽거나 저장하지 못했습니다. 입력을 보존하고 새로고침하세요.'])
];
for (const [code, message] of storageNotices) test('account library preserves ' + code + ' and offers storage recovery through public operations', async () => {
  const h = harness({ local: [first], active: first }), before = structuredClone([...h.spaces]);
  const list = h.args.storage.listAccountLibraries;
  h.args.storage.listAccountLibraries = async () => { throw Object.assign(new Error('private raw detail'), { code }); };
  const manager = create(h.args);
  try {
    const failed = await manager.bootstrap();
    assert.deepEqual(failed.error, { code, message }); assert.equal(failed.cached, true);
    assert.deepEqual((await manager.getState()).error, { code, message });
    assert.deepEqual([...h.spaces], before); assert.equal(h.active, first);
    assert(!h.log.some(value => /^(receive|adopt|enable|source:222)/.test(value)), 'No replacement or upload while storage is unavailable');
    h.args.storage.listAccountLibraries = list; await manager.retry();
    assert.equal((await manager.getState()).status, 'synced');
    const recovered = structuredClone([...h.spaces]);
    h.args.storage.listAccountLibraries = async () => { throw Object.assign(new Error('private raw detail'), { code }); };
    const failedAgain = await manager.reconcile();
    assert.equal(failedAgain.status, 'error'); assert.deepEqual(failedAgain.error, { code, message });
    assert.deepEqual([...h.spaces], recovered); assert.equal(h.active, first);
    h.args.storage.listAccountLibraries = list; await manager.retry();
    assert.equal((await manager.getState()).error, null);
    h.args.sync.getState = async () => { throw Object.assign(new Error('private raw detail'), { code }); };
    const failedRead = await manager.getState();
    assert.equal(failedRead.status, 'error'); assert.deepEqual(failedRead.domains.sources.error, { code, message });
  } finally { manager.dispose(); }
});
test('non-storage failures keep their existing public mapping without leaking raw errors', async () => {
  for (const [code, expected, message] of [
    ['auth_required', 'auth_required', '로그인 계정을 다시 확인해 주세요.'],
    ['request_cancelled', 'request_cancelled', '계정이 바뀌어 이전 자료 요청을 중단했습니다.'],
    ['network_error', 'network_error', '서버에 연결하지 못했습니다. 자료는 전송 대기 상태로 유지됩니다.'],
    ...['storage', 'unknown', null, 42, {}].map(code => [code, 'network_error', '서버에 연결하지 못했습니다. 자료는 전송 대기 상태로 유지됩니다.'])
  ]) {
    const h = harness({ local: [first], active: first });
    h.args.storage.listAccountLibraries = async () => { throw Object.assign(new Error('private raw detail'), { code }); };
    const manager = create(h.args);
    try { assert.deepEqual((await manager.bootstrap()).error, { code: expected, message }); }
    finally { manager.dispose(); }
  }
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
    assert.equal(h.originalCreates, 0); assert.equal(manager.originals, null);
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
test('foreground cache waits for fresh Auth and starts no remote work before explicit reconciliation', async () => {
  const h = harness({ local: [first], active: first }); acknowledgedCache(h);
  const authorization = deferred(), entered = deferred();
  h.auth.verify = async () => { entered.resolve(); await authorization.promise; return { id: owner.userId }; };
  const manager = create(h.args), pending = manager.bootstrap({ foreground: true });
  try {
    await entered.promise; assert.deepEqual(h.log, [], 'No private storage opens before verification');
    assert.equal(h.originalCreates, 0); assert.equal(manager.originals, null);
    authorization.resolve(); const result = await pending;
    assert.deepEqual(result, { mode: 'account', workspaceId: first, cached: true, background: true });
    assert.deepEqual(h.log, ['storage:open']); assert.equal(h.originalStarts, 0);
    assert.equal(manager.originals, h.originals); assert.equal(h.originalCreates, 1);
    assert.notEqual((await manager.getState()).status, 'synced');
    for (const callback of h.callbacks) callback({ type: 'changed', workspaceId: first });
    await new Promise(resolve => setTimeout(resolve, 380));
    assert.deepEqual(h.log, ['storage:open'], 'Storage events cannot race the caller before mount/reveal');
    await manager.reconcile(); assert(h.log.includes('catalog'));
    assert.equal(h.originalStarts, 1); assert.equal((await manager.getState()).status, 'synced');
    assert.equal(manager.originals, h.originals); assert.equal(h.originalCreates, 1);
  } finally { authorization.resolve(); manager.dispose(); }
});
test('failed foreground authentication never falls back to an unread private active pointer', async () => {
  const h = harness({ local: [first], active: first }); acknowledgedCache(h); let privateReads = 0;
  for (const name of ['getActive', 'listAccountLibraries', 'getSyncState', 'getLibraryMetaState']) {
    const original = h.args.storage[name]; h.args.storage[name] = async (...args) => { privateReads++; return original(...args); };
  }
  h.auth.verify = async () => { throw Object.assign(new Error('offline'), { code: 'network_error' }); };
  const manager = create(h.args);
  try {
    const result = await manager.bootstrap({ foreground: true });
    assert.equal(result.cached, false); assert.equal(result.error.code, 'network_error');
    assert.equal(privateReads, 0); assert.deepEqual(h.log, []);
    assert.equal(h.originalCreates, 0); assert.equal(manager.originals, null);
  } finally { manager.dispose(); }
});
test('unbound, unacknowledged, mismatched and recovery copies cannot become a foreground account cache', async () => {
  for (const kind of ['unbound', 'unacknowledged', 'metadata-owner', 'source-id', 'recovery']) {
    const h = harness({ local: [first, second], active: kind === 'recovery' ? second : first,
      recovery: kind === 'recovery' ? [second] : [] });
    const id = kind === 'recovery' ? second : first; acknowledgedCache(h, id);
    if (kind === 'unbound') h.metadataStates.delete(id);
    if (kind === 'unacknowledged') h.metadataStates.get(id).remoteRevision = 0;
    if (kind === 'metadata-owner') h.metadataStates.get(id).binding.userId = second;
    if (kind === 'source-id') h.states.get(id).binding.remoteId = second;
    const manager = create(h.args);
    try {
      await manager.bootstrap({ foreground: true });
      assert(h.log.some(value => value.startsWith('open:')), kind + ' must pass the remote default barrier');
      assert(!h.log.some(value => /^(receive|adopt|enable|source|metadata):/.test(value) && value.endsWith(second)), 'Recovery is not synchronized');
    } finally { manager.dispose(); }
  }
});
test('a new device prepares the canonical space before the catalog and secondary spaces', async () => {
  const h = harness({ rows: [second, first] }), manager = create(h.args);
  try {
    const result = await manager.bootstrap({ foreground: true });
    assert.deepEqual(result, { mode: 'account', workspaceId: first, background: true, cached: true });
    assert.deepEqual(h.log.filter(value => value.startsWith('receive:')), ['receive:' + first]);
    assert(!h.log.includes('catalog')); assert.equal(h.active, first);
    assert(h.log.indexOf('source:' + first) < h.log.indexOf('composition:' + first));
    assert(h.log.indexOf('source:' + first) < h.log.indexOf('metadata:' + first));
    assert.equal(h.originalStarts, 0); assert.notEqual((await manager.getState()).status, 'synced');
    assert.equal(manager.originals, h.originals); assert.equal(h.originalCreates, 1);
    await manager.reconcile();
    assert(h.log.includes('receive:' + second)); assert.equal(h.active, first);
    assert.deepEqual(h.log.filter(value => value.startsWith('active:')), ['active:' + first]);
    assert.equal((await manager.getState()).status, 'synced');
  } finally { manager.dispose(); }
});
test('a selected-space metadata failure remains visible until the same domain succeeds on retry', async () => {
  const h = harness(), original = h.args.libraryMetaSync.enable; let fail = true;
  h.args.libraryMetaSync.enable = async (...args) => { if (fail) throw Object.assign(new Error('offline'), { code: 'network_error' }); return original(...args); };
  const manager = create(h.args);
  try {
    const result = await manager.bootstrap({ foreground: true }); assert.equal(result.workspaceId, first);
    assert.equal((await manager.getState()).status, 'error'); assert.equal(h.originalStarts, 0);
    fail = false; await manager.retry();
    assert.equal((await manager.getState()).status, 'synced'); assert.equal(h.originalStarts, 1);
  } finally { manager.dispose(); }
});
test('a missing canonical default after foreground cache preserves dirty and conflicted state without uploading', async () => {
  const h = harness({ local: [first], active: first }); acknowledgedCache(h);
  Object.assign(h.states.get(first), { status: 'conflict', conflict: { remoteRevision: 5 }, outbox: { operationId: second, localRevision: 1 } });
  Object.assign(h.metadataStates.get(first), { status: 'pending', outbox: { operationId: first, sourceRevision: 4, localRevision: 1 } });
  const before = structuredClone({ source: h.states.get(first), metadata: h.metadataStates.get(first) });
  h.remote.open = async () => ({ status: 'missing', workspace_id: first, default_revision: 0, pristine: false });
  const manager = create(h.args);
  try {
    const result = await manager.bootstrap({ foreground: true }); assert.equal(result.workspaceId, first);
    assert.deepEqual({ source: h.states.get(first), metadata: h.metadataStates.get(first) }, before);
    await manager.reconcile();
    assert.deepEqual({ source: h.states.get(first), metadata: h.metadataStates.get(first) }, before);
    const state = await manager.getState(); assert.notEqual(state.status, 'synced'); assert.equal(state.error.code, 'remote_missing');
    assert(!h.log.some(value => /^(receive|adopt|enable|source|metadata):[0-9a-f-]{36}$/.test(value)));
    assert.equal(h.active, first);
  } finally { manager.dispose(); }
});
test('an acknowledged foreground account cache cannot silently downgrade into legacy local storage', async () => {
  const h = harness({ local: [first], active: first, capabilities: 0 }); acknowledgedCache(h);
  const manager = create(h.args);
  try {
    await manager.bootstrap({ foreground: true });
    const failed = await manager.reconcile();
    assert.equal(failed.mode, 'account'); assert.equal(failed.legacy, false); assert.equal(failed.error.code, 'schema_missing');
    assert.equal((await manager.getState()).status, 'error'); assert.equal(manager.getMode(), 'account');
    assert(!h.log.includes('automatic:true')); assert(!h.log.includes('source:start')); assert.equal(h.originalStarts, 0);
    h.remote.capabilities = async () => ({ version: 1, metadataVersion: 1, originalsVersion: 1 });
    await manager.retry(); assert.equal((await manager.getState()).status, 'synced');
  } finally { manager.dispose(); }
});
test('a pending first catalog is retried after a local event instead of cleared by a partial reconciliation', { timeout: 3000 }, async () => {
  const h = harness({ rows: [first, second] }), original = h.remote.catalog;
  const firstEntered = deferred(), firstRelease = deferred(), retryEntered = deferred(), retryRelease = deferred(); let calls = 0;
  h.remote.catalog = async () => {
    if (++calls === 1) { firstEntered.resolve(); await firstRelease.promise; throw Object.assign(new Error('offline'), { code: 'network_error' }); }
    retryEntered.resolve(); await retryRelease.promise; return original();
  };
  const manager = create(h.args);
  try {
    await manager.bootstrap({ foreground: true });
    const pending = manager.reconcile(); await firstEntered.promise;
    for (const callback of h.callbacks) callback({ type: 'changed', workspaceId: first });
    firstRelease.resolve(); await pending;
    assert.equal((await manager.getState()).status, 'error'); assert(!h.spaces.has(second));
    let retryDeadline;
    try {
      // The production debounce is unref'ed; keep this harness wait alive and bounded.
      await Promise.race([retryEntered.promise, new Promise((_, reject) => {
        retryDeadline = setTimeout(() => reject(new Error('Scheduled authoritative catalog retry did not begin within 2 seconds')), 2000);
      })]);
    } finally { clearTimeout(retryDeadline); }
    assert.equal(calls, 2); assert(!h.spaces.has(second));
    assert.notEqual((await manager.getState()).status, 'synced');
    retryRelease.resolve(); await manager.reconcile({ refreshCatalog: false });
    assert(h.spaces.has(second)); assert.equal((await manager.getState()).status, 'synced');
  } finally { firstRelease.resolve(); retryRelease.resolve(); manager.dispose(); }
});
test('account invalidation during cache inspection rejects the old foreground result without network work', async () => {
  const h = harness({ local: [first], active: first }); acknowledgedCache(h);
  const entered = deferred(), release = deferred(), original = h.args.storage.getLibraryMetaState;
  h.args.storage.getLibraryMetaState = async id => { entered.resolve(); await release.promise; return original(id); };
  const manager = create(h.args), pending = manager.bootstrap({ foreground: true });
  try {
    await entered.promise; h.auth.epoch++; h.auth.user = { id: second }; release.resolve();
    await assert.rejects(pending, { code: 'request_cancelled' });
    assert.deepEqual(h.log, ['storage:open']); assert.equal(h.originalStarts, 0);
  } finally { release.resolve(); manager.dispose(); }
});
test('disposing a displayed cache prevents all deferred account work', async () => {
  const h = harness({ local: [first], active: first }); acknowledgedCache(h);
  const manager = create(h.args);
  await manager.bootstrap({ foreground: true }); assert.equal(manager.originals, h.originals);
  manager.dispose(); manager.dispose();
  await assert.rejects(manager.reconcile(), { code: 'request_cancelled' });
  assert.deepEqual(h.log, ['storage:open', 'remote:dispose']);
  assert.equal(h.originalCreates, 1); assert.equal(h.originalStarts, 0); assert.equal(h.originalDisposals, 1);
});
test('another tab selecting a space during cold preparation retains its pointer and uses the full barrier', async () => {
  const h = harness({ local: [second], rows: [first, second] }), original = h.args.sync.download;
  h.args.sync.download = async (...args) => { const result = await original(...args); await h.args.storage.setActive(second); return result; };
  const manager = create(h.args);
  try {
    const result = await manager.bootstrap({ foreground: true });
    assert.equal(result.workspaceId, second); assert.equal(result.background, false);
    assert.equal(h.active, second); assert(h.log.includes('catalog'));
    assert.deepEqual(h.log.filter(value => value.startsWith('active:')), ['active:' + second]);
    assert.equal((await manager.getState()).status, 'synced');
  } finally { manager.dispose(); }
});
test('warm background bootstrap preserves an explicitly selected recovery pointer without enrolling it', async () => {
  const h = harness({ local: [first, second], active: first, recovery: [second] }); acknowledgedCache(h);
  const entered = deferred(), release = deferred(), original = h.remote.catalog;
  h.remote.catalog = async (...args) => { entered.resolve(); await release.promise; return original(...args); };
  const manager = create(h.args);
  try {
    await manager.bootstrap({ foreground: true }); const pending = manager.reconcile();
    await entered.promise; await h.args.storage.setActive(second); release.resolve();
    const result = await pending; assert.equal(result.workspaceId, second); assert.equal(h.active, second);
    assert.deepEqual(h.log.filter(value => value.startsWith('active:')), ['active:' + second]);
    assert(!h.log.some(value => /^(receive|adopt|enable|source|metadata):/.test(value) && value.endsWith(second)));
    assert.notEqual((await manager.getState()).status, 'synced');
  } finally { release.resolve(); manager.dispose(); }
});
test('a foreground account refresh failure still exposes the shared originals service without starting it', async () => {
  const h = harness({ local: [first], active: first });
  h.remote.open = async () => ({ status: 'missing', workspace_id: first, default_revision: 0, pristine: false });
  const manager = create(h.args);
  try {
    const result = await manager.bootstrap({ foreground: true });
    assert.equal(result.mode, 'account'); assert.equal(result.cached, true); assert.equal(result.error.code, 'remote_missing');
    assert.equal(manager.originals, h.originals); assert.equal(h.originalCreates, 1); assert.equal(h.originalStarts, 0);
    assert.equal((await manager.getState()).status, 'error');
    assert(!h.log.some(value => /^(receive|adopt|enable):/.test(value)));
  } finally { manager.dispose(); }
});
test('the prepared originals service survives a start failure and starts only once after recovery', async () => {
  const h = harness({ local: [first], active: first }); acknowledgedCache(h); let attempts = 0;
  const start = h.originals.start;
  h.originals.start = () => { if (++attempts === 1) throw Object.assign(new Error('offline'), { code: 'network_error' }); start(); };
  const manager = create(h.args);
  try {
    await manager.bootstrap({ foreground: true }); const shared = manager.originals;
    await manager.reconcile();
    assert.equal((await manager.getState()).status, 'error'); assert.equal(manager.originals, shared);
    assert.equal(h.originalCreates, 1); assert.equal(h.originalDisposals, 0); assert.equal(h.originalStarts, 0);
    await manager.reconcile(); await manager.reconcile();
    assert.equal((await manager.getState()).status, 'synced'); assert.equal(manager.originals, shared);
    assert.equal(attempts, 2); assert.equal(h.originalStarts, 1); assert.equal(h.originalCreates, 1);
  } finally { manager.dispose(); }
  assert.equal(h.originalDisposals, 1);
});
test('an originals subscription failure closes the partial service and remains retryable', async () => {
  const h = harness({ local: [first], active: first }); acknowledgedCache(h);
  const factory = h.args.originalsFactory; let attempts = 0, partialClosed = 0;
  h.args.originalsFactory = options => ++attempts === 1 ? {
    subscribe() { throw Object.assign(new Error('subscription failed'), { code: 'network_error' }); },
    dispose() { partialClosed++; }
  } : factory(options);
  const manager = create(h.args);
  try {
    await manager.bootstrap({ foreground: true });
    assert.equal(manager.originals, null); assert.equal(partialClosed, 1);
    assert.equal((await manager.getState()).status, 'error'); assert.equal(h.originalStarts, 0);
    await manager.reconcile();
    assert.equal(manager.originals, h.originals); assert.equal(partialClosed, 1); assert.equal(attempts, 2);
    assert.equal((await manager.getState()).status, 'synced'); assert.equal(h.originalStarts, 1);
  } finally { manager.dispose(); }
});
test('preparing the actual originals service performs no storage or remote work before explicit use', async () => {
  const h = harness({ local: [first], active: first }); acknowledgedCache(h);
  const Originals = require('../assets/life/original-attachments.js'); let storageOpens = 0, remoteCalls = 0;
  h.args.originalsFactory = ({ auth }) => Originals.create({ auth, broadcast: false,
    indexedDB: { open() { storageOpens++; throw new Error('Unexpected early storage access'); } },
    remote: { capabilities: async () => { remoteCalls++; throw new Error('Unexpected early remote request'); } }
  });
  const manager = create(h.args);
  try {
    await manager.bootstrap({ foreground: true });
    assert.equal(typeof manager.originals.archive, 'function'); assert.equal(manager.originals.getState().mode, 'local');
    assert.equal(storageOpens, 0); assert.equal(remoteCalls, 0);
    assert.notEqual((await manager.getState()).status, 'synced');
  } finally { manager.dispose(); }
  assert.equal(storageOpens, 0); assert.equal(remoteCalls, 0);
});
// 2026-11-04 startup latency: background receive takes two account spaces at a time.
const third = '44444444-4444-4444-8444-444444444444';
async function until(condition, label) { for (let i = 0; i < 500; i++) { if (condition()) return; await new Promise(done => setImmediate(done)); } throw Error(label); }
function gatedDownloads(h) {
  const original = h.args.sync.download, gates = new Map(); let inFlight = 0, peak = 0;
  h.args.sync.download = async (id, options) => {
    inFlight++; peak = Math.max(peak, inFlight); const gate = deferred(); gates.set(id, gate);
    try { if (await gate.promise === 'fail') throw Object.assign(Error('offline'), { code: 'network_error' }); return await original(id, options); } finally { inFlight--; }
  };
  return { gates, get peak() { return peak; }, get inFlight() { return inFlight; } };
}
test('background receive takes at most two account spaces at a time and then every space', async () => {
  const h = harness({ rows: [first, second, third] }), downloads = gatedDownloads(h), manager = create(h.args);
  try {
    const pending = manager.bootstrap();
    await until(() => downloads.gates.size === 2, 'two receives did not start');
    assert.equal(downloads.inFlight, 2); assert.ok(!downloads.gates.has(third), 'a third space waits for a free slot');
    downloads.gates.get(first).resolve();
    await until(() => downloads.gates.has(third), 'the third receive did not start after one finished');
    assert.equal(downloads.peak, 2);
    downloads.gates.get(second).resolve(); downloads.gates.get(third).resolve();
    const result = await pending; assert.equal(result.workspaceId, first);
    assert.deepEqual(h.log.filter(s => s.startsWith('receive:')).sort(), ['receive:' + first, 'receive:' + second, 'receive:' + third].sort());
    for (const id of [first, second, third]) assert.ok(h.log.indexOf('source:' + id) < h.log.indexOf('metadata:' + id), 'each space keeps originals before its domains');
    assert.deepEqual(h.log.filter(s => s.startsWith('active:')), ['active:' + first]);
  } finally { manager.dispose(); }
});
test('a failed space receive starts no further spaces and settles only after the started one finishes', async () => {
  const h = harness({ rows: [first, second, third] }), downloads = gatedDownloads(h), manager = create(h.args);
  try {
    let settled = false; const pending = manager.bootstrap().finally(() => { settled = true; });
    await until(() => downloads.gates.size === 2, 'two receives did not start');
    downloads.gates.get(second).resolve('fail');
    for (let i = 0; i < 50; i++) await new Promise(done => setImmediate(done));
    assert.equal(settled, false, 'the started receive is still running');
    assert.ok(!downloads.gates.has(third), 'no space starts after a failure');
    downloads.gates.get(first).resolve();
    // #185 review minor 1: the failed receive is reported, never shown as a finished pass.
    const result = await pending;
    assert.equal(result.error?.code, 'network_error', 'the bootstrap reports the failed receive');
    assert.equal((await manager.getState()).status === 'synced', false, 'the account is not shown as synchronized');
    assert.ok(!downloads.gates.has(third)); assert.equal(downloads.inFlight, 0);
    assert.ok(h.log.includes('receive:' + first) && !h.log.includes('receive:' + second));
  } finally { manager.dispose(); }
});

// 2026-11-11 originals merge: the originals settle their own differences (both sides' items stay),
// like the two other domains. A recorded difference therefore still runs; only a deleted server
// copy waits. (Before: any recorded originals conflict stopped the workspace until a choice.)
test('a recorded originals difference still runs and the other domains follow; a deleted server copy waits', async () => {
  for (const missing of [false, true]) {
    const h = harness({ local: [first], active: first }); acknowledgedCache(h);
    Object.assign(h.states.get(first), { status: 'conflict', conflict: { missing, remoteRevision: 5 } });
    const run = h.args.sync.syncNow;
    h.args.sync.syncNow = async (id, options) => { delete h.states.get(id).conflict; return run(id, options); }; // the run merges it
    const manager = create(h.args);
    try {
      await manager.bootstrap();
      assert.equal(h.log.includes('source:' + first), !missing, 'missing=' + missing);
      assert.equal(h.log.includes('composition:' + first), !missing); assert.equal(h.log.includes('metadata:' + first), !missing);
      assert.equal((await manager.getState()).status, missing ? 'conflict' : 'synced');
    } finally { manager.dispose(); }
  }
});
// While a pass runs, a recorded difference is one the pass is about to settle: no conflict band.
// What is still recorded when the pass ends could not be merged and needs the person.
test('a recorded difference is shown as a conflict only when the pass could not settle it', async () => {
  const h = harness({ local: [first], active: first }); acknowledgedCache(h);
  Object.assign(h.states.get(first), { status: 'conflict', conflict: { missing: false, remoteRevision: 5 } });
  let gate = null, merge = false;
  h.args.sync.syncNow = async id => { await gate?.promise; if (merge) Object.assign(h.states.get(id), { status: 'synced', conflict: null }); return h.states.get(id); };
  const manager = create(h.args);
  try {
    await manager.bootstrap();
    assert.equal((await manager.getState()).status, 'conflict', 'still recorded after the pass: the person compares');
    // The next pass (a poll, a retry) is running: the difference it is about to settle is not announced again.
    gate = deferred(); merge = true;
    const pass = manager.reconcile();
    for (let i = 0; i < 20; i++) await new Promise(done => setImmediate(done));
    assert.equal((await manager.getState()).status, 'syncing', 'not shown as a conflict while the pass is running');
    gate.resolve(); await pass;
    assert.equal((await manager.getState()).status, 'synced');
    // A deleted server copy is shown at once, also during a pass.
    Object.assign(h.states.get(first), { status: 'conflict', conflict: { missing: true, remoteRevision: 5 } });
    gate = deferred(); const waiting = manager.reconcile();
    for (let i = 0; i < 20; i++) await new Promise(done => setImmediate(done));
    assert.equal((await manager.getState()).status, 'conflict');
    gate.resolve(); await waiting;
  } finally { manager.dispose(); }
});

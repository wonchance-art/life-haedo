'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../assets/life/core.js');
const SyncCommon = require('../assets/life/sync-common.js');
const source = fs.readFileSync(require.resolve('../assets/life/sync.js'), 'utf8');
// The page loads sync-lifecycle.js before sync.js (S2); the engine binds its events through it.
const lifecycleSource = fs.readFileSync(require.resolve('../assets/life/sync-lifecycle.js'), 'utf8');
const CONFIG = { url: 'https://sync-fixture.example.invalid', key: 'sb_publishable_fixture_only' };
const account = id => ({ userId: id, email: `${id}@example.invalid`, projectUrl: CONFIG.url });
const copy = value => structuredClone(value);
const error = code => Object.assign(new Error('private server detail must not escape'), { code });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); } assert.fail('expected state did not settle'); }
const code = expected => value => { assert.equal(value.code, expected); return true; };

// Thin decision fixture: real SDK/IDB/CAS durability is covered by life-sync-browser.cjs.
// This fixture controls otherwise difficult auth and preview response interleavings.
function fixture(t, options = {}) {
  const state = { saved: options.saved ? copy(CONFIG) : null, session: account('a'), offline: false,
    calls: 0, adapters: [], meta: null, local: Core.createWorkspace(), row: null, copies: [], errors: [], writes: 0,
    localCalls: [], sent: [], logoutCalls: 0, applied: [], readCalls: 0, headCalls: 0 };
  const events = new Map(), visibility = new Map();
  const storage = {
    ...(options.owner ? { account: copy(options.owner) } : {}),
    async listWorkspaces() { state.localCalls.push('list'); return state.meta ? [{ workspaceId: state.local.workspaceId }] : []; },
    async getSyncState() { state.localCalls.push('state'); const result = copy(state.meta); if (state.stateGate) await state.stateGate.promise; return result; },
    async read() { state.localCalls.push('read'); return copy(state.local); },
    async applySyncRemote(_id, _binding, row) {
      state.applied.push(copy(row));
      if (state.applyError) throw error(state.applyError);
      return { status: state.applyConflict ? 'conflict' : 'stored', revision: state.local.revision };
    },
    subscribe() { return () => {}; },
    async prepareSyncUpload() { if (state.prepareError) throw error(state.prepareError); return null; },
    async ackSync(_id, _binding, operationId, revision) {
      assert.equal(operationId, state.meta.outbox.operationId);
      state.meta.syncedLocalRevision = state.meta.outbox.localRevision;
      state.meta.remoteRevision = revision; state.meta.outbox = null; state.meta.status = 'synced';
    },
    async setSyncError(_id, _binding, value) { state.errors.push(copy(value)); state.meta.error = value; state.meta.status = value ? 'error' : 'pending'; },
    async setSyncConflict(_id, _binding, row) {
      if (state.meta.conflict?.row && row?.revision === state.meta.conflict.remoteRevision) assert.deepEqual(row.data, state.meta.conflict.row.data);
      state.meta.conflict = { missing: !row, row: copy(row), remoteRevision: row?.revision ?? state.meta.remoteRevision, localRevision: state.local.revision };
      state.meta.status = 'conflict'; return copy(state.meta);
    },
    async resolveSync(_id, _binding, resolution) {
      if (state.local.revision !== resolution.expectedLocalRevision || state.meta.conflict.localRevision !== resolution.expectedLocalRevision) throw error('sync_conflict_changed');
      assert.notEqual(resolution.copy.workspaceId, state.local.workspaceId);
      state.copies.push(copy(resolution.copy));
      if (resolution.choice === 'remote') state.local = { ...copy(resolution.remoteRow.data), revision: state.local.revision + 1 };
      state.meta.conflict = null; state.meta.status = resolution.choice === 'remote' ? 'synced' : 'pending';
      return { bundle: copy(state.local), metadata: copy(state.meta), copyWorkspaceId: resolution.copy.workspaceId };
    }
  };
  // options.merge: the storage joins both sides as storage.js does (the real merge function);
  // prepareSyncUpload then hands out the merged snapshot as the next request.
  if (options.merge) Object.assign(storage, {
    async mergeSyncRemote(_id, _binding, row) {
      (state.merges ||= []).push(copy(row));
      if (state.mergeError) throw error(state.mergeError);
      const result = SyncCommon.mergeWorkspace({ base: state.base || null, local: state.local, remote: row.data });
      if (!result.equalsLocal) state.local = { ...copy(result.bundle), revision: state.local.revision + 1 };
      state.base = SyncCommon.mergeBase(row.data);
      Object.assign(state.meta, { outbox: null, conflict: null, error: null, remoteRevision: row.revision,
        syncedLocalRevision: result.equalsRemote ? state.local.revision : -1, status: result.equalsRemote ? 'synced' : 'pending' });
      return { status: 'merged' };
    },
    async prepareSyncUpload() {
      if (state.meta.outbox) return copy(state.meta.outbox);
      if (state.local.revision === state.meta.syncedLocalRevision) return null;
      state.meta.outbox = { operationId: Core.id(), expectedRevision: state.meta.remoteRevision, localRevision: state.local.revision, data: copy(state.local) };
      return copy(state.meta.outbox);
    },
    async captureSyncBase() { state.captures = (state.captures || 0) + 1; return true; }
  });
  const factory = settings => {
    const adapter = {
      disposed: false,
      async getAccount() {
        state.calls++;
        if (state.accountGate) await state.accountGate.promise;
        if (adapter.disposed) throw error('stale_session');
        if (state.offline) throw error('network_error');
        if (state.authError) throw error(state.authError);
        return copy(state.session);
      },
      async signIn(email) {
        const gate = state.loginGate; if (gate) { state.loginGate = null; await gate.promise; }
        if (adapter.disposed) throw error('stale_session');
        state.session = account(email.split('@')[0]); return copy(state.session);
      },
      async signOut() {
        state.logoutCalls++;
        state.logoutStarted = true;
        if (state.logoutGate) await state.logoutGate.promise;
        if (adapter.disposed) throw error('stale_session');
        if (state.logoutError) throw error(state.logoutError);
        state.session = null;
      },
      onAuthChange(listener) { adapter.listener = listener; return () => { adapter.listener = null; }; },
      async read() { state.readCalls++; const row = copy(state.row); if (state.readGate) await state.readGate.promise; return row; },
      async write(request) {
        state.writes++; state.sent.push(copy(request));
        if (!options.successfulWrites) throw error('unexpected_write');
        // options.cas: the server refuses a request written against another revision.
        state.beforeWrite?.(request);
        if (options.cas && state.row && state.row.revision !== request.expectedRevision) return { status: 'conflict', revision: state.row.revision };
        state.row = { id: request.workspaceId, title: request.data.title, revision: request.expectedRevision + 1,
          data: copy(request.data), updated_at: '2026-10-03T00:00:00Z' };
        return { status: 'stored', revision: state.row.revision };
      },
      dispose() { adapter.disposed = true; }
    };
    if (options.head) adapter.head = async () => {
      state.headCalls++; assert.equal(!!state.meta.outbox, false);
      return state.row && { id: state.row.id, revision: state.row.revision, title: state.row.title, updated_at: state.row.updated_at };
    };
    // W4: an adapter may offer cycle(), one scoped view per engine operation.
    if (options.cycles) adapter.cycle = () => {
      const view = { ended: false, calls: [], end() { view.ended = true; } };
      for (const name of ['getAccount', 'list', 'read', 'write', 'head']) if (adapter[name]) view[name] = (...args) => { assert.equal(view.ended, false, 'no call after end()'); view.calls.push(name); return adapter[name](...args); };
      (state.cycles ||= []).push(view); return view;
    };
    assert.equal(settings.url, CONFIG.url); state.adapters.push(adapter); return adapter;
  };
  factory.loadConfig = () => copy(options.shared ? CONFIG : state.saved);
  factory.saveConfig = value => { if (!options.shared) state.saved = copy(value); };
  const context = { module: { exports: {} }, URL, setTimeout, clearTimeout,
    setInterval: callback => { state.periodic = callback; return { unref() {} }; }, clearInterval() {},
    addEventListener: (type, callback) => events.set(type, callback), removeEventListener: type => events.delete(type),
    document: { visibilityState: 'visible', addEventListener: (type, callback) => visibility.set(type, callback), removeEventListener: type => visibility.delete(type) } };
  vm.createContext(context); vm.runInContext(lifecycleSource, context); vm.runInContext(source, context);
  const core = options.core || Core;
  const manager = context.module.exports.create({ storage, core, remoteFactory: factory, automatic: options.automatic ?? true });
  t.after(() => manager.dispose());
  const login = id => manager.connect({ ...CONFIG, email: `${id}@example.invalid`, password: 'fixture-only' });
  function bind() {
    state.meta = { workspaceId: state.local.workspaceId, binding: { projectUrl: CONFIG.url, userId: 'a', remoteId: state.local.workspaceId },
      enabled: true, remoteRevision: 0, syncedLocalRevision: -1, outbox: null, conflict: null, status: 'pending', error: null };
  }
  function auth(value) { state.session = copy(value); for (const adapter of state.adapters) if (!adapter.disposed) adapter.listener?.(copy(value)); }
  return { state, manager, storage, login, bind, auth, online: () => events.get('online')?.(), visible: () => visibility.get('visibilitychange')?.() };
}
async function append(bundle, text) {
  const prepared = await Core.prepareImport({ origin: 'obsidian', text, coverage: 'partial', authorRelation: 'self' }, bundle);
  return Core.applyChanges(bundle, Core.buildImportChanges(bundle, prepared, [{ start: 0, end: text.length, topic: '검증' }]));
}

test('offline saved-session start preserves settings and retries once across simultaneous lifecycle events', async t => {
  const f = fixture(t, { saved: true }); f.state.offline = true;
  await assert.rejects(f.manager.start(), code('network_error'));
  assert.deepEqual(copy(f.manager.getConfig()), CONFIG); assert.equal(f.manager.getAccount(), null);
  assert.equal(f.state.adapters[0].disposed, true);
  f.state.offline = false; f.state.accountGate = deferred();
  f.online(); f.visible(); f.state.periodic();
  assert.equal(f.state.adapters.length, 2); assert.equal(f.state.calls, 2);
  f.state.accountGate.resolve();
  await until(() => f.manager.getAccount()?.userId === 'a');
  assert.equal(f.state.writes, 0); // Authentication never binds unconnected local data.
});

test('authentication rejection does not schedule network reconnect or discard public prefill', async t => {
  const f = fixture(t, { saved: true }); f.state.authError = 'auth_required';
  await assert.rejects(f.manager.start(), code('auth_required'));
  f.online(); f.visible(); f.state.periodic(); await tick();
  assert.equal(f.state.adapters.length, 1); assert.deepEqual(copy(f.manager.getConfig()), CONFIG);
  assert.equal(f.manager.getAccount(), null);
});

test('explicit logout cancels offline reconnect; SDK logout failure cannot reenable startup config', async t => {
  const f = fixture(t, { saved: true }); f.state.offline = true;
  await assert.rejects(f.manager.start(), code('network_error'));
  await f.manager.signOut(); f.state.offline = false; f.online(); await tick();
  assert.equal(f.state.saved, null); assert.equal(f.manager.getConfig(), null); assert.equal(f.state.adapters.length, 1);
  await f.login('a'); f.state.logoutError = 'network_error';
  await assert.rejects(f.manager.signOut(), code('network_error'));
  assert.equal(f.state.saved, null); assert.equal(f.manager.getAccount(), null);
  assert.equal(f.state.session.userId, 'a'); // SDK failure may leave a session; manager must never auto resume it.
  await f.manager.start(); f.online(); await tick(); assert.equal(f.state.adapters.length, 2);
});

test('new same-project login disposes an in-flight old logout before it can remove the new session', async t => {
  const f = fixture(t); await f.login('a'); f.state.logoutGate = deferred();
  const logout = f.manager.signOut(); const rejected = assert.rejects(logout, code('stale_session'));
  await until(() => f.state.logoutStarted);
  await f.login('b'); assert.equal(f.state.adapters[0].disposed, true);
  f.state.logoutGate.resolve(); await rejected;
  assert.equal(f.state.session.userId, 'b'); assert.equal(f.manager.getAccount().userId, 'b');
  assert.deepEqual(f.state.saved, CONFIG);
});

test('a superseded pending login is disposed before its late SDK response can save an old session', async t => {
  const f = fixture(t); f.state.loginGate = deferred(); const gate = f.state.loginGate;
  const oldLogin = f.login('a'); const rejected = assert.rejects(oldLogin, code('stale_session'));
  await f.login('b'); assert.equal(f.state.adapters[0].disposed, true);
  gate.resolve(); await rejected;
  assert.equal(f.state.session.userId, 'b'); assert.equal(f.manager.getAccount().userId, 'b');
  assert.deepEqual(f.state.saved, CONFIG);
});

test('logout disposes a pending login before it can save or broadcast a signed-in session', async t => {
  const f = fixture(t); f.state.loginGate = deferred(); const gate = f.state.loginGate;
  const login = f.login('b'); const rejected = assert.rejects(login, code('stale_session'));
  await f.manager.signOut(); assert.equal(f.state.adapters[0].disposed, true);
  gate.resolve(); await rejected;
  assert.equal(f.state.session.userId, 'a');
  assert.equal(f.manager.getAccount(), null); assert.equal(f.state.saved, null);
});

test('Storage size failure is normalized without exposing server detail or replacing pending content', async t => {
  const f = fixture(t); await f.login('a'); f.bind(); f.state.prepareError = 'snapshot_too_large';
  const original = copy(f.state.local);
  await assert.rejects(f.manager.syncNow(original.workspaceId), value => {
    assert.equal(value.code, 'payload_too_large'); assert.match(value.message, /크기 제한/);
    assert.doesNotMatch(value.message, /private server/); return true;
  });
  assert.deepEqual(f.state.local, original); assert.equal(f.state.writes, 0);
  assert.equal(f.state.errors.at(-1).code, 'payload_too_large');
});

async function acknowledgedFixture(t, options = {}) {
  const f = fixture(t, options); await f.login('a'); f.bind();
  f.state.meta.remoteRevision = 1; f.state.meta.syncedLocalRevision = f.state.local.revision;
  f.state.meta.status = 'synced';
  f.state.row = { id: f.state.local.workspaceId, title: f.state.local.title, revision: 1,
    data: copy(f.state.local), updated_at: '2026-10-03T00:00:00Z' };
  return f;
}

test('explicit download validates equal-revision snapshots through storage and preserves local data on integrity failure', async t => {
  const f = await acknowledgedFixture(t), before = copy(f.state.local);
  f.state.row.title = f.state.row.data.title = '같은 서버 버전에서 달라진 제목';
  f.state.applyError = 'remote_revision_mismatch';
  await assert.rejects(f.manager.download(before.workspaceId), code('remote_revision_mismatch'));
  assert.equal(f.state.applied.length, 1); assert.deepEqual(f.state.applied[0], f.state.row);
  assert.deepEqual(f.state.local, before); assert.equal(f.state.writes, 0);
  f.state.applyError = null; f.state.row.title = f.state.row.data.title = before.title;
  assert.deepEqual(copy(await f.manager.download(before.workspaceId)), before);
  assert.equal(f.state.applied.length, 2); assert.equal(f.state.writes, 0);
});

// Rule change (2026-11-11, originals merge): a local save that lands while an unchanged server
// snapshot is being checked is not a conflict. The server did not move, so there is nothing to
// compare: the run goes on and sends the save. (Before: recorded as a conflict for the person.)
test('automatic sync checks equal-revision snapshots before clearing errors; a concurrent local edit on an unchanged server is sent, not a conflict', async t => {
  const f = await acknowledgedFixture(t), before = copy(f.state.local);
  f.state.applyError = 'remote_revision_mismatch';
  await assert.rejects(f.manager.syncNow(before.workspaceId), value => {
    assert.equal(value.code, 'remote_revision_mismatch'); assert.match(value.message, /같은 서버 버전/);
    assert.doesNotMatch(value.message, /private server/); return true;
  });
  assert.equal(f.state.applied.length, 1); assert.equal(f.state.errors.at(-1).code, 'remote_revision_mismatch');
  assert.deepEqual(f.state.local, before); assert.equal(f.state.writes, 0);
  f.state.applyError = null;
  assert.equal((await f.manager.syncNow(before.workspaceId)).error, null);
  assert.equal(f.state.applied.length, 2); assert.equal(f.state.errors.at(-1), null);
  // The save lands between the engine's read and the storage's atomic check: it is sent to the
  // server by the same run (the request, its content and the stored row are checked).
  const g = await acknowledgedFixture(t, { merge: true, successfulWrites: true, cas: true }), start = copy(g.state.local);
  g.state.applyConflict = true;
  const apply = g.storage.applySyncRemote;
  let saved = null;
  g.storage.applySyncRemote = async (...args) => {
    const result = await apply(...args);
    if (g.state.applyConflict) { g.state.applyConflict = false; g.state.local = saved = await append(g.state.local, '확인하는 사이에 저장한 원문'); }
    return result;
  };
  const result = await g.manager.syncNow(start.workspaceId);
  assert.equal(result.conflict, null); assert.equal(g.state.meta.conflict, null); assert.equal(g.state.merges, undefined, 'nothing to merge: the server did not move');
  assert.deepEqual(g.state.sent.map(request => [request.expectedRevision, request.data.revision]), [[1, saved.revision]]);
  assert.deepEqual(g.state.row.data, saved); assert.equal(g.state.row.revision, 2); assert.equal(g.state.meta.status, 'synced');
});

// ---- Originals merge: both sides changed -----------------------------------------------------
async function divergedFixture(t, options = {}) {
  const f = fixture(t, { merge: true, cas: true, successfulWrites: true, ...options }); await f.login('a');
  const base = await append(f.state.local, '공통 원문'); f.state.base = SyncCommon.mergeBase(base);
  f.state.local = await append(base, '폰에서 가져온 원문'); f.bind();
  f.state.meta.remoteRevision = 1; f.state.meta.syncedLocalRevision = base.revision;
  const server = await append(base, '맥에서 가져온 원문');
  f.state.row = { id: base.workspaceId, title: server.title, revision: 2, data: server, updated_at: '2026-11-11T00:00:00Z' };
  return { f, base, server, id: base.workspaceId };
}
const texts = bundle => bundle.sourceVersions.map(version => version.contentText).sort();
const ALL = ['공통 원문', '맥에서 가져온 원문', '폰에서 가져온 원문'];

test('both sides changed: the run merges them and sends the result; nothing is recorded for the person', async t => {
  const { f, id } = await divergedFixture(t);
  const result = await f.manager.syncNow(id);
  assert.equal(result.conflict, null); assert.equal(result.error, null); assert.equal(f.state.meta.status, 'synced');
  assert.equal(f.state.merges.length, 1); assert.equal(f.state.merges[0].revision, 2);
  assert.deepEqual(f.state.sent.map(request => request.expectedRevision), [2], 'one upload against the merged-with revision');
  assert.deepEqual(texts(f.state.row.data), ALL); assert.equal(f.state.row.revision, 3);
  assert.deepEqual(texts(f.state.local), ALL); assert.deepEqual(f.state.copies, [], 'no copy workspace: nothing was chosen');
});

test('a refused upload reads the row, merges and sends again; a server that keeps moving ends the run without a conflict', async t => {
  const { f, base, id } = await divergedFixture(t);
  // This device believes the server is where it last agreed; another device stores first.
  const moved = copy(f.state.row); f.state.row = { ...moved, revision: 1, data: copy(base), title: base.title };
  let moves = 1;
  f.state.beforeWrite = () => { if (moves-- > 0) f.state.row = copy(moved); };
  const result = await f.manager.syncNow(id);
  assert.equal(result.conflict, null); assert.equal(f.state.meta.status, 'synced');
  assert.deepEqual(f.state.sent.map(request => request.expectedRevision), [1, 2], 'refused, merged, sent again');
  assert.equal(f.state.merges.length, 1); assert.deepEqual(texts(f.state.row.data), ALL);
  // Every upload is refused (another device stores each time): bounded passes, then the next wake-up.
  const busy = await divergedFixture(t, { automatic: false });
  busy.f.state.beforeWrite = () => { busy.f.state.row = { ...busy.f.state.row, revision: busy.f.state.row.revision + 1 }; };
  const pending = await busy.f.manager.syncNow(busy.id);
  assert.equal(pending.conflict, null); assert.equal(pending.error, null); assert.notEqual(busy.f.state.meta.status, 'conflict');
  assert.ok(busy.f.state.writes >= 2 && busy.f.state.writes <= 8, 'bounded: ' + busy.f.state.writes);
  assert.deepEqual(texts(busy.f.state.local), ALL, 'the merged snapshot stays on the device for the next run');
});

test('what cannot be merged is recorded for the manual comparison and tried again by the next run; damage is an error', async t => {
  for (const reason of ['merge_invalid', 'snapshot_too_large', 'merge_unavailable']) {
    const { f, id } = await divergedFixture(t); f.state.mergeError = reason;
    const before = copy(f.state.local);
    const result = await f.manager.syncNow(id);
    assert.equal(result.status, 'conflict', reason); assert.deepEqual(f.state.meta.conflict.row, f.state.row);
    assert.deepEqual(f.state.local, before); assert.equal(f.state.writes, 0);
    // Later runs try again; the same recorded difference is not announced again (an open comparison is not redrawn).
    const events = []; f.manager.subscribe(event => events.push(event.type));
    assert.equal((await f.manager.syncNow(id)).status, 'conflict'); assert.equal(f.state.merges.length, 2);
    assert.deepEqual(events, [], reason);
    f.state.mergeError = null;
    assert.equal((await f.manager.syncNow(id)).conflict, null, 'a recorded difference is merged once it can be');
    assert.deepEqual(texts(f.state.row.data), ALL);
  }
  const { f, id } = await divergedFixture(t); f.state.mergeError = 'immutable_source_version';
  await assert.rejects(f.manager.syncNow(id), code('immutable_source_version'));
  assert.equal(f.state.meta.conflict, null); assert.equal(f.state.errors.at(-1).code, 'immutable_source_version'); assert.equal(f.state.writes, 0);
});

// m2 (2026-11-11 review): what could not be merged is megabytes when the reason is the size limit.
// Until the server or this device changes, a run asks for the server's revision only.
test('a difference that could not be merged is not downloaded again until the server or this device changes', async t => {
  const { f, id } = await divergedFixture(t, { head: true }); f.state.mergeError = 'snapshot_too_large';
  assert.equal((await f.manager.getState(id)).unmergeable, undefined);
  assert.equal((await f.manager.syncNow(id)).status, 'conflict');
  // The state says that this page tried and could not: the account band shows the comparison without waiting for a pass.
  assert.equal((await f.manager.getState(id)).unmergeable, true);
  const reads = f.state.readCalls, heads = f.state.headCalls;
  for (let run = 0; run < 5; run++) assert.equal((await f.manager.syncNow(id, { headIfClean: run % 2 === 0 })).status, 'conflict');
  assert.deepEqual([f.state.readCalls - reads, f.state.headCalls - heads, f.state.merges.length, f.state.writes], [0, 5, 1, 0]);
  // This device changed: one more attempt with the full row.
  f.state.local = await append(f.state.local, '합치지 못한 뒤에 가져온 원문');
  assert.equal((await f.manager.syncNow(id)).status, 'conflict'); assert.equal(f.state.merges.length, 2);
  await f.manager.syncNow(id); assert.equal(f.state.merges.length, 2, 'and then head only again');
  // The server changed: one more attempt, which now succeeds.
  f.state.row = { ...f.state.row, revision: f.state.row.revision + 1 }; f.state.mergeError = null;
  assert.equal((await f.manager.syncNow(id)).conflict, null); assert.equal(f.state.merges.length, 3); assert.equal((await f.manager.getState(id)).unmergeable, undefined);
  // A deleted server copy is seen by the head check.
  const gone = await divergedFixture(t, { head: true }); gone.f.state.mergeError = 'merge_invalid';
  await gone.f.manager.syncNow(gone.id); gone.f.state.row = null;
  assert.equal((await gone.f.manager.syncNow(gone.id)).conflict.missing, true);
});

test('a page that opens a synced workspace keeps the merge base at once, before any run or change', async t => {
  const f = fixture(t, { shared: true, automatic: false, merge: true }); f.bind();
  f.state.meta.remoteRevision = 4; f.state.meta.syncedLocalRevision = 0; f.state.meta.status = 'synced';
  await f.manager.start();
  assert.equal(f.state.captures, 1); assert.equal(f.state.readCalls, 0); assert.equal(f.state.writes, 0);
});

test('a difference recorded by an older version is merged by the next run; a deleted server copy is never merged or recreated', async t => {
  const { f, id } = await divergedFixture(t);
  await f.storage.setSyncConflict(id, f.state.meta.binding, f.state.row); assert.equal(f.state.meta.status, 'conflict');
  const result = await f.manager.syncNow(id);
  assert.equal(result.conflict, null); assert.equal(f.state.meta.status, 'synced'); assert.deepEqual(texts(f.state.row.data), ALL);
  const gone = await divergedFixture(t); gone.f.state.row = null;
  const missing = await gone.f.manager.syncNow(gone.id);
  assert.equal(missing.conflict.missing, true); assert.equal(gone.f.state.merges, undefined); assert.equal(gone.f.state.writes, 0);
  assert.equal((await gone.f.manager.syncNow(gone.id)).conflict.missing, true);
});

test('a clean head check stores the merge base once per acknowledged revision', async t => {
  const f = fixture(t, { shared: true, automatic: false, head: true, merge: true }); await f.manager.start(); f.bind();
  f.state.meta.remoteRevision = 2; f.state.meta.syncedLocalRevision = 0; f.state.meta.status = 'synced';
  f.state.row = { id: f.state.local.workspaceId, revision: 2, data: copy(f.state.local) };
  for (let n = 0; n < 3; n++) await f.manager.syncNow(f.state.local.workspaceId, { headIfClean: true });
  assert.equal(f.state.captures, 1); assert.equal(f.state.headCalls, 3); assert.equal(f.state.readCalls, 0);
});

test('equal-revision downloads preserve dirty and pending local work; lower and missing server heads remain rejected', async t => {
  const f = await acknowledgedFixture(t), before = copy(f.state.local);
  f.state.local.revision++;
  await assert.rejects(f.manager.download(before.workspaceId), code('workspace_conflict'));
  f.state.local = copy(before); f.state.meta.outbox = { operationId: Core.id() };
  await assert.rejects(f.manager.download(before.workspaceId), code('workspace_conflict'));
  f.state.meta.outbox = null; f.state.meta.remoteRevision = 2;
  await assert.rejects(f.manager.download(before.workspaceId), code('remote_revision_regressed'));
  f.state.row = null;
  await assert.rejects(f.manager.download(before.workspaceId), code('remote_missing'));
  assert.deepEqual(f.state.local, before); assert.equal(f.state.applied.length, 0); assert.equal(f.state.writes, 0);
});

async function conflictFixture(t, options = {}) {
  const f = fixture(t, options); await f.login('a');
  const original = await append(f.state.local, '원문 🌱\r\n동일한 위치');
  const server = { ...copy(original), title: '서버 쪽' };
  f.state.local = await append(original, '로컬 추가 원문'); f.bind();
  f.state.meta.remoteRevision = 1; f.state.meta.syncedLocalRevision = original.revision;
  f.state.row = { id: original.workspaceId, title: server.title, revision: 2, data: server, updated_at: '2026-10-03T00:00:00Z' };
  await f.storage.setSyncConflict(original.workspaceId, f.state.meta.binding, f.state.row);
  return f;
}

test('fresh explicit conflict preview permits later local edits while preserving their remapped source/excerpt copy', async t => {
  const f = await conflictFixture(t);
  f.state.local = await append(f.state.local, '비교 전에 더한 원문'); const reviewed = copy(f.state.local);
  await assert.rejects(f.manager.resolve(reviewed.workspaceId, 'remote'), code('stale_conflict'));
  const result = await f.manager.resolve(reviewed.workspaceId, 'remote', { expectedLocalRevision: reviewed.revision, expectedRemoteRevision: 2 });
  assert.equal(result.bundle.title, '서버 쪽'); assert.equal(f.state.copies.length, 1);
  const saved = f.state.copies[0]; assert.equal(result.copyWorkspaceId, saved.workspaceId);
  assert.notEqual(saved.workspaceId, reviewed.workspaceId); assert.equal(saved.revision, 0);
  assert.deepEqual(saved.sourceVersions.map(x => x.contentText), reviewed.sourceVersions.map(x => x.contentText));
  assert.notEqual(saved.records[0].sourceRefs[0].sourceVersionId, reviewed.records[0].sourceRefs[0].sourceVersionId);
  Core.validateWorkspace(saved);
});

test('local edit after preview during async recovery preparation rejects the decision without installing a partial copy', async t => {
  const gate = deferred(); let restoring = false;
  const f = await conflictFixture(t, { core: { ...Core, async restoreBackup(backup) { restoring = true; await gate.promise; return Core.restoreBackup(backup); } } });
  const reviewed = copy(f.state.local);
  const resolution = f.manager.resolve(reviewed.workspaceId, 'remote', { expectedLocalRevision: reviewed.revision, expectedRemoteRevision: 2 });
  const rejected = assert.rejects(resolution, code('sync_conflict_changed'));
  await until(() => restoring); f.state.local = await append(f.state.local, '비교 이후의 변경'); gate.resolve(); await rejected;
  assert.equal(f.state.copies.length, 0); assert.equal(f.state.local.sourceVersions.length, reviewed.sourceVersions.length + 1);
  assert.equal(f.state.meta.status, 'conflict');
});

test('shared Auth startup and later login never upload unbound data; borrowed adapter disposal never logs out', async t => {
  const f = fixture(t, { shared: true }); f.state.session = null;
  assert.equal(await f.manager.start(), null);
  f.auth(account('a')); await tick();
  assert.equal(f.manager.getAccount().userId, 'a'); assert.equal(f.state.writes, 0); assert.equal(f.state.meta, null);
  f.manager.dispose(); assert.equal(f.state.session.userId, 'a'); assert.equal(f.state.logoutCalls, 0);
  assert.equal(f.state.adapters[0].disposed, true);
});

test('shared session startup resumes only its previously bound durable outbox with the same request', async t => {
  const f = fixture(t, { shared: true, owner: account('a'), successfulWrites: true }); f.bind();
  const outbox = { operationId: Core.id(), expectedRevision: 0, localRevision: f.state.local.revision, data: copy(f.state.local) };
  f.state.meta.outbox = copy(outbox); await f.manager.start();
  await until(() => f.state.meta.outbox === null);
  assert.equal(f.state.sent.length, 1);
  assert.deepEqual(f.state.sent[0], { workspaceId: f.state.local.workspaceId, expectedRevision: outbox.expectedRevision,
    operationId: outbox.operationId, data: outbox.data });
  assert.equal(f.state.meta.remoteRevision, 1); assert.equal(f.state.logoutCalls, 0);
});

test('fixed-owner scoped handle blocks local access immediately on shared account transition and cancels old remote response', async t => {
  const f = fixture(t, { shared: true, owner: account('a') }); await f.manager.start();
  f.state.row = { id: f.state.local.workspaceId, title: f.state.local.title, revision: 1, data: copy(f.state.local), updated_at: '2026-10-03T00:00:00Z' };
  f.state.readGate = deferred();
  const download = f.manager.download(f.state.local.workspaceId); const rejected = assert.rejects(download, code('stale_session'));
  await tick(); const accesses = f.state.localCalls.length;
  f.auth(account('b'));
  await assert.rejects(f.manager.getState(f.state.local.workspaceId), code('account_mismatch'));
  await assert.rejects(f.manager.syncNow(f.state.local.workspaceId), code('account_mismatch'));
  f.state.readGate.resolve(); await rejected; await tick();
  assert.equal(f.state.localCalls.length, accesses); assert.equal(f.state.writes, 0);
  assert.equal(f.manager.getAccount().userId, 'b');
});

test('pending local metadata read cannot reveal an old owner conflict snapshot after account transition', async t => {
  const f = fixture(t, { shared: true, owner: account('a') }); await f.manager.start(); f.bind();
  f.state.meta.conflict = { row: { data: copy(f.state.local) }, missing: false, localRevision: 0, remoteRevision: 1 };
  f.state.stateGate = deferred();
  const reading = f.manager.getState(f.state.local.workspaceId); const rejected = assert.rejects(reading, code('stale_session'));
  f.auth(account('b')); f.state.stateGate.resolve(); await rejected;
  f.auth(null); const accesses = f.state.localCalls.length;
  const loggedOut = await f.manager.getState(f.state.local.workspaceId);
  assert.equal(loggedOut.conflict, null); assert.equal(loggedOut.binding, null);
  assert.equal(f.state.localCalls.length, accesses);
});

test('receive-first automatic:false verifies the account without background reads and can restore legacy scheduling', async t => {
  const f = fixture(t, { shared: true, automatic: false }); f.bind();
  f.state.meta.remoteRevision = 1; f.state.meta.syncedLocalRevision = 0;
  f.state.row = { id: f.state.local.workspaceId, revision: 1, data: copy(f.state.local) };
  await f.manager.start(); await tick();
  assert.equal(f.state.periodic, undefined); assert.equal(f.state.readCalls, 0); assert.equal(f.state.writes, 0);
  await f.manager.syncNow(f.state.local.workspaceId); assert.equal(f.state.readCalls, 1);
  f.manager.setAutomatic(true); await until(() => f.state.readCalls > 1); assert.equal(typeof f.state.periodic, 'function');
  f.manager.setAutomatic(false);
});

test('background download captures activate:false before a delayed remote read and preserves legacy activate:true', async t => {
  const f = fixture(t, { shared: true, automatic: false }); await f.manager.start();
  f.state.row = { id: f.state.local.workspaceId, revision: 1, data: copy(f.state.local) };
  const installed = []; f.storage.installSyncRemote = async (row, binding, options) => { installed.push(copy(options)); return copy(row.data); };
  f.state.readGate = deferred(); const options = { activate: false }, pending = f.manager.download(f.state.local.workspaceId, options); options.activate = true;
  f.state.readGate.resolve(); await pending; assert.deepEqual(installed[0], { activate: false });
  f.state.readGate = null; await f.manager.download(f.state.local.workspaceId); assert.deepEqual(installed[1], { activate: true });
});

test('adoption rechecks the real remote revision before authorizing pristine migration and does not write', async t => {
  const f = fixture(t, { shared: true, automatic: false }); await f.manager.start();
  f.state.row = { id: f.state.local.workspaceId, revision: 3, data: copy(f.state.local) };
  const observed = []; f.storage.adoptSyncRemote = async (_, binding, row, options) => {
    observed.push(copy(options)); f.bind(); f.state.meta.remoteRevision = row.revision; f.state.meta.syncedLocalRevision = 0;
  };
  await f.manager.adoptExisting(f.state.local.workspaceId, { pristine: true, pristineRevision: 2 }); assert.deepEqual(observed[0], { pristine: false });
  f.state.meta = null; await f.manager.adoptExisting(f.state.local.workspaceId, { pristine: true, pristineRevision: 3 }); assert.deepEqual(observed[1], { pristine: true });
  assert.equal(f.state.writes, 0);
  f.state.meta.enabled = false; f.state.meta.outbox = { operationId: Core.id(), expectedRevision: 3, localRevision: 1, data: copy(f.state.local) };
  const outbox = copy(f.state.meta.outbox); f.storage.bindSync = async () => { f.state.meta.enabled = true; };
  const reads = f.state.readCalls; await f.manager.adoptExisting(f.state.local.workspaceId);
  assert.deepEqual(f.state.meta.outbox, outbox); assert.equal(f.state.readCalls, reads);
});

test('optional clean head check avoids source bodies, while explicit and dirty synchronization retain full validation', async t => {
  const f = fixture(t, { shared: true, automatic: false, head: true }); await f.manager.start(); f.bind();
  f.state.meta.remoteRevision = 2; f.state.meta.syncedLocalRevision = 0; f.state.meta.status = 'synced';
  f.state.row = { id: f.state.local.workspaceId, revision: 2, data: copy(f.state.local) };
  await f.manager.syncNow(f.state.local.workspaceId, { headIfClean: true }); assert.equal(f.state.headCalls, 1); assert.equal(f.state.readCalls, 0);
  await f.manager.syncNow(f.state.local.workspaceId); assert.equal(f.state.readCalls, 1);
  f.state.local.revision++; await f.manager.syncNow(f.state.local.workspaceId, { headIfClean: true });
  assert.equal(f.state.headCalls, 1); assert.ok(f.state.readCalls > 1);
});

test('clean metadata head missing/regression is not success and absent head support uses the legacy full read', async t => {
  for (const missing of [true, false]) {
    const f = fixture(t, { shared: true, automatic: false, head: true }); await f.manager.start(); f.bind();
    f.state.meta.remoteRevision = 2; f.state.meta.syncedLocalRevision = 0; f.state.meta.status = 'synced';
    f.state.row = missing ? null : { id: f.state.local.workspaceId, revision: 1, data: copy(f.state.local) };
    if (missing) { const result = await f.manager.syncNow(f.state.local.workspaceId, { headIfClean: true }); assert.equal(result.conflict.missing, true); }
    else await assert.rejects(f.manager.syncNow(f.state.local.workspaceId, { headIfClean: true }), code('remote_revision_regressed'));
    assert.equal(f.state.readCalls, 0);
  }
  const legacy = fixture(t, { shared: true, automatic: false }); await legacy.manager.start(); legacy.bind();
  legacy.state.meta.remoteRevision = 1; legacy.state.meta.syncedLocalRevision = 0;
  legacy.state.row = { id: legacy.state.local.workspaceId, revision: 1, data: copy(legacy.state.local) };
  await legacy.manager.syncNow(legacy.state.local.workspaceId, { headIfClean: true }); assert.equal(legacy.state.readCalls, 1);
});

test('optional head optimization still replays the exact durable request before probing a clean head', async t => {
  const f = fixture(t, { shared: true, automatic: false, head: true, successfulWrites: true }); await f.manager.start(); f.bind();
  f.state.meta.remoteRevision = 1;
  f.state.meta.outbox = { operationId: Core.id(), expectedRevision: 1, localRevision: 0, data: copy(f.state.local) };
  const original = copy(f.state.meta.outbox);
  await f.manager.syncNow(f.state.local.workspaceId, { headIfClean: true });
  assert.equal(f.state.sent[0].operationId, original.operationId); assert.deepEqual(f.state.sent[0].data, original.data);
  assert.equal(f.state.headCalls, 1); assert.equal(f.state.readCalls, 0); assert.equal(f.state.meta.outbox, null);
});

test('W4 each sync operation uses one adapter cycle that ends with it, on success and on failure; conflict choice keeps per-call checks', async t => {
  const f = fixture(t, { shared: true, automatic: false, head: true, cycles: true, successfulWrites: true }); await f.manager.start(); f.bind();
  const id = f.state.local.workspaceId;
  f.state.meta.remoteRevision = 1; f.state.meta.outbox = { operationId: Core.id(), expectedRevision: 1, localRevision: 0, data: copy(f.state.local) };
  const start = f.state.calls;
  await f.manager.syncNow(id, { headIfClean: true });
  assert.equal(f.state.cycles.length, 1); assert.equal(f.state.cycles[0].ended, true);
  assert.deepEqual(f.state.cycles[0].calls, ['getAccount', 'getAccount', 'write', 'getAccount', 'head', 'getAccount']);
  assert.equal(f.state.calls - start, 4, 'the engine still asks for its account before and after each step');
  f.state.offline = true;
  await assert.rejects(f.manager.syncNow(id, { headIfClean: true }), code('network_error'));
  assert.equal(f.state.cycles.length, 2); assert.equal(f.state.cycles[1].ended, true);
  f.state.offline = false;
  await Promise.all([f.manager.syncNow(id, { headIfClean: true }), f.manager.syncNow(id, { headIfClean: true })]);
  assert.equal(f.state.cycles.length, 4); assert.ok(f.state.cycles.every(cycle => cycle.ended));
  const c = await conflictFixture(t, { cycles: true });
  const reviewed = copy(c.state.local);
  await c.manager.resolve(reviewed.workspaceId, 'remote', { expectedLocalRevision: reviewed.revision, expectedRemoteRevision: 2 });
  assert.deepEqual(c.state.cycles || [], [], 'explicit conflict resolution verifies every call on the server');
});

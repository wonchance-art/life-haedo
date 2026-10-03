'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../assets/life/core.js');
const source = fs.readFileSync(require.resolve('../assets/life/sync.js'), 'utf8');
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
    localCalls: [], sent: [], logoutCalls: 0 };
  const events = new Map(), visibility = new Map();
  const storage = {
    ...(options.owner ? { account: copy(options.owner) } : {}),
    async listWorkspaces() { state.localCalls.push('list'); return state.meta ? [{ workspaceId: state.local.workspaceId }] : []; },
    async getSyncState() { state.localCalls.push('state'); const result = copy(state.meta); if (state.stateGate) await state.stateGate.promise; return result; },
    async read() { state.localCalls.push('read'); return copy(state.local); },
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
      async read() { const row = copy(state.row); if (state.readGate) await state.readGate.promise; return row; },
      async write(request) {
        state.writes++; state.sent.push(copy(request));
        if (!options.successfulWrites) throw error('unexpected_write');
        state.row = { id: request.workspaceId, title: request.data.title, revision: request.expectedRevision + 1,
          data: copy(request.data), updated_at: '2026-10-03T00:00:00Z' };
        return { status: 'stored', revision: state.row.revision };
      },
      dispose() { adapter.disposed = true; }
    };
    assert.equal(settings.url, CONFIG.url); state.adapters.push(adapter); return adapter;
  };
  factory.loadConfig = () => copy(options.shared ? CONFIG : state.saved);
  factory.saveConfig = value => { if (!options.shared) state.saved = copy(value); };
  const context = { module: { exports: {} }, URL, setTimeout, clearTimeout,
    setInterval: callback => { state.periodic = callback; return { unref() {} }; }, clearInterval() {},
    addEventListener: (type, callback) => events.set(type, callback), removeEventListener: type => events.delete(type),
    document: { visibilityState: 'visible', addEventListener: (type, callback) => visibility.set(type, callback), removeEventListener: type => visibility.delete(type) } };
  vm.runInNewContext(source, context);
  const core = options.core || Core;
  const manager = context.module.exports.create({ storage, core, remoteFactory: factory });
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

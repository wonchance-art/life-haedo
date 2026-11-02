/* W4 (2026-11-02): one server account check per sync cycle instead of one per
 * remote call. Real platform-auth, platform-life-remote, life remote and sync
 * engine; synthetic SDK/HTTP only. Counts actual getUser calls per cycle and
 * checks that account switch, token refresh and held responses stay guarded.
 * Not evidence of hosted Auth, RLS or a real device. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../assets/life/core.js');
const Remote = require('../assets/life/remote.js');
const PlatformRemote = require('../assets/platform-life-remote.js');
const Sync = require('../assets/life/sync.js');
const { createAuth, SESSION_KEY } = require('../assets/platform-auth.js');
const config = { url: 'https://fixture.supabase.co', key: 'sb_publishable_fixture' };
const A = { id: '11111111-1111-4111-8111-111111111111', email: 'a@example.invalid' };
const B = { id: '22222222-2222-4222-8222-222222222222', email: 'b@example.invalid' };
const copy = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function platform() {
  const records = new Map([[SESSION_KEY, JSON.stringify({ user: A, access_token: 'synthetic-a' })]]);
  const state = { records, user: A, calls: [], heads: [], puts: [], remoteRevision: 1, holdHead: null };
  const sdkListeners = new Set();
  const env = {
    location: { hostname: 'localhost', pathname: '/index.html', search: '', href: 'http://localhost/index.html', replace() {} },
    document: { querySelectorAll: () => [], body: { dataset: { lifeHome: 'true' } }, documentElement: { classList: { add() {}, remove() {} } }, dispatchEvent() { return true; } },
    history: { replaceState() {} }, Event, addEventListener() {}, removeEventListener() {},
    localStorage: { getItem: key => records.get(key) || null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) }
  };
  function builder(run) {
    const value = {
      select() { return value; }, eq() { return value; }, order() { return value; }, maybeSingle() { return value; },
      abortSignal(signal) {
        return new Promise((resolve, reject) => {
          const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          if (signal.aborted) return abort();
          signal.addEventListener('abort', abort, { once: true });
          Promise.resolve().then(run).then(resolve, reject);
        });
      },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); }
    };
    return value;
  }
  const clientFactory = (_url, _key, options) => ({
    auth: {
      onAuthStateChange(listener) { sdkListeners.add(listener); return { data: { subscription: { unsubscribe: () => sdkListeners.delete(listener) } } }; },
      async getSession() { const value = options.auth.storage.getItem(SESSION_KEY); return { data: { session: value ? JSON.parse(value) : null }, error: null }; },
      async getUser() { state.calls.push('getUser'); return { data: { user: state.user }, error: null }; },
      async signOut() { records.delete(SESSION_KEY); state.user = null; for (const l of [...sdkListeners]) l('SIGNED_OUT', null); return { error: null }; },
      dispose() {}
    },
    from(table) {
      assert.equal(table, 'life_workspaces');
      return builder(async () => {
        state.heads.push(state.user?.id || null);
        if (state.holdHead) { const hold = state.holdHead; state.holdHead = null; hold.entered.resolve(); await hold.release.promise; }
        return { data: { id: state.workspaceId, title: '자료', revision: state.remoteRevision, updated_at: '2026-11-02T00:00:00Z' }, error: null };
      });
    },
    rpc(name, args) {
      assert.equal(name, 'life_sync_put');
      return builder(async () => { state.puts.push(args.p_expected_revision); state.remoteRevision = args.p_expected_revision + 1; return { data: { status: 'stored', revision: state.remoteRevision }, error: null }; });
    }
  });
  const auth = createAuth(env, { config, clientFactory });
  function emit(name, user, token) {
    if (user) records.set(SESSION_KEY, JSON.stringify({ user, access_token: token })); else records.delete(SESSION_KEY);
    state.user = user;
    for (const listener of [...sdkListeners]) listener(name, user ? { user, access_token: token } : null);
  }
  return { auth, state, emit, users: () => state.calls.filter(name => name === 'getUser').length };
}

async function engine(t, p, { outbox = false } = {}) {
  const local = Core.createWorkspace({ title: '자료' }), id = local.workspaceId; p.state.workspaceId = id;
  const meta = { workspaceId: id, binding: { projectUrl: config.url, userId: A.id, remoteId: id }, enabled: true, remoteRevision: 1,
    syncedLocalRevision: local.revision, outbox: null, conflict: null, status: 'synced', error: null };
  if (outbox) meta.outbox = { operationId: '33333333-3333-4333-8333-333333333333', expectedRevision: 1, localRevision: local.revision, data: copy(local) };
  const errors = [];
  const storage = {
    async listWorkspaces() { return [{ workspaceId: id }]; },
    async getSyncState() { return copy(meta); },
    async read() { return copy(local); },
    subscribe() { return () => {}; },
    async prepareSyncUpload() { return null; },
    async ackSync(_id, _binding, operationId, revision) { assert.equal(operationId, meta.outbox.operationId); meta.syncedLocalRevision = meta.outbox.localRevision; meta.remoteRevision = revision; meta.outbox = null; },
    async setSyncError(_id, _binding, value) { errors.push(value); meta.error = value; },
    async setSyncConflict() { throw new Error('unexpected conflict'); },
    async applySyncRemote() { throw new Error('unexpected body apply'); }
  };
  const remoteFactory = settings => PlatformRemote.create(settings, { platformAuth: p.auth, remote: Remote, core: Core });
  remoteFactory.loadConfig = () => copy(config); remoteFactory.saveConfig = () => {};
  const manager = Sync.create({ storage, core: Core, remoteFactory, automatic: false });
  t.after(() => { manager.dispose(); p.auth.dispose(); });
  assert.equal((await p.auth.verify()).id, A.id); // the shell's own boot check
  assert.equal((await manager.start()).userId, A.id);
  return { manager, id, meta, errors };
}

test('W4 a clean sync cycle checks the account server once instead of before and after every call', async t => {
  const p = platform(), e = await engine(t, p);
  for (let cycle = 1; cycle <= 3; cycle++) {
    const before = p.users();
    assert.equal((await e.manager.syncNow(e.id, { headIfClean: true })).status, 'synced');
    // Before W4: verified + head's own check + verified again = 3.
    assert.equal(p.users() - before, 1, 'cycle ' + cycle);
  }
  assert.equal(p.state.heads.length, 3); assert.deepEqual(e.errors, []);
});

test('W4 the snapshot overwrite keeps its own server check inside the cycle', async t => {
  const p = platform(), e = await engine(t, p, { outbox: true });
  const before = p.users();
  assert.equal((await e.manager.syncNow(e.id, { headIfClean: true })).status, 'synced');
  assert.deepEqual(p.state.puts, [1]);
  // Cycle start + a fresh check right before life_sync_put; the reads after it reuse that newer check.
  assert.equal(p.users() - before, 2);
  assert.equal(e.meta.remoteRevision, 2); assert.deepEqual(e.errors, []);
});

test('W4 a token refresh during a cycle discards the earlier check before the next call', async t => {
  const p = platform(), e = await engine(t, p);
  const hold = { entered: deferred(), release: deferred() }; p.state.holdHead = hold;
  const before = p.users(), cycle = e.manager.syncNow(e.id, { headIfClean: true });
  await hold.entered.promise;
  p.emit('TOKEN_REFRESHED', A, 'synthetic-a-refreshed');
  hold.release.resolve();
  assert.equal((await cycle).status, 'synced');
  // The check after the held head cannot reuse the pre-refresh result.
  assert.equal(p.users() - before, 2);
});

test('W4 an account switch during a cycle cancels it; the old check is never applied to the new account', async t => {
  const p = platform(), e = await engine(t, p);
  const hold = { entered: deferred(), release: deferred() }; p.state.holdHead = hold;
  const before = p.users(), cycle = e.manager.syncNow(e.id, { headIfClean: true });
  await hold.entered.promise;
  p.emit('SIGNED_IN', B, 'synthetic-b');
  hold.release.resolve();
  const outcome = await cycle.then(value => value, error => error);
  // The held response belongs to A's cycle; it neither completes A's sync nor
  // continues under B. Only A's own first check was sent for this cycle.
  assert.notEqual(outcome?.status, 'synced');
  if (outcome instanceof Error) assert.ok(['request_cancelled', 'stale_session', 'account_mismatch'].includes(outcome.code), outcome.code);
  assert.deepEqual(p.state.puts, []);
  assert.deepEqual(p.state.heads, [A.id]);
  assert.equal(p.users() - before, 1);
  await tick();
  // A later check verifies B on the server; nothing of A's cycle is reused.
  const scope = p.auth.verificationScope(), next = p.users();
  assert.equal((await scope.verify()).id, B.id); assert.equal(p.users() - next, 1); scope.end();
});

test('W4 a sign-out during a cycle stops it without another server check or write', async t => {
  const p = platform(), e = await engine(t, p);
  const hold = { entered: deferred(), release: deferred() }; p.state.holdHead = hold;
  const before = p.users(), cycle = e.manager.syncNow(e.id, { headIfClean: true });
  await hold.entered.promise;
  p.emit('SIGNED_OUT', null);
  hold.release.resolve();
  const outcome = await cycle.then(value => value, error => error);
  assert.notEqual(outcome?.status, 'synced');
  assert.deepEqual(p.state.puts, []); assert.equal(p.users() - before, 1);
  assert.equal(p.auth.user, null);
});

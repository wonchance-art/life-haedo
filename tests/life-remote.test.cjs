const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const Core = require('../assets/life/core.js');
const Remote = require('../assets/life/remote.js');
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OP = '33333333-3333-4333-8333-333333333333';
const CONNECTION = { url: 'https://life-sync-test.supabase.co', key: 'sb_publishable_fixture_only' };
const code = expected => error => { assert.equal(error.code, expected); return true; };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function officialSDK() {
  const context = { fetch, Headers, Request, Response, URL, crypto, TextEncoder, TextDecoder, WebSocket,
    AbortController, DOMException, atob, btoa, setTimeout, clearTimeout, setInterval, clearInterval,
    console: { log() {}, warn() {}, error() {}, debug() {} } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../vendor/supabase/supabase.js'), 'utf8'), context);
  return context.supabase;
}
async function bundle() {
  const before = Core.createWorkspace();
  const prepared = await Core.prepareImport({ origin: 'obsidian', title: '자료', text: '원문 🌱\r\n다시 읽기', coverage: 'partial' }, before);
  return Core.applyChanges(before, Core.buildImportChanges(before, prepared, [{ start: 0, end: 2 }]));
}
function fixture(overrides = {}) {
  const state = { user: { id: USER, email: 'fixture@example.invalid' }, rows: [], row: null,
    rpcResult: { data: { status: 'stored', revision: 1 }, error: null }, calls: [], stopped: 0, unsubscribed: 0, ...overrides };
  const factory = (url, key, options) => {
    state.options = options; state.url = url; state.key = key;
    return {
      auth: {
        onAuthStateChange(listener) { state.emit = listener; return { data: { subscription: { unsubscribe() { state.unsubscribed++; } } } }; },
        async getUser() { state.calls.push('getUser'); return state.accountPromise ? state.accountPromise : { data: { user: state.user }, error: state.authError || null }; },
        async signInWithPassword() {
          if (state.signInError) return { error: state.signInError };
          state.emit('SIGNED_IN', { user: state.user }); return { data: { user: state.user }, error: null };
        },
        async signOut(options) { state.signOutOptions = options; state.user = null; state.emit('SIGNED_OUT', null); return { error: null }; },
        stopAutoRefresh() { state.stopped++; }
      },
      from(table) {
        state.table = table;
        return { select(columns) {
          state.columns = columns;
          return { async order(column, options) { state.order = { column, options }; return { data: state.rows, error: state.queryError || null }; },
            eq(column, id) { state.eq = { column, id }; return { async maybeSingle() {
              return state.readPromise || { data: state.row, error: state.queryError || null };
            } }; }
          };
        } };
      },
      async rpc(name, params) { state.rpc = { name, params }; state.calls.push('rpc'); return state.rpcResult; }
    };
  };
  const adapter = Remote.create(CONNECTION, { core: Core, clientFactory: factory });
  return { adapter, state };
}
function row(data, revision = 1) { return { id: data.workspaceId, title: '서버 자료', revision, updated_at: '2026-10-03T12:00:00Z', data }; }

test('rejects private keys and unsafe project URLs before constructing SDK', () => {
  const jwt = role => 'fixture.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.fixture';
  for (const url of ['http://example.org', 'https://user:pass@example.org', 'https://example.org/path', 'https://example.org?x=1', 'https://example.org#x']) {
    assert.throws(() => Remote.create({ ...CONNECTION, url }), code('invalid_config'));
  }
  for (const key of ['sb_secret_private', jwt('service_role'), jwt('authenticated')]) assert.throws(() => Remote.create({ ...CONNECTION, key }), code('secret_key_rejected'));
  assert.throws(() => Remote.create({ ...CONNECTION, key: 'unknown' }), code('invalid_config'));
  let seen;
  const { adapter } = fixture(); adapter.dispose();
  const anon = Remote.create({ ...CONNECTION, key: jwt('anon') }, { core: Core, clientFactory: (_u, _k, opts) => {
    seen = opts; return { auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, stopAutoRefresh() {} } };
  } });
  assert.equal(seen.auth.autoRefreshToken, true); assert.equal(seen.auth.detectSessionInUrl, false); anon.dispose();
});

test('new connection storage is isolated from legacy chart settings', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const records = new Map([['caeyeon_life_cloud', 'legacy-sentinel']]);
  const accessed = [];
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key) { accessed.push(key); return records.get(key) || null; }, setItem(key, value) { accessed.push(key); records.set(key, value); }, removeItem(key) { accessed.push(key); records.delete(key); }
  } });
  try {
    assert.equal(Remote.loadConfig(), null); assert.deepEqual(Remote.saveConfig(CONNECTION), CONNECTION);
    assert.deepEqual(Remote.loadConfig(), CONNECTION); Remote.saveConfig(null);
    assert.equal(records.get('caeyeon_life_cloud'), 'legacy-sentinel');
    assert.ok(accessed.every(key => key === Remote.CONFIG_KEY));
    const { adapter, state } = fixture();
    assert.equal(state.options.auth.storageKey, Remote.SESSION_PREFIX + encodeURIComponent(CONNECTION.url)); adapter.dispose();
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
});

test('auth verifies account, defers auth listeners, and signs out only this browser session', async () => {
  const { adapter, state } = fixture();
  assert.deepEqual(await adapter.getAccount(), { userId: USER, email: 'fixture@example.invalid', projectUrl: CONNECTION.url });
  const events = []; const unsubscribe = adapter.onAuthChange(value => events.push(value));
  await adapter.signIn('fixture@example.invalid', 'synthetic-password'); assert.equal(events.length, 0);
  await tick(); assert.equal(events[0].userId, USER);
  await adapter.signOut(); await tick(); assert.equal(events[1], null);
  assert.deepEqual(state.signOutOptions, { scope: 'local' }); assert.equal(await adapter.getAccount(), null);
  unsubscribe(); adapter.dispose(); assert.equal(state.unsubscribed, 1); assert.equal(state.stopped, 1);
});

test('missing session is unauthenticated, and raw server errors are not exposed', async () => {
  const { adapter, state } = fixture({ authError: { name: 'AuthSessionMissingError', message: 'private text' } });
  assert.equal(await adapter.getAccount(), null);
  state.authError = null; state.signInError = { code: 'invalid_credentials', message: 'raw secret password or token' };
  await assert.rejects(adapter.signIn('fixture@example.invalid', 'password'), error => { assert.equal(error.code, 'auth_invalid_credentials'); assert.ok(!error.message.includes('raw secret')); return true; });
  state.authError = { status: 401, message: 'raw token' };
  await assert.rejects(adapter.getAccount(), code('auth_required'));
  state.authError = { status: 404, code: 'user_not_found', message: 'raw identity' };
  await assert.rejects(adapter.getAccount(), code('auth_required')); adapter.dispose();
});

test('list queries metadata only, strips unrequested fields, and reports missing schema', async () => {
  const data = await bundle(), record = row(data);
  const { adapter, state } = fixture({ rows: [record] });
  assert.deepEqual(await adapter.list(), [{ id: record.id, title: record.title, revision: 1, updated_at: record.updated_at }]);
  assert.equal(state.table, 'life_workspaces'); assert.equal(state.columns, 'id,title,revision,updated_at');
  state.queryError = { code: 'PGRST205', message: 'raw query details' };
  await assert.rejects(adapter.list(), code('schema_missing')); adapter.dispose();
});

test('read returns an owned snapshot after validating exact source hashes and identities', async () => {
  const data = await bundle(); const { adapter, state } = fixture({ row: row(data) });
  const received = await adapter.read(data.workspaceId);
  assert.deepEqual(received.data, data); received.data.sourceVersions[0].contentText = 'changed';
  assert.equal(state.row.data.sourceVersions[0].contentText, '원문 🌱\r\n다시 읽기');
  state.row = null; assert.equal(await adapter.read(data.workspaceId), null);
  state.row = row(structuredClone(data)); state.row.data.sourceVersions[0].contentText += ' 변조';
  await assert.rejects(adapter.read(data.workspaceId), code('hash_mismatch'));
  state.row = row(data); state.row.id = OTHER;
  await assert.rejects(adapter.read(data.workspaceId), code('invalid_remote_data'));
  state.row = row(structuredClone(data)); state.row.data.sourceVersions[0].sourceId = OTHER;
  await assert.rejects(adapter.read(data.workspaceId), code('invalid_remote_data')); adapter.dispose();
});

test('write captures parameters and snapshot before awaiting account/network', async () => {
  const data = await bundle(), waiting = deferred();
  const { adapter, state } = fixture({ accountPromise: waiting.promise });
  const request = { workspaceId: data.workspaceId, expectedRevision: 0, operationId: OP, data };
  const pending = adapter.write(request);
  request.operationId = OTHER; request.expectedRevision = 44; data.sourceVersions[0].contentText = 'mutated caller text';
  waiting.resolve({ data: { user: state.user }, error: null });
  assert.deepEqual(await pending, { status: 'stored', revision: 1 });
  assert.equal(state.rpc.name, 'life_sync_put'); assert.equal(state.rpc.params.p_operation_id, OP);
  assert.equal(state.rpc.params.p_expected_revision, 0); assert.equal(state.rpc.params.p_data.sourceVersions[0].contentText, '원문 🌱\r\n다시 읽기');
  adapter.dispose();
});

test('write reports CAS outcomes and does not treat missing as successful creation', async () => {
  const data = await bundle(); const { adapter, state } = fixture();
  for (const result of [{ status: 'stored', revision: 2 }, { status: 'conflict', revision: 3 }, { status: 'missing' }]) {
    state.rpcResult = { data: result, error: null };
    assert.deepEqual(await adapter.write({ workspaceId: data.workspaceId, expectedRevision: 1, operationId: OP, data }), result);
  }
  state.rpcResult = { data: { status: 'stored', revision: '4' }, error: null };
  await assert.rejects(adapter.write({ workspaceId: data.workspaceId, expectedRevision: 1, operationId: OP, data }), code('invalid_remote_data'));
  adapter.dispose();
});

test('invalid hashes and oversized JSON block transport; remote oversized rows are rejected', async () => {
  const data = await bundle(); const { adapter, state } = fixture();
  data.sourceVersions[0].contentHash = '0'.repeat(64);
  await assert.rejects(adapter.write({ workspaceId: data.workspaceId, expectedRevision: 0, operationId: OP, data }), code('hash_mismatch'));
  assert.equal(state.rpc, undefined);
  const large = { workspaceId: data.workspaceId, padding: 'x'.repeat(Remote.MAX_BYTES) };
  await assert.rejects(adapter.write({ workspaceId: data.workspaceId, expectedRevision: 0, operationId: OP, data: large }), code('payload_too_large'));
  state.row = row(large);
  await assert.rejects(adapter.read(data.workspaceId), code('payload_too_large')); adapter.dispose();
});

test('fixed SQL error identifiers become safe adapter faults', async () => {
  const data = await bundle(); const { adapter, state } = fixture();
  for (const [error, expected] of [
    [{ code: '22001', message: 'life_snapshot_too_large' }, 'payload_too_large'],
    [{ code: '22023', message: 'life_operation_mismatch' }, 'operation_mismatch'],
    [{ code: '42501', message: 'life_auth_required' }, 'auth_required'],
    [{ code: '22023', message: 'life_invalid_snapshot' }, 'invalid_request'],
    [{ code: '42501', message: 'private authorization detail' }, 'permission_denied'],
    [{ code: 'unexpected', message: 'private token and source text' }, 'remote_error']
  ]) {
    state.rpcResult = { data: null, error };
    await assert.rejects(adapter.write({ workspaceId: data.workspaceId, expectedRevision: 0, operationId: OP, data }), caught => { assert.equal(caught.code, expected); assert.ok(!caught.message.includes('private')); return true; });
  }
  adapter.dispose();
});

test('dispose and account switch reject stale reads instead of returning old-account data', async () => {
  const data = await bundle();
  for (const action of ['dispose', 'account']) {
    const waiting = deferred(); const { adapter, state } = fixture({ readPromise: waiting.promise });
    state.emit('INITIAL_SESSION', { user: state.user });
    const pending = adapter.read(data.workspaceId);
    await tick();
    if (action === 'dispose') adapter.dispose(); else state.emit('SIGNED_IN', { user: { id: OTHER } });
    waiting.resolve({ data: row(data), error: null });
    await assert.rejects(pending, code('request_cancelled')); adapter.dispose();
  }
});

test('SDK global fetch is aborted on disposal', async () => {
  let sdkOptions, aborted = false;
  const clientFactory = (_url, _key, options) => {
    sdkOptions = options;
    return { auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, stopAutoRefresh() {} } };
  };
  const adapter = Remote.create(CONNECTION, { core: Core, clientFactory, fetch: (_resource, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  }) });
  const request = sdkOptions.global.fetch(CONNECTION.url + '/fixture');
  adapter.dispose(); await assert.rejects(request, { name: 'AbortError' }); assert.equal(aborted, true);
  assert.equal(typeof officialSDK().createClient, 'function');
});

test('SDK global fetch follows the caller AbortSignal as well as adapter disposal', async () => {
  let sdkOptions;
  const adapter = Remote.create(CONNECTION, { core: Core, clientFactory: (_url, _key, options) => {
    sdkOptions = options;
    return { auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, stopAutoRefresh() {} } };
  }, fetch: (_resource, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }) });
  const controller = new AbortController();
  const pending = sdkOptions.global.fetch(CONNECTION.url + '/fixture', { signal: controller.signal });
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' }); adapter.dispose();
});

test('SDK storage cannot write a stale session after adapter disposal', () => {
  let sdkOptions, closed = 0;
  const records = new Map([['fixture-key', 'current-session']]);
  const storage = { getItem: key => records.get(key) || null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
  const adapter = Remote.create(CONNECTION, { core: Core, storage, clientFactory: (_url, _key, options) => {
    sdkOptions = options;
    return { auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, dispose() { closed++; } } };
  } });
  sdkOptions.auth.storage.setItem('fixture-key', 'active-session');
  adapter.dispose(); sdkOptions.auth.storage.setItem('fixture-key', 'stale-session'); sdkOptions.auth.storage.removeItem('fixture-key');
  assert.equal(records.get('fixture-key'), 'active-session'); assert.equal(closed, 1);
});

test('official bundled SDK removes valid local session even when logout server is offline', async () => {
  const sdk = officialSDK(), storageKey = Remote.SESSION_PREFIX + encodeURIComponent(CONNECTION.url);
  const records = new Map([[storageKey, JSON.stringify({ access_token: 'fixture.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.fixture',
    refresh_token: 'synthetic-refresh-fixture', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user: { id: USER, email: 'fixture@example.invalid' } })]]);
  const storage = { getItem: key => records.get(key) || null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
  const urls = [];
  const adapter = Remote.create(CONNECTION, { core: Core, clientFactory: sdk.createClient, storage, fetch: async (url) => {
    urls.push(String(url)); return new Response(JSON.stringify({ message: 'fixture server offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  } });
  const events = []; adapter.onAuthChange(value => events.push(value));
  await assert.rejects(adapter.signOut(), code('network_error'));
  await tick(); assert.ok(urls.some(url => url.includes('/auth/v1/logout?scope=local')));
  assert.equal(records.has(storageKey), false); assert.equal(events.at(-1), null);
  assert.equal(await adapter.getAccount(), null); adapter.dispose();
});

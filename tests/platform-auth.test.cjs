const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { createAuth, safeNext, validConfig, SESSION_KEY, LOGOUT_KEY } = require('../assets/platform-auth.js');
const config = { url: 'https://fixture.supabase.co', key: 'sb_publishable_fixture' };
const A = { id: '11111111-1111-4111-8111-111111111111', email: 'fixture@example.invalid' };
const B = { id: '22222222-2222-4222-8222-222222222222', email: 'other@example.invalid' };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const errorCode = code => error => { assert.equal(error.code, code); return true; };
function setup(overrides = {}) {
  const records = new Map([[SESSION_KEY, JSON.stringify({ user: A, access_token: 'synthetic-a' })]]);
  const state = { records, user: A, calls: [], events: [], navigations: [], privateElement: { hidden: false }, ...overrides };
  const pageHandlers = new Map(), sdkListeners = new Set();
  const backingStorage = { getItem: key => records.get(key) || null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
  const pathname = overrides.pathname || '/life.html';
  const env = {
    location: { hostname: 'localhost', pathname, search: overrides.search || '', href: 'http://localhost' + pathname + (overrides.search || ''), replace: value => state.navigations.push(value) },
    document: { querySelectorAll: selector => selector === '[data-private]' ? [state.privateElement] : [],
      body: { dataset: { lifeHome: overrides.publicHome ? 'true' : 'false' } },
      documentElement: { classList: { add() {}, remove() {} } }, dispatchEvent: event => state.events.push(event) },
    history: { replaceState: (_state, _title, url) => { state.scrubbed = url; } }, Event,
    addEventListener: (name, callback) => pageHandlers.set(name, callback), removeEventListener: name => pageHandlers.delete(name),
    fetch: async (_url, options) => { state.sent = options; return state.fetchPromise || new Response('{}', { status: state.responseStatus || 200 }); },
    localStorage: backingStorage
  };
  const clientFactory = (_url, _key, options) => {
    state.options = options;
    return { auth: {
      onAuthStateChange(listener) { sdkListeners.add(listener); return { data: { subscription: { unsubscribe: () => sdkListeners.delete(listener) } } }; },
      async getSession() {
        state.calls.push('getSession');
        const value = options.auth.storage.getItem(SESSION_KEY);
        return { data: { session: value ? JSON.parse(value) : null }, error: state.sessionError || null };
      },
      async getUser() { state.calls.push('getUser'); return state.userPromise || { data: { user: state.user }, error: state.verifyError || null }; },
      async refreshSession() { state.calls.push('refresh'); return state.refreshPromise || { data: { session: { user: state.user, access_token: 'synthetic-refreshed' } }, error: null }; },
      async signInWithOAuth(value) { state.oauth = value; return { error: state.oauthError || null }; },
      async signOut(options) {
        state.logoutOptions = options; state.logoutCalls = (state.logoutCalls || 0) + 1;
        const current = state.options.auth.storage.getItem(SESSION_KEY);
        if (current) state.serverRevoke = (state.serverRevoke || 0) + 1;
        if (current && state.logoutPending) await state.logoutPending;
        if (current && state.logoutError) return { error: state.logoutError };
        state.options.auth.storage.removeItem(SESSION_KEY); state.change(null); return { error: null };
      },
      dispose() { state.disposed = true; }
    } };
  };
  state.change = user => {
    state.user = user;
    if (user) records.set(SESSION_KEY, JSON.stringify({ user, access_token: 'synthetic-' + user.id })); else records.delete(SESSION_KEY);
    for (const listener of [...sdkListeners]) listener(user ? 'SIGNED_IN' : 'SIGNED_OUT', user ? { user } : null);
  };
  const auth = createAuth(env, { config, clientFactory });
  return { auth, state, env, pageHandlers, sdkListeners };
}

test('private routes include life and remove unknown query values and external redirects', () => {
  assert.equal(safeNext('life.html?code=private&doc=unrelated#token'), 'life.html');
  assert.equal(safeNext('//evil.invalid/life.html'), 'index.html');
  assert.equal(safeNext('timeline.html?doc=d_1&view=map&access_token=hidden'), 'timeline.html?view=map&doc=d_1');
  assert.equal(validConfig({ ...config, key: 'sb_secret_hidden' }, 'localhost'), false);
});

test('unified home return accepts only known sections and material views', () => {
  assert.equal(safeNext(), 'index.html');
  assert.equal(safeNext('index.html?section=home&code=discarded#token'), 'index.html?section=home');
  assert.equal(safeNext('life.html?section=home&access_token=discarded'), 'life.html?section=home');
  assert.equal(safeNext('index.html?section=records&code=discarded'), 'index.html?section=records');
  assert.equal(safeNext('https://evil.invalid/index.html?section=records'), 'index.html');
  assert.equal(safeNext('index.html?section=manage&view=sync&code=discarded#token'), 'index.html?section=manage&view=sync');
  assert.equal(safeNext('index.html?section=tools&view=transfer'), 'index.html?section=tools&view=transfer');
  assert.equal(safeNext('index.html?section=unknown&view=public&next=https://evil.invalid'), 'index.html');
  assert.equal(safeNext('life.html?view=sources&section=manage'), 'life.html?section=manage&view=sources');
  assert.equal(safeNext('workspace.html?doc=unrelated'), 'workspace.html');
  assert.equal(safeNext('workspace.html?section=manage#backupAll'), 'workspace.html?section=manage');
  assert.equal(safeNext('workspace.html?section=tools'), 'workspace.html');
  assert.equal(safeNext('life.html?section=manage&view=transfer&token=hidden'), 'life.html?section=manage&view=transfer');
  for (const page of ['index.html', 'life.html']) {
    for (const query of ['section=records&view=write', 'section=records&view=activities', 'section=records&view=page', 'section=tools&view=discover', 'section=tools&view=reflection', 'section=manage&view=workbench-backup']) {
      assert.equal(safeNext(page + '?' + query + '&code=discarded&next=https://evil.invalid#access_token=hidden'), page + '?' + query);
    }
  }
  assert.equal(safeNext('index.html?section=manage&view=workbench-backup%26access_token%3Dhidden'), 'index.html?section=manage');
});

test('public home guest verification does not redirect and Google returns to the requested section', async () => {
  const { auth, state } = setup({ pathname: '/index.html', publicHome: true, search: '?section=tools' });
  state.records.delete(SESSION_KEY);
  assert.equal(await auth.verify(), null); assert.equal(auth.getAccount(), null);
  assert.equal(state.navigations.length, 0); assert.equal(state.calls.includes('getUser'), false);
  await auth.login('index.html?section=tools');
  assert.equal(new URL(state.oauth.options.redirectTo).searchParams.get('next'), 'index.html?section=tools');
  auth.dispose();
});

test('public home bfcache keeps cached personal DOM hidden until its shell remounts', async () => {
  const { auth, state, pageHandlers } = setup({ pathname: '/index.html', publicHome: true });
  await auth.verify(); pageHandlers.get('pagehide')();
  assert.equal(state.privateElement.hidden, true);
  await pageHandlers.get('pageshow')({ persisted: true });
  assert.equal(auth.getAccount().userId, A.id); assert.equal(state.privateElement.hidden, true);
  assert.equal(state.navigations.length, 0);
  state.verifyError = { name: 'AuthRetryableFetchError' };
  await pageHandlers.get('pageshow')({ persisted: true });
  assert.equal(state.privateElement.hidden, true); assert.equal(state.events.at(-1).type, 'haedo:auth-unavailable');
  assert.equal(state.navigations.length, 0); auth.dispose();
});

test('leaving the public home cancels a pending verification before it can expose an account', async () => {
  const { auth, state, pageHandlers } = setup({ pathname: '/', publicHome: true });
  const waiting = deferred(); state.userPromise = waiting.promise;
  const accounts = []; auth.onAccountChange(account => accounts.push(account));
  const pending = auth.verify(); await tick(); pageHandlers.get('pagehide')();
  waiting.resolve({ data: { user: A }, error: null });
  await assert.rejects(pending, errorCode('request_cancelled'));
  assert.equal(auth.getAccount(), null); assert.equal(state.privateElement.hidden, true);
  assert.equal(accounts.some(Boolean), false); assert.equal(state.navigations.length, 0); auth.dispose();
});

test('public home account change hides old data without forcing navigation or accepting its late result', async () => {
  const { auth, state } = setup({ pathname: '/index.html', publicHome: true });
  await auth.verify(); const waiting = deferred(); state.userPromise = waiting.promise;
  const pending = auth.verify(); await tick(); state.change(B);
  assert.equal(state.privateElement.hidden, true); assert.equal(auth.getAccount(), null);
  assert.equal(state.navigations.length, 0);
  state.userPromise = null; await auth.verify();
  waiting.resolve({ data: { user: A }, error: null });
  await assert.rejects(pending, errorCode('request_cancelled'));
  assert.equal(auth.getAccount().userId, B.id); assert.equal(state.navigations.length, 0); auth.dispose();
});

test('verified shared account uses Google PKCE and never enables a password flow', async () => {
  const { auth, state } = setup();
  assert.equal(auth.user, null); assert.equal(auth.getAccount(), null);
  assert.equal((await auth.requireUser()).id, A.id); assert.equal(auth.getAccount().userId, A.id);
  assert.ok(state.calls.includes('getUser')); assert.equal(state.options.auth.flowType, 'pkce'); assert.equal(state.options.auth.storageKey, SESSION_KEY);
  await auth.login('life.html?code=discarded');
  assert.equal(state.oauth.provider, 'google'); assert.equal(new URL(state.oauth.options.redirectTo).searchParams.get('next'), 'life.html');
  assert.equal(typeof auth.getClient().auth.signInWithPassword, 'undefined'); auth.dispose();
});

test('unverified token cannot open a protected offline cold load', async () => {
  const { auth, state } = setup({ verifyError: { name: 'AuthRetryableFetchError', message: 'raw private error' } });
  await assert.rejects(auth.requireUser(), errorCode('network_error'));
  assert.equal(auth.user, null); assert.equal(auth.getAccount(), null); assert.equal(state.navigations.length, 0); auth.dispose();
});

test('temporary network loss keeps an already verified account while bfcache keeps the page hidden', async () => {
  const { auth, state, pageHandlers } = setup(); await auth.verify();
  state.verifyError = { name: 'AuthRetryableFetchError' };
  await assert.rejects(auth.verify(), errorCode('network_error')); assert.equal(auth.user.id, A.id);
  pageHandlers.get('pagehide')(); await pageHandlers.get('pageshow')({ persisted: true });
  assert.equal(state.privateElement.hidden, true); assert.equal(state.events.at(-1).type, 'haedo:auth-unavailable');
  assert.equal(state.events.at(-1).code, 'network_error'); assert.equal(state.navigations.length, 0); auth.dispose();
});

test('account switch rejects an old verification even if the same account returns later', async () => {
  const { auth, state } = setup(); await auth.verify();
  const waiting = deferred(); state.userPromise = waiting.promise;
  const pending = auth.verify(); await tick(); state.change(B); state.change(A);
  waiting.resolve({ data: { user: A }, error: null });
  await assert.rejects(pending, errorCode('request_cancelled')); assert.equal(auth.user, null); auth.dispose();
});

test('disposed Auth cannot republish a late verified account', async () => {
  const { auth, state } = setup(); const waiting = deferred(); state.userPromise = waiting.promise;
  const pending = auth.verify(); await tick(); auth.dispose(); waiting.resolve({ data: { user: A }, error: null });
  await assert.rejects(pending, errorCode('request_cancelled')); assert.equal(auth.user, null);
});

test('online logout retains normal SDK server revocation then persists the local block', async () => {
  const { auth, state } = setup(); await auth.verify(); const previous = auth.epoch;
  await auth.signOut(); assert.equal(state.serverRevoke, 1); assert.deepEqual(state.logoutOptions, { scope: 'local' });
  assert.equal(state.records.get(LOGOUT_KEY), '1'); assert.equal(state.records.has(SESSION_KEY), false);
  assert.ok(auth.epoch > previous); assert.equal(auth.getAccount(), null); assert.equal(state.privateElement.hidden, true);
  assert.equal(state.navigations.at(-1), 'index.html'); auth.dispose();
});

test('another tab logout blocks private UI immediately before its SDK broadcast arrives', async () => {
  const { auth, state, pageHandlers } = setup(); await auth.verify(); const before = auth.epoch;
  state.records.set(LOGOUT_KEY, '1'); pageHandlers.get('storage')({ key: LOGOUT_KEY, newValue: '1' });
  assert.equal(auth.getAccount(), null); assert.equal(state.privateElement.hidden, true); assert.ok(auth.epoch > before);
  assert.equal(state.events.at(-1).type, 'haedo:signed-out'); auth.dispose();
});

test('a late old logout cannot delete or broadcast over another tab fresh login', async () => {
  const { auth, state } = setup(); await auth.verify(); const waiting = deferred(); state.logoutPending = waiting.promise;
  const pending = auth.signOut(); await tick();
  state.records.delete(LOGOUT_KEY); state.records.set(SESSION_KEY, JSON.stringify({ user: B, access_token: 'synthetic-b' }));
  waiting.resolve(); await pending;
  assert.equal(JSON.parse(state.records.get(SESSION_KEY)).user.id, B.id);
  assert.equal(state.logoutCalls, 1); assert.equal(auth.getAccount(), null); auth.dispose();
});

test('a late bfcache verification cannot hide a newly verified account screen', async () => {
  const { auth, state, pageHandlers } = setup(); await auth.verify(); const waiting = deferred(); state.userPromise = waiting.promise;
  const pending = pageHandlers.get('pageshow')({ persisted: true }); await tick();
  state.change(B); state.userPromise = null; await auth.verify(); state.privateElement.hidden = false;
  const eventCount = state.events.length;
  waiting.resolve({ data: { user: A }, error: null }); await pending;
  assert.equal(auth.getAccount().userId, B.id); assert.equal(state.privateElement.hidden, false);
  assert.equal(state.events.length, eventCount); auth.dispose();
});

test('expired offline logout cleans through supported SDK storage and prevents reload resurrection', async () => {
  const { auth, state, env } = setup({ logoutError: { name: 'AuthRetryableFetchError' } }); await auth.verify();
  await auth.signOut(); assert.equal(state.logoutCalls, 2); assert.equal(state.records.has(SESSION_KEY), false);
  state.options.auth.storage.setItem(SESSION_KEY, JSON.stringify({ user: A })); assert.equal(state.records.has(SESSION_KEY), false);
  const recreated = createAuth(env, { config, clientFactory: (_url, _key, options) => ({ auth: {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    async getSession() { return { data: { session: options.auth.storage.getItem(SESSION_KEY) }, error: null }; }, dispose() {}
  } }) });
  assert.equal(await recreated.verify(), null); assert.equal(recreated.getAccount(), null); recreated.dispose(); auth.dispose();
});

test('request blocks foreign origins before attaching credentials', async () => {
  const { auth, state } = setup(); await auth.verify();
  await assert.rejects(auth.request('https://evil.invalid/rest/v1/charts'), errorCode('invalid_request'));
  assert.equal(state.sent, undefined); auth.dispose();
});

test('refresh cannot retry an old body with a new account token', async () => {
  const { auth, state } = setup({ responseStatus: 401 }); await auth.verify();
  const waiting = deferred(); state.refreshPromise = waiting.promise;
  const pending = auth.request(config.url + '/rest/v1/charts', { method: 'POST', body: 'anonymous old-account body' });
  await tick(); assert.ok(state.calls.includes('refresh')); state.change(B);
  waiting.resolve({ data: { session: { user: B, access_token: 'synthetic-b' } }, error: null });
  await assert.rejects(pending, errorCode('request_cancelled'));
  assert.equal(new Headers(state.sent.headers).get('Authorization'), 'Bearer synthetic-a'); auth.dispose();
});

test('old fetch results are rejected across A to B to A and its AbortSignal is cancelled', async () => {
  const { auth, state } = setup(); await auth.verify(); const waiting = deferred(); state.fetchPromise = waiting.promise;
  const pending = auth.request(config.url + '/rest/v1/charts'); await tick();
  state.change(B); state.change(A); assert.equal(state.sent.signal.aborted, true);
  waiting.resolve(new Response('{}')); await assert.rejects(pending, errorCode('request_cancelled')); auth.dispose();
});

test('callback credentials and errors are scrubbed on success or SDK initialization failure', async () => {
  for (const failed of [false, true]) {
    const { env, auth, state } = setup(); auth.dispose(); env.location.pathname = '/login.html';
    env.location.href = 'http://localhost/login.html?next=life.html&code=synthetic-code&error_description=private#access_token=synthetic';
    const created = createAuth(env, { config, clientFactory: () => ({ auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: () => failed ? Promise.reject(new Error('raw error')) : Promise.resolve({ data: { session: null } }), dispose() {}
    } }) });
    await tick(); assert.equal(created.ready, true);
    assert.equal(state.scrubbed, '/login.html?next=life.html');
    state.scrubbed = undefined;
    const missing = createAuth(env, { config: { url: '', key: '' } });
    assert.equal(state.scrubbed, '/login.html?next=life.html'); missing.dispose(); created.dispose();
  }
});

function sdk() {
  const context = { fetch, Headers, Request, Response, URL, crypto, TextEncoder, TextDecoder, WebSocket, AbortController,
    DOMException, setTimeout, clearTimeout, setInterval, clearInterval, atob, btoa,
    console: { warn() {}, log() {}, error() {}, debug() {} } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../vendor/supabase/supabase.js'), 'utf8'), context);
  return context.supabase;
}

test('actual bundled SDK online logout uses shared session and offline failure cannot restore it', async () => {
  const { env, auth: fake } = setup(); fake.dispose();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = 'fixture.' + Buffer.from(JSON.stringify({ sub: A.id, exp })).toString('base64url') + '.fixture';
  const records = new Map([[SESSION_KEY, JSON.stringify({ user: A, access_token: token, refresh_token: 'synthetic-refresh', expires_at: exp, expires_in: 3600, token_type: 'bearer' })]]);
  env.localStorage = { getItem: key => records.get(key) || null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
  const paths = [];
  const factory = (url, key, options) => sdk().createClient(url, key, { ...options, global: { fetch: async input => {
    const path = new URL(input).pathname; paths.push(path);
    return new Response(JSON.stringify(path === '/auth/v1/user' ? A : { message: 'offline fixture' }), { status: path === '/auth/v1/user' ? 200 : 503, headers: { 'Content-Type': 'application/json' } });
  } } });
  const auth = createAuth(env, { config, clientFactory: factory });
  assert.equal((await auth.verify()).id, A.id); await auth.signOut();
  assert.ok(paths.includes('/auth/v1/logout')); assert.equal(records.has(SESSION_KEY), false); assert.equal(records.get(LOGOUT_KEY), '1');
  assert.equal(auth.getAccount(), null); auth.dispose();
});

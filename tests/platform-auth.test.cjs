const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { createAuth, safeNext, validConfig, SESSION_KEY, LOGOUT_KEY, STARTUP_LIMIT_MS } = require('../assets/platform-auth.js');
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
    localStorage: backingStorage, ...(overrides.sessionStorage ? { sessionStorage: overrides.sessionStorage } : {})
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
  const auth = createAuth(env, { config, clientFactory, ...(overrides.now ? { now: overrides.now } : {}), ...(overrides.authOptions || {}) });
  return { auth, state, env, pageHandlers, sdkListeners };
}

test('private routes include life and remove unknown query values and external redirects', () => {
  assert.equal(safeNext('life.html?code=private&doc=unrelated#token'), 'life.html');
  assert.equal(safeNext('//evil.invalid/life.html'), 'index.html');
  assert.equal(safeNext('timeline.html?doc=d_1&view=map&access_token=hidden'), 'timeline.html?view=map&doc=d_1');
  assert.equal(validConfig({ ...config, key: 'sb_secret_hidden' }, 'localhost'), false);
});

test('account post discovery survives login without keeping private query values', () => {
  assert.equal(safeNext('index.html?view=account-blog&code=discarded&post=private#token'), 'index.html?view=account-blog');
  assert.equal(safeNext('life.html?section=home&view=account-blog&access_token=discarded'), 'life.html?section=home&view=account-blog');
  assert.equal(safeNext('https://evil.invalid/index.html?view=account-blog'), 'index.html');
  assert.equal(safeNext('index.html?view=account-blog-unknown'), 'index.html');
});

test('first writing intent survives login only as the exact local home flag', () => {
  assert.equal(safeNext('index.html?compose=1&code=discarded&next=https://evil.invalid#token'), 'index.html?compose=1');
  assert.equal(safeNext('index.html?compose=other'), 'index.html');
  assert.equal(safeNext('index.html?compose=1%26access_token%3Dhidden'), 'index.html');
  assert.equal(safeNext('life.html?compose=1'), 'life.html');
  assert.equal(safeNext('timeline.html?compose=1'), 'timeline.html');
  assert.equal(safeNext('https://evil.invalid/index.html?compose=1'), 'index.html');
});

test('relocated library and publishing destinations survive login with legacy links and no private query data', () => {
  for (const page of ['index.html', 'life.html']) {
    for (const query of ['section=records&view=books', 'section=tools&view=books', 'section=records&view=source-trash',
      'section=manage&view=source-trash', 'section=home&view=public-pages', 'section=manage&view=public-pages', 'section=records&view=find']) {
      assert.equal(safeNext(page + '?' + query + '&code=discarded&sourceId=private&next=https://evil.invalid#token'), page + '?' + query);
    }
  }
  for (const value of ['books-extra', 'public-pages%26access_token%3Dhidden', 'source-trash%2F..', '__proto__']) {
    assert.equal(safeNext('index.html?section=records&view=' + value), 'index.html?section=records');
  }
  assert.equal(safeNext('//evil.invalid/index.html?section=home&view=public-pages'), 'index.html');
});

test('unified home return accepts only known sections and material views', () => {
  assert.equal(safeNext(), 'index.html');
  assert.equal(safeNext('index.html?section=home&code=discarded#token'), 'index.html?section=home');
  assert.equal(safeNext('index.html?section=news&code=discarded&access_token=hidden&next=https://evil.invalid#refresh_token=hidden'), 'index.html?section=news');
  assert.equal(safeNext('index.html?section=tools&view=annual-plan&code=discarded#token'), 'index.html?section=tools&view=annual-plan');
  assert.equal(safeNext('life.html?section=tools&view=annual-plan&access_token=discarded'), 'life.html?section=tools&view=annual-plan');
  assert.equal(safeNext('life.html?section=news&view=external-discovery&access_token=discarded#token'), 'life.html?section=news&view=external-discovery');
  assert.equal(safeNext('index.html?view=external-discovery&code=discarded#token'), 'index.html?view=external-discovery');
  assert.equal(safeNext('https://evil.invalid/index.html?section=news'), 'index.html');
  assert.equal(safeNext('index.html?section=news%26access_token%3Dhidden'), 'index.html');
  assert.equal(safeNext('index.html?section=tools&view=interests&code=discarded#token'), 'index.html?section=tools&view=interests');
  assert.equal(safeNext('index.html?section=tools&view=external-discovery&code=discarded#token'), 'index.html?section=tools&view=external-discovery');
  assert.equal(safeNext('life.html?section=tools&view=external-discovery&access_token=discarded'), 'life.html?section=tools&view=external-discovery');
  assert.equal(safeNext('life.html?section=home&access_token=discarded'), 'life.html?section=home');
  assert.equal(safeNext('index.html?section=records&code=discarded'), 'index.html?section=records');
  assert.equal(safeNext('https://evil.invalid/index.html?section=records'), 'index.html');
  assert.equal(safeNext('index.html?section=manage&view=sync&code=discarded#token'), 'index.html?section=manage&view=sync');
  assert.equal(safeNext('index.html?section=tools&view=transfer'), 'index.html?section=tools&view=transfer');
  assert.equal(safeNext('index.html?section=unknown&view=public&next=https://evil.invalid'), 'index.html');
  // 2026-11-02 menu: 일정 (schedule) and its plan view keep their exact return; old IDs stay accepted.
  assert.equal(safeNext('index.html?section=schedule&view=tools&code=discarded#token'), 'index.html?section=schedule&view=tools');
  assert.equal(safeNext('index.html?section=schedule&view=annual-plan&access_token=hidden'), 'index.html?section=schedule&view=annual-plan');
  assert.equal(safeNext('index.html?section=schedule'), 'index.html?section=schedule');
  assert.equal(safeNext('index.html?section=Schedule&view=Tools'), 'index.html');
  assert.equal(safeNext('life.html?view=sources&section=manage'), 'life.html?section=manage&view=sources');
  assert.equal(safeNext('workspace.html?doc=unrelated'), 'workspace.html');
  assert.equal(safeNext('workspace.html?section=manage#backupAll'), 'workspace.html?section=manage');
  assert.equal(safeNext('workspace.html?section=tools'), 'workspace.html');
  assert.equal(safeNext('life.html?section=manage&view=transfer&token=hidden'), 'life.html?section=manage&view=transfer');
  for (const page of ['index.html', 'life.html']) {
    for (const query of ['section=records&view=write', 'section=records&view=activities', 'section=records&view=page', 'section=tools&view=discover', 'section=tools&view=reflection', 'section=manage&view=workbench-backup', 'section=manage&view=preservation', 'section=manage&view=obsidian-update', 'section=manage&view=blog', 'section=manage&view=public-cover']) {
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

test('a workspace captures before conceal and owns one verified resume without generic reveal', async () => {
  const { auth, state, env, pageHandlers } = setup();
  await auth.verify();
  const epoch = auth.epoch;
  const calls = state.calls.filter(name => name === 'getUser').length;
  let resumed = 0, suspension;
  env.document.dispatchEvent = event => {
    state.events.push(event);
    if (event.type === 'haedo:page-suspend') suspension = { hidden: state.privateElement.hidden, epoch: auth.epoch };
    if (event.type === 'haedo:page-resume') { resumed++; event.preventDefault(); }
    return !event.defaultPrevented;
  };
  pageHandlers.get('pagehide')();
  assert.deepEqual(suspension, { hidden: false, epoch });
  assert.equal(state.privateElement.hidden, true);
  assert.equal(auth.epoch, epoch + 1);
  await pageHandlers.get('pageshow')({ persisted: true });
  assert.equal(resumed, 1);
  assert.equal(state.calls.filter(name => name === 'getUser').length, calls);
  assert.equal(state.privateElement.hidden, true);
  assert.equal(state.navigations.length, 0);
  auth.dispose();
});

test('a cached page starts no account check, so its resume never shares one begun before pageshow', async () => {
  const { auth, state, env, pageHandlers } = setup();
  await auth.verify();
  env.document.dispatchEvent = event => { state.events.push(event); if (event.type === 'haedo:page-resume') event.preventDefault(); return !event.defaultPrevented; };
  const before = state.calls.filter(name => name === 'getUser').length;
  pageHandlers.get('pagehide')({ persisted: true });
  // A background engine woken by pagehide, or by the visibility change that
  // precedes pageshow on restore, must not contact Auth for the cached page.
  await assert.rejects(auth.verify(), errorCode('request_cancelled'));
  assert.equal(state.calls.filter(name => name === 'getUser').length, before);
  await pageHandlers.get('pageshow')({ persisted: true });
  const waiting = deferred(); state.userPromise = waiting.promise;
  const resume = auth.verify(), engine = auth.verify(); await tick(); await tick();
  // The resumed page's check is new; checks overlapping it share that one request.
  assert.equal(state.calls.filter(name => name === 'getUser').length, before + 1);
  waiting.resolve({ data: { user: A }, error: null });
  assert.equal((await resume).id, A.id); assert.equal((await engine).id, A.id);
  // An ordinary (non-cached) pagehide does not block later checks.
  state.userPromise = null; pageHandlers.get('pagehide')({ persisted: false });
  assert.equal((await auth.verify()).id, A.id);
  auth.dispose();
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

test('concurrent exact-session verification shares one server request but later verification is fresh', async () => {
  const { auth, state } = setup(); const waiting = deferred(); state.userPromise = waiting.promise;
  const pending = Array.from({ length: 5 }, () => auth.verify());
  await tick(); assert.equal(state.calls.filter(name => name === 'getUser').length, 1);
  assert.equal(auth.user, null); assert.equal(auth.getAccount(), null);
  waiting.resolve({ data: { user: A }, error: null });
  for (const user of await Promise.all(pending)) assert.equal(user.id, A.id);
  // Every caller still checks its current session before and after the shared GET.
  assert.equal(state.calls.filter(name => name === 'getSession').length, 11);
  state.userPromise = null; await auth.verify();
  assert.equal(state.calls.filter(name => name === 'getUser').length, 2); auth.dispose();
});

test('failed shared server verification is removed and an explicit retry contacts Auth again', async () => {
  const { auth, state } = setup(); const waiting = deferred(); state.userPromise = waiting.promise;
  const pending = Array.from({ length: 3 }, () => auth.verify());
  const outcomes = Promise.allSettled(pending);
  await tick(); assert.equal(state.calls.filter(name => name === 'getUser').length, 1);
  waiting.resolve({ data: { user: null }, error: { name: 'AuthRetryableFetchError' } });
  for (const result of await outcomes) { assert.equal(result.status, 'rejected'); assert.equal(result.reason.code, 'network_error'); }
  assert.equal(auth.getAccount(), null);
  state.userPromise = null; assert.equal((await auth.verify()).id, A.id);
  assert.equal(state.calls.filter(name => name === 'getUser').length, 2); auth.dispose();
});

test('a rotated token has its own pending check and an older completion cannot clear it', async () => {
  const { auth, state, sdkListeners } = setup();
  const oldRead = deferred(), newRead = deferred(); state.userPromise = oldRead.promise;
  const beforeRotation = auth.verify(); await tick();
  const nextSession = { user: A, access_token: 'synthetic-rotated' };
  state.records.set(SESSION_KEY, JSON.stringify(nextSession));
  for (const listener of sdkListeners) listener('TOKEN_REFRESHED', nextSession);
  state.userPromise = newRead.promise;
  const afterRotation = auth.verify(); await tick();
  assert.equal(state.calls.filter(name => name === 'getUser').length, 2);
  oldRead.resolve({ data: { user: A }, error: null }); assert.equal((await beforeRotation).id, A.id);
  const sameRotatedSession = auth.verify(); await tick();
  assert.equal(state.calls.filter(name => name === 'getUser').length, 2);
  newRead.resolve({ data: { user: A }, error: null });
  assert.equal((await afterRotation).id, A.id); assert.equal((await sameRotatedSession).id, A.id);
  assert.equal(auth.session.access_token, 'synthetic-rotated');
  state.userPromise = null; await auth.verify();
  assert.equal(state.calls.filter(name => name === 'getUser').length, 3); auth.dispose();
});

test('an account change cancels every waiter without sharing the old account response', async () => {
  const { auth, state } = setup(); const waiting = deferred(); state.userPromise = waiting.promise;
  const oldCalls = Promise.allSettled([auth.verify(), auth.verify(), auth.verify()]); await tick();
  assert.equal(state.calls.filter(name => name === 'getUser').length, 1);
  state.change(B); assert.equal(auth.getAccount(), null); assert.equal(state.privateElement.hidden, true);
  state.userPromise = null; assert.equal((await auth.verify()).id, B.id);
  waiting.resolve({ data: { user: A }, error: null });
  for (const result of await oldCalls) { assert.equal(result.status, 'rejected'); assert.equal(result.reason.code, 'request_cancelled'); }
  assert.equal(auth.getAccount().userId, B.id);
  assert.equal(state.calls.filter(name => name === 'getUser').length, 2); auth.dispose();
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

test('actual bundled SDK shares one overlapping user HTTP request and refreshes the next verification', async () => {
  const { env, auth: fake } = setup(); fake.dispose();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = 'fixture.' + Buffer.from(JSON.stringify({ sub: A.id, exp })).toString('base64url') + '.fixture';
  const records = new Map([[SESSION_KEY, JSON.stringify({ user: A, access_token: token, refresh_token: 'synthetic-refresh', expires_at: exp, expires_in: 3600, token_type: 'bearer' })]]);
  env.localStorage = { getItem: key => records.get(key) || null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
  const entered = deferred(), release = deferred(), paths = [];
  const factory = (url, key, options) => sdk().createClient(url, key, { ...options, global: { fetch: async (input, init) => {
    const path = new URL(input).pathname; paths.push(path);
    assert.equal(path, '/auth/v1/user'); assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + token);
    entered.resolve(); await release.promise;
    return new Response(JSON.stringify(A), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } } });
  const auth = createAuth(env, { config, clientFactory: factory });
  try {
    const pending = [auth.verify(), auth.verify(), auth.verify()];
    await entered.promise; await tick(); assert.equal(paths.length, 1); assert.equal(auth.user, null);
    release.resolve(); for (const user of await Promise.all(pending)) assert.equal(user.id, A.id);
    assert.equal(paths.length, 1);
    assert.equal((await auth.verify()).id, A.id); assert.equal(paths.length, 2);
  } finally { release.resolve(); auth.dispose(); }
});

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

// W4 (2026-11-02): a verification scope shares one server check across one
// bounded unit of work. These cases pin every condition that discards it.
const serverChecks = state => state.calls.filter(name => name === 'getUser').length;

test('W4 a verification scope contacts Auth once; other scopes, plain verify, ended scopes and fresh checks stay server-side', async () => {
  const { auth, state } = setup();
  const scope = auth.verificationScope();
  for (let n = 0; n < 5; n++) assert.equal((await scope.verify()).id, A.id);
  assert.equal(serverChecks(state), 1);
  const other = auth.verificationScope(); assert.equal((await other.verify()).id, A.id); assert.equal(serverChecks(state), 2);
  await auth.verify(); await auth.verify(); assert.equal(serverChecks(state), 4);
  scope.end(); assert.equal(scope.ended, true);
  await scope.verify(); await scope.verify(); assert.equal(serverChecks(state), 6);
  await other.verify({ fresh: true }); assert.equal(serverChecks(state), 7);
  await other.verify(); assert.equal(serverChecks(state), 7);
  auth.dispose();
});

test('W4 every SDK Auth event discards the scope result before the next call', async () => {
  const { auth, state, sdkListeners } = setup();
  const scope = auth.verificationScope(); await scope.verify();
  let expected = 1;
  for (const name of ['TOKEN_REFRESHED', 'USER_UPDATED', 'SIGNED_IN', 'INITIAL_SESSION', 'PASSWORD_RECOVERY', 'MFA_CHALLENGE_VERIFIED']) {
    for (const listener of [...sdkListeners]) listener(name, { user: A, access_token: 'synthetic-a' });
    assert.equal((await scope.verify()).id, A.id, name); expected++;
    assert.equal(serverChecks(state), expected, name + ' must contact Auth again');
    await scope.verify(); assert.equal(serverChecks(state), expected, name + ': the new check is reused');
  }
  auth.dispose();
});

test('W4 a token changed without an event, a cross-tab session write and a session read failure are never reused', async () => {
  const { auth, state, pageHandlers } = setup();
  const scope = auth.verificationScope(); await scope.verify();
  state.records.set(SESSION_KEY, JSON.stringify({ user: A, access_token: 'synthetic-rotated-elsewhere' }));
  assert.equal((await scope.verify()).id, A.id); assert.equal(serverChecks(state), 2);
  await scope.verify(); assert.equal(serverChecks(state), 2);
  pageHandlers.get('storage')({ key: SESSION_KEY, newValue: state.records.get(SESSION_KEY) });
  await scope.verify(); assert.equal(serverChecks(state), 3);
  state.sessionError = { name: 'AuthRetryableFetchError' };
  await assert.rejects(scope.verify(), errorCode('network_error')); assert.equal(serverChecks(state), 3);
  state.sessionError = null; await scope.verify(); assert.equal(serverChecks(state), 4);
  auth.dispose();
});

test('W4 account switch, sign-out and another tab logout never reuse the previous account check', async () => {
  const { auth, state, pageHandlers } = setup();
  const scope = auth.verificationScope(); await scope.verify();
  state.change(B);
  assert.equal((await scope.verify()).id, B.id); assert.equal(serverChecks(state), 2);
  // A check obtained after the switch is not kept by the scope opened for A.
  assert.equal((await scope.verify()).id, B.id); assert.equal(serverChecks(state), 3);
  const second = auth.verificationScope(); await second.verify(); await second.verify(); assert.equal(serverChecks(state), 4);
  state.change(null);
  assert.equal(await second.verify(), null); assert.equal(serverChecks(state), 4);
  state.change(A);
  const third = auth.verificationScope(); assert.equal((await third.verify()).id, A.id); assert.equal(serverChecks(state), 5);
  // Another tab's logout marker blocks reuse even before its storage event arrives.
  state.records.set(LOGOUT_KEY, '1');
  assert.equal(await third.verify(), null); assert.equal(serverChecks(state), 5);
  pageHandlers.get('storage')({ key: LOGOUT_KEY, newValue: '1' });
  assert.equal(await third.verify(), null); assert.equal(serverChecks(state), 5); assert.equal(auth.getAccount(), null);
  auth.dispose();
});

test('W4 a scope never crosses an epoch, even when no Auth event or storage event marked the change', async () => {
  // The session disappears and returns with the same token, with no SDK or
  // storage event at all. Only the epoch advanced (a plain verify() found no
  // session and signed the page out); the earlier scope must still recheck.
  const { auth, state } = setup();
  const scope = auth.verificationScope(); await scope.verify(); assert.equal(serverChecks(state), 1);
  const saved = state.records.get(SESSION_KEY); state.records.delete(SESSION_KEY);
  assert.equal(await auth.verify(), null); assert.equal(auth.getAccount(), null);
  state.records.set(SESSION_KEY, saved);
  assert.equal((await auth.verify()).id, A.id); assert.equal(serverChecks(state), 2);
  assert.equal((await scope.verify()).id, A.id); assert.equal(serverChecks(state), 3);
  // Nor does it keep a check obtained in the new epoch.
  await scope.verify(); assert.equal(serverChecks(state), 4);
  auth.dispose();
});

test('W4 a late check for the previous account is neither returned nor kept for the new account', async () => {
  const { auth, state } = setup();
  const scope = auth.verificationScope(), waiting = deferred(); state.userPromise = waiting.promise;
  const pending = scope.verify(); await tick();
  state.change(B); state.userPromise = null;
  waiting.resolve({ data: { user: A }, error: null });
  await assert.rejects(pending, errorCode('request_cancelled'));
  const next = auth.verificationScope(); assert.equal((await next.verify()).id, B.id);
  const before = serverChecks(state);
  assert.equal((await scope.verify()).id, B.id); assert.equal(serverChecks(state), before + 1);
  auth.dispose();
});

test('W4 bfcache: a parked page uses no scope result, and after pageshow every scope checks Auth again', async () => {
  for (const pathname of ['/life.html', '/blog.html']) {
    const { auth, state, env, pageHandlers } = setup({ pathname });
    env.document.dispatchEvent = event => { state.events.push(event); if (event.type === 'haedo:page-resume') event.preventDefault(); return !event.defaultPrevented; };
    const scope = auth.verificationScope(); await scope.verify(); await scope.verify();
    const before = serverChecks(state);
    pageHandlers.get('pagehide')({ persisted: true });
    await assert.rejects(scope.verify(), errorCode('request_cancelled'), pathname);
    assert.equal(serverChecks(state), before, pathname + ': no check while parked');
    await pageHandlers.get('pageshow')({ persisted: true });
    assert.equal((await scope.verify()).id, A.id); assert.equal(serverChecks(state), before + 1, pathname + ': resumed page checks again');
    // An ordinary pagehide and pageshow are boundaries too.
    pageHandlers.get('pagehide')({ persisted: false });
    const after = auth.verificationScope(); await after.verify(); assert.equal(serverChecks(state), before + 2);
    await after.verify(); await pageHandlers.get('pageshow')({ persisted: false });
    await after.verify(); assert.equal(serverChecks(state), before + 3, pathname);
    auth.dispose();
  }
});

test('W4 failed and offline checks are not kept: each later call retries the server with the same errors', async () => {
  const { auth, state } = setup();
  const scope = auth.verificationScope();
  state.user = null; state.verifyError = { name: 'AuthRetryableFetchError' };
  await assert.rejects(scope.verify(), errorCode('network_error'));
  await assert.rejects(scope.verify(), errorCode('network_error'));
  assert.equal(serverChecks(state), 2);
  state.verifyError = { name: 'TypeError' };
  await assert.rejects(scope.verify(), errorCode('network_error')); assert.equal(serverChecks(state), 3);
  state.user = A; state.verifyError = null;
  assert.equal((await scope.verify()).id, A.id); await scope.verify(); assert.equal(serverChecks(state), 4);
  // A server rejection signs the page out exactly as before and keeps nothing.
  state.user = null; state.verifyError = { status: 401, code: 'session_not_found' };
  const rejected = auth.verificationScope();
  assert.equal(await rejected.verify(), null); assert.equal(auth.getAccount(), null); assert.equal(serverChecks(state), 5);
  state.user = A; state.verifyError = null;
  assert.equal((await rejected.verify()).id, A.id); assert.equal(serverChecks(state), 6);
  auth.dispose();
});

test('W4 the public home exposes no account before its first server check, scoped or not', async () => {
  const { auth, state } = setup({ pathname: '/index.html', publicHome: true });
  const waiting = deferred(); state.userPromise = waiting.promise;
  const scope = auth.verificationScope(), pending = scope.verify(); await tick();
  assert.equal(auth.user, null); assert.equal(auth.getAccount(), null);
  waiting.resolve({ data: { user: A }, error: null });
  assert.equal((await pending).id, A.id); assert.equal(auth.getAccount().userId, A.id);
  auth.dispose();
});

test('W4 actual bundled SDK: one user HTTP request per scope, read against the real stored session', async () => {
  const { env, auth: fake } = setup(); fake.dispose();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = 'fixture.' + Buffer.from(JSON.stringify({ sub: A.id, exp })).toString('base64url') + '.fixture';
  const records = new Map([[SESSION_KEY, JSON.stringify({ user: A, access_token: token, refresh_token: 'synthetic-refresh', expires_at: exp, expires_in: 3600, token_type: 'bearer' })]]);
  env.localStorage = { getItem: key => records.get(key) || null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
  const paths = [];
  const factory = (url, key, options) => sdk().createClient(url, key, { ...options, global: { fetch: async input => {
    const path = new URL(input).pathname; paths.push(path); assert.equal(path, '/auth/v1/user');
    return new Response(JSON.stringify(A), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } } });
  const auth = createAuth(env, { config, clientFactory: factory });
  try {
    // The SDK's own start-up events (SIGNED_IN from session recovery,
    // INITIAL_SESSION) are boundaries as well; the boot check precedes scopes.
    assert.equal((await auth.verify()).id, A.id); assert.equal(paths.length, 1);
    const scope = auth.verificationScope();
    for (let n = 0; n < 4; n++) assert.equal((await scope.verify()).id, A.id);
    assert.equal(paths.length, 2);
    const next = auth.verificationScope(); await next.verify(); assert.equal(paths.length, 3);
    scope.end(); await scope.verify(); assert.equal(paths.length, 4);
  } finally { auth.dispose(); }
});

// 2026-11-03 page opening (beginStartup): the shell check, the foreground
// account bootstrap and the first mount share one finished server check.
// Only opt-in reads use it; it follows the W4 conditions and a new opening starts empty.
test('opening: opt-in reads share one server check; plain, fresh and ended calls still contact Auth', async () => {
  const { auth, state } = setup();
  const opening = auth.beginStartup();
  assert.equal((await auth.verify({ startup: true })).id, A.id); assert.equal(serverChecks(state), 1);
  assert.equal((await auth.requireUser({ startup: true })).id, A.id); assert.equal((await auth.verify({ startup: true })).id, A.id);
  assert.equal(serverChecks(state), 1, 'bootstrap and remote reads reuse the opening check');
  const scope = auth.verificationScope(); await scope.verify(); assert.equal(serverChecks(state), 1, 'a sync operation starts from the opening check');
  await scope.verify({ fresh: true }); assert.equal(serverChecks(state), 2, 'a snapshot write still checks with Auth');
  await auth.verify(); assert.equal(serverChecks(state), 3, 'a call without the option is never shared');
  opening.end();
  await auth.verify({ startup: true }); assert.equal(serverChecks(state), 4, 'after the opening every call checks');
  const next = auth.beginStartup();
  await auth.verify({ startup: true }); assert.equal(serverChecks(state), 5, 'a new opening starts without a result');
  await auth.verify({ startup: true }); assert.equal(serverChecks(state), 5);
  next.end(); auth.dispose();
});

test('opening: an account switch, sign-out, token change, Auth event or page hide never reuses the earlier check', async () => {
  const { auth, state, sdkListeners, pageHandlers } = setup();
  const opening = auth.beginStartup();
  await auth.verify({ startup: true }); assert.equal(serverChecks(state), 1);
  state.change(B);
  assert.equal((await auth.verify({ startup: true })).id, B.id, 'the switched account is checked, not the earlier result'); assert.equal(serverChecks(state), 2);
  state.records.set(SESSION_KEY, JSON.stringify({ user: B, access_token: 'synthetic-rotated' }));
  assert.equal((await auth.verify({ startup: true })).id, B.id); assert.equal(serverChecks(state), 3, 'a new access token is checked');
  for (const listener of [...sdkListeners]) listener('TOKEN_REFRESHED', { user: B, access_token: 'synthetic-rotated' });
  await auth.verify({ startup: true }); assert.equal(serverChecks(state), 4, 'a token refresh event is checked');
  pageHandlers.get('pagehide')({ persisted: false });
  await auth.verify({ startup: true }); assert.equal(serverChecks(state), 5, 'a page boundary is checked');
  state.change(null);
  assert.equal(await auth.verify({ startup: true }), null); assert.equal(auth.getAccount(), null);
  state.change(A); state.records.set(LOGOUT_KEY, '1');
  assert.equal(await auth.verify({ startup: true }), null, 'a logout marker blocks reuse');
  opening.end(); auth.dispose();
});

test('opening: only the document\'s first pageshow keeps the opening check; an Auth event before it, or a resumed page, does not', async () => {
  const { auth, state, pageHandlers } = setup();
  const opening = auth.beginStartup();
  await auth.verify({ startup: true }); assert.equal(serverChecks(state), 1);
  await pageHandlers.get('pageshow')({ persisted: false });
  await auth.verify({ startup: true }); assert.equal(serverChecks(state), 1, 'the first show of this document is not a hidden period');
  const scope = auth.verificationScope(); await scope.verify(); assert.equal(serverChecks(state), 1);
  pageHandlers.get('pagehide')({ persisted: true }); await pageHandlers.get('pageshow')({ persisted: true });
  const resumed = serverChecks(state); // the resumed private page verifies itself
  await auth.verify({ startup: true }); assert.equal(serverChecks(state), resumed + 1, 'a page resumed from the back/forward cache checks again');
  opening.end();
  const { auth: other, state: otherState, sdkListeners: otherListeners, pageHandlers: otherHandlers } = setup();
  const second = other.beginStartup();
  await other.verify({ startup: true });
  for (const listener of [...otherListeners]) listener('TOKEN_REFRESHED', { user: A, access_token: 'synthetic-a' });
  await otherHandlers.get('pageshow')({ persisted: false });
  await other.verify({ startup: true }); assert.equal(serverChecks(otherState), 2, 'an Auth event before the first pageshow is not carried over');
  second.end(); other.dispose(); auth.dispose();
});

test('opening: overlapping opt-in calls make one request, and a late result for the previous account is not used', async () => {
  const { auth, state } = setup();
  const opening = auth.beginStartup(), waiting = deferred(); state.userPromise = waiting.promise;
  const calls = Array.from({ length: 4 }, () => auth.verify({ startup: true })); await tick();
  waiting.resolve({ data: { user: A }, error: null }); state.userPromise = null;
  assert.deepEqual((await Promise.all(calls)).map(user => user.id), [A.id, A.id, A.id, A.id]); assert.equal(serverChecks(state), 1);
  opening.end();
  const second = auth.beginStartup(), late = deferred(); state.userPromise = late.promise;
  const pending = auth.verify({ startup: true }); await tick();
  state.change(B); state.userPromise = null;
  late.resolve({ data: { user: A }, error: null });
  await assert.rejects(pending, errorCode('request_cancelled'));
  const before = serverChecks(state);
  assert.equal((await auth.verify({ startup: true })).id, B.id); assert.equal(serverChecks(state), before + 1, 'the new account gets its own check');
  second.end(); auth.dispose();
});

// 2026-11-03 independent review of the page opening (P1–P8 probes): each case
// below fails when the matching guard is removed from platform-auth.js.
test('opening: a session token or user replaced without any event is never reused', async () => {
  const { auth, state } = setup();
  const opening = auth.beginStartup();
  await auth.verify({ startup: true }); assert.equal(serverChecks(state), 1);
  state.records.set(SESSION_KEY, JSON.stringify({ user: A, access_token: 'synthetic-rotated-silently' }));
  await auth.verify({ startup: true }); assert.equal(serverChecks(state), 2, 'a different stored token is checked');
  await auth.verify({ startup: true }); assert.equal(serverChecks(state), 2);
  state.records.set(SESSION_KEY, JSON.stringify({ user: B, access_token: 'synthetic-rotated-silently' }));
  const replaced = await auth.verify({ startup: true }).catch(error => error);
  assert.notEqual(replaced?.id, A.id, 'a stored session of another user never receives the earlier answer'); assert.equal(serverChecks(state), 3);
  opening.end(); auth.dispose();
});

test('opening: a caller that arrives after an account switch gets its own check while the old one is still running', async () => {
  const { auth, state } = setup();
  const opening = auth.beginStartup(), late = deferred(); state.userPromise = late.promise;
  const a = auth.verify({ startup: true }); await tick();
  state.change(B); state.userPromise = null;
  const b = auth.verify({ startup: true });
  const first = await Promise.race([b.then(user => user?.id), new Promise(resolve => setTimeout(() => resolve('waiting'), 300))]);
  assert.equal(first, B.id, 'B is answered without waiting for the stalled check of A');
  late.resolve({ data: { user: A }, error: null });
  await assert.rejects(a, errorCode('request_cancelled'));
  assert.equal(auth.getAccount()?.userId, B.id);
  opening.end(); auth.dispose();
});

test('opening: a check that crosses an Auth event and then the first pageshow is not kept', async () => {
  const { auth, state, pageHandlers, sdkListeners } = setup();
  const opening = auth.beginStartup(), late = deferred(); state.userPromise = late.promise;
  const running = auth.verify({ startup: true }); await tick();
  for (const listener of [...sdkListeners]) listener('TOKEN_REFRESHED', { user: A, access_token: 'synthetic-a' });
  await pageHandlers.get('pageshow')({ persisted: false });
  late.resolve({ data: { user: A }, error: null }); state.userPromise = null;
  await running.catch(() => {});
  const before = serverChecks(state);
  await auth.verify({ startup: true }); assert.equal(serverChecks(state), before + 1, 'the Auth event in between still discards it');
  opening.end(); auth.dispose();
});

test('opening: callers waiting on the running check share its answer even when the opening ends meanwhile', async () => {
  // CI life-discovery-automation (PR #183): a resumed page's BlogSync joined the shell's
  // running check, the shell then ended the opening, and the waiter sent a second request.
  const { auth, state } = setup();
  const opening = auth.beginStartup(), gate = deferred(); state.userPromise = gate.promise;
  const shell = auth.verify({ startup: true }); await tick();
  const engine = auth.verify({ startup: true }); await tick();
  gate.resolve({ data: { user: A }, error: null }); state.userPromise = null;
  assert.equal((await shell).id, A.id); opening.end();
  assert.equal((await engine).id, A.id); assert.equal(serverChecks(state), 1);
  await auth.verify({ startup: true }); assert.equal(serverChecks(state), 2, 'after the opening a new call checks');
  auth.dispose();
});

test('opening: past the first-screen limit an opt-in call checks with Auth again', async () => {
  const clock = { now: 1_000_000 };
  const { auth, state } = setup({ now: () => clock.now });
  const opening = auth.beginStartup();
  await auth.verify({ startup: true }); clock.now += STARTUP_LIMIT_MS - 1;
  await auth.verify({ startup: true }); assert.equal(serverChecks(state), 1);
  clock.now += 2;
  await auth.verify({ startup: true }); assert.equal(serverChecks(state), 2, 'a stalled opening no longer shares');
  await auth.verify({ startup: true }); assert.equal(serverChecks(state), 3);
  opening.end(); auth.dispose();
});

test('opening: a waiter whose shared check crossed an Auth event checks again instead of taking that answer', async () => {
  const { auth, state, sdkListeners } = setup();
  const opening = auth.beginStartup(), gate = deferred(); state.userPromise = gate.promise;
  const shell = auth.verify({ startup: true }); await tick();
  const engine = auth.verify({ startup: true }); await tick();
  for (const listener of [...sdkListeners]) listener('TOKEN_REFRESHED', { user: A, access_token: 'synthetic-a' });
  gate.resolve({ data: { user: A }, error: null }); state.userPromise = null;
  await shell.catch(() => {});
  assert.equal((await engine).id, A.id); assert.equal(serverChecks(state), 2, 'the event after joining discards the shared answer');
  opening.end(); auth.dispose();
});

test('opening: the bootstrap joins the shell check that the document\'s first pageshow crossed (warm open: one request)', async () => {
  const { auth, state, pageHandlers } = setup();
  const opening = auth.beginStartup(), gate = deferred(); state.userPromise = gate.promise;
  const shell = auth.verify({ startup: true }); await tick();
  await pageHandlers.get('pageshow')({ persisted: false });
  const bootstrap = auth.verify({ startup: true }); await tick();
  gate.resolve({ data: { user: A }, error: null }); state.userPromise = null;
  assert.equal((await shell).id, A.id); assert.equal((await bootstrap).id, A.id);
  await auth.verify({ startup: true }); assert.equal(serverChecks(state), 1);
  opening.end(); auth.dispose();
});

// 2026-11-04 (PR183 re-review M2): the stored session turns into another user with no Auth
// event, storage event or epoch change while callers wait on the running opening check.
// Neither the caller that started it nor a waiter receives the earlier user's answer.
test('opening: a user replaced without any event while callers wait on the running check is never answered with the earlier user', async () => {
  const { auth, state } = setup();
  const opening = auth.beginStartup(), late = deferred(); state.userPromise = late.promise;
  const started = auth.verify({ startup: true }); await tick();
  const waiter = auth.verify({ startup: true }); await tick();
  state.records.set(SESSION_KEY, JSON.stringify({ user: B, access_token: 'synthetic-silent-b' }));
  late.resolve({ data: { user: A }, error: null }); state.userPromise = null;
  const results = await Promise.allSettled([started, waiter]);
  for (const result of results) assert.notEqual(result.status === 'fulfilled' ? result.value?.id : null, A.id, 'no caller gets A after the silent switch');
  assert.notEqual(auth.getAccount()?.userId, A.id);
  opening.end(); auth.dispose();
});

// ── 2026-11-11 m1: the place the owner was at survives a login ──
test('m1: 일정 calendar units with their date, 백업·복원, the open blog post and the habit month survive login', () => {
  const kept = ['index.html?section=schedule&view=day&date=2026-10-29', 'index.html?section=schedule&view=week&date=2026-10-29',
    'index.html?section=schedule&view=month&date=2026-09-01', 'index.html?section=schedule&view=quarter&date=2026-04-01',
    'index.html?section=schedule&view=tools&date=2025-06-01', 'index.html?section=schedule&view=tools', 'index.html?section=tools&date=2025-06-01',
    'life.html?section=schedule&view=day&date=2024-02-29', 'index.html?section=manage&view=backup', 'index.html?section=schedule&view=annual-plan',
    'index.html?section=schedule&view=page&blog=photo.Ab_9-xyz', 'index.html?section=schedule&view=page&blog=draft.d1', 'index.html?section=schedule&view=page&blog=plain.p1',
    'index.html?section=schedule&view=page&blog=new', 'index.html?section=schedule&view=page&blog=profile', 'index.html?section=records&view=page',
    'habits.html?month=2026-09', 'habits.html', 'goals.html', 'workspace.html', 'workspace.html?section=manage'];
  for (const address of kept) assert.equal(safeNext(address + (address.includes('?') ? '&' : '?') + 'code=discarded&next=https://evil.invalid#access_token=hidden'), address, address);
  // Parameters come back in one fixed order whatever order they arrived in.
  assert.equal(safeNext('index.html?date=2026-10-29&view=day&section=schedule'), 'index.html?section=schedule&view=day&date=2026-10-29');
  assert.equal(safeNext('index.html?blog=photo.a1&view=page'), 'index.html?view=page&blog=photo.a1');
});

test('m1: a value outside its exact shape is left out, and nothing else is ever carried', () => {
  // date: a real civil day, only for a calendar unit.
  for (const date of ['2026-02-30', '2026-13-01', '2026-00-10', '1899-12-31', '2200-01-01', '2026-1-1', '20261029', '2026-10-29T00:00', '2026-10-29%0d%0aSet-Cookie:x', '2026-10-29<script>', '../2026-10-29', ''])
    assert.equal(safeNext('index.html?section=schedule&view=day&date=' + date), 'index.html?section=schedule&view=day', 'date ' + date);
  assert.equal(safeNext('index.html?section=records&view=sources&date=2026-10-29'), 'index.html?section=records&view=sources', 'date belongs to calendar units only');
  assert.equal(safeNext('index.html?section=manage&date=2026-10-29'), 'index.html?section=manage');
  assert.equal(safeNext('habits.html?date=2026-10-29'), 'habits.html');
  // blog: the app's own route shape, only with view=page; without it view=page is left out (except 자료's own page).
  for (const blog of ['photo.', 'photo.a/b', 'photo.a.b', 'photo.' + 'a'.repeat(129), 'post.a1', 'PHOTO.a1', 'photo.a1%26view%3Dsync', 'javascript:alert(1)', 'https://evil.invalid', 'photo.<script>', 'new2', ''])
    assert.equal(safeNext('index.html?section=schedule&view=page&blog=' + blog), 'index.html?section=schedule', 'blog ' + blog);
  assert.equal(safeNext('index.html?section=schedule&view=page'), 'index.html?section=schedule');
  assert.equal(safeNext('index.html?view=page'), 'index.html');
  assert.equal(safeNext('index.html?section=schedule&view=day&blog=photo.a1'), 'index.html?section=schedule&view=day', 'blog belongs to view=page only');
  assert.equal(safeNext('index.html?section=records&view=sources&blog=photo.a1'), 'index.html?section=records&view=sources');
  // month: YYYY-MM, on the habit page only.
  for (const month of ['2026-13', '2026-00', '2026-9', '202609', '1899-12', '2200-01', '2026-09-01', '2026-09%26next%3Dx', '<b>', ''])
    assert.equal(safeNext('habits.html?month=' + month), 'habits.html', 'month ' + month);
  assert.equal(safeNext('goals.html?month=2026-09'), 'goals.html');
  assert.equal(safeNext('index.html?month=2026-09'), 'index.html');
  // view: the listed names only.
  for (const view of ['day2', 'Day', 'backup/..', 'week%00', 'constructor', '__proto__', 'toString'])
    assert.equal(safeNext('index.html?section=schedule&view=' + view), 'index.html?section=schedule', 'view ' + view);
  // A repeated key: the first value is the one checked, and the one written.
  assert.equal(safeNext('index.html?view=day&view=evil&date=2026-10-29&date=x'), 'index.html?view=day&date=2026-10-29');
  assert.equal(safeNext('index.html?view=evil&view=day'), 'index.html');
});

test('m1: no open redirect and no injected parameter: other origins, schemes and unknown keys always come back as a page of this app', () => {
  const hostile = ['https://evil.invalid/index.html?section=schedule&view=day&date=2026-10-29', '//evil.invalid/index.html?view=day', '///evil.invalid/habits.html?month=2026-09',
    '\\\\evil.invalid\\index.html', '/\\evil.invalid/index.html', 'http://haedo.invalid/index.html?view=day', 'https://haedo.invalid:8443/index.html', 'https://haedo.invalid@evil.invalid/index.html',
    'https://user:pw@haedo.invalid/index.html?view=day', 'javascript:alert(document.domain)', 'JaVaScRiPt:alert(1)//index.html', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)',
    'blob:https://haedo.invalid/index.html', 'file:///index.html', 'about:blank', 'index.html/../../evil.html', 'login.html?next=https://evil.invalid', 'privacy.html', 'sw.js', 'assets/app.js',
    'index.htmlx', 'index.html%2F..%2Fevil.html', 'sub/index.html', '%2F%2Fevil.invalid', ' https://evil.invalid/index.html', '\thttps://evil.invalid/index.html', 'https:evil.invalid/index.html', 'ht\ntps://evil.invalid'];
  const allowed = /^(?:index|life|workspace|timeline|goals|habits)\.html(?:\?[A-Za-z0-9_.=&-]*)?$/;
  for (const value of hostile) {
    const next = safeNext(value);
    assert.match(next, allowed, JSON.stringify(value) + ' -> ' + next);
    assert.equal(new URL(next, 'https://app.invalid/dir/').origin, 'https://app.invalid', value);
    assert.ok(!/evil|script|javascript|alert/i.test(next), value + ' -> ' + next);
  }
  // Unknown keys and OAuth callback values never ride along, on any page.
  const extra = 'code=c&access_token=t&refresh_token=r&id_token=i&provider_token=p&error=e&error_description=d&next=https%3A%2F%2Fevil.invalid&redirect_to=//evil.invalid&returnTo=x&sourceId=s&q=private+words&__proto__=x&constructor=y';
  assert.equal(safeNext('index.html?' + extra + '&section=schedule&view=month&date=2026-09-01#access_token=hidden'), 'index.html?section=schedule&view=month&date=2026-09-01');
  for (const page of ['index.html', 'life.html', 'workspace.html', 'timeline.html', 'goals.html', 'habits.html']) assert.equal(safeNext(page + '?' + extra + '#frag'), page);
  // Non-string input.
  for (const value of [null, undefined, 0, '', {}, [], 42, true]) assert.match(safeNext(value), allowed);
});

// ── 2026-11-11 m2: an account check that never answers ──
const { VERIFY_LIMIT_MS } = require('../assets/platform-auth.js');
const never = () => new Promise(() => {});
test('m2: the limit is the first-screen budget, and the ordinary check still makes exactly one server request', async () => {
  assert.equal(VERIFY_LIMIT_MS, 10000); assert.equal(VERIFY_LIMIT_MS, STARTUP_LIMIT_MS);
  const { auth, state } = setup();
  await tick(); state.calls.length = 0; // the client's own first session read
  assert.equal((await auth.verify()).id, A.id);
  assert.deepEqual(state.calls, ['getSession', 'getUser', 'getSession']);
});

test('m2: a server check that never answers ends as network_error after the limit; the next check asks the server again', async () => {
  const { auth, state } = setup({ authOptions: { verifyLimit: 40 }, userPromise: never() });
  await tick(); state.calls.length = 0;
  const started = Date.now();
  await assert.rejects(auth.verify(), errorCode('network_error'));
  assert.ok(Date.now() - started >= 35 && Date.now() - started < 2000, 'gave up at the limit');
  assert.equal(auth.user, null, 'no account is opened by a check that did not answer');
  assert.deepEqual(state.calls, ['getSession', 'getUser']);
  // The connection is back: this check is a new request, not the stalled one.
  state.userPromise = null;
  assert.equal((await auth.verify()).id, A.id);
  assert.equal(state.calls.filter(call => call === 'getUser').length, 2);
  assert.equal(auth.user.id, A.id);
});

test('m2: a stalled stored-session read (a token refresh that hangs) is given up the same way', async () => {
  const { auth, state } = setup({ authOptions: { verifyLimit: 40 } });
  const sdk = auth.getClient().auth, read = sdk.getSession;
  await tick(); state.calls.length = 0;
  sdk.getSession = () => { state.calls.push('getSession'); return never(); };
  await assert.rejects(auth.verify(), errorCode('network_error'));
  assert.deepEqual(state.calls, ['getSession']);
  sdk.getSession = read;
  assert.equal((await auth.verify()).id, A.id);
});

test('m2: an answer that arrives after the limit follows the old guards: same session yes, a changed account never', async () => {
  const late = deferred();
  const { auth, state } = setup({ authOptions: { verifyLimit: 30 }, userPromise: late.promise });
  const seen = []; auth.onAccountChange(account => seen.push(account?.userId || null));
  await assert.rejects(auth.verify(), errorCode('network_error'));
  assert.equal(auth.user, null);
  late.resolve({ data: { user: A }, error: null }); await tick(); await tick();
  assert.equal(auth.user?.id, A.id, 'the same session: the late server answer is the verification');
  assert.deepEqual(seen, [A.id]);
  // Another account signed in while a check was out: its late answer is dropped.
  const other = deferred();
  const second = setup({ authOptions: { verifyLimit: 30 }, userPromise: other.promise });
  await assert.rejects(second.auth.verify(), errorCode('network_error'));
  second.state.change(B);
  other.resolve({ data: { user: A }, error: null }); await tick(); await tick();
  assert.equal(second.auth.user, null, 'a late answer never opens an account after the session changed');
});

test('m2: only the user check request is cut short; token refresh and data requests are passed through untouched', async () => {
  const { state, env } = setup({ authOptions: { verifyLimit: 40 } });
  const sdkFetch = state.options.global.fetch;
  assert.equal(typeof sdkFetch, 'function');
  const calls = [];
  env.fetch = (url, init) => { calls.push({ url, init }); return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))); };
  env.AbortController = AbortController;
  const plain = { method: 'GET', headers: {} };
  sdkFetch(config.url + '/auth/v1/user', plain).catch(() => {});
  const limited = calls.at(-1);
  assert.notEqual(limited.init, plain); assert.ok(limited.init.signal, 'the user check carries a signal');
  await assert.rejects(sdkFetch(config.url + '/auth/v1/user', { method: 'GET' }), error => error.name === 'AbortError');
  for (const [url, init] of [[config.url + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: '{}' }], [config.url + '/auth/v1/user', { method: 'PUT', body: '{}' }],
    [config.url + '/rest/v1/haedo_items', { method: 'GET' }], [config.url + '/auth/v1/user?x=1', { method: 'GET' }], ['https://elsewhere.invalid/auth/v1/user', { method: 'GET' }]]) {
    sdkFetch(url, init);
    assert.equal(calls.at(-1).init, init, url + ' ' + init.method + ' is passed as given');
    assert.equal(calls.at(-1).init.signal, undefined);
  }
  // A caller's own signal still aborts the limited request.
  const outer = new AbortController(), pending = sdkFetch(config.url + '/auth/v1/user', { method: 'GET', signal: outer.signal });
  outer.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
});

// 2026-11-11 review MAJOR-1: the limit timer was unref'd, so in Node the tests above that wait for the limit were
// cancelled whenever nothing else kept the event loop alive (pattern runs failed 5/5).
test('m2: the limit timer stays referenced (an awaited check is answered at the limit even when nothing else is pending)', async () => {
  let unrefs = 0, armed = 0;
  const timers = { setTimeout: (run, ms) => { armed++; const timer = setTimeout(run, ms), real = timer.unref.bind(timer); timer.unref = () => { unrefs++; return real(); }; return timer; }, clearTimeout };
  const { auth, state } = setup({ authOptions: { verifyLimit: 30, ...timers }, userPromise: never() });
  await assert.rejects(auth.verify(), errorCode('network_error'));
  assert.ok(armed >= 1, 'the injected timer is the one used'); assert.equal(unrefs, 0, 'never unref’d');
  // A check that answers clears its timer (nothing is left to hold a process).
  const cleared = []; state.userPromise = null;
  const second = setup({ authOptions: { verifyLimit: 30, setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: id => { cleared.push(id); clearTimeout(id); } } });
  assert.equal((await second.auth.verify()).id, A.id); assert.equal(cleared.length, 1);
});

// ── 2026-11-11 review MINOR-4·5: a slow connection is waited for longer; 다시 확인 does not join a stalled check ──
const { VERIFY_PATIENCE } = require('../assets/platform-auth.js');
// Timers that record the limit each check was given (and still run, on the real clock).
const recorded = asked => ({ setTimeout: (run, ms) => { asked.push(ms); return setTimeout(run, ms); }, clearTimeout });
const memoryStore = () => { const data = new Map(); return { data, getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) }; };
test('m2: each lapse in a row lengthens the next check (10 → 20 → 30 s, no further); a quick answer goes back to the first limit', async () => {
  assert.equal(VERIFY_PATIENCE, 3);
  const asked = [], { auth, state } = setup({ authOptions: { verifyLimit: 20, ...recorded(asked) }, userPromise: never() });
  for (let i = 0; i < 4; i++) await assert.rejects(auth.verify(), errorCode('network_error'));
  assert.deepEqual(asked, [20, 40, 60, 60]);
  state.userPromise = null;
  assert.equal((await auth.verify()).id, A.id); await tick();
  await auth.verify();
  assert.deepEqual(asked.slice(4), [60, 20], 'the check that was answered at once resets the level');
});

test('m2: a check that was answered, but slowly, keeps the limit it needed (the next check on that connection is not cut at 10 s)', async () => {
  let clock = 1000000;
  const asked = [], slow = deferred(), { auth, state } = setup({ now: () => clock, authOptions: { verifyLimit: 10000, ...recorded(asked) }, userPromise: slow.promise });
  const first = auth.verify(); await tick();
  clock += 12000; slow.resolve({ data: { user: A }, error: null });   // by this clock the answer took 12 s
  assert.equal((await first).id, A.id); await tick();
  state.userPromise = null; await auth.verify(); await tick();
  assert.deepEqual(asked, [10000, 20000], 'a 12 s answer needs the 20 s limit');
  // An answer within the first limit goes back to it; one that took 25 s keeps the longest.
  await auth.verify(); await tick();
  const slower = deferred(); state.userPromise = slower.promise;
  const third = auth.verify(); await tick(); clock += 25000; slower.resolve({ data: { user: A }, error: null }); await third; await tick();
  state.userPromise = null; await auth.verify();
  assert.deepEqual(asked.slice(2), [10000, 10000, 30000]);
});

test('m2: 다시 확인 (patient) waits the longest at once and does not join the check that has not been answered; that check’s late answer is not used', async () => {
  const asked = [], stalled = deferred(), { auth, state } = setup({ authOptions: { verifyLimit: 40, ...recorded(asked) }, userPromise: stalled.promise });
  const seen = []; auth.onAccountChange(account => seen.push(account?.userId || null));
  await tick(); state.calls.length = 0;
  const quiet = auth.verify(); quiet.catch(() => {}); await tick();
  assert.deepEqual(state.calls, ['getSession', 'getUser']);
  // The owner presses 다시 확인 while that check is out: a new server request, with the longest limit.
  state.userPromise = null;
  assert.equal((await auth.verify({ patient: true })).id, A.id);
  assert.equal(state.calls.filter(call => call === 'getUser').length, 2, 'a second request, not the stalled one');
  assert.deepEqual(asked, [40, 120]);
  assert.deepEqual(seen, [A.id]);
  // The abandoned check ends as cancelled, and its late answer changes nothing.
  stalled.resolve({ data: { user: B }, error: null });
  await assert.rejects(quiet, error => ['request_cancelled', 'network_error'].includes(error.code));
  await tick(); await tick();
  assert.equal(auth.user.id, A.id); assert.deepEqual(seen, [A.id]);
  // The same through the page opening (the shell's path).
  const opening = auth.beginStartup({ patient: true });
  assert.equal((await auth.verify({ startup: true, patient: true })).id, A.id); opening.end();
  assert.equal(asked.at(-1), 120);
});

test('m2: the level is kept for the tab, so a page that opens again after a lapse waits longer; expectSlow() asks for the longest', async () => {
  const sessionStorage = memoryStore(), asked = [];
  const first = setup({ sessionStorage, authOptions: { verifyLimit: 20, ...recorded(asked) }, userPromise: never() });
  await assert.rejects(first.auth.verify(), errorCode('network_error'));
  assert.deepEqual([...sessionStorage.data.values()], ['1']);
  // The page reloads: a new auth object in the same tab.
  const again = setup({ sessionStorage, authOptions: { verifyLimit: 20, ...recorded(asked) } });
  assert.equal((await again.auth.verify()).id, A.id); await tick();
  assert.deepEqual(asked, [20, 40]);
  assert.equal(sessionStorage.data.size, 0, 'an answer in time clears it');
  again.auth.expectSlow();
  assert.deepEqual([...sessionStorage.data.values()], ['2']);
  const third = setup({ sessionStorage, authOptions: { verifyLimit: 20, ...recorded(asked) } });
  await third.auth.verify();
  assert.equal(asked.at(-1), 60);
  // A value that is not a small whole number is ignored; storage that throws is tolerated.
  for (const junk of ['99', '-1', '1.5', 'x', '']) {
    const store = memoryStore(); store.data.set('caeyeon_life_platform_verify_lapses', junk); const seen = [];
    const { auth } = setup({ sessionStorage: store, authOptions: { verifyLimit: 20, ...recorded(seen) } });
    await auth.verify(); assert.ok([20, 60].includes(seen[0]), junk + ' → ' + seen[0]); assert.equal(seen[0], junk === '99' ? 60 : 20);
  }
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal((await setup({ sessionStorage: broken }).auth.verify()).id, A.id);
});

test('m2: the user check request is cut at the limit of the check that is out (20 s for a second try), and 다시 확인 cuts the earlier request at once', async () => {
  const asked = [], { auth, state, env } = setup({ authOptions: { verifyLimit: 30, ...recorded(asked) }, userPromise: never() });
  const sdkFetch = state.options.global.fetch, aborted = [];
  env.AbortController = AbortController;
  env.fetch = (url, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => { aborted.push(url); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }));
  await assert.rejects(auth.verify(), errorCode('network_error'));   // one lapse: the next check is allowed 60
  asked.length = 0;
  const second = auth.verify(); second.catch(() => {});
  await tick();
  const request = sdkFetch(config.url + '/auth/v1/user', { method: 'GET' }); request.catch(() => {});
  assert.deepEqual(asked, [60, 60], 'the check and its request share the longer limit');
  // 다시 확인 now: the request that is out is cut at once.
  state.userPromise = null;
  assert.equal(aborted.length, 0);
  const pressed = auth.verify({ patient: true });
  assert.equal(aborted.length, 1, 'the earlier request was aborted when 다시 확인 was pressed');
  assert.equal((await pressed).id, A.id);
  await assert.rejects(request, error => error.name === 'AbortError');
});

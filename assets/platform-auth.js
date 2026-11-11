/* One official SDK client owns Google PKCE, session rotation and cross-tab coordination. */
(function (root) {
  'use strict';
  const SESSION_KEY = 'caeyeon_life_platform_session';
  const LOGOUT_KEY = 'caeyeon_life_platform_logged_out';
  // Longest life of a page opening's shared account check (see beginStartup): about the first-screen budget.
  const STARTUP_LIMIT_MS = 10000;
  // Longest wait for one account check (2026-11-11 m2). A request that never answers (a connection that
  // accepts and then stalls) used to leave the first screen on "로그인을 확인하고 있습니다." with no way out.
  // The same 10 seconds as the opening above: past it the opening's result is not reused anyway, and a
  // normal check answers in well under 2 seconds even on a throttled phone (first screen 1.1–1.5 s).
  // The check then fails as network_error, like an unreachable server, and the caller's retry applies.
  const VERIFY_LIMIT_MS = 10000;
  // A check given up at the limit does not mean the account cannot be checked: the connection may only be
  // slow (2026-11-11 review: where every check answered after 12 s the app never opened any more, though it
  // used to open when one waited). Each lapse in a row lengthens the next check: 10 → 20 → 30 s. An answer
  // sets the level to what its own duration needed (a quick answer back to 10 s). A check the owner asked
  // for (다시 확인) waits the longest at once. The level is kept for the tab, so a plan page that opens again
  // after a lapse (it reloads) waits longer as well.
  const VERIFY_PATIENCE = 3;
  const LAPSE_KEY = 'caeyeon_life_platform_verify_lapses';
  const privatePages = new Set(['workspace.html', 'timeline.html', 'goals.html', 'habits.html', 'life.html']);
  const homeSections = new Set(['schedule', 'home', 'news', 'records', 'tools', 'manage']);
  const materialViews = new Set(['tools', 'annual-plan', 'naver-blog', 'external-discovery', 'interests', 'collection', 'topics', 'sources', 'source-trash', 'find', 'time', 'import', 'write', 'transfer', 'sync', 'activities', 'page', 'discover', 'related', 'reflection', 'books', 'workbench-backup', 'preservation', 'obsidian-update', 'blog', 'account-blog', 'public-cover', 'public-pages']);
  // 일정's calendar units and 백업·복원 are screens of their own with an address (2026-11-11 m1).
  const calendarViews = new Set(['tools', 'quarter', 'month', 'week', 'day']);
  const homeViews = new Set([...materialViews, ...calendarViews, 'backup']);
  // The values below are the only ones a return address may carry besides the names above; each has one exact shape.
  function civilDate(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof value === 'string' ? value : '');
    if (!m) return false;
    const year = +m[1], month = +m[2], day = +m[3];
    return year >= 1900 && year <= 2199 && month >= 1 && month <= 12 && day >= 1 && day <= new Date(year, month, 0).getDate();
  }
  const civilMonth = value => { const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(typeof value === 'string' ? value : ''); return !!m && +m[1] >= 1900 && +m[1] <= 2199; };
  // The open blog task as the app writes it (ui.js blogRoutePattern): new, profile, photo.<id>, plain.<id>, draft.<id>.
  const blogRoute = /^(?:new|profile|(?:photo|plain|draft)\.[A-Za-z0-9_-]{1,128})$/;
  // Allow-list only: a page of this app by exact name, and for each page the parameters it reads, each
  // checked against its exact shape. Anything else (another origin or scheme, an unknown key or value,
  // OAuth callback values, the fragment) is left out.
  function safeNext(value) {
    try {
      const url = new URL(value || 'index.html', 'https://haedo.invalid/');
      if (url.origin !== 'https://haedo.invalid' || !(url.pathname === '/index.html' || privatePages.has(url.pathname.slice(1)))) return 'index.html';
      const params = new URLSearchParams();
      if (url.pathname === '/index.html' || url.pathname === '/life.html') {
        const section = url.searchParams.get('section'), view = url.searchParams.get('view'), blog = url.searchParams.get('blog'), date = url.searchParams.get('date');
        if (homeSections.has(section)) params.set('section', section);
        if (view === 'page') {
          // The blog editor or reader is `page` with its post named. Without one `page` is only 자료's own
          // 선택 자료 페이지; under another section it would open that unrelated screen, so it is left out.
          if (typeof blog === 'string' && blogRoute.test(blog)) { params.set('view', 'page'); params.set('blog', blog); }
          else if (section === 'records') params.set('view', 'page');
        } else if (homeViews.has(view)) params.set('view', view);
        // 일정 reads `date` for its calendar units (and for the old section=tools address).
        if ((calendarViews.has(view) || section === 'tools') && civilDate(date)) params.set('date', date);
      }
      if (url.pathname === '/index.html' && url.searchParams.get('compose') === '1') params.set('compose', '1');
      if (url.pathname === '/workspace.html' && url.searchParams.get('section') === 'manage') params.set('section', 'manage');
      if (url.pathname === '/habits.html' && civilMonth(url.searchParams.get('month'))) params.set('month', url.searchParams.get('month'));
      if (url.pathname === '/timeline.html') {
        if (['records', 'map'].includes(url.searchParams.get('view'))) params.set('view', url.searchParams.get('view'));
        const doc = url.searchParams.get('doc');
        if (doc && /^[a-zA-Z0-9_-]{1,120}$/.test(doc)) params.set('doc', doc);
      }
      return url.pathname.slice(1) + (params.size ? '?' + params : '');
    } catch (_) { return 'index.html'; }
  }
  function validConfig(config, hostname) {
    if (!config || typeof config.key !== 'string' || !config.key) return false;
    try {
      const url = new URL(config.url);
      if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return false;
      const local = ['localhost', '127.0.0.1'].includes(hostname) && ['localhost', '127.0.0.1'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol);
      if (!(url.protocol === 'https:' && url.hostname.endsWith('.supabase.co')) && !local) return false;
      if (/^sb_secret_/i.test(config.key)) return false;
      if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.key)) {
        const parts = config.key.split('.'); if (parts.length !== 3 || !parts.every(Boolean)) return false;
        const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        if (JSON.parse(root.atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))).role !== 'anon') return false;
      }
      return true;
    } catch (_) { return false; }
  }
  function fault(code) {
    const messages = { auth_required: '로그인이 필요합니다.', request_cancelled: '계정이 변경되어 이전 요청을 중단했습니다.',
      network_error: '계정을 확인하려면 인터넷 연결이 필요합니다. 연결 후 다시 시도해 주세요.',
      invalid_config: '로그인 연결을 준비 중입니다.', invalid_request: '허용되지 않은 요청입니다.',
      auth_error: '로그인을 완료하지 못했습니다. 다시 시도해 주세요.', storage_unavailable: '로그아웃 상태를 저장하지 못했습니다. 이 페이지의 개인 화면은 닫았습니다.' };
    const error = new Error(messages[code] || messages.auth_error); error.code = code; return error;
  }
  function cleanError(error) {
    if (Object.prototype.hasOwnProperty.call(error || {}, 'code') && ['auth_required','request_cancelled','network_error','invalid_config','invalid_request','auth_error','storage_unavailable'].includes(error.code)) return fault(error.code);
    if (error?.name === 'AbortError') return fault('request_cancelled');
    if (error?.status === 401 || error?.status === 403 || ['session_not_found','user_not_found','bad_jwt','refresh_token_not_found','refresh_token_already_used'].includes(error?.code)) return fault('auth_required');
    if (error?.name === 'TypeError' || error?.name === 'AuthRetryableFetchError' || error?.status >= 500) return fault('network_error');
    return fault('auth_error');
  }
  function createAuth(env, options = {}) {
    const location = env.location || {}, document = env.document;
    const publicLifeHome = () => document?.body?.dataset?.lifeHome === 'true';
    const hasPrivateSurface = () => privatePages.has(location.pathname?.split('/').pop()) || publicLifeHome();
    const input = options.config || env.HAEDO_CONFIG;
    const sdkFactory = options.clientFactory || env.supabase?.createClient;
    const ready = validConfig(input, location.hostname) && typeof sdkFactory === 'function';
    const config = ready ? Object.freeze({ url: new URL(input.url).origin, key: input.key }) : null;
    let user = null, session = null, epoch = 0, observedId, closed = false, locallyBlocked = false, signingOut = false, logoutPromise = null, pendingUser = null, parked = false;
    // The page's opening (see beginStartup); null outside it.
    let startupScope = null;
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    // The page's timers; a host without any (an isolated script context) simply has no limit.
    const timers = typeof env.setTimeout === 'function' && typeof env.clearTimeout === 'function' ? env
      : typeof setTimeout === 'function' && typeof clearTimeout === 'function' ? { setTimeout, clearTimeout } : null;
    const setTimer = options.setTimeout || (timers ? (run, ms) => timers.setTimeout(run, ms) : () => null);
    const clearTimer = options.clearTimeout || (timers ? id => timers.clearTimeout(id) : () => {});
    const verifyLimit = Number.isFinite(options.verifyLimit) ? options.verifyLimit : VERIFY_LIMIT_MS;
    // Lapses in a row, 0 … VERIFY_PATIENCE - 1 (see VERIFY_PATIENCE).
    let lapses = 0;
    try { const kept = Number(env.sessionStorage?.getItem(LAPSE_KEY)); if (Number.isInteger(kept) && kept > 0) lapses = Math.min(kept, VERIFY_PATIENCE - 1); } catch (_) {}
    function setLapses(value) {
      lapses = Math.max(0, Math.min(value, VERIFY_PATIENCE - 1));
      try { if (lapses) env.sessionStorage?.setItem(LAPSE_KEY, String(lapses)); else env.sessionStorage?.removeItem(LAPSE_KEY); } catch (_) {}
    }
    // The limits of the checks that are out now; the user check request is cut at the longest of them.
    const limitsOut = [];
    // The user check requests that are out, and how many times the checks before were abandoned (다시 확인).
    const userChecks = new Set(); let abandoned = 0;
    // Advances on every SDK Auth event, cancellation and page lifecycle boundary.
    // A verification scope never reuses a result from an earlier generation.
    let authGeneration = 0;
    const listeners = new Set(), controllers = new Set();
    let backingStorage;
    try { backingStorage = options.storage || env.localStorage; } catch (_) {}
    function persistedBlock() {
      try { return backingStorage?.getItem(LOGOUT_KEY) === '1'; } catch (_) { return true; }
    }
    function blocked() { return locallyBlocked || persistedBlock(); }
    const sessionValue = key => key === SESSION_KEY || key === SESSION_KEY + '-user';
    const storage = backingStorage && {
      getItem(key) { return sessionValue(key) && blocked() && !(signingOut && persistedBlock()) ? null : backingStorage.getItem(key); },
      setItem(key, value) { if (!closed && !(sessionValue(key) && blocked())) return backingStorage.setItem(key, value); },
      removeItem(key) {
        // Another tab's explicit login cleared our logout marker. Throw before SDK
        // removal/broadcast so an old logout cannot erase that newer shared session.
        if (locallyBlocked && (key === SESSION_KEY || key.startsWith(SESSION_KEY + '-')) && !persistedBlock()) throw fault('request_cancelled');
        if (!closed) return backingStorage.removeItem(key);
      }
    };
    function account() { return !blocked() && user ? { projectUrl: config.url, userId: user.id, email: user.email || '' } : null; }
    function notify() {
      const current = account();
      for (const listener of [...listeners]) { try { listener(current && { ...current }); } catch (_) {} }
    }
    function event(name, code) {
      if (!document?.dispatchEvent || !env.Event) return;
      const value = new env.Event(name); if (code) value.code = code;
      document.dispatchEvent(value);
    }
    function hidePrivate() {
      document?.querySelectorAll?.('[data-private]').forEach(element => { element.hidden = true; });
      document?.querySelectorAll?.('dialog[open]').forEach(dialog => { dialog.close(); });
      if (privatePages.has(location.pathname?.split('/').pop())) document?.documentElement?.classList.add('auth-pending');
    }
    function cancel() { epoch++; authGeneration++; pendingUser = null; for (const controller of controllers) controller.abort(); controllers.clear(); }
    function invalidate() { cancel(); user = session = null; hidePrivate(); notify(); event('haedo:signed-out'); }
    function alive(expected, uid) {
      if (closed || expected !== epoch || (uid && user?.id !== uid)) throw fault('request_cancelled');
    }
    // The account check itself (GET /auth/v1/user) is given up after the limit, so a stalled request does
    // not keep the SDK's session lock and every later check behind it. Reading the user is safe to abandon
    // and repeat. Nothing else is limited here: a token refresh in particular is never cut short (its
    // answer may already have replaced the refresh token on the server).
    const userCheck = ready ? config.url + '/auth/v1/user' : null;
    function sdkFetch(input, init) {
      const url = typeof input === 'string' ? input : input?.url, method = String(init?.method || input?.method || 'GET').toUpperCase();
      if (url !== userCheck || method !== 'GET' || typeof env.AbortController !== 'function') return env.fetch(input, init);
      const controller = new env.AbortController(), outer = init?.signal;
      if (outer?.aborted) controller.abort(); else outer?.addEventListener?.('abort', () => controller.abort(), { once: true });
      const timer = setTimer(() => controller.abort(), Math.max(verifyLimit, ...limitsOut));
      userChecks.add(controller);
      return env.fetch(input, { ...init, signal: controller.signal }).finally(() => { clearTimer(timer); userChecks.delete(controller); });
    }
    // 다시 확인 while an earlier check has not been answered: that check is given up, so the new one is a new
    // request and does not wait behind it (the SDK runs one session operation at a time). Its answer, should
    // one still arrive, is not used (see checkWithServer).
    function abandonUserChecks() {
      abandoned += 1; pendingUser = null;
      for (const controller of [...userChecks]) controller.abort();
    }
    const client = ready ? sdkFactory(config.url, config.key, {
      auth: { flowType: 'pkce', storageKey: SESSION_KEY, detectSessionInUrl: true, ...(storage ? { storage } : {}) },
      global: { headers: { 'X-Client-Info': 'haedo-platform' }, ...(typeof env.fetch === 'function' ? { fetch: sdkFetch } : {}) }
    }) : null;
    const subscription = client?.auth.onAuthStateChange((name, next) => {
      // SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED, SIGNED_IN and any other event.
      authGeneration++;
      if (closed) return;
      const id = next?.user?.id || null;
      if (name === 'SIGNED_OUT' || (observedId !== undefined && observedId !== id) || (user && user.id !== id)) {
        invalidate();
        if (privatePages.has(location.pathname?.split('/').pop())) location.replace?.('login.html?next=' + encodeURIComponent(safeNext(location.pathname.split('/').pop() + (location.search || ''))));
      } else if (next && user?.id === id) session = next;
      observedId = id;
    }).data.subscription;
    function verifiedUser(current, expected) {
      const uid = current.user.id, token = current.access_token;
      if (typeof token !== 'string' || !token) return client.auth.getUser();
      if (pendingUser?.epoch === expected && pendingUser.uid === uid && pendingUser.token === token) return pendingUser.promise;
      // Share only an outstanding server check for this exact session. A later
      // verification still contacts Auth; no completed approval is cached.
      const pending = { epoch: expected, uid, token, promise: null };
      pending.promise = Promise.resolve().then(() => { alive(expected); return client.auth.getUser(); })
        .finally(() => { if (pendingUser === pending) pendingUser = null; });
      pendingUser = pending;
      return pending.promise;
    }
    // verify({ startup: true }) may reuse a server check finished during the
    // page's opening (beginStartup), under the same conditions as a W4 scope.
    // Without that option, or outside the opening, it always contacts Auth.
    // patient: true — the owner pressed 다시 확인: the longest limit at once, and an earlier unanswered check is given up.
    async function verify(options) {
      const patient = options?.patient === true;
      if (options?.startup === true && startupScope && !startupScope.ended) return startupScope.verify(patient ? { patient: true } : undefined);
      return serverVerify(patient);
    }
    // One account check, given up after its limit (see VERIFY_PATIENCE) as network_error. The limit covers the whole attempt
    // (reading the stored session, a token refresh it may need, the server check), so no stalled step keeps
    // the caller waiting. An answer that still arrives later is applied under the same guards as before
    // (same epoch, same session user): it never switches accounts and never reveals a screen by itself.
    async function serverVerify(patient = false) {
      if (!client || blocked()) return null;
      // A page in the back/forward cache starts no account check. The document
      // becomes visible before pageshow; a check begun then would be shared by
      // the resumed page's own verification and reveal it early.
      if (parked) throw fault('request_cancelled');
      if (patient) abandonUserChecks();
      const kept = abandoned;
      const limit = patient ? verifyLimit * VERIFY_PATIENCE : verifyLimit * Math.min(1 + lapses, VERIFY_PATIENCE);
      let timer = null, check = null;
      const startedAt = now();
      limitsOut.push(limit);
      const attempt = checkWithServer(value => { check = value; });
      // An answer (signed in or signed out) sets the level its own duration needed; a quick one resets it.
      attempt.then(() => setLapses(Math.ceil(Math.max(0, now() - startedAt) / verifyLimit) - 1), () => {});
      const lapse = new Promise((_, reject) => {
        timer = setTimer(() => {
          // A later attempt asks the server again instead of joining the request that stalled.
          if (check && pendingUser?.promise === check) pendingUser = null;
          // (A check given up for a newer one says nothing about the connection.)
          if (kept === abandoned) setLapses(lapses + 1);
          reject(fault('network_error'));
        }, limit);
        // The timer is never unref'd: whoever awaits this check must get its answer at the limit. In Node an
        // unref'd timer let the process finish with the check still pending (node:test then cancelled the
        // tests that wait for the limit). It also holds no process open needlessly: a check that settles
        // clears it below, and no unit file leaves one behind (measured 2026-11-11 with and without unref).
      });
      try { return await Promise.race([attempt, lapse]); }
      finally { clearTimer(timer); limitsOut.splice(limitsOut.indexOf(limit), 1); }
    }
    async function checkWithServer(began) {
      const expected = epoch, kept = abandoned;
      // A check given up for a newer one (다시 확인) never applies its late answer.
      const wanted = () => { alive(expected); if (kept !== abandoned) throw fault('request_cancelled'); };
      try {
        const current = await client.auth.getSession(); wanted();
        if (current.error) throw current.error;
        if (!current.data.session) { if (user) invalidate(); return null; }
        const uid = current.data.session.user.id;
        if (observedId === undefined) observedId = uid;
        const pending = verifiedUser(current.data.session, expected); began(pending);
        const verified = await pending; wanted();
        const latest = await client.auth.getSession(); wanted();
        if (latest.data?.session && latest.data.session.user.id !== uid) { invalidate(); throw fault('request_cancelled'); }
        if (verified.error) throw verified.error;
        if (latest.error) throw latest.error;
        if (blocked() || !latest.data.session || latest.data.session.user.id !== uid || !verified.data?.user || verified.data.user.id !== uid) throw fault('auth_required');
        user = verified.data.user; session = latest.data.session; notify(); return user;
      } catch (error) {
        alive(expected);
        const safe = cleanError(error);
        if (safe.code === 'auth_required') { invalidate(); return null; }
        throw safe;
      }
    }
    // W4 (2026-11-02 owner approval): one server check per bounded unit of work
    // (one sync engine operation) instead of one per remote call. A scope reuses
    // only its own completed verification, and only while nothing about the
    // account can have changed: the same epoch it opened in, no Auth event,
    // cancellation or pagehide/pageshow since (authGeneration), the same stored
    // session user and exact access token, not logged out and not parked in the
    // back/forward cache. There is no time window. Anything else, an ended
    // scope, a null or failed check, and fresh: true all run verify() as before,
    // so its errors, retries and late-response guards are unchanged.
    // The page's opening (2026-11-03, first screen delay): shell verification,
    // the foreground account bootstrap and the first mount are one unit of work.
    // Opt-in callers (verify({ startup: true }): the shell and AccountLibrary;
    // getStartupUser() reads; a W4 scope's first check) reuse its finished server
    // check under the W4 conditions above; writes, BlogSync and fresh: true checks
    // keep contacting Auth. The shell ends it once the screen is shown or the
    // opening fails, it lapses after STARTUP_LIMIT_MS, and a new opening starts empty.
    function beginStartup(options) {
      startupScope?.end();
      // A stalled bootstrap or mount cannot keep the opening's result alive: past the
      // first-screen budget every opt-in call checks with Auth again. On a slow connection the budget
      // grows with the check's own limit (see VERIFY_PATIENCE): a check that took longer than a fixed budget
      // is too old the moment it is answered, and everything that follows in the opening asks again.
      // Measured 2026-11-11 on a connection that answers in 12 s (tests/daily-entry-browser.cjs): after the
      // check that was given up, two answered checks before the screen (as an ordinary opening) with this, five with a fixed 10 s.
      const patience = options?.patient === true ? VERIFY_PATIENCE : Math.min(1 + lapses, VERIFY_PATIENCE);
      const scope = makeScope(scoped => serverVerify(scoped?.patient === true), now() + STARTUP_LIMIT_MS * patience);
      startupScope = scope;
      return Object.freeze({ end() { scope.end(); if (startupScope === scope) startupScope = null; } });
    }
    // A scope's first (non-fresh) check may use the page opening's finished check.
    function verificationScope() { return makeScope(options => verify(options?.fresh ? undefined : { startup: true })); }
    function makeScope(server, deadline = Infinity) {
      const opened = epoch; let ended = false, record = null, running = null, carried = null;
      // A generation as it stands after the opening's first-pageshow carry (only the opening carries).
      const carriedTo = generation => carried?.from === generation ? carried.to : generation;
      const current = generation => carriedTo(generation) === authGeneration;
      const reusable = () => !!record && !ended && !closed && !parked && !blocked() && opened === epoch &&
        record.generation === authGeneration && user?.id === record.uid && now() <= deadline;
      async function check(options = {}) {
        // Single flight: a non-fresh call joins this scope's check that is still running, but only one
        // begun in the same epoch and generation (never a check for an account or session since replaced).
        // Its answer is shared as an in-flight getUser() is (2026-10-24): it is used when nothing about the
        // account changed meanwhile, even if the scope ended while it ran.
        const flight = running;
        if (!options.fresh && flight && flight.epoch === epoch && current(flight.generation)) {
          let shared = null; try { shared = await flight.promise; } catch (_) { shared = null; }
          if (shared && !closed && !parked && !blocked() && flight.epoch === epoch && current(flight.generation) && user === shared) return shared;
        }
        if (!options.fresh && reusable()) {
          const current = await client.auth.getSession(), stored = current?.data?.session;
          if (!current.error && reusable() && typeof stored?.access_token === 'string' && stored.access_token === record.token && stored.user?.id === record.uid) return user;
        }
        record = null;
        const generation = authGeneration;
        const run = (async () => {
          const verified = await server(options);
          const token = session?.access_token, kept = carriedTo(generation);
          if (verified && !ended && !parked && opened === epoch && kept === authGeneration && user === verified &&
              typeof token === 'string' && token && session.user?.id === verified.id) record = { uid: verified.id, token, generation: kept };
          return verified;
        })();
        const entry = { promise: run, epoch, generation };
        if (!options.fresh) running = entry;
        try { return await run; } finally { if (running === entry) running = null; }
      }
      // Only the page opening uses carry: the document's own first pageshow (see pageshow).
      function carry(from, to) { carried = { from, to }; if (record?.generation === from) record.generation = to; }
      return Object.freeze({ verify: check, carry, end() { ended = true; record = null; running = null; }, get ended() { return ended; } });
    }
    // A page about to reload for 다시 확인 (the plan pages): its next check waits the longest.
    function expectSlow() { setLapses(VERIFY_PATIENCE - 1); }
    // How long the next check of a newly opened screen may take (ms), for the screen that waits for it.
    function verifyWait() { return verifyLimit * Math.min(1 + lapses, VERIFY_PATIENCE); }
    async function requireUser(options) {
      const verified = await verify(options);
      if (!verified) location.replace?.('login.html?next=' + encodeURIComponent(safeNext(location.pathname?.split('/').pop() + (location.search || ''))));
      return verified;
    }
    async function signOut() {
      if (logoutPromise) return logoutPromise;
      const pending = (async () => {
        invalidate(); locallyBlocked = true;
        let persistError = false;
        try { backingStorage?.setItem(LOGOUT_KEY, '1'); if (!backingStorage) persistError = true; } catch (_) { persistError = true; }
        // The SDK may read the old session for normal online server revocation, while
        // the app is already blocked and any refresh write is suppressed.
        signingOut = true;
        try { if (client) await client.auth.signOut({ scope: 'local' }); } catch (_) {}
        finally {
          signingOut = false;
          // An expired/offline refresh can return before SDK cleanup. Its supported
          // storage adapter now reports no session; a second public signOut clears
          // session/PKCE keys and broadcasts without requiring a network refresh.
          try { if (client && persistedBlock()) await client.auth.signOut({ scope: 'local' }); } catch (_) {}
        }
        location.replace?.('index.html');
        if (persistError) throw fault('storage_unavailable');
      })();
      logoutPromise = pending;
      try { return await pending; } finally { if (logoutPromise === pending) logoutPromise = null; }
    }
    async function login(next) {
      if (!client) throw fault('invalid_config');
      if (logoutPromise) await logoutPromise;
      if (locallyBlocked && !persistedBlock()) locallyBlocked = false;
      // Explicit Google login is the only operation that clears a local logout block.
      if (blocked()) {
        try { const result = await client.auth.signOut({ scope: 'local' }); if (result.error) throw result.error;
          backingStorage.removeItem(LOGOUT_KEY); locallyBlocked = false; } catch (error) { throw cleanError(error); }
      }
      const callback = new URL('login.html', location.href); callback.searchParams.set('next', safeNext(next));
      const result = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callback.href, scopes: 'openid email profile', queryParams: { prompt: 'select_account' } } });
      if (result.error) throw cleanError(result.error);
    }
    async function request(url, options = {}) {
      let target; try { target = new URL(url); } catch (_) { throw fault('invalid_request'); }
      if (!config || target.origin !== config.url || !target.pathname.startsWith('/rest/v1/') || target.username || target.password) throw fault('invalid_request');
      const uid = user?.id, expected = epoch;
      if (!uid || blocked()) throw fault('auth_required');
      const controller = new AbortController(); controllers.add(controller);
      const abort = () => controller.abort();
      if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, { once: true });
      try {
        const current = await client.auth.getSession(); alive(expected, uid);
        if (current.error || !current.data.session || current.data.session.user.id !== uid) throw fault('auth_required');
        const send = value => {
          const headers = new Headers(options.headers); headers.set('apikey', config.key); headers.set('Authorization', 'Bearer ' + value.access_token);
          return (options.fetch || env.fetch)(target.href, { ...options, headers, signal: controller.signal });
        };
        let response = await send(current.data.session); alive(expected, uid);
        if (response.status === 401) {
          const refresh = await client.auth.refreshSession(); alive(expected, uid);
          if (refresh.error || !refresh.data.session || refresh.data.session.user.id !== uid) throw fault('auth_required');
          response = await send(refresh.data.session); alive(expected, uid);
        }
        return response;
      } catch (error) { alive(expected, uid); throw cleanError(error); }
      finally { controllers.delete(controller); options.signal?.removeEventListener('abort', abort); }
    }
    function scrubCallback() {
      try {
        const url = new URL(location.href);
        for (const key of ['code','access_token','refresh_token','token','id_token','provider_token','provider_refresh_token','error','error_code','error_description','token_type','expires_in','expires_at']) url.searchParams.delete(key);
        if (/#.*(?:token|error|code)=/.test(url.hash)) url.hash = '';
        if (url.href !== location.href) env.history?.replaceState(null, '', url.pathname + url.search + url.hash);
      } catch (_) {}
    }
    const pagehide = value => {
      authGeneration++;
      if (value?.persisted) parked = true;
      if (!hasPrivateSurface()) return;
      // Let a live workspace capture its caret/scroll before hiding changes
      // layout and focus. The notification never cancels navigation or conceal.
      if (env.Event && document?.dispatchEvent) document.dispatchEvent(new env.Event('haedo:page-suspend'));
      cancel(); hidePrivate();
    };
    const storageChange = value => {
      // Another tab may have rotated, replaced or removed the shared session.
      if (value.key === null || value.key === LOGOUT_KEY || value.key?.startsWith(SESSION_KEY)) authGeneration++;
      if (value.key === LOGOUT_KEY && value.newValue === '1') invalidate();
    };
    let shown = false;
    const pageshow = async value => {
      const before = authGeneration;
      parked = false; authGeneration++;
      // The document's first pageshow (not from the back/forward cache) follows no
      // hidden period. W4 scopes still drop their results; the page opening keeps a
      // check that no other boundary followed (an Auth event in between still discards it).
      if (!value?.persisted && !shown) startupScope?.carry(before, authGeneration);
      shown = true;
      if (!value.persisted || !hasPrivateSurface()) return;
      // A workspace owns its unsaved editor and verifies the resumed account
      // before revealing it. Let that owner handle one verification, rather than
      // racing a second generic check against a retained editing session.
      if (env.Event && document?.dispatchEvent) {
        const resume = new env.Event('haedo:page-resume', { cancelable: true });
        if (document.dispatchEvent(resume) === false) return;
      }
      const previous = user?.id, expected = epoch;
      try {
        const current = await verify();
        if (closed || expected !== epoch) return;
        // The public home owns its guest and private states. Its shell remounts
        // only the verified account, never a cached personal DOM snapshot.
        if (publicLifeHome()) return;
        if (!current || current.id !== previous) { location.replace?.('login.html'); return; }
        document?.querySelectorAll?.('[data-private]').forEach(element => { element.hidden = false; });
        document?.documentElement?.classList.remove('auth-pending');
      } catch (error) { if (closed || expected !== epoch) return; hidePrivate(); event('haedo:auth-unavailable', cleanError(error).code); }
    };
    env.addEventListener?.('pagehide', pagehide); env.addEventListener?.('pageshow', pageshow); env.addEventListener?.('storage', storageChange);
    // Let SDK PKCE initialization read the callback first, then scrub success and failure URLs.
    if (client) client.auth.getSession().then(scrubCallback, scrubCallback); else scrubCallback();
    return Object.freeze({ ready, client, config, safeNext, verify, verificationScope, beginStartup, requireUser, expectSlow, verifyWait, login, signOut, request,
      get user() { return blocked() ? null : user; }, get session() { return blocked() ? null : session; }, get epoch() { return epoch; },
      getAccount: account, getClient: () => client,
      onAccountChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      dispose() { if (closed) return; closed = true; invalidate(); subscription?.unsubscribe(); listeners.clear(); env.removeEventListener?.('pagehide', pagehide); env.removeEventListener?.('pageshow', pageshow); env.removeEventListener?.('storage', storageChange); Promise.resolve(client?.auth.dispose?.()).catch(() => {}); }
    });
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { safeNext, validConfig, createAuth, SESSION_KEY, LOGOUT_KEY, STARTUP_LIMIT_MS, VERIFY_LIMIT_MS, VERIFY_PATIENCE }; return; }
  root.HaedoAuth = createAuth(root);
})(globalThis);

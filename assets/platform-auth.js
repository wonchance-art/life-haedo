/* One official SDK client owns Google PKCE, session rotation and cross-tab coordination. */
(function (root) {
  'use strict';
  const SESSION_KEY = 'caeyeon_life_platform_session';
  const LOGOUT_KEY = 'caeyeon_life_platform_logged_out';
  const privatePages = new Set(['workspace.html', 'timeline.html', 'goals.html', 'habits.html', 'life.html']);
  function safeNext(value) {
    try {
      const url = new URL(value || 'workspace.html', 'https://haedo.invalid/');
      if (url.origin !== 'https://haedo.invalid' || !privatePages.has(url.pathname.slice(1))) return 'workspace.html';
      const params = new URLSearchParams();
      if (url.pathname === '/timeline.html') {
        if (['records', 'map'].includes(url.searchParams.get('view'))) params.set('view', url.searchParams.get('view'));
        const doc = url.searchParams.get('doc');
        if (doc && /^[a-zA-Z0-9_-]{1,120}$/.test(doc)) params.set('doc', doc);
      }
      return url.pathname.slice(1) + (params.size ? '?' + params : '');
    } catch (_) { return 'workspace.html'; }
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
    const input = options.config || env.HAEDO_CONFIG;
    const sdkFactory = options.clientFactory || env.supabase?.createClient;
    const ready = validConfig(input, location.hostname) && typeof sdkFactory === 'function';
    const config = ready ? Object.freeze({ url: new URL(input.url).origin, key: input.key }) : null;
    let user = null, session = null, epoch = 0, observedId, closed = false, locallyBlocked = false, signingOut = false, logoutPromise = null;
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
    function cancel() { epoch++; for (const controller of controllers) controller.abort(); controllers.clear(); }
    function invalidate() { cancel(); user = session = null; hidePrivate(); notify(); event('haedo:signed-out'); }
    function alive(expected, uid) {
      if (closed || expected !== epoch || (uid && user?.id !== uid)) throw fault('request_cancelled');
    }
    const client = ready ? sdkFactory(config.url, config.key, {
      auth: { flowType: 'pkce', storageKey: SESSION_KEY, detectSessionInUrl: true, ...(storage ? { storage } : {}) },
      global: { headers: { 'X-Client-Info': 'haedo-platform' } }
    }) : null;
    const subscription = client?.auth.onAuthStateChange((name, next) => {
      if (closed) return;
      const id = next?.user?.id || null;
      if (name === 'SIGNED_OUT' || (observedId !== undefined && observedId !== id) || (user && user.id !== id)) {
        invalidate();
        if (privatePages.has(location.pathname?.split('/').pop())) location.replace?.('login.html?next=' + encodeURIComponent(safeNext(location.pathname.split('/').pop() + (location.search || ''))));
      } else if (next && user?.id === id) session = next;
      observedId = id;
    }).data.subscription;
    async function verify() {
      if (!client || blocked()) return null;
      const expected = epoch;
      try {
        const current = await client.auth.getSession(); alive(expected);
        if (current.error) throw current.error;
        if (!current.data.session) { if (user) invalidate(); return null; }
        const uid = current.data.session.user.id;
        if (observedId === undefined) observedId = uid;
        const verified = await client.auth.getUser(); alive(expected);
        const latest = await client.auth.getSession(); alive(expected);
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
    async function requireUser() {
      const verified = await verify();
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
    const pagehide = () => { if (privatePages.has(location.pathname?.split('/').pop())) hidePrivate(); };
    const storageChange = value => {
      if (value.key === LOGOUT_KEY && value.newValue === '1') invalidate();
    };
    const pageshow = async value => {
      if (!value.persisted || !privatePages.has(location.pathname?.split('/').pop())) return;
      const previous = user?.id, expected = epoch;
      try {
        const current = await verify();
        if (closed || expected !== epoch) return;
        if (!current || current.id !== previous) { location.replace?.('login.html'); return; }
        document?.querySelectorAll?.('[data-private]').forEach(element => { element.hidden = false; });
        document?.documentElement?.classList.remove('auth-pending');
      } catch (error) { if (closed || expected !== epoch) return; hidePrivate(); event('haedo:auth-unavailable', cleanError(error).code); }
    };
    env.addEventListener?.('pagehide', pagehide); env.addEventListener?.('pageshow', pageshow); env.addEventListener?.('storage', storageChange);
    // Let SDK PKCE initialization read the callback first, then scrub success and failure URLs.
    if (client) client.auth.getSession().then(scrubCallback, scrubCallback); else scrubCallback();
    return Object.freeze({ ready, client, config, safeNext, verify, requireUser, login, signOut, request,
      get user() { return blocked() ? null : user; }, get session() { return blocked() ? null : session; }, get epoch() { return epoch; },
      getAccount: account, getClient: () => client,
      onAccountChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      dispose() { if (closed) return; closed = true; invalidate(); subscription?.unsubscribe(); listeners.clear(); env.removeEventListener?.('pagehide', pagehide); env.removeEventListener?.('pageshow', pageshow); env.removeEventListener?.('storage', storageChange); Promise.resolve(client?.auth.dispose?.()).catch(() => {}); }
    });
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { safeNext, validConfig, createAuth, SESSION_KEY, LOGOUT_KEY }; return; }
  root.HaedoAuth = createAuth(root);
})(globalThis);

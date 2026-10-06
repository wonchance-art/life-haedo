/* Bind the Cloud life transport to the platform's single verified Auth client. */
(function (root) {
  "use strict";
  function fault(code) {
    const error = new Error(code);
    error.code = code;
    if (code === "request_cancelled") error.name = "AbortError";
    if (code === "auth_required") error.status = 401;
    return error;
  }
  function sameConfig(left, right) {
    try {
      return new URL(left.url).origin === new URL(right.url).origin &&
        left.key === right.key;
    } catch (_) { return false; }
  }
  function clientFactory(auth, options = {}) {
    const composition = options.scope === 'composition';
    const writing = options.scope === 'writing';
    if (options.scope !== undefined && !composition && !writing) throw fault('invalid_request');
    if (!auth?.ready || !auth.client || typeof auth.verify !== "function")
      throw fault("auth_required");
    return (url, key) => {
      if (!sameConfig({ url, key }, auth.config)) throw fault("project_mismatch");
      let closed = false, epoch = 0;
      const controllers = new Set();
      const subscriptions = new Set();
      let accountId = auth.user?.id || null;
      let observedAccount = !!accountId;
      const cancel = () => {
        epoch++;
        for (const controller of controllers) controller.abort();
        controllers.clear();
      };
      const subscription = auth.client.auth.onAuthStateChange((_event, session) => {
        const nextId = session?.user?.id || null;
        if (observedAccount && accountId !== nextId) cancel();
        observedAccount = true;
        accountId = nextId;
      }).data.subscription;
      const unlistenAccount = auth.onAccountChange?.(value => {
        const nextId = value?.userId || null;
        if (observedAccount && accountId !== nextId) cancel();
        observedAccount = true; accountId = nextId;
      });
      function alive(uid, expected = epoch) {
        if (closed || expected !== epoch) throw fault("request_cancelled");
        if (uid && (!auth.user || auth.user.id !== uid || accountId !== uid))
          throw fault("request_cancelled");
      }
      function query(builder, captured = { uid: auth.user?.id, epoch, authEpoch: auth.epoch }) {
        return new Proxy(builder, {
          get(target, property) {
            if (property === "then") return (resolve, reject) => {
              const request = (async () => {
                const { uid, epoch: expected, authEpoch } = captured;
                alive(undefined, expected);
                if (!uid) throw fault("auth_required");
                alive(uid, expected);
                if (authEpoch !== auth.epoch) throw fault("request_cancelled");
                const controller = new AbortController();
                controllers.add(controller);
                try {
                  const result = await target.abortSignal(controller.signal);
                  alive(uid, expected);
                  if (authEpoch !== auth.epoch) throw fault("request_cancelled");
                  return result;
                } finally { controllers.delete(controller); }
              })();
              return request.then(resolve, reject);
            };
            const value = Reflect.get(target, property, target);
            if (typeof value !== "function") return value;
            return (...args) => {
              alive();
              const result = value.apply(target, args);
              return result && typeof result.then === "function" ? query(result, captured) : result;
            };
          },
        });
      }
      const borrowedAuth = {
        async getUser() {
          alive();
          const expected = epoch, authEpoch = auth.epoch;
          const user = await auth.verify();
          alive(undefined, expected);
          if (authEpoch !== auth.epoch) throw fault("request_cancelled");
          if (user && auth.user?.id !== user.id) throw fault("request_cancelled");
          accountId = user?.id || null;
          observedAccount = true;
          return { data: { user }, error: user ? null : { name: "AuthSessionMissingError" } };
        },
        async signInWithPassword() { throw fault("auth_required"); },
        async signOut() {
          alive();
          cancel();
          await auth.signOut();
          return { error: null };
        },
        onAuthStateChange(listener) {
          alive();
          // Only the platform's server-verified account can authorize life data.
          // SDK session events alone are not a verification result.
          const subscription = typeof auth.onAccountChange === "function" ? {
            unsubscribe: auth.onAccountChange(value => {
              if (!closed) listener(value ? "SIGNED_IN" : "SIGNED_OUT", value ? { user: auth.user } : null);
            }),
          } : auth.client.auth.onAuthStateChange((event, session) => { if (!closed) listener(event, session); }).data.subscription;
          subscriptions.add(subscription);
          return { data: { subscription: { unsubscribe() { subscriptions.delete(subscription); subscription.unsubscribe(); } } } };
        },
        dispose() {
          if (closed) return;
          closed = true;
          cancel();
          subscription.unsubscribe();
          unlistenAccount?.();
          for (const item of subscriptions) item.unsubscribe();
          subscriptions.clear();
        },
      };
      return {
        auth: borrowedAuth,
        from(table) {
          alive();
          if (composition || writing || table !== "life_workspaces") throw fault("invalid_request");
          return query(auth.client.from(table));
        },
        rpc(name, args) {
          alive();
          const allowed = writing ? ['life_writing_draft_get', 'life_writing_draft_put', 'life_writing_draft_list'] :
            composition ? ['life_composition_get', 'life_composition_put'] : ['life_sync_put'];
          if (!allowed.includes(name)) throw fault("invalid_request");
          return query(auth.client.rpc(name, args));
        },
      };
    };
  }
  function loadConfig() {
    return root.HaedoAuth?.ready ? { ...root.HaedoAuth.config } : null;
  }
  function saveConfig(value) {
    if (value !== null && !sameConfig(value, loadConfig())) throw fault("project_mismatch");
    // Platform configuration and session are owned by HaedoAuth, never this adapter.
    return loadConfig();
  }
  function create(config, options = {}) {
    const auth = options.platformAuth || root.HaedoAuth;
    const remote = options.remote || root.HaedoLife?.Remote;
    if (typeof remote?.create !== "function") throw fault("dependency_unavailable");
    return remote.create(config, { ...options, clientFactory: clientFactory(auth) });
  }
  create.loadConfig = loadConfig;
  create.saveConfig = saveConfig;
  const api = Object.freeze({ create, loadConfig, saveConfig, clientFactory });
  root.HaedoLife = root.HaedoLife || {};
  root.HaedoLife.PlatformRemote = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);

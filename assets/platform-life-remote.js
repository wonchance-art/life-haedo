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
  function clientFactory(auth) {
    if (!auth?.ready || !auth.client || typeof auth.verify !== "function")
      throw fault("auth_required");
    return (url, key) => {
      if (!sameConfig({ url, key }, auth.config)) throw fault("project_mismatch");
      let closed = false;
      const controllers = new Set();
      let accountId = auth.user?.id || null;
      const cancel = () => {
        for (const controller of controllers) controller.abort();
        controllers.clear();
      };
      const subscription = auth.client.auth.onAuthStateChange((_event, session) => {
        const nextId = session?.user?.id || null;
        if (accountId !== nextId) cancel();
        accountId = nextId;
      }).data.subscription;
      function alive(uid) {
        if (closed) throw fault("request_cancelled");
        if (uid && (!auth.user || auth.user.id !== uid || accountId !== uid))
          throw fault("request_cancelled");
      }
      function query(builder) {
        return new Proxy(builder, {
          get(target, property) {
            if (property === "then") return (resolve, reject) => {
              const request = (async () => {
                alive();
                const uid = auth.user?.id;
                if (!uid) throw fault("auth_required");
                alive(uid);
                const controller = new AbortController();
                controllers.add(controller);
                try {
                  const result = await target.abortSignal(controller.signal);
                  alive(uid);
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
              return result && typeof result.then === "function" ? query(result) : result;
            };
          },
        });
      }
      const borrowedAuth = {
        async getUser() {
          alive();
          const user = await auth.verify();
          alive();
          if (user && auth.user?.id !== user.id) throw fault("request_cancelled");
          accountId = user?.id || null;
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
          return auth.client.auth.onAuthStateChange(listener);
        },
        dispose() {
          if (closed) return;
          closed = true;
          cancel();
          subscription.unsubscribe();
        },
      };
      return {
        auth: borrowedAuth,
        from(table) {
          alive();
          if (table !== "life_workspaces") throw fault("invalid_request");
          return query(auth.client.from(table));
        },
        rpc(name, args) {
          alive();
          if (name !== "life_sync_put") throw fault("invalid_request");
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

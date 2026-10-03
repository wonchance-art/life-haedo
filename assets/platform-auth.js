/* The SDK handles PKCE, token rotation and cross-tab session locks. */
(function (root) {
  const privatePages = new Set([
    "workspace.html",
    "timeline.html",
    "goals.html",
    "habits.html",
  ]);
  function safeNext(value) {
    try {
      const url = new URL(value || "workspace.html", "https://haedo.invalid/");
      if (
        url.origin !== "https://haedo.invalid" ||
        !privatePages.has(url.pathname.slice(1))
      )
        return "workspace.html";
      const params = new URLSearchParams();
      if (url.pathname === "/timeline.html") {
        if (["records", "map"].includes(url.searchParams.get("view")))
          params.set("view", url.searchParams.get("view"));
        const doc = url.searchParams.get("doc");
        if (doc && /^[a-zA-Z0-9_-]{1,120}$/.test(doc)) params.set("doc", doc);
      }
      return url.pathname.slice(1) + (params.size ? "?" + params : "");
    } catch (_) {
      return "workspace.html";
    }
  }
  function validConfig(config, hostname) {
    if (!config || typeof config.key !== "string" || !config.key) return false;
    try {
      const url = new URL(config.url);
      if (url.username || url.password || url.search || url.hash ||
        (url.pathname !== "/" && url.pathname !== "")) return false;
      const local =
        ["localhost", "127.0.0.1"].includes(hostname) &&
        ["localhost", "127.0.0.1"].includes(url.hostname) &&
        ["http:", "https:"].includes(url.protocol);
      if (
        !(url.protocol === "https:" && url.hostname.endsWith(".supabase.co")) &&
        !local
      )
        return false;
      if (config.key.startsWith("sb_secret_")) return false;
      if (!config.key.startsWith("sb_publishable_")) {
        const claims = JSON.parse(
          atob(config.key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
        );
        if (claims.role !== "anon") return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { safeNext, validConfig };
    return;
  }
  const config = root.HAEDO_CONFIG;
  const ready = validConfig(config, location.hostname);
  const client = ready
    ? root.supabase.createClient(config.url, config.key, {
        auth: {
          flowType: "pkce",
          storageKey: "caeyeon_life_platform_session",
          detectSessionInUrl: true,
        },
        global: { headers: { "X-Client-Info": "haedo-platform" } },
      })
    : null;
  let user = null,
    session = null;
  const auth = {
    ready,
    client,
    config,
    get user() {
      return user;
    },
    get session() {
      return session;
    },
    safeNext,
    async verify() {
      if (!client) return null;
      const { data: current, error: sessionError } =
        await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!current.session) {
        user = session = null;
        return null;
      }
      const uid = current.session.user.id;
      // An unverified local token is never sufficient to open personal records.
      const { data, error } = await client.auth.getUser();
      const { data: latest, error: latestError } = await client.auth.getSession();
      if (latestError) throw latestError;
      if (!latest.session || latest.session.user.id !== uid)
        throw new Error("계정이 변경됐습니다. 다시 로그인해 주세요.");
      if (error) {
        if (
          error.status === 401 ||
          error.status === 403 ||
          error.code === "session_not_found"
        ) {
          await client.auth.signOut({ scope: "local" });
          return null;
        }
        throw error;
      }
      if (!data.user || data.user.id !== uid)
        throw new Error("계정 확인 결과가 달라졌습니다. 다시 로그인해 주세요.");
      user = data.user;
      session = latest.session;
      return user;
    },
    async requireUser() {
      const verified = await auth.verify();
      if (!verified) {
        const current = safeNext(
          location.pathname.split("/").pop() + location.search,
        );
        location.replace("login.html?next=" + encodeURIComponent(current));
      }
      return verified;
    },
    async login(next) {
      if (!client) throw new Error("로그인 연결을 준비 중입니다.");
      const callback = new URL("login.html", location.href);
      callback.searchParams.set("next", safeNext(next));
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callback.href,
          scopes: "openid email profile",
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
    },
    async signOut() {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw error;
      user = session = null;
      location.replace("index.html");
    },
    async request(url, options = {}) {
      if (!user) throw new Error("로그인이 필요합니다.");
      const uid = user.id;
      const { data, error } = await client.auth.getSession();
      if (error || !data.session || data.session.user.id !== uid)
        throw new Error("다시 로그인해 주세요.");
      session = data.session;
      const send = () =>
        fetch(url, {
          ...options,
          headers: {
            ...options.headers,
            apikey: config.key,
            Authorization: "Bearer " + session.access_token,
          },
        });
      let response = await send();
      if (response.status === 401) {
        const refresh = await client.auth.refreshSession();
        if (refresh.error || !refresh.data.session)
          throw new Error("다시 로그인해 주세요.");
        session = refresh.data.session;
        if (session.user.id !== uid) throw new Error("계정이 변경됐습니다.");
        response = await send();
      }
      if (!user || user.id !== uid) throw new Error("계정이 변경됐습니다.");
      return response;
    },
  };
  function hidePrivate() {
    document.querySelectorAll("[data-private]").forEach((el) => {
      el.hidden = true;
    });
    document
      .querySelectorAll("dialog[open]")
      .forEach((dialog) => dialog.close());
    if (location.pathname.endsWith("/timeline.html"))
      document.documentElement.classList.add("auth-pending");
  }
  client?.auth.onAuthStateChange((event, next) => {
    if (
      user &&
      (event === "SIGNED_OUT" || (next && next.user.id !== user.id))
    ) {
      user = session = null;
      hidePrivate();
      document.dispatchEvent(new Event("haedo:signed-out"));
      if (privatePages.has(location.pathname.split("/").pop()))
        location.replace("login.html");
    } else if (next && user) session = next;
  });
  addEventListener("pagehide", () => {
    if (!privatePages.has(location.pathname.split("/").pop())) return;
    hidePrivate();
  });
  addEventListener("pageshow", async (event) => {
    if (
      !event.persisted ||
      !privatePages.has(location.pathname.split("/").pop())
    )
      return;
    const previous = user?.id;
    try {
      const current = await auth.verify();
      if (!current || current.id !== previous) {
        location.replace("login.html");
        return;
      }
      document.querySelectorAll("[data-private]").forEach((el) => {
        el.hidden = false;
      });
      document.documentElement.classList.remove("auth-pending");
    } catch (_) {
      location.replace("login.html");
    }
  });
  root.HaedoAuth = auth;
})(globalThis);

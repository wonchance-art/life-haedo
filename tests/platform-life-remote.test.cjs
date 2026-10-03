const test = require("node:test");
const assert = require("node:assert/strict");
const bridge = require("../assets/platform-life-remote.js");
const config = { url: "https://fixture.supabase.co", key: "sb_publishable_fixture" };
function setup() {
  const listeners = new Set();
  let calls = 0, verified = 0, disposed = 0, signal, pending;
  const auth = {
    ready: true, config, user: { id: "A" },
    async verify() { verified++; return auth.user; },
    async signOut() { auth.user = null; change(null); },
    client: {
      auth: {
        onAuthStateChange(callback) {
          listeners.add(callback);
          return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
        },
        dispose() { disposed++; },
        stopAutoRefresh() { disposed++; },
      },
      from() { calls++; return builder(); },
      rpc() { calls++; return builder(); },
    },
  };
  function change(user) {
    auth.user = user;
    for (const callback of listeners) callback(user ? "SIGNED_IN" : "SIGNED_OUT", user ? { user } : null);
  }
  function builder() {
    return {
      select() { return this; }, order() { return this; }, eq() { return this; },
      maybeSingle() { return this; },
      abortSignal(value) { signal = value; return this; },
      then(resolve, reject) {
        return (pending || Promise.resolve({ data: [], error: null })).then(resolve, reject);
      },
    };
  }
  const client = bridge.clientFactory(auth)(config.url, config.key);
  return { auth, client, change, setPending(value) { pending = value; },
    get signal() { return signal; }, get calls() { return calls; },
    get verified() { return verified; }, get disposed() { return disposed; },
    get listeners() { return listeners.size; } };
}
test("life transport borrows the platform client and verifies the account on the server", async () => {
  const s = setup();
  assert.equal((await s.client.auth.getUser()).data.user.id, "A");
  assert.equal(s.verified, 1);
  assert.deepEqual(await s.client.from("life_workspaces").select("id").order("updated_at"), { data: [], error: null });
  assert.equal(s.calls, 1);
  s.client.auth.dispose();
});
test("separate projects, keys and password login cannot override the platform account", async () => {
  const s = setup();
  assert.throws(() => bridge.clientFactory(s.auth)("https://other.supabase.co", config.key), { code: "project_mismatch" });
  assert.throws(() => bridge.clientFactory(s.auth)(config.url, "sb_publishable_other"), { code: "project_mismatch" });
  await assert.rejects(s.client.auth.signInWithPassword(), { code: "auth_required" });
  assert.equal(s.auth.user.id, "A");
  s.client.auth.dispose();
});
test("unverified and signed-out users cannot send a query", async () => {
  assert.throws(() => bridge.clientFactory({ ready: false }), { code: "auth_required" });
  const s = setup(); s.change(null);
  assert.equal((await s.client.auth.getUser()).data.user, null);
  await assert.rejects(Promise.resolve(s.client.from("life_workspaces").select("id")), { code: "auth_required" });
  s.client.auth.dispose();
});
test("changing account cancels the old query and rejects its late response", async () => {
  const s = setup(); let finish;
  s.setPending(new Promise(resolve => { finish = resolve; }));
  const read = Promise.resolve(s.client.from("life_workspaces").select("id").eq("id", "fixture").maybeSingle());
  await new Promise(resolve => setImmediate(resolve));
  const rejected = assert.rejects(read, { code: "request_cancelled" });
  s.change({ id: "B" });
  assert.equal(s.signal.aborted, true);
  finish({ data: { id: "old account" }, error: null });
  await rejected;
  s.client.auth.dispose();
});
test("disposing life transport aborts its queries without disposing the shared session", async () => {
  const s = setup(); let finish;
  s.setPending(new Promise(resolve => { finish = resolve; }));
  const write = Promise.resolve(s.client.rpc("life_sync_put", {}));
  await new Promise(resolve => setImmediate(resolve));
  const rejected = assert.rejects(write, { code: "request_cancelled" });
  s.client.auth.dispose();
  assert.equal(s.signal.aborted, true);
  assert.equal(s.disposed, 0);
  assert.equal(s.listeners, 0);
  assert.equal(s.auth.user.id, "A");
  finish({ data: { status: "stored" }, error: null });
  await rejected;
});
test("logout uses the platform logout and the bridge only exposes the life API", async () => {
  const s = setup();
  assert.throws(() => s.client.from("charts"), { code: "invalid_request" });
  assert.throws(() => s.client.rpc("other_rpc", {}), { code: "invalid_request" });
  assert.deepEqual(await s.client.auth.signOut(), { error: null });
  assert.equal(s.auth.user, null);
  s.client.auth.dispose();
});
test("the Cloud Remote factory receives the borrowed client without starting another SDK", async () => {
  const s = setup(); let got;
  const remote = { create(input, options) { got = options.clientFactory(input.url, input.key); return got; } };
  const adapter = bridge.create(config, { platformAuth: s.auth, remote });
  assert.equal(adapter, got);
  assert.equal((await adapter.auth.getUser()).data.user.id, "A");
  adapter.auth.dispose(); s.client.auth.dispose();
});

test("borrowed official SDK sends the same verified token to life SELECT and RPC", async () => {
  const vm = require("node:vm"), fs = require("node:fs");
  const context = { fetch, Headers, Request, Response, URL, crypto, TextEncoder,
    WebSocket, AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
    atob, btoa, console };
  vm.runInNewContext(fs.readFileSync(require.resolve("../vendor/supabase.js"), "utf8"), context);
  const { createClient } = context.supabase;
  const user = { id: "6f8e1779-3972-4343-84ee-d1f45e123008", email: "anonymous@example.invalid" };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = ["fixture", Buffer.from(JSON.stringify({ sub: user.id, exp })).toString("base64url"), "fixture"].join(".");
  const memory = new Map([["shared-test-session", JSON.stringify({ access_token: token,
    refresh_token: "anonymous-refresh-fixture", expires_at: exp, expires_in: 3600, token_type: "bearer", user })]]);
  const requests = [];
  const client = createClient(config.url, config.key, {
    auth: { storageKey: "shared-test-session", persistSession: true, autoRefreshToken: false,
      detectSessionInUrl: false, storage: {
        getItem: key => memory.get(key) || null,
        setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key),
      } },
    global: { fetch: async (url, options) => {
      const path = new URL(url).pathname;
      assert.equal(new Headers(options.headers).get("authorization"), "Bearer " + token);
      requests.push(path);
      const value = path === "/auth/v1/user" ? user :
        path === "/rest/v1/rpc/life_sync_put" ? { status: "stored", revision: 1 } : [];
      return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
    } },
  });
  const auth = { ready: true, config, client, user: null,
    async verify() { const result = await client.auth.getUser(); if (result.error) throw result.error;
      auth.user = result.data.user; return auth.user; } };
  const borrowed = bridge.clientFactory(auth)(config.url, config.key);
  try {
    assert.equal((await borrowed.auth.getUser()).data.user.id, user.id);
    assert.equal((await borrowed.from("life_workspaces").select("id").order("updated_at")).data.length, 0);
    const written = (await borrowed.rpc("life_sync_put", { p_expected_revision: 0 })).data;
    assert.equal(written.status, "stored"); assert.equal(written.revision, 1);
    borrowed.auth.dispose();
    assert.equal((await client.auth.getSession()).data.session.user.id, user.id);
    assert.deepEqual(requests, ["/auth/v1/user", "/rest/v1/life_workspaces", "/rest/v1/rpc/life_sync_put"]);
  } finally {
    borrowed.auth.dispose();
    if (client.auth.dispose) await client.auth.dispose(); else await client.auth.stopAutoRefresh();
  }
});

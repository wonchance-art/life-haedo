const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readFileSync } = require("node:fs");
const model = require("../assets/platform-data.js");
const { safeNext, validConfig } = require("../assets/platform-auth.js");
const data = require("../assets/data.js");
const sync = require("../assets/sync.js");
function storage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    key: (i) => [...values.keys()][i],
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
    values,
  };
}
const doc = (n) => ({
  profile: { name: "Anonymous timeline", birth: "1990-01" },
  events: Array.from({ length: n }, (_, i) => ({
    date: "2020-01",
    title: "Anonymous " + i,
  })),
  spans: [],
});
test("private return destinations are restricted to known local feature routes", () => {
  for (const next of [
    "https://evil.invalid/workspace.html",
    "//evil.invalid/",
    "javascript:alert(1)",
    "index.html",
    "goals.html?token=secret",
    "workspace.html#secret",
  ])
    assert.equal(
      safeNext(next),
      next.startsWith("goals") ? "goals.html" : "workspace.html",
    );
  assert.equal(
    safeNext("timeline.html?view=records&doc=d_test&access_token=hidden"),
    "timeline.html?view=records&doc=d_test",
  );
  assert.equal(
    safeNext("timeline.html?doc=%3Cscript%3E&view=unknown"),
    "timeline.html",
  );
});
test("public configuration rejects server credentials and non-Supabase production origins", () => {
  assert.ok(
    validConfig(
      { url: "https://test.supabase.co", key: "sb_publishable_fixture" },
      "example.com",
    ),
  );
  assert.ok(
    !validConfig(
      { url: "https://test.supabase.co", key: "sb_secret_fixture" },
      "example.com",
    ),
  );
  assert.ok(
    !validConfig(
      { url: "http://127.0.0.1:4180", key: "sb_publishable_fixture" },
      "example.com",
    ),
  );
  assert.ok(
    validConfig(
      { url: "http://127.0.0.1:4180", key: "sb_publishable_fixture" },
      "127.0.0.1",
    ),
  );
  assert.ok(
    !validConfig(
      {
        url: "https://supabase.co.evil.invalid",
        key: "sb_publishable_fixture",
      },
      "example.com",
    ),
  );
});
test("linking 80 legacy records makes account copies and preserves the source bytes", () => {
  const s = storage(),
    original = JSON.stringify(doc(80));
  s.setItem(
    "caeyeon_life_registry",
    JSON.stringify({ docs: [{ id: "old", name: "Old" }], current: "old" }),
  );
  s.setItem("caeyeon_life_doc_old", original);
  s.setItem("caeyeon_life_cloud", '{"key":"private-fixture-not-for-export"}');
  const reg = s.getItem("caeyeon_life_registry"),
    backup = model.legacyBackup(s);
  const imported = model.importDocs(s, "account-A", backup, () => "copy", true);
  assert.equal(imported[0].data.events.length, 80);
  assert.equal(s.getItem("caeyeon_life_doc_old"), original);
  assert.equal(s.getItem("caeyeon_life_registry"), reg);
  assert.equal(model.registry(s, "account-A").docs[0].legacySource, "old");
  assert.equal(model.registry(s, "account-B").docs.length, 0);
  assert.ok(!JSON.stringify(backup).includes("private-fixture"));
});
test("damaged legacy registries and orphan documents remain recoverable", () => {
  const s = storage();
  s.setItem("caeyeon_life_registry", "invalid");
  s.setItem("caeyeon_life_doc_orphan", JSON.stringify(doc(2)));
  s.setItem("caeyeon_life_doc_damaged", "{");
  const backup = model.legacyBackup(s);
  assert.equal(backup.docs[0].data.events.length, 2);
  assert.equal(backup.raw.length, 2);
  assert.equal(s.getItem("caeyeon_life_registry"), "invalid");
});
test("invalid imports fail before changing account or legacy storage", () => {
  const s = storage();
  s.setItem("caeyeon_life_v2", JSON.stringify(doc(80)));
  const before = [...s.values];
  assert.throws(() =>
    model.importDocs(s, "A", { docs: [{ data: doc(1) }, { data: null }] }),
  );
  assert.deepEqual([...s.values], before);
});
test("failed registry commit preserves originals and leaves copies recoverable", () => {
  const s = storage();
  s.setItem("caeyeon_life_doc_old", JSON.stringify(doc(80)));
  const originalSet = s.setItem;
  s.setItem = (key, value) => {
    if (key === model.keys("A").registry) throw new Error("quota");
    originalSet(key, value);
  };
  assert.throws(() =>
    model.importDocs(s, "A", model.legacyBackup(s), () => "copy"),
  );
  assert.equal(JSON.parse(s.getItem("caeyeon_life_doc_old")).events.length, 80);
  assert.equal(
    JSON.parse(s.getItem(model.keys("A").docs + "copy")).events.length,
    80,
  );
});
test("weekday streaks skip rest days and do not lose yesterday before today is completed", () => {
  const habit = {
    title: "Anonymous",
    created: "2026-09-24",
    days: [1, 2, 3, 4, 5],
    checks: ["2026-09-24", "2026-09-25", "2026-09-28"],
  };
  assert.equal(model.streak(habit, "2026-09-29"), 3);
  assert.equal(model.streak(habit, "2026-09-30"), 0);
  assert.equal(model.streak(habit, "2026-09-27"), 2);
});
test("habit completion respects its start, schedule, future dates and leap-day boundaries", () => {
  const habit = {
    title: "Anonymous",
    created: "2024-02-28",
    days: [0, 1, 2, 3, 4, 5, 6],
    checks: [],
  };
  assert.equal(model.addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(model.addDays("2024-02-29", 1), "2024-03-01");
  const next = model.toggleHabit(habit, "2024-02-29", "2024-03-01");
  assert.deepEqual(next.checks, ["2024-02-29"]);
  assert.deepEqual(habit.checks, []);
  assert.deepEqual(
    model.toggleHabit(next, "2024-02-29", "2024-03-01").checks,
    [],
  );
  assert.throws(() => model.toggleHabit(habit, "2024-03-02", "2024-03-01"));
  assert.throws(() => model.toggleHabit(habit, "2024-02-27", "2024-03-01"));
  assert.throws(() =>
    model.toggleHabit({ ...habit, days: [1] }, "2024-02-29", "2024-03-01"),
  );
});
function storeHarness(request) {
  const listeners = {},
    local = storage(),
    auth = {
      user: { id: "A" },
      config: { url: "https://test.supabase.co" },
      request,
    };
  const context = {
    HaedoPlatformData: model,
    HaedoAuth: auth,
    HaedoData: data,
    HaedoSync: sync,
    localStorage: local,
    document: {
      hidden: false,
      addEventListener: (name, fn) => (listeners[name] = fn),
      dispatchEvent: () => {},
    },
    addEventListener: () => {},
    setTimeout,
    clearTimeout,
    Date,
    Event,
    structuredClone,
  };
  vm.runInNewContext(
    readFileSync(require.resolve("../assets/platform-store.js"), "utf8"),
    context,
  );
  return {
    store: context.HaedoPlatformStore.init("A"),
    auth,
    local,
    logout: () => listeners["haedo:signed-out"](),
  };
}
test("editing an item while a write is in flight preserves both the latest data and server revision", async () => {
  let release,
    started,
    stamp = null,
    body,
    calls = 0;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const start = new Promise((resolve) => {
    started = resolve;
  });
  const h = storeHarness(async (_url, options) => {
    if (!options.method)
      return new Response(JSON.stringify(stamp ? [{ updated_at: stamp }] : []));
    body = JSON.parse(options.body);
    calls++;
    if (calls === 1) {
      started();
      await held;
    }
    stamp = "2026-10-02T00:00:0" + calls + ".000Z";
    return new Response(JSON.stringify([{ updated_at: stamp }]), {
      status: 200,
    });
  });
  const id = h.store.change(null, "goal", {
    title: "Anonymous",
    target: "",
    progress: 10,
  });
  const first = h.store.flush();
  await start;
  h.store.change(id, "goal", { title: "Anonymous", target: "", progress: 30 });
  release();
  await first;
  await h.store.flush();
  assert.equal(h.store.items[0].data.progress, 30);
  assert.equal(h.store.items[0].state, "ok");
  assert.equal(h.store.items[0].syncedAt, stamp);
  assert.equal((Array.isArray(body) ? body[0] : body).data.progress, 30);
  h.logout();
});
test("signing out during a pull never writes data into another account", async () => {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const h = storeHarness(async () => {
    await held;
    return new Response(
      JSON.stringify([
        {
          id: "remote",
          kind: "goal",
          data: { title: "Anonymous", progress: 0 },
          updated_at: "stamp",
        },
      ]),
    );
  });
  const before = [...h.local.values],
    pull = h.store.pull();
  h.auth.user = null;
  h.logout();
  release();
  await assert.rejects(pull);
  assert.deepEqual([...h.local.values], before);
});
test("conflicting goal changes stay local until a backed-up copy is chosen", async () => {
  let writes = 0;
  const h = storeHarness(async (_url, options) => {
    if (options.method) writes++;
    return new Response(JSON.stringify([{ updated_at: "other-device" }]));
  });
  h.store.change(null, "goal", {
    title: "Anonymous",
    target: "",
    progress: 10,
  });
  await h.store.flush();
  assert.equal(h.store.items[0].state, "conflict");
  assert.equal(writes, 0);
  h.logout();
});
test("uploading a document preserves edits and new registry entries made while the request is in flight", async () => {
  let release, started;
  const held = new Promise((resolve) => {
      release = resolve;
    }),
    start = new Promise((resolve) => {
      started = resolve;
    });
  const h = storeHarness(async (_url, options) => {
    if (!options.method) return new Response("[]");
    started();
    await held;
    return new Response(
      JSON.stringify([{ updated_at: "2026-10-02T00:00:01.000Z" }]),
    );
  });
  model.importDocs(h.local, "A", doc(1), () => "first");
  const uploading = h.store.uploadDocuments(["first"]);
  await start;
  model.importDocs(h.local, "A", doc(2), () => "second");
  const reg = model.registry(h.local, "A");
  reg.docs.find((d) => d.id === "first").updated = "2026-10-02T00:00:02.000Z";
  h.local.setItem(model.keys("A").registry, JSON.stringify(reg));
  h.local.setItem(model.keys("A").docs + "first", JSON.stringify(doc(3)));
  release();
  await uploading;
  const latest = model.registry(h.local, "A");
  assert.equal(latest.docs.length, 2);
  assert.equal(latest.current, "second");
  const first = latest.docs.find((d) => d.id === "first");
  assert.equal(first.syncedAt, "2026-10-02T00:00:01.000Z");
  assert.equal(first.updated, "2026-10-02T00:00:02.000Z");
  assert.equal(
    JSON.parse(h.local.getItem(model.keys("A").docs + "first")).events.length,
    3,
  );
  h.logout();
});
test("signing out closes an open private form before navigating away", async () => {
  let changed;
  const user = { id: "A" },
    session = { user, access_token: "anonymous-fixture" };
  const privateArea = { hidden: false },
    dialog = {
      open: true,
      close() {
        this.open = false;
      },
    };
  const location = {
    hostname: "127.0.0.1",
    pathname: "/workspace.html",
    search: "",
    replace() {
      assert.equal(privateArea.hidden, true);
      assert.equal(dialog.open, false);
    },
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session } }),
      getUser: async () => ({ data: { user } }),
      onAuthStateChange: (fn) => {
        changed = fn;
      },
    },
  };
  const context = {
    HAEDO_CONFIG: {
      url: "https://test.supabase.co",
      key: "sb_publishable_fixture",
    },
    supabase: { createClient: () => client },
    location,
    URL,
    URLSearchParams,
    Event,
    document: {
      querySelectorAll: (selector) =>
        selector === "[data-private]" ? [privateArea] : [dialog],
      dispatchEvent: () => {},
      documentElement: { classList: { add: () => {} } },
    },
    addEventListener: () => {},
  };
  vm.runInNewContext(
    readFileSync(require.resolve("../assets/platform-auth.js"), "utf8"),
    context,
  );
  await context.HaedoAuth.verify();
  changed("SIGNED_OUT", null);
  assert.equal(context.HaedoAuth.user, null);
  assert.equal(dialog.open, false);
});

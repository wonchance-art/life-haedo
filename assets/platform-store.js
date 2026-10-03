(function (root) {
  const model = root.HaedoPlatformData, auth = root.HaedoAuth;
  let uid = null, items = [], epoch = 0, accountProject = null, queue = null, pulling = null;
  const project = () => auth.config?.url.replace(/\/+$/, "");
  const headers = () => ({ "Content-Type": "application/json", Prefer: "return=representation" });
  function accountError() {
    const error = new Error("계정이 변경됐습니다. 현재 계정에서 다시 열어 주세요.");
    error.code = "account_changed";
    return error;
  }
  function context() {
    const captured = { uid, epoch, project: accountProject, authEpoch: auth.epoch };
    assertAccount(captured);
    return captured;
  }
  function current(captured) {
    return captured.uid && captured.uid === uid && captured.epoch === epoch &&
      captured.project === accountProject && captured.project === project() &&
      captured.authEpoch === auth.epoch && auth.user?.id === captured.uid;
  }
  function assertAccount(captured) { if (!current(captured)) throw accountError(); }
  function notify(captured) {
    if (current(captured)) document.dispatchEvent(new Event("haedo:store"));
  }
  function requestFor(captured) {
    return async (url, options) => {
      assertAccount(captured);
      const response = await auth.request(url, typeof options === "function" ? options() : options);
      assertAccount(captured);
      return response;
    };
  }
  const base = (captured, table) => captured.project + "/rest/v1/" + table;
  function saveItems(captured) {
    assertAccount(captured);
    localStorage.setItem(model.keys(captured.uid).items, JSON.stringify(items));
  }
  function clearAccount() {
    epoch++;
    queue?.clear(); queue = null; pulling = null;
    uid = null; accountProject = null; items = [];
  }
  async function pushItem(id, captured) {
    assertAccount(captured);
    const item = items.find(row => row.id === id);
    if (!item) return;
    const stamp = item.updated;
    item.state = "sync";
    notify(captured);
    try {
      const result = await HaedoSync.writeSnapshot({
        request: requestFor(captured), base: base(captured, "haedo_items"), headers,
        row: { id, user_id: captured.uid, kind: item.kind, name: item.data.title,
          data: structuredClone(item.data), updated_at: stamp }, seen: item.syncedAt,
      });
      assertAccount(captured);
      const latest = items.find(row => row.id === id);
      if (!latest) return;
      if (result.conflict) latest.state = "conflict";
      else {
        latest.syncedAt = result.stamp;
        if (latest.updated === stamp) latest.updated = result.stamp;
        latest.state = latest.updated === latest.syncedAt ? "ok" : "sync";
      }
      saveItems(captured);
    } catch (_) {
      if (current(captured)) {
        const latest = items.find(row => row.id === id);
        if (latest) latest.state = "err";
        saveItems(captured);
      }
    }
    notify(captured);
  }
  async function pull() {
    const captured = context();
    if (pulling) return;
    const operation = {}; pulling = operation;
    try {
      const response = await requestFor(captured)(base(captured, "haedo_items") + "?select=id,kind,name,data,updated_at");
      if (!response.ok) throw new Error("목표와 습관을 불러오지 못했습니다. 연결 후 다시 시도해 주세요.");
      const rows = await response.json();
      assertAccount(captured);
      if (!Array.isArray(rows) || rows.some(row => !model.validItem(row)))
        throw new Error("저장된 항목 형식을 확인해야 합니다. 기기 사본은 보존했습니다.");
      for (const row of rows) {
        const local = items.find(item => item.id === row.id);
        if (local && local.updated !== local.syncedAt) {
          if (local.syncedAt !== row.updated_at) local.state = "conflict";
          continue;
        }
        const next = { id: row.id, kind: row.kind, data: row.data, updated: row.updated_at,
          syncedAt: row.updated_at, state: "ok" };
        if (local) Object.assign(local, next); else items.push(next);
      }
      saveItems(captured);
      for (const item of items) {
        if (item.syncedAt && !rows.some(row => row.id === item.id)) { item.state = "conflict"; continue; }
        if (item.updated !== item.syncedAt && item.state !== "conflict") queue.schedule(item.id);
      }
    } finally {
      if (current(captured) && pulling === operation) { pulling = null; notify(captured); }
    }
  }
  const store = {
    init(account) {
      clearAccount();
      if (!account || auth.user?.id !== account) throw accountError();
      const candidate = model.read(localStorage, model.keys(account).items, []);
      if (!Array.isArray(candidate) || candidate.some(row => !model.validItem(row)))
        throw new Error("기기의 목표·습관 사본을 읽지 못했습니다. 원본은 보존했습니다.");
      uid = account; accountProject = project(); items = candidate;
      const captured = context();
      // Each account generation owns its queue; an old running job cannot pick up B's same ID.
      queue = HaedoSync.createQueue(id => pushItem(id, captured));
      return store;
    },
    captureAccount() {
      const captured = context();
      return () => assertAccount(captured);
    },
    get items() {
      if (!uid || auth.user?.id !== uid || accountProject !== project()) return [];
      return items.filter(item => !item.data.deleted);
    },
    pull,
    async syncDocuments() {
      const captured = context();
      const response = await requestFor(captured)(base(captured, "haedo_documents") + "?select=id,name,data,updated_at");
      if (!response.ok) throw new Error("연표를 불러오지 못했습니다. 기기 사본은 보존했습니다.");
      const rows = await response.json();
      assertAccount(captured);
      if (!Array.isArray(rows) || rows.some(row => !HaedoData.isDocument(row.data)))
        throw new Error("연표 응답 형식을 확인해야 합니다.");
      const k = model.keys(captured.uid), reg = model.registry(localStorage, captured.uid);
      const account = captured.project + "|" + captured.uid;
      for (const row of rows) {
        const meta = reg.docs.find(doc => doc.id === row.id);
        if (meta && meta.updated !== meta.syncedAt) continue;
        localStorage.setItem(k.docs + row.id, JSON.stringify(row.data));
        const next = { id: row.id, name: row.name, updated: row.updated_at,
          syncedAt: row.updated_at, cloudAccount: account };
        if (meta) Object.assign(meta, next); else reg.docs.push(next);
      }
      if (!reg.current && reg.docs.length) reg.current = reg.docs[0].id;
      localStorage.setItem(k.registry, JSON.stringify(reg));
      notify(captured); return reg;
    },
    change(id, kind, data) {
      const captured = context(), old = items.find(row => row.id === id);
      const next = { id: id || model.newId(), kind, data,
        updated: new Date(Math.max(Date.now(), Date.parse(old?.updated || "") + 1 || 0)).toISOString(), state: "sync" };
      if (!model.validItem(next)) throw new Error("항목의 내용과 날짜를 확인해 주세요.");
      const candidate = old ? { ...old, ...next } : next;
      const newItems = old ? items.map(row => row === old ? candidate : row) : [...items, candidate];
      localStorage.setItem(model.keys(captured.uid).items, JSON.stringify(newItems));
      items = newItems; queue.schedule(next.id); notify(captured); return next.id;
    },
    remove(id) {
      context();
      const item = items.find(row => row.id === id);
      if (item) store.change(id, item.kind, { ...item.data, deleted: true });
    },
    async resolve(id, choice) {
      const captured = context(), item = items.find(row => row.id === id);
      if (!item) return;
      const response = await requestFor(captured)(base(captured, "haedo_items") + "?id=eq." + encodeURIComponent(id) + "&select=id,kind,data,updated_at");
      if (!response.ok) throw new Error("서버 사본을 확인하지 못했습니다.");
      const rows = await response.json(); assertAccount(captured);
      if (!Array.isArray(rows)) throw new Error("서버 사본의 형식을 확인해야 합니다.");
      const remote = rows[0];
      if (remote && !model.validItem(remote)) throw new Error("서버 사본의 형식을 확인해야 합니다.");
      if (choice === "remote") {
        if (remote) Object.assign(item, { data: remote.data, updated: remote.updated_at, syncedAt: remote.updated_at, state: "ok" });
        else items = items.filter(row => row.id !== id);
        saveItems(captured); notify(captured);
      } else {
        item.syncedAt = remote?.updated_at; item.updated = new Date().toISOString(); item.state = "sync";
        saveItems(captured); queue.schedule(id); notify(captured);
      }
    },
    async flush() {
      const captured = context(), pending = queue;
      for (const item of items) {
        assertAccount(captured);
        if (item.updated !== item.syncedAt && item.state !== "conflict") await pending.flush(item.id);
        assertAccount(captured);
      }
    },
    async uploadDocuments(ids) {
      const captured = context(), k = model.keys(captured.uid), request = requestFor(captured);
      for (const id of ids) {
        assertAccount(captured);
        const meta = model.registry(localStorage, captured.uid).docs.find(row => row.id === id);
        if (!meta) continue;
        const sent = meta.updated, data = JSON.parse(localStorage.getItem(k.docs + id));
        const result = await HaedoSync.writeSnapshot({ request, base: base(captured, "haedo_documents"), headers,
          row: { id, user_id: captured.uid, name: meta.name, data, updated_at: sent }, seen: meta.syncedAt });
        assertAccount(captured);
        if (result.conflict) throw new Error("서버 사본과 충돌했습니다. 연표에서 두 사본을 확인해 주세요.");
        const latest = model.registry(localStorage, captured.uid), current = latest.docs.find(row => row.id === id);
        if (!current) continue;
        current.syncedAt = result.stamp;
        if (current.updated === sent) current.updated = result.stamp;
        current.cloudAccount = captured.project + "|" + captured.uid;
        localStorage.setItem(k.registry, JSON.stringify(latest));
      }
      notify(captured);
    },
    backup() {
      const captured = context(), reg = model.registry(localStorage, captured.uid), k = model.keys(captured.uid);
      return { format: "haedo-platform-backup-v1", exportedAt: new Date().toISOString(),
        docs: reg.docs.map(doc => ({ id: doc.id, name: doc.name, data: JSON.parse(localStorage.getItem(k.docs + doc.id)) })),
        items: structuredClone(items) };
    },
  };
  document.addEventListener("haedo:signed-out", clearAccount);
  document.addEventListener("visibilitychange", () => {
    if (uid && !document.hidden) pull().catch(() => {});
  });
  addEventListener("online", () => { if (uid) pull().catch(() => {}); });
  root.HaedoPlatformStore = store;
})(globalThis);

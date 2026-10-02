(function (root) {
  const model = root.HaedoPlatformData,
    auth = root.HaedoAuth;
  let uid,
    items,
    pulling = false;
  const notify = () => document.dispatchEvent(new Event("haedo:store"));
  const headers = () => ({
    "Content-Type": "application/json",
    Prefer: "return=representation",
  });
  const request = (url, options) =>
    auth.request(url, typeof options === "function" ? options() : options);
  const base = (table) =>
    auth.config.url.replace(/\/+$/, "") + "/rest/v1/" + table;
  const assertAccount = () => {
    if (!uid || auth.user?.id !== uid) throw new Error("계정이 변경됐습니다.");
  };
  function saveItems() {
    assertAccount();
    localStorage.setItem(model.keys(uid).items, JSON.stringify(items));
  }
  async function pushItem(id) {
    assertAccount();
    const item = items.find((row) => row.id === id);
    if (!item) return;
    const account = uid,
      stamp = item.updated;
    item.state = "sync";
    notify();
    try {
      const result = await HaedoSync.writeSnapshot({
        request,
        base: base("haedo_items"),
        headers,
        row: {
          id,
          user_id: account,
          kind: item.kind,
          name: item.data.title,
          data: structuredClone(item.data),
          updated_at: stamp,
        },
        seen: item.syncedAt,
      });
      assertAccount();
      const current = items.find((row) => row.id === id);
      if (!current) return;
      if (result.conflict) current.state = "conflict";
      else {
        current.syncedAt = result.stamp;
        if (current.updated === stamp) current.updated = result.stamp;
        current.state = current.updated === current.syncedAt ? "ok" : "sync";
      }
      saveItems();
    } catch (_) {
      if (uid === account && auth.user?.id === account) {
        const current = items.find((row) => row.id === id);
        if (current) current.state = "err";
        saveItems();
      }
    }
    notify();
  }
  const queue = HaedoSync.createQueue(pushItem);
  async function pull() {
    if (pulling) return;
    assertAccount();
    pulling = true;
    try {
      const response = await auth.request(
        base("haedo_items") + "?select=id,kind,name,data,updated_at",
      );
      if (!response.ok)
        throw new Error(
          "목표와 습관을 불러오지 못했습니다. 연결 후 다시 시도해 주세요.",
        );
      const rows = await response.json();
      assertAccount();
      if (!Array.isArray(rows) || rows.some((row) => !model.validItem(row)))
        throw new Error(
          "저장된 항목 형식을 확인해야 합니다. 기기 사본은 보존했습니다.",
        );
      for (const row of rows) {
        const local = items.find((item) => item.id === row.id);
        if (local && local.updated !== local.syncedAt) {
          if (local.syncedAt !== row.updated_at) local.state = "conflict";
          continue;
        }
        const next = {
          id: row.id,
          kind: row.kind,
          data: row.data,
          updated: row.updated_at,
          syncedAt: row.updated_at,
          state: "ok",
        };
        if (local) Object.assign(local, next);
        else items.push(next);
      }
      saveItems();
      for (const item of items) {
        if (item.syncedAt && !rows.some((row) => row.id === item.id)) {
          item.state = "conflict";
          continue;
        }
        if (item.updated !== item.syncedAt && item.state !== "conflict")
          queue.schedule(item.id);
      }
    } finally {
      pulling = false;
      notify();
    }
  }
  const store = {
    init(account) {
      uid = account;
      items = model.read(localStorage, model.keys(uid).items, []);
      if (!Array.isArray(items) || items.some((row) => !model.validItem(row)))
        throw new Error(
          "기기의 목표·습관 사본을 읽지 못했습니다. 원본은 보존했습니다.",
        );
      return store;
    },
    get items() {
      return (items || []).filter((item) => !item.data.deleted);
    },
    pull,
    async syncDocuments() {
      assertAccount();
      const response = await auth.request(
        base("haedo_documents") + "?select=id,name,data,updated_at",
      );
      if (!response.ok)
        throw new Error(
          "연표를 불러오지 못했습니다. 기기 사본은 보존했습니다.",
        );
      const rows = await response.json();
      assertAccount();
      if (
        !Array.isArray(rows) ||
        rows.some((row) => !HaedoData.isDocument(row.data))
      )
        throw new Error("연표 응답 형식을 확인해야 합니다.");
      const k = model.keys(uid),
        reg = model.registry(localStorage, uid);
      const account = auth.config.url + "|" + uid;
      for (const row of rows) {
        const meta = reg.docs.find((doc) => doc.id === row.id);
        if (meta && meta.updated !== meta.syncedAt) continue;
        localStorage.setItem(k.docs + row.id, JSON.stringify(row.data));
        const next = {
          id: row.id,
          name: row.name,
          updated: row.updated_at,
          syncedAt: row.updated_at,
          cloudAccount: account,
        };
        if (meta) Object.assign(meta, next);
        else reg.docs.push(next);
      }
      if (!reg.current && reg.docs.length) reg.current = reg.docs[0].id;
      localStorage.setItem(k.registry, JSON.stringify(reg));
      notify();
      return reg;
    },
    change(id, kind, data) {
      assertAccount();
      const old = items.find((row) => row.id === id);
      const next = {
        id: id || model.newId(),
        kind,
        data,
        updated: new Date(
          Math.max(Date.now(), Date.parse(old?.updated || "") + 1 || 0),
        ).toISOString(),
        state: "sync",
      };
      if (!model.validItem(next))
        throw new Error("항목의 내용과 날짜를 확인해 주세요.");
      const candidate = old ? { ...old, ...next } : next;
      const newItems = old
        ? items.map((row) => (row === old ? candidate : row))
        : [...items, candidate];
      localStorage.setItem(model.keys(uid).items, JSON.stringify(newItems));
      items = newItems;
      queue.schedule(next.id);
      notify();
      return next.id;
    },
    remove(id) {
      const item = items.find((row) => row.id === id);
      if (item) store.change(id, item.kind, { ...item.data, deleted: true });
    },
    async resolve(id, choice) {
      assertAccount();
      const item = items.find((row) => row.id === id);
      if (!item) return;
      const response = await auth.request(
        base("haedo_items") +
          "?id=eq." +
          encodeURIComponent(id) +
          "&select=id,kind,data,updated_at",
      );
      if (!response.ok) throw new Error("서버 사본을 확인하지 못했습니다.");
      const rows = await response.json();
      assertAccount();
      const remote = rows[0];
      if (remote && !model.validItem(remote))
        throw new Error("서버 사본의 형식을 확인해야 합니다.");
      if (choice === "remote") {
        if (remote)
          Object.assign(item, {
            data: remote.data,
            updated: remote.updated_at,
            syncedAt: remote.updated_at,
            state: "ok",
          });
        else items = items.filter((row) => row.id !== id);
        saveItems();
        notify();
      } else {
        item.syncedAt = remote?.updated_at;
        item.updated = new Date().toISOString();
        item.state = "sync";
        saveItems();
        queue.schedule(id);
        notify();
      }
    },
    async flush() {
      for (const item of items)
        if (item.updated !== item.syncedAt && item.state !== "conflict")
          await queue.flush(item.id);
    },
    async uploadDocuments(ids) {
      assertAccount();
      const k = model.keys(uid);
      for (const id of ids) {
        assertAccount();
        const meta = model
          .registry(localStorage, uid)
          .docs.find((row) => row.id === id);
        if (!meta) continue;
        const sent = meta.updated;
        const data = JSON.parse(localStorage.getItem(k.docs + id));
        const result = await HaedoSync.writeSnapshot({
          request,
          base: base("haedo_documents"),
          headers,
          row: { id, user_id: uid, name: meta.name, data, updated_at: sent },
          seen: meta.syncedAt,
        });
        assertAccount();
        if (result.conflict)
          throw new Error(
            "서버 사본과 충돌했습니다. 연표에서 두 사본을 확인해 주세요.",
          );
        // Another tab may edit this document or add a document during the request.
        const latest = model.registry(localStorage, uid),
          current = latest.docs.find((row) => row.id === id);
        if (!current) continue;
        current.syncedAt = result.stamp;
        if (current.updated === sent) current.updated = result.stamp;
        current.cloudAccount = auth.config.url + "|" + uid;
        localStorage.setItem(k.registry, JSON.stringify(latest));
      }
      notify();
    },
    backup() {
      const reg = model.registry(localStorage, uid),
        k = model.keys(uid);
      return {
        format: "haedo-platform-backup-v1",
        exportedAt: new Date().toISOString(),
        docs: reg.docs.map((doc) => ({
          id: doc.id,
          name: doc.name,
          data: JSON.parse(localStorage.getItem(k.docs + doc.id)),
        })),
        items: structuredClone(items),
      };
    },
  };
  document.addEventListener("haedo:signed-out", () => {
    queue.clear();
    uid = null;
    items = [];
  });
  document.addEventListener("visibilitychange", () => {
    if (uid && !document.hidden) pull().catch(() => {});
  });
  addEventListener("online", () => {
    if (uid) pull().catch(() => {});
  });
  root.HaedoPlatformStore = store;
})(globalThis);

(function (root) {
  const model = root.HaedoPlatformData, auth = root.HaedoAuth;
  let uid = null, items = [], epoch = 0, accountProject = null, queue = null, docQueue = null, pulling = null;
  // Document uploads that failed in this page (id -> message), shown as "계정에 올리지 못함".
  const docErrors = new Map();
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
    queue?.clear(); queue = null; docQueue?.clear(); docQueue = null; pulling = null; docErrors.clear();
    uid = null; accountProject = null; items = [];
  }
  // 2026-11-01 owner rule: when both sides changed, the newest edit wins and the other side is
  // kept. The losing item goes to the account's recovery list before the winner replaces it; if
  // that write fails nothing is replaced (the caller leaves the item in its conflict state).
  function readRecovery(captured) {
    const list = model.read(localStorage, model.keys(captured.uid).recovery, []);
    if (!Array.isArray(list)) throw new Error("기기의 복구 사본 목록을 읽지 못했습니다. 원본은 보존했습니다.");
    return list;
  }
  function keepLoser(captured, row, reason) {
    assertAccount(captured);
    const list = readRecovery(captured);
    list.push({ id: row.id, kind: row.kind, data: structuredClone(row.data), updated: row.updated || null,
      keptAt: new Date().toISOString(), reason });
    localStorage.setItem(model.keys(captured.uid).recovery, JSON.stringify(list));
  }
  // Applies newest-wins to a local item whose server copy also changed (remote is the server row,
  // or null when the row is gone). Returns true when the local copy won and must be sent again.
  function settle(captured, local, remote) {
    if (!remote) {
      // The server row is gone. An edit made here after the last sync is newer and is sent again
      // (as a new row); an unchanged copy follows the deletion, kept in recovery first.
      if (local.updated !== local.syncedAt) { delete local.syncedAt; local.state = "sync"; return true; }
      keepLoser(captured, local, "remote_deleted");
      items = items.filter(row => row !== local);
      return false;
    }
    if (model.localWins(local.updated, remote.updated_at)) {
      keepLoser(captured, { id: remote.id, kind: remote.kind, data: remote.data, updated: remote.updated_at }, "local_newer");
      local.syncedAt = remote.updated_at; local.state = "sync";
      return true;
    }
    keepLoser(captured, local, "remote_newer");
    Object.assign(local, { kind: remote.kind, data: remote.data, updated: remote.updated_at, syncedAt: remote.updated_at, state: "ok" });
    return false;
  }
  async function remoteItem(captured, id) {
    const response = await requestFor(captured)(base(captured, "haedo_items") + "?id=eq." + encodeURIComponent(id) + "&select=id,kind,data,updated_at");
    if (!response.ok) throw new Error("서버 사본을 확인하지 못했습니다.");
    const rows = await response.json(); assertAccount(captured);
    if (!Array.isArray(rows) || rows[0] && !model.validItem(rows[0])) throw new Error("서버 사본의 형식을 확인해야 합니다.");
    return rows[0] || null;
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
      if (result.conflict) {
        // The server copy changed since this device last saw it: newest edit wins.
        const remote = await remoteItem(captured, id);
        const now = items.find(row => row.id === id);
        if (!now) return;
        let again = false;
        try { again = settle(captured, now, remote); } catch (_) { now.state = "conflict"; }
        saveItems(captured);
        if (again) queue.schedule(id);
        notify(captured);
        return;
      } else {
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
          // Only this device changed it: the queued upload sends it (a stale conflict mark clears).
          if (local.syncedAt === row.updated_at) { if (local.state === "conflict") local.state = "sync"; continue; }
          // Both changed (this includes items left in the older manual conflict state).
          try { settle(captured, local, row); } catch (_) { local.state = "conflict"; }
          continue;
        }
        const next = { id: row.id, kind: row.kind, data: row.data, updated: row.updated_at,
          syncedAt: row.updated_at, state: "ok" };
        if (local) Object.assign(local, next); else items.push(next);
      }
      for (const item of [...items]) {
        if (item.syncedAt && !rows.some(row => row.id === item.id)) {
          try { settle(captured, item, null); } catch (_) { item.state = "conflict"; }
        }
      }
      saveItems(captured);
      for (const item of items) {
        if (item.updated !== item.syncedAt && item.state !== "conflict") queue.schedule(item.id);
      }
    } finally {
      if (current(captured) && pulling === operation) { pulling = null; notify(captured); }
    }
  }
  // Documents follow the same rule at document level. The losing copy becomes a new document
  // "<이름> 복구 사본" in the same list; it is written (body, then the list) before the winner
  // replaces anything, and it is uploaded like any other unsynced document.
  function keepLoserDoc(captured, reg, name, data) {
    assertAccount(captured);
    if (!HaedoData.isDocument(data)) throw new Error("연표 사본 형식을 확인해야 합니다.");
    const k = model.keys(captured.uid), id = model.newId(), label = (name || "내 연표") + " 복구 사본";
    // The label is also the copy's own name, so a restore or an edit of the copy keeps it.
    localStorage.setItem(k.docs + id, JSON.stringify({ ...data, profile: { ...data.profile, name: label } }));
    reg.docs.push({ id, name: label, updated: new Date().toISOString() });
    localStorage.setItem(k.registry, JSON.stringify(reg));
    return id;
  }
  // meta changed here and row changed on the server. Returns true when the local copy won.
  function settleDoc(captured, reg, meta, row) {
    const k = model.keys(captured.uid), local = JSON.parse(localStorage.getItem(k.docs + meta.id));
    if (model.localWins(meta.updated, row.updated_at)) {
      keepLoserDoc(captured, reg, row.name || meta.name, row.data);
      meta.syncedAt = row.updated_at;
      return true;
    }
    keepLoserDoc(captured, reg, meta.name, local);
    localStorage.setItem(k.docs + meta.id, JSON.stringify(row.data));
    Object.assign(meta, { name: row.name, updated: row.updated_at, syncedAt: row.updated_at, cloudAccount: captured.project + "|" + captured.uid });
    return false;
  }
  async function uploadDoc(captured, id) {
    const k = model.keys(captured.uid), request = requestFor(captured);
    for (let attempt = 0; attempt < 2; attempt++) {
      assertAccount(captured);
      const meta = model.registry(localStorage, captured.uid).docs.find(row => row.id === id);
      if (!meta) return;
      const sent = meta.updated, data = JSON.parse(localStorage.getItem(k.docs + id));
      const result = await HaedoSync.writeSnapshot({ request, base: base(captured, "haedo_documents"), headers,
        row: { id, user_id: captured.uid, name: meta.name, data, updated_at: sent }, seen: meta.syncedAt });
      assertAccount(captured);
      const latest = model.registry(localStorage, captured.uid), current = latest.docs.find(row => row.id === id);
      if (!current) return;
      if (!result.conflict) {
        current.syncedAt = result.stamp;
        if (current.updated === sent) current.updated = result.stamp;
        current.cloudAccount = captured.project + "|" + captured.uid;
        localStorage.setItem(k.registry, JSON.stringify(latest));
        return;
      }
      // The server copy changed: newest wins, the other copy is kept as a recovery document.
      const response = await request(base(captured, "haedo_documents") + "?id=eq." + encodeURIComponent(id) + "&select=id,name,data,updated_at");
      if (!response.ok) throw new Error("서버 연표를 확인하지 못했습니다. 기기 사본은 보존했습니다.");
      const rows = await response.json(); assertAccount(captured);
      if (!Array.isArray(rows) || rows[0] && !HaedoData.isDocument(rows[0].data)) throw new Error("연표 응답 형식을 확인해야 합니다.");
      const fresh = model.registry(localStorage, captured.uid), meta2 = fresh.docs.find(row => row.id === id);
      if (!meta2) return;
      if (!rows[0]) { delete meta2.syncedAt; localStorage.setItem(k.registry, JSON.stringify(fresh)); continue; }
      const again = settleDoc(captured, fresh, meta2, rows[0]);
      localStorage.setItem(k.registry, JSON.stringify(fresh));
      if (!again) return;
    }
    throw new Error("서버 사본과 계속 충돌했습니다. 기기 사본은 보존했습니다. 잠시 뒤 다시 시도해 주세요.");
  }
  async function uploadQueued(id, captured) {
    try { await uploadDoc(captured, id); docErrors.delete(id); }
    catch (error) { if (current(captured)) docErrors.set(id, error?.message || "연표를 계정에 올리지 못했습니다."); }
    notify(captured);
    // Recovery documents made by this upload are sent too.
    if (current(captured)) for (const meta of model.registry(localStorage, captured.uid).docs)
      if (!meta.syncedAt && meta.id !== id && !docQueue.pending(meta.id) && !docErrors.has(meta.id)) docQueue.schedule(meta.id);
  }
  // The timeline document the editor opens by default (registry.current, else the first).
  function currentDoc(captured) {
    const reg = model.registry(localStorage, captured.uid);
    return reg.docs.find(doc => doc.id === reg.current) || reg.docs[0] || null;
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
      docQueue = HaedoSync.createQueue(id => uploadQueued(id, captured));
      return store;
    },
    // Initialise only when this account is not the one already open (keeps a running queue).
    ensure(account) {
      if (account && uid === account && accountProject === project() && auth.user?.id === account) return store;
      return store.init(account);
    },
    get account() { return uid && auth.user?.id === uid && accountProject === project() ? uid : null; },
    // Items kept from the losing side of a conflict (newest first).
    get recovery() {
      if (!store.account) return [];
      try { return readRecovery(context()).slice().reverse(); } catch (_) { return []; }
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
        if (meta && meta.updated !== meta.syncedAt) {
          // Only this device changed it: its upload sends it. Both changed: newest wins.
          if (meta.syncedAt === row.updated_at || !meta.syncedAt) continue;
          if (settleDoc(captured, reg, meta, row)) docQueue?.schedule(meta.id);
          continue;
        }
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
      const captured = context();
      for (const id of ids) await uploadDoc(captured, id);
      notify(captured);
    },
    // 행복도 of one day in the current timeline document (null when not recorded).
    happiness(date) {
      if (!store.account) return null;
      const captured = context(), meta = currentDoc(captured);
      if (!meta) return null;
      try { return model.happinessOn(JSON.parse(localStorage.getItem(model.keys(captured.uid).docs + meta.id)), date); }
      catch (_) { return null; }
    },
    // Sets (0–10) or clears (null) that day's 행복도. With no timeline document yet, saving the
    // first value creates "내 연표" (the timeline editor's default); viewing never creates one.
    setHappiness(date, n) {
      const captured = context(), k = model.keys(captured.uid), reg = model.registry(localStorage, captured.uid);
      let meta = reg.docs.find(doc => doc.id === reg.current) || reg.docs[0] || null, doc;
      if (!meta) {
        if (n === null) return null;
        meta = { id: model.newId(), name: "내 연표", updated: null };
        doc = model.emptyDocument("내 연표");
        reg.docs.push(meta); reg.current = meta.id;
      } else doc = JSON.parse(localStorage.getItem(k.docs + meta.id));
      const next = model.withHappiness(doc, date, n);
      meta.updated = new Date(Math.max(Date.now(), Date.parse(meta.updated || "") + 1 || 0)).toISOString();
      // Body first, list last: a failed list write leaves the old list pointing at a valid body.
      localStorage.setItem(k.docs + meta.id, JSON.stringify(next));
      localStorage.setItem(k.registry, JSON.stringify(reg));
      docErrors.delete(meta.id); docQueue.schedule(meta.id); notify(captured);
      return meta.id;
    },
    // Upload state of the current document: "ok" | "pending" | "error" (null without one).
    happinessState() {
      if (!store.account) return null;
      const captured = context(), meta = currentDoc(captured);
      if (!meta) return null;
      if (docErrors.has(meta.id)) return "error";
      return meta.updated === meta.syncedAt ? "ok" : "pending";
    },
    retryDocuments() {
      if (!store.account) return;
      const captured = context();
      for (const meta of model.registry(localStorage, captured.uid).docs) if (meta.updated !== meta.syncedAt) { docErrors.delete(meta.id); docQueue.schedule(meta.id); }
    },
    backup() {
      const captured = context(), reg = model.registry(localStorage, captured.uid), k = model.keys(captured.uid);
      return { format: "haedo-platform-backup-v1", exportedAt: new Date().toISOString(),
        docs: reg.docs.map(doc => ({ id: doc.id, name: doc.name, data: JSON.parse(localStorage.getItem(k.docs + doc.id)) })),
        items: structuredClone(items), recovery: readRecovery(captured) };
    },
    // Restores recovery copies from a backup (added, never replacing what is already kept).
    restoreRecovery(list) {
      const captured = context();
      if (!Array.isArray(list) || list.some(row => !model.validItem(row))) throw new Error("복구 사본 형식을 읽을 수 없습니다.");
      const kept = readRecovery(captured), seen = new Set(kept.map(row => JSON.stringify([row.id, row.updated, row.keptAt])));
      for (const row of list) if (!seen.has(JSON.stringify([row.id, row.updated, row.keptAt]))) kept.push(structuredClone(row));
      localStorage.setItem(model.keys(captured.uid).recovery, JSON.stringify(kept));
      notify(captured);
    },
  };
  // Account boundary: always bound directly, so sign-out clears this account even without the
  // lifecycle module.
  document.addEventListener("haedo:signed-out", clearAccount);
  // Wake-ups (S2 shared wiring, assets/life/sync-lifecycle.js): pull when the page shows again or
  // the network returns, and resend unsent timeline documents. Without the module (an older cached
  // page) only explicit and start-up syncs run.
  const wake = () => { if (!store.account) return; pull().catch(() => {}); store.retryDocuments(); };
  const visible = () => { if (!document.hidden) wake(); };
  root.HaedoLife?.SyncLifecycle?.attach(root, { listen: [["document", "visibilitychange", visible], ["window", "online", wake]] });
  root.HaedoPlatformStore = store;
})(globalThis);

(function (root) {
  const model = root.HaedoPlatformData, auth = root.HaedoAuth;
  let uid = null, items = [], epoch = 0, accountProject = null, queue = null, pulling = null;
  // Timeline documents (haedo_documents): this store only brings them here (syncDocuments) and
  // sends them on an explicit request (uploadDocuments), as on main. Their writer is the timeline
  // editor; the 일정 screen only reads 행복도 (B2 scope, 2026-11-04 owner decision).
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
  // 2026-11-01 owner rule: when both sides changed, the newest edit wins and the other side is
  // kept. The losing item goes to the account's recovery list before the winner replaces it; if
  // that write fails nothing is replaced (the caller leaves the item in its conflict state).
  // The comparison mixes a device's edit time and a server upload time (no shared clock); the
  // losing side is always kept, so a wrong order loses nothing.
  const sameData = (a, b) => JSON.stringify(HaedoData.canonical(a)) === JSON.stringify(HaedoData.canonical(b));
  // A list that cannot be read is set aside (raw value) and a new list starts: a damaged value
  // never blocks a conflict, a backup or a restore.
  function readRecovery(captured) {
    const k = model.keys(captured.uid), raw = localStorage.getItem(k.recovery);
    if (raw === null) return [];
    let list = null;
    try { list = JSON.parse(raw); } catch (_) { list = null; }
    if (Array.isArray(list) && list.every(row => row && typeof row === "object" && !Array.isArray(row))) return list;
    let damaged = null;
    try { damaged = JSON.parse(localStorage.getItem(k.recoveryDamaged)); } catch (_) { damaged = null; }
    damaged = Array.isArray(damaged) ? damaged : [];
    damaged.push(raw);
    localStorage.setItem(k.recoveryDamaged, JSON.stringify(damaged));
    localStorage.setItem(k.recovery, "[]");
    return [];
  }
  const ridOf = row => row.rid || JSON.stringify([row.id, row.updated ?? null, row.keptAt ?? null]);
  function keepLoser(captured, row, reason) {
    assertAccount(captured);
    const list = readRecovery(captured);
    // Pull and push can settle the same conflict: the same losing version is kept once.
    if (list.some(kept => kept.id === row.id && (kept.updated ?? null) === (row.updated ?? null) && sameData(kept.data, row.data))) return;
    list.push({ rid: model.newId(), id: row.id, kind: row.kind, data: structuredClone(row.data), updated: row.updated || null,
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
      // A pull whose list was read before this write must not treat its result as stale.
      pulling?.pushed.add(id);
      const latest = items.find(row => row.id === id);
      if (!latest) return;
      if (result.conflict) {
        // The server copy changed since this device last saw it: newest edit wins.
        const remote = await remoteItem(captured, id);
        const now = items.find(row => row.id === id);
        if (!now) return;
        let again = false;
        // A failed recovery write leaves the item as it is, in conflict (nothing applied).
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
    const operation = { pushed: new Set() }; pulling = operation;
    try {
      const response = await requestFor(captured)(base(captured, "haedo_items") + "?select=id,kind,name,data,updated_at");
      if (!response.ok) throw new Error("목표와 습관을 불러오지 못했습니다. 연결 후 다시 시도해 주세요.");
      const rows = await response.json();
      assertAccount(captured);
      if (!Array.isArray(rows) || rows.some(row => !model.validItem(row)))
        throw new Error("저장된 항목 형식을 확인해야 합니다. 기기 사본은 보존했습니다.");
      for (const row of rows) {
        // Written by this device while the list was in flight: the list row is older than it.
        if (operation.pushed.has(row.id)) continue;
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
        if (item.syncedAt && !operation.pushed.has(item.id) && !rows.some(row => row.id === item.id)) {
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
    // Initialise only when this account is not the one already open (keeps a running queue).
    ensure(account) {
      if (account && uid === account && accountProject === project() && auth.user?.id === account) return store;
      return store.init(account);
    },
    get account() { return uid && auth.user?.id === uid && accountProject === project() ? uid : null; },
    // Items kept from the losing side of a conflict (newest first).
    get recovery() {
      if (!store.account) return [];
      try { return readRecovery(context()).slice().reverse().map(row => ({ ...row, rid: ridOf(row) })); } catch (_) { return []; }
    },
    // Recovery copies the owner has not acknowledged yet (the notice shows only these). Judged by
    // id: a copy that arrives later from another device is new even with an earlier keptAt.
    get recoveryUnseen() {
      if (!store.account) return 0;
      let seen = [];
      try { seen = JSON.parse(localStorage.getItem(model.keys(uid).recoverySeen)); } catch (_) { seen = []; }
      const ids = new Set(Array.isArray(seen) ? seen : []);
      return store.recovery.filter(row => !ids.has(row.rid)).length;
    },
    acknowledgeRecovery() {
      const captured = context();
      localStorage.setItem(model.keys(captured.uid).recoverySeen, JSON.stringify(store.recovery.map(row => row.rid)));
      notify(captured);
    },
    // Puts a kept copy back as a new item (a new ID; the item it lost to is not touched).
    reviveRecovery(rid) {
      const captured = context(), row = store.recovery.find(item => item.rid === rid);
      if (!row) throw new Error("복구 사본을 찾지 못했습니다.");
      return store.change(null, row.kind, structuredClone(row.data));
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
    // A pull settles items left in conflict; then everything unsent is sent.
    async retry() {
      await pull().catch(() => {});
      await store.flush();
    },
    // As main (the timeline editor and the goals/habits screens bring the account's timelines here;
    // a document changed on this device is left to its editor), writing only what changed.
    async syncDocuments() {
      const captured = context();
      const response = await requestFor(captured)(base(captured, "haedo_documents") + "?select=id,name,data,updated_at");
      if (!response.ok) throw new Error("연표를 불러오지 못했습니다. 기기 사본은 보존했습니다.");
      const rows = await response.json();
      assertAccount(captured);
      if (!Array.isArray(rows) || rows.some(row => !HaedoData.isDocument(row.data)))
        throw new Error("연표 응답 형식을 확인해야 합니다.");
      const k = model.keys(captured.uid), reg = model.registry(localStorage, captured.uid);
      // Only what changed on the server is written, and the list only when this pass changed it:
      // this page's view of localStorage can lag another tab's write (the timeline editor's
      // unsent edit), and writing back an unchanged stale copy would hide that edit.
      const listBefore = JSON.stringify(reg);
      const account = captured.project + "|" + captured.uid;
      for (const row of rows) {
        const meta = reg.docs.find(doc => doc.id === row.id);
        if (meta && meta.updated !== meta.syncedAt) continue;
        if (meta && meta.syncedAt === row.updated_at) continue;
        localStorage.setItem(k.docs + row.id, JSON.stringify(row.data));
        const next = { id: row.id, name: row.name, updated: row.updated_at,
          syncedAt: row.updated_at, cloudAccount: account };
        if (meta) Object.assign(meta, next); else reg.docs.push(next);
      }
      if (!reg.current && reg.docs.length) reg.current = reg.docs[0].id;
      if (JSON.stringify(reg) !== listBefore) localStorage.setItem(k.registry, JSON.stringify(reg));
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
    // As main: explicit uploads only (the goals/habits screens' sync, a timeline import).
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
    // 행복도 of one day, read only (the 일정 screen shows it; it is entered in the timeline editor).
    // From the timeline chosen the same way on every device (model.baseDocument): the non-recovery
    // timeline with the most daily 행복도, then the smallest id. Scales as the editor reads them.
    happiness(date) {
      if (!store.account) return null;
      const captured = context(), k = model.keys(captured.uid);
      const read = id => { try { return JSON.parse(localStorage.getItem(k.docs + id)); } catch (_) { return null; } };
      const meta = model.baseDocument(model.registry(localStorage, captured.uid), { read });
      if (!meta) return null;
      return model.happinessOn(read(meta.id), date);
    },
    // The timeline 행복도 is read from (its id and name), for the link to the editor.
    get happinessSource() {
      if (!store.account) return null;
      const captured = context(), k = model.keys(captured.uid);
      const read = id => { try { return JSON.parse(localStorage.getItem(k.docs + id)); } catch (_) { return null; } };
      const meta = model.baseDocument(model.registry(localStorage, captured.uid), { read });
      return meta ? { id: meta.id, name: meta.name } : null;
    },
    backup() {
      const captured = context(), reg = model.registry(localStorage, captured.uid), k = model.keys(captured.uid);
      const recovery = readRecovery(captured);
      let damaged = null;
      try { damaged = JSON.parse(localStorage.getItem(k.recoveryDamaged)); } catch (_) { damaged = null; }
      return { format: "haedo-platform-backup-v1", exportedAt: new Date().toISOString(),
        docs: reg.docs.map(doc => ({ id: doc.id, name: doc.name, data: JSON.parse(localStorage.getItem(k.docs + doc.id)) })),
        items: structuredClone(items), recovery, ...(Array.isArray(damaged) && damaged.length ? { recoveryDamaged: damaged } : {}) };
    },
    // Restores recovery copies (from a backup or another device): added, never replacing what is
    // already kept. Copies already kept (same rid, or same item version and data) are skipped.
    restoreRecovery(list) {
      const captured = context();
      if (!Array.isArray(list) || list.some(row => !model.validItem(row))) throw new Error("복구 사본 형식을 읽을 수 없습니다.");
      const kept = readRecovery(captured), rids = new Set(kept.map(ridOf));
      let added = 0;
      for (const row of list) {
        const rid = ridOf(row);
        if (rids.has(rid) || kept.some(item => item.id === row.id && (item.updated ?? null) === (row.updated ?? null) && sameData(item.data, row.data))) continue;
        kept.push({ ...structuredClone(row), rid }); rids.add(rid); added++;
      }
      // Only a real addition notifies: the 일정 screen mirrors this list with the account on notice.
      if (added) { localStorage.setItem(model.keys(captured.uid).recovery, JSON.stringify(kept)); notify(captured); }
      return added;
    },
    // Restores damaged recovery values set aside on another copy (raw text, kept as it was).
    restoreDamaged(list) {
      const captured = context(), k = model.keys(captured.uid);
      if (!Array.isArray(list)) return 0;
      let damaged = null;
      try { damaged = JSON.parse(localStorage.getItem(k.recoveryDamaged)); } catch (_) { damaged = null; }
      damaged = Array.isArray(damaged) ? damaged : [];
      let added = 0;
      for (const raw of list) if (typeof raw === "string" && !damaged.includes(raw)) { damaged.push(raw); added++; }
      if (added) localStorage.setItem(k.recoveryDamaged, JSON.stringify(damaged));
      return added;
    },
  };
  // Account boundary: always bound directly, so sign-out clears this account even without the
  // lifecycle module.
  document.addEventListener("haedo:signed-out", clearAccount);
  // Wake-ups (S2 shared wiring, assets/life/sync-lifecycle.js): pull goals/habits when the page shows
  // again or the network returns. Timeline documents are never sent from here: their editor does
  // (one writer per document). Without the module (an older cached page) only explicit and
  // start-up syncs run.
  const wake = () => {
    if (!store.account) return;
    pull().catch(() => {});
  };
  const visible = () => { if (!document.hidden) wake(); };
  root.HaedoLife?.SyncLifecycle?.attach(root, { listen: [["document", "visibilitychange", visible], ["window", "online", wake]] });
  root.HaedoPlatformStore = store;
})(globalThis);

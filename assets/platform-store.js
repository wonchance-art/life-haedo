(function (root) {
  const model = root.HaedoPlatformData, auth = root.HaedoAuth;
  let uid = null, items = [], epoch = 0, accountProject = null, queue = null, docQueue = null, pulling = null;
  // Document uploads that failed in this page (id -> message), shown as "계정에 올리지 못함".
  const docErrors = new Map();
  // Who sends a document (B2 review B1, re-review M1). Every page that shows a changed document
  // sends it: the timeline editor (app.js) its open documents, the 일정 screen (`following`) the
  // changed documents it reads from the account and its own, the goals/habits screens through
  // their explicit sync. Uploads of one document never overlap across pages and tabs
  // (HaedoSync.exclusive, a Web Lock per document); the next writer finds it clean.
  // ownedDocs: documents this page wrote (행복도, its recovery copies), rebuilt when it opens.
  const ownedDocs = new Set();
  let following = false;
  // 행복도 days pressed here and not on the server yet, per document (date -> {n, at}), and the
  // body this page last knew to be on the server. Kept on the device (happinessPending) so a
  // reopened page still rebases a conflict day by day (M1) and sends the days.
  const pendingHappiness = new Map(), lastSynced = new Map();
  // Server documents seen by the last successful syncDocuments (null before one): a document
  // this device synced that is no longer there was deleted elsewhere.
  // serverSeen: the latest server stamp in that list. A document stamped later (sent after it,
  // by any page) is not taken for deleted.
  let serverIds = null, serverSeen = "";
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
    ownedDocs.clear(); pendingHappiness.clear(); lastSynced.clear(); following = false; serverIds = null; serverSeen = ""; baseMemo = null;
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
  // Documents follow the same rule at document level. The losing copy becomes a new document
  // "<이름> 복구 사본 (날짜 시각)" in the same list; it is written (body, then the list) before the
  // winner replaces anything. The same content is kept once; a copy of a copy keeps the base name.
  function keepLoserDoc(captured, reg, name, data, winner) {
    assertAccount(captured);
    if (!HaedoData.isDocument(data)) throw new Error("연표 사본 형식을 확인해야 합니다.");
    const k = model.keys(captured.uid), key = HaedoData.contentKey(data);
    if (winner && key === HaedoData.contentKey(winner)) return null;
    const held = reg.docs.find(doc => HaedoData.isRecoveryName(doc.name) && (() => {
      try { return HaedoData.contentKey(JSON.parse(localStorage.getItem(k.docs + doc.id))) === key; } catch (_) { return false; }
    })());
    if (held) return held.id;
    const id = model.newId(), label = HaedoData.recoveryName(name);
    // The label is also the copy's own name, so a restore or an edit of the copy keeps it.
    localStorage.setItem(k.docs + id, JSON.stringify({ ...data, profile: { ...data.profile, name: label } }));
    reg.docs.push({ id, name: label, updated: new Date().toISOString() });
    localStorage.setItem(k.registry, JSON.stringify(reg));
    ownedDocs.add(id);
    return id;
  }
  const applyPending = (doc, pending) => [...pending].reduce((next, [date, entry]) => model.withHappiness(next, date, entry.n), doc);
  function savePending(captured) {
    const out = {};
    for (const [id, days] of pendingHappiness) if (days.size) out[id] = { base: lastSynced.get(id) ?? null, days: Object.fromEntries(days) };
    try {
      const key = model.keys(captured.uid).happinessPending;
      if (Object.keys(out).length) localStorage.setItem(key, JSON.stringify(out)); else localStorage.removeItem(key);
    } catch (_) { /* No room: this page still holds the days; the edit itself is in the document. */ }
  }
  function loadPending(captured) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(model.keys(captured.uid).happinessPending)); } catch (_) { saved = null; }
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;
    for (const [id, row] of Object.entries(saved)) {
      if (!row || typeof row.days !== "object" || !row.days) continue;
      const days = new Map(Object.entries(row.days).filter(([date, entry]) =>
        /^\d{4}-\d{2}-\d{2}$/.test(date) && entry && (entry.n === null || Number.isInteger(entry.n)) && typeof entry.at === "string"));
      if (!days.size) continue;
      pendingHappiness.set(id, days); ownedDocs.add(id);
      if (typeof row.base === "string") lastSynced.set(id, row.base);
    }
  }
  const scoreOn = (doc, date) => model.happinessOn(doc, date)?.score ?? null;
  // meta changed here and row changed on the server. Returns "rebased" | "local" (send again) or
  // "remote" (the server copy is now local).
  function reconcileDoc(captured, reg, meta, row) {
    const k = model.keys(captured.uid), local = JSON.parse(localStorage.getItem(k.docs + meta.id));
    const pending = pendingHappiness.get(meta.id), known = lastSynced.get(meta.id);
    // Only 행복도 days changed here since the last known server copy: apply those days on top of
    // the newer server copy; the other device's edits stay. When the other device changed the
    // same day too, the later one wins (press time here, upload time there) and the losing
    // version is kept as a recovery copy, never dropped.
    const base = known && JSON.parse(known);
    if (pending?.size && base && HaedoData.contentKey(applyPending(base, pending)) === HaedoData.contentKey(local)) {
      let rebased = row.data, lostHere = false, lostThere = false;
      for (const [date, entry] of [...pending]) {
        const there = scoreOn(row.data, date), sameDay = there !== scoreOn(base, date) && there !== entry.n;
        if (sameDay && !model.localWins(entry.at, row.updated_at)) { lostHere = true; pending.delete(date); continue; }
        if (sameDay) lostThere = true;
        rebased = model.withHappiness(rebased, date, entry.n);
      }
      if (lostHere) keepLoserDoc(captured, reg, meta.name, local, rebased);
      if (lostThere) keepLoserDoc(captured, reg, row.name || meta.name, row.data, rebased);
      localStorage.setItem(k.docs + meta.id, JSON.stringify(rebased));
      lastSynced.set(meta.id, JSON.stringify(row.data));
      if (!pending.size) pendingHappiness.delete(meta.id);
      savePending(captured);
      // Nothing of this device's left to send: the server copy is the document now.
      if (HaedoData.contentKey(rebased) === HaedoData.contentKey(row.data)) {
        Object.assign(meta, { updated: row.updated_at, syncedAt: row.updated_at, cloudAccount: captured.project + "|" + captured.uid });
        return "remote";
      }
      Object.assign(meta, { syncedAt: row.updated_at, updated: new Date(Math.max(Date.now(), Date.parse(row.updated_at || "") + 1 || 0)).toISOString() });
      return "rebased";
    }
    if (model.localWins(meta.updated, row.updated_at)) {
      keepLoserDoc(captured, reg, row.name || meta.name, row.data, local);
      meta.syncedAt = row.updated_at;
      lastSynced.set(meta.id, JSON.stringify(row.data));
      return "local";
    }
    keepLoserDoc(captured, reg, meta.name, local, row.data);
    localStorage.setItem(k.docs + meta.id, JSON.stringify(row.data));
    Object.assign(meta, { name: row.name, updated: row.updated_at, syncedAt: row.updated_at, cloudAccount: captured.project + "|" + captured.uid });
    lastSynced.set(meta.id, JSON.stringify(row.data)); pendingHappiness.delete(meta.id); savePending(captured);
    return "remote";
  }
  // A document this device synced is gone from the server (deleted on another device): it is not
  // sent again. The unsent version here is kept as a recovery copy first, then the document leaves
  // this device's list; the schedule picks its timeline again.
  function dropDeleted(captured, reg, meta) {
    const k = model.keys(captured.uid);
    let local = null;
    try { local = JSON.parse(localStorage.getItem(k.docs + meta.id)); } catch (_) { local = null; }
    if (local) keepLoserDoc(captured, reg, meta.name, local, null);
    reg.docs = reg.docs.filter(doc => doc.id !== meta.id);
    if (reg.current === meta.id) reg.current = reg.docs[0]?.id || null;
    localStorage.setItem(k.registry, JSON.stringify(reg));
    localStorage.removeItem(k.docs + meta.id);
    pendingHappiness.delete(meta.id); lastSynced.delete(meta.id); ownedDocs.delete(meta.id); docErrors.delete(meta.id);
    savePending(captured);
    if (readBase(captured)?.docId === meta.id) { localStorage.removeItem(k.base); baseMemo = null; const next = baseDoc(captured); if (next) writeBase(captured, next.id); }
  }
  function uploadDoc(captured, id) {
    return HaedoSync.exclusive("haedo-doc:" + captured.uid + ":" + id, () => uploadDocNow(captured, id));
  }
  async function uploadDocNow(captured, id) {
    // A stalled request times out (HaedoSync.timed) so it does not hold the document's lock.
    const k = model.keys(captured.uid), request = HaedoSync.timed(requestFor(captured));
    for (let attempt = 0; attempt < 3; attempt++) {
      assertAccount(captured);
      const meta = model.registry(localStorage, captured.uid).docs.find(row => row.id === id);
      if (!meta) return;
      // Nothing changed here since the last upload: nothing to send.
      if (meta.syncedAt && meta.updated === meta.syncedAt) return;
      const sent = meta.updated, body = localStorage.getItem(k.docs + id), data = JSON.parse(body);
      const sentPending = [...(pendingHappiness.get(id) || [])];
      const result = await HaedoSync.writeSnapshot({ request, base: base(captured, "haedo_documents"), headers,
        row: { id, user_id: captured.uid, name: meta.name, data, updated_at: sent }, seen: meta.syncedAt });
      assertAccount(captured);
      const latest = model.registry(localStorage, captured.uid), now = latest.docs.find(row => row.id === id);
      if (!now) return;
      if (!result.conflict) {
        now.syncedAt = result.stamp;
        if (now.updated === sent) now.updated = result.stamp;
        now.cloudAccount = captured.project + "|" + captured.uid;
        localStorage.setItem(k.registry, JSON.stringify(latest));
        lastSynced.set(id, body); serverIds?.add(id); baseMemo = null;
        // Days sent with this upload are on the server; a newer value for the same day stays pending.
        const pending = pendingHappiness.get(id);
        for (const [date, entry] of sentPending) if (pending?.get(date) === entry) pending.delete(date);
        if (pending && !pending.size) pendingHappiness.delete(id);
        savePending(captured);
        return;
      }
      const response = await request(base(captured, "haedo_documents") + "?id=eq." + encodeURIComponent(id) + "&select=id,name,data,updated_at");
      if (!response.ok) throw new Error("서버 연표를 확인하지 못했습니다. 기기 사본은 보존했습니다.");
      const rows = await response.json(); assertAccount(captured);
      if (!Array.isArray(rows) || rows[0] && !HaedoData.isDocument(rows[0].data)) throw new Error("연표 응답 형식을 확인해야 합니다.");
      const fresh = model.registry(localStorage, captured.uid), meta2 = fresh.docs.find(row => row.id === id);
      if (!meta2) return;
      if (!rows[0]) {
        if (meta2.syncedAt) { dropDeleted(captured, fresh, meta2); notify(captured); return; }
        continue;
      }
      const outcome = reconcileDoc(captured, fresh, meta2, rows[0]);
      localStorage.setItem(k.registry, JSON.stringify(fresh));
      if (outcome === "remote") return;
    }
    throw new Error("서버 사본과 계속 충돌했습니다. 기기 사본은 보존했습니다. 잠시 뒤 다시 시도해 주세요.");
  }
  async function uploadQueued(id, captured) {
    try { await uploadDoc(captured, id); docErrors.delete(id); }
    catch (error) {
      // A timeout is "not sent yet" (waiting), sent again on the next wake-up or retry.
      if (current(captured)) { if (error?.code === "timeout") docErrors.delete(id); else docErrors.set(id, error?.message || "연표를 계정에 올리지 못했습니다."); }
    }
    notify(captured);
    // Recovery documents this store made are sent too (only its own: see ownedDocs).
    if (current(captured)) for (const meta of model.registry(localStorage, captured.uid).docs)
      if (ownedDocs.has(meta.id) && meta.updated !== meta.syncedAt && meta.id !== id && !docQueue.pending(meta.id) && !docErrors.has(meta.id)) docQueue.schedule(meta.id);
  }
  // The timeline the schedule uses (model.baseDocument): the account's recorded choice when it is
  // here, chosen the same way on every device otherwise. Memoised on the list and record text.
  let baseMemo = null;
  function readBase(captured) {
    try { const value = JSON.parse(localStorage.getItem(model.keys(captured.uid).base)); return value && typeof value.docId === "string" && typeof value.chosenAt === "string" ? value : null; }
    catch (_) { return null; }
  }
  function writeBase(captured, docId, chosenAt = new Date().toISOString()) {
    const value = { docId, chosenAt };
    localStorage.setItem(model.keys(captured.uid).base, JSON.stringify(value)); baseMemo = null;
    return value;
  }
  // A recorded timeline this device has not received yet (another device chose it): 행복도 waits
  // for it, instead of going to another timeline or replacing the account's choice.
  function waitingFor(captured) {
    const record = readBase(captured);
    if (!record) return null;
    return model.registry(localStorage, captured.uid).docs.some(doc => doc.id === record.docId) ? null : record.docId;
  }
  function baseDoc(captured) {
    const k = model.keys(captured.uid), regText = localStorage.getItem(k.registry), baseText = localStorage.getItem(k.base);
    const key = [captured.uid, regText, baseText, serverIds ? [...serverIds].join() : ""].join("\u0000");
    if (baseMemo?.key === key) return baseMemo.meta && { ...baseMemo.meta };
    const read = id => { try { return JSON.parse(localStorage.getItem(k.docs + id)); } catch (_) { return null; } };
    const gone = serverIds ? doc => !!doc.syncedAt && !serverIds.has(doc.id) && doc.syncedAt <= serverSeen : null;
    const meta = model.baseDocument(model.registry(localStorage, captured.uid), { record: readBase(captured)?.docId || null, read, gone });
    baseMemo = { key, meta: meta && { ...meta } };
    return meta;
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
      loadPending(captured);
      return store;
    },
    // Initialise only when this account is not the one already open (keeps a running queue).
    ensure(account) {
      if (account && uid === account && accountProject === project() && auth.user?.id === account) return store;
      return store.init(account);
    },
    get account() { return uid && auth.user?.id === uid && accountProject === project() ? uid : null; },
    // The 일정 screen owns the timeline documents it shows: it keeps them current on wake-ups and
    // sends what it changed. Pages with their own editor (timeline.html) do not call this.
    followDocuments() { context(); following = true; },
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
          // Only this device changed it: the 일정 screen sends it (also after a reopen, when no
          // page remembers having written it); other pages leave it to their own uploader.
          if (meta.syncedAt === row.updated_at || !meta.syncedAt) {
            if (following || ownedDocs.has(meta.id)) { ownedDocs.add(meta.id); docQueue?.schedule(meta.id); }
            continue;
          }
          const outcome = reconcileDoc(captured, reg, meta, row);
          if (outcome !== "remote" && (following || ownedDocs.has(meta.id))) { ownedDocs.add(meta.id); docQueue?.schedule(meta.id); }
          continue;
        }
        const body = JSON.stringify(row.data);
        if (!meta || meta.syncedAt !== row.updated_at) localStorage.setItem(k.docs + row.id, body);
        lastSynced.set(row.id, body);
        const next = { id: row.id, name: row.name, updated: row.updated_at,
          syncedAt: row.updated_at, cloudAccount: account };
        if (meta) Object.assign(meta, next); else reg.docs.push(next);
      }
      if (!reg.current && reg.docs.length) reg.current = reg.docs[0].id;
      // 행복도 pressed while its timeline had not arrived: applied now that it is here (a value the
      // other device set later for the same day wins; this device's is kept as a recovery copy).
      for (const [id, days] of [...pendingHappiness]) {
        const meta = reg.docs.find(doc => doc.id === id);
        if (!meta || meta.updated !== meta.syncedAt) continue;     // a changed document already carries its days
        let doc;
        try { doc = JSON.parse(localStorage.getItem(k.docs + id)); } catch (_) { continue; }
        if (!doc) continue;
        let next = doc, lost = false;
        for (const [date, entry] of days) {
          const there = scoreOn(doc, date);
          if (there !== null && there !== entry.n && !model.localWins(entry.at, meta.syncedAt)) { lost = true; continue; }
          next = model.withHappiness(next, date, entry.n);
        }
        if (lost) keepLoserDoc(captured, reg, meta.name, applyPending(doc, days), next);
        if (HaedoData.contentKey(next) === HaedoData.contentKey(doc)) { pendingHappiness.delete(id); continue; }
        lastSynced.set(id, JSON.stringify(doc));
        localStorage.setItem(k.docs + id, JSON.stringify(next));
        meta.updated = new Date(Math.max(Date.now(), Date.parse(meta.updated || "") + 1 || 0)).toISOString();
        ownedDocs.add(id); docQueue?.schedule(id);
      }
      savePending(captured);
      localStorage.setItem(k.registry, JSON.stringify(reg));
      serverIds = new Set(rows.map(row => row.id)); baseMemo = null;
      serverSeen = rows.reduce((latest, row) => (row.updated_at || "") > latest ? row.updated_at : latest, "");
      // Changed documents this store wrote that the server does not have yet (new ones), and on the
      // 일정 screen recovery copies never sent (a copy made before a reopen is remembered by no page).
      for (const meta of reg.docs)
        if (!meta.syncedAt && meta.updated && !serverIds.has(meta.id) && (ownedDocs.has(meta.id) || following && HaedoData.isRecoveryName(meta.name))) {
          ownedDocs.add(meta.id); docQueue?.schedule(meta.id);
        }
      // A recorded timeline deleted on another device (this device had it on the account and it is
      // gone): choose again and record it. One not received yet is waited for, not replaced.
      const record = readBase(captured), recorded = record && reg.docs.find(doc => doc.id === record.docId);
      if (recorded && recorded.syncedAt && !serverIds.has(recorded.id) && recorded.syncedAt <= serverSeen) {
        localStorage.removeItem(k.base); baseMemo = null;
        const next = baseDoc(captured);
        if (next) writeBase(captured, next.id);
      }
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
    // Explicit upload (goals/habits screens' sync, timeline import): only changed documents are sent.
    async uploadDocuments(ids) {
      const captured = context();
      for (const id of ids) await uploadDoc(captured, id);
      notify(captured);
    },
    // 행복도 of one day in the base timeline (null when not recorded).
    happiness(date) {
      if (!store.account) return null;
      const captured = context(), waiting = waitingFor(captured);
      if (waiting) { const entry = pendingHappiness.get(waiting)?.get(date); return entry && entry.n !== null ? { score: entry.n } : null; }
      const meta = baseDoc(captured);
      if (!meta) return null;
      try { return model.happinessOn(JSON.parse(localStorage.getItem(model.keys(captured.uid).docs + meta.id)), date); }
      catch (_) { return null; }
    },
    // Sets (0–10) or clears (null) that day's 행복도 in the base timeline. With no timeline yet,
    // saving the first value creates "내 연표" (the timeline editor's default); viewing never does.
    setHappiness(date, n) {
      const captured = context(), k = model.keys(captured.uid), reg = model.registry(localStorage, captured.uid);
      const waiting = waitingFor(captured);
      if (waiting) {
        // Kept on this device until the recorded timeline arrives (applied in syncDocuments).
        if (!pendingHappiness.has(waiting)) pendingHappiness.set(waiting, new Map());
        pendingHappiness.get(waiting).set(date, { n, at: new Date().toISOString() });
        savePending(captured); ownedDocs.add(waiting); notify(captured);
        return waiting;
      }
      let meta = baseDoc(captured), doc;
      if (meta) meta = reg.docs.find(row => row.id === meta.id);
      if (!meta) {
        if (n === null) return null;
        meta = { id: model.newId(), name: "내 연표", updated: null };
        doc = model.emptyDocument("내 연표");
        reg.docs.push(meta); reg.current ||= meta.id;
      } else {
        const body = localStorage.getItem(k.docs + meta.id);
        doc = JSON.parse(body);
        // A clean document is the server copy: remember it for a day-by-day rebase.
        if (meta.syncedAt && meta.updated === meta.syncedAt) lastSynced.set(meta.id, body);
      }
      const next = model.withHappiness(doc, date, n);
      meta.updated = new Date(Math.max(Date.now(), Date.parse(meta.updated || "") + 1 || 0)).toISOString();
      // Body first, list last: a failed list write leaves the old list pointing at a valid body.
      localStorage.setItem(k.docs + meta.id, JSON.stringify(next));
      localStorage.setItem(k.registry, JSON.stringify(reg));
      // The first value records which timeline the schedule writes to (mirrored to the account;
      // every device follows it). A recorded timeline not on this device yet is not replaced.
      if (!readBase(captured)) writeBase(captured, meta.id);
      if (!pendingHappiness.has(meta.id)) pendingHappiness.set(meta.id, new Map());
      pendingHappiness.get(meta.id).set(date, { n, at: meta.updated });
      savePending(captured);
      ownedDocs.add(meta.id);
      docErrors.delete(meta.id); docQueue.schedule(meta.id); notify(captured);
      return meta.id;
    },
    // The timeline the schedule writes to: its id and name, and the recorded choice (docId,
    // chosenAt) that the 일정 screen mirrors to the account (platformBase).
    get base() {
      if (!store.account) return null;
      const captured = context(), record = readBase(captured), waiting = waitingFor(captured);
      if (waiting) return { docId: waiting, name: null, waiting: true, record };
      const meta = baseDoc(captured);
      // Two timelines with the same name (each device made "내 연표"): the date it was last changed tells them apart.
      const twins = meta && model.registry(localStorage, captured.uid).docs.filter(doc => doc.name === meta.name && !HaedoData.isRecoveryName(doc.name)).length > 1;
      const when = meta?.updated && !Number.isNaN(Date.parse(meta.updated)) ? new Date(meta.updated).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }) : "";
      return { docId: meta?.id || null, name: meta ? meta.name + (twins && when ? " (" + when + " 수정)" : "") : null, waiting: false, record };
    },
    // A choice recorded on the account (another device): the later choice wins.
    adoptBase(value) {
      const captured = context();
      if (!value || typeof value.docId !== "string" || typeof value.chosenAt !== "string") return false;
      const local = readBase(captured);
      if (local && (local.docId === value.docId || local.chosenAt >= value.chosenAt)) return false;
      writeBase(captured, value.docId, value.chosenAt); notify(captured);
      return true;
    },
    // Upload state of the base timeline: "ok" | "pending" | "error" (null without one).
    happinessState() {
      if (!store.account) return null;
      const captured = context(), waiting = waitingFor(captured);
      if (waiting) return pendingHappiness.get(waiting)?.size ? "pending" : null;
      const meta = baseDoc(captured);
      if (!meta) return null;
      if (docErrors.has(meta.id)) return "error";
      return meta.updated === meta.syncedAt ? "ok" : "pending";
    },
    // Resends documents this store owns that are not on the server yet.
    retryDocuments() {
      if (!store.account) return;
      const captured = context();
      // The 일정 screen also sends changed documents it read from the account (a reopened page
      // remembers no writes); a never-sent document is sent only by the page that made it.
      for (const meta of model.registry(localStorage, captured.uid).docs)
        if (meta.updated !== meta.syncedAt && (ownedDocs.has(meta.id) || following && meta.syncedAt)) { docErrors.delete(meta.id); docQueue.schedule(meta.id); }
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
  // again or the network returns. The 일정 screen also refreshes its timeline and resends what it
  // changed; other pages leave documents to their own editor. Without the module (an older cached
  // page) only explicit and start-up syncs run.
  const wake = () => {
    if (!store.account) return;
    pull().catch(() => {});
    if (following) store.syncDocuments().catch(() => {}).finally(() => store.retryDocuments());
    else store.retryDocuments();
  };
  const visible = () => { if (!document.hidden) wake(); };
  root.HaedoLife?.SyncLifecycle?.attach(root, { listen: [["document", "visibilitychange", visible], ["window", "online", wake]] });
  root.HaedoPlatformStore = store;
})(globalThis);

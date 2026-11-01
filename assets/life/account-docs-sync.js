/* Automatic account-document sync (owner directive 2026-11-01).
 * Every small device-local document of the signed-in account (settings, reading
 * position, plans, drafts, ...) is replicated to the account's other devices
 * without any per-device choice. Sync is not publication. Local rows are never
 * deleted: a conflict keeps the losing content as a local recovery copy, and a
 * remote value is written only while the local value is unchanged (local CAS),
 * so a save racing with a remote apply always survives. Open editors decide on
 * their own whether to reload (see `account_doc_applied`).
 */
(function (root, factory) {
  'use strict';
  const api = factory(root); root.HaedoLife ||= {}; root.HaedoLife.AccountDocsSync = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const EPOCH = '1970-01-01T00:00:00.000Z';
  // Local saves of these types may change a synced document.
  const TRIGGERS = new Set(['account_doc_changed', 'reading_position_changed', 'interest_profile_changed', 'annual_plan_changed',
    'discovery_profile_changed', 'discovery_settings_changed', 'discovery_language_settings_changed', 'discovery_actions_changed',
    'discovery_reading_changed', 'public_cover_changed', 'photo_posts_changed', 'workbench_changed']);
  const STOP = new Set(['auth_required', 'request_cancelled', 'schema_missing', 'permission_denied', 'storage_scope_closed', 'storage_closed']);
  const fault = (code, message) => Object.assign(new Error(message || '자동 저장을 진행하지 못했습니다.'), { code });
  const time = value => { const parsed = Date.parse(value || EPOCH); return Number.isFinite(parsed) ? parsed : 0; };
  // List-shaped documents merge item by item against the last agreed base, so
  // concurrent additions on two devices both survive and a deletion is not
  // undone by a device that never touched the item. Single-value documents
  // (settings, reading position, evidence, reading evaluation) keep
  // whole-document latest-wins.
  const byDate = field => (a, b) => String(a[field] ?? '').localeCompare(String(b[field] ?? ''));
  const LISTS = Object.freeze({
    'page-drafts': [{ path: 'posts', key: 'id', time: 'updatedAt' }],
    'public-cover': [{ path: 'covers', key: 'id' }],
    discoveryActions: [{ path: 'entries', key: 'canonicalUrl', time: 'updatedAt' }],
    discoveryProfile: [{ path: 'feedback', key: 'canonicalUrl', time: 'updatedAt' }],
    interestProfile: [{ path: 'manual', key: 'id' }, { path: 'confirmedIds' }],
    annualPlan: [{ path: 'rows', key: 'year', sort: (a, b) => a.year - b.year }, { path: 'entries', key: 'id', sort: byDate('date') }]
  });
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).filter(key => value[key] !== undefined).sort()
      .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(value ?? null);
  }
  const same = (a, b) => canonical(a) === canonical(b);
  const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
  // 3-way merge of one list by item key. `localWins` decides an item both sides
  // changed when it carries no comparable time. Losing item versions are returned.
  function mergeList(spec, base, local, remote, localWins) {
    const keyOf = item => spec.key ? item?.[spec.key] : canonical(item);
    const index = list => new Map((Array.isArray(list) ? list : []).map(item => [canonical(keyOf(item)), item]));
    const B = index(base), L = index(local), R = index(remote), chosen = new Map(), lost = [];
    for (const id of new Set([...L.keys(), ...R.keys()])) {
      const b = B.get(id), l = L.get(id), r = R.get(id);
      if (l !== undefined && r !== undefined && same(l, r)) chosen.set(id, l);
      else if (l === undefined) { if (b === undefined || !same(r, b)) chosen.set(id, r); }       // added there, or edited there after a delete here
      else if (r === undefined) { if (b === undefined || !same(l, b)) chosen.set(id, l); }       // added here, or edited here after a delete there
      else if (b !== undefined && same(l, b)) chosen.set(id, r);
      else if (b !== undefined && same(r, b)) chosen.set(id, l);
      else {
        const lt = spec.time ? time(l[spec.time]) : 0, rt = spec.time ? time(r[spec.time]) : 0;
        const keepLocal = lt !== rt ? lt > rt : localWins;
        chosen.set(id, keepLocal ? l : r); lost.push(keepLocal ? r : l);
      }
    }
    const first = localWins ? local : remote, second = localWins ? remote : local, result = [], used = new Set();
    for (const list of [first, second]) for (const item of Array.isArray(list) ? list : []) {
      const id = canonical(keyOf(item));
      if (chosen.has(id) && !used.has(id)) { used.add(id); result.push(chosen.get(id)); }
    }
    if (spec.sort) result.sort(spec.sort);
    return { list: result, lost };
  }
  function mergeDocument(prefix, base, local, remote, localWins) {
    const lists = LISTS[prefix];
    if (!lists || !plainObject(local) || !plainObject(remote) || (base !== null && base !== undefined && !plainObject(base))) return null;
    const merged = {}, lost = [], listPaths = new Set(lists.map(spec => spec.path));
    for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      if (listPaths.has(key)) continue;
      const b = base?.[key], l = local[key], r = remote[key];
      let value;
      if (key === 'revision') value = Math.max(Number.isSafeInteger(l) ? l : 0, Number.isSafeInteger(r) ? r : 0);
      else if (key === 'updatedAt' && typeof l === 'string' && typeof r === 'string') value = l > r ? l : r;
      else value = same(l, r) || same(r, b) ? l : same(l, b) ? r : localWins ? l : r;
      if (value !== undefined) merged[key] = value;
    }
    for (const spec of lists) {
      const result = mergeList(spec, base?.[spec.path], local[spec.path], remote[spec.path], localWins);
      merged[spec.path] = result.list; lost.push(...result.lost);
    }
    return { value: merged, lost };
  }
  const content = value => plainObject(value) ? canonical({ ...value, revision: 0 }) : canonical(value);
  function uuid() {
    if (root.crypto?.randomUUID) return root.crypto.randomUUID();
    const bytes = new Uint8Array(16); root.crypto.getRandomValues(bytes); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  function create({ storage, auth = root.HaedoAuth, remote = null, polling = true, debounceMs = 800, intervalMs = 30000,
    now = () => new Date().toISOString(), locks = root.navigator?.locks, online = () => root.navigator?.onLine !== false,
    unavailableMs = 5 * 60 * 1000, clock = () => Date.now() } = {}) {
    if (!storage?.account || typeof storage.listAccountDocs !== 'function' || !auth) throw fault('account_mismatch', '현재 계정의 자동 저장을 준비하지 못했습니다.');
    const owner = storage.account, listeners = new Set();
    const client = remote || root.HaedoLife?.AccountDocsRemote?.create({ auth, ownerId: owner.userId });
    if (!client) throw fault('dependency_unavailable', '자동 저장 연결을 준비하지 못했습니다.');
    let disposed = false, started = false, timer = null, interval = null, unlisten = null, running = null, again = false;
    // Between a persisted pagehide and its pageshow the page sits in the
    // back/forward cache: starting work there evicts it, and an account check
    // begun before pageshow must not stand in for the resumed page's own.
    let parked = false;
    // A server without the account-document RPCs is 'unavailable': local saves
    // stay pending and the server is asked again only after a growing pause.
    let unavailableUntil = 0, unavailableDelay = 0;
    // While a page is suspended (bfcache/history) no pass may send with the old
    // session; the shell's own fresh verification is followed by haedo:page-ready.
    let suspended = false;
    let status = { state: 'idle', pending: 0, error: null, lastSyncedAt: null };
    const changeTimes = new Map(); // key -> time of the first local save seen since the last mark
    const sameAccount = value => value?.userId === owner.userId && value?.projectUrl === owner.projectUrl;
    const lockName = `haedo-account-docs:${owner.projectUrl}|${owner.userId}`;
    function guard() { if (disposed || !sameAccount(auth.getAccount?.())) throw fault('request_cancelled', '계정이 바뀌어 이전 자동 저장을 중단했습니다.'); }
    function emit(next) {
      status = { ...status, ...next };
      for (const listener of [...listeners]) { try { listener({ ...status }); } catch (_) { /* Advisory. */ } }
    }
    const fresh = key => ({ docKey: key, revision: 0, seq: 0, hash: null, remoteHash: null, pendingHash: null, changedAt: null,
      operationId: null, operationExpected: null, operationHash: null, error: null, deferred: null });
    const saveSync = async (key, state, base) => { guard(); return storage.writeAccountDocSync(key, state, base); };
    const errorOf = error => ({ code: typeof error?.code === 'string' ? error.code : 'network_error', message: error?.message || '자동 저장을 진행하지 못했습니다.' });

    // A remote row is applied only through the storage CAS. A pending local
    // change makes it a conflict decided by latest client_updated_at; a tie is
    // broken by content hash so every device picks the same winner.
    async function receive(row) {
      guard();
      let record;
      try { record = await storage.readAccountDocRecord(row.docKey); }
      catch (error) {
        if (['account_doc_invalid_key', 'workspace_access_denied'].includes(error?.code)) return 'ignored';
        throw error;
      }
      guard();
      const sync = { ...fresh(row.docKey), ...(record.sync || {}) };
      if (row.revision <= sync.revision) {
        if (sync.deferred && sync.deferred.revision <= sync.revision) await saveSync(row.docKey, { ...sync, deferred: null });
        return 'known';
      }
      const base = { revision: row.revision, seq: Math.max(sync.seq, row.seq || 0), deferred: null, error: null,
        operationId: null, operationExpected: null, operationHash: null };
      if (row.deleted) {
        // A server tombstone never deletes local data; a later local edit revives it.
        await saveSync(row.docKey, { ...sync, ...base, remoteHash: null, hash: record.exists ? record.hash : sync.hash });
        return 'tombstone';
      }
      const remoteHash = storage.accountDocHash(row.data);
      if (record.exists && record.hash === remoteHash) {
        await saveSync(row.docKey, { ...sync, ...base, hash: record.hash, remoteHash, pendingHash: null, changedAt: null }, record.value);
        return 'adopted';
      }
      const pending = record.exists && (!record.sync || record.hash !== sync.hash);
      // Content that existed here before this account sync ever ran counts as
      // the oldest possible edit, so an already-synced copy wins and the local
      // one is kept as a recovery copy.
      const firstSync = !record.sync || sync.changedAt === EPOCH;
      let remoteWins = true, reason = null;
      if (pending) {
        const localTime = firstSync ? time(EPOCH) : time(sync.pendingHash === record.hash && sync.changedAt ? sync.changedAt : now());
        const remoteTime = time(row.client_updated_at);
        remoteWins = remoteTime > localTime || (remoteTime === localTime && String(remoteHash) > String(record.hash));
        reason = firstSync ? 'first_sync' : 'conflict';
      }
      const keepLocal = { ...sync, ...base, remoteHash, changedAt: sync.changedAt || (firstSync ? EPOCH : now()), pendingHash: sync.pendingHash || record.hash };
      if (pending) {
        // List documents: keep every item either side added and only resolve
        // items both sides changed. Only those losing item versions are copied.
        const merged = mergeDocument(record.prefix, record.base, record.value, row.data, !remoteWins);
        if (merged && content(merged.value) !== content(row.data)) {
          if (merged.lost.length && record.recovery) await storage.saveAccountDocRecovery(row.docKey, { items: merged.lost }, 'merge_conflict');
          if (content(merged.value) === content(record.value)) { await saveSync(row.docKey, keepLocal, row.data); return 'kept_local'; }
          guard();
          const result = await storage.applyAccountDoc(row.docKey, { value: merged.value, expectedHash: record.hash,
            sync: { ...sync, ...base, remoteHash, pendingHash: null, changedAt: now() }, pending: true, base: row.data });
          guard();
          if (result.status === 'applied') return 'merged';
          if (result.status === 'changed') {
            await saveSync(row.docKey, { ...sync, deferred: { revision: row.revision, seq: row.seq || 0, data: row.data, deleted: false, client_updated_at: row.client_updated_at ?? null } });
            return 'retry';
          }
          // The merged value does not validate here (e.g. a reset on one side):
          // fall back to whole-document latest-wins below.
        } else if (merged) {
          if (merged.lost.length && record.recovery) await storage.saveAccountDocRecovery(row.docKey, { items: merged.lost }, 'merge_conflict');
          remoteWins = true; reason = null;
        }
      }
      if (!remoteWins) {
        // This device's newer content stays and is sent next; the remote
        // content it replaces is kept here as a recovery copy.
        if (record.recovery) await storage.saveAccountDocRecovery(row.docKey, row.data, 'conflict_remote');
        await saveSync(row.docKey, keepLocal, row.data);
        return 'kept_local';
      }
      guard();
      const result = await storage.applyAccountDoc(row.docKey, { value: row.data, expectedHash: record.hash,
        sync: { ...sync, ...base, remoteHash, pendingHash: null, changedAt: null }, recoveryReason: reason });
      guard();
      if (result.status === 'applied') return 'applied';
      // Changed meanwhile (decide again next pass) or not applicable here yet
      // (e.g. a newer app version's format): keep the row and retry later.
      await saveSync(row.docKey, { ...sync, deferred: { revision: row.revision, seq: row.seq || 0, data: row.data, deleted: false,
        client_updated_at: row.client_updated_at ?? null }, error: result.status === 'rejected' ? result.error : null });
      return result.status === 'changed' ? 'retry' : 'deferred';
    }
    async function pull() {
      let cursor = await storage.readAccountDocCursor(), retry = false;
      // A stored cursor also records that this account has synced on this device.
      // Written once; later only new rows move it, so idle passes write nothing.
      if (cursor === null) cursor = await storage.writeAccountDocCursor(0);
      for (;;) {
        guard();
        const rows = await client.changes(cursor, client.PAGE_LIMIT || 200); guard();
        for (const row of rows) {
          if ((await receive(row)) === 'retry') retry = true;
          cursor = await storage.writeAccountDocCursor(row.seq);
        }
        if (rows.length < (client.PAGE_LIMIT || 200)) break;
      }
      return retry;
    }
    async function retryDeferred(docs) {
      let retry = false;
      for (const doc of docs) if (doc.sync?.deferred) {
        const row = { docKey: doc.key, ...doc.sync.deferred };
        await saveSync(doc.key, { ...doc.sync, deferred: null });
        if ((await receive(row)) === 'retry') retry = true;
      }
      return retry;
    }
    async function push(key) {
      for (let attempt = 0; attempt < 3; attempt++) {
        guard();
        const record = await storage.readAccountDocRecord(key); guard();
        if (!record.exists) return 'missing';
        const sync = { ...fresh(key), ...(record.sync || {}) };
        if (record.sync && record.hash === sync.hash) return 'clean';
        if (sync.deferred) return 'deferred';
        if (sync.pendingHash !== record.hash || !sync.changedAt) {
          // Pushes run after this cycle's pull stored the cursor, so a document
          // without sync state here is a new edit, not pre-sync content.
          sync.changedAt = changeTimes.get(key) || (record.sync && sync.changedAt === EPOCH ? EPOCH : now()); sync.pendingHash = record.hash;
        }
        if (!(sync.operationId && sync.operationHash === record.hash && sync.operationExpected === sync.revision)) {
          sync.operationId = uuid(); sync.operationHash = record.hash; sync.operationExpected = sync.revision;
        }
        // Persist the operation first: a lost reply is replayed with the same id.
        await saveSync(key, sync);
        let result;
        try {
          result = await client.put({ docKey: key, expectedRevision: sync.revision, operationId: sync.operationId,
            data: record.value, deleted: false, clientUpdatedAt: sync.changedAt });
        } catch (error) {
          guard();
          if (!STOP.has(error?.code) && error?.code !== 'network_error') {
            // A request this document can never satisfy (e.g. too large) stays local.
            await saveSync(key, { ...sync, operationId: null, operationHash: null, operationExpected: null, error: errorOf(error) });
            return 'failed';
          }
          await saveSync(key, { ...sync, error: errorOf(error) });
          throw error;
        }
        guard();
        if (result.status === 'stored') {
          await saveSync(key, { ...sync, revision: result.revision, seq: Math.max(sync.seq, result.seq), hash: record.hash, remoteHash: record.hash,
            pendingHash: null, changedAt: null, operationId: null, operationHash: null, operationExpected: null, error: null }, record.value);
          return 'stored';
        }
        await saveSync(key, { ...sync, operationId: null, operationHash: null, operationExpected: null });
        if (!result.current) {
          // The server no longer has the document; send it again as new.
          await saveSync(key, { ...sync, revision: 0, operationId: null, operationHash: null, operationExpected: null });
          continue;
        }
        const outcome = await receive({ docKey: key, seq: result.seq || 0, ...result.current });
        if (outcome !== 'kept_local') return outcome;
      }
      return 'retry';
    }
    // Stamp each new local change with the time it was first seen. This runs
    // offline too, so a later conflict compares real edit times.
    async function mark() {
      const docs = await storage.listAccountDocs(); guard();
      // Before this account's first sync on this device every existing document
      // is "pre-sync" content; afterwards a new document is a real new edit.
      const initialized = (await storage.readAccountDocCursor()) !== null; guard();
      for (const doc of docs) {
        if (doc.sync && doc.hash === doc.sync.hash) continue;
        const sync = { ...fresh(doc.key), ...(doc.sync || {}) };
        if (doc.sync && sync.pendingHash === doc.hash && sync.changedAt) continue;
        const seen = changeTimes.get(doc.key);
        const stamp = seen || (!doc.sync ? (initialized ? now() : EPOCH) : sync.changedAt === EPOCH ? EPOCH : now());
        await saveSync(doc.key, { ...sync, pendingHash: doc.hash, changedAt: stamp });
      }
      changeTimes.clear();
    }
    async function cycle() {
      guard();
      await mark();
      if (suspended) return;
      if (!online()) { emit({ state: 'offline' }); return; }
      if (clock() < unavailableUntil) { emit({ state: 'unavailable' }); return; }
      emit({ state: 'syncing' });
      let retry = await pull();
      let docs = await storage.listAccountDocs(); guard();
      if (await retryDeferred(docs)) retry = true;
      docs = await storage.listAccountDocs(); guard();
      for (const doc of docs) {
        if (doc.sync && doc.hash === doc.sync.hash) continue;
        if (doc.sync?.deferred) continue;
        if ((await push(doc.key)) === 'retry') retry = true;
      }
      docs = await storage.listAccountDocs(); guard();
      const pending = docs.filter(doc => !doc.sync || doc.hash !== doc.sync.hash).length;
      unavailableDelay = 0;
      emit({ state: pending ? 'pending' : 'synced', pending, error: null, lastSyncedAt: pending ? status.lastSyncedAt : now() });
      if (retry) schedule(debounceMs);
    }
    function run() {
      if (disposed || parked) return Promise.resolve();
      if (running) { again = true; return running; }
      const exclusive = task => locks?.request ? locks.request(lockName, { mode: 'exclusive' }, task) : task();
      running = (async () => {
        try {
          do { again = false; await exclusive(cycle); } while (again && !disposed);
        } catch (error) {
          if (!disposed && error?.code === 'schema_missing') {
            unavailableDelay = Math.min(Math.max(unavailableDelay * 2, unavailableMs), 60 * 60 * 1000);
            unavailableUntil = clock() + unavailableDelay;
            emit({ state: 'unavailable', error: errorOf(error) });
          } else if (!disposed) emit({ state: error?.code === 'network_error' ? 'offline' : 'error', error: errorOf(error) });
        } finally { running = null; }
      })();
      return running;
    }
    function schedule(delay = debounceMs) {
      if (disposed || !started || parked) return;
      root.clearTimeout(timer);
      timer = root.setTimeout(() => { timer = null; run(); }, delay);
      timer?.unref?.();
    }
    const wake = () => { if (!suspended) schedule(0); };
    const suspend = () => { suspended = true; root.clearTimeout(timer); timer = null; };
    const ready = () => { if (!suspended) return; suspended = false; schedule(0); };
    const visibility = () => wake(); // Hidden: flush pending saves now; visible: pull other devices' changes.
    // A cached page resumes on the regular poll, after its own account check.
    const pagehide = event => { if (event?.persisted) { parked = true; root.clearTimeout(timer); timer = null; } };
    const pageshow = event => { if (event?.persisted) parked = false; };
    function start() {
      guard(); if (started) return; started = true;
      unlisten = storage.subscribeAll(event => {
        if (event?.type === 'account_doc_applied' || !TRIGGERS.has(event?.type)) return;
        if (event.type === 'account_doc_changed' && typeof event.key === 'string' && !changeTimes.has(event.key)) changeTimes.set(event.key, now());
        schedule(debounceMs);
      });
      root.addEventListener?.('online', wake); root.addEventListener?.('focus', wake);
      root.document?.addEventListener?.('visibilitychange', visibility);
      root.document?.addEventListener?.('haedo:page-suspend', suspend); root.document?.addEventListener?.('haedo:page-ready', ready);
      root.addEventListener?.('pagehide', pagehide); root.addEventListener?.('pageshow', pageshow);
      // Poll only while visible; hiding the page flushes once through visibilitychange.
      if (polling) { interval = root.setInterval(() => { if (root.document?.visibilityState !== 'hidden') run(); }, intervalMs); interval?.unref?.(); }
      run();
    }
    function dispose() {
      if (disposed) return; disposed = true;
      root.clearTimeout(timer); root.clearInterval(interval); unlisten?.(); listeners.clear();
      root.removeEventListener?.('online', wake); root.removeEventListener?.('focus', wake);
      root.document?.removeEventListener?.('visibilitychange', visibility);
      root.document?.removeEventListener?.('haedo:page-suspend', suspend); root.document?.removeEventListener?.('haedo:page-ready', ready);
      root.removeEventListener?.('pagehide', pagehide); root.removeEventListener?.('pageshow', pageshow);
      client.dispose?.();
    }
    function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
    return Object.freeze({ start, syncNow: run, getStatus: () => ({ ...status }), subscribe, dispose });
  }
  return Object.freeze({ create, mergeDocument, LISTS });
});

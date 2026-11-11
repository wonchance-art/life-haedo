/* Every writing draft of the signed-in account syncs automatically through the tested CAS/lifetime
 * engine (one engine per draft, polling off). Conflicts keep the newest edit and store the other
 * side as a new unlinked draft through the existing fork/recovery transaction. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).WritingSync = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  // S2: page-lifecycle wiring (sync-lifecycle.js). An older cached page may lack it: the engine
  // then runs its explicit and start-up passes only, until the page reloads.
  const syncLifecycle = () => root.HaedoLife?.SyncLifecycle || (typeof require === 'function' ? require('./sync-lifecycle.js') : null);
  const time = value => { const parsed = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : null; };
  // A saved record is terminal: keep it and recover the other input as a new draft.
  // Otherwise the newer edit time wins; ties converge on the server copy.
  function latest({ local, remote }) {
    const other = remote?.data;
    if (local?.state === 'applied' || other?.state === 'applied') return 'fork';
    const mine = time(local?.updatedAt), theirs = time(other?.updatedAt);
    if (mine === null) return 'remote';
    return theirs !== null && theirs >= mine ? 'remote' : 'local';
  }
  function create({ storage, sourceSync, auth = root.HaedoAuth,
    remote = root.HaedoLife?.WritingRemote?.create({ auth }), engine = root.HaedoLife?.CompositionSync,
    materials = undefined, interval: every = 30000 } = {}) {
    const clean = root.HaedoLife?.WritingRemote?.clean || (error => error);
    const fault = code => clean({ code });
    if (!storage?.account || !sourceSync || !auth || !remote || !engine) throw fault('account_mismatch');
    const owner = storage.account, entries = new Map(), listeners = new Set();
    let disposed = false, started = false, wiring = null, refreshing = null, again = false, soon = null, offAll = null, material = null;
    const same = value => value?.userId === owner.userId && value?.projectUrl === owner.projectUrl;
    const guard = epoch => { if (disposed || !same(auth.getAccount()) || epoch !== undefined && epoch !== auth.epoch) throw fault('request_cancelled'); };
    const binding = ws => ({ ...owner, remoteId: ws });
    const emit = (workspaceId, draftId, extra = null) => { if (!disposed) for (const listener of listeners) { try { listener({ workspaceId, draftId, ...(extra || {}) }); } catch (_) {} } };
    function entry(ws, id) {
      guard(); const key = ws + '/' + id;
      if (entries.has(key)) return entries.get(key);
      // Engine identities are local queue keys only. Every persistence/HTTP call below
      // explicitly restores the real workspace + draft tuple and account binding.
      const stateForEngine = state => state && ({ ...state, workspaceId: id, binding: { ...state.binding, remoteId: id } });
      const adapter = {
        account: owner,
        getCompositionState: async () => stateForEngine(await storage.getWritingSyncState(ws, id)),
        bindCompositionSync: () => storage.bindWritingSync(ws, id, binding(ws)),
        pauseCompositionSync: () => storage.pauseWritingSync(ws, id, binding(ws)),
        prepareCompositionUpload: () => storage.prepareWritingUpload(ws, id, binding(ws)),
        ackCompositionSync: (_, __, operation, revision) => storage.ackWritingSync(ws, id, binding(ws), operation, revision),
        applyCompositionRemote: (_, __, row) => storage.applyWritingRemote(ws, id, binding(ws), row),
        setCompositionConflict: (_, __, row) => storage.setWritingConflict(ws, id, binding(ws), row),
        setCompositionError: (_, __, error) => storage.setWritingError(ws, id, binding(ws), error),
        resolveCompositionSync: (_, __, request) => storage.resolveWritingSync(ws, id, binding(ws), request),
        dismissCompositionNotice: () => storage.dismissWritingNotice(ws, id),
        readWorkbenchSnapshot: async () => { const value = await storage.readWritingSnapshot(ws, id); return { workbench: value.stage, bundle: value.bundle }; },
        listWorkspaces: async () => { const state = await getState(ws, id); return state.enabled && state.status !== 'closed' ? [{ workspaceId: id }] : []; },
        // The draft's engine sends a saved change half a second later. A hidden page does that for
        // its own saves only: another tab's save is sent by that tab (both tabs would otherwise
        // send the same stored request, three requests each).
        subscribe: (_, listener) => storage.subscribe(ws, event => {
          if (event.stageId !== id) return;
          if (event.type === 'writing_draft_changed' && (event.local === true || !hidden())) listener({ workspaceId: id, type: 'workbench_changed' });
          if (event.type === 'writing_sync_changed') listener({ workspaceId: id, type: 'composition_sync_changed' });
        })
      };
      const sourceAdapter = { getState: () => sourceSync.getState(ws), syncNow: () => sourceSync.syncNow(ws),
        subscribe: listener => sourceSync.subscribe(event => { if (event.workspaceId === ws) listener({ workspaceId: id }); }) };
      const transport = { read: () => remote.read(ws, id), write: request => remote.write({ ...request, workspaceId: ws, draftId: id }) };
      // A new piece of writing (no original it edits, not yet saved as a record) points at no
      // original: it is sent while the originals are still pending, failing or unmerged.
      const sourceOptional = async () => { const stage = await storage.getStage(id); return !!stage && stage.kind === 'writing' && stage.workspaceId === ws && stage.state === 'draft' && stage.sourceId === null; };
      const instance = engine.create({ storage: adapter, sourceSync: sourceAdapter, auth, remote: transport,
        errorCleaner: clean, resolutionChoices: ['local','remote','fork'], sendResolution: (_, result) => result.metadata.status === 'pending', polling: false,
        autoResolve: latest, sourceOptional });
      instance.subscribe(event => emit(ws, id, event?.autoResolved ? { autoResolved: true, recoveryStageId: event.recoveryId || null } : null));
      const value = { instance, start() { if (!value.started) { value.started = true; instance.start(); } }, started: false };
      entries.set(key, value); return value;
    }
    async function getState(ws, id) {
      guard(); const epoch = auth.epoch;
      const stage = await storage.getStage(id); guard(epoch);
      if (stage && (stage.workspaceId !== ws || stage.kind !== 'writing')) throw fault('account_mismatch');
      const metadata = stage ? await storage.getWritingSyncState(ws, id) : null; guard(epoch);
      return { ...(metadata || {}), workspaceId: ws, draftId: id, stage, enabled: !!metadata?.enabled, notice: metadata?.notice || null,
        status: !metadata ? 'not_enabled' : !metadata.enabled ? 'paused' : stage.state === 'applied' && metadata.status === 'synced' ? 'closed' : metadata.status };
    }
    async function call(method, ws, id, ...args) {
      // Engines are driven by this loop only (no per-draft polling or focus runs): every remote
      // read is decided against the list revision first.
      try { const value = entry(ws, id); return await value.instance[method](id, ...args); }
      catch (error) { throw clean(error); }
    }
    async function sourceReady(ws, floor = 1) {
      guard(); const epoch = auth.epoch;
      const before = await sourceSync.getState(ws); guard(epoch);
      if (!before.enabled || !same(before.binding)) throw fault('writing_source_pending');
      await sourceSync.syncNow(ws); guard(epoch);
      const after = await sourceSync.getState(ws); guard(epoch);
      if (!after.enabled || !same(after.binding) || after.status !== 'synced' || after.remoteRevision < floor) throw fault('writing_source_pending');
    }
    async function listRemote(ws, after = null) {
      const epoch = auth.epoch; await sourceReady(ws); const rows = await remote.list(ws, after); guard(epoch); return rows;
    }
    // `source` is a state the caller already read as enabled and synced for this account;
    // the originals are then refreshed only when the draft needs a newer source head.
    async function download(ws, id, source = null) {
      guard(); const epoch = auth.epoch; if (!source) await sourceReady(ws);
      const row = await remote.read(ws, id); guard(epoch);
      if (!row) throw fault('remote_missing');
      if (!source || row.source_revision > source.remoteRevision) { await sourceReady(ws, row.source_revision); guard(epoch); }
      const existing = await storage.getStage(id); guard(epoch);
      if (existing) {
        if (existing.workspaceId !== ws || existing.kind !== 'writing') throw fault('account_mismatch');
        await call('enable', ws, id); guard(epoch); return { stage: await storage.getStage(id), existing: true };
      }
      const result = await storage.installWritingRemote(ws, binding(ws), row); guard(epoch);
      emit(ws, id, { received: true }); return result;
    }
    // One pass over every workspace whose originals already sync for this account:
    // upload every local draft, keep enabled drafts moving and install drafts that
    // exist only on the server. Each draft fails independently; text stays local.
    // A server without the draft schema is recorded as unavailable and retried with growing
    // back-off (5 min → 1 h) instead of probing every draft on every cycle.
    let availability = { status: 'unknown', until: 0, backoff: 0 };
    const UNAVAILABLE = new Set(['schema_missing', 'permission_denied']);
    function markUnavailable(error) {
      if (!UNAVAILABLE.has(error?.code)) return false;
      const backoff = Math.min(Math.max(availability.backoff * 2, 5 * 60000), 60 * 60000);
      availability = { status: 'unavailable', until: Date.now() + backoff, backoff }; return true;
    }
    // A pass needs a workspace's originals to be connected (enabled, bound to this account, a
    // server revision acknowledged). Drafts that point at an original also need them ready
    // (synced). Workspaces whose originals a pass found not ready are remembered: when the
    // originals engine connects (an open, a reconnect) or such a workspace's originals become ready,
    // a pass runs then instead of at the next poll. Other originals changes start no pass.
    const originalsReady = state => !!state?.enabled && same(state.binding) && state.status === 'synced';
    const waiting = new Set();
    // Server drafts that could not be installed while the originals were not ready (they point at
    // an original that has not arrived): the same server revision is not read again until the
    // originals are ready, so a long originals outage costs one body read per draft, not one per pass.
    const held = new Map();
    let sourceCheck = null, sourceAgain = null, offSource = null, sourceEvents = 0;
    function onSource(event) {
      sourceEvents++;
      if (disposed || !waiting.size || event?.type !== 'account' && event?.type !== 'state') return;
      const targets = event.type === 'state' && event.workspaceId ? [event.workspaceId] : null;
      if (targets && !waiting.has(targets[0])) return;
      // Events that arrive during a check join it: one more check for the union of their targets.
      if (sourceCheck) { sourceAgain = !targets || sourceAgain === true ? true : new Set([...(sourceAgain || []), ...targets]); return; }
      sourceCheck = checkSource(targets).finally(() => { sourceCheck = null; });
    }
    async function checkSource(targets) {
      try {
        for (let next = targets; ; ) {
          guard(); const epoch = auth.epoch; let ready = false;
          for (const ws of next ? next.filter(value => waiting.has(value)) : [...waiting]) {
            let state = null; try { state = await sourceSync.getState(ws); } catch (_) { /* Not ready yet. */ }
            guard(epoch);
            if (originalsReady(state)) { waiting.delete(ws); ready = true; }
          }
          // automatic() keeps the hidden/suspended/back-forward rules and joins a running pass.
          if (ready) automatic();
          if (!sourceAgain || disposed) return;
          next = sourceAgain === true ? null : [...sourceAgain]; sourceAgain = null;
        }
      } catch (_) { sourceAgain = null; /* Another account or a disposed manager: nothing starts. */ }
    }
    // One pass per workspace: one metadata list (100 per page) decides which draft bodies to fetch.
    // A draft whose local text is unchanged since its last exchange and whose listed server revision
    // equals the acknowledged one is skipped: no body read on cellular for unchanged drafts.
    // uploadOnly (a hidden page): what this device holds is sent; the server list is not read and
    // nothing new is installed.
    async function workspacePass(ws, epoch, uploadOnly = false, own = null) {
      if (uploadOnly && ![...own].some(key => key.startsWith(ws + '/'))) return;
      // An originals event that lands while this read is in flight may already be past: check again.
      const seen = sourceEvents, wait = () => { waiting.add(ws); if (sourceEvents !== seen) onSource({ type: 'state', workspaceId: ws }); };
      let source;
      try { source = await sourceSync.getState(ws); } catch (error) { wait(); throw error; }
      guard(epoch);
      if (originalsReady(source)) waiting.delete(ws); else wait();
      if (!source?.enabled || !same(source.binding)) return;
      let listed = null;
      // The list needs the originals' connection, not their being up to date: each draft and row
      // that points at an original is still held by its own check until the originals arrive.
      if (!uploadOnly && source.remoteRevision >= 1) {
        listed = new Map();
        try {
          let after = null;
          for (let page = 0; page < 50; page++) {
            const rows = await remote.list(ws, after); guard(epoch);
            for (const row of rows) listed.set(row.draft_id, row);
            if (rows.length < 100) break;
            after = rows.at(-1).draft_id;
          }
        } catch (error) { guard(epoch); if (markUnavailable(clean(error))) throw clean(error); return; }
        availability = { status: 'available', until: 0, backoff: 0 };
      }
      const stages = (await storage.listStages(ws)).filter(stage => stage.kind === 'writing'); guard(epoch);
      const states = new Map((await storage.listWritingSyncStates(ws)).map(state => [state.draftId, state])); guard(epoch);
      for (const stage of stages) {
        if (uploadOnly && !own.has(ws + '/' + stage.stageId)) continue;
        const state = states.get(stage.stageId);
        try {
          if (!state) { if (stage.state !== 'applied') await call('enable', ws, stage.stageId); }
          else if (!state.enabled) await call('enable', ws, stage.stageId);
          else {
            if (stage.state === 'applied' && state.status === 'synced') continue;
            const row = listed?.get(stage.stageId);
            const localChange = !!state.outbox || !!state.conflict || !!state.error || state.status !== 'synced' || stage.revision !== state.syncedLocalRevision;
            const remoteChange = listed !== null && (!row || row.revision !== state.remoteRevision);
            if (!localChange && !remoteChange) continue;
            await entry(ws, stage.stageId).instance.syncNow(stage.stageId).catch(() => {});
          }
        } catch (error) { guard(epoch); if (markUnavailable(error)) throw error; /* Durable state keeps the error; the next pass retries. */ }
        guard(epoch);
      }
      if (!listed) return;
      const known = new Set(stages.map(stage => stage.stageId));
      const ready = originalsReady(source);
      for (const row of listed.values()) {
        if (row.state !== 'draft' || known.has(row.draft_id)) continue;
        const key = ws + '/' + row.draft_id;
        if (!ready && held.get(key) === row.revision) continue;
        try { await download(ws, row.draft_id, source); known.add(row.draft_id); held.delete(key); }
        catch (error) { guard(epoch); if (!ready && error?.code === 'writing_source_pending') held.set(key, row.revision); else held.delete(key); }
      }
    }
    // Callers that arrive during a pass wait for the same pass, which then runs once more.
    // A suspended page (haedo:page-suspend) sends nothing with the old session until the shell's
    // fresh verification is followed by haedo:page-ready. Between a persisted pagehide and its
    // pageshow (back/forward cache) nothing starts: work there evicts the page, and nothing begun
    // then may stand in for the resumed page's own account check. It resumes on the regular poll.
    let suspended = false, parked = false;
    const suspend = () => { suspended = true; root.clearTimeout(soon); soon = null; };
    const resume = () => { if (!suspended) return; suspended = false; automatic(); };
    // A page that is closed (pagehide, not kept in the cache) starts nothing here: the platform has
    // suspended its session by then (platform-auth.js hides the private screen and cancels the
    // session's generation on pagehide, and haedo:page-suspend arrives first). What it could send
    // went out when it was hidden (visibilitychange comes before pagehide); a draft that did not
    // make it stays on this device and the next page sends it.
    const pagehide = event => { if (event?.persisted) { parked = true; root.clearTimeout(soon); soon = null; } };
    const pageshow = event => { if (event?.persisted) parked = false; };
    const hidden = () => root.document?.visibilityState === 'hidden';
    // mine: drafts this page itself saved and no pass has taken yet (storage marks its own saves
    // `local`; another tab's saves and sync's own writes arrive without it). full: a visible
    // page asked for the whole pass (list, receive, send).
    const mine = new Set();
    let full = false;
    function begin() {
      if (refreshing) { again = true; return refreshing; }
      refreshing = passes().finally(() => { refreshing = null; });
      return refreshing;
    }
    function automatic() {
      if (disposed || suspended || parked || hidden()) return Promise.resolve();
      full = true;
      return begin();
    }
    // A page that is being hidden sends what it saved itself and has not sent yet, once (typed,
    // then switched away): an upload-only pass for those drafts, no list and no installs. With
    // nothing of its own to send it does nothing: another tab's saves are sent by that tab, and
    // the poll stays quiet while hidden.
    function flush() {
      if (disposed || suspended || parked || !mine.size) return Promise.resolve();
      root.clearTimeout(soon); soon = null;
      return begin();
    }
    const wake = () => hidden() ? flush() : automatic();
    async function passes() {
      if (Date.now() < availability.until) return;
      try {
        do {
          again = false;
          // The whole pass only for a visible page that asked for it; otherwise this page's own saves.
          const uploadOnly = !full || hidden(), own = new Set(mine);
          full = false; mine.clear();
          if (uploadOnly && !own.size) continue;
          guard(); const epoch = auth.epoch, workspaces = await storage.listWorkspaces(); guard(epoch);
          for (const workspace of workspaces) {
            try { await workspacePass(workspace.workspaceId, epoch, uploadOnly, own); }
            catch (error) { guard(epoch); if (Date.now() < availability.until) return; /* Other workspaces still sync. */ }
          }
        } while (again && !disposed);
      } catch (_) { /* Retain local text and metadata; the next pass retries. */ }
    }
    function nudge() {
      if (disposed || suspended || parked || soon) return;
      soon = root.setTimeout(() => { soon = null; wake(); }, 3000); soon?.unref?.();
    }
    // Any saved draft change (new draft or new text) is sent by a pass shortly after; the pass
    // reads no body for drafts that did not change on either side.
    function onStorage(event) {
      if (event?.type !== 'writing_draft_changed' || !event.stageId) return;
      if (event.local === true) mine.add(event.workspaceId + '/' + event.stageId);
      // A hidden page reacts to its own saves only.
      else if (hidden()) return;
      nudge();
    }
    function start() { guard(); if (started) return; started = true;
      wiring = syncLifecycle()?.attach(root, {
        listen: [['window', 'online', wake], ['window', 'focus', automatic], ['document', 'visibilitychange', wake],
          ['document', 'haedo:page-suspend', suspend], ['document', 'haedo:page-ready', resume],
          ['window', 'pagehide', pagehide], ['window', 'pageshow', pageshow]],
        poll: [every, automatic],
      }) || null;
      try { offAll = storage.subscribeAll?.(onStorage) || null; } catch (_) { offAll = null; }
      try { offSource = sourceSync.subscribe?.(onSource) || null; } catch (_) { offSource = null; }
      if (materials !== null) {
        try { material = (materials || root.HaedoLife?.MaterialContinuitySync?.automatic)?.({ storage, auth }) || null; material?.start(); }
        catch (_) { material = null; }
      }
      automatic();
    }
    function dispose() { if (disposed) return; disposed = true; wiring?.detach(); wiring = null; root.clearTimeout(soon); soon = null;
      offAll?.(); offSource?.(); offSource = null; waiting.clear(); held.clear(); mine.clear(); sourceAgain = null; material?.dispose(); material = null;
      for (const value of entries.values()) value.instance.dispose(); entries.clear(); listeners.clear(); remote.dispose?.();
    }
    // { force: true } (an explicit retry) ignores the unavailable back-off once.
    return Object.freeze({ start, getState, listRemote, download, dispose, refresh: options => { if (options?.force === true) availability.until = 0; return automatic(); },
      // The preparation loop started with this account's writing sync (null when unavailable).
      availability: () => ({ status: availability.status, until: availability.until }),
      refreshMaterials: () => material?.refresh() || Promise.resolve(), materialAvailability: () => material?.availability() || null,
      enable: (ws, id) => call('enable', ws, id), pause: (ws, id) => call('pause', ws, id), syncNow: (ws, id) => call('syncNow', ws, id),
      compare: (ws, id) => call('compare', ws, id), resolve: (ws, id, choice, expected) => call('resolve', ws, id, choice, expected),
      // The notice is stored with the draft's sync record, so it survives reloads until dismissed.
      dismissNotice: async (ws, id) => { guard(); await storage.dismissWritingNotice(ws, id); emit(ws, id); },
      subscribe(listener) { guard(); listeners.add(listener); return () => listeners.delete(listener); }
    });
  }
  return Object.freeze({ create, latest });
});

/* Every writing draft of the signed-in account syncs automatically through the tested CAS/lifetime
 * engine (one engine per draft, polling off). Conflicts keep the newest edit and store the other
 * side as a new unlinked draft through the existing fork/recovery transaction. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).WritingSync = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
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
    const owner = storage.account, entries = new Map(), listeners = new Set(), notices = new Map();
    let disposed = false, started = false, interval = null, refreshing = null, again = false, soon = null, offAll = null, material = null;
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
        readWorkbenchSnapshot: async () => { const value = await storage.readWritingSnapshot(ws, id); return { workbench: value.stage, bundle: value.bundle }; },
        listWorkspaces: async () => { const state = await getState(ws, id); return state.enabled && state.status !== 'closed' ? [{ workspaceId: id }] : []; },
        subscribe: (_, listener) => storage.subscribe(ws, event => {
          if (event.stageId !== id) return;
          if (event.type === 'writing_draft_changed') listener({ workspaceId: id, type: 'workbench_changed' });
          if (event.type === 'writing_sync_changed') listener({ workspaceId: id, type: 'composition_sync_changed' });
        })
      };
      const sourceAdapter = { getState: () => sourceSync.getState(ws), syncNow: () => sourceSync.syncNow(ws),
        subscribe: listener => sourceSync.subscribe(event => { if (event.workspaceId === ws) listener({ workspaceId: id }); }) };
      const transport = { read: () => remote.read(ws, id), write: request => remote.write({ ...request, workspaceId: ws, draftId: id }) };
      const instance = engine.create({ storage: adapter, sourceSync: sourceAdapter, auth, remote: transport,
        errorCleaner: clean, resolutionChoices: ['local','remote','fork'], sendResolution: (_, result) => result.metadata.status === 'pending', polling: false,
        autoResolve: latest });
      instance.subscribe(event => {
        if (event?.autoResolved) notices.set(key, { choice: event.choice, recoveryStageId: event.recoveryId || null, at: new Date().toISOString() });
        emit(ws, id, event?.autoResolved ? { autoResolved: true, recoveryStageId: event.recoveryId || null } : null);
      });
      const value = { instance, start() { if (!value.started) { value.started = true; instance.start(); } }, started: false };
      entries.set(key, value); return value;
    }
    async function getState(ws, id) {
      guard(); const epoch = auth.epoch;
      const stage = await storage.getStage(id); guard(epoch);
      if (stage && (stage.workspaceId !== ws || stage.kind !== 'writing')) throw fault('account_mismatch');
      const metadata = stage ? await storage.getWritingSyncState(ws, id) : null; guard(epoch);
      return { ...(metadata || {}), workspaceId: ws, draftId: id, stage, enabled: !!metadata?.enabled, notice: notices.get(ws + '/' + id) || null,
        status: !metadata ? 'not_enabled' : !metadata.enabled ? 'paused' : stage.state === 'applied' && metadata.status === 'synced' ? 'closed' : metadata.status };
    }
    async function call(method, ws, id, ...args) {
      try { const value = entry(ws, id); const result = await value.instance[method](id, ...args); if (['enable','syncNow'].includes(method)) value.start(); return result; }
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
      entry(ws, id).start(); emit(ws, id, { received: true }); return result;
    }
    // One pass over every workspace whose originals already sync for this account:
    // upload every local draft, keep enabled drafts moving and install drafts that
    // exist only on the server. Each draft fails independently; text stays local.
    async function workspacePass(ws, epoch) {
      const source = await sourceSync.getState(ws); guard(epoch);
      if (!source?.enabled || !same(source.binding)) return;
      const stages = (await storage.listStages(ws)).filter(stage => stage.kind === 'writing'); guard(epoch);
      const states = new Map((await storage.listWritingSyncStates(ws)).map(state => [state.draftId, state])); guard(epoch);
      for (const stage of stages) {
        const state = states.get(stage.stageId);
        try {
          if (!state) { if (stage.state !== 'applied') await call('enable', ws, stage.stageId); }
          else if (!state.enabled) await call('enable', ws, stage.stageId);
          else {
            if (stage.state === 'applied' && state.status === 'synced') continue;
            const value = entry(ws, stage.stageId);
            if (!value.started) value.start();
            await value.instance.syncNow(stage.stageId).catch(() => {});
          }
        } catch (_) { guard(epoch); /* Durable state keeps the error; the next pass retries. */ }
        guard(epoch);
      }
      if (source.status !== 'synced') return;
      const known = new Set(stages.map(stage => stage.stageId));
      let after = null;
      for (let page = 0; page < 50; page++) {
        const rows = await remote.list(ws, after); guard(epoch);
        for (const row of rows) {
          if (row.state !== 'draft' || known.has(row.draft_id)) continue;
          try { await download(ws, row.draft_id, source); known.add(row.draft_id); } catch (_) { guard(epoch); }
        }
        if (rows.length < 100) break;
        after = rows.at(-1).draft_id;
      }
    }
    // Callers that arrive during a pass wait for the same pass, which then runs once more.
    function automatic() {
      if (disposed || root.document?.visibilityState === 'hidden') return Promise.resolve();
      if (refreshing) { again = true; return refreshing; }
      refreshing = passes().finally(() => { refreshing = null; });
      return refreshing;
    }
    async function passes() {
      try {
        do {
          again = false;
          guard(); const epoch = auth.epoch, workspaces = await storage.listWorkspaces(); guard(epoch);
          for (const workspace of workspaces) {
            try { await workspacePass(workspace.workspaceId, epoch); }
            catch (error) { guard(epoch); /* Other workspaces still sync. */ }
          }
        } while (again && !disposed);
      } catch (_) { /* Retain local text and metadata; the next pass retries. */ }
    }
    function nudge() {
      if (disposed || soon) return;
      soon = root.setTimeout(() => { soon = null; automatic(); }, 1500); soon?.unref?.();
    }
    function onStorage(event) {
      if (event?.type !== 'writing_draft_changed' || !event.stageId || entries.has(event.workspaceId + '/' + event.stageId)) return;
      nudge();
    }
    function start() { guard(); if (started) return; started = true;
      interval = root.setInterval(automatic, every); interval?.unref?.();
      root.addEventListener?.('online', automatic); root.addEventListener?.('focus', automatic);
      root.document?.addEventListener('visibilitychange', automatic);
      try { offAll = storage.subscribeAll?.(onStorage) || null; } catch (_) { offAll = null; }
      if (materials !== null) {
        try { material = (materials || root.HaedoLife?.MaterialContinuitySync?.automatic)?.({ storage, auth }) || null; material?.start(); }
        catch (_) { material = null; }
      }
      automatic();
    }
    function dispose() { if (disposed) return; disposed = true; root.clearInterval(interval); root.clearTimeout(soon); soon = null;
      offAll?.(); material?.dispose(); material = null;
      for (const value of entries.values()) value.instance.dispose(); entries.clear(); listeners.clear(); notices.clear(); remote.dispose?.();
      root.removeEventListener?.('online', automatic); root.removeEventListener?.('focus', automatic);
      root.document?.removeEventListener('visibilitychange', automatic);
    }
    return Object.freeze({ start, getState, listRemote, download, dispose, refresh: automatic,
      enable: (ws, id) => call('enable', ws, id), pause: (ws, id) => call('pause', ws, id), syncNow: (ws, id) => call('syncNow', ws, id),
      compare: (ws, id) => call('compare', ws, id), resolve: (ws, id, choice, expected) => call('resolve', ws, id, choice, expected),
      dismissNotice: (ws, id) => { notices.delete(ws + '/' + id); },
      subscribe(listener) { guard(); listeners.add(listener); return () => listeners.delete(listener); }
    });
  }
  return Object.freeze({ create, latest });
});

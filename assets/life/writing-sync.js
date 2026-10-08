/* Adapt selected drafts to the already tested CAS/lifetime engine. Reuse its queue, retry and account boundaries. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).WritingSync = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  function create({ storage, sourceSync, auth = root.HaedoAuth,
    remote = root.HaedoLife?.WritingRemote?.create({ auth }), engine = root.HaedoLife?.CompositionSync } = {}) {
    const clean = root.HaedoLife?.WritingRemote?.clean || (error => error);
    const fault = code => clean({ code });
    if (!storage?.account || !sourceSync || !auth || !remote || !engine) throw fault('account_mismatch');
    const owner = storage.account, entries = new Map(), listeners = new Set();
    let disposed = false, started = false, interval = null, refreshing = false;
    const same = value => value?.userId === owner.userId && value?.projectUrl === owner.projectUrl;
    const guard = epoch => { if (disposed || !same(auth.getAccount()) || epoch !== undefined && epoch !== auth.epoch) throw fault('request_cancelled'); };
    const binding = ws => ({ ...owner, remoteId: ws });
    const emit = (workspaceId, draftId) => { if (!disposed) for (const listener of listeners) { try { listener({ workspaceId, draftId }); } catch (_) {} } };
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
        errorCleaner: clean, resolutionChoices: ['local','remote','fork'], sendResolution: (_, result) => result.metadata.status === 'pending', polling: false });
      instance.subscribe(() => emit(ws, id));
      const value = { instance, start() { if (!value.started) { value.started = true; instance.start(); } }, started: false };
      entries.set(key, value); return value;
    }
    async function getState(ws, id) {
      guard(); const epoch = auth.epoch;
      const stage = await storage.getStage(id); guard(epoch);
      if (stage && (stage.workspaceId !== ws || stage.kind !== 'writing')) throw fault('account_mismatch');
      const metadata = stage ? await storage.getWritingSyncState(ws, id) : null; guard(epoch);
      return { ...(metadata || {}), workspaceId: ws, draftId: id, stage, enabled: !!metadata?.enabled,
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
    async function download(ws, id) {
      guard(); const epoch = auth.epoch; await sourceReady(ws);
      const row = await remote.read(ws, id); guard(epoch);
      if (!row) throw fault('remote_missing');
      await sourceReady(ws, row.source_revision); guard(epoch);
      const existing = await storage.getStage(id); guard(epoch);
      if (existing) {
        if (existing.workspaceId !== ws || existing.kind !== 'writing') throw fault('account_mismatch');
        await call('enable', ws, id); guard(epoch); return { stage: await storage.getStage(id), existing: true };
      }
      const result = await storage.installWritingRemote(ws, binding(ws), row); guard(epoch);
      entry(ws, id).start(); emit(ws, id); return result;
    }
    async function automatic() {
      if (disposed || refreshing || root.document?.visibilityState === 'hidden') return;
      refreshing = true;
      try {
        guard(); const epoch = auth.epoch, workspaces = await storage.listWorkspaces(); guard(epoch);
        for (const workspace of workspaces) {
          const states = await storage.listWritingSyncStates(workspace.workspaceId); guard(epoch);
          for (const state of states) {
            if (!state.enabled) continue;
            const actual = await getState(state.workspaceId, state.draftId); guard(epoch);
            if (actual.status === 'closed') continue;
            const value = entry(state.workspaceId, state.draftId);
            if (!value.started) value.start(); else value.instance.syncNow(state.draftId).catch(() => {});
          }
        }
      } catch (_) { /* Retain local text and metadata; explicit actions report errors. */ }
      finally { refreshing = false; }
    }
    function start() { guard(); if (started) return; started = true;
      interval = root.setInterval(automatic, 30000); interval?.unref?.();
      root.addEventListener?.('online', automatic); root.addEventListener?.('focus', automatic);
      root.document?.addEventListener('visibilitychange', automatic); automatic();
    }
    function dispose() { if (disposed) return; disposed = true; root.clearInterval(interval);
      for (const value of entries.values()) value.instance.dispose(); entries.clear(); listeners.clear(); remote.dispose?.();
      root.removeEventListener?.('online', automatic); root.removeEventListener?.('focus', automatic);
      root.document?.removeEventListener('visibilitychange', automatic);
    }
    return Object.freeze({ start, getState, listRemote, download, dispose,
      enable: (ws, id) => call('enable', ws, id), pause: (ws, id) => call('pause', ws, id), syncNow: (ws, id) => call('syncNow', ws, id),
      compare: (ws, id) => call('compare', ws, id), resolve: (ws, id, choice, expected) => call('resolve', ws, id, choice, expected),
      subscribe(listener) { guard(); listeners.add(listener); return () => listeners.delete(listener); }
    });
  }
  return Object.freeze({ create });
});

/* Account library orchestration. Existing domain CAS engines own replication;
 * this module owns receive-first discovery and the account default experience. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).AccountLibrary = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  const messages = {
    auth_required: '로그인 계정을 다시 확인해 주세요.',
    request_cancelled: '계정이 바뀌어 이전 자료 요청을 중단했습니다.',
    schema_missing: '계정 자료 보관을 확인하지 못했습니다. 저장 대기 자료는 유지됩니다.',
    remote_missing: '계정 자료함을 찾을 수 없습니다. 기존 자료는 유지했습니다.',
    account_mismatch: '현재 로그인 계정의 자료를 다시 확인해 주세요.',
    invalid_remote_data: '계정 자료 목록을 확인하지 못했습니다. 기존 자료는 유지됩니다.',
    catalog_too_large: '계정 자료 목록을 모두 확인하지 못했습니다. 기존 자료는 유지됩니다.',
    network_error: '서버에 연결하지 못했습니다. 자료는 전송 대기 상태로 유지됩니다.'
  };
  const fault = code => Object.assign(new Error(messages[code] || messages.network_error), { code });
  function clean(error) {
    const code = Object.hasOwn(messages, error?.code) ? error.code : 'network_error';
    return { code, message: messages[code] };
  }
  const copy = value => value == null ? value : structuredClone(value);
  function create({ storage, core, sync, compositionSync, libraryMetaSync, auth = root.HaedoAuth,
    remote, originalsFactory, naverMediaFactory, polling = true } = {}) {
    if (!storage?.isAccountScoped || !storage.account || !core || !sync || !compositionSync || !libraryMetaSync || !auth?.verify)
      throw fault('auth_required');
    const owner = copy(storage.account), authEpoch = auth.epoch;
    const transport = root.HaedoLife?.LibraryRemote || (typeof require === 'function' && require('./library-remote.js'));
    remote ||= transport.create({ auth });
    const listeners = new Set(), domainErrors = new Map(), stops = [];
    let disposed = false, mode = 'unavailable', reason = null, legacy = false, started = false, sourceStarted = false, ready = false;
    let booting = false, working = false, operation = null, timer = null, interval = null, globalError = null, followup = false;
    let defaultRow = null, catalog = new Map(), originals = null, originalsStop = null, originalsStarted = false;
    let deferredBackground = false, catalogPending = false, accountCachePresented = false;
    let naverMedia = null;
    function mediaReceipts() {
      if (naverMedia) return naverMedia;
      const factory = naverMediaFactory || root.HaedoLife?.NaverCaptureSync?.create;
      if (!factory || !storage.listNaverMediaReceipts) return null;
      naverMedia = factory({ storage, core, auth, isCurrent: () => !disposed });
      return naverMedia;
    }
    const same = value => value?.projectUrl === owner.projectUrl && value?.userId === owner.userId;
    function guard() {
      if (disposed || auth.epoch !== authEpoch || !same(auth.getAccount?.()) || auth.user?.id !== owner.userId) throw fault('request_cancelled');
    }
    async function step(action) { guard(); const result = await action(); guard(); return result; }
    async function verify() { const user = await step(() => auth.verify()); if (user?.id !== owner.userId) throw fault('auth_required'); }
    function emit(type = 'state', workspaceId) {
      if (disposed) return;
      const event = { type, ...(workspaceId ? { workspaceId } : {}) };
      for (const listener of [...listeners]) { try { listener(copy(event)); } catch (_) { /* Advisory UI notifications. */ } }
    }
    function serial(action) {
      if (operation) return operation;
      const pending = Promise.resolve().then(action);
      operation = pending;
      pending.finally(() => {
        if (operation === pending) operation = null;
        if (followup && !disposed) { followup = false; schedule(); }
      }).catch(() => {});
      return pending;
    }
    async function eligible() {
      const rows = await step(() => storage.listAccountLibraries());
      return rows.filter(row => row.eligible === true);
    }
    async function readCatalog() {
      const seen = new Set(), rows = new Map(); let cursor = null;
      for (let page = 0; page < 100; page++) {
        const result = await step(() => remote.catalog(cursor, 100));
        for (const row of result.items) {
          if (!UUID.test(row.id) || rows.has(row.id)) throw fault('invalid_remote_data');
          rows.set(row.id, copy(row));
        }
        if (result.next === null) { catalog = rows; return rows; }
        if (!result.items.length || seen.has(result.next)) throw fault('invalid_remote_data');
        seen.add(result.next); cursor = result.next;
      }
      throw fault('catalog_too_large');
    }
    async function sources(workspaceId, local, pristine, knownRemote = false) {
      let state = await step(() => sync.getState(workspaceId));
      if (!state.binding) {
        if (knownRemote || catalog.has(workspaceId)) {
          await step(() => sync.adoptExisting(workspaceId, {
            pristine: !!pristine, pristineRevision: pristine ? defaultRow.default_revision : null
          }));
        } else {
          try { await step(() => sync.enable(workspaceId)); }
          catch (error) {
            if (error?.code !== 'remote_exists') throw error;
            // An independently opened device may have installed this ID since
            // the catalog read. Adoption checks the actual snapshot, never title.
            await step(() => sync.adoptExisting(workspaceId));
          }
        }
        state = await step(() => sync.getState(workspaceId));
      }
      if (!state.enabled) { await step(() => sync.enable(workspaceId)); state = await step(() => sync.getState(workspaceId)); }
      if (state.conflict || state.status === 'conflict') return state;
      return step(() => sync.syncNow(workspaceId, { headIfClean: true }));
    }
    async function domain(manager, workspaceId) {
      const state = await step(() => manager.getState(workspaceId));
      if (!state.enabled) return step(() => manager.enable(workspaceId));
      if (state.conflict || state.status === 'conflict') return state;
      return step(() => manager.syncNow(workspaceId));
    }
    async function synchronizeRow(row, knownRemote = false) {
      const id = row.workspaceId;
      try {
        const source = await sources(id, row, defaultRow?.pristine && defaultRow.workspace_id === id, knownRemote);
        if (source.status === 'synced') {
          // Each domain still receives only after its exact source state is ready.
          const results = await Promise.allSettled([domain(compositionSync, id), domain(libraryMetaSync, id)]);
          // Immutable media receipts follow the exact source acknowledgement.
          // They are independent of folders and never delay the readable body.
          try { await step(() => mediaReceipts()?.publishPending(id)); }
          catch (_) { guard(); /* Durable pending receipt remains available for retry. */ }
          const rejected = results.find(value => value.status === 'rejected');
          if (rejected) throw rejected.reason;
        }
        domainErrors.delete(id);
      } catch (error) {
        guard(); domainErrors.set(id, clean(error));
      }
      emit('state', id);
    }
    async function accountCache() {
      if (!storage.getSyncState || !storage.getLibraryMetaState) return null;
      const rows = await eligible(), workspaceId = await step(() => storage.getActive());
      if (!rows.some(row => row.workspaceId === workspaceId)) return null;
      const states = await step(() => Promise.all([
        storage.getSyncState(workspaceId), storage.getLibraryMetaState(workspaceId)
      ]));
      const acknowledged = state => same(state?.binding) && state.binding.remoteId === workspaceId &&
        Number.isSafeInteger(state.remoteRevision) && state.remoteRevision > 0;
      // Metadata acknowledgement proves this was an account-library copy. It is
      // not proof of current capability, existence or freshness on the server.
      if (!states.every(acknowledged)) return null;
      if (await step(() => storage.getActive()) !== workspaceId) return null;
      return workspaceId;
    }
    async function foregroundWorkspace() {
      let rows = await eligible();
      const active = await step(() => storage.getActive());
      const workspaceId = rows.some(row => row.workspaceId === active) ? active : defaultRow.workspace_id;
      if (!rows.some(row => row.workspaceId === workspaceId)) {
        const all = await step(() => storage.listWorkspaces());
        // Never adopt or overwrite a recovery space just because its ID matches.
        if (all.some(row => row.workspaceId === workspaceId)) throw fault('remote_missing');
        await step(() => sync.download(workspaceId, { activate: false }));
        rows = await eligible();
      }
      const row = rows.find(value => value.workspaceId === workspaceId);
      if (!row) throw fault('remote_missing');
      await synchronizeRow(row, workspaceId === defaultRow.workspace_id);
      const latest = await step(() => storage.getActive()), available = await eligible();
      if (latest && latest !== workspaceId && available.some(value => value.workspaceId === latest)) {
        // Another tab changed the selected space during preparation. Preserve
        // its selection and use the full receive barrier for this uncommon path.
        await receiveAndSend(true);
        const selected = await step(() => storage.getActive());
        if (!(await eligible()).some(value => value.workspaceId === selected)) throw fault('remote_missing');
        return { workspaceId: selected, background: false };
      }
      if (latest !== workspaceId) await step(() => storage.setActive(workspaceId));
      return { workspaceId, background: true };
    }
    async function receiveAndSend(refreshCatalog) {
      if (refreshCatalog) await readCatalog();
      let localRows = await eligible();
      const allLocal = await step(() => storage.listWorkspaces());
      const localIds = new Set(allLocal.map(row => row.workspaceId));
      for (const row of catalog.values()) {
        if (localIds.has(row.id)) continue;
        await step(() => sync.download(row.id, { activate: false }));
        localIds.add(row.id); emit('catalog', row.id);
      }
      localRows = await eligible();
      for (const row of localRows) await synchronizeRow(row);
      // A failed/incomplete catalog never removes local spaces or changes the
      // current workspace. Background downloads never set the active pointer.
      emit('catalog');
      return localRows;
    }
    function schedule() {
      if (disposed || mode !== 'account') return;
      if (deferredBackground) { followup = true; return; }
      if (working) { followup = true; return; }
      root.clearTimeout(timer);
      timer = root.setTimeout(() => { timer = null; reconcile({ refreshCatalog: false }).catch(() => {}); }, 350);
      timer?.unref?.();
    }
    function activateLifecycle() {
      if (started || disposed) return; started = true;
      stops.push(storage.subscribeAll(event => {
        if (disposed) return;
        if (['changed', 'workbench_changed', 'source_folders_changed', 'collection_changed', 'nine_board_changed', 'naver_media_changed'].includes(event.type)) schedule();
      }));
      for (const manager of [sync, compositionSync, libraryMetaSync]) stops.push(manager.subscribe(event => emit('state', event?.workspaceId)));
      root.addEventListener?.('online', lifecycle);
      root.addEventListener?.('focus', lifecycle);
      root.document?.addEventListener('visibilitychange', visible);
      if (polling) { interval = root.setInterval(lifecycle, 30000); interval?.unref?.(); }
    }
    function visible() { if (root.document?.visibilityState !== 'hidden') lifecycle(); }
    function lifecycle() {
      if (disposed || deferredBackground || root.document?.visibilityState === 'hidden') return;
      (mode === 'account' && ready ? reconcile() : bootstrap()).catch(() => {});
      originals?.retry?.().catch?.(() => {});
    }
    function prepareOriginals() {
      if (disposed) return null;
      if (originals) return originals;
      const factory = originalsFactory || root.HaedoLife?.OriginalAttachments?.create;
      if (typeof factory !== 'function') { globalError = clean(fault('schema_missing')); return null; }
      let candidate;
      try {
        candidate = factory({ auth });
        originalsStop = candidate.subscribe?.(() => emit());
        originals = candidate;
        return originals;
      } catch (error) {
        try { candidate?.dispose?.(); } catch (_) { /* Close a partially prepared account service. */ }
        globalError = clean(error); return null;
      }
    }
    function startOriginals() {
      if (disposed || originalsStarted) return;
      const service = prepareOriginals();
      if (!service) return;
      try { service.start?.(); originalsStarted = true; }
      catch (error) { globalError = clean(error); }
    }
    async function bootstrap(options = {}) {
      if (!options || typeof options !== 'object' || Array.isArray(options) ||
          Object.keys(options).some(key => key !== 'foreground') ||
          options.foreground !== undefined && typeof options.foreground !== 'boolean') throw fault('invalid_remote_data');
      const foreground = options.foreground === true;
      return serial(async () => {
        guard(); deferredBackground = foreground; booting = true; working = true; globalError = null; emit();
        let verifiedAccount = false;
        try {
          await verify(); verifiedAccount = true; await step(() => storage.open());
          if (foreground) {
            const workspaceId = await accountCache();
            if (workspaceId) {
              mode = 'account'; reason = null; legacy = false; ready = false;
              catalogPending = true; accountCachePresented = true;
              prepareOriginals(); activateLifecycle();
              return { mode, workspaceId, cached: true, background: true };
            }
          }
          const capabilities = await step(() => remote.capabilities());
          if (capabilities.version === 0) {
            // A previously acknowledged account copy must not silently become a
            // local-only library after its foreground screen has been shown.
            if (accountCachePresented) throw fault('schema_missing');
            deferredBackground = false;
            mode = 'unavailable'; reason = 'unsupported'; legacy = true;
            sync.setAutomatic?.(true);
            if (!sourceStarted) { await step(() => sync.start()); sourceStarted = true; }
            compositionSync.start?.();
            const workspaceId = await step(() => storage.getActive());
            return { mode, reason, legacy: true, cached: !!workspaceId, ...(workspaceId ? { workspaceId } : {}) };
          }
          if (capabilities.version !== 1 || capabilities.metadataVersion !== 1 || capabilities.originalsVersion !== 1) throw fault('schema_missing');
          mode = 'account'; reason = null; legacy = false; sync.setAutomatic?.(false);
          // Make the shared service available to an early explicit dialog. Its
          // constructor does not open storage or start remote reconciliation.
          if (foreground) prepareOriginals();
          if (!sourceStarted) { await step(() => sync.start()); sourceStarted = true; }
          if (!same(sync.getAccount())) throw fault('auth_required');
          const local = await eligible(), active = await step(() => storage.getActive());
          const preferred = local.some(row => row.workspaceId === active) ? active : local[0]?.workspaceId || null;
          defaultRow = await step(() => remote.open(preferred));
          if (defaultRow.status === 'missing') throw fault('remote_missing');
          if (foreground) {
            catalogPending = true;
            const selected = await foregroundWorkspace();
            ready = true; activateLifecycle();
            if (!selected.background) { catalogPending = false; deferredBackground = false; startOriginals(); }
            return { mode, ...selected, cached: true };
          }
          await receiveAndSend(true);
          let workspaceId = await step(() => storage.getActive());
          const rows = await eligible();
          if (accountCachePresented) {
            // The displayed user may have explicitly opened an owned recovery
            // copy while this background bootstrap ran. Do not change their
            // pointer or make that copy eligible for automatic replication.
            if (!workspaceId) throw fault('remote_missing');
          } else if (!workspaceId || !rows.some(row => row.workspaceId === workspaceId)) {
            if (!rows.some(row => row.workspaceId === defaultRow.workspace_id)) throw fault('remote_missing');
            workspaceId = defaultRow.workspace_id;
            await step(() => storage.setActive(workspaceId));
          }
          catalogPending = false; activateLifecycle(); startOriginals(); ready = true;
          return { mode, workspaceId, cached: true };
        } catch (error) {
          guard(); globalError = clean(error); reason = error?.code === 'schema_missing' ? 'unsupported' : 'offline';
          deferredBackground = false;
          if (mode !== 'account') mode = 'unavailable';
          if (foreground && !verifiedAccount) return { mode, reason, legacy: false, cached: false, error: copy(globalError) };
          const workspaceId = await step(() => storage.getActive()).catch(() => null);
          activateLifecycle();
          return { mode, reason, legacy: false, cached: !!workspaceId,
            ...(workspaceId ? { workspaceId } : {}), error: copy(globalError) };
        } finally { booting = false; working = false; emit(); }
      });
    }
    async function reconcile({ refreshCatalog = true } = {}) {
      deferredBackground = false;
      if (mode !== 'account' || !ready) return bootstrap();
      return serial(async () => {
        guard(); working = true; emit();
        try {
          const needsCatalog = refreshCatalog || catalogPending;
          if (needsCatalog) catalogPending = true;
          await verify(); await receiveAndSend(needsCatalog); catalogPending = false; globalError = null; reason = null; startOriginals();
        } catch (error) { guard(); globalError = clean(error); emit('error'); }
        finally { working = false; emit(); }
        return getState();
      });
    }
    async function getState(workspaceId) {
      guard();
      const id = workspaceId || await step(() => storage.getActive());
      const domains = { sources: null, composition: null, metadata: null, originals: originals?.getState?.() || null };
      if (id && sourceStarted) {
        const values = await Promise.allSettled([sync.getState(id), compositionSync.getState(id), libraryMetaSync.getState(id)]); guard();
        ['sources', 'composition', 'metadata'].forEach((key, index) => { domains[key] = values[index].status === 'fulfilled' ? values[index].value : { status: 'error', error: clean(values[index].reason) }; });
      }
      const states = [domains.sources, domains.composition, domains.metadata].filter(Boolean);
      let status = booting ? 'checking' : working || catalogPending ? 'syncing' : 'synced';
      let error = globalError || domainErrors.get(id) || states.find(state => state.error)?.error || null;
      if (!booting && states.some(state => state.conflict || state.status === 'conflict')) status = 'conflict';
      else if (!booting && (error || states.some(state => state.status === 'error'))) status = 'error';
      else if (!booting && !working && !catalogPending && (mode !== 'account' || !states.length || states.some(state => state.status !== 'synced'))) status = 'pending';
      const fileState = domains.originals;
      if (!booting && fileState?.status === 'error' && status !== 'conflict') { status = 'error'; error ||= fileState.error || clean(null); }
      else if (!booting && !working && status === 'synced' && mode === 'account' && (!fileState || fileState.status !== 'saved')) status = 'pending';
      return { mode, status, workspaceId: id || null, reason, error: copy(error), domains };
    }
    async function retry() {
      const result = await (mode === 'account' && ready ? reconcile() : bootstrap());
      if (originals?.retry) await originals.retry();
      return result;
    }
    function dispose() {
      if (disposed) return; disposed = true;
      naverMedia?.dispose?.(); naverMedia = null;
      root.clearTimeout(timer); root.clearInterval(interval);
      root.removeEventListener?.('online', lifecycle); root.removeEventListener?.('focus', lifecycle);
      root.document?.removeEventListener('visibilitychange', visible);
      for (const stop of stops) stop?.(); stops.length = 0;
      originalsStop?.(); originals?.dispose?.(); remote.dispose?.(); listeners.clear();
    }
    return Object.freeze({ bootstrap, reconcile, getState, retry, getMode: () => mode,
      get originals() { return originals; },
      subscribe(listener) { guard(); if (typeof listener !== 'function') throw fault('invalid_remote_data'); listeners.add(listener); return () => listeners.delete(listener); }, dispose });
  }
  return Object.freeze({ create });
});

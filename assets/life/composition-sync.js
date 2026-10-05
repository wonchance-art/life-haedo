/* Opt-in composition replication. Source sync and public publication stay separate. */
(function (root, factory) {
  'use strict';
  const api = factory(root); root.HaedoLife ||= {}; root.HaedoLife.CompositionSync = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const messages = {
    composition_source_pending: '원문 동기화를 먼저 완료해 주세요. 구성은 이 브라우저에 보존됩니다.',
    composition_conflict: '두 기기의 구성이 다릅니다. 양쪽 내용을 비교해 주세요.',
    composition_conflict_changed: '비교한 뒤 구성이 바뀌었습니다. 양쪽 내용을 다시 확인해 주세요.',
    remote_revision_mismatch: '같은 서버 버전의 내용이 달라 적용하지 않았습니다.',
    stale_sync_result: '서버 버전이 이전보다 낮거나 현재 요청과 달라 적용하지 않았습니다.',
    remote_missing: '연결된 서버 구성이 없습니다. 자동으로 다시 만들지 않았습니다.',
    sync_paused: '구성 이어쓰기가 중지되어 있습니다.',
    not_enabled: '구성 이어쓰기를 먼저 시작해 주세요.',
    account_mismatch: '현재 계정의 구성 연결을 확인해 주세요.',
    request_cancelled: '계정 또는 연결이 바뀌어 이전 요청을 적용하지 않았습니다.',
    storage_quota: '저장 공간이 부족합니다. 현재 구성과 복구 사본을 보존한 뒤 다시 시도해 주세요.',
    network_error: '연결을 확인한 뒤 다시 시도해 주세요. 구성과 전송 대기 내용은 보존됩니다.'
  };
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const fault = code => Object.assign(new Error(messages[code] || messages.network_error), { code });
  function create({ storage, sourceSync, auth = root.HaedoAuth,
    remote = root.HaedoLife?.CompositionRemote?.create({ auth }) } = {}) {
    if (!storage?.account || !sourceSync || !auth || !remote) throw fault('account_mismatch');
    const owner = storage.account, watches = new Map(), timers = new Map(), locks = new Map(), generations = new Map(), listeners = new Set();
    let disposed = false, started = false, interval = null, refreshing = false, unlistenSources = null;
    const sameAccount = value => value?.userId === owner.userId && value?.projectUrl === owner.projectUrl;
    function guard(context) {
      if (disposed || !sameAccount(auth.getAccount()) || context &&
          (context.generation !== (generations.get(context.workspaceId) || 0) || context.authEpoch !== auth.epoch)) throw fault('request_cancelled');
    }
    const context = workspaceId => { guard(); return { workspaceId, generation: generations.get(workspaceId) || 0, authEpoch: auth.epoch }; };
    const binding = workspaceId => ({ projectUrl: owner.projectUrl, userId: owner.userId, remoteId: workspaceId });
    function emit(workspaceId) { if (!disposed) for (const listener of [...listeners]) { try { listener({ workspaceId }); } catch (_) {} } }
    function clean(error) {
      if (messages[error?.code]) return fault(error.code);
      return root.HaedoLife?.CompositionRemote?.clean(error) || fault('network_error');
    }
    function serial(ctx, task) {
      const key = ctx.workspaceId + '|' + ctx.generation + '|' + ctx.authEpoch;
      const previous = locks.get(key) || Promise.resolve();
      const pending = previous.catch(() => {}).then(() => { guard(ctx); return task(); });
      locks.set(key, pending);
      pending.finally(() => { if (locks.get(key) === pending) locks.delete(key); }).catch(() => {});
      return pending;
    }
    async function getState(workspaceId) {
      const ctx = context(workspaceId);
      const state = await storage.getCompositionState(workspaceId); guard(ctx);
      return state ? { ...clone(state), status: state.enabled ? state.status : 'paused' } : { workspaceId, enabled: false, status: 'not_enabled', conflict: null, error: null, lastRecoveryId: null };
    }
    async function sources(ctx, minimum = 1) {
      guard(ctx);
      const initial = await sourceSync.getState(ctx.workspaceId); guard(ctx);
      if (!initial.enabled || !sameAccount(initial.binding)) throw fault('composition_source_pending');
      await sourceSync.syncNow(ctx.workspaceId); guard(ctx);
      const current = await sourceSync.getState(ctx.workspaceId); guard(ctx);
      if (!current.enabled || current.status !== 'synced' || !sameAccount(current.binding) || current.remoteRevision < minimum) throw fault('composition_source_pending');
      return current;
    }
    async function checkedState(ctx) {
      const state = await storage.getCompositionState(ctx.workspaceId); guard(ctx);
      if (!state) throw fault('not_enabled');
      if (!sameAccount(state.binding) || state.binding.remoteId !== ctx.workspaceId) throw fault('account_mismatch');
      if (!state.enabled) throw fault('sync_paused');
      return state;
    }
    async function conflict(ctx, row) {
      if (row) await sources(ctx, row.source_revision);
      guard(ctx); await storage.setCompositionConflict(ctx.workspaceId, binding(ctx.workspaceId), row); guard(ctx);
      emit(ctx.workspaceId); return getState(ctx.workspaceId);
    }
    async function send(ctx, outbox) {
      guard(ctx);
      const reply = await remote.write({ workspaceId: ctx.workspaceId, ...clone(outbox) }); guard(ctx);
      if (reply.status === 'stored') {
        await storage.ackCompositionSync(ctx.workspaceId, binding(ctx.workspaceId), outbox.operationId, reply.revision); guard(ctx);
        emit(ctx.workspaceId); return true;
      }
      const row = reply.status === 'missing' ? null : await remote.read(ctx.workspaceId); guard(ctx);
      await conflict(ctx, row); return false;
    }
    async function run(ctx) {
      try {
        await checkedState(ctx); await sources(ctx);
        for (let pass = 0; pass < 8; pass++) {
          const state = await checkedState(ctx);
          if (state.conflict) { const row = await remote.read(ctx.workspaceId); guard(ctx); return conflict(ctx, row); }
          // A lost response is resolved by replaying the same durable operation before reads.
          if (state.outbox) { if (await send(ctx, state.outbox)) continue; return getState(ctx.workspaceId); }
          const row = await remote.read(ctx.workspaceId); guard(ctx);
          if (!row && state.remoteRevision > 0) return conflict(ctx, null);
          if (row) {
            await sources(ctx, row.source_revision);
            if (!state.remoteRevision) return conflict(ctx, row);
            const applied = await storage.applyCompositionRemote(ctx.workspaceId, binding(ctx.workspaceId), row); guard(ctx);
            if (applied.status === 'conflict') return conflict(ctx, row);
          }
          const outbox = await storage.prepareCompositionUpload(ctx.workspaceId, binding(ctx.workspaceId)); guard(ctx);
          if (outbox) { if (await send(ctx, outbox)) continue; return getState(ctx.workspaceId); }
          await storage.setCompositionError(ctx.workspaceId, binding(ctx.workspaceId), null); guard(ctx);
          emit(ctx.workspaceId); return getState(ctx.workspaceId);
        }
        schedule(ctx.workspaceId); return getState(ctx.workspaceId);
      } catch (error) {
        guard(ctx);
        const safe = clean(error);
        if (!['sync_paused', 'not_enabled', 'request_cancelled'].includes(safe.code)) {
          await storage.setCompositionError(ctx.workspaceId, binding(ctx.workspaceId), { code: safe.code, message: safe.message }).catch(() => {});
          guard(ctx); emit(ctx.workspaceId);
        }
        throw safe;
      }
    }
    async function syncNow(workspaceId) { const ctx = context(workspaceId); return serial(ctx, () => run(ctx)); }
    function schedule(workspaceId) {
      if (disposed || timers.has(workspaceId)) return;
      const timer = root.setTimeout(() => { timers.delete(workspaceId); syncNow(workspaceId).catch(() => {}); }, 500);
      timer?.unref?.(); timers.set(workspaceId, timer);
    }
    function watch(workspaceId) {
      if (watches.has(workspaceId)) return;
      watches.set(workspaceId, storage.subscribe(workspaceId, event => {
        if (disposed) return;
        if (event.type === 'workbench_changed') { emit(workspaceId); schedule(workspaceId); }
        else if (event.type === 'composition_sync_changed') emit(workspaceId);
      }));
    }
    async function enable(workspaceId) {
      const ctx = context(workspaceId);
      return serial(ctx, async () => {
        await sources(ctx);
        // Probe installation before recording consent. Missing schema is not an empty success.
        await remote.read(workspaceId); guard(ctx);
        await storage.bindCompositionSync(workspaceId, binding(workspaceId)); guard(ctx);
        watch(workspaceId); emit(workspaceId); return run(ctx);
      });
    }
    async function pause(workspaceId) {
      const ctx = context(workspaceId);
      generations.set(workspaceId, ctx.generation + 1);
      ctx.generation++;
      root.clearTimeout(timers.get(workspaceId)); timers.delete(workspaceId);
      const previous = await storage.getCompositionState(workspaceId); guard(ctx);
      if (previous) { await storage.pauseCompositionSync(workspaceId, binding(workspaceId)); guard(ctx); }
      emit(workspaceId); return getState(workspaceId);
    }
    async function compare(workspaceId) {
      const ctx = context(workspaceId);
      return serial(ctx, async () => {
        const state = await checkedState(ctx);
        if (!state.conflict) throw fault('composition_conflict_changed');
        await sources(ctx);
        const row = await remote.read(workspaceId); guard(ctx);
        await conflict(ctx, row);
        const snapshot = await storage.readWorkbenchSnapshot(workspaceId); guard(ctx);
        return { local: snapshot.workbench, remote: row, bundle: snapshot.bundle, expectedLocalRevision: snapshot.workbench.revision, expectedRemoteRevision: row?.revision ?? null };
      });
    }
    async function resolve(workspaceId, choice, expected) {
      const ctx = context(workspaceId);
      return serial(ctx, async () => {
        const state = await checkedState(ctx);
        if (!['local', 'remote'].includes(choice) || !state.conflict || state.conflict.missing ||
            state.conflict.remoteRevision !== expected?.expectedRemoteRevision) throw fault('composition_conflict_changed');
        await sources(ctx);
        const row = await remote.read(workspaceId); guard(ctx);
        if (!row) { await conflict(ctx, null); throw fault('remote_missing'); }
        if (row.revision !== expected.expectedRemoteRevision) { await conflict(ctx, row); throw fault('composition_conflict_changed'); }
        await sources(ctx, row.source_revision);
        const result = await storage.resolveCompositionSync(workspaceId, binding(workspaceId), {
          choice, expectedLocalRevision: expected.expectedLocalRevision, remoteRow: row }); guard(ctx);
        emit(workspaceId);
        if (choice === 'local') {
          try { await run(ctx); } catch (error) { result.syncError = { code: error.code, message: error.message }; }
          guard(ctx);
        }
        return result;
      });
    }
    async function automatic() {
      if (disposed || refreshing || root.document?.visibilityState === 'hidden') return;
      refreshing = true;
      try {
        guard(); const rows = await storage.listWorkspaces(); guard();
        for (const row of rows) {
          const state = await getState(row.workspaceId);
          if (state.enabled) { watch(row.workspaceId); schedule(row.workspaceId); }
        }
      } catch (_) { /* State stays durable; an explicit retry gives the current error. */ }
      finally { refreshing = false; }
    }
    function start() {
      guard(); if (started) return; started = true;
      root.addEventListener?.('online', automatic); root.addEventListener?.('focus', automatic);
      root.document?.addEventListener('visibilitychange', automatic);
      interval = root.setInterval(automatic, 30000); interval?.unref?.();
      unlistenSources = sourceSync.subscribe(event => { if (event.workspaceId && watches.has(event.workspaceId) && ![...locks.keys()].some(key => key.startsWith(event.workspaceId + '|'))) schedule(event.workspaceId); });
      automatic();
    }
    function dispose() {
      if (disposed) return; disposed = true;
      for (const timer of timers.values()) root.clearTimeout(timer);
      for (const stop of watches.values()) stop();
      timers.clear(); watches.clear(); listeners.clear();
      root.clearInterval(interval); unlistenSources?.();
      root.removeEventListener?.('online', automatic); root.removeEventListener?.('focus', automatic);
      root.document?.removeEventListener('visibilitychange', automatic); remote.dispose?.();
    }
    function subscribe(listener) { guard(); listeners.add(listener); return () => listeners.delete(listener); }
    return Object.freeze({ start, getState, enable, pause, syncNow, compare, resolve, subscribe, dispose });
  }
  return Object.freeze({ create });
});

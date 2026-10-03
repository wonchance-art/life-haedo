(function (root, factory) {
  'use strict';
  const api = factory(root);
  root.HaedoLife = root.HaedoLife || {};
  root.HaedoLife.Sync = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : this, function (root) {
  'use strict';

  const MESSAGES = {
    auth_required: '로그인 후 다시 동기화해 주세요. 이 브라우저의 자료는 보존됩니다.',
    account_mismatch: '이 작업공간은 다른 계정 또는 프로젝트에 연결되어 있습니다. 새 사본으로 옮겨 주세요.',
    stale_session: '연결이 변경되어 이전 요청의 결과를 적용하지 않았습니다.',
    sync_paused: '이 작업공간의 동기화가 중지되어 있습니다.',
    not_enabled: '이 작업공간의 동기화를 먼저 명시적으로 시작해 주세요.',
    remote_exists: '같은 ID의 서버 작업공간이 있습니다. 서버 목록에서 열어 주세요.',
    remote_missing: '연결된 서버 작업공간을 찾을 수 없습니다. 자동으로 다시 만들지 않았습니다.',
    workspace_conflict: '이 브라우저의 변경이 있습니다. 양쪽 내용을 먼저 비교해 주세요.',
    stale_conflict: '비교 후 내용이나 버전이 바뀌었습니다. 다시 비교한 뒤 선택해 주세요.',
    remote_invalid: '서버 자료의 형식 또는 버전이 맞지 않아 적용하지 않았습니다.',
    remote_revision_regressed: '서버 버전이 이전보다 낮아 적용하지 않았습니다.',
    schema_missing: '서버에 자료 동기화 준비가 필요합니다. 연결 도움말을 확인해 주세요.',
    payload_too_large: '동기화할 자료가 서버의 크기 제한을 넘었습니다. 로컬 자료는 보존됩니다.',
    network_error: '서버 연결을 확인해 주세요. 전송 대기 작업은 보존됩니다.',
    dependency_unavailable: '동기화 모듈을 불러오지 못했습니다.',
    disposed: '동기화 화면이 종료되었습니다.'
  };
  function fault(code, message) {
    const error = new Error(message || MESSAGES[code] || '동기화하지 못했습니다. 로컬 자료와 전송 대기 작업은 보존됩니다.');
    error.code = code;
    return error;
  }
  function safeError(error) {
    let code = typeof error?.code === 'string' && /^[a-z_]{1,64}$/.test(error.code) ? error.code : 'network_error';
    if (code === 'snapshot_too_large') code = 'payload_too_large';
    return fault(code);
  }
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  function project(url) {
    let parsed;
    try { parsed = new URL(url); } catch (_) { throw fault('account_mismatch'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) throw fault('account_mismatch');
    return parsed.origin;
  }
  function accountCopy(value, config) {
    if (!value) return null;
    if (typeof value.userId !== 'string' || !value.userId || typeof value.projectUrl !== 'string' || project(value.projectUrl) !== project(config.url)) throw fault('account_mismatch');
    return { userId: value.userId, email: typeof value.email === 'string' ? value.email : '', projectUrl: project(value.projectUrl) };
  }
  function sameBinding(left, right) {
    return !!left && !!right && left.projectUrl === right.projectUrl && left.userId === right.userId && left.remoteId === right.remoteId;
  }
  function create({ storage, core, remoteFactory } = {}) {
    if (!storage || !core) throw fault('dependency_unavailable');
    const support = root.HaedoLife?.Remote;
    const factory = remoteFactory || support?.create;
    const loadConfig = remoteFactory?.loadConfig || support?.loadConfig;
    const saveConfig = remoteFactory?.saveConfig || support?.saveConfig;
    const listeners = new Set(), watches = new Map(), timers = new Map(), locks = new Map(), spaceEpochs = new Map(), closingAdapters = new Set();
    let adapter = null, config = null, account = null, epoch = 0, disposed = false, authUnsubscribe = null, interval = null, lifecycle = false;
    let pendingReconnect = null, reconnecting = null;
    const connectionCandidates = new Set();

    function emit(type, workspaceId, error) {
      const event = { type };
      if (workspaceId) event.workspaceId = workspaceId;
      if (error) event.error = { code: error.code, message: error.message };
      for (const listener of listeners) { try { listener(clone(event)); } catch (_) { /* Views cannot cancel durable writes. */ } }
    }
    function live() { if (disposed) throw fault('disposed'); }
    function localAccount(value) {
      // Product storage handles have a fixed owner. Auth events never turn an A handle into a B handle.
      const owner = storage.account;
      if (owner && (!value || owner.userId !== value.userId || owner.projectUrl !== value.projectUrl)) throw fault('account_mismatch');
    }
    function scope(workspaceId) {
      live();
      if (!adapter || !account) throw fault('auth_required');
      localAccount(account);
      return { adapter, account: clone(account), epoch, workspaceId, spaceEpoch: spaceEpochs.get(workspaceId) || 0 };
    }
    function current(context) {
      return !disposed && context.epoch === epoch && context.adapter === adapter && account && context.account.userId === account.userId && context.account.projectUrl === account.projectUrl &&
        (!context.workspaceId || context.spaceEpoch === (spaceEpochs.get(context.workspaceId) || 0));
    }
    function guard(context) { if (!current(context)) throw fault('stale_session'); localAccount(context.account); }
    function binding(context, remoteId) { return { projectUrl: context.account.projectUrl, userId: context.account.userId, remoteId }; }
    function checkedBinding(context, state) {
      guard(context);
      const expected = binding(context, context.workspaceId);
      if (!state || !sameBinding(state.binding, expected)) throw fault(state ? 'account_mismatch' : 'not_enabled');
      if (!state.enabled) throw fault('sync_paused');
      return expected;
    }
    async function verified(context) {
      guard(context);
      const value = await context.adapter.getAccount();
      guard(context);
      const actual = accountCopy(value, { url: context.account.projectUrl });
      if (!actual || actual.userId !== context.account.userId || actual.projectUrl !== context.account.projectUrl) {
        epoch += 1; account = actual; clearWatches(); emit('account');
        throw fault(actual ? 'account_mismatch' : 'auth_required');
      }
      return actual;
    }
    function validateRow(row, remoteId) {
      if (!row || row.id !== remoteId || !Number.isSafeInteger(row.revision) || row.revision < 1 || !row.data || row.data.workspaceId !== remoteId) throw fault('remote_invalid');
      try { core.validateWorkspace(row.data); } catch (_) { throw fault('remote_invalid'); }
      return row;
    }
    async function readRemote(context, remoteId) {
      guard(context);
      const row = await context.adapter.read(remoteId);
      guard(context);
      return row === null ? null : validateRow(row, remoteId);
    }
    function serial(context, action) {
      const key = context.epoch + ':' + context.spaceEpoch + ':' + context.workspaceId;
      const previous = locks.get(key) || Promise.resolve();
      const next = previous.catch(() => {}).then(() => { guard(context); return action(); });
      locks.set(key, next);
      next.then(() => { if (locks.get(key) === next) locks.delete(key); }, () => { if (locks.get(key) === next) locks.delete(key); });
      return next;
    }
    function clearScheduled() {
      for (const timer of timers.values()) root.clearTimeout(timer);
      timers.clear();
    }
    function schedule(workspaceId, delay = 300) {
      if (disposed || !account) return;
      if (timers.has(workspaceId)) root.clearTimeout(timers.get(workspaceId));
      const timer = root.setTimeout(() => {
        timers.delete(workspaceId);
        syncNow(workspaceId).catch(() => {});
      }, delay);
      timer?.unref?.(); timers.set(workspaceId, timer);
    }
    function watch(workspaceId) {
      if (watches.has(workspaceId) || !storage.subscribe) return;
      const unsubscribe = storage.subscribe(workspaceId, event => {
        if (disposed) return;
        if (event.type === 'changed') { emit('state', workspaceId); schedule(workspaceId); }
        else if (event.type === 'sync_changed') emit('state', workspaceId);
        else if (event.type === 'error') emit('error', workspaceId, safeError(event.error));
      });
      watches.set(workspaceId, unsubscribe);
    }
    async function enabledSpaces(run) {
      if (disposed || !account) return;
      localAccount(account);
      const generation = epoch;
      const workspaces = await storage.listWorkspaces();
      for (const workspace of workspaces) {
        if (disposed || generation !== epoch || !account) return;
        const state = await storage.getSyncState(workspace.workspaceId);
        if (disposed || generation !== epoch || !account) return;
        if (state?.enabled && sameBinding(state.binding, { projectUrl: account.projectUrl, userId: account.userId, remoteId: workspace.workspaceId })) {
          watch(workspace.workspaceId);
          if (run && !state.conflict) schedule(workspace.workspaceId, 0);
        }
      }
    }
    function automatic() {
      if (disposed) return;
      if (pendingReconnect && !account) {
        if (reconnecting) return;
        const settings = clone(pendingReconnect);
        const retry = establish(settings, null);
        reconnecting = retry;
        retry.catch(error => { if (!disposed && error.code !== 'stale_session') emit('error', undefined, safeError(error)); })
          .finally(() => { if (reconnecting === retry) reconnecting = null; });
        return;
      }
      enabledSpaces(true).catch(error => { if (!disposed) emit('error', undefined, safeError(error)); });
    }
    function visible() { if (!root.document || root.document.visibilityState === 'visible') automatic(); }
    function startLifecycle() {
      if (lifecycle) return;
      lifecycle = true;
      root.addEventListener?.('online', automatic);
      root.document?.addEventListener?.('visibilitychange', visible);
      interval = root.setInterval(visible, 60000); interval?.unref?.();
    }
    function clearWatches() {
      clearScheduled();
      for (const unsubscribe of watches.values()) unsubscribe();
      watches.clear();
    }
    function detach() {
      authUnsubscribe?.(); authUnsubscribe = null;
      clearWatches();
    }
    function reset() {
      epoch += 1; detach();
      const previous = adapter;
      adapter = null; account = null; pendingReconnect = null; reconnecting = null;
      previous?.dispose?.();
      // A previous SDK logout must not remove a newer same-project session when its response arrives.
      for (const closing of closingAdapters) closing.dispose?.();
      closingAdapters.clear();
      for (const candidate of connectionCandidates) candidate.dispose?.();
      connectionCandidates.clear();
      return epoch;
    }
    function attachAuth(target, connectedEpoch) {
      if (!target.onAuthChange) return;
      authUnsubscribe = target.onAuthChange(value => {
        if (disposed || target !== adapter || connectedEpoch > epoch) return;
        let next;
        try { next = accountCopy(value, config); } catch (_) { next = null; }
        if (!next || !account || next.userId !== account.userId || next.projectUrl !== account.projectUrl) {
          epoch += 1; clearWatches(); account = next; emit('account');
          if (next) automatic();
        } else { account = next; emit('account'); }
      });
    }
    async function establish(settings, credentials) {
      live();
      if (typeof factory !== 'function') throw fault('dependency_unavailable');
      const generation = reset();
      const candidateConfig = { url: project(settings.url), key: settings.key };
      config = clone(candidateConfig); // Public connection settings remain available during an offline start.
      const candidate = factory(candidateConfig);
      connectionCandidates.add(candidate);
      try {
        const signedIn = credentials ? await candidate.signIn(credentials.email, credentials.password) : await candidate.getAccount();
        if (disposed || generation !== epoch) throw fault('stale_session');
        const actual = accountCopy(signedIn, candidateConfig);
        if (credentials && !actual) throw fault('auth_required');
        if (credentials && saveConfig) await saveConfig(clone(candidateConfig));
        if (disposed || generation !== epoch) throw fault('stale_session');
        connectionCandidates.delete(candidate);
        adapter = candidate; config = candidateConfig; account = actual;
        attachAuth(candidate, generation); startLifecycle(); emit('account');
        await enabledSpaces(false);
        if (disposed || candidate !== adapter) throw fault('stale_session');
        if (actual) automatic();
        return clone(account);
      } catch (error) {
        connectionCandidates.delete(candidate);
        if (candidate !== adapter) candidate.dispose?.();
        if (!credentials && !disposed && generation === epoch && safeError(error).code === 'network_error') pendingReconnect = clone(candidateConfig);
        throw safeError(error);
      }
    }
    async function start() {
      live(); startLifecycle();
      const generation = epoch;
      const settings = loadConfig ? await loadConfig() : config;
      if (disposed || generation !== epoch) throw fault('stale_session');
      if (!settings) return null;
      return establish(clone(settings), null);
    }
    async function connect(input) {
      live();
      const settings = { url: input?.url, key: input?.key };
      const credentials = { email: input?.email, password: input?.password };
      if (typeof credentials.email !== 'string' || typeof credentials.password !== 'string' || !credentials.email || !credentials.password) throw fault('auth_required');
      return establish(settings, credentials);
    }
    async function signOut() {
      live();
      const previous = adapter;
      if (previous) closingAdapters.add(previous);
      epoch += 1; detach(); adapter = null; account = null; config = null; pendingReconnect = null; reconnecting = null; emit('account');
      for (const candidate of connectionCandidates) candidate.dispose?.();
      connectionCandidates.clear();
      // Forget the startup connection before waiting for SDK logout: even a failed refresh must not resume on reload.
      try {
        if (saveConfig) await saveConfig(null);
        if (previous) await previous.signOut();
      }
      catch (error) { throw safeError(error); }
      finally { closingAdapters.delete(previous); previous?.dispose?.(); }
    }
    function getAccount() { return clone(account); }
    function getConfig() { return clone(config); }
    async function getState(workspaceId) {
      live();
      const generation = epoch;
      // Before shared Auth verification, a scoped manager exposes no source/conflict snapshot.
      if (storage.account && !account) return { status: 'auth_required', enabled: false, binding: null,
        remoteRevision: 0, syncedLocalRevision: -1, conflict: null, error: null, account: null };
      localAccount(account);
      const state = await storage.getSyncState(workspaceId);
      live();
      if (generation !== epoch) throw fault('stale_session');
      localAccount(account);
      let status = state?.status || 'not_enabled';
      if (!config) status = 'not_configured';
      else if (!account) status = 'auth_required';
      else if (state && !sameBinding(state.binding, { projectUrl: account.projectUrl, userId: account.userId, remoteId: workspaceId })) status = 'account_mismatch';
      else if (state && !state.enabled) status = 'paused';
      return { status, enabled: !!state?.enabled, binding: clone(state?.binding || null), remoteRevision: state?.remoteRevision ?? 0,
        syncedLocalRevision: state?.syncedLocalRevision ?? -1, conflict: clone(state?.conflict || null), error: state?.error ? { code: state.error.code, message: safeError(state.error).message } : null, account: getAccount() };
    }
    async function enable(workspaceId) {
      const context = scope(workspaceId);
      return serial(context, async () => {
        await verified(context);
        const state = await storage.getSyncState(workspaceId); guard(context);
        const expected = binding(context, workspaceId);
        if (state && !sameBinding(state.binding, expected)) throw fault('account_mismatch');
        if (!state) {
          const row = await readRemote(context, workspaceId);
          if (row) throw fault('remote_exists');
          await verified(context);
        }
        guard(context); await storage.bindSync(workspaceId, expected); guard(context);
        watch(workspaceId); emit('state', workspaceId);
        return runSync(context);
      });
    }
    async function pause(workspaceId) {
      const context = scope(workspaceId);
      const nextGeneration = (spaceEpochs.get(workspaceId) || 0) + 1;
      spaceEpochs.set(workspaceId, nextGeneration); context.spaceEpoch = nextGeneration;
      const state = await storage.getSyncState(workspaceId);
      guard(context);
      if (!state || !sameBinding(state.binding, binding(context, workspaceId))) throw fault(state ? 'account_mismatch' : 'not_enabled');
      if (timers.has(workspaceId)) root.clearTimeout(timers.get(workspaceId)); timers.delete(workspaceId);
      await storage.pauseSync(workspaceId, state.binding);
      emit('state', workspaceId);
      return getState(workspaceId);
    }
    async function listRemote() {
      const context = scope(); await verified(context);
      const rows = await context.adapter.list(); guard(context); await verified(context);
      return clone(rows);
    }
    async function download(remoteId) {
      const context = scope(remoteId);
      return serial(context, async () => {
        await verified(context);
        const row = await readRemote(context, remoteId);
        if (!row) throw fault('remote_missing');
        await verified(context);
        const spaces = await storage.listWorkspaces(); guard(context);
        const expected = binding(context, remoteId);
        let result;
        if (spaces.some(item => item.workspaceId === remoteId)) {
          const state = await storage.getSyncState(remoteId); guard(context);
          if (!state) throw fault('workspace_conflict');
          checkedBinding(context, state);
          const local = await storage.read(remoteId); guard(context);
          if (state.outbox || local.revision !== state.syncedLocalRevision || state.conflict) throw fault('workspace_conflict');
          if (row.revision < state.remoteRevision) throw fault('remote_revision_regressed');
          if (row.revision > state.remoteRevision) {
            const applied = await storage.applySyncRemote(remoteId, expected, row); guard(context);
            if (applied.status !== 'stored') { await storage.setSyncConflict(remoteId, expected, row); throw fault('workspace_conflict'); }
          }
          result = await storage.read(remoteId);
        } else result = await storage.installSyncRemote(row, expected);
        guard(context); watch(remoteId); emit('state', remoteId);
        return clone(result);
      });
    }
    async function observeConflict(context, expected, row) {
      guard(context);
      if (row) validateRow(row, context.workspaceId);
      await storage.setSyncConflict(context.workspaceId, expected, row); guard(context);
      emit('state', context.workspaceId);
      return getState(context.workspaceId);
    }
    async function upload(context, expected, outbox) {
      await verified(context);
      const reply = await context.adapter.write({ workspaceId: expected.remoteId, expectedRevision: outbox.expectedRevision, operationId: outbox.operationId, data: clone(outbox.data) });
      guard(context); await verified(context);
      if (reply?.status === 'stored') {
        if (!Number.isSafeInteger(reply.revision) || reply.revision !== outbox.expectedRevision + 1) throw fault('remote_invalid');
        await storage.ackSync(context.workspaceId, expected, outbox.operationId, reply.revision); guard(context);
        emit('state', context.workspaceId); return true;
      }
      if (reply?.status === 'conflict' || reply?.status === 'missing') {
        const row = reply.status === 'missing' ? null : await readRemote(context, expected.remoteId);
        await observeConflict(context, expected, row); return false;
      }
      throw fault('remote_invalid');
    }
    async function runSync(context) {
      try {
        await verified(context);
        for (let pass = 0; pass < 8; pass++) {
          const state = await storage.getSyncState(context.workspaceId); guard(context);
          const expected = checkedBinding(context, state);
          if (state.conflict) return observeConflict(context, expected, await readRemote(context, expected.remoteId));
          // A saved request always precedes remote reads: a lost success is recovered from its receipt.
          if (state.outbox) { if (await upload(context, expected, state.outbox)) continue; return getState(context.workspaceId); }
          if (state.remoteRevision === 0 && state.syncedLocalRevision === -1) {
            const outbox = await storage.prepareSyncUpload(context.workspaceId, expected); guard(context);
            if (outbox) { if (await upload(context, expected, outbox)) continue; return getState(context.workspaceId); }
          }
          const row = await readRemote(context, expected.remoteId);
          await verified(context);
          if (!row) return observeConflict(context, expected, null);
          if (row.revision < state.remoteRevision) throw fault('remote_revision_regressed');
          const local = await storage.read(context.workspaceId); guard(context);
          const dirty = local.revision !== state.syncedLocalRevision;
          if (row.revision > state.remoteRevision) {
            if (dirty) return observeConflict(context, expected, row);
            const applied = await storage.applySyncRemote(context.workspaceId, expected, row); guard(context);
            if (applied.status !== 'stored') return observeConflict(context, expected, row);
            emit('state', context.workspaceId); continue;
          }
          if (!dirty) {
            if (state.error) { await storage.setSyncError(context.workspaceId, expected, null); guard(context); }
            return getState(context.workspaceId);
          }
          const outbox = await storage.prepareSyncUpload(context.workspaceId, expected); guard(context);
          if (outbox) { if (await upload(context, expected, outbox)) continue; return getState(context.workspaceId); }
        }
        schedule(context.workspaceId, 0);
        return getState(context.workspaceId);
      } catch (error) {
        if (!current(context) || ['stale_session', 'stale_sync_result', 'sync_paused'].includes(error?.code)) return { status: 'cancelled' };
        const clean = safeError(error);
        try { await storage.setSyncError(context.workspaceId, binding(context, context.workspaceId), { code: clean.code, message: clean.message }); } catch (_) { /* A paused/changed binding must not be altered. */ }
        if (current(context)) emit('error', context.workspaceId, clean);
        throw clean;
      }
    }
    function syncNow(workspaceId) {
      let context;
      try { context = scope(workspaceId); } catch (error) { return Promise.reject(safeError(error)); }
      return serial(context, () => runSync(context));
    }
    async function resolve(workspaceId, choice, expectedVersions = {}) {
      if (!['local', 'remote'].includes(choice)) throw fault('stale_conflict');
      const context = scope(workspaceId);
      return serial(context, async () => {
        await verified(context);
        const state = await storage.getSyncState(workspaceId); guard(context);
        const expected = checkedBinding(context, state), conflict = state.conflict;
        if (!conflict) throw fault('stale_conflict');
        if (conflict.missing || !conflict.row) throw fault('remote_missing');
        const local = await storage.read(workspaceId); guard(context);
        const reviewedLocal = expectedVersions.expectedLocalRevision ?? conflict.localRevision;
        if (local.revision !== reviewedLocal ||
          expectedVersions.expectedRemoteRevision !== undefined && expectedVersions.expectedRemoteRevision !== conflict.remoteRevision) throw fault('stale_conflict');
        const row = await readRemote(context, workspaceId); await verified(context);
        if (!row || row.revision !== conflict.remoteRevision) { await observeConflict(context, expected, row); throw fault(row ? 'stale_conflict' : 'remote_missing'); }
        // An explicit fresh preview may include local edits made after the original conflict.
        // Refresh only the same checked server snapshot; storage still checks both revisions atomically.
        await storage.setSyncConflict(workspaceId, expected, row); guard(context);
        const preserved = choice === 'local' ? row.data : local;
        const copy = await core.restoreBackup(core.makeBackup(preserved)); guard(context);
        await verified(context);
        const result = await storage.resolveSync(workspaceId, expected, { choice, expectedLocalRevision: local.revision, remoteRow: row, copy }); guard(context);
        emit('state', workspaceId);
        if (choice === 'local') {
          try { await runSync(context); } catch (error) { result.syncError = { code: error.code, message: error.message }; }
        }
        guard(context); return result;
      });
    }
    function subscribe(listener) {
      live(); if (typeof listener !== 'function') throw fault('dependency_unavailable');
      listeners.add(listener); return () => listeners.delete(listener);
    }
    function dispose() {
      if (disposed) return;
      epoch += 1; disposed = true; detach();
      adapter?.dispose?.(); adapter = null; account = null;
      for (const closing of closingAdapters) closing.dispose?.();
      closingAdapters.clear(); pendingReconnect = null; reconnecting = null;
      for (const candidate of connectionCandidates) candidate.dispose?.();
      connectionCandidates.clear();
      if (interval !== null) root.clearInterval(interval);
      root.removeEventListener?.('online', automatic);
      root.document?.removeEventListener?.('visibilitychange', visible);
      listeners.clear(); locks.clear();
    }
    return Object.freeze({ start, connect, signOut, getAccount, getConfig, getState, subscribe, enable, pause, listRemote, download, syncNow, resolve, dispose });
  }
  return Object.freeze({ create });
});

/* Local persistence only. No legacy storage, credentials, or network access. */
(function (root) {
  'use strict';

  const DB_NAME = 'life-tools-v1';
  const DB_VERSION = 1;
  const SYNC_MAX_BYTES = 16 * 1024 * 1024;
  const COLLECTIONS = ['sources', 'sourceVersions', 'records', 'links', 'resumeHints', 'tombstones'];
  const clone = value => structuredClone(value);
  const plain = value => value !== null && typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  function fault(code, message) { return Object.assign(new Error(message), { code }); }
  function errorInfo(error) {
    if (error?.code && typeof error.code === 'string') return { code: error.code, message: error.message || '저장하지 못했습니다.' };
    const errors = {
      QuotaExceededError: ['storage_quota', '브라우저 저장 공간이 부족합니다. 입력을 보존하고 백업을 내려받으세요.'],
      AbortError: ['storage_aborted', '저장이 중단되었습니다. 입력을 확인하고 다시 저장하세요.'],
      VersionError: ['storage_version_changed', '다른 버전의 저장소입니다. 이 화면을 새로고침하세요.'],
      InvalidStateError: ['storage_unavailable', '브라우저 저장소 연결을 사용할 수 없습니다.'],
      SecurityError: ['storage_unavailable', '이 브라우저에서 저장소에 접근할 수 없습니다.']
    };
    const [code, message] = errors[error?.name] || ['storage_error', '브라우저 저장소를 읽거나 저장하지 못했습니다.'];
    return { code, message };
  }
  function asFault(error) { const info = errorInfo(error); return fault(info.code, info.message); }
  function requireId(value, name) {
    if (typeof value !== 'string' || !value.trim()) throw fault('invalid_request', `${name} 식별자가 필요합니다.`);
  }
  function requireRevision(value, name = 'revision') {
    if (!Number.isSafeInteger(value) || value < 0) throw fault('invalid_request', `${name} 값이 올바르지 않습니다.`);
  }
  function accountValue(value) {
    if (!plain(value) || typeof value.userId !== 'string' || !value.userId.trim()) {
      throw fault('auth_scope_required', '확인된 로그인 계정으로 자료를 열어 주세요.');
    }
    let url;
    try { url = new URL(value.projectUrl); } catch (_) { throw fault('auth_scope_required', '로그인 프로젝트를 확인할 수 없습니다.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw fault('auth_scope_required', '로그인 프로젝트를 확인할 수 없습니다.');
    }
    return Object.freeze({ projectUrl: url.origin, userId: value.userId });
  }
  const sameAccount = (left, right) => !!left && !!right && left.projectUrl === right.projectUrl && left.userId === right.userId;

  // JSON order is irrelevant; unsupported values must not collapse to the same receipt.
  function stablePayload(value) {
    const seen = new Set();
    function visit(item) {
      if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
      if (typeof item === 'number' && Number.isFinite(item)) return item;
      if (typeof item !== 'object' || (!Array.isArray(item) && !plain(item)) || seen.has(item)) {
        throw fault('invalid_request', '저장할 작업은 순환 참조 없는 JSON 값이어야 합니다.');
      }
      seen.add(item);
      let result;
      if (Array.isArray(item)) {
        result = Array.from(item, entry => visit(entry));
      } else {
        result = Object.create(null);
        for (const key of Object.keys(item).sort()) {
          // Missing optional object properties and explicit undefined have the same JSON meaning.
          if (item[key] !== undefined) result[key] = visit(item[key]);
        }
      }
      seen.delete(item);
      return result;
    }
    return JSON.stringify(visit(value));
  }

  function createStorage(options = {}) {
    const name = options.dbName || DB_NAME;
    const account = options.account === undefined ? null : accountValue(options.account);
    const accountKey = account ? JSON.stringify([account.projectUrl, account.userId]) : null;
    const activeKey = account ? `activeWorkspace:${accountKey}` : 'activeWorkspace';
    const listeners = new Map();
    const transactions = new Set();
    const sender = root.crypto?.randomUUID?.() || `tab-${Date.now()}-${Math.random()}`;
    let connection = null, opening = null, failure = null, pendingOpen = null;
    let channel = null, generation = 0;
    let disposed = false, childScope = null;
    function scopeGuard() {
      if (disposed) throw fault('storage_scope_closed', '이전 계정의 자료 화면이 닫혔습니다. 현재 로그인 계정에서 다시 열어 주세요.');
    }
    const core = () => {
      const value = options.core || root.HaedoLife?.Core;
      if (!value?.validateWorkspace || !value?.applyChanges || !value?.createWorkspace) {
        throw fault('dependency_unavailable', '데이터 모듈을 불러오지 못했습니다.');
      }
      return value;
    };
    const workbench = () => {
      const value = options.workbench || root.HaedoLife?.Workbench;
      if (!value?.validate || !value?.empty) throw fault('dependency_unavailable', '활동·페이지 구성 모듈을 불러오지 못했습니다.');
      return value;
    };
    function notify(event) {
      if (disposed) return;
      const callbacks = event.type === 'error'
        ? [...listeners.values()].flatMap(group => [...group])
        : [...(listeners.get(event.workspaceId) || [])];
      for (const listener of callbacks) {
        try { listener(clone(event)); } catch (_) { /* A view listener cannot undo a committed write. */ }
      }
    }
    function changed(workspaceId, revision) {
      const event = { type: 'changed', workspaceId, revision };
      notify(event);
      try { channel?.postMessage({ ...event, sender }); } catch (_) { /* Notifications are advisory. */ }
    }
    function syncChanged(state) {
      const event = { type: 'sync_changed', workspaceId: state.workspaceId, status: state.status, enabled: state.enabled };
      notify(event);
      try { channel?.postMessage({ ...event, sender }); } catch (_) { /* Persistent state is authoritative. */ }
    }
    function workbenchChanged(state) {
      const event = { type: 'workbench_changed', workspaceId: state.workspaceId, revision: state.revision };
      notify(event);
      try { channel?.postMessage({ ...event, sender }); } catch (_) { /* Persistent state is authoritative. */ }
    }
    function ensureChannel() {
      if (channel || options.channelFactory === null) return;
      try {
        const factory = options.channelFactory || (root.BroadcastChannel ? key => new root.BroadcastChannel(key) : null);
        channel = factory?.(`${name}:changes${accountKey ? ':' + accountKey : ''}`) || null;
        if (channel) channel.onmessage = ({ data }) => {
          if (data?.sender !== sender && data?.type === 'sync_changed' && typeof data.workspaceId === 'string') {
            notify({ type: 'sync_changed', workspaceId: data.workspaceId });
          }
          if (data?.sender !== sender && data?.type === 'changed' && typeof data.workspaceId === 'string' &&
              Number.isSafeInteger(data.revision) && data.revision >= 0) {
            notify({ type: 'changed', workspaceId: data.workspaceId, revision: data.revision });
          }
          if (data?.sender !== sender && data?.type === 'workbench_changed' && typeof data.workspaceId === 'string' &&
              Number.isSafeInteger(data.revision) && data.revision >= 0) {
            notify({ type: 'workbench_changed', workspaceId: data.workspaceId, revision: data.revision });
          }
        };
      } catch (_) { channel = null; }
    }
    function invalidate(error, token) {
      if (token !== generation || failure) return;
      failure = error;
      for (const tx of transactions) { try { tx.abort(); } catch (_) {} }
      connection?.close();
      connection = null;
      pendingOpen?.reject(error);
      pendingOpen = null;
      notify({ type: 'error', error: errorInfo(error) });
    }
    function open() {
      try { scopeGuard(); } catch (error) { return Promise.reject(error); }
      if (failure) return Promise.reject(failure);
      if (opening) return opening;
      const token = ++generation;
      opening = new Promise((resolve, reject) => {
        pendingOpen = { reject };
        let request;
        try {
          core();
          const library = options.idb || root.idb;
          if (!library?.openDB) throw fault('dependency_unavailable', '브라우저 저장소 모듈을 불러오지 못했습니다.');
          request = library.openDB(name, DB_VERSION, {
            upgrade(db) {
              if (!db.objectStoreNames.contains('bundles')) db.createObjectStore('bundles', { keyPath: 'workspaceId' });
              if (!db.objectStoreNames.contains('operations')) db.createObjectStore('operations', { keyPath: ['workspaceId', 'operationId'] });
              if (!db.objectStoreNames.contains('staging')) {
                const stages = db.createObjectStore('staging', { keyPath: 'stageId' });
                stages.createIndex('workspaceId', 'workspaceId');
              }
              if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
              if (!db.objectStoreNames.contains('recovery')) db.createObjectStore('recovery', { keyPath: 'id' });
            },
            blocked() { invalidate(fault('storage_blocked', '다른 탭이 저장소 열기를 막고 있습니다. 다른 탭을 닫고 다시 여세요.'), token); },
            blocking() { invalidate(fault('storage_version_changed', '다른 탭에서 저장소 버전이 바뀌었습니다. 입력을 보존하고 새로고침하세요.'), token); },
            terminated() { invalidate(fault('storage_terminated', '브라우저 저장소 연결이 끊어졌습니다. 입력을 보존하고 새로고침하세요.'), token); }
          });
        } catch (error) { invalidate(asFault(error), token); return; }
        Promise.resolve(request).then(db => {
          // A blocked/cancelled request can finish later; never publish its stale connection.
          if (token !== generation || failure) { db.close(); return; }
          connection = db;
          pendingOpen = null;
          ensureChannel();
          resolve(api);
        }, error => invalidate(asFault(error), token));
      });
      return opening;
    }
    function close() {
      if (account) disposed = true;
      childScope?.dispose(); childScope = null;
      generation += 1;
      pendingOpen?.reject(fault('storage_closed', '저장소 연결을 닫았습니다.'));
      pendingOpen = null;
      for (const tx of transactions) { try { tx.abort(); } catch (_) {} }
      connection?.close();
      connection = null;
      channel?.close();
      channel = null;
      opening = null;
      failure = null;
      if (disposed) listeners.clear();
    }
    function dispose() { disposed = true; close(); listeners.clear(); }
    function clearAccount() { childScope?.dispose(); childScope = null; }
    function forAccount(authenticatedAccount) {
      scopeGuard();
      if (account) throw fault('auth_scope_fixed', '계정이 고정된 저장소의 계정을 바꿀 수 없습니다.');
      const next = accountValue(authenticatedAccount);
      clearAccount();
      childScope = createStorage({ ...options, account: next });
      return childScope;
    }
    async function transaction(stores, mode, run) {
      scopeGuard();
      await open();
      scopeGuard();
      if (failure || !connection) throw failure || fault('storage_closed', '저장소 연결을 닫았습니다.');
      let tx;
      try {
        tx = connection.transaction([...new Set([...stores, 'meta'])], mode);
        transactions.add(tx);
        // Attach immediately, including when a request rejects before the completion is awaited.
        tx.done.catch(() => {});
        const result = await run(tx);
        scopeGuard();
        await tx.done;
        scopeGuard();
        return result;
      } catch (error) {
        if (tx) {
          try { tx.abort(); } catch (_) { /* Already completed or aborted. */ }
          await tx.done.catch(() => {});
        }
        if (disposed) scopeGuard();
        throw asFault(error);
      } finally {
        if (tx) transactions.delete(tx);
      }
    }
    async function workspaceOwner(meta, workspaceId) {
      const owner = await meta.get(`owner:${workspaceId}`);
      let explicit = null;
      if (owner !== undefined) {
        try {
          onlyFields(owner.value, ['projectUrl', 'userId'], 'invalid_account_binding');
          explicit = accountValue(owner.value);
        } catch (_) { throw fault('invalid_account_binding', '로컬 자료의 계정 소유 정보를 확인할 수 없습니다. 원본은 보존했습니다.'); }
      }
      const synced = await meta.get(`sync:${workspaceId}`);
      let previous = null;
      if (synced !== undefined) {
        try { previous = accountValue(bindingValue(synced.value?.binding, workspaceId)); }
        catch (_) { throw fault('invalid_sync_metadata', '기존 동기화 자료의 계정을 확인할 수 없습니다. 원본은 보존했습니다.'); }
      }
      if (explicit && previous && !sameAccount(explicit, previous)) {
        throw fault('invalid_account_binding', '로컬 소유 계정과 동기화 계정이 다릅니다. 원본은 보존했습니다.');
      }
      // A pre-existing sync binding is ownership evidence; an unbound bundle is never claimed here.
      return explicit || previous;
    }
    async function assertOwner(meta, workspaceId) {
      scopeGuard();
      if (account && !sameAccount(await workspaceOwner(meta, workspaceId), account)) {
        throw fault('workspace_access_denied', '현재 계정에서 이 작업공간에 접근할 수 없습니다.');
      }
      scopeGuard();
    }
    async function saveOwner(meta, workspaceId) {
      if (account) await meta.put({ key: `owner:${workspaceId}`, value: clone(account) });
    }
    async function checkedBundle(store, workspaceId, meta) {
      if (account) await assertOwner(meta, workspaceId);
      const bundle = await store.get(workspaceId);
      if (!bundle) throw fault('workspace_not_found', '작업공간을 찾을 수 없습니다. 기존 백업과 작업공간 목록을 확인하세요.');
      core().validateWorkspace(bundle);
      return bundle;
    }
    function onlyFields(value, allowed, code = 'invalid_sync_metadata') {
      if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) {
        throw fault(code, '동기화 정보의 형식을 확인할 수 없습니다. 기존 자료를 보존하고 연결 상태를 확인하세요.');
      }
    }
    function bindingValue(input, workspaceId) {
      onlyFields(input, ['projectUrl', 'userId', 'remoteId'], 'invalid_binding');
      requireId(input.userId, '계정'); requireId(input.remoteId, '서버 작업공간');
      let url;
      try { url = new URL(input.projectUrl); } catch (_) { throw fault('invalid_binding', '동기화 프로젝트 주소를 확인하세요.'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
          (workspaceId !== undefined && input.remoteId !== workspaceId)) {
        throw fault('invalid_binding', '계정과 작업공간의 동기화 연결을 확인하세요.');
      }
      return { projectUrl: url.origin, userId: input.userId, remoteId: input.remoteId };
    }
    function remoteRow(input, workspaceId) {
      if (!plain(input) || !Number.isSafeInteger(input.revision) || input.revision < 1) {
        throw fault('invalid_remote_snapshot', '서버 작업공간의 버전을 확인할 수 없습니다.');
      }
      const row = clone(input);
      core().validateWorkspace(row.data);
      if (row.id !== row.data.workspaceId || (workspaceId !== undefined && row.id !== workspaceId) ||
          (row.title !== undefined && row.title !== row.data.title)) {
        throw fault('invalid_remote_snapshot', '서버 작업공간의 식별자와 내용이 일치하지 않습니다.');
      }
      if (new TextEncoder().encode(JSON.stringify(row.data)).length > SYNC_MAX_BYTES) {
        throw fault('snapshot_too_large', '동기화 스냅샷은 16 MiB까지 지원합니다. 로컬 자료는 보존했습니다.');
      }
      // Preserve only the documented row fields; never retain SDK/session objects.
      return { id: row.id, title: row.data.title, revision: row.revision, data: row.data,
        ...(typeof row.updated_at === 'string' ? { updated_at: row.updated_at } : {}) };
    }
    function immutableVersions(local, incoming) {
      const previous = new Map((local.sourceVersions || []).map(version => [version.id, version]));
      for (const version of incoming.sourceVersions || []) {
        const original = previous.get(version.id);
        if (original && stablePayload(original) !== stablePayload(version)) {
          throw fault('immutable_source_version', '서버의 원문 버전이 같은 식별자로 변경되었습니다. 로컬 원문은 보존했습니다.');
        }
      }
    }
    function validateSyncState(state, workspaceId) {
      try {
        onlyFields(state, ['workspaceId', 'binding', 'enabled', 'remoteRevision', 'syncedLocalRevision', 'outbox', 'conflict', 'status', 'error']);
        if (state.workspaceId !== workspaceId || typeof state.enabled !== 'boolean' ||
            !['pending', 'synced', 'conflict', 'error'].includes(state.status) ||
            !Number.isSafeInteger(state.syncedLocalRevision) || state.syncedLocalRevision < -1) throw new Error('metadata');
        if (stablePayload(bindingValue(state.binding, workspaceId)) !== stablePayload(state.binding)) throw new Error('binding');
        requireRevision(state.remoteRevision);
        if (state.outbox !== null) {
          const box = state.outbox;
          onlyFields(box, ['operationId', 'expectedRevision', 'localRevision', 'data']);
          requireId(box.operationId, '전송 작업'); requireRevision(box.expectedRevision); requireRevision(box.localRevision);
          core().validateWorkspace(box.data);
          if (box.data.workspaceId !== workspaceId || box.data.revision !== box.localRevision || box.expectedRevision !== state.remoteRevision) throw new Error('outbox');
        }
        if (state.conflict !== null) {
          onlyFields(state.conflict, ['missing', 'row', 'remoteRevision', 'localRevision']);
          if (typeof state.conflict.missing !== 'boolean') throw new Error('conflict');
          requireRevision(state.conflict.remoteRevision); requireRevision(state.conflict.localRevision);
          if (state.conflict.missing ? state.conflict.row !== null :
            remoteRow(state.conflict.row, workspaceId).revision !== state.conflict.remoteRevision) throw new Error('conflict');
          if (state.conflict.remoteRevision < state.remoteRevision) throw new Error('conflict revision');
        }
        if (state.error !== null) {
          onlyFields(state.error, ['code', 'message']);
          if (typeof state.error.code !== 'string' || typeof state.error.message !== 'string') throw new Error('error');
        }
        if ((state.status === 'conflict') !== (state.conflict !== null) ||
            (state.status === 'synced' && (state.outbox || state.error || state.syncedLocalRevision < 0)) ||
            (state.status === 'error' && !state.error) || (state.status === 'pending' && state.error) ||
            (state.remoteRevision === 0 && state.syncedLocalRevision !== -1) ||
            (state.outbox && state.outbox.localRevision <= state.syncedLocalRevision)) throw new Error('state consistency');
      } catch (_) { throw fault('invalid_sync_metadata', '동기화 정보가 손상되었습니다. 자료를 보존하고 연결 상태를 확인하세요.'); }
      return state;
    }
    async function readSyncState(store, workspaceId, bundle) {
      if (account) await assertOwner(store, workspaceId);
      const entry = await store.get(`sync:${workspaceId}`);
      if (entry === undefined) return null;
      const state = validateSyncState(entry.value, workspaceId);
      if (bundle && (state.syncedLocalRevision > bundle.revision || state.outbox?.localRevision > bundle.revision ||
          state.conflict?.localRevision > bundle.revision)) {
        throw fault('invalid_sync_metadata', '동기화 기준이 현재 로컬 자료보다 앞서 있습니다. 기존 자료를 보존했습니다.');
      }
      return state;
    }
    async function writeSyncState(store, state) {
      if (account && !sameAccount(account, state.binding)) throw fault('account_mismatch', '현재 로그인 계정과 동기화 계정이 다릅니다.');
      validateSyncState(state, state.workspaceId);
      await store.put({ key: `sync:${state.workspaceId}`, value: state });
      return clone(state);
    }
    function authorizedSync(state, binding, enabled = true) {
      if (account && !sameAccount(account, binding)) throw fault('account_mismatch', '현재 로그인 계정과 동기화 계정이 다릅니다.');
      if (!state) throw fault('sync_not_configured', '이 작업공간의 동기화를 먼저 연결하세요.');
      if (stablePayload(state.binding) !== stablePayload(binding)) throw fault('account_mismatch', '이 작업공간은 다른 계정 또는 프로젝트에 연결되어 있습니다.');
      if (enabled && !state.enabled) throw fault('sync_paused', '이 작업공간의 동기화가 중지되어 있습니다.');
      return state;
    }
    function syncStatus(state, bundle) {
      return state.conflict ? 'conflict' : state.outbox || bundle.revision !== state.syncedLocalRevision ? 'pending' : 'synced';
    }
    function revisionFloor(state) { return Math.max(state.remoteRevision, state.conflict?.remoteRevision || 0); }
    function nextLocalSnapshot(local, row) {
      immutableVersions(local, row.data);
      const bundle = { ...clone(row.data), revision: local.revision + 1 };
      core().validateWorkspace(bundle);
      return bundle;
    }
    async function listWorkspaces() {
      return transaction(['bundles'], 'readonly', async tx => {
        const bundles = await tx.objectStore('bundles').getAll();
        const result = [];
        for (const bundle of bundles) {
          if (account && !sameAccount(await workspaceOwner(tx.objectStore('meta'), bundle.workspaceId), account)) continue;
          core().validateWorkspace(bundle);
          result.push({ workspaceId: bundle.workspaceId, title: bundle.title, revision: bundle.revision });
        }
        return result;
      });
    }
    async function read(workspaceId) {
      requireId(workspaceId, '작업공간');
      return transaction(['bundles'], 'readonly', async tx => clone(await checkedBundle(tx.objectStore('bundles'), workspaceId, tx.objectStore('meta'))));
    }
    async function workbenchValue(meta, workspaceId) {
      const row = await meta.get(`workbench:${workspaceId}`);
      const state = row === undefined ? workbench().empty(workspaceId) : row.value;
      workbench().validate(state);
      if (state.workspaceId !== workspaceId) throw fault('workspace_mismatch', '구성의 작업공간이 다릅니다. 기존 구성을 보존했습니다.');
      return state;
    }
    async function readWorkbenchSnapshot(workspaceId) {
      requireId(workspaceId, '작업공간');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, tx.objectStore('meta'));
        const state = await workbenchValue(tx.objectStore('meta'), workspaceId);
        return { bundle: clone(bundle), workbench: clone(state) };
      });
    }
    async function readWorkbench(workspaceId) { return (await readWorkbenchSnapshot(workspaceId)).workbench; }
    async function saveWorkbench(workspaceId, input, baseRevision) {
      requireId(workspaceId, '작업공간'); requireRevision(baseRevision, 'baseRevision');
      workbench().validate(input);
      const state = clone(input);
      if (state.workspaceId !== workspaceId) throw fault('workspace_mismatch', '저장할 구성의 작업공간이 다릅니다.');
      if (state.revision !== baseRevision) throw fault('workbench_conflict', '구성의 저장 기준이 달라졌습니다. 입력을 보존하고 최신 구성을 확인해 주세요.');
      const saved = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta');
        await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const previous = await workbenchValue(meta, workspaceId);
        if (previous.revision !== baseRevision) throw fault('workbench_conflict', '다른 탭에서 구성을 바꿨습니다. 입력을 보존하고 최신 구성을 확인해 주세요.');
        state.revision = baseRevision + 1;
        workbench().validate(state);
        await meta.put({ key: `workbench:${workspaceId}`, value: state });
        return clone(state);
      });
      workbenchChanged(saved);
      return saved;
    }
    async function installWorkbenchCopy(input) {
      if (!plain(input) || Object.keys(input).some(key => !['bundle', 'workbench'].includes(key))) {
        throw fault('invalid_workbench', '설치할 자료와 구성을 확인해 주세요.');
      }
      core().validateWorkspace(input.bundle); workbench().validate(input.workbench);
      const { bundle, workbench: state } = clone(input);
      if (bundle.workspaceId !== state.workspaceId) throw fault('workspace_mismatch', '자료와 구성의 작업공간이 다릅니다.');
      const installed = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const bundles = tx.objectStore('bundles'), meta = tx.objectStore('meta');
        if (await bundles.get(bundle.workspaceId) || await workspaceOwner(meta, bundle.workspaceId) || await meta.get(`workbench:${bundle.workspaceId}`)) {
          throw fault('workspace_exists', '같은 작업공간이 이미 있습니다. 새 사본으로 복원하세요.');
        }
        await bundles.add(bundle);
        await saveOwner(meta, bundle.workspaceId);
        await meta.put({ key: `workbench:${bundle.workspaceId}`, value: state });
        await meta.put({ key: activeKey, value: bundle.workspaceId });
        return { bundle: clone(bundle), workbench: clone(state) };
      });
      changed(bundle.workspaceId, bundle.revision); workbenchChanged(state);
      return installed;
    }
    async function installWorkspace(input) {
      const bundle = clone(input);
      core().validateWorkspace(bundle);
      const installed = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const bundles = tx.objectStore('bundles');
        if (await bundles.get(bundle.workspaceId) || await workspaceOwner(tx.objectStore('meta'), bundle.workspaceId)) {
          throw fault('workspace_exists', '같은 작업공간이 이미 있습니다. 새 사본으로 복원하세요.');
        }
        await bundles.add(bundle);
        await saveOwner(tx.objectStore('meta'), bundle.workspaceId);
        await tx.objectStore('meta').put({ key: activeKey, value: bundle.workspaceId });
        return clone(bundle);
      });
      changed(bundle.workspaceId, bundle.revision);
      return installed;
    }
    async function createWorkspace(title) {
      return installWorkspace(core().createWorkspace(title === undefined ? {} : { title }));
    }
    async function getActive() {
      return transaction(['meta', 'bundles'], 'readonly', async tx => {
        const entry = await tx.objectStore('meta').get(activeKey);
        if (entry === undefined) return null;
        requireId(entry.value, '활성 작업공간');
        await checkedBundle(tx.objectStore('bundles'), entry.value, tx.objectStore('meta'));
        return entry.value;
      });
    }
    async function setActive(workspaceId) {
      requireId(workspaceId, '작업공간');
      return transaction(['meta', 'bundles'], 'readwrite', async tx => {
        await checkedBundle(tx.objectStore('bundles'), workspaceId, tx.objectStore('meta'));
        await tx.objectStore('meta').put({ key: activeKey, value: workspaceId });
      });
    }
    async function commitLocal(request) {
      let operationId = request?.operationId;
      try {
        const input = clone(request);
        if (!plain(input)) throw fault('invalid_request', '저장할 작업을 확인하세요.');
        const { workspaceId, baseRevision, changes, stageId, stageRevision, stageResult } = input;
        operationId = input.operationId;
        requireId(operationId, '작업');
        requireId(workspaceId, '작업공간');
        requireRevision(baseRevision, 'baseRevision');
        if (!plain(changes)) throw fault('invalid_request', '변경 내용을 확인하세요.');
        if (stageId !== undefined) { requireId(stageId, '가져오기'); requireRevision(stageRevision, 'stageRevision'); }
        else if (stageRevision !== undefined) throw fault('invalid_request', '가져오기 식별자가 필요합니다.');
        if (stageResult !== undefined) {
          if (stageId === undefined) throw fault('invalid_stage_result', '보관 결과를 연결할 가져오기 항목이 필요합니다.');
          validateStageResult(stageResult);
        }
        // Omitting this extension preserves the byte-for-byte payload of earlier receipts.
        const payload = stablePayload({ workspaceId, baseRevision, changes, stageId, stageRevision,
          ...(stageResult !== undefined ? { stageResult } : {}) });
        let wrote = false, updatedSync = null;
        const result = await transaction(['bundles', 'operations', 'staging', 'meta'], 'readwrite', async tx => {
          await assertOwner(tx.objectStore('meta'), workspaceId);
          const operations = tx.objectStore('operations');
          const key = [workspaceId, operationId];
          const receipt = await operations.get(key);
          if (receipt) {
            if (receipt.payload !== payload) throw fault('operation_mismatch', '이미 저장한 작업 식별자에 다른 변경 내용이 들어왔습니다.');
            return clone(receipt.result);
          }
          const bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, tx.objectStore('meta'));
          if (bundle.revision !== baseRevision) return { status: 'conflict', currentRevision: bundle.revision, operationId };
          let stage;
          if (stageId !== undefined) {
            stage = await tx.objectStore('staging').get(stageId);
            if (!stage || stage.workspaceId !== workspaceId || stage.revision !== stageRevision || stage.state !== 'draft') {
              return { status: 'conflict', currentRevision: bundle.revision, operationId, error: { code: 'stage_conflict', message: '가져오기 검토 내용이 바뀌었습니다. 다시 확인하세요.' } };
            }
            validateStage(stage);
          }
          const updated = core().applyChanges(bundle, changes);
          core().validateWorkspace(updated);
          if (updated.workspaceId !== workspaceId || updated.revision !== bundle.revision + 1) {
            throw fault('invalid_revision', '저장할 작업공간 버전을 확인할 수 없습니다.');
          }
          if (stageResult !== undefined) validateStageResult(stageResult, updated);
          const stored = { status: 'stored', revision: updated.revision, operationId };
          const sync = await readSyncState(tx.objectStore('meta'), workspaceId, bundle);
          await tx.objectStore('bundles').put(updated);
          if (stage) await tx.objectStore('staging').put({ ...stage, state: 'applied', revision: stage.revision + 1,
            updatedAt: new Date().toISOString(), ...(stageResult !== undefined ? { appliedResult: clone(stageResult) } : {}) });
          if (sync) {
            sync.status = syncStatus(sync, updated); sync.error = null;
            updatedSync = await writeSyncState(tx.objectStore('meta'), sync);
          }
          await operations.add({ workspaceId, operationId, payload, result: stored });
          wrote = true;
          return stored;
        });
        if (wrote) changed(workspaceId, result.revision);
        if (updatedSync) syncChanged(updatedSync);
        return result;
      } catch (error) {
        return { status: 'rejected', error: errorInfo(error), operationId };
      }
    }
    async function getSyncState(workspaceId) {
      requireId(workspaceId, '작업공간');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, tx.objectStore('meta'));
        return clone(await readSyncState(tx.objectStore('meta'), workspaceId, bundle));
      });
    }
    async function bindSync(workspaceId, input) {
      const binding = bindingValue(input, workspaceId);
      const state = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, tx.objectStore('meta'));
        const previous = await readSyncState(tx.objectStore('meta'), workspaceId, bundle);
        const sync = previous ? authorizedSync(previous, binding, false) : {
          workspaceId, binding, enabled: true, remoteRevision: 0, syncedLocalRevision: -1,
          outbox: null, conflict: null, status: 'pending', error: null
        };
        sync.enabled = true; sync.error = null; sync.status = syncStatus(sync, bundle);
        return writeSyncState(tx.objectStore('meta'), sync);
      });
      syncChanged(state); return state;
    }
    async function pauseSync(workspaceId, input) {
      const binding = bindingValue(input, workspaceId);
      const state = await transaction(['meta'], 'readwrite', async tx => {
        const sync = authorizedSync(await readSyncState(tx.objectStore('meta'), workspaceId), binding, false);
        sync.enabled = false;
        return writeSyncState(tx.objectStore('meta'), sync);
      });
      syncChanged(state); return state;
    }
    async function prepareSyncUpload(workspaceId, input) {
      const binding = bindingValue(input, workspaceId);
      let event;
      const outbox = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, tx.objectStore('meta'));
        const sync = authorizedSync(await readSyncState(tx.objectStore('meta'), workspaceId, bundle), binding);
        if (sync.conflict) throw fault('sync_conflict', '다른 기기의 변경을 먼저 비교해 주세요.');
        if (sync.outbox) return clone(sync.outbox);
        if (bundle.revision === sync.syncedLocalRevision) return null;
        if (new TextEncoder().encode(JSON.stringify(bundle)).length > SYNC_MAX_BYTES) {
          throw fault('snapshot_too_large', '동기화 스냅샷은 16 MiB까지 지원합니다. 로컬 자료는 보존했습니다.');
        }
        const operationId = core().id ? core().id() : root.crypto.randomUUID();
        sync.outbox = { operationId, expectedRevision: sync.remoteRevision, localRevision: bundle.revision, data: clone(bundle) };
        sync.status = 'pending'; sync.error = null;
        event = await writeSyncState(tx.objectStore('meta'), sync);
        return clone(sync.outbox);
      });
      if (event) syncChanged(event);
      return outbox;
    }
    async function ackSync(workspaceId, input, operationId, remoteRevision) {
      const binding = bindingValue(input, workspaceId);
      requireId(operationId, '전송 작업'); requireRevision(remoteRevision);
      const state = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, tx.objectStore('meta'));
        const sync = authorizedSync(await readSyncState(tx.objectStore('meta'), workspaceId, bundle), binding);
        if (!sync.outbox || sync.outbox.operationId !== operationId || sync.conflict ||
            remoteRevision !== sync.outbox.expectedRevision + 1 || remoteRevision < revisionFloor(sync)) {
          throw fault('stale_sync_result', '현재 전송 작업과 다른 응답입니다. 최신 동기화 상태를 확인하세요.');
        }
        sync.remoteRevision = remoteRevision; sync.syncedLocalRevision = sync.outbox.localRevision;
        sync.outbox = null; sync.error = null; sync.status = syncStatus(sync, bundle);
        return writeSyncState(tx.objectStore('meta'), sync);
      });
      syncChanged(state); return state;
    }
    async function applySyncRemote(workspaceId, input, inputRow) {
      const binding = bindingValue(input, workspaceId), row = remoteRow(inputRow, workspaceId);
      let event;
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, tx.objectStore('meta'));
        const sync = authorizedSync(await readSyncState(tx.objectStore('meta'), workspaceId, bundle), binding);
        if (row.revision < revisionFloor(sync)) throw fault('stale_sync_result', '더 최신 서버 상태를 이미 확인했습니다. 다시 동기화하세요.');
        if (sync.outbox || sync.conflict || bundle.revision !== sync.syncedLocalRevision) {
          return { status: 'conflict', revision: bundle.revision };
        }
        immutableVersions(bundle, row.data);
        if (row.revision === sync.remoteRevision) {
          if (stablePayload({ ...row.data, revision: bundle.revision }) !== stablePayload(bundle)) {
            throw fault('remote_revision_mismatch', '같은 서버 버전의 내용이 달라졌습니다. 로컬 자료를 보존했습니다.');
          }
          return { status: 'stored', revision: bundle.revision };
        }
        const updated = nextLocalSnapshot(bundle, row);
        sync.remoteRevision = row.revision; sync.syncedLocalRevision = updated.revision;
        sync.status = 'synced'; sync.error = null;
        await tx.objectStore('bundles').put(updated);
        event = await writeSyncState(tx.objectStore('meta'), sync);
        return { status: 'stored', revision: updated.revision };
      });
      if (event) { changed(workspaceId, result.revision); syncChanged(event); }
      return result;
    }
    async function installSyncRemote(inputRow, input) {
      const row = remoteRow(inputRow), binding = bindingValue(input, row.id);
      if (account && !sameAccount(account, binding)) throw fault('account_mismatch', '현재 로그인 계정과 받은 자료의 계정이 다릅니다.');
      const bundle = { ...clone(row.data), revision: 0 };
      core().validateWorkspace(bundle);
      const state = { workspaceId: bundle.workspaceId, binding, enabled: true, remoteRevision: row.revision,
        syncedLocalRevision: 0, outbox: null, conflict: null, status: 'synced', error: null };
      await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        if (await tx.objectStore('bundles').get(bundle.workspaceId) || await workspaceOwner(tx.objectStore('meta'), bundle.workspaceId)) {
          throw fault('workspace_exists', '같은 식별자의 작업공간이 있습니다. 기존 자료를 덮어쓰지 않았습니다.');
        }
        await tx.objectStore('bundles').add(bundle);
        await saveOwner(tx.objectStore('meta'), bundle.workspaceId);
        await writeSyncState(tx.objectStore('meta'), state);
        await tx.objectStore('meta').put({ key: activeKey, value: bundle.workspaceId });
      });
      changed(bundle.workspaceId, bundle.revision); syncChanged(state);
      return clone(bundle);
    }
    async function setSyncConflict(workspaceId, input, inputRow) {
      const binding = bindingValue(input, workspaceId), row = inputRow === null ? null : remoteRow(inputRow, workspaceId);
      let wrote = false;
      const state = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, tx.objectStore('meta'));
        const sync = authorizedSync(await readSyncState(tx.objectStore('meta'), workspaceId, bundle), binding);
        if (row && row.revision < revisionFloor(sync)) return clone(sync);
        if (row) {
          immutableVersions(bundle, row.data);
          if (sync.conflict?.row && row.revision === sync.conflict.remoteRevision &&
              stablePayload(row.data) !== stablePayload(sync.conflict.row.data)) {
            throw fault('remote_revision_mismatch', '같은 서버 버전의 충돌 내용이 달라졌습니다.');
          }
        }
        sync.conflict = { missing: row === null, row, remoteRevision: row?.revision ?? revisionFloor(sync), localRevision: bundle.revision };
        sync.status = 'conflict'; sync.error = null;
        wrote = true;
        return writeSyncState(tx.objectStore('meta'), sync);
      });
      if (wrote) syncChanged(state);
      return state;
    }
    async function setSyncError(workspaceId, input, inputError) {
      const binding = bindingValue(input, workspaceId);
      if (inputError !== null) {
        onlyFields(inputError, ['code', 'message'], 'invalid_request');
        if (typeof inputError.code !== 'string' || !/^[a-z0-9_]{1,80}$/.test(inputError.code) ||
            typeof inputError.message !== 'string' || inputError.message.length > 1000) {
          throw fault('invalid_request', '정제된 동기화 오류 정보가 필요합니다.');
        }
      }
      const error = clone(inputError);
      const state = await transaction(['meta', 'bundles'], 'readwrite', async tx => {
        const bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, tx.objectStore('meta'));
        const sync = authorizedSync(await readSyncState(tx.objectStore('meta'), workspaceId, bundle), binding);
        sync.error = error;
        sync.status = error === null ? syncStatus(sync, bundle) : sync.conflict ? 'conflict' : 'error';
        return writeSyncState(tx.objectStore('meta'), sync);
      });
      syncChanged(state); return state;
    }
    function assertRemappedCopy(original, copy) {
      core().validateWorkspace(copy);
      if (copy.workspaceId === original.workspaceId || copy.revision !== 0) throw fault('invalid_recovery_copy', '별도 작업공간 사본이 필요합니다.');
      const mapping = new Map([[original.workspaceId, copy.workspaceId]]);
      function add(oldId, newId) {
        if (oldId === newId || (mapping.has(oldId) && mapping.get(oldId) !== newId)) throw fault('invalid_recovery_copy', '복구 사본의 식별자 대응이 올바르지 않습니다.');
        mapping.set(oldId, newId);
      }
      for (const name of COLLECTIONS) {
        if (original[name].length !== copy[name].length) throw fault('invalid_recovery_copy', '복구 사본에 보존하지 않은 항목이 있습니다.');
        original[name].forEach((item, index) => add(item.id, copy[name][index].id));
      }
      original.tombstones.forEach((item, index) => add(item.entityId, copy.tombstones[index].entityId));
      if (new Set(mapping.values()).size !== mapping.size || [...mapping.values()].some(value => mapping.has(value))) {
        throw fault('invalid_recovery_copy', '복구 사본의 식별자가 원본과 겹칩니다.');
      }
      const mapped = value => {
        if (!mapping.has(value)) throw fault('invalid_recovery_copy', '복구 사본의 연결이 누락되었습니다.');
        return mapping.get(value);
      };
      const expected = { ...clone(original), workspaceId: copy.workspaceId, revision: 0,
        title: copy.title, createdAt: copy.createdAt, updatedAt: copy.updatedAt };
      for (const name of COLLECTIONS) for (const item of expected[name]) {
        item.id = mapped(item.id);
        for (const key of ['sourceId', 'sourceVersionId', 'recordId', 'entityId']) if (item[key] !== undefined) item[key] = mapped(item[key]);
        if (item.revision !== undefined) item.revision = 1;
        if (item.sourceRefs) for (const ref of item.sourceRefs) { ref.sourceId = mapped(ref.sourceId); ref.sourceVersionId = mapped(ref.sourceVersionId); }
        if (item.entityRefs) for (const ref of item.entityRefs) { ref.entityId = mapped(ref.entityId); if (ref.revision !== undefined) ref.revision = 1; }
      }
      if (stablePayload(expected) !== stablePayload(copy)) throw fault('invalid_recovery_copy', '선택하지 않은 내용과 복구 사본이 일치하지 않습니다.');
    }
    async function resolveSync(workspaceId, input, resolution) {
      const binding = bindingValue(input, workspaceId), request = clone(resolution);
      onlyFields(request, ['choice', 'expectedLocalRevision', 'remoteRow', 'copy'], 'invalid_request');
      if (!['local', 'remote'].includes(request.choice)) throw fault('invalid_request', '남길 변경을 선택하세요.');
      requireRevision(request.expectedLocalRevision);
      const row = request.remoteRow === null ? null : remoteRow(request.remoteRow, workspaceId);
      core().validateWorkspace(request.copy);
      const result = await transaction(['bundles', 'meta', 'recovery'], 'readwrite', async tx => {
        const bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, tx.objectStore('meta'));
        const sync = authorizedSync(await readSyncState(tx.objectStore('meta'), workspaceId, bundle), binding);
        if (sync.conflict?.missing) throw fault('remote_missing', '서버에서 삭제된 작업공간은 자동 재생성하지 않습니다. 사본을 보관하거나 연결을 중지하세요.');
        if (!sync.conflict || !row || bundle.revision !== request.expectedLocalRevision ||
            sync.conflict.localRevision !== request.expectedLocalRevision || row.revision !== sync.conflict.remoteRevision ||
            stablePayload(row.data) !== stablePayload(sync.conflict.row.data)) {
          throw fault('sync_conflict_changed', '비교한 내용이 바뀌었습니다. 최신 양쪽 내용을 다시 확인하세요.');
        }
        immutableVersions(bundle, row.data);
        assertRemappedCopy(request.choice === 'remote' ? bundle : row.data, request.copy);
        if (await tx.objectStore('bundles').get(request.copy.workspaceId) || await workspaceOwner(tx.objectStore('meta'), request.copy.workspaceId)) {
          throw fault('workspace_exists', '복구 사본의 식별자가 이미 사용 중입니다.');
        }
        const updated = request.choice === 'remote' ? nextLocalSnapshot(bundle, row) : bundle;
        sync.remoteRevision = row.revision; sync.outbox = null; sync.conflict = null; sync.error = null;
        sync.syncedLocalRevision = request.choice === 'remote' ? updated.revision : -1;
        sync.status = request.choice === 'remote' ? 'synced' : 'pending';
        await tx.objectStore('bundles').add(request.copy);
        await saveOwner(tx.objectStore('meta'), request.copy.workspaceId);
        await tx.objectStore('recovery').add({ id: core().id ? core().id() : root.crypto.randomUUID(), workspaceId,
          copyWorkspaceId: request.copy.workspaceId, choice: request.choice, localRevision: bundle.revision,
          remoteRevision: row.revision, createdAt: new Date().toISOString() });
        if (request.choice === 'remote') await tx.objectStore('bundles').put(updated);
        const metadata = await writeSyncState(tx.objectStore('meta'), sync);
        return { bundle: clone(updated), metadata, copyWorkspaceId: request.copy.workspaceId };
      });
      changed(result.copyWorkspaceId, request.copy.revision);
      if (request.choice === 'remote') changed(workspaceId, result.bundle.revision);
      syncChanged(result.metadata);
      return result;
    }
    function validateStageResult(value, bundle) {
      try {
        if (!plain(value) || Object.keys(value).length !== 2 ||
            Object.keys(value).some(key => key !== 'sourceId' && key !== 'sourceVersionId')) throw new Error('shape');
        requireId(value.sourceId, '자료'); requireId(value.sourceVersionId, '원문 버전');
      } catch (_) {
        throw fault('invalid_stage_result', '보관한 원문을 연결할 자료와 버전 식별자를 확인하세요.');
      }
      if (bundle && (!bundle.sources.some(source => source.id === value.sourceId) ||
          !bundle.sourceVersions.some(version => version.id === value.sourceVersionId && version.sourceId === value.sourceId))) {
        throw fault('invalid_stage_result', '보관 결과가 이 작업공간의 원문과 일치하지 않습니다. 입력은 유지됩니다.');
      }
    }
    function validateStage(stage) {
      if (!plain(stage)) throw fault('invalid_stage', '가져오기 초안을 확인하세요.');
      if (stage.kind === 'writing') {
        const writing = options.writing || root.HaedoLife?.Writing ||
          (typeof require === 'function' ? require('./writing.js') : null);
        if (!writing?.validateDraft) throw fault('dependency_unavailable', '글쓰기 모듈을 불러오지 못했습니다.');
        writing.validateDraft(stage);
      }
      requireId(stage.stageId, '가져오기');
      requireId(stage.workspaceId, '작업공간');
      requireRevision(stage.revision);
      if (stage.state !== 'draft' && stage.state !== 'applied') throw fault('invalid_stage', '가져오기 상태를 확인하세요.');
      if (Object.hasOwn(stage, 'appliedResult')) {
        if (stage.state !== 'applied') throw fault('invalid_stage', '검토 중인 항목에 확정된 보관 결과를 넣을 수 없습니다.');
        validateStageResult(stage.appliedResult);
      }
      stablePayload(stage);
    }
    async function saveStage(input) {
      const stage = clone(input);
      validateStage(stage);
      if (stage.state !== 'draft') throw fault('invalid_stage', '확정된 가져오기는 다시 초안으로 저장할 수 없습니다.');
      return transaction(['staging', 'bundles'], 'readwrite', async tx => {
        await checkedBundle(tx.objectStore('bundles'), stage.workspaceId, tx.objectStore('meta'));
        const stages = tx.objectStore('staging');
        const previous = await stages.get(stage.stageId);
        if (previous ? previous.workspaceId !== stage.workspaceId || previous.revision !== stage.revision || previous.state !== 'draft' : stage.revision !== 0) {
          throw fault('stage_conflict', '다른 탭에서 가져오기 초안을 바꿨습니다. 이전 입력을 보존하고 다시 확인하세요.');
        }
        const now = new Date().toISOString();
        const saved = { ...stage, revision: stage.revision + 1, createdAt: previous?.createdAt || now, updatedAt: now };
        await stages.put(saved);
        return clone(saved);
      });
    }
    async function getStage(stageId) {
      requireId(stageId, '가져오기');
      return transaction(['staging'], 'readonly', async tx => {
        const stage = await tx.objectStore('staging').get(stageId);
        if (stage === undefined) return null;
        await assertOwner(tx.objectStore('meta'), stage.workspaceId);
        validateStage(stage);
        return clone(stage);
      });
    }
    async function listStages(workspaceId) {
      requireId(workspaceId, '작업공간');
      return transaction(['staging', 'bundles'], 'readonly', async tx => {
        await checkedBundle(tx.objectStore('bundles'), workspaceId, tx.objectStore('meta'));
        const stages = await tx.objectStore('staging').index('workspaceId').getAll(workspaceId);
        for (const stage of stages) validateStage(stage);
        return clone(stages);
      });
    }
    async function deleteStage(stageId) {
      requireId(stageId, '가져오기');
      return transaction(['staging'], 'readwrite', async tx => {
        const stage = await tx.objectStore('staging').get(stageId);
        if (stage === undefined) return;
        await assertOwner(tx.objectStore('meta'), stage.workspaceId);
        await tx.objectStore('staging').delete(stageId);
      });
    }
    async function listUnownedWorkspaces() {
      if (!account) throw fault('auth_scope_required', '로그인한 계정에서 이전 자료를 사본으로 가져와 주세요.');
      return transaction(['bundles'], 'readonly', async tx => {
        const result = [];
        for (const bundle of await tx.objectStore('bundles').getAll()) {
          if (await workspaceOwner(tx.objectStore('meta'), bundle.workspaceId)) continue;
          core().validateWorkspace(bundle);
          result.push({ workspaceId: bundle.workspaceId, title: bundle.title, revision: bundle.revision });
        }
        return result;
      });
    }
    async function importUnownedWorkspace(workspaceId) {
      if (!account) throw fault('auth_scope_required', '로그인한 계정에서 이전 자료를 사본으로 가져와 주세요.');
      requireId(workspaceId, '이전 작업공간');
      const source = await transaction(['bundles', 'staging'], 'readonly', async tx => {
        if (await workspaceOwner(tx.objectStore('meta'), workspaceId)) throw fault('workspace_access_denied', '계정에 연결된 자료는 이 경로로 가져올 수 없습니다.');
        const bundle = await tx.objectStore('bundles').get(workspaceId);
        if (!bundle) throw fault('workspace_not_found', '이전 작업공간을 찾을 수 없습니다.');
        core().validateWorkspace(bundle);
        const stages = await tx.objectStore('staging').index('workspaceId').getAll(workspaceId);
        for (const stage of stages) validateStage(stage);
        return { bundle, stages };
      });
      // Hash verification and ID remapping happen before the installation transaction.
      const copy = await core().restoreBackup(core().makeBackup(source.bundle));
      scopeGuard();
      const sourceIds = new Map(source.bundle.sources.map((item, index) => [item.id, copy.sources[index].id]));
      const versionIds = new Map(source.bundle.sourceVersions.map((item, index) => [item.id, copy.sourceVersions[index].id]));
      const copiedStages = source.stages.map(stage => {
        const result = { ...clone(stage), stageId: core().id(), workspaceId: copy.workspaceId, revision: 1 };
        if (result.input?.existingSourceId) {
          if (!sourceIds.has(result.input.existingSourceId)) throw fault('invalid_stage', '이전 초안의 원천 연결을 확인할 수 없습니다. 원본과 초안을 보존했습니다.');
          result.input.existingSourceId = sourceIds.get(result.input.existingSourceId);
        }
        if (stage.kind === 'writing' && stage.sourceId !== null) {
          const originalSource = source.bundle.sources.find(item => item.id === stage.sourceId);
          const originalVersion = source.bundle.sourceVersions.find(item => item.id === stage.baseSourceVersionId && item.sourceId === stage.sourceId);
          if (!originalSource || !originalVersion) throw fault('invalid_stage', '이전 글쓰기 초안의 원문을 확인할 수 없습니다. 원본과 입력을 보존했습니다.');
          const originalHead = source.bundle.sourceVersions.findLast(item => item.sourceId === stage.sourceId);
          result.sourceId = sourceIds.get(stage.sourceId);
          result.baseSourceVersionId = versionIds.get(stage.baseSourceVersionId);
          result.baseSourceRevision = copy.sources.find(item => item.id === result.sourceId).revision;
          // Copying resets entity revisions. Preserve an already stale editing
          // base explicitly instead of accidentally making revision 1 current.
          if (stage.baseChanged || stage.baseSourceRevision !== originalSource.revision || originalHead.id !== stage.baseSourceVersionId) {
            result.baseChanged = true;
          }
        }
        if (stage.appliedResult !== undefined) {
          validateStageResult(stage.appliedResult, source.bundle);
          result.appliedResult = { sourceId: sourceIds.get(stage.appliedResult.sourceId), sourceVersionId: versionIds.get(stage.appliedResult.sourceVersionId) };
          validateStageResult(result.appliedResult, copy);
        }
        validateStage(result);
        return result;
      });
      await transaction(['bundles', 'staging', 'meta'], 'readwrite', async tx => {
        if (await workspaceOwner(tx.objectStore('meta'), workspaceId)) throw fault('workspace_access_denied', '이전 자료의 계정 연결이 변경되어 가져오기를 중지했습니다.');
        const current = await tx.objectStore('bundles').get(workspaceId);
        const stages = await tx.objectStore('staging').index('workspaceId').getAll(workspaceId);
        if (stablePayload(current) !== stablePayload(source.bundle) ||
            stablePayload([...stages].sort((a, b) => a.stageId.localeCompare(b.stageId))) !==
            stablePayload([...source.stages].sort((a, b) => a.stageId.localeCompare(b.stageId)))) {
          throw fault('import_source_changed', '가져오는 동안 이전 자료나 초안이 바뀌었습니다. 원본을 다시 확인해 주세요.');
        }
        if (await tx.objectStore('bundles').get(copy.workspaceId) || await workspaceOwner(tx.objectStore('meta'), copy.workspaceId)) {
          throw fault('workspace_exists', '사본 식별자가 이미 사용 중입니다. 원본은 보존했습니다.');
        }
        await tx.objectStore('bundles').add(copy);
        await saveOwner(tx.objectStore('meta'), copy.workspaceId);
        for (const stage of copiedStages) await tx.objectStore('staging').add(stage);
        await tx.objectStore('meta').put({ key: activeKey, value: copy.workspaceId });
      });
      changed(copy.workspaceId, copy.revision);
      return clone(copy);
    }
    function subscribe(workspaceId, listener) {
      scopeGuard();
      requireId(workspaceId, '작업공간');
      if (typeof listener !== 'function') throw fault('invalid_request', '저장 알림 함수를 확인하세요.');
      if (!listeners.has(workspaceId)) listeners.set(workspaceId, new Set());
      listeners.get(workspaceId).add(listener);
      return () => {
        const group = listeners.get(workspaceId);
        group?.delete(listener);
        if (group?.size === 0) listeners.delete(workspaceId);
      };
    }
    const api = { open, close, dispose, account, isAccountScoped: account !== null,
      listWorkspaces, read, createWorkspace, installWorkspace, getActive, setActive,
      readWorkbench, saveWorkbench, readWorkbenchSnapshot, installWorkbenchCopy,
      commitLocal, saveStage, getStage, listStages, deleteStage, subscribe,
      getSyncState, bindSync, pauseSync, prepareSyncUpload, ackSync, applySyncRemote, installSyncRemote,
      setSyncConflict, setSyncError, resolveSync, listUnownedWorkspaces, importUnownedWorkspace };
    if (!account) Object.assign(api, { forAccount, clearAccount });
    return Object.freeze(api);
  }

  root.HaedoLife ||= {};
  root.HaedoLife.Storage = createStorage();
  if (typeof module !== 'undefined' && module.exports) module.exports = { createStorage };
})(globalThis);

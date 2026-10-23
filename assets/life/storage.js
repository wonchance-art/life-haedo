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
    const sourceFolders = () => {
      const value = options.sourceFolders || root.HaedoLife?.SourceFolders;
      if (!value?.validate || !value?.validateReferences || !value?.empty) throw fault('dependency_unavailable', '자료 폴더 모듈을 불러오지 못했습니다.');
      return value;
    };
    const collection = () => {
      const value = options.collection || root.HaedoLife?.Collection;
      if (!value?.validate || !value?.empty) throw fault('dependency_unavailable', '컬렉션 모듈을 불러오지 못했습니다.');
      return value;
    };
    const interestProfile = () => {
      const value = options.interestProfile || root.HaedoLife?.InterestProfile;
      if (!value?.validate || !value?.empty || !value?.revalidate) {
        throw fault('dependency_unavailable', '관심 정보 모듈을 불러오지 못했습니다.');
      }
      return value;
    };
    const discoveryProfile = () => {
      const value = options.discoveryProfile || root.HaedoLife?.DiscoveryProfile;
      if (!value?.validate || !value?.empty) throw fault('dependency_unavailable', '발견 피드백 모듈을 불러오지 못했습니다.');
      return value;
    };
    const discoverySettings = () => {
      const value = options.discoverySettings || root.HaedoLife?.DiscoverySettings;
      if (!value?.validate || !value?.empty) throw fault('dependency_unavailable', '새 글 찾기 설정 모듈을 불러오지 못했습니다.');
      return value;
    };
    const annualPlan = () => {
      const value = options.annualPlan || root.HaedoLife?.AnnualPlan;
      if (!value?.validate || !value?.empty) throw fault('dependency_unavailable', '연간 계획 모듈을 불러오지 못했습니다.');
      return value;
    };
    const discoveryActions = () => {
      const value = options.discoveryActions || root.HaedoLife?.DiscoveryActions;
      if (!value?.validate || !value?.empty) throw fault('dependency_unavailable', '좋아요·담기 모듈을 불러오지 못했습니다.');
      return value;
    };
    const discoveryLanguageSettings = () => {
      const value = options.discoveryLanguageSettings || root.HaedoLife?.DiscoveryLanguageSettings;
      if (!value?.validate || !value?.empty) throw fault('dependency_unavailable', '언어 옵션 모듈을 불러오지 못했습니다.');
      return value;
    };
    const discoveryReading = () => {
      const value = options.discoveryReading || root.HaedoLife?.DiscoveryReading;
      if (!value?.validate || !value?.empty || !Number.isSafeInteger(value.MAX_BYTES) || value.MAX_BYTES < 1) {
        throw fault('dependency_unavailable', '읽기 평가 모듈을 불러오지 못했습니다.');
      }
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
    function compositionChanged(state) {
      const event = { type: 'composition_sync_changed', workspaceId: state.workspaceId, status: state.status, enabled: state.enabled };
      notify(event);
      try { channel?.postMessage({ ...event, sender }); } catch (_) { /* Persistent state is authoritative. */ }
    }
    function workbenchChanged(state) {
      const event = { type: 'workbench_changed', workspaceId: state.workspaceId, revision: state.revision };
      notify(event);
      try { channel?.postMessage({ ...event, sender }); } catch (_) { /* Persistent state is authoritative. */ }
    }
    function sourceFoldersChanged(state) {
      const event = { type: 'source_folders_changed', workspaceId: state.workspaceId, revision: state.revision };
      notify(event);
      try { channel?.postMessage({ ...event, sender }); } catch (_) { /* The committed profile remains authoritative. */ }
    }
    function readingPositionChanged(workspaceId, revision) {
      const event = { type: 'reading_position_changed', workspaceId, revision };
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
          if (data?.sender !== sender && data?.type === 'composition_sync_changed' && typeof data.workspaceId === 'string') {
            notify({ type: 'composition_sync_changed', workspaceId: data.workspaceId });
          }
          if (data?.sender !== sender && ['writing_draft_changed', 'writing_sync_changed'].includes(data?.type) &&
              typeof data.workspaceId === 'string' && typeof data.stageId === 'string') {
            notify({ type: data.type, workspaceId: data.workspaceId, stageId: data.stageId });
          }
          if (data?.sender !== sender && data?.type === 'changed' && typeof data.workspaceId === 'string' &&
              Number.isSafeInteger(data.revision) && data.revision >= 0) {
            notify({ type: 'changed', workspaceId: data.workspaceId, revision: data.revision });
          }
          if (data?.sender !== sender && data?.type === 'collection_changed' && typeof data.workspaceId === 'string' && Number.isSafeInteger(data.revision)) {
            notify({ type: 'collection_changed', workspaceId: data.workspaceId, revision: data.revision });
          }
          if (data?.sender !== sender && data?.type === 'nine_board_changed' && typeof data.workspaceId === 'string' && Number.isSafeInteger(data.revision) && data.revision >= 1) {
            notify({ type: 'nine_board_changed', workspaceId: data.workspaceId, revision: data.revision });
          }
          if (data?.sender !== sender && data?.type === 'blog_series_changed' && typeof data.workspaceId === 'string' && Number.isSafeInteger(data.revision) && data.revision >= 1) {
            notify({ type: 'blog_series_changed', workspaceId: data.workspaceId, revision: data.revision });
          }
          if (data?.sender !== sender && data?.type === 'public_cover_changed' && typeof data.workspaceId === 'string' && Number.isSafeInteger(data.revision) && data.revision >= 1) {
            notify({ type: 'public_cover_changed', workspaceId: data.workspaceId, revision: data.revision });
          }
          if (data?.sender !== sender && data?.type === 'material_writing_changed' && typeof data.workspaceId === 'string' && Number.isSafeInteger(data.revision) && data.revision >= 1) {
            notify({ type: 'material_writing_changed', workspaceId: data.workspaceId, revision: data.revision });
          }
          if (data?.sender !== sender && data?.type === 'photo_posts_changed' && typeof data.workspaceId === 'string') notify({ type: 'photo_posts_changed', workspaceId: data.workspaceId });
          if (data?.sender !== sender && data?.type === 'workbench_changed' && typeof data.workspaceId === 'string' &&
              Number.isSafeInteger(data.revision) && data.revision >= 0) {
            notify({ type: 'workbench_changed', workspaceId: data.workspaceId, revision: data.revision });
          }
          if (data?.sender !== sender && data?.type === 'source_folders_changed' && typeof data.workspaceId === 'string' &&
              Number.isSafeInteger(data.revision) && data.revision >= 0) {
            notify({ type: 'source_folders_changed', workspaceId: data.workspaceId, revision: data.revision });
          }
          if (data?.sender !== sender && data?.type === 'reading_position_changed' && typeof data.workspaceId === 'string' &&
              Number.isSafeInteger(data.revision) && data.revision >= 1) {
            notify({ type: 'reading_position_changed', workspaceId: data.workspaceId, revision: data.revision });
          }
          if (data?.sender !== sender && data?.type === 'annual_plan_changed' && typeof data.workspaceId === 'string' &&
              Number.isSafeInteger(data.revision) && data.revision >= 1) {
            notify({ type: 'annual_plan_changed', workspaceId: data.workspaceId, revision: data.revision });
          }
          if (data?.sender !== sender && data?.type === 'interest_profile_changed' && typeof data.workspaceId === 'string' &&
              Number.isSafeInteger(data.revision) && data.revision >= 1) {
            notify({ type: 'interest_profile_changed', workspaceId: data.workspaceId, revision: data.revision });
          }
          if (data?.sender !== sender && data?.type === 'discovery_profile_changed' && typeof data.workspaceId === 'string' &&
              Number.isSafeInteger(data.revision) && data.revision >= 1) {
            notify({ type: 'discovery_profile_changed', workspaceId: data.workspaceId, revision: data.revision });
          }
          if (data?.sender !== sender && data?.type === 'discovery_settings_changed' && typeof data.workspaceId === 'string' &&
              Number.isSafeInteger(data.revision) && data.revision >= 1) {
            notify({ type: 'discovery_settings_changed', workspaceId: data.workspaceId, revision: data.revision });
          }
          if (data?.sender !== sender && data?.type === 'discovery_actions_changed' && typeof data.workspaceId === 'string' &&
              Number.isSafeInteger(data.revision) && data.revision >= 1) {
            notify({ type: 'discovery_actions_changed', workspaceId: data.workspaceId, revision: data.revision });
          }
          if (data?.sender !== sender && data?.type === 'discovery_language_settings_changed' && typeof data.workspaceId === 'string' &&
              Number.isSafeInteger(data.revision) && data.revision >= 1) {
            notify({ type: 'discovery_language_settings_changed', workspaceId: data.workspaceId, revision: data.revision });
          }
          if (data?.sender !== sender && data?.type === 'discovery_reading_changed' && typeof data.workspaceId === 'string' &&
              Number.isSafeInteger(data.revision) && data.revision >= 1) {
            notify({ type: 'discovery_reading_changed', workspaceId: data.workspaceId, revision: data.revision });
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
    function immutableVersions(local, incoming, { partial = false } = {}) {
      const previous = new Map((local.sourceVersions || []).map(version => [version.id, version]));
      for (const version of incoming.sourceVersions || []) {
        const original = previous.get(version.id);
        if (original && stablePayload(original) !== stablePayload(version)) {
          throw fault('immutable_source_version', '서버의 원문 버전이 같은 식별자로 변경되었습니다. 로컬 원문은 보존했습니다.');
        }
      }
      if (partial && typeof core().editedCopyMarkers === 'function') {
        const markers = new Map((incoming.links || []).map(link => [link.id, link]));
        const knownVersionIds = (incoming.sourceVersions || []).map(version => version.id).filter(id => previous.has(id));
        for (const marker of core().editedCopyMarkers(local, knownVersionIds)) {
          if (!markers.has(marker.id) || stablePayload(markers.get(marker.id)) !== stablePayload(marker)) {
            throw fault('immutable_source_marker', '수정한 사본의 표시가 받은 자료에서 빠지거나 바뀌었습니다. 기존 자료는 보존했습니다.');
          }
        }
      } else if (!partial && typeof core().assertSourceLinkPreservation === 'function') {
        core().assertSourceLinkPreservation(local, incoming);
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
    // One local position per account/workspace. A cleared row keeps its revision
    // so an older tab cannot recreate the position after the user removes it.
    const readingPositionKey = workspaceId => `readingPosition:${accountKey}:${workspaceId}`;
    function readingPositionScope(workspaceId) {
      scopeGuard();
      if (!account) throw fault('auth_scope_required', '로그인한 계정에서 읽던 위치를 확인해 주세요.');
      requireId(workspaceId, '작업공간');
    }
    function readingPositionInput(input, withTimestamp = false) {
      const invalid = () => fault('reading_position_invalid', '읽던 위치의 형식을 확인할 수 없습니다. 기존 위치는 보존했습니다.');
      try {
        onlyFields(input, ['sourceId', 'sourceVersionId', 'offset', ...(withTimestamp ? ['updatedAt'] : [])], 'reading_position_invalid');
        if (typeof input.sourceId !== 'string' || !input.sourceId.trim() || typeof input.sourceVersionId !== 'string' ||
            !input.sourceVersionId.trim() || !Number.isSafeInteger(input.offset) || input.offset < 0) throw invalid();
        if (withTimestamp && (typeof input.updatedAt !== 'string' || !Number.isFinite(Date.parse(input.updatedAt)))) throw invalid();
        return clone(input);
      } catch (_) { throw invalid(); }
    }
    async function readingPositionValue(meta, workspaceId) {
      const entry = await meta.get(readingPositionKey(workspaceId));
      if (entry === undefined) return { revision: 0, position: null };
      try {
        const value = entry.value;
        onlyFields(value, ['format', 'workspaceId', 'revision', 'position'], 'reading_position_invalid');
        if (value.format !== 'life-reading-position-v1' || value.workspaceId !== workspaceId ||
            !Number.isSafeInteger(value.revision) || value.revision < 1 || !Object.hasOwn(value, 'position')) throw new Error('position');
        return { revision: value.revision, position: value.position === null ? null : readingPositionInput(value.position, true) };
      } catch (_) { throw fault('reading_position_invalid', '읽던 위치 정보를 확인할 수 없습니다. 기존 위치는 보존했습니다.'); }
    }
    function readingPositionReference(bundle, position) {
      const source = bundle.sources.find(value => value.id === position.sourceId);
      const version = bundle.sourceVersions.find(value => value.id === position.sourceVersionId && value.sourceId === position.sourceId);
      if (!source || !version || typeof version.contentText !== 'string' || version.coverage.status === 'link_only') return 'unavailable';
      const { contentText: text } = version, { offset } = position;
      if (offset > text.length) return 'invalid';
      const previous = text.charCodeAt(offset - 1), next = text.charCodeAt(offset);
      if (previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) return 'invalid';
      return 'available';
    }
    function readingPositionState(value, bundle) {
      return { revision: value.revision, position: clone(value.position),
        status: value.position === null ? 'empty' : readingPositionReference(bundle, value.position) === 'available' ? 'available' : 'unavailable' };
    }
    async function readReadingPosition(workspaceId) {
      readingPositionScope(workspaceId);
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return readingPositionState(await readingPositionValue(meta, workspaceId), bundle);
      });
    }
    async function writeReadingPosition(workspaceId, position, baseRevision) {
      readingPositionScope(workspaceId); requireRevision(baseRevision, 'baseRevision');
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const previous = await readingPositionValue(meta, workspaceId);
        if (previous.revision !== baseRevision) return { status: 'conflict', state: readingPositionState(previous, bundle) };
        if (position !== null) {
          const reference = readingPositionReference(bundle, position);
          if (reference === 'unavailable') throw fault('reading_position_unavailable', '읽던 원문 버전을 확인할 수 없습니다. 다른 버전으로 대신 저장하지 않았습니다.');
          if (reference === 'invalid') throw fault('reading_position_invalid', '원문 안의 읽기 위치를 확인해 주세요. 기존 위치는 보존했습니다.');
        }
        if (baseRevision === Number.MAX_SAFE_INTEGER) throw fault('reading_position_invalid', '읽던 위치의 저장 기준을 확인할 수 없습니다.');
        const saved = { format: 'life-reading-position-v1', workspaceId, revision: baseRevision + 1,
          position: position === null ? null : { ...position, updatedAt: new Date().toISOString() } };
        await meta.put({ key: readingPositionKey(workspaceId), value: saved });
        return { status: 'stored', state: readingPositionState(saved, bundle) };
      });
      if (result.status === 'stored') readingPositionChanged(workspaceId, result.state.revision);
      return result;
    }
    async function saveReadingPosition(workspaceId, input, baseRevision) {
      readingPositionScope(workspaceId);
      return writeReadingPosition(workspaceId, readingPositionInput(input), baseRevision);
    }
    async function clearReadingPosition(workspaceId, baseRevision) { return writeReadingPosition(workspaceId, null, baseRevision); }
    // Derived private metadata has its own account/workspace CAS. It never enters
    // the bundle, file backups, remote sync payloads or public copies.
    const interestProfileKey = workspaceId => `interestProfile:${accountKey}:${workspaceId}`;
    function privateProfileScope(workspaceId, label) {
      scopeGuard();
      if (!account) throw fault('auth_scope_required', `로그인한 계정에서 ${label} 확인해 주세요.`);
      requireId(workspaceId, '작업공간');
    }
    function interestProfileScope(workspaceId) { privateProfileScope(workspaceId, '관심 정보를'); }
    function validatePrivateProfile(value, workspaceId, model, maxBytes, prefix) {
      model.validate(value);
      if (value.workspaceId !== workspaceId) throw fault('workspace_mismatch', prefix === 'interest' ? '관심 정보의 작업공간이 다릅니다.' : '발견 피드백의 작업공간이 다릅니다.');
      if (new TextEncoder().encode(stablePayload(value)).length >= maxBytes) {
        throw fault(`${prefix}_profile_too_large`, prefix === 'interest' ? '관심 정보가 너무 큽니다. 기존 정보는 보존했습니다.' : '발견 피드백이 너무 큽니다. 기존 정보는 보존했습니다.');
      }
    }
    function validateInterestProfile(value, workspaceId) {
      validatePrivateProfile(value, workspaceId, interestProfile(), 256 * 1024, 'interest');
    }
    async function privateProfileValue(meta, key, workspaceId, model, validate) {
      const row = await meta.get(key);
      const value = row === undefined ? model.empty(workspaceId) : row.value;
      validate(value, workspaceId);
      return value;
    }
    const sourceFoldersKey = workspaceId => `source-folders:${accountKey}:${workspaceId}`;
    function validateSourceFolders(value, workspaceId) {
      sourceFolders().validate(value);
      if (value.workspaceId !== workspaceId) throw fault('workspace_mismatch', '자료 폴더의 작업공간이 다릅니다.');
    }
    async function sourceFoldersValue(meta, workspaceId) {
      return privateProfileValue(meta, sourceFoldersKey(workspaceId), workspaceId, sourceFolders(), validateSourceFolders);
    }
    async function readSourceFoldersSnapshot(workspaceId) {
      privateProfileScope(workspaceId, '자료 폴더를');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return { bundle: clone(bundle), sourceFolders: clone(await sourceFoldersValue(meta, workspaceId)) };
      });
    }
    async function readSourceFolders(workspaceId) { return (await readSourceFoldersSnapshot(workspaceId)).sourceFolders; }
    async function saveSourceFolders(workspaceId, input, baseRevision) {
      privateProfileScope(workspaceId, '자료 폴더를'); requireRevision(baseRevision, 'baseRevision');
      const state = clone(input); validateSourceFolders(state, workspaceId);
      if (state.revision !== baseRevision || baseRevision === Number.MAX_SAFE_INTEGER) throw fault('source_folders_conflict', '자료 폴더의 저장 기준이 바뀌었습니다. 입력을 보존했습니다.');
      const saved = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const previous = await sourceFoldersValue(meta, workspaceId);
        if (previous.revision !== baseRevision) throw fault('source_folders_conflict', '다른 탭에서 자료 폴더를 바꿨습니다. 입력을 보존하고 최신 상태를 확인해 주세요.');
        const retained = new Map(previous.assignments.map(item => [item.sourceId, item.folderId]));
        for (const item of state.assignments) if (retained.get(item.sourceId) !== item.folderId) {
          if (!bundle.sources.some(source => source.id === item.sourceId)) throw fault('source_folders_missing_reference', '분류할 자료를 찾지 못했습니다. 기존 폴더와 입력을 보존했습니다.');
          if (!core().isSourceActive(bundle, item.sourceId)) throw fault('source_trashed', '휴지통의 자료는 복원한 뒤 폴더에 넣어 주세요.');
        }
        state.revision = baseRevision + 1; validateSourceFolders(state, workspaceId);
        await meta.put({ key: sourceFoldersKey(workspaceId), value: state }); return clone(state);
      });
      sourceFoldersChanged(saved); return saved;
    }
    async function readLibraryBackupSnapshot(workspaceId) {
      privateProfileScope(workspaceId, '자료와 폴더를');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return { bundle: clone(bundle), workbench: clone(await workbenchValue(meta, workspaceId)),
          sourceFolders: clone(await sourceFoldersValue(meta, workspaceId)) };
      });
    }
    async function installLibraryCopy(input) {
      if (!plain(input) || Object.keys(input).some(key => !['bundle', 'workbench', 'sourceFolders'].includes(key))) throw fault('source_folders_invalid', '복원할 자료와 폴더를 확인해 주세요.');
      const candidate = clone(input), { bundle, workbench: state, sourceFolders: folders } = candidate;
      privateProfileScope(bundle?.workspaceId, '자료와 폴더를');
      core().validateWorkspace(bundle); workbench().validate(state); validateSourceFolders(folders, bundle.workspaceId);
      if (state.workspaceId !== bundle.workspaceId) throw fault('workspace_mismatch', '자료와 구성의 작업공간이 다릅니다.');
      sourceFolders().validateReferences(bundle, folders);
      const installed = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const bundles = tx.objectStore('bundles'), meta = tx.objectStore('meta');
        if (await bundles.get(bundle.workspaceId) || await workspaceOwner(meta, bundle.workspaceId) ||
            await meta.get(`workbench:${bundle.workspaceId}`) || await meta.get(sourceFoldersKey(bundle.workspaceId))) throw fault('workspace_exists', '같은 작업공간이 이미 있습니다. 새 사본으로 복원하세요.');
        await bundles.add(bundle); await saveOwner(meta, bundle.workspaceId);
        await meta.put({ key: `workbench:${bundle.workspaceId}`, value: state });
        await meta.put({ key: sourceFoldersKey(bundle.workspaceId), value: folders });
        await meta.put({ key: activeKey, value: bundle.workspaceId }); return clone(candidate);
      });
      changed(bundle.workspaceId, bundle.revision); workbenchChanged(state); sourceFoldersChanged(folders); return installed;
    }
    // Annual plans are private local metadata. Birth dates and plan text never
    // enter original bundles, ordinary backups, sync payloads or broadcasts.
    const annualPlanKey = workspaceId => `annualPlan:${accountKey}:${workspaceId}`;
    function validateAnnualPlan(value, workspaceId) {
      annualPlan().validate(value);
      if (value.workspaceId !== workspaceId) throw fault('workspace_mismatch', '연간 계획의 작업공간이 다릅니다.');
      if (new TextEncoder().encode(stablePayload(value)).length > 2 * 1024 * 1024) {
        throw fault('annual_plan_too_large', '연간 계획이 너무 큽니다. 입력을 보존하고 전용 백업을 내려받으세요.');
      }
    }
    async function annualPlanValue(meta, workspaceId) {
      return privateProfileValue(meta, annualPlanKey(workspaceId), workspaceId, annualPlan(), validateAnnualPlan);
    }
    async function readAnnualPlan(workspaceId) {
      privateProfileScope(workspaceId, '연간 계획을');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta');
        await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return clone(await annualPlanValue(meta, workspaceId));
      });
    }
    async function saveAnnualPlan(workspaceId, input, baseRevision) {
      privateProfileScope(workspaceId, '연간 계획을'); requireRevision(baseRevision, 'baseRevision');
      validateAnnualPlan(input, workspaceId);
      const value = clone(input);
      if (baseRevision === Number.MAX_SAFE_INTEGER || value.revision !== baseRevision + 1) {
        throw fault('annual_plan_conflict', '연간 계획의 저장 기준을 확인해 주세요.');
      }
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta');
        await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const previous = await annualPlanValue(meta, workspaceId);
        if (previous.revision !== baseRevision) return { status: 'conflict', profile: clone(previous) };
        await meta.put({ key: annualPlanKey(workspaceId), value });
        return { status: 'stored', profile: clone(value) };
      });
      if (result.status === 'stored') {
        const event = { type: 'annual_plan_changed', workspaceId, revision: result.profile.revision };
        notify({ ...event, local: true }); try { channel?.postMessage({ ...event, sender }); } catch (_) { /* The committed row remains authoritative. */ }
      }
      return result;
    }
    async function interestProfileValue(meta, workspaceId) {
      return privateProfileValue(meta, interestProfileKey(workspaceId), workspaceId, interestProfile(), validateInterestProfile);
    }
    async function readInterestProfile(workspaceId) {
      interestProfileScope(workspaceId);
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta');
        await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return clone(await interestProfileValue(meta, workspaceId));
      });
    }
    function interestEvidenceSnapshot(bundle, profile) {
      return stablePayload((profile.analysis?.selection.references || []).map(ref => {
        const source = bundle.sources.find(item => item.id === ref.sourceId);
        const version = bundle.sourceVersions.find(item => item.id === ref.sourceVersionId && item.sourceId === ref.sourceId);
        if (!source || !version) throw fault('interest_profile_stale', '선택한 원문이나 근거가 바뀌었습니다. 분석 범위를 다시 확인해 주세요.');
        return { source, version };
      }));
    }
    async function saveInterestProfile(workspaceId, input, baseRevision) {
      interestProfileScope(workspaceId); requireRevision(baseRevision, 'baseRevision');
      validateInterestProfile(input, workspaceId);
      const value = clone(input);
      if (baseRevision === Number.MAX_SAFE_INTEGER || value.revision !== baseRevision + 1) {
        throw fault('interest_profile_conflict', '관심 정보의 저장 기준을 확인해 주세요.');
      }
      const prepared = await transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const previous = await interestProfileValue(meta, workspaceId);
        return previous.revision !== baseRevision ? { conflict: clone(previous) } : { bundle: clone(bundle) };
      });
      if (prepared.conflict) return { status: 'conflict', profile: prepared.conflict };
      const evidenceSnapshot = interestEvidenceSnapshot(prepared.bundle, value);
      // Web Crypto yields outside IndexedDB. The readwrite transaction below
      // compares the exact selected raw bodies, hashes and source metadata again.
      await interestProfile().revalidate(prepared.bundle, value);
      scopeGuard();
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const previous = await interestProfileValue(meta, workspaceId);
        if (previous.revision !== baseRevision) return { status: 'conflict', profile: clone(previous) };
        if (interestEvidenceSnapshot(bundle, value) !== evidenceSnapshot) {
          throw fault('interest_profile_stale', '선택한 원문이나 근거가 바뀌었습니다. 분석 범위를 다시 확인해 주세요.');
        }
        validateInterestProfile(value, workspaceId);
        await meta.put({ key: interestProfileKey(workspaceId), value });
        return { status: 'stored', profile: clone(value) };
      });
      if (result.status === 'stored') {
        const event = { type: 'interest_profile_changed', workspaceId, revision: result.profile.revision };
        notify(event); try { channel?.postMessage({ ...event, sender }); } catch (_) { /* The committed row remains authoritative. */ }
      }
      return result;
    }
    // Feedback has no source-write or network path. Undo/reset retain the CAS
    // revision so an old tab cannot silently reapply the excluded article.
    const discoveryProfileKey = workspaceId => `discoveryProfile:${accountKey}:${workspaceId}`;
    function validateDiscoveryProfile(value, workspaceId) {
      validatePrivateProfile(value, workspaceId, discoveryProfile(), 128 * 1024, 'discovery');
    }
    async function discoveryProfileValue(meta, workspaceId) {
      return privateProfileValue(meta, discoveryProfileKey(workspaceId), workspaceId, discoveryProfile(), validateDiscoveryProfile);
    }
    async function readDiscoveryProfile(workspaceId) {
      privateProfileScope(workspaceId, '발견 피드백을');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta');
        await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return clone(await discoveryProfileValue(meta, workspaceId));
      });
    }
    async function saveDiscoveryProfile(workspaceId, input, baseRevision) {
      privateProfileScope(workspaceId, '발견 피드백을'); requireRevision(baseRevision, 'baseRevision');
      validateDiscoveryProfile(input, workspaceId);
      const value = clone(input);
      if (baseRevision === Number.MAX_SAFE_INTEGER || value.revision !== baseRevision + 1) {
        throw fault('discovery_profile_conflict', '발견 피드백의 저장 기준을 확인해 주세요.');
      }
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta');
        await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const previous = await discoveryProfileValue(meta, workspaceId);
        if (previous.revision !== baseRevision) return { status: 'conflict', profile: clone(previous) };
        await meta.put({ key: discoveryProfileKey(workspaceId), value });
        return { status: 'stored', profile: clone(value) };
      });
      if (result.status === 'stored') {
        const event = { type: 'discovery_profile_changed', workspaceId, revision: result.profile.revision };
        notify(event); try { channel?.postMessage({ ...event, sender }); } catch (_) { /* The committed row remains authoritative. */ }
      }
      return result;
    }
    // Controls are separate from interests and feedback. A reset keeps its
    // revision/tombstone, preventing a delayed old tab from enabling automation.
    const discoverySettingsKey = workspaceId => `discoverySettings:${accountKey}:${workspaceId}`;
    function validateDiscoverySettings(value, workspaceId) {
      discoverySettings().validate(value);
      if (value.workspaceId !== workspaceId) throw fault('workspace_mismatch', '새 글 찾기 설정의 작업공간이 다릅니다.');
      if (new TextEncoder().encode(stablePayload(value)).length >= 32 * 1024) {
        throw fault('discovery_settings_too_large', '새 글 찾기 설정이 너무 큽니다. 기존 설정은 보존했습니다.');
      }
    }
    async function discoverySettingsValue(meta, workspaceId) {
      return privateProfileValue(meta, discoverySettingsKey(workspaceId), workspaceId, discoverySettings(), validateDiscoverySettings);
    }
    async function readDiscoverySettings(workspaceId) {
      privateProfileScope(workspaceId, '새 글 찾기 설정을');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta');
        await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return clone(await discoverySettingsValue(meta, workspaceId));
      });
    }
    async function saveDiscoverySettings(workspaceId, input, baseRevision) {
      privateProfileScope(workspaceId, '새 글 찾기 설정을'); requireRevision(baseRevision, 'baseRevision');
      validateDiscoverySettings(input, workspaceId);
      const value = clone(input);
      if (baseRevision === Number.MAX_SAFE_INTEGER || value.revision !== baseRevision + 1) {
        throw fault('discovery_settings_conflict', '새 글 찾기 설정의 저장 기준을 확인해 주세요.');
      }
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta');
        await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const previous = await discoverySettingsValue(meta, workspaceId);
        if (previous.revision !== baseRevision) return { status: 'conflict', settings: clone(previous) };
        await meta.put({ key: discoverySettingsKey(workspaceId), value });
        return { status: 'stored', settings: clone(value) };
      });
      if (result.status === 'stored') {
        const event = { type: 'discovery_settings_changed', workspaceId, revision: result.settings.revision };
        notify(event); try { channel?.postMessage({ ...event, sender }); } catch (_) { /* The committed row remains authoritative. */ }
      }
      return result;
    }
    const discoveryLanguageSettingsKey = workspaceId => `discoveryLanguageSettings:${accountKey}:${workspaceId}`;
    function validateDiscoveryLanguageSettings(value, workspaceId) {
      discoveryLanguageSettings().validate(value);
      if (value.workspaceId !== workspaceId) throw fault('workspace_mismatch', '언어 옵션의 작업공간이 다릅니다.');
      if (new TextEncoder().encode(stablePayload(value)).length >= 16 * 1024) {
        throw fault('discovery_language_settings_too_large', '언어 옵션이 너무 큽니다. 기존 설정은 보존했습니다.');
      }
    }
    async function discoveryLanguageSettingsValue(meta, workspaceId) {
      return privateProfileValue(meta, discoveryLanguageSettingsKey(workspaceId), workspaceId, discoveryLanguageSettings(), validateDiscoveryLanguageSettings);
    }
    async function readDiscoveryLanguageSettings(workspaceId) {
      privateProfileScope(workspaceId, '언어 옵션을');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta');
        await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return clone(await discoveryLanguageSettingsValue(meta, workspaceId));
      });
    }
    async function saveDiscoveryLanguageSettings(workspaceId, input, baseRevision) {
      privateProfileScope(workspaceId, '언어 옵션을'); requireRevision(baseRevision, 'baseRevision');
      validateDiscoveryLanguageSettings(input, workspaceId);
      const value = clone(input);
      if (baseRevision === Number.MAX_SAFE_INTEGER || value.revision !== baseRevision + 1) {
        throw fault('discovery_language_settings_conflict', '언어 옵션의 저장 기준을 확인해 주세요.');
      }
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta');
        await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const previous = await discoveryLanguageSettingsValue(meta, workspaceId);
        if (previous.revision !== baseRevision) return { status: 'conflict', settings: clone(previous) };
        await meta.put({ key: discoveryLanguageSettingsKey(workspaceId), value });
        return { status: 'stored', settings: clone(value) };
      });
      if (result.status === 'stored') {
        const event = { type: 'discovery_language_settings_changed', workspaceId, revision: result.settings.revision };
        notify({ ...event, local: true }); try { channel?.postMessage({ ...event, sender }); } catch (_) { /* The committed row remains authoritative. */ }
      }
      return result;
    }
    const discoveryActionsKey = workspaceId => `discoveryActions:${accountKey}:${workspaceId}`;
    function validateDiscoveryActions(value, workspaceId) {
      discoveryActions().validate(value);
      if (value.workspaceId !== workspaceId) throw fault('workspace_mismatch', '좋아요·담기의 작업공간이 다릅니다.');
      if (new TextEncoder().encode(stablePayload(value)).length >= 1024 * 1024) {
        throw fault('discovery_actions_too_large', '좋아요·담기 자료가 너무 큽니다. 기존 선택은 보존했습니다.');
      }
    }
    async function discoveryActionsValue(meta, workspaceId) {
      return privateProfileValue(meta, discoveryActionsKey(workspaceId), workspaceId, discoveryActions(), validateDiscoveryActions);
    }
    async function readDiscoveryActions(workspaceId) {
      privateProfileScope(workspaceId, '좋아요·담기를');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta');
        await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return clone(await discoveryActionsValue(meta, workspaceId));
      });
    }
    async function saveDiscoveryActions(workspaceId, input, baseRevision) {
      privateProfileScope(workspaceId, '좋아요·담기를'); requireRevision(baseRevision, 'baseRevision');
      validateDiscoveryActions(input, workspaceId);
      const value = clone(input);
      if (baseRevision === Number.MAX_SAFE_INTEGER || value.revision !== baseRevision + 1) {
        throw fault('discovery_actions_conflict', '좋아요·담기의 저장 기준을 확인해 주세요.');
      }
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta');
        await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const previous = await discoveryActionsValue(meta, workspaceId);
        if (previous.revision !== baseRevision) return { status: 'conflict', profile: clone(previous) };
        await meta.put({ key: discoveryActionsKey(workspaceId), value });
        return { status: 'stored', profile: clone(value) };
      });
      if (result.status === 'stored') {
        const event = { type: 'discovery_actions_changed', workspaceId, revision: result.profile.revision };
        // Only this storage facade observes its own committed action write.
        // Other facades/tabs receive the minimal event and must revalidate.
        notify({ ...event, local: true }); try { channel?.postMessage({ ...event, sender }); } catch (_) { /* The committed row remains authoritative. */ }
      }
      return result;
    }
    const discoveryReadingKey = workspaceId => `discoveryReading:${accountKey}:${workspaceId}`;
    function validateDiscoveryReading(value, workspaceId) {
      const model = discoveryReading();
      validatePrivateProfile(value, workspaceId, model, model.MAX_BYTES, 'discovery_reading');
    }
    async function discoveryReadingValue(meta, workspaceId) {
      return privateProfileValue(meta, discoveryReadingKey(workspaceId), workspaceId, discoveryReading(), validateDiscoveryReading);
    }
    async function readDiscoveryReading(workspaceId) {
      privateProfileScope(workspaceId, '읽기 평가를');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta');
        await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return clone(await discoveryReadingValue(meta, workspaceId));
      });
    }
    async function saveDiscoveryReading(workspaceId, input, baseRevision) {
      privateProfileScope(workspaceId, '읽기 평가를'); requireRevision(baseRevision, 'baseRevision');
      validateDiscoveryReading(input, workspaceId);
      const value = clone(input);
      if (baseRevision === Number.MAX_SAFE_INTEGER || value.revision !== baseRevision + 1) {
        throw fault('discovery_reading_conflict', '읽기 평가의 저장 기준을 확인해 주세요.');
      }
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta');
        await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const previous = await discoveryReadingValue(meta, workspaceId);
        if (previous.revision !== baseRevision) return { status: 'conflict', profile: clone(previous) };
        await meta.put({ key: discoveryReadingKey(workspaceId), value });
        return { status: 'stored', profile: clone(value) };
      });
      if (result.status === 'stored') {
        const event = { type: 'discovery_reading_changed', workspaceId, revision: result.profile.revision };
        notify({ ...event, local: true });
        try { channel?.postMessage({ ...event, sender }); } catch (_) { /* The committed row remains authoritative. */ }
      }
      return result;
    }
    // Independent local metadata: does not alter source/workbench revisions or sync payloads.
    function collectionScope(workspaceId) {
      scopeGuard();
      if (!account) throw fault('auth_scope_required', '로그인한 계정에서 컬렉션을 열어 주세요.');
      requireId(workspaceId, '작업공간');
    }
    async function collectionValue(meta, workspaceId) {
      const row = await meta.get(`collection:${workspaceId}`);
      const value = row === undefined ? collection().empty(workspaceId) : row.value;
      collection().validate(value);
      if (value.workspaceId !== workspaceId) throw fault('workspace_mismatch', '컬렉션의 작업공간을 확인해 주세요.');
      return value;
    }
    async function readCollection(workspaceId) {
      collectionScope(workspaceId);
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        await checkedBundle(tx.objectStore('bundles'), workspaceId, tx.objectStore('meta'));
        return clone(await collectionValue(tx.objectStore('meta'), workspaceId));
      });
    }
    async function saveCollection(workspaceId, input, baseRevision) {
      collectionScope(workspaceId); requireRevision(baseRevision, 'baseRevision');
      collection().validate(input);
      const state = clone(input);
      if (state.workspaceId !== workspaceId) throw fault('workspace_mismatch', '컬렉션의 작업공간이 다릅니다.');
      if (state.revision !== baseRevision) throw fault('collection_conflict', '컬렉션 저장 기준이 바뀌었습니다. 입력을 보존했습니다.');
      const saved = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta');
        await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const previous = await collectionValue(meta, workspaceId);
        if (previous.revision !== baseRevision) throw fault('collection_conflict', '다른 탭에서 컬렉션을 수정했습니다. 입력을 보존하고 최신 내용과 비교해 주세요.');
        state.revision = baseRevision + 1;
        collection().validate(state);
        await meta.put({ key: `collection:${workspaceId}`, value: state });
        return clone(state);
      });
      const event = { type: 'collection_changed', workspaceId, revision: saved.revision };
      notify(event); try { channel?.postMessage({ ...event, sender }); } catch (_) { /* Saving succeeded; reload remains available. */ }
      return saved;
    }
    // Nine-slot boards are independently scoped local data, with their own file backup.
    const nineBoard = () => root.HaedoLife?.NineBoard || (typeof require === 'function' && require('./nine-board.js'));
    async function nineBoardValue(meta, workspaceId) {
      const row = await meta.get(`nine-board:${workspaceId}`);
      const value = row === undefined ? nineBoard().empty(workspaceId) : row.value;
      nineBoard().validate(value);
      if (value.workspaceId !== workspaceId) throw fault('workspace_mismatch', '9칸 구성의 작업공간이 다릅니다.');
      return value;
    }
    async function readNineBoard(workspaceId) {
      collectionScope(workspaceId);
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return clone(await nineBoardValue(meta, workspaceId));
      });
    }
    function saveNineBoard(workspaceId, input, baseRevision) { return saveNineBoardVerified(workspaceId, input, baseRevision, false); }
    function saveNineBoardCopy(workspaceId, input, baseRevision) { return saveNineBoardVerified(workspaceId, input, baseRevision, true); }
    async function saveNineBoardVerified(workspaceId, input, baseRevision, copy) {
      collectionScope(workspaceId); requireRevision(baseRevision, 'baseRevision'); nineBoard().validate(input);
      const value = clone(input);
      if (value.workspaceId !== workspaceId) throw fault('workspace_mismatch', '9칸 구성의 작업공간이 다릅니다.');
      if (value.revision !== baseRevision) throw fault('nine_board_conflict', '9칸 구성의 저장 기준이 바뀌었습니다.');
      const saved = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const previous = await nineBoardValue(meta, workspaceId);
        if (previous.revision !== baseRevision) throw fault('nine_board_conflict', '다른 탭에서 9칸 구성이 바뀌었습니다. 내 변경을 새 사본으로 보관해 주세요.');
        if (copy) {
          if (value.boards.length <= previous.boards.length || stablePayload(value.boards.slice(0, previous.boards.length)) !== stablePayload(previous.boards))
            throw fault('invalid_nine_board', '복원은 기존 구성을 유지한 새 사본으로만 저장해 주세요.');
        } else {
          for (const board of value.boards) for (const area of board.areas) {
            const oldArea = previous.boards.find(item => item.id === board.id)?.areas.find(item => item.id === area.id);
            const retained = (oldArea?.items || []).filter(item => item.reference?.kind === 'source').map(item => stablePayload(item.reference.value));
            for (const item of area.items) if (item.reference?.kind === 'source') {
              const at = retained.indexOf(stablePayload(item.reference.value));
              if (at >= 0) retained.splice(at, 1);
              else if (item.reference.value.workspaceId === workspaceId && bundle.sourceVersions.some(version => version.id === item.reference.value.sourceVersionId && version.sourceId === item.reference.value.sourceId)) assertNewEvidenceActive(bundle, [item.reference.value]);
            }
          }
        }
        value.revision++; nineBoard().validate(value);
        await meta.put({ key: `nine-board:${workspaceId}`, value }); return clone(value);
      });
      const event = { type: 'nine_board_changed', workspaceId, revision: saved.revision };
      notify(event); try { channel?.postMessage({ ...event, sender }); } catch (_) { /* Committed data remains authoritative. */ }
      return saved;
    }
    const publicCover = () => root.HaedoLife?.PublicCover || (typeof require === 'function' && require('./public-cover.js'));
    async function publicCoverValue(meta, workspaceId) {
      const row = await meta.get(`public-cover:${workspaceId}`), state = row === undefined ? publicCover().empty(workspaceId) : row.value;
      publicCover().validateState(state);
      if (state.workspaceId !== workspaceId) throw fault('workspace_mismatch', '표지와 작업공간의 연결을 확인해 주세요.');
      return state;
    }
    async function readPublicCover(workspaceId) {
      collectionScope(workspaceId);
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return clone(await publicCoverValue(meta, workspaceId));
      });
    }
    async function savePublicCover(workspaceId, input, baseRevision) {
      collectionScope(workspaceId); requireRevision(baseRevision); const value = clone(input); publicCover().validateState(value);
      if (value.workspaceId !== workspaceId) throw fault('workspace_mismatch', '다른 작업공간의 표지는 바꾸지 않았습니다.');
      if (value.revision !== baseRevision) throw fault('public_cover_conflict', '표지의 저장 기준이 바뀌었습니다. 입력은 유지합니다.');
      const saved = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const previous = await publicCoverValue(meta, workspaceId);
        if (previous.revision !== baseRevision) throw fault('public_cover_conflict', '다른 탭에서 표지가 바뀌었습니다. 내 입력은 새 사본으로 보관해 주세요.');
        value.revision++; publicCover().validateState(value); await meta.put({ key: `public-cover:${workspaceId}`, value }); return clone(value);
      });
      const event = { type: 'public_cover_changed', workspaceId, revision: saved.revision }; notify(event);
      try { channel?.postMessage({ ...event, sender }); } catch (_) { /* The committed draft remains authoritative. */ }
      return saved;
    }
    const photoPost = () => root.HaedoLife?.PhotoPost || (typeof require === 'function' && require('./photo-post.js'));
    const localPostKinds = ['photo', 'plain', 'page-draft', 'source', 'writing-draft'];
    function localPostScope() {
      scopeGuard();
      if (!account) throw fault('auth_scope_required', '확인된 로그인 계정에서 이 기기의 글을 찾아 주세요.');
    }
    const localPostTitle = body => body.split(/\r?\n/).find(line => line.trim())?.slice(0, 200) || '';
    async function scanLocalPosts(input = {}) {
      localPostScope();
      const settings = clone(input); onlyFields(settings, ['includeUnowned'], 'invalid_request');
      if (settings.includeUnowned !== undefined && typeof settings.includeUnowned !== 'boolean') throw fault('invalid_request', '이전 자료의 포함 여부를 확인해 주세요.');
      return transaction(['bundles', 'meta', 'staging'], 'readonly', async tx => {
        const bundles = tx.objectStore('bundles'), meta = tx.objectStore('meta'), stages = tx.objectStore('staging');
        const result = { workspaces: [], posts: [], issues: [], complete: true };
        function issue(workspaceId, kind, cause) {
          result.complete = false;
          result.issues.push({ ...(workspaceId === undefined ? {} : { workspaceId }), kind, code: typeof cause === 'string' ? cause : errorInfo(cause).code });
        }
        // Inspect ownership before reading a bundle or any of its post blobs.
        for (const workspaceId of await bundles.getAllKeys()) {
          scopeGuard();
          let owner;
          try { owner = await workspaceOwner(meta, workspaceId); }
          catch (_) { issue(undefined, 'workspace', 'workspace_ownership_unknown'); continue; }
          if (owner ? !sameAccount(owner, account) : !settings.includeUnowned) continue;
          const unowned = !owner;
          let bundle;
          try { bundle = await preservationBundle(tx, workspaceId, unowned); }
          catch (cause) {
            if (['workspace_access_denied', 'invalid_account_binding', 'invalid_sync_metadata'].includes(cause?.code)) issue(undefined, 'workspace', 'workspace_ownership_unknown');
            else issue(workspaceId, 'workspace', cause);
            continue;
          }
          const workspace = { workspaceId, title: bundle.title, unowned };
          result.workspaces.push(workspace);
          const add = (kind, row) => result.posts.push({ workspaceId, workspaceTitle: bundle.title, unowned, kind, ...row });
          const summaryRow = await meta.get(`photo-posts:${workspaceId}`), summaries = new Map();
          if (summaryRow !== undefined) {
            if (!Array.isArray(summaryRow.value)) issue(workspaceId, 'photo', 'invalid_photo_post_index');
            else for (const summary of summaryRow.value) {
              if (!plain(summary) || typeof summary.id !== 'string' || summaries.has(summary.id)) issue(workspaceId, 'photo', 'invalid_photo_post_index');
              else summaries.set(summary.id, summary);
            }
          }
          const prefix = `photo-post:${workspaceId}:`, found = new Set();
          let cursor = await meta.openCursor(root.IDBKeyRange.bound(prefix, prefix + '\uffff'));
          while (cursor) {
            const doc = cursor.value?.value;
            try {
              photoPost().validate(doc);
              if (cursor.key !== prefix + doc.id) throw fault('invalid_photo_post', '글과 저장 식별자가 다릅니다.');
              found.add(doc.id);
              const summary = summaries.get(doc.id), expected = photoSummary(doc);
              let indexState = summary ? 'mismatch' : 'missing';
              if (summary) {
                try { if (stablePayload(summary) === stablePayload(expected)) indexState = 'listed'; }
                catch (_) { issue(workspaceId, 'photo', 'invalid_photo_post_index'); }
              }
              add('photo', { id: doc.id, revision: doc.revision, title: doc.title, status: doc.status,
                archived: doc.archived === true, indexState, updatedAt: doc.updatedAt });
            } catch (cause) { issue(workspaceId, 'photo', cause); }
            cursor = await cursor.continue();
          }
          for (const id of summaries.keys()) if (!found.has(id)) issue(workspaceId, 'photo', 'photo_post_missing_or_invalid');
          const workbenchRow = await meta.get(`workbench:${workspaceId}`);
          if (workbenchRow !== undefined) {
            const state = workbenchRow.value;
            try { workbench().validate(state); if (state.workspaceId !== workspaceId) throw fault('workspace_mismatch', '다른 공간의 구성입니다.'); }
            catch (cause) { issue(workspaceId, 'plain', cause); }
            if (plain(state) && state.workspaceId === workspaceId && Number.isSafeInteger(state.revision) && state.revision >= 0 && Array.isArray(state.page?.posts)) {
              const seen = new Set();
              for (const post of state.page.posts) {
                try {
                  pagePosts().validate([post]);
                  if (seen.has(post.id)) throw fault('invalid_page_post', '중복된 글 식별자입니다.');
                  seen.add(post.id);
                  add('plain', { id: post.id, revision: state.revision, title: localPostTitle(post.body), status: post.status,
                    archived: false, indexState: 'listed', updatedAt: post.updatedAt });
                } catch (cause) { issue(workspaceId, 'plain', cause); }
              }
            }
          }
          const draftsRow = await meta.get(`page-drafts:${workspaceId}`);
          if (draftsRow !== undefined) {
            const value = draftsRow.value;
            try { validatePageDrafts(value); } catch (cause) { issue(workspaceId, 'page-draft', cause); }
            if (plain(value) && Number.isSafeInteger(value.revision) && value.revision >= 0 && Array.isArray(value.posts)) {
              const seen = new Set();
              for (const post of value.posts) {
                try {
                  pagePosts().validate([post]);
                  if (post.status !== 'draft' || seen.has(post.id)) throw fault('invalid_page_post', '초안 식별자와 상태를 확인하지 못했습니다.');
                  seen.add(post.id);
                  add('page-draft', { id: post.id, revision: value.revision, title: localPostTitle(post.body), status: 'draft',
                    archived: false, indexState: 'listed', updatedAt: post.updatedAt });
                } catch (cause) { issue(workspaceId, 'page-draft', cause); }
              }
            }
          }
          for (const source of bundle.sources) {
            if (writing().isOwnSource(source, bundle)) {
              const version = writing().latestVersion(bundle, source.id);
              add('source', { id: source.id, revision: source.revision, title: source.title, status: 'saved', archived: false,
                indexState: 'listed', updatedAt: source.updatedAt, versionId: version.id });
            } else if (typeof source.sourceKey === 'string' && source.sourceKey.startsWith(writing().SOURCE_KEY_PREFIX)) issue(workspaceId, 'source', 'invalid_own_writing');
          }
          for (const stage of await stages.index('workspaceId').getAll(workspaceId)) {
            if (stage?.kind !== 'writing') continue;
            try {
              writing().validateDraft(stage);
              if (stage.workspaceId !== workspaceId) throw fault('workspace_mismatch', '다른 공간의 초안입니다.');
              add('writing-draft', { id: stage.stageId, revision: stage.revision, title: stage.title, status: stage.state,
                archived: false, indexState: 'listed', updatedAt: stage.updatedAt });
            } catch (cause) { issue(workspaceId, 'writing-draft', cause); }
          }
        }
        return result;
      });
    }
    async function readLocalPostCandidate(input) {
      localPostScope(); const ref = clone(input);
      onlyFields(ref, ['workspaceId', 'kind', 'id', 'revision', 'unowned', 'versionId'], 'invalid_request');
      requireId(ref.workspaceId, '작업공간'); requireId(ref.id, '글');
      if (!localPostKinds.includes(ref.kind) || typeof ref.unowned !== 'boolean') throw fault('invalid_request', '찾은 글의 종류와 계정 범위를 확인해 주세요.');
      if (ref.revision !== undefined) requireRevision(ref.revision);
      if (ref.versionId !== undefined) requireId(ref.versionId, '원문 버전');
      return transaction(['bundles', 'meta', 'staging'], 'readonly', async tx => {
        const bundle = await preservationBundle(tx, ref.workspaceId, ref.unowned), meta = tx.objectStore('meta');
        const changed = () => fault('local_post_changed', '찾은 뒤 글이 바뀌었습니다. 다시 찾아 최신 내용을 확인해 주세요.');
        const missing = () => fault('local_post_missing', '찾은 글을 확인하지 못했습니다. 원본을 바꾸지 않았습니다.');
        const check = revision => { if (ref.revision !== undefined && ref.revision !== revision) throw changed(); };
        if (ref.versionId !== undefined && ref.kind !== 'source') throw fault('invalid_request', '이 글 종류에는 원문 버전을 지정할 수 없습니다.');
        if (ref.kind === 'photo') {
          const doc = (await meta.get(`photo-post:${ref.workspaceId}:${ref.id}`))?.value;
          if (!doc) throw missing(); photoPost().validate(doc); check(doc.revision);
          if (doc.id !== ref.id) throw missing();
          return { kind: ref.kind, title: doc.title, doc: clone(doc) };
        }
        if (ref.kind === 'plain' || ref.kind === 'page-draft') {
          const row = await meta.get(`${ref.kind === 'plain' ? 'workbench' : 'page-drafts'}:${ref.workspaceId}`), state = row?.value;
          if (!state) throw missing();
          // A valid candidate can still be read when an unrelated entry in the
          // same wrapper is damaged. Never repair or rewrite that wrapper here.
          if (!plain(state) || !Number.isSafeInteger(state.revision) || state.revision < 0) throw missing();
          if (ref.kind === 'plain' ? state.workspaceId !== ref.workspaceId || !Array.isArray(state.page?.posts) : !Array.isArray(state.posts)) throw missing();
          check(state.revision);
          const posts = ref.kind === 'plain' ? state.page.posts : state.posts, matches = posts.filter(post => post?.id === ref.id);
          if (matches.length !== 1) throw missing(); const doc = matches[0]; pagePosts().validate([doc]);
          if (ref.kind === 'page-draft' && doc.status !== 'draft') throw missing();
          return { kind: ref.kind, title: localPostTitle(doc.body), body: doc.body, doc: clone(doc) };
        }
        if (ref.kind === 'source') {
          const source = bundle.sources.find(row => row.id === ref.id);
          if (!source || !writing().isOwnSource(source, bundle)) throw missing(); check(source.revision);
          const version = ref.versionId === undefined ? writing().latestVersion(bundle, source.id) : bundle.sourceVersions.find(row => row.id === ref.versionId && row.sourceId === source.id);
          if (!version) throw changed();
          return { kind: ref.kind, title: source.title, body: version.contentText, doc: clone({ source, version }) };
        }
        const stage = await tx.objectStore('staging').get(ref.id);
        if (!stage || stage.workspaceId !== ref.workspaceId || stage.kind !== 'writing') throw missing();
        writing().validateDraft(stage); check(stage.revision);
        return { kind: ref.kind, title: stage.title, body: stage.text, doc: clone(stage) };
      });
    }
    async function listPhotoPosts(workspaceId) {
      collectionScope(workspaceId);
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return clone((await meta.get(`photo-posts:${workspaceId}`))?.value || []);
      });
    }
    async function readPhotoPost(workspaceId, postId) {
      collectionScope(workspaceId); requireId(postId, '사진 글');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const value = (await meta.get(`photo-post:${workspaceId}:${postId}`))?.value;
        if (!value) throw fault('photo_post_missing', '사진 글이 바뀌었거나 없습니다. 목록을 다시 확인해 주세요.');
        photoPost().validate(value); return clone(value);
      });
    }
    async function savePhotoPost(workspaceId, input, baseRevision, evidenceRequest = null, nineRequest = null, naver = null) {
      collectionScope(workspaceId); requireRevision(baseRevision); photoPost().validate(input);
      const value = photoPost().compact(input);
      if (naver && (baseRevision !== 0 || value.status !== 'draft' || value.replaces || value.archived))
        throw fault('invalid_photo_post', '원문 사진은 새 비공개 초안으로만 담을 수 있습니다.');
      const nine = nineRequest === null ? null : clone(nineRequest);
      if (nine) {
        onlyFields(nine, ['revision', 'boardId', 'areaId'], 'invalid_photo_post'); requireRevision(nine.revision);
        if (baseRevision !== 0 || value.status !== 'draft' || value.replaces || value.archived || typeof nine.boardId !== 'string' || typeof nine.areaId !== 'string')
          throw fault('invalid_photo_post', '9칸 구성은 새 비공개 초안으로만 담을 수 있습니다.');
      }
      const evidence = evidenceRequest === null ? null : { refs: checkedEvidence(evidenceRequest.refs, workspaceId), baseRevision: evidenceRequest.baseRevision };
      if (evidence) requireRevision(evidence.baseRevision);
      if (value.revision !== baseRevision) throw fault('photo_post_conflict', '사진 글 저장 기준이 바뀌었습니다. 입력을 보존했습니다.');
      const effects = {};
      const result = await transaction(['bundles', 'meta'], 'readwrite', tx => writePhotoPost(tx, workspaceId, value, baseRevision, evidence, nine, effects, [], naver));
      const event = { type: 'photo_posts_changed', workspaceId }; notify(event); try { channel?.postMessage({ ...event, sender }); } catch (_) {}
      if (effects.materialRevision !== undefined) materialWritingChanged(workspaceId, effects.materialRevision);
      return result;
    }
    async function writePhotoPost(tx, workspaceId, value, baseRevision, evidence, nine, effects = {}, retainedEvidence = [], naver = null) {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        if (naver) {
          naver.assertCurrent();
          const { sourceId, sourceVersionId, captureHash } = naver.request;
          if (!bundle.sourceVersions.some(version => version.id === sourceVersionId && version.sourceId === sourceId))
            throw fault('invalid_naver_media', '선택한 원문 사진의 정확한 버전을 확인하지 못했습니다.');
          if (!core().isSourceActive(bundle, sourceId)) throw fault('source_trashed', '휴지통의 사진으로 새 글을 만들지 않았습니다. 복원한 뒤 다시 선택해 주세요.');
          const attachment = (await meta.get(naverCaptureKey(workspaceId, sourceVersionId)))?.value;
          if (!attachment || attachment.sourceId !== sourceId || attachment.sourceVersionId !== sourceVersionId || attachment.capture?.capture_hash !== captureHash)
            throw fault('invalid_naver_media', '선택한 원문 사진의 수집 정보가 바뀌었습니다. 다시 선택해 주세요.');
          naverMedia().checkTarget(bundle, attachment); naver.assertCurrent();
        }
        if (nine) {
          const source = await nineBoardValue(meta, workspaceId);
          if (source.revision !== nine.revision || !source.boards.find(board => board.id === nine.boardId)?.areas.some(area => area.id === nine.areaId))
            throw fault('nine_board_conflict', '9칸 구성이 바뀌었습니다. 영역을 다시 검토한 뒤 초안을 만들어 주세요.');
        }
        if (evidence) {
          checkEvidenceTargets(evidence.refs, bundle);
          const priorEvidence = (await meta.get(`post-evidence:${workspaceId}:${value.id}`))?.value || { revision: 0, refs: [] };
          if (priorEvidence.revision !== evidence.baseRevision) throw fault('post_evidence_conflict', '다른 탭에서 글의 원문 근거가 바뀌었습니다. 입력은 유지합니다.');
          let inherited = [];
          if (value.replaces) {
            const target = (await meta.get(`photo-post:${workspaceId}:${value.replaces.id}`))?.value;
            if (target?.status === 'saved' && target.revision === value.replaces.revision) inherited = (await meta.get(`post-evidence:${workspaceId}:${target.id}`))?.value?.refs || [];
          }
          assertNewEvidenceActive(bundle, evidence.refs, [...priorEvidence.refs, ...inherited, ...retainedEvidence]);
        }
        const key = `photo-post:${workspaceId}:${value.id}`, previous = (await meta.get(key))?.value;
        if ((previous?.revision || 0) !== baseRevision || !previous && baseRevision !== 0) throw fault('photo_post_conflict', '다른 탭에서 사진 글을 수정했습니다. 입력은 남아 있습니다. 백업하거나 새 사본으로 보관해 주세요.');
        if (previous) photoPost().validate(previous);
        if (previous?.format === 'life-photo-post-v2' && value.format === 'life-photo-post-v1') throw fault('photo_post_update_required', '첨부와 보관 상태가 있는 새 형식입니다. 최신 작성기에서 다시 열어 주세요.');
        let index = (await meta.get(`photo-posts:${workspaceId}`))?.value || [];
        if (value.status === 'saved' && value.replaces) {
          const targetKey = `photo-post:${workspaceId}:${value.replaces.id}`, target = (await meta.get(targetKey))?.value;
          if (!target || target.revision !== value.replaces.revision || target.status !== 'saved') throw fault('photo_post_conflict', '원래 사진 글이 변경됐습니다. 수정 초안은 유지했습니다. 새 글로 저장할 수 있습니다.');
          const inheritedEvidence = (await meta.get(`post-evidence:${workspaceId}:${target.id}`))?.value;
          if (!evidence && inheritedEvidence && !(await meta.get(`post-evidence:${workspaceId}:${value.id}`))) {
            checkEvidenceTargets(checkedEvidence(inheritedEvidence.refs, workspaceId), bundle);
            await meta.put({ key: `post-evidence:${workspaceId}:${value.id}`, value: { revision: 1, refs: clone(inheritedEvidence.refs) } });
          }
          const priorBlog = (await meta.get(`blog-sync:${workspaceId}:${target.id}`))?.value;
          if (priorBlog && !(await meta.get(`blog-sync:${workspaceId}:${value.id}`))) {
            const binding = { ...clone(priorBlog), revision: 1, localRevision: 0, publishPending: null, unpublishPending: null, status: priorBlog.enabled ? 'pending' : 'paused' };
            if (binding.pending) binding.pending.localRevision = 0;
            await meta.put({ key: `blog-sync:${workspaceId}:${value.id}`, value: binding });
            await meta.delete(`blog-sync:${workspaceId}:${target.id}`);
          }
          if (priorBlog?.remoteId) {
            const receiptKey = `blog-received:${workspaceId}:${priorBlog.remoteId}`, receipt = (await meta.get(receiptKey))?.value;
            if (receipt) {
              checkBlogReceipt(receipt, priorBlog.remoteId);
              if (receipt.localPostId === target.id) {
                const nextBinding = (await meta.get(`blog-sync:${workspaceId}:${value.id}`))?.value;
                if (nextBinding?.remoteId !== priorBlog.remoteId) throw fault('invalid_blog_state', '받은 글의 연결이 바뀌었습니다. 원래 글을 유지했습니다.');
                await meta.put({ key: receiptKey, value: { ...receipt, localPostId: value.id } });
              }
            }
          }
          const materialRevision = await moveMaterialWritingOutputs(meta, workspaceId, target.id, value.id);
          if (materialRevision !== null) effects.materialRevision = materialRevision;
          await meta.delete(targetKey); index = index.filter(item => item.id !== target.id); value.createdAt = target.createdAt; value.replaces = null;
        }
        value.revision = baseRevision + 1; photoPost().validate(value);
        const summary = { id: value.id, title: value.title, status: value.status, revision: value.revision, updatedAt: value.updatedAt, body: photoPost().plainText(value), photos: value.photos.length, attachments: (value.attachments || []).length, archived: value.archived === true };
        const at = index.findIndex(item => item.id === value.id); if (at < 0) index.push(summary); else index[at] = summary;
        if (index.length > 200) throw fault('photo_post_limit', '사진 글과 초안은 합계 200개까지 보관할 수 있습니다.');
        await meta.put({ key, value }); await meta.put({ key: `photo-posts:${workspaceId}`, value: index });
        if (evidence) await meta.put({ key: `post-evidence:${workspaceId}:${value.id}`, value: { revision: evidence.baseRevision + 1, refs: clone(evidence.refs) } });
        if (naver) naver.assertCurrent();
        return clone(value);
    }
    function checkedEvidence(refs, workspaceId) {
      if (!Array.isArray(refs) || refs.length > 64) throw fault('invalid_source_reference', '원문 근거는 64개까지 보관할 수 있습니다.');
      const api = root.HaedoLife?.SourceReference || (typeof require === 'function' && require('./source-reference.js'));
      for (const ref of refs) {
        api.validate(ref);
        if (ref.workspaceId !== workspaceId) throw fault('workspace_access_denied', '다른 작업공간의 원문 근거를 저장하지 않았습니다.');
      }
      return clone(refs);
    }
    function checkEvidenceTargets(refs, bundle) {
      for (const ref of refs) {
        const version = bundle.sourceVersions.find(v => v.id === ref.sourceVersionId && v.sourceId === ref.sourceId);
        if (!bundle.sources.some(s => s.id === ref.sourceId) || !version || version.contentHash !== ref.contentHash ||
            typeof version.contentText !== 'string' || version.contentText.slice(ref.locator.start, ref.locator.end) !== ref.quote) {
          throw fault('invalid_source_reference', '선택한 정확한 원문 근거를 확인하지 못했습니다. 다른 버전으로 바꾸지 않았습니다.');
        }
      }
    }
    function assertNewEvidenceActive(bundle, refs, previous = []) {
      if (typeof core().isSourceActive !== 'function') return;
      const retained = new Set(previous.map(ref => stablePayload(ref)));
      for (const ref of refs) if (!retained.has(stablePayload(ref)) && !core().isSourceActive(bundle, ref.sourceId)) {
        throw fault('source_trashed', '휴지통의 자료를 새 근거로 추가하지 않았습니다. 입력과 기존 인용은 유지됩니다. 복원한 뒤 다시 선택해 주세요.');
      }
    }
    async function readPostEvidence(workspaceId, postId) {
      collectionScope(workspaceId); requireId(postId, '글');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const value = (await meta.get(`post-evidence:${workspaceId}:${postId}`))?.value || { revision: 0, refs: [] };
        checkedEvidence(value.refs, workspaceId); return clone(value);
      });
    }
    async function savePostEvidence(workspaceId, postId, input, baseRevision) {
      collectionScope(workspaceId); requireId(postId, '글'); requireRevision(baseRevision);
      const refs = checkedEvidence(input.refs, workspaceId);
      return transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        if (!(await meta.get(`photo-post:${workspaceId}:${postId}`))) throw fault('photo_post_missing', '근거를 연결할 글을 찾지 못했습니다.');
        checkEvidenceTargets(refs, bundle);
        const key = `post-evidence:${workspaceId}:${postId}`, previous = (await meta.get(key))?.value || { revision: 0 };
        if (previous.revision !== baseRevision) throw fault('post_evidence_conflict', '다른 탭에서 원문 근거가 바뀌었습니다.');
        assertNewEvidenceActive(bundle, refs, previous.refs || []);
        const value = { revision: baseRevision + 1, refs }; await meta.put({ key, value }); return clone(value);
      });
    }
    function savePhotoPostWithEvidence(workspaceId, input, baseRevision, refs, evidenceBaseRevision) {
      return savePhotoPost(workspaceId, input, baseRevision, { refs, baseRevision: evidenceBaseRevision });
    }
    function savePhotoPostFromNineBoard(workspaceId, input, revision, boardId, areaId) {
      return savePhotoPost(workspaceId, input, 0, null, { revision, boardId, areaId });
    }
    async function savePhotoPostFromNaverCapture(workspaceId, input, captureRequest, requestOptions = {}) {
      onlyFields(captureRequest, ['sourceId', 'sourceVersionId', 'captureHash'], 'invalid_naver_media');
      const request = clone(captureRequest);
      requireId(request.sourceId, '원문'); requireId(request.sourceVersionId, '원문 버전');
      if (typeof request.captureHash !== 'string' || !/^[a-f0-9]{64}$/.test(request.captureHash)) throw fault('invalid_naver_media', '원문 사진의 수집 해시를 확인해 주세요.');
      onlyFields(requestOptions, ['isCurrent'], 'invalid_request');
      const isCurrent = requestOptions.isCurrent;
      if (isCurrent !== undefined && typeof isCurrent !== 'function') throw fault('invalid_request', '사진 글을 만들 화면을 확인해 주세요.');
      const assertCurrent = () => { scopeGuard(); if (isCurrent && isCurrent() === false) throw fault('request_cancelled', '화면이 바뀌어 사진 글 만들기를 중단했습니다.'); };
      assertCurrent();
      return savePhotoPost(workspaceId, input, 0, null, null, { request, assertCurrent });
    }
    const materialWriting = () => root.HaedoLife?.MaterialWriting || (typeof require === 'function' && require('./material-writing.js'));
    const materialOutputKey = (workspaceId, planId) => `material-writing-output:${workspaceId}:${planId}`;
    async function materialReceipt(meta, workspaceId, planId) {
      const row = await meta.get(materialOutputKey(workspaceId, planId));
      if (row === undefined) return null;
      onlyFields(row.value, ['postId'], 'invalid_material_writing'); requireId(row.value.postId, '완성 글'); return row.value;
    }
    async function materialWritingValue(meta, workspaceId) {
      const row = await meta.get(`material-writing:${workspaceId}`), state = row === undefined ? materialWriting().empty(workspaceId) : row.value;
      materialWriting().validate(state);
      if (state.workspaceId !== workspaceId) throw fault('workspace_mismatch', '자료 글쓰기의 작업공간이 다릅니다.');
      for (const plan of state.plans) {
        const receipt = await materialReceipt(meta, workspaceId, plan.id);
        if (stablePayload(receipt) !== stablePayload(plan.output)) throw fault('invalid_material_writing', '준비와 완성 글의 연결을 확인하지 못했습니다. 새 글을 자동 생성하지 않았습니다.');
      }
      return state;
    }
    function materialWritingChanged(workspaceId, revision) {
      const event = { type: 'material_writing_changed', workspaceId, revision }; notify(event);
      try { channel?.postMessage({ ...event, sender }); } catch (_) { /* The committed plan remains authoritative. */ }
    }
    async function readMaterialWriting(workspaceId) {
      collectionScope(workspaceId);
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return clone(await materialWritingValue(meta, workspaceId));
      });
    }
    async function saveMaterialWriting(workspaceId, input, baseRevision) {
      collectionScope(workspaceId); requireRevision(baseRevision); const state = clone(input); materialWriting().validate(state);
      if (state.workspaceId !== workspaceId) throw fault('workspace_mismatch', '자료 글쓰기의 작업공간이 다릅니다.');
      if (state.revision !== baseRevision) throw fault('material_writing_conflict', '준비 저장 기준이 바뀌었습니다. 입력은 유지합니다.');
      const saved = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const previous = await materialWritingValue(meta, workspaceId);
        if (previous.revision !== baseRevision) throw fault('material_writing_conflict', '다른 탭에서 준비가 바뀌었습니다. 내 입력은 유지합니다.');
        for (const plan of state.plans) {
          const prior = previous.plans.find(value => value.id === plan.id), receipt = await materialReceipt(meta, workspaceId, plan.id);
          if (!prior && (receipt || plan.output !== null) || prior && stablePayload(prior.output) !== stablePayload(plan.output))
            throw fault('material_writing_conflict', '기존 글 연결을 바꾸거나 지워 새 글을 만들 수 없습니다. 새 준비 사본으로 보관해 주세요.');
          for (const material of plan.materials) {
            const original = prior?.materials.find(item => item.id === material.id);
            if ((!original || original.sourceId !== material.sourceId || original.sourceVersionId !== material.sourceVersionId || original.contentHash !== material.contentHash) &&
                typeof core().isSourceActive === 'function' && !core().isSourceActive(bundle, material.sourceId)) {
              throw fault('source_trashed', '휴지통의 자료를 새 준비에 추가하지 않았습니다. 입력과 기존 자료는 유지됩니다.');
            }
          }
          for (const block of plan.blocks) if (block.kind === 'quote') {
            const original = prior?.blocks.find(item => item.id === block.id && item.kind === 'quote' && item.materialId === block.materialId);
            assertNewEvidenceActive(bundle, [block.reference], original ? [original.reference] : []);
          }
        }
        state.revision = baseRevision + 1; materialWriting().validate(state);
        await meta.put({ key: `material-writing:${workspaceId}`, value: state }); return clone(state);
      });
      materialWritingChanged(workspaceId, saved.revision); return saved;
    }
    async function materialOutput(meta, workspaceId, plan, planRevision) {
      const post = (await meta.get(`photo-post:${workspaceId}:${plan.output.postId}`))?.value;
      if (!post || post.id !== plan.output.postId) throw fault('material_writing_output_missing', '연결한 글을 찾지 못했습니다. 준비와 기존 자료는 유지하며 새 글을 자동 생성하지 않습니다.');
      photoPost().validate(post); return { postId: post.id, revision: post.revision, planRevision, created: false };
    }
    async function createMaterialWritingPost(workspaceId, planId, expectedRevision) {
      return materialWritingPost(workspaceId, planId, expectedRevision, false);
    }
    function ownedMaterialClaim(state) {
      const output = state?.head?.data?.output;
      return state?.enabled && !state.pending && !state.conflict && output && state.localClaim?.postId === output.postId && state.localClaim.claimId === output.claimId;
    }
    async function finishMaterialContinuityClaim(workspaceId, planId, expectedRevision) {
      const result = await materialWritingPost(workspaceId, planId, expectedRevision, true);
      if (result.created) return result;
      // A preparation connected after an existing local handoff also needs the
      // canonical post identity before the saved replacement migrates its ID.
      await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const state = await materialContinuityState(meta, workspaceId, planId);
        if (!ownedMaterialClaim(state)) throw fault('material_output_elsewhere', '이 기기에서 확인한 글쓰기 권한을 다시 확인해 주세요.');
        const plan = (await materialWritingValue(meta, workspaceId)).plans.find(value => value.id === planId);
        if (plan?.output?.postId !== result.postId) throw fault('material_continuity_changed', '연결한 글이 바뀌었습니다. 다시 확인해 주세요.');
        await seedMaterialBlog(meta, workspaceId, result.postId, state);
      });
      return result;
    }
    async function seedMaterialBlog(meta, workspaceId, postId, state) {
      const key = `blog-sync:${workspaceId}:${postId}`, prior = (await meta.get(key))?.value;
      if (prior && prior.remoteId !== state.output.postId) throw fault('material_continuity_conflict', '기존 글의 다른 서버 연결을 바꾸지 않았습니다.');
      // This reserved identity has not been paused by the user. Keep drafts
      // local, but allow the first explicit finished save to start storage.
      if (!prior) await meta.put({ key, value: { ...materialBlogState(state.output.postId, state.head.data.bundle.workspaceId, 0, null, 0, null, false), enableOnSave: true } });
    }
    async function materialWritingPost(workspaceId, planId, expectedRevision, connected) {
      collectionScope(workspaceId); requireId(planId, '글 준비'); requireRevision(expectedRevision);
      const initial = await transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta), state = await materialWritingValue(meta, workspaceId);
        const plan = state.plans.find(value => value.id === planId);
        if (!plan) throw fault('material_writing_missing', '선택한 글 준비를 찾지 못했습니다.');
        const continuity = await materialContinuityState(meta, workspaceId, planId);
        if (connected && !ownedMaterialClaim(continuity)) throw fault('material_output_elsewhere', '다른 기기의 글쓰기를 새 초안으로 만들지 않았습니다.');
        if (plan.output) return { result: await materialOutput(meta, workspaceId, plan, state.revision) };
        if (connected && continuity.output.state !== 'writing') throw fault('material_output_pending', '완성 글을 정확한 원본으로 먼저 받아 주세요.');
        if (connected && materialCanonicalPayload(materialSnapshotData(bundle, plan, continuity)) !== materialCanonicalPayload(continuity.head.data)) throw fault('material_continuity_changed', '서버에서 확인한 준비와 정확한 원문이 바뀌었습니다.');
        if (continuity && !connected) throw fault('material_claim_required', '연결된 준비는 서버에서 글쓰기 권한을 확인한 뒤 이어 써 주세요.');
        if (state.revision !== expectedRevision) throw fault('material_writing_conflict', '준비가 바뀌었습니다. 최신 개요를 다시 검토해 주세요.');
        return clone({ state, plan, bundle, continuity });
      });
      if (initial.result) return initial.result;
      const projected = materialWriting().project(initial.state, planId, () => core().id()), doc = photoPost().compact(projected.doc), refs = checkedEvidence(projected.refs, workspaceId);
      if (connected) doc.id = initial.continuity.output.postId;
      if (doc.revision !== 0 || doc.status !== 'draft' || doc.replaces !== null || doc.archived) throw fault('invalid_material_writing', '새 비공개 글 초안으로만 이어 쓸 수 있습니다.');
      const reference = root.HaedoLife?.SourceReference || (typeof require === 'function' && require('./source-reference.js'));
      // Hash verification yields only before the write transaction. Its exact
      // source text and plan are rechecked inside that transaction below.
      for (const ref of refs) { await reference.resolve(initial.bundle, ref); scopeGuard(); }
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta), state = clone(await materialWritingValue(meta, workspaceId));
        const plan = state.plans.find(value => value.id === planId);
        if (!plan) throw fault('material_writing_missing', '선택한 글 준비가 바뀌었습니다.');
        // A lost reply or another tab may already have completed this exact
        // handoff. Resuming it never creates a second document.
        const continuity = await materialContinuityState(meta, workspaceId, planId);
        if (connected && (!ownedMaterialClaim(continuity) || stablePayload(continuity) !== stablePayload(initial.continuity))) throw fault('material_continuity_changed', '글쓰기 확인 뒤 준비 연결이 바뀌었습니다.');
        if (!connected && continuity) throw fault('material_claim_required', '연결된 준비는 서버에서 글쓰기 권한을 확인한 뒤 이어 써 주세요.');
        if (plan.output) return materialOutput(meta, workspaceId, plan, state.revision);
        if (connected && materialCanonicalPayload(materialSnapshotData(bundle, plan, continuity)) !== materialCanonicalPayload(continuity.head.data)) throw fault('material_continuity_changed', '검토한 준비와 정확한 원문이 바뀌었습니다. 새 글을 만들지 않았습니다.');
        if (state.revision !== expectedRevision || stablePayload(plan) !== stablePayload(initial.plan)) throw fault('material_writing_conflict', '검토한 준비가 바뀌었습니다. 새 글을 만들지 않았습니다.');
        checkEvidenceTargets(refs, bundle);
        for (const ref of refs) {
          const before = initial.bundle.sourceVersions.find(value => value.id === ref.sourceVersionId), current = bundle.sourceVersions.find(value => value.id === ref.sourceVersionId);
          if (before.contentText !== current.contentText) throw fault('invalid_source_reference', '검토한 정확한 원문이 바뀌었습니다. 최신판으로 바꾸지 않았습니다.');
        }
        const post = await writePhotoPost(tx, workspaceId, doc, 0, { refs, baseRevision: 0 }, null, {}, refs);
        plan.output = { postId: post.id }; state.revision++; materialWriting().validate(state);
        await meta.put({ key: `material-writing:${workspaceId}`, value: state });
        await meta.put({ key: materialOutputKey(workspaceId, planId), value: clone(plan.output) });
        if (connected) await seedMaterialBlog(meta, workspaceId, post.id, continuity);
        return { postId: post.id, revision: post.revision, planRevision: state.revision, created: true };
      });
      if (result.created) {
        materialWritingChanged(workspaceId, result.planRevision);
        const event = { type: 'photo_posts_changed', workspaceId }; notify(event); try { channel?.postMessage({ ...event, sender }); } catch (_) {}
      }
      return result;
    }
    async function moveMaterialWritingOutputs(meta, workspaceId, oldPostId, newPostId) {
      if (!(await meta.get(`material-writing:${workspaceId}`))) return null;
      const state = clone(await materialWritingValue(meta, workspaceId)); let changedPlans = false;
      for (const plan of state.plans) if (plan.output?.postId === oldPostId) { plan.output.postId = newPostId; changedPlans = true; }
      const prefix = `material-writing-output:${workspaceId}:`;
      const range = root.IDBKeyRange?.bound(prefix, prefix + '\uffff');
      const keys = (await meta.getAllKeys(range)).filter(key => typeof key === 'string' && key.startsWith(prefix));
      for (const key of keys) {
        const receipt = (await meta.get(key)).value; onlyFields(receipt, ['postId'], 'invalid_material_writing'); requireId(receipt.postId, '완성 글');
        if (receipt.postId === oldPostId) await meta.put({ key, value: { postId: newPostId } });
      }
      if (!changedPlans) return null;
      state.revision++; materialWriting().validate(state); await meta.put({ key: `material-writing:${workspaceId}`, value: state }); return state.revision;
    }
    const materialContinuity = () => root.HaedoLife?.MaterialContinuity || (typeof require === 'function' && require('./material-continuity.js'));
    const materialContinuityKey = (workspaceId, planId) => `material-continuity:${workspaceId}:${planId}`;
    const materialInstallKey = remoteId => `material-continuity-install:${accountKey}:${remoteId}`;
    function materialBinding(value) {
      onlyFields(value, ['projectUrl', 'userId'], 'invalid_material_continuity');
      const binding = accountValue(value);
      if (!account || !sameAccount(account, binding)) throw fault('account_mismatch', '현재 계정의 준비 연결만 사용할 수 있습니다.');
      return binding;
    }
    function materialRemoteRow(input) {
      onlyFields(input, ['id', 'revision', 'data', 'updated_at'], 'invalid_material_continuity');
      requireId(input.id, '서버 준비'); requireRevision(input.revision);
      if (!input.revision) throw fault('invalid_material_continuity', '서버 준비 버전을 확인해 주세요.');
      materialContinuity().validate(input.data);
      if (input.updated_at !== undefined && typeof input.updated_at !== 'string') throw fault('invalid_material_continuity', '서버 수정 시각을 확인해 주세요.');
      return clone(input);
    }
    function materialMapping(mapping, workspaceId) {
      if (mapping === null) return;
      onlyFields(mapping, ['workspaceId', 'sourceIds', 'versionIds', 'planIds', 'materialIds', 'blockIds', 'linkIds'], 'invalid_material_continuity');
      onlyFields(mapping.workspaceId, ['from', 'to'], 'invalid_material_continuity');
      requireId(mapping.workspaceId.from, '원래 작업공간');
      if (mapping.workspaceId.to !== workspaceId) throw fault('workspace_mismatch', '준비 사본의 작업공간 연결이 다릅니다.');
      const used = new Set([workspaceId]);
      for (const name of ['sourceIds', 'versionIds', 'planIds', 'materialIds', 'blockIds', 'linkIds']) {
        const entries = name === 'linkIds' && mapping[name] === undefined ? {} : mapping[name];
        if (!plain(entries)) throw fault('invalid_material_continuity', '준비 식별자 연결을 확인해 주세요.');
        for (const [from, to] of Object.entries(entries)) {
          requireId(from, '원래 항목'); requireId(to, '사본 항목');
          if (used.has(to)) throw fault('invalid_material_continuity', '준비 식별자 연결이 중복됐습니다.'); used.add(to);
        }
      }
    }
    function validateMaterialContinuityState(value, workspaceId) {
      onlyFields(value, ['revision', 'binding', 'enabled', 'remoteId', 'remoteRevision', 'head', 'mapping', 'output', 'pending', 'conflict', 'localClaim', 'error'], 'invalid_material_continuity');
      requireRevision(value.revision); materialBinding(value.binding); requireId(value.remoteId, '서버 준비'); requireRevision(value.remoteRevision);
      if (typeof value.enabled !== 'boolean') throw fault('invalid_material_continuity', '준비 연결 상태를 확인해 주세요.');
      materialMapping(value.mapping, workspaceId);
      if (value.head !== null) {
        const row = materialRemoteRow(value.head);
        if (row.id !== value.remoteId || row.revision !== value.remoteRevision || stablePayload(row.data.output) !== stablePayload(value.output)) throw fault('invalid_material_continuity', '준비의 서버 비교 기준이 다릅니다.');
      } else if (value.remoteRevision !== 0 || value.output !== null) throw fault('invalid_material_continuity', '준비의 서버 비교 기준이 없습니다.');
      if (value.pending !== null) {
        onlyFields(value.pending, ['operationId', 'expectedRevision', 'data', 'fingerprint'], 'invalid_material_continuity');
        requireId(value.pending.operationId, '전송 작업'); requireRevision(value.pending.expectedRevision); materialContinuity().validate(value.pending.data);
        if (value.pending.expectedRevision !== value.remoteRevision || !/^[a-f0-9]{64}$/.test(value.pending.fingerprint)) throw fault('invalid_material_continuity', '준비 전송 기준을 확인해 주세요.');
      }
      if (value.conflict !== null) {
        onlyFields(value.conflict, ['row', 'localFingerprint'], 'invalid_material_continuity');
        if (value.conflict.row !== null && (materialRemoteRow(value.conflict.row).id !== value.remoteId || value.conflict.row.revision < value.remoteRevision)) throw fault('invalid_material_continuity', '충돌한 준비의 서버 기준이 다릅니다.');
        if (!/^[a-f0-9]{64}$/.test(value.conflict.localFingerprint)) throw fault('invalid_material_continuity', '충돌한 준비의 비교 기준이 없습니다.');
      }
      if (value.localClaim !== null) {
        onlyFields(value.localClaim, ['claimId', 'postId'], 'invalid_material_continuity'); requireId(value.localClaim.claimId, '글쓰기 확인'); requireId(value.localClaim.postId, '완성 글');
        const output = value.pending?.data.output || value.output;
        if (!output || output.claimId !== value.localClaim.claimId || output.postId !== value.localClaim.postId) throw fault('invalid_material_continuity', '이 기기의 글쓰기 확인 정보가 다릅니다.');
      }
      if (value.error !== null && (typeof value.error !== 'string' || !/^[a-z0-9_]{1,100}$/.test(value.error))) throw fault('invalid_material_continuity', '정리된 준비 오류 코드가 필요합니다.');
      return value;
    }
    function materialOutputProgress(before, after) {
      if (!before) return;
      if (!after || before.postId !== after.postId || before.claimId !== after.claimId || before.state === 'saved' && (after.state !== 'saved' || after.revision < before.revision)) throw fault('invalid_material_continuity', '이미 확인한 글쓰기 연결을 지우거나 되돌릴 수 없습니다.');
    }
    async function materialContinuityState(meta, workspaceId, planId) {
      const state = (await meta.get(materialContinuityKey(workspaceId, planId)))?.value || null;
      if (state) validateMaterialContinuityState(state, workspaceId);
      return state;
    }
    async function readMaterialContinuityState(workspaceId, planId) {
      collectionScope(workspaceId); requireId(planId, '글 준비');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return clone(await materialContinuityState(meta, workspaceId, planId));
      });
    }
    async function writeMaterialContinuityState(workspaceId, planId, input, baseRevision = 0) {
      collectionScope(workspaceId); requireId(planId, '글 준비'); requireRevision(baseRevision);
      const value = clone(input); value.revision = baseRevision + 1; validateMaterialContinuityState(value, workspaceId);
      for (const data of [value.head?.data, value.pending?.data, value.conflict?.row?.data].filter(Boolean)) { await materialContinuity().verify(data); scopeGuard(); }
      let planRevision;
      const saved = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const wrapper = await materialWritingValue(meta, workspaceId); planRevision = wrapper.revision;
        if (!wrapper.plans.some(plan => plan.id === planId)) throw fault('material_writing_missing', '연결할 글 준비를 찾지 못했습니다.');
        const prior = await materialContinuityState(meta, workspaceId, planId);
        if ((prior?.revision || 0) !== baseRevision) throw fault('material_continuity_conflict', '다른 탭에서 준비 연결이 바뀌었습니다. 다시 확인해 주세요.');
        if (prior && (prior.remoteId !== value.remoteId || value.remoteRevision < prior.remoteRevision)) throw fault('stale_sync_result', '준비 연결을 오래된 서버 기준으로 바꾸지 않았습니다.');
        if (prior?.head && value.head && (prior.head.data.bundle.workspaceId !== value.head.data.bundle.workspaceId || prior.head.data.plan.id !== value.head.data.plan.id)) throw fault('invalid_material_continuity', '서버 준비의 고정 식별자를 바꾸지 않았습니다.');
        materialOutputProgress(prior?.output, value.output);
        if (prior?.head && value.head?.revision === prior.head.revision && stablePayload(prior.head.data) !== stablePayload(value.head.data)) throw fault('remote_revision_mismatch', '같은 서버 버전의 준비 내용이 다릅니다.');
        const receipt = (await meta.get(materialInstallKey(value.remoteId)))?.value;
        if (receipt && (receipt.workspaceId !== workspaceId || receipt.planId !== planId)) throw fault('material_continuity_exists', '이 서버 준비는 이미 다른 로컬 준비에 연결돼 있습니다.');
        await meta.put({ key: materialContinuityKey(workspaceId, planId), value });
        await meta.put({ key: materialInstallKey(value.remoteId), value: { workspaceId, planId } }); return clone(value);
      });
      materialWritingChanged(workspaceId, planRevision); return saved;
    }
    async function findMaterialContinuity(remoteId) {
      scopeGuard(); requireId(remoteId, '서버 준비'); if (!account) throw fault('auth_scope_required', '확인된 계정으로 준비를 받아 주세요.');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'), receipt = (await meta.get(materialInstallKey(remoteId)))?.value;
        if (!receipt) return null;
        onlyFields(receipt, ['workspaceId', 'planId'], 'invalid_material_continuity');
        await checkedBundle(tx.objectStore('bundles'), receipt.workspaceId, meta);
        const state = await materialContinuityState(meta, receipt.workspaceId, receipt.planId);
        if (!state || state.remoteId !== remoteId || !(await materialWritingValue(meta, receipt.workspaceId)).plans.some(plan => plan.id === receipt.planId)) throw fault('material_writing_missing', '이미 받은 준비의 연결을 찾지 못했습니다. 새 준비를 자동 생성하지 않습니다.');
        return clone(receipt);
      });
    }
    function mapMaterialOutput(output, mapping) {
      if (!output || output.state !== 'saved' || !mapping) return clone(output);
      return { ...clone(output), refs: output.refs.map(ref => ({ ...clone(ref), workspaceId: mapping.workspaceId.to,
        sourceId: mapping.sourceIds[ref.sourceId] || ref.sourceId, sourceVersionId: mapping.versionIds[ref.sourceVersionId] || ref.sourceVersionId })) };
    }
    function canonicalMaterialRefs(refs, mapping) {
      if (!mapping) return clone(refs);
      const sources = new Map(Object.entries(mapping.sourceIds).map(([from, to]) => [to, from])), versions = new Map(Object.entries(mapping.versionIds).map(([from, to]) => [to, from]));
      return refs.map(ref => ({ ...clone(ref), workspaceId: mapping.workspaceId.from, sourceId: sources.get(ref.sourceId) || ref.sourceId, sourceVersionId: versions.get(ref.sourceVersionId) || ref.sourceVersionId }));
    }
    function materialSnapshotData(bundle, plan, state, override) {
      const model = materialContinuity(), data = model.snapshot(bundle, plan, mapMaterialOutput(override === undefined ? state?.output || null : override, state?.mapping));
      if (!state?.mapping) return data;
      const inverse = new Map(); for (const name of ['sourceIds', 'versionIds', 'planIds', 'materialIds', 'blockIds', 'linkIds']) for (const [from, to] of Object.entries(state.mapping[name] || {})) inverse.set(to, from);
      return model.remap(data, state.mapping.workspaceId.from, id => inverse.get(id) || id).data;
    }
    async function materialSnapshot(tx, workspaceId, planId, override) {
      const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta), wrapper = await materialWritingValue(meta, workspaceId), plan = wrapper.plans.find(value => value.id === planId);
      if (!plan) throw fault('material_writing_missing', '선택한 글 준비를 찾지 못했습니다.');
      const state = await materialContinuityState(meta, workspaceId, planId), data = materialSnapshotData(bundle, plan, state, override);
      let post = null, refs = [], editingDrafts = [];
      if (plan.output) {
        post = (await meta.get(`photo-post:${workspaceId}:${plan.output.postId}`))?.value;
        if (!post) throw fault('material_writing_output_missing', '연결한 글을 찾지 못했습니다. 새 글을 자동 생성하지 않습니다.');
        photoPost().validate(post);
        const evidence = await meta.get(`post-evidence:${workspaceId}:${post.id}`); refs = checkedEvidence(evidence === undefined ? [] : evidence.value.refs, workspaceId);
        if (post.status === 'saved') {
          const index = (await meta.get(`photo-posts:${workspaceId}`))?.value || [];
          for (const summary of index) if (summary.status === 'draft' && !summary.archived) {
            const draft = (await meta.get(`photo-post:${workspaceId}:${summary.id}`))?.value;
            if (!draft) throw fault('photo_post_missing', '수정 중인 글을 찾지 못했습니다. 기존 준비와 글을 유지합니다.');
            photoPost().validate(draft);
            if (draft.status !== 'draft' || draft.archived || draft.replaces?.id !== post.id || draft.replaces.revision !== post.revision) continue;
            const own = await meta.get(`post-evidence:${workspaceId}:${draft.id}`), actual = checkedEvidence(own === undefined ? refs : own.value.refs, workspaceId);
            editingDrafts.push({ post: clone(draft), refs: canonicalMaterialRefs(actual, state?.mapping) });
          }
          editingDrafts.sort((a, b) => a.post.id < b.post.id ? -1 : a.post.id > b.post.id ? 1 : 0);
        }
      }
      return clone({ data, localRevision: wrapper.revision, plan, post, refs: canonicalMaterialRefs(refs, state?.mapping), editingDrafts, state });
    }
    async function readMaterialContinuitySnapshot(workspaceId, planId, options = {}) {
      collectionScope(workspaceId); requireId(planId, '글 준비');
      onlyFields(options, ['output'], 'invalid_material_continuity'); const override = options.output === undefined ? undefined : clone(options.output);
      const value = await transaction(['bundles', 'meta'], 'readonly', tx => materialSnapshot(tx, workspaceId, planId, override));
      await materialContinuity().verify(value.data); scopeGuard();
      value.fingerprint = await materialContinuity().fingerprint(value.data); scopeGuard(); return value;
    }
    function materialSnapshotGuard(value) {
      return stablePayload({ data: value.data, output: value.plan.output, review: materialReviewPayload(value), stateRevision: value.state?.revision || 0 });
    }
    function materialReviewPayload(value) {
      const blog = root.HaedoLife?.Blog || (typeof require === 'function' && require('./blog.js'));
      return stablePayload({ post: value.post ? blog.pack(photoPost().compact(value.post)) : null, refs: value.refs,
        editingDrafts: (value.editingDrafts || []).map(value => ({ post: blog.pack(photoPost().compact(value.post)), refs: value.refs })) });
    }
    function materialCanonicalPayload(data) {
      const value = clone(data);
      for (const name of ['sources', 'sourceVersions', 'links']) value.bundle[name].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      return stablePayload(value);
    }
    function freshMaterialState(remoteId, row, mapping) {
      return { revision: 1, binding: clone(account), enabled: true, remoteId, remoteRevision: row.revision, head: clone(row), mapping,
        output: clone(row.data.output), pending: null, conflict: null, localClaim: null, error: null };
    }
    function materialRemapped(data, workspaceId, previous, keepIds = false) {
      const all = new Map();
      if (previous) for (const name of ['sourceIds', 'versionIds', 'planIds', 'materialIds', 'blockIds', 'linkIds']) for (const [from, to] of Object.entries(previous[name] || {})) all.set(from, to);
      const mapped = materialContinuity().remap(data, workspaceId, id => all.get(id) || (keepIds ? id : core().id()));
      if (previous) for (const name of ['sourceIds', 'versionIds', 'planIds', 'materialIds', 'blockIds', 'linkIds']) mapped.mapping[name] = { ...previous[name], ...mapped.mapping[name] };
      return mapped;
    }
    function materialLocalPost(input) {
      const doc = photoPost().compact(input), ids = new Map(); doc.id = core().id(); doc.revision = 0; doc.replaces = null;
      for (const photo of doc.photos) { const id = core().id(); ids.set(photo.id, id); photo.id = id; }
      doc.ops = doc.ops.map(op => typeof op.insert === 'string' ? op : { ...op, insert: { photo: { ...op.insert.photo, id: ids.get(op.insert.photo.id) } } });
      photoPost().validate(doc); return doc;
    }
    function materialBlogState(remoteId, workspaceId, remoteRevision, manifest, localRevision, prior = null, enabled = true) {
      return { ...(prior || {}), revision: (prior?.revision || 0) + 1, enabled, remoteId, remoteWorkspaceId: workspaceId, remoteRevision,
        remoteManifest: clone(manifest), localRevision, pending: null, conflict: null, publishPending: null, unpublishPending: null,
        publication: prior?.publication || null, status: enabled ? 'synced' : 'paused', error: null };
    }
    async function installMaterialPost(tx, workspaceId, mapped, original, remoteWorkspaceId, priorPlan, preserveLocal, blogRow = null) {
      const meta = tx.objectStore('meta'), output = mapped.data.output;
      const oldPost = priorPlan?.output && (await meta.get(`photo-post:${workspaceId}:${priorPlan.output.postId}`))?.value;
      const oldBinding = oldPost && (await meta.get(`blog-sync:${workspaceId}:${oldPost.id}`))?.value;
      if (!output || output.state !== 'saved') {
        if (!oldPost || output && (oldPost.id === output.postId || oldBinding?.remoteId === output.postId)) return priorPlan?.output || null;
        if (preserveLocal) return null;
        throw fault('local_changed', '이 기기의 기존 글은 유지합니다. 양쪽 준비와 글을 보존하는 선택을 먼저 확인해 주세요.');
      }
      if (oldPost && oldBinding?.remoteId === output.postId && oldBinding.remoteRevision === output.revision && oldBinding.localRevision === oldPost.revision && !oldBinding.pending && !oldBinding.conflict) {
        if (original && stablePayload(oldBinding.remoteManifest) !== stablePayload((root.HaedoLife?.Blog || require('./blog.js')).pack(original))) throw fault('remote_revision_mismatch', '같은 서버 버전의 글 본문이 다릅니다.');
        return { postId: oldPost.id };
      }
      if (oldPost && !preserveLocal && (!oldBinding || oldBinding.localRevision !== oldPost.revision || oldBinding.pending || oldBinding.conflict)) throw fault('local_changed', '이 기기의 글을 수정 중입니다. 양쪽 글을 보존할 방법을 먼저 선택해 주세요.');
      if (!original) throw fault('material_output_pending', '완성 글의 정확한 원본을 먼저 받아 주세요.');
      const doc = materialLocalPost(original), saved = await writePhotoPost(tx, workspaceId, doc, 0, { refs: mapped.data.output.refs, baseRevision: 0 }, null, {}, mapped.data.output.refs);
      const blog = root.HaedoLife?.Blog || require('./blog.js');
      const state = materialBlogState(output.postId, blogRow?.workspace_id || remoteWorkspaceId, output.revision, blog.pack(original), saved.revision);
      state.publication = clone(blogRow?.publication || null);
      await meta.put({ key: `blog-sync:${workspaceId}:${saved.id}`, value: state });
      return { postId: saved.id };
    }
    async function materialNewWorkspace(tx, data, post, boundRow = null, blogRow = null, privateRecovery = false) {
      const bundle = core().createWorkspace({ title: data.plan.title || '받은 글 준비' }), workspaceId = bundle.workspaceId;
      const mapped = materialRemapped(data, workspaceId, null), plan = mapped.data.plan;
      bundle.sources = mapped.data.bundle.sources; bundle.sourceVersions = mapped.data.bundle.sourceVersions; bundle.links = mapped.data.bundle.links; core().validateWorkspace(bundle);
      const bundles = tx.objectStore('bundles'), meta = tx.objectStore('meta');
      if (await bundles.get(workspaceId)) throw fault('workspace_exists', '새 준비 공간이 이미 있습니다. 다시 시도해 주세요.');
      await bundles.add(bundle); await saveOwner(meta, workspaceId);
      if (privateRecovery && post) {
        const saved = await writePhotoPost(tx, workspaceId, materialLocalPost(post), 0, { refs: mapped.data.output.refs, baseRevision: 0 }, null, {}, mapped.data.output.refs);
        plan.output = { postId: saved.id };
      } else plan.output = await installMaterialPost(tx, workspaceId, mapped, post, data.bundle.workspaceId, null, false, blogRow);
      const wrapper = { ...materialWriting().empty(workspaceId), revision: 1, plans: [plan] }; materialWriting().validate(wrapper);
      await meta.put({ key: `material-writing:${workspaceId}`, value: wrapper });
      if (plan.output) await meta.put({ key: materialOutputKey(workspaceId, plan.id), value: clone(plan.output) });
      if (boundRow) {
        const state = freshMaterialState(boundRow.id, boundRow, mapped.mapping); validateMaterialContinuityState(state, workspaceId);
        await meta.put({ key: materialContinuityKey(workspaceId, plan.id), value: state });
        await meta.put({ key: materialInstallKey(boundRow.id), value: { workspaceId, planId: plan.id } });
      }
      return { workspaceId, planId: plan.id, postId: plan.output?.postId || null, existing: false, bundle: clone(bundle), planRevision: wrapper.revision };
    }
    async function installMaterialContinuity(inputRow, options = {}) {
      scopeGuard(); if (!account) throw fault('auth_scope_required', '확인된 계정에 준비 사본을 받아 주세요.');
      onlyFields(options, ['target', 'expectedFingerprint', 'expectedReview', 'preserveLocal', 'preserveRemote', 'post', 'blogRow'], 'invalid_material_continuity');
      const row = materialRemoteRow(inputRow), settings = clone(options), model = materialContinuity();
      let expectedReview = null;
      if (settings.expectedReview !== undefined) {
        onlyFields(settings.expectedReview, ['post', 'refs', 'editingDrafts'], 'invalid_material_continuity');
        expectedReview = stablePayload({ ...settings.expectedReview, editingDrafts: settings.expectedReview.editingDrafts || [] });
      }
      await model.verify(row.data); scopeGuard();
      let original = settings.post || null;
      if (original) {
        photoPost().validate(original);
        if (row.data.output?.state !== 'saved' || original.id !== row.data.output.postId || original.status !== 'saved' || original.replaces !== null) throw fault('invalid_material_continuity', '검토한 완성 글과 서버 준비의 연결이 다릅니다.');
        const blog = root.HaedoLife?.Blog || require('./blog.js'); original = await blog.hydrate(blog.pack(original), new Map(original.photos.map(photo => [photo.id, photo.blob]))); scopeGuard();
        if (settings.blogRow && (settings.blogRow.id !== row.data.output.postId || settings.blogRow.revision !== row.data.output.revision || typeof settings.blogRow.workspace_id !== 'string' || stablePayload(settings.blogRow.data) !== stablePayload(blog.pack(original)))) throw fault('invalid_material_continuity', '서버 완성 글의 버전·본문·연결이 다릅니다.');
      }
      if (settings.preserveLocal !== undefined && typeof settings.preserveLocal !== 'boolean' || settings.preserveRemote !== undefined && typeof settings.preserveRemote !== 'boolean' || settings.preserveLocal && settings.preserveRemote) throw fault('invalid_material_continuity', '한 번에 보존할 충돌 쪽을 선택해 주세요.');
      let target = settings.target || await findMaterialContinuity(row.id), before = null;
      if (target) {
        onlyFields(target, ['workspaceId', 'planId'], 'invalid_material_continuity');
        before = await readMaterialContinuitySnapshot(target.workspaceId, target.planId); scopeGuard();
        if (settings.expectedFingerprint !== before.fingerprint) throw fault('material_continuity_changed', '비교한 준비가 바뀌었습니다. 양쪽 내용을 다시 확인해 주세요.');
        if (expectedReview !== null && materialReviewPayload(before) !== expectedReview) throw fault('material_continuity_changed', '비교한 글 본문이나 정확한 근거가 바뀌었습니다. 양쪽 내용을 다시 확인해 주세요.');
      }
      const installed = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), receipt = (await meta.get(materialInstallKey(row.id)))?.value;
        if (!target) {
          if (receipt) throw fault('material_continuity_exists', '다른 탭에서 이미 이 준비를 받았습니다. 기존 준비를 다시 열어 주세요.');
          if (row.data.output?.state === 'saved' && !original) throw fault('material_output_pending', '완성 글의 정확한 원본을 먼저 받아 주세요.');
          const result = await materialNewWorkspace(tx, row.data, original, row, settings.blogRow);
          await meta.put({ key: activeKey, value: result.workspaceId }); return result;
        }
        const current = await materialSnapshot(tx, target.workspaceId, target.planId), state = current.state;
        if (expectedReview !== null && materialReviewPayload(current) !== expectedReview) throw fault('material_continuity_changed', '글 본문이나 정확한 근거가 검토 뒤 바뀌었습니다. 입력은 유지합니다.');
        if (materialSnapshotGuard(current) !== materialSnapshotGuard(before)) throw fault('material_continuity_changed', '원문·준비·연결한 글이 검토 뒤 바뀌었습니다. 입력은 유지합니다.');
        if (!state || state.remoteId !== row.id || receipt?.workspaceId !== target.workspaceId || receipt?.planId !== target.planId) throw fault('material_continuity_exists', '준비의 계정별 연결이 다릅니다.');
        if (!state.enabled) throw fault('material_paused', '이어쓰기가 중지된 준비는 변경하지 않았습니다. 다시 연결한 뒤 받아 주세요.');
        if (row.revision < state.remoteRevision || row.revision < (state.conflict?.row?.revision || 0)) throw fault('stale_sync_result', '더 최신 서버 준비를 이미 확인했습니다.');
        if (state.head?.revision === row.revision && stablePayload(state.head.data) !== stablePayload(row.data)) throw fault('remote_revision_mismatch', '같은 서버 버전의 준비 내용이 다릅니다.');
        if (state.head && (state.head.data.bundle.workspaceId !== row.data.bundle.workspaceId || state.head.data.plan.id !== row.data.plan.id)) throw fault('invalid_material_continuity', '서버 준비의 고정 식별자가 바뀌었습니다.');
        materialOutputProgress(state.output, row.data.output);
        if (current.editingDrafts.length && !settings.preserveLocal && !settings.preserveRemote) throw fault('local_changed', '이 글을 수정 중인 초안이 있습니다. 양쪽 글과 초안을 먼저 비교해 주세요.');
        let recovery = null, editingRecovery = [];
        if (settings.preserveLocal) {
          const bundle = await checkedBundle(tx.objectStore('bundles'), target.workspaceId, meta);
          // An edited local result and its actual sidecar are kept together in
          // a private recovery workspace; no server/public binding is copied.
          const recoveryOutput = current.post ? mapMaterialOutput({ state: 'saved', postId: core().id(), claimId: core().id(), revision: 1, refs: current.refs }, state.mapping) : null;
          recovery = await materialNewWorkspace(tx, model.snapshot(bundle, current.plan, recoveryOutput), current.post, null, null, true);
          for (const editing of current.editingDrafts) {
            const descriptor = mapMaterialOutput({ state: 'saved', postId: core().id(), claimId: core().id(), revision: 1, refs: editing.refs }, state.mapping);
            const installed = await materialNewWorkspace(tx, model.snapshot(bundle, current.plan, descriptor), editing.post, null, null, true);
            editingRecovery.push({ workspaceId: installed.workspaceId, planId: installed.planId, postId: installed.postId });
          }
        }
        if (settings.preserveRemote) {
          recovery = await materialNewWorkspace(tx, row.data, original, null, null, true);
          const oldBlog = current.post && (await meta.get(`blog-sync:${target.workspaceId}:${current.post.id}`))?.value;
          const differentOutput = current.post && (oldBlog?.remoteId || current.post.id) !== row.data.output?.postId;
          let localRecovery = null, planRevision = current.localRevision, output = current.plan.output;
          const bundle = clone(await checkedBundle(tx.objectStore('bundles'), target.workspaceId, meta));
          if (differentOutput) {
            const descriptor = mapMaterialOutput({ state: 'saved', postId: core().id(), claimId: core().id(), revision: 1, refs: current.refs }, state.mapping);
            localRecovery = await materialNewWorkspace(tx, model.snapshot(bundle, current.plan, descriptor), current.post, null, null, true);
            for (const editing of current.editingDrafts) {
              const descriptor = mapMaterialOutput({ state: 'saved', postId: core().id(), claimId: core().id(), revision: 1, refs: editing.refs }, state.mapping);
              const installed = await materialNewWorkspace(tx, model.snapshot(bundle, current.plan, descriptor), editing.post, null, null, true);
              editingRecovery.push({ workspaceId: installed.workspaceId, planId: installed.planId, postId: installed.postId });
            }
            const wrapper = clone(await materialWritingValue(meta, target.workspaceId)); wrapper.plans.find(plan => plan.id === target.planId).output = null; wrapper.revision++; planRevision = wrapper.revision; output = null;
            await meta.delete(materialOutputKey(target.workspaceId, target.planId)); await meta.put({ key: `material-writing:${target.workspaceId}`, value: wrapper });
          }
          const mapped = materialRemapped(row.data, target.workspaceId, state.mapping, state.mapping === null); let appended = false;
          immutableVersions(bundle, mapped.data.bundle, { partial: true });
          // The chosen local plan and source metadata stay authoritative, while
          // the winning output's exact evidence dependencies become available.
          for (const name of ['sources', 'sourceVersions', 'links']) for (const item of mapped.data.bundle[name]) if (!bundle[name].some(value => value.id === item.id)) { bundle[name].push(item); appended = true; }
          if (appended) { bundle.revision++; bundle.updatedAt = new Date().toISOString(); core().validateWorkspace(bundle); await tx.objectStore('bundles').put(bundle); }
          state.revision++; state.remoteRevision = row.revision; state.head = clone(row); state.output = clone(row.data.output); state.pending = null; state.conflict = null; state.error = null;
          state.mapping = mapped.mapping;
          if (state.localClaim && (state.output?.postId !== state.localClaim.postId || state.output?.claimId !== state.localClaim.claimId)) state.localClaim = null;
          validateMaterialContinuityState(state, target.workspaceId);
          await meta.put({ key: materialContinuityKey(target.workspaceId, target.planId), value: state });
          return { ...target, postId: output?.postId || null, existing: true, bundle: clone(bundle), planRevision,
            recoveryWorkspaceId: recovery.workspaceId, recoveryPlanId: recovery.planId,
            ...(localRecovery ? { localRecoveryWorkspaceId: localRecovery.workspaceId, localRecoveryPlanId: localRecovery.planId } : {}), ...(editingRecovery.length ? { editingRecovery } : {}) };
        }
        const mapped = materialRemapped(row.data, target.workspaceId, state.mapping, state.mapping === null), bundle = clone(await checkedBundle(tx.objectStore('bundles'), target.workspaceId, meta));
        if (mapped.data.plan.id !== target.planId) throw fault('invalid_material_continuity', '서버 준비의 고정 식별자가 바뀌었습니다.');
        immutableVersions(bundle, mapped.data.bundle, { partial: true });
        for (const name of ['sources', 'sourceVersions', 'links']) for (const item of mapped.data.bundle[name]) {
          const at = bundle[name].findIndex(existing => existing.id === item.id); if (at < 0) bundle[name].push(item); else bundle[name][at] = item;
        }
        bundle.revision++; bundle.updatedAt = new Date().toISOString(); core().validateWorkspace(bundle); await tx.objectStore('bundles').put(bundle);
        const wrapper = clone(await materialWritingValue(meta, target.workspaceId)), at = wrapper.plans.findIndex(plan => plan.id === target.planId), plan = mapped.data.plan;
        plan.output = await installMaterialPost(tx, target.workspaceId, mapped, original, row.data.bundle.workspaceId, current.plan, !!settings.preserveLocal, settings.blogRow);
        wrapper.plans[at] = plan; wrapper.revision++; materialWriting().validate(wrapper);
        if (plan.output) await meta.put({ key: materialOutputKey(target.workspaceId, plan.id), value: clone(plan.output) });
        else if (current.plan.output) await meta.delete(materialOutputKey(target.workspaceId, plan.id));
        await meta.put({ key: `material-writing:${target.workspaceId}`, value: wrapper });
        Object.assign(state, { revision: state.revision + 1, remoteRevision: row.revision, head: clone(row), output: clone(row.data.output), mapping: mapped.mapping, pending: null, conflict: null, error: null });
        if (state.localClaim && (state.output?.postId !== state.localClaim.postId || state.output?.claimId !== state.localClaim.claimId)) state.localClaim = null;
        validateMaterialContinuityState(state, target.workspaceId); await meta.put({ key: materialContinuityKey(target.workspaceId, target.planId), value: state });
        return { ...target, postId: plan.output?.postId || null, existing: true, bundle: clone(bundle), planRevision: wrapper.revision,
          ...(recovery ? { recoveryWorkspaceId: recovery.workspaceId, recoveryPlanId: recovery.planId } : {}), ...(editingRecovery.length ? { editingRecovery } : {}) };
      });
      changed(installed.workspaceId, installed.bundle.revision); materialWritingChanged(installed.workspaceId, installed.planRevision);
      return installed;
    }
    const blogSeries = () => root.HaedoLife?.BlogSeries || (typeof require === 'function' && require('./blog-series.js'));
    const seriesPostKey = (workspaceId, seriesId, itemId) => `blog-series-post:${workspaceId}:${seriesId}:${itemId}`;
    async function blogSeriesValue(meta, workspaceId) {
      const row = await meta.get(`blog-series:${workspaceId}`), value = row === undefined ? blogSeries().empty(workspaceId) : row.value;
      blogSeries().validate(value);
      if (value.workspaceId !== workspaceId) throw fault('workspace_mismatch', '모음의 작업공간이 다릅니다.');
      return value;
    }
    function seriesChanged(workspaceId, revision) {
      const event = { type: 'blog_series_changed', workspaceId, revision }; notify(event);
      try { channel?.postMessage({ ...event, sender }); } catch (_) { /* The committed library remains authoritative. */ }
    }
    async function readBlogSeries(workspaceId) {
      collectionScope(workspaceId);
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return clone(await blogSeriesValue(meta, workspaceId));
      });
    }
    async function seriesSnapshot(meta, workspaceId, series) {
      const posts = [];
      for (const item of series.items) {
        const row = await meta.get(seriesPostKey(workspaceId, series.id, item.id));
        if (!row) throw fault('blog_series_missing', '모음에 보존한 글 사본을 찾지 못했습니다. 최신 글로 바꾸지 않았습니다.');
        posts.push(row.value);
      }
      const value = { series, posts }; blogSeries().validateSnapshot(value); return value;
    }
    async function readBlogSeriesSnapshot(workspaceId, seriesId) {
      collectionScope(workspaceId); requireId(seriesId, '모음');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const state = await blogSeriesValue(meta, workspaceId), series = state.series.find(value => value.id === seriesId);
        if (!series) throw fault('blog_series_missing', '선택한 모음을 찾지 못했습니다. 모음 목록을 다시 확인해 주세요.');
        return clone(await seriesSnapshot(meta, workspaceId, series));
      });
    }
    async function saveBlogSeries(workspaceId, input, baseRevision) {
      collectionScope(workspaceId); requireRevision(baseRevision); const value = clone(input); blogSeries().validate(value);
      if (value.workspaceId !== workspaceId) throw fault('workspace_mismatch', '모음의 작업공간이 다릅니다.');
      if (value.revision !== baseRevision) throw fault('blog_series_conflict', '모음 저장 기준이 바뀌었습니다. 입력을 보존했습니다.');
      const saved = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const previous = await blogSeriesValue(meta, workspaceId);
        if (previous.revision !== baseRevision) throw fault('blog_series_conflict', '다른 탭에서 모음이 바뀌었습니다. 내 입력은 유지합니다.');
        const origins = new Map(), retained = new Set(), writes = [];
        const origin = item => stablePayload({ postId: item.postId, postRevision: item.postRevision, title: item.title });
        for (const series of previous.series) for (const item of series.items) {
          const key = origin(item); if (!origins.has(key)) origins.set(key, { series, item });
        }
        for (const series of value.series) {
          const prior = previous.series.find(row => row.id === series.id);
          if (prior && prior.createdAt !== series.createdAt) throw fault('blog_series_conflict', '모음의 등록 기준이 바뀌었습니다. 입력은 유지합니다.');
          const posts = [];
          for (const item of series.items) {
            const old = prior?.items.find(row => row.id === item.id); let doc;
            if (old) {
              if (origin(old) !== origin(item)) throw fault('blog_series_conflict', '이미 담은 글의 판을 바꾸지 않았습니다. 새 항목으로 다시 선택해 주세요.');
              const row = await meta.get(seriesPostKey(workspaceId, series.id, item.id));
              if (!row) throw fault('blog_series_missing', '모음에 보존한 글 사본이 없습니다. 원래 글로 대체하지 않았습니다.');
              blogSeries().validateSnapshot({ series: { ...series, items: [item] }, posts: [row.value] }); doc = row.value.doc;
            } else {
              const current = (await meta.get(`photo-post:${workspaceId}:${item.postId}`))?.value;
              if (current && current.id === item.postId && current.revision === item.postRevision && current.title === item.title && current.status === 'saved' && !current.archived) {
                doc = photoPost().compact(current);
              } else {
                // A conflict recovery may reuse a previously captured exact
                // version, even after the original was edited or archived.
                const source = origins.get(origin(item));
                if (!source) throw fault('blog_series_post_changed', '선택한 저장 글이 바뀌었거나 보관함에 있습니다. 다시 확인해 선택해 주세요.');
                const row = await meta.get(seriesPostKey(workspaceId, source.series.id, source.item.id));
                if (!row) throw fault('blog_series_missing', '복구할 고정 글 사본을 찾지 못했습니다.');
                blogSeries().validateSnapshot({ series: { ...source.series, items: [source.item] }, posts: [row.value] }); doc = row.value.doc;
              }
            }
            const row = { itemId: item.id, doc }, key = seriesPostKey(workspaceId, series.id, item.id);
            posts.push(row); retained.add(key); if (!old) writes.push({ key, value: row });
          }
          blogSeries().validateSnapshot({ series, posts });
        }
        for (const row of writes) await meta.put(row);
        for (const series of previous.series) for (const item of series.items) {
          const key = seriesPostKey(workspaceId, series.id, item.id); if (!retained.has(key)) await meta.delete(key);
        }
        value.revision = baseRevision + 1; blogSeries().validate(value);
        await meta.put({ key: `blog-series:${workspaceId}`, value }); return clone(value);
      });
      seriesChanged(workspaceId, saved.revision); return saved;
    }
    async function installBlogSeriesCopy(workspaceId, input) {
      collectionScope(workspaceId); const value = clone(input); blogSeries().validateSnapshot(value);
      const transport = root.HaedoLife?.Blog || (typeof require === 'function' && require('./blog.js'));
      if (!transport?.pack || !transport?.hydrate) throw fault('dependency_unavailable', '원본 사진 검증기를 불러오지 못했습니다.');
      for (const { doc } of value.posts) {
        await transport.hydrate(transport.pack(doc), new Map(doc.photos.map(photo => [photo.id, photo.blob]))); scopeGuard();
      }
      const occupied = new Set([workspaceId, value.series.id, ...value.series.items.map(item => item.id)]);
      for (const { doc } of value.posts) { occupied.add(doc.id); for (const photo of doc.photos) occupied.add(photo.id); }
      const fresh = () => {
        const id = core().id ? core().id() : root.crypto.randomUUID();
        if (occupied.has(id)) throw fault('invalid_blog_series', '새 모음의 식별자가 중복됐습니다.'); occupied.add(id); return id;
      };
      value.series.id = fresh();
      for (let i = 0; i < value.posts.length; i++) {
        const row = value.posts[i], item = value.series.items[i], photos = new Map(); row.itemId = item.id = fresh();
        row.doc.id = item.postId = fresh(); row.doc.revision = item.postRevision = 1; row.doc.replaces = null;
        for (const photo of row.doc.photos) { const id = fresh(); photos.set(photo.id, id); photo.id = id; }
        row.doc.ops = row.doc.ops.map(op => typeof op.insert === 'string' ? op : { ...op, insert: { photo: { ...op.insert.photo, id: photos.get(op.insert.photo.id) } } });
      }
      blogSeries().validateSnapshot(value); scopeGuard();
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const state = clone(await blogSeriesValue(meta, workspaceId)); state.series.push(value.series); state.revision++;
        blogSeries().validate(state);
        for (const row of value.posts) await meta.put({ key: seriesPostKey(workspaceId, value.series.id, row.itemId), value: row });
        await meta.put({ key: `blog-series:${workspaceId}`, value: state }); return { seriesId: value.series.id, revision: state.revision };
      });
      seriesChanged(workspaceId, result.revision); return result;
    }
    // A private, selected copy has no server binding. Read its dependencies in
    // one transaction; hashing/ZIP work happens later on this owned snapshot.
    function preservationOptions(input, selection = false) {
      const value = input === undefined ? {} : clone(input);
      onlyFields(value, selection ? ['postIds', 'boardIds', 'unowned'] : ['unowned'], 'invalid_preservation');
      if (value.unowned !== undefined && typeof value.unowned !== 'boolean') throw fault('invalid_preservation', '기존 자료의 계정 범위를 확인해 주세요.');
      if (selection) {
        for (const [key, max] of [['postIds', 20], ['boardIds', 20]]) {
          value[key] ??= [];
          if (!Array.isArray(value[key]) || value[key].length > max || new Set(value[key]).size !== value[key].length) throw fault('invalid_preservation', '보관할 글과 구성을 다시 선택해 주세요.');
          value[key].forEach(id => requireId(id, '선택 항목'));
        }
        if (!value.postIds.length && !value.boardIds.length) throw fault('invalid_preservation', '보관할 글 또는 9칸 구성을 선택해 주세요.');
      }
      return value;
    }
    async function preservationBundle(tx, workspaceId, unowned) {
      const bundles = tx.objectStore('bundles'), meta = tx.objectStore('meta');
      if (!unowned) return checkedBundle(bundles, workspaceId, meta);
      if (await workspaceOwner(meta, workspaceId)) throw fault('workspace_access_denied', '계정에 연결된 자료는 기존 자료 가져오기로 열 수 없습니다.');
      const bundle = await bundles.get(workspaceId);
      if (!bundle) throw fault('workspace_not_found', '보관할 작업공간을 찾지 못했습니다.');
      core().validateWorkspace(bundle); return bundle;
    }
    function photoSummary(doc) {
      return { id: doc.id, title: doc.title, status: doc.status, revision: doc.revision, updatedAt: doc.updatedAt,
        body: photoPost().plainText(doc), photos: doc.photos.length, attachments: (doc.attachments || []).length, archived: doc.archived === true };
    }
    async function readPreservationCatalog(workspaceId, options) {
      collectionScope(workspaceId); const settings = preservationOptions(options);
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const bundle = await preservationBundle(tx, workspaceId, settings.unowned), meta = tx.objectStore('meta');
        const index = (await meta.get(`photo-posts:${workspaceId}`))?.value || [];
        if (!Array.isArray(index) || index.length > 200 || index.some(row => !plain(row) || typeof row.id !== 'string' || !['saved', 'draft'].includes(row.status)) || new Set(index.map(row => row.id)).size !== index.length) throw fault('invalid_preservation', '저장 글 목록을 확인하지 못했습니다. 기존 자료를 보존했습니다.');
        const posts = index.filter(row => row.status === 'saved').map(row => {
          if (typeof row.title !== 'string' || typeof row.body !== 'string' || typeof row.updatedAt !== 'string' || !Number.isSafeInteger(row.revision) || row.revision < 1 || !Number.isSafeInteger(row.photos) || row.photos < 0) throw fault('invalid_preservation', '저장 글 목록을 확인하지 못했습니다.');
          return { id: row.id, title: row.title, status: row.status, revision: row.revision, updatedAt: row.updatedAt,
            body: row.body, photos: row.photos, attachments: row.attachments || 0, archived: row.archived === true };
        });
        const state = await nineBoardValue(meta, workspaceId);
        return clone({ workspace: { workspaceId, title: bundle.title, revision: bundle.revision }, posts,
          boards: state.boards.map(board => ({ id: board.id, title: board.title, areas: board.areas.length, itemCount: board.areas.reduce((sum, area) => sum + area.items.length, 0) })) });
      });
    }
    async function readPreservationSnapshot(workspaceId, options) {
      collectionScope(workspaceId); const settings = preservationOptions(options, true);
      return transaction(['bundles', 'meta'], 'readonly', tx => preservationSnapshot(tx, workspaceId, settings));
    }
    async function preservationSnapshot(tx, workspaceId, settings) {
      const bundle = await preservationBundle(tx, workspaceId, settings.unowned), meta = tx.objectStore('meta');
      const state = await nineBoardValue(meta, workspaceId), wanted = new Set(settings.boardIds);
      const boards = state.boards.filter(board => wanted.has(board.id));
      if (boards.length !== wanted.size) throw fault('preservation_source_changed', '선택한 9칸 구성이 바뀌었습니다. 다시 확인해 주세요.');
      const postIds = new Set(settings.postIds), postRefs = [];
      for (const board of boards) for (const area of board.areas) for (const item of area.items) if (item.reference) {
        const ref = item.reference.value;
        if (ref.workspaceId !== workspaceId) throw fault('workspace_access_denied', '다른 작업공간의 근거는 자동으로 가져오지 않습니다.');
        if (item.reference.kind === 'post') { postIds.add(ref.postId); postRefs.push(ref); }
        else checkEvidenceTargets(checkedEvidence([ref], workspaceId), bundle);
      }
      if (postIds.size > 20) throw fault('invalid_preservation', '선택한 글과 필수 근거 글은 20개까지 보관할 수 있습니다.');
      const posts = [];
      for (const postId of postIds) {
        const doc = (await meta.get(`photo-post:${workspaceId}:${postId}`))?.value;
        if (!doc || doc.id !== postId) throw fault('photo_post_missing', '선택한 글 또는 필요한 근거 글을 찾지 못했습니다.');
        photoPost().validate(doc);
        if (doc.status !== 'saved') throw fault('invalid_preservation', '명시적으로 저장한 글만 보관 파일에 담을 수 있습니다.');
        const evidence = (await meta.get(`post-evidence:${workspaceId}:${postId}`))?.value || { revision: 0, refs: [] };
        onlyFields(evidence, ['revision', 'refs'], 'invalid_preservation'); requireRevision(evidence.revision);
        checkEvidenceTargets(checkedEvidence(evidence.refs, workspaceId), bundle);
        for (const ref of postRefs.filter(ref => ref.postId === postId)) {
          if (doc.revision !== ref.postRevision || doc.archived || photoPost().plainText(doc).slice(ref.locator.start, ref.locator.end) !== ref.quote) throw fault('preservation_source_changed', '9칸에서 참조한 정확한 저장 글이 바뀌었습니다. 최신 글로 바꾸지 않았습니다.');
        }
        posts.push({ doc, evidence });
      }
      return clone({ bundle, posts, nineBoard: { ...state, boards } });
    }
    function preservationSelectionPayload(snapshot, expected) {
      const sourceIds = new Set(expected.bundle.sources.map(row => row.id)), versionIds = new Set(expected.bundle.sourceVersions.map(row => row.id));
      return stablePayload({ workspaceId: snapshot.bundle.workspaceId,
        sources: snapshot.bundle.sources.filter(row => sourceIds.has(row.id)),
        sourceVersions: snapshot.bundle.sourceVersions.filter(row => versionIds.has(row.id)),
        ...(typeof core().editedCopyMarkers === 'function' ? { editedCopyMarkers: core().editedCopyMarkers(snapshot.bundle, [...versionIds]) } : {}),
        posts: snapshot.posts.map(({ doc, evidence }) => ({ doc: { ...doc, photos: doc.photos.map(({ blob, ...metadata }) => metadata) }, evidence })),
        boards: snapshot.nineBoard.boards });
    }
    const preservationReferences = () => root.HaedoLife?.PreservationReferences || (typeof require === 'function' && require('./preservation-references.js'));
    async function installPreservationCopy(input, options) {
      scopeGuard();
      if (!account) throw fault('auth_scope_required', '현재 로그인 계정에 새 비공개 사본으로 복원해 주세요.');
      const candidate = clone(input), settings = options === undefined ? {} : clone(options), references = preservationReferences();
      onlyFields(settings, ['source'], 'invalid_preservation');
      if (!references?.validate) throw fault('dependency_unavailable', '보관 파일의 근거 검증기를 불러오지 못했습니다.');
      let expected = null, selected = null, expectedPayload = null;
      if (settings.source !== undefined) {
        onlyFields(settings.source, ['workspaceId', 'unowned', 'expected'], 'invalid_preservation');
        requireId(settings.source.workspaceId, '이전 작업공간');
        if (settings.source.unowned !== undefined && typeof settings.source.unowned !== 'boolean') throw fault('invalid_preservation', '기존 자료의 계정 범위를 확인해 주세요.');
        expected = await references.validate(settings.source.expected); scopeGuard();
        if (expected.bundle.workspaceId !== settings.source.workspaceId) throw fault('workspace_access_denied', '검토한 원본 작업공간과 일치하지 않습니다.');
        selected = preservationOptions({ unowned: settings.source.unowned, postIds: expected.posts.map(({ doc }) => doc.id), boardIds: expected.nineBoard.boards.map(board => board.id) }, true);
        expectedPayload = preservationSelectionPayload(expected, expected);
      }
      // Never await crypto or image decoding inside the IndexedDB transaction.
      const value = await references.validate(candidate); scopeGuard();
      const { bundle, posts, nineBoard: state } = value;
      if (bundle.revision !== 0 || state.revision !== 0 || posts.some(({ doc, evidence }) => doc.revision !== 1 || doc.replaces !== null || evidence.revision !== 1) ||
          bundle.sources.some(source => source.revision !== 1) || bundle.sourceVersions.some(version => version.revision !== undefined && version.revision !== 1)) throw fault('invalid_preservation', '새 사본의 저장 기준을 확인해 주세요.');
      for (const { doc } of posts) if (doc.photos.length) {
        const transport = root.HaedoLife?.Blog || (typeof require === 'function' && require('./blog.js'));
        if (!transport?.pack || !transport?.hydrate) throw fault('dependency_unavailable', '원본 사진 검증기를 불러오지 못했습니다.');
        await transport.hydrate(transport.pack(doc), new Map(doc.photos.map(photo => [photo.id, photo.blob]))); scopeGuard();
      }
      const installed = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const bundles = tx.objectStore('bundles'), meta = tx.objectStore('meta'), workspaceId = bundle.workspaceId;
        if (expected) {
          let current;
          try { current = await preservationSnapshot(tx, settings.source.workspaceId, selected); }
          catch (error) {
            if (['photo_post_missing', 'workspace_not_found', 'invalid_preservation', 'invalid_source_reference', 'preservation_source_changed'].includes(error.code)) throw fault('preservation_source_changed', '검토한 글·구성·근거가 바뀌었습니다. 다시 확인한 뒤 새 사본을 만들어 주세요.');
            throw error;
          }
          if (preservationSelectionPayload(current, expected) !== expectedPayload) throw fault('preservation_source_changed', '검토한 글·구성·근거가 바뀌었습니다. 원본을 유지하고 복원을 중지했습니다.');
        }
        if (await bundles.get(workspaceId) || (await meta.getAllKeys()).some(key => typeof key === 'string' && key.split(':').includes(workspaceId))) throw fault('workspace_exists', '같은 작업공간의 자료가 이미 있습니다. 새 사본을 다시 준비해 주세요.');
        await bundles.add(bundle); await saveOwner(meta, workspaceId);
        for (const { doc, evidence } of posts) {
          await meta.put({ key: `photo-post:${workspaceId}:${doc.id}`, value: doc });
          await meta.put({ key: `post-evidence:${workspaceId}:${doc.id}`, value: evidence });
        }
        await meta.put({ key: `photo-posts:${workspaceId}`, value: posts.map(({ doc }) => photoSummary(doc)) });
        await meta.put({ key: `nine-board:${workspaceId}`, value: state });
        await meta.put({ key: activeKey, value: workspaceId });
        return clone(value);
      });
      changed(bundle.workspaceId, bundle.revision);
      return installed;
    }
    function blogAccountScope(workspaceId) {
      collectionScope(workspaceId);
      if (!account) throw fault('auth_scope_required', '확인된 계정으로 서버 글을 열어 주세요.');
    }
    function checkBlogReceipt(value, remoteId) {
      if (!plain(value) || !sameAccount(value.owner, account) || value.remoteId !== remoteId || typeof value.localPostId !== 'string' || !value.localPostId)
        throw fault('invalid_blog_state', '받은 글의 연결을 확인하지 못했습니다. 기존 글을 유지합니다.');
    }
    async function blogCopies(meta, workspaceId, remoteId = null) {
      const prefix = `blog-sync:${workspaceId}:`, result = [];
      // Inspect keys first: no other workspace's private documents are read.
      for (const key of await meta.getAllKeys()) {
        if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
        const state = (await meta.get(key))?.value;
        if (remoteId !== null && state?.remoteId !== remoteId) continue;
        if (!plain(state) || typeof state.remoteId !== 'string' || !state.remoteId ||
            typeof state.enabled !== 'boolean' || !Number.isSafeInteger(state.revision) || state.revision < 1 ||
            !Number.isSafeInteger(state.remoteRevision) || state.remoteRevision < 0 || !Number.isSafeInteger(state.localRevision) || state.localRevision < 0)
          throw fault('invalid_blog_state', '글의 연결 정보를 확인하지 못했습니다. 기존 글을 유지합니다.');
        const localPostId = key.slice(prefix.length), post = (await meta.get(`photo-post:${workspaceId}:${localPostId}`))?.value;
        if (post) { photoPost().validate(post); if (post.id !== localPostId) throw fault('invalid_blog_state', '글의 연결과 본문이 다릅니다.'); }
        const status = !post || post.status !== 'saved' ? 'error' : state.conflict ? 'conflict' : state.error ? 'error' :
          !state.enabled ? state.enableOnSave === true ? 'local_pending' : 'paused' :
          state.pending || state.localRevision !== post.revision ? 'local_pending' : 'received';
        result.push({ localPostId, remoteId: state.remoteId, revision: post?.revision || 0, remoteRevision: state.remoteRevision,
          status, archived: post?.archived === true });
      }
      return result;
    }
    async function listBlogCopies(workspaceId) {
      blogAccountScope(workspaceId);
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return clone(await blogCopies(meta, workspaceId));
      });
    }
    async function installReceivedBlogPost(workspaceId, input, inputState, options = {}) {
      blogAccountScope(workspaceId); photoPost().validate(input);
      if (options.isCurrent !== undefined && typeof options.isCurrent !== 'function') throw fault('invalid_request', '글을 받을 화면을 확인해 주세요.');
      const assertCurrent = () => { scopeGuard(); if (options.isCurrent && options.isCurrent() === false) throw fault('request_cancelled', '화면이 바뀌어 글 받기를 중단했습니다.'); };
      assertCurrent();
      const post = photoPost().compact(input), state = clone(inputState);
      onlyFields(state, ['enabled', 'remoteId', 'remoteWorkspaceId', 'remoteRevision', 'localRevision', 'remoteManifest', 'publication', 'pending', 'conflict', 'status', 'error'], 'invalid_blog_state');
      if (post.revision !== 0 || post.status !== 'saved' || post.replaces || !plain(state) || state.enabled !== true ||
          typeof state.remoteId !== 'string' || !state.remoteId || typeof state.remoteWorkspaceId !== 'string' ||
          !Number.isSafeInteger(state.remoteRevision) || state.remoteRevision < 1 || state.pending || state.conflict || state.error ||
          state.remoteManifest?.id !== state.remoteId)
        throw fault('invalid_blog_state', '받을 글의 연결과 버전을 확인해 주세요.');
      const blog = root.HaedoLife?.Blog || (typeof require === 'function' && require('./blog.js'));
      blog.validateManifest(state.remoteManifest);
      if (new TextEncoder().encode(JSON.stringify(state)).length > 8388608) throw fault('invalid_blog_state', '글 연결 정보는 8 MiB까지 보관할 수 있습니다.');
      const normalized = blog.pack(post), photoIds = new Map();
      if (normalized.photos.length !== state.remoteManifest.photos.length) throw fault('invalid_blog_state', '받은 사진과 서버 원본이 다릅니다.');
      normalized.id = state.remoteId; normalized.revision = state.remoteManifest.revision;
      normalized.photos.forEach((photo, index) => { photoIds.set(photo.id, state.remoteManifest.photos[index].id); photo.id = state.remoteManifest.photos[index].id; });
      normalized.ops = normalized.ops.map(op => typeof op.insert === 'string' ? op : { ...op, insert: { photo: { ...op.insert.photo, id: photoIds.get(op.insert.photo.id) } } });
      if (stablePayload(normalized) !== stablePayload(state.remoteManifest)) throw fault('invalid_blog_state', '받은 글과 서버 원본이 다릅니다.');
      const effects = {};
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta); assertCurrent();
        const copies = await blogCopies(meta, workspaceId, state.remoteId); assertCurrent();
        if (copies.length > 1) throw fault('blog_copy_selection_required', '받은 글이 여러 개입니다. 열 글을 선택해 주세요.');
        if (copies.length) {
          const existing = (await meta.get(`photo-post:${workspaceId}:${copies[0].localPostId}`))?.value;
          assertCurrent();
          if (!existing || existing.status !== 'saved') throw fault('photo_post_missing', '연결된 글을 확인하지 못했습니다. 기존 자료를 유지합니다.');
          return { post: clone(existing), received: false };
        }
        const receiptKey = `blog-received:${workspaceId}:${state.remoteId}`, receipt = (await meta.get(receiptKey))?.value; assertCurrent();
        if (receipt) { checkBlogReceipt(receipt, state.remoteId); throw fault('photo_post_missing', '전에 받은 글의 연결을 확인하지 못했습니다. 새 사본을 자동 생성하지 않았습니다.'); }
        const saved = await writePhotoPost(tx, workspaceId, post, 0, null, null, effects); assertCurrent();
        await meta.put({ key: `blog-sync:${workspaceId}:${saved.id}`, value: { ...state, revision: 1, localRevision: saved.revision } });
        assertCurrent();
        await meta.put({ key: receiptKey, value: { owner: clone(account), remoteId: state.remoteId, localPostId: saved.id } });
        assertCurrent();
        return { post: saved, received: true };
      });
      if (result.received) {
        const event = { type: 'photo_posts_changed', workspaceId }; notify(event); try { channel?.postMessage({ ...event, sender }); } catch (_) {}
      }
      return result;
    }
    async function readBlogSyncState(workspaceId, postId) {
      collectionScope(workspaceId); requireId(postId, '글');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return clone((await meta.get(`blog-sync:${workspaceId}:${postId}`))?.value || null);
      });
    }
    async function writeBlogSyncState(workspaceId, postId, input, baseRevision = 0, options = {}) {
      collectionScope(workspaceId); requireId(postId, '글'); requireRevision(baseRevision);
      if (options.isCurrent !== undefined && typeof options.isCurrent !== 'function') throw fault('invalid_request', '글을 확인할 화면을 확인해 주세요.');
      if (options.expectedLocalRevision !== undefined) requireRevision(options.expectedLocalRevision);
      const assertCurrent = () => { scopeGuard(); if (options.isCurrent && options.isCurrent() === false) throw fault('request_cancelled', '화면이 바뀌어 글 확인을 중단했습니다.'); };
      assertCurrent();
      let serialized;
      try { serialized = JSON.stringify(input); } catch (_) { throw fault('invalid_blog_state', '글 연결 정보를 확인해 주세요.'); }
      if (!plain(input) || typeof serialized !== 'string' || new TextEncoder().encode(serialized).length > 8388608) throw fault('invalid_blog_state', '글 연결 정보는 8 MiB까지 보관할 수 있습니다.');
      const value = { ...JSON.parse(serialized), revision: baseRevision + 1 };
      return transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta); assertCurrent();
        if (options.expectedLocalRevision !== undefined) {
          const post = (await meta.get(`photo-post:${workspaceId}:${postId}`))?.value; assertCurrent();
          if (!post || post.id !== postId || post.revision !== options.expectedLocalRevision) throw fault('local_changed', '확인하는 동안 글이 바뀌었습니다. 현재 글을 다시 확인해 주세요.');
        }
        const key = `blog-sync:${workspaceId}:${postId}`, prior = (await meta.get(key))?.value;
        assertCurrent();
        if ((prior?.revision || 0) !== baseRevision) throw fault('blog_state_conflict', '다른 탭에서 글의 연결 상태가 바뀌었습니다. 원문은 유지합니다.');
        await meta.put({ key, value }); assertCurrent(); return clone(value);
      });
    }
    // Page composer drafts stay local, outside composition sync and public copies.
    const pagePosts = () => root.HaedoLife?.PagePosts || (typeof require === 'function' && require('./page-posts.js'));
    function validatePageDrafts(value) {
      if (!plain(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'revision') || !Object.hasOwn(value, 'posts')) throw fault('invalid_page_post', '초안 형식을 확인해 주세요.');
      requireRevision(value.revision, 'revision'); pagePosts().validate(value.posts);
      if (value.posts.some(post => post.status !== 'draft') || new TextEncoder().encode(JSON.stringify(value)).length > 2097152) throw fault('invalid_page_post', '초안은 2 MiB까지 보관할 수 있습니다.');
    }
    async function pageDraftsValue(meta, workspaceId) {
      const row = await meta.get(`page-drafts:${workspaceId}`);
      const value = row === undefined ? { revision: 0, posts: [] } : row.value;
      validatePageDrafts(value); return value;
    }
    async function readPageDrafts(workspaceId) {
      collectionScope(workspaceId);
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return clone(await pageDraftsValue(meta, workspaceId));
      });
    }
    async function savePageDrafts(workspaceId, input, baseRevision) {
      collectionScope(workspaceId); requireRevision(baseRevision, 'baseRevision'); validatePageDrafts(input);
      const value = clone(input);
      if (value.revision !== baseRevision) throw fault('page_draft_conflict', '초안 저장 기준이 바뀌었습니다.');
      return transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const previous = await pageDraftsValue(meta, workspaceId);
        if (previous.revision !== baseRevision) throw fault('page_draft_conflict', '다른 탭에서 초안이 바뀌었습니다. 입력을 파일로 보관한 뒤 다시 열어 주세요.');
        value.revision++; validatePageDrafts(value); await meta.put({ key: `page-drafts:${workspaceId}`, value }); return clone(value);
      });
    }
    async function savePagePost(workspaceId, draftId, draftRevision, baseRevision, options = {}) {
      collectionScope(workspaceId); requireRevision(draftRevision, 'draftRevision'); requireRevision(baseRevision, 'baseRevision');
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const previous = await workbenchValue(meta, workspaceId), drafts = await pageDraftsValue(meta, workspaceId);
        if (previous.revision !== baseRevision) throw fault('workbench_conflict', '페이지가 바뀌었습니다. 초안을 보존했으니 새 저장본을 확인해 주세요.');
        if (drafts.revision !== draftRevision) throw fault('page_draft_conflict', '다른 탭에서 초안이 바뀌었습니다. 입력을 보존했습니다.');
        const draft = drafts.posts.find(post => post.id === draftId);
        const finished = pagePosts().finish((previous.page.posts || []).concat(draft || []), draftId, new Date().toISOString(), options);
        const state = clone(previous); state.page.posts = finished.posts; state.revision++; workbench().validate(state);
        const composition = await readCompositionState(meta, workspaceId, previous);
        drafts.posts = drafts.posts.filter(post => post.id !== draftId); drafts.revision++; validatePageDrafts(drafts);
        await meta.put({ key: `workbench:${workspaceId}`, value: state });
        await meta.put({ key: `page-drafts:${workspaceId}`, value: drafts });
        if (composition) { composition.error = null; composition.status = compositionStatus(composition, state); await writeCompositionState(meta, composition); }
        return { workbench: clone(state), drafts: clone(drafts), id: finished.id };
      });
      workbenchChanged(result.workbench); return result;
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
        const bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const previous = await workbenchValue(meta, workspaceId);
        if (previous.revision !== baseRevision) throw fault('workbench_conflict', '다른 탭에서 구성을 바꿨습니다. 입력을 보존하고 최신 구성을 확인해 주세요.');
        assertNewWorkbenchVersionsActive(bundle, state, previous);
        const composition = await readCompositionState(meta, workspaceId, previous);
        state.revision = baseRevision + 1;
        workbench().validate(state);
        await meta.put({ key: `workbench:${workspaceId}`, value: state });
        if (composition) {
          composition.error = null; composition.status = compositionStatus(composition, state);
          await writeCompositionState(meta, composition);
        }
        return clone(state);
      });
      workbenchChanged(saved);
      return saved;
    }
    function assertNewWorkbenchVersionsActive(bundle, state, previous) {
      if (typeof core().isVersionActive !== 'function') return;
      const references = value => {
        const result = new Map(), add = (path, ids) => result.set(stablePayload(path), new Set(ids));
        for (const group of value.groups) add(['group', group.id], group.versionIds);
        for (const entry of value.page.entries) add(['page', entry.id], entry.parts.map(part => part.versionId));
        add(['reflection'], value.reflection.versionIds);
        for (const book of value.books || []) {
          const chapters = (items, edition) => {
            for (const chapter of items) {
              const path = ['book', book.id, edition, chapter.id]; add(path, chapter.versionIds);
              for (const insight of chapter.insights || []) {
                add([...path, insight.id, 'support'], insight.supportVersionIds);
                add([...path, insight.id, 'counter'], insight.counterVersionIds);
              }
            }
          };
          chapters(book.chapters, null);
          for (const edition of book.editions || []) chapters(edition.chapters, edition.id);
        }
        return result;
      };
      const retained = references(previous), known = new Set(bundle.sourceVersions.map(version => version.id));
      for (const [path, ids] of references(state)) for (const id of ids) {
        // Missing references remain representable in legacy compositions; known
        // trash cannot become a new use in another container or evidence field.
        if (!retained.get(path)?.has(id) && known.has(id) && !core().isVersionActive(bundle, id))
          throw fault('source_trashed', '휴지통의 자료를 새 구성에 추가하지 않았습니다. 입력과 기존 연결은 유지됩니다. 복원한 뒤 다시 선택해 주세요.');
      }
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
    async function installWorkspaces(input) {
      if (!Array.isArray(input) || input.length < 1 || input.length > 2) throw fault('invalid_request', '새 사본은 한 번에 1~2개 작업공간으로 복원할 수 있습니다.');
      const copies = clone(input);
      copies.forEach(bundle => core().validateWorkspace(bundle));
      if (new Set(copies.map(bundle => bundle.workspaceId)).size !== copies.length) throw fault('workspace_exists', '복원할 작업공간 식별자가 중복됩니다.');
      const installed = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const bundles = tx.objectStore('bundles'), meta = tx.objectStore('meta');
        for (const bundle of copies) {
          if (await bundles.get(bundle.workspaceId) || await workspaceOwner(meta, bundle.workspaceId)) throw fault('workspace_exists', '같은 작업공간이 이미 있습니다. 새 사본으로 복원하세요.');
        }
        for (const bundle of copies) {
          await bundles.add(bundle);
          await saveOwner(meta, bundle.workspaceId);
        }
        await meta.put({ key: activeKey, value: copies[0].workspaceId });
        return clone(copies);
      });
      for (const bundle of copies) changed(bundle.workspaceId, bundle.revision);
      return installed;
    }
    async function installWorkspace(input) { return (await installWorkspaces([input]))[0]; }
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
    const accountMaterialKey = (workspaceId, id) => `account-material:${workspaceId}:${id}`;
    function accountMaterialDescriptor(input) {
      onlyFields(input, ['id', 'revision', 'sourceWorkspaceId', 'sourceRevision', 'fingerprint'], 'invalid_account_material_registration');
      const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
      if (!uuid.test(input.id) || !uuid.test(input.sourceWorkspaceId) || !Number.isSafeInteger(input.revision) || input.revision < 1 ||
          !Number.isSafeInteger(input.sourceRevision) || input.sourceRevision < 1 || !/^[a-f0-9]{64}$/.test(input.fingerprint)) {
        throw fault('invalid_account_material_registration', '자료 등록의 정확한 기준을 확인해 주세요.');
      }
      return clone(input);
    }
    async function accountMaterialValue(meta, workspaceId, id, bundle) {
      const row = await meta.get(accountMaterialKey(workspaceId, id));
      if (row === undefined) return null;
      const value = row.value;
      onlyFields(value, ['owner', 'descriptor', 'result'], 'invalid_account_material_registration');
      onlyFields(value.owner, ['projectUrl', 'userId'], 'invalid_account_material_registration');
      if (!sameAccount(accountValue(value.owner), account)) throw fault('workspace_access_denied', '현재 계정의 자료 등록이 아닙니다.');
      const descriptor = accountMaterialDescriptor(value.descriptor);
      if (descriptor.id !== id) throw fault('invalid_account_material_registration', '자료 등록의 식별자가 다릅니다.');
      onlyFields(value.result, ['status', 'revision', 'operationId'], 'invalid_account_material_registration');
      requireRevision(value.result.revision); requireId(value.result.operationId, '등록 작업');
      if (value.result.status !== 'stored' || value.result.revision > bundle.revision) throw fault('invalid_account_material_registration', '자료 등록의 보관 결과를 확인하지 못했습니다.');
      return value;
    }
    async function readAccountMaterialRegistration(workspaceId, id) {
      scopeGuard();
      if (!account) throw fault('auth_scope_required', '확인된 계정에서 자료 등록을 확인해 주세요.');
      requireId(workspaceId, '작업공간');
      if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw fault('invalid_account_material_registration', '자료 등록의 식별자를 확인해 주세요.');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        return clone(await accountMaterialValue(meta, workspaceId, id, bundle));
      });
    }
    function checkAccountMaterialAppend(bundle, changes) {
      onlyFields(changes, ['put'], 'invalid_account_material_registration');
      if (changes.put === undefined) return;
      onlyFields(changes.put, ['sources', 'sourceVersions', 'links'], 'invalid_account_material_registration');
      for (const [name, items] of Object.entries(changes.put)) {
        if (!Array.isArray(items)) throw fault('invalid_account_material_registration', '추가할 자료 목록을 확인해 주세요.');
        const previous = new Map(bundle[name].map(item => [item.id, item]));
        for (const item of items) if (previous.has(item?.id) && stablePayload(previous.get(item.id)) !== stablePayload(item)) {
          throw fault('account_material_registration_changed', '기존 자료와 같은 식별자의 내용이 달라 등록하지 않았습니다.');
        }
      }
    }
    const naverMedia = () => {
      const value = options.naverMedia || root.HaedoLife?.NaverMedia || (typeof require === 'function' && require('./naver-media.js'));
      if (!value?.validate || !value?.checkTarget) throw fault('dependency_unavailable', '원문 사진 검증기를 불러오지 못했습니다.');
      return value;
    };
    const naverCaptureKey = (workspaceId, versionId) => `naver-capture:${workspaceId}:${versionId}`;
    async function commitNaverCapture(request, options = {}) {
      const operationId = request?.operationId;
      try {
        const input = clone(request); collectionScope(input.workspaceId);
        onlyFields(input, ['workspaceId', 'baseRevision', 'operationId', 'changes', 'attachment'], 'invalid_naver_media');
        const attachment = await naverMedia().validate(input.attachment, { ownerId: account.userId }); scopeGuard();
        if (attachment.localOnly) throw fault('invalid_naver_media', '파일 사본을 서버 수집 결과로 저장하지 않았습니다.');
        delete input.attachment;
        return commitLocalVerified(input, options, attachment);
      } catch (error) { return { status: 'rejected', error: errorInfo(error), operationId }; }
    }
    async function readNaverCapture(workspaceId, sourceVersionId) {
      collectionScope(workspaceId); requireId(sourceVersionId, '원문 버전');
      const snapshot = await transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const attachment = (await meta.get(naverCaptureKey(workspaceId, sourceVersionId)))?.value;
        return { bundle: clone(bundle), attachment: attachment === undefined ? null : clone(attachment) };
      });
      if (snapshot.attachment === null) return null;
      const attachment = await naverMedia().validate(snapshot.attachment); scopeGuard();
      if (attachment.sourceVersionId !== sourceVersionId) throw fault('invalid_naver_media', '원문 사진의 버전이 일치하지 않습니다.');
      naverMedia().checkTarget(snapshot.bundle, attachment);
      return attachment;
    }
    async function installNaverCaptureCopy(input, { isCurrent = () => true } = {}) {
      scopeGuard();
      if (!account) throw fault('auth_scope_required', '확인된 계정에 원문 사본을 받아 주세요.');
      const value = await naverMedia().validateSnapshot(clone(input)); scopeGuard();
      const { bundle, attachment } = value;
      if (!attachment.localOnly || bundle.revision !== 0 || bundle.sources.some(source => source.revision !== 1) ||
          bundle.sourceVersions.some(version => version.revision !== 1)) throw fault('invalid_naver_media', '새 독립 사본으로 복원해 주세요.');
      const installed = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const bundles = tx.objectStore('bundles'), meta = tx.objectStore('meta');
        if (!isCurrent()) throw fault('request_cancelled', '화면이 바뀌어 원문 복원을 중지했습니다.');
        if (await bundles.get(bundle.workspaceId) || (await meta.getAllKeys()).some(key => typeof key === 'string' && key.split(':').includes(bundle.workspaceId))) {
          throw fault('workspace_exists', '같은 작업공간이 이미 있습니다. 새 사본으로 복원해 주세요.');
        }
        await bundles.add(bundle); await saveOwner(meta, bundle.workspaceId);
        await meta.add({ key: naverCaptureKey(bundle.workspaceId, attachment.sourceVersionId), value: attachment });
        await meta.put({ key: activeKey, value: bundle.workspaceId });
        if (!isCurrent()) throw fault('request_cancelled', '화면이 바뀌어 원문 복원을 중지했습니다.');
        return clone(value);
      });
      changed(bundle.workspaceId, bundle.revision); return installed;
    }
    async function commitLocal(request, options) { return commitLocalVerified(request, options); }
    function assertWritableSourceChanges(bundle, changes) {
      if (typeof core().isSourceActive !== 'function') return;
      const versions = new Map((bundle.sourceVersions || []).map(version => [version.id, version]));
      for (const version of changes.put?.sourceVersions || []) {
        const exists = bundle.sources?.some(source => source.id === version.sourceId);
        if (exists && !versions.has(version.id) && !core().isSourceActive(bundle, version.sourceId)) {
          throw fault('source_in_trash', '휴지통의 자료에는 새 원문을 저장하지 않았습니다. 입력을 보존하고 자료를 복원한 뒤 다시 저장해 주세요.');
        }
      }
      for (const source of changes.put?.sources || []) {
        const previous = bundle.sources?.find(value => value.id === source.id);
        if (previous && stablePayload(previous) !== stablePayload(source) && !core().isSourceActive(bundle, source.id)) {
          throw fault('source_in_trash', '휴지통의 자료는 수정하지 않았습니다. 입력을 보존하고 자료를 먼저 복원해 주세요.');
        }
      }
    }
    async function preparedStageHashes(changes, stageId) {
      const hashes = new Map();
      if (stageId === undefined || !Array.isArray(changes.put?.sourceVersions)) return hashes;
      const crypto = root.crypto?.subtle ? root.crypto : typeof require === 'function' ? require('node:crypto').webcrypto : null;
      if (!crypto?.subtle) throw fault('crypto_unavailable', '원문 해시를 확인할 수 없어 저장하지 않았습니다. 입력은 보존했습니다.');
      for (const version of changes.put.sourceVersions) if (typeof version?.contentText === 'string') {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(version.contentText));
        hashes.set(version.id, Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''));
      }
      return hashes;
    }
    async function commitLocalVerified(request, { isCurrent = () => true } = {}, naverAttachment = null) {
      let operationId = request?.operationId;
      try {
        const input = clone(request);
        if (!plain(input)) throw fault('invalid_request', '저장할 작업을 확인하세요.');
        const { workspaceId, baseRevision, changes, stageId, stageRevision, stageResult } = input;
        const registration = input.accountMaterialRegistration === undefined ? null : accountMaterialDescriptor(input.accountMaterialRegistration);
        if (registration && !account) throw fault('auth_scope_required', '확인된 계정에 자료를 등록해 주세요.');
        if (registration && stageId !== undefined) throw fault('invalid_account_material_registration', '자료 등록과 글 인계는 별도로 보관해 주세요.');
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
          ...(stageResult !== undefined ? { stageResult } : {}),
          ...(registration ? { accountMaterialRegistration: registration } : {}),
          ...(naverAttachment ? { naverAttachment: { sourceId: naverAttachment.sourceId, sourceVersionId: naverAttachment.sourceVersionId,
            capture: naverAttachment.capture, localOnly: false } } : {}) });
        // Hash outside IDB: the cloned request is fixed, and the exact stage/base is
        // checked again in the transaction after this asynchronous work completes.
        const hashes = await preparedStageHashes(changes, stageId);
        let wrote = false, updatedSync = null, updatedWriting = null, appliedWriting = null;
        const result = await transaction(['bundles', 'operations', 'staging', 'meta'], 'readwrite', async tx => {
          await assertOwner(tx.objectStore('meta'), workspaceId);
          if (!isCurrent()) throw fault('request_cancelled', '화면이나 작업공간이 바뀌어 저장을 중지했습니다.');
          const operations = tx.objectStore('operations');
          const key = [workspaceId, operationId];
          const receipt = await operations.get(key);
          if (receipt) {
            if (receipt.payload !== payload) throw fault('operation_mismatch', '이미 저장한 작업 식별자에 다른 변경 내용이 들어왔습니다.');
            if (!registration) return clone(receipt.result);
          }
          const bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, tx.objectStore('meta'));
          if (registration) {
            const previous = await accountMaterialValue(tx.objectStore('meta'), workspaceId, registration.id, bundle);
            if (previous) {
              if (stablePayload(previous.descriptor) !== stablePayload(registration)) throw fault('account_material_registration_changed', '이미 등록한 자료의 기준이 달라 자동으로 바꾸지 않았습니다.');
              if (receipt) {
                if (stablePayload(previous.result) !== stablePayload(receipt.result)) throw fault('invalid_account_material_registration', '자료 등록의 작업 결과가 일치하지 않습니다.');
                return clone(receipt.result);
              }
              return { status: 'already_registered', revision: bundle.revision, operationId };
            }
            if (receipt) throw fault('invalid_account_material_registration', '자료 등록의 영수증을 확인하지 못했습니다.');
            if ((await tx.objectStore('meta').get(activeKey))?.value !== workspaceId) throw fault('account_material_target_changed', '자료를 등록할 현재 공간이 바뀌었습니다. 기존 자료는 유지했습니다.');
            const sync = await readSyncState(tx.objectStore('meta'), workspaceId, bundle);
            if (sync?.outbox || sync?.conflict) throw fault('account_material_sync_busy', '기존 자료의 동기화 작업을 먼저 확인해 주세요. 등록은 보류했습니다.');
          }
          if (bundle.revision !== baseRevision) return { status: 'conflict', currentRevision: bundle.revision, operationId };
          if (registration) checkAccountMaterialAppend(bundle, changes);
          let stage;
          if (stageId !== undefined) {
            stage = await tx.objectStore('staging').get(stageId);
            if (!stage || stage.workspaceId !== workspaceId || stage.revision !== stageRevision || stage.state !== 'draft') {
              return { status: 'conflict', currentRevision: bundle.revision, operationId, error: { code: 'stage_conflict', message: '가져오기 검토 내용이 바뀌었습니다. 다시 확인하세요.' } };
            }
            validateStage(stage);
            if (stage.kind === 'source-edit') {
              if (stageResult === undefined) throw fault('invalid_stage_result', '수정한 자료의 정확한 저장 결과가 필요합니다.');
              sourceEdit().checkPrepared(bundle, stage, changes, stageResult);
              for (const version of changes.put?.sourceVersions || []) if (typeof version.contentText === 'string' && hashes.get(version.id) !== version.contentHash) {
                throw fault('hash_mismatch', '수정한 본문과 원문 해시가 일치하지 않아 저장하지 않았습니다. 입력은 보존했습니다.');
              }
            }
          }
          if (!isCurrent()) throw fault('request_cancelled', '화면이나 작업공간이 바뀌어 저장을 중지했습니다.');
          assertWritableSourceChanges(bundle, changes);
          const updated = core().applyChanges(bundle, changes);
          core().validateWorkspace(updated);
          if (updated.workspaceId !== workspaceId || updated.revision !== bundle.revision + 1) {
            throw fault('invalid_revision', '저장할 작업공간 버전을 확인할 수 없습니다.');
          }
          if (naverAttachment) {
            naverMedia().checkTarget(updated, naverAttachment);
            const meta = tx.objectStore('meta'), key = naverCaptureKey(workspaceId, naverAttachment.sourceVersionId), previous = await meta.get(key);
            if (previous && stablePayload({ ...previous.value, photos: undefined }) !== stablePayload({ ...naverAttachment, photos: undefined })) {
              throw fault('immutable_naver_capture', '보관한 원문 사진 선언은 덮어쓸 수 없습니다. 새 원문 버전으로 보관해 주세요.');
            }
            if (!previous) await meta.add({ key, value: naverAttachment });
          }
          if (registration && (await readSyncState(tx.objectStore('meta'), workspaceId, bundle))?.enabled &&
              new TextEncoder().encode(JSON.stringify(updated)).length > SYNC_MAX_BYTES) throw fault('snapshot_too_large', '등록한 자료가 동기화 크기 제한을 넘습니다. 기존 자료는 유지했습니다.');
          if (stageResult !== undefined) validateStageResult(stageResult, updated);
          if (registration && COLLECTIONS.every(name => stablePayload(updated[name]) === stablePayload(bundle[name]))) {
            const stored = { status: 'stored', revision: bundle.revision, operationId };
            await tx.objectStore('meta').add({ key: accountMaterialKey(workspaceId, registration.id), value: { owner: clone(account), descriptor: registration, result: stored } });
            await operations.add({ workspaceId, operationId, payload, result: stored });
            return stored;
          }
          const stored = { status: 'stored', revision: updated.revision, operationId };
          const sync = await readSyncState(tx.objectStore('meta'), workspaceId, bundle);
          if (!isCurrent()) throw fault('request_cancelled', '화면이나 작업공간이 바뀌어 저장을 중지했습니다.');
          await tx.objectStore('bundles').put(updated);
          if (stage) {
            const applied = { ...stage, state: 'applied', revision: stage.revision + 1,
              updatedAt: new Date().toISOString(), ...(stageResult !== undefined ? { appliedResult: clone(stageResult) } : {}) };
            if (stage.kind === 'source-edit') validateStage(applied);
            if (stage.kind === 'writing') {
              const writingSync = await readWritingState(tx.objectStore('meta'), workspaceId, stage.stageId, stage);
              if (writingSync) {
                checkWritingApplied(applied, updated);
                // The original write and its terminal marker are one transaction. The
                // source stream becomes pending below, blocking premature transmission.
                writingSync.error = null; writingSync.status = writingStatus(writingSync, applied);
                updatedWriting = await writeWritingState(tx.objectStore('meta'), writingSync);
              }
              appliedWriting = applied;
            }
            await tx.objectStore('staging').put(applied);
          }
          if (sync) {
            sync.status = syncStatus(sync, updated); sync.error = null;
            updatedSync = await writeSyncState(tx.objectStore('meta'), sync);
          }
          await operations.add({ workspaceId, operationId, payload, result: stored });
          if (registration) await tx.objectStore('meta').add({ key: accountMaterialKey(workspaceId, registration.id), value: { owner: clone(account), descriptor: registration, result: stored } });
          if (!isCurrent()) throw fault('request_cancelled', '화면이나 작업공간이 바뀌어 저장을 중지했습니다.');
          wrote = true;
          return stored;
        });
        if (wrote) changed(workspaceId, result.revision);
        if (updatedSync) syncChanged(updatedSync);
        if (appliedWriting) writingChanged(appliedWriting);
        if (updatedWriting) writingSyncChanged(updatedWriting);
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
    // Composition revisions are independent of material revisions. The original binding is
    // a prerequisite, never an implicit request to connect or upload private material.
    function compositionRow(input, workspaceId) {
      if (!plain(input) || !Number.isSafeInteger(input.revision) || input.revision < 1 ||
          !Number.isSafeInteger(input.source_revision) || input.source_revision < 1) {
        throw fault('invalid_remote_snapshot', '서버 구성의 저장 버전을 확인할 수 없습니다.');
      }
      const row = clone(input);
      workbench().validate(row.data);
      if (row.workspace_id !== workspaceId || row.data.workspaceId !== workspaceId) {
        throw fault('invalid_remote_snapshot', '서버 구성의 작업공간과 내용이 일치하지 않습니다.');
      }
      return { workspace_id: workspaceId, revision: row.revision, source_revision: row.source_revision, data: row.data,
        ...(typeof row.updated_at === 'string' ? { updated_at: row.updated_at } : {}) };
    }
    function compositionStatus(sync, state) {
      return sync.conflict ? 'conflict' : sync.outbox || state.revision !== sync.syncedLocalRevision ? 'pending' : 'synced';
    }
    function validateCompositionState(sync, workspaceId) {
      try {
        onlyFields(sync, ['format', 'workspaceId', 'binding', 'enabled', 'remoteRevision', 'sourceRevision',
          'syncedLocalRevision', 'outbox', 'conflict', 'status', 'error', 'lastRecoveryId']);
        if (sync.format !== 'life-composition-sync-v1' || sync.workspaceId !== workspaceId || typeof sync.enabled !== 'boolean' ||
            !['pending', 'synced', 'conflict', 'error'].includes(sync.status) ||
            !Number.isSafeInteger(sync.syncedLocalRevision) || sync.syncedLocalRevision < -1) throw new Error('metadata');
        if (stablePayload(bindingValue(sync.binding, workspaceId)) !== stablePayload(sync.binding)) throw new Error('binding');
        requireRevision(sync.remoteRevision); requireRevision(sync.sourceRevision);
        if ((sync.remoteRevision === 0) !== (sync.sourceRevision === 0) ||
            (sync.lastRecoveryId !== null && (typeof sync.lastRecoveryId !== 'string' || !sync.lastRecoveryId))) throw new Error('metadata');
        if (sync.outbox !== null) {
          const box = sync.outbox;
          onlyFields(box, ['operationId', 'expectedRevision', 'sourceRevision', 'localRevision', 'data']);
          requireId(box.operationId, '전송 작업'); requireRevision(box.expectedRevision); requireRevision(box.localRevision);
          requireRevision(box.sourceRevision); workbench().validate(box.data);
          if (box.data.workspaceId !== workspaceId || box.data.revision !== box.localRevision ||
              box.expectedRevision !== sync.remoteRevision || box.sourceRevision < Math.max(1, sync.sourceRevision)) throw new Error('outbox');
        }
        if (sync.conflict !== null) {
          const conflict = sync.conflict;
          onlyFields(conflict, ['missing', 'row', 'remoteRevision', 'localRevision']);
          requireRevision(conflict.remoteRevision); requireRevision(conflict.localRevision);
          if (typeof conflict.missing !== 'boolean' || conflict.remoteRevision < sync.remoteRevision) throw new Error('conflict');
          if (conflict.missing) { if (conflict.row !== null) throw new Error('missing'); }
          else {
            const row = compositionRow(conflict.row, workspaceId);
            if (row.revision !== conflict.remoteRevision || row.source_revision < sync.sourceRevision) throw new Error('conflict');
          }
        }
        if (sync.error !== null) {
          onlyFields(sync.error, ['code', 'message']);
          if (typeof sync.error.code !== 'string' || !/^[a-z0-9_]{1,80}$/.test(sync.error.code) ||
              typeof sync.error.message !== 'string' || sync.error.message.length > 1000) throw new Error('error');
        }
        if ((sync.status === 'conflict') !== (sync.conflict !== null) ||
            (sync.status === 'synced' && (sync.outbox || sync.error || sync.syncedLocalRevision < 0)) ||
            (sync.status === 'error' && !sync.error) || (sync.status === 'pending' && sync.error) ||
            (sync.remoteRevision === 0 && sync.syncedLocalRevision !== -1) ||
            (sync.outbox && sync.outbox.localRevision <= sync.syncedLocalRevision)) throw new Error('consistency');
      } catch (_) { throw fault('invalid_composition_metadata', '구성 동기화 정보를 확인할 수 없습니다. 기존 내용은 보존했습니다.'); }
      return sync;
    }
    async function readCompositionState(meta, workspaceId, state) {
      if (account) await assertOwner(meta, workspaceId);
      const row = await meta.get(`compositionSync:${workspaceId}`);
      if (row === undefined) return null;
      const sync = validateCompositionState(row.value, workspaceId);
      if (account && !sameAccount(account, sync.binding)) throw fault('account_mismatch', '현재 계정과 구성 연결 정보가 다릅니다.');
      if (state && (sync.syncedLocalRevision > state.revision || sync.outbox?.localRevision > state.revision ||
          sync.conflict?.localRevision > state.revision)) {
        throw fault('invalid_composition_metadata', '구성 동기화 기준이 로컬 저장보다 앞서 있습니다. 기존 내용은 보존했습니다.');
      }
      const head = await meta.get(`compositionHead:${workspaceId}`);
      if (sync.remoteRevision > 0) {
        if (!head) throw fault('invalid_composition_metadata', '구성의 서버 비교 기준을 찾을 수 없습니다. 기존 내용은 보존했습니다.');
        const value = compositionRow(head.value, workspaceId);
        if (value.revision !== sync.remoteRevision || value.source_revision !== sync.sourceRevision ||
            (state && state.revision === sync.syncedLocalRevision && stablePayload({ ...value.data, revision: state.revision }) !== stablePayload(state)) ||
            (state && sync.status === 'synced' && state.revision !== sync.syncedLocalRevision)) {
          throw fault('invalid_composition_metadata', '구성의 서버 비교 기준이 일치하지 않습니다. 기존 내용은 보존했습니다.');
        }
      } else if (head) throw fault('invalid_composition_metadata', '연결되지 않은 구성에 서버 비교 기준이 있습니다.');
      return sync;
    }
    async function writeCompositionState(meta, sync) {
      if (account && !sameAccount(account, sync.binding)) throw fault('account_mismatch', '현재 로그인 계정과 구성 동기화 계정이 다릅니다.');
      validateCompositionState(sync, sync.workspaceId);
      await meta.put({ key: `compositionSync:${sync.workspaceId}`, value: sync });
      return clone(sync);
    }
    function authorizedComposition(sync, binding, enabled = true) {
      if (account && !sameAccount(account, binding)) throw fault('account_mismatch', '현재 로그인 계정과 구성 동기화 계정이 다릅니다.');
      if (!sync) throw fault('composition_not_configured', '이 작업공간의 구성 동기화를 먼저 연결하세요.');
      if (stablePayload(sync.binding) !== stablePayload(binding)) throw fault('account_mismatch', '다른 계정에 연결된 구성입니다.');
      if (enabled && !sync.enabled) throw fault('composition_paused', '구성 동기화가 중지되어 있습니다.');
      return sync;
    }
    async function compositionSource(meta, workspaceId, binding, bundle, ready = true) {
      if (account && !sameAccount(account, binding)) throw fault('account_mismatch', '현재 로그인 계정과 동기화 계정이 다릅니다.');
      const source = await readSyncState(meta, workspaceId, bundle);
      if (source && stablePayload(source.binding) !== stablePayload(binding)) {
        throw fault('account_mismatch', '원문과 구성의 연결 계정이 다릅니다.');
      }
      if (!source || !source.enabled || (ready && (source.remoteRevision < 1 || source.status !== 'synced' ||
          source.outbox || source.conflict || source.syncedLocalRevision !== bundle.revision))) {
        throw fault('composition_source_pending', '원문 동기화를 먼저 완료해 주세요. 구성은 이 기기에 보존했습니다.');
      }
      return source;
    }
    async function checkCompositionRow(meta, sync, source, row) {
      if (row.revision < revisionFloor(sync) || row.source_revision < Math.max(sync.sourceRevision, sync.conflict?.row?.source_revision || 0)) {
        throw fault('stale_sync_result', '더 최신 구성 또는 원문 기준을 이미 확인했습니다. 다시 동기화하세요.');
      }
      if (row.source_revision > source.remoteRevision) {
        throw fault('composition_source_pending', '이 구성에서 참조하는 원문을 먼저 받아 주세요. 기존 내용은 보존했습니다.');
      }
      const known = row.revision === sync.remoteRevision ? (await meta.get(`compositionHead:${sync.workspaceId}`))?.value :
        row.revision === sync.conflict?.remoteRevision ? sync.conflict.row : null;
      if (known && (row.source_revision !== known.source_revision || stablePayload(row.data) !== stablePayload(known.data))) {
        throw fault('remote_revision_mismatch', '같은 서버 버전의 구성 내용이 달라졌습니다. 기존 내용은 보존했습니다.');
      }
    }
    async function saveCompositionHead(meta, row) {
      await meta.put({ key: `compositionHead:${row.workspace_id}`, value: clone(row) });
    }
    async function getCompositionState(workspaceId) {
      requireId(workspaceId, '작업공간');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta');
        await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const state = await workbenchValue(meta, workspaceId);
        return clone(await readCompositionState(meta, workspaceId, state));
      });
    }
    async function bindCompositionSync(workspaceId, input) {
      const binding = bindingValue(input, workspaceId);
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        await compositionSource(meta, workspaceId, binding, bundle);
        const state = await workbenchValue(meta, workspaceId), previous = await readCompositionState(meta, workspaceId, state);
        const sync = previous ? authorizedComposition(previous, binding, false) : {
          format: 'life-composition-sync-v1', workspaceId, binding, enabled: true, remoteRevision: 0, sourceRevision: 0,
          syncedLocalRevision: -1, outbox: null, conflict: null, status: 'pending', error: null, lastRecoveryId: null
        };
        sync.enabled = true; sync.error = null; sync.status = compositionStatus(sync, state);
        return writeCompositionState(meta, sync);
      });
      compositionChanged(result); return result;
    }
    async function pauseCompositionSync(workspaceId, input) {
      const binding = bindingValue(input, workspaceId);
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta');
        await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const state = await workbenchValue(meta, workspaceId);
        const sync = authorizedComposition(await readCompositionState(meta, workspaceId, state), binding, false);
        sync.enabled = false; return writeCompositionState(meta, sync);
      });
      compositionChanged(result); return result;
    }
    async function prepareCompositionUpload(workspaceId, input) {
      const binding = bindingValue(input, workspaceId);
      let event;
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const source = await compositionSource(meta, workspaceId, binding, bundle);
        const state = await workbenchValue(meta, workspaceId);
        const sync = authorizedComposition(await readCompositionState(meta, workspaceId, state), binding);
        if (sync.conflict) throw fault('composition_conflict', '다른 기기의 구성을 먼저 비교해 주세요.');
        if (sync.outbox) {
          if (sync.outbox.sourceRevision > source.remoteRevision) throw fault('composition_source_pending', '전송 대기 구성에서 참조한 원문을 먼저 받아 주세요.');
          return clone(sync.outbox);
        }
        if (state.revision === sync.syncedLocalRevision) return null;
        if (source.remoteRevision < sync.sourceRevision) throw fault('stale_sync_result', '구성이 참조한 원문 기준보다 이전 자료입니다.');
        sync.outbox = { operationId: core().id(), expectedRevision: sync.remoteRevision, sourceRevision: source.remoteRevision,
          localRevision: state.revision, data: clone(state) };
        sync.error = null; sync.status = 'pending'; event = await writeCompositionState(meta, sync);
        return clone(sync.outbox);
      });
      if (event) compositionChanged(event); return result;
    }
    async function ackCompositionSync(workspaceId, input, operationId, remoteRevision) {
      const binding = bindingValue(input, workspaceId);
      requireId(operationId, '전송 작업'); requireRevision(remoteRevision);
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const source = await compositionSource(meta, workspaceId, binding, bundle);
        const state = await workbenchValue(meta, workspaceId);
        const sync = authorizedComposition(await readCompositionState(meta, workspaceId, state), binding);
        const box = sync.outbox;
        if (!box || box.operationId !== operationId || sync.conflict || remoteRevision !== box.expectedRevision + 1 ||
            remoteRevision < revisionFloor(sync) || box.sourceRevision > source.remoteRevision) {
          throw fault('stale_sync_result', '현재 구성 전송 작업과 다른 응답입니다. 다시 동기화하세요.');
        }
        await saveCompositionHead(meta, { workspace_id: workspaceId, revision: remoteRevision, source_revision: box.sourceRevision, data: box.data });
        sync.remoteRevision = remoteRevision; sync.sourceRevision = box.sourceRevision; sync.syncedLocalRevision = box.localRevision;
        sync.outbox = null; sync.error = null; sync.status = compositionStatus(sync, state);
        return writeCompositionState(meta, sync);
      });
      compositionChanged(result); return result;
    }
    async function applyCompositionRemote(workspaceId, input, inputRow) {
      const binding = bindingValue(input, workspaceId), row = compositionRow(inputRow, workspaceId);
      let event, updated;
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const source = await compositionSource(meta, workspaceId, binding, bundle);
        const state = await workbenchValue(meta, workspaceId);
        const sync = authorizedComposition(await readCompositionState(meta, workspaceId, state), binding);
        await checkCompositionRow(meta, sync, source, row);
        if (sync.outbox || sync.conflict || state.revision !== sync.syncedLocalRevision) {
          // An acknowledged unchanged remote head does not conflict with a newer local edit.
          if (row.revision === sync.remoteRevision && !sync.conflict) return { status: 'stored', revision: state.revision };
          sync.conflict = { missing: false, row, remoteRevision: row.revision, localRevision: state.revision };
          sync.status = 'conflict'; sync.error = null; event = await writeCompositionState(meta, sync);
          return { status: 'conflict', revision: state.revision };
        }
        if (row.revision === sync.remoteRevision) return { status: 'stored', revision: state.revision };
        updated = { ...clone(row.data), revision: state.revision + 1 }; workbench().validate(updated);
        await meta.put({ key: `workbench:${workspaceId}`, value: updated }); await saveCompositionHead(meta, row);
        sync.remoteRevision = row.revision; sync.sourceRevision = row.source_revision; sync.syncedLocalRevision = updated.revision;
        sync.error = null; sync.status = 'synced'; event = await writeCompositionState(meta, sync);
        return { status: 'stored', revision: updated.revision };
      });
      if (updated) workbenchChanged(updated); if (event) compositionChanged(event); return result;
    }
    async function setCompositionConflict(workspaceId, input, inputRow) {
      const binding = bindingValue(input, workspaceId), row = inputRow === null ? null : compositionRow(inputRow, workspaceId);
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const source = await compositionSource(meta, workspaceId, binding, bundle);
        const state = await workbenchValue(meta, workspaceId);
        const sync = authorizedComposition(await readCompositionState(meta, workspaceId, state), binding);
        if (row) await checkCompositionRow(meta, sync, source, row);
        sync.conflict = { missing: row === null, row, remoteRevision: row?.revision ?? revisionFloor(sync), localRevision: state.revision };
        sync.error = null; sync.status = 'conflict'; return writeCompositionState(meta, sync);
      });
      compositionChanged(result); return result;
    }
    async function setCompositionError(workspaceId, input, inputError) {
      const binding = bindingValue(input, workspaceId), error = clone(inputError);
      if (error !== null) {
        onlyFields(error, ['code', 'message'], 'invalid_request');
        if (typeof error.code !== 'string' || !/^[a-z0-9_]{1,80}$/.test(error.code) ||
            typeof error.message !== 'string' || error.message.length > 1000) throw fault('invalid_request', '정제된 구성 오류 정보가 필요합니다.');
      }
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        await compositionSource(meta, workspaceId, binding, bundle, false);
        const state = await workbenchValue(meta, workspaceId);
        const sync = authorizedComposition(await readCompositionState(meta, workspaceId, state), binding);
        sync.error = error; sync.status = error === null ? compositionStatus(sync, state) : sync.conflict ? 'conflict' : 'error';
        return writeCompositionState(meta, sync);
      });
      compositionChanged(result); return result;
    }
    async function resolveCompositionSync(workspaceId, input, resolution) {
      const binding = bindingValue(input, workspaceId), request = clone(resolution);
      onlyFields(request, ['choice', 'expectedLocalRevision', 'remoteRow'], 'invalid_request');
      if (!['local', 'remote'].includes(request.choice)) throw fault('invalid_request', '남길 구성을 선택하세요.');
      requireRevision(request.expectedLocalRevision);
      const row = request.remoteRow === null ? null : compositionRow(request.remoteRow, workspaceId);
      const result = await transaction(['bundles', 'meta'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const source = await compositionSource(meta, workspaceId, binding, bundle);
        const state = await workbenchValue(meta, workspaceId);
        const sync = authorizedComposition(await readCompositionState(meta, workspaceId, state), binding);
        if (sync.conflict?.missing) throw fault('remote_missing', '삭제된 서버 구성을 자동 재생성하지 않습니다. 백업을 보관하거나 연결을 중지하세요.');
        if (!sync.conflict || !row || request.expectedLocalRevision !== state.revision ||
            sync.conflict.localRevision !== state.revision || row.revision !== sync.conflict.remoteRevision ||
            row.source_revision !== sync.conflict.row.source_revision || stablePayload(row.data) !== stablePayload(sync.conflict.row.data)) {
          throw fault('composition_conflict_changed', '비교한 구성이 바뀌었습니다. 최신 양쪽 내용을 다시 확인하세요.');
        }
        await checkCompositionRow(meta, sync, source, row);
        const recoveryId = core().id(), discarded = request.choice === 'remote' ? state : row.data;
        // Keep exact references and material together before either side is replaced. The
        // existing integrated-backup restore remaps this durable snapshot into a new copy.
        await meta.add({ key: `compositionRecovery:${workspaceId}:${recoveryId}`, value: {
          id: recoveryId, workspaceId, createdAt: new Date().toISOString(), bundle: clone(bundle), workbench: clone(discarded)
        } });
        const updated = request.choice === 'remote' ? { ...clone(row.data), revision: state.revision + 1 } : state;
        workbench().validate(updated);
        if (request.choice === 'remote') await meta.put({ key: `workbench:${workspaceId}`, value: updated });
        await saveCompositionHead(meta, row);
        sync.remoteRevision = row.revision; sync.sourceRevision = row.source_revision; sync.outbox = null; sync.conflict = null; sync.error = null;
        sync.syncedLocalRevision = request.choice === 'remote' ? updated.revision : -1;
        sync.status = request.choice === 'remote' ? 'synced' : 'pending'; sync.lastRecoveryId = recoveryId;
        return { workbench: clone(updated), metadata: await writeCompositionState(meta, sync), recoveryId };
      });
      if (request.choice === 'remote') workbenchChanged(result.workbench);
      compositionChanged(result.metadata); return result;
    }
    function compositionRecovery(value, workspaceId, id) {
      onlyFields(value, ['id', 'workspaceId', 'createdAt', 'bundle', 'workbench'], 'invalid_recovery_copy');
      if (value.id !== id || value.workspaceId !== workspaceId || typeof value.createdAt !== 'string' ||
          !Number.isFinite(Date.parse(value.createdAt)) || value.bundle?.workspaceId !== workspaceId || value.workbench?.workspaceId !== workspaceId) {
        throw fault('invalid_recovery_copy', '구성 복구 사본의 식별자를 확인할 수 없습니다.');
      }
      core().validateWorkspace(value.bundle); workbench().validate(value.workbench); return value;
    }
    async function listCompositionRecoveries(workspaceId) {
      requireId(workspaceId, '작업공간');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const prefix = `compositionRecovery:${workspaceId}:`, entries = await meta.getAll(root.IDBKeyRange.bound(prefix, prefix + '\uffff'));
        return entries.map(entry => {
          const value = compositionRecovery(entry.value, workspaceId, entry.key.slice(prefix.length));
          return { id: value.id, createdAt: value.createdAt, title: value.workbench.page.title };
        }).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      });
    }
    async function readCompositionRecovery(workspaceId, id) {
      requireId(workspaceId, '작업공간'); requireId(id, '복구 사본');
      return transaction(['bundles', 'meta'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const entry = await meta.get(`compositionRecovery:${workspaceId}:${id}`);
        if (!entry) throw fault('recovery_not_found', '구성 복구 사본을 찾을 수 없습니다.');
        return clone(compositionRecovery(entry.value, workspaceId, id));
      });
    }
    // A selected writing draft has its own CAS/receipt stream. Imports and unselected
    // drafts remain local, and the original-material stream is always a prerequisite.
    function writing() {
      const value = options.writing || root.HaedoLife?.Writing || (typeof require === 'function' ? require('./writing.js') : null);
      if (!value?.validateDraft || !value?.recoverDraft) throw fault('dependency_unavailable', '글쓰기 모듈을 불러오지 못했습니다.');
      return value;
    }
    function writingChanged(stage) {
      const event = { type: 'writing_draft_changed', workspaceId: stage.workspaceId, stageId: stage.stageId };
      notify(event); try { channel?.postMessage({ ...event, sender }); } catch (_) {}
    }
    function writingSyncChanged(state) {
      const event = { type: 'writing_sync_changed', workspaceId: state.workspaceId, stageId: state.draftId, status: state.status, enabled: state.enabled };
      notify(event); try { channel?.postMessage({ ...event, sender }); } catch (_) {}
    }
    const writingKey = (workspaceId, draftId) => `writingSync:${workspaceId}:${draftId}`;
    const writingHeadKey = (workspaceId, draftId) => `writingHead:${workspaceId}:${draftId}`;
    function writingIdentity(workspaceId, draftId) {
      requireId(workspaceId, '작업공간'); requireId(draftId, '초안');
    }
    function writingRow(input, workspaceId, draftId) {
      if (!plain(input) || !Number.isSafeInteger(input.revision) || input.revision < 1 ||
          !Number.isSafeInteger(input.source_revision) || input.source_revision < 1) throw fault('invalid_remote_snapshot', '서버 초안의 저장 버전을 확인할 수 없습니다.');
      const row = clone(input); writing().validateDraft(row.data);
      if (row.workspace_id !== workspaceId || row.draft_id !== draftId || row.data.workspaceId !== workspaceId || row.data.stageId !== draftId ||
          row.data.revision < 1 || (row.data.state === 'applied' && !row.data.appliedResult)) throw fault('invalid_remote_snapshot', '서버 초안의 식별자 또는 보관 결과가 일치하지 않습니다.');
      return { workspace_id: workspaceId, draft_id: draftId, revision: row.revision, source_revision: row.source_revision, data: row.data,
        ...(typeof row.updated_at === 'string' ? { updated_at: row.updated_at } : {}) };
    }
    function writingStatus(sync, stage) {
      return sync.conflict ? 'conflict' : sync.outbox || stage.revision !== sync.syncedLocalRevision ? 'pending' : 'synced';
    }
    function validateWritingState(sync, workspaceId, draftId) {
      try {
        onlyFields(sync, ['format', 'workspaceId', 'draftId', 'binding', 'enabled', 'remoteRevision', 'sourceRevision', 'syncedLocalRevision', 'outbox', 'conflict', 'status', 'error']);
        if (sync.format !== 'life-writing-sync-v1' || sync.workspaceId !== workspaceId || sync.draftId !== draftId || typeof sync.enabled !== 'boolean' ||
            !['pending', 'synced', 'conflict', 'error'].includes(sync.status) || !Number.isSafeInteger(sync.syncedLocalRevision) || sync.syncedLocalRevision < -1) throw new Error('metadata');
        if (stablePayload(bindingValue(sync.binding, workspaceId)) !== stablePayload(sync.binding)) throw new Error('binding');
        requireRevision(sync.remoteRevision); requireRevision(sync.sourceRevision);
        if ((sync.remoteRevision === 0) !== (sync.sourceRevision === 0)) throw new Error('floor');
        if (sync.outbox !== null) {
          const box = sync.outbox; onlyFields(box, ['operationId', 'expectedRevision', 'sourceRevision', 'localRevision', 'data']);
          requireId(box.operationId, '전송 작업'); requireRevision(box.expectedRevision); requireRevision(box.localRevision); requireRevision(box.sourceRevision);
          writing().validateDraft(box.data);
          if (box.data.workspaceId !== workspaceId || box.data.stageId !== draftId || box.data.revision !== box.localRevision ||
              box.expectedRevision !== sync.remoteRevision || box.sourceRevision < Math.max(1, sync.sourceRevision) ||
              box.localRevision <= sync.syncedLocalRevision || (box.data.state === 'applied' && !box.data.appliedResult)) throw new Error('outbox');
        }
        if (sync.conflict !== null) {
          const conflict = sync.conflict; onlyFields(conflict, ['missing', 'row', 'remoteRevision', 'localRevision']);
          requireRevision(conflict.remoteRevision); requireRevision(conflict.localRevision);
          if (typeof conflict.missing !== 'boolean' || conflict.remoteRevision < sync.remoteRevision) throw new Error('conflict');
          if (conflict.missing) { if (conflict.row !== null) throw new Error('missing'); }
          else {
            const row = writingRow(conflict.row, workspaceId, draftId);
            if (row.revision !== conflict.remoteRevision || row.source_revision < sync.sourceRevision) throw new Error('conflict');
          }
        }
        if (sync.error !== null) {
          onlyFields(sync.error, ['code', 'message']);
          if (typeof sync.error.code !== 'string' || !/^[a-z0-9_]{1,80}$/.test(sync.error.code) || typeof sync.error.message !== 'string' || sync.error.message.length > 1000) throw new Error('error');
        }
        if ((sync.status === 'conflict') !== (sync.conflict !== null) || (sync.status === 'synced' && (sync.outbox || sync.error || sync.syncedLocalRevision < 0)) ||
            (sync.status === 'error' && !sync.error) || (sync.status === 'pending' && sync.error) || (sync.remoteRevision === 0 && sync.syncedLocalRevision !== -1)) throw new Error('consistency');
      } catch (_) { throw fault('invalid_writing_metadata', '초안 이어쓰기 정보를 확인할 수 없습니다. 입력은 보존했습니다.'); }
      return sync;
    }
    async function writingStage(stages, workspaceId, draftId) {
      const stage = await stages.get(draftId);
      if (!stage || stage.workspaceId !== workspaceId || stage.kind !== 'writing') throw fault('writing_draft_not_found', '이 작업공간의 글쓰기 초안을 찾을 수 없습니다.');
      writing().validateDraft(stage); return stage;
    }
    async function readWritingState(meta, workspaceId, draftId, stage) {
      await assertOwner(meta, workspaceId);
      const entry = await meta.get(writingKey(workspaceId, draftId)); if (entry === undefined) return null;
      const sync = validateWritingState(entry.value, workspaceId, draftId);
      if (account && !sameAccount(account, sync.binding)) throw fault('account_mismatch', '현재 계정과 초안 연결 정보가 다릅니다.');
      if (stage && (sync.syncedLocalRevision > stage.revision || sync.outbox?.localRevision > stage.revision || sync.conflict?.localRevision > stage.revision ||
          (sync.status === 'synced' && stage.revision !== sync.syncedLocalRevision))) throw fault('invalid_writing_metadata', '초안의 저장 기준이 일치하지 않습니다. 입력은 보존했습니다.');
      const head = await meta.get(writingHeadKey(workspaceId, draftId));
      if (sync.remoteRevision > 0) {
        if (!head) throw fault('invalid_writing_metadata', '초안의 서버 비교 기준을 찾을 수 없습니다.');
        const row = writingRow(head.value, workspaceId, draftId);
        if (row.revision !== sync.remoteRevision || row.source_revision !== sync.sourceRevision ||
            (stage && stage.revision === sync.syncedLocalRevision && stablePayload({ ...row.data, revision: stage.revision }) !== stablePayload(stage))) throw fault('invalid_writing_metadata', '초안의 서버 비교 기준이 일치하지 않습니다.');
      } else if (head) throw fault('invalid_writing_metadata', '연결되지 않은 초안에 서버 비교 기준이 있습니다.');
      return sync;
    }
    async function writeWritingState(meta, sync) {
      if (account && !sameAccount(account, sync.binding)) throw fault('account_mismatch', '현재 계정과 초안 연결 정보가 다릅니다.');
      validateWritingState(sync, sync.workspaceId, sync.draftId);
      await meta.put({ key: writingKey(sync.workspaceId, sync.draftId), value: sync }); return clone(sync);
    }
    function authorizedWriting(sync, binding, enabled = true) {
      if (account && !sameAccount(account, binding)) throw fault('account_mismatch', '현재 계정과 초안 연결 정보가 다릅니다.');
      if (!sync) throw fault('writing_not_configured', '이 초안의 이어쓰기를 먼저 시작하세요.');
      if (stablePayload(sync.binding) !== stablePayload(binding)) throw fault('account_mismatch', '다른 계정에 연결된 초안입니다.');
      if (enabled && !sync.enabled) throw fault('writing_paused', '초안 이어쓰기가 중지되어 있습니다.'); return sync;
    }
    async function writingSource(meta, workspaceId, binding, bundle, ready = true) {
      try { return await compositionSource(meta, workspaceId, binding, bundle, ready); }
      catch (error) { if (error.code === 'composition_source_pending') throw fault('writing_source_pending', '원문 동기화를 먼저 완료해 주세요. 초안은 이 기기에 보존했습니다.'); throw error; }
    }
    function checkWritingApplied(stage, bundle) {
      if (stage.state !== 'applied') return;
      if (!stage.appliedResult) throw fault('invalid_remote_snapshot', '보관을 마친 초안의 원문 연결을 확인할 수 없습니다.');
      const ref = stage.appliedResult, source = bundle.sources.find(value => value.id === ref.sourceId),
        version = bundle.sourceVersions.find(value => value.id === ref.sourceVersionId && value.sourceId === ref.sourceId);
      if (!source || !version || !writing().isOwnSource(source, bundle) || version.contentText !== stage.text) {
        throw fault('writing_source_pending', '보관된 초안과 정확히 일치하는 원문 버전을 먼저 받아 주세요. 입력은 보존했습니다.');
      }
    }
    async function checkWritingRow(meta, sync, source, row, bundle) {
      if (row.revision < revisionFloor(sync) || row.source_revision < Math.max(sync.sourceRevision, sync.conflict?.row?.source_revision || 0)) throw fault('stale_sync_result', '더 최신 초안 또는 원문 기준을 이미 확인했습니다.');
      if (row.source_revision > source.remoteRevision) throw fault('writing_source_pending', '이 초안에서 참조하는 원문을 먼저 받아 주세요.');
      checkWritingApplied(row.data, bundle);
      const known = row.revision === sync.remoteRevision ? (await meta.get(writingHeadKey(sync.workspaceId, sync.draftId)))?.value : row.revision === sync.conflict?.remoteRevision ? sync.conflict.row : null;
      if (known && (row.source_revision !== known.source_revision || stablePayload(row.data) !== stablePayload(known.data))) throw fault('remote_revision_mismatch', '같은 서버 버전의 초안 내용이 달라졌습니다. 입력은 보존했습니다.');
    }
    async function saveWritingHead(meta, row) {
      await meta.put({ key: writingHeadKey(row.workspace_id, row.draft_id), value: clone(row) });
    }
    function freshWritingState(workspaceId, draftId, binding) {
      return { format: 'life-writing-sync-v1', workspaceId, draftId, binding, enabled: true, remoteRevision: 0, sourceRevision: 0,
        syncedLocalRevision: -1, outbox: null, conflict: null, status: 'pending', error: null };
    }
    async function getWritingSyncState(workspaceId, draftId) {
      writingIdentity(workspaceId, draftId);
      return transaction(['bundles', 'staging'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const stage = await writingStage(tx.objectStore('staging'), workspaceId, draftId);
        return clone(await readWritingState(meta, workspaceId, draftId, stage));
      });
    }
    async function readWritingSnapshot(workspaceId, draftId) {
      writingIdentity(workspaceId, draftId);
      return transaction(['bundles', 'staging'], 'readonly', async tx => ({
        bundle: clone(await checkedBundle(tx.objectStore('bundles'), workspaceId, tx.objectStore('meta'))),
        stage: clone(await writingStage(tx.objectStore('staging'), workspaceId, draftId))
      }));
    }
    async function listWritingSyncStates(workspaceId) {
      requireId(workspaceId, '작업공간');
      return transaction(['bundles', 'staging'], 'readonly', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const prefix = `writingSync:${workspaceId}:`, entries = await meta.getAll(root.IDBKeyRange.bound(prefix, prefix + '\uffff')), result = [];
        for (const entry of entries) {
          const draftId = entry.key.slice(prefix.length), stage = await writingStage(tx.objectStore('staging'), workspaceId, draftId);
          result.push(await readWritingState(meta, workspaceId, draftId, stage));
        }
        return clone(result);
      });
    }
    async function bindWritingSync(workspaceId, draftId, input) {
      writingIdentity(workspaceId, draftId); const binding = bindingValue(input, workspaceId);
      const result = await transaction(['bundles', 'staging'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        await writingSource(meta, workspaceId, binding, bundle);
        const stage = await writingStage(tx.objectStore('staging'), workspaceId, draftId); checkWritingApplied(stage, bundle);
        const previous = await readWritingState(meta, workspaceId, draftId, stage), sync = previous ? authorizedWriting(previous, binding, false) : freshWritingState(workspaceId, draftId, binding);
        sync.enabled = true; sync.error = null; sync.status = writingStatus(sync, stage); return writeWritingState(meta, sync);
      }); writingSyncChanged(result); return result;
    }
    async function pauseWritingSync(workspaceId, draftId, input) {
      writingIdentity(workspaceId, draftId); const binding = bindingValue(input, workspaceId);
      const result = await transaction(['bundles', 'staging'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'); await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        const stage = await writingStage(tx.objectStore('staging'), workspaceId, draftId), previous = await readWritingState(meta, workspaceId, draftId, stage);
        if (!previous) return null;
        const sync = authorizedWriting(previous, binding, false); sync.enabled = false; return writeWritingState(meta, sync);
      }); if (result) writingSyncChanged(result); return result;
    }
    async function prepareWritingUpload(workspaceId, draftId, input) {
      const binding = bindingValue(input, workspaceId); let event;
      const result = await transaction(['bundles', 'staging'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta), source = await writingSource(meta, workspaceId, binding, bundle);
        const stage = await writingStage(tx.objectStore('staging'), workspaceId, draftId), sync = authorizedWriting(await readWritingState(meta, workspaceId, draftId, stage), binding);
        if (sync.conflict) throw fault('writing_conflict', '다른 기기의 초안을 먼저 비교해 주세요.');
        checkWritingApplied(stage, bundle);
        if (sync.outbox) {
          if (sync.outbox.sourceRevision > source.remoteRevision) throw fault('writing_source_pending', '전송 대기 초안의 원문을 먼저 받아 주세요.');
          checkWritingApplied(sync.outbox.data, bundle); return clone(sync.outbox);
        }
        if (stage.revision === sync.syncedLocalRevision) return null;
        if (source.remoteRevision < sync.sourceRevision) throw fault('stale_sync_result', '초안이 참조한 원문보다 이전 자료입니다.');
        sync.outbox = { operationId: core().id(), expectedRevision: sync.remoteRevision, sourceRevision: source.remoteRevision, localRevision: stage.revision, data: clone(stage) };
        sync.error = null; sync.status = 'pending'; event = await writeWritingState(meta, sync); return clone(sync.outbox);
      }); if (event) writingSyncChanged(event); return result;
    }
    async function ackWritingSync(workspaceId, draftId, input, operationId, remoteRevision) {
      const binding = bindingValue(input, workspaceId); requireId(operationId, '전송 작업'); requireRevision(remoteRevision);
      const result = await transaction(['bundles', 'staging'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta), source = await writingSource(meta, workspaceId, binding, bundle);
        const stage = await writingStage(tx.objectStore('staging'), workspaceId, draftId), sync = authorizedWriting(await readWritingState(meta, workspaceId, draftId, stage), binding), box = sync.outbox;
        if (!box || box.operationId !== operationId || sync.conflict || remoteRevision !== box.expectedRevision + 1 || remoteRevision < revisionFloor(sync) || box.sourceRevision > source.remoteRevision) throw fault('stale_sync_result', '현재 초안 전송 작업과 다른 응답입니다.');
        checkWritingApplied(stage, bundle); checkWritingApplied(box.data, bundle);
        await saveWritingHead(meta, { workspace_id: workspaceId, draft_id: draftId, revision: remoteRevision, source_revision: box.sourceRevision, data: box.data });
        sync.remoteRevision = remoteRevision; sync.sourceRevision = box.sourceRevision; sync.syncedLocalRevision = box.localRevision;
        sync.outbox = null; sync.error = null; sync.status = writingStatus(sync, stage); return writeWritingState(meta, sync);
      }); writingSyncChanged(result); return result;
    }
    async function applyWritingRemote(workspaceId, draftId, input, inputRow) {
      const binding = bindingValue(input, workspaceId), row = writingRow(inputRow, workspaceId, draftId); let event, updated;
      const result = await transaction(['bundles', 'staging'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta), source = await writingSource(meta, workspaceId, binding, bundle);
        const stages = tx.objectStore('staging'), stage = await writingStage(stages, workspaceId, draftId), sync = authorizedWriting(await readWritingState(meta, workspaceId, draftId, stage), binding);
        checkWritingApplied(stage, bundle); await checkWritingRow(meta, sync, source, row, bundle);
        if (row.revision === sync.remoteRevision && !sync.conflict) return { status: 'stored', revision: stage.revision };
        if (stage.state === 'applied' || sync.outbox || sync.conflict || stage.revision !== sync.syncedLocalRevision) {
          sync.conflict = { missing: false, row, remoteRevision: row.revision, localRevision: stage.revision }; sync.status = 'conflict'; sync.error = null;
          event = await writeWritingState(meta, sync); return { status: 'conflict', revision: stage.revision };
        }
        updated = { ...clone(row.data), revision: stage.revision + 1 }; writing().validateDraft(updated);
        await stages.put(updated); await saveWritingHead(meta, row);
        sync.remoteRevision = row.revision; sync.sourceRevision = row.source_revision; sync.syncedLocalRevision = updated.revision;
        sync.error = null; sync.status = 'synced'; event = await writeWritingState(meta, sync); return { status: 'stored', revision: updated.revision };
      }); if (updated) writingChanged(updated); if (event) writingSyncChanged(event); return result;
    }
    async function installWritingRemote(workspaceId, input, inputRow) {
      const binding = bindingValue(input, workspaceId), row = writingRow(inputRow, workspaceId, inputRow?.draft_id), draftId = row.draft_id;
      const result = await transaction(['bundles', 'staging'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta), source = await writingSource(meta, workspaceId, binding, bundle);
        const stages = tx.objectStore('staging');
        if (await stages.get(draftId) || await meta.get(writingKey(workspaceId, draftId)) || await meta.get(writingHeadKey(workspaceId, draftId))) throw fault('writing_draft_exists', '이 초안이 이미 있습니다. 양쪽 내용을 비교해 주세요.');
        const sync = freshWritingState(workspaceId, draftId, binding); await checkWritingRow(meta, sync, source, row, bundle);
        const stage = { ...clone(row.data), revision: 1 }; await stages.add(stage); await saveWritingHead(meta, row);
        Object.assign(sync, { remoteRevision: row.revision, sourceRevision: row.source_revision, syncedLocalRevision: 1, status: 'synced' });
        return { stage: clone(stage), metadata: await writeWritingState(meta, sync) };
      }); writingChanged(result.stage); writingSyncChanged(result.metadata); return result;
    }
    async function setWritingConflict(workspaceId, draftId, input, inputRow) {
      const binding = bindingValue(input, workspaceId), row = inputRow === null ? null : writingRow(inputRow, workspaceId, draftId);
      const result = await transaction(['bundles', 'staging'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta), source = await writingSource(meta, workspaceId, binding, bundle);
        const stage = await writingStage(tx.objectStore('staging'), workspaceId, draftId), sync = authorizedWriting(await readWritingState(meta, workspaceId, draftId, stage), binding);
        checkWritingApplied(stage, bundle); if (row) await checkWritingRow(meta, sync, source, row, bundle);
        sync.conflict = { missing: row === null, row, remoteRevision: row?.revision ?? revisionFloor(sync), localRevision: stage.revision };
        sync.error = null; sync.status = 'conflict'; return writeWritingState(meta, sync);
      }); writingSyncChanged(result); return result;
    }
    async function setWritingError(workspaceId, draftId, input, inputError) {
      const binding = bindingValue(input, workspaceId), error = clone(inputError);
      if (error !== null) {
        onlyFields(error, ['code', 'message'], 'invalid_request');
        if (typeof error.code !== 'string' || !/^[a-z0-9_]{1,80}$/.test(error.code) || typeof error.message !== 'string' || error.message.length > 1000) throw fault('invalid_request', '정제된 초안 오류 정보가 필요합니다.');
      }
      const result = await transaction(['bundles', 'staging'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta);
        await writingSource(meta, workspaceId, binding, bundle, false);
        const stage = await writingStage(tx.objectStore('staging'), workspaceId, draftId), sync = authorizedWriting(await readWritingState(meta, workspaceId, draftId, stage), binding);
        sync.error = error; sync.status = error === null ? writingStatus(sync, stage) : sync.conflict ? 'conflict' : 'error'; return writeWritingState(meta, sync);
      }); writingSyncChanged(result); return result;
    }
    async function resolveWritingSync(workspaceId, draftId, input, resolution) {
      const binding = bindingValue(input, workspaceId), request = clone(resolution);
      onlyFields(request, ['choice', 'expectedLocalRevision', 'remoteRow'], 'invalid_request'); requireRevision(request.expectedLocalRevision);
      if (!['local', 'remote', 'fork'].includes(request.choice)) throw fault('invalid_request', '남길 초안을 선택하세요.');
      const row = request.remoteRow === null ? null : writingRow(request.remoteRow, workspaceId, draftId); let recovered;
      const result = await transaction(['bundles', 'staging'], 'readwrite', async tx => {
        const meta = tx.objectStore('meta'), bundle = await checkedBundle(tx.objectStore('bundles'), workspaceId, meta), source = await writingSource(meta, workspaceId, binding, bundle);
        const stages = tx.objectStore('staging'), stage = await writingStage(stages, workspaceId, draftId), sync = authorizedWriting(await readWritingState(meta, workspaceId, draftId, stage), binding);
        if (sync.conflict?.missing) throw fault('remote_missing', '삭제된 서버 초안을 자동 재생성하지 않습니다. 입력을 내보내거나 연결을 중지하세요.');
        if (!sync.conflict || !row || request.expectedLocalRevision !== stage.revision || sync.conflict.localRevision !== stage.revision ||
            row.revision !== sync.conflict.remoteRevision || row.source_revision !== sync.conflict.row.source_revision || stablePayload(row.data) !== stablePayload(sync.conflict.row.data)) throw fault('writing_conflict_changed', '비교한 초안이 바뀌었습니다. 최신 양쪽 내용을 다시 확인하세요.');
        checkWritingApplied(stage, bundle); await checkWritingRow(meta, sync, source, row, bundle);
        const terminal = stage.state === 'applied' || row.data.state === 'applied';
        if (terminal !== (request.choice === 'fork')) throw fault('writing_conflict', terminal ? '보관한 글은 유지하고 다른 입력을 새 초안으로 남겨 주세요.' : '남길 초안을 선택해 주세요.');
        const useRemote = terminal ? row.data.state === 'applied' : request.choice === 'remote';
        const loser = clone(useRemote ? stage : row.data);
        if (terminal) {
          loser.state = 'draft'; delete loser.appliedResult; delete loser.baseChanged;
          Object.assign(loser, { sourceId: null, baseSourceRevision: null, baseSourceVersionId: null });
        }
        recovered = { ...writing().recoverDraft(loser), revision: 1 };
        await stages.add(recovered);
        const updated = useRemote ? { ...clone(row.data), revision: stage.revision + 1 } : stage;
        writing().validateDraft(updated); if (useRemote) await stages.put(updated);
        await saveWritingHead(meta, row);
        Object.assign(sync, { remoteRevision: row.revision, sourceRevision: row.source_revision, syncedLocalRevision: useRemote ? updated.revision : -1,
          outbox: null, conflict: null, error: null, status: useRemote ? 'synced' : 'pending' });
        return { stage: clone(updated), metadata: await writeWritingState(meta, sync), recoveryStageId: recovered.stageId };
      }); writingChanged(recovered); writingChanged(result.stage); writingSyncChanged(result.metadata); return result;
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
    const sourceEdit = () => {
      const value = options.sourceEdit || root.HaedoLife?.SourceEdit || (typeof require === 'function' && require('./source-edit.js'));
      if (!value?.validate || !value?.checkPrepared) throw fault('dependency_unavailable', '자료 수정 모듈을 불러오지 못했습니다.');
      return value;
    };
    function validateStage(stage) {
      if (!plain(stage)) throw fault('invalid_stage', '가져오기 초안을 확인하세요.');
      if (stage.kind === 'source-edit') sourceEdit().validate(stage);
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
      let event;
      const result = await transaction(['staging', 'bundles'], 'readwrite', async tx => {
        await checkedBundle(tx.objectStore('bundles'), stage.workspaceId, tx.objectStore('meta'));
        const stages = tx.objectStore('staging');
        const previous = await stages.get(stage.stageId);
        if (previous ? previous.workspaceId !== stage.workspaceId || previous.revision !== stage.revision || previous.state !== 'draft' : stage.revision !== 0) {
          throw fault('stage_conflict', '다른 탭에서 가져오기 초안을 바꿨습니다. 이전 입력을 보존하고 다시 확인하세요.');
        }
        if (previous && previous.kind !== stage.kind) {
          throw fault('stage_conflict', '기존 초안의 종류를 바꿀 수 없습니다. 입력은 보존했습니다.');
        }
        const now = new Date().toISOString();
        const saved = { ...stage, revision: stage.revision + 1, createdAt: previous?.createdAt || now, updatedAt: now };
        if (stage.kind === 'writing') {
          const sync = await readWritingState(tx.objectStore('meta'), stage.workspaceId, stage.stageId, previous);
          if (sync) {
            if (!previous) throw fault('invalid_writing_metadata', '연결된 초안을 찾을 수 없습니다. 같은 식별자로 다시 만들지 않습니다.');
            sync.error = null; sync.status = writingStatus(sync, saved); event = await writeWritingState(tx.objectStore('meta'), sync);
          }
        }
        await stages.put(saved);
        return clone(saved);
      });
      if (stage.kind === 'writing') writingChanged(result); if (event) writingSyncChanged(event); return result;
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
        if (stage.kind === 'writing' && await readWritingState(tx.objectStore('meta'), stage.workspaceId, stageId, stage)) {
          throw fault('writing_selected', '이어쓰기로 연결한 초안은 삭제할 수 없습니다. 입력을 보존했습니다.');
        }
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
        if (stage.kind === 'source-edit') {
          const sourceRow = source.bundle.sources.find(item => item.id === stage.baseSourceId);
          const baseVersion = source.bundle.sourceVersions.find(item => item.id === stage.baseSourceVersionId && item.sourceId === stage.baseSourceId);
          const head = source.bundle.sourceVersions.findLast(item => item.sourceId === stage.baseSourceId);
          if (!sourceRow || !baseVersion || !head || stage.restoreVersionId !== null && !versionIds.has(stage.restoreVersionId)) {
            throw fault('invalid_stage', '수정 초안의 원문을 확인할 수 없습니다. 이전 자료와 입력은 보존했습니다.');
          }
          result.baseSourceId = sourceIds.get(stage.baseSourceId);
          result.baseSourceVersionId = versionIds.get(stage.baseSourceVersionId);
          result.baseSourceRevision = copy.sources.find(item => item.id === result.baseSourceId).revision;
          result.restoreVersionId = stage.restoreVersionId === null ? null : versionIds.get(stage.restoreVersionId);
          result.lifecycleRevision = core().sourceState(copy, result.baseSourceId).revision;
          if (stage.baseChanged || sourceRow.revision !== stage.baseSourceRevision || head.id !== stage.baseSourceVersionId ||
              baseVersion.contentHash !== stage.baseHash || core().sourceState(source.bundle, stage.baseSourceId).revision !== stage.lifecycleRevision) {
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
      listWorkspaces, read, createWorkspace, installWorkspace, installWorkspaces, getActive, setActive,
      readReadingPosition, saveReadingPosition, clearReadingPosition,
      readAnnualPlan, saveAnnualPlan,
      readSourceFolders, readSourceFoldersSnapshot, saveSourceFolders, readLibraryBackupSnapshot, installLibraryCopy,
      readInterestProfile, saveInterestProfile,
      readDiscoveryProfile, saveDiscoveryProfile,
      readDiscoverySettings, saveDiscoverySettings,
      readDiscoveryLanguageSettings, saveDiscoveryLanguageSettings,
      readDiscoveryActions, saveDiscoveryActions,
      readDiscoveryReading, saveDiscoveryReading,
      readCollection, saveCollection, readNineBoard, saveNineBoard, saveNineBoardCopy, readMaterialWriting, saveMaterialWriting, createMaterialWritingPost, readBlogSeries, saveBlogSeries, readBlogSeriesSnapshot, installBlogSeriesCopy, listPhotoPosts, readPhotoPost, savePhotoPost, readPostEvidence, savePostEvidence, savePhotoPostWithEvidence, savePhotoPostFromNineBoard, savePhotoPostFromNaverCapture, listBlogCopies, installReceivedBlogPost, readBlogSyncState, writeBlogSyncState, readPageDrafts, savePageDrafts, savePagePost,

      scanLocalPosts, readLocalPostCandidate,
      readMaterialContinuitySnapshot, readMaterialContinuityState, writeMaterialContinuityState, findMaterialContinuity, installMaterialContinuity, finishMaterialContinuityClaim,
      readPublicCover, savePublicCover,
      readWorkbench, saveWorkbench, readWorkbenchSnapshot, installWorkbenchCopy,
      readPreservationCatalog, readPreservationSnapshot, installPreservationCopy, commitNaverCapture, readNaverCapture, installNaverCaptureCopy,
      commitLocal, readAccountMaterialRegistration, saveStage, getStage, listStages, deleteStage, subscribe,
      getSyncState, bindSync, pauseSync, prepareSyncUpload, ackSync, applySyncRemote, installSyncRemote,
      setSyncConflict, setSyncError, resolveSync,
      getCompositionState, bindCompositionSync, pauseCompositionSync, prepareCompositionUpload, ackCompositionSync,
      applyCompositionRemote, setCompositionConflict, setCompositionError, resolveCompositionSync,
      listCompositionRecoveries, readCompositionRecovery,
      getWritingSyncState, readWritingSnapshot, listWritingSyncStates, bindWritingSync, pauseWritingSync, prepareWritingUpload, ackWritingSync,
      applyWritingRemote, installWritingRemote, setWritingConflict, setWritingError, resolveWritingSync,
      listUnownedWorkspaces, importUnownedWorkspace };
    if (!account) Object.assign(api, { forAccount, clearAccount });
    return Object.freeze(api);
  }

  root.HaedoLife ||= {};
  root.HaedoLife.Storage = createStorage();
  if (typeof module !== 'undefined' && module.exports) module.exports = { createStorage };
})(globalThis);

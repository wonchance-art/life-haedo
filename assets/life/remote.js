/* New life-workspace transport. The legacy chart connection/session is never read. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  root.HaedoLife = root.HaedoLife || {};
  root.HaedoLife.Remote = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const CONFIG_KEY = 'life_tools_sync_config_v1';
  const SESSION_PREFIX = 'life_tools_sync_auth_v1:';
  const MAX_BYTES = 16 * 1024 * 1024;
  const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  class RemoteFault extends Error {
    constructor(code, message) { super(message); this.name = 'LifeRemoteError'; this.code = code; }
  }
  const fault = (code, message) => new RemoteFault(code, message);
  function config(input) {
    let url;
    try { url = new URL(input?.url); } catch (_) { throw fault('invalid_config', 'HTTPS 프로젝트 URL을 확인해주세요.'); }
    if (url.protocol !== 'https:' || url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
      throw fault('invalid_config', '사용자 정보·경로·쿼리가 없는 HTTPS 프로젝트 URL이 필요합니다.');
    }
    const key = typeof input?.key === 'string' ? input.key.trim() : '';
    if (/^sb_secret_/i.test(key)) throw fault('secret_key_rejected', '서버 전용 키는 사용할 수 없습니다. publishable 또는 anon 공개 키를 사용해주세요.');
    if (!/^sb_publishable_.+/.test(key)) {
      let payload;
      try {
        const parts = key.split('.');
        if (parts.length !== 3 || !parts.every(Boolean)) throw new Error();
        const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
        payload = JSON.parse(root.atob(padded));
      } catch (_) { throw fault('invalid_config', 'publishable 또는 anon 공개 키를 확인해주세요.'); }
      if (payload.role !== 'anon') throw fault('secret_key_rejected', 'anon 공개 키만 사용할 수 있습니다. 사용자 토큰·서버 전용 키를 넣지 마세요.');
    }
    return { url: url.origin, key };
  }
  function loadConfig() {
    try {
      const raw = root.localStorage?.getItem(CONFIG_KEY);
      return raw ? config(JSON.parse(raw)) : null;
    } catch (_) { throw fault('config_unavailable', '동기화 연결 설정을 읽지 못했습니다. 기존 로컬 자료는 그대로 있습니다.'); }
  }
  function saveConfig(input) {
    const value = input === null ? null : config(input);
    try {
      if (!root.localStorage) throw new Error();
      if (value) root.localStorage.setItem(CONFIG_KEY, JSON.stringify(value));
      else root.localStorage.removeItem(CONFIG_KEY);
    } catch (_) { throw fault('config_unavailable', '동기화 연결 설정을 저장하지 못했습니다.'); }
    return value;
  }
  function cleanError(error) {
    if (error instanceof RemoteFault) return error;
    const code = error?.code;
    // Only fixed server error identifiers are inspected; raw messages are never surfaced.
    if (error?.message === 'life_operation_mismatch') return fault('operation_mismatch', '이미 전송한 작업에 다른 내용이 들어왔습니다.');
    if (code === '22001' || error?.message === 'life_snapshot_too_large') return fault('payload_too_large', '서버가 확인한 자료 크기가 16 MiB를 넘습니다. 로컬 자료는 보존됩니다.');
    if (error?.message === 'life_auth_required') return fault('auth_required', '로그인이 필요합니다. 로컬 자료는 보존됩니다.');
    if (['life_invalid_request', 'life_invalid_snapshot', 'life_invalid_title', 'life_revision_limit'].includes(error?.message)) return fault('invalid_request', '서버가 작업 형식 또는 자료 버전을 확인하지 못했습니다. 로컬 자료는 보존됩니다.');
    if (['user_not_found', 'bad_jwt', 'session_expired', 'refresh_token_not_found', 'refresh_token_already_used', 'session_not_found'].includes(code)) {
      return fault('auth_required', '로그인이 필요합니다. 로컬 자료는 이 브라우저에 남아 있습니다.');
    }
    if (['PGRST205', 'PGRST202', '42P01', '42883'].includes(code) || error?.status === 404) {
      return fault('schema_missing', '이 프로젝트에 생활 자료 동기화 저장소가 준비되지 않았습니다. 연결 도움말을 확인해주세요.');
    }
    if (error?.name === 'AbortError') return fault('request_cancelled', '연결 변경으로 이전 요청을 중단했습니다.');
    if (['invalid_credentials', 'invalid_grant'].includes(code)) return fault('auth_invalid_credentials', '이메일과 비밀번호를 확인해주세요.');
    if (error?.status === 401 || ['PGRST301', 'PGRST302', 'PGRST303'].includes(code)) {
      return fault('auth_required', '로그인이 필요합니다. 로컬 자료는 이 브라우저에 남아 있습니다.');
    }
    if (error?.status === 403 || code === '42501') return fault('permission_denied', '이 계정에 생활 자료 접근 권한이 없습니다.');
    if (['operation_mismatch', 'payload_too_large'].includes(code)) return fault(code, code === 'operation_mismatch' ? '이미 전송한 작업에 다른 내용이 들어왔습니다.' : '전송할 자료가 16 MiB를 넘습니다. 로컬 자료는 보존됩니다.');
    if (error?.name === 'TypeError' || error?.name === 'AuthRetryableFetchError') return fault('network_error', '서버에 연결하지 못했습니다. 로컬 자료는 보존됩니다.');
    return fault('remote_error', '서버 요청을 완료하지 못했습니다. 로컬 자료를 보존하고 연결 상태를 확인해주세요.');
  }
  function identifier(value) {
    if (typeof value !== 'string' || !UUID.test(value)) throw fault('invalid_request', '작업공간 또는 작업 식별자를 확인해주세요.');
  }
  function revision(value, minimum = 0) {
    if (!Number.isSafeInteger(value) || value < minimum) throw fault('invalid_remote_data', '서버 자료 버전을 확인할 수 없습니다.');
  }
  function cloneSized(value) {
    let serialized;
    try { serialized = JSON.stringify(value); } catch (_) { throw fault('invalid_remote_data', '자료를 JSON 형식으로 읽을 수 없습니다.'); }
    if (typeof serialized !== 'string') throw fault('invalid_remote_data', '자료를 확인할 수 없습니다.');
    if (serialized.length > MAX_BYTES || new TextEncoder().encode(serialized).length > MAX_BYTES) {
      throw fault('payload_too_large', '자료가 16 MiB를 넘습니다. 로컬 자료를 보존하고 범위를 나눠주세요.');
    }
    return JSON.parse(serialized);
  }
  function create(input, options = {}) {
    const connection = config(input);
    const core = options.core || root.HaedoLife?.Core;
    const factory = options.clientFactory || root.supabase?.createClient;
    if (typeof factory !== 'function' || typeof core?.validateWorkspace !== 'function') throw fault('dependency_unavailable', '동기화 모듈을 불러오지 못했습니다.');
    let disposed = false, epoch = 0, authUserId, notification = 0;
    const controllers = new Set(), listeners = new Set();
    const fetcher = options.fetch || root.fetch?.bind(root);
    function cancelPending() { epoch++; for (const controller of controllers) controller.abort(); controllers.clear(); }
    function assertAlive(expected = epoch) {
      if (disposed || expected !== epoch) throw fault('request_cancelled', '연결 변경으로 이전 요청을 중단했습니다.');
    }
    async function guardedFetch(resource, init = {}) {
      assertAlive();
      const expected = epoch, controller = new AbortController();
      const callerSignal = init.signal || resource?.signal;
      const abort = () => controller.abort();
      if (callerSignal?.aborted) abort();
      else callerSignal?.addEventListener('abort', abort, { once: true });
      controllers.add(controller);
      try {
        const response = await fetcher(resource, { ...init, signal: controller.signal });
        assertAlive(expected); return response;
      } finally { controllers.delete(controller); callerSignal?.removeEventListener('abort', abort); }
    }
    const authOptions = { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
      storageKey: SESSION_PREFIX + encodeURIComponent(connection.url) };
    let sessionStorage = options.storage;
    if (!sessionStorage) { try { sessionStorage = root.localStorage; } catch (_) {} }
    if (sessionStorage) authOptions.storage = {
      getItem: key => sessionStorage.getItem(key),
      // A disposed SDK refresh must not resurrect a session in its replacement client.
      setItem: (key, value) => disposed ? undefined : sessionStorage.setItem(key, value),
      removeItem: key => disposed ? undefined : sessionStorage.removeItem(key)
    };
    const client = factory(connection.url, connection.key, { auth: authOptions, global: { fetch: guardedFetch } });
    function account(user) {
      if (!user) return null;
      if (typeof user.id !== 'string' || !UUID.test(user.id) || (user.email !== undefined && typeof user.email !== 'string')) {
        throw fault('invalid_remote_data', '로그인 계정 정보를 확인할 수 없습니다.');
      }
      return { userId: user.id, email: user.email || '', projectUrl: connection.url };
    }
    const authSubscription = client.auth.onAuthStateChange((_event, session) => {
      let current;
      try { current = account(session?.user); } catch (_) { current = null; }
      const nextId = current?.userId || null;
      if (authUserId !== undefined && authUserId !== nextId) cancelPending();
      authUserId = nextId;
      const currentNotification = ++notification;
      // Never call SDK Auth methods while its auth-event lock is held.
      setTimeout(() => {
        if (disposed || currentNotification !== notification) return;
        for (const listener of [...listeners]) { try { listener(current && { ...current }); } catch (_) {} }
      }, 0);
    }).data.subscription;
    async function getAccount() {
      assertAlive(); const expected = epoch;
      try {
        const result = await client.auth.getUser(); assertAlive(expected);
        if (result.error?.name === 'AuthSessionMissingError') return null;
        if (result.error) throw result.error;
        return account(result.data?.user);
      } catch (error) { assertAlive(expected); throw cleanError(error); }
    }
    async function signIn(email, password) {
      assertAlive();
      if (typeof email !== 'string' || !email.trim() || email.length > 320 || typeof password !== 'string' || !password) throw fault('invalid_request', '이메일과 비밀번호를 입력해주세요.');
      cancelPending();
      try {
        const result = await client.auth.signInWithPassword({ email: email.trim(), password }); assertAlive();
        if (result.error) throw result.error;
        const current = account(result.data?.user);
        if (!current) throw fault('auth_required', '로그인 계정 확인이 필요합니다.');
        return current;
      } catch (error) { throw cleanError(error); }
    }
    async function signOut() {
      assertAlive(); cancelPending();
      try {
        const result = await client.auth.signOut({ scope: 'local' });
        if (result.error) throw result.error;
      } catch (error) { throw cleanError(error); }
    }
    async function verifyData(data) {
      const snapshot = cloneSized(data);
      try { core.validateWorkspace(snapshot); } catch (_) { throw fault('invalid_remote_data', '서버 자료의 원문·참조 형식이 올바르지 않습니다. 로컬 자료는 변경하지 않았습니다.'); }
      if (!root.crypto?.subtle) throw fault('hash_unavailable', '원문 무결성을 확인할 수 없습니다. HTTPS 환경에서 다시 열어주세요.');
      for (const version of snapshot.sourceVersions) {
        if (version.contentText === null) continue;
        const digest = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(version.contentText));
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (hash !== version.contentHash) throw fault('hash_mismatch', '서버 원문과 해시가 일치하지 않습니다. 로컬 자료는 변경하지 않았습니다.');
      }
      return snapshot;
    }
    async function authorized() { const current = await getAccount(); if (!current) throw fault('auth_required', '로그인이 필요합니다.'); return current; }
    function metadata(row) {
      identifier(row?.id); revision(row.revision, 1);
      if (typeof row.title !== 'string' || row.title.length > 2000 || typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) throw fault('invalid_remote_data', '서버 자료 목록의 형식이 올바르지 않습니다.');
      return { id: row.id, title: row.title, revision: row.revision, updated_at: row.updated_at };
    }
    async function list() {
      assertAlive(); const expected = epoch;
      try {
        await authorized(); assertAlive(expected);
        const result = await client.from('life_workspaces').select('id,title,revision,updated_at').order('updated_at', { ascending: false });
        assertAlive(expected); if (result.error) throw result.error;
        if (!Array.isArray(result.data)) throw fault('invalid_remote_data', '서버 목록을 읽을 수 없습니다.');
        cloneSized(result.data); return result.data.map(metadata);
      } catch (error) { assertAlive(expected); throw cleanError(error); }
    }
    async function read(workspaceId) {
      identifier(workspaceId); assertAlive(); const expected = epoch;
      try {
        await authorized(); assertAlive(expected);
        const result = await client.from('life_workspaces').select('id,title,revision,data,updated_at').eq('id', workspaceId).maybeSingle();
        assertAlive(expected); if (result.error) throw result.error;
        if (result.data === null) return null;
        const row = cloneSized(result.data), meta = metadata(row);
        if (meta.id !== workspaceId || row.data?.workspaceId !== workspaceId) throw fault('invalid_remote_data', '서버 작업공간 식별자가 일치하지 않습니다.');
        const data = await verifyData(row.data); assertAlive(expected);
        return { ...meta, data };
      } catch (error) { assertAlive(expected); throw cleanError(error); }
    }
    async function write(request) {
      const workspaceId = request?.workspaceId, operationId = request?.operationId, expectedRevision = request?.expectedRevision;
      identifier(workspaceId); identifier(operationId); revision(expectedRevision);
      assertAlive(); const expected = epoch;
      try {
        const data = await verifyData(request.data); assertAlive(expected);
        if (data.workspaceId !== workspaceId) throw fault('invalid_request', '전송 대상과 자료의 작업공간 식별자가 다릅니다.');
        await authorized(); assertAlive(expected);
        const result = await client.rpc('life_sync_put', { p_workspace_id: workspaceId,
          p_expected_revision: expectedRevision, p_operation_id: operationId, p_data: data });
        assertAlive(expected); if (result.error) throw result.error;
        if (result.data?.status === 'missing') return { status: 'missing' };
        if (!['stored', 'conflict'].includes(result.data?.status)) throw fault('invalid_remote_data', '서버 저장 결과를 확인할 수 없습니다.');
        revision(result.data.revision, 1);
        return { status: result.data.status, revision: result.data.revision };
      } catch (error) { assertAlive(expected); throw cleanError(error); }
    }
    function onAuthChange(listener) {
      assertAlive(); if (typeof listener !== 'function') throw fault('invalid_request', '계정 변경 알림을 확인해주세요.');
      listeners.add(listener); return () => listeners.delete(listener);
    }
    function dispose() {
      if (disposed) return;
      disposed = true; cancelPending(); listeners.clear(); authSubscription.unsubscribe();
      const cleanup = typeof client.auth.dispose === 'function' ? client.auth.dispose() : client.auth.stopAutoRefresh();
      Promise.resolve(cleanup).catch(() => {});
    }
    return Object.freeze({ getAccount, signIn, signOut, onAuthChange, list, read, write, dispose });
  }
  return Object.freeze({ create, loadConfig, saveConfig, MAX_BYTES, CONFIG_KEY, SESSION_PREFIX });
});

/* Verified account library capability/catalog and metadata transport. No source
 * writes or publication: existing Core/Composition transports retain ownership. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).LibraryRemote = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const MAX_BYTES = 8 * 1024 * 1024, UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  const messages = {
    auth_required: '로그인 계정을 다시 확인해 주세요.', request_cancelled: '계정 또는 연결이 바뀌어 이전 요청을 중단했습니다.',
    schema_missing: '서버의 계정 자료 보관 기능을 확인해 주세요. 저장 대기 자료는 유지됩니다.',
    invalid_remote_data: '서버 자료실 정보의 형식을 확인하지 못했습니다. 기존 자료는 유지됩니다.',
    invalid_request: '자료실 전송의 버전과 형식을 확인해 주세요.', operation_mismatch: '이전 전송 작업과 내용이 달라 적용하지 않았습니다.',
    composition_source_pending: '원문 저장이 완료되면 자료실 분류를 이어서 저장합니다.',
    payload_too_large: '자료실 분류 정보의 전송 한도를 넘었습니다. 기존 자료는 유지됩니다.',
    permission_denied: '현재 계정으로 자료실 정보에 접근하지 못했습니다.', network_error: '연결을 확인해 주세요. 전송 대기 자료는 유지됩니다.',
    remote_missing: '연결된 계정 자료를 찾을 수 없습니다. 자동으로 다시 만들지 않았습니다.',
    not_enabled: '계정 자료 연결을 준비하고 있습니다.', sync_paused: '자료실 정보 전송이 중지되어 있습니다.',
    account_mismatch: '현재 계정의 자료실 연결을 확인해 주세요.', composition_conflict_changed: '비교 후 분류가 바뀌었습니다. 다시 확인해 주세요.',
    stale_sync_result: '더 최신 서버 상태가 있습니다. 현재 자료는 유지했습니다.', remote_revision_mismatch: '같은 서버 버전의 내용이 달라 적용하지 않았습니다.'
  };
  const fault = code => Object.assign(new Error(messages[code] || messages.network_error), { code });
  const id = value => typeof value === 'string' && UUID.test(value);
  const revision = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
  const check = (value, code = 'invalid_remote_data') => { if (!value) throw fault(code); };
  function fields(value, keys) {
    check(value && typeof value === 'object' && !Array.isArray(value) && [null, Object.prototype].includes(Object.getPrototypeOf(value)));
    const own = Reflect.ownKeys(value);
    check(own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key) &&
      Object.getOwnPropertyDescriptor(value, key)?.enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')));
  }
  function clean(error) {
    if (messages[error?.code]) return fault(error.code);
    if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error?.code) || error?.status === 404) return fault('schema_missing');
    const message = error?.message;
    if (['life_library_source_not_ready', 'life_composition_source_not_ready'].includes(message)) return fault('composition_source_pending');
    if (['life_library_operation_mismatch', 'life_operation_mismatch'].includes(message)) return fault('operation_mismatch');
    if (error?.code === '22001' || ['life_library_meta_too_large', 'library_meta_too_large', 'collection_limit', 'source_folders_too_large'].includes(error?.code) || message === 'life_library_meta_too_large') return fault('payload_too_large');
    if (message === 'life_library_auth_required' || error?.status === 401 || error?.name === 'AuthSessionMissingError') return fault('auth_required');
    if (error?.name === 'AbortError') return fault('request_cancelled');
    if (error?.code === '42501' || error?.status === 403) return fault('permission_denied');
    if (['22023', '22003'].includes(error?.code)) return fault('invalid_request');
    return fault('network_error');
  }
  function create({ auth = root.HaedoAuth, metadata = root.HaedoLife?.LibraryMeta,
    clientFactory = root.HaedoLife?.PlatformRemote?.clientFactory } = {}) {
    metadata ||= typeof require === 'function' && require('./library-meta.js');
    check(auth?.ready && metadata?.validate && clientFactory, 'auth_required');
    const owner = auth.getAccount?.()?.userId || auth.user?.id, project = auth.config.url;
    check(id(owner), 'auth_required');
    const client = clientFactory(auth, { scope: 'library' })(auth.config.url, auth.config.key);
    let disposed = false;
    function alive(context) {
      check(!disposed, 'request_cancelled');
      if (context) check(context.authEpoch === auth.epoch && auth.config.url === project &&
        (auth.getAccount?.()?.userId || auth.user?.id) === owner && (!auth.getAccount || auth.getAccount()?.projectUrl === project), 'request_cancelled');
    }
    function context() { alive(); const value = { authEpoch: auth.epoch }; alive(value); return value; }
    async function authorize(ctx) {
      alive(ctx); const result = await client.auth.getUser(); alive(ctx);
      check(!result.error && result.data?.user?.id === owner, 'auth_required');
    }
    async function rpc(ctx, name, params) {
      await authorize(ctx); const result = await client.rpc(name, params); alive(ctx);
      if (result.error) throw result.error;
      return result.data;
    }
    function data(value, workspaceId) {
      try {
        metadata.validate(value); check(value.workspaceId === workspaceId);
        check(new TextEncoder().encode(JSON.stringify(value)).length <= MAX_BYTES, 'payload_too_large');
        return structuredClone(value);
      } catch (error) { throw fault(['library_meta_too_large', 'source_folders_too_large', 'collection_limit', 'payload_too_large'].includes(error?.code) ? 'payload_too_large' : 'invalid_remote_data'); }
    }
    async function perform(action) {
      const ctx = context();
      try { return await action(ctx); } catch (error) { alive(ctx); throw clean(error); }
    }
    async function capabilities() {
      return perform(async ctx => {
        const value = await rpc(ctx, 'life_library_capabilities', {});
        fields(value, ['version', 'metadataVersion', 'originalsVersion']);
        check([0, 1].includes(value.version) && [0, 1].includes(value.metadataVersion) && [0, 1].includes(value.originalsVersion));
        check(value.version !== 0 || value.metadataVersion === 0 && value.originalsVersion === 0);
        return structuredClone(value);
      });
    }
    async function open(preferredId = null) {
      check(preferredId === null || id(preferredId), 'invalid_request');
      return perform(async ctx => {
        const value = await rpc(ctx, 'life_library_open', { p_preferred_workspace_id: preferredId });
        fields(value, ['status', 'workspace_id', 'default_revision', 'pristine']);
        check(['ready', 'missing'].includes(value.status) && id(value.workspace_id) && typeof value.pristine === 'boolean' &&
          revision(value.default_revision, value.status === 'ready' ? 1 : 0) && (value.status !== 'missing' || value.pristine === false));
        return structuredClone(value);
      });
    }
    async function catalog(after = null, limit = 100) {
      check((after === null || id(after)) && Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'invalid_request');
      return perform(async ctx => {
        const value = await rpc(ctx, 'life_library_catalog', { p_after: after, p_limit: limit });
        fields(value, ['items', 'next']); check(Array.isArray(value.items) && value.items.length <= limit &&
          Reflect.ownKeys(value.items).length === value.items.length + 1 && Array.from({ length: value.items.length }, (_, i) => {
            const descriptor = Object.getOwnPropertyDescriptor(value.items, String(i));
            return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
          }).every(Boolean));
        let previous = after?.toLowerCase() || '';
        for (const item of value.items) {
          fields(item, ['id', 'title', 'revision', 'updated_at']);
          check(id(item.id) && item.id.toLowerCase() > previous && typeof item.title === 'string' && item.title.length > 0 && item.title.length <= 500 &&
            revision(item.revision, 1) && typeof item.updated_at === 'string' && Number.isFinite(Date.parse(item.updated_at)));
          previous = item.id.toLowerCase();
        }
        check(value.next === null || id(value.next) && value.items.length > 0 && value.next === value.items.at(-1).id);
        return structuredClone(value);
      });
    }
    async function read(workspaceId) {
      check(id(workspaceId), 'invalid_request');
      return perform(async ctx => {
        const value = await rpc(ctx, 'life_library_meta_get', { p_workspace_id: workspaceId });
        if (value === null) return null;
        fields(value, ['workspace_id', 'revision', 'source_revision', 'data', 'updated_at']);
        check(value.workspace_id === workspaceId && revision(value.revision, 1) && revision(value.source_revision, 1) &&
          typeof value.updated_at === 'string' && Number.isFinite(Date.parse(value.updated_at)));
        return { workspace_id: workspaceId, revision: value.revision, source_revision: value.source_revision,
          data: data(value.data, workspaceId), updated_at: value.updated_at };
      });
    }
    async function write(request) {
      const { workspaceId, expectedRevision, operationId, sourceRevision } = request || {};
      check(id(workspaceId) && id(operationId) && revision(expectedRevision) && revision(sourceRevision, 1), 'invalid_request');
      const snapshot = data(request.data, workspaceId);
      return perform(async ctx => {
        const value = await rpc(ctx, 'life_library_meta_put', { p_workspace_id: workspaceId, p_expected_revision: expectedRevision,
          p_operation_id: operationId, p_source_revision: sourceRevision, p_data: snapshot });
        if (value?.status === 'missing') { fields(value, ['status']); return { status: 'missing' }; }
        fields(value, ['status', 'revision']);
        check(['stored', 'conflict'].includes(value.status) && revision(value.revision, 1) &&
          (value.status !== 'stored' || value.revision === expectedRevision + 1));
        return { status: value.status, revision: value.revision };
      });
    }
    function dispose() { if (!disposed) { disposed = true; client.auth.dispose(); } }
    return Object.freeze({ capabilities, open, catalog, read, write, dispose });
  }
  return Object.freeze({ create, MAX_BYTES, clean });
});

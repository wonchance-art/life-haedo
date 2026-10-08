/* Private configuration transport; borrows the one server-verified platform session. */
(function (root, factory) {
  'use strict';
  const api = factory(root); root.HaedoLife ||= {}; root.HaedoLife.CompositionRemote = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const MAX_BYTES = 2 * 1024 * 1024;
  const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  const messages = {
    auth_required: '로그인 계정을 다시 확인해 주세요.',
    request_cancelled: '계정 또는 연결이 바뀌어 이전 요청을 중단했습니다.',
    schema_missing: '서버에 구성 이어쓰기 준비가 필요합니다. 이 브라우저의 구성은 보존됩니다.',
    invalid_remote_data: '서버 구성의 형식을 확인하지 못했습니다. 현재 구성은 보존됩니다.',
    invalid_request: '구성 전송의 버전과 형식을 확인해 주세요.',
    operation_mismatch: '이전 전송 작업과 내용이 달라 적용하지 않았습니다.',
    composition_source_pending: '원문 동기화를 먼저 완료해 주세요. 현재 구성은 보존됩니다.',
    payload_too_large: '구성은 2 MiB까지 이어 쓸 수 있습니다. 이 브라우저의 구성은 보존됩니다.',
    permission_denied: '현재 계정으로 구성에 접근하지 못했습니다.',
    network_error: '서버에 연결하지 못했습니다. 전송 대기 내용은 보존됩니다.'
  };
  const fault = code => Object.assign(new Error(messages[code] || messages.network_error), { code });
  const validRevision = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
  const identifier = value => typeof value === 'string' && UUID.test(value);
  function clean(error) {
    if (messages[error?.code]) return fault(error.code);
    const message = error?.message || '';
    if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error?.code) || error?.status === 404) return fault('schema_missing');
    if (message === 'life_composition_source_not_ready') return fault('composition_source_pending');
    if (message === 'life_composition_operation_mismatch') return fault('operation_mismatch');
    if (error?.code === '22001' || message === 'life_composition_too_large') return fault('payload_too_large');
    if (message === 'life_composition_auth_required' || error?.status === 401 || error?.name === 'AuthSessionMissingError') return fault('auth_required');
    if (error?.name === 'AbortError') return fault('request_cancelled');
    if (error?.code === '42501' || error?.status === 403) return fault('permission_denied');
    if (['22023', '22003'].includes(error?.code)) return fault('invalid_request');
    return fault('network_error');
  }
  function create({ auth = root.HaedoAuth, workbench = root.HaedoLife?.Workbench,
    clientFactory = root.HaedoLife?.PlatformRemote?.clientFactory } = {}) {
    if (!auth?.ready || !workbench?.validate || !clientFactory) throw fault('auth_required');
    const client = clientFactory(auth, { scope: 'composition' })(auth.config.url, auth.config.key);
    let disposed = false;
    const alive = () => { if (disposed) throw fault('request_cancelled'); };
    function data(value, workspaceId) {
      try {
        workbench.validate(value);
        if (value.workspaceId !== workspaceId) throw fault('invalid_remote_data');
        const json = JSON.stringify(value);
        if (new TextEncoder().encode(json).length > MAX_BYTES) throw fault('payload_too_large');
        return JSON.parse(json);
      } catch (error) { throw fault(['payload_too_large', 'workbench_too_large'].includes(error?.code) ? 'payload_too_large' : 'invalid_remote_data'); }
    }
    async function authorize() {
      alive(); const result = await client.auth.getUser(); alive();
      if (result.error || !result.data?.user) throw fault('auth_required');
    }
    async function read(workspaceId) {
      if (!identifier(workspaceId)) throw fault('invalid_request');
      try {
        await authorize();
        const result = await client.rpc('life_composition_get', { p_workspace_id: workspaceId }); alive();
        if (result.error) throw result.error;
        if (result.data === null) return null;
        const row = result.data;
        if (row?.workspace_id !== workspaceId || !validRevision(row.revision, 1) || !validRevision(row.source_revision, 1) ||
            typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) throw fault('invalid_remote_data');
        return { workspace_id: workspaceId, revision: row.revision, source_revision: row.source_revision,
          data: data(row.data, workspaceId), updated_at: row.updated_at };
      } catch (error) { alive(); throw clean(error); }
    }
    async function write(request) {
      const { workspaceId, operationId, expectedRevision, sourceRevision } = request || {};
      if (!identifier(workspaceId) || !identifier(operationId) || !validRevision(expectedRevision) || !validRevision(sourceRevision, 1)) throw fault('invalid_request');
      try {
        const snapshot = data(request.data, workspaceId);
        await authorize();
        const result = await client.rpc('life_composition_put', { p_workspace_id: workspaceId,
          p_expected_revision: expectedRevision, p_operation_id: operationId,
          p_source_revision: sourceRevision, p_data: snapshot }); alive();
        if (result.error) throw result.error;
        if (result.data?.status === 'missing') return { status: 'missing' };
        if (!['stored', 'conflict'].includes(result.data?.status) || !validRevision(result.data.revision, 1)) throw fault('invalid_remote_data');
        return { status: result.data.status, revision: result.data.revision };
      } catch (error) { alive(); throw clean(error); }
    }
    function dispose() { if (!disposed) { disposed = true; client.auth.dispose(); } }
    return Object.freeze({ read, write, dispose });
  }
  return Object.freeze({ create, MAX_BYTES, clean });
});

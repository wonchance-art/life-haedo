/* Private, selected writing drafts. The shared verified SDK owns authentication. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).WritingRemote = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const MAX_BYTES = 2 * 1024 * 1024;
  const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  const messages = {
    auth_required: '로그인 계정을 다시 확인해 주세요.', request_cancelled: '계정 또는 연결이 바뀌어 이전 요청을 중단했습니다.',
    schema_missing: '서버에 초안 이어쓰기 준비가 필요합니다. 이 브라우저의 글은 보존됩니다.',
    invalid_remote_data: '서버 초안의 형식을 확인하지 못했습니다. 현재 글은 보존됩니다.',
    invalid_request: '초안 전송의 식별자와 버전을 확인해 주세요.', operation_mismatch: '이전 전송 요청과 내용이 달라 적용하지 않았습니다.',
    writing_source_pending: '원문 동기화와 저장한 글의 도착을 먼저 확인해 주세요. 초안은 보존됩니다.',
    writing_conflict: '두 기기의 초안이 다릅니다. 양쪽 글을 비교해 주세요.',
    writing_conflict_changed: '비교한 뒤 초안이 바뀌었습니다. 양쪽 글을 다시 확인해 주세요.',
    writing_closed: '다른 기기에서 기록으로 저장했습니다. 쓰던 글은 새 초안 사본으로 보관할 수 있습니다.',
    payload_too_large: '초안 본문은 UTF-8 기준 1 MiB까지 이어 쓸 수 있습니다. TXT로 보관해 주세요.',
    permission_denied: '현재 계정으로 초안에 접근하지 못했습니다.',
    network_error: '서버에 연결하지 못했습니다. 글과 전송 대기 내용은 보존됩니다.',
    remote_missing: '연결된 서버 초안이 없습니다. 자동으로 다시 만들지 않았습니다.',
    remote_revision_mismatch: '같은 서버 버전의 내용이 달라 적용하지 않았습니다.',
    stale_sync_result: '현재 요청과 다른 이전 응답을 적용하지 않았습니다.',
    sync_paused: '초안 이어쓰기가 중지되어 있습니다.', not_enabled: '이 초안의 이어쓰기를 먼저 시작해 주세요.',
    account_mismatch: '현재 계정의 초안 연결을 확인해 주세요.',
    storage_quota: '저장 공간이 부족합니다. TXT로 입력을 보관한 뒤 다시 시도해 주세요.'
  };
  const fault = code => Object.assign(new Error(messages[code] || messages.network_error), { code });
  const validId = value => typeof value === 'string' && UUID.test(value);
  const revision = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
  function clean(error) {
    const aliases = { composition_source_pending: 'writing_source_pending', composition_conflict: 'writing_conflict',
      composition_conflict_changed: 'writing_conflict_changed', writing_paused: 'sync_paused', writing_not_configured: 'not_enabled' };
    const code = aliases[error?.code] || error?.code;
    if (messages[code]) return fault(code);
    if (['PGRST202','PGRST205','42P01','42883'].includes(code) || error?.status === 404) return fault('schema_missing');
    const message = error?.message || '';
    if (message === 'life_writing_draft_source_not_ready') return fault('writing_source_pending');
    if (message === 'life_writing_draft_operation_mismatch') return fault('operation_mismatch');
    if (code === '22001' || code === 'text_too_large') return fault('payload_too_large');
    if (message === 'life_writing_draft_auth_required' || error?.status === 401 || error?.name === 'AuthSessionMissingError') return fault('auth_required');
    if (error?.name === 'AbortError') return fault('request_cancelled');
    if (code === '42501' || error?.status === 403) return fault('permission_denied');
    if (['22023','22003'].includes(code)) return fault('invalid_request');
    return fault('network_error');
  }
  function create({ auth = root.HaedoAuth, writing = root.HaedoLife?.Writing,
    clientFactory = root.HaedoLife?.PlatformRemote?.clientFactory } = {}) {
    if (!auth?.ready || !writing?.validateDraft || !clientFactory) throw fault('auth_required');
    const client = clientFactory(auth, { scope: 'writing' })(auth.config.url, auth.config.key);
    let disposed = false;
    const alive = () => { if (disposed) throw fault('request_cancelled'); };
    const ids = (ws, id) => { if (!validId(ws) || !validId(id)) throw fault('invalid_request'); };
    function data(value, ws, id) {
      try {
        writing.validateDraft(value);
        if (value.workspaceId !== ws || value.stageId !== id || value.state === 'applied' && !value.appliedResult) throw fault('invalid_remote_data');
        const json = JSON.stringify(value);
        if (new TextEncoder().encode(json).length > MAX_BYTES) throw fault('payload_too_large');
        return JSON.parse(json);
      } catch (error) { throw fault(['text_too_large','payload_too_large'].includes(error.code) ? 'payload_too_large' : 'invalid_remote_data'); }
    }
    async function rpc(name, args) {
      try {
        alive(); const user = await client.auth.getUser(); alive();
        if (user.error || !user.data?.user) throw fault('auth_required');
        const result = await client.rpc(name, args); alive();
        if (result.error) throw result.error; return result.data;
      } catch (error) { alive(); throw clean(error); }
    }
    async function read(ws, id) {
      ids(ws, id); const row = await rpc('life_writing_draft_get', { p_workspace_id: ws, p_draft_id: id });
      if (row === null) return null;
      if (row?.workspace_id !== ws || row.draft_id !== id || !revision(row.revision, 1) || !revision(row.source_revision, 1) ||
          typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) throw fault('invalid_remote_data');
      return { workspace_id: ws, draft_id: id, revision: row.revision, source_revision: row.source_revision,
        updated_at: row.updated_at, data: data(row.data, ws, id) };
    }
    async function write(request) {
      const { workspaceId, draftId, expectedRevision, operationId, sourceRevision } = request || {};
      ids(workspaceId, draftId);
      if (!validId(operationId) || !revision(expectedRevision) || !revision(sourceRevision, 1)) throw fault('invalid_request');
      const snapshot = data(request.data, workspaceId, draftId);
      const result = await rpc('life_writing_draft_put', { p_workspace_id: workspaceId, p_draft_id: draftId,
        p_expected_revision: expectedRevision, p_operation_id: operationId, p_source_revision: sourceRevision, p_data: snapshot });
      if (result?.status === 'missing') return { status: 'missing' };
      if (!['stored','conflict'].includes(result?.status) || !revision(result.revision, 1)) throw fault('invalid_remote_data');
      return { status: result.status, revision: result.revision };
    }
    async function list(ws, after = null) {
      if (!validId(ws) || after !== null && !validId(after)) throw fault('invalid_request');
      const result = await rpc('life_writing_draft_list', { p_workspace_id: ws, p_after_draft_id: after });
      if (!Array.isArray(result) || result.length > 100) throw fault('invalid_remote_data');
      let previous = after || '';
      return result.map(row => {
        if (!validId(row?.draft_id) || row.draft_id <= previous || typeof row.title !== 'string' || row.title.length > 500 ||
            row.title.includes('\u0000') || Array.from(row.title).some(char => char.length === 1 && /[\ud800-\udfff]/.test(char)) ||
            !['draft','applied'].includes(row.state) || !revision(row.revision, 1) || typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) throw fault('invalid_remote_data');
        previous = row.draft_id;
        return { draft_id: row.draft_id, title: row.title, state: row.state, revision: row.revision, updated_at: row.updated_at };
      });
    }
    return Object.freeze({ read, write, list, dispose() { if (!disposed) { disposed = true; client.auth.dispose(); } } });
  }
  return Object.freeze({ create, clean, MAX_BYTES });
});

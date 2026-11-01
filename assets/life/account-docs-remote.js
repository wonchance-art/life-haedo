/* Private account-document transport; borrows the one server-verified platform session. */
(function (root, factory) {
  'use strict';
  const api = factory(root); root.HaedoLife ||= {}; root.HaedoLife.AccountDocsRemote = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const MAX_BYTES = 2 * 1024 * 1024;
  const PAGE_LIMIT = 200;
  const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  const messages = {
    auth_required: '로그인 계정을 다시 확인해 주세요.',
    request_cancelled: '계정 또는 연결이 바뀌어 이전 요청을 중단했습니다.',
    schema_missing: '서버에 계정 자동 저장 준비가 필요합니다. 이 기기의 내용은 보존됩니다.',
    invalid_remote_data: '서버에서 받은 내용의 형식을 확인하지 못했습니다. 이 기기의 내용은 보존됩니다.',
    invalid_request: '자동 저장 요청의 형식을 확인해 주세요.',
    operation_mismatch: '이전 전송 작업과 내용이 달라 적용하지 않았습니다.',
    payload_too_large: '한 항목은 2 MiB까지 계정에 자동 저장할 수 있습니다. 이 기기의 내용은 보존됩니다.',
    permission_denied: '현재 계정으로 자동 저장에 접근하지 못했습니다.',
    network_error: '서버에 연결하지 못했습니다. 바뀐 내용은 이 기기에 보존되고 연결되면 다시 보냅니다.'
  };
  const fault = code => Object.assign(new Error(messages[code] || messages.network_error), { code });
  const validKey = value => typeof value === 'string' && value.length >= 1 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
  const validRevision = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
  const validTime = value => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
  // PostgREST serializes bigint as a JSON number; accept an exact numeric string defensively.
  const integer = value => typeof value === 'string' && /^\d{1,16}$/.test(value) ? Number(value) : value;
  function clean(error) {
    if (messages[error?.code]) return fault(error.code);
    const message = error?.message || '';
    if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error?.code) || error?.status === 404) return fault('schema_missing');
    if (message === 'life_account_document_operation_mismatch') return fault('operation_mismatch');
    if (error?.code === '22001' || message === 'life_account_document_too_large') return fault('payload_too_large');
    if (message === 'life_account_document_auth_required' || error?.status === 401 || error?.name === 'AuthSessionMissingError') return fault('auth_required');
    if (error?.name === 'AbortError') return fault('request_cancelled');
    if (error?.code === '42501' || error?.status === 403) return fault('permission_denied');
    if (['22023', '22003'].includes(error?.code)) return fault('invalid_request');
    return fault('network_error');
  }
  // Detached JSON copy; anything that does not survive JSON (Blob, Map, cycles) is refused.
  function json(value) {
    let text;
    try { text = JSON.stringify(value); } catch (_) { throw fault('invalid_request'); }
    if (typeof text !== 'string') throw fault('invalid_request');
    if (new TextEncoder().encode(text).length > MAX_BYTES) throw fault('payload_too_large');
    return JSON.parse(text);
  }
  function current(value) {
    if (value === null) return null;
    if (!value || typeof value !== 'object') throw fault('invalid_remote_data');
    const revision = integer(value.revision);
    if (!validRevision(revision, 1) || typeof value.deleted !== 'boolean' || !validTime(value.client_updated_at ?? null) ||
        (value.deleted ? value.data !== null : value.data === null || value.data === undefined)) throw fault('invalid_remote_data');
    return { revision, data: value.data === null ? null : JSON.parse(JSON.stringify(value.data)), deleted: value.deleted,
      client_updated_at: value.client_updated_at ?? null };
  }
  function create({ auth = root.HaedoAuth, clientFactory = root.HaedoLife?.PlatformRemote?.clientFactory } = {}) {
    if (!auth?.ready || !clientFactory) throw fault('auth_required');
    const client = clientFactory(auth, { scope: 'account-docs' })(auth.config.url, auth.config.key);
    let disposed = false;
    const alive = () => { if (disposed) throw fault('request_cancelled'); };
    async function authorize() {
      alive(); const result = await client.auth.getUser(); alive();
      if (result.error || !result.data?.user) throw fault('auth_required');
    }
    async function put(request) {
      const { docKey, expectedRevision, operationId, deleted = false, clientUpdatedAt = null } = request || {};
      if (!validKey(docKey) || !validRevision(expectedRevision) || typeof operationId !== 'string' || !UUID.test(operationId) ||
          typeof deleted !== 'boolean' || !validTime(clientUpdatedAt) || (deleted ? request.data !== null : request.data == null)) throw fault('invalid_request');
      try {
        const data = deleted ? null : json(request.data);
        await authorize();
        const result = await client.rpc('life_account_document_put', { p_doc_key: docKey, p_expected_revision: expectedRevision,
          p_operation_id: operationId, p_data: data, p_deleted: deleted, p_client_updated_at: clientUpdatedAt }); alive();
        if (result.error) throw result.error;
        const value = result.data, revision = integer(value?.revision), seq = value?.seq === null ? null : integer(value?.seq);
        if (value?.status === 'stored' && validRevision(revision, 1) && validRevision(seq, 1)) return { status: 'stored', revision, seq };
        if (value?.status === 'conflict' && validRevision(revision) && (seq === null || validRevision(seq, 1))) {
          const now = current(value.current ?? null);
          if ((now === null) !== (revision === 0) || (now && now.revision !== revision)) throw fault('invalid_remote_data');
          return { status: 'conflict', revision, seq, current: now };
        }
        throw fault('invalid_remote_data');
      } catch (error) { alive(); throw clean(error); }
    }
    async function changes(afterSeq, limit = PAGE_LIMIT) {
      if (!validRevision(afterSeq) || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw fault('invalid_request');
      try {
        await authorize();
        const result = await client.rpc('life_account_document_changes', { p_after_seq: afterSeq, p_limit: limit }); alive();
        if (result.error) throw result.error;
        if (!Array.isArray(result.data) || result.data.length > limit) throw fault('invalid_remote_data');
        let previous = afterSeq;
        return result.data.map(row => {
          const seq = integer(row?.seq);
          if (!validKey(row?.doc_key) || !validRevision(seq, 1) || seq <= previous) throw fault('invalid_remote_data');
          previous = seq;
          return { docKey: row.doc_key, seq, ...current({ revision: row.revision, data: row.data, deleted: row.deleted, client_updated_at: row.client_updated_at }) };
        });
      } catch (error) { alive(); throw clean(error); }
    }
    function dispose() { if (!disposed) { disposed = true; client.auth.dispose(); } }
    return Object.freeze({ put, changes, dispose, PAGE_LIMIT });
  }
  return Object.freeze({ create, clean, MAX_BYTES, PAGE_LIMIT });
});

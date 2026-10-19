/* One explicitly selected preparation. No whole-workspace synchronization or publication. */
(function (root, factory) {
  const api = factory(root); (root.HaedoLife ||= {}).MaterialContinuityRemote = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const MAX_BYTES = 16 * 1024 * 1024, MAX_REVISION = Number.MAX_SAFE_INTEGER;
  const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  const messages = {
    auth_required: '로그인 계정을 다시 확인해 주세요.', request_cancelled: '계정이나 연결이 바뀌어 이전 요청을 중단했습니다.',
    schema_missing: '서버에 자료 준비 이어쓰기 설치가 필요합니다. 이 브라우저의 준비는 유지합니다.',
    invalid_request: '자료 준비 전송의 식별자와 버전을 확인해 주세요.', invalid_remote_data: '서버 준비의 원문과 구절을 확인하지 못했습니다. 현재 입력은 유지합니다.',
    operation_mismatch: '이미 보낸 작업과 요청 내용이 달라 적용하지 않았습니다.', remote_missing: '연결한 서버 준비가 없습니다. 자동으로 다시 만들지 않았습니다.',
    output_conflict: '이미 정해진 글과 작성 기기를 바꿀 수 없습니다. 기존 글을 이어 쓰거나 별도 준비 사본을 만드세요.',
    output_missing: '이 계정에 보관한 완성 글을 찾지 못했습니다. 글을 먼저 비공개 서버에 보관해 주세요.',
    output_changed: '서버에 보관한 글의 버전이 바뀌었습니다. 현재 글을 다시 확인한 뒤 연결해 주세요.',
    immutable_source_version: '같은 원문 버전의 내용이 달라 적용하지 않았습니다. 원래 자료를 유지합니다.',
    payload_too_large: '준비와 선택 원문은 합계 16 MiB까지 전송할 수 있습니다. 자료 선택 범위를 줄여 주세요.',
    permission_denied: '현재 계정으로 이 준비에 접근할 수 없습니다.', network_error: '서버에 연결하지 못했습니다. 준비와 전송 대기 내용은 유지합니다.'
  };
  const fault = code => Object.assign(new Error(messages[code] || messages.network_error), { code: messages[code] ? code : 'network_error' });
  const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const fields = (value, keys) => plain(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const id = value => typeof value === 'string' && UUID.test(value);
  const revision = (value, min = 0) => Number.isSafeInteger(value) && value >= min && value <= MAX_REVISION;
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
  const submillis = value => ((/\.(\d+)(?:Z|[+-]\d\d(?::?\d\d)?)$/.exec(value)?.[1] || '').padEnd(9, '0')).slice(3);
  const compareTime = (a, b) => Date.parse(a) - Date.parse(b) || (submillis(a) > submillis(b) ? 1 : submillis(a) < submillis(b) ? -1 : 0);
  function clean(error) {
    if (messages[error?.code]) return fault(error.code);
    const message = error?.message || '';
    const known = /\blife_material_(auth_required|invalid_request|invalid_remote_data|operation_mismatch|remote_missing|output_conflict|output_missing|output_changed|immutable_source_version|payload_too_large)\b/.exec(message);
    if (known) return fault(known[1]);
    if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error?.code) || error?.status === 404) return fault('schema_missing');
    if (error?.name === 'AbortError') return fault('request_cancelled');
    if (error?.status === 401 || error?.name === 'AuthSessionMissingError') return fault('auth_required');
    if (error?.code === '42501' || error?.status === 403) return fault('permission_denied');
    if (error?.code === '22001') return fault('payload_too_large');
    if (['22023', '22003', '22P02'].includes(error?.code)) return fault('invalid_request');
    return fault('network_error');
  }
  function create({ auth = root.HaedoAuth, model = root.HaedoLife?.MaterialContinuity,
    clientFactory = root.HaedoLife?.PlatformRemote?.clientFactory } = {}) {
    if (!auth?.ready || !model?.verify || !clientFactory) throw fault('auth_required');
    const client = clientFactory(auth, { scope: 'material' })(auth.config.url, auth.config.key);
    let disposed = false;
    const context = () => { if (disposed) throw fault('request_cancelled'); if (!auth.user?.id) throw fault('auth_required'); return { userId: auth.user.id, epoch: auth.epoch }; };
    function alive(value) { if (disposed || value && (!value.userId || auth.user?.id !== value.userId || auth.epoch !== value.epoch)) throw fault('request_cancelled'); }
    async function rpc(name, args, captured) {
      try {
        alive(captured); const user = await client.auth.getUser(); alive(captured);
        if (user.error || !user.data?.user || user.data.user.id !== captured.userId) throw fault('auth_required');
        const result = await client.rpc(name, args); alive(captured); if (result.error) throw result.error; return result.data;
      } catch (cause) { alive(captured); throw clean(cause); }
    }
    async function verified(input) {
      try {
        const owned = structuredClone(input);
        if (new TextEncoder().encode(JSON.stringify(owned)).length > MAX_BYTES) throw fault('payload_too_large');
        return await model.verify(owned);
      } catch (cause) { throw cause?.code === 'payload_too_large' ? cause : fault('invalid_remote_data'); }
    }
    async function read(remoteId) {
      if (!id(remoteId)) throw fault('invalid_request'); const captured = context();
      const row = await rpc('life_material_get', { p_id: remoteId }, captured);
      if (row === null) return null;
      if (!fields(row, ['id', 'revision', 'data', 'updated_at']) || row.id !== remoteId || !revision(row.revision, 1) || !timestamp(row.updated_at)) throw fault('invalid_remote_data');
      const data = await verified(row.data); alive(captured); return { id: row.id, revision: row.revision, data, updated_at: row.updated_at };
    }
    async function write(request) {
      const captured = context(), owned = structuredClone(request);
      if (!fields(owned, ['remoteId', 'operationId', 'expectedRevision', 'data']) || !id(owned.remoteId) || !id(owned.operationId) || !revision(owned.expectedRevision) || owned.expectedRevision === MAX_REVISION) throw fault('invalid_request');
      const data = await verified(owned.data); alive(captured);
      const result = await rpc('life_material_put', { p_id: owned.remoteId, p_operation_id: owned.operationId, p_expected_revision: owned.expectedRevision, p_data: data }, captured);
      if (!fields(result, ['status', 'revision']) || !['stored', 'conflict'].includes(result.status) || !revision(result.revision, 1) || result.status === 'stored' && result.revision !== owned.expectedRevision + 1) throw fault('invalid_remote_data');
      return { status: result.status, revision: result.revision };
    }
    async function list(after = null) {
      const captured = context(), cursor = after === null ? null : structuredClone(after);
      if (cursor !== null && (!fields(cursor, ['updated_at', 'id']) || !timestamp(cursor.updated_at) || !id(cursor.id))) throw fault('invalid_request');
      const result = await rpc('life_material_list', { p_after_updated_at: cursor?.updated_at || null, p_after_id: cursor?.id || null }, captured);
      if (!fields(result, ['items', 'next']) || !Array.isArray(result.items) || result.items.length > 20) throw fault('invalid_remote_data');
      const seen = new Set(); let prior = cursor;
      const items = result.items.map(row => {
        if (!fields(row, ['id', 'revision', 'title', 'updated_at']) || !id(row.id) || seen.has(row.id) || !revision(row.revision, 1) || !timestamp(row.updated_at) || typeof row.title !== 'string' || row.title.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(row.title)) throw fault('invalid_remote_data');
        const order = prior && compareTime(row.updated_at, prior.updated_at);
        if (prior && (order > 0 || order === 0 && row.id.toLowerCase() >= prior.id.toLowerCase())) throw fault('invalid_remote_data');
        prior = row; seen.add(row.id); return { id: row.id, revision: row.revision, title: row.title, updated_at: row.updated_at };
      });
      if (result.next !== null && (!fields(result.next, ['updated_at', 'id']) || items.length !== 20 || result.next.id !== prior?.id || result.next.updated_at !== prior?.updated_at)) throw fault('invalid_remote_data');
      return { items, next: result.next === null ? null : { updated_at: result.next.updated_at, id: result.next.id } };
    }
    return Object.freeze({ read, write, list, dispose() { if (disposed) return; disposed = true; client.auth.dispose(); } });
  }
  return Object.freeze({ create, clean, MAX_BYTES });
});

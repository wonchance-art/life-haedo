/* Private immutable archive RPCs and owner-verified Storage chunks. */
(function (root, factory) {
  const api = factory(root); (root.HaedoLife ||= {}).LibraryOriginalsRemote = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const BUCKET = 'life-library-originals', CHUNK_BYTES = 8 * 1024 * 1024;
  const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  const HASH = /^[a-f0-9]{64}$/;
  const fields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const messages = { originals_auth: '로그인 계정을 다시 확인해 주세요.', originals_scope_closed: '계정이 바뀌어 이전 원본 요청을 중단했습니다.', originals_schema_missing: '계정 원본 보관을 사용할 수 없습니다. 기존 원본과 전송 대기는 유지합니다.', originals_invalid_remote: '서버 원본의 경로·크기·해시를 확인하지 못했습니다.', originals_remote_missing: '계정에서 원본을 찾을 수 없습니다. 이전 원본을 자동으로 다시 만들지 않았습니다.', originals_network: '원본 전송을 완료하지 못했습니다. 기존 원본과 전송 대기는 유지합니다.' };
  const fault = code => Object.assign(new Error(messages[code] || messages.originals_network), { code: messages[code] ? code : 'originals_network' });
  function clean(error) {
    if (messages[error?.code]) return fault(error.code);
    if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error?.code)) return fault('originals_schema_missing');
    if (error?.status === 401 || error?.name === 'AuthSessionMissingError') return fault('originals_auth');
    if (error?.name === 'AbortError' || error?.code === 'request_cancelled') return fault('originals_scope_closed');
    return fault('originals_network');
  }
  const digest = async blob => [...new Uint8Array(await root.crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
  function create({ auth = root.HaedoAuth, model = root.HaedoLife?.OriginalAttachments, clientFactory = root.HaedoLife?.PlatformRemote?.clientFactory } = {}) {
    if (!auth?.ready || !auth.client || !auth.config || !clientFactory || !model?.validateManifest) throw fault('originals_auth');
    const client = clientFactory(auth, { scope: 'originals' })(auth.config.url, auth.config.key);
    let disposed = false;
    const context = () => { if (disposed) throw fault('originals_scope_closed'); if (!UUID.test(auth.user?.id || '')) throw fault('originals_auth'); return { userId: auth.user.id, epoch: auth.epoch, projectUrl: auth.config.url }; };
    function alive(captured) {
      if (disposed || captured && (auth.user?.id !== captured.userId || auth.epoch !== captured.epoch || auth.config.url !== captured.projectUrl)) throw fault('originals_scope_closed');
    }
    async function verify(captured) {
      alive(captured); const reply = await client.auth.getUser(); alive(captured);
      if (reply.error || reply.data?.user?.id !== captured.userId) throw fault('originals_auth');
    }
    async function rpc(name, args, captured) {
      try { await verify(captured); const result = await client.rpc(name, args); alive(captured); if (result.error) throw result.error; return result.data; }
      catch (error) { alive(captured); throw clean(error); }
    }
    async function capabilities() {
      const captured = context(); let value;
      try { value = await rpc('life_library_capabilities', {}, captured); }
      catch (error) { if (error.code === 'originals_schema_missing') return { version: 0, originalsVersion: 0 }; throw error; }
      if (value?.version === 0) return { version: 0, originalsVersion: 0 };
      if (!fields(value, ['version', 'metadataVersion', 'originalsVersion']) || value.version !== 1 || value.metadataVersion !== 1 || value.originalsVersion !== 1) throw fault('originals_invalid_remote');
      return { ...value };
    }
    async function list(after = null, limit = 100) {
      const captured = context(), cursor = after;
      if (cursor !== null && !UUID.test(cursor) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw fault('originals_invalid_remote');
      const result = await rpc('life_library_originals_list', { p_after: cursor, p_limit: limit }, captured);
      if (!fields(result, ['items', 'next']) || !Array.isArray(result.items) || result.items.length > limit) throw fault('originals_invalid_remote');
      let previous = cursor?.toLowerCase() || ''; const items = result.items.map(row => {
        if (!fields(row, ['id', 'revision', 'created_at', 'archive_sha256', 'archive_bytes', 'part', 'part_count', 'source_head', 'entry_count', 'total_file_bytes']) || !UUID.test(row.id || '') || row.id.toLowerCase() <= previous || row.revision !== 1 || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at)) || !HASH.test(row.archive_sha256 || '') || !Number.isSafeInteger(row.archive_bytes) || row.archive_bytes < 22 || row.archive_bytes > model.LIMITS.part || !Number.isSafeInteger(row.part_count) || row.part_count < 1 || row.part_count > 200 || !Number.isSafeInteger(row.part) || row.part < 1 || row.part > row.part_count || !/^[a-f0-9]{40}$/.test(row.source_head || '') || !Number.isSafeInteger(row.entry_count) || row.entry_count < 1 || row.entry_count > 500 || !Number.isSafeInteger(row.total_file_bytes) || row.total_file_bytes < 0 || row.total_file_bytes > row.archive_bytes) throw fault('originals_invalid_remote');
        previous = row.id.toLowerCase(); return { ...row };
      });
      if (result.next !== null && (!UUID.test(result.next || '') || items.length !== limit || result.next !== items.at(-1)?.id)) throw fault('originals_invalid_remote');
      return { items, next: result.next };
    }
    async function read(id) {
      if (!UUID.test(id || '')) throw fault('originals_invalid_remote'); const captured = context();
      const row = await rpc('life_library_original_get', { p_id: id }, captured);
      if (row === null) return null;
      if (!fields(row, ['id', 'revision', 'manifest', 'created_at']) || row.id !== id || row.revision !== 1 || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) throw fault('originals_invalid_remote');
      const manifest = model.validateManifest(row.manifest, captured.userId); alive(captured);
      if (manifest.id !== id) throw fault('originals_invalid_remote');
      return { id, revision: 1, manifest, created_at: row.created_at };
    }
    async function write(request) {
      const captured = context(), value = structuredClone(request);
      if (!fields(value, ['id', 'operationId', 'manifest']) || !UUID.test(value.id || '') || !UUID.test(value.operationId || '')) throw fault('originals_invalid_remote');
      const manifest = model.validateManifest(value.manifest, captured.userId);
      if (manifest.id !== value.id) throw fault('originals_invalid_remote');
      const result = await rpc('life_library_original_put', { p_id: value.id, p_operation_id: value.operationId, p_manifest: manifest }, captured);
      if (fields(result, ['status']) && result.status === 'missing') return { status: 'missing' };
      if (!fields(result, ['status', 'revision']) || result.status !== 'stored' || result.revision !== 1) throw fault('originals_invalid_remote');
      return { status: 'stored', revision: 1 };
    }
    function chunk(value, captured) {
      const copy = structuredClone(value);
      if (!fields(copy, ['index', 'path', 'bytes', 'sha256']) || !Number.isSafeInteger(copy.index) || copy.index < 0 || copy.index > 15 || !Number.isSafeInteger(copy.bytes) || copy.bytes < 1 || copy.bytes > CHUNK_BYTES || !HASH.test(copy.sha256 || '') || typeof copy.path !== 'string' || !new RegExp('^' + captured.userId + '/[a-f0-9]{64}/' + String(copy.index).padStart(4, '0') + '-' + copy.sha256 + '$').test(copy.path)) throw fault('originals_invalid_remote');
      return copy;
    }
    async function checkedBlob(blob, entry, captured) {
      if (!(blob instanceof Blob) || blob.size !== entry.bytes || await digest(blob) !== entry.sha256) throw fault('originals_invalid_remote'); alive(captured); return blob;
    }
    async function downloadChunk(input) {
      const captured = context(), entry = chunk(input, captured);
      try { await verify(captured); const result = await auth.client.storage.from(BUCKET).download(entry.path); alive(captured); if (result.error) throw result.error; await verify(captured); return await checkedBlob(result.data, entry, captured); }
      catch (error) { alive(captured); throw clean(error); }
    }
    async function uploadChunk(input, inputBlob) {
      const captured = context(), entry = chunk(input, captured), blob = inputBlob instanceof Blob ? inputBlob.slice() : inputBlob;
      try {
        await checkedBlob(blob, entry, captured); await verify(captured);
        const result = await auth.client.storage.from(BUCKET).upload(entry.path, blob, { upsert: false, contentType: 'application/octet-stream', cacheControl: '31536000' }); alive(captured); await verify(captured);
        if (result.error) {
          if (Number(result.error.statusCode || result.error.status) !== 409 && !['Duplicate', 'ResourceAlreadyExists'].includes(result.error.error)) throw result.error;
          await downloadChunk(entry); alive(captured);
        }
        return { path: entry.path };
      } catch (error) { alive(captured); throw clean(error); }
    }
    return Object.freeze({ capabilities, list, read, write, uploadChunk, downloadChunk, dispose() { if (disposed) return; disposed = true; client.auth.dispose(); } });
  }
  return Object.freeze({ create, clean, BUCKET, CHUNK_BYTES });
});

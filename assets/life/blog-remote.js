/* Selected private blog documents, borrowing the platform's sole SDK session. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).BlogRemote = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  const PHOTO = /^[A-Za-z0-9_-]{1,128}$/;
  const messages = {
    auth_required: '로그인 계정을 다시 확인해 주세요.', request_cancelled: '계정이나 연결이 바뀌어 이전 요청을 중단했습니다.',
    schema_missing: '서버에 블로그 보관 준비가 필요합니다. 이 브라우저의 글은 유지됩니다.',
    permission_denied: '현재 계정으로 이 글에 접근할 수 없습니다.', invalid_request: '글과 사진의 요청 형식을 확인해 주세요.',
    invalid_remote_data: '서버 글과 사진을 검증하지 못했습니다. 기존 글은 유지됩니다.', network_error: '서버 연결을 확인한 뒤 다시 시도해 주세요. 글과 전송 대기는 유지됩니다.',
    operation_mismatch: '이전 전송 요청과 내용이 달라 적용하지 않았습니다.', remote_missing: '서버의 글을 찾을 수 없습니다.',
    blog_conflict: '두 기기의 글이 다릅니다. 양쪽 글을 보관한 뒤 선택해 주세요.', local_changed: '글이 변경됐습니다. 현재 글을 다시 확인해 주세요.',
    not_enabled: '이 글의 서버 보관을 먼저 선택해 주세요.', sync_paused: '이 글의 연결을 중지했습니다.', storage_quota: '보관 공간이 부족합니다. 글을 파일로 보관한 뒤 다시 시도해 주세요.'
  };
  const fault = code => Object.assign(new Error(messages[code] || messages.network_error), { code });
  const id = value => typeof value === 'string' && UUID.test(value);
  const rev = value => Number.isSafeInteger(value) && value >= 0;
  const clone = value => structuredClone(value);
  function clean(error) {
    if (messages[error?.code]) return fault(error.code);
    if (['invalid_blog_document', 'invalid_blog_photo', 'invalid_blog_snapshot', 'invalid_photo_post', 'invalid_blog_selection'].includes(error?.code)) return fault('invalid_remote_data');
    if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error?.code) || error?.status === 404) return fault('schema_missing');
    if (error?.status === 401 || error?.name === 'AuthSessionMissingError' || error?.message === 'life_blog_auth_required') return fault('auth_required');
    if (error?.status === 403 || error?.statusCode === '403' || error?.code === '42501') return fault('permission_denied');
    if (error?.name === 'AbortError') return fault('request_cancelled');
    if (/operation_mismatch/.test(error?.message || '')) return fault('operation_mismatch');
    if (['22023', '22003', '22001'].includes(error?.code)) return fault('invalid_request');
    return fault('network_error');
  }
  function create({ auth = root.HaedoAuth, blog = root.HaedoLife?.Blog } = {}) {
    if (!auth?.ready || !auth.client?.rpc || typeof auth.verify !== 'function' || !blog?.validateManifest) throw fault('auth_required');
    const client = auth.client, controllers = new Set(); let disposed = false, generation = 0;
    const cancel = () => { generation++; for (const item of controllers) item.abort(); controllers.clear(); };
    let observed = auth.user?.id || null;
    const unlisten = auth.onAccountChange?.(account => { const next = account?.userId || null; if (next !== observed) { observed = next; cancel(); } });
    const capture = () => ({ userId: auth.user?.id, epoch: auth.epoch, generation });
    const guard = context => { if (disposed || context.generation !== generation || context.epoch !== auth.epoch || !context.userId || auth.user?.id !== context.userId) throw fault('request_cancelled'); };
    async function verified(context) {
      guard(context); const user = await auth.verify(); guard(context);
      if (!user || user.id !== context.userId) throw fault('auth_required');
    }
    function manifest(value, postId) {
      try { blog.validateManifest(value); if (value.id !== postId || value.status !== 'saved' || new TextEncoder().encode(JSON.stringify(value)).length > 8 * 1024 * 1024) throw Error(); return clone(value); }
      catch (_) { throw fault('invalid_remote_data'); }
    }
    function identity(value) { if (!id(value)) throw fault('invalid_request'); }
    async function rpc(name, params) {
      const context = capture(), controller = new AbortController(); controllers.add(controller);
      try {
        await verified(context); let request = client.rpc(name, params);
        if (typeof request?.abortSignal === 'function') request = request.abortSignal(controller.signal);
        const response = await request; guard(context); if (response.error) throw response.error;
        await verified(context); return clone(response.data);
      } catch (error) { guard(context); throw clean(error); }
      finally { controllers.delete(controller); }
    }
    async function list(workspaceId = null) {
      if (workspaceId !== null) identity(workspaceId);
      const rows = await rpc('life_blog_list', { p_workspace_id: workspaceId });
      if (!Array.isArray(rows) || rows.length > 200) throw fault('invalid_remote_data');
      const seen = new Set();
      for (const row of rows) {
        if (!id(row?.id) || !id(row.workspace_id) || workspaceId && row.workspace_id !== workspaceId || !rev(row.revision) || row.revision < 1 || typeof row.title !== 'string' || row.title.length > 500 || seen.has(row.id)) throw fault('invalid_remote_data');
        seen.add(row.id);
      }
      return rows;
    }
    async function read(postId) {
      identity(postId); const row = await rpc('life_blog_read', { p_post_id: postId });
      if (row === null) return null;
      if (row?.id !== postId || !id(row.workspace_id) || !rev(row.revision) || row.revision < 1 || !Number.isFinite(Date.parse(row.updated_at))) throw fault('invalid_remote_data');
      row.data = manifest(row.data, postId);
      if (!row.assets || typeof row.assets !== 'object' || Array.isArray(row.assets)) throw fault('invalid_remote_data');
      if (Object.keys(row.assets).length !== row.data.photos.length) throw fault('invalid_remote_data');
      for (const photo of row.data.photos) {
        const asset = row.assets[photo.id];
        if (asset?.bucket !== 'haedo-blog-originals' || typeof asset.path !== 'string' || asset.path !== auth.user.id + '/' + postId + '/' + photo.id + '/' + photo.digest) throw fault('invalid_remote_data');
      }
      if (row.publication !== null && (!id(row.publication?.token) || !id(row.publication.blogToken) || !rev(row.publication.revision) || row.publication.revision < 1 || typeof row.publication.active !== 'boolean')) throw fault('invalid_remote_data');
      return row;
    }
    async function save(request) {
      const { workspaceId, postId, expectedRevision, operationId } = request || {};
      identity(workspaceId); identity(postId); identity(operationId); if (!rev(expectedRevision)) throw fault('invalid_request');
      const data = manifest(request.data, postId);
      const result = await rpc('life_blog_save', { p_workspace_id: workspaceId, p_post_id: postId, p_expected_revision: expectedRevision, p_operation_id: operationId, p_data: data });
      if (!['stored', 'conflict', 'missing'].includes(result?.status) || result.status !== 'missing' && (!rev(result.revision) || result.revision < 1)) throw fault('invalid_remote_data');
      return result;
    }
    async function prepareAsset(postId, photo) {
      identity(postId);
      if (!PHOTO.test(photo?.id || '') || !/^[a-f\d]{64}$/.test(photo.digest || '') || !Number.isSafeInteger(photo.size) || photo.size < 1 || photo.size > 64 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(photo.type) || !Number.isSafeInteger(photo.width) || photo.width < 1 || !Number.isSafeInteger(photo.height) || photo.height < 1) throw fault('invalid_request');
      const context = capture();
      const asset = await rpc('life_blog_prepare_asset', { p_post_id: postId, p_photo_id: photo.id, p_digest: photo.digest, p_bytes: photo.size, p_type: photo.type, p_width: photo.width, p_height: photo.height }); guard(context);
      if (asset?.bucket !== 'haedo-blog-originals' || asset.path !== context.userId + '/' + postId + '/' + photo.id + '/' + photo.digest || typeof asset.exists !== 'boolean') throw fault('invalid_remote_data');
      return asset;
    }
    async function uploadAsset(postId, photo, blob) {
      identity(postId);
      if (!PHOTO.test(photo?.id || '') || !/^[a-f\d]{64}$/.test(photo.digest || '') || !(blob instanceof Blob) || blob.size !== photo.size || blob.type !== photo.type) throw fault('invalid_request');
      const expected = clone({ id: photo.id, digest: photo.digest, size: photo.size, type: photo.type, width: photo.width, height: photo.height });
      const context = capture(); await verified(context);
      const digest = await root.crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); guard(context);
      if (Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') !== expected.digest) throw fault('invalid_remote_data');
      const asset = await prepareAsset(postId, expected); guard(context);
      if (!asset.exists) {
        try { await verified(context); const result = await client.storage.from(asset.bucket).upload(asset.path, blob, { contentType: expected.type, upsert: false }); guard(context); if (result.error) throw result.error; await verified(context); }
        catch (error) { guard(context); throw clean(error); }
      }
      return asset;
    }
    async function downloadAsset(asset) {
      if (asset?.bucket !== 'haedo-blog-originals' || typeof asset.path !== 'string' || !asset.path.startsWith(auth.user?.id + '/')) throw fault('invalid_remote_data');
      const context = capture(); await verified(context);
      try { const result = await client.storage.from(asset.bucket).download(asset.path); guard(context); if (result.error) throw result.error; if (!(result.data instanceof Blob)) throw fault('invalid_remote_data'); await verified(context); return result.data; }
      catch (error) { guard(context); throw clean(error); }
    }
    async function publish(postId, expectedRevision, operationId, options = {}) {
      identity(postId); identity(operationId); if (!rev(expectedRevision) || expectedRevision < 1 || !Array.isArray(options.photoIds || []) || (options.photoIds || []).some(value => !PHOTO.test(value))) throw fault('invalid_request');
      if (!rev(options.expectedPublicRevision ?? 0)) throw fault('invalid_request');
      const result = await rpc('life_blog_publish', { p_post_id: postId, p_expected_revision: expectedRevision, p_expected_publication_revision: options.expectedPublicRevision ?? 0, p_operation_id: operationId, p_photo_ids: clone(options.photoIds || []), p_author: clone(options.author || { name: '', intro: '' }) });
      if (result?.status !== 'published' && result?.status !== 'stored') { if (result?.status === 'conflict') throw fault('blog_conflict'); throw fault('invalid_remote_data'); }
      if (!id(result.token) || !id(result.blogToken) || !rev(result.revision) || result.revision < 1) throw fault('invalid_remote_data');
      return result;
    }
    async function unpublish(postId, expectedRevision, operationId) {
      identity(postId); identity(operationId); if (!rev(expectedRevision) || expectedRevision < 1) throw fault('invalid_request');
      const result = await rpc('life_blog_unpublish', { p_post_id: postId, p_expected_revision: expectedRevision, p_operation_id: operationId });
      if (!['unpublished', 'stored'].includes(result?.status) || !rev(result.revision)) { if (result?.status === 'conflict') throw fault('blog_conflict'); throw fault('invalid_remote_data'); }
      return result;
    }
    return Object.freeze({ list, read, save, prepareAsset, uploadAsset, downloadAsset, publish, unpublish, dispose() { if (!disposed) { disposed = true; cancel(); unlisten?.(); } } });
  }
  return Object.freeze({ create, clean, fault });
});

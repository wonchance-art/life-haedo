/* Private blog documents of the signed-in account, borrowing the platform's sole SDK session. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).BlogRemote = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  const PHOTO = /^[A-Za-z0-9_-]{1,128}$/, DIGEST = /^[a-f\d]{64}$/;
  const BUCKET = 'haedo-blog-originals';
  const ORIGINAL_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
  const VIEW_REQUIRED = ['image/heic', 'image/heif'];
  const COPY_TYPES = ['image/jpeg', 'image/png'];
  const messages = {
    auth_required: '로그인 계정을 다시 확인해 주세요.', request_cancelled: '계정이나 연결이 바뀌어 이전 요청을 중단했습니다.',
    schema_missing: '서버에 블로그 동기화 준비가 필요합니다. 이 기기의 글은 유지됩니다.',
    permission_denied: '현재 계정으로 이 글에 접근할 수 없습니다.', invalid_request: '글과 사진의 요청 형식을 확인해 주세요.',
    invalid_remote_data: '서버 글과 사진을 검증하지 못했습니다. 기존 글은 유지됩니다.', network_error: '서버 연결을 확인하지 못했습니다. 글은 이 기기에 남아 있고 자동으로 다시 시도합니다.',
    operation_mismatch: '이전 전송 요청과 내용이 달라 적용하지 않았습니다.', remote_missing: '서버의 글을 찾을 수 없습니다.',
    blog_conflict: '다른 기기에서 먼저 바뀐 글입니다. 최신 내용을 다시 확인해 주세요.', local_changed: '글이 변경됐습니다. 현재 글을 다시 확인해 주세요.',
    storage_quota: '보관 공간이 부족합니다. 글을 파일로 보관한 뒤 다시 시도해 주세요.',
    blog_publication_unavailable: '이 글의 공개 기능이 아직 준비되지 않았습니다. 저장한 글은 유지됩니다.',
    blog_update_required: '새 형식의 글입니다. 새로고침한 뒤 다시 시도해 주세요. 저장한 글은 유지됩니다.',
    blog_public_copies_required: '공개할 사진 사본을 먼저 준비해야 합니다. 저장한 글과 공개 요청은 유지됩니다.'
  };
  const fault = code => Object.assign(new Error(messages[code] || messages.network_error), { code });
  // Connection failures of publishing, withdrawing and the publication check (2026-11-11). The
  // code stays network_error; the text does not borrow the document-save message, because a
  // publish request is never sent again automatically. "unsent": nothing was recorded or sent.
  // "unconfirmed": the request is recorded and its result is unknown. Only a recorded
  // withdrawal is sent again by itself (BlogSync settles it on the next cycle).
  const publicationMessages = {
    publish_unsent: '공개 게시 요청을 보내지 못했습니다. 공개 상태는 바뀌지 않았습니다. 연결을 확인한 뒤 다시 게시해 주세요.',
    publish_unconfirmed: '공개 게시 결과를 받지 못했습니다. 서버에는 반영됐을 수 있습니다. 공개 상태를 확인하거나 같은 내용으로 다시 게시해 주세요.',
    unpublish_unsent: '공개 철회 요청을 보내지 못했습니다. 공개 상태는 바뀌지 않았습니다. 연결을 확인한 뒤 다시 철회해 주세요.',
    unpublish_unconfirmed: '공개 철회 결과를 받지 못했습니다. 연결되면 철회 요청을 다시 보냅니다. 그때까지 공개 상태일 수 있습니다.',
    settle_failed: '공개 상태를 확인하지 못했습니다. 연결을 확인한 뒤 다시 확인해 주세요.'
  };
  const publicationFault = kind => Object.assign(new Error(publicationMessages[kind] || publicationMessages.settle_failed), { code: 'network_error' });
  const id = value => typeof value === 'string' && UUID.test(value);
  const rev = value => Number.isSafeInteger(value) && value >= 0;
  const clone = value => structuredClone(value);
  const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
  function clean(error) {
    if (messages[error?.code]) return fault(error.code);
    // PostgreSQL returns these specific rollout/version boundaries as 22023.
    // Match only the exact server condition; never surface SQL details or
    // describe an unsupported format as a network failure with automatic retry.
    if (error?.code === '22023' && error.message === 'life_blog_markdown_publication_unavailable') return fault('blog_publication_unavailable');
    if (error?.code === '22023' && error.message === 'life_blog_update_required') return fault('blog_update_required');
    if (['invalid_blog_document', 'invalid_blog_photo', 'invalid_blog_snapshot', 'invalid_photo_post', 'invalid_blog_selection'].includes(error?.code)) return fault('invalid_remote_data');
    if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error?.code) || error?.status === 404) return fault('schema_missing');
    if (error?.status === 401 || error?.name === 'AuthSessionMissingError' || error?.message === 'life_blog_auth_required') return fault('auth_required');
    if (error?.status === 403 || error?.statusCode === '403' || error?.code === '42501') return fault('permission_denied');
    if (error?.name === 'AbortError') return fault('request_cancelled');
    if (/operation_mismatch/.test(error?.message || '')) return fault('operation_mismatch');
    if (['22023', '22003', '22001'].includes(error?.code)) return fault('invalid_request');
    return fault('network_error');
  }
  // One original and, only for HEIC/HEIF, its JPEG view (separate immutable asset).
  function media(value) {
    return plain(value) && DIGEST.test(value.digest || '') && Number.isSafeInteger(value.size) && value.size >= 1 && value.size <= 64 * 1024 * 1024 &&
      Number.isSafeInteger(value.width) && value.width >= 1 && Number.isSafeInteger(value.height) && value.height >= 1;
  }
  function checkViews(manifest) {
    for (const photo of manifest.photos) {
      if (!ORIGINAL_TYPES.includes(photo.type)) return false;
      if (VIEW_REQUIRED.includes(photo.type)) {
        const view = photo.view;
        if (!media(view) || Object.keys(view).sort().join() !== 'digest,height,size,type,width' || view.type !== 'image/jpeg' || view.digest === photo.digest) return false;
      } else if (Object.hasOwn(photo, 'view')) return false;
    }
    return true;
  }
  function create({ auth = root.HaedoAuth, blog = root.HaedoLife?.Blog } = {}) {
    if (!auth?.ready || !auth.client?.rpc || typeof auth.verify !== 'function' || !blog?.validateManifest) throw fault('auth_required');
    const client = auth.client, controllers = new Set(); let disposed = false, generation = 0;
    const cancel = () => { generation++; for (const item of controllers) item.abort(); controllers.clear(); };
    let observed = auth.user?.id || null;
    const unlisten = auth.onAccountChange?.(account => { const next = account?.userId || null; if (next !== observed) { observed = next; cancel(); } });
    const capture = () => ({ userId: auth.user?.id, epoch: auth.epoch, generation });
    // Cheap synchronous identity check before and after every request. The
    // session getter is the SDK session the platform rotates; a different or
    // missing owner cancels the request without another network round trip.
    const sessionOwner = () => ('session' in auth) ? auth.session?.user?.id : auth.user?.id;
    const guard = context => {
      if (disposed || context.generation !== generation || context.epoch !== auth.epoch || !context.userId || auth.user?.id !== context.userId || sessionOwner() !== context.userId) throw fault('request_cancelled');
    };
    // The single network account check of a transfer, and the one right before
    // a durable commit (document save or deletion).
    async function verify(context = capture()) {
      guard(context); const user = await auth.verify(); guard(context);
      if (!user || user.id !== context.userId) throw fault('auth_required');
      return { userId: user.id };
    }
    function manifest(value, postId) {
      try {
        blog.validateManifest(value);
        if (value.id !== postId || !['saved', 'draft'].includes(value.status) || !checkViews(value) || new TextEncoder().encode(JSON.stringify(value)).length > 8 * 1024 * 1024) throw Error();
        return clone(value);
      } catch (_) { throw fault('invalid_remote_data'); }
    }
    function identity(value) { if (!id(value)) throw fault('invalid_request'); }
    async function rpc(name, params, { commit = false } = {}) {
      const context = capture(), controller = new AbortController(); controllers.add(controller);
      let responseError = null, responseStatus = null;
      try {
        if (commit) await verify(context); else guard(context);
        let request = client.rpc(name, params);
        if (typeof request?.abortSignal === 'function') request = request.abortSignal(controller.signal);
        const response = await request; guard(context);
        if (response.error) {
          responseError = response.error; responseStatus = response.status;
          throw responseError;
        }
        return clone(response.data);
      } catch (error) {
        guard(context); const failure = clean(error);
        if (error === responseError && responseStatus === 400 && ['life_blog_publish', 'life_blog_publish_copies'].includes(name) &&
          error?.code === '22023' && error.message === 'life_blog_markdown_publication_unavailable') {
          // Receipt replay precedes this SQL exception. Only this actual RPC
          // response proves rollback; Auth/transport throws and copied flags do
          // not. The caller must inspect it before further normalization.
          Object.defineProperty(failure, 'publicationRolledBack', { value: true });
        }
        throw failure;
      }
      finally { controllers.delete(controller); }
    }
    // The server reads the stored Markdown itself. Only the approved selection,
    // immutable public-copy metadata and durable operation/CAS travel here.
    async function publishMarkdown(params) {
      const context = capture(), controller = new AbortController(); controllers.add(controller);
      try {
        if (typeof client.functions?.invoke !== 'function') throw fault('schema_missing');
        await verify(context);
        const response = await client.functions.invoke('haedo-blog-publish', { body: params, signal: controller.signal });
        guard(context);
        if (response.error) {
          let failure = response.error;
          if (failure.name === 'FunctionsHttpError') {
            const status = failure.context?.status;
            let payload = null;
            try { payload = await failure.context?.json(); } catch (_) { /* No server details are exposed. */ }
            guard(context);
            failure = typeof payload?.code === 'string' && Object.hasOwn(messages, payload.code) ? fault(payload.code) : { status };
          }
          throw failure;
        }
        return clone(response.data);
      } catch (error) { guard(context); throw clean(error); }
      finally { controllers.delete(controller); }
    }
    function publication(value) {
      return value === null || id(value?.token) && id(value.blogToken) && rev(value.revision) && value.revision >= 1 && typeof value.active === 'boolean';
    }
    async function list(workspaceId = null) {
      if (workspaceId !== null) identity(workspaceId);
      const rows = await rpc('life_blog_list', { p_workspace_id: workspaceId });
      if (!Array.isArray(rows) || rows.length > 5000) throw fault('invalid_remote_data');
      const seen = new Set();
      for (const row of rows) {
        if (!id(row?.id) || !id(row.workspace_id) || workspaceId && row.workspace_id !== workspaceId || !rev(row.revision) || row.revision < 1 || typeof row.title !== 'string' || row.title.length > 500 || seen.has(row.id)) throw fault('invalid_remote_data');
        seen.add(row.id);
      }
      return rows;
    }
    // Every saved post and draft head of this account, without bodies.
    async function syncList() {
      const rows = await rpc('life_blog_sync_list', {});
      if (!Array.isArray(rows) || rows.length > 5000) throw fault('invalid_remote_data');
      const seen = new Set();
      for (const row of rows) {
        if (!id(row?.id) || !id(row.workspace_id) || !rev(row.revision) || row.revision < 1 || !['saved', 'draft'].includes(row.status) ||
          typeof row.title !== 'string' || row.title.length > 500 || !Number.isFinite(Date.parse(row.updated_at)) ||
          typeof row.document_updated_at !== 'string' || !Number.isFinite(Date.parse(row.document_updated_at)) ||
          typeof row.archived !== 'boolean' || !publication(row.publication ?? null) || seen.has(row.id)) throw fault('invalid_remote_data');
        row.publication ??= null; seen.add(row.id);
      }
      return rows;
    }
    function assetPath(userId, postId, photoId, digest) { return userId + '/' + postId + '/' + photoId + '/' + digest; }
    async function read(postId) {
      identity(postId); const context = capture(); const row = await rpc('life_blog_read', { p_post_id: postId });
      if (row === null) return null;
      if (row?.id !== postId || !id(row.workspace_id) || !rev(row.revision) || row.revision < 1 || !Number.isFinite(Date.parse(row.updated_at))) throw fault('invalid_remote_data');
      row.data = manifest(row.data, postId);
      if (!plain(row.assets)) throw fault('invalid_remote_data');
      if (Object.keys(row.assets).length !== row.data.photos.length) throw fault('invalid_remote_data');
      for (const photo of row.data.photos) {
        const asset = row.assets[photo.id];
        if (asset?.bucket !== BUCKET || asset.path !== assetPath(context.userId, postId, photo.id, photo.digest)) throw fault('invalid_remote_data');
        if (photo.view) {
          if (asset.view?.bucket !== BUCKET || asset.view.path !== assetPath(context.userId, postId, photo.id, photo.view.digest) || Object.keys(asset).length !== 3) throw fault('invalid_remote_data');
        } else if (Object.keys(asset).length !== 2) throw fault('invalid_remote_data');
      }
      row.publication ??= null;
      if (!publication(row.publication)) throw fault('invalid_remote_data');
      return row;
    }
    async function save(request) {
      const { workspaceId, postId, expectedRevision, operationId } = request || {};
      identity(workspaceId); identity(postId); identity(operationId); if (!rev(expectedRevision)) throw fault('invalid_request');
      const data = manifest(request.data, postId);
      const result = await rpc('life_blog_save', { p_workspace_id: workspaceId, p_post_id: postId, p_expected_revision: expectedRevision, p_operation_id: operationId, p_data: data }, { commit: true });
      if (!['stored', 'conflict', 'missing'].includes(result?.status) || result.status !== 'missing' && (!rev(result.revision) || result.revision < 1)) throw fault('invalid_remote_data');
      return result;
    }
    function checkMedia(value) {
      if (!PHOTO.test(value?.id || '') || !media(value) || !ORIGINAL_TYPES.includes(value.type)) throw fault('invalid_request');
    }
    async function prepareAsset(postId, item) {
      identity(postId); checkMedia(item);
      const context = capture();
      const asset = await rpc('life_blog_prepare_asset', { p_post_id: postId, p_photo_id: item.id, p_digest: item.digest, p_bytes: item.size, p_type: item.type, p_width: item.width, p_height: item.height }); guard(context);
      if (asset?.bucket !== BUCKET || asset.path !== assetPath(context.userId, postId, item.id, item.digest) || typeof asset.exists !== 'boolean') throw fault('invalid_remote_data');
      return asset;
    }
    // `item` is either an original ({id,digest,size,type,width,height}) or a
    // view of the same photo id with its own digest and metadata.
    async function uploadAsset(postId, item, blob) {
      identity(postId); checkMedia(item);
      if (!(blob instanceof Blob) || blob.size !== item.size || blob.type !== item.type) throw fault('invalid_request');
      const expected = clone({ id: item.id, digest: item.digest, size: item.size, type: item.type, width: item.width, height: item.height });
      const context = capture(); guard(context);
      const digest = await root.crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); guard(context);
      if (Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') !== expected.digest) throw fault('invalid_remote_data');
      const asset = await prepareAsset(postId, expected); guard(context);
      if (!asset.exists) {
        try { const result = await client.storage.from(asset.bucket).upload(asset.path, blob, { contentType: expected.type, upsert: false }); guard(context); if (result.error) throw result.error; }
        catch (error) { guard(context); throw clean(error); }
      }
      return asset;
    }
    // A transfer in progress is aborted by an account change or dispose (cancel), like the RPCs
    // (2026-11-04: before, up to six started photo downloads ran to the end and were then thrown away).
    // The bundled storage-js (2.117.2) passes download()'s third argument into the GET fetch options.
    async function downloadAsset(asset) {
      const context = capture(); guard(context);
      if (asset?.bucket !== BUCKET || typeof asset.path !== 'string' || !asset.path.startsWith(context.userId + '/')) throw fault('invalid_remote_data');
      const controller = new AbortController(); controllers.add(controller);
      try { const result = await client.storage.from(asset.bucket).download(asset.path, undefined, { signal: controller.signal }); guard(context); if (result.error) throw result.error; if (!(result.data instanceof Blob)) throw fault('invalid_remote_data'); return result.data; }
      catch (error) { guard(context); throw clean(error); }
      finally { controllers.delete(controller); }
    }
    // A metadata-free public copy of one photo (any format) of a stored post
    // (2026-11-02). Registered by its own RPC, so the server can tell it from
    // the private original; same immutable private bucket and path pattern.
    function checkCopy(value) {
      if (!PHOTO.test(value?.id || '') || !media(value) || !COPY_TYPES.includes(value.type)) throw fault('invalid_request');
    }
    async function uploadPublicCopy(postId, item, blob) {
      identity(postId); checkCopy(item);
      if (!(blob instanceof Blob) || blob.size !== item.size || blob.type !== item.type) throw fault('invalid_request');
      const expected = clone({ id: item.id, digest: item.digest, size: item.size, type: item.type, width: item.width, height: item.height });
      const context = capture(); guard(context);
      const digest = await root.crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); guard(context);
      if (Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') !== expected.digest) throw fault('invalid_remote_data');
      const asset = await rpc('life_blog_publish_prepare_copy', { p_post_id: postId, p_photo_id: expected.id, p_digest: expected.digest, p_bytes: expected.size, p_type: expected.type, p_width: expected.width, p_height: expected.height }); guard(context);
      if (asset?.bucket !== BUCKET || asset.path !== assetPath(context.userId, postId, expected.id, expected.digest) || typeof asset.exists !== 'boolean') throw fault('invalid_remote_data');
      if (!asset.exists) {
        try { const result = await client.storage.from(asset.bucket).upload(asset.path, blob, { contentType: expected.type, upsert: false }); guard(context); if (result.error) throw result.error; }
        catch (error) { guard(context); throw clean(error); }
      }
      return asset;
    }
    // Explicit owner deletion of one private post. Returns the exact original
    // paths that became removable; `removeAssets` deletes only those objects.
    async function deletePost(postId, expectedRevision = null) {
      identity(postId); if (expectedRevision !== null && (!rev(expectedRevision) || expectedRevision < 1)) throw fault('invalid_request');
      const context = capture();
      const result = await rpc('life_blog_delete', { p_post_id: postId, p_expected_revision: expectedRevision }, { commit: true });
      // 'conflict': a newer revision exists; 'published': the post is public (withdraw first). Neither deletes anything.
      const kept = result?.status === 'conflict' || result?.status === 'published';
      if (!['deleted', 'missing', 'conflict', 'published'].includes(result?.status) || !rev(result.revision) || !kept && (!Array.isArray(result.paths) || result.paths.length > 64)) throw fault('invalid_remote_data');
      if (!kept && result.paths.some(path => typeof path !== 'string' || !path.startsWith(context.userId + '/' + postId + '/'))) throw fault('invalid_remote_data');
      return result;
    }
    async function removeAssets(postId, paths) {
      identity(postId); const context = capture(); guard(context);
      if (!Array.isArray(paths) || paths.length > 64 || paths.some(path => typeof path !== 'string' || !/^[^/]+\/[^/]+\/[A-Za-z0-9_-]{1,128}\/[a-f\d]{64}$/.test(path) || !path.startsWith(context.userId + '/' + postId + '/'))) throw fault('invalid_request');
      if (!paths.length) return 0;
      try { const result = await client.storage.from(BUCKET).remove(clone(paths)); guard(context); if (result.error) throw result.error; return Array.isArray(result.data) ? result.data.length : 0; }
      catch (error) { guard(context); throw clean(error); }
    }
    // `copies` names the uploaded public copy of every selected photo. A
    // text-only publication names none and uses the earlier RPC unchanged.
    async function publish(postId, expectedRevision, operationId, options = {}) {
      identity(postId); identity(operationId); if (!rev(expectedRevision) || expectedRevision < 1 || !Array.isArray(options.photoIds || []) || (options.photoIds || []).some(value => !PHOTO.test(value))) throw fault('invalid_request');
      if (!rev(options.expectedPublicRevision ?? 0)) throw fault('invalid_request');
      if (Object.hasOwn(options, 'documentFormat') && options.documentFormat !== 'life-post-md-v1') throw fault('invalid_request');
      const markdown = options.documentFormat === 'life-post-md-v1';
      const selected = options.photoIds === undefined ? [] : options.photoIds;
      const author = options.author === undefined ? { name: '', intro: '' } : options.author;
      if (markdown) {
        // Reject unexpected nested data before account verification or transfer.
        // The legacy RPC contract remains unchanged for old durable requests.
        const safeString = (value, limit) => typeof value === 'string' && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(value);
        if (!Array.isArray(selected) || selected.length > 20 || new Set(selected).size !== selected.length || Array.from(selected).some(value => typeof value !== 'string' || !PHOTO.test(value)) ||
          !plain(author) || ![Object.prototype, null].includes(Object.getPrototypeOf(author)) || Reflect.ownKeys(author).length !== 2 || !Object.hasOwn(author, 'name') || !Object.hasOwn(author, 'intro') ||
          !safeString(author.name, 500) || !safeString(author.intro, 2000)) throw fault('invalid_request');
      }
      const copies = markdown ? (options.copies === undefined ? [] : options.copies) : options.copies || [];
      if (!Array.isArray(copies) || copies.length > 20) throw fault('invalid_request');
      const named = {};
      for (const item of copies) {
        checkCopy(item);
        if (Object.hasOwn(named, item.id) || !(options.photoIds || []).includes(item.id)) throw fault('invalid_request');
        const metadata = { type: item.type, size: item.size, digest: item.digest, width: item.width, height: item.height };
        if (markdown) Object.defineProperty(named, item.id, { value: metadata, enumerable: true });
        else named[item.id] = metadata;
      }
      if (markdown && selected.some(photoId => !Object.hasOwn(named, photoId))) throw fault('invalid_request');
      const params = { p_post_id: postId, p_expected_revision: expectedRevision, p_expected_publication_revision: options.expectedPublicRevision ?? 0, p_operation_id: operationId, p_photo_ids: clone(options.photoIds || []), p_author: clone(markdown ? author : options.author || { name: '', intro: '' }) };
      const result = markdown
        ? await publishMarkdown({ ...params, p_copies: named })
        : copies.length ? await rpc('life_blog_publish_copies', { ...params, p_copies: named }, { commit: true }) : await rpc('life_blog_publish', params, { commit: true });
      if (result?.status !== 'published' && result?.status !== 'stored') { if (result?.status === 'conflict') throw fault('blog_conflict'); throw fault('invalid_remote_data'); }
      if (!id(result.token) || !id(result.blogToken) || !rev(result.revision) || result.revision < 1) throw fault('invalid_remote_data');
      return result;
    }
    async function unpublish(postId, expectedRevision, operationId) {
      identity(postId); identity(operationId); if (!rev(expectedRevision) || expectedRevision < 1) throw fault('invalid_request');
      const result = await rpc('life_blog_unpublish', { p_post_id: postId, p_expected_revision: expectedRevision, p_operation_id: operationId }, { commit: true });
      if (!['unpublished', 'stored'].includes(result?.status) || !rev(result.revision)) { if (result?.status === 'conflict') throw fault('blog_conflict'); throw fault('invalid_remote_data'); }
      return result;
    }
    return Object.freeze({ verify: () => verify(), list, syncList, read, save, prepareAsset, uploadAsset, uploadPublicCopy, downloadAsset, deletePost, removeAssets, publish, unpublish,
      dispose() { if (!disposed) { disposed = true; cancel(); unlisten?.(); } } });
  }
  return Object.freeze({ create, clean, fault, publicationFault, checkViews });
});

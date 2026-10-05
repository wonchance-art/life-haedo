/* Owner publishing borrows the verified SDK. Public reading has no account/session dependency. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  root.HaedoLife ||= {}; root.HaedoLife.ShareRemote = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  const PREFIX = 'life_share_pending_v1:';
  const messages = {
    auth_required: '게시 상태를 확인하려면 다시 로그인해 주세요.', request_cancelled: '계정 또는 화면이 바뀌어 이전 요청을 중단했습니다.',
    invalid_config: '공개 페이지 연결 설정을 확인해 주세요.', invalid_request: '게시 요청의 형식을 확인해 주세요.',
    invalid_snapshot: '서버가 공개 사본의 형식을 확인하지 못했습니다. 게시할 내용을 다시 검토해 주세요.',
    invalid_remote_data: '서버의 게시 결과를 확인하지 못했습니다.', network_error: '서버에 연결하지 못했습니다. 다시 시도해 주세요.',
    schema_missing: '공개 페이지 저장소가 아직 준비되지 않았습니다.', permission_denied: '이 계정의 게시 권한을 확인하지 못했습니다.',
    pending_storage_failed: '게시 시도 보관에 실패해 전송하지 않았습니다. 브라우저 저장 공간을 확인해 주세요.',
    pending_corrupt: '이 브라우저의 미확인 게시 요청을 읽지 못했습니다. 기존 요청을 보존했습니다.',
    pending_operation: '결과를 확인하지 못한 게시 요청이 있습니다. 같은 요청을 다시 확인해 주세요.',
    publish_unknown: '게시 요청의 결과를 확인하지 못했습니다. 상태를 조회하거나 같은 요청을 재시도해 주세요.',
    operation_mismatch: '서버에 보관한 작업과 요청 내용이 다릅니다. 게시 상태를 다시 확인해 주세요.'
  };
  function fault(code) { return Object.assign(new Error(messages[code] || messages.invalid_request), { code }); }
  function assert(value, code = 'invalid_request') { if (!value) throw fault(code); }
  function model() {
    const value = root.HaedoLife?.Share || (typeof require === 'function' ? require('./share.js') : null);
    assert(value?.validate, 'invalid_config'); return value;
  }
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  function fields(value, allowed, required = allowed, code = 'invalid_remote_data') {
    assert(plain(value) && Reflect.ownKeys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)), code);
  }
  function uuid(value, code = 'invalid_request') { assert(typeof value === 'string' && UUID.test(value), code); return value.toLowerCase(); }
  function revision(value, min = 0, code = 'invalid_remote_data') { assert(Number.isSafeInteger(value) && value >= min, code); }
  function timestamp(value) { assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)), 'invalid_remote_data'); }
  function clone(value, code = 'invalid_remote_data') {
    try {
      const text = JSON.stringify(value);
      assert(typeof text === 'string' && new TextEncoder().encode(text).length <= model().LIMITS.bytes + 16384, code);
      return JSON.parse(text);
    } catch (error) { if (error.code) throw error; throw fault(code); }
  }
  function config(input) {
    let url;
    try { url = new URL(input?.url); } catch (_) { throw fault('invalid_config'); }
    assert(url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'invalid_config');
    const key = input?.key;
    assert(typeof key === 'string' && key.length < 8192 && !/^sb_secret_/i.test(key), 'invalid_config');
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
      try {
        const parts = key.split('.'); assert(parts.length === 3 && parts.every(Boolean), 'invalid_config');
        const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        assert(JSON.parse(root.atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))).role === 'anon', 'invalid_config');
      } catch (_) { throw fault('invalid_config'); }
    }
    return Object.freeze({ url: url.origin, key });
  }
  function ownerMetadata(value) {
    fields(value, ['status', 'revision', 'publicId', 'updatedAt', 'lastOperationId']);
    assert(['missing', 'published', 'revoked'].includes(value.status), 'invalid_remote_data');
    revision(value.revision, value.status === 'missing' ? 0 : 1);
    if (value.status === 'missing') {
      assert(value.revision === 0 && value.publicId === null && value.updatedAt === null && value.lastOperationId === null, 'invalid_remote_data');
    } else {
      if (value.status === 'published') uuid(value.publicId, 'invalid_remote_data');
      else assert(value.publicId === null, 'invalid_remote_data');
      timestamp(value.updatedAt); uuid(value.lastOperationId, 'invalid_remote_data');
    }
    return Object.freeze({ ...value });
  }
  function writeResult(value) {
    if (value?.status === 'missing') { fields(value, ['status']); return Object.freeze({ status: 'missing' }); }
    if (value?.status === 'conflict') { fields(value, ['status', 'revision']); revision(value.revision); return Object.freeze({ ...value }); }
    fields(value, ['status', 'revision', 'publicId', 'published', 'updatedAt', 'action']);
    assert(value.status === 'stored' && typeof value.published === 'boolean' && ['publish', 'revoke'].includes(value.action), 'invalid_remote_data');
    assert(value.published === (value.action === 'publish'), 'invalid_remote_data'); revision(value.revision, 1); timestamp(value.updatedAt);
    if (value.published) uuid(value.publicId, 'invalid_remote_data'); else assert(value.publicId === null, 'invalid_remote_data');
    return Object.freeze({ ...value });
  }
  function request(input) {
    fields(input, ['workspaceId', 'expectedRevision', 'operationId', 'action', 'snapshot'], undefined, 'invalid_request');
    uuid(input.workspaceId); uuid(input.operationId); revision(input.expectedRevision, 0, 'invalid_request');
    assert(['publish', 'revoke'].includes(input.action));
    if (input.action === 'publish') model().validate(input.snapshot); else assert(input.snapshot === null);
    // Copy before verification or network calls can yield to a caller editing its draft.
    const value = clone(input, 'invalid_request');
    value.workspaceId = uuid(value.workspaceId); value.operationId = uuid(value.operationId);
    return value;
  }
  function remoteError(error, { write = false } = {}) {
    if (error?.code && Object.hasOwn(messages, error.code)) return error;
    if (['PGRST202', 'PGRST205', '42883', '42P01'].includes(error?.code) || error?.status === 404)
      return Object.assign(fault('schema_missing'), { definitiveNoWrite: true });
    if (['life_public_operation_mismatch', 'life_share_operation_mismatch'].includes(error?.message)) return fault('operation_mismatch');
    if (error?.code === '22023' && ['life_share_invalid_snapshot', 'life_share_invalid_request'].includes(error?.message))
      return Object.assign(fault(error.message === 'life_share_invalid_snapshot' ? 'invalid_snapshot' : 'invalid_request'), { definitiveNoWrite: true });
    if (error?.code === '22003' && error?.message === 'life_share_revision_limit')
      return Object.assign(fault('invalid_request'), { definitiveNoWrite: true });
    if (error?.message === 'life_share_auth_required') return fault('auth_required');
    if (error?.status === 401 || ['PGRST301', 'PGRST302', 'PGRST303'].includes(error?.code)) return fault('auth_required');
    if (error?.status === 403 || error?.code === '42501') return fault('permission_denied');
    return fault(write ? 'publish_unknown' : 'network_error');
  }
  function createOwner(options = {}) {
    const auth = options.auth || root.HaedoAuth;
    assert(auth?.ready && auth.client?.rpc && typeof auth.verify === 'function', 'auth_required');
    const connection = config(auth.config);
    let storage = options.storage;
    if (!storage) { try { storage = root.sessionStorage; } catch (_) {} }
    let disposed = false, epoch = 0, accountId = auth.user?.id || null;
    const controllers = new Set();
    function cancel() { epoch++; for (const controller of controllers) controller.abort(); controllers.clear(); }
    function changed(next) { if (accountId !== next) cancel(); accountId = next; }
    const unsubscribe = auth.onAccountChange?.(value => changed(value?.userId || null));
    const subscription = auth.client.auth?.onAuthStateChange?.((_name, session) => changed(session?.user?.id || null))?.data?.subscription;
    function alive(context) {
      assert(!disposed && (!context || context.epoch === epoch), 'request_cancelled');
      if (context) assert(auth.user?.id === context.uid && auth.epoch === context.authEpoch && accountId === context.uid, 'request_cancelled');
    }
    async function authorized() {
      alive(); const expected = epoch, authEpoch = auth.epoch, prior = auth.user?.id;
      const user = await auth.verify();
      assert(!disposed && expected === epoch && authEpoch === auth.epoch, 'request_cancelled');
      assert(user && auth.user?.id === user.id, 'auth_required'); uuid(user.id);
      assert(!prior || prior === user.id, 'request_cancelled'); accountId = user.id;
      return { epoch, authEpoch: auth.epoch, uid: user.id };
    }
    function current() {
      alive(); const uid = auth.user?.id; assert(uid && accountId === uid, 'auth_required'); uuid(uid);
      return { uid, epoch, authEpoch: auth.epoch };
    }
    const key = (uid, workspaceId) => PREFIX + encodeURIComponent(JSON.stringify([connection.url, uid, workspaceId]));
    function load(context, workspaceId) {
      alive(context); workspaceId = uuid(workspaceId);
      let saved;
      try { assert(storage?.getItem && storage?.setItem && storage?.removeItem, 'pending_storage_failed'); saved = storage.getItem(key(context.uid, workspaceId)); }
      catch (_) { throw fault('pending_storage_failed'); }
      if (saved === null) return null;
      try { const value = request(JSON.parse(saved)); assert(value.workspaceId === workspaceId); return value; }
      catch (_) { throw fault('pending_corrupt'); }
    }
    function pending(workspaceId) { return load(current(), workspaceId); }
    function save(context, value) {
      const previous = load(context, value.workspaceId);
      if (previous) assert(JSON.stringify(previous) === JSON.stringify(value), 'pending_operation');
      const serialized = JSON.stringify(value);
      try {
        storage.setItem(key(context.uid, value.workspaceId), serialized);
        assert(storage.getItem(key(context.uid, value.workspaceId)) === serialized, 'pending_storage_failed');
      } catch (_) { throw fault('pending_storage_failed'); }
      alive(context);
    }
    function clear(context, value) {
      alive(context);
      try {
        const found = load(context, value.workspaceId);
        if (found && JSON.stringify(found) === JSON.stringify(value)) storage.removeItem(key(context.uid, value.workspaceId));
      } catch (_) { /* The definitive response remains valid; an identical retry is harmless. */ }
    }
    async function rpc(context, name, args, write = false) {
      alive(context); const controller = new AbortController(); controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
      try {
        const result = await auth.client.rpc(name, args).abortSignal(controller.signal);
        alive(context); if (result.error) throw result.error;
        return clone(result.data);
      } catch (error) { alive(context); throw remoteError(error, { write }); }
      finally { clearTimeout(timer); controllers.delete(controller); }
    }
    async function get(workspaceId) {
      workspaceId = uuid(workspaceId);
      try { const context = await authorized(); return ownerMetadata(await rpc(context, 'life_public_page_get', { p_workspace_id: workspaceId })); }
      catch (error) { throw remoteError(error); }
    }
    async function list(after = null) {
      if (after !== null) after = uuid(after);
      try {
        const context = await authorized(), value = await rpc(context, 'life_public_page_list', { p_after: after });
        fields(value, ['pages', 'nextCursor']);
        assert(Array.isArray(value.pages) && value.pages.length <= 50, 'invalid_remote_data');
        if (value.nextCursor !== null) uuid(value.nextCursor, 'invalid_remote_data');
        const seen = new Set();
        const pages = value.pages.map(page => {
          fields(page, ['workspaceId', 'title', 'revision', 'publicId', 'updatedAt', 'lastOperationId']);
          const workspaceId = uuid(page.workspaceId, 'invalid_remote_data');
          assert(!seen.has(workspaceId), 'invalid_remote_data'); seen.add(workspaceId);
          assert(typeof page.title === 'string' && page.title.trim().length > 0 && page.title.length <= model().LIMITS.title &&
            !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(page.title), 'invalid_remote_data');
          ownerMetadata({ status: 'published', revision: page.revision, publicId: page.publicId,
            updatedAt: page.updatedAt, lastOperationId: page.lastOperationId });
          return Object.freeze({ ...page, workspaceId });
        });
        if (value.nextCursor !== null) assert(pages.length > 0 && value.nextCursor.toLowerCase() === pages.at(-1).workspaceId &&
          value.nextCursor.toLowerCase() !== after, 'invalid_remote_data');
        return Object.freeze({ pages: Object.freeze(pages), nextCursor: value.nextCursor?.toLowerCase() || null });
      } catch (error) { throw remoteError(error); }
    }
    async function put(input) {
      const value = request(input), context = await authorized(); alive(context); save(context, value);
      let data;
      try {
        data = await rpc(context, 'life_public_page_put', { p_workspace_id: value.workspaceId,
          p_expected_revision: value.expectedRevision, p_operation_id: value.operationId,
          p_action: value.action, p_snapshot: value.snapshot }, true);
      } catch (error) {
        // These exact PostgreSQL exceptions roll the transaction back, or the RPC does not exist.
        // They are safe to replace with a corrected request; ambiguous transport errors are not.
        if (error.definitiveNoWrite) clear(context, value);
        throw error;
      }
      let result;
      try { result = writeResult(data); }
      catch (_) { throw fault('publish_unknown'); }
      if (result.status === 'stored' && result.action !== value.action) throw fault('publish_unknown');
      if (result.status === 'stored' && result.revision !== value.expectedRevision + 1) throw fault('publish_unknown');
      clear(context, value);
      return result;
    }
    async function retryPending(workspaceId) {
      const value = pending(workspaceId); assert(value, 'invalid_request'); return put(value);
    }
    function dispose() {
      if (disposed) return; disposed = true; cancel(); unsubscribe?.(); subscription?.unsubscribe();
      // The common SDK, tokens and account remain owned by HaedoAuth.
    }
    return Object.freeze({ get, readOwner: get, list, put, pending, retryPending, dispose });
  }
  function createReader(options = {}) {
    const connection = config(options.config || root.HAEDO_CONFIG), fetcher = options.fetch || root.fetch?.bind(root);
    assert(typeof fetcher === 'function', 'invalid_config');
    let disposed = false, epoch = 0;
    const controllers = new Set();
    async function read(publicId) {
      publicId = uuid(publicId); assert(!disposed, 'request_cancelled'); const captured = epoch;
      const controller = new AbortController(); controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
      try {
        const response = await fetcher(connection.url + '/rest/v1/rpc/life_public_page_read', {
          method: 'POST', headers: { apikey: connection.key, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          body: JSON.stringify({ p_public_id: publicId }), credentials: 'omit', redirect: 'error', cache: 'no-store',
          referrerPolicy: 'no-referrer', signal: controller.signal
        });
        assert(!disposed && captured === epoch, 'request_cancelled');
        if (!response.ok) throw { status: response.status };
        const text = await response.text(); assert(!disposed && captured === epoch, 'request_cancelled');
        assert(new TextEncoder().encode(text).length <= model().LIMITS.bytes + 16384, 'invalid_remote_data');
        let value; try { value = JSON.parse(text); } catch (_) { throw fault('invalid_remote_data'); }
        if (value?.status === 'missing') { fields(value, ['status']); return Object.freeze({ status: 'missing' }); }
        fields(value, ['status', 'publicId', 'revision', 'updatedAt', 'snapshot']);
        assert(value.status === 'published' && typeof value.publicId === 'string' && value.publicId.toLowerCase() === publicId, 'invalid_remote_data');
        uuid(value.publicId, 'invalid_remote_data'); revision(value.revision, 1); timestamp(value.updatedAt);
        try { model().validate(value.snapshot); } catch (_) { throw fault('invalid_remote_data'); }
        return value;
      } catch (error) {
        assert(!disposed && captured === epoch, 'request_cancelled'); throw remoteError(error);
      } finally { clearTimeout(timer); controllers.delete(controller); }
    }
    function dispose() { if (disposed) return; disposed = true; epoch++; for (const controller of controllers) controller.abort(); controllers.clear(); }
    return Object.freeze({ read, dispose });
  }
  return Object.freeze({ createOwner, createReader });
});

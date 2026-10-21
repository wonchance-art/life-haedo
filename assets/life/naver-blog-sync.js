/* Private Naver inbox transport and additive local receipt. No publication. */
(function (root, factory) {
  'use strict';
  const api = factory(root); (root.HaedoLife ||= {}).NaverBlogSync = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  const FIELDS = ['id', 'blog_id', 'log_no', 'title', 'url', 'content_text', 'content_hash', 'published_at', 'fetched_at', 'coverage'];
  const messages = {
    naver_setup_required: '블로그 연결은 보관할 수 있습니다. 서버 수집기는 아직 준비 중입니다.',
    naver_schema_missing: '네이버 블로그 연결 저장소가 아직 설치되지 않았습니다. 입력한 아이디는 그대로 있습니다.',
    naver_conflict: '다른 화면에서 연결이 변경되었습니다. 목록을 다시 불러와 확인해 주세요.',
    naver_cancelled: '계정이나 화면이 바뀌어 이전 작업을 중지했습니다.',
    naver_invalid_data: '서버에서 받은 블로그 자료를 확인하지 못했습니다. 기존 자료는 유지됩니다.',
    naver_ambiguous: '같은 주소의 자료가 여러 개 있습니다. 기존 자료를 확인해 주세요.',
    naver_receive_conflict: '자료가 변경되어 보관을 마치지 못했습니다. 기존 자료는 유지됩니다. 다시 시도해 주세요.',
    naver_network_error: '블로그 연결 요청을 완료하지 못했습니다. 입력과 기존 자료는 유지됩니다.',
    naver_auth_required: '로그인을 확인한 뒤 다시 시도해 주세요.'
  };
  function fault(code) { return Object.assign(new Error(messages[code] || messages.naver_network_error), { code }); }
  function check(value, code = 'naver_invalid_data') { if (!value) throw fault(code); }
  function clean(error) {
    if (messages[error?.code]) return error;
    if (error?.message === 'life_naver_setup_required') return fault('naver_setup_required');
    if (error?.message === 'life_naver_conflict') return fault('naver_conflict');
    if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error?.code)) return fault('naver_schema_missing');
    if (error?.code === '42501' || error?.status === 401) return fault('naver_auth_required');
    return fault('naver_network_error');
  }
  function create({ storage, auth = root.HaedoAuth, core = root.HaedoLife?.Core, model = root.HaedoLife?.NaverBlog, isCurrent = () => true } = {}) {
    check(storage?.isAccountScoped && storage.account && auth?.client?.rpc && auth?.verify && core && model, 'naver_auth_required');
    const owner = { ...storage.account }, client = auth.client;
    let disposed = false, generation = 0;
    const controllers = new Set();
    const cancel = () => { generation++; for (const controller of controllers) controller.abort(); controllers.clear(); };
    const unlisten = auth.onAccountChange?.(() => { if (auth.getAccount?.()?.userId !== owner.userId) cancel(); });
    function guard(context) {
      check(!disposed && generation === context.generation && auth.epoch === context.epoch && isCurrent(context.workspaceId) &&
        auth.user?.id === owner.userId && auth.getAccount?.()?.userId === owner.userId &&
        auth.getAccount?.()?.projectUrl === owner.projectUrl, 'naver_cancelled');
    }
    function capture(workspaceId) { return { generation, epoch: auth.epoch, workspaceId }; }
    async function step(context, action) { guard(context); const value = await action(); guard(context); return value; }
    async function verify(context) {
      const user = await step(context, () => auth.verify()); check(user?.id === owner.userId, 'naver_auth_required');
    }
    async function rpc(context, name, args) {
      await verify(context);
      const controller = new AbortController(); controllers.add(controller);
      try {
        let request = client.rpc(name, args);
        if (request?.abortSignal) request = request.abortSignal(controller.signal);
        const response = await step(context, () => request);
        if (response.error) throw response.error;
        return response.data;
      } catch (error) { guard(context); throw clean(error); }
      finally { controllers.delete(controller); }
    }
    function workspace(id) { check(UUID.test(id || '')); }
    function subscription(row, workspaceId) {
      check(row && UUID.test(row.id) && row.workspace_id === workspaceId && typeof row.enabled === 'boolean' &&
        Number.isSafeInteger(row.revision) && row.revision > 0 && model.parseBlog(row.blog_id).blogId === row.blog_id);
      return { ...row };
    }
    async function item(row, subscriptions) {
      check(row && UUID.test(row.id) && row.owner_id === owner.userId &&
        subscriptions.some(sub => sub.id === row.subscription_id && sub.blog_id === row.blog_id));
      const value = Object.fromEntries(FIELDS.map(key => [key, row[key]]));
      model.toImportInput(value);
      if (value.content_text !== null) {
        const actual = Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.content_text))), n => n.toString(16).padStart(2, '0')).join('');
        check(actual === value.content_hash);
      }
      return value;
    }
    async function readPage(context, workspaceId, before = null) {
      const data = await rpc(context, 'life_naver_list', { p_workspace_id: workspaceId, p_limit: 100, p_before: before });
      check(data && typeof data.ready === 'boolean' && Array.isArray(data.subscriptions) && data.subscriptions.length <= 20 &&
        Array.isArray(data.items) && data.items.length <= 100 && typeof data.has_more === 'boolean');
      const subscriptions = data.subscriptions.map(row => subscription(row, workspaceId));
      check(new Set(subscriptions.map(row => row.id)).size === subscriptions.length);
      const items = [];
      for (const row of data.items) items.push(await step(context, () => item(row, subscriptions)));
      if (data.has_more) check(data.next_cursor && typeof data.next_cursor.fetched_at === 'string' && UUID.test(data.next_cursor.id));
      else check(data.next_cursor === null);
      return { subscriptions, items, ready: data.ready, hasMore: data.has_more, nextCursor: data.next_cursor };
    }
    async function list(workspaceId, { before = null } = {}) {
      workspace(workspaceId); const context = capture(workspaceId);
      const page = await readPage(context, workspaceId, before);
      let bundle = await step(context, () => storage.read(workspaceId));
      let receivedCount = 0, autoReceiveError = null;
      // Opt-in applies only to this registered blog and workspace. Closed apps
      // retain captures on the server; local projection occurs when opened here.
      if (page.ready) for (const value of page.items) {
        if (!page.subscriptions.some(sub => sub.enabled && sub.blog_id === value.blog_id)) continue;
        const row = model.project([value], bundle)[0];
        if (row.status !== 'new') continue;
        try {
          const received = await receiveFound(context, workspaceId, value);
          if (!received.alreadyReceived) receivedCount++;
          bundle = await step(context, () => storage.read(workspaceId));
        } catch (error) {
          guard(context); autoReceiveError = clean(error).message; break;
        }
      }
      return { ...page, bundle, items: model.project(page.items, bundle), receivedCount, autoReceiveError };
    }
    async function save(workspaceId, { blogId, expectedRevision = 0, enabled = false }) {
      workspace(workspaceId); const context = capture(workspaceId), parsed = model.parseBlog(blogId);
      check(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 && typeof enabled === 'boolean');
      const row = await rpc(context, 'life_naver_save', { p_workspace_id: workspaceId, p_blog_id: parsed.blogId,
        p_expected_revision: expectedRevision, p_enabled: enabled });
      return subscription(row, workspaceId);
    }
    async function checkRemote(workspaceId, subscriptionId) {
      workspace(workspaceId); check(UUID.test(subscriptionId)); const context = capture(workspaceId);
      await verify(context);
      check(client.functions?.invoke, 'naver_setup_required');
      const controller = new AbortController(); controllers.add(controller);
      try {
        const response = await step(context, () => client.functions.invoke('haedo-naver-blog', {
          body: { subscriptionId }, signal: controller.signal
        }));
        if (response.data?.error === 'setup_required') throw fault('naver_setup_required');
        if (response.error) throw clean(response.error);
        check(response.data?.status === 'checked' || response.data?.status === 'busy');
        return response.data;
      } finally { controllers.delete(controller); }
    }
    async function receive(workspaceId, itemId) {
      workspace(workspaceId); check(UUID.test(itemId)); const context = capture(workspaceId);
      // Read the actual immutable server item, never trust a UI row or stale page.
      let before = null, found = null;
      const seen = new Set();
      for (let pageNo = 0; pageNo < 100; pageNo++) {
        const page = await readPage(context, workspaceId, before);
        found = page.items.find(value => value.id === itemId); if (found || !page.hasMore) break;
        const key = JSON.stringify(page.nextCursor); check(!seen.has(key)); seen.add(key); before = page.nextCursor;
      }
      check(found);
      return receiveFound(context, workspaceId, found);
    }
    async function receiveFound(context, workspaceId, found) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const bundle = await step(context, () => storage.read(workspaceId));
        const row = model.project([found], bundle)[0];
        check(row.status !== 'ambiguous', 'naver_ambiguous');
        // An existing partial/full original is never replaced by an RSS capture.
        if (row.sourceId) return { sourceId: row.sourceId, sourceVersionId: row.sourceVersionId, alreadyReceived: true };
        const input = { ...model.toImportInput(found), forceSeparate: true };
        const prepared = await step(context, () => core.prepareImport(input, bundle));
        const changes = core.buildImportChanges(bundle, prepared);
        await verify(context);
        const result = await step(context, () => storage.commitLocal({ workspaceId, baseRevision: bundle.revision,
          operationId: root.crypto.randomUUID(), changes }, { isCurrent: () => { try { guard(context); return true; } catch (_) { return false; } } }));
        if (result.status === 'conflict') continue;
        check(result.status === 'stored', 'naver_receive_conflict');
        return { sourceId: prepared.source.id, sourceVersionId: prepared.version.id, alreadyReceived: false };
      }
      throw fault('naver_receive_conflict');
    }
    return Object.freeze({ list, save, check: checkRemote, receive, dispose() { disposed = true; cancel(); unlisten?.(); } });
  }
  return Object.freeze({ create, fault });
});

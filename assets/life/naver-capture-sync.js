/* Authenticated private captures. Only the worker fetches upstream pages. */
(function (root, factory) {
  const api = factory(root); (root.HaedoLife ||= {}).NaverCaptureSync = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, LOG = /^[1-9][0-9]{0,29}$/;
  const messages = {
    naver_auth_required: '로그인을 확인한 뒤 다시 시도해 주세요.',
    naver_setup_required: '실제 수집은 준비 중입니다. 기존 연결과 자료는 유지됩니다.',
    naver_schema_missing: '본문·사진 보관 기능의 서버 설치가 아직 준비되지 않았습니다.',
    naver_cancelled: '계정이나 화면이 바뀌어 이전 작업을 중지했습니다.',
    naver_invalid_data: '받은 원문이나 사진을 확인하지 못했습니다. 기존 자료는 유지됩니다.',
    naver_network_error: '요청을 마치지 못했습니다. 기존 자료를 유지하며 다시 확인할 수 있습니다.',
    naver_conflict: '자료나 연결이 바뀌었습니다. 현재 내용을 다시 확인해 주세요.',
    naver_ambiguous: '같은 글의 자료가 여러 개 있습니다. 보완할 자료를 먼저 확인해 주세요.',
    naver_source_trashed: '휴지통에 있는 자료입니다. 복원한 뒤 본문·사진을 받아 주세요.'
  };
  const fault = code => Object.assign(new Error(messages[code] || messages.naver_network_error), { code });
  function need(ok, code = 'naver_invalid_data') { if (!ok) throw fault(code); }
  const plain = value => value && typeof value === 'object' && !Array.isArray(value);
  function clean(error) {
    if (messages[error?.code]) return error;
    if (error?.code === 'PT409' || error?.status === 409 || /conflict/i.test(error?.message || '')) return fault('naver_conflict');
    if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error?.code)) return fault('naver_schema_missing');
    if (error?.code === '42501' || error?.status === 401) return fault('naver_auth_required');
    if (/setup_required/i.test(error?.message || '')) return fault('naver_setup_required');
    return fault('naver_network_error');
  }
  function create({ storage, auth = root.HaedoAuth, core = root.HaedoLife?.Core,
    model = root.HaedoLife?.NaverCapture, identity = root.HaedoLife?.NaverBlog, isCurrent = () => true } = {}) {
    need(storage?.isAccountScoped && storage.account && auth?.client?.rpc && auth?.verify && core && model && identity, 'naver_auth_required');
    const owner = { ...storage.account }, client = auth.client, controllers = new Set(), snapshots = new Map(), jobs = new Map();
    let disposed = false, generation = 0;
    function cancel() { generation++; snapshots.clear(); for (const c of controllers) c.abort(); controllers.clear(); }
    const unlisten = auth.onAccountChange?.(() => { if (auth.getAccount?.()?.userId !== owner.userId) cancel(); });
    function context(workspaceId) { need(UUID.test(workspaceId || '')); return { workspaceId, epoch: auth.epoch, generation }; }
    function guard(c) {
      need(!disposed && c.generation === generation && c.epoch === auth.epoch && isCurrent(c.workspaceId) &&
        auth.user?.id === owner.userId && auth.getAccount?.()?.userId === owner.userId && auth.getAccount?.()?.projectUrl === owner.projectUrl, 'naver_cancelled');
    }
    async function step(c, action) { guard(c); const value = await action(); guard(c); return value; }
    async function verify(c) { const user = await step(c, () => auth.verify()); need(user?.id === owner.userId, 'naver_auth_required'); }
    async function rpc(c, name, args) {
      await verify(c); const controller = new AbortController(); controllers.add(controller);
      try {
        let request = client.rpc(name, args); if (request?.abortSignal) request = request.abortSignal(controller.signal);
        const result = await step(c, () => request); if (result.error) throw result.error; return result.data;
      } catch (error) { guard(c); throw clean(error); } finally { controllers.delete(controller); }
    }
    function subscription(row) {
      need(plain(row) && UUID.test(row.id || '') && UUID.test(row.workspace_id || '') && typeof row.enabled === 'boolean' &&
        Number.isSafeInteger(row.revision) && row.revision > 0 && identity.parseBlog(row.blog_id).blogId === row.blog_id);
      return { ...row, blogId: row.blog_id, workspaceId: row.workspace_id,
        baselineComplete: row.inventory?.baseline_complete === true || row.inventory?.baselineComplete === true || !!row.inventory?.baseline_completed_at,
        baselineAt: row.inventory?.baseline_completed_at || row.inventory?.baseline_at || row.inventory?.baselineAt || null };
    }
    function job(row) {
      need(plain(row) && UUID.test(row.id || '') && !Object.hasOwn(row, 'lease_token') && !Object.hasOwn(row, 'owner_id'));
      const copy = { ...row }; jobs.set(copy.id, copy); return copy;
    }
    async function connections(ws) {
      const c = context(ws), rows = [], seen = new Set(); let before = null;
      for (let n = 0; n < 100; n++) {
        const data = await rpc(c, 'life_naver_account_list', { p_limit: 100, p_before: before });
        need(plain(data) && Array.isArray(data.subscriptions) && data.subscriptions.length <= 100 && typeof data.ready === 'boolean' && typeof data.hasMore === 'boolean');
        rows.push(...data.subscriptions.map(subscription));
        if (!data.hasMore) return { connections: rows, ready: data.ready };
        need(UUID.test(data.nextCursor || '') && !seen.has(data.nextCursor)); seen.add(data.nextCursor); before = data.nextCursor;
      }
      throw fault('naver_invalid_data');
    }
    function project(row, bundle) {
      const key = identity.postIdentity(row.payload.url)?.key;
      const candidates = bundle.sources.filter(s => s.origin === 'naver_blog' && identity.postIdentity(s.url)?.key === key);
      if (candidates.length > 1) return { status: 'ambiguous', sourceId: null, sourceVersionId: null };
      const s = candidates[0], v = s && bundle.sourceVersions.filter(value => value.sourceId === s.id).at(-1);
      return { status: !s ? 'new' : !core.isSourceActive(bundle, s.id) ? 'trashed' : v?.coverage.status === 'full_text' ? 'imported' : 'needs_content', sourceId: s?.id || null, sourceVersionId: v?.id || null };
    }
    async function receivedProjection(c, row, bundle) {
      const projection = { ...project(row, bundle), received: false };
      if (projection.sourceId) for (const version of bundle.sourceVersions.filter(value => value.sourceId === projection.sourceId)) {
        const local = await step(c, () => storage.readNaverCapture(c.workspaceId, version.id));
        if (local?.capture.capture_hash === row.capture_hash) return { ...projection, sourceVersionId: version.id, received: true };
      }
      return projection;
    }
    async function publicList(ws, sub, { before = null } = {}) {
      need(UUID.test(sub || '')); const c = context(ws);
      const data = await rpc(c, 'life_naver_inventory_list', { p_subscription_id: sub, p_limit: 100, p_before: before });
      need(plain(data) && Array.isArray(data.items) && data.items.length <= 100 && typeof data.hasMore === 'boolean');
      const bundle = await step(c, () => storage.read(ws));
      const items = data.items.map(value => {
        need(plain(value) && LOG.test(value.logNo || '') && identity.parseBlog(value.blogId).blogId === value.blogId && typeof value.title === 'string');
        const url = 'https://blog.naver.com/' + value.blogId + '/' + value.logNo;
        return { ...value, url, ...project({ payload: { ...value, url } }, bundle) };
      });
      return { ...data, items, complete: data.inventory?.status === 'complete', jobs: items.flatMap(value => value.job ? [job(value.job)] : []) };
    }
    async function startInventory(ws, sub, revision) {
      need(UUID.test(sub || '') && Number.isSafeInteger(revision) && revision > 0);
      return rpc(context(ws), 'life_naver_inventory_start', { p_subscription_id: sub, p_expected_revision: revision });
    }
    async function queue(ws, sub, { logNos, expectedRevision, refresh = false }) {
      need(UUID.test(sub || '') && Array.isArray(logNos) && logNos.length > 0 && logNos.length <= 100 && new Set(logNos).size === logNos.length &&
        logNos.every(value => LOG.test(value)) && Number.isSafeInteger(expectedRevision) && expectedRevision > 0 && typeof refresh === 'boolean');
      const c = context(ws), result = [];
      for (const no of logNos) result.push(job(await rpc(c, 'life_naver_capture_request', { p_subscription_id: sub, p_log_no: no, p_expected_revision: expectedRevision, p_refresh: refresh })));
      return { jobs: result };
    }
    async function captures(ws, { subscriptionId, before = null }) {
      need(UUID.test(subscriptionId || '')); const c = context(ws);
      const data = await rpc(c, 'life_naver_capture_list', { p_subscription_id: subscriptionId, p_limit: 10, p_before: before });
      need(plain(data) && Array.isArray(data.captures) && data.captures.length <= 100 && Array.isArray(data.jobs) && data.jobs.length <= 100 && typeof data.hasMore === 'boolean');
      const rows = [];
      for (const value of data.captures) { const row = await step(c, () => model.validateCaptureRow(value)); need(row.owner_id === owner.userId); rows.push(row); }
      return { ...data, captures: rows, jobs: data.jobs.map(job) };
    }
    async function checkCapture(ws, sub, { jobId = null, inventory = false } = {}) {
      need(UUID.test(sub || '') && (jobId === null || UUID.test(jobId))); const c = context(ws); await verify(c);
      const controller = new AbortController(); controllers.add(controller);
      try {
        const body = inventory ? { action: 'inventory', subscriptionId: sub } : jobId ? { action: 'capture', jobId } : { action: 'run', subscriptionId: sub };
        const result = await step(c, () => client.functions.invoke('haedo-naver-blog', { body, signal: controller.signal }));
        if (result.data?.error === 'setup_required') throw fault('naver_setup_required');
        if (result.error || result.data?.error) throw fault('naver_network_error');
        need(plain(result.data) && ['checked', 'busy', 'pending'].includes(result.data.status)); return result.data;
      } catch (error) { guard(c); throw clean(error); } finally { controllers.delete(controller); }
    }
    async function retry(ws, id) {
      need(UUID.test(id || '')); const value = jobs.get(id); need(value && UUID.test(value.subscription_id || '') && LOG.test(value.log_no || ''));
      const subs = await connections(ws), sub = subs.connections.find(row => row.id === value.subscription_id); need(sub);
      return queue(ws, sub.id, { logNos: [value.log_no], expectedRevision: sub.revision });
    }
    async function configureConnection(ws, id, { expectedRevision, enabled }) {
      need(UUID.test(id || '') && Number.isSafeInteger(expectedRevision) && expectedRevision > 0 && typeof enabled === 'boolean');
      const c = context(ws), account = await connections(ws), sub = account.connections.find(value => value.id === id);
      need(sub && sub.revision === expectedRevision, 'naver_conflict');
      return subscription(await rpc(c, 'life_naver_save', { p_workspace_id: sub.workspaceId, p_blog_id: sub.blogId,
        p_expected_revision: expectedRevision, p_enabled: enabled }));
    }
    async function readCapture(ws, id) {
      need(UUID.test(id || '')); const c = context(ws), key = ws + ':' + id;
      if (snapshots.has(key)) {
        const cached = snapshots.get(key), bundle = await step(c, () => storage.read(ws));
        const fresh = { ...cached, projection: await receivedProjection(c, cached.capture, bundle) }; snapshots.set(key, fresh); return structuredClone(fresh);
      }
      const raw = await rpc(c, 'life_naver_capture_read', { p_capture_id: id });
      const row = await step(c, () => model.validateCaptureRow(raw));
      need(row.owner_id === owner.userId); const photos = [];
      for (const photo of row.payload.photos) if (photo.status === 'stored') {
        await verify(c);
        const result = await step(c, () => client.storage.from('haedo-naver-originals').download(photo.storagePath));
        if (result.error) throw clean(result.error); need(result.data instanceof Blob); photos.push({ index: photo.index, blob: result.data });
      }
      const bundle = await step(c, () => storage.read(ws)), projection = await receivedProjection(c, row, bundle);
      await step(c, () => root.HaedoLife.NaverMedia.validate({ sourceId: projection.sourceId || core.id(), sourceVersionId: projection.sourceVersionId || core.id(), capture: row, photos }));
      const snapshot = { capture: row, photos, projection }; snapshots.set(key, snapshot); return structuredClone(snapshot);
    }
    async function receiveCapture(ws, id, options = {}) {
      options = { ...options };
      const c = context(ws), snapshot = await readCapture(ws, id);
      for (let attempt = 0; attempt < 3; attempt++) {
        const bundle = await step(c, () => storage.read(ws)), found = project(snapshot.capture, bundle);
        need(found.status !== 'ambiguous', 'naver_ambiguous');
        need(found.status !== 'trashed', 'naver_source_trashed');
        if (found.sourceId) for (const version of bundle.sourceVersions.filter(v => v.sourceId === found.sourceId)) {
          const old = await step(c, () => storage.readNaverCapture(ws, version.id));
          if (old?.capture.capture_hash === snapshot.capture.capture_hash) return { sourceId: found.sourceId, sourceVersionId: version.id, alreadyReceived: true, received: true };
        }
        const expectedSource = Object.hasOwn(options, 'existingSourceId') ? options.existingSourceId : snapshot.projection.sourceId;
        const expectedVersion = Object.hasOwn(options, 'expectedSourceVersionId') ? options.expectedSourceVersionId : snapshot.projection.sourceVersionId;
        need(expectedSource === found.sourceId && expectedVersion === found.sourceVersionId, 'naver_conflict');
        const source = bundle.sources.find(s => s.id === found.sourceId);
        const input = model.toImportInput(snapshot.capture.payload, source ? { existingSourceId: source.id, existingSourceUrl: source.url } : {});
        if (!source) input.forceSeparate = true;
        const prepared = await step(c, () => core.prepareImport(input, bundle, { forceNewVersion: !!source }));
        await verify(c);
        const result = await step(c, () => storage.commitNaverCapture({ workspaceId: ws, baseRevision: bundle.revision, operationId: core.id(),
          changes: core.buildImportChanges(bundle, prepared), attachment: { sourceId: prepared.source.id, sourceVersionId: prepared.version.id, capture: snapshot.capture, photos: snapshot.photos } },
        { isCurrent: () => { try { guard(c); return true; } catch (_) { return false; } } }));
        if (result.status === 'conflict') continue; need(result.status === 'stored', 'naver_conflict'); snapshots.delete(ws + ':' + id);
        return { sourceId: prepared.source.id, sourceVersionId: prepared.version.id, alreadyReceived: false, received: true };
      }
      throw fault('naver_conflict');
    }
    return Object.freeze({ connections, publicList, startInventory, queue, captures, checkCapture, retry, configureConnection, readCapture, receiveCapture,
      dispose() { disposed = true; cancel(); unlisten?.(); } });
  }
  return Object.freeze({ create, fault });
});

/* Authenticated private captures. Only the worker fetches upstream pages. */
(function (root, factory) {
  const api = factory(root); (root.HaedoLife ||= {}).NaverCaptureSync = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, LOG = /^[1-9][0-9]{0,29}$/,
    ID = /^[A-Za-z0-9_-]{1,128}$/, SHA = /^[a-f0-9]{64}$/;
  const messages = {
    naver_auth_required: '로그인을 확인한 뒤 다시 시도해 주세요.',
    naver_setup_required: '실제 수집은 준비 중입니다. 기존 연결과 자료는 유지됩니다.',
    naver_schema_missing: '본문·사진 보관 기능의 서버 설치가 아직 준비되지 않았습니다.',
    naver_cancelled: '계정이나 화면이 바뀌어 이전 작업을 중지했습니다.',
    naver_invalid_data: '받은 원문이나 사진을 확인하지 못했습니다. 기존 자료는 유지됩니다.',
    naver_network_error: '요청을 마치지 못했습니다. 기존 자료를 유지하며 다시 확인할 수 있습니다.',
    naver_conflict: '자료나 연결이 바뀌었습니다. 현재 내용을 다시 확인해 주세요.',
    naver_ambiguous: '같은 글의 자료가 여러 개 있습니다. 보완할 자료를 먼저 확인해 주세요.',
    naver_source_trashed: '휴지통에 있는 자료입니다. 복원한 뒤 본문·사진을 받아 주세요.',
    naver_photo_reference_missing: '이 원문 판에는 사진 연결이 보관되지 않았습니다. 수집 사본을 확인해 주세요.',
    naver_photo_unavailable: '이 계정에서 같은 사진 판을 찾지 못했습니다. 기존 자료는 유지됩니다.'
  };
  const fault = code => Object.assign(new Error(messages[code] || messages.naver_network_error), { code });
  function need(ok, code = 'naver_invalid_data') { if (!ok) throw fault(code); }
  const plain = value => value && typeof value === 'object' && !Array.isArray(value);
  function clean(error) {
    if (messages[error?.code]) return error;
    if (['naver_capture_invalid', 'invalid_naver_media', 'invalid_naver_capture_reference', 'naver_capture_reference_invalid',
      'naver_capture_reference_mismatch', 'duplicate_naver_capture_reference'].includes(error?.code)) return fault('naver_invalid_data');
    if (['immutable_naver_capture_reference', 'immutable_source_version', 'immutable_naver_capture',
      'naver_capture_changed', 'naver_target_changed'].includes(error?.code)) return fault('naver_conflict');
    if (error?.code === 'source_trashed') return fault('naver_source_trashed');
    if (error?.code === 'PT409' || error?.status === 409 || /conflict/i.test(error?.message || '')) return fault('naver_conflict');
    if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error?.code)) return fault('naver_schema_missing');
    if (error?.code === '42501' || error?.status === 401) return fault('naver_auth_required');
    if (/setup_required/i.test(error?.message || '')) return fault('naver_setup_required');
    return fault('naver_network_error');
  }
  function create({ storage, auth = root.HaedoAuth, core = root.HaedoLife?.Core,
    model = root.HaedoLife?.NaverCapture, identity = root.HaedoLife?.NaverBlog,
    reference = root.HaedoLife?.NaverCaptureReference, media = root.HaedoLife?.NaverMedia, isCurrent = () => true } = {}) {
    need(storage?.isAccountScoped && storage.account && auth?.client?.rpc && auth?.verify && core && model && identity, 'naver_auth_required');
    const owner = { ...storage.account }, client = auth.client, controllers = new Set(), snapshots = new Map(), jobs = new Map(), photoTasks = new Map();
    let disposed = false, generation = 0;
    function cancel() { generation++; snapshots.clear(); photoTasks.clear(); for (const c of controllers) c.abort(); controllers.clear(); }
    const unlisten = auth.onAccountChange?.(() => {
      const current = auth.getAccount?.();
      if (current?.userId !== owner.userId || current?.projectUrl !== owner.projectUrl) cancel();
    });
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
    async function downloadPhotos(c, row) {
      const photos = [];
      for (const photo of row.payload.photos) if (photo.status === 'stored') {
        await verify(c); const controller = new AbortController(); controllers.add(controller);
        try {
          const result = await step(c, () => client.storage.from('haedo-naver-originals').download(photo.storagePath, {}, { signal: controller.signal }));
          if (result.error) throw result.error;
          need(result.data instanceof Blob); photos.push({ index: photo.index, blob: result.data });
        } catch (error) { guard(c); throw clean(error); } finally { controllers.delete(controller); }
      }
      return photos;
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
    function photoTarget(input) {
      const keys = ['sourceId', 'sourceVersionId', 'expectedCaptureHash'];
      need(plain(input) && Reflect.ownKeys(input).length === keys.length && keys.every(key =>
        Object.hasOwn(input, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), 'value')));
      need(ID.test(input.sourceId || '') && ID.test(input.sourceVersionId || '') && SHA.test(input.expectedCaptureHash || ''));
      return { sourceId: input.sourceId, sourceVersionId: input.sourceVersionId, expectedCaptureHash: input.expectedCaptureHash };
    }
    async function exactTarget(c, target, requiredReference) {
      need(reference?.get && reference?.assertCapture && media?.validate && media?.checkTarget);
      const bundle = await step(c, () => storage.read(c.workspaceId));
      core.validateWorkspace(bundle);
      const source = bundle.sources.find(value => value.id === target.sourceId), version = bundle.sourceVersions.find(value => value.id === target.sourceVersionId);
      need(source?.origin === 'naver_blog' && version?.sourceId === source.id, 'naver_conflict');
      need(core.isSourceActive(bundle, source.id), 'naver_source_trashed');
      const linked = reference.get(bundle, source.id, version.id);
      if (requiredReference) need(linked, 'naver_photo_reference_missing');
      if (linked) need(linked.reference.captureHash === target.expectedCaptureHash, 'naver_conflict');
      return { bundle, linked };
    }
    async function exactCapture(c, pointer) {
      need(typeof client.from === 'function');
      await verify(c); const controller = new AbortController(); controllers.add(controller);
      try {
        // A hash reference chooses an immutable photo set, not the latest post.
        // It carries no server locator or assertion of account storage success.
        let request = client.from('life_naver_captures').select('id,owner_id,blog_id,log_no,capture_hash,created_at,payload')
          .eq('owner_id', owner.userId).eq('blog_id', pointer.blogId).eq('log_no', pointer.logNo).eq('capture_hash', pointer.captureHash).limit(2);
        if (request?.abortSignal) request = request.abortSignal(controller.signal);
        const result = await step(c, () => request); if (result.error) throw result.error;
        need(Array.isArray(result.data)); need(result.data.length !== 0, 'naver_photo_unavailable'); need(result.data.length === 1);
        const row = await step(c, () => model.validateCaptureRow(result.data[0], { ownerId: owner.userId }));
        reference.assertCapture(pointer, row); return row;
      } catch (error) { guard(c); throw clean(error); } finally { controllers.delete(controller); }
    }
    function commitGuard(c) { return () => { try { guard(c); return true; } catch (_) { return false; } }; }
    function photoCommit(result, target) {
      if (result?.status === 'conflict') throw fault('naver_conflict');
      if (result?.status === 'rejected') throw clean(result.error);
      need(result?.status === 'stored' && result.sourceId === target.sourceId && result.sourceVersionId === target.sourceVersionId &&
        Number.isSafeInteger(result.revision) && result.revision >= 0);
      return structuredClone(result);
    }
    async function photoTask(ws, input, kind, action) {
      const target = photoTarget(input), c = context(ws);
      guard(c);
      const key = JSON.stringify([kind, ws, target.sourceId, target.sourceVersionId, target.expectedCaptureHash, c.epoch, c.generation]);
      let task = photoTasks.get(key);
      if (!task) {
        task = (async () => { try { return await action(c, target); } catch (error) { guard(c); throw clean(error); } })();
        photoTasks.set(key, task);
      }
      try { return structuredClone(await step(c, () => task)); }
      finally { if (photoTasks.get(key) === task) photoTasks.delete(key); }
    }
    async function restoreSourcePhotos(ws, input) {
      return photoTask(ws, input, 'restore', async (c, target) => {
        need(typeof storage.restoreNaverCapturePhotos === 'function');
        const initial = await exactTarget(c, target, true), pointer = initial.linked.reference;
        const row = await exactCapture(c, pointer), attachment = { sourceId: target.sourceId, sourceVersionId: target.sourceVersionId,
          capture: row, photos: [] };
        media.checkTarget(initial.bundle, attachment);
        attachment.photos = await downloadPhotos(c, row);
        const verified = await step(c, () => media.validate(attachment, { ownerId: owner.userId }));
        const current = await exactTarget(c, target, true); reference.assertCapture(current.linked.reference, row); media.checkTarget(current.bundle, verified);
        await verify(c);
        return photoCommit(await step(c, () => storage.restoreNaverCapturePhotos({ workspaceId: ws, sourceId: target.sourceId,
          sourceVersionId: target.sourceVersionId, expectedReference: pointer, attachment: verified }, { isCurrent: commitGuard(c) })), target);
      });
    }
    async function rememberSourcePhotos(ws, input) {
      return photoTask(ws, input, 'remember', async (c, target) => {
        need(typeof storage.rememberNaverCaptureReference === 'function' && typeof storage.readNaverCapture === 'function');
        const initial = await exactTarget(c, target, false), local = await step(c, () => storage.readNaverCapture(ws, target.sourceVersionId));
        need(local && !local.localOnly && local.sourceId === target.sourceId && local.sourceVersionId === target.sourceVersionId &&
          local.capture?.owner_id === owner.userId && local.capture?.capture_hash === target.expectedCaptureHash, 'naver_conflict');
        const previous = await step(c, () => model.validateCaptureRow(local.capture, { ownerId: owner.userId })); media.checkTarget(initial.bundle, local);
        // Existing local bytes do not prove current server availability. This
        // explicit action rechecks the same server row before adding a pointer.
        const raw = await rpc(c, 'life_naver_capture_read', { p_capture_id: previous.id });
        need(raw !== null, 'naver_photo_unavailable');
        const row = await step(c, () => model.validateCaptureRow(raw, { ownerId: owner.userId }));
        need(row.id === previous.id && row.capture_hash === target.expectedCaptureHash);
        const pointer = { sourceVersionId: target.sourceVersionId, blogId: previous.blog_id, logNo: previous.log_no, captureHash: previous.capture_hash };
        reference.assertCapture(pointer, row);
        const current = await exactTarget(c, target, false); media.checkTarget(current.bundle, { ...local, capture: row });
        await verify(c);
        return photoCommit(await step(c, () => storage.rememberNaverCaptureReference({ workspaceId: ws, sourceId: target.sourceId,
          sourceVersionId: target.sourceVersionId, expectedCaptureHash: target.expectedCaptureHash, expectedCaptureId: previous.id,
          operationId: core.id() }, { isCurrent: commitGuard(c) })), target);
      });
    }
    async function readCapture(ws, id) {
      need(UUID.test(id || '')); const c = context(ws), key = ws + ':' + id;
      if (snapshots.has(key)) {
        const cached = snapshots.get(key), bundle = await step(c, () => storage.read(ws));
        const fresh = { ...cached, projection: await receivedProjection(c, cached.capture, bundle) }; snapshots.set(key, fresh); return structuredClone(fresh);
      }
      const raw = await rpc(c, 'life_naver_capture_read', { p_capture_id: id });
      const row = await step(c, () => model.validateCaptureRow(raw));
      need(row.id === id && row.owner_id === owner.userId); const photos = await downloadPhotos(c, row);
      const bundle = await step(c, () => storage.read(ws)), projection = await receivedProjection(c, row, bundle);
      await step(c, () => media.validate({ sourceId: projection.sourceId || core.id(), sourceVersionId: projection.sourceVersionId || core.id(), capture: row, photos }));
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
      restoreSourcePhotos, rememberSourcePhotos,
      dispose() { disposed = true; cancel(); unlisten?.(); } });
  }
  return Object.freeze({ create, fault });
});

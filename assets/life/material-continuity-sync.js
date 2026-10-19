/* Explicit one-preparation checkpoints. Ordinary source/blog sync retain their contracts. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).MaterialContinuitySync = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const messages = {
    material_review_required: '준비나 완성 글이 바뀌었습니다. 포함 내용을 다시 검토하고 보관해 주세요.',
    material_not_connected: '이 준비의 포함 내용을 검토한 뒤 다른 기기 이어쓰기를 연결해 주세요.',
    material_paused: '이어쓰기가 중지되어 있습니다. 포함 내용을 검토한 뒤 다시 연결해 주세요.',
    material_conflict: '두 기기의 준비가 다릅니다. 양쪽 내용을 비교하고 보존할 내용을 선택해 주세요.',
    material_remote_missing: '서버의 작성 준비를 찾지 못했습니다. 이 기기의 준비는 유지됩니다.',
    material_output_elsewhere: '다른 기기에서 이 준비의 글을 작성 중입니다. 그 기기에서 글과 사진을 저장·보관한 뒤 여기서 다시 받아 주세요.',
    material_output_not_saved: '기존 작성기에서 글을 저장한 뒤 완성 글과 사진 원본을 보관해 주세요.',
    material_output_changed: '보관된 글의 버전이 달라졌습니다. 작성한 기기에서 완성 글 연결을 다시 보관해 주세요.',
    material_receive_changed: '검토한 뒤 서버 준비가 바뀌었습니다. 최신 내용을 다시 확인해 주세요.',
    request_cancelled: '계정이나 이어쓰기 상태가 바뀌어 이전 요청을 중단했습니다.',
    material_busy: '처리 중인 이어쓰기 결과를 확인한 뒤 다시 시도해 주세요.'
  };
  const fault = code => Object.assign(new Error(messages[code] || '이어쓰기 요청을 마치지 못했습니다. 이 기기의 내용은 유지됩니다.'), { code });
  const clone = value => structuredClone(value);
  const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
  function create({ storage, auth = root.HaedoAuth, model = root.HaedoLife?.MaterialContinuity,
    remote = root.HaedoLife?.MaterialContinuityRemote?.create({ auth }),
    blogSync = root.HaedoLife?.BlogSync?.create({ storage, auth }),
    blogRemote = root.HaedoLife?.BlogRemote?.create({ auth }),
    blog = root.HaedoLife?.Blog, photoPost = root.HaedoLife?.PhotoPost,
    makeId = () => root.crypto.randomUUID() } = {}) {
    if (!storage?.account || !model || !remote || !auth) throw fault('request_cancelled');
    const owner = storage.account, queues = new Map(), generations = new Map(), listeners = new Set(); let disposed = false;
    const key = (ws, id) => ws + '/' + id;
    const context = (ws = '*', id = '*') => ({ ws, id, epoch: auth.epoch, generation: generations.get(key(ws, id)) || 0 });
    function guard(c) {
      const account = auth.getAccount();
      if (disposed || account?.userId !== owner.userId || account?.projectUrl !== owner.projectUrl || c.epoch !== auth.epoch || c.generation !== (generations.get(key(c.ws, c.id)) || 0)) throw fault('request_cancelled');
    }
    async function verified(c) { guard(c); const user = await auth.verify(); guard(c); if (user?.id !== owner.userId) throw fault('request_cancelled'); }
    const emit = c => { if (!disposed) for (const listener of listeners) { try { listener({ workspaceId: c.ws, planId: c.id }); } catch (_) {} } };
    function serial(ws, id, task) {
      const k = key(ws, id), previous = queues.get(k) || Promise.resolve(), c = context(ws, id);
      const next = previous.catch(() => {}).then(async () => { guard(c); return task(c); }); queues.set(k, next);
      next.finally(() => { if (queues.get(k) === next) queues.delete(k); }).catch(() => {}); return next;
    }
    async function read(c) { const state = await storage.readMaterialContinuityState(c.ws, c.id); guard(c); return state; }
    async function snapshot(c, options) { const value = await storage.readMaterialContinuitySnapshot(c.ws, c.id, options); guard(c); return value; }
    const reviewStamp = value => ({ post: value.post ? blog.pack(photoPost.compact(value.post)) : null, refs: value.refs || [],
      editingDrafts: (value.editingDrafts || []).map(value => ({ post: blog.pack(photoPost.compact(value.post)), refs: value.refs })) });
    async function write(c, state, changes) {
      guard(c); const result = await storage.writeMaterialContinuityState(c.ws, c.id, { ...state, ...changes }, state?.revision || 0); guard(c); emit(c); return result;
    }
    async function checkedRow(c, id) {
      const row = await remote.read(id); guard(c); if (!row) throw fault('material_remote_missing');
      row.data = await model.verify(row.data); guard(c); return row;
    }
    async function stateFor(c) {
      const value = await snapshot(c), state = value.state || await read(c), changed = !!state?.head && value.fingerprint !== await model.fingerprint(state.head.data); guard(c);
      const postState = value.post && state?.output ? await storage.readBlogSyncState(c.ws, value.post.id) : null; guard(c);
      const outputNeedsReview = value.post?.status === 'saved' && !!state?.output && (state.output.state !== 'saved' || !postState ||
        postState.remoteId !== state.output.postId || postState.remoteRevision !== state.output.revision || postState.localRevision !== value.post.revision);
      return { ...(state || {}), workspaceId: c.ws, planId: c.id, enabled: !!state?.enabled, changed,
        output: state?.output || null, ownClaim: !!state?.localClaim && state.localClaim.claimId === state.output?.claimId, outputNeedsReview,
        status: !state ? 'not_enabled' : !state.enabled ? 'paused' : state.conflict ? 'conflict' : state.error ? 'error' : !state.head || state.pending || changed ? 'pending' : 'synced' };
    }
    async function review(c) {
      const value = await snapshot(c);
      let outputData = null;
      if (value.post?.status === 'saved' && value.state?.output) {
        const descriptor = { state: 'saved', postId: value.state.output.postId, claimId: value.state.output.claimId,
          revision: value.state.output.revision || 1, refs: value.refs || [] };
        const complete = await snapshot(c, { output: descriptor });
        const baseline = model.snapshot(complete.data.bundle, complete.data.plan, value.data.output);
        if (await model.fingerprint(baseline) !== value.fingerprint || canonical(complete.refs || []) !== canonical(value.refs || []) ||
          canonical(reviewStamp(complete)) !== canonical(reviewStamp(value))) throw fault('material_review_required');
        outputData = complete.data;
      }
      const bytes = new TextEncoder().encode(canonical({ preparation: value.fingerprint, ...reviewStamp(value), outputData }));
      const digest = await root.crypto.subtle.digest('SHA-256', bytes); guard(c);
      const fingerprint = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
      return { ...value, outputData, fingerprint, preparationFingerprint: value.fingerprint, counts: {
        materials: value.data.plan.materials.length, versions: value.data.bundle.sourceVersions.length,
        blocks: value.data.plan.blocks.length, bytes: new TextEncoder().encode(JSON.stringify(value.data)).length,
        photos: value.post?.photos?.length || 0 } };
    }
    async function rememberError(c, error) {
      try { guard(c); const state = await read(c); if (state?.enabled) await write(c, state, { error: error.code || 'network_error' }); } catch (_) { /* Durable pending operation remains retryable. */ }
    }
    async function conflict(c, state, row) {
      const local = await snapshot(c); return write(c, state, { conflict: { row, localFingerprint: local.fingerprint }, error: null });
    }
    async function send(c) {
      let state = await read(c); if (!state?.enabled) throw fault('material_paused');
      if (!state.pending) return state;
      const pending = clone(state.pending);
      const response = await remote.write({ remoteId: state.remoteId, operationId: pending.operationId, expectedRevision: pending.expectedRevision, data: pending.data }); guard(c);
      // Historical success receipts do not establish the current server head.
      const row = await checkedRow(c, state.remoteId), current = await read(c);
      if (!current?.enabled || current.pending?.operationId !== pending.operationId) throw fault('request_cancelled');
      const actual = await model.fingerprint(row.data); guard(c);
      if (response.status !== 'stored' || response.revision !== row.revision || actual !== pending.fingerprint) return conflict(c, current, row);
      return write(c, current, { remoteRevision: row.revision, head: row, output: row.data.output, pending: null, conflict: null, error: null });
    }
    async function pending(c, state, data, changes = {}) {
      const verifiedData = await model.verify(data), fingerprint = await model.fingerprint(verifiedData); guard(c);
      return write(c, state, { ...changes, pending: { operationId: makeId(), expectedRevision: state.remoteRevision, data: verifiedData, fingerprint }, conflict: null, error: null });
    }
    async function connect(ws, id, expectedFingerprint) {
      return serial(ws, id, async c => {
        try {
          await verified(c); const preview = await review(c); if (preview.fingerprint !== expectedFingerprint) throw fault('material_review_required');
          let state = await read(c);
          if (!state) state = await write(c, null, { binding: owner, enabled: true, remoteId: makeId(), remoteRevision: 0, head: null,
            mapping: null, output: null, pending: null, conflict: null, localClaim: null, error: null });
          else if (!state.enabled) state = await write(c, state, { enabled: true, error: null });
          if (state.pending) { state = await send(c); if (state.conflict) return stateFor(c); }
          if (state.head) {
            const row = await checkedRow(c, state.remoteId);
            if (row.revision !== state.remoteRevision || await model.fingerprint(row.data) !== await model.fingerprint(state.head.data)) { await conflict(c, state, row); return stateFor(c); }
          }
          const now = await review(c); if (now.fingerprint !== expectedFingerprint) throw fault('material_review_required');
          let data = now.data, changes = {};
          if (now.post && !state.output) {
            const priorPostState = await storage.readBlogSyncState(ws, now.post.id); guard(c);
            const output = { state: 'writing', postId: priorPostState?.remoteId || now.post.id, claimId: makeId() };
            data = { ...data, output }; changes = { localClaim: { claimId: output.claimId, postId: output.postId } };
          }
          if (state.head && await model.fingerprint(data) === await model.fingerprint(state.head.data)) { await write(c, state, { error: null }); return stateFor(c); }
          await pending(c, state, data, changes); state = await send(c);
          if (now.post && !state.conflict && state.localClaim?.claimId === state.output?.claimId) {
            await storage.finishMaterialContinuityClaim(ws, id, now.localRevision); guard(c);
          }
          return stateFor(c);
        } catch (error) { await rememberError(c, error); throw error; }
      });
    }
    async function outputPost(c, row) {
      if (row.data.output?.state !== 'saved') return null;
      const output = row.data.output, postRow = await blogRemote.read(output.postId); guard(c);
      if (!postRow || postRow.revision !== output.revision) throw fault('material_output_changed');
      const blobs = new Map();
      for (const photo of postRow.data.photos) { blobs.set(photo.id, await blogRemote.downloadAsset(postRow.assets[photo.id])); guard(c); }
      const doc = await blog.hydrate(postRow.data, blobs); guard(c);
      // Install uses these verified server fields for the existing BlogSync binding.
      return { doc, row: postRow };
    }
    async function install(c, row, options = {}) {
      const completed = await outputPost(c, row); guard(c);
      try {
        const result = await storage.installMaterialContinuity(row, { ...options, ...(completed ? { post: completed.doc, blogRow: completed.row } : {}) }); guard(c); emit(c); return result;
      } catch (error) {
        if (error.code === 'local_changed' && options.target) {
          guard(c); const targetContext = context(options.target.workspaceId, options.target.planId), state = await read(targetContext);
          if (state?.enabled) await conflict(targetContext, state, row);
        }
        throw error;
      }
    }
    async function sync(ws, id) {
      return serial(ws, id, async c => {
        try {
          await verified(c); let state = await read(c); if (!state) throw fault('material_not_connected'); if (!state.enabled) throw fault('material_paused');
          if (state.pending) { state = await send(c); if (state.conflict) return stateFor(c); }
          const row = await checkedRow(c, state.remoteId), local = await snapshot(c);
          if (row.revision === state.remoteRevision) {
            if (!state.head || await model.fingerprint(row.data) !== await model.fingerprint(state.head.data)) throw fault('material_receive_changed');
            await write(c, state, { error: null }); return stateFor(c);
          }
          if (!state.head || local.fingerprint !== await model.fingerprint(state.head.data)) { await conflict(c, state, row); return stateFor(c); }
          const received = await install(c, row, { target: { workspaceId: ws, planId: id }, expectedFingerprint: local.fingerprint, expectedReview: reviewStamp(local) }); return { ...await stateFor(c), received };
        } catch (error) { await rememberError(c, error); throw error; }
      });
    }
    async function handoff(ws, id, expectedRevision) {
      return serial(ws, id, async c => {
        let state = await read(c);
        if (!state) return storage.createMaterialWritingPost(ws, id, expectedRevision);
        try {
          await verified(c); if (!state.enabled) throw fault('material_paused');
          if (state.pending) { state = await send(c); if (state.conflict) throw fault('material_conflict'); }
          if (state.conflict) throw fault('material_conflict');
          const local = await snapshot(c);
          if (local.localRevision !== expectedRevision) throw fault('material_review_required');
          if (!state.head || local.fingerprint !== await model.fingerprint(state.head.data)) throw fault('material_review_required');
          const row = await checkedRow(c, state.remoteId);
          if (row.revision !== state.remoteRevision || await model.fingerprint(row.data) !== await model.fingerprint(state.head.data)) { await conflict(c, state, row); throw fault('material_conflict'); }
          if (!state.output) {
            const output = { state: 'writing', postId: makeId(), claimId: makeId() };
            await pending(c, state, { ...local.data, output }, { localClaim: { claimId: output.claimId, postId: output.postId } });
            state = await send(c); if (state.conflict) throw fault('material_conflict');
          }
          if (!state.localClaim || state.localClaim.claimId !== state.output?.claimId) {
            if (local.plan.output) return storage.createMaterialWritingPost(ws, id, expectedRevision);
            throw fault('material_output_elsewhere');
          }
          const result = await storage.finishMaterialContinuityClaim(ws, id, expectedRevision); guard(c); emit(c); return result;
        } catch (error) { await rememberError(c, error); throw error; }
      });
    }
    async function shareOutput(ws, id, expectedFingerprint) {
      return serial(ws, id, async c => {
        try {
          await verified(c); const before = await review(c); if (before.fingerprint !== expectedFingerprint) throw fault('material_review_required');
          let state = await read(c); if (!state?.enabled) throw fault('material_not_connected');
          if (!before.post || before.post.status !== 'saved' || before.editingDrafts?.length) throw fault('material_output_not_saved');
          if (state.pending) { state = await send(c); if (state.conflict) throw fault('material_conflict'); }
          if (!state.output || state.conflict) throw fault('material_conflict');
          const current = await checkedRow(c, state.remoteId);
          if (current.revision !== state.remoteRevision || await model.fingerprint(current.data) !== await model.fingerprint(state.head.data)) { await conflict(c, state, current); throw fault('material_conflict'); }
          const postState = await blogSync.save(ws, before.post.id, { expectedManifest: blog.pack(photoPost.compact(before.post)) }); guard(c);
          if (postState.status !== 'synced' || postState.remoteId !== state.output.postId) throw fault('material_output_changed');
          const storedPost = await blogRemote.read(state.output.postId); guard(c);
          const expectedPost = blog.pack(photoPost.compact(before.post)); expectedPost.id = state.output.postId; expectedPost.replaces = null;
          if (!storedPost || storedPost.revision !== postState.remoteRevision || canonical(storedPost.data) !== canonical(expectedPost)) throw fault('material_output_changed');
          const after = await review(c); if (after.fingerprint !== expectedFingerprint) throw fault('material_review_required');
          if (!before.outputData) throw fault('material_review_required');
          const data = clone(before.outputData); data.output.revision = postState.remoteRevision;
          await pending(c, await read(c), data); await send(c); return stateFor(c);
        } catch (error) { await rememberError(c, error); throw error; }
      });
    }
    async function compare(ws, id) {
      const c = context(ws, id); await verified(c); const local = await review(c), state = await read(c);
      if (!state) throw fault('material_not_connected'); const row = await checkedRow(c, state.remoteId);
      const completed = await outputPost(c, row);
      return { local: { data: local.data, fingerprint: local.preparationFingerprint, ...reviewStamp(local) },
        remote: row, remotePost: completed ? blog.pack(completed.doc) : null, expected: { fingerprint: local.preparationFingerprint, remoteRevision: row.revision, reviewFingerprint: local.fingerprint } };
    }
    async function resolve(ws, id, choice, expected) {
      return serial(ws, id, async c => {
        await verified(c); if (!['local', 'remote'].includes(choice)) throw fault('material_review_required');
        const state = await read(c); if (!state?.enabled) throw fault('material_paused');
        const local = await review(c), row = await checkedRow(c, state.remoteId);
        if (local.preparationFingerprint !== expected?.fingerprint || row.revision !== expected?.remoteRevision) throw fault('material_review_required');
        if (local.fingerprint !== expected.reviewFingerprint) throw fault('material_review_required');
        const result = await install(c, row, { target: { workspaceId: ws, planId: id }, expectedFingerprint: local.preparationFingerprint, expectedReview: reviewStamp(local),
          preserveLocal: choice === 'remote', preserveRemote: choice === 'local' });
        if (choice === 'local') { const kept = await snapshot(c); await pending(c, await read(c), kept.data); await send(c); }
        return result;
      });
    }
    async function pause(ws, id) {
      const k = key(ws, id); generations.set(k, (generations.get(k) || 0) + 1);
      const c = context(ws, id), state = await read(c); if (state) await write(c, state, { enabled: false, error: null }); return stateFor(c);
    }
    async function inspect(remoteId) { const c = context(); await verified(c); return checkedRow(c, remoteId); }
    async function receive(remoteId, expectedRevision) {
      return serial('*', remoteId, async c => {
        await verified(c); const row = await checkedRow(c, remoteId); if (row.revision !== expectedRevision) throw fault('material_receive_changed');
        const target = await storage.findMaterialContinuity(remoteId); guard(c);
        if (target) {
          const localContext = context(target.workspaceId, target.planId), local = await snapshot(localContext), state = await read(localContext);
          if (!state?.enabled) throw fault('material_paused');
          if (!state.head || local.fingerprint !== await model.fingerprint(state.head.data)) { await conflict(localContext, state, row); throw fault('material_conflict'); }
          const result = await install(localContext, row, { target, expectedFingerprint: local.fingerprint, expectedReview: reviewStamp(local) }); guard(c); return result;
        }
        return install(c, row);
      });
    }
    function dispose() { if (disposed) return; disposed = true; remote.dispose?.(); blogRemote?.dispose?.(); blogSync?.dispose?.(); listeners.clear(); }
    return Object.freeze({ getState: (ws, id) => stateFor(context(ws, id)), preview: (ws, id) => review(context(ws, id)), connect, sync, pause,
      handoff, shareOutput, compare, resolve, inspect, receive,
      async list(after = null) { const c = context(); await verified(c); const result = await remote.list(after); guard(c); return result; },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, dispose });
  }
  return Object.freeze({ create, fault });
});

'use strict';
// Real account-scoped Storage/BlogSync/BlogRemote; only authenticated RPC/Edge
// responses are synthetic. No network, deployed SQL or provider success claim.
const test = require('node:test'), assert = require('node:assert/strict');
const Remote = require('../assets/life/blog-remote.js'), Markdown = require('../assets/life/post-markdown.js');
const { server, device, post, Core, Photo, Sync } = require('./helpers/blog-sync-cloud.cjs');
const F = require('./fixtures/photo-metadata.cjs');
const MD = 'life-post-md-v1', clone = value => structuredClone(value);
const fault = code => Object.assign(Error(code), { code });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };

async function fixture(t, { photos = 0, missingCopies = false, markdown = true, flagged = false } = {}) {
  const cloud = server(), a = await device(cloud, 'pending-recovery');
  const original = await post({ photos, body: '그대로 남을 본문 🌿\r\n정확한 다음 줄' });
  const doc = await a.storage.savePhotoPost(a.ws, markdown ? Markdown.fromV2(original).document : original, 0);
  await a.sync.saveDefault(a.ws, doc.id, { expectedLocalRevision: doc.revision });
  const durable = [], actualStorage = a.storage;
  const control = { mode: 'rollback', beforeLegacy: null, afterInitialRead: null, beforeRepairWrite: null, beforeEdge: null, loseEdge: false, failRead: false };
  a.sync.dispose();
  a.sync = Sync.create({ storage: { ...actualStorage, async readBlogSyncState(...args) {
    const state = await actualStorage.readBlogSyncState(...args);
    if (control.afterInitialRead) { const action = control.afterInitialRead; control.afterInitialRead = null; await action(state); }
    return state;
  }, async writeBlogSyncState(...args) {
    durable.push(clone(args[2].publishPending));
    if (control.beforeRepairWrite && args[2].publishPending?.documentFormat === MD) {
      const action = control.beforeRepairWrite; control.beforeRepairWrite = null; await action();
    }
    return actualStorage.writeBlogSyncState(...args);
  } }, auth: a.auth, remote: a.remote, blog: require('../assets/life/blog.js'), photoPost: Photo,
    makeId: Core.id, locks: null, timers: { setTimeout: () => 0, clearTimeout() {} } });
  const state = await a.storage.readBlogSyncState(a.ws, doc.id);
  const selection = { photoIds: doc.photos.map(p => p.id).reverse(), author: { name: '검토한 작성자', intro: '검토한 소개' } }, copies = [];
  if (!missingCopies) for (const [i, id] of selection.photoIds.entries()) {
    const blob = new Blob([F.png(1, 1, [41 + i, 51, 61, 255])], { type: 'image/png' });
    const copy = { id, type: blob.type, size: blob.size, width: 1, height: 1, digest: await Photo.digest(blob) };
    await a.remote.uploadPublicCopy(state.remoteId, copy, blob); copies.push(copy);
  }
  const pending = { operationId: Core.id(), expectedRevision: state.remoteRevision, expectedPublicRevision: 0, localRevision: doc.revision, selection,
    ...(copies.length ? { copies } : {}), ...(flagged ? { documentFormat: MD } : {}) };
  await a.storage.writeBlogSyncState(a.ws, doc.id, { ...state, publishPending: pending }, state.revision);
  const calls = [], receipts = new Map();
  const key = params => JSON.stringify({ post: params.p_post_id, revision: params.p_expected_revision, publicRevision: params.p_expected_publication_revision,
    photos: params.p_photo_ids, author: params.p_author, copies: params.p_copies || {} });
  function commit(params) {
    const receipt = receipts.get(params.p_operation_id);
    if (receipt) { assert.equal(key(params), receipt.key); return clone(receipt.result); }
    const row = cloud.rows.get(params.p_post_id);
    if (row.revision !== params.p_expected_revision || (row.publication?.revision || 0) !== params.p_expected_publication_revision) return { status: 'conflict' };
    row.publication = { token: Core.id(), blogToken: Core.id(), revision: params.p_expected_publication_revision + 1, active: true };
    const result = { status: 'published', ...row.publication };
    receipts.set(params.p_operation_id, { key: key(params), result: clone(result) }); return result;
  }
  const auth = { ready: true, get epoch() { return a.auth.epoch; }, get user() { return { id: a.auth.getAccount()?.userId }; },
    get session() { return { user: auth.user }; }, async verify() { return auth.user; }, client: {
      async rpc(name, params) {
        calls.push({ route: 'rpc', name, params: clone(params) });
        assert(['life_blog_publish', 'life_blog_publish_copies'].includes(name));
        if (control.beforeLegacy) await control.beforeLegacy();
        if (control.mode === 'conflict') return { status: 200, data: { status: 'conflict', revision: 2 } };
        if (control.mode === 'throw') throw { code: '22023', message: 'life_blog_markdown_publication_unavailable', publicationRolledBack: true };
        if (control.mode === 'network') return { status: 503, error: { code: 'network_error', publicationRolledBack: true } };
        if (control.mode === 'bare-code') return { status: 400, error: { code: 'blog_publication_unavailable', publicationRolledBack: true } };
        if (control.mode === 'missing-status') return { error: { code: '22023', message: 'life_blog_markdown_publication_unavailable' } };
        if (control.mode === 'wrong-status') return { status: 503, error: { code: '22023', message: 'life_blog_markdown_publication_unavailable' } };
        const prior = receipts.get(params.p_operation_id);
        if (prior) { assert.equal(key(params), prior.key); return { status: 200, data: clone(prior.result) }; }
        return { status: 400, error: { code: '22023', message: 'life_blog_markdown_publication_unavailable', details: 'never expose SQL details' } };
      },
      functions: { async invoke(name, { body }) {
        calls.push({ route: 'edge', name, params: clone(body) }); assert.equal(name, 'haedo-blog-publish');
        if (control.beforeEdge) await control.beforeEdge();
        if (control.mode === 'edge-unavailable') return { error: { name: 'FunctionsHttpError', context: new Response(JSON.stringify({ code: 'blog_publication_unavailable', publicationRolledBack: true }), { status: 503 }) } };
        const result = commit(body);
        if (control.loseEdge) { control.loseEdge = false; return { error: { code: 'network_error' } }; }
        return { data: result };
      } }
    } };
  const adapter = Remote.create({ auth, blog: require('../assets/life/blog.js') }); a.remote.publish = adapter.publish;
  const read = a.remote.read.bind(a.remote);
  a.remote.read = async (...args) => { if (control.failRead) throw fault('network_error'); return read(...args); };
  t.after(() => { adapter.dispose(); a.sync.dispose(); a.storage.close(); });
  const options = { expectedLocalRevision: doc.revision, expectedRemoteRevision: pending.expectedRevision,
    expectedPublicRevision: pending.expectedPublicRevision, ...clone(selection) };
  return { a, cloud, doc, pending, options, control, calls, receipts, commit, durable, binding: () => a.storage.readBlogSyncState(a.ws, doc.id),
    async unchanged() { assert.deepEqual(await a.storage.readPhotoPost(a.ws, doc.id), doc); for (const photo of doc.photos) assert.equal(await Photo.digest(photo.blob), photo.digest); } };
}

test('an exact legacy rollback adds only the Markdown route and reuses its operation, both CAS values, selection and public copies', async t => {
  for (const photos of [0, 2]) await t.test(String(photos) + ' selected photos', async t => {
    const f = await fixture(t, { photos });
    const result = await f.a.sync.publish(f.a.ws, f.doc.id, f.options);
    assert.equal(result.revision, 1); assert.deepEqual(f.calls.map(c => c.route), ['rpc', 'edge']);
    const [legacy, edge] = f.calls; assert.equal(legacy.params.p_operation_id, f.pending.operationId);
    assert.deepEqual(edge.params, { ...legacy.params, p_copies: legacy.params.p_copies || {} });
    assert.deepEqual(f.durable, [{ ...f.pending, documentFormat: MD }, null], 'route is durable before Edge; no intermediate deletion or new intent');
    assert.equal((await f.binding()).publishPending, null); await f.unchanged();
  });
});

test('network ambiguity, bare codes, thrown lookalikes and non-400 responses never change an old Markdown pending request', async t => {
  for (const mode of ['network', 'bare-code', 'throw', 'missing-status', 'wrong-status']) await t.test(mode, async t => {
    const f = await fixture(t); f.control.mode = mode; const before = await f.binding();
    await assert.rejects(f.a.sync.publish(f.a.ws, f.doc.id, f.options));
    assert.deepEqual(await f.binding(), before); assert.deepEqual(f.calls.map(c => c.route), ['rpc']); await f.unchanged();
  });
});

test('a completed legacy receipt is acknowledged without changing routes, even when the source is now Markdown', async t => {
  const f = await fixture(t), parameters = { p_post_id: (await f.binding()).remoteId, p_expected_revision: f.pending.expectedRevision,
    p_expected_publication_revision: 0, p_operation_id: f.pending.operationId, p_photo_ids: [], p_author: f.pending.selection.author };
  f.commit(parameters);
  const result = await f.a.sync.publish(f.a.ws, f.doc.id, f.options);
  assert.equal(result.revision, 1); assert.deepEqual(f.calls.map(c => c.route), ['rpc']); assert.equal(f.calls[0].params.p_operation_id, f.pending.operationId);
  assert.equal((await f.binding()).publishPending, null); assert.equal(f.receipts.size, 1); await f.unchanged();
});

test('a completed pre-copy photo receipt is replayed before checking for missing public copies', async t => {
  const f = await fixture(t, { photos: 1, missingCopies: true }), parameters = { p_post_id: (await f.binding()).remoteId, p_expected_revision: f.pending.expectedRevision,
    p_expected_publication_revision: 0, p_operation_id: f.pending.operationId, p_photo_ids: f.pending.selection.photoIds, p_author: f.pending.selection.author };
  f.commit(parameters);
  const result = await f.a.sync.publish(f.a.ws, f.doc.id, f.options);
  assert.equal(result.revision, 1); assert.deepEqual(f.calls.map(c => c.route), ['rpc']);
  assert.equal((await f.binding()).publishPending, null); assert.equal(f.receipts.size, 1); await f.unchanged();
});

test('a legacy conflict is not rollback proof and retains the exact Markdown pending request', async t => {
  for (const missingCopies of [false, true]) await t.test(missingCopies ? 'pre-copy photo' : 'text', async t => {
    const f = await fixture(t, { photos: missingCopies ? 1 : 0, missingCopies }), before = await f.binding(); f.control.mode = 'conflict';
    await assert.rejects(f.a.sync.publish(f.a.ws, f.doc.id, f.options), { code: 'blog_conflict' });
    assert.deepEqual(await f.binding(), before); assert.deepEqual(f.calls.map(c => c.route), ['rpc']);
  });
});

test('the same operation ID cannot hide a changed selection, private CAS, public CAS or copy set before replay', async t => {
  for (const changed of ['selection', 'expectedRevision', 'expectedPublicRevision', 'copies']) await t.test(changed, async t => {
    const f = await fixture(t, { photos: 1 });
    f.control.afterInitialRead = async state => {
      const pending = clone(state.publishPending);
      if (changed === 'selection') pending.selection.author.name = '다른 탭의 선택';
      else if (changed === 'copies') pending.copies[0].digest = 'a'.repeat(64);
      else pending[changed]++;
      await f.a.storage.writeBlogSyncState(f.a.ws, f.doc.id, { ...state, publishPending: pending }, state.revision);
    };
    await assert.rejects(f.a.sync.publish(f.a.ws, f.doc.id, f.options), { code: 'local_changed' });
    assert.equal(f.calls.length, 0, 'changed intent is refused before any publication request');
    assert.equal((await f.binding()).publishPending.operationId, f.pending.operationId); await f.unchanged();
  });
});

test('a competing server revision or publication is never adopted as the repaired request CAS', async t => {
  for (const changed of ['private', 'public']) await t.test(changed, async t => {
    const f = await fixture(t), row = f.cloud.rows.get((await f.binding()).remoteId);
    f.control.beforeEdge = async () => {
      if (changed === 'private') row.revision++;
      else row.publication = { token: Core.id(), blogToken: Core.id(), revision: 7, active: true };
    };
    await assert.rejects(f.a.sync.publish(f.a.ws, f.doc.id, f.options), { code: 'blog_conflict' });
    assert.deepEqual(f.calls.map(c => c.route), ['rpc', 'edge']);
    const repaired = f.calls[1].params;
    assert.equal(repaired.p_expected_revision, f.pending.expectedRevision); assert.equal(repaired.p_expected_publication_revision, f.pending.expectedPublicRevision);
    assert.equal(repaired.p_operation_id, f.pending.operationId); assert.equal(f.receipts.size, 0); await f.unchanged();
  });
});

test('a lost Edge ACK replays the upgraded durable operation without another legacy call or public revision', async t => {
  const f = await fixture(t, { photos: 2 }); f.control.loseEdge = true;
  await assert.rejects(f.a.sync.publish(f.a.ws, f.doc.id, f.options), { code: 'network_error' });
  assert.deepEqual((await f.binding()).publishPending, { ...f.pending, documentFormat: MD });
  const result = await f.a.sync.publish(f.a.ws, f.doc.id, f.options);
  assert.equal(result.revision, 1); assert.deepEqual(f.calls.map(c => c.route), ['rpc', 'edge', 'edge']);
  assert.deepEqual(f.calls[2], f.calls[1]); assert.equal(f.receipts.size, 1); await f.unchanged();
});

test('photo choices without durable copies first replay the legacy receipt and retain the exact pending after a proven rollback', async t => {
  const f = await fixture(t, { photos: 1, missingCopies: true }), before = await f.binding();
  await assert.rejects(f.a.sync.publish(f.a.ws, f.doc.id, f.options), error => /공개.*사진.*사본.*준비/.test(error.message));
  assert.deepEqual(f.calls.map(c => c.route), ['rpc']); assert.deepEqual(await f.binding(), before); await f.unchanged();
});

test('an old Markdown pending created while a new request prepares copies is never replaced by the pre-copy migration branch', async t => {
  const f = await fixture(t, { photos: 1, missingCopies: true }), prior = await f.binding();
  await f.a.storage.writeBlogSyncState(f.a.ws, f.doc.id, { ...prior, publishPending: null }, prior.revision);
  f.control.afterInitialRead = async state => {
    await f.a.storage.writeBlogSyncState(f.a.ws, f.doc.id, { ...state, publishPending: clone(f.pending) }, state.revision);
  };
  const blob = new Blob([F.png(1, 1, [71, 81, 91, 255])], { type: 'image/png' });
  const copy = { id: f.doc.photos[0].id, type: blob.type, size: blob.size, width: 1, height: 1, digest: await Photo.digest(blob), blob };
  await assert.rejects(f.a.sync.publish(f.a.ws, f.doc.id, { ...f.options, copies: [copy] }), { code: 'local_changed' });
  assert.deepEqual((await f.binding()).publishPending, f.pending); assert.deepEqual(f.calls, []);
  assert.equal(f.cloud.stats.copyUploads.length, 0); await f.unchanged();
});

test('an Edge unavailable response never authorizes another route replacement', async t => {
  const f = await fixture(t, { flagged: true }); f.control.mode = 'edge-unavailable'; const before = await f.binding();
  await assert.rejects(f.a.sync.publish(f.a.ws, f.doc.id, f.options), { code: 'blog_publication_unavailable' });
  assert.deepEqual(await f.binding(), before); assert.deepEqual(f.calls.map(c => c.route), ['edge']);
});

test('account changes, a new local revision, or a competing state CAS during legacy rejection cannot rewrite the pending request', async t => {
  for (const change of ['account', 'post', 'state', 'dispose']) await t.test(change, async t => {
    const f = await fixture(t), entered = deferred(), release = deferred();
    f.control.beforeLegacy = async () => { entered.resolve(); await release.promise; };
    const outcome = f.a.sync.publish(f.a.ws, f.doc.id, f.options); outcome.catch(() => {}); await entered.promise;
    if (change === 'account') f.a.auth.epoch++;
    if (change === 'dispose') f.a.sync.dispose();
    if (change === 'post') await f.a.storage.savePhotoPost(f.a.ws, { ...f.doc, title: '그사이 고친 제목' }, f.doc.revision);
    if (change === 'state') { const state = await f.binding(); await f.a.storage.writeBlogSyncState(f.a.ws, f.doc.id, { ...state, otherTab: true }, state.revision); }
    const before = await f.binding(); release.resolve();
    await assert.rejects(outcome, error => ['request_cancelled', 'local_changed', 'blog_state_conflict'].includes(error.code));
    assert.deepEqual(await f.binding(), before); assert.deepEqual(f.calls.map(c => c.route), ['rpc']);
  });
});

test('an acknowledgement whose following read fails keeps the original operation for receipt replay', async t => {
  const f = await fixture(t), parameters = { p_post_id: (await f.binding()).remoteId, p_expected_revision: f.pending.expectedRevision,
    p_expected_publication_revision: 0, p_operation_id: f.pending.operationId, p_photo_ids: [], p_author: f.pending.selection.author };
  f.commit(parameters); f.control.failRead = true; const before = await f.binding();
  await assert.rejects(f.a.sync.publish(f.a.ws, f.doc.id, f.options), { code: 'network_error' });
  assert.deepEqual(await f.binding(), before); assert.deepEqual(f.calls.map(c => c.route), ['rpc']);
});

test('the atomic route repair checks account ownership and local revision inside the storage transaction', async t => {
  for (const change of ['account', 'post', 'storage-failure']) await t.test(change, async t => {
    const f = await fixture(t), before = await f.binding();
    f.control.beforeRepairWrite = async () => {
      if (change === 'account') f.a.auth.epoch++;
      if (change === 'post') await f.a.storage.savePhotoPost(f.a.ws, { ...f.doc, title: '보완 직전 고친 제목' }, f.doc.revision);
      if (change === 'storage-failure') f.a.memory.control.fail = write => write.name === 'meta' && write.method === 'put';
    };
    await assert.rejects(f.a.sync.publish(f.a.ws, f.doc.id, f.options), { code: change === 'account' ? 'request_cancelled' : change === 'post' ? 'local_changed' : 'storage_quota' });
    assert.deepEqual(await f.binding(), before); assert.deepEqual(f.calls.map(c => c.route), ['rpc']);
  });
});

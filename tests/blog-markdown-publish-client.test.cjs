'use strict';
// Transport and durable retry contracts; the real Edge/SQL path is checked by
// post-markdown-publish-browser.cjs and the isolated PostgreSQL suite.
const test = require('node:test'), assert = require('node:assert/strict');
const Remote = require('../assets/life/blog-remote.js');
const Markdown = require('../assets/life/post-markdown.js');
const { server, device, post, Core, Photo, Blog } = require('./helpers/blog-sync-cloud.cjs');
const F = require('./fixtures/photo-metadata.cjs');
const MD = 'life-post-md-v1', POST = Core.id(), OP = Core.id();
const clone = value => structuredClone(value);
const fault = code => Object.assign(Error(code), { code });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const turn = () => new Promise(done => setImmediate(done));
function fixture(t) {
  const callbacks = new Set(), state = { rpc: [], edge: [], verifies: 0, response: { data: { status: 'stored', token: Core.id(), blogToken: Core.id(), revision: 1 }, error: null } };
  const auth = { ready: true, epoch: 1, user: { id: Core.id() }, async verify() { state.verifies++; return auth.user; },
    onAccountChange(callback) { callbacks.add(callback); return () => callbacks.delete(callback); }, client: {
      rpc(name, params) { state.rpc.push({ name, params }); return Promise.resolve(state.response); },
      functions: { async invoke(name, options) { state.edge.push({ name, ...options }); return state.pending || state.response; } }
    } };
  auth.session = { user: auth.user };
  const remote = Remote.create({ auth, blog: Blog }); t.after(() => remote.dispose());
  return { state, auth, remote, change() { auth.epoch++; auth.user = { id: Core.id() }; auth.session = { user: auth.user }; for (const fn of callbacks) fn({ userId: auth.user.id }); } };
}

test('Markdown publishes only selection, copies and durable CAS through Edge; legacy requests retain their RPC wire', async t => {
  const f = fixture(t), options = { documentFormat: MD, expectedPublicRevision: 0, author: { name: '익명', intro: '' }, photoIds: [], markdown: 'never sent', owner: 'never sent', ops: [] };
  await f.remote.publish(POST, 3, OP, options);
  assert.equal(f.state.verifies, 1); assert.equal(f.state.rpc.length, 0);
  const request = f.state.edge[0];
  assert.equal(request.name, 'haedo-blog-publish'); assert(request.signal instanceof AbortSignal);
  assert.deepEqual(request.body, { p_post_id: POST, p_expected_revision: 3, p_expected_publication_revision: 0, p_operation_id: OP, p_photo_ids: [], p_author: { name: '익명', intro: '' }, p_copies: {} });
  const copy = { id: 'photo', type: 'image/png', size: 10, digest: 'a'.repeat(64), width: 1, height: 1 };
  await f.remote.publish(POST, 3, OP, { documentFormat: MD, photoIds: ['photo'], copies: [copy] });
  const { id, ...metadata } = copy; assert.deepEqual(f.state.edge[1].body.p_copies, { photo: metadata });
  await f.remote.publish(POST, 3, OP, {});
  await f.remote.publish(POST, 3, OP, { photoIds: ['photo'], copies: [copy] });
  assert.deepEqual(f.state.rpc.map(call => call.name), ['life_blog_publish', 'life_blog_publish_copies']);
  assert.equal(Object.hasOwn(f.state.rpc[0].params, 'p_copies'), false);
  assert.deepEqual(f.state.rpc[1].params.p_copies, { photo: metadata }); assert.equal(f.state.edge.length, 2);
  f.remote.dispose(); assert.equal(request.signal.aborted, false, 'finished request releases its controller');
});

test('Markdown route freezes reviewed values before account verification and rejects unknown routes before sending', async t => {
  const f = fixture(t), held = deferred(); f.auth.verify = () => held.promise;
  const copy = { id: 'photo', type: 'image/png', size: 10, digest: 'a'.repeat(64), width: 1, height: 1 };
  const options = { documentFormat: MD, author: { name: 'reviewed', intro: '' }, photoIds: ['photo'], copies: [copy] };
  const pending = f.remote.publish(POST, 3, OP, options);
  options.author.name = 'later'; options.photoIds.length = 0; copy.digest = 'b'.repeat(64); options.documentFormat = 'future';
  held.resolve(f.auth.user); await pending;
  assert.equal(f.state.edge[0].body.p_author.name, 'reviewed'); assert.deepEqual(f.state.edge[0].body.p_photo_ids, ['photo']);
  assert.equal(f.state.edge[0].body.p_copies.photo.digest, 'a'.repeat(64));
  for (const documentFormat of ['life-post-v2', 'life-post-md-v2', null, undefined, '']) await assert.rejects(f.remote.publish(POST, 3, OP, { documentFormat }), { code: 'invalid_request' });
  assert.equal(f.state.edge.length, 1); assert.equal(f.state.rpc.length, 0);
});

test('Edge HTTP errors expose only known codes; malformed receipts fail the existing validation', async t => {
  const f = fixture(t);
  for (const [status, body, code] of [[409, { code: 'blog_conflict', detail: 'private SQL' }, 'blog_conflict'], [409, { code: 'operation_mismatch' }, 'operation_mismatch'],
    [503, { code: 'blog_publication_unavailable' }, 'blog_publication_unavailable'], [400, { code: 'blog_update_required' }, 'blog_update_required'],
    [500, { code: '__proto__', detail: 'private SQL' }, 'network_error'], [403, { code: 'private SQL' }, 'permission_denied'], [401, null, 'auth_required'], [404, null, 'schema_missing']]) {
    f.state.response = { error: { name: 'FunctionsHttpError', context: new Response(JSON.stringify(body), { status }) } };
    await assert.rejects(f.remote.publish(POST, 3, OP, { documentFormat: MD }), error => error.code === code && !error.message.includes('private'));
  }
  f.state.response = { error: { name: 'FunctionsHttpError', context: new Response('<html>private error</html>', { status: 502 }) } };
  await assert.rejects(f.remote.publish(POST, 3, OP, { documentFormat: MD }), { code: 'network_error' });
  for (const data of [null, { status: 'stored', token: 'bad', revision: 1 }, { status: 'stored', token: POST, blogToken: OP, revision: 0 }]) {
    f.state.response = { data }; await assert.rejects(f.remote.publish(POST, 3, OP, { documentFormat: MD }), { code: 'invalid_remote_data' });
  }
});

test('Markdown direct calls reject unreviewed nested data and incomplete photo selections before verification or transfer', async t => {
  const f = fixture(t), copy = { id: 'photo', type: 'image/png', size: 10, digest: 'a'.repeat(64), width: 1, height: 1 };
  const invalid = [
    { author: { name: '', intro: '', privateBody: 'must never leave this device' } },
    { author: { name: '' } }, { author: null }, { author: { name: 1, intro: '' } },
    { author: { name: 'n'.repeat(501), intro: '' } }, { author: { name: '', intro: 'i'.repeat(2001) } },
    { author: { name: '\u0000', intro: '' } }, { author: { name: '', intro: '\ud800' } },
    { photoIds: ['photo', 'photo'], copies: [copy] }, { photoIds: Array.from({ length: 21 }, (_, n) => 'p' + n) },
    { photoIds: ['photo'] }, { photoIds: ['photo'], copies: [] }, { photoIds: [], copies: [copy] },
    { photoIds: ['photo'], copies: [copy, copy] }, { photoIds: null }, { photoIds: [42] }, { photoIds: Array(1) }, { copies: null }
  ];
  const symbolAuthor = { name: '', intro: '', [Symbol('private')]: 'private' }; invalid.push({ author: symbolAuthor });
  for (const options of invalid) await assert.rejects(f.remote.publish(POST, 3, OP, { documentFormat: MD, ...options }), { code: 'invalid_request' });
  assert.equal(f.state.verifies, 0); assert.equal(f.state.edge.length, 0); assert.equal(f.state.rpc.length, 0);
  // Limits count UTF-16 units, accept ordinary emoji, and carry no extra fields.
  await f.remote.publish(POST, 3, OP, { documentFormat: MD, author: { name: '🌿'.repeat(250), intro: 'i'.repeat(2000) } });
  assert.deepEqual(Object.keys(f.state.edge[0].body.p_author).sort(), ['intro', 'name']);
  // Legacy calls keep their historical RPC behavior, even for formerly accepted extras.
  await f.remote.publish(POST, 3, OP, { author: { name: '', intro: '', legacyField: true }, photoIds: ['photo', 'photo'] });
  assert.equal(f.state.rpc[0].name, 'life_blog_publish');
});

test('Markdown copy maps preserve valid prototype-like photo IDs as own JSON keys', async t => {
  const f = fixture(t), ids = ['__proto__', 'constructor', 'toString'];
  const copies = ids.map(id => ({ id, type: 'image/png', size: 10, digest: 'a'.repeat(64), width: 1, height: 1 }));
  await f.remote.publish(POST, 3, OP, { documentFormat: MD, photoIds: ids, copies });
  const named = JSON.parse(JSON.stringify(f.state.edge[0].body.p_copies));
  assert.deepEqual(Object.keys(named), ids);
  for (const id of ids) { assert.equal(Object.hasOwn(named, id), true); assert.equal(named[id].digest, 'a'.repeat(64)); }
});

test('late Edge success and error-body reads are cancelled on account change or disposal', async t => {
  for (const end of ['account', 'dispose', 'error-body']) {
    const f = fixture(t), held = deferred();
    if (end === 'error-body') f.state.response = { error: { name: 'FunctionsHttpError', context: { status: 409, json: () => held.promise } } };
    else f.state.pending = held.promise;
    const pending = f.remote.publish(POST, 3, OP, { documentFormat: MD }); await turn();
    if (end === 'dispose') f.remote.dispose(); else f.change();
    assert.equal(f.state.edge[0].signal.aborted, true);
    held.resolve(end === 'error-body' ? { code: 'blog_conflict' } : f.state.response);
    await assert.rejects(pending, { code: 'request_cancelled' });
  }
});

test('an older SDK cannot publish Markdown but its legacy RPC path is still usable', async t => {
  const f = fixture(t); delete f.auth.client.functions;
  await assert.rejects(f.remote.publish(POST, 3, OP, { documentFormat: MD }), { code: 'schema_missing' });
  await f.remote.publish(POST, 3, OP, {}); assert.equal(f.state.rpc.length, 1);
});

async function saved(t, photos = 0, markdown = true) {
  const cloud = server(), a = await device(cloud, 'publish-device'); t.after(() => { a.sync.dispose(); a.storage.close(); });
  const v2 = await post({ photos }), doc = markdown ? Markdown.fromV2(v2).document : v2;
  const value = await a.storage.savePhotoPost(a.ws, doc, 0); await a.sync.syncNow();
  return { cloud, a, value };
}

test('lost ACK after Markdown publication retries the persisted route, operation, CAS and uploaded copy exactly once', async t => {
  const { cloud, a, value } = await saved(t, 1), source = value.photos[0];
  const blob = new Blob([F.png(1, 1, [10, 20, 30, 255])], { type: 'image/png' });
  const copy = { id: source.id, type: blob.type, size: blob.size, width: 1, height: 1, digest: await Photo.digest(blob), blob };
  const original = a.remote.publish.bind(a.remote), receipts = new Map(), attempts = []; let lose = true;
  a.remote.publish = async (...args) => {
    const durable = (await a.storage.readBlogSyncState(a.ws, value.id)).publishPending;
    assert.equal(durable.documentFormat, MD); assert.equal(durable.operationId, args[2]);
    assert.equal(cloud.stats.copyUploads.length, 1, 'copy is uploaded before the durable request'); attempts.push(clone(args));
    const prior = receipts.get(args[2]);
    if (prior) { assert.deepEqual(args, prior.request); return clone(prior.result); }
    const result = await original(...args); receipts.set(args[2], { request: clone(args), result });
    if (lose) { lose = false; throw fault('network_error'); } return result;
  };
  const options = { photoIds: [source.id], copies: [copy], expectedLocalRevision: value.revision };
  await assert.rejects(a.sync.publish(a.ws, value.id, options), { code: 'network_error' });
  const pending = (await a.storage.readBlogSyncState(a.ws, value.id)).publishPending;
  assert.equal(pending.documentFormat, MD); assert.equal(pending.expectedPublicRevision, 0);
  assert.equal(cloud.rows.get(value.id).publication.revision, 1, 'first request committed despite the lost ACK');
  assert.equal(Object.hasOwn(pending.copies[0], 'blob'), false);
  // No copy bytes are available on retry: the durable metadata/receipt suffices.
  const published = await a.sync.publish(a.ws, value.id, { photoIds: [source.id], expectedLocalRevision: value.revision });
  assert.equal(published.revision, 1); assert.deepEqual(attempts[1], attempts[0]);
  assert.equal(cloud.stats.publishes.length, 1); assert.equal(cloud.stats.copyUploads.length, 1);
  assert.equal((await a.storage.readBlogSyncState(a.ws, value.id)).publishPending, null);
  const local = await a.storage.readPhotoPost(a.ws, value.id);
  assert.equal(local.markdown, value.markdown); assert.equal(local.photos[0].digest, source.digest);
  assert.equal(await Photo.digest(local.photos[0].blob), source.digest);
});

test('new v2 pending and pre-B3 Markdown pending stay on the unflagged legacy request', async t => {
  for (const markdown of [false, true]) {
    const { a, value } = await saved(t, 0, markdown), state = await a.storage.readBlogSyncState(a.ws, value.id), operation = Core.id();
    const legacy = { operationId: operation, expectedRevision: state.remoteRevision, expectedPublicRevision: 0, localRevision: value.revision,
      selection: { photoIds: [], author: { name: '', intro: '' } } };
    if (markdown) await a.storage.writeBlogSyncState(a.ws, value.id, { ...state, publishPending: legacy }, state.revision);
    let attempts = 0;
    a.remote.publish = async (_id, _revision, operationId, options) => {
      attempts++; assert.equal(Object.hasOwn(options, 'documentFormat'), false);
      if (markdown) assert.equal(operationId, operation);
      throw fault(markdown ? 'blog_publication_unavailable' : 'network_error');
    };
    const options = { expectedLocalRevision: value.revision };
    await assert.rejects(a.sync.publish(a.ws, value.id, options), { code: markdown ? 'blog_publication_unavailable' : 'network_error' });
    const pending = (await a.storage.readBlogSyncState(a.ws, value.id)).publishPending;
    assert.equal(Object.hasOwn(pending, 'documentFormat'), false); if (markdown) assert.deepEqual(pending, legacy);
    await assert.rejects(a.sync.publish(a.ws, value.id, options));
    assert.deepEqual((await a.storage.readBlogSyncState(a.ws, value.id)).publishPending, pending); assert.equal(attempts, 2);
  }
});

// 2026-11-11 owner rule (publication recovery): a request whose result is unknown no longer
// blocks a different explicit choice. The exact server head shows whether it was applied; one
// that was not is replaced by the new choice (tests/blog-publication-settle.test.cjs covers the
// applied case and the late arrival). The earlier assertion here (local_changed for a changed
// selection or a newer saved revision) was the reviewed defect "글이 변경됐습니다".
test('a durable Markdown request the server did not apply is replaced by a changed selection or a newer saved revision, never sent twice', async t => {
  const { cloud, a, value } = await saved(t), sent = [];
  a.remote.publish = async (...args) => { sent.push(clone(args)); throw fault('network_error'); };
  await assert.rejects(a.sync.publish(a.ws, value.id, { expectedLocalRevision: value.revision }), { code: 'network_error' });
  const pending = (await a.storage.readBlogSyncState(a.ws, value.id)).publishPending;
  await assert.rejects(a.sync.publish(a.ws, value.id, { expectedLocalRevision: value.revision, author: { name: 'changed', intro: '' } }), { code: 'network_error' });
  const replaced = (await a.storage.readBlogSyncState(a.ws, value.id)).publishPending;
  assert.notEqual(replaced.operationId, pending.operationId); assert.deepEqual(replaced.selection.author, { name: 'changed', intro: '' });
  assert.equal(replaced.documentFormat, MD); assert.equal(replaced.expectedPublicRevision, 0);
  assert.equal(sent.length, 2); assert.equal(sent[1][2], replaced.operationId); assert.deepEqual(sent[1][3].author, { name: 'changed', intro: '' });
  const updated = await a.storage.savePhotoPost(a.ws, { ...value, title: '바뀐 제목' }, value.revision);
  await assert.rejects(a.sync.publish(a.ws, value.id, { expectedLocalRevision: updated.revision }), { code: 'network_error' });
  const latest = (await a.storage.readBlogSyncState(a.ws, value.id)).publishPending;
  assert.equal(latest.localRevision, updated.revision); assert.notEqual(latest.operationId, replaced.operationId);
  assert.equal(sent.length, 3); assert.equal(sent[2][1], latest.expectedRevision);
  // A revision that is no longer the saved one is still refused before any request.
  await assert.rejects(a.sync.publish(a.ws, value.id, { expectedLocalRevision: value.revision }), { code: 'local_changed' });
  assert.equal(sent.length, 3); assert.deepEqual((await a.storage.readBlogSyncState(a.ws, value.id)).publishPending, latest);
  assert.equal(cloud.rows.get(value.id).publication, null, 'nothing was published');
});

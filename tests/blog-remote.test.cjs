'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Remote = require('../assets/life/blog-remote.js'), Blog = require('../assets/life/blog.js'), Photo = require('../assets/life/photo-post.js'), Core = require('../assets/life/core.js');
const UID = Core.id(), WS = Core.id(), POST = Core.id(), OTHER = Core.id(), OP = Core.id();
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
function document() { const d = Photo.create(() => POST); d.title = '익명 여행'; d.status = 'saved'; d.revision = 1; d.ops = [{ insert: '보관할 원문 🌿\n' }]; return d; }
function fixture() {
  const callbacks = new Set(), state = { calls: [], verifications: 0, uploads: [], downloads: [], signals: [] };
  const auth = { ready: true, epoch: 1, config: { url: 'https://blog-test.supabase.co' }, user: { id: UID },
    async verify() { state.verifications++; for (const listener of callbacks) listener({ userId: auth.user?.id }); return auth.user; },
    onAccountChange(listener) { callbacks.add(listener); return () => callbacks.delete(listener); }, client: {
      rpc(name, params) { state.calls.push({ name, params }); return { abortSignal(signal) { state.signals.push(signal); return this; }, then(resolve, reject) { return (state.pending || Promise.resolve({ data: state.data, error: state.error })).then(resolve, reject); } }; },
      storage: { from(bucket) { return { async upload(path, blob, options) { state.uploads.push({ bucket, path, blob, options }); return { error: null }; }, async download(path) { state.downloads.push({ bucket, path }); return { data: state.blob, error: null }; } }; } },
      auth: { dispose() { throw Error('Shared session must remain alive'); } }
    } };
  return { auth, state, adapter: Remote.create({ auth, blog: Blog }), change() { auth.epoch++; auth.user = { id: OTHER }; for (const listener of callbacks) listener({ userId: OTHER }); }, callbacks };
}
test('private list/read borrow verified account and snapshot exact selected manifest without changing shared Auth', async () => {
  const f = fixture(), doc = document(); f.state.data = { id: POST, workspace_id: WS, revision: 1, updated_at: doc.updatedAt, data: Blog.pack(doc), assets: {}, publication: null };
  const result = await f.adapter.read(POST); assert.equal(result.id, POST); result.data.title = 'caller'; assert.equal(f.state.data.data.title, doc.title);
  assert.equal(f.state.verifications, 2); assert.deepEqual(f.state.calls[0], { name: 'life_blog_read', params: { p_post_id: POST } });
  f.state.data = [{ id: POST, workspace_id: WS, revision: 1, title: doc.title }]; assert.equal((await f.adapter.list(WS)).length, 1);
  assert.equal(f.state.calls[1].params.p_workspace_id, WS); f.adapter.dispose(); assert.equal(f.callbacks.size, 0);
});
test('manifest and identity failures happen before network; wrong snapshot/asset owner cannot be read', async () => {
  const f = fixture(), d = Blog.pack(document());
  await assert.rejects(f.adapter.save({ workspaceId: WS, postId: 'bad', operationId: OP, expectedRevision: 0, data: d }), { code: 'invalid_request' });
  await assert.rejects(f.adapter.save({ workspaceId: WS, postId: POST, operationId: OP, expectedRevision: 0, data: { ...d, unexpected: true } }), { code: 'invalid_remote_data' });
  assert.equal(f.state.calls.length, 0);
  for (const changes of [{ id: OTHER }, { revision: 0 }, { workspace_id: 'bad' }, { assets: { extra: { bucket: 'public' } } }, { publication: { token: OP, blogToken: WS, revision: 1, active: 'yes' } }]) {
    f.state.data = { id: POST, workspace_id: WS, revision: 1, updated_at: d.updatedAt, data: d, assets: {}, publication: null, ...changes };
    await assert.rejects(f.adapter.read(POST), { code: 'invalid_remote_data' });
  }
  await assert.rejects(f.adapter.downloadAsset({ bucket: 'haedo-blog-originals', path: OTHER + '/secret' }), { code: 'invalid_remote_data' }); f.adapter.dispose();
});
test('private save freezes payload before asynchronous verification and preserves CAS/idempotency identifiers', async () => {
  const f = fixture(), held = deferred(), d = Blog.pack(document()); f.auth.verify = async () => held.promise; f.state.data = { status: 'stored', revision: 1 };
  const request = { workspaceId: WS, postId: POST, operationId: OP, expectedRevision: 0, data: d }, pending = f.adapter.save(request);
  request.data.title = 'changed during request'; request.expectedRevision = 5; held.resolve(f.auth.user); assert.equal((await pending).status, 'stored');
  assert.equal(f.state.calls[0].params.p_data.title, '익명 여행'); assert.equal(f.state.calls[0].params.p_expected_revision, 0); assert.equal(f.state.calls[0].params.p_operation_id, OP); f.adapter.dispose();
});
test('asset bytes are hashed before preparation; existing immutable objects are reused without overwrite', async () => {
  const f = fixture(), blob = new Blob(['anonymous bytes'], { type: 'image/png' }), photo = { id: Core.id(), digest: await Photo.digest(blob), size: blob.size, type: blob.type, width: 1, height: 1 };
  const path = UID + '/' + POST + '/' + photo.id + '/' + photo.digest;
  f.state.data = { bucket: 'haedo-blog-originals', path, exists: false };
  assert.equal((await f.adapter.uploadAsset(POST, photo, blob)).path, path); assert.equal(f.state.uploads.length, 1); assert.equal(f.state.uploads[0].options.upsert, false);
  f.state.data.exists = true; await f.adapter.uploadAsset(POST, photo, blob); assert.equal(f.state.uploads.length, 1);
  const calls = f.state.calls.length; await assert.rejects(f.adapter.uploadAsset(POST, { ...photo, digest: '0'.repeat(64) }, blob), { code: 'invalid_remote_data' }); assert.equal(f.state.calls.length, calls); f.adapter.dispose();
});
test('account change and disposal abort late RPC replies without accepting another user or disposing shared session', async () => {
  for (const change of ['account', 'dispose']) {
    const f = fixture(), held = deferred(); f.state.pending = held.promise; const pending = f.adapter.list();
    await new Promise(done => setImmediate(done)); if (change === 'account') f.change(); else f.adapter.dispose();
    assert.equal(f.state.signals[0].aborted, true); held.resolve({ data: [], error: null }); await assert.rejects(pending, { code: 'request_cancelled' }); f.adapter.dispose();
  }
});
test('public mutations carry separate private/public CAS and explicit photo selections; raw errors are redacted', async () => {
  const f = fixture(); f.state.data = { status: 'published', token: POST, blogToken: WS, revision: 3 };
  await f.adapter.publish(POST, 2, OP, { expectedPublicRevision: 2 }); const args = f.state.calls[0].params;
  assert.equal(args.p_expected_revision, 2); assert.equal(args.p_expected_publication_revision, 2); assert.deepEqual(args.p_photo_ids, []);
  for (const [error, code] of [[{ code: 'PGRST202', message: 'private SQL bearer' }, 'schema_missing'], [{ code: '42501', message: 'private owner' }, 'permission_denied'], [{ message: 'private stack' }, 'network_error']]) {
    f.state.error = error; await assert.rejects(f.adapter.list(), e => e.code === code && !e.message.includes('private'));
  }
  f.adapter.dispose();
});

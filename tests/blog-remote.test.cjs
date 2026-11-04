'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Remote = require('../assets/life/blog-remote.js'), Blog = require('../assets/life/blog.js'), Photo = require('../assets/life/photo-post.js'), Core = require('../assets/life/core.js');
const Sync = require('../assets/life/blog-sync.js'), { createStorage } = require('../assets/life/storage.js'), { memoryIdb, owner, USER } = require('./helpers/blog-sync-cloud.cjs');
const UID = Core.id(), WS = Core.id(), POST = Core.id(), OTHER = Core.id(), OP = Core.id();
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
function document() { const d = Photo.create(() => POST); d.title = '익명 여행'; d.status = 'saved'; d.revision = 1; d.ops = [{ insert: '보관할 원문 🌿\n' }]; return d; }
function fixture(userId = UID) {
  const callbacks = new Set(), state = { calls: [], verifications: 0, uploads: [], downloads: [], removed: [], signals: [], replies: null };
  const auth = { ready: true, epoch: 1, config: { url: 'https://blog-test.supabase.co' }, user: { id: userId }, session: { user: { id: userId } },
    async verify() { state.verifications++; for (const listener of callbacks) listener({ userId: auth.user?.id }); return auth.user; },
    onAccountChange(listener) { callbacks.add(listener); return () => callbacks.delete(listener); }, client: {
      rpc(name, params) {
        state.calls.push({ name, params });
        const reply = state.replies?.(name, params);
        return { abortSignal(signal) { state.signals.push(signal); return this; }, then(resolve, reject) { return (state.pending || Promise.resolve(reply || { data: state.data, error: state.error })).then(resolve, reject); } };
      },
      storage: { from(bucket) { return {
        async upload(path, blob, options) { state.uploads.push({ bucket, path, blob, options }); return { error: null }; },
        async download(path) { state.downloads.push({ bucket, path }); return { data: state.blob, error: null }; },
        async remove(paths) { state.removed.push({ bucket, paths }); return { data: paths.map(name => ({ name })), error: null }; } }; } },
      auth: { dispose() { throw Error('Shared session must remain alive'); } }
    } };
  return { auth, state, adapter: Remote.create({ auth, blog: Blog }), change() { auth.epoch++; auth.user = { id: OTHER }; auth.session = { user: { id: OTHER } }; for (const listener of callbacks) listener({ userId: OTHER }); }, callbacks };
}
test('reads and lists use the cheap identity check; one explicit verify covers them without changing shared Auth', async () => {
  const f = fixture(), doc = document(); f.state.data = { id: POST, workspace_id: WS, revision: 1, updated_at: doc.updatedAt, data: Blog.pack(doc), assets: {}, publication: null };
  await f.adapter.verify(); assert.equal(f.state.verifications, 1);
  const result = await f.adapter.read(POST); assert.equal(result.id, POST); result.data.title = 'caller'; assert.equal(f.state.data.data.title, doc.title);
  assert.equal(f.state.verifications, 1, 'no network check per read'); assert.deepEqual(f.state.calls[0], { name: 'life_blog_read', params: { p_post_id: POST } });
  f.state.data = [{ id: POST, workspace_id: WS, revision: 1, title: doc.title }]; assert.equal((await f.adapter.list(WS)).length, 1);
  assert.equal(f.state.calls[1].params.p_workspace_id, WS); assert.equal(f.state.verifications, 1);
  f.adapter.dispose(); assert.equal(f.callbacks.size, 0);
});
test('a session that no longer belongs to the account cancels a request before it is sent', async () => {
  const f = fixture(); f.auth.session = { user: { id: OTHER } };
  await assert.rejects(f.adapter.read(POST), { code: 'request_cancelled' }); assert.equal(f.state.calls.length, 0);
  f.auth.session = null; await assert.rejects(f.adapter.syncList(), { code: 'request_cancelled' }); assert.equal(f.state.calls.length, 0); f.adapter.dispose();
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
test('drafts round-trip; HEIC originals need exactly one JPEG view and the read returns both locators', async () => {
  const f = fixture(), draft = { ...Blog.pack(document()), status: 'draft' };
  f.state.data = { id: POST, workspace_id: WS, revision: 2, updated_at: draft.updatedAt, data: draft, assets: {}, publication: null };
  assert.equal((await f.adapter.read(POST)).data.status, 'draft');
  const heic = { id: 'heic-photo', name: 'IMG.HEIC', type: 'image/heic', width: 4032, height: 3024, size: 11, digest: 'c'.repeat(64), view: { type: 'image/jpeg', size: 9, digest: 'd'.repeat(64), width: 4032, height: 3024 } };
  const data = { ...Blog.pack(document()), photos: [heic], ops: [{ insert: '본문\n' }, { insert: { photo: { id: 'heic-photo', caption: '', alt: '' } } }, { insert: '\n' }] };
  const path = digest => UID + '/' + POST + '/heic-photo/' + digest;
  f.state.data = { id: POST, workspace_id: WS, revision: 1, updated_at: data.updatedAt, data, publication: null,
    assets: { 'heic-photo': { bucket: 'haedo-blog-originals', path: path(heic.digest), view: { bucket: 'haedo-blog-originals', path: path(heic.view.digest) } } } };
  assert.equal((await f.adapter.read(POST)).assets['heic-photo'].view.path, path(heic.view.digest));
  f.state.data.assets['heic-photo'] = { bucket: 'haedo-blog-originals', path: path(heic.digest) };
  await assert.rejects(f.adapter.read(POST), { code: 'invalid_remote_data' }, 'a view locator is required');
  assert.equal(Remote.checkViews({ photos: [heic] }), true);
  assert.equal(Remote.checkViews({ photos: [{ ...heic, view: undefined }] }), false);
  assert.equal(Remote.checkViews({ photos: [{ ...heic, view: { ...heic.view, type: 'image/png' } }] }), false);
  assert.equal(Remote.checkViews({ photos: [{ ...heic, type: 'image/jpeg' }] }), false, 'non-HEIC photos never carry a view');
  f.adapter.dispose();
});
test('private save freezes payload and verifies the account once right before the durable commit', async () => {
  const f = fixture(), held = deferred(), d = Blog.pack(document()); f.auth.verify = async () => { f.state.verifications++; return held.promise; }; f.state.data = { status: 'stored', revision: 1 };
  const request = { workspaceId: WS, postId: POST, operationId: OP, expectedRevision: 0, data: d }, pending = f.adapter.save(request);
  request.data.title = 'changed during request'; request.expectedRevision = 5; held.resolve(f.auth.user); assert.equal((await pending).status, 'stored');
  assert.equal(f.state.verifications, 1);
  assert.equal(f.state.calls[0].params.p_data.title, '익명 여행'); assert.equal(f.state.calls[0].params.p_expected_revision, 0); assert.equal(f.state.calls[0].params.p_operation_id, OP); f.adapter.dispose();
});
test('asset bytes are hashed before preparation; existing immutable objects are reused without overwrite or network verification', async () => {
  const f = fixture(), blob = new Blob(['anonymous bytes'], { type: 'image/png' }), photo = { id: Core.id(), digest: await Photo.digest(blob), size: blob.size, type: blob.type, width: 1, height: 1 };
  const path = UID + '/' + POST + '/' + photo.id + '/' + photo.digest;
  f.state.data = { bucket: 'haedo-blog-originals', path, exists: false };
  assert.equal((await f.adapter.uploadAsset(POST, photo, blob)).path, path); assert.equal(f.state.uploads.length, 1); assert.equal(f.state.uploads[0].options.upsert, false);
  f.state.data.exists = true; await f.adapter.uploadAsset(POST, photo, blob); assert.equal(f.state.uploads.length, 1);
  assert.equal(f.state.verifications, 0);
  const calls = f.state.calls.length; await assert.rejects(f.adapter.uploadAsset(POST, { ...photo, digest: '0'.repeat(64) }, blob), { code: 'invalid_remote_data' }); assert.equal(f.state.calls.length, calls); f.adapter.dispose();
});
test('deletion verifies once, accepts only this post paths, and removes exactly those objects', async () => {
  const f = fixture(), paths = [UID + '/' + POST + '/photo-a/' + 'a'.repeat(64)];
  f.state.data = { status: 'deleted', revision: 3, paths };
  const result = await f.adapter.deletePost(POST, 3); assert.deepEqual(result.paths, paths); assert.equal(f.state.verifications, 1);
  assert.deepEqual(f.state.calls[0], { name: 'life_blog_delete', params: { p_post_id: POST, p_expected_revision: 3 } });
  assert.equal(await f.adapter.removeAssets(POST, paths), 1); assert.deepEqual(f.state.removed[0], { bucket: 'haedo-blog-originals', paths });
  await assert.rejects(f.adapter.removeAssets(POST, [OTHER + '/' + POST + '/photo-a/' + 'a'.repeat(64)]), { code: 'invalid_request' });
  f.state.data = { status: 'deleted', revision: 3, paths: [UID + '/' + OTHER + '/photo/' + 'a'.repeat(64)] };
  await assert.rejects(f.adapter.deletePost(POST), { code: 'invalid_remote_data' }); f.adapter.dispose();
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
test('a full upload of three new photos makes two network account checks (was about eighteen)', async () => {
  const f = fixture(USER), memory = memoryIdb();
  const storage = createStorage({ idb: memory.idb, core: Core, channelFactory: null, account: owner }), ws = (await storage.createWorkspace('공간')).workspaceId;
  const doc = Photo.create(Core.id); doc.status = 'saved'; doc.title = '사진 세 장'; doc.ops = [{ insert: '본문\n' }];
  for (let n = 0; n < 3; n++) {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, n])], { type: 'image/png' });
    const photo = { id: Core.id(), name: n + '.png', type: 'image/png', width: 1, height: 1, size: blob.size, digest: await Photo.digest(blob), blob };
    doc.photos.push(photo); doc.ops.push({ insert: { photo: { id: photo.id, caption: '', alt: '' } } }, { insert: '\n' });
  }
  const saved = await storage.savePhotoPost(ws, doc, 0);
  f.state.replies = (name, params) => name === 'life_blog_prepare_asset' ? { data: { bucket: 'haedo-blog-originals', path: USER + '/' + params.p_post_id + '/' + params.p_photo_id + '/' + params.p_digest, exists: false }, error: null }
    : name === 'life_blog_save' ? { data: { status: 'stored', revision: 1 }, error: null } : null;
  f.auth.getAccount = () => owner;
  const sync = Sync.create({ storage, auth: f.auth, blog: Blog, photoPost: Photo, remote: f.adapter, makeId: Core.id, locks: null });
  const result = await sync.saveDefault(ws, saved.id, { expectedLocalRevision: saved.revision });
  assert.equal(result.status, 'synced'); assert.equal(f.state.uploads.length, 3);
  assert.equal(f.state.verifications, 2, 'one at transfer start, one right before life_blog_save');
  assert.deepEqual(f.state.calls.map(call => call.name), ['life_blog_prepare_asset', 'life_blog_prepare_asset', 'life_blog_prepare_asset', 'life_blog_save']);
  sync.dispose();
});

// 2026-11-04 (PR183 re-review minor): a photo download in progress is aborted by dispose or an
// account change instead of running to the end; a finished one releases its controller.
test('an in-progress photo download is aborted by dispose or an account change, and nothing is returned', async () => {
  for (const end of ['dispose', 'change']) {
    const f = fixture(), signals = [];
    f.auth.client.storage.from = bucket => ({ download(path, options, parameters) {
      signals.push(parameters?.signal); f.state.downloads.push({ bucket, path });
      return new Promise((resolve, reject) => parameters.signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' })), { once: true }));
    } });
    const pending = f.adapter.downloadAsset({ bucket: 'haedo-blog-originals', path: UID + '/' + POST + '/photo' });
    await new Promise(done => setImmediate(done));
    assert.equal(signals.length, 1); assert.equal(signals[0].aborted, false);
    if (end === 'dispose') f.adapter.dispose(); else f.change();
    await assert.rejects(pending, { code: 'request_cancelled' });
    assert.equal(signals[0].aborted, true, end + ' aborts the transfer');
    if (end === 'change') f.adapter.dispose();
  }
  // A completed download passes a signal that is never aborted later.
  const f = fixture(); let seen = null; f.state.blob = new Blob(['x']);
  f.auth.client.storage.from = () => ({ async download(path, options, parameters) { seen = parameters.signal; return { data: f.state.blob, error: null }; } });
  assert.equal(await (await f.adapter.downloadAsset({ bucket: 'haedo-blog-originals', path: UID + '/x' })).text(), 'x');
  f.adapter.dispose(); assert.equal(seen.aborted, false, 'a finished transfer is no longer tracked');
});

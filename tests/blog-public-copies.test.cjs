'use strict';
// Public photo copies (2026-11-02 owner decision): a published JPEG/PNG/WebP
// photo is a separate metadata-free re-encoding; HEIC/HEIF publish their JPEG
// view; originals stay private. Canvas decoding/encoding is stubbed here; the
// real canvas, rotation and byte checks run in tests/public-photo-copy-browser.cjs,
// and SQL plus served bytes in tests/run-blog-sql-postgres.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const F = require('./fixtures/photo-metadata.cjs');
const { server, device, clock, png, post, Core, Photo, Blog } = require('./helpers/blog-sync-cloud.cjs');
const Remote = require('../assets/life/blog-remote.js');

// Stub canvas: decoding reports the recorded size; encoding returns a small
// metadata-free image of the requested type (or `encodeAs` for one call).
const encodes = [];
let encodeAs = null;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
globalThis.OffscreenCanvas = class {
  constructor(width, height) { Object.assign(this, { width, height }); }
  getContext() { return { fillRect() {}, drawImage() {}, set fillStyle(_) {}, set imageSmoothingQuality(_) {}, set imageSmoothingEnabled(_) {} }; }
  async convertToBlob(options) {
    encodes.push(options);
    if (encodeAs) { const value = encodeAs; encodeAs = null; return value; }
    // A different quality gives different JPEG bytes, as a real encoder's tables do.
    const jpeg = Buffer.from(F.JPEG_8X8); if (options.quality !== 0.9) jpeg[jpeg.length - 4] ^= 1;
    return new Blob([options.type === 'image/png' ? F.png(1, 1, [10, 20, 30, 255]) : jpeg], { type: options.type });
  }
};

async function photoOf(bytes, type, width = 1, height = 1) {
  const blob = new Blob([bytes], { type });
  return { id: Core.id(), name: 'private.' + type.split('/')[1], type, width, height, size: blob.size, digest: await Photo.digest(blob), blob };
}
async function savedWith(photos) {
  const cloud = server(), a = await device(cloud, 'mac', { time: clock() });
  const doc = await post({ title: '사진 공개' });
  doc.photos = photos; doc.ops = [{ insert: '본문\n' }, ...photos.map(p => ({ insert: { photo: { id: p.id, caption: '', alt: '' } } })), { insert: '\n' }];
  const saved = await a.storage.savePhotoPost(a.ws, doc, 0); await a.sync.syncNow();
  return { cloud, a, saved };
}

test('a PNG/JPEG/WebP copy is a new canvas encoding: JPEG for JPEG and opaque WebP, PNG for PNG; HEIC returns its view', async () => {
  encodes.length = 0;
  const jpeg = await photoOf(F.jpegWithGps(F.JPEG_8X8), 'image/jpeg'), pngPhoto = await photoOf(F.pngWithGps(F.png(1, 1)), 'image/png');
  const webp = await photoOf(F.webpWithGps(F.WEBP_8X8, { width: 1, height: 1 }), 'image/webp');
  for (const [photo, type] of [[jpeg, 'image/jpeg'], [pngPhoto, 'image/png'], [webp, 'image/jpeg']]) {
    const copy = await Photo.publicCopy(photo);
    assert.equal(copy.type, type); assert.notEqual(copy.digest, photo.digest); assert.equal(copy.view, undefined);
    assert.deepEqual(F.leaks(Buffer.from(await copy.blob.arrayBuffer())), []);
    assert.equal(await Photo.digest(copy.blob), copy.digest);
  }
  assert.deepEqual(encodes.map(o => [o.type, o.quality]), [['image/jpeg', 0.9], ['image/png', undefined], ['image/jpeg', 0.9]]);
  const view = new Blob([F.JPEG_8X8], { type: 'image/jpeg' }), heicBytes = F.heicWithGps(), heic = await photoOf(heicBytes, 'image/heic', 8, 8);
  heic.view = { type: 'image/jpeg', size: view.size, digest: await Photo.digest(view), width: 8, height: 8, blob: view };
  const copy = await Photo.publicCopy(heic);
  assert.equal(copy.view, true); assert.equal(copy.digest, heic.view.digest); assert.equal(copy.blob, view);
});

test('a copy whose re-encoding equals the original still becomes a separate object without adding metadata', async () => {
  const plain = F.png(1, 1, [10, 20, 30, 255]), photo = await photoOf(plain, 'image/png');
  const copy = await Photo.publicCopy(photo), bytes = Buffer.from(await copy.blob.arrayBuffer());
  assert.notEqual(copy.digest, photo.digest);
  assert.equal(bytes.toString('latin1', 37, 41), 'sRGB', 'an sRGB chunk follows IHDR');
  assert.deepEqual(F.leaks(bytes), []);
  encodes.length = 0;
  const jpeg = await photoOf(F.JPEG_8X8, 'image/jpeg'); encodeAs = new Blob([F.JPEG_8X8], { type: 'image/jpeg' });
  const again = await Photo.publicCopy(jpeg);
  assert.deepEqual(encodes.map(o => o.quality), [0.9, 0.89]); assert.notEqual(again.digest, jpeg.digest);
});

test('a copy is refused when decoding shows another orientation or the copy does not match its photo', async () => {
  const photo = await photoOf(F.JPEG_8X8, 'image/jpeg', 8, 6);
  await assert.rejects(Photo.publicCopy(photo), { code: 'public_copy_failed' });
  const ok = await photoOf(F.jpegWithGps(F.JPEG_8X8), 'image/jpeg'), copy = await Photo.publicCopy(ok);
  for (const bad of [{ ...copy, id: 'other' }, { ...copy, digest: ok.digest }, { ...copy, type: 'image/webp' }, { ...copy, width: 2 }, { ...copy, size: copy.size + 1 }])
    assert.throws(() => Photo.checkPublicCopy(ok, bad), { code: 'invalid_photo_post' });
});

test('animation and alpha are read from the original headers', async () => {
  assert.deepEqual(await Photo.imageTraits(new Blob([F.apng()])), { type: 'image/png', alpha: true, animated: true });
  assert.deepEqual(await Photo.imageTraits(new Blob([F.animatedWebp(F.WEBP_8X8, 8, 8)])), { type: 'image/webp', alpha: false, animated: true });
  assert.deepEqual(await Photo.imageTraits(new Blob([F.WEBP_8X8])), { type: 'image/webp', alpha: false, animated: false });
  assert.deepEqual(await Photo.imageTraits(new Blob([F.JPEG_8X8])), { type: 'image/jpeg', alpha: false, animated: false });
});

test('the public snapshot names copy metadata; a missing, extra or HEIC copy is refused', async () => {
  const jpeg = await photoOf(F.jpegWithGps(F.JPEG_8X8), 'image/jpeg'), copy = await Photo.publicCopy(jpeg);
  const doc = await post({ title: '스냅샷' }); doc.photos = [jpeg]; doc.ops = [{ insert: '본문\n' }, { insert: { photo: { id: jpeg.id, caption: '', alt: '' } } }, { insert: '\n' }];
  const meta = { id: copy.id, type: copy.type, size: copy.size, digest: copy.digest, width: copy.width, height: copy.height };
  const snapshot = Blog.publicSnapshot(doc, { photoIds: [jpeg.id], copies: [meta] });
  assert.equal(snapshot.photos[0].digest, copy.digest); assert(!JSON.stringify(snapshot).includes(jpeg.digest));
  assert.throws(() => Blog.publicSnapshot(doc, { photoIds: [jpeg.id], copies: [] }), { code: 'invalid_blog_selection' });
  assert.throws(() => Blog.publicSnapshot(doc, { photoIds: [], copies: [meta] }), { code: 'invalid_blog_selection' });
  assert.throws(() => Blog.publicSnapshot(doc, { photoIds: [jpeg.id], copies: [{ ...meta, digest: jpeg.digest }] }), { code: 'invalid_blog_selection' });
  // Private reading (no copies given) keeps the original projection.
  assert.equal(Blog.publicSnapshot(doc, { photoIds: [jpeg.id] }).photos[0].digest, jpeg.digest);
});

test('publishing uploads the copy before the durable request and names only copies; the original stays private', async () => {
  const photo = await png(1), { cloud, a, saved } = await savedWith([photo]);
  const originalUploads = cloud.stats.uploads.length;
  const published = await a.sync.publish(a.ws, saved.id, { photoIds: [photo.id], expectedLocalRevision: saved.revision });
  assert.ok(published.token);
  assert.equal(cloud.stats.copyUploads.length, 1); assert.equal(cloud.stats.uploads.length, originalUploads, 'no original is uploaded again');
  const named = cloud.stats.publishes[0].options.copies;
  assert.deepEqual(named.map(c => c.id), [photo.id]); assert.notEqual(named[0].digest, photo.digest);
  assert.equal(Object.hasOwn(named[0], 'blob'), false, 'the request carries metadata only');
  assert.equal(named[0].digest, cloud.stats.copyUploads[0].digest);
  const state = await a.storage.readBlogSyncState(a.ws, saved.id);
  assert.equal(state.publishPending, null);
  const local = await a.storage.readPhotoPost(a.ws, saved.id);
  assert.equal(local.photos[0].digest, photo.digest, 'the local document is not changed by publishing');
});

test('reviewed copies are used as given; a copy for another photo or with altered bytes is refused before upload', async () => {
  const photo = await png(2), { cloud, a, saved } = await savedWith([photo]);
  const local = await a.storage.readPhotoPost(a.ws, saved.id), reviewed = await Photo.publicCopy(local.photos[0]);
  encodes.length = 0;
  await a.sync.publish(a.ws, saved.id, { photoIds: [photo.id], copies: [reviewed], expectedLocalRevision: saved.revision });
  assert.equal(encodes.length, 0, 'the previewed copy is not encoded again');
  assert.equal(cloud.stats.publishes[0].options.copies[0].digest, reviewed.digest);
  const before = cloud.stats.copyUploads.length;
  await assert.rejects(a.sync.publish(a.ws, saved.id, { photoIds: [photo.id], copies: [{ ...reviewed, digest: '0'.repeat(64) }], expectedLocalRevision: saved.revision, expectedPublicRevision: 1 }), { code: 'invalid_photo_post' });
  assert.equal(cloud.stats.copyUploads.length, before);
});

test('an interrupted publication retries with the same uploaded copies; a request recorded before copies is replaced', async () => {
  const photo = await png(3), { cloud, a, saved } = await savedWith([photo]);
  const publish = a.remote.publish; let fail = true;
  a.remote.publish = async (...args) => { if (fail) { fail = false; throw Object.assign(Error('lost'), { code: 'network_error' }); } return publish.apply(a.remote, args); };
  await assert.rejects(a.sync.publish(a.ws, saved.id, { photoIds: [photo.id], expectedLocalRevision: saved.revision }), { code: 'network_error' });
  const pending = (await a.storage.readBlogSyncState(a.ws, saved.id)).publishPending;
  assert.equal(cloud.stats.publishes.length, 0, 'the lost request never reached the server');
  assert.equal(pending.copies.length, 1); assert.equal(cloud.stats.copyUploads.length, 1);
  encodes.length = 0;
  await a.sync.publish(a.ws, saved.id, { photoIds: [photo.id], expectedLocalRevision: saved.revision });
  assert.equal(cloud.stats.copyUploads.length, 1, 'the retry reuses the uploaded copy');
  assert.deepEqual(cloud.stats.publishes.at(-1).options.copies, pending.copies);
  // A pending request written by an earlier version (no copies) would publish an original.
  const second = await png(4), other = await savedWith([second]);
  const state = await other.a.storage.readBlogSyncState(other.a.ws, other.saved.id), earlier = Core.id();
  await other.a.storage.writeBlogSyncState(other.a.ws, other.saved.id, { ...state, publishPending: { operationId: earlier, expectedRevision: state.remoteRevision, expectedPublicRevision: 0,
    localRevision: other.saved.revision, selection: { photoIds: [second.id], author: { name: '', intro: '' } } } }, state.revision);
  await other.a.sync.publish(other.a.ws, other.saved.id, { photoIds: [second.id], expectedLocalRevision: other.saved.revision });
  const request = other.cloud.stats.publishes.at(-1);
  assert.notEqual(request.operation, earlier, 'a new operation replaces the copy-less one'); assert.equal(request.options.copies.length, 1);
});

test('a text-only or HEIC-only publication names no copy and uses the earlier RPC unchanged', async () => {
  const calls = [], auth = { ready: true, epoch: 1, user: { id: Core.id() }, async verify() { return auth.user; }, client: {
    rpc(name, params) { calls.push({ name, params }); return Promise.resolve({ data: { status: 'stored', token: Core.id(), blogToken: Core.id(), revision: 1 }, error: null }); } } };
  auth.session = { user: auth.user };
  const remote = Remote.create({ auth, blog: Blog }), postId = Core.id(), op = Core.id();
  await remote.publish(postId, 1, op, { photoIds: ['heic-photo'], author: { name: '', intro: '' } });
  assert.equal(calls[0].name, 'life_blog_publish'); assert.equal(Object.hasOwn(calls[0].params, 'p_copies'), false);
  const copy = { id: 'jpeg-photo', type: 'image/jpeg', size: 10, digest: 'a'.repeat(64), width: 4, height: 3 };
  await remote.publish(postId, 1, op, { photoIds: ['jpeg-photo'], copies: [copy] });
  assert.equal(calls[1].name, 'life_blog_publish_copies');
  assert.deepEqual(calls[1].params.p_copies, { 'jpeg-photo': { type: 'image/jpeg', size: 10, digest: 'a'.repeat(64), width: 4, height: 3 } });
  for (const bad of [[{ ...copy, type: 'image/webp' }], [{ ...copy, id: 'other' }], [copy, copy]])
    await assert.rejects(remote.publish(postId, 1, op, { photoIds: ['jpeg-photo'], copies: bad }), { code: 'invalid_request' });
  assert.equal(calls.length, 2, 'refused selections never reach the server');
  remote.dispose();
});

test('a copy is registered by its own RPC and uploaded once to the private bucket without overwrite', async () => {
  const user = Core.id(), postId = Core.id(), calls = [], uploads = [], reply = { exists: false };
  const auth = { ready: true, epoch: 1, user: { id: user }, async verify() { return auth.user; }, client: {
    rpc(name, params) { calls.push({ name, params }); return Promise.resolve({ data: { bucket: 'haedo-blog-originals', path: user + '/' + postId + '/' + params.p_photo_id + '/' + params.p_digest, exists: reply.exists }, error: null }); },
    storage: { from: bucket => ({ async upload(path, blob, options) { uploads.push({ bucket, path, options }); return { error: null }; } }) } } };
  auth.session = { user: auth.user };
  const remote = Remote.create({ auth, blog: Blog }), blob = new Blob([F.JPEG_8X8], { type: 'image/jpeg' });
  const item = { id: 'jpeg-photo', type: 'image/jpeg', size: blob.size, digest: await Photo.digest(blob), width: 8, height: 8 };
  await remote.uploadPublicCopy(postId, item, blob);
  assert.deepEqual(calls.map(call => call.name), ['life_blog_publish_prepare_copy']);
  assert.deepEqual(uploads, [{ bucket: 'haedo-blog-originals', path: user + '/' + postId + '/jpeg-photo/' + item.digest, options: { contentType: 'image/jpeg', upsert: false } }]);
  reply.exists = true; await remote.uploadPublicCopy(postId, item, blob); assert.equal(uploads.length, 1, 'an uploaded copy is reused');
  await assert.rejects(remote.uploadPublicCopy(postId, { ...item, digest: '0'.repeat(64) }, blob), { code: 'invalid_remote_data' });
  await assert.rejects(remote.uploadPublicCopy(postId, { ...item, type: 'image/webp' }, new Blob([F.JPEG_8X8], { type: 'image/webp' })), { code: 'invalid_request' });
  assert.equal(calls.length, 2); remote.dispose();
});

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const fs = require('node:fs');
const Capture = require('../assets/life/naver-capture.js');
const Core = require('../assets/life/core.js');
const PhotoPost = require('../assets/life/photo-post.js');
const hash = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const invalid = error => error.code === 'naver_capture_invalid';
const clone = value => structuredClone(value);
function photo(index = 0, patch = {}) {
  const sha256 = hash('synthetic-photo-' + index);
  return { index, url: 'https://example.invalid/photo-' + index + '.png',
    storagePath: owner + '/naver/Fixture_blog/123456789012345678901234567890/' + sha256,
    sha256, mimeType: 'image/png', width: 4032, height: 3024, bytes: 241477,
    alt: '대체 설명 🌱', caption: '사진 설명', status: 'stored', error: null, originalStatus: 'unverified', ...patch };
}
function payload(patch = {}) {
  const body = '\uFEFF첫 문장\r\n둘째 🌱 문장\r\n';
  return { version: 1, blogId: 'Fixture_blog', logNo: '123456789012345678901234567890',
    url: 'https://blog.naver.com/Fixture_blog/123456789012345678901234567890', title: '합성 원문 제목',
    format: 'text/plain', body, bodyHash: hash(body), htmlHash: hash('<p>합성 원문</p>'),
    coverage: 'partial', omissions: ['원문 전체 미확인'], publishedAt: null, author: '',
    extractedAt: '2026-10-21T10:00:00.000Z', extractor: 'fixture@1', photos: [photo()], ...patch };
}
async function row(p = payload(), patch = {}) {
  return { id: '33333333-3333-4333-8333-333333333333', owner_id: owner, blog_id: p.blogId,
    log_no: p.logNo, capture_hash: await Capture.fingerprint(p), created_at: '2026-10-21T10:01:00+00:00', payload: p, ...patch };
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function context(cryptoOverride = crypto.webcrypto) {
  const ctx = vm.createContext({ URL, TextEncoder, Uint8Array, crypto: cryptoOverride });
  for (const key of ['fetch', 'indexedDB', 'localStorage', 'document', 'supabase']) Object.defineProperty(ctx, key, {
    get() { throw new Error('Unexpected private/network access'); }
  });
  for (const name of ['naver-blog', 'naver-capture']) vm.runInContext(fs.readFileSync(require.resolve('../assets/life/' + name + '.js'), 'utf8'), ctx);
  return ctx;
}

test('browser/Node pure model shares API and reads no network, Auth, storage or DOM', async () => {
  const ctx = context();
  assert.deepEqual(Object.keys(ctx.HaedoLife.NaverCapture).sort(), Object.keys(Capture).sort());
  const browserPayload = vm.runInContext('JSON.parse(' + JSON.stringify(JSON.stringify(payload())) + ')', ctx);
  assert.equal(await ctx.HaedoLife.NaverCapture.fingerprint(browserPayload), await Capture.fingerprint(payload()));
  assert.equal(Object.isFrozen(Capture), true);
  assert.equal(Object.isFrozen(Capture.LIMITS), true);
});

test('row verifies raw body and capture hash, exact owner identity, and returns an independent clone', async () => {
  const input = await row(), before = clone(input);
  const verified = await Capture.validateCaptureRow(input, { ownerId: owner });
  assert.deepEqual(verified, before); assert.notEqual(verified, input); assert.notEqual(verified.payload.photos, input.payload.photos);
  verified.payload.photos[0].caption = '새 사본'; verified.payload.omissions.push('사본 변경');
  assert.deepEqual(input, before);
  await assert.rejects(Capture.validateCaptureRow(input, { ownerId: other }), invalid);
  for (const patch of [{ blog_id: 'Other_blog' }, { log_no: '123' }, { capture_hash: hash('wrong') }, { owner_id: other }]) {
    await assert.rejects(Capture.validateCaptureRow({ ...input, ...patch }), invalid);
  }
});

test('fingerprint has independently specified sorted JSON and ignores only capture location/time', async () => {
  const input = payload(), expected = clone(input);
  delete expected.extractedAt; for (const p of expected.photos) delete p.storagePath;
  const fingerprint = await Capture.fingerprint(input);
  assert.equal(fingerprint, hash(canonical(expected)));
  const later = clone(input); later.extractedAt = '2026-10-22T12:00:00Z';
  later.photos[0].storagePath = later.photos[0].storagePath.replace(owner, other);
  assert.equal(await Capture.fingerprint(later), fingerprint);
  const moved = await row(later, { owner_id: other, id: '44444444-4444-4444-8444-444444444444', created_at: '2026-10-23T00:00:00Z' });
  assert.equal((await Capture.validateCaptureRow(moved)).capture_hash, fingerprint);
  for (const patch of [{ extractor: 'fixture@2' }, { htmlHash: hash('<p>changed</p>') }, { format: 'text/markdown' },
    { body: input.body + '\n', bodyHash: hash(input.body + '\n') }, { coverage: 'full_text' }, { omissions: ['다른 누락'] }]) {
    assert.notEqual(await Capture.fingerprint({ ...input, ...patch }), fingerprint);
  }
  const caption = clone(input); caption.photos[0].caption += ' 수정';
  assert.notEqual(await Capture.fingerprint(caption), fingerprint);
});

test('local archive clears only remote paths and cannot masquerade as a validated server row', async () => {
  const input = payload(), local = clone(input); local.photos[0].storagePath = null;
  assert.equal(Capture.validatePayload(local, { local: true }), true);
  assert.deepEqual(await Capture.verifyPayload(local, { local: true }), local);
  assert.equal(await Capture.fingerprint(local, { local: true }), await Capture.fingerprint(input));
  assert.equal(Capture.toImportInput(local, { local: true }).text, local.body);
  assert.throws(() => Capture.validatePayload(local), invalid);
  assert.throws(() => Capture.validatePayload(input, { local: true }), invalid);
  assert.throws(() => Capture.validatePayload(local, { local: true, ownerId: owner }), invalid);
  const remoteRow = await row(input); remoteRow.payload = local;
  await assert.rejects(Capture.validateCaptureRow(remoteRow), invalid);
  await assert.rejects(Capture.validateCaptureRow(remoteRow, { local: true }), invalid);
});

test('raw BOM/CRLF/emoji/plain or markdown and exact existing URL survive Core version import', async () => {
  for (const format of ['text/plain', 'text/markdown']) {
    const p = payload({ format });
    const input = Capture.toImportInput(p);
    assert.equal(input.text, p.body); assert.equal(input.format, format); assert.equal(input.authorRelation, 'unknown');
    assert.deepEqual(input.coverage, { status: 'partial', omissions: p.omissions });
    const workspace = Core.createWorkspace();
    const oldURL = 'http://m.blog.naver.com/PostView.naver?blogId=Fixture_blog&logNo=' + p.logNo + '&from=manual';
    const old = await Core.prepareImport({ ...input, url: oldURL, text: '이전 원문', format: 'text/plain' }, workspace);
    const bundle = Core.applyChanges(workspace, Core.buildImportChanges(workspace, old, [])), before = clone(bundle);
    const updated = await Core.prepareImport(Capture.toImportInput(p, { existingSourceId: old.source.id, existingSourceUrl: oldURL }), bundle);
    assert.equal(updated.source.id, old.source.id); assert.equal(updated.source.url, oldURL);
    assert.equal(updated.version.contentText, p.body); assert.equal(updated.version.contentHash, hash(p.body));
    assert.equal(updated.version.format, format); assert.deepEqual(bundle, before);
    assert.throws(() => Capture.toImportInput(p, { existingSourceId: old.source.id, existingSourceUrl: 'https://blog.naver.com/other/1' }), invalid);
    assert.throws(() => Capture.toImportInput(p, { existingSourceUrl: oldURL }), invalid);
  }
  const spaces = ' \r\n '; assert.equal((await Capture.verifyPayload(payload({ body: spaces, bodyHash: hash(spaces) }))).body, spaces);
});

test('link-only/unknown/full text are explicit and no photograph bytes or HTML are invented', async () => {
  const link = payload({ body: null, bodyHash: null, coverage: 'link_only', photos: [] });
  assert.equal((await Capture.verifyPayload(link)).coverage, 'link_only');
  assert.equal(Capture.toImportInput(link).text, null);
  for (const coverage of ['unknown', 'partial', 'full_text']) assert.equal((await Capture.verifyPayload(payload({ coverage }))).coverage, coverage);
  for (const patch of [{ body: null }, { coverage: 'link_only' }, { format: 'text/html' }, { htmlHash: null }, { body: '', bodyHash: hash('') }]) {
    assert.throws(() => Capture.validatePayload(payload(patch)), invalid);
  }
  await assert.rejects(Capture.verifyPayload(payload({ body: '변조한 본문' })), invalid);
});

test('strict whitelists reject accessors, extra data, sparse arrays and invalid scalar types without invoking getters', async () => {
  const bad = [];
  bad.push(payload({ secret: 'excluded' }));
  const getter = payload(); Object.defineProperty(getter, 'body', { get() { throw new Error('getter must not run'); }, enumerable: true }); bad.push(getter);
  const symbol = payload(); symbol[Symbol('hidden')] = true; bad.push(symbol);
  const hole = payload(); hole.photos = Array(1); bad.push(hole);
  const extraArray = payload(); extraArray.omissions.extra = true; bad.push(extraArray);
  const inherited = Object.assign(Object.create({ unexpected: true }), payload()); bad.push(inherited);
  const extraPhoto = payload(); extraPhoto.photos[0].blob = new Blob(['untrusted']); bad.push(extraPhoto);
  for (const patch of [{ title: '\ud800' }, { body: '\udc00' }, { logNo: 123 }, { blogId: 'bad id' },
    { url: 'http://blog.naver.com/Fixture_blog/' + payload().logNo }, { publishedAt: '2026-10-21' }, { extractedAt: 'not-a-date' }]) bad.push(payload(patch));
  for (const value of bad) assert.throws(() => Capture.validatePayload(value), invalid);
  const r = await row(); r.extra = 1; await assert.rejects(Capture.validateCaptureRow(r), invalid);
  assert.throws(() => Capture.toImportInput(payload(), null), invalid);
});

test('stored path and failure contracts reject foreign scope/traversal/forged originals and preserve safe failures', async () => {
  const input = payload();
  for (const patch of [{ storagePath: input.photos[0].storagePath + '.png' },
    { storagePath: input.photos[0].storagePath.replace('/naver/', '/naver/../') },
    { storagePath: input.photos[0].storagePath.replace('Fixture_blog', 'Other') },
    { originalStatus: 'verified' }, { mimeType: 'image/svg+xml' }, { url: 'javascript:alert(1)' },
    { url: 'https://user:pass@example.invalid/a' }, { width: 0 }, { height: 1.5 }, { bytes: 0 }, { error: 'error' }]) {
    assert.throws(() => Capture.validatePayload(payload({ photos: [photo(0, patch)] })), invalid);
  }
  const failed = photo(0, { storagePath: null, sha256: null, mimeType: null, width: null, height: null, bytes: null,
    status: 'failed', error: 'image_fetch_failed' });
  assert.equal(Capture.validatePayload(payload({ photos: [failed], omissions: ['사진 1개 미보관'] })), true);
  for (const patch of [{ error: 'raw upstream token=secret' }, { bytes: 1 }, { error: null }]) {
    assert.throws(() => Capture.validatePayload(payload({ photos: [{ ...failed, ...patch }] })), invalid);
  }
  assert.throws(() => Capture.validatePayload(payload({ photos: [failed], omissions: [] })), invalid);
});

test('photo count/file/total limits match existing PhotoPost and never silently truncate', () => {
  for (const key of ['photos', 'file', 'bytes']) assert.equal(Capture.LIMITS[key], PhotoPost.LIMITS[key]);
  assert.equal(Capture.validatePayload(payload({ photos: Array.from({ length: 20 }, (_, i) => photo(i)) })), true);
  assert.throws(() => Capture.validatePayload(payload({ photos: Array.from({ length: 21 }, (_, i) => photo(i)) })), invalid);
  assert.equal(Capture.validatePayload(payload({ photos: Array.from({ length: 4 }, (_, i) => photo(i, { bytes: Capture.LIMITS.file })) })), true);
  assert.throws(() => Capture.validatePayload(payload({ photos: [photo(0, { bytes: Capture.LIMITS.file + 1 })] })), invalid);
  assert.throws(() => Capture.validatePayload(payload({ photos: Array.from({ length: 5 }, (_, i) => photo(i, { bytes: Capture.LIMITS.file })) })), invalid);
  assert.throws(() => Capture.validatePayload(payload({ photos: [photo(1)] })), invalid);
  const body = '한'.repeat(Math.floor(Capture.LIMITS.body / 3) + 1);
  assert.throws(() => Capture.validatePayload(payload({ body, bodyHash: hash(body) })), invalid);
});

test('verification snapshots all caller data before its first asynchronous digest', async () => {
  let unblock, reached;
  const gate = new Promise(resolve => { unblock = resolve; }), began = new Promise(resolve => { reached = resolve; });
  const ctx = context({ subtle: { digest: async (...args) => { reached(); await gate; return crypto.webcrypto.subtle.digest(...args); } } });
  const input = await row();
  const browserRow = vm.runInContext('JSON.parse(' + JSON.stringify(JSON.stringify(input)) + ')', ctx);
  const promise = ctx.HaedoLife.NaverCapture.validateCaptureRow(browserRow);
  await began;
  browserRow.owner_id = other; browserRow.capture_hash = hash('wrong'); browserRow.payload.body = 'late mutation';
  browserRow.payload.photos[0].caption = 'late caption'; browserRow.payload.omissions.push('late omission');
  unblock(); const verified = await promise;
  assert.equal(verified.owner_id, owner); assert.equal(verified.capture_hash, input.capture_hash);
  assert.equal(verified.payload.body, input.payload.body); assert.equal(verified.payload.photos[0].caption, input.payload.photos[0].caption);
  assert.equal(verified.payload.omissions.length, input.payload.omissions.length);
});

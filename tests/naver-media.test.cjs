'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Core = require('../assets/life/core.js'), Capture = require('../assets/life/naver-capture.js');
const Media = require('../assets/life/naver-media.js'), zip = require('../vendor/fflate/fflate.js');
const F = require('./fixtures/naver-media.cjs');
const copy = value => structuredClone(value);
async function complete() {
  const data = await F.fixture();
  return { ...data, bundle: Core.applyChanges(data.bundle, data.changes) };
}
test('media validates exact received bytes/dimensions and binds only the declared source version', async t => {
  const restore = F.installDecoder(); t.after(restore);
  const data = await complete(), before = copy(data);
  const attachment = await Media.validate(data.attachment, { ownerId: F.OWNER });
  assert.equal(Media.checkTarget(data.bundle, attachment), true);
  assert.equal(attachment.localOnly, false);
  assert.deepEqual(data, before);
  const changed = copy(data.bundle); changed.sourceVersions[0].contentText += 'changed';
  assert.throws(() => Media.checkTarget(changed, attachment), { code: 'invalid_naver_media' });
  for (const patch of [{ width: 2 }, { sha256: '0'.repeat(64) }]) {
    const bad = copy(data.attachment); Object.assign(bad.capture.payload.photos[0], patch);
    if (patch.sha256) bad.capture.payload.photos[0].storagePath = F.OWNER + '/naver/fixture_blog/123456789012/' + patch.sha256;
    bad.capture.capture_hash = await Capture.fingerprint(bad.capture.payload);
    await assert.rejects(Media.validate(bad), { code: 'invalid_naver_media' });
  }
  const missing = copy(data.attachment); missing.photos = [];
  await assert.rejects(Media.validate(missing), { code: 'invalid_naver_media' });
  await assert.rejects(Media.validate(data.attachment, { ownerId: '99999999-9999-4999-8999-999999999999' }));
});
test('ZIP includes selected exact text/photo only, strips private server identity and restores independent IDs', async t => {
  const restore = F.installDecoder(); t.after(restore);
  const data = await complete();
  const unrelated = await Core.prepareImport({ origin: 'obsidian', title: 'UNSELECTED_PRIVATE_TITLE', text: 'UNSELECTED_PRIVATE_BODY' }, data.bundle);
  const full = Core.applyChanges(data.bundle, Core.buildImportChanges(data.bundle, unrelated, [{ start: 0, end: 3, note: 'UNSELECTED_PRIVATE_NOTE' }]));
  const archive = await Media.pack({ bundle: full, attachment: data.attachment });
  const files = zip.unzipSync(new Uint8Array(await archive.arrayBuffer())), manifestText = zip.strFromU8(files['manifest.json']);
  assert.deepEqual(Object.keys(files).sort(), ['manifest.json', 'photos/0']);
  for (const marker of [F.OWNER, data.attachment.capture.id, data.payload.photos[0].storagePath,
    'UNSELECTED_PRIVATE_TITLE', 'UNSELECTED_PRIVATE_BODY', 'UNSELECTED_PRIVATE_NOTE']) assert.equal(manifestText.includes(marker), false);
  const opened = await Media.read(archive);
  assert.equal(opened.attachment.localOnly, true);
  assert.deepEqual(Object.keys(opened.attachment.capture).sort(), ['capture_hash', 'payload']);
  assert.equal(opened.attachment.capture.payload.photos[0].storagePath, null);
  assert.equal(opened.attachment.capture.capture_hash, data.attachment.capture.capture_hash);
  assert.equal(opened.bundle.sourceVersions[0].contentText, data.payload.body);
  assert.deepEqual(new Uint8Array(await opened.attachment.photos[0].blob.arrayBuffer()), new Uint8Array(F.bytes));
  const restored = await Media.copy(opened, { title: '새 원문 사본' });
  assert.notEqual(restored.bundle.workspaceId, data.bundle.workspaceId);
  assert.notEqual(restored.attachment.sourceId, data.attachment.sourceId);
  assert.notEqual(restored.attachment.sourceVersionId, data.attachment.sourceVersionId);
  assert.equal(restored.bundle.revision, 0); assert.equal(restored.bundle.title, '새 원문 사본');
  assert.equal(Media.checkTarget(restored.bundle, restored.attachment), true);
  assert.equal(restored.bundle.sourceVersions[0].contentHash, data.payload.bodyHash);
});
test('failed image metadata remains a failure without requiring or fabricating a photo blob', async t => {
  const restore = F.installDecoder(); t.after(restore);
  const data = await F.fixture(), attachment = data.attachment;
  attachment.capture.payload.photos.push({ index: 1, url: 'https://postfiles.pstatic.net/fixture/missing.gif',
    storagePath: null, sha256: null, mimeType: null, width: null, height: null, bytes: null,
    alt: '', caption: '미확보 이미지', status: 'failed', error: 'unsupported_type', originalStatus: 'unverified' });
  attachment.capture.payload.omissions = ['사진 한 장 미보관'];
  attachment.capture.capture_hash = await Capture.fingerprint(attachment.capture.payload);
  const prepared = await Core.prepareImport(Capture.toImportInput(attachment.capture.payload), data.bundle);
  attachment.sourceId = prepared.source.id; attachment.sourceVersionId = prepared.version.id;
  const bundle = Core.applyChanges(data.bundle, Core.buildImportChanges(data.bundle, prepared));
  const read = await Media.read(await Media.pack({ bundle, attachment }));
  assert.equal(read.attachment.photos.length, 1);
  assert.equal(read.attachment.capture.payload.photos[1].status, 'failed');
  assert.deepEqual(read.bundle.sourceVersions[0].coverage.omissions, ['사진 한 장 미보관']);
});
test('ZIP rejects changed bytes, payload hashes, unsupported paths/compression and extra private records', async t => {
  const restore = F.installDecoder(); t.after(restore);
  const data = await complete(), archive = await Media.pack({ bundle: data.bundle, attachment: data.attachment });
  const original = zip.unzipSync(new Uint8Array(await archive.arrayBuffer()));
  function file(mutator, options = { level: 0 }) {
    const files = copy(original), manifest = JSON.parse(zip.strFromU8(files['manifest.json']));
    mutator(files, manifest); files['manifest.json'] = zip.strToU8(JSON.stringify(manifest));
    return new Blob([zip.zipSync(files, options)]);
  }
  await assert.rejects(Media.read(file(files => { files['photos/0'][10] ^= 1; })), { code: 'invalid_naver_media' });
  await assert.rejects(Media.read(file((files, manifest) => { manifest.attachment.capture.capture_hash = '0'.repeat(64); })), { code: 'invalid_naver_media' });
  await assert.rejects(Media.read(file(files => { files['../escape'] = new Uint8Array([1]); })), { code: 'invalid_naver_media' });
  await assert.rejects(Media.read(file(() => {}, { level: 6 })), { code: 'invalid_naver_media' });
  await assert.rejects(Media.read(file((files, manifest) => { manifest.bundle.sources.push(copy(manifest.bundle.sources[0])); }))); 
  const trailing = new Blob([await archive.arrayBuffer(), new Uint8Array([0])]);
  await assert.rejects(Media.read(trailing), { code: 'invalid_naver_media' });
});

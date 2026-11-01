'use strict';
// HEIC/HEIF originals keep exact bytes and carry a derived JPEG `view`.
// Synthetic ftyp headers only; decoding and JPEG encoding are stubbed.
const test = require('node:test'), assert = require('node:assert/strict');
const Zip = require('../vendor/fflate/fflate.js');
const M = require('../assets/life/photo-post.js'), Blog = require('../assets/life/blog.js'), C = require('../assets/life/core.js');

function ftyp(major, compatible = [], tail = 64) {
  const size = 16 + 4 * compatible.length, bytes = new Uint8Array(size + tail);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(Buffer.from('ftyp' + major + '\0\0\0\0' + compatible.join(''), 'latin1'), 4);
  for (let i = size; i < bytes.length; i++) bytes[i] = (i * 7) & 255;
  return bytes;
}
const jpegBytes = seed => Uint8Array.from([255, 216, 255, 224, seed & 255, 1, 2, 3, 4, 5, 255, 217]);
const VIEW_DIMS = new Map();
let decoder = { width: 8064, height: 6048, supported: true }, active = 0, peak = 0;
globalThis.createImageBitmap = async blob => {
  if (blob.type === 'image/jpeg') {
    const dims = VIEW_DIMS.get(await M.digest(blob)) || [0, 0];
    return { width: dims[0], height: dims[1], close() {} };
  }
  active++; peak = Math.max(peak, active);
  try {
    await new Promise(resolve => setTimeout(resolve, 5));
    if (!decoder.supported) throw new Error('decode failed');
    return { width: decoder.width, height: decoder.height, close() {} };
  } finally { active--; }
};
let encoded = 0;
globalThis.OffscreenCanvas = class {
  constructor(width, height) { Object.assign(this, { width, height }); }
  getContext() { return { fillRect() {}, drawImage() {}, set fillStyle(_) {}, set imageSmoothingQuality(_) {}, set imageSmoothingEnabled(_) {} }; }
  async convertToBlob(options) {
    assert.equal(options.type, 'image/jpeg');
    const blob = new Blob([jpegBytes(++encoded)], { type: 'image/jpeg' });
    VIEW_DIMS.set(await M.digest(blob), [this.width, this.height]);
    return blob;
  }
};
const heicFile = (name = 'IMG_0001.HEIC', type = 'image/heic', major = 'heic', compatible = ['mif1', 'heic']) =>
  new File([ftyp(major, compatible)], name, { type });
async function heicDoc() {
  const d = M.create(C.id), p = await M.readPhoto(heicFile(), C.id);
  d.title = '아이폰 사진'; d.photos = [p];
  d.ops = [{ insert: '첫 문단\n' }, { insert: { photo: { id: p.id, caption: '설명 🌱', alt: '익명 풍경' } } }, { insert: '\n' }];
  return { d, p };
}

test('content detection: HEVC brands are HEIC, mif1/msf1 only with a HEVC brand are HEIF, AVIF and malformed boxes are refused', () => {
  assert.equal(M.detectType(ftyp('heic', ['mif1', 'heic'])), 'image/heic');
  for (const brand of ['heix', 'hevc', 'hevx', 'heim', 'heis']) assert.equal(M.detectType(ftyp(brand)), 'image/heic');
  assert.equal(M.detectType(ftyp('mif1', ['mif1', 'heic'])), 'image/heif');
  assert.equal(M.detectType(ftyp('msf1', ['msf1', 'hevc'])), 'image/heif');
  assert.equal(M.detectType(ftyp('mif1', ['mif1', 'miaf'])), null);
  assert.equal(M.detectType(ftyp('mif1', ['avif', 'mif1', 'miaf'])), null);
  assert.equal(M.detectType(ftyp('avif', ['avif', 'mif1', 'miaf'])), null);
  assert.equal(M.detectType(ftyp('avis', ['avis', 'msf1'])), null);
  const bad = ftyp('heic'); new DataView(bad.buffer).setUint32(0, 4096 * 4); assert.equal(M.detectType(bad), null, 'box larger than the read head');
  assert.equal(M.detectType(jpegBytes(1)), 'image/jpeg');
  assert.equal(M.detectType(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png');
});

test('readPhoto keeps exact HEIC bytes and adds a JPEG view with the displayed size limited to 4096 px', async () => {
  const file = heicFile(), p = await M.readPhoto(file, C.id);
  assert.deepEqual(Object.keys(p), ['id', 'name', 'type', 'width', 'height', 'size', 'digest', 'view', 'blob']);
  assert.equal(p.type, 'image/heic'); assert.equal(p.blob.type, 'image/heic');
  assert.deepEqual(new Uint8Array(await p.blob.arrayBuffer()), new Uint8Array(await file.arrayBuffer()));
  assert.equal(p.digest, await M.digest(file)); assert.equal(p.width, 8064); assert.equal(p.height, 6048);
  assert.deepEqual(Object.keys(p.view), ['type', 'size', 'digest', 'width', 'height', 'blob']);
  assert.equal(p.view.type, 'image/jpeg'); assert.equal(p.view.width, 4096); assert.equal(p.view.height, 3072);
  assert.equal(p.view.digest, await M.digest(p.view.blob));
  decoder = { width: 3024, height: 4032, supported: true };
  const portrait = await M.readPhoto(heicFile('a.heif', 'image/heif', 'mif1', ['mif1', 'heic']), C.id);
  assert.equal(portrait.type, 'image/heif'); assert.equal(portrait.view.width, 3024); assert.equal(portrait.view.height, 4032, 'no upscaling, no crop');
  const unlabeled = await M.readPhoto(heicFile('b', ''), C.id); assert.equal(unlabeled.type, 'image/heic');
  const crossLabel = await M.readPhoto(heicFile('c.heic', 'image/heif'), C.id); assert.equal(crossLabel.type, 'image/heic', 'content decides within the HEIF family');
  await assert.rejects(M.readPhoto(new File([ftyp('avif', ['avif', 'mif1'])], 'x.avif', { type: '' }), C.id), /일치하지 않습니다/);
  await assert.rejects(M.readPhoto(new File([ftyp('heic')], 'x.jpg', { type: 'image/jpeg' }), C.id), /일치하지 않습니다/);
  decoder = { width: 8064, height: 6048, supported: true };
});

test('HEIC conversions run one at a time and an unsupported decoder fails with guidance before any document change', async () => {
  peak = 0;
  const photos = await Promise.all([1, 2, 3].map(i => M.readPhoto(heicFile('p' + i + '.heic'), C.id)));
  assert.equal(photos.length, 3); assert.equal(peak, 1);
  const { d } = await heicDoc(), shape = v => JSON.stringify({ ...v, photos: v.photos.map(M.metadata) }), before = shape(d);
  decoder.supported = false;
  try {
    await assert.rejects(M.readPhoto(heicFile(), C.id), error => error.code === 'heic_unsupported' && /HEIC 보기용 사본을 만들 수 없습니다. iPhone·iPad에서 추가해 주세요/.test(error.message));
    const next = await M.readPhoto(heicFile(), C.id).catch(() => 'still-refused'); assert.equal(next, 'still-refused', 'queue keeps working after a failure');
  } finally { decoder.supported = true; }
  assert.equal(shape(d), before);
  assert.equal((await M.readPhoto(heicFile(), C.id)).view.width, 4096, 'queue recovers');
});

test('view is required for HEIC/HEIF and forbidden for other types; view metadata is bounded and blob-checked', async () => {
  const { d, p } = await heicDoc(); M.validate(d);
  const missing = structuredClone(d); delete missing.photos[0].view; assert.throws(() => M.validate(missing));
  const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1])], { type: 'image/png' });
  const extra = structuredClone(d); Object.assign(extra.photos[0], { type: 'image/png', blob: png, size: png.size }); assert.throws(() => M.validate(extra), /형식/);
  for (const change of [v => { v.type = 'image/png'; }, v => { v.width = 4097; }, v => { v.height = 0; }, v => { v.size = 1; }, v => { v.digest = 'x'; }, v => { v.extra = 1; }, v => { delete v.blob; }]) {
    const bad = structuredClone(d); change(bad.photos[0].view); assert.throws(() => M.validate(bad));
  }
  const tooWide = structuredClone(d); tooWide.photos[0].width = 100; assert.throws(() => M.validate(tooWide), /보기용/);
  assert.equal(M.viewRequired('image/heic'), true); assert.equal(M.viewRequired('image/heif'), true); assert.equal(M.viewRequired('image/jpeg'), false);
  assert.equal(p.view.blob.type, 'image/jpeg');
});

test('metadata strips original and view blobs, preserving key order and non-HEIC output', async () => {
  const { p } = await heicDoc(), m = M.metadata(p);
  assert.deepEqual(Object.keys(m), ['id', 'name', 'type', 'width', 'height', 'size', 'digest', 'view']);
  assert.deepEqual(Object.keys(m.view), ['type', 'size', 'digest', 'width', 'height']);
  assert(p.view.blob instanceof Blob, 'caller photo is not mutated');
  const png = { id: 'a', name: 'x.png', type: 'image/png', width: 1, height: 1, size: 9, digest: 'f'.repeat(64), blob: new Blob(['x']) };
  const { blob, ...legacy } = png; assert.equal(JSON.stringify(M.metadata(png)), JSON.stringify(legacy));
});

test('photo ZIP stores views/<id> beside photos/<id>, restores both exactly and refuses missing, changed or orphan views', async () => {
  const { d, p } = await heicDoc(), files = Zip.unzipSync(new Uint8Array(await (await M.backup(d)).arrayBuffer()));
  assert.deepEqual(Object.keys(files).sort(), ['manifest.json', 'photos/' + p.id, 'views/' + p.id].sort());
  const manifest = JSON.parse(Zip.strFromU8(files['manifest.json']));
  assert.deepEqual(manifest.photos[0].view, M.metadata(p).view); assert(!Object.hasOwn(manifest.photos[0].view, 'blob'));
  const copy = await M.readBackup(new Blob([Zip.zipSync(files)]), C.id);
  assert.notEqual(copy.photos[0].id, p.id); assert.equal(copy.photos[0].view.digest, p.view.digest);
  assert.deepEqual(new Uint8Array(await copy.photos[0].blob.arrayBuffer()), new Uint8Array(await p.blob.arrayBuffer()));
  assert.deepEqual(new Uint8Array(await copy.photos[0].view.blob.arrayBuffer()), new Uint8Array(await p.view.blob.arrayBuffer()));
  assert.deepEqual(Object.keys(copy.photos[0]), Object.keys(p));
  const without = { ...files }; delete without['views/' + p.id];
  await assert.rejects(M.readBackup(new Blob([Zip.zipSync(without)]), C.id), /보기용 사본/);
  const changed = { ...files, ['views/' + p.id]: jpegBytes(200) };
  await assert.rejects(M.readBackup(new Blob([Zip.zipSync(changed)]), C.id), /보기용 사본/);
  const orphan = { ...files, ['views/other']: jpegBytes(3) };
  await assert.rejects(M.readBackup(new Blob([Zip.zipSync(orphan)]), C.id), /백업 파일/);
  // Non-HEIC ZIPs keep their exact entry set.
  const plain = M.create(C.id), png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])], { type: 'image/png' });
  plain.photos = [{ id: C.id(), name: 'a.png', type: png.type, width: 2, height: 2, size: png.size, digest: await M.digest(png), blob: png }];
  plain.ops = [{ insert: { photo: { id: plain.photos[0].id, caption: '', alt: '' } } }, { insert: '\n' }];
  const plainFiles = Zip.unzipSync(new Uint8Array(await (await M.backup(plain)).arrayBuffer()));
  assert.deepEqual(Object.keys(plainFiles).sort(), ['manifest.json', 'photos/' + plain.photos[0].id].sort());
  const withView = { ...plainFiles, ['views/' + plain.photos[0].id]: jpegBytes(4) };
  await assert.rejects(M.readBackup(new Blob([Zip.zipSync(withView)]), C.id), /백업 파일/);
});

test('Blog.pack strips view blobs; hydrate verifies HEIC by signature/digest and the view by digest and decoded size', async () => {
  const { d, p } = await heicDoc(); d.status = 'saved'; d.revision = 2;
  const packed = Blog.pack(d);
  assert.deepEqual(packed.photos[0], M.metadata(p)); assert.equal(JSON.stringify(packed).includes('"blob"'), false);
  const viaMap = await Blog.hydrate(packed, new Map([[p.id, { blob: p.blob, view: p.view.blob }]]));
  assert.equal(viaMap.photos[0].view.blob, p.view.blob); assert.equal(viaMap.photos[0].blob, p.blob);
  const viaArray = await Blog.hydrate(packed, d.photos); assert.equal(viaArray.photos[0].view.blob, p.view.blob);
  // Existing callers pass only the original after Blog.pack(doc) validated the pair.
  const legacyCaller = await Blog.hydrate(Blog.pack(d), new Map(d.photos.map(photo => [photo.id, photo.blob])));
  assert.equal(legacyCaller.photos[0].view.blob, p.view.blob);
  const fresh = new Blob([await p.blob.arrayBuffer()], { type: p.type });
  await assert.rejects(Blog.hydrate(packed, new Map([[p.id, fresh]])), { code: 'invalid_blog_photo' }, 'no view, no pairing');
  const wrongView = new Blob([jpegBytes(99)], { type: 'image/jpeg' });
  await assert.rejects(Blog.hydrate(packed, new Map([[p.id, { blob: p.blob, view: wrongView }]])), { code: 'invalid_blog_photo' });
  const viewAsOriginal = structuredClone(packed); viewAsOriginal.photos[0].view.width = 4000;
  await assert.rejects(Blog.hydrate(viewAsOriginal, new Map([[p.id, { blob: p.blob, view: p.view.blob }]])), { code: 'invalid_blog_photo' }, 'decoded view size must match');
  const forbidden = structuredClone(packed); delete forbidden.photos[0].view; assert.throws(() => Blog.validateManifest(forbidden));
  // Public projection uses the derived JPEG; the HEIC original is never public.
  const snapshot = Blog.publicSnapshot(d, { photoIds: [p.id] });
  assert.equal(snapshot.photos[0].type, 'image/jpeg'); assert.equal(snapshot.photos[0].digest, p.view.digest);
  assert.equal(snapshot.photos[0].width, 4096); assert.equal(snapshot.photos[0].size, p.view.size);
});

test('preservation ZIP carries photos/<doc>/<id>.view for HEIC and counts its bytes', async () => {
  const P = require('../assets/life/preservation-package.js'), R = require('../assets/life/source-reference.js'), N = require('../assets/life/nine-board.js');
  let bundle = C.createWorkspace({ title: '익명 선택 자료' });
  const body = '선택한 정확 구절\n끝';
  const first = await C.prepareImport({ origin: 'obsidian', title: '선택 원문', text: body, fileName: 'a.md', authorRelation: 'unknown' }, bundle);
  bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, first));
  const ref = await R.build({ bundle, sourceId: first.source.id, versionId: first.version.id, locator: { start: 0, end: 4 } });
  const { d, p } = await heicDoc(); d.status = 'saved'; d.revision = 3;
  const nineBoard = N.empty(bundle.workspaceId);
  const snapshot = await require('../assets/life/preservation-references.js').select(
    { bundle, posts: [{ doc: d, evidence: { revision: 1, refs: [ref] } }], nineBoard }, { postIds: [d.id], boardIds: [] });
  const summary = P.summary(snapshot); assert.equal(summary.photos, 1); assert.equal(summary.photoBytes, p.size + p.view.size);
  const archive = await P.pack(snapshot), files = Zip.unzipSync(new Uint8Array(await archive.arrayBuffer()));
  assert.deepEqual(Object.keys(files).sort(), ['manifest.json', `photos/${d.id}/${p.id}`, `photos/${d.id}/${p.id}.view`].sort());
  const restored = await P.read(archive);
  assert.equal(await M.digest(restored.posts[0].doc.photos[0].view.blob), p.view.digest);
  assert.equal(await M.digest(restored.posts[0].doc.photos[0].blob), p.digest);
  const copy = await require('../assets/life/preservation-references.js').copy(restored);
  assert.equal(copy.posts[0].doc.photos[0].view.digest, p.view.digest);
  // Removing the view entry is refused, not silently re-derived.
  const missing = { ...files }; delete missing[`photos/${d.id}/${p.id}.view`];
  await assert.rejects(P.read(new Blob([Zip.zipSync(missing, { level: 0 })])), { code: 'invalid_preservation_package' });
});

test('series ZIP nests the photo ZIP with its view and restores the exact snapshot', async () => {
  const S = require('../assets/life/blog-series-package.js'), Series = require('../assets/life/blog-series.js');
  const { d, p } = await heicDoc(); d.status = 'saved'; d.revision = 4;
  const series = Series.create(C.id, d.createdAt); series.title = '아이폰 사진 모음'; series.items = [Series.item(d, C.id)];
  const snapshot = { series, posts: [{ itemId: series.items[0].id, doc: d }] };
  const archive = await S.pack(snapshot), outer = Zip.unzipSync(new Uint8Array(await archive.arrayBuffer()));
  const inner = Zip.unzipSync(outer['posts/' + series.items[0].id + '.zip']);
  assert.deepEqual(Object.keys(inner).sort(), ['manifest.json', 'photos/' + p.id, 'views/' + p.id].sort());
  const restored = await S.read(archive);
  assert.equal(restored.posts[0].doc.photos[0].view.digest, p.view.digest);
  assert.deepEqual(new Uint8Array(await restored.posts[0].doc.photos[0].blob.arrayBuffer()), new Uint8Array(await p.blob.arrayBuffer()));
});

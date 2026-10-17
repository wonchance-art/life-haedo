'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Zip = require('../vendor/fflate/fflate.js');
const P = require('../assets/life/preservation-package.js'), C = require('../assets/life/core.js');
const Photo = require('../assets/life/photo-post.js'), R = require('../assets/life/source-reference.js'), N = require('../assets/life/nine-board.js');
const blob = files => new Blob([Zip.zipSync(files, { level: 0 })]);
const filesOf = async file => Zip.unzipSync(new Uint8Array(await file.arrayBuffer()));
const decode = files => JSON.parse(new TextDecoder().decode(files['manifest.json']));
const changeManifest = (files, change) => { const value = decode(files); change(value); return { ...files, 'manifest.json': Zip.strToU8(JSON.stringify(value)) }; };
function central(bytes, name, change) {
  const result = Buffer.from(bytes); let at = 0;
  while ((at = result.indexOf(Buffer.from([80, 75, 1, 2]), at)) !== -1) {
    if (result.subarray(at + 46, at + 46 + result.readUInt16LE(at + 28)).toString() === name) { change(result, at); return result; }
    at += 4;
  }
  throw Error('fixture entry missing');
}
async function fixture() {
  let bundle = C.createWorkspace({ title: '익명 선택 자료' });
  const body = '\ufeff🌱 옛 원문\r\n선택한 정확 구절\r\n끝';
  const first = await C.prepareImport({ origin: 'obsidian', title: '선택 원문', text: body, fileName: 'notes/선택.md', authorRelation: 'unknown' }, bundle);
  bundle = C.applyChanges(bundle, C.buildImportChanges(bundle, first));
  const ref = await R.build({ bundle, sourceId: first.source.id, versionId: first.version.id,
    locator: { start: body.indexOf('선택한'), end: body.indexOf('\r\n끝') } });
  const photo = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])], { type: 'image/png' });
  const doc = Photo.create(C.id); doc.status = 'saved'; doc.revision = 3; doc.title = '원문과 사진을 담은 글 🌱';
  doc.photos = [{ id: C.id(), name: '익명 원본.png', type: photo.type, width: 4032, height: 3024,
    size: photo.size, digest: await Photo.digest(photo), blob: photo }];
  doc.ops = [{ insert: '첫 문단\r\n' }, { insert: { photo: { id: doc.photos[0].id, caption: '직접 쓴 설명', alt: '익명 풍경' } } }, { insert: '선택한 정확 구절\n' }];
  const postRef = await R.buildPost({ workspaceId: bundle.workspaceId, post: doc });
  const nineBoard = N.empty(bundle.workspaceId), board = N.create(C.id); board.title = '내가 고른 기록';
  board.areas[0].items = [N.evidenceSnapshot({ kind: 'source', value: ref }), N.evidenceSnapshot({ kind: 'post', value: postRef })];
  nineBoard.format = 'life-nine-board-v2'; nineBoard.revision = 2; nineBoard.boards = [board];
  return require('../assets/life/preservation-references.js').select(
    { bundle, posts: [{ doc, evidence: { revision: 1, refs: [ref] } }], nineBoard }, { postIds: [doc.id], boardIds: [board.id] });
}
test('selected originals, exact evidence and nine-board references round-trip without changing IDs, bytes or caller data', async () => {
  const snapshot = await fixture(), before = structuredClone(snapshot), archive = await P.pack(snapshot), files = await filesOf(archive);
  assert.equal(archive.type, 'application/zip');
  assert.deepEqual(Object.keys(files).sort(), ['manifest.json', `photos/${snapshot.posts[0].doc.id}/${snapshot.posts[0].doc.photos[0].id}`].sort());
  const manifest = decode(files); assert.equal(manifest.format, P.FORMAT);
  assert.deepEqual(Object.keys(manifest).sort(), ['format', 'bundle', 'posts', 'nineBoard'].sort());
  assert(!Object.hasOwn(manifest.posts[0].doc.photos[0], 'blob'));
  const restored = await P.read(archive); assert.deepEqual(restored, before); assert.deepEqual(snapshot, before);
  assert.equal(await Photo.digest(restored.posts[0].doc.photos[0].blob), before.posts[0].doc.photos[0].digest);
  assert.deepEqual(await restored.posts[0].doc.photos[0].blob.arrayBuffer(), await before.posts[0].doc.photos[0].blob.arrayBuffer());
  assert.deepEqual(P.summary(restored), { posts: 1, photos: 1, photoBytes: 11, sources: 1, sourceVersions: 1, boards: 1 });
  assert.equal((await R.resolve(restored.bundle, restored.posts[0].evidence.refs[0])).sourceVersionId, before.bundle.sourceVersions[0].id);
});
test('v1 saved text-only posts and explicitly archived v2 posts remain private saved documents, not implicit publications', async () => {
  for (const legacy of [false, true]) {
    const snapshot = await fixture(), doc = snapshot.posts[0].doc;
    doc.photos = []; doc.ops = [{ insert: '사진 없는 저장 글\n' }]; snapshot.nineBoard = N.empty(snapshot.bundle.workspaceId);
    if (legacy) { doc.format = 'life-photo-post-v1'; delete doc.attachments; delete doc.archived; }
    else doc.archived = true;
    const restored = await P.read(await P.pack(snapshot)); assert.deepEqual(restored, snapshot);
    assert.equal(restored.posts[0].doc.status, 'saved'); assert.equal(restored.posts[0].doc.revision, 3);
    assert(!Object.hasOwn(decode(await filesOf(await P.pack(snapshot))), 'publication'));
  }
});
test('unknown metadata, draft posts, duplicate posts, cross-workspace data and extra source versions cannot enter transport', async () => {
  const original = await fixture();
  const changes = [s => { s.account = 'excluded'; }, s => { s.posts[0].doc.status = 'draft'; },
    s => { s.posts.push(structuredClone(s.posts[0])); }, s => { s.posts[0].evidence.sync = {}; },
    s => { s.nineBoard.workspaceId = C.id(); }, s => { s.posts[0].evidence.refs[0].note = 'excluded'; },
    s => { s.bundle.sourceVersions.push({ ...structuredClone(s.bundle.sourceVersions[0]), id: C.id(), contentText: '다른 버전', contentHash: '0'.repeat(64) }); }];
  for (const change of changes) { const copy = structuredClone(original); change(copy); await assert.rejects(P.pack(copy)); }
  const archive = await P.pack(original), files = await filesOf(archive);
  for (const change of [m => { m.sync = {}; }, m => { m.posts[0].doc.publication = {}; }, m => { m.posts[0].evidence.revision = -1; }]) await assert.rejects(P.read(blob(changeManifest(files, change))));
  assert.deepEqual(original, await P.read(archive));
});
test('changed exact source/post references, body hashes and original photo bytes fail rather than substituting another target', async () => {
  const snapshot = await fixture(), files = await filesOf(await P.pack(snapshot));
  for (const change of [m => { m.bundle.sourceVersions[0].contentText += '변조'; },
    m => { m.posts[0].evidence.refs[0].quote = 'x'.repeat(m.posts[0].evidence.refs[0].quote.length); },
    m => { m.nineBoard.boards[0].areas[0].items[1].reference.value.postRevision++; },
    m => { m.nineBoard.boards[0].areas[0].items[0].reference.value.sourceVersionId = C.id(); },
    m => { m.posts[0].doc.photos[0].digest = '0'.repeat(64); },
    m => { m.posts[0].doc.photos[0].type = 'image/jpeg'; }]) await assert.rejects(P.read(blob(changeManifest(files, change))));
  const path = Object.keys(files).find(name => name.startsWith('photos/')), altered = { ...files, [path]: files[path].slice() };
  altered[path][8] ^= 1; await assert.rejects(P.read(blob(altered)), { code: 'invalid_blog_photo' });
});
test('missing, extra, executable, traversal, backslash, directory and duplicate archive names reject before a snapshot is returned', async () => {
  const files = await filesOf(await P.pack(await fixture())), photo = Object.keys(files).find(name => name.startsWith('photos/'));
  const missingManifest = { ...files }; delete missingManifest['manifest.json'];
  const missingPhoto = { ...files }; delete missingPhoto[photo];
  for (const invalid of [missingManifest, missingPhoto, { ...files, 'read.html': Zip.strToU8('<script>bad()</script>') },
    { ...files, '../escape': new Uint8Array(1) }, { ...files, 'photos/': new Uint8Array() },
    { ...files, 'photos/a/../b': new Uint8Array(1) }, { ...files, 'photos\\a\\b': new Uint8Array(1) },
    { ...files, 'photos/extra/extra': new Uint8Array(1) }]) await assert.rejects(P.read(blob(invalid)), { code: 'invalid_preservation_package' });
  const duplicate = Buffer.from(await blob({ ...files, 'manifest.jsox': files['manifest.json'] }).arrayBuffer());
  let at = 0; while ((at = duplicate.indexOf('manifest.jsox', at)) !== -1) { duplicate.write('manifest.json', at); at += 13; }
  await assert.rejects(P.read(new Blob([duplicate])), { code: 'invalid_preservation_package' });
});
test('UTF-8, declared sizes, compression methods and bounded input reject malformed files without allocating their claimed payloads', async () => {
  const files = await filesOf(await P.pack(await fixture())), packed = await blob(files).arrayBuffer();
  await assert.rejects(P.read({ size: P.LIMITS.bytes + 1, arrayBuffer() { throw Error('must not read'); } }), { code: 'invalid_preservation_package' });
  await assert.rejects(P.read({ size: 30, arrayBuffer: async () => new ArrayBuffer(31) }), { code: 'invalid_preservation_package' });
  await assert.rejects(P.read(blob({ ...files, 'manifest.json': new Uint8Array([255, 254]) })), { code: 'invalid_preservation_package' });
  await assert.rejects(P.read(blob({ ...files, 'manifest.json': Zip.strToU8('{}') })), { code: 'invalid_preservation_package' });
  const photo = Object.keys(files).find(name => name.startsWith('photos/'));
  for (const [name, change] of [
    ['manifest.json', (b, at) => b.writeUInt32LE(P.LIMITS.json + 1, at + 24)],
    [photo, (b, at) => b.writeUInt32LE(64 * 1024 * 1024 + 1, at + 24)],
    [photo, (b, at) => b.writeUInt32LE(1, at + 24)],
    [photo, (b, at) => b.writeUInt16LE(99, at + 10)],
  ]) await assert.rejects(P.read(new Blob([central(packed, name, change)])), { code: 'invalid_preservation_package' });
  await assert.rejects(P.read(new Blob([Buffer.alloc(100)])), { code: 'invalid_preservation_package' });
});
test('stored CRC, local names and headers bind each extracted file to the exact declared archive bytes', async () => {
  const files = await filesOf(await P.pack(await fixture())), packed = await blob(files).arrayBuffer();
  const photo = Object.keys(files).find(name => name.startsWith('photos/'));
  for (const change of [
    (b, at) => { const local = b.readUInt32LE(at + 42); b[local + 30] ^= 1; },
    (b, at) => { const local = b.readUInt32LE(at + 42); b.writeUInt32LE(1, local + 18); },
    (b, at) => { const local = b.readUInt32LE(at + 42); b[local + 30 + b.readUInt16LE(local + 26) + 8] ^= 1; },
    (b, at) => { const local = b.readUInt32LE(at + 42); b.writeUInt32LE(0, at + 16); b.writeUInt32LE(0, local + 14); },
    (b, at) => { b.writeUInt32LE(0xa0000000, at + 38); },
  ]) await assert.rejects(P.read(new Blob([central(packed, photo, change)])), { code: 'invalid_preservation_package' });
});
test('DEFLATE with an understated output size cannot hide data behind a valid JSON prefix in this stored-only format', async () => {
  const files = await filesOf(await P.pack(await fixture()));
  const prefix = files['manifest.json'], expanded = new Uint8Array(prefix.length + 5000);
  expanded.set(prefix); expanded.fill(32, prefix.length);
  const compressed = Zip.zipSync({ ...files, 'manifest.json': expanded }, { level: 6 });
  const understated = central(compressed, 'manifest.json', (bytes, at) => bytes.writeUInt32LE(prefix.length, at + 24));
  // The underlying engine returns this valid prefix at the forged length. The
  // package boundary must reject compression before trusting that apparent size.
  assert.deepEqual(Zip.unzipSync(understated)['manifest.json'], prefix);
  await assert.rejects(P.read(new Blob([understated])), /지원하지 않는 ZIP 압축 방식/);
  await assert.rejects(P.read(new Blob([Zip.zipSync(files, { level: 6 })])), /지원하지 않는 ZIP 압축 방식/);
});
test('a selected source-only nine-board also remains reusable without adding unrelated posts', async () => {
  const snapshot = await fixture(); snapshot.posts = [];
  snapshot.nineBoard.boards[0].areas[0].items.splice(1);
  const restored = await P.read(await P.pack(snapshot)); assert.deepEqual(restored, snapshot);
  assert.equal(P.summary(restored).posts, 0); assert.equal(P.summary(restored).photos, 0);
  assert.equal((await R.resolve(restored.bundle, restored.nineBoard.boards[0].areas[0].items[0].reference.value)).sourceVersionId, snapshot.bundle.sourceVersions[0].id);
});
test('selection limits apply before photo reads and file output, while an empty selection is not exported', async () => {
  const snapshot = await fixture();
  const empty = { bundle: C.createWorkspace(), posts: [], nineBoard: null }; empty.nineBoard = N.empty(empty.bundle.workspaceId);
  await assert.rejects(P.pack(empty));
  const many = structuredClone(snapshot); many.posts = Array.from({ length: 21 }, (_, index) => ({ ...structuredClone(snapshot.posts[0]), doc: { ...structuredClone(snapshot.posts[0].doc), id: 'post_' + index } }));
  await assert.rejects(P.pack(many), { code: 'invalid_preservation_package' });
  const photos = structuredClone(snapshot);
  photos.posts = Array.from({ length: 11 }, (_, index) => {
    const doc = { ...structuredClone(snapshot.posts[0].doc), id: 'post_' + index };
    doc.photos = Array.from({ length: 20 }, (_, p) => ({ ...doc.photos[0], id: 'photo_' + p }));
    doc.ops = [{ insert: '사진 목록\n' }];
    return { doc, evidence: { revision: 0, refs: [] } };
  });
  await assert.rejects(P.pack(photos), { code: 'invalid_preservation_package' });
});
test('pack takes ownership before asynchronous verification, so caller changes cannot alter confirmed archive contents', async () => {
  const snapshot = await fixture(), before = structuredClone(snapshot), pending = P.pack(snapshot);
  snapshot.posts[0].doc.title = '호출 뒤 바뀐 제목'; snapshot.posts[0].evidence.refs.length = 0; snapshot.nineBoard.boards.length = 0;
  const restored = await P.read(await pending); assert.deepEqual(restored, before);
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const P = require('../assets/life/blog-series-package.js'), Series = require('../assets/life/blog-series.js');
const Photo = require('../assets/life/photo-post.js'), Core = require('../assets/life/core.js'), Zip = require('../vendor/fflate/fflate.js');
const archive = files => new Blob([Zip.zipSync(files, { level: 0 })], { type: 'application/zip' });
const filesOf = async blob => Zip.unzipSync(new Uint8Array(await blob.arrayBuffer()));
const manifest = files => JSON.parse(new TextDecoder().decode(files['series.json']));
function editManifest(files, change) { const value = manifest(files); change(value); return { ...files, 'series.json': Zip.strToU8(JSON.stringify(value)) }; }
async function fixture() {
  const series = Series.create(Core.id, '2026-10-18T01:00:00.000Z'); series.title = '걷고 읽는 날들 🌱'; series.intro = '옛 글을 고른 순서\r\n사진과 출처를 함께 읽습니다.';
  const first = Photo.create(Core.id, series.createdAt), second = Photo.create(Core.id, series.createdAt);
  first.status = second.status = 'saved'; first.revision = 4; second.revision = 7;
  first.title = '사진을 남긴 첫날'; second.title = '사진 없이 이어 쓴 글';
  first.format = 'life-photo-post-v1'; delete first.attachments; delete first.archived;
  const blob = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
  first.photos = [{ id: Core.id(), name: '원본 <사진>.png', type: blob.type, width: 1, height: 1, size: blob.size, digest: await Photo.digest(blob), blob }];
  first.ops = [{ insert: '인용한 구절\r\n', attributes: { blockquote: true } }, { insert: '원문 출처\n', attributes: { link: 'https://example.org/source?edition=old' } }, { insert: { photo: { id: first.photos[0].id, caption: '사진 설명 🌱', alt: '익명 풍경' } } }, { insert: '\n' }];
  second.ops = [{ insert: '두 번째 글의 본문\n' }];
  second.attachments = [{ type: 'book', title: '길에서 읽은 책', creator: '익명 저자', url: 'https://example.org/book' }];
  series.items = [Series.item(first, Core.id), Series.item(second, Core.id)];
  return { series, posts: [{ itemId: series.items[0].id, doc: first }, { itemId: series.items[1].id, doc: second }] };
}
function central(bytes, callback) {
  const result = Buffer.from(bytes); let at = result.readUInt32LE(result.length - 6);
  while (result.readUInt32LE(at) === 0x02014b50) {
    const length = result.readUInt16LE(at + 28), name = result.subarray(at + 46, at + 46 + length).toString();
    callback(result, at, name); at += 46 + length + result.readUInt16LE(at + 30) + result.readUInt16LE(at + 32);
  }
  return result;
}
test('self-contained series preserves order, exact saved snapshots, v1/v2 formats, attachments and original bytes', async () => {
  const snapshot = await fixture(), before = structuredClone(snapshot), blob = await P.pack(snapshot), files = await filesOf(blob);
  assert.deepEqual(Object.keys(files).sort(), ['series.json', ...snapshot.posts.map(row => 'posts/' + row.itemId + '.zip')].sort());
  const data = manifest(files); assert.equal(data.format, P.FORMAT); assert.deepEqual(Object.keys(data).sort(), ['format', 'posts', 'series']);
  for (const row of snapshot.posts) {
    const nested = await filesOf(await Photo.backup(row.doc));
    assert.deepEqual(await filesOf(new Blob([files['posts/' + row.itemId + '.zip']])), nested, 'reuse the unchanged photo-post backup shape');
  }
  const restored = await P.read(blob); assert.deepEqual(restored, before); assert.deepEqual(snapshot, before);
  assert.equal(restored.posts[0].doc.format, 'life-photo-post-v1'); assert.equal(restored.posts[1].doc.format, 'life-photo-post-v2');
  assert.equal(await Photo.digest(restored.posts[0].doc.photos[0].blob), before.posts[0].doc.photos[0].digest);
  assert.deepEqual(await restored.posts[0].doc.photos[0].blob.arrayBuffer(), await before.posts[0].doc.photos[0].blob.arrayBuffer());
  assert.match(Photo.plainText(restored.posts[0].doc), /인용한 구절/); assert.equal(restored.posts[0].doc.ops[1].attributes.link, 'https://example.org/source?edition=old');
});
test('empty collections, drafts, archived posts, extra account/evidence fields and inconsistent entry mapping fail', async () => {
  const original = await fixture();
  for (const change of [value => { value.series.items = []; value.posts = []; }, value => { value.account = 'private'; }, value => { value.posts[0].evidence = { refs: [] }; }, value => { value.posts[0].doc.status = 'draft'; }, value => { value.posts[1].doc.archived = true; }, value => { value.posts.reverse(); }, value => { value.series.items[0].postRevision++; }]) {
    const value = structuredClone(original); change(value); await assert.rejects(P.pack(value));
  }
  assert.deepEqual(original, await P.read(await P.pack(original)));
});
test('manifest/content disagreement, missing or extra nested archives and unsupported metadata cannot substitute a post', async () => {
  const snapshot = await fixture(), files = await filesOf(await P.pack(snapshot));
  for (const change of [value => { value.owner = 'excluded'; }, value => { value.series.publication = { token: 'excluded' }; }, value => { value.posts[0].doc.ops[0].insert = '다른 본문\n'; }, value => { value.posts[0].doc.photos[0].name = '다른 파일명.png'; }, value => { value.posts[1].doc.attachments[0].url = 'https://example.org/different'; }, value => { value.series.items.reverse(); }]) await assert.rejects(P.read(archive(editManifest(files, change))));
  const missing = { ...files }; delete missing['posts/' + snapshot.posts[0].itemId + '.zip']; await assert.rejects(P.read(archive(missing)));
  await assert.rejects(P.read(archive({ ...files, 'posts/unselected.zip': files['posts/' + snapshot.posts[0].itemId + '.zip'] })));
  await assert.rejects(P.read(archive({ ...files, '../outside': new Uint8Array([1]) })));
});
test('nested original-photo corruption and metadata digest/declared-pixel disagreement are rejected', async () => {
  const snapshot = await fixture(), files = await filesOf(await P.pack(snapshot)), key = 'posts/' + snapshot.posts[0].itemId + '.zip';
  const nested = await filesOf(new Blob([files[key]])), photoKey = Object.keys(nested).find(name => name.startsWith('photos/'));
  nested[photoKey][nested[photoKey].length - 1] ^= 1;
  await assert.rejects(P.read(archive({ ...files, [key]: new Uint8Array(await archive(nested).arrayBuffer()) })), /내용|원본/);
  await assert.rejects(P.read(archive(editManifest(files, value => { value.posts[0].doc.photos[0].digest = '0'.repeat(64); }))));
  const original = global.createImageBitmap;
  global.createImageBitmap = async () => ({ width: 2, height: 1, close() {} });
  try { await assert.rejects(P.read(archive(files)), /사진/); await assert.rejects(P.pack(snapshot), /사진/); }
  finally { if (original === undefined) delete global.createImageBitmap; else global.createImageBitmap = original; }
});
test('unused photo payloads and mismatched legacy nested formats cannot enter the series transport', async () => {
  const snapshot = await fixture(), files = await filesOf(await P.pack(snapshot)), key = 'posts/' + snapshot.posts[0].itemId + '.zip';
  const withUnused = editManifest(files, value => { value.posts[0].doc.ops = [{ insert: '사진을 사용하지 않은 본문\n' }]; });
  await assert.rejects(P.read(archive(withUnused)), /사용한 사진/);
  const unusedInput = structuredClone(snapshot); unusedInput.posts[0].doc.ops = [{ insert: '사진 없는 본문\n' }];
  await assert.rejects(P.pack(unusedInput), /사용한 (?:원본 )?사진/);
  const nested = await filesOf(new Blob([files[key]])), value = JSON.parse(Zip.strFromU8(nested['manifest.json']));
  value.format = 'life-photo-post-backup-v2'; value.attachments = [];
  nested['manifest.json'] = Zip.strToU8(JSON.stringify(value));
  await assert.rejects(P.read(archive({ ...files, [key]: new Uint8Array(await archive(nested).arrayBuffer()) })), /문서 형식/);
});
test('outer and nested DEFLATE members are rejected before the legacy reader can accept a truncated decoded prefix', async () => {
  const snapshot = await fixture(), files = await filesOf(await P.pack(snapshot));
  await assert.rejects(P.read(new Blob([Zip.zipSync(files, { level: 6 })])), /압축/);
  const key = 'posts/' + snapshot.posts[0].itemId + '.zip', nested = await filesOf(new Blob([files[key]]));
  const deflated = Zip.zipSync(nested, { level: 6 });
  await assert.rejects(P.read(archive({ ...files, [key]: deflated })), /압축/);
  const understated = central(deflated, (buffer, at, name) => { if (name.startsWith('photos/')) buffer.writeUInt32LE(1, at + 24); });
  await assert.rejects(P.read(archive({ ...files, [key]: understated })), /압축/);
});
test('CRC, local/central bounds, duplicate paths, hidden trailing bytes and truncated archives fail strictly', async () => {
  const snapshot = await fixture(), file = await P.pack(snapshot), bytes = Buffer.from(await file.arrayBuffer());
  const crc = Buffer.from(bytes); crc[45] ^= 1; await assert.rejects(P.read(new Blob([crc])));
  const changedLocal = central(bytes, (buffer, at) => { const local = buffer.readUInt32LE(at + 42); buffer.writeUInt32LE(1, local + 22); });
  await assert.rejects(P.read(new Blob([changedLocal])));
  const named = [];
  const duplicate = central(bytes, (buffer, at, name) => { if (name.startsWith('posts/')) { named.push(name); if (named.length === 2) { Buffer.from(named[0]).copy(buffer, at + 46); Buffer.from(named[0]).copy(buffer, buffer.readUInt32LE(at + 42) + 30); } } });
  await assert.rejects(P.read(new Blob([duplicate])), /중복/);
  await assert.rejects(P.read(new Blob([bytes, new Uint8Array([1])])));
  await assert.rejects(P.read(new Blob([bytes.subarray(0, bytes.length - 1)])));
});
test('native read owns independent metadata and read failures never change the source file or snapshot', async () => {
  const snapshot = await fixture(), file = await P.pack(snapshot), before = await file.arrayBuffer();
  const first = await P.read(file); first.series.title = '읽은 뒤 수정'; first.posts[0].doc.ops[0].insert = '새 입력\n';
  const second = await P.read(file); assert.deepEqual(second, snapshot); assert.deepEqual(await file.arrayBuffer(), before);
  await assert.rejects(P.read({ size: 22, arrayBuffer: async () => new ArrayBuffer(22) }));
  const malformed = await filesOf(file); malformed['series.json'] = new Uint8Array([255]); await assert.rejects(P.read(archive(malformed)), /읽지/);
});

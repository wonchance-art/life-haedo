'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const M = require('../assets/life/photo-post.js');
const Markdown = require('../assets/life/post-markdown.js');
const C = require('../assets/life/core.js');
const Zip = require('../vendor/fflate/fflate.js');

async function fixture() {
  const doc = M.create(C.id);
  const blob = new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3])], { type: 'image/png' });
  const photo = { id: C.id(), name: '사진 원본.png', type: blob.type, width: 4032, height: 3024,
    size: blob.size, digest: await M.digest(blob), blob };
  doc.title = '산책과 생각';
  doc.photos = [photo];
  doc.ops = [{ insert: '첫 문장', attributes: { bold: true, author: 'ai' } }, { insert: '\n' },
    { insert: { photo: { id: photo.id, caption: '설명\n둘째 줄 &amp;', alt: '길과 나무 🌳' } } },
    { insert: '마지막 문장\n' }];
  doc.attachments = [{ type: 'book', title: '읽던 책', creator: '익명 저자', url: 'https://example.org/book' }];
  return { legacy: doc, doc: Markdown.fromV2(doc).document, photo };
}

test('Markdown validation keeps the sole canonical body, photo bytes and AI text; compatibility projection is read-only', async () => {
  const { legacy, doc, photo } = await fixture(), before = structuredClone(doc);
  assert.deepEqual([...M.validate(doc)], [photo.id]);
  assert.equal(M.plainText(doc), M.plainText(legacy));
  assert.equal(M.contentOps(doc).find(op => op.insert === '첫 문장').attributes.author, 'ai');
  assert.equal(Object.hasOwn(doc, 'ops'), false);
  assert.deepEqual(M.upgrade(doc), before);
  assert.deepEqual(doc, before);
});

test('Markdown backup and restore remap photo identities, preserve bytes and keep Markdown format and reviewed attachments', async () => {
  const { doc, photo } = await fixture(), before = structuredClone(doc);
  doc.archived = true;
  const archive = await M.backup(doc);
  const files = Zip.unzipSync(new Uint8Array(await archive.arrayBuffer()));
  const manifest = JSON.parse(Zip.strFromU8(files['manifest.json']));
  assert.equal(manifest.format, 'life-post-md-backup-v1');
  assert.equal(manifest.markdown, doc.markdown);
  assert.equal(Object.hasOwn(manifest, 'ops'), false);
  assert.deepEqual(Object.keys(files).sort(), ['manifest.json', 'photos/' + photo.id].sort());
  const copy = await M.readBackup(archive, C.id);
  assert.equal(copy.format, 'life-post-md-v1');
  assert.equal(copy.status, 'draft');
  assert.equal(copy.archived, false);
  assert.equal(copy.revision, 0);
  assert.equal(copy.replaces, null);
  assert.notEqual(copy.id, doc.id);
  assert.notEqual(copy.photos[0].id, photo.id);
  assert.deepEqual(copy.attachments, doc.attachments);
  assert.equal(M.plainText(copy), M.plainText(doc));
  assert.deepEqual(await copy.photos[0].blob.arrayBuffer(), await photo.blob.arrayBuffer());
  assert.equal(copy.photos[0].digest, photo.digest);
  assert.equal(copy.photos[0].width, 4032);
  assert.equal(copy.photos[0].height, 3024);
  assert.equal(M.contentOps(copy).find(op => typeof op.insert !== 'string').insert.photo.id, copy.photos[0].id);
  assert.equal(M.contentOps(copy).find(op => op.insert === '첫 문장').attributes.author, 'ai');
  assert.deepEqual(doc, { ...before, archived: true });
});

test('Markdown compact removes only unused originals while retaining exact raw Markdown', async () => {
  const { doc, photo } = await fixture();
  doc.photos.push({ ...photo, id: C.id() });
  const compact = M.compact(doc);
  assert.equal(compact.photos.length, 1);
  assert.equal(compact.markdown, doc.markdown);
  assert.equal(doc.photos.length, 2);
});

test('Markdown schema refuses dual bodies, missing or duplicate photos, foreign fields and excess text', async () => {
  const { doc, photo } = await fixture();
  for (const bad of [{ ...doc, ops: [{ insert: '\n' }] }, { ...doc, account: 'private' },
    { ...doc, photos: [] }, { ...doc, markdown: doc.markdown + `\n![copy](haedo-photo:${photo.id})\n` },
    { ...doc, markdown: '가'.repeat(50001) + '\n' }, { ...doc, attachments: [{ type: 'book', title: 'x', creator: '', url: '', note: 'private' }] }])
    assert.throws(() => M.validate(bad));
});

test('Markdown saved empty documents cannot bypass the same required-content boundary', () => {
  const legacy = M.create(C.id), doc = Markdown.fromV2(legacy).document;
  doc.status = 'saved';
  assert.throws(() => M.validate(doc), /글을 쓰거나/);
  doc.title = '제목만 있는 글';
  assert.doesNotThrow(() => M.validate(doc));
});

test('Markdown ZIP corruption and unexpected payloads fail before returning a restored draft', async () => {
  const { doc, photo } = await fixture(), archive = await M.backup(doc);
  const files = Zip.unzipSync(new Uint8Array(await archive.arrayBuffer()));
  const corrupt = { ...files, ['photos/' + photo.id]: files['photos/' + photo.id].slice() };
  corrupt['photos/' + photo.id][8] ^= 1;
  await assert.rejects(M.readBackup(new Blob([Zip.zipSync(corrupt)]), C.id), /내용/);
  const manifest = JSON.parse(Zip.strFromU8(files['manifest.json']));
  manifest.ops = [{ insert: '\n' }];
  files['manifest.json'] = Zip.strToU8(JSON.stringify(manifest));
  await assert.rejects(M.readBackup(new Blob([Zip.zipSync(files)]), C.id), /형식/);
  delete manifest.ops;
  manifest.markdown = manifest.markdown.trimEnd();
  files['manifest.json'] = Zip.strToU8(JSON.stringify(manifest));
  await assert.rejects(M.readBackup(new Blob([Zip.zipSync(files)]), C.id), /본문 형식/);
});

test('unknown newer document formats are refused with explicit refresh guidance', () => {
  const doc = { ...M.create(C.id), format: 'life-post-md-v2' };
  assert.throws(() => M.validate(doc), error => error.code === 'photo_post_update_required' && /새로고침/.test(error.message));
});

test('stored Markdown must already be canonical; validation never silently rewrites source', () => {
  const doc = Markdown.fromV2(M.create(C.id)).document;
  doc.markdown = '본문';
  assert.throws(() => M.validate(doc), /다시 확인/);
  assert.equal(doc.markdown, '본문');
  doc.markdown = Markdown.canonicalize(doc.markdown);
  assert.doesNotThrow(() => M.validate(doc));
});

test('Markdown ZIP preserves an HEIC original and its JPEG view as distinct exact blobs', async () => {
  const { doc } = await fixture();
  const blob = new Blob([Buffer.from('000000186674797068656963000000006d69663168656963', 'hex')], { type: 'image/heic' });
  const viewBlob = new Blob([Uint8Array.from([255,216,255,224,5,6,7,255,217])], { type: 'image/jpeg' });
  const old = doc.photos[0];
  doc.photos = [{ ...old, name: 'IMG_001.HEIC', type: blob.type, size: blob.size, digest: await M.digest(blob), blob,
    view: { type: viewBlob.type, size: viewBlob.size, digest: await M.digest(viewBlob), width: 4032, height: 3024, blob: viewBlob } }];
  const archive = await M.backup(doc), copy = await M.readBackup(archive, C.id);
  assert.equal(copy.format, 'life-post-md-v1');
  assert.deepEqual(await copy.photos[0].blob.arrayBuffer(), await blob.arrayBuffer());
  assert.deepEqual(await copy.photos[0].view.blob.arrayBuffer(), await viewBlob.arrayBuffer());
  const files = Zip.unzipSync(new Uint8Array(await archive.arrayBuffer()));
  delete files['views/' + old.id];
  await assert.rejects(M.readBackup(new Blob([Zip.zipSync(files)]), C.id), /보기용 사본/);
});

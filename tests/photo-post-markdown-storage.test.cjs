'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createStorage } = require('../assets/life/storage.js');
const Photo = require('../assets/life/photo-post.js'), Markdown = require('../assets/life/post-markdown.js');
const Blog = require('../assets/life/blog.js'), Series = require('../assets/life/blog-series.js');
const { memoryIdb, owner, Core, png } = require('./helpers/blog-sync-cloud.cjs');

async function fixture(t) {
  const memory = memoryIdb(), storage = createStorage({ idb: memory.idb, core: Core, channelFactory: null, account: owner });
  t.after(() => storage.close());
  const ws = (await storage.createWorkspace('Markdown 저장 검수')).workspaceId;
  const legacy = Photo.create(Core.id, '2026-11-05T00:00:00.000Z');
  legacy.title = '함께 읽을 기록'; legacy.status = 'saved'; legacy.photos = [await png(91)];
  legacy.ops = [{ insert: '보존할 문장', attributes: { author: 'ai', bold: true } }, { insert: '\n' },
    { insert: { photo: { id: legacy.photos[0].id, caption: '사진 설명', alt: '나무 한 그루' } } }, { insert: '\n' }];
  return { memory, storage, ws, legacy, doc: Markdown.fromV2(legacy).document };
}

test('Markdown saves and reopens exact source and photos; stale saves and failed writes leave it intact', async t => {
  const { memory, storage, ws, doc } = await fixture(t);
  const saved = await storage.savePhotoPost(ws, doc, 0);
  assert.equal(saved.revision, 1);
  assert.equal(saved.markdown, doc.markdown);
  assert.equal((await storage.listPhotoPosts(ws))[0].body.includes('보존할 문장'), true);
  assert.deepEqual(await storage.readPhotoPost(ws, saved.id), saved);
  await assert.rejects(storage.savePhotoPost(ws, { ...saved, title: '낡은 수정' }, 0), { code: 'photo_post_conflict' });
  memory.control.fail = () => true;
  await assert.rejects(storage.savePhotoPost(ws, { ...saved, title: '저장 실패' }, saved.revision), { code: 'storage_quota' });
  assert.deepEqual(await storage.readPhotoPost(ws, saved.id), saved);
});

test('a v2 writer cannot overwrite a Markdown post directly or through a replacement draft', async t => {
  const { storage, ws, doc, legacy } = await fixture(t);
  const saved = await storage.savePhotoPost(ws, doc, 0);
  for (const format of ['life-photo-post-v1', 'life-photo-post-v2']) {
    const old = { ...structuredClone(legacy), revision: saved.revision, format };
    if (format.endsWith('v1')) { delete old.attachments; delete old.archived; }
    await assert.rejects(storage.savePhotoPost(ws, old, saved.revision), error => error.code === 'photo_post_update_required' && /새로고침/.test(error.message));
  }
  const draft = { ...structuredClone(legacy), id: Core.id(), status: 'draft', revision: 0, replaces: { id: saved.id, revision: saved.revision } };
  const pending = await storage.savePhotoPost(ws, draft, 0);
  await assert.rejects(storage.savePhotoPost(ws, { ...pending, status: 'saved' }, pending.revision), { code: 'photo_post_update_required' });
  assert.deepEqual(await storage.readPhotoPost(ws, saved.id), saved);
  assert.deepEqual(await storage.readPhotoPost(ws, pending.id), pending);
});

test('Markdown migration save remains one-way while preserving identity, CAS and original photo bytes', async t => {
  const { storage, ws, legacy } = await fixture(t);
  const saved = await storage.savePhotoPost(ws, legacy, 0);
  const converted = Markdown.fromV2(saved).document;
  const next = await storage.savePhotoPost(ws, converted, saved.revision);
  assert.equal(next.id, saved.id);
  assert.equal(next.revision, saved.revision + 1);
  assert.equal(next.format, 'life-post-md-v1');
  assert.deepEqual(await next.photos[0].blob.arrayBuffer(), await saved.photos[0].blob.arrayBuffer());
  assert.deepEqual(saved.ops, legacy.ops, 'the supplied original remains untouched; phase 2 creates its durable recovery copy');
});

test('finishing an old draft preserves an unreadable future or damaged replacement target and every existing row', async t => {
  const { memory, storage, ws, legacy } = await fixture(t);
  const saved = await storage.savePhotoPost(ws, legacy, 0);
  const draft = await storage.savePhotoPost(ws, { ...structuredClone(saved), id: Core.id(), revision: 0,
    status: 'draft', replaces: { id: saved.id, revision: saved.revision } }, 0);
  const targetKey = `photo-post:${ws}:${saved.id}`;
  for (const target of [
    { ...Markdown.fromV2(saved).document, format: 'life-post-md-v2', futureField: 'must survive' },
    { ...structuredClone(saved), photos: [] },
  ]) {
    memory.rows.get('meta').set(JSON.stringify(targetKey), { key: targetKey, value: target });
    const before = structuredClone(memory.rows);
    await assert.rejects(storage.savePhotoPost(ws, { ...draft, status: 'saved' }, draft.revision),
      target.format === 'life-post-md-v2' ? { code: 'photo_post_update_required' } : { code: 'invalid_photo_post' });
    assert.deepEqual(memory.rows, before, 'unreadable target, original photo blobs, draft, summaries and bindings stay untouched');
    assert.deepEqual(await storage.readPhotoPost(ws, draft.id), draft);
  }
});

test('installing an exact Markdown series snapshot remaps embedded photo IDs and preserves saved body semantics', async t => {
  const { storage, ws, doc } = await fixture(t);
  doc.revision = 4;
  const series = Series.create(Core.id), item = Series.item(doc, Core.id);
  series.title = '기록 모음'; series.items = [item];
  const input = { series, posts: [{ itemId: item.id, doc }] }, before = structuredClone(input);
  const installed = await storage.installBlogSeriesCopy(ws, input);
  const reopened = await storage.readBlogSeriesSnapshot(ws, installed.seriesId);
  const copy = reopened.posts[0].doc;
  assert.equal(copy.format, 'life-post-md-v1');
  assert.notEqual(copy.id, doc.id);
  assert.notEqual(copy.photos[0].id, doc.photos[0].id);
  assert.equal(Photo.contentOps(copy).find(op => typeof op.insert !== 'string').insert.photo.id, copy.photos[0].id);
  assert.equal(Photo.plainText(copy), Photo.plainText(doc));
  assert.deepEqual(await copy.photos[0].blob.arrayBuffer(), await doc.photos[0].blob.arrayBuffer());
  assert.deepEqual(input, before);
});

test('receiving a Markdown post validates remapped photo identities against the exact server manifest', async t => {
  const { storage, ws, doc } = await fixture(t);
  const remote = Blog.pack({ ...doc, revision: 3 }), photoIds = new Map();
  const incoming = structuredClone(doc); incoming.id = Core.id();
  for (const photo of incoming.photos) { const fresh = Core.id(); photoIds.set(photo.id, fresh); photo.id = fresh; }
  Object.assign(incoming, Photo.remapBody(incoming, photoIds));
  const state = { enabled: true, remoteId: remote.id, remoteWorkspaceId: 'source-space', remoteRevision: 3, localRevision: 0,
    remoteManifest: remote, publication: null, pending: null, conflict: null, status: 'synced', error: null };
  const installed = await storage.installReceivedBlogPost(ws, incoming, state);
  assert.equal(installed.received, true);
  const saved = await storage.readPhotoPost(ws, installed.post.id);
  assert.equal(saved.format, 'life-post-md-v1');
  assert.equal(saved.markdown, incoming.markdown);
  assert.deepEqual(await saved.photos[0].blob.arrayBuffer(), await doc.photos[0].blob.arrayBuffer());
  const another = structuredClone(incoming); another.id = Core.id();
  assert.equal((await storage.installReceivedBlogPost(ws, another, state)).received, false);
  const corrupt = { ...incoming, id: Core.id(), markdown: '바뀐 본문\n' };
  await assert.rejects(storage.installReceivedBlogPost(ws, corrupt, state), { code: 'invalid_blog_state' });
  assert.equal((await storage.listPhotoPosts(ws)).length, 1);
});

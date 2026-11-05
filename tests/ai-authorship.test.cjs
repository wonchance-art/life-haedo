'use strict';
// Private AI authorship marks (2026-11-02, writing-ai-review 묶음 A): the Delta
// attribute author:"ai" on text only. Private paths (local document, post ZIP,
// BlogSync, full backup, preservation ZIP) keep it exactly; public copies never
// carry it. An older client that rejects the attribute must not delete or
// overwrite anything.
const test = require('node:test'), assert = require('node:assert/strict');
const { server, device, clock, png, copy, Core, Photo, Blog, Sync } = require('./helpers/blog-sync-cloud.cjs');

const MARKED = Object.freeze([
  { insert: '내가 쓴 앞 문장. ' },
  { insert: 'AI가 제안한 문장.', attributes: { author: 'ai' } },
  { insert: ' 굵은 AI 문장', attributes: { author: 'ai', bold: true } },
  { insert: ' 끝\n' },
]);
const hasMark = ops => ops.some(op => op.attributes && Object.hasOwn(op.attributes, 'author'));
function doc(ops = MARKED, extra = {}) {
  const value = Photo.create(Core.id, '2026-11-02T00:00:00.000Z');
  return Object.assign(value, { status: 'saved', title: '익명 AI 표시 글', ops: copy(ops) }, extra);
}
async function withPhoto(ops = MARKED) {
  const value = doc(), photo = await png(3);
  value.photos.push(photo);
  value.ops = [...copy(ops.slice(0, -1)), { insert: '\n' }, { insert: { photo: { id: photo.id, caption: '사진 설명', alt: '익명 풍경' } } }, { insert: '사진 뒤 문장', attributes: { author: 'ai' } }, { insert: '\n' }];
  return value;
}
const rejects = (value, pattern = /AI 글 표시|지원하지 않는/) => assert.throws(() => Photo.validate(value), pattern);

test('validation accepts author "ai" on text in v1 and v2, and rejects every other value or a photo embed', () => {
  Photo.validate(doc());
  const v1 = doc(); v1.format = 'life-photo-post-v1'; delete v1.attachments; delete v1.archived; Photo.validate(v1);
  Photo.validate(doc([{ insert: '줄\n', attributes: { author: 'ai' } }]));
  for (const value of ['human', 'AI', true, null, 1, { by: 'ai' }, ''])
    rejects(doc([{ insert: '글', attributes: { author: value } }, { insert: '\n' }]));
  rejects(doc([{ insert: '글', attributes: { author: 'ai', color: 'red' } }, { insert: '\n' }]), /지원하지 않는 서식/);
  const photo = doc(); photo.photos.push({ id: 'p1', name: 'a.png', type: 'image/png', width: 1, height: 1, size: 1, digest: 'a'.repeat(64), blob: new Blob(['x'], { type: 'image/png' }) });
  photo.ops = [{ insert: '앞\n' }, { insert: { photo: { id: 'p1', caption: '', alt: '' } }, attributes: { author: 'ai' } }, { insert: '\n' }];
  rejects(photo, /AI 글 표시/);
  photo.ops[1].attributes = { align: 'center' }; Photo.validate(photo);
});

test('a public snapshot drops only the mark, compacts equivalent runs, and rejects any mark it is given', async () => {
  const value = await withPhoto();
  Photo.validate(value);
  const before = copy({ ...value, photos: value.photos.map(Photo.metadata) });
  const snapshot = Blog.publicSnapshot(value, { photoIds: [value.photos[0].id] });
  assert.equal(hasMark(snapshot.ops), false);
  // D2 public projections normalize equal runs so equivalent v2/Markdown bodies
  // have identical wire bytes. Only grouping changes; the literal text and every
  // remaining style below are still checked, and private copies remain exact.
  assert.deepEqual(snapshot.ops.filter(op => typeof op.insert === 'string'), [
    { insert: '내가 쓴 앞 문장. AI가 제안한 문장.' }, { insert: ' 굵은 AI 문장', attributes: { bold: true } }, { insert: '\n' },
    { insert: '사진 뒤 문장\n' }]);
  assert.equal(snapshot.ops.map(op => typeof op.insert === 'string' ? op.insert : '').join(''), value.ops.map(op => typeof op.insert === 'string' ? op.insert : '').join(''));
  assert.deepEqual({ ...value, photos: value.photos.map(Photo.metadata) }, before, 'the private document is unchanged');
  assert.equal(hasMark(value.ops), true);
  const tampered = copy(snapshot); tampered.ops[1].attributes = { author: 'ai' };
  assert.throws(() => Blog.validateSnapshot(tampered), e => e.code === 'invalid_blog_snapshot');
  // Already canonical public runs keep the same keys and order.
  const plain = doc([{ insert: '굵은 글', attributes: { bold: true } }, { insert: '\n', attributes: { header: 2 } }]);
  assert.equal(JSON.stringify(Blog.publicSnapshot(plain).ops), JSON.stringify(plain.ops));
});

test('a private reading copy keeps the marks for the owner\'s own views only; public validation refuses it', async () => {
  const value = await withPhoto(), ids = [value.photos[0].id];
  const reading = Blog.privateReadingSnapshot(value, { photoIds: ids }), pub = Blog.publicSnapshot(value, { photoIds: ids });
  assert.equal(reading.format, 'life-blog-private-reading-v1');
  assert.deepEqual(reading.ops.filter(op => typeof op.insert === 'string'), value.ops.filter(op => typeof op.insert === 'string'), 'text and marks are copied exactly');
  assert.equal(hasMark(pub.ops), false, 'the public copy of the same post still carries no mark');
  // Same projection apart from the marks and the format: title, attachments and photo metadata agree.
  assert.deepEqual({ ...reading, format: null, ops: null, photos: reading.photos.map(({ id, ...rest }) => rest) }, { ...pub, format: null, ops: null, photos: pub.photos.map(({ id, ...rest }) => rest) });
  assert.throws(() => Blog.validateSnapshot(reading), e => e.code === 'invalid_blog_snapshot', 'a reading copy is never a valid public snapshot');
  assert.throws(() => Blog.validateReadingSnapshot(pub), e => e.code === 'invalid_blog_snapshot', 'the formats are not interchangeable');
  Blog.validateReadingSnapshot(reading);
  const bad = copy(reading); bad.ops[1].attributes = { author: 'human' };
  assert.throws(() => Blog.validateReadingSnapshot(bad), e => e.code === 'invalid_blog_snapshot', 'the reading copy still validates the marks');
});

test('a public series package is only ordered public post links: no body, ops or AI mark can enter it', () => {
  const Series = require('../assets/life/blog-series-public.js'), { randomUUID } = require('node:crypto');
  const tokens = [randomUUID(), randomUUID()], wrapper = Series.wrapper('익명 연재', '소개', tokens, 'https://example.org/life-haedo/');
  const keys = new Set(); JSON.stringify(wrapper, (key, value) => { keys.add(key); return value; });
  for (const key of ['ops', 'insert', 'attributes', 'author', 'photos', 'doc', 'body']) assert.equal(keys.has(key), false, key);
  assert.deepEqual(wrapper.entries.map(entry => entry.attachments.map(item => new URL(item.url).searchParams.get('post'))), tokens.map(t => [t]));
  assert.equal(Series.wrapper.length, 4, 'the wrapper takes a title, an introduction, tokens and a base URL only');
});

test('the post ZIP and Blog pack/hydrate keep every mark exactly', async () => {
  const value = await withPhoto();
  const restored = await Photo.readBackup(await Photo.backup(value), Core.id);
  assert.deepEqual(restored.ops.map(op => typeof op.insert === 'string' ? op : 'photo'), value.ops.map(op => typeof op.insert === 'string' ? op : 'photo'));
  const manifest = Blog.pack(value);
  assert.deepEqual(manifest.ops, value.ops);
  const hydrated = await Blog.hydrate(manifest, value.photos);
  assert.deepEqual(hydrated.ops, value.ops);
});

test('BlogSync carries the marks to the other device and back after an edit there', async () => {
  const cloud = server(), time = clock();
  const a = await device(cloud, 'mac', { time }), b = await device(cloud, 'ipad', { time });
  const saved = await a.storage.savePhotoPost(a.ws, await withPhoto(), 0);
  assert.equal((await a.sync.saveDefault(a.ws, saved.id, { expectedLocalRevision: saved.revision })).status, 'synced');
  assert.equal(hasMark(cloud.rows.get(saved.id).data.ops), true, 'the private server copy keeps the marks');
  await b.sync.syncNow();
  const received = await b.storage.readPhotoPost(b.ws, saved.id);
  assert.deepEqual(received.ops, saved.ops);
  // The iPad unmarks one run (the owner rewrote it); the Mac receives exactly that.
  const next = copy(received); next.ops[1] = { insert: 'AI가 제안한 문장.' }; next.updatedAt = '2026-11-02T00:10:00.000Z';
  const changed = await b.storage.savePhotoPost(b.ws, next, received.revision);
  await b.sync.syncNow(); time.advance(60000); await a.sync.syncNow();
  const back = await a.storage.readPhotoPost(a.ws, saved.id);
  assert.deepEqual(back.ops, changed.ops);
  assert.equal(back.ops.filter(op => op.attributes?.author === 'ai').length, 2);
});

test('an older client that rejects the mark keeps its own copies and deletes or overwrites nothing', async () => {
  const cloud = server(), time = clock();
  const a = await device(cloud, 'mac', { time }), old = await device(cloud, 'old-ipad', { time });
  // The previous PhotoPost validator: identical except that `author` is unknown.
  const oldReject = manifest => { if (hasMark(manifest.ops)) throw Object.assign(new Error('지원하지 않는 서식입니다.'), { code: 'invalid_photo_post' }); };
  const oldBlog = { ...Blog, validateManifest(m) { oldReject(m); return Blog.validateManifest(m); }, async hydrate(m, f) { oldReject(m); return Blog.hydrate(m, f); } };
  old.sync.dispose();
  old.sync = Sync.create({ storage: old.storage, auth: old.auth, blog: oldBlog, photoPost: Photo, remote: cloud.client('old-ipad'), makeId: Core.id, locks: null, now: () => time.now, timers: { setTimeout: () => 0, clearTimeout() {} }, interval: 30000 });
  // 1. A post the old device already has, then marked on the Mac.
  const first = await a.storage.savePhotoPost(a.ws, doc([{ insert: '처음에는 표시 없는 글\n' }]), 0);
  await a.sync.saveDefault(a.ws, first.id, { expectedLocalRevision: first.revision });
  await old.sync.syncNow();
  const oldCopy = await old.storage.readPhotoPost(old.ws, first.id);
  const marked = copy(first); marked.ops = [{ insert: '처음에는 표시 없는 글', attributes: { author: 'ai' } }, { insert: '\n' }]; marked.updatedAt = '2026-11-02T00:05:00.000Z';
  await a.storage.savePhotoPost(a.ws, marked, first.revision);
  await a.sync.syncNow();
  // 2. A new marked post the old device has never seen.
  const fresh = await a.storage.savePhotoPost(a.ws, doc(), 0);
  await a.sync.saveDefault(a.ws, fresh.id, { expectedLocalRevision: fresh.revision });
  const serverBefore = copy([...cloud.rows.values()].map(row => ({ id: row.id, revision: row.revision, data: row.data })));
  const deletes = cloud.stats.deletes.length, saves = cloud.stats.saves.length;
  time.advance(60000); await old.sync.syncNow();
  time.advance(60000); await old.sync.syncNow();
  assert.deepEqual(await old.storage.readPhotoPost(old.ws, first.id), oldCopy, 'the old device keeps its previous copy unchanged');
  assert.deepEqual((await old.storage.listPhotoPosts(old.ws)).map(row => row.id), [first.id], 'the unreadable new post is not installed, nothing is removed');
  assert.deepEqual(copy([...cloud.rows.values()].map(row => ({ id: row.id, revision: row.revision, data: row.data }))), serverBefore, 'the server copies are untouched');
  assert.equal(cloud.stats.deletes.length, deletes); assert.equal(cloud.stats.saves.length, saves, 'the old device sends nothing');
  assert.notEqual((await old.sync.syncNow()).state, 'synced', 'the old device reports that it could not receive');
  // After updating, the same device receives both exactly.
  old.sync.dispose();
  const updated = Sync.create({ storage: old.storage, auth: old.auth, blog: Blog, photoPost: Photo, remote: cloud.client('updated-ipad'), makeId: Core.id, locks: null, now: () => time.now, timers: { setTimeout: () => 0, clearTimeout() {} }, interval: 30000 });
  time.advance(10 * 60000); await updated.syncNow();
  assert.deepEqual((await old.storage.readPhotoPost(old.ws, first.id)).ops, marked.ops);
  assert.deepEqual((await old.storage.readPhotoPost(old.ws, fresh.id)).ops, fresh.ops);
  updated.dispose();
});

test('the full backup bundle and the preservation ZIP restore the marks exactly', async () => {
  const { memoryIdb, owner } = require('./helpers/blog-sync-cloud.cjs');
  const { createStorage } = require('../assets/life/storage.js');
  // The bundle writer reads every kind through these models (as tests/full-backup.test.cjs).
  for (const file of ['source-reference', 'source-folders', 'workbench', 'collection', 'nine-board', 'discovery-settings', 'blog-series', 'material-writing', 'writing', 'naver-media', 'original-attachments'])
    require('../assets/life/' + file + '.js');
  const Full = require('../assets/life/full-backup.js');
  const PlatformData = require('../assets/platform-data.js');
  const storage = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: owner });
  const ws = (await storage.createWorkspace('익명 공간')).workspaceId;
  const saved = await storage.savePhotoPost(ws, await withPhoto(), 0);
  const draft = await storage.savePhotoPost(ws, doc([{ insert: '초안의 AI 문장', attributes: { author: 'ai' } }, { insert: '\n' }], { status: 'draft' }), 0);
  const timeline = () => Full.timelineSnapshot({ platformData: PlatformData, localStorage: { getItem: () => null }, uid: owner.userId });
  const context = { storage, timeline, originals: null };
  const writer = Full.writer(await Full.plan(context), context, { appVersion: 'haedo-v175' });
  assert.deepEqual(await writer.collect(), []);
  const built = writer.finish({ partial: false });
  const target = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: { ...owner, userId: '99999999-2222-4333-8444-555555555555' } });
  const opened = await Full.open(new Blob([await built.blob.arrayBuffer()]));
  const report = await Full.restore(opened, { storage: target, kinds: new Set(['library', 'photoPosts']), verifyPhoto: null, originals: null, now: () => new Date(2026, 10, 2, 9) });
  assert.equal(report.items.filter(item => item.status === 'failed').length, 0, JSON.stringify(report.items));
  const restored = [];
  for (const space of await target.listWorkspaces()) for (const row of await target.listPhotoPosts(space.workspaceId)) restored.push(await target.readPhotoPost(space.workspaceId, row.id));
  const strings = value => value.ops.filter(op => typeof op.insert === 'string');
  assert.deepEqual(restored.map(strings).sort((x, y) => x.length - y.length), [strings(draft), strings(saved)]);

  const Preservation = require('../assets/life/preservation-package.js'), Refs = require('../assets/life/preservation-references.js');
  const bundle = Core.createWorkspace({ title: '익명 보존' });
  const input = await Refs.select({ bundle, posts: [{ doc: saved, evidence: { revision: 1, refs: [] } }], nineBoard: require('../assets/life/nine-board.js').empty(bundle.workspaceId) }, { postIds: [saved.id], boardIds: [] });
  const back = await Preservation.read(await Preservation.pack(input));
  assert.deepEqual(back.posts[0].doc.ops, saved.ops);
  assert.equal(hasMark(back.posts[0].doc.ops), true);
});

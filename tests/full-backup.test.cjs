'use strict';
// "모두 받기" bundle: one ZIP of the account's workspaces, each file in its
// existing format, restored only as new workspace copies.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { owner, memoryIdb, Core, Photo } = require('./helpers/blog-sync-cloud.cjs');
const { createStorage } = require('../assets/life/storage.js');
const Reference = require('../assets/life/source-reference.js');
const Folders = require('../assets/life/source-folders.js');
require('../assets/life/workbench.js');
const Collection = require('../assets/life/collection.js');
const Nine = require('../assets/life/nine-board.js');
const Settings = require('../assets/life/discovery-settings.js');
const Series = require('../assets/life/blog-series.js');
const Material = require('../assets/life/material-writing.js');
const Writing = require('../assets/life/writing.js');
const Media = require('../assets/life/naver-media.js');
const Originals = require('../assets/life/original-attachments.js');
const NaverFixture = require('./fixtures/naver-media.cjs');
const OriginalsFixture = require('./fixtures/original-attachments.cjs');
const PlatformData = require('../assets/platform-data.js');
const Z = require('../vendor/fflate/fflate.js');
const Full = require('../assets/life/full-backup.js');
const { createHash } = require('node:crypto');

const other = { projectUrl: owner.projectUrl, userId: '99999999-2222-4333-8444-555555555555' };
const hex = async blob => Buffer.from(await blob.arrayBuffer()).toString('hex');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const zipNames = async blob => {
  const bytes = Buffer.from(await blob.arrayBuffer()), names = [];
  let at = bytes.readUInt32LE(bytes.length - 6);
  while (bytes.readUInt32LE(at) === 0x02014b50) {
    const length = bytes.readUInt16LE(at + 28); names.push(bytes.subarray(at + 46, at + 46 + length).toString());
    at += 46 + length + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  return names;
};

async function heicPhoto() {
  const original = new Blob([Buffer.from('000000186674797068656963000000006d69663168656963', 'hex'), new Uint8Array([1, 2, 3, 250, 251])], { type: 'image/heic' });
  const view = new Blob([Uint8Array.from([255, 216, 255, 224, 9, 8, 7, 255, 217])], { type: 'image/jpeg' });
  return { id: Core.id(), name: 'IMG_0001.HEIC', type: 'image/heic', width: 4032, height: 3024, size: original.size, digest: await Photo.digest(original), blob: original,
    view: { type: 'image/jpeg', size: view.size, digest: await Photo.digest(view), width: 4032, height: 3024, blob: view } };
}
async function jpegPhoto() {
  const blob = new Blob([Uint8Array.from([255, 216, 255, 225, 0, 1, 2, 3, 4, 5, 255, 217])], { type: 'image/jpeg' });
  return { id: Core.id(), name: '익명 풍경.jpg', type: 'image/jpeg', width: 1200, height: 800, size: blob.size, digest: await Photo.digest(blob), blob };
}
function postDoc({ title, status, photos = [] }) {
  const doc = Photo.create(Core.id, '2026-11-01T09:00:00.000Z'); doc.status = status; doc.title = title; doc.ops = [{ insert: title + ' 본문 🌿\n' }];
  for (const photo of photos) { doc.photos.push(photo); doc.ops.push({ insert: { photo: { id: photo.id, caption: '설명', alt: '대체 텍스트' } } }, { insert: '\n' }); }
  return doc;
}
async function addSource(storage, workspaceId, title, text, extra = null) {
  let bundle = await storage.read(workspaceId);
  const prepared = await Core.prepareImport({ origin: 'obsidian', title, text, authorRelation: 'self' }, bundle);
  const changes = Core.buildImportChanges(bundle, prepared, [{ start: 0, end: 2, topic: '검증', note: '비공개 메모' }]);
  assert.equal((await storage.commitLocal({ workspaceId, operationId: Core.id(), baseRevision: bundle.revision, changes })).status, 'stored');
  if (extra) {
    bundle = await storage.read(workspaceId);
    const next = await Core.prepareImport({ origin: 'obsidian', title, text: extra, existingSourceId: prepared.source.id, authorRelation: 'self' }, bundle);
    assert.equal((await storage.commitLocal({ workspaceId, operationId: Core.id(), baseRevision: bundle.revision, changes: Core.buildImportChanges(bundle, next) })).status, 'stored');
  }
  return prepared;
}
// A stand-in for the account's originals service with the real part reader.
function fakeOriginals() {
  const rows = new Map(), tickets = new Map();
  return { rows,
    async list() { return [...rows.values()].map(row => ({ id: row.id, part: row.part.part, partCount: row.part.partCount, count: row.part.entries.length })); },
    async archive(id) { return { blob: rows.get(id).blob }; },
    async prepare(blob) { const part = await Originals.readPart(blob), ticket = { id: Core.id() }; tickets.set(ticket.id, { part, blob }); return { ticket, count: part.entries.length }; },
    async install(ticket) { const id = Core.id(); rows.set(id, { id, ...tickets.get(ticket.id) }); return { id }; } };
}

async function seed({ naver = false } = {}) {
  const memory = memoryIdb(), storage = createStorage({ idb: memory.idb, core: Core, channelFactory: null, account: owner });
  const first = (await storage.createWorkspace('첫 자료공간')).workspaceId;
  const second = (await storage.createWorkspace('두 번째 자료공간')).workspaceId;
  // An old exact version and a newer version of the same source.
  const old = await addSource(storage, first, '산책 원문', '옛 문장 그대로 남긴다.', '새로 고친 문장.');
  const bundle = await storage.read(first);
  const ref = await Reference.build({ bundle, sourceId: old.source.id, versionId: old.version.id, locator: { start: 0, end: 5 } });
  const wb = await storage.readWorkbench(first);
  wb.groups.push({ id: Core.id(), title: '묶음', versionIds: [old.version.id] });
  await storage.saveWorkbench(first, wb, wb.revision);
  let folders = Folders.createFolder(await storage.readSourceFolders(first), { name: '산책', parentId: null });
  folders = Folders.assignSources(folders, [old.source.id], folders.folders[0].id);
  await storage.saveSourceFolders(first, folders, folders.revision);
  const collection = await storage.readCollection(first);
  collection.items.push(Collection.fromAttachment({ type: 'book', title: '익명 책', creator: '익명', url: '' }, Core.id(), '2026-11-01T09:00:00.000Z'));
  await storage.saveCollection(first, collection, collection.revision);
  const board = Nine.create(Core.id); board.title = '아홉 칸'; board.areas[0].title = '영역';
  board.areas[0].items = [Nine.evidenceSnapshot({ kind: 'source', value: ref })]; board.areas[0].items[0].reason = '이유';
  await storage.saveNineBoard(first, { format: 'life-nine-board-v2', workspaceId: first, revision: 0, boards: [board] }, 0);
  const heic = await heicPhoto(), jpeg = await jpegPhoto();
  const saved = await storage.savePhotoPostWithEvidence(first, postDoc({ title: '저장한 사진 글', status: 'saved', photos: [heic, jpeg] }), 0, [ref], 0);
  // A blog series of one saved post, a writing preparation and an unsaved writing draft.
  const seriesPost = await storage.savePhotoPost(first, postDoc({ title: '연재 첫 글', status: 'saved' }), 0);
  const series = Series.create(Core.id); series.title = '익명 연재'; series.items = [Series.item(seriesPost, Core.id)];
  await storage.saveBlogSeries(first, { ...Series.empty(first), series: [series] }, 0);
  const plan = Material.create(Core.id, '2026-11-01T09:00:00.000Z'); plan.title = '준비한 글'; plan.question = '무엇을 남길까';
  const material = Material.material(await storage.read(first), old.source.id, old.version.id, Core.id); material.note = '자료 메모';
  plan.materials = [material];
  plan.blocks = [{ id: Core.id(), kind: 'paragraph', text: '개요 문단' }, { id: Core.id(), kind: 'quote', materialId: material.id, reference: ref }];
  await storage.saveMaterialWriting(first, { ...Material.empty(first), plans: [plan] }, 0);
  await storage.saveStage({ ...Writing.createDraft(await storage.read(first)), title: '쓰는 중', text: '아직 저장하지 않은 초안' });
  const draft = await storage.savePhotoPost(second, postDoc({ title: '두 번째 공간 초안', status: 'draft' }), 0);
  await addSource(storage, second, '두 번째 원문', '두 번째 공간의 원문.');
  const settings = await storage.readDiscoverySettings(first);
  await storage.saveDiscoverySettings(first, Settings.update(settings, { autoRefresh: true }, { expectedRevision: settings.revision }), settings.revision);
  let naverWs = null;
  if (naver) {
    const data = await NaverFixture.fixture(), complete = Core.applyChanges(data.bundle, data.changes);
    const copy = await Media.copy(await Media.read(await Media.pack({ bundle: complete, attachment: data.attachment })));
    naverWs = (await storage.installNaverCaptureCopy(copy)).bundle.workspaceId;
  }
  await storage.setActive(first);
  const originals = fakeOriginals(), part = OriginalsFixture.fixture();
  const prepared = await originals.prepare(new Blob([part.zip], { type: 'application/zip' })); await originals.install(prepared.ticket);
  return { memory, storage, first, second, old, ref, saved, draft, heic, jpeg, naverWs, originals, partZip: part.zip };
}
function fakeLocal(uid) {
  const data = new Map(), keys = PlatformData.keys(uid);
  data.set(keys.registry, JSON.stringify({ docs: [{ id: 'd_1', name: '내 연표', updated: '2026-11-01T00:00:00.000Z' }], current: 'd_1' }));
  data.set(keys.docs + 'd_1', JSON.stringify({ profile: { name: '내 연표', birth: '1990-01' }, events: [{ id: 'e1', date: '2000-01-01', title: '사건' }] }));
  data.set(keys.items, JSON.stringify([{ id: 'g1', kind: 'goal', data: { title: '목표' } }, { id: 'h1', kind: 'habit', data: { title: '습관' } }]));
  return { getItem: key => data.has(key) ? data.get(key) : null };
}
function memoryLocal() { const data = new Map(); return { getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, String(value)) }; }
async function fullBundle(storage, { originals = null, limit, partial = false } = {}) {
  const timeline = () => Full.timelineSnapshot({ platformData: PlatformData, localStorage: fakeLocal(owner.userId), uid: owner.userId });
  const context = { storage, timeline, originals };
  const planned = await Full.plan(context);
  const writer = Full.writer(planned, context, { appVersion: 'haedo-v171', ...(limit ? { limit } : {}) });
  const failed = await writer.collect();
  return { planned, writer, failed, built: failed.length && !partial ? null : writer.finish({ partial }) };
}
async function snapshotAll(storage) {
  const rows = [];
  for (const ws of await storage.listWorkspaces()) {
    const posts = [];
    for (const row of await storage.listPhotoPosts(ws.workspaceId)) {
      const doc = await storage.readPhotoPost(ws.workspaceId, row.id);
      posts.push({ ...doc, photos: await Promise.all(doc.photos.map(async p => ({ ...p, blob: await hex(p.blob), view: p.view ? { ...p.view, blob: await hex(p.view.blob) } : undefined }))) });
    }
    rows.push({ ws, bundle: await storage.read(ws.workspaceId), workbench: await storage.readWorkbench(ws.workspaceId), collection: await storage.readCollection(ws.workspaceId),
      nine: await storage.readNineBoard(ws.workspaceId), series: await storage.readBlogSeries(ws.workspaceId), material: await storage.readMaterialWriting(ws.workspaceId), posts });
  }
  return JSON.stringify(rows);
}
const RESTORABLE = new Set(['library', 'collection', 'photoPosts', 'nineBoards', 'blogSeries', 'materialWriting', 'naverCaptures', 'accountDocuments', 'originals']);

test('v1 글의 전체 백업과 단독 ZIP은 원본을 보존하며 v2 새 사본으로 복원된다', async () => {
  const storage = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: owner });
  const ws = (await storage.createWorkspace('v1 기록')).workspaceId;
  const photo = await jpegPhoto(), legacy = postDoc({ title: '옛 형식 글', status: 'saved', photos: [photo] });
  legacy.format = 'life-photo-post-v1'; delete legacy.attachments; delete legacy.archived;
  await storage.savePhotoPost(ws, legacy, 0);
  const original = await storage.readPhotoPost(ws, legacy.id), before = await snapshotAll(storage);
  const { built, failed } = await fullBundle(storage);
  assert.deepEqual(failed, []);
  const entry = built.manifest.files.find(file => file.postId === legacy.id);
  assert.equal(entry.format, 'life-photo-post-backup-v1');
  for (const [blob, status] of [[built.blob, 'saved'], [await Photo.backup(original), 'draft']]) {
    const opened = await Full.open(blob);
    const target = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: other });
    const report = await Full.restore(opened, { storage: target, kinds: new Set(['photoPosts']), verifyPhoto: null });
    assert.equal(report.items.length, 1); assert.equal(report.items[0].status, 'restored');
    const spaces = await target.listWorkspaces(), rows = await target.listPhotoPosts(spaces[0].workspaceId);
    assert.equal(rows.length, 1);
    const restored = await target.readPhotoPost(spaces[0].workspaceId, rows[0].id);
    assert.equal(restored.format, 'life-photo-post-v2'); assert.equal(restored.status, status);
    assert.notEqual(restored.id, original.id);
    const remapped = Photo.remapBody(restored, new Map([[restored.photos[0].id, original.photos[0].id]]));
    assert.deepEqual(remapped.ops, original.ops);
    assert.equal(await hex(restored.photos[0].blob), await hex(original.photos[0].blob));
  }
  assert.equal(await snapshotAll(storage), before);
});

test('비Markdown ZIP에 Markdown 라벨을 붙인 전체 백업은 글을 저장하지 않는다', async () => {
  const storage = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: owner });
  const ws = (await storage.createWorkspace('기존 형식 기록')).workspaceId;
  const legacy = postDoc({ title: '바뀌지 않을 기존 글', status: 'saved', photos: [await jpegPhoto()] });
  await storage.savePhotoPost(ws, legacy, 0);
  const before = await snapshotAll(storage), { built, failed } = await fullBundle(storage);
  assert.deepEqual(failed, []);
  const files = Z.unzipSync(new Uint8Array(await built.blob.arrayBuffer()));
  const manifest = structuredClone(built.manifest), entry = manifest.files.find(file => file.postId === legacy.id);
  assert.equal(entry.format, 'life-photo-post-backup-v2');
  entry.format = 'life-post-md-backup-v1'; entry.formatVersion = 1;
  files['manifest.json'] = Z.strToU8(JSON.stringify(manifest));
  const opened = await Full.open(new Blob([Z.zipSync(files, { level: 0 })]));
  const target = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: other });
  const report = await Full.restore(opened, { storage: target, kinds: new Set(['photoPosts']), verifyPhoto: null });
  assert.equal(report.items.length, 1);
  assert.equal(report.items[0].status, 'failed'); assert.match(report.items[0].message, /문서 형식/);
  for (const space of await target.listWorkspaces()) assert.deepEqual(await target.listPhotoPosts(space.workspaceId), []);
  assert.equal(await snapshotAll(storage), before);
});

test('Markdown 글: 전체 ZIP과 단독 ZIP에서 새 사본으로 복원하고 사진 바이트·AI 표시·숨김 상태를 보존한다', async () => {
  const Markdown = require('../assets/life/post-markdown.js');
  const { storage, first, saved } = await seed();
  const source = await storage.readPhotoPost(first, saved.id);
  source.ops.unshift({ insert: 'AI 문장', attributes: { author: 'ai', bold: true } }, { insert: '\n' });
  const converted = Markdown.fromV2(source).document;
  converted.archived = true;
  const result = await storage.savePhotoPost(first, converted, source.revision);
  assert.equal(result.status, 'saved');
  const original = await storage.readPhotoPost(first, source.id);
  const before = await snapshotAll(storage);
  const { built, failed } = await fullBundle(storage);
  assert.deepEqual(failed, []);
  const entry = built.manifest.files.find(file => file.postId === source.id);
  assert.equal(entry.format, 'life-post-md-backup-v1');
  assert.equal(entry.formatVersion, 1);
  const files = Z.unzipSync(new Uint8Array(await built.blob.arrayBuffer()));
  const standalone = await Full.open(new Blob([files[entry.path]], { type: 'application/zip' }));
  assert.equal(standalone.entries[0].kind, 'photoPosts');
  assert.equal(standalone.entries[0].format, 'life-post-md-backup-v1');
  const opened = await Full.open(built.blob);
  const target = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: other });
  const report = await Full.restore(opened, { storage: target, kinds: new Set(['photoPosts']), verifyPhoto: null });
  assert.deepEqual(report.items.filter(item => item.status !== 'restored'), []);
  const restored = [];
  for (const ws of await target.listWorkspaces()) for (const row of await target.listPhotoPosts(ws.workspaceId)) {
    const doc = await target.readPhotoPost(ws.workspaceId, row.id);
    if (doc.format === 'life-post-md-v1') restored.push(doc);
  }
  assert.equal(restored.length, 1);
  const copy = restored[0];
  assert.equal(copy.status, 'saved'); assert.equal(copy.archived, true);
  assert.notEqual(copy.id, original.id); assert.equal(Object.hasOwn(copy, 'ops'), false);
  const ids = new Map(copy.photos.map((photo, index) => [photo.id, original.photos[index].id]));
  assert.equal(Markdown.remapPhotos(copy.markdown, ids), original.markdown);
  assert.match(copy.markdown, /data-author="ai"/);
  for (let i = 0; i < copy.photos.length; i++) {
    assert.notEqual(copy.photos[i].id, original.photos[i].id);
    assert.equal(await hex(copy.photos[i].blob), await hex(original.photos[i].blob));
    if (copy.photos[i].view) assert.equal(await hex(copy.photos[i].view.blob), await hex(original.photos[i].view.blob));
  }
  assert.equal(await snapshotAll(storage), before, '원래 계정의 글·사진·판은 변하지 않는다');
  const mislabeled = structuredClone(built.manifest);
  mislabeled.files.find(file => file.postId === source.id).format = 'life-photo-post-backup-v2';
  mislabeled.files.find(file => file.postId === source.id).formatVersion = 2;
  files['manifest.json'] = Z.strToU8(JSON.stringify(mislabeled));
  const tampered = await Full.open(new Blob([Z.zipSync(files, { level: 0 })]));
  const rejectedTarget = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: other });
  const rejected = await Full.restore(tampered, { storage: rejectedTarget, kinds: new Set(['photoPosts']), verifyPhoto: null });
  assert.ok(rejected.items.some(item => item.kind === 'photoPosts' && item.status === 'failed' && /文書|문서 형식/.test(item.message)));
  for (const ws of await rejectedTarget.listWorkspaces()) for (const row of await rejectedTarget.listPhotoPosts(ws.workspaceId))
    assert.notEqual(row.title, original.title, '형식이 어긋난 글은 저장하지 않는다');
});

test('모두 받기: every account workspace and kind in one ZIP, existing formats, lists written last with hashes and what is not included', async t => {
  const restore = NaverFixture.installDecoder(); t.after(restore);
  const seeded = await seed({ naver: true });
  const { built } = await fullBundle(seeded.storage, { originals: seeded.originals });
  assert.equal(built.manifest.format, 'haedo-full-backup-v1'); assert.equal(built.manifest.version, 2);
  assert.equal(built.manifest.complete, true); assert.equal(built.manifest.appVersion, 'haedo-v171');
  assert.match(built.fileName, /^haedo-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  // Single pass: manifest/README are the last entries, after every data file.
  const names = await zipNames(built.blob);
  assert.deepEqual(names.slice(-2), ['README.txt', 'manifest.json']);
  const files = Z.unzipSync(new Uint8Array(await built.blob.arrayBuffer()));
  assert.deepEqual(Object.keys(files).sort(), ['README.txt', 'manifest.json', ...built.manifest.files.map(file => file.path)].sort());
  assert.equal(built.manifest.workspaces.length, 3);
  for (const file of built.manifest.files) {
    assert.equal(sha(files[file.path]), file.sha256, file.path); assert.equal(files[file.path].byteLength, file.bytes);
    assert.ok(Number.isSafeInteger(file.formatVersion) && file.formatVersion >= 1);
  }
  const byKind = kind => built.manifest.files.filter(file => file.kind === kind);
  // Existing formats unchanged, compact JSON: each restores through its own module.
  const library = JSON.parse(Buffer.from(files['workspaces/01/library.json']).toString());
  assert.equal(library.format, Folders.BACKUP_FORMAT); assert.equal(Buffer.from(files['workspaces/01/library.json']).includes('\n  '), false);
  assert.equal((await Folders.restoreBackup(library)).bundle.sourceVersions.length, 2);
  assert.equal(byKind('library')[1].format, 'life-workbench-backup-v1'); // no folders: the same choice as the 자료·구성 screen
  assert.equal(JSON.parse(Buffer.from(files['workspaces/01/nine-boards.json']).toString()).format, 'life-nine-board-backup-v2');
  assert.equal(byKind('photoPosts').length, 3);
  const postFile = byKind('photoPosts').find(file => file.postId === seeded.saved.id);
  assert.equal(postFile.status, 'saved'); assert.deepEqual(postFile.counts, { posts: 1, photos: 2, views: 1, attachments: 0 });
  const inner = Z.unzipSync(files[postFile.path]);
  assert.equal(Buffer.from(inner['photos/' + seeded.heic.id]).toString('hex'), await hex(seeded.heic.blob));
  assert.equal(Buffer.from(inner['views/' + seeded.heic.id]).toString('hex'), await hex(seeded.heic.view.blob));
  // M1: blog series, preparation, Naver capture and original parts in their existing formats.
  const [series] = byKind('blogSeries'); assert.equal(series.format, 'life-blog-series-package-v1'); assert.deepEqual(series.counts, { series: 1, seriesPosts: 1, photos: 0 });
  assert.match(series.path, /^workspaces\/01\/blog-series\/[A-Za-z0-9_-]+\.zip$/);
  const [material] = byKind('materialWriting').filter(file => file.workspace === 1);
  assert.equal(material.format, 'life-material-writing-v1'); assert.deepEqual(material.counts, { plans: 1 });
  const [capture] = byKind('naverCaptures'); assert.equal(capture.format, 'haedo.naver.capture.v1'); assert.deepEqual(capture.counts, { captures: 1, photos: 1 });
  assert.equal((await Media.read(new Blob([files[capture.path]]))).attachment.photos.length, 1);
  const [part] = byKind('originals'); assert.equal(part.format, 'haedo-private-originals-part-v1'); assert.equal(sha(files[part.path]), sha(seeded.partZip));
  const docs = JSON.parse(Buffer.from(files['account-documents.json']).toString());
  assert.equal(docs.format, 'haedo-account-documents-v1');
  assert.ok(docs.documents.some(doc => doc.prefix === 'discoverySettings' && doc.value.autoRefresh === true));
  assert.ok(docs.documents.some(doc => doc.prefix === 'post-evidence' && doc.postId === seeded.saved.id));
  assert.ok(!JSON.stringify(docs).includes(owner.userId), 'account keys are not written into the file');
  const timeline = JSON.parse(Buffer.from(files['timeline-goals-habits.json']).toString());
  assert.equal(timeline.format, 'haedo-platform-backup-v1'); assert.deepEqual(byKind('timeline')[0].counts, { timelines: 1, goals: 1, habits: 1 });
  // Kinds without a format are listed, with the draft count; nothing claims "all".
  const excluded = Object.fromEntries(built.manifest.notIncluded.map(row => [row.kind, row]));
  assert.deepEqual(Object.keys(excluded).sort(), ['importDrafts', 'originalsServer', 'publication', 'sourceEditDrafts', 'writingDrafts']);
  assert.match(excluded.originalsServer.reason, /서버에만 있는 파트는 확인하지 않았습니다/);
  assert.equal(excluded.writingDrafts.count, 1); assert.ok(excluded.writingDrafts.whereToSave);
  const readme = Buffer.from(files['README.txt']).toString();
  assert.match(readme, /하나의 형식이 아닙니다/); assert.match(readme, /담지 않은 것/); assert.match(readme, /글쓰기 초안 1개/);
  assert.doesNotMatch(readme, /모든 항목/);
  for (const file of built.manifest.files) assert.ok(readme.includes(file.sha256));
  // Without an originals service the kind is listed as not included, not silently absent.
  const withoutOriginals = await fullBundle(seeded.storage);
  assert.ok(withoutOriginals.built.manifest.notIncluded.some(row => row.kind === 'originals'));
  assert.equal(withoutOriginals.built.manifest.files.some(file => file.kind === 'originals'), false);
});

test('restore into another account: new copies only, exact versions, byte-identical HEIC/JPEG, every kind; existing data untouched', async t => {
  const decoder = NaverFixture.installDecoder(); t.after(decoder);
  const seeded = await seed({ naver: true });
  const { built } = await fullBundle(seeded.storage, { originals: seeded.originals });
  const memory = memoryIdb(), target = createStorage({ idb: memory.idb, core: Core, channelFactory: null, account: other });
  const existing = (await target.createWorkspace('원래 있던 공간')).workspaceId;
  await addSource(target, existing, '원래 원문', '그대로 있어야 하는 원문.');
  const before = await snapshotAll(target), originals = fakeOriginals();
  const opened = await Full.open(new Blob([await built.blob.arrayBuffer()]));
  assert.equal(opened.type, 'bundle'); assert.match(opened.fingerprint, /^[0-9a-f]{64}$/);
  const summary = Full.summarize(opened);
  assert.deepEqual(summary.map(row => row.kind), ['library', 'collection', 'photoPosts', 'nineBoards', 'blogSeries', 'materialWriting', 'naverCaptures', 'accountDocuments', 'originals', 'timeline']);
  assert.equal(summary.find(row => row.kind === 'timeline').restorable, false);
  const report = await Full.restore(opened, { storage: target, kinds: RESTORABLE, verifyPhoto: null, originals, now: () => new Date(2026, 10, 2, 9) });
  assert.equal(report.items.filter(item => item.status !== 'restored').length, 0, JSON.stringify(report.items.filter(item => item.status !== 'restored')));
  assert.equal(await target.getActive(), existing, 'the workspace in use stays active');
  const after = JSON.parse(await snapshotAll(target)), old = JSON.parse(before)[0];
  assert.deepEqual(after.find(row => row.ws.workspaceId === existing), old, 'existing workspace unchanged');
  // One copy per original workspace; the capture joins its library copy instead of making another workspace.
  assert.equal(after.length, 4); assert.equal(report.extraCopies.length, 0);
  // Copies carry the restore date in their name and a restored-copy marker naming the original.
  const copy = after.find(row => row.ws.title === '첫 자료공간 (11-02 복원)');
  assert.ok(copy && copy.ws.workspaceId !== seeded.first);
  const libraries = await target.listAccountLibraries();
  assert.deepEqual(libraries.find(row => row.workspaceId === copy.ws.workspaceId).restoredCopy, { sourceWorkspaceId: seeded.first, restoredAt: new Date(2026, 10, 2, 9).toISOString() });
  assert.equal(Object.hasOwn(libraries.find(row => row.workspaceId === existing), 'restoredCopy'), false);
  const source = await seeded.storage.read(seeded.first);
  assert.deepEqual(copy.bundle.sourceVersions.map(v => [v.contentHash, v.contentText]), source.sourceVersions.map(v => [v.contentHash, v.contentText]));
  const oldCopy = copy.bundle.sourceVersions.find(v => v.contentText === '옛 문장 그대로 남긴다.');
  assert.deepEqual(copy.workbench.groups[0].versionIds, [oldCopy.id], 'composition keeps the exact old version');
  assert.equal(copy.collection.items.length, 1);
  const refItem = copy.nine.boards[0].areas[0].items[0].reference.value;
  assert.equal(refItem.sourceVersionId, oldCopy.id); assert.equal(refItem.workspaceId, copy.ws.workspaceId);
  const post = copy.posts.find(row => row.title === '저장한 사진 글');
  assert.equal(post.status, 'saved'); assert.notEqual(post.id, seeded.saved.id);
  assert.equal(post.photos[0].blob, await hex(seeded.heic.blob)); assert.equal(post.photos[0].type, 'image/heic');
  assert.equal(post.photos[0].view.blob, await hex(seeded.heic.view.blob));
  assert.equal(post.photos[1].blob, await hex(seeded.jpeg.blob));
  const evidence = await target.readPostEvidence(copy.ws.workspaceId, post.id);
  assert.equal(evidence.refs[0].sourceVersionId, oldCopy.id); assert.equal(evidence.refs[0].quote, seeded.ref.quote);
  assert.equal((await target.readDiscoverySettings(copy.ws.workspaceId)).autoRefresh, true);
  // M1 kinds restored through their existing install functions.
  assert.equal(copy.series.series.length, 1); assert.equal(copy.series.series[0].title, '익명 연재');
  assert.equal(copy.material.plans.length, 1); assert.equal(copy.material.plans[0].output, null);
  assert.equal(copy.material.plans[0].materials[0].sourceVersionId, oldCopy.id);
  const captureCopy = after.find(row => row.bundle.sources.some(source => source.origin === 'naver_blog'));
  assert.equal(captureCopy.bundle.sources.length, 1);
  const restoredCapture = await target.readNaverCapture(captureCopy.ws.workspaceId, captureCopy.bundle.sourceVersions[0].id);
  assert.equal(sha(Buffer.from(await restoredCapture.photos[0].blob.arrayBuffer())), sha(NaverFixture.bytes));
  assert.equal(originals.rows.size, 1); assert.equal(sha(Buffer.from(await [...originals.rows.values()][0].blob.arrayBuffer())), sha(seeded.partZip));
  const second = after.find(row => row.ws.title === '두 번째 자료공간 (11-02 복원)');
  assert.equal(second.posts[0].status, 'draft'); assert.equal(second.bundle.sources.length, 1);
  assert.equal((await seeded.storage.listWorkspaces()).length, 3, 'the source account is untouched');
});

test('first-version bundles (manifest first, no notIncluded) still open and restore', async () => {
  const blob = new Blob([fs.readFileSync(path.join(__dirname, 'fixtures/full-backup/first-version-bundle.zip'))]);
  const names = await zipNames(blob); assert.deepEqual(names.slice(0, 2), ['README.txt', 'manifest.json']);
  const opened = await Full.open(blob);
  assert.equal(opened.manifest.version, 1); assert.equal(opened.workspaces.length, 2);
  const target = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: other });
  const report = await Full.restore(opened, { storage: target, kinds: RESTORABLE, verifyPhoto: null });
  assert.deepEqual(report.items.filter(item => item.status !== 'restored'), []);
  const workspaces = await target.listWorkspaces();
  assert.equal(workspaces.length, 2); // two new copies
  const withPhotos = [];
  for (const ws of workspaces) for (const row of await target.listPhotoPosts(ws.workspaceId)) withPhotos.push(await target.readPhotoPost(ws.workspaceId, row.id));
  assert.equal(withPhotos.find(doc => doc.title === '저장한 사진 글').photos[0].type, 'image/heic');
});

test('tampered, unknown-version and oversized files are rejected before anything is written', async () => {
  const { storage } = await seed();
  const { built } = await fullBundle(storage);
  const files = Z.unzipSync(new Uint8Array(await built.blob.arrayBuffer()));
  const path0 = built.manifest.files.find(file => file.kind === 'photoPosts').path;
  const changed = { ...files, [path0]: Uint8Array.from(files[path0], (byte, i) => i === 40 ? byte ^ 1 : byte) };
  await assert.rejects(Full.open(new Blob([Z.zipSync(changed, { level: 0 })])), error => error.code === 'tampered');
  await assert.rejects(Full.open(new Blob([Z.zipSync({ ...files, 'extra.txt': new Uint8Array([1]) }, { level: 0 })])), error => error.code === 'tampered');
  const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
  const future = { ...files, 'manifest.json': Z.strToU8(JSON.stringify({ ...manifest, format: 'haedo-full-backup-v2', version: 3 })) };
  await assert.rejects(Full.open(new Blob([Z.zipSync(future, { level: 0 })])), error => error.code === 'unsupported_version');
  const sameName = { ...files, 'manifest.json': Z.strToU8(JSON.stringify({ ...manifest, version: 3 })) };
  await assert.rejects(Full.open(new Blob([Z.zipSync(sameName, { level: 0 })])), error => error.code === 'unsupported_version');
  // Claiming completeness while a read failed is rejected.
  const lying = { ...files, 'manifest.json': Z.strToU8(JSON.stringify({ ...manifest, missing: [{ kind: 'photoPosts', workspace: 1, reason: 'read_failed', error: 'x' }] })) };
  await assert.rejects(Full.open(new Blob([Z.zipSync(lying, { level: 0 })])), error => error.code === 'invalid_backup');
  await assert.rejects(Full.open(new Blob([Z.zipSync(files, { level: 6 })])), error => error.code === 'invalid_zip');
  const huge = { size: Full.LIMITS.bundle + 1, slice: () => new Blob([Uint8Array.from([80, 75, 3, 4])]) };
  await assert.rejects(Full.open(huge), error => error.code === 'backup_too_large');
  await assert.rejects(Full.open(new Blob([JSON.stringify({ format: 'something-else' })])), error => error.code === 'unsupported_backup');
});

test('size limit: the writer measures the whole file the reader measures, so any ZIP it makes can be opened', async () => {
  const { storage } = await seed();
  const full = await fullBundle(storage);
  const exact = full.built.blob.size;
  // A limit exactly at the produced size succeeds and the reader accepts the file at that limit.
  const fits = await fullBundle(storage, { limit: exact + 64 });
  assert.ok(fits.built.blob.size <= exact + 64);
  assert.equal((await Full.open(fits.built.blob, { limit: fits.built.blob.size })).type, 'bundle');
  await assert.rejects(Full.open(fits.built.blob, { limit: fits.built.blob.size - 1 }), error => error.code === 'backup_too_large');
  // Below the size the writer refuses before producing a file the reader would refuse.
  await assert.rejects(fullBundle(storage, { limit: exact - 200 }), error => error.code === 'backup_too_large');
});

test('partial failure keeps the ZIP open: retry reads and appends only the failed part; or a labelled partial ZIP', async () => {
  const { storage, saved } = await seed();
  let fail = true, reads = 0;
  const flaky = Object.create(storage, { readPhotoPost: { value: async (...args) => { reads++; if (fail && args[1] === saved.id) throw new Error('합성 읽기 실패'); return storage.readPhotoPost(...args); } } });
  const timeline = () => Full.timelineSnapshot({ platformData: PlatformData, localStorage: fakeLocal(owner.userId), uid: owner.userId });
  const context = { storage: flaky, timeline };
  const planned = await Full.plan(context);
  const writer = Full.writer(planned, context);
  const failed = await writer.collect();
  assert.deepEqual(failed.map(task => task.postId), [saved.id]);
  // Results keep only metadata: no Blob of any item stays referenced.
  for (const result of writer.results.values()) assert.equal(Object.values(result).some(value => value instanceof Blob), false);
  assert.throws(() => writer.finish(), error => error.code === 'backup_incomplete');
  fail = false; reads = 0;
  assert.deepEqual(await writer.collect({ only: new Set(failed.map(task => task.id)) }), []);
  assert.equal(reads, 1, 'retry reads only the failed item');
  const complete = writer.finish();
  assert.equal(complete.manifest.complete, true);
  const names = await zipNames(complete.blob);
  assert.equal(names.at(-3), failed[0].path, 'the retried item is appended before the lists');
  assert.ok((await Full.open(complete.blob)).entries.some(entry => entry.postId === saved.id));
  // A second run that stays failed finishes as an explicit partial ZIP.
  fail = true;
  const again = Full.writer(planned, context); await again.collect();
  const partial = again.finish({ partial: true });
  assert.equal(partial.manifest.complete, false); assert.match(partial.fileName, /-partial\.zip$/);
  assert.equal(partial.manifest.missing[0].postId, saved.id); assert.equal(partial.manifest.missing[0].reason, 'read_failed');
  const files = Z.unzipSync(new Uint8Array(await partial.blob.arrayBuffer()));
  assert.match(Buffer.from(files['README.txt']).toString(), /\[읽기 실패\]/);
  assert.equal((await Full.open(partial.blob)).manifest.complete, false);
});

test('skipped items are recorded in missing: a post ID outside the path rule and account documents of unlisted workspaces', async () => {
  const { storage, second } = await seed();
  const odd = Object.create(storage, {
    listPhotoPosts: { value: async workspaceId => (await storage.listPhotoPosts(workspaceId)).concat(workspaceId === second ? [] : [{ id: '경로에 못 쓰는 id', title: '이상한 글', status: 'saved' }]) },
    listAccountLibraries: { value: async () => (await storage.listAccountLibraries()).filter(row => row.workspaceId !== second) }
  });
  const timeline = () => Full.timelineSnapshot({ platformData: PlatformData, localStorage: fakeLocal(owner.userId), uid: owner.userId });
  // The second workspace has account documents (a reading of its settings).
  const s2 = await storage.readDiscoverySettings(second);
  await storage.saveDiscoverySettings(second, Settings.update(s2, { autoRefresh: true }, { expectedRevision: s2.revision }), s2.revision);
  const context = { storage: odd, timeline }, planned = await Full.plan(context), writer = Full.writer(planned, context);
  assert.deepEqual(await writer.collect(), []);
  const built = writer.finish();
  assert.equal(built.manifest.complete, true, 'skipped items are not read failures');
  const skipped = built.manifest.missing.filter(row => row.reason === 'skipped');
  assert.deepEqual(skipped.map(row => row.kind).sort(), ['accountDocuments', 'photoPosts']);
  assert.match(skipped.find(row => row.kind === 'photoPosts').error, /경로 규칙/);
  assert.match(skipped.find(row => row.kind === 'accountDocuments').error, /문서 1개/);
  const readme = Buffer.from(Z.unzipSync(new Uint8Array(await built.blob.arrayBuffer()))['README.txt']).toString();
  assert.match(readme, /\[담지 않음\]/);
  assert.equal((await Full.open(built.blob)).manifest.missing.length, 2);
});

test('a nine-slot board restored without its library drops evidence that points at the old sources, and says so', async () => {
  const { storage } = await seed();
  const { built } = await fullBundle(storage);
  const target = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: other });
  const opened = await Full.open(built.blob);
  const report = await Full.restore(opened, { storage: target, kinds: new Set(['nineBoards', 'photoPosts']), verifyPhoto: null });
  const nine = report.items.find(item => item.kind === 'nineBoards' && item.workspace === 1);
  assert.equal(nine.status, 'restored'); assert.match(nine.message, /근거 1개는 연결하지 않았습니다/);
  const board = (await target.readNineBoard(nine.targetId)).boards[0];
  assert.equal(Object.hasOwn(board.areas[0].items[0], 'reference'), false);
  assert.equal(board.areas[0].items[0].reason, '이유'); assert.equal(board.title, '아홉 칸');
  const post = report.items.find(item => item.kind === 'photoPosts' && item.title === '저장한 사진 글');
  assert.match(post.message, /인용 근거 1개를 연결하지 않았습니다/);
  // The preparation needs its exact sources and is skipped, not half-restored.
  const prep = await Full.restore(opened, { storage: target, kinds: new Set(['materialWriting']), verifyPhoto: null });
  assert.equal(prep.items.find(item => item.workspace === 1).status, 'skipped');
});

test('restore receipts: this account remembers a restored backup by its manifest hash', async () => {
  const { storage } = await seed();
  const { built } = await fullBundle(storage);
  const target = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: other });
  const local = memoryLocal(), book = Full.receipts(target, local);
  const first = await Full.open(built.blob), again = await Full.open(new Blob([await built.blob.arrayBuffer()]));
  assert.equal(first.fingerprint, again.fingerprint);
  assert.equal(book.find(first.fingerprint), null);
  book.record({ fingerprint: first.fingerprint, createdAt: first.manifest.createdAt, copies: 2 });
  const seen = book.find(again.fingerprint);
  assert.equal(seen.createdAt, first.manifest.createdAt); assert.equal(seen.copies, 2); assert.ok(Date.parse(seen.restoredAt));
  // Scoped to the account.
  assert.equal(Full.receipts(storage, local).find(first.fingerprint), null);
});

test('single existing files open with their format and restore as new copies; partly rejected documents stay retryable', async () => {
  const { storage, first, saved } = await seed();
  const snapshot = await storage.readLibraryBackupSnapshot(first);
  const opened = await Full.open(new Blob([JSON.stringify(Folders.makeBackup(snapshot.bundle, snapshot.workbench, snapshot.sourceFolders))]));
  assert.equal(opened.type, 'single'); assert.equal(opened.entries[0].kind, 'library'); assert.equal(opened.workspaces[0].title, '첫 자료공간');
  const photo = await Full.open(await Photo.backup(await storage.readPhotoPost(first, saved.id)));
  assert.equal(photo.entries[0].kind, 'photoPosts'); assert.equal(photo.entries[0].counts.views, 1); assert.match(photo.fingerprint, /^[0-9a-f]{64}$/);
  const transfer = await Full.open(new Blob([JSON.stringify(Core.makeBackup(snapshot.bundle))]));
  assert.equal(transfer.entries[0].format, 'life-tools-backup-v1');
  const series = (await storage.readBlogSeries(first)).series[0];
  const seriesFile = await Full.open(await require('../assets/life/blog-series-package.js').pack(await storage.readBlogSeriesSnapshot(first, series.id)));
  assert.equal(seriesFile.entries[0].kind, 'blogSeries');
  const timeline = await Full.open(new Blob([JSON.stringify({ format: 'haedo-platform-backup-v1', exportedAt: '2026-11-01T00:00:00.000Z', docs: [], items: [] })]));
  assert.equal(timeline.type, 'external'); assert.equal(timeline.kind, 'timeline');
  const target = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: other });
  const kept = (await target.createWorkspace('기존')).workspaceId;
  const report = await Full.restore(photo, { storage: target, kinds: new Set(['photoPosts']), verifyPhoto: null });
  assert.equal(report.items[0].status, 'restored');
  const copies = (await target.listWorkspaces()).filter(row => row.workspaceId !== kept);
  assert.equal(copies.length, 1);
  const [restoredPost] = await target.listPhotoPosts(copies[0].workspaceId);
  assert.equal(restoredPost.status, 'draft', 'a bare photo ZIP restores as a draft, as in the editor');
  assert.deepEqual(await target.listPhotoPosts(kept), []);
  assert.equal((await Full.restore(transfer, { storage: target, kinds: new Set(['library']), verifyPhoto: null })).items[0].counts.sourceVersions, 2);
  // One valid and one invalid document: the set is 'failed' so a retry runs; the retry applies only the rest.
  const docs = { format: 'haedo-account-documents-v1', exportedAt: '2026-11-01T00:00:00.000Z', documents: [
    { prefix: 'discoverySettings', workspaceId: 'ws_original', value: { ...Settings.update(Settings.empty('ws_original'), { autoRefresh: true }, { expectedRevision: 0 }) } },
    { prefix: 'discoveryLanguageSettings', workspaceId: 'ws_original', value: { broken: true } }] };
  const docFile = await Full.open(new Blob([JSON.stringify(docs)]));
  const targets = new Map();
  const partly = await Full.restore(docFile, { storage: target, kinds: new Set(['accountDocuments']), targets, verifyPhoto: null });
  const row = partly.items[0];
  assert.equal(row.status, 'failed'); assert.equal(row.counts.documents, 1); assert.equal(row.rejected, 1);
  const retry = await Full.restore(docFile, { storage: target, kinds: new Set(['accountDocuments']), targets, verifyPhoto: null });
  assert.equal(retry.items[0].counts.documents, 0); assert.equal(retry.items[0].rejected, 1, 'only the rejected document runs again');
  assert.equal((await target.readDiscoverySettings(row.targetId)).autoRefresh, true);
});

// Three Naver captures kept in one workspace, built from the shared fixture with distinct posts.
async function naverWorkspace(storage, count) {
  const Capture = require('../assets/life/naver-capture.js'), { bytes, hash, OWNER } = NaverFixture;
  let bundle = Core.createWorkspace(); bundle.title = '네이버 원문 공간';
  const attachments = [];
  for (let n = 0; n < count; n++) {
    const logNo = '12345678901' + n, body = '추출한 원문 ' + n + '\r\n🌱 그대로 보관한 구절', sha256 = hash(bytes), stamp = '2026-10-21T01:00:00.000Z';
    const payload = { version: 1, blogId: 'fixture_blog', logNo, url: 'https://blog.naver.com/fixture_blog/' + logNo,
      title: '사진이 있는 원문 ' + n, format: 'text/plain', body, bodyHash: hash(body), htmlHash: hash('<p>' + n + '</p>'),
      coverage: 'full_text', omissions: [], publishedAt: null, author: '', extractedAt: stamp, extractor: 'fixture@v1',
      photos: [{ index: 0, url: 'https://postfiles.pstatic.net/fixture/' + n + '.png?type=w966', storagePath: OWNER + '/naver/fixture_blog/' + logNo + '/' + sha256,
        sha256, mimeType: 'image/png', width: 1, height: 1, bytes: bytes.length, alt: '대체 설명', caption: '사진 설명', status: 'stored', error: null, originalStatus: 'unverified' }] };
    const capture = { id: require('node:crypto').randomUUID(), owner_id: OWNER, blog_id: payload.blogId, log_no: logNo, capture_hash: await Capture.fingerprint(payload), created_at: stamp, payload };
    const prepared = await Core.prepareImport(Capture.toImportInput(payload), bundle);
    bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, prepared));
    attachments.push({ sourceId: prepared.source.id, sourceVersionId: prepared.version.id, capture, photos: [{ index: 0, blob: new Blob([bytes], { type: 'image/png' }) }] });
  }
  await storage.installWorkspace(bundle);
  for (const attachment of attachments) {
    const file = await Media.read(await Media.pack({ bundle, attachment }));
    await storage.attachNaverCaptureCopy(bundle.workspaceId, file.attachment);
  }
  return bundle.workspaceId;
}

test('N1: three captures plus their library restore into exactly one new workspace, each version with its own photo bytes', async t => {
  const decoder = NaverFixture.installDecoder(); t.after(decoder);
  const storage = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: owner });
  const ws = await naverWorkspace(storage, 3);
  assert.equal((await storage.listNaverCaptures(ws)).length, 3);
  // The inventory counts captures from the stored rows, without validating each capture.
  let reads = 0;
  const counting = Object.create(storage, { readNaverCapture: { value: async (...args) => { reads++; return storage.readNaverCapture(...args); } } });
  const planned = await Full.plan({ storage: counting });
  assert.equal(reads, 0); assert.equal(planned.tasks.filter(task => task.kind === 'naverCaptures').length, 3);
  const { built } = await fullBundle(storage);
  assert.equal(built.manifest.files.filter(file => file.kind === 'naverCaptures').length, 3);
  const target = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: other });
  const opened = await Full.open(built.blob);
  const report = await Full.restore(opened, { storage: target, kinds: RESTORABLE, verifyPhoto: null });
  assert.deepEqual(report.items.filter(item => item.status !== 'restored'), []);
  const workspaces = await target.listWorkspaces();
  assert.equal(workspaces.length, 1, 'one new workspace, not one per capture');
  const copy = await target.read(workspaces[0].workspaceId), original = await storage.read(ws);
  assert.equal(copy.sourceVersions.length, 3);
  for (const version of copy.sourceVersions) {
    const capture = await target.readNaverCapture(copy.workspaceId, version.id);
    assert.ok(capture, 'every restored version has its capture');
    assert.equal(capture.sourceVersionId, version.id);
    const before = original.sourceVersions.find(row => row.contentHash === version.contentHash);
    const source = await storage.readNaverCapture(ws, before.id);
    assert.equal(sha(Buffer.from(await capture.photos[0].blob.arrayBuffer())), sha(Buffer.from(await source.photos[0].blob.arrayBuffer())));
    assert.equal(capture.capture.capture_hash, source.capture.capture_hash);
  }
  // Without the library the photos are not restored and no workspace is made for them.
  const bare = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: other });
  const skipped = await Full.restore(opened, { storage: bare, kinds: new Set(['naverCaptures']), verifyPhoto: null });
  assert.deepEqual(skipped.items.map(item => item.status), ['skipped', 'skipped', 'skipped']);
  assert.match(skipped.items[0].message, /자료·구성과 함께 복원하세요/);
  assert.deepEqual(await bare.listWorkspaces(), []);
  // The attach function never replaces an existing capture.
  const again = await Media.read(new Blob([Z.unzipSync(new Uint8Array(await built.blob.arrayBuffer()))[built.manifest.files.find(file => file.kind === 'naverCaptures').path]]));
  const version = copy.sourceVersions.find(row => row.contentHash === original.sourceVersions.find(item => item.id === again.attachment.sourceVersionId).contentHash);
  const source = copy.sources.find(row => row.id === version.sourceId);
  await assert.rejects(target.attachNaverCaptureCopy(copy.workspaceId, { ...again.attachment, sourceId: source.id, sourceVersionId: version.id }), { code: 'naver_capture_exists' });
});

test('a list that failed is read again on retry, and its items are appended', async () => {
  const { storage, first } = await seed();
  let fail = true;
  const flaky = Object.create(storage, { listPhotoPosts: { value: async workspaceId => { if (fail && workspaceId === first) throw new Error('합성 목록 실패'); return storage.listPhotoPosts(workspaceId); } } });
  const context = { storage: flaky }, planned = await Full.plan(context), writer = Full.writer(planned, context);
  const failed = await writer.collect();
  assert.deepEqual(failed.map(task => task.id), ['photoPosts:1:list']);
  fail = false;
  assert.deepEqual(await writer.collect({ only: new Set(['photoPosts:1:list']) }), []);
  const built = writer.finish();
  assert.equal(built.manifest.complete, true);
  assert.equal(built.manifest.files.filter(file => file.kind === 'photoPosts' && file.workspace === 1).length, 2);
});

test('a failure after reading never leaves a written entry outside the manifest', async () => {
  const { storage, first } = await seed();
  // The value serializes, then its count throws: the entry must not be written.
  const odd = Object.create(storage, { readMaterialWriting: { value: async workspaceId => {
    const value = await storage.readMaterialWriting(workspaceId);
    if (workspaceId !== first) return value;
    let reads = 0; const plans = value.plans;
    return Object.defineProperty({ ...value }, 'plans', { enumerable: true, get() { if (++reads > 1) throw new Error('합성 개수 실패'); return plans; } });
  } } });
  const context = { storage: odd }, planned = await Full.plan(context), writer = Full.writer(planned, context);
  const failed = await writer.collect();
  assert.deepEqual(failed.map(task => task.id), ['materialWriting:1']);
  const partial = writer.finish({ partial: true });
  assert.equal((await zipNames(partial.blob)).includes('workspaces/01/material-writing.json'), false);
  assert.equal((await Full.open(partial.blob)).type, 'bundle', 'the partial ZIP matches its manifest');
});

test('a restored post makes nine-slot references follow its new revision only when the body is the referenced one', async () => {
  const storage = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: owner });
  const ws = (await storage.createWorkspace('글 참조 공간')).workspaceId;
  let same = await storage.savePhotoPost(ws, postDoc({ title: '그대로인 글', status: 'saved' }), 0);
  same = await storage.savePhotoPost(ws, same, same.revision); // revision 2
  let edited = await storage.savePhotoPost(ws, postDoc({ title: '나중에 고친 글', status: 'saved' }), 0);
  edited = await storage.savePhotoPost(ws, edited, edited.revision); // revision 2
  const sameRef = await Reference.buildPost({ workspaceId: ws, post: same }), editedRef = await Reference.buildPost({ workspaceId: ws, post: edited });
  edited = await storage.savePhotoPost(ws, { ...edited, ops: [{ insert: '본문을 바꾼 뒤 저장\n' }] }, edited.revision); // revision 3, other body
  const board = Nine.create(Core.id); board.title = '글 아홉 칸';
  board.areas[0].items = [Nine.evidenceSnapshot({ kind: 'post', value: sameRef }), Nine.evidenceSnapshot({ kind: 'post', value: editedRef })];
  await storage.saveNineBoard(ws, { format: 'life-nine-board-v2', workspaceId: ws, revision: 0, boards: [board] }, 0);
  const { built } = await fullBundle(storage);
  const target = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: other });
  const report = await Full.restore(await Full.open(built.blob), { storage: target, kinds: RESTORABLE, verifyPhoto: null });
  const copyId = report.workspaces[0].targetId, items = (await target.readNineBoard(copyId)).boards[0].areas[0].items;
  const posts = await target.listPhotoPosts(copyId), restoredSame = posts.find(row => row.title === '그대로인 글'), restoredEdited = posts.find(row => row.title === '나중에 고친 글');
  assert.equal(items[0].reference.value.postId, restoredSame.id);
  assert.equal(items[0].reference.value.postRevision, restoredSame.revision, 'same body: follows the restored revision');
  assert.equal((await Reference.resolvePost({ workspaceId: copyId, post: await target.readPhotoPost(copyId, restoredSame.id) }, items[0].reference.value)).postId, restoredSame.id);
  assert.equal(items[1].reference.value.postId, restoredEdited.id);
  assert.equal(items[1].reference.value.postRevision, 2, 'changed body: left as it was, no other version substituted');
});

test('conflict recovery copies of account documents are counted as not included', async () => {
  const { storage, first } = await seed();
  const key = Full.docKey(storage, 'discoverySettings', first);
  await storage.saveAccountDocRecovery(key, { schemaVersion: 1, note: '이전 값' }, 'conflict');
  const planned = await Full.plan({ storage });
  const row = planned.notIncluded.find(item => item.kind === 'accountDocRecoveries');
  assert.equal(row.count, 1); assert.ok(row.reason && row.whereToSave);
});

test('M4: a restore into the same account names each copy with its date, marks it, and the home lists every post once', async () => {
  require('../assets/life/home.js');
  const { listAccountPosts } = globalThis.HaedoLife.HomeUI;
  const { storage, first, second } = await seed();
  const { built } = await fullBundle(storage);
  const at = new Date(2026, 10, 2, 9), titles = async () => (await storage.listWorkspaces()).map(row => row.title);
  const before = await listAccountPosts(storage, first);
  const counts = posts => posts.reduce((map, row) => map.set(row.title, (map.get(row.title) || 0) + 1), new Map());
  assert.ok([...counts(before.posts).values()].every(n => n === 1));
  // A workspace that only looks like a copy by name is not one: the marker decides.
  const lookalike = (await storage.createWorkspace('첫 자료공간 (11-02 복원)')).workspaceId;
  await storage.savePhotoPost(lookalike, postDoc({ title: '이름만 비슷한 공간의 글', status: 'saved' }), 0);
  await storage.setActive(first);
  const run = async () => Full.restore(await Full.open(new Blob([await built.blob.arrayBuffer()])), { storage, kinds: RESTORABLE, verifyPhoto: null, now: () => at });
  const once = await run(), twice = await run();
  for (const report of [once, twice]) assert.deepEqual(report.items.filter(item => item.status !== 'restored'), []);
  // Same day twice: every name differs from the original, the look-alike and each other.
  assert.deepEqual(once.workspaces.map(ws => ws.targetTitle), ['첫 자료공간 (11-02 복원 2)', '두 번째 자료공간 (11-02 복원)']);
  assert.deepEqual(twice.workspaces.map(ws => ws.targetTitle), ['첫 자료공간 (11-02 복원 3)', '두 번째 자료공간 (11-02 복원 2)']);
  const names = await titles(); assert.equal(new Set(names).size, names.length, 'no two workspaces share a name');
  assert.equal(await storage.getActive(), first);
  const libraries = await storage.listAccountLibraries();
  const copyOf = id => libraries.filter(row => row.restoredCopy?.sourceWorkspaceId === id).map(row => row.workspaceId);
  assert.equal(copyOf(first).length, 2); assert.equal(copyOf(second).length, 2);
  for (const row of libraries.filter(row => row.restoredCopy)) { assert.equal(row.eligible, true); assert.equal(row.restoredCopy.restoredAt, at.toISOString()); }
  assert.equal(Object.hasOwn(libraries.find(row => row.workspaceId === lookalike), 'restoredCopy'), false);
  // Home of the original: each post once, the originals' rows (and the unmarked look-alike's).
  const home = await listAccountPosts(storage, first);
  assert.equal(home.workspaces.length, 7, 'every library is read; copies are not skipped as a whole');
  assert.deepEqual([...counts(home.posts).entries()].filter(([, n]) => n !== 1), []);
  assert.equal(home.posts.length, before.posts.length + 1);
  assert.ok(home.posts.every(row => [first, second, lookalike].includes(row.workspaceId)));
  // Opening a copy lists that copy's rows in place of the equal ones; still each post once.
  const opened = copyOf(first)[0], inCopy = await listAccountPosts(storage, opened);
  assert.deepEqual([...counts(inCopy.posts).entries()].filter(([, n]) => n !== 1), []);
  assert.equal(inCopy.posts.length, home.posts.length);
  assert.ok(inCopy.posts.filter(row => row.title === '저장한 사진 글').every(row => row.workspaceId === opened));
  // Hidden from the home list only: a later backup still contains every copy and opens cleanly.
  const again = await fullBundle(storage);
  assert.equal(again.planned.workspaces.length, 7);
  const reopened = await Full.open(again.built.blob);
  assert.ok(reopened.entries.find(entry => entry.kind === 'accountDocuments').data.documents.every(doc => doc.prefix !== 'restored-copy'));
});

test('M4: the home never loses a post to a restore copy: deleted, changed and later posts stay; only unchanged copies fold', async () => {
  require('../assets/life/home.js');
  const { listAccountPosts } = globalThis.HaedoLife.HomeUI;
  // Independent of home.js: what a person sees as the same post (title, state, text, photo bytes in order).
  const restoredContent = value => JSON.stringify([value.title, value.status, value.archived === true, Photo.plainText(value), value.photos.map(p => [p.digest, p.view?.digest || null])]);
  const { storage, first, second } = await seed();
  const at = new Date(2026, 10, 2, 9);
  const restore = async () => { const { built } = await fullBundle(storage); const report = await Full.restore(await Full.open(built.blob), { storage, kinds: RESTORABLE, verifyPhoto: null, now: () => at });
    assert.deepEqual(report.items.filter(item => item.status !== 'restored'), []); return report; };
  // Every post of every eligible library: its content must be listed at least once, and an unchanged copy only once.
  async function check(open, label) {
    const listed = await listAccountPosts(storage, open), shown = new Map(), stored = new Map();
    for (const row of listed.posts) { const content = restoredContent(await storage.readPhotoPost(row.workspaceId, row.id)); shown.set(content, (shown.get(content) || 0) + 1); }
    for (const library of await storage.listAccountLibraries()) {
      if (library.eligible === false && library.workspaceId !== open) continue;
      for (const row of await storage.listPhotoPosts(library.workspaceId)) {
        const content = restoredContent(await storage.readPhotoPost(library.workspaceId, row.id));
        stored.set(content, [...(stored.get(content) || []), library.workspaceId]);
      }
    }
    for (const [content, where] of stored) assert.ok(shown.get(content) >= 1, label + ': a post vanished from the home (' + JSON.parse(content)[0] + ')');
    for (const [content, n] of shown) assert.equal(n, Math.max(1, stored.get(content).filter(ws => ws === open).length), label + ': listed twice (' + JSON.parse(content)[0] + ')');
    return listed;
  }
  await check(first, 'before');
  // 1. A post deleted from the original after the backup is restored by the copy and listed from it.
  const { built: early } = await fullBundle(storage);
  const lost = (await storage.listPhotoPosts(first)).find(row => row.title === '저장한 사진 글');
  await storage.deletePhotoPost(first, lost.id, lost.revision);
  await storage.setActive(first);
  const report = await Full.restore(await Full.open(early.blob), { storage, kinds: RESTORABLE, verifyPhoto: null, now: () => at });
  const copy = report.workspaces.find(ws => ws.index === 1).targetId;
  assert.equal(await storage.getActive(), first, 'the original stays open after the restore');
  let listed = await check(first, 'deleted then restored');
  assert.deepEqual(listed.posts.filter(row => row.title === '저장한 사진 글').map(row => row.workspaceId), [copy], 'the recovered post is on the home');
  assert.ok(listed.posts.filter(row => row.title === '연재 첫 글').every(row => row.workspaceId === first), 'the unchanged one is listed from the original');
  // 2. A post written in the original after the backup stays listed when the copy is opened.
  const later = await storage.savePhotoPost(first, postDoc({ title: '백업 뒤에 쓴 글', status: 'saved' }), 0);
  listed = await check(copy, 'copy opened');
  assert.ok(listed.posts.some(row => row.id === later.id && row.workspaceId === first));
  assert.ok(listed.posts.filter(row => row.title === '연재 첫 글').every(row => row.workspaceId === copy), 'the open copy lists its own row');
  // 3. A post changed in the original after the backup is a different post: both are listed.
  const series = (await storage.listPhotoPosts(first)).find(row => row.title === '연재 첫 글'), doc = await storage.readPhotoPost(first, series.id);
  await storage.savePhotoPost(first, { ...doc, ops: [{ insert: '백업 뒤에 고친 본문\n' }] }, doc.revision);
  listed = await check(first, 'changed after backup');
  assert.deepEqual(listed.posts.filter(row => row.title === '연재 첫 글').map(row => row.workspaceId).sort(), [first, copy].sort());
  // A second restore of the current state folds again; the second space's draft is listed once.
  await restore();
  listed = await check(first, 'restored twice');
  assert.equal(listed.posts.filter(row => row.title === '두 번째 공간 초안').length, 1);
  assert.ok(listed.posts.filter(row => row.title === '두 번째 공간 초안').every(row => row.workspaceId === second));
});

test('M4: restore-copy folding pairs one to one, needs an eligible listed original and survives a marker loop', async () => {
  require('../assets/life/home.js');
  const { restoredDuplicates } = globalThis.HaedoLife.HomeUI;
  const row = (id, title) => ({ id, title, status: 'saved', archived: false, body: title + '\n', photos: 0, attachments: 0 });
  const doc = (id, title) => ({ id, title, status: 'saved', archived: false, ops: [{ insert: title + '\n' }], photos: [], attachments: [] });
  const docs = new Map(), read = async (ws, ids) => ids.map(id => docs.get(ws + '/' + id) || null);
  const lists = new Map([['a', [row('a1', '같은 글')]], ['c', [row('c1', '같은 글'), row('c2', '같은 글')]], ['r', [row('r1', '복구 글')]], ['rc', [row('rc1', '복구 글')]],
    ['x', [row('x1', '고리')]], ['y', [row('y1', '고리')]]]);
  for (const [ws, rows] of lists) for (const item of rows) docs.set(ws + '/' + item.id, doc(item.id, item.title));
  const libraries = [{ workspaceId: 'a' }, { workspaceId: 'c', restoredCopy: { sourceWorkspaceId: 'a' } }, { workspaceId: 'r', eligible: false },
    { workspaceId: 'rc', restoredCopy: { sourceWorkspaceId: 'r' } }, { workspaceId: 'x', restoredCopy: { sourceWorkspaceId: 'y' } }, { workspaceId: 'y', restoredCopy: { sourceWorkspaceId: 'x' } }];
  const hidden = await restoredDuplicates(libraries, lists, 'a', read);
  // Two equal copies of one original post: one folds, the other stays (one to one).
  assert.equal(['c/c1', 'c/c2'].filter(item => hidden.has(item)).length, 1); assert.equal(hidden.has('a/a1'), false);
  // A copy of an ineligible (recovery) library is not folded into it (m1).
  assert.equal(hidden.has('rc/rc1'), false);
  // A loop of markers keeps exactly one of the pair.
  assert.equal(['x/x1', 'y/y1'].filter(item => hidden.has(item)).length, 1);
  // An unreadable post never folds.
  const unreadable = await restoredDuplicates(libraries, lists, 'a', async (ws, ids) => { if (ws === 'c') throw new Error('읽기 실패'); return ids.map(id => docs.get(ws + '/' + id)); });
  assert.equal(['c/c1', 'c/c2'].some(item => unreadable.has(item)), false);
});

// Review P1 (bench: 100 posts, 50 sources of 20,000 characters per workspace).
// Before: every compared post read and re-validated its whole workspace, one
// read at a time (2.3-3.3 s here, about 30x the unmarked list). Now one read
// per workspace, and the view cache reads nothing again for unchanged posts.
test('M4 cost: folding a restore copy reads each workspace once and the view cache reads nothing again', async t => {
  require('../assets/life/home.js');
  const { listAccountPosts } = globalThis.HaedoLife.HomeUI;
  const N = 100, SOURCES = 50, SIZE = 20000;
  // About 1 MB of sources per workspace, built once in memory; each library installs a copy with new IDs.
  let template = Core.createWorkspace({ title: '원문 묶음' });
  for (let s = 0; s < SOURCES; s++) {
    const prepared = await Core.prepareImport({ origin: 'obsidian', title: '원문 ' + s, text: '가'.repeat(SIZE), authorRelation: 'self' }, template);
    template = Core.applyChanges(template, Core.buildImportChanges(template, prepared, []));
  }
  async function library(storage, title, options) {
    const bundle = await Core.restoreBackup(Core.makeBackup(template));
    const ws = (await storage.installWorkspace({ ...bundle, title }, options)).workspaceId;
    for (let i = 0; i < N; i++) await storage.savePhotoPost(ws, postDoc({ title: '글 ' + i, status: 'saved' }), 0);
    return ws;
  }
  async function account(marked) {
    const storage = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: owner });
    const a = await library(storage, '내 자료');
    const b = await library(storage, '내 자료 (11-02 복원)', marked ? { restoredCopy: { sourceWorkspaceId: a, restoredAt: '2026-11-02T00:00:00.000Z' } } : undefined);
    await storage.setActive(a);
    const calls = { many: 0, one: 0 };
    const counted = Object.create(storage, {
      readPhotoPosts: { value: (ws, ids) => { calls.many++; return storage.readPhotoPosts(ws, ids); } },
      readPhotoPost: { value: (ws, id) => { calls.one++; return storage.readPhotoPost(ws, id); } } });
    return { storage: counted, a, b, calls };
  }
  const median = values => values.slice().sort((x, y) => x - y)[1];
  const timed = async (f, options) => { const out = []; for (let r = 0; r < 3; r++) { const t = process.hrtime.bigint(); await listAccountPosts(f.storage, f.a, options); out.push(Number(process.hrtime.bigint() - t) / 1e6); } return out; };
  const plain = await account(false), marked = await account(true);
  // Same decision as before: every copy post equals its original and folds; none of A's rows go.
  const listed = await listAccountPosts(marked.storage, marked.a);
  assert.equal(listed.posts.length, N); assert.ok(listed.posts.every(row => row.workspaceId === marked.a));
  assert.equal((await listAccountPosts(plain.storage, plain.a)).posts.length, 2 * N, 'without a marker nothing folds');
  // One read per workspace, never one per post.
  marked.calls.many = marked.calls.one = 0;
  await listAccountPosts(marked.storage, marked.a);
  assert.deepEqual(marked.calls, { many: 2, one: 0 });
  // With the view cache, a later pass over unchanged posts reads none.
  const contentCache = new Map();
  await listAccountPosts(marked.storage, marked.a, { contentCache });
  assert.equal(contentCache.size, 2 * N);
  marked.calls.many = 0; await listAccountPosts(marked.storage, marked.a, { contentCache });
  assert.equal(marked.calls.many, 0);
  // An edited post is read again (its revision changed); only it.
  const edited = (await marked.storage.listPhotoPosts(marked.b))[0], doc = await marked.storage.readPhotoPost(marked.b, edited.id);
  await marked.storage.savePhotoPost(marked.b, doc, doc.revision);
  let asked = 0; const watch = Object.create(marked.storage, { readPhotoPosts: { value: (ws, ids) => { asked += ids.length; return marked.storage.readPhotoPosts(ws, ids); } } });
  assert.equal((await listAccountPosts(watch, marked.a, { contentCache })).posts.length, N);
  assert.equal(asked, 1);
  // Time is recorded, not asserted: the two lists are timed at different moments,
  // so machine load moves the ratio. The read counts above guard the cost.
  const base = median(await timed(plain)), folded = median(await timed(marked));
  t.diagnostic('list ' + Math.round(base) + ' ms unmarked, ' + Math.round(folded) + ' ms with a restore copy (median of 3)');
});

test('timeline snapshot: a damaged goal/habit recovery value is written as it is, never blocking the backup', () => {
  const uid = '11111111-1111-4111-8111-111111111111', keys = PlatformData.keys(uid), local = memoryLocal();
  local.setItem(keys.registry, JSON.stringify({ docs: [], current: null }));
  local.setItem(keys.items, '[]');
  local.setItem(keys.recovery, '{not json');
  local.setItem(keys.recoveryDamaged, JSON.stringify(['[1,']));
  const damaged = Full.timelineSnapshot({ platformData: PlatformData, localStorage: local, uid });
  assert.deepEqual(damaged.recovery, []);
  assert.deepEqual(damaged.recoveryDamaged, ['[1,', '{not json']);
  const row = { rid: 'r1', id: 'g1', kind: 'goal', data: { title: '목표' }, updated: null, keptAt: '2026-11-04T00:00:00.000Z', reason: 'remote-newer' };
  local.setItem(keys.recovery, JSON.stringify([row])); local.setItem(keys.recoveryDamaged, '[]');
  const fine = Full.timelineSnapshot({ platformData: PlatformData, localStorage: local, uid });
  assert.deepEqual(fine.recovery, [row]);
  assert.equal(Object.hasOwn(fine, 'recoveryDamaged'), false);
});

// 하루 행복도(happinessDays, 2026-11-04): carried as a field of the timeline part. account-documents.json
// and the ZIP file list are unchanged, so this release and older ones still open the bundle.
test('행복도: the timeline part carries happinessDays; account-documents.json and the file list are unchanged and the bundle opens', async () => {
  const memory = memoryIdb(), storage = createStorage({ idb: memory.idb, core: Core, channelFactory: null, account: owner });
  const plain = await fullBundle(storage);
  await storage.writeHappinessDay('2026-11-01', 0.4); await storage.writeHappinessDay('2026-11-02', 0.2); await storage.writeHappinessDay('2026-11-02', null);
  const { built } = await fullBundle(storage);
  const files = Z.unzipSync(new Uint8Array(await built.blob.arrayBuffer()));
  const timeline = JSON.parse(Buffer.from(files['timeline-goals-habits.json']).toString());
  assert.deepEqual(timeline.happinessDays.entries.map(entry => [entry.date, entry.v]), [['2026-11-01', 0.4], ['2026-11-02', null]]);
  assert.deepEqual(built.manifest.files.find(file => file.kind === 'timeline').counts, { timelines: 1, goals: 1, habits: 1, days: 1 });
  assert.deepEqual(built.manifest.files.map(file => file.path).sort(), plain.built.manifest.files.map(file => file.path).sort(), 'no new file in the ZIP');
  const docs = JSON.parse(Buffer.from(files['account-documents.json']).toString());
  assert.equal(docs.documents.some(doc => doc.prefix === 'happinessDays'), false, 'account-documents.json keeps only the kinds older releases know');
  const opened = await Full.open(new Blob([await built.blob.arrayBuffer()]));
  assert.equal(opened.type, 'bundle');
  assert.equal(opened.entries.find(entry => entry.kind === 'timeline').data.happinessDays.entries.length, 2);
  // A timeline file without the field (older backups) is still read.
  const older = await Full.open(new Blob([JSON.stringify({ format: 'haedo-platform-backup-v1', exportedAt: '2026-11-01T00:00:00.000Z', docs: [], items: [] })]));
  assert.equal(older.kind, 'timeline');
});

test('행복도 복원: copies get the points shown at backup time on signed1, every copy the same; 행복도 only makes one new timeline', () => {
  const day = (date, v, extra = {}) => ({ date, v, at: '2026-11-01T00:00:00.000Z', ...extra });
  const docA = { profile: { name: 'A', birth: '1990-01' }, events: [], spans: [], happiness: [{ date: '2026-10', v: 6 }, { date: '2026-10-01', v: 3 }, { date: '2026-10-02', v: 7 }, { date: '2026-10-05', v: 9 }] };
  const docB = { profile: { name: 'B', birth: '1990-01' }, scale: 'signed1', events: [], spans: [], happiness: [] };
  const backup = { format: 'haedo-platform-backup-v1', docs: [{ id: 'a', name: 'A', data: docA }, { id: 'b', name: 'B', data: docB }],
    happinessDays: { entries: [day('2026-10-01', 0.8), day('2026-10-02', null), day('2026-10-09', -0.2, { future: true })] } };
  const restored = PlatformData.restoreBackupDays(backup);
  assert.equal(restored.happinessOnly, false); assert.equal(restored.days, 2);
  const [a, b] = restored.backup.docs.map(entry => entry.data);
  assert.equal(a.scale, 'signed1');
  assert.deepEqual(a.happiness.map(p => [p.date, p.v, !!p.future]),
    [['2026-10', 0.2, false], ['2026-10-05', 0.8, false], ['2026-10-01', 0.8, false], ['2026-10-09', -0.2, true]],
    'months stay, a day the account had is replaced, a deleted day is left out, a day only in the timeline stays');
  assert.deepEqual(b.happiness.filter(p => p.date.length === 10).map(p => [p.date, p.v]), [['2026-10-01', 0.8], ['2026-10-09', -0.2]], 'every copy gets the same days');
  assert.equal(docA.happiness[1].v, 3, 'the backup itself is not changed');
  // 행복도 only: one new timeline named 행복도 복원; the importer keeps the timeline being viewed.
  const only = PlatformData.restoreBackupDays({ format: 'haedo-platform-backup-v1', docs: [], items: [], happinessDays: { entries: [day('2026-10-01', 0.3)] } });
  assert.equal(only.happinessOnly, true);
  assert.deepEqual(only.backup.docs.map(entry => [entry.name, entry.data.happiness]), [['행복도 복원', [{ date: '2026-10-01', v: 0.3 }]]]);
  const local = memoryLocal(), keys = PlatformData.keys('u1');
  local.setItem(keys.registry, JSON.stringify({ docs: [{ id: 'mine', name: '내 연표' }], current: 'mine' }));
  globalThis.crypto ||= require('node:crypto').webcrypto;
  PlatformData.importDocs(local, 'u1', only.backup, undefined, false, { keepCurrent: only.happinessOnly });
  const reg = JSON.parse(local.getItem(keys.registry));
  assert.equal(reg.current, 'mine'); assert.deepEqual(reg.docs.map(doc => doc.name), ['내 연표', '행복도 복원']);
  // A backup without the field passes through as it was.
  const none = { format: 'haedo-platform-backup-v1', docs: [{ data: docA }] };
  assert.equal(PlatformData.restoreBackupDays(none).backup, none);
});

test('행복도를 읽지 못해도(새 앱의 형식 등) 연표 부분은 담기고, 담지 못한 이유가 목록에 남는다', async () => {
  const memory = memoryIdb(), storage = createStorage({ idb: memory.idb, core: Core, channelFactory: null, account: owner });
  const newer = Object.create(storage, { readHappinessDays: { value: async () => { throw Object.assign(new Error('앱을 새로고침한 뒤 다시 시도해 주세요. 값은 그대로 있습니다.'), { code: 'app_refresh_required' }); } } });
  const { built, failed } = await fullBundle(newer);
  assert.deepEqual(failed, []);
  const files = Z.unzipSync(new Uint8Array(await built.blob.arrayBuffer()));
  const timeline = JSON.parse(Buffer.from(files['timeline-goals-habits.json']).toString());
  assert.equal(timeline.format, 'haedo-platform-backup-v1'); assert.equal(Object.hasOwn(timeline, 'happinessDays'), false);
  const missing = built.manifest.missing.filter(row => row.kind === 'timeline');
  assert.equal(missing.length, 1); assert.equal(missing[0].reason, 'skipped');
  assert.match(missing[0].error, /하루 행복도를 읽지 못해/);
});

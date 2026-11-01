'use strict';
// "모두 받기" bundle: one ZIP of every account workspace, each file in its
// existing format, restored only as new workspace copies.
const test = require('node:test'), assert = require('node:assert/strict');
const { owner, memoryIdb, Core, Photo } = require('./helpers/blog-sync-cloud.cjs');
const { createStorage } = require('../assets/life/storage.js');
const Reference = require('../assets/life/source-reference.js');
const Folders = require('../assets/life/source-folders.js');
const Workbench = require('../assets/life/workbench.js');
const Collection = require('../assets/life/collection.js');
const Nine = require('../assets/life/nine-board.js');
const Settings = require('../assets/life/discovery-settings.js');
const PlatformData = require('../assets/platform-data.js');
const Z = require('../vendor/fflate/fflate.js');
const Full = require('../assets/life/full-backup.js');
const { createHash } = require('node:crypto');

const other = { projectUrl: owner.projectUrl, userId: '99999999-2222-4333-8444-555555555555' };
const hex = async blob => Buffer.from(await blob.arrayBuffer()).toString('hex');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

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
  const prepared = await Core.prepareImport({ origin: 'obsidian', title, text }, bundle);
  const changes = Core.buildImportChanges(bundle, prepared, [{ start: 0, end: 2, topic: '검증', note: '비공개 메모' }]);
  assert.equal((await storage.commitLocal({ workspaceId, operationId: Core.id(), baseRevision: bundle.revision, changes })).status, 'stored');
  if (extra) {
    bundle = await storage.read(workspaceId);
    const next = await Core.prepareImport({ origin: 'obsidian', title, text: extra, existingSourceId: prepared.source.id }, bundle);
    assert.equal((await storage.commitLocal({ workspaceId, operationId: Core.id(), baseRevision: bundle.revision, changes: Core.buildImportChanges(bundle, next) })).status, 'stored');
  }
  return prepared;
}

async function seed() {
  const memory = memoryIdb(), storage = createStorage({ idb: memory.idb, core: Core, channelFactory: null, account: owner });
  const first = (await storage.createWorkspace('첫 자료공간')).workspaceId;
  const second = (await storage.createWorkspace('두 번째 자료공간')).workspaceId;
  // An old exact version and a newer version of the same source.
  const old = await addSource(storage, first, '산책 원문', '옛 문장 그대로 남긴다.', '새로 고친 문장.');
  let bundle = await storage.read(first);
  const quote = { start: 0, end: 5 };
  const ref = await Reference.build({ bundle, sourceId: old.source.id, versionId: old.version.id, locator: quote });
  // Composition and folders reference the exact old version.
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
  const draft = await storage.savePhotoPost(second, postDoc({ title: '두 번째 공간 초안', status: 'draft' }), 0);
  await addSource(storage, second, '두 번째 원문', '두 번째 공간의 원문.');
  const settings = await storage.readDiscoverySettings(first);
  await storage.saveDiscoverySettings(first, Settings.update(settings, { autoRefresh: true }, { expectedRevision: settings.revision }), settings.revision);
  return { memory, storage, first, second, old, ref, saved, draft, heic, jpeg };
}
function fakeLocal(uid) {
  const data = new Map(), keys = PlatformData.keys(uid);
  data.set(keys.registry, JSON.stringify({ docs: [{ id: 'd_1', name: '내 연표', updated: '2026-11-01T00:00:00.000Z' }], current: 'd_1' }));
  data.set(keys.docs + 'd_1', JSON.stringify({ profile: { name: '내 연표', birth: '1990-01' }, events: [{ id: 'e1', date: '2000-01-01', title: '사건' }] }));
  data.set(keys.items, JSON.stringify([{ id: 'g1', kind: 'goal', data: { title: '목표' } }, { id: 'h1', kind: 'habit', data: { title: '습관' } }]));
  return { getItem: key => data.has(key) ? data.get(key) : null };
}
async function fullBundle(storage, options = {}) {
  const timeline = () => Full.timelineSnapshot({ platformData: PlatformData, localStorage: fakeLocal(owner.userId), uid: owner.userId });
  const planned = await Full.plan({ storage, timeline });
  const results = await Full.collect(planned, { storage, timeline, ...options.context });
  return { planned, results, built: await Full.build(planned, results, { appVersion: 'haedo-v171', ...options.build }) };
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
      nine: await storage.readNineBoard(ws.workspaceId), posts });
  }
  return JSON.stringify(rows);
}

test('모두 받기: every workspace in one ZIP, each file in its existing format with manifest hashes', async () => {
  const seeded = await seed();
  const { built } = await fullBundle(seeded.storage);
  assert.equal(built.manifest.format, 'haedo-full-backup-v1'); assert.equal(built.manifest.complete, true); assert.equal(built.manifest.appVersion, 'haedo-v171');
  assert.match(built.fileName, /^haedo-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  const files = Z.unzipSync(new Uint8Array(await built.blob.arrayBuffer()));
  assert.deepEqual(Object.keys(files).sort(), ['README.txt', 'manifest.json', ...built.manifest.files.map(file => file.path)].sort());
  assert.equal(built.manifest.workspaces.length, 2);
  for (const file of built.manifest.files) {
    assert.equal(sha(files[file.path]), file.sha256, file.path); assert.equal(files[file.path].byteLength, file.bytes);
    assert.ok(Number.isSafeInteger(file.formatVersion) && file.formatVersion >= 1);
  }
  const byKind = kind => built.manifest.files.filter(file => file.kind === kind);
  // Existing formats unchanged: the material-library JSON restores through its own module.
  const library = JSON.parse(Buffer.from(files['workspaces/01/library.json']).toString());
  assert.equal(library.format, Folders.BACKUP_FORMAT);
  const restored = await Folders.restoreBackup(library);
  assert.equal(restored.bundle.sourceVersions.length, 2);
  assert.equal(byKind('library')[1].format, 'life-workbench-backup-v1'); // no folders: the same choice as the 자료·구성 screen
  assert.equal(JSON.parse(Buffer.from(files['workspaces/01/nine-boards.json']).toString()).format, 'life-nine-board-backup-v2');
  assert.equal(byKind('photoPosts').length, 2);
  const postFile = byKind('photoPosts').find(file => file.postId === seeded.saved.id);
  assert.equal(postFile.status, 'saved'); assert.deepEqual(postFile.counts, { posts: 1, photos: 2, views: 1, attachments: 0 });
  const inner = Z.unzipSync(files[postFile.path]);
  assert.equal(Buffer.from(inner['photos/' + seeded.heic.id]).toString('hex'), await hex(seeded.heic.blob));
  assert.equal(Buffer.from(inner['views/' + seeded.heic.id]).toString('hex'), await hex(seeded.heic.view.blob));
  assert.equal(JSON.parse(Buffer.from(inner['manifest.json']).toString()).format, 'life-photo-post-backup-v2');
  const docs = JSON.parse(Buffer.from(files['account-documents.json']).toString());
  assert.equal(docs.format, 'haedo-account-documents-v1');
  assert.ok(docs.documents.some(doc => doc.prefix === 'discoverySettings' && doc.value.autoRefresh === true));
  assert.ok(docs.documents.some(doc => doc.prefix === 'post-evidence' && doc.postId === seeded.saved.id));
  assert.ok(!JSON.stringify(docs).includes(owner.userId), 'account keys are not written into the file');
  const timeline = JSON.parse(Buffer.from(files['timeline-goals-habits.json']).toString());
  assert.equal(timeline.format, 'haedo-platform-backup-v1'); assert.deepEqual(byKind('timeline')[0].counts, { timelines: 1, goals: 1, habits: 1 });
  const readme = Buffer.from(files['README.txt']).toString();
  assert.match(readme, /하나의 형식이 아닙니다/); for (const file of built.manifest.files) assert.ok(readme.includes(file.sha256));
});

test('restore into another account: new copies only, exact versions, byte-identical HEIC/JPEG, account docs; existing data untouched', async () => {
  const seeded = await seed();
  const { built } = await fullBundle(seeded.storage);
  const memory = memoryIdb(), target = createStorage({ idb: memory.idb, core: Core, channelFactory: null, account: other });
  const existing = (await target.createWorkspace('원래 있던 공간')).workspaceId;
  await addSource(target, existing, '원래 원문', '그대로 있어야 하는 원문.');
  const before = await snapshotAll(target);
  const opened = await Full.open(new Blob([await built.blob.arrayBuffer()]));
  assert.equal(opened.type, 'bundle');
  const summary = Full.summarize(opened);
  assert.deepEqual(summary.map(row => row.kind), ['library', 'collection', 'photoPosts', 'nineBoards', 'accountDocuments', 'timeline']);
  assert.equal(summary.find(row => row.kind === 'timeline').restorable, false);
  const report = await Full.restore(opened, { storage: target, kinds: new Set(['library', 'collection', 'photoPosts', 'nineBoards', 'accountDocuments']), verifyPhoto: null });
  assert.equal(report.items.filter(item => item.status !== 'restored').length, 0, JSON.stringify(report.items.filter(item => item.status !== 'restored')));
  assert.equal(await target.getActive(), existing, 'the workspace in use stays active');
  const after = JSON.parse(await snapshotAll(target)), old = JSON.parse(before)[0];
  assert.deepEqual(after.find(row => row.ws.workspaceId === existing), old, 'existing workspace unchanged');
  assert.equal(after.length, 3);
  const copy = after.find(row => row.ws.title === '첫 자료공간');
  assert.ok(copy && copy.ws.workspaceId !== seeded.first);
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
  const settings = await target.readDiscoverySettings(copy.ws.workspaceId);
  assert.equal(settings.autoRefresh, true);
  const second = after.find(row => row.ws.title === '두 번째 자료공간');
  assert.equal(second.posts[0].status, 'draft'); assert.equal(second.bundle.sources.length, 1);
  // The source account is untouched by restore elsewhere.
  assert.equal((await seeded.storage.listWorkspaces()).length, 2);
});

test('tampered, unknown-version and oversized files are rejected before anything is written', async () => {
  const { storage } = await seed();
  const { built } = await fullBundle(storage);
  const files = Z.unzipSync(new Uint8Array(await built.blob.arrayBuffer()));
  // Same sizes, one byte changed in a photo ZIP.
  const path = built.manifest.files.find(file => file.kind === 'photoPosts').path;
  const changed = { ...files, [path]: Uint8Array.from(files[path], (byte, i) => i === 40 ? byte ^ 1 : byte) };
  await assert.rejects(Full.open(new Blob([Z.zipSync(changed, { level: 0 })])), error => error.code === 'tampered');
  // An extra file not listed in the manifest.
  await assert.rejects(Full.open(new Blob([Z.zipSync({ ...files, 'extra.txt': new Uint8Array([1]) }, { level: 0 })])), error => error.code === 'tampered');
  // Unknown bundle version.
  const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
  const future = { ...files, 'manifest.json': Z.strToU8(JSON.stringify({ ...manifest, format: 'haedo-full-backup-v2', version: 2 })) };
  await assert.rejects(Full.open(new Blob([Z.zipSync(future, { level: 0 })])), error => error.code === 'unsupported_version');
  const sameName = { ...files, 'manifest.json': Z.strToU8(JSON.stringify({ ...manifest, version: 3 })) };
  await assert.rejects(Full.open(new Blob([Z.zipSync(sameName, { level: 0 })])), error => error.code === 'unsupported_version');
  // Compressed entries are not a Haedo bundle.
  await assert.rejects(Full.open(new Blob([Z.zipSync(files, { level: 6 })])), error => error.code === 'invalid_zip');
  // Oversized: checked from the size before reading.
  const huge = { size: Full.LIMITS.bundle + 1, slice: () => new Blob([Uint8Array.from([80, 75, 3, 4])]) };
  await assert.rejects(Full.open(huge), error => error.code === 'backup_too_large');
  await assert.rejects(Full.open(new Blob([JSON.stringify({ format: 'something-else' })])), error => error.code === 'unsupported_backup');
});

test('partial failure: no complete ZIP; retry only the failed part or explicitly build a labelled partial ZIP', async () => {
  const { storage, saved } = await seed();
  let fail = true;
  const flaky = Object.create(storage, { readPhotoPost: { value: async (...args) => { if (fail && args[1] === saved.id) throw new Error('합성 읽기 실패'); return storage.readPhotoPost(...args); } } });
  const timeline = () => Full.timelineSnapshot({ platformData: PlatformData, localStorage: fakeLocal(owner.userId), uid: owner.userId });
  const planned = await Full.plan({ storage: flaky, timeline });
  const results = await Full.collect(planned, { storage: flaky, timeline });
  const failed = planned.tasks.filter(task => results.get(task.id).status === 'failed');
  assert.deepEqual(failed.map(task => task.postId), [saved.id]);
  await assert.rejects(Full.build(planned, results), error => error.code === 'backup_incomplete');
  const partial = await Full.build(planned, results, { partial: true });
  assert.equal(partial.manifest.complete, false); assert.match(partial.fileName, /-partial\.zip$/);
  assert.equal(partial.manifest.missing[0].postId, saved.id); assert.match(partial.manifest.missing[0].error, /합성 읽기 실패/);
  const files = Z.unzipSync(new Uint8Array(await partial.blob.arrayBuffer()));
  assert.match(Buffer.from(files['README.txt']).toString(), /빠진 항목/);
  const reopened = await Full.open(partial.blob);
  assert.equal(reopened.manifest.complete, false);
  // Retry only the failed part.
  fail = false;
  await Full.collect(planned, { storage: flaky, timeline }, { only: new Set(failed.map(task => task.id)), results });
  const complete = await Full.build(planned, results);
  assert.equal(complete.manifest.complete, true);
});

test('single existing files open with their format and restore as new copies', async () => {
  const { storage, first, saved } = await seed();
  const snapshot = await storage.readLibraryBackupSnapshot(first);
  const libraryFile = new Blob([JSON.stringify(Folders.makeBackup(snapshot.bundle, snapshot.workbench, snapshot.sourceFolders))]);
  const opened = await Full.open(libraryFile);
  assert.equal(opened.type, 'single'); assert.equal(opened.entries[0].kind, 'library'); assert.equal(opened.workspaces[0].title, '첫 자료공간');
  const photoZip = await Photo.backup(await storage.readPhotoPost(first, saved.id));
  const photo = await Full.open(photoZip);
  assert.equal(photo.entries[0].kind, 'photoPosts'); assert.equal(photo.entries[0].counts.views, 1);
  const transfer = await Full.open(new Blob([JSON.stringify(Core.makeBackup(snapshot.bundle))]));
  assert.equal(transfer.entries[0].format, 'life-tools-backup-v1');
  const timeline = await Full.open(new Blob([JSON.stringify({ format: 'haedo-platform-backup-v1', exportedAt: '2026-11-01T00:00:00.000Z', docs: [], items: [] })]));
  assert.equal(timeline.type, 'external'); assert.equal(timeline.kind, 'timeline');
  const target = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: other });
  const kept = (await target.createWorkspace('기존')).workspaceId;
  const report = await Full.restore(photo, { storage: target, kinds: new Set(['photoPosts']), verifyPhoto: null });
  assert.equal(report.items[0].status, 'restored'); assert.equal(report.items[0].status, 'restored');
  const copies = (await target.listWorkspaces()).filter(row => row.workspaceId !== kept);
  assert.equal(copies.length, 1);
  const [restoredPost] = await target.listPhotoPosts(copies[0].workspaceId);
  assert.equal(restoredPost.status, 'draft', 'a bare photo ZIP restores as a draft, as in the editor');
  assert.deepEqual(await target.listPhotoPosts(kept), []);
  const t2 = await Full.restore(transfer, { storage: target, kinds: new Set(['library']), verifyPhoto: null });
  assert.equal(t2.items[0].counts.sourceVersions, 2);
});

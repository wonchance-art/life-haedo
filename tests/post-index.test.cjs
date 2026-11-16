'use strict';
// The post list as per-post rows (owner decisions 8 and 10, 2026-11-16; docs/design-review/post-index-rebuild.md).
// Each post's list row `photo-summary:${ws}:${id}` sits beside its document; the documents are the source
// of truth; a save writes only that post's row; there is no length limit; and for one release the
// whole-list row `photo-posts:${ws}` that app versions up to haedo-v220 read stays complete. Real Storage
// on the tests' in-memory IndexedDB adapter; the earlier version is the unchanged storage.js of c76e693
// (tests/helpers/post-index-previous.cjs) opened on the same database. Anonymous synthetic posts only.
const test = require('node:test'), assert = require('node:assert/strict');
const { createStorage } = require('../assets/life/storage.js');
const { memoryIdb, owner, Core, Photo, post, server, device, clock } = require('./helpers/blog-sync-cloud.cjs');
const { previousStorage } = require('./helpers/post-index-previous.cjs');
require('../assets/life/source-folders.js'); require('../assets/life/workbench.js'); require('../assets/life/collection.js'); require('../assets/life/nine-board.js');
const PlatformData = require('../assets/platform-data.js'), Full = require('../assets/life/full-backup.js');
const Previous = previousStorage();

const key = value => JSON.stringify(value);
const LONG = '긴 본문 문장 하나가 이어집니다. 🌿 '.repeat(40); // 840 characters: longer than the earlier versions' cut
// A database whose meta reads of documents are counted (`photo-post:` keys).
function counted() {
  const memory = memoryIdb(), reads = { docs: 0 };
  const idb = { async openDB(...args) {
    const db = await memory.idb.openDB(...args);
    return { ...db, objectStoreNames: db.objectStoreNames, close: () => db.close(), transaction(names, mode) {
      const tx = db.transaction(names, mode);
      return { done: tx.done, abort: tx.abort, objectStore(name) {
        const store = tx.objectStore(name);
        return { ...store, get: item => { if (name === 'meta' && typeof item === 'string' && item.startsWith('photo-post:')) reads.docs++; return store.get(item); } };
      } };
    } };
  } };
  return { memory, reads, idb };
}
const open = (idb, module = { createStorage }) => module.createStorage({ idb, core: Core, channelFactory: null, account: owner });
const meta = memory => memory.rows.get('meta');
const row = (memory, name) => meta(memory).get(key(name))?.value;
const rowKeys = (memory, prefix) => [...meta(memory).keys()].map(item => JSON.parse(item)).filter(name => typeof name === 'string' && name.startsWith(prefix));
const writes = (memory, from) => memory.control.writes.slice(from).filter(write => write.name === 'meta').map(write => write.id);
const iso = n => new Date(Date.UTC(2026, 0, 1) + n * 3600000).toISOString();
async function doc(n, { status = 'saved', body = n % 3 ? '본문 ' + n : LONG + n } = {}) { return post({ title: '글 ' + n, body, status, time: iso(n) }); }
// What an earlier version stored for a post: its document and its whole-list entry with the whole text.
function earlierEntry(value) {
  return { id: value.id, title: value.title, status: value.status, revision: value.revision, updatedAt: value.updatedAt,
    body: Photo.plainText(value), photos: value.photos.length, attachments: (value.attachments || []).length, archived: value.archived === true };
}
function putEarlier(memory, ws, value) {
  const stored = { ...structuredClone(value), revision: 1 }, docKey = `photo-post:${ws}:${value.id}`, listKey = `photo-posts:${ws}`;
  meta(memory).set(key(docKey), { key: docKey, value: stored });
  const list = row(memory, listKey) || []; list.push(earlierEntry(stored)); meta(memory).set(key(listKey), { key: listKey, value: list });
  return stored;
}
// The list as the documents say it, oldest first.
async function expected(storage, ws, ids) {
  const docs = await storage.readPhotoPosts(ws, ids);
  return docs.map(value => ({ id: value.id, title: value.title, status: value.status, revision: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt,
    body: Photo.plainText(value), photos: value.photos.length, attachments: (value.attachments || []).length, archived: value.archived === true }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
// The whole-list row says what every document says (the text cut as this version writes it).
function assertEarlierList(memory, ws, list) {
  const entries = row(memory, `photo-posts:${ws}`);
  assert.ok(Array.isArray(entries)); assert.equal(entries.length, list.length);
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  for (const summary of list) {
    const entry = byId.get(summary.id); assert.ok(entry, summary.id);
    for (const name of ['title', 'status', 'revision', 'updatedAt', 'photos', 'attachments', 'archived']) assert.equal(entry[name], summary[name], name);
    // Whole, as an earlier version wrote it, or (longer than 300) cut from its first non-space character.
    assert.ok(entry.body === summary.body || summary.body.length > 300 && entry.body.length <= 300 && summary.body.trimStart().startsWith(entry.body), 'text whole or cut from the start');
    assert.equal(!!entry.body.trim(), !!summary.body.trim(), 'a text with something in it is not empty in the cut');
  }
}

test('upgrade: a library an earlier version wrote (0, 1 and 250 posts) is listed in full from its documents, once', async () => {
  for (const total of [0, 1, 250]) {
    const { memory, reads, idb } = counted();
    const earlier = open(idb, Previous), ws = (await earlier.createWorkspace('이전 판 공간')).workspaceId, ids = [];
    // That version stores up to 200 itself; the rest arrive as it stores what sync brings (whole entries, revision 1).
    for (let n = 0; n < total; n++) ids.push(n < 200 ? (await earlier.savePhotoPost(ws, await doc(n), 0)).id : putEarlier(memory, ws, await doc(n)).id);
    earlier.close();
    assert.equal(rowKeys(memory, `photo-summary:${ws}:`).length, 0, 'no per-post rows before the upgrade');
    const storage = open(idb), want = await expected(storage, ws, ids);
    reads.docs = 0; const upgradeFrom = memory.control.writes.length;
    const list = await storage.listPhotoPosts(ws);
    if (!total) assert.deepEqual(writes(memory, upgradeFrom), [], 'a library without posts is listed without a write');
    assert.deepEqual(list, want, `${total}: every post, with createdAt and the whole text`);
    assert.equal(rowKeys(memory, `photo-summary:${ws}:`).length, total, `${total}: one row per post written`);
    for (const summary of want) assert.deepEqual(row(memory, `photo-summary:${ws}:${summary.id}`), summary);
    if (total) assertEarlierList(memory, ws, want);
    assert.ok((row(memory, `photo-posts:${ws}`) || []).every(entry => entry.body.length <= 300), `${total}: the whole-list row is rewritten once with each text cut`);
    // The next list reads the rows only: no document and no write.
    const before = memory.control.writes.length; reads.docs = 0;
    assert.deepEqual(await storage.listPhotoPosts(ws), want);
    assert.equal(reads.docs, 0, `${total}: no document read once the rows match`); assert.deepEqual(writes(memory, before), []);
    storage.close();
  }
});

test('a missing, malformed or partial whole-list row and damaged post rows are rebuilt from the documents', async () => {
  const damages = {
    'list row missing': (m, ws) => meta(m).delete(key(`photo-posts:${ws}`)),
    'list row not a list': (m, ws) => meta(m).set(key(`photo-posts:${ws}`), { key: `photo-posts:${ws}`, value: { unsupported: true } }),
    'list row with a repeated id': (m, ws) => { const list = row(m, `photo-posts:${ws}`); list.push(structuredClone(list[0])); },
    'list row without a post': (m, ws, ids) => { const list = row(m, `photo-posts:${ws}`); list.splice(list.findIndex(entry => entry.id === ids[2]), 1); },
    'list entry behind its document': (m, ws, ids) => Object.assign(row(m, `photo-posts:${ws}`).find(entry => entry.id === ids[3]), { title: '오래된 제목', revision: 1 }),
    'list entry without a document': (m, ws) => row(m, `photo-posts:${ws}`).push({ id: 'dangling-synthetic-id', title: '본문 없는 항목', status: 'saved', revision: 1, updatedAt: iso(0), body: '', photos: 0, attachments: 0, archived: false }),
    'post rows missing': (m, ws) => { for (const name of rowKeys(m, `photo-summary:${ws}:`)) meta(m).delete(key(name)); },
    'post row malformed': (m, ws, ids) => meta(m).set(key(`photo-summary:${ws}:${ids[1]}`), { key: `photo-summary:${ws}:${ids[1]}`, value: { id: ids[1], title: 7 } }),
    'post row behind its document': (m, ws, ids) => Object.assign(row(m, `photo-summary:${ws}:${ids[4]}`), { body: '오래된 본문' }),
    'post row without a document': (m, ws) => meta(m).set(key(`photo-summary:${ws}:orphan-synthetic-id`), { key: `photo-summary:${ws}:orphan-synthetic-id`, value: { id: 'orphan-synthetic-id' } }),
  };
  for (const [name, damage] of Object.entries(damages)) {
    const { memory, idb } = counted(), storage = open(idb), ws = (await storage.createWorkspace(name)).workspaceId, ids = [];
    for (let n = 0; n < 6; n++) ids.push((await storage.savePhotoPost(ws, await doc(n), 0)).id);
    let edited = await storage.readPhotoPost(ws, ids[3]); edited = await storage.savePhotoPost(ws, { ...edited, title: '고친 제목' }, edited.revision);
    const want = await expected(storage, ws, ids);
    damage(memory, ws, ids);
    assert.deepEqual(await storage.listPhotoPosts(ws), want, name);
    assertEarlierList(memory, ws, want);
    assert.deepEqual(rowKeys(memory, `photo-summary:${ws}:`).sort(), ids.map(id => `photo-summary:${ws}:${id}`).sort(), name + ': exactly one row per document');
    for (const summary of want) assert.deepEqual(row(memory, `photo-summary:${ws}:${summary.id}`), summary, name);
    // A save after the repair keeps every post in both rows.
    await storage.savePhotoPost(ws, await doc(9), 0);
    assert.equal((await storage.listPhotoPosts(ws)).length, 7, name); assert.equal(row(memory, `photo-posts:${ws}`).length, 7, name);
    storage.close();
  }
});

// Review M1 (27e291d): a document that fails validation is listed as the earlier list showed it (its row,
// else its whole-list entry), so account sync keeps its binding and a backup reports it, never dropped.
test('a document that fails validation stays listed by its row or whole-list entry, and nothing rewrites it', async () => {
  const { memory, idb } = counted(), storage = open(idb), ws = (await storage.createWorkspace('손상된 문서')).workspaceId;
  const kept = await storage.savePhotoPost(ws, await doc(1), 0), broken = await storage.savePhotoPost(ws, await doc(2), 0);
  const docKey = `photo-post:${ws}:${broken.id}`, damaged = { format: 'life-photo-post-v2', id: broken.id, title: '손상', revision: 9 };
  meta(memory).set(key(docKey), { key: docKey, value: damaged });
  const shown = async () => (await storage.listPhotoPosts(ws)).map(summary => [summary.id, summary.title, summary.revision]).sort();
  const expectedRows = [[kept.id, '글 1', 1], [broken.id, '글 2', 1]].sort();
  // Row and entry agree: listed without reading the document.
  assert.deepEqual(await shown(), expectedRows);
  // No row: the document is read, fails, and its whole-list entry is listed (with its update time as createdAt).
  meta(memory).delete(key(`photo-summary:${ws}:${broken.id}`));
  assert.deepEqual(await shown(), expectedRows);
  assert.equal((await storage.listPhotoPosts(ws)).find(summary => summary.id === broken.id).createdAt, broken.updatedAt);
  assert.deepEqual((await storage.listBlogSyncStates(ws)).posts.map(summary => summary.id).sort(), [kept.id, broken.id].sort());
  assert.deepEqual((await storage.readPostSummaries(ws, [broken.id]))[0].title, '글 2');
  assert.deepEqual(row(memory, docKey), damaged, 'the damaged document stays as it is');
  assert.equal(row(memory, `photo-summary:${ws}:${broken.id}`), undefined, 'no row is made from a document that fails');
  // A later save keeps its entry, and listing again writes nothing.
  await storage.savePhotoPost(ws, await doc(3), 0);
  assert.equal(row(memory, `photo-posts:${ws}`).length, 3); assert.equal((await storage.listPhotoPosts(ws)).length, 3);
  const before = memory.control.writes.length; await storage.listPhotoPosts(ws);
  assert.deepEqual(writes(memory, before), [], 'no repair write for a document that cannot be repaired');
  // Its row only (no entry): listed by the row. Neither: not listed (nothing to show it by).
  const other = await storage.savePhotoPost(ws, await doc(4), 0), otherKey = `photo-post:${ws}:${other.id}`;
  meta(memory).set(key(otherKey), { key: otherKey, value: { ...damaged, id: other.id } });
  const list = row(memory, `photo-posts:${ws}`); list.splice(list.findIndex(entry => entry.id === other.id), 1);
  assert.equal((await storage.listPhotoPosts(ws)).find(summary => summary.id === other.id)?.title, '글 4');
  meta(memory).delete(key(`photo-summary:${ws}:${other.id}`));
  assert.equal((await storage.listPhotoPosts(ws)).some(summary => summary.id === other.id), false);
  assert.deepEqual(row(memory, otherKey), { ...damaged, id: other.id });
  storage.close();
});

test('a synced post whose document fails validation keeps its binding: sync downloads nothing again, and a backup reports it', async () => {
  const cloud = server(), time = clock(Date.UTC(2026, 10, 11, 12)), a = await device(cloud, 'mac', { time });
  const saved = await a.storage.savePhotoPost(a.ws, await post({ title: '사진 글', body: '본문', photos: 2, time: new Date(time.now - 3600000).toISOString() }), 0);
  await a.sync.syncNow(); await a.sync.syncNow();
  assert.equal(cloud.rows.size, 1);
  const docKey = `photo-post:${a.ws}:${saved.id}`; meta(a.memory).get(key(docKey)).value.photos = 'broken';
  meta(a.memory).delete(key(`photo-summary:${a.ws}:${saved.id}`));
  const downloads = cloud.stats.downloads, saves = cloud.stats.saves.length;
  for (let n = 0; n < 5; n++) { time.advance(31000); await a.sync.syncNow(); }
  assert.equal(cloud.stats.downloads - downloads, 0, 'no download per cycle (review probe P7: 10 in 5 cycles)');
  assert.equal(cloud.stats.saves.length - saves, 0); assert.equal(cloud.rows.size, 1);
  assert.deepEqual((await a.storage.listPhotoPosts(a.ws)).map(summary => summary.id), [saved.id]);
  // The full backup lists it and reports that it could not be read, as before the per-post rows.
  const data = new Map([[PlatformData.keys(owner.userId).registry, JSON.stringify({ docs: [], current: null })]]);
  const context = { storage: a.storage, timeline: () => Full.timelineSnapshot({ platformData: PlatformData, localStorage: { getItem: name => data.has(name) ? data.get(name) : null }, uid: owner.userId }), originals: null };
  const plan = await Full.plan(context);
  assert.equal(plan.tasks.filter(task => task.kind === 'photoPosts' && task.postId === saved.id).length, 1, 'the backup plans it');
  const failed = await Full.writer(plan, context, { appVersion: 'haedo-test' }).collect();
  assert.equal(failed.length, 1, 'and reports one failure, never leaves it out silently');
  assert.match(JSON.stringify(failed[0]), new RegExp('photoPosts:[0-9]+:' + saved.id));
});

test('readPostSummaries reads a few posts by the list rule; listBlogSyncStates({ posts: false }) reads no list', async () => {
  const { memory, idb } = counted(), storage = open(idb), ws = (await storage.createWorkspace('몇 개만')).workspaceId, ids = [];
  for (let n = 0; n < 5; n++) ids.push((await storage.savePhotoPost(ws, await doc(n), 0)).id);
  const list = await storage.listPhotoPosts(ws), byId = new Map(list.map(summary => [summary.id, summary]));
  assert.deepEqual(await storage.readPostSummaries(ws, [ids[3], 'missing-synthetic-id', ids[0]]), [byId.get(ids[3]), null, byId.get(ids[0])]);
  // A write by an earlier version (its entry differs from the row) is read from the document.
  const earlier = open(idb, Previous), old = await earlier.readPhotoPost(ws, ids[1]);
  await earlier.savePhotoPost(ws, { ...old, title: '이전 판 제목' }, old.revision); earlier.close();
  const [fresh] = await storage.readPostSummaries(ws, [ids[1]]);
  assert.deepEqual([fresh.title, fresh.revision, fresh.createdAt], ['이전 판 제목', 2, old.createdAt]);
  // A row and entry left behind by a raw deletion are not trusted without the document.
  meta(memory).delete(key(`photo-post:${ws}:${ids[2]}`));
  assert.deepEqual(await storage.readPostSummaries(ws, [ids[2]]), [null]);
  await assert.rejects(storage.readPostSummaries(ws, ['']), { code: 'invalid_request' });
  storage.close();
  const synced = await device(server(), 'mac'), states = await synced.storage.listBlogSyncStates(synced.ws, { posts: false });
  assert.deepEqual(Object.keys(states).sort(), ['issues', 'states', 'tombstones']);
  await assert.rejects(synced.storage.listBlogSyncStates(synced.ws, { posts: 'no' }), { code: 'invalid_request' });
});

test('a save with the list row damaged first rebuilds it, so an earlier version never reads a partial list', async () => {
  for (const value of [undefined, { unsupported: true }, 'text']) {
    const { memory, idb } = counted(), storage = open(idb), ws = (await storage.createWorkspace('목록 손상')).workspaceId, ids = [];
    for (let n = 0; n < 5; n++) ids.push((await storage.savePhotoPost(ws, await doc(n), 0)).id);
    if (value === undefined) meta(memory).delete(key(`photo-posts:${ws}`)); else meta(memory).set(key(`photo-posts:${ws}`), { key: `photo-posts:${ws}`, value });
    const saved = await storage.savePhotoPost(ws, await doc(5), 0);
    assert.deepEqual(row(memory, `photo-posts:${ws}`).map(entry => entry.id).sort(), [...ids, saved.id].sort(), String(value));
    // And a deletion with it missing as well.
    meta(memory).delete(key(`photo-posts:${ws}`));
    await storage.deletePhotoPost(ws, ids[0], 1);
    assert.deepEqual(row(memory, `photo-posts:${ws}`).map(entry => entry.id).sort(), [...ids.slice(1), saved.id].sort());
    assert.equal(row(memory, `photo-summary:${ws}:${ids[0]}`), undefined);
    storage.close();
  }
});

test('beside 250 posts a save writes that post\'s document and row, and the whole-list row once; no other post row', async () => {
  const { memory, reads, idb } = counted(), storage = open(idb), ws = (await storage.createWorkspace('250개')).workspaceId;
  for (let n = 0; n < 250; n++) await storage.savePhotoPost(ws, await doc(n), 0);
  let draft = await storage.savePhotoPost(ws, await doc(300, { status: 'draft', body: '쓰는 중' }), 0);
  await storage.listPhotoPosts(ws);
  for (let n = 0; n < 3; n++) {
    const from = memory.control.writes.length; reads.docs = 0;
    draft = await storage.savePhotoPost(ws, { ...draft, ops: [{ insert: LONG + ' 자동 저장 ' + n + '\n' }], updatedAt: iso(400 + n) }, draft.revision);
    assert.deepEqual(writes(memory, from), [`photo-post:${ws}:${draft.id}`, `photo-summary:${ws}:${draft.id}`, `photo-posts:${ws}`]);
    assert.equal(reads.docs, 1, 'only the document being saved is read');
  }
  assert.equal(row(memory, `photo-summary:${ws}:${draft.id}`).body, Photo.plainText(draft));
  // Finishing an editing draft of a saved post removes that post's row with its document.
  const target = (await storage.listPhotoPosts(ws)).find(summary => summary.title === '글 7'), saved = await storage.readPhotoPost(ws, target.id);
  const editing = await storage.savePhotoPost(ws, { ...saved, id: Core.id(), revision: 0, status: 'draft', replaces: { id: saved.id, revision: saved.revision }, title: '고치는 글 7' }, 0);
  const from = memory.control.writes.length;
  const done = await storage.savePhotoPost(ws, { ...editing, status: 'saved' }, editing.revision);
  assert.deepEqual(writes(memory, from).filter(id => id.startsWith('photo-')).sort(), [`photo-post:${ws}:${saved.id}`, `photo-summary:${ws}:${saved.id}`, `photo-post:${ws}:${done.id}`, `photo-summary:${ws}:${done.id}`, `photo-posts:${ws}`].sort());
  assert.equal(row(memory, `photo-summary:${ws}:${saved.id}`), undefined);
  assert.equal(row(memory, `photo-summary:${ws}:${done.id}`).createdAt, saved.createdAt, 'the finished post keeps when it was first written');
  assert.equal((await storage.listPhotoPosts(ws)).length, 251);
  storage.close();
});

test('no cap: the 201st and the 251st post and draft are stored and listed', async () => {
  const storage = open(memoryIdb().idb), ws = (await storage.createWorkspace('상한 없음')).workspaceId;
  for (let n = 0; n < 251; n++) {
    const saved = await storage.savePhotoPost(ws, await doc(n, { status: n % 2 ? 'draft' : 'saved', body: '본문 ' + n }), 0);
    if (n === 200 || n === 250) assert.equal((await storage.listPhotoPosts(ws)).find(summary => summary.id === saved.id)?.title, '글 ' + n);
  }
  assert.equal((await storage.listPhotoPosts(ws)).length, 251);
  storage.close();
});

test('an app version up to haedo-v220 on the same database sees every post, refuses its own 251st, and its writes are read again', async () => {
  const { memory, idb } = counted(), storage = open(idb), ws = (await storage.createWorkspace('두 판')).workspaceId, ids = [];
  for (let n = 0; n < 250; n++) ids.push((await storage.savePhotoPost(ws, await doc(n), 0)).id);
  const earlier = open(idb, Previous);
  // It lists, syncs and backs up from the whole-list row: every post with its exact revision and state.
  const want = await expected(storage, ws, ids), seen = await earlier.listPhotoPosts(ws);
  assert.equal(seen.length, 250);
  const exact = list => list.map(item => [item.id, item.revision, item.status, item.title, item.updatedAt, item.archived]).sort();
  assert.deepEqual(exact(seen), exact(want));
  assert.deepEqual(exact((await earlier.listBlogSyncStates(ws)).posts), exact(want), 'its BlogSync compares the exact revisions, so nothing reads as changed');
  // Its own cap counts that row: a post it starts is refused with its message; nothing is written or dropped.
  const before = structuredClone([...meta(memory)]);
  await assert.rejects(earlier.savePhotoPost(ws, await doc(500), 0), error => error.code === 'photo_post_limit' && /합계 200개/.test(error.message));
  assert.deepEqual([...meta(memory)], before, 'a refused save changes nothing');
  // Saving a post that is here is not refused there; the new version then reads that post from its document.
  const old = await earlier.readPhotoPost(ws, ids[10]);
  const changed = await earlier.savePhotoPost(ws, { ...old, title: '이전 판에서 고친 제목', ops: [{ insert: LONG + ' 이전 판\n' }], updatedAt: iso(600) }, old.revision);
  let list = await storage.listPhotoPosts(ws), mine = list.find(summary => summary.id === ids[10]);
  assert.equal(mine.title, '이전 판에서 고친 제목'); assert.equal(mine.revision, changed.revision); assert.equal(mine.body, Photo.plainText(changed));
  assert.equal(mine.createdAt, old.createdAt); assert.deepEqual(row(memory, `photo-summary:${ws}:${ids[10]}`), mine);
  // An editing draft it finishes replaces the post: the new version drops the replaced post's row.
  const target = await earlier.readPhotoPost(ws, ids[20]);
  const draft = await earlier.savePhotoPost(ws, { ...target, id: Core.id(), revision: 0, status: 'draft', replaces: { id: target.id, revision: target.revision }, title: '이전 판 수정본' }, 0);
  const finished = await earlier.savePhotoPost(ws, { ...draft, status: 'saved' }, draft.revision);
  // A deletion there is a deletion here.
  await earlier.deletePhotoPost(ws, ids[30], 1);
  list = await storage.listPhotoPosts(ws);
  assert.equal(list.length, 249); assert.equal(list.some(summary => [ids[20], ids[30]].includes(summary.id)), false);
  assert.equal(list.find(summary => summary.id === finished.id).title, '이전 판 수정본');
  assert.equal(row(memory, `photo-summary:${ws}:${ids[20]}`), undefined); assert.equal(row(memory, `photo-summary:${ws}:${ids[30]}`), undefined);
  assert.deepEqual(list, await expected(storage, ws, list.map(summary => summary.id)));
  // And the earlier version keeps seeing exactly what the new one writes.
  const fresh = await storage.savePhotoPost(ws, await doc(700), 0);
  assert.deepEqual(exact(await earlier.listPhotoPosts(ws)), exact(await storage.listPhotoPosts(ws)));
  assert.equal((await earlier.listPhotoPosts(ws)).some(item => item.id === fresh.id), true);
  earlier.close(); storage.close();
});

test('the list, account sync and preservation read the same rows; hidden posts and recovery copies keep their state', async () => {
  const storage = open(memoryIdb().idb), ws = (await storage.createWorkspace('읽는 곳')).workspaceId;
  const shown = await storage.savePhotoPost(ws, await doc(1), 0);
  const hidden = await storage.savePhotoPost(ws, { ...(await doc(2)), archived: true }, 0);
  const copy = await storage.savePhotoPost(ws, await post({ title: '복구 사본 · 글', status: 'draft', time: iso(3) }), 0);
  const list = await storage.listPhotoPosts(ws);
  assert.deepEqual(list.map(summary => [summary.id, summary.archived, summary.status]), [[shown.id, false, 'saved'], [hidden.id, true, 'saved'], [copy.id, false, 'draft']]);
  assert.deepEqual((await storage.listBlogSyncStates(ws)).posts, list);
  assert.deepEqual((await storage.readPreservationCatalog(ws)).posts.map(row => row.id), [shown.id, hidden.id]);
  storage.close();
});

test('a full backup of 250 posts restores all of them with their text and first-written time', async () => {
  const cloud = server(), time = clock(Date.UTC(2026, 10, 11, 12)), a = await device(cloud, 'mac', { time });
  for (let n = 0; n < 250; n++) await a.storage.savePhotoPost(a.ws, await doc(n, { status: n % 10 ? 'saved' : 'draft' }), 0);
  const data = new Map([[PlatformData.keys(owner.userId).registry, JSON.stringify({ docs: [], current: null })]]);
  const context = { storage: a.storage, timeline: () => Full.timelineSnapshot({ platformData: PlatformData, localStorage: { getItem: name => data.has(name) ? data.get(name) : null }, uid: owner.userId }), originals: null };
  const writer = Full.writer(await Full.plan(context), context, { appVersion: 'haedo-test' });
  assert.deepEqual(await writer.collect(), []);
  const built = writer.finish({ partial: false });
  assert.equal(built.manifest.files.filter(file => file.kind === 'photoPosts').length, 250);
  const target = createStorage({ idb: memoryIdb().idb, core: Core, channelFactory: null, account: { projectUrl: owner.projectUrl, userId: '99999999-2222-4333-8444-555555555555' } });
  const report = await Full.restore(await Full.open(built.blob), { storage: target, kinds: new Set(['photoPosts']), verifyPhoto: null });
  assert.deepEqual(report.items.filter(item => item.status !== 'restored'), []);
  const [copy] = await target.listWorkspaces(), restored = await target.listPhotoPosts(copy.workspaceId), original = await a.storage.listPhotoPosts(a.ws);
  const content = list => list.map(summary => [summary.status, summary.title, summary.body, summary.createdAt, summary.updatedAt].join('|')).sort();
  assert.equal(restored.length, 250); assert.deepEqual(content(restored), content(original));
  target.close();
});

'use strict';
// 2026-11-02 owner decision: a blog conflict keeps the later side with no
// exception for saved posts, and the other side is kept as a recovery copy
// named `복구 사본`. Times compared are the document write times (updatedAt);
// a server document is bounded by its server commit time (updated_at), and a
// tie keeps the server version. A saved server identity never returns to a
// draft and keeps its place and publication: a later draft becomes that post's
// editing draft (finishing it updates the same post and public address), and
// the saved content is also kept as a private recovery copy.
const test = require('node:test'), assert = require('node:assert/strict');
const { server, device, clock, post, edit, finish, png, Core, Photo } = require('./helpers/blog-sync-cloud.cjs');

const KEPT = '복구 사본 · ';
async function pair() {
  const cloud = server(), time = clock();
  return { cloud, time, a: await device(cloud, 'mac', { time }), b: await device(cloud, 'ipad', { time }) };
}
const save = (dev, doc) => dev.storage.savePhotoPost(dev.ws, doc, 0);
const list = dev => dev.storage.listPhotoPosts(dev.ws);
const shown = async dev => (await list(dev)).map(row => [row.status, row.title]).sort();
const bytes = async blob => Buffer.from(await blob.arrayBuffer()).toString('hex');
const at = (time, minutes) => new Date(time.now + minutes * 60000).toISOString();
const byTitle = async (dev, title) => dev.storage.readPhotoPost(dev.ws, (await list(dev)).find(row => row.title === title).id);
async function heic() {
  const original = new Blob([Buffer.from('000000186674797068656963000000006d69663168656963', 'hex'), new Uint8Array(32)], { type: 'image/heic' });
  const view = new Blob([Uint8Array.from([255, 216, 255, 224, 5, 6, 7, 255, 217])], { type: 'image/jpeg' });
  return { original, view, photo: { id: Core.id(), name: 'IMG_0002.HEIC', type: 'image/heic', width: 4032, height: 3024, size: original.size, digest: await Photo.digest(original), blob: original,
    view: { type: 'image/jpeg', size: view.size, digest: await Photo.digest(view), width: 4032, height: 3024, blob: view } } };
}
// A draft written on A, received by the others; `finisher` then finishes it (draft -> saved).
async function finishedOn({ time, a, others = [], finisher }, { photo = null, publish = false } = {}) {
  const doc = await post({ title: '쓰는 중', status: 'draft', time: '2026-11-01T09:00:00.000Z' });
  if (photo) { doc.photos = [photo]; doc.ops = [{ insert: '본문\n' }, { insert: { photo: { id: photo.id, caption: '', alt: '' } } }, { insert: '\n' }]; }
  const draft = await save(a, doc);
  time.advance(60000); await a.sync.syncNow({ flushDrafts: true });
  for (const dev of others) await dev.sync.syncNow();
  const cur = await finisher.storage.readPhotoPost(finisher.ws, draft.id);
  const done = await finisher.storage.savePhotoPost(finisher.ws, { ...cur, status: 'saved', title: '완성', updatedAt: '2026-11-01T10:00:00.000Z' }, cur.revision);
  await finisher.sync.saveDefault(finisher.ws, done.id, { expectedLocalRevision: done.revision });
  if (publish) await finisher.sync.publish(finisher.ws, done.id, { expectedLocalRevision: done.revision });
  return draft.id;
}
const finishedOnB = (env, options) => finishedOn({ ...env, others: [env.b], finisher: env.b }, options);
async function redraft(dev, id, title, updatedAt) {
  const cur = await dev.storage.readPhotoPost(dev.ws, id);
  return dev.storage.savePhotoPost(dev.ws, { ...cur, title, updatedAt }, cur.revision);
}
async function cycles(dev, time, n = 3) { for (let i = 0; i < n; i++) { time.advance(20 * 60000); await dev.sync.syncNow({ flushDrafts: true }); } }
const LATER_DRAFT = [['draft', KEPT + '완성'], ['draft', '맥에서 더 쓴 초안'], ['saved', '완성']].sort();

test('a draft edited later than the saved version wins as that post\'s editing draft; the saved content is also kept; photos and the HEIC pair stay exact', async () => {
  const env = await pair(), { cloud, time, a, b } = env, { original, view, photo } = await heic();
  const id = await finishedOnB(env, { photo });
  await redraft(a, id, '맥에서 더 쓴 초안', '2026-11-01T10:05:00.000Z');
  // An open editor holds the post: nothing is decided over its unsaved input.
  const release = a.sync.holdPost(a.ws, id);
  await cycles(a, time, 1);
  assert.deepEqual(await shown(a), [['draft', '맥에서 더 쓴 초안']], 'held: the open draft is untouched');
  release(); await cycles(a, time);
  assert.deepEqual(await shown(a), LATER_DRAFT);
  const placed = await a.storage.readPhotoPost(a.ws, id), later = await byTitle(a, '맥에서 더 쓴 초안'), kept = await byTitle(a, KEPT + '완성');
  assert.equal(placed.status, 'saved'); assert.equal(placed.title, '완성', 'the saved post stays in place, unchanged');
  assert.deepEqual(later.replaces, { id, revision: placed.revision }, 'the later draft edits that exact saved revision');
  assert.equal(later.updatedAt, '2026-11-01T10:05:00.000Z', 'the winning draft keeps its own write time');
  assert.equal(kept.replaces, null); assert.equal(kept.updatedAt, '2026-11-01T10:00:00.000Z');
  for (const doc of [placed, later, kept]) { assert.equal(await bytes(doc.photos[0].blob), await bytes(original)); assert.equal(await bytes(doc.photos[0].view.blob), await bytes(view)); }
  assert.equal(cloud.rows.get(id).data.title, '완성'); assert.equal(cloud.rows.get(later.id).data.status, 'draft');
  assert.deepEqual(cloud.rows.get(later.id).data.replaces, { id, revision: cloud.rows.get(id).revision });
  assert.equal(cloud.rows.get(later.id).data.photos[0].view.digest, photo.view.digest, 'the HEIC original and its view travel together');
  assert.equal(a.sync.getStatus().state, 'synced');
  await cycles(b, time, 2);
  assert.deepEqual(await shown(b), LATER_DRAFT, 'the finishing device converges');
  const received = await b.storage.readPhotoPost(b.ws, later.id);
  assert.deepEqual(received.replaces, { id, revision: (await b.storage.readPhotoPost(b.ws, id)).revision }, 'the other device has the same editing link');
  assert.equal(await bytes(received.photos[0].blob), await bytes(original)); assert.equal(await bytes(received.photos[0].view.blob), await bytes(view));
  // Finishing the winning draft updates the same post on every device.
  const done = await finish(a, later, '2026-11-01T10:10:00.000Z');
  await a.sync.saveDefault(a.ws, done.id, { expectedLocalRevision: done.revision }); await cycles(a, time, 1);
  assert.equal(cloud.rows.get(id).data.title, '맥에서 더 쓴 초안'); assert.equal(cloud.rows.has(later.id), false, 'the editing draft is retired on the server');
  await cycles(b, time, 2);
  assert.deepEqual(await shown(b), [['draft', KEPT + '완성'], ['saved', '맥에서 더 쓴 초안']]);
});

test('a post saved later than a draft wins, from either device; the draft is the recovery copy', async () => {
  // The saving device has not seen the other device's draft edit yet.
  {
    const { cloud, time, a, b } = await pair();
    const draft = await save(a, await post({ title: '쓰는 중', status: 'draft', time: '2026-11-01T09:00:00.000Z' }));
    time.advance(60000); await a.sync.syncNow({ flushDrafts: true }); await b.sync.syncNow();
    await redraft(b, draft.id, '아이패드 초안', '2026-11-01T10:00:00.000Z');
    await cycles(b, time, 1); assert.equal(cloud.rows.get(draft.id).data.title, '아이패드 초안');
    const aCur = await a.storage.readPhotoPost(a.ws, draft.id);
    const done = await a.storage.savePhotoPost(a.ws, { ...aCur, status: 'saved', title: '완성', updatedAt: '2026-11-01T10:30:00.000Z' }, aCur.revision);
    await a.sync.saveDefault(a.ws, done.id, { expectedLocalRevision: done.revision }).catch(() => {});
    await cycles(a, time, 2);
    assert.deepEqual(await shown(a), [['draft', KEPT + '아이패드 초안'], ['saved', '완성']]);
    assert.equal(cloud.rows.get(draft.id).data.status, 'saved'); assert.equal(cloud.rows.get(draft.id).data.title, '완성');
    await cycles(b, time, 2);
    assert.deepEqual(await shown(b), [['draft', KEPT + '아이패드 초안'], ['saved', '완성']]);
  }
  // The drafting device learns of the later save.
  {
    const env = await pair(), { time, a } = env;
    const id = await finishedOnB(env);
    await redraft(a, id, '맥 이른 초안', '2026-11-01T09:30:00.000Z');
    await cycles(a, time);
    assert.deepEqual(await shown(a), [['draft', KEPT + '맥 이른 초안'], ['saved', '완성']]);
    assert.equal((await a.storage.readPhotoPost(a.ws, id)).status, 'saved');
  }
});

test('equal write times keep the server version on every device, deterministically', async () => {
  const { cloud, time, a, b } = await pair();
  const doc = await save(a, await post({ title: '원래 글' })); await a.sync.syncNow(); await b.sync.syncNow();
  const aDraft = await edit(a, doc.id, { title: '맥 수정' }, '2026-11-01T10:00:00.000Z'); await finish(a, aDraft, '2026-11-01T10:00:00.000Z');
  const bDraft = await edit(b, doc.id, { title: '아이패드 수정' }, '2026-11-01T10:00:00.000Z'); await finish(b, bDraft, '2026-11-01T10:00:00.000Z');
  time.advance(60000); await a.sync.syncNow(); assert.equal(cloud.rows.get(doc.id).data.title, '맥 수정');
  await b.sync.syncNow();
  assert.equal(cloud.rows.get(doc.id).data.title, '맥 수정', 'the version the server already holds stays');
  await cycles(b, time, 1); await cycles(a, time, 2);
  const expected = [['draft', KEPT + '아이패드 수정'], ['saved', '맥 수정']];
  assert.deepEqual(await shown(b), expected); assert.deepEqual(await shown(a), expected);
  // A tie between this device's draft and a saved server version also keeps the server version.
  const env = await pair(), id = await finishedOnB(env);
  await redraft(env.a, id, '같은 시각 초안', '2026-11-01T10:00:00.000Z');
  await cycles(env.a, env.time);
  assert.deepEqual(await shown(env.a), [['draft', KEPT + '같은 시각 초안'], ['saved', '완성']]);
});

test('a device clock running ahead does not beat a later edit: the server commit time bounds its write time', async () => {
  const { cloud, time, a, b } = await pair();
  const doc = await save(a, await post({ title: '원래 글' })); await a.sync.syncNow(); await b.sync.syncNow();
  // B's clock is two hours fast: its edit claims a time two hours from now.
  const bDraft = await edit(b, doc.id, { title: '아이패드 (시계 빠름)' }, at(time, 120)); await finish(b, bDraft, at(time, 120));
  await b.sync.syncNow();
  assert.equal(cloud.rows.get(doc.id).data.title, '아이패드 (시계 빠름)');
  assert(Date.parse(cloud.rows.get(doc.id).updated_at) < Date.parse(at(time, 1)), 'the server stored it now, not two hours ahead');
  // A edits ten minutes later in real time, with a correct clock.
  time.advance(10 * 60000);
  const aDraft = await edit(a, doc.id, { title: '맥 나중 수정' }, at(time, 0)); await finish(a, aDraft, at(time, 0));
  await a.sync.syncNow();
  assert.equal(cloud.rows.get(doc.id).data.title, '맥 나중 수정', 'the later real edit wins');
  await cycles(a, time, 1); await cycles(b, time, 2);
  const expected = [['draft', KEPT + '아이패드 (시계 빠름)'], ['saved', '맥 나중 수정']];
  assert.deepEqual(await shown(a), expected); assert.deepEqual(await shown(b), expected);
});

test('a published post: the public address follows the later side and the public copy changes only by an explicit republish', async () => {
  // Later draft vs a saved and published version: the post and its publication stay in place.
  {
    const env = await pair(), { cloud, time, a, b } = env;
    const id = await finishedOnB(env, { publish: true });
    const before = structuredClone(cloud.rows.get(id).publication), publishes = cloud.stats.publishes.length;
    assert.equal(before.active, true);
    await redraft(a, id, '맥에서 더 쓴 초안', '2026-11-01T10:05:00.000Z');
    await cycles(a, time);
    assert.deepEqual(await shown(a), LATER_DRAFT);
    assert.equal(cloud.rows.get(id).data.title, '완성', 'the published post keeps its title');
    assert.deepEqual(cloud.rows.get(id).publication, before, 'no implicit publish or withdrawal');
    assert.equal(cloud.stats.publishes.length, publishes);
    const later = await byTitle(a, '맥에서 더 쓴 초안'), kept = await byTitle(a, KEPT + '완성');
    assert.equal((await a.storage.readBlogSyncState(a.ws, id)).publication.active, true, 'the post is shown as public: it still is');
    assert.equal((await a.storage.readBlogSyncState(a.ws, later.id)).publication, null, 'its editing draft is not shown as public');
    assert.equal((await a.storage.readBlogSyncState(a.ws, kept.id)).publication, null, 'the recovery copy is private');
    await cycles(b, time, 2);
    assert.deepEqual(await shown(b), LATER_DRAFT);
    assert.equal((await b.storage.readBlogSyncState(b.ws, id)).publication.active, true);
    // Finishing the later draft updates the same post; the public copy waits for an explicit republish at the same address.
    const done = await finish(a, later, '2026-11-01T10:10:00.000Z');
    await a.sync.saveDefault(a.ws, done.id, { expectedLocalRevision: done.revision });
    assert.equal(cloud.rows.get(id).data.title, '맥에서 더 쓴 초안');
    assert.deepEqual(cloud.rows.get(id).publication, before, 'saving does not republish');
    const state = await a.storage.readBlogSyncState(a.ws, done.id);
    assert.equal(state.remoteId, id); assert.equal(state.publication.active, true);
    await a.sync.publish(a.ws, done.id, { expectedLocalRevision: (await a.storage.readPhotoPost(a.ws, done.id)).revision, expectedPublicRevision: before.revision });
    assert.equal(cloud.rows.get(id).publication.token, before.token, 'the same public address');
    assert.equal(cloud.rows.get(id).publication.revision, before.revision + 1);
  }
  // Later saved edit vs a published server version: the publication stays with the post identity
  // (its public copy unchanged); the losing published content becomes a private draft copy.
  {
    const { cloud, time, a, b } = await pair();
    const doc = await save(a, await post({ title: '공개한 글' })); await a.sync.syncNow(); await b.sync.syncNow();
    const bDraft = await edit(b, doc.id, { title: '아이패드 공개 전 수정' }, '2026-11-01T10:00:00.000Z'); const bSaved = await finish(b, bDraft, '2026-11-01T10:00:00.000Z');
    await b.sync.publish(b.ws, bSaved.id, { expectedLocalRevision: bSaved.revision });
    const before = structuredClone(cloud.rows.get(doc.id).publication);
    const aDraft = await edit(a, doc.id, { title: '맥 나중 수정' }, '2026-11-01T11:00:00.000Z'); const aSaved = await finish(a, aDraft, '2026-11-01T11:00:00.000Z');
    time.advance(60000); await a.sync.syncNow(); await cycles(a, time, 1);
    assert.equal(cloud.rows.get(doc.id).data.title, '맥 나중 수정');
    assert.deepEqual(cloud.rows.get(doc.id).publication, before, 'the public copy is unchanged');
    assert.deepEqual(await shown(a), [['draft', KEPT + '아이패드 공개 전 수정'], ['saved', '맥 나중 수정']]);
    const copyRow = (await list(a)).find(row => row.status === 'draft');
    assert.equal((await a.storage.readBlogSyncState(a.ws, copyRow.id)).publication, null, 'the recovery copy is private');
    assert.equal((await a.storage.readBlogSyncState(a.ws, aSaved.id)).publication.active, true);
  }
});

test('sides with the same content make no recovery copy', async () => {
  // Two saved edits that end with the same title, body and photos.
  {
    const { cloud, time, a, b } = await pair();
    const doc = await save(a, await post({ title: '원래 글' })); await a.sync.syncNow(); await b.sync.syncNow();
    const aDraft = await edit(a, doc.id, { title: '같은 결과' }, '2026-11-01T10:00:00.000Z'); await finish(a, aDraft, '2026-11-01T10:00:00.000Z');
    const bDraft = await edit(b, doc.id, { title: '같은 결과' }, '2026-11-01T10:30:00.000Z'); await finish(b, bDraft, '2026-11-01T10:30:00.000Z');
    time.advance(60000); await a.sync.syncNow(); await cycles(b, time, 2); await cycles(a, time, 1);
    assert.deepEqual(await shown(b), [['saved', '같은 결과']]); assert.deepEqual(await shown(a), [['saved', '같은 결과']]);
    assert.equal(cloud.rows.size, 1);
  }
  // A later draft whose content equals the saved version: the saved version is simply applied.
  {
    const env = await pair(), { cloud, time, a } = env;
    const id = await finishedOnB(env);
    await redraft(a, id, '완성', '2026-11-01T10:05:00.000Z');
    await cycles(a, time);
    assert.deepEqual(await shown(a), [['saved', '완성']]); assert.equal(cloud.rows.size, 1);
  }
});

test('three devices: one saved post, one editing draft (the latest) and every other side kept once, with one prefix', async () => {
  for (const race of [false, true]) {
    const cloud = server(), time = clock();
    const a = await device(cloud, 'mac', { time }), b = await device(cloud, 'ipad', { time }), c = await device(cloud, 'iphone', { time });
    const id = await finishedOn({ time, a, others: [b, c], finisher: a });
    await redraft(b, id, 'B 초안', '2026-11-01T10:05:00.000Z');
    await redraft(c, id, 'C 초안', '2026-11-01T10:06:00.000Z');
    if (race) { time.advance(20 * 60000); await b.sync.syncNow({ flushDrafts: true }); await c.sync.syncNow({ flushDrafts: true }); }
    await cycles(b, time, 2); await cycles(c, time, 3); await cycles(b, time, 2); await cycles(a, time, 2); await cycles(c, time, 1);
    const expected = [['draft', 'C 초안'], ['draft', KEPT + 'B 초안'], ['draft', KEPT + '완성'], ['saved', '완성']].sort();
    for (const dev of [a, b, c]) assert.deepEqual(await shown(dev), expected, (race ? 'race ' : 'sequential ') + dev.name);
    const later = await byTitle(a, 'C 초안');
    assert.deepEqual(later.replaces, { id, revision: (await a.storage.readPhotoPost(a.ws, id)).revision }, 'the latest draft is the editing draft');
    assert.equal((await byTitle(a, KEPT + 'B 초안')).replaces, null, 'the earlier draft is a plain recovery copy');
    assert.equal(cloud.rows.size, 4);
  }
  // A recovery copy that itself loses a conflict keeps a single prefix.
  const { time, a, b } = await pair();
  const memo = await save(a, await post({ title: KEPT + '메모', status: 'draft', time: '2026-11-01T09:00:00.000Z' }));
  time.advance(60000); await a.sync.syncNow({ flushDrafts: true }); await b.sync.syncNow();
  await a.storage.savePhotoPost(a.ws, { ...(await a.storage.readPhotoPost(a.ws, memo.id)), ops: [{ insert: '맥 본문\n' }], updatedAt: '2026-11-01T10:00:00.000Z' }, 1);
  await cycles(a, time, 1);
  await b.storage.savePhotoPost(b.ws, { ...(await b.storage.readPhotoPost(b.ws, memo.id)), ops: [{ insert: '아이패드 본문\n' }], updatedAt: '2026-11-01T09:30:00.000Z' }, 1);
  await cycles(b, time, 2);
  // The losing side was written at 09:30 (UTC) on B; its copy carries that local time.
  const lost = new Date('2026-11-01T09:30:00.000Z'), two = value => String(value).padStart(2, '0');
  const stamp = ' (' + two(lost.getMonth() + 1) + '-' + two(lost.getDate()) + ' ' + two(lost.getHours()) + ':' + two(lost.getMinutes()) + ')';
  assert.deepEqual(await shown(b), [['draft', KEPT + '메모'], ['draft', KEPT + '메모' + stamp]].sort(), 'one prefix, and the copy is told apart by its write time');
  assert.equal((await byTitle(b, KEPT + '메모' + stamp)).ops[0].insert, '아이패드 본문\n');
  assert.equal((await byTitle(b, KEPT + '메모')).ops[0].insert, '맥 본문\n');
});

test('an explicit deletion wins over a decided, not yet uploaded conflict: the deleted post is not recreated', async () => {
  const env = await pair(), { cloud, time, a, b } = env;
  const id = await finishedOn({ time, a, others: [b], finisher: a });
  await redraft(b, id, 'B 초안', '2026-11-01T10:05:00.000Z');
  // B decides during its upload phase; the timer that would upload the result never fires here.
  time.advance(20 * 60000); await b.sync.syncNow({ flushDrafts: true, uploadOnly: true });
  assert.deepEqual(await shown(b), [['draft', 'B 초안'], ['draft', KEPT + '완성'], ['saved', '완성']]);
  await a.sync.syncNow(); await a.sync.deletePost(a.ws, id); await a.sync.syncNow();
  assert.equal(cloud.rows.has(id), false);
  await cycles(b, time, 3); await cycles(a, time, 2);
  for (const dev of [a, b]) {
    assert.deepEqual(await shown(dev), [['draft', 'B 초안']], dev.name + ': the deleted post and its untouched recovery copy stay deleted; the later draft keeps its content');
    assert.equal((await byTitle(dev, 'B 초안')).replaces, null, dev.name + ': the editing draft of the deleted post is now a post of its own');
  }
  assert.equal(cloud.rows.has(id), false);
  assert.deepEqual([...cloud.rows.values()].map(row => [row.data.status, row.data.title, row.data.replaces]), [['draft', 'B 초안', null]]);
});

test('deleting only the saved post keeps its recovery copy that was already visible to the deleting device, on every device', async () => {
  const { cloud, time, a, b } = await pair();
  const id = await finishedOn({ time, a, others: [b], finisher: a });
  await redraft(b, id, 'B 초안', '2026-11-01T10:05:00.000Z');
  await cycles(b, time, 2); await cycles(a, time, 2);
  assert.deepEqual(await shown(a), [['draft', 'B 초안'], ['draft', KEPT + '완성'], ['saved', '완성']], 'the owner sees the copy before deleting');
  await a.sync.deletePost(a.ws, id); await cycles(a, time, 1);
  await cycles(b, time, 2); await cycles(a, time, 2);
  const expected = [['draft', 'B 초안'], ['draft', KEPT + '완성']];
  assert.deepEqual(await shown(a), expected); assert.deepEqual(await shown(b), expected);
  assert.deepEqual([...cloud.rows.values()].map(row => [row.data.status, row.data.title]).sort(), expected);
  assert.equal(cloud.stats.deletes.filter(call => call.postId !== id).length, 0, 'only the deleted post was deleted');
});

test('a device that already received another device\'s result for the same saved revision makes no duplicates', async () => {
  const cloud = server(), time = clock();
  const a = await device(cloud, 'mac', { time }), b = await device(cloud, 'ipad', { time }), c = await device(cloud, 'iphone', { time });
  const id = await finishedOn({ time, a, others: [b, c], finisher: a });
  await redraft(b, id, 'B 초안', '2026-11-01T10:05:00.000Z');
  await cycles(b, time, 2);
  // C's own later draft was just written, so its first cycle receives B's results before deciding.
  time.advance(20 * 60000); await redraft(c, id, 'C 초안', at(time, 0));
  await c.sync.syncNow();
  await cycles(c, time, 3); await cycles(b, time, 2); await cycles(a, time, 2); await cycles(c, time, 1);
  const expected = [['draft', 'C 초안'], ['draft', KEPT + 'B 초안'], ['draft', KEPT + '완성'], ['saved', '완성']].sort();
  for (const dev of [a, b, c]) assert.deepEqual(await shown(dev), expected, dev.name);
  const later = await byTitle(c, 'C 초안');
  assert.deepEqual(later.replaces, { id, revision: (await c.storage.readPhotoPost(c.ws, id)).revision });
  assert.equal(cloud.rows.size, 4);
  const saves = cloud.stats.saves.length;
  await cycles(a, time, 1); await cycles(b, time, 1); await cycles(c, time, 1);
  assert.equal(cloud.stats.saves.length, saves, 'settled: nothing is sent again');
});

test('a recovery copy that was changed after the conflict survives the deletion of the post it came from', async () => {
  const env = await pair(), { cloud, time, a, b } = env;
  const id = await finishedOn({ time, a, others: [b], finisher: a });
  await redraft(b, id, 'B 초안', '2026-11-01T10:05:00.000Z');
  await cycles(b, time, 2);
  const kept = await byTitle(b, KEPT + '완성');
  await b.storage.savePhotoPost(b.ws, { ...kept, ops: [{ insert: '사본에 덧붙인 문장\n' }], updatedAt: at(time, 0) }, kept.revision);
  await cycles(b, time, 1);
  await a.sync.syncNow(); await a.sync.deletePost(a.ws, id); await a.sync.syncNow();
  await cycles(b, time, 2); await cycles(a, time, 2);
  for (const dev of [a, b]) assert.deepEqual(await shown(dev), [['draft', 'B 초안'], ['draft', KEPT + '완성']], dev.name);
  assert.equal(cloud.rows.has(id), false);
});

test('an editor opened while a conflict or a newer version downloads is never overwritten', async () => {
  const { cloud, time, a, b } = await pair();
  const doc = await save(a, await post({ title: '원래 글', photos: 1 })); await a.sync.syncNow(); await b.sync.syncNow();
  // The editor opens the post right after the first original arrives.
  const holdDuringDownload = (dev, id) => {
    const download = dev.remote.downloadAsset; let release = null;
    dev.remote.downloadAsset = async asset => { const value = await download.call(dev.remote, asset); if (!release) release = dev.sync.holdPost(dev.ws, id); return value; };
    return () => { dev.remote.downloadAsset = download; release?.(); };
  };
  // A newer server version over a clean local copy.
  const aSaved = await finish(a, await edit(a, doc.id, { title: '맥 수정' }, '2026-11-01T10:00:00.000Z'), '2026-11-01T10:00:00.000Z'); await a.sync.syncNow();
  let release = holdDuringDownload(b, doc.id); await b.sync.syncNow();
  assert.equal((await b.storage.readPhotoPost(b.ws, doc.id)).title, '원래 글', 'not applied under the open editor');
  release(); await cycles(b, time, 1);
  assert.equal((await b.storage.readPhotoPost(b.ws, doc.id)).title, '맥 수정', 'applied after release');
  // A conflict the server side wins.
  const bEdit = await finish(b, await edit(b, doc.id, { title: '아이패드 이른 수정' }, '2026-11-01T10:30:00.000Z'), '2026-11-01T10:30:00.000Z');
  await finish(a, await edit(a, aSaved.id, { title: '맥 늦은 수정' }, '2026-11-01T11:00:00.000Z'), '2026-11-01T11:00:00.000Z'); await a.sync.syncNow();
  release = holdDuringDownload(b, bEdit.id);
  await b.sync.syncNow();
  assert.deepEqual(await shown(b), [['saved', '아이패드 이른 수정']], 'nothing decided under the open editor');
  release(); await cycles(b, time, 1);
  assert.deepEqual(await shown(b), [['draft', KEPT + '아이패드 이른 수정'], ['saved', '맥 늦은 수정']]);
  assert.equal(cloud.rows.get(doc.id).data.title, '맥 늦은 수정');
});

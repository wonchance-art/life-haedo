'use strict';
// 2026-11-02 owner decision: a blog conflict keeps the later side with no
// exception for saved posts, and the other side is kept as a recovery copy
// named `복구 사본`. Times compared are the document write times (updatedAt);
// a server document is bounded by its server commit time (updated_at), and a
// tie keeps the server version. A saved server identity never returns to a
// draft and keeps its publication, so a later draft continues as a new draft
// while the saved version is renamed in place.
const test = require('node:test'), assert = require('node:assert/strict');
const { server, device, clock, post, edit, finish, Core, Photo } = require('./helpers/blog-sync-cloud.cjs');

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
async function heic() {
  const original = new Blob([Buffer.from('000000186674797068656963000000006d69663168656963', 'hex'), new Uint8Array(32)], { type: 'image/heic' });
  const view = new Blob([Uint8Array.from([255, 216, 255, 224, 5, 6, 7, 255, 217])], { type: 'image/jpeg' });
  return { original, view, photo: { id: Core.id(), name: 'IMG_0002.HEIC', type: 'image/heic', width: 4032, height: 3024, size: original.size, digest: await Photo.digest(original), blob: original,
    view: { type: 'image/jpeg', size: view.size, digest: await Photo.digest(view), width: 4032, height: 3024, blob: view } } };
}
// A draft written on A, received by B; B then finishes it (draft -> saved).
async function finishedOnB({ cloud, time, a, b }, { photo = null, publish = false } = {}) {
  const doc = await post({ title: '쓰는 중', status: 'draft', time: '2026-11-01T09:00:00.000Z' });
  if (photo) { doc.photos = [photo]; doc.ops = [{ insert: '본문\n' }, { insert: { photo: { id: photo.id, caption: '', alt: '' } } }, { insert: '\n' }]; }
  const draft = await save(a, doc);
  time.advance(60000); await a.sync.syncNow({ flushDrafts: true }); await b.sync.syncNow();
  const bCur = await b.storage.readPhotoPost(b.ws, draft.id);
  const done = await b.storage.savePhotoPost(b.ws, { ...bCur, status: 'saved', title: '완성', updatedAt: '2026-11-01T10:00:00.000Z' }, bCur.revision);
  await b.sync.saveDefault(b.ws, done.id, { expectedLocalRevision: done.revision });
  if (publish) await b.sync.publish(b.ws, done.id, { expectedLocalRevision: done.revision });
  assert.equal(cloud.rows.get(draft.id).data.status, 'saved');
  return draft.id;
}
async function cycles(dev, time, n = 3) { for (let i = 0; i < n; i++) { time.advance(20 * 60000); await dev.sync.syncNow({ flushDrafts: true }); } }

test('a draft edited later than the saved version wins; the saved version stays saved as the recovery copy, photos and HEIC pair intact', async () => {
  const env = await pair(), { cloud, time, a, b } = env, { original, view, photo } = await heic();
  const id = await finishedOnB(env, { photo });
  const aCur = await a.storage.readPhotoPost(a.ws, id);
  await a.storage.savePhotoPost(a.ws, { ...aCur, title: '맥에서 더 쓴 초안', updatedAt: '2026-11-01T10:05:00.000Z' }, aCur.revision);
  // An open editor holds the post: nothing is decided over its unsaved input.
  const release = a.sync.holdPost(a.ws, id);
  await cycles(a, time, 1);
  assert.deepEqual(await shown(a), [['draft', '맥에서 더 쓴 초안']], 'held: the open draft is untouched');
  release(); await cycles(a, time);
  assert.deepEqual(await shown(a), [['draft', '맥에서 더 쓴 초안'], ['saved', KEPT + '완성']]);
  const kept = await a.storage.readPhotoPost(a.ws, id), winner = (await list(a)).find(row => row.id !== id);
  assert.equal(kept.status, 'saved', 'the server identity stays saved');
  const current = await a.storage.readPhotoPost(a.ws, winner.id);
  assert.equal(current.updatedAt, '2026-11-01T10:05:00.000Z', 'the winning draft keeps its own write time');
  for (const doc of [kept, current]) { assert.equal(await bytes(doc.photos[0].blob), await bytes(original)); assert.equal(await bytes(doc.photos[0].view.blob), await bytes(view)); }
  assert.equal(cloud.rows.get(id).data.title, KEPT + '완성'); assert.equal(cloud.rows.get(winner.id).data.status, 'draft');
  assert.equal(cloud.rows.get(winner.id).data.photos[0].view.digest, photo.view.digest, 'the HEIC original and its view travel together');
  assert.equal(a.sync.getStatus().state, 'synced');
  await cycles(b, time, 2);
  assert.deepEqual(await shown(b), [['draft', '맥에서 더 쓴 초안'], ['saved', KEPT + '완성']], 'the finishing device converges');
  const received = await b.storage.readPhotoPost(b.ws, winner.id);
  assert.equal(await bytes(received.photos[0].blob), await bytes(original)); assert.equal(await bytes(received.photos[0].view.blob), await bytes(view));
});

test('a post saved later than a draft wins, from either device; the draft is the recovery copy', async () => {
  // The saving device has not seen the other device's draft edit yet.
  {
    const { cloud, time, a, b } = await pair();
    const draft = await save(a, await post({ title: '쓰는 중', status: 'draft', time: '2026-11-01T09:00:00.000Z' }));
    time.advance(60000); await a.sync.syncNow({ flushDrafts: true }); await b.sync.syncNow();
    const bCur = await b.storage.readPhotoPost(b.ws, draft.id);
    await b.storage.savePhotoPost(b.ws, { ...bCur, title: '아이패드 초안', updatedAt: '2026-11-01T10:00:00.000Z' }, bCur.revision);
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
    const aCur = await a.storage.readPhotoPost(a.ws, id);
    await a.storage.savePhotoPost(a.ws, { ...aCur, title: '맥 이른 초안', updatedAt: '2026-11-01T09:30:00.000Z' }, aCur.revision);
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
  const aCur = await env.a.storage.readPhotoPost(env.a.ws, id);
  await env.a.storage.savePhotoPost(env.a.ws, { ...aCur, title: '같은 시각 초안', updatedAt: '2026-11-01T10:00:00.000Z' }, aCur.revision);
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

test('a published post on the losing side keeps its public copy unchanged and is shown as public only where it still is', async () => {
  // Later draft vs a saved and published version: the published identity is the renamed recovery copy.
  {
    const env = await pair(), { cloud, time, a, b } = env;
    const id = await finishedOnB(env, { publish: true });
    const before = structuredClone(cloud.rows.get(id).publication), publishes = cloud.stats.publishes.length;
    assert.equal(before.active, true);
    const aCur = await a.storage.readPhotoPost(a.ws, id);
    await a.storage.savePhotoPost(a.ws, { ...aCur, title: '맥에서 더 쓴 초안', updatedAt: '2026-11-01T10:05:00.000Z' }, aCur.revision);
    await cycles(a, time);
    assert.deepEqual(await shown(a), [['draft', '맥에서 더 쓴 초안'], ['saved', KEPT + '완성']]);
    assert.deepEqual(cloud.rows.get(id).publication, before, 'the public copy is unchanged: no implicit publish or withdrawal');
    assert.equal(cloud.stats.publishes.length, publishes);
    const winner = (await list(a)).find(row => row.id !== id);
    assert.equal((await a.storage.readBlogSyncState(a.ws, id)).publication.active, true, 'the recovery copy is shown as public: it still is');
    assert.equal((await a.storage.readBlogSyncState(a.ws, winner.id)).publication, null, 'the winning draft is not shown as public');
    assert.equal(cloud.rows.get(winner.id).publication, null);
    await cycles(b, time, 2);
    assert.deepEqual(await shown(b), [['draft', '맥에서 더 쓴 초안'], ['saved', KEPT + '완성']]);
    assert.equal((await b.storage.readBlogSyncState(b.ws, id)).publication.active, true);
    await assert.rejects(a.sync.deletePost(a.ws, id), { code: 'blog_post_published' }, 'still protected as a public post');
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

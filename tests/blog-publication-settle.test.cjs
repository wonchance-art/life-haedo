'use strict';
// Publication settlement (2026-11-11). A publish or withdrawal whose answer was lost leaves
// this device not knowing whether the post is public. The exact server head settles it:
// an applied request becomes the recorded publication, an unanswered withdrawal is sent
// again, and a publish request is never sent again without the owner's action.
// Real Storage/BlogSync; the synthetic server follows the SQL publication CAS and receipts
// (supabase/migrations/20261105051632_life_post_markdown.sql publish/publish_copies and
// 20261017144744_life_blog_originals.sql unpublish). The real SQL and browser run in
// tests/publish-recovery-browser.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const F = require('./fixtures/photo-metadata.cjs');
const Remote = require('../assets/life/blog-remote.js');
const { server, device, clock, post, Core, Photo, Blog, Sync } = require('./helpers/blog-sync-cloud.cjs');

// Canvas stub (as tests/blog-public-copies.test.cjs): a small metadata-free copy.
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
globalThis.OffscreenCanvas = class {
  constructor(width, height) { Object.assign(this, { width, height }); }
  getContext() { return { fillRect() {}, drawImage() {}, set fillStyle(_) {}, set imageSmoothingQuality(_) {}, set imageSmoothingEnabled(_) {} }; }
  async convertToBlob(options) { return new Blob([options.type === 'image/png' ? F.png(1, 1, [10, 20, 30, 255]) : Buffer.from(F.JPEG_8X8)], { type: options.type }); }
};
const fault = code => Object.assign(new Error(code), { code });
const clone = value => structuredClone(value);

// The publication RPCs of the synthetic server with the SQL rules: receipt replay by operation
// id first, then the post-revision and publication-revision CAS. `control.lose` drops the
// answer after the server applied the request; `control.block` fails before the server sees it.
function publicationServer(cloud, dev) {
  const receipts = new Map(), calls = [], control = { lose: null, block: null, failRead: false };
  dev.remote.publish = async (id, revision, operation, options) => {
    const request = { kind: 'publish', id, revision, operation, options: clone(options) };
    if (control.block === 'publish') { calls.push({ ...request, reached: false }); throw fault('network_error'); }
    calls.push({ ...request, reached: true });
    let result = receipts.get(operation);
    if (!result) {
      const row = cloud.rows.get(id);
      if (!row || row.revision !== revision || (row.publication?.revision || 0) !== (options.expectedPublicRevision || 0)) throw fault('blog_conflict');
      row.publication = { token: row.publication?.active ? row.publication.token : Core.id(), blogToken: row.publication?.blogToken || Core.id(), revision: (options.expectedPublicRevision || 0) + 1, active: true };
      row.published = { photoIds: clone(options.photoIds || []), author: clone(options.author) };
      result = { status: 'stored', ...row.publication }; receipts.set(operation, result);
    }
    if (control.lose === 'publish') { control.lose = null; throw fault('network_error'); }
    return clone(result);
  };
  dev.remote.unpublish = async (id, revision, operation) => {
    if (control.block === 'unpublish') { calls.push({ kind: 'unpublish', id, revision, operation, reached: false }); throw fault('network_error'); }
    calls.push({ kind: 'unpublish', id, revision, operation, reached: true });
    let result = receipts.get(operation);
    if (!result) {
      const row = cloud.rows.get(id);
      if (!row?.publication || row.publication.revision !== revision) throw fault('blog_conflict');
      row.publication = { ...row.publication, revision: revision + 1, active: false }; row.published = null;
      result = { status: 'stored', revision: revision + 1 }; receipts.set(operation, result);
    }
    if (control.lose === 'unpublish') { control.lose = null; throw fault('network_error'); }
    return clone(result);
  };
  const read = dev.remote.read.bind(dev.remote);
  dev.remote.read = async id => { if (control.failRead) throw fault('network_error'); return read(id); };
  return { receipts, calls, control, sent: kind => calls.filter(call => call.kind === kind && call.reached) };
}
async function saved(t, { photos = 0 } = {}) {
  const cloud = server(), time = clock(), a = await device(cloud, 'mac', { time });
  t.after(() => { a.sync.dispose(); a.storage.close(); });
  const doc = await a.storage.savePhotoPost(a.ws, await post({ title: '공개할 글', photos }), 0); await a.sync.syncNow();
  const net = publicationServer(cloud, a);
  const state = () => a.storage.readBlogSyncState(a.ws, doc.id), row = () => cloud.rows.get(doc.id);
  const status = async () => (await a.sync.getState(a.ws, doc.id)).publicationStatus;
  return { cloud, time, a, doc, net, state, row, status };
}

test('B1: a publication whose answer was lost is shown as unknown, then settled as public by one server check', async t => {
  const f = await saved(t); f.net.control.lose = 'publish';
  const failure = await f.a.sync.publish(f.a.ws, f.doc.id, { expectedLocalRevision: f.doc.revision }).catch(error => error);
  assert.equal(failure.code, 'network_error');
  assert.match(failure.message, /공개 게시 결과를 받지 못했습니다/); assert.doesNotMatch(failure.message, /자동으로 다시 시도|글은 이 기기에 남아/);
  assert.equal(f.row().publication.active, true, 'the server applied it');
  assert.equal((await f.state()).publication, null); assert.equal(await f.status(), 'unknown', 'never private while the result is unknown');
  assert.deepEqual(await f.a.sync.publicationStatuses(f.a.ws), { [f.doc.id]: 'unknown' });
  const settled = await f.a.sync.settlePublication(f.a.ws, f.doc.id);
  assert.equal(settled.publicationStatus, 'public'); assert.equal(settled.publishPending, null);
  assert.deepEqual(settled.publication, f.row().publication);
  assert.equal(f.net.sent('publish').length, 1, 'settling reads the head; it sends no publication request');
});

test('B1: the periodic cycle settles the lost answer without the owner and never sends a publication request', async t => {
  const f = await saved(t); f.net.control.lose = 'publish';
  await assert.rejects(f.a.sync.publish(f.a.ws, f.doc.id, { expectedLocalRevision: f.doc.revision }), { code: 'network_error' });
  assert.equal(await f.status(), 'unknown');
  await f.a.sync.syncNow();
  assert.equal(await f.status(), 'public'); assert.equal((await f.state()).publishPending, null);
  assert.equal(f.net.sent('publish').length, 1);
});

test('B1: withdrawing works on a device that never recorded the publication (the server head is read first)', async t => {
  const f = await saved(t); f.net.control.lose = 'publish';
  await assert.rejects(f.a.sync.publish(f.a.ws, f.doc.id, { expectedLocalRevision: f.doc.revision }), { code: 'network_error' });
  assert.equal((await f.state()).publication, null);
  const result = await f.a.sync.unpublish(f.a.ws, f.doc.id);
  assert.equal(result.status, 'stored'); assert.equal(f.row().publication.active, false);
  const state = await f.state();
  assert.equal(state.publication.active, false); assert.equal(state.publishPending, null); assert.equal(state.unpublishPending, null);
  assert.equal(await f.status(), 'private');
  // Another device's publication this device has not received is withdrawn the same way.
  const row = f.row(); row.publication = { ...row.publication, revision: row.publication.revision + 1, active: true };
  assert.equal((await f.state()).publication.active, false);
  await f.a.sync.unpublish(f.a.ws, f.doc.id);
  assert.equal(f.row().publication.active, false); assert.equal(await f.status(), 'private');
});

test('B1: after the lost answer a different choice updates the settled publication instead of being refused', async t => {
  const f = await saved(t); f.net.control.lose = 'publish';
  await assert.rejects(f.a.sync.publish(f.a.ws, f.doc.id, { expectedLocalRevision: f.doc.revision, author: { name: '처음 이름', intro: '' } }), { code: 'network_error' });
  const first = (await f.state()).publishPending;
  const published = await f.a.sync.publish(f.a.ws, f.doc.id, { expectedLocalRevision: f.doc.revision, author: { name: '바꾼 이름', intro: '' } });
  assert.equal(published.revision, 2, 'an update of the publication the lost request made');
  assert.deepEqual(f.row().published.author, { name: '바꾼 이름', intro: '' });
  assert.notEqual(f.net.calls.at(-1).operation, first.operationId); assert.equal(f.net.calls.at(-1).options.expectedPublicRevision, 1);
  assert.equal(await f.status(), 'public');
  // A reviewed public revision that the settlement proved stale is still refused before any request.
  f.net.control.lose = 'publish';
  await assert.rejects(f.a.sync.publish(f.a.ws, f.doc.id, { expectedLocalRevision: f.doc.revision, author: { name: '셋째', intro: '' }, expectedPublicRevision: 2 }), { code: 'network_error' });
  const before = f.net.calls.length;
  await assert.rejects(f.a.sync.publish(f.a.ws, f.doc.id, { expectedLocalRevision: f.doc.revision, author: { name: '넷째', intro: '' }, expectedPublicRevision: 2 }), { code: 'local_changed' });
  assert.equal(f.net.calls.length, before, 'the stale preview sends nothing'); assert.equal(await f.status(), 'public');
});

test('M4: a request that never reached the server is replaced by a new choice; the dropped photos are never published', async t => {
  const f = await saved(t, { photos: 2 }); f.net.control.block = 'publish';
  const both = f.doc.photos.map(photo => photo.id);
  const failure = await f.a.sync.publish(f.a.ws, f.doc.id, { expectedLocalRevision: f.doc.revision, photoIds: both }).catch(error => error);
  assert.equal(failure.code, 'network_error'); assert.match(failure.message, /공개 게시 결과를 받지 못했습니다/);
  const old = (await f.state()).publishPending; assert.deepEqual(old.selection.photoIds, both);
  assert.equal(f.row().publication, null); assert.equal(await f.status(), 'unknown');
  f.net.control.block = null;
  const published = await f.a.sync.publish(f.a.ws, f.doc.id, { expectedLocalRevision: f.doc.revision, photoIds: [] });
  assert.equal(published.revision, 1); assert.deepEqual(f.row().published.photoIds, []);
  assert.deepEqual(f.net.sent('publish').map(call => call.options.photoIds), [[]], 'only the new choice reached the server');
  assert.equal((await f.state()).publishPending, null); assert.equal(await f.status(), 'public');
  // The old request arriving late is refused by the publication-revision CAS.
  await assert.rejects(f.a.remote.publish(f.doc.id, old.expectedRevision, old.operationId, { ...old.selection, copies: old.copies, expectedPublicRevision: old.expectedPublicRevision }), { code: 'blog_conflict' });
  assert.deepEqual(f.row().published.photoIds, []);
});

test('a publish request the server did not apply is never sent again by a cycle, a check or a withdrawal', async t => {
  const f = await saved(t); f.net.control.block = 'publish';
  await assert.rejects(f.a.sync.publish(f.a.ws, f.doc.id, { expectedLocalRevision: f.doc.revision }), { code: 'network_error' });
  f.net.control.block = null;
  const pending = (await f.state()).publishPending;
  for (let i = 0; i < 3; i++) { f.time.advance(60000); await f.a.sync.syncNow(); }
  await f.a.sync.settlePublication(f.a.ws, f.doc.id);
  assert.equal(f.net.sent('publish').length, 0, 'no implicit publication'); assert.equal(f.row().publication, null);
  const state = await f.state();
  assert.deepEqual(state.publishPending, pending, 'kept for an explicit retry of the same choice');
  assert.equal(state.publishChecked, pending.operationId); assert.equal(await f.status(), 'private', 'the head showed it is not public');
  // The same choice replays the same operation.
  const published = await f.a.sync.publish(f.a.ws, f.doc.id, { expectedLocalRevision: f.doc.revision });
  assert.equal(published.revision, 1); assert.equal(f.net.sent('publish')[0].operation, pending.operationId);
  // A withdrawal is the later choice: an unapplied publish request is dropped, not sent.
  const g = await saved(t); g.net.control.block = 'publish';
  await assert.rejects(g.a.sync.publish(g.a.ws, g.doc.id, { expectedLocalRevision: g.doc.revision }), { code: 'network_error' });
  g.net.control.block = null;
  assert.deepEqual(await g.a.sync.unpublish(g.a.ws, g.doc.id), { status: 'not_published', revision: 0 });
  assert.equal((await g.state()).publishPending, null); assert.equal(g.net.calls.filter(call => call.reached).length, 0); assert.equal(await g.status(), 'private');
});

test('a withdrawal whose answer was lost is unknown until settled; one never received is sent again by the cycle', async t => {
  const f = await saved(t);
  await f.a.sync.publish(f.a.ws, f.doc.id, { expectedLocalRevision: f.doc.revision });
  f.net.control.lose = 'unpublish';
  const lost = await f.a.sync.unpublish(f.a.ws, f.doc.id).catch(error => error);
  assert.equal(lost.code, 'network_error'); assert.match(lost.message, /공개 철회 결과를 받지 못했습니다/); assert.match(lost.message, /철회 요청을 다시 보냅니다/);
  assert.equal(f.row().publication.active, false); assert.equal((await f.state()).publication.active, true);
  assert.equal(await f.status(), 'unknown', 'neither public nor private while the withdrawal is unanswered');
  await f.a.sync.syncNow();
  assert.equal(await f.status(), 'private'); assert.equal((await f.state()).unpublishPending, null);
  assert.equal(f.net.sent('unpublish').length, 1, 'an applied withdrawal is not sent twice');
  // Never received by the server: the cycle sends the same operation again.
  const g = await saved(t);
  await g.a.sync.publish(g.a.ws, g.doc.id, { expectedLocalRevision: g.doc.revision });
  g.net.control.block = 'unpublish';
  const unsent = await g.a.sync.unpublish(g.a.ws, g.doc.id).catch(error => error);
  assert.equal(unsent.code, 'network_error');
  const pending = (await g.state()).unpublishPending; assert(pending);
  assert.equal(g.row().publication.active, true); assert.equal(await g.status(), 'unknown');
  await g.a.sync.syncNow();
  assert.equal(await g.status(), 'unknown', 'still unanswered while the server cannot be reached');
  g.net.control.block = null; g.time.advance(60000); await g.a.sync.syncNow();
  assert.equal(g.row().publication.active, false); assert.equal(await g.status(), 'private');
  assert.deepEqual(g.net.sent('unpublish').map(call => call.operation), [pending.operationId]);
});

test('a failed check keeps the state unknown and changes nothing; an account change during it is cancelled', async t => {
  const f = await saved(t); f.net.control.lose = 'publish';
  await assert.rejects(f.a.sync.publish(f.a.ws, f.doc.id, { expectedLocalRevision: f.doc.revision }), { code: 'network_error' });
  const before = await f.state();
  f.net.control.failRead = true;
  const failed = await f.a.sync.settlePublication(f.a.ws, f.doc.id).catch(error => error);
  assert.equal(failed.code, 'network_error'); assert.match(failed.message, /공개 상태를 확인하지 못했습니다/);
  await f.a.sync.syncNow();
  assert.deepEqual(await f.state(), before); assert.equal(await f.status(), 'unknown');
  // The answer arrives after the account changed: it is dropped.
  f.net.control.failRead = false;
  const read = f.a.remote.read; let entered, release;
  const arrived = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  f.a.remote.read = async id => { const row = await read(id); entered(); await gate; return row; };
  const outcome = f.a.sync.settlePublication(f.a.ws, f.doc.id).catch(error => error);
  await arrived; f.a.auth.epoch++; release();
  assert.equal((await outcome).code, 'request_cancelled');
  assert.deepEqual(await f.state(), before, 'a late answer writes nothing');
});

test('m5: deleting waits for the publication check; a public post is refused and an unreachable server deletes nothing', async t => {
  const f = await saved(t); f.net.control.lose = 'publish';
  await assert.rejects(f.a.sync.publish(f.a.ws, f.doc.id, { expectedLocalRevision: f.doc.revision }), { code: 'network_error' });
  f.net.control.failRead = true;
  const unsettled = await f.a.sync.deletePost(f.a.ws, f.doc.id).catch(error => error);
  assert.equal(unsettled.code, 'blog_post_unsettled'); assert.match(unsettled.message, /공개 상태를 확인하지 못해 삭제하지 않았습니다/);
  assert((await f.a.storage.listPhotoPosts(f.a.ws)).some(row => row.id === f.doc.id));
  // Storage refuses it too when BlogSync is bypassed.
  await assert.rejects(f.a.storage.deletePhotoPost(f.a.ws, f.doc.id, f.doc.revision), { code: 'blog_post_unsettled' });
  f.net.control.failRead = false;
  await assert.rejects(f.a.sync.deletePost(f.a.ws, f.doc.id), { code: 'blog_post_published' });
  assert.equal(await f.status(), 'public'); assert.equal(f.cloud.rows.has(f.doc.id), true);
  await f.a.sync.unpublish(f.a.ws, f.doc.id);
  await f.a.sync.deletePost(f.a.ws, f.doc.id); await f.a.sync.syncNow();
  assert.equal(f.cloud.rows.has(f.doc.id), false);
});

test('m5: a deletion the server refused because the post is public there is reported with its reason', async t => {
  const cloud = server(), time = clock(), a = await device(cloud, 'mac', { time }), b = await device(cloud, 'ipad', { time });
  t.after(() => { for (const dev of [a, b]) { dev.sync.dispose(); dev.storage.close(); } });
  const doc = await a.storage.savePhotoPost(a.ws, await post({ title: '다른 기기에서 공개한 글' }), 0); await a.sync.syncNow(); await b.sync.syncNow();
  await b.sync.publish(b.ws, doc.id, { expectedLocalRevision: (await b.storage.readPhotoPost(b.ws, doc.id)).revision });
  const events = []; a.sync.subscribe(event => events.push(event));
  await a.sync.deletePost(a.ws, doc.id); await a.sync.syncNow();
  assert.deepEqual(events.filter(event => event.type === 'delete_refused'), [{ type: 'delete_refused', reason: 'published', workspaceId: a.ws, remoteId: doc.id }]);
  assert.equal(cloud.rows.get(doc.id).publication.active, true);
});

test('the account overview read settles this device too, so the post screen cannot contradict it', async t => {
  const f = await saved(t); f.net.control.lose = 'publish';
  await assert.rejects(f.a.sync.publish(f.a.ws, f.doc.id, { expectedLocalRevision: f.doc.revision }), { code: 'network_error' });
  const rows = await f.a.sync.catalog(f.a.ws);
  assert.equal(rows[0].publication.active, true); assert.equal(await f.status(), 'public');
});

test('M3: the public profile is read anonymously and only while a post is public', async t => {
  const cloud = server(), time = clock(), a = await device(cloud, 'mac', { time });
  const lists = [];
  const reader = { async list(token, options) { lists.push({ token, options }); return { blogToken: token, author: { name: '익명A', intro: '익명 소개' }, posts: [], nextCursor: null }; } };
  a.sync.dispose();
  a.sync = Sync.create({ storage: a.storage, auth: a.auth, blog: Blog, photoPost: Photo, remote: a.remote, makeId: Core.id, locks: null, now: () => time.now,
    timers: { setTimeout: () => 0, clearTimeout() {} }, publicReader: reader });
  t.after(() => { a.sync.dispose(); a.storage.close(); });
  const doc = await a.storage.savePhotoPost(a.ws, await post({ title: '프로필 글' }), 0); await a.sync.syncNow();
  assert.deepEqual(await a.sync.publicProfile(a.ws), { visible: false, author: { name: '', intro: '' }, posts: 0 });
  assert.equal(lists.length, 0, 'nothing public: no public request at all');
  await a.sync.publish(a.ws, doc.id, { expectedLocalRevision: doc.revision, author: { name: '익명A', intro: '익명 소개' } });
  assert.deepEqual(await a.sync.publicProfile(a.ws), { visible: true, author: { name: '익명A', intro: '익명 소개' }, posts: 1 });
  assert.deepEqual(lists, [{ token: cloud.rows.get(doc.id).publication.blogToken, options: { limit: 1 } }]);
  reader.list = async () => { throw fault('network_error'); };
  await assert.rejects(a.sync.publicProfile(a.ws), { code: 'network_error' });
});

test('publication failures never borrow the document-save message', () => {
  for (const kind of ['publish_unsent', 'publish_unconfirmed', 'unpublish_unsent', 'unpublish_unconfirmed', 'settle_failed']) {
    const error = Remote.publicationFault(kind);
    assert.equal(error.code, 'network_error'); assert.doesNotMatch(error.message, /자동으로 다시 시도|글은 이 기기에 남아/);
  }
  assert.match(Remote.publicationFault('publish_unsent').message, /공개 상태는 바뀌지 않았습니다/);
  assert.doesNotMatch(Remote.publicationFault('publish_unconfirmed').message, /다시 보냅니다/, 'a publish request is never promised to be sent again');
  assert.equal(Sync.publicationStatus(null), 'private');
  assert.equal(Sync.publicationStatus({ publication: { active: true, revision: 1 } }), 'public');
  assert.equal(Sync.publicationStatus({ publication: { active: true, revision: 1 }, unpublishPending: { operationId: 'w' } }), 'unknown');
  assert.equal(Sync.publicationStatus({ publication: null, publishPending: { operationId: 'p' } }), 'unknown');
  assert.equal(Sync.publicationStatus({ publication: null, publishPending: { operationId: 'p' }, publishChecked: 'p' }), 'private');
  assert.equal(Sync.publicationStatus({ publication: null, publishPending: { operationId: 'q' }, publishChecked: 'p' }), 'unknown');
});

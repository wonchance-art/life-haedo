'use strict';
// Publication settlement (2026-11-11). A publish or withdrawal whose answer was lost leaves
// this device not knowing whether the post is public. The exact server head settles it:
// an applied request becomes the recorded publication, an unanswered withdrawal is sent
// again, and a publish request is never sent again without the owner's action. A request
// that is not applied yet can still arrive, so it is never recorded as failed for good:
// a withdrawal ends it on the server where the server allows that and guards against it
// where it does not, and a new choice shares its publication revision so that at most one
// of the two is applied.
// Real Storage/BlogSync; the synthetic server follows the SQL publication CAS and receipts
// (supabase/migrations/20261105051632_life_post_markdown.sql publish/publish_copies and
// 20261017144744_life_blog_originals.sql unpublish: receipt first, then the post revision,
// then the publication revision; unpublish answers "missing" without a publication row and
// moves the revision of an existing row whether it is active or not). The real SQL and
// browser run in tests/publish-recovery-browser.cjs.
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
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// The publication RPCs of the synthetic server with the SQL rules, shared by every client of
// one cloud. `control.lose` drops the answer after the server applied the request,
// `control.block` fails before the server sees it, `control.before` runs right before the
// server handles a request (another request arriving first), `control.hold` keeps a request
// in flight until released.
function publicationNet(cloud) {
  const receipts = new Map(), calls = [], control = { lose: null, block: null, failRead: false, before: null, hold: null };
  const apply = {
    publish(id, revision, operation, options) {
      let result = receipts.get(operation);
      if (result) return clone(result);
      const row = cloud.rows.get(id);
      if (!row || row.revision !== revision || (row.publication?.revision || 0) !== (options.expectedPublicRevision || 0)) throw fault('blog_conflict');
      row.publication = { token: row.publication?.active ? row.publication.token : Core.id(), blogToken: row.publication?.blogToken || Core.id(), revision: (options.expectedPublicRevision || 0) + 1, active: true };
      row.published = { photoIds: clone(options.photoIds || []), author: clone(options.author), digests: (options.copies || []).map(copy => copy.digest) };
      result = { status: 'stored', ...row.publication }; receipts.set(operation, result); return clone(result);
    },
    unpublish(id, revision, operation) {
      let result = receipts.get(operation);
      if (result) return clone(result);
      const row = cloud.rows.get(id);
      // No publication row: "missing" (BlogRemote reports it like a conflict). A row moves whether active or not.
      if (!row?.publication || row.publication.revision !== revision) throw fault('blog_conflict');
      row.publication = { ...row.publication, revision: revision + 1, active: false }; row.published = null;
      result = { status: 'stored', revision: revision + 1 }; receipts.set(operation, result); return clone(result);
    },
  };
  function attach(dev) {
    for (const kind of ['publish', 'unpublish']) dev.remote[kind] = async (...args) => {
      const call = { kind, tab: dev.name, id: args[0], revision: args[1], operation: args[2], options: clone(args[3] || null), reached: false }; calls.push(call);
      if (control.block === kind) throw fault('network_error');
      if (control.hold?.kind === kind) { const hold = control.hold; control.hold = null; hold.entered.resolve(call); await hold.release.promise; }
      if (control.before) { const hook = control.before; control.before = null; await hook(call); }
      call.reached = true;
      const result = apply[kind](...args);
      if (control.lose === kind) { control.lose = null; throw fault('network_error'); }
      return result;
    };
    const read = dev.remote.read.bind(dev.remote);
    dev.remote.read = async id => { if (control.failRead) throw fault('network_error'); return read(id); };
  }
  // The anonymous public reading of one post (what a visitor gets).
  const reader = { async read(token) {
    const row = [...cloud.rows.values()].find(value => value.publication?.active && value.publication.token === token);
    return row ? { token, snapshot: { author: clone(row.published.author), photos: row.published.digests.map(digest => ({ digest })) } } : null;
  }, async list(token) { const row = [...cloud.rows.values()].find(value => value.publication?.active && value.publication.blogToken === token); return { blogToken: token, author: clone(row?.published.author || { name: '', intro: '' }), posts: [], nextCursor: null }; } };
  const holdNext = kind => control.hold = { kind, entered: deferred(), release: deferred() };
  return { receipts, calls, control, apply, attach, reader, holdNext, sent: kind => calls.filter(call => call.kind === kind && call.reached), tried: kind => calls.filter(call => call.kind === kind) };
}
// Web Locks of one browser, shared by its tabs.
function browserLocks() {
  const held = new Map();
  return { held, async request(name, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (options.ifAvailable && held.has(name)) return callback(null);
    while (held.has(name)) await held.get(name);
    const done = deferred(); held.set(name, done.promise);
    try { return await callback({ name }); } finally { held.delete(name); done.resolve(); }
  } };
}
// One tab: its own BlogSync over the device's storage (tabs of one browser share IndexedDB).
function tab(cloud, net, dev, name, { locks = null } = {}) {
  const remote = cloud.client(name), view = { name, remote, storage: dev.storage, ws: dev.ws, auth: dev.auth };
  net.attach(view);
  view.sync = Sync.create({ storage: dev.storage, auth: dev.auth, blog: Blog, photoPost: Photo, remote, makeId: Core.id, locks, now: () => dev.time.now,
    timers: { setTimeout: () => 0, clearTimeout() {} }, interval: 30000, publicReader: net.reader });
  return view;
}
async function saved(t, { photos = 0, locks = null } = {}) {
  const cloud = server(), time = clock(), dev = await device(cloud, 'mac', { time }), net = publicationNet(cloud);
  dev.sync.dispose();
  const a = tab(cloud, net, dev, 'tab-a', { locks }), tabs = [a];
  t.after(() => { for (const view of tabs) view.sync.dispose(); dev.storage.close(); });
  const doc = await a.storage.savePhotoPost(a.ws, await post({ title: '공개할 글', photos }), 0); await a.sync.syncNow();
  const state = () => a.storage.readBlogSyncState(a.ws, doc.id), row = () => cloud.rows.get(doc.id);
  const view = async (from = a) => { const value = await from.sync.getState(a.ws, doc.id); return { status: value.publicationStatus, notice: value.publicationNotice }; };
  const status = async from => (await view(from)).status;
  const open = name => { const next = tab(cloud, net, dev, name, { locks }); tabs.push(next); return next; };
  const publish = (options = {}, from = a) => from.sync.publish(a.ws, doc.id, { expectedLocalRevision: doc.revision, ...options });
  // Replays a request exactly as the page sent it: the same request reaching the server late.
  const late = call => net.apply[call.kind](call.id, call.revision, call.operation, call.options);
  return { cloud, time, dev, a, doc, net, state, row, status, view, open, publish, late };
}
// A second device of the same account that received the post.
async function otherDevice(t, f) {
  const b = await device(f.cloud, 'ipad', { time: f.time }); t.after(() => { b.sync.dispose(); b.storage.close(); });
  await b.sync.syncNow();
  const id = (await b.storage.listBlogSyncStates(b.ws)).states[0].localPostId, doc = await b.storage.readPhotoPost(b.ws, id);
  const net = { attach: f.net.attach }; net.attach(b);
  return { b, publish: options => b.sync.publish(b.ws, doc.id, { expectedLocalRevision: doc.revision, ...options }) };
}

test('B1: a publication whose answer was lost is shown as unknown, then settled as public by one server check', async t => {
  const f = await saved(t); f.net.control.lose = 'publish';
  const failure = await f.publish().catch(error => error);
  assert.equal(failure.code, 'network_error');
  assert.match(failure.message, /공개 게시 결과를 받지 못했습니다/); assert.doesNotMatch(failure.message, /자동으로 다시 시도|글은 이 기기에 남아/);
  assert.equal(f.row().publication.active, true, 'the server applied it');
  assert.equal((await f.state()).publication, null); assert.equal(await f.status(), 'unknown', 'never private while the result is unknown');
  assert.deepEqual(await f.a.sync.publicationStatuses(f.a.ws), { [f.doc.id]: 'unknown' });
  const settled = await f.a.sync.settlePublication(f.a.ws, f.doc.id);
  assert.equal(settled.publicationStatus, 'public'); assert.equal(settled.publishPending, null); assert.equal(settled.publicationNotice, null);
  assert.deepEqual(settled.publication, f.row().publication);
  assert.equal(f.net.sent('publish').length, 1, 'settling reads the head; it sends no publication request');
});

test('B1: the periodic cycle settles the lost answer without the owner and never sends a publication request', async t => {
  const f = await saved(t); f.net.control.lose = 'publish';
  await assert.rejects(f.publish(), { code: 'network_error' });
  assert.equal(await f.status(), 'unknown');
  await f.a.sync.syncNow();
  assert.equal(await f.status(), 'public'); assert.equal((await f.state()).publishPending, null);
  assert.equal(f.net.tried('publish').length, 1);
});

test('B1: withdrawing works on a device that never recorded the publication (the server head is read first)', async t => {
  const f = await saved(t); f.net.control.lose = 'publish';
  await assert.rejects(f.publish(), { code: 'network_error' });
  assert.equal((await f.state()).publication, null);
  const result = await f.a.sync.unpublish(f.a.ws, f.doc.id);
  assert.equal(result.status, 'stored'); assert.equal(f.row().publication.active, false);
  const state = await f.state();
  assert.equal(state.publication.active, false); assert.equal(state.publishPending, null); assert.equal(state.unpublishPending, null); assert.equal(state.publishRevoked ?? null, null);
  assert.deepEqual(await f.view(), { status: 'private', notice: null });
  // Another device's publication this device has not received is withdrawn the same way.
  const row = f.row(); row.publication = { ...row.publication, revision: row.publication.revision + 1, active: true }; row.published = { photoIds: [], author: { name: '', intro: '' }, digests: [] };
  assert.equal((await f.state()).publication.active, false);
  await f.a.sync.unpublish(f.a.ws, f.doc.id);
  assert.equal(f.row().publication.active, false); assert.equal(await f.status(), 'private');
});

test('B1: after the lost answer a different choice updates the settled publication instead of being refused', async t => {
  const f = await saved(t); f.net.control.lose = 'publish';
  await assert.rejects(f.publish({ author: { name: '처음 이름', intro: '' } }), { code: 'network_error' });
  const first = (await f.state()).publishPending;
  const published = await f.publish({ author: { name: '바꾼 이름', intro: '' } });
  assert.equal(published.revision, 2, 'an update of the publication the lost request made');
  assert.deepEqual(f.row().published.author, { name: '바꾼 이름', intro: '' });
  assert.notEqual(f.net.calls.at(-1).operation, first.operationId); assert.equal(f.net.calls.at(-1).options.expectedPublicRevision, 1);
  assert.deepEqual(f.net.tried('publish').map(call => call.options.expectedPublicRevision), [0, 1], 'the applied request was recognized before the new one was made: no request against the old revision');
  assert.equal(await f.status(), 'public');
  // A reviewed public revision that the settlement proved stale is still refused before any request.
  f.net.control.lose = 'publish';
  await assert.rejects(f.publish({ author: { name: '셋째', intro: '' }, expectedPublicRevision: 2 }), { code: 'network_error' });
  const before = f.net.calls.length;
  await assert.rejects(f.publish({ author: { name: '넷째', intro: '' }, expectedPublicRevision: 2 }), { code: 'local_changed' });
  assert.equal(f.net.calls.length, before, 'the stale preview sends nothing'); assert.equal(await f.status(), 'public');
});

test('M4: a request that never reached the server is replaced by a new choice; the dropped photos are never published', async t => {
  const f = await saved(t, { photos: 2 }); f.net.control.block = 'publish';
  const both = f.doc.photos.map(photo => photo.id);
  const failure = await f.publish({ photoIds: both }).catch(error => error);
  assert.equal(failure.code, 'network_error'); assert.match(failure.message, /공개 게시 결과를 받지 못했습니다/);
  const old = (await f.state()).publishPending; assert.deepEqual(old.selection.photoIds, both);
  assert.equal(f.row().publication, null); assert.equal(await f.status(), 'unknown');
  f.net.control.block = null;
  const published = await f.publish({ photoIds: [] });
  assert.equal(published.revision, 1); assert.deepEqual(f.row().published.photoIds, []);
  assert.deepEqual(f.net.sent('publish').map(call => call.options.photoIds), [[]], 'only the new choice reached the server');
  assert.equal((await f.state()).publishPending, null); assert.deepEqual(await f.view(), { status: 'public', notice: null });
  // The old request arriving late is refused by the publication-revision CAS.
  assert.throws(() => f.late(f.net.tried('publish')[0]), { code: 'blog_conflict' });
  assert.deepEqual(f.row().published.photoIds, []);
});

test('at most one of two unanswered requests is ever applied: a new choice shares the publication revision of the one it replaces', async t => {
  const f = await saved(t, { photos: 2 }); f.net.control.block = 'publish';
  const both = f.doc.photos.map(photo => photo.id);
  await assert.rejects(f.publish({ photoIds: both }), { code: 'network_error' });
  await assert.rejects(f.publish({ photoIds: [] }), { code: 'network_error' });
  await assert.rejects(f.publish({ photoIds: [both[0]] }), { code: 'network_error' });
  f.net.control.block = null;
  const requests = f.net.tried('publish');
  assert.equal(requests.length, 3); assert.equal(new Set(requests.map(call => call.operation)).size, 3);
  assert.deepEqual(requests.map(call => [call.revision, call.options.expectedPublicRevision]), [[1, 0], [1, 0], [1, 0]], 'the same post and publication revision for each');
  const pending = (await f.state()).publishPending;
  assert.equal(pending.operationId, requests[2].operation, 'one request is kept as this device\'s own'); assert.equal(pending.contested, true);
  // Whatever order they arrive in, the server applies exactly one.
  f.late(requests[1]);
  assert.throws(() => f.late(requests[0]), { code: 'blog_conflict' }); assert.throws(() => f.late(requests[2]), { code: 'blog_conflict' });
  assert.deepEqual(f.row().published.photoIds, []); assert.equal(f.row().publication.revision, 1);
});

test('M3: the replaced request arrives first: the new choice is sent once more as an update, so the last reviewed choice stays public', async t => {
  const f = await saved(t, { photos: 2 }); f.net.control.block = 'publish';
  const both = f.doc.photos.map(photo => photo.id);
  await assert.rejects(f.publish({ photoIds: both, author: { name: '익명', intro: '' } }), { code: 'network_error' });
  f.net.control.block = null;
  const old = f.net.tried('publish')[0];
  // While the new request is on its way, the old one reaches the server.
  f.net.control.before = async () => { f.late(old); };
  const published = await f.publish({ photoIds: [], author: { name: '익명', intro: '' } });
  assert.equal(published.revision, 2); assert.deepEqual(f.row().published.photoIds, [], 'no photo of the replaced choice stays public');
  assert.equal(published.token, f.net.receipts.get(old.operation).token, 'an update of the same public address');
  const requests = f.net.tried('publish');
  assert.deepEqual(requests.map(call => [call.options.photoIds.length, call.options.expectedPublicRevision, call.reached]), [[2, 0, false], [0, 0, true], [0, 1, true]]);
  assert.notEqual(requests[2].operation, requests[1].operation);
  const state = await f.state(); assert.equal(state.publishPending, null); assert.equal(state.publication.revision, 2);
  assert.deepEqual(await f.view(), { status: 'public', notice: null });
});

test('M3: a conflict that is not this device\'s earlier request is not sent again; the error says what is public', async t => {
  const f = await saved(t, { photos: 2 }), other = await otherDevice(t, f); f.net.control.block = 'publish';
  const both = f.doc.photos.map(photo => photo.id);
  await assert.rejects(f.publish({ photoIds: both, author: { name: '익명', intro: '' } }), { code: 'network_error' });
  f.net.control.block = null;
  // Another device publishes its own choice (another name) while the new request is on its way.
  f.net.control.before = async () => { f.net.control.before = null; await other.publish({ author: { name: '다른 기기', intro: '' } }); };
  const failure = await f.publish({ photoIds: [], author: { name: '익명', intro: '' } }).catch(error => error);
  assert.equal(failure.code, 'blog_conflict'); assert.equal(failure.ownRequest, false); assert.deepEqual(failure.publicCopy, { photos: 0 });
  assert.deepEqual(f.row().published.author, { name: '다른 기기', intro: '' }, 'the other device\'s publication is not overwritten');
  assert.equal(f.net.tried('publish').filter(call => call.tab === 'tab-a').length, 2, 'no second attempt');
  assert.equal((await f.state()).publishPending, null); assert.equal(await f.status(), 'public');
  // The same without an earlier request of this device.
  const g = await saved(t), elsewhere = await otherDevice(t, g);
  g.net.control.before = async () => { g.net.control.before = null; await elsewhere.publish({ author: { name: '다른 기기', intro: '' } }); };
  const plain = await g.publish().catch(error => error);
  assert.equal(plain.code, 'blog_conflict'); assert.equal(plain.ownRequest, false); assert.equal(g.net.tried('publish').filter(call => call.tab === 'tab-a').length, 1);
});

test('a publish request the server did not apply is never sent again by a cycle or a check, and stays named instead of being called failed', async t => {
  const f = await saved(t); f.net.control.block = 'publish';
  await assert.rejects(f.publish(), { code: 'network_error' });
  f.net.control.block = null;
  const pending = (await f.state()).publishPending;
  for (let i = 0; i < 3; i++) { f.time.advance(60000); await f.a.sync.syncNow(); }
  await f.a.sync.settlePublication(f.a.ws, f.doc.id);
  assert.equal(f.net.tried('publish').length, 1, 'no implicit publication'); assert.equal(f.row().publication, null);
  const state = await f.state();
  assert.deepEqual(state.publishPending, pending, 'kept for an explicit retry of the same choice');
  assert.equal(state.publishChecked, pending.operationId);
  assert.deepEqual(await f.view(), { status: 'private', notice: 'publish_unapplied' }, 'the head showed it is not public; the request is still named');
  assert.deepEqual(await f.a.sync.publicationNotices(f.a.ws), { [f.doc.id]: 'publish_unapplied' });
  // It arrives after all: the next cycle records it.
  f.late(f.net.tried('publish')[0]); await f.a.sync.syncNow();
  assert.deepEqual(await f.view(), { status: 'public', notice: null }); assert.equal((await f.state()).publishPending, null);
  // The same choice replays the same operation.
  const g = await saved(t); g.net.control.block = 'publish';
  await assert.rejects(g.publish(), { code: 'network_error' }); g.net.control.block = null;
  await g.a.sync.syncNow();
  const published = await g.publish();
  assert.equal(published.revision, 1); assert.deepEqual(g.net.tried('publish').map(call => call.operation), Array(2).fill((await g.net.tried('publish'))[0].operation));
});

test('M2: an update of a public post that is not applied stays named on every reading while the earlier copy is public', async t => {
  const f = await saved(t, { photos: 2 }); const both = f.doc.photos.map(photo => photo.id);
  await f.publish({ photoIds: both });
  f.net.control.block = 'publish';
  await assert.rejects(f.publish({ photoIds: [], expectedPublicRevision: 1 }), { code: 'network_error' }); f.net.control.block = null;
  assert.equal(await f.status(), 'unknown');
  for (let i = 0; i < 2; i++) { f.time.advance(60000); await f.a.sync.syncNow(); }
  assert.deepEqual(await f.view(), { status: 'public', notice: 'update_unapplied' }, 'public, and not silently: the update is not what is public');
  assert.deepEqual(await f.a.sync.publicationNotices(f.a.ws), { [f.doc.id]: 'update_unapplied' });
  assert.deepEqual(f.row().published.photoIds, both); assert.equal(f.net.sent('publish').length, 1);
  // The explicit retry of the same choice applies it and ends the notice.
  await f.publish({ photoIds: [], expectedPublicRevision: 1 });
  assert.deepEqual(await f.view(), { status: 'public', notice: null }); assert.deepEqual(f.row().published.photoIds, []);
});

test('M1: a withdrawal ends an unanswered re-publication for certain when a publication row exists (the revision is moved)', async t => {
  const f = await saved(t);
  await f.publish(); await f.a.sync.unpublish(f.a.ws, f.doc.id);
  assert.deepEqual({ active: f.row().publication.active, revision: f.row().publication.revision }, { active: false, revision: 2 });
  f.net.control.block = 'publish';
  await assert.rejects(f.publish({ author: { name: '다시', intro: '' } }), { code: 'network_error' }); f.net.control.block = null;
  const old = f.net.tried('publish').at(-1); assert.equal(old.options.expectedPublicRevision, 2);
  const before = f.net.sent('unpublish').length;
  const result = await f.a.sync.unpublish(f.a.ws, f.doc.id);
  assert.equal(result.status, 'unpublished'); assert.equal(f.net.sent('unpublish').length, before + 1, 'a withdrawal request was really sent');
  assert.deepEqual({ active: f.row().publication.active, revision: f.row().publication.revision }, { active: false, revision: 3 });
  const state = await f.state(); assert.equal(state.publishPending, null); assert.equal(state.publishRevoked ?? null, null, 'no guard is needed');
  assert.deepEqual(await f.view(), { status: 'private', notice: null });
  // The old request arriving after the withdrawal ends in conflict: nothing becomes public.
  assert.throws(() => f.late(old), { code: 'blog_conflict' }); assert.equal(f.row().publication.active, false);
  await f.a.sync.syncNow(); assert.equal(await f.status(), 'private');
});

test('M1: a withdrawal of a public post ends an unanswered update with it', async t => {
  const f = await saved(t, { photos: 2 }); const both = f.doc.photos.map(photo => photo.id);
  await f.publish({ photoIds: [] });
  f.net.control.block = 'publish';
  await assert.rejects(f.publish({ photoIds: both, expectedPublicRevision: 1 }), { code: 'network_error' }); f.net.control.block = null;
  const old = f.net.tried('publish').at(-1);
  const result = await f.a.sync.unpublish(f.a.ws, f.doc.id);
  assert.equal(result.status, 'stored'); assert.equal(f.row().publication.active, false);
  assert.throws(() => f.late(old), { code: 'blog_conflict' }); assert.equal(f.row().publication.active, false);
  assert.deepEqual(await f.view(), { status: 'private', notice: null }); assert.equal((await f.state()).publishPending, null);
});

// Steps between a decision and its result, and what the device holds when each one fails
// (the table in the hand-over report). Nothing in between forgets a request that can still arrive.
test('M1/M3: every failure in the middle of ending an unanswered request leaves a state that matches the server', async t => {
  const withdrawn = async () => {
    const f = await saved(t, { photos: 2 }); await f.publish({ photoIds: [] }); await f.a.sync.unpublish(f.a.ws, f.doc.id);
    f.net.control.block = 'publish';
    await assert.rejects(f.publish({ photoIds: f.doc.photos.map(photo => photo.id), expectedPublicRevision: 2 }), { code: 'network_error' }); f.net.control.block = null;
    return { f, old: f.net.tried('publish').at(-1) };
  };
  await t.test('withdrawal: the revision-moving request never arrives, then is repeated by the cycle', async () => {
    const { f, old } = await withdrawn(); f.net.control.block = 'unpublish';
    const failure = await f.a.sync.unpublish(f.a.ws, f.doc.id).catch(error => error); f.net.control.block = null;
    assert.equal(failure.code, 'network_error'); assert.match(failure.message, /공개 철회 결과를 받지 못했습니다/, 'a withdrawal request did go out');
    let state = await f.state();
    assert.equal(state.publishPending.operationId, old.operation, 'the request it was meant to end is not forgotten'); assert.equal(state.unpublishPending.ending, true);
    assert.equal(await f.status(), 'unknown'); assert.equal(f.row().publication.revision, 2);
    await f.a.sync.syncNow();
    assert.deepEqual({ active: f.row().publication.active, revision: f.row().publication.revision }, { active: false, revision: 3 }, 'the cycle moved the revision');
    state = await f.state(); assert.equal(state.publishPending, null); assert.equal(state.unpublishPending, null);
    assert.deepEqual(await f.view(), { status: 'private', notice: null }); assert.equal(state.publicationLog ?? null, null, 'nothing public was withdrawn: nothing to announce');
    assert.throws(() => f.late(old), { code: 'blog_conflict' });
  });
  await t.test('withdrawal: the revision moved, the answer was lost', async () => {
    const { f, old } = await withdrawn(); f.net.control.lose = 'unpublish';
    await assert.rejects(f.a.sync.unpublish(f.a.ws, f.doc.id), { code: 'network_error' });
    assert.equal(f.row().publication.revision, 3); assert.equal(await f.status(), 'unknown');
    const before = f.net.sent('unpublish').length; await f.a.sync.syncNow();
    assert.equal(f.net.sent('unpublish').length, before, 'already moved: not sent again');
    assert.deepEqual(await f.view(), { status: 'private', notice: null }); assert.throws(() => f.late(old), { code: 'blog_conflict' });
  });
  await t.test('new choice: the old request is ended first, then the new one is sent against the moved revision', async () => {
    const { f, old } = await withdrawn();
    const published = await f.publish({ photoIds: [], expectedPublicRevision: 2 });
    assert.equal(published.revision, 4); assert.deepEqual(f.row().published.photoIds, []);
    assert.deepEqual(f.net.tried('publish').at(-1).options.expectedPublicRevision, 3); assert.equal(f.net.sent('unpublish').length, 2);
    assert.throws(() => f.late(old), { code: 'blog_conflict' }); assert.deepEqual(await f.view(), { status: 'public', notice: null });
  });
  await t.test('new choice: ending the old request fails; no new request is sent and the old one stays recorded', async () => {
    const { f, old } = await withdrawn(); f.net.control.block = 'unpublish'; const before = f.net.tried('publish').length;
    const failure = await f.publish({ photoIds: [], expectedPublicRevision: 2 }).catch(error => error); f.net.control.block = null;
    assert.equal(failure.code, 'network_error'); assert.match(failure.message, /이번 공개 게시 요청은 보내지 못했습니다\. 앞서 보낸 요청의 결과는 아직 확인하지 못했습니다/);
    assert.equal(f.net.tried('publish').length, before); assert.equal((await f.state()).publishPending.operationId, old.operation); assert.equal(await f.status(), 'unknown');
    await f.a.sync.syncNow(); assert.deepEqual(await f.view(), { status: 'private', notice: null }); assert.throws(() => f.late(old), { code: 'blog_conflict' });
  });
  await t.test('new choice: the old request is ended, the new request\'s answer is lost', async () => {
    const { f, old } = await withdrawn(); f.net.control.lose = 'publish';
    await assert.rejects(f.publish({ photoIds: [], expectedPublicRevision: 2 }), { code: 'network_error' });
    assert.equal(await f.status(), 'unknown'); assert.equal((await f.state()).publishPending.contested ?? false, false, 'only one request can still be unanswered');
    await f.a.sync.syncNow(); assert.deepEqual(await f.view(), { status: 'public', notice: null }); assert.deepEqual(f.row().published.photoIds, []);
    assert.throws(() => f.late(old), { code: 'blog_conflict' });
  });
  await t.test('replaced request arrived first, then the second attempt of the new choice gets no answer or never arrives', async () => {
    for (const arrives of [true, false]) {
      const f = await saved(t, { photos: 2 }); const both = f.doc.photos.map(photo => photo.id); f.net.control.block = 'publish';
      await assert.rejects(f.publish({ photoIds: both }), { code: 'network_error' }); f.net.control.block = null;
      const old = f.net.tried('publish')[0];
      f.net.control.before = async () => { f.late(old); f.net.control[arrives ? 'lose' : 'block'] = 'publish'; };
      await assert.rejects(f.publish({ photoIds: [] }), { code: 'network_error' }); f.net.control.block = null; f.net.control.lose = null;
      assert.equal(await f.status(), 'unknown'); assert.equal((await f.state()).publication.revision, 1, 'the copy that is public now is recorded');
      await f.a.sync.syncNow();
      if (arrives) { assert.deepEqual(await f.view(), { status: 'public', notice: null }); assert.deepEqual(f.row().published.photoIds, []); }
      else { assert.deepEqual(await f.view(), { status: 'public', notice: 'update_unapplied' }, 'the replaced choice is public and the screen says the last choice is not'); assert.deepEqual(f.row().published.photoIds, both); }
    }
  });
});

test('M1: with no publication row the server cannot end an unanswered first publication; the withdrawal guards and withdraws it when it arrives', async t => {
  const f = await saved(t, { photos: 2 }); const both = f.doc.photos.map(photo => photo.id); f.net.control.block = 'publish';
  await assert.rejects(f.publish({ photoIds: both, author: { name: '익명', intro: '' } }), { code: 'network_error' }); f.net.control.block = null;
  const old = f.net.tried('publish')[0];
  const events = []; f.a.sync.subscribe(event => events.push(event));
  assert.deepEqual(await f.a.sync.unpublish(f.a.ws, f.doc.id), { status: 'not_published', revision: 0, guarded: true });
  assert.equal(f.net.tried('unpublish').length, 0, 'there is no publication row to move'); assert.equal(f.net.tried('publish').length, 1);
  let state = await f.state(); assert.equal(state.publishPending, null); assert.equal(state.publishRevoked.operationId, old.operation);
  assert.equal(await f.status(), 'unknown', 'while the request can plausibly still arrive the post is not called private');
  await f.a.sync.syncNow(); assert.equal(f.net.tried('unpublish').length, 0); assert.equal(await f.status(), 'unknown');
  // The request arrives after the withdrawal.
  f.late(old); assert.equal(f.row().publication.active, true);
  await f.a.sync.syncNow();
  assert.equal(f.row().publication.active, false, 'the withdrawal still stands'); assert.equal(f.net.sent('unpublish').length, 1);
  state = await f.state(); assert.equal(state.publishRevoked, null); assert.equal(state.unpublishPending, null); assert.equal(state.publicationLog.code, 'late_publication_withdrawn');
  assert.deepEqual(await f.view(), { status: 'private', notice: null });
  assert.deepEqual(events.filter(event => event.type === 'publication_notice'), [{ type: 'publication_notice', code: 'late_publication_withdrawn', workspaceId: f.a.ws, localPostId: f.doc.id }]);
  assert.equal(f.net.tried('publish').length, 1, 'no publication request was sent by the guard');
});

test('M1: the guard outlasts the unknown window, does not touch another device\'s publication, and ends with a new post revision', async t => {
  // After the window the post reads as not public, with the guard named; a late arrival is still withdrawn.
  const f = await saved(t); f.net.control.block = 'publish';
  await assert.rejects(f.publish({ author: { name: '익명', intro: '' } }), { code: 'network_error' }); f.net.control.block = null;
  await f.a.sync.unpublish(f.a.ws, f.doc.id);
  f.time.advance(Sync.LATE_WINDOW - 1000); assert.equal(await f.status(), 'unknown');
  f.time.advance(2000); assert.deepEqual(await f.view(), { status: 'private', notice: 'late_publish_guarded' });
  await f.a.sync.syncNow(); assert.equal((await f.state()).publishRevoked.operationId, f.net.tried('publish')[0].operation, 'still guarded');
  f.late(f.net.tried('publish')[0]); await f.a.sync.syncNow();
  assert.equal(f.row().publication.active, false); assert.deepEqual(await f.view(), { status: 'private', notice: null });
  // Another device's own publication (another name) is not the guarded request: it stays.
  const g = await saved(t), other = await otherDevice(t, g); g.net.control.block = 'publish';
  await assert.rejects(g.publish({ author: { name: '익명', intro: '' } }), { code: 'network_error' }); g.net.control.block = null;
  await g.a.sync.unpublish(g.a.ws, g.doc.id);
  await other.publish({ author: { name: '다른 기기', intro: '' } });
  await g.a.sync.syncNow();
  assert.equal(g.row().publication.active, true); assert.equal(g.net.tried('unpublish').length, 0);
  assert.equal((await g.state()).publishRevoked, null); assert.deepEqual(await g.view(), { status: 'public', notice: null });
  assert.throws(() => g.late(g.net.tried('publish')[0]), { code: 'blog_conflict' }, 'the guarded request can no longer be applied');
  // A new post revision makes the guarded request impossible: the guard ends.
  const h = await saved(t); h.net.control.block = 'publish';
  await assert.rejects(h.publish(), { code: 'network_error' }); h.net.control.block = null;
  await h.a.sync.unpublish(h.a.ws, h.doc.id);
  const edited = await h.a.storage.savePhotoPost(h.a.ws, { ...h.doc, title: '고친 제목', updatedAt: new Date(h.time.now + 1000).toISOString() }, h.doc.revision);
  h.time.advance(5000); await h.a.sync.syncNow(); await h.a.sync.syncNow();
  assert.equal(h.cloud.rows.get(h.doc.id).revision, 2); assert.equal(edited.revision > h.doc.revision, true);
  assert.equal((await h.state()).publishRevoked, null); assert.throws(() => h.late(h.net.tried('publish')[0]), { code: 'blog_conflict' });
});

test('a withdrawal whose answer was lost is unknown until settled; one never received is sent again by the cycle and said on the post', async t => {
  const f = await saved(t);
  await f.publish();
  f.net.control.lose = 'unpublish';
  const lost = await f.a.sync.unpublish(f.a.ws, f.doc.id).catch(error => error);
  assert.equal(lost.code, 'network_error'); assert.match(lost.message, /공개 철회 결과를 받지 못했습니다/); assert.match(lost.message, /철회 요청을 다시 보냅니다/);
  assert.equal(f.row().publication.active, false); assert.equal((await f.state()).publication.active, true);
  assert.equal(await f.status(), 'unknown', 'neither public nor private while the withdrawal is unanswered');
  await f.a.sync.syncNow();
  assert.equal(await f.status(), 'private'); assert.equal((await f.state()).unpublishPending, null);
  assert.equal(f.net.sent('unpublish').length, 1, 'an applied withdrawal is not sent twice'); assert.equal((await f.state()).publicationLog ?? null, null, 'nothing was sent again');
  // Never received by the server: the cycle sends the same operation again, and says so.
  const g = await saved(t);
  await g.publish();
  g.net.control.block = 'unpublish';
  const unsent = await g.a.sync.unpublish(g.a.ws, g.doc.id).catch(error => error);
  assert.equal(unsent.code, 'network_error');
  const pending = (await g.state()).unpublishPending; assert(pending);
  assert.equal(g.row().publication.active, true); assert.equal(await g.status(), 'unknown');
  await g.a.sync.syncNow();
  assert.equal(await g.status(), 'unknown', 'still unanswered while the server cannot be reached');
  const events = []; g.a.sync.subscribe(event => events.push(event));
  g.net.control.block = null; g.time.advance(60000); await g.a.sync.syncNow();
  assert.equal(g.row().publication.active, false); assert.equal(await g.status(), 'private');
  assert.deepEqual(g.net.sent('unpublish').map(call => call.operation), [pending.operationId]);
  assert.equal((await g.state()).publicationLog.code, 'withdrawal_resent', 'not silent: the post records that the device sent it again');
  assert.equal(events.filter(event => event.type === 'publication_notice' && event.code === 'withdrawal_resent').length, 1);
});

// Review probe5 (1, 2): an unanswered withdrawal is sent again only against the exact
// publication revision it was made for, never against a publication made afterwards.
test('an unanswered withdrawal never withdraws a publication another device made afterwards', async t => {
  for (const arrived of [false, true]) await t.test(arrived ? 'the withdrawal was applied, its answer lost' : 'the withdrawal never arrived', async t => {
    const f = await saved(t), other = await otherDevice(t, f);
    await f.publish();
    f.net.control[arrived ? 'lose' : 'block'] = 'unpublish';
    await assert.rejects(f.a.sync.unpublish(f.a.ws, f.doc.id), { code: 'network_error' }); f.net.control.block = null;
    assert.equal(await f.status(), 'unknown');
    await other.b.sync.syncNow();
    await other.publish({ author: { name: '다른 기기에서 다시 공개', intro: '' } });
    const revision = f.row().publication.revision, before = f.net.tried('unpublish').length;
    assert.equal(f.row().publication.active, true); assert.equal(revision, arrived ? 3 : 2);
    await f.a.sync.syncNow();
    assert.equal(f.row().publication.active, true, 'the newer publication stays'); assert.equal(f.row().publication.revision, revision);
    assert.equal(f.net.tried('unpublish').length, before, 'the old withdrawal is not sent against the newer publication');
    const state = await f.state(); assert.equal(state.unpublishPending, null); assert.equal(await f.status(), 'public');
  });
});

test('M1: another tab does not judge a request that is still being sent (Web Lock), and the sending tab ends with its result', async t => {
  const locks = browserLocks(), f = await saved(t, { locks }), b = f.open('tab-b');
  const hold = f.net.holdNext('publish'), sending = f.publish(); sending.catch(() => {});
  await hold.entered.promise;
  assert.equal(await f.status(b), 'unknown');
  await b.sync.syncNow();
  let state = await f.state();
  assert.equal(state.publishChecked ?? null, null, 'tab B did not record the request as not applied'); assert.equal(await f.status(b), 'unknown');
  assert.equal(f.row().publication, null, 'the request has not reached the server yet');
  hold.release.resolve();
  const published = await sending;
  assert.equal(published.revision, 1); assert.equal(f.row().publication.active, true);
  assert.deepEqual(await f.view(b), { status: 'public', notice: null });
  // A withdrawal being sent is not sent a second time by another tab's cycle.
  const held = f.net.holdNext('unpublish'), withdrawing = f.a.sync.unpublish(f.a.ws, f.doc.id); withdrawing.catch(() => {});
  await held.entered.promise;
  await b.sync.syncNow();
  assert.equal(f.net.tried('unpublish').length, 1, 'no second withdrawal request');
  held.release.resolve();
  assert.equal((await withdrawing).status, 'stored'); assert.deepEqual(await f.view(b), { status: 'private', notice: null });
  // An explicit action in the other tab waits for the request instead of racing it.
  const again = f.net.holdNext('publish'), republishing = f.publish({ expectedPublicRevision: 2 }); republishing.catch(() => {});
  await again.entered.promise;
  let withdrew = false; const waiting = b.sync.unpublish(f.a.ws, f.doc.id).then(result => { withdrew = true; return result; });
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(withdrew, false); assert.equal(f.net.tried('unpublish').length, 1);
  again.release.resolve(); await republishing;
  assert.equal((await waiting).status, 'stored'); assert.equal(f.row().publication.active, false, 'the later withdrawal is what stands');
});

test('M1: a successful publish or withdrawal is not reported as an error when another tab wrote the same binding meanwhile', async t => {
  // Without Web Locks (the fallback) only the merge protects the answer.
  const f = await saved(t), b = f.open('tab-b');
  const hold = f.net.holdNext('publish'), sending = f.publish(); sending.catch(() => {});
  await hold.entered.promise;
  await b.sync.syncNow();
  const meanwhile = await f.state(); assert.equal(meanwhile.publishChecked, meanwhile.publishPending.operationId, 'the other tab wrote the binding');
  hold.release.resolve();
  const published = await sending;
  assert.equal(published.revision, 1);
  const state = await f.state(); assert.equal(state.publishPending, null); assert.equal(state.publication.active, true);
  assert.deepEqual(await f.view(), { status: 'public', notice: null });
  const held = f.net.holdNext('unpublish'), withdrawing = f.a.sync.unpublish(f.a.ws, f.doc.id); withdrawing.catch(() => {});
  await held.entered.promise;
  const other = await f.state(); await f.a.storage.writeBlogSyncState(f.a.ws, f.doc.id, { ...other, otherTab: true }, other.revision);
  held.release.resolve();
  assert.equal((await withdrawing).status, 'stored');
  const after = await f.state(); assert.equal(after.unpublishPending, null); assert.equal(after.publication.active, false); assert.equal(after.otherTab, true, 'the other tab\'s write is kept');
});

test('two unanswered requests and a copy that is not provably the last choice: said as unverified', async t => {
  const f = await saved(t, { photos: 2 }); const both = f.doc.photos.map(photo => photo.id); f.net.control.block = 'publish';
  await assert.rejects(f.publish({ photoIds: both }), { code: 'network_error' });
  await assert.rejects(f.publish({ photoIds: [] }), { code: 'network_error' }); f.net.control.block = null;
  const [first, second] = f.net.tried('publish');
  f.late(first); await f.a.sync.syncNow();
  assert.deepEqual(await f.view(), { status: 'public', notice: 'copy_unverified' }, 'public, but it is the replaced choice');
  assert.equal(f.net.tried('publish').length, 2, 'the cycle sends no publication request to find out');
  // The explicit publication of the last choice ends the doubt.
  await f.publish({ photoIds: [], expectedPublicRevision: 1 });
  assert.deepEqual(await f.view(), { status: 'public', notice: null }); assert.deepEqual(f.row().published.photoIds, []);
  // When the last choice is what arrived, there is no doubt.
  const g = await saved(t, { photos: 2 }); const pair = g.doc.photos.map(photo => photo.id); g.net.control.block = 'publish';
  await assert.rejects(g.publish({ photoIds: pair }), { code: 'network_error' });
  await assert.rejects(g.publish({ photoIds: [] }), { code: 'network_error' }); g.net.control.block = null;
  g.late(g.net.tried('publish')[1]); await g.a.sync.syncNow();
  assert.deepEqual(await g.view(), { status: 'public', notice: null });
});

test('a failed check keeps the state unknown and changes nothing; an account change during it is cancelled', async t => {
  const f = await saved(t); f.net.control.lose = 'publish';
  await assert.rejects(f.publish(), { code: 'network_error' });
  const before = await f.state();
  f.net.control.failRead = true;
  const failed = await f.a.sync.settlePublication(f.a.ws, f.doc.id).catch(error => error);
  assert.equal(failed.code, 'network_error'); assert.match(failed.message, /공개 상태를 확인하지 못했습니다/);
  await f.a.sync.syncNow();
  assert.deepEqual(await f.state(), before); assert.equal(await f.status(), 'unknown');
  // The answer arrives after the account changed: it is dropped.
  f.net.control.failRead = false;
  const read = f.a.remote.read; const entered = deferred(), gate = deferred();
  f.a.remote.read = async id => { const row = await read(id); entered.resolve(); await gate.promise; return row; };
  const outcome = f.a.sync.settlePublication(f.a.ws, f.doc.id).catch(error => error);
  await entered.promise; f.a.auth.epoch++; gate.resolve();
  assert.equal((await outcome).code, 'request_cancelled');
  assert.deepEqual(await f.state(), before, 'a late answer writes nothing');
});

test('m5: a failure names what this attempt did: sent and unanswered, not sent, or not sent while an earlier request is unanswered', async t => {
  const f = await saved(t); f.net.control.lose = 'publish';
  assert.match((await f.publish().catch(error => error)).message, /공개 게시 결과를 받지 못했습니다/);
  // This attempt (another choice) fails before anything is sent; the earlier request is still unanswered.
  f.net.control.failRead = true;
  const prior = await f.publish({ author: { name: '다른 선택', intro: '' } }).catch(error => error);
  assert.equal(prior.code, 'network_error'); assert.match(prior.message, /이번 공개 게시 요청은 보내지 못했습니다\. 앞서 보낸 요청의 결과는 아직 확인하지 못했습니다/);
  assert.equal(f.net.tried('publish').length, 1);
  const withdrawal = await f.a.sync.unpublish(f.a.ws, f.doc.id).catch(error => error);
  assert.match(withdrawal.message, /이번 공개 철회 요청은 보내지 못했습니다\. 앞서 보낸 요청의 결과는 아직 확인하지 못했습니다/);
  // Nothing unanswered at all: plainly not sent.
  const g = await saved(t); await g.publish(); g.net.control.failRead = true;
  const unsent = await g.a.sync.unpublish(g.a.ws, g.doc.id).catch(error => error);
  assert.match(unsent.message, /공개 철회 요청을 보내지 못했습니다\. 공개 상태는 바뀌지 않았습니다/); assert.equal(g.net.tried('unpublish').length, 0);
  const again = await g.publish({ author: { name: '갱신', intro: '' }, expectedPublicRevision: 1 }).catch(error => error);
  assert.match(again.message, /공개 게시 요청을 보내지 못했습니다\. 공개 상태는 바뀌지 않았습니다/);
});

test('m5: deleting waits for the publication check; a public post is refused and an unreachable server deletes nothing', async t => {
  const f = await saved(t); f.net.control.lose = 'publish';
  await assert.rejects(f.publish(), { code: 'network_error' });
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
  const f = await saved(t), other = await otherDevice(t, f);
  await other.publish();
  const events = []; f.a.sync.subscribe(event => events.push(event));
  await f.a.sync.deletePost(f.a.ws, f.doc.id); await f.a.sync.syncNow();
  assert.deepEqual(events.filter(event => event.type === 'delete_refused'), [{ type: 'delete_refused', reason: 'published', workspaceId: f.a.ws, remoteId: f.doc.id }]);
  assert.equal(f.row().publication.active, true);
});

test('the account overview read settles this device too, so the post screen cannot contradict it', async t => {
  const f = await saved(t); f.net.control.lose = 'publish';
  await assert.rejects(f.publish(), { code: 'network_error' });
  const rows = await f.a.sync.catalog(f.a.ws);
  assert.equal(rows[0].publication.active, true); assert.equal(await f.status(), 'public');
});

test('M3/m1: the public profile is read anonymously while a post is public; with none public the last published values of this device are offered and marked', async t => {
  const f = await saved(t), lists = [], list = f.net.reader.list;
  f.net.reader.list = async (token, options) => { lists.push({ token, options }); return list(token); };
  assert.deepEqual(await f.a.sync.publicProfile(f.a.ws), { visible: false, author: { name: '', intro: '' }, posts: 0 });
  assert.equal(lists.length, 0, 'nothing public: no public request at all');
  await f.publish({ author: { name: '익명A', intro: '익명 소개' } });
  assert.deepEqual(await f.a.sync.publicProfile(f.a.ws), { visible: true, author: { name: '익명A', intro: '익명 소개' }, posts: 1 });
  assert.deepEqual(lists, [{ token: f.row().publication.blogToken, options: { limit: 1 } }]);
  f.net.reader.list = async () => { throw fault('network_error'); };
  await assert.rejects(f.a.sync.publicProfile(f.a.ws), { code: 'network_error' });
  // The only public post is withdrawn: the server shows no profile, the device still knows what it published.
  await f.a.sync.unpublish(f.a.ws, f.doc.id);
  assert.deepEqual(await f.a.sync.publicProfile(f.a.ws), { visible: false, author: { name: '익명A', intro: '익명 소개' }, posts: 0, remembered: true });
});

test('publication failures never borrow the document-save message; status and notice are pure readings of the binding', () => {
  for (const kind of ['publish_unsent', 'publish_unconfirmed', 'publish_unsent_prior', 'unpublish_unsent', 'unpublish_unconfirmed', 'unpublish_unsent_prior', 'settle_failed']) {
    const error = Remote.publicationFault(kind);
    assert.equal(error.code, 'network_error'); assert.doesNotMatch(error.message, /자동으로 다시 시도|글은 이 기기에 남아/);
  }
  assert.match(Remote.publicationFault('publish_unsent').message, /공개 상태는 바뀌지 않았습니다/);
  assert.doesNotMatch(Remote.publicationFault('publish_unconfirmed').message, /다시 보냅니다/, 'a publish request is never promised to be sent again');
  // No note calls an unanswered request failed for good.
  for (const text of Object.values(Remote.publicationNotes)) assert.doesNotMatch(text, /반영되지 않았습니다\.$|실패했습니다/);
  for (const name of ['update_unapplied', 'publish_unapplied']) assert.match(Remote.publicationNotes[name], /아직 반영되지 않았습니다.*늦게 반영될 수 있/);
  const live = { active: true, revision: 1 }, at = Date.parse('2026-11-11T00:00:00.000Z'), iso = ms => new Date(at + ms).toISOString();
  assert.equal(Sync.publicationStatus(null), 'private');
  assert.equal(Sync.publicationStatus({ publication: live }), 'public');
  assert.equal(Sync.publicationStatus({ publication: live, unpublishPending: { operationId: 'w' } }), 'unknown');
  assert.equal(Sync.publicationStatus({ publication: null, publishPending: { operationId: 'p' } }), 'unknown');
  assert.equal(Sync.publicationStatus({ publication: null, publishPending: { operationId: 'p' }, publishChecked: 'p' }), 'private');
  assert.equal(Sync.publicationStatus({ publication: null, publishPending: { operationId: 'q' }, publishChecked: 'p' }), 'unknown');
  assert.equal(Sync.publicationStatus({ publication: null, publishRevoked: { operationId: 'x', at: iso(0) } }, at + Sync.LATE_WINDOW - 1), 'unknown');
  assert.equal(Sync.publicationStatus({ publication: null, publishRevoked: { operationId: 'x', at: iso(0) } }, at + Sync.LATE_WINDOW), 'private');
  assert.equal(Sync.publicationNotice({ publication: null, publishRevoked: { operationId: 'x', at: iso(0) } }, at + Sync.LATE_WINDOW), 'late_publish_guarded');
  assert.equal(Sync.publicationNotice({ publication: null, publishPending: { operationId: 'p' }, publishChecked: 'p' }), 'publish_unapplied');
  assert.equal(Sync.publicationNotice({ publication: live, publishPending: { operationId: 'p' }, publishChecked: 'p' }), 'update_unapplied');
  assert.equal(Sync.publicationNotice({ publication: live, publishPending: { operationId: 'p' } }), null, 'unknown has no notice: the status itself says it');
  assert.equal(Sync.publicationNotice({ publication: live, publicationDoubt: true }), 'copy_unverified');
  assert.equal(Sync.publicationNotice({ publication: { active: false, revision: 2 }, publicationDoubt: true }), null);
  assert.equal(Sync.publicationNotice({ publication: live }), null);
});

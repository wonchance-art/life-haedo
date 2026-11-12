'use strict';
// An open editor and account sync (2026-11-12, account sync review M2/M3/M4/m5).
// - A clean editor (nothing outside storage) lets a version from another device in; the
//   editor reads it again (photo-post-ui refreshEdit). A busy editor (input not stored yet,
//   an IME composition) keeps its post, says so (remote_waiting) and takes the version once
//   it is idle. A deletion from another device waits for any open editor.
// - Other tabs of the browser never change a post open in this tab: the hold is shared
//   through a Web Lock (shared mode) or, without Web Locks, a lease in localStorage.
// - The later save wins over a version changed elsewhere, saved posts included
//   (storage.savePhotoPostOver): that version is kept as `복구 사본`, a public copy is not
//   touched, and a revision whose post was deleted elsewhere is saved as a post of its own.
// - A finished revision is never written before its post's first time (another device's
//   clock ahead of this one).
const test = require('node:test'), assert = require('node:assert/strict');
const { server, device, clock, post, edit, finish, copy, Core, Photo, Blog, Sync } = require('./helpers/blog-sync-cloud.cjs');

const KEPT = Sync.CONFLICT_PREFIX;
async function pair() {
  const cloud = server(), time = clock();
  return { cloud, time, a: await device(cloud, 'mac', { time }), b: await device(cloud, 'ipad', { time }) };
}
const list = dev => dev.storage.listPhotoPosts(dev.ws);
const shown = async dev => (await list(dev)).map(row => [row.status, row.title]).sort();
const read = (dev, id) => dev.storage.readPhotoPost(dev.ws, id);
async function redraft(dev, id, title, updatedAt) {
  const cur = await read(dev, id);
  return dev.storage.savePhotoPost(dev.ws, { ...copy(cur), title, updatedAt }, cur.revision);
}
// Web Locks of one browser with shared locks and query(), shared by its tabs.
function tabLocks() {
  const held = [];
  return { held, async request(name, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const mode = options.mode || 'exclusive';
    if (options.ifAvailable && held.some(lock => lock.name === name && (mode === 'exclusive' || lock.mode === 'exclusive'))) return callback(null);
    const entry = { name, mode }; held.push(entry);
    try { return await callback({ name, mode }); } finally { held.splice(held.indexOf(entry), 1); }
  }, async query() { return { held: held.map(({ name, mode }) => ({ name, mode })), pending: [] }; } };
}
// localStorage of one browser.
function memoryStorage() {
  const map = new Map();
  return { map, get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, getItem: k => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => { map.set(k, String(v)); }, removeItem: k => { map.delete(k); } };
}
// A second tab of a device: its own engine over the same storage.
function tabOf(cloud, dev, name, options = {}) {
  return Sync.create({ storage: dev.storage, auth: dev.auth, blog: Blog, photoPost: Photo, remote: cloud.client(name), makeId: Core.id,
    now: () => dev.time.now, timers: { setTimeout: () => 0, clearTimeout() {} }, interval: 30000, ...options });
}
function sameDevice(cloud, dev, name, options) {
  const engine = tabOf(cloud, dev, name, options);
  return { ...dev, name, sync: engine };
}
async function shared(t) {
  const { cloud, time, a, b } = await pair();
  const draft = await a.storage.savePhotoPost(a.ws, await post({ title: '초안', status: 'draft' }), 0); time.advance(10000);
  await a.sync.syncNow({ flushDrafts: true }); await b.sync.syncNow();
  t.after(() => { a.sync.dispose(); b.sync.dispose(); });
  // Another device continues the draft.
  const elsewhere = async (title, minutes = 30) => { await redraft(b, draft.id, title, new Date(time.now + minutes * 60000).toISOString()); time.advance(10000); await b.sync.syncNow({ flushDrafts: true }); };
  return { cloud, time, a, b, draft, elsewhere };
}

test('M2: a clean open editor takes the version from another device; a busy one keeps its post, says so, and takes it once idle', async t => {
  const { a, draft, elsewhere } = await shared(t);
  let busy = false; const events = [];
  a.sync.subscribe(event => events.push(event));
  const release = a.sync.holdPost(a.ws, draft.id, { busy: () => busy });
  await elsewhere('다른 기기에서 이어 씀');
  await a.sync.syncNow();
  assert.equal((await read(a, draft.id)).title, '다른 기기에서 이어 씀', 'nothing outside storage: the open draft follows the account');
  assert.equal(events.filter(event => event.type === 'remote_waiting').length, 0);
  // The editor has input that is not stored yet.
  busy = true;
  await elsewhere('또 다른 기기에서 이어 씀', 40);
  await a.sync.syncNow();
  assert.equal((await read(a, draft.id)).title, '다른 기기에서 이어 씀', 'input not in storage is never decided over');
  assert.deepEqual(events.filter(event => event.type === 'remote_waiting').map(event => event.localPostId), [draft.id], 'the open editor is told once');
  await a.sync.syncNow();
  assert.equal(events.filter(event => event.type === 'remote_waiting').length, 1, 'not again while it waits');
  busy = false; release.idle();
  await a.sync.syncNow();
  assert.equal((await read(a, draft.id)).title, '또 다른 기기에서 이어 씀', 'taken once the editor is idle');
  assert.deepEqual(await shown(a), [['draft', '또 다른 기기에서 이어 씀']]);
  release();
});

test('M2: the input stored after a version waited is the later side; the other device\'s version is kept as a recovery copy', async t => {
  const { cloud, time, a, b, draft, elsewhere } = await shared(t);
  let busy = true;
  const release = a.sync.holdPost(a.ws, draft.id, { busy: () => busy });
  await elsewhere('폰에서 고침', 1);
  await a.sync.syncNow();
  // The editor stores its input (later than the phone's), then is idle.
  time.advance(5 * 60000);
  await redraft(a, draft.id, '맥에서 마저 씀', new Date(time.now).toISOString()); busy = false; release.idle();
  time.advance(10000); await a.sync.syncNow({ flushDrafts: true });
  const expected = [['draft', KEPT + '폰에서 고침'], ['draft', '맥에서 마저 씀']].sort();
  assert.deepEqual(await shown(a), expected);
  assert.equal(cloud.rows.get(draft.id).data.title, '맥에서 마저 씀');
  time.advance(60000); await a.sync.syncNow({ flushDrafts: true }); await b.sync.syncNow();
  assert.deepEqual(await shown(b), expected, 'both devices converge');
  release();
});

test('M2: a deletion from another device waits for an open editor, clean or busy', async t => {
  const { a, b, draft } = await shared(t);
  const release = a.sync.holdPost(a.ws, draft.id, { busy: () => false });
  await b.sync.deletePost(b.ws, draft.id); await b.sync.syncNow();
  await a.sync.syncNow();
  assert.deepEqual(await shown(a), [['draft', '초안']], 'kept while open');
  release(); await a.sync.syncNow();
  assert.deepEqual(await shown(a), [], 'removed once closed');
});

for (const kind of ['Web Lock', 'localStorage lease']) {
  test('M3: another tab never changes a post open in this tab (' + kind + '); this tab takes the version itself', async t => {
    const { cloud, time, a, draft, elsewhere } = await shared(t);
    const options = kind === 'Web Lock' ? { locks: tabLocks() } : { locks: null, leases: memoryStorage() };
    const tab1 = sameDevice(cloud, a, 'mac-tab1', options), tab2 = sameDevice(cloud, a, 'mac-tab2', options);
    t.after(() => { tab1.sync.dispose(); tab2.sync.dispose(); });
    await tab1.sync.syncNow(); await tab2.sync.syncNow();
    let busy = false;
    const release = tab1.sync.holdPost(a.ws, draft.id, { busy: () => busy });
    if (kind === 'Web Lock') { await new Promise(resolve => setImmediate(resolve)); assert.equal(options.locks.held.filter(lock => lock.mode === 'shared').length, 1, 'held in shared mode'); }
    await elsewhere('폰에서 이어 씀');
    await tab2.sync.syncNow();
    assert.equal((await read(a, draft.id)).title, '초안', 'the other tab leaves the open post as it is');
    await tab1.sync.syncNow();
    assert.equal((await read(a, draft.id)).title, '폰에서 이어 씀', 'the tab with the editor takes it (its editor is clean)');
    // A deletion is not applied by the other tab either.
    await elsewhere('폰에서 또 이어 씀', 40);
    busy = true; await tab1.sync.syncNow(); await tab2.sync.syncNow();
    assert.equal((await read(a, draft.id)).title, '폰에서 이어 씀', 'busy here, and not taken by the other tab');
    release();
    if (kind === 'localStorage lease') assert.equal([...options.leases.map.keys()].length, 0, 'the lease goes with the editor');
    await tab2.sync.syncNow();
    assert.equal((await read(a, draft.id)).title, '폰에서 또 이어 씀', 'released: any tab takes it');
    // A lease of a tab that ended without releasing (closed, discarded) runs out.
    if (kind === 'localStorage lease') {
      const again = tab1.sync.holdPost(a.ws, draft.id, { busy: () => false });
      const leaseKey = [...options.leases.map.keys()][0]; assert.ok(leaseKey);
      await elsewhere('만료 뒤', 50);
      await tab2.sync.syncNow(); assert.equal((await read(a, draft.id)).title, '폰에서 또 이어 씀');
      time.advance(31000); await tab2.sync.syncNow();
      assert.equal((await read(a, draft.id)).title, '만료 뒤', 'a lease not renewed is no hold');
      again();
    }
  });
}

test('M3: a hidden tab with nothing unsaved does not keep its open post from the other tabs; shown or busy again, it does', async t => {
  const { cloud, a, draft, elsewhere } = await shared(t);
  const locks = tabLocks(), page = { visibilityState: 'hidden' };
  const tab1 = sameDevice(cloud, a, 'mac-tab1', { locks, events: { document: page } }), tab2 = sameDevice(cloud, a, 'mac-tab2', { locks });
  t.after(() => { tab1.sync.dispose(); tab2.sync.dispose(); });
  let busy = false;
  const release = tab1.sync.holdPost(a.ws, draft.id, { busy: () => busy });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(locks.held.length, 0, 'hidden and clean: not shared');
  await elsewhere('폰에서 이어 씀'); await tab2.sync.syncNow();
  assert.equal((await read(a, draft.id)).title, '폰에서 이어 씀', 'the other tab takes it (the hidden editor reads it again)');
  page.visibilityState = 'visible'; release.idle(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(locks.held.length, 1, 'shown: shared again');
  await elsewhere('폰에서 또 이어 씀', 40); await tab2.sync.syncNow();
  assert.equal((await read(a, draft.id)).title, '폰에서 이어 씀', 'the other tab leaves it again');
  page.visibilityState = 'hidden'; busy = true; release.idle(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(locks.held.length, 1, 'hidden with input outside storage: still shared');
  await tab2.sync.syncNow(); assert.equal((await read(a, draft.id)).title, '폰에서 이어 씀');
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(locks.held.length, 0, 'released with the editor');
});

test('M3: two tabs that both open the post keep it for each other (shared locks)', async t => {
  const { cloud, a, draft, elsewhere } = await shared(t);
  const locks = tabLocks(), tab1 = sameDevice(cloud, a, 'mac-tab1', { locks }), tab2 = sameDevice(cloud, a, 'mac-tab2', { locks });
  t.after(() => { tab1.sync.dispose(); tab2.sync.dispose(); });
  const r1 = tab1.sync.holdPost(a.ws, draft.id, { busy: () => false }), r2 = tab2.sync.holdPost(a.ws, draft.id, { busy: () => false });
  await new Promise(resolve => setImmediate(resolve));
  await elsewhere('폰에서 이어 씀');
  await tab1.sync.syncNow(); await tab2.sync.syncNow();
  assert.equal((await read(a, draft.id)).title, '초안', 'open in the other tab too');
  r2(); await tab1.sync.syncNow();
  assert.equal((await read(a, draft.id)).title, '폰에서 이어 씀');
  r1();
});

test('a hold without busy() keeps the earlier meaning: everything waits', async t => {
  const { a, draft, elsewhere } = await shared(t);
  const release = a.sync.holdPost(a.ws, draft.id);
  await elsewhere('다른 기기에서 계속'); await a.sync.syncNow();
  assert.equal((await read(a, draft.id)).title, '초안');
  release(); await a.sync.syncNow();
  assert.equal((await read(a, draft.id)).title, '다른 기기에서 계속');
});

test('M3 safety: input stored over a draft another tab changed keeps that version as a recovery copy; the same content keeps none', async () => {
  const { a } = await pair();
  const draft = await a.storage.savePhotoPost(a.ws, await post({ title: '초안', status: 'draft' }), 0);
  const other = await a.storage.savePhotoPost(a.ws, { ...copy(draft), title: '다른 탭에서 고침', updatedAt: '2026-11-01T09:10:00.000Z' }, draft.revision);
  const input = { ...copy(draft), title: '이 탭의 입력', updatedAt: '2026-11-01T09:20:00.000Z' };
  await assert.rejects(a.storage.savePhotoPost(a.ws, input, draft.revision), { code: 'photo_post_conflict' }, 'the plain store is refused');
  await assert.rejects(a.storage.savePhotoPostOver(a.ws, { ...input, revision: draft.revision }, draft.revision, { over: { id: draft.id, revision: draft.revision }, copyId: Core.id() }), { code: 'photo_post_conflict' }, 'over a revision that is not the stored one: refused');
  const saved = await a.storage.savePhotoPostOver(a.ws, { ...input, revision: other.revision }, other.revision, { over: { id: draft.id, revision: other.revision }, copyId: Core.id() });
  assert.equal(saved.title, '이 탭의 입력'); assert.equal(saved.revision, other.revision + 1); assert.ok(saved.keptCopyId);
  const kept = await read(a, saved.keptCopyId);
  assert.equal(kept.title, KEPT + '다른 탭에서 고침'); assert.equal(kept.status, 'draft'); assert.equal(kept.replaces, null); assert.equal(kept.updatedAt, '2026-11-01T09:10:00.000Z');
  const same = await a.storage.savePhotoPostOver(a.ws, { ...copy(saved), updatedAt: '2026-11-01T09:30:00.000Z' }, saved.revision, { over: { id: draft.id, revision: saved.revision }, copyId: Core.id() });
  assert.equal(same.keptCopyId, null, 'nothing differs: no copy');
  // The caller knows the stored version holds nothing it has not seen (only its revision moved): no copy either.
  const moved = await a.storage.savePhotoPost(a.ws, { ...copy(same), updatedAt: '2026-11-01T09:31:00.000Z' }, same.revision);
  const known = await a.storage.savePhotoPostOver(a.ws, { ...copy(moved), title: '이 탭의 다음 입력', revision: moved.revision, updatedAt: '2026-11-01T09:40:00.000Z' }, moved.revision, { over: { id: draft.id, revision: moved.revision }, copyId: Core.id(), keep: false });
  assert.equal(known.keptCopyId, null); assert.equal(known.title, '이 탭의 다음 입력');
  assert.deepEqual(await shown(a), [['draft', KEPT + '다른 탭에서 고침'], ['draft', '이 탭의 다음 입력']].sort());
});

test('M4: the later save of a saved post edited on two devices updates it; the other version is a recovery copy everywhere; the public copy is not touched', async t => {
  const { cloud, time, a, b } = await pair();
  const doc = await a.storage.savePhotoPost(a.ws, await post({ title: '원래 글' }), 0); await a.sync.syncNow();
  await a.sync.publish(a.ws, doc.id, { expectedLocalRevision: doc.revision }); await b.sync.syncNow();
  const publication = copy(cloud.rows.get(doc.id).publication), publishes = cloud.stats.publishes.length;
  assert.equal(publication.active, true);
  // A opens the post for editing; B edits and saves it first.
  const aDraft = await edit(a, doc.id, { title: 'A가 나중에 저장' }, '2026-11-01T10:30:00.000Z');
  const bSaved = await finish(b, await edit(b, doc.id, { title: 'B가 먼저 저장' }, '2026-11-01T10:00:00.000Z'), '2026-11-01T10:00:00.000Z');
  await b.sync.saveDefault(b.ws, bSaved.id, { expectedLocalRevision: bSaved.revision });
  time.advance(60000); await a.sync.syncNow();
  const target = await read(a, doc.id);
  assert.equal(target.title, 'B가 먼저 저장'); assert.notEqual(target.revision, aDraft.replaces.revision, 'the post changed under the revision');
  // The plain save is refused as before; the later save goes over the version now stored.
  await assert.rejects(finish(a, aDraft, '2026-11-01T10:30:00.000Z'), { code: 'photo_post_conflict' });
  const saved = await a.storage.savePhotoPostOver(a.ws, { ...copy(aDraft), status: 'saved', updatedAt: '2026-11-01T10:30:00.000Z' }, aDraft.revision, { over: { id: doc.id, revision: target.revision }, copyId: Core.id() });
  assert.equal(saved.status, 'saved'); assert.equal(saved.replaces, null); assert.equal(saved.createdAt, target.createdAt);
  assert.deepEqual(await shown(a), [['draft', KEPT + 'B가 먼저 저장'], ['saved', 'A가 나중에 저장']]);
  const state = await a.storage.readBlogSyncState(a.ws, saved.id);
  assert.equal(state.remoteId, doc.id, 'the post keeps its server identity'); assert.deepEqual(state.publication, publication, 'and its publication');
  time.advance(60000); await a.sync.syncNow(); await b.sync.syncNow(); await a.sync.syncNow();
  assert.equal(cloud.rows.get(doc.id).data.title, 'A가 나중에 저장');
  assert.deepEqual(cloud.rows.get(doc.id).publication, publication, 'the public copy is not changed by a save');
  assert.equal(cloud.stats.publishes.length, publishes, 'nothing published');
  for (const dev of [a, b]) assert.deepEqual(await shown(dev), [['draft', KEPT + 'B가 먼저 저장'], ['saved', 'A가 나중에 저장']], dev.name);
  assert.equal((await b.sync.getState(b.ws, (await list(b)).find(row => row.status === 'saved').id)).publicationStatus, 'public');
});

test('m5: a revision finished on a device whose clock is behind the post\'s first time is written at that time', async () => {
  const { a } = await pair();
  const doc = await a.storage.savePhotoPost(a.ws, await post({ title: '다른 기기 시계로 만든 글', time: '2026-11-01T12:10:00.000Z' }), 0);
  const draft = await edit(a, doc.id, { title: '고침', createdAt: '2026-11-01T12:00:00.000Z' }, '2026-11-01T12:01:00.000Z');
  const saved = await finish(a, draft, '2026-11-01T12:02:00.000Z');
  assert.equal(saved.createdAt, '2026-11-01T12:10:00.000Z'); assert.equal(saved.updatedAt, '2026-11-01T12:10:00.000Z');
  assert.equal(Photo.writtenAt({ createdAt: '2026-11-01T12:10:00.000Z' }, Date.parse('2026-11-01T12:02:00.000Z')), '2026-11-01T12:10:00.000Z');
  assert.equal(Photo.writtenAt({ createdAt: '2026-11-01T12:10:00.000Z' }, Date.parse('2026-11-01T12:20:00.000Z')), '2026-11-01T12:20:00.000Z');
});

test('MINOR-B: a Markdown document on either side is never the same input as a device copy', async () => {
  const doc = await post({ title: '같은 제목', body: '같은 본문' });
  const copyOf = { title: doc.title, ops: copy(doc.ops), attachments: [] };
  assert.equal(Photo.sameInput(copyOf, doc), true, 'the same ops');
  assert.equal(Photo.sameInput({ ...copyOf, ops: [{ insert: '다른 본문\n' }] }, doc), false);
  const markdown = { ...copy(doc), format: 'life-post-md-v1', markdown: '같은 본문\n' }; delete markdown.ops;
  assert.equal(Photo.sameInput(copyOf, markdown), false, 'a Markdown document has no ops to compare');
  assert.equal(Photo.sameInput({ ...copyOf, ops: [{ insert: '전혀 다른 본문\n' }] }, markdown), false, 'any copy differs from it');
  assert.equal(Photo.sameInput({ title: doc.title, format: 'life-post-md-v1', markdown: '같은 본문\n', attachments: [] }, doc), false, 'a Markdown copy differs too');
});

// Review B1 (q3, three devices): a change made here to a post another device deleted is kept under a new server
// identity. The deleted identity is never re-created at revision 1, which a device that missed the deletion would take
// for the revision it holds and later overwrite without a recovery copy. The input is somewhere in every case.
// Review q5 (2026-11-02 rule): two devices that both changed it meet under the same derived identity; the later wins
// and the earlier is kept as `복구 사본`. These go through the upload's `missing` answer; the list path is below.
for (const offlineEdit of [false, true]) {
  test('B1: a post deleted on one device and changed on another is kept as a post of its own; a third device ' + (offlineEdit ? 'that also changed it: one post, the earlier change a recovery copy' : 'receives it'), async () => {
    const cloud = server(), time = clock();
    const mac = await device(cloud, 'mac', { time }), phone = await device(cloud, 'phone', { time }), ipad = await device(cloud, 'ipad', { time });
    const draft = await mac.storage.savePhotoPost(mac.ws, await post({ title: '세 기기 초안', status: 'draft' }), 0); time.advance(10000);
    await mac.sync.syncNow({ flushDrafts: true }); await phone.sync.syncNow(); await ipad.sync.syncNow();
    // The phone deletes it; the Mac (which has not heard yet) changes it; the iPad is away.
    await phone.sync.deletePost(phone.ws, draft.id); await phone.sync.syncNow();
    assert.equal(cloud.rows.has(draft.id), false);
    await redraft(mac, draft.id, '맥에서 지워진 뒤 쓴 문장', new Date(time.now + 60000).toISOString()); time.advance(70000);
    if (offlineEdit) await redraft(ipad, draft.id, '아이패드에서 고친 문장', new Date(time.now).toISOString());
    time.advance(10000); await mac.sync.syncNow({ flushDrafts: true });
    assert.equal(cloud.rows.has(draft.id), false, 'the deleted identity is never re-created');
    const macRow = [...cloud.rows.values()].find(row => row.data.title === '맥에서 지워진 뒤 쓴 문장');
    assert.ok(macRow, 'the change is on the server under a new identity'); assert.notEqual(macRow.id, draft.id);
    for (let i = 0; i < 3; i++) { time.advance(60000); await ipad.sync.syncNow({ flushDrafts: true }); await mac.sync.syncNow({ flushDrafts: true }); await phone.sync.syncNow(); }
    const titles = async dev => (await list(dev)).map(row => row.title).sort();
    const current = offlineEdit ? '아이패드에서 고친 문장' : '맥에서 지워진 뒤 쓴 문장';
    const expected = offlineEdit ? [KEPT + '맥에서 지워진 뒤 쓴 문장', '아이패드에서 고친 문장'].sort() : ['맥에서 지워진 뒤 쓴 문장'];
    for (const dev of [mac, phone, ipad]) assert.deepEqual(await titles(dev), expected, dev.name);
    assert.deepEqual([...cloud.rows.values()].map(row => row.data.title).sort(), expected);
    assert.equal([...cloud.rows.values()].find(row => row.data.title === current).id, macRow.id, 'both met under the one derived identity');
    // The iPad goes on writing what it now holds: an ordinary edit of that post, received by the Mac.
    const ipadPost = (await list(ipad)).find(row => row.title === current);
    await redraft(ipad, ipadPost.id, current + ' · 아이패드가 이어 씀', new Date(time.now + 60000).toISOString()); time.advance(70000);
    await ipad.sync.syncNow({ flushDrafts: true }); await mac.sync.syncNow();
    assert.ok((await titles(mac)).includes(current + ' · 아이패드가 이어 씀'));
    for (const dev of [mac, phone, ipad]) dev.sync.dispose();
  });
}

// Review m-2: the same tab's editor that gets busy while a received version is being committed keeps its post: the
// commit's own transaction checks it again (quietHere) and the version waits for the editor to be idle.
test('m-2: an editor that gets busy during the commit of a received version keeps its post; the version comes in once idle', async t => {
  const { cloud, a, draft, elsewhere } = await shared(t);
  let busy = false, typing = true; const events = [];
  // Input arrives exactly as the received version is being written: after every check before the transaction.
  const storage = { ...a.storage, commitBlogSync: (...args) => { if (typing) busy = true; return a.storage.commitBlogSync(...args); } };
  const tab = tabOf(cloud, a, 'mac-editor', { storage }); t.after(() => tab.dispose());
  tab.subscribe(event => events.push(event));
  const release = tab.holdPost(a.ws, draft.id, { busy: () => busy });
  await elsewhere('다른 기기에서 이어 씀');
  await tab.syncNow();
  assert.equal((await read(a, draft.id)).title, '초안', 'the post under the busy editor is untouched');
  assert.deepEqual(events.filter(event => event.type === 'remote_waiting').map(event => event.localPostId), [draft.id], 'the editor is told');
  typing = false; busy = false; release.idle(); await tab.syncNow();
  assert.equal((await read(a, draft.id)).title, '다른 기기에서 이어 씀');
  release();
});

// Review M-a: a revision open here whose server copy is gone (another device finished or deleted it) is said once.
test('M-a: an open editor whose post the server no longer has is told once (remote_gone); the post stays while it is open', async t => {
  const { a, b, draft } = await shared(t);
  const events = []; a.sync.subscribe(event => events.push(event));
  const release = a.sync.holdPost(a.ws, draft.id, { busy: () => false });
  await b.sync.deletePost(b.ws, draft.id); await b.sync.syncNow();
  await a.sync.syncNow(); await a.sync.syncNow();
  assert.deepEqual(events.filter(event => event.type === 'remote_gone').map(event => event.localPostId), [draft.id]);
  assert.deepEqual(await shown(a), [['draft', '초안']], 'kept while open');
  release(); await a.sync.syncNow();
  assert.deepEqual(await shown(a), []);
});

// Review U17 (q3c): the cycle's list shows the row gone first while the post here is changed (an edit still in its
// upload delay, or made offline and not yet sent): vanish keeps it under a new identity, never the deleted one.
test('U17: the list shows a changed post gone first: it is kept under a new identity, and a device that missed the deletion receives it', async () => {
  const cloud = server(), time = clock();
  const mac = await device(cloud, 'mac', { time }), phone = await device(cloud, 'phone', { time }), ipad = await device(cloud, 'ipad', { time });
  const draft = await mac.storage.savePhotoPost(mac.ws, await post({ title: '목록 먼저 초안', status: 'draft' }), 0); time.advance(10000);
  await mac.sync.syncNow({ flushDrafts: true }); await phone.sync.syncNow(); await ipad.sync.syncNow();
  await phone.sync.deletePost(phone.ws, draft.id); await phone.sync.syncNow();
  // Just written: still in the draft upload delay, so the cycle lists before it sends anything.
  await redraft(mac, draft.id, '목록이 먼저 본 문장', new Date(time.now).toISOString());
  const saves = cloud.stats.saves.length;
  await mac.sync.syncNow();
  assert.ok(cloud.stats.saves.length > saves, 'the vanish path sent it');
  assert.equal(cloud.rows.has(draft.id), false, 'the deleted identity is never re-created');
  const kept = [...cloud.rows.values()].find(row => row.data.title === '목록이 먼저 본 문장');
  assert.ok(kept); assert.notEqual(kept.id, draft.id);
  await ipad.sync.syncNow(); await phone.sync.syncNow();
  for (const dev of [mac, phone, ipad]) assert.deepEqual(await shown(dev), [['draft', '목록이 먼저 본 문장']], dev.name);
  for (const dev of [mac, phone, ipad]) dev.sync.dispose();
});

// Review U19: a conflict being decided finds the row gone (deleted between the list and the read): kept under a new
// identity as well.
test('U19: a conflict that finds the row gone keeps the change under a new identity', async t => {
  const { cloud, time, a, draft, elsewhere } = await shared(t);
  await elsewhere('다른 기기에서 이어 씀');
  await redraft(a, draft.id, '이 기기에서 고친 문장', new Date(time.now).toISOString());
  const read = a.remote.read; let gone = false;
  a.remote.read = async (id, ...rest) => { if (id === draft.id && !gone) { gone = true; cloud.rows.delete(draft.id); return null; } return read.call(a.remote, id, ...rest); };
  await a.sync.syncNow();
  a.remote.read = read;
  assert.ok(gone, 'the conflict read found it gone');
  assert.equal(cloud.rows.has(draft.id), false);
  const kept = [...cloud.rows.values()].find(row => row.data.title === '이 기기에서 고친 문장');
  assert.ok(kept, 'the change is on the server under a new identity'); assert.notEqual(kept.id, draft.id);
});

// Review q5 safety: a row deleted and re-created under the same identity (a re-created derived identity, or an older
// app) starts at revision 1 again. A device holding revision 1 sees other content there and decides it as a change:
// clean, it takes it; changed, its push over revision 1 reads the head first and keeps the other side as `복구 사본`.
for (const dirtyHere of [false, true]) {
  test('q5: a row re-created at the revision held here with other content is decided, never taken as the same (' + (dirtyHere ? 'changed here' : 'clean') + ')', async t => {
    const { cloud, time, a, b, draft } = await shared(t);
    // The server row is replaced under the same identity at revision 1.
    const row = cloud.rows.get(draft.id);
    cloud.rows.set(draft.id, { ...row, revision: 1, data: { ...copy(row.data), title: '다시 만들어진 내용', updatedAt: new Date(time.now + 1000).toISOString() } });
    if (dirtyHere) await redraft(a, draft.id, '이 기기의 나중 수정', new Date(time.now + 60000).toISOString());
    time.advance(120000); await a.sync.syncNow({ flushDrafts: true }); await a.sync.syncNow({ flushDrafts: true });
    const expected = dirtyHere ? [['draft', KEPT + '다시 만들어진 내용'], ['draft', '이 기기의 나중 수정']].sort() : [['draft', '다시 만들어진 내용']];
    assert.deepEqual(await shown(a), expected);
    if (dirtyHere) assert.equal(cloud.rows.get(draft.id).data.title, '이 기기의 나중 수정');
    else assert.equal(cloud.rows.get(draft.id).data.title, '다시 만들어진 내용');
  });
}

// Review q5 (list first): the other device's revival arrives here before this device's own change to the deleted post is
// sent (still in its upload delay). The received copy is only a mirror and goes; this change meets that row like any
// conflict: one post, the earlier change kept as `복구 사본`. Separated duplicates never reuse a deleted identity.
test('q5: a revival received before this change is sent: one post, the earlier change a recovery copy; the deleted identity is never re-created', async () => {
  const cloud = server(), time = clock();
  const mac = await device(cloud, 'mac', { time }), phone = await device(cloud, 'phone', { time }), ipad = await device(cloud, 'ipad', { time });
  const draft = await mac.storage.savePhotoPost(mac.ws, await post({ title: '두 기기 고침', status: 'draft' }), 0); time.advance(10000);
  await mac.sync.syncNow({ flushDrafts: true }); await phone.sync.syncNow(); await ipad.sync.syncNow();
  await redraft(mac, draft.id, '맥 오프라인 고침', new Date(time.now).toISOString());
  await phone.sync.deletePost(phone.ws, draft.id); await phone.sync.syncNow();
  time.advance(60000); await mac.sync.syncNow({ flushDrafts: true });
  const revived = [...cloud.rows.values()].find(row => row.data.title === '맥 오프라인 고침'); assert.ok(revived);
  // The iPad's change is just written (in its upload delay): its cycle lists first, receives the revival, then decides.
  await redraft(ipad, draft.id, '아이패드 오프라인 고침', new Date(time.now).toISOString());
  // Its read of the revived row is slow: the deletion of its own post is decided only after the revival is installed.
  const read = ipad.remote.read;
  ipad.remote.read = async (id, ...rest) => { if (id === revived.id) await new Promise(resolve => setTimeout(resolve, 60)); return read.call(ipad.remote, id, ...rest); };
  await ipad.sync.syncNow();
  ipad.remote.read = read;
  for (let i = 0; i < 3; i++) { time.advance(60000); await ipad.sync.syncNow({ flushDrafts: true }); await mac.sync.syncNow({ flushDrafts: true }); await phone.sync.syncNow(); }
  const expected = [['draft', KEPT + '맥 오프라인 고침'], ['draft', '아이패드 오프라인 고침']].sort();
  for (const dev of [mac, phone, ipad]) assert.deepEqual(await shown(dev), expected, dev.name);
  assert.equal(cloud.rows.has(draft.id), false, 'the deleted identity is never re-created');
  assert.equal(cloud.rows.get(revived.id).data.title, '아이패드 오프라인 고침', 'the later change took the revived row');
  for (const dev of [mac, phone, ipad]) dev.sync.dispose();
});

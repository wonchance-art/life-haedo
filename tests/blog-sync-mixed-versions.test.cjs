'use strict';
// An earlier app and the current app on the owner's devices at once (2026-11-12, account sync
// review B1, probe q6-mixed). The Mac still runs an app from before v220: when the server no
// longer has a post it changed, it sends the change again under the SAME identity with expected
// revision 0 (the current app moves it to a new identity instead). The phone deletes the post;
// the Mac changes it afterwards; the iPad, which held revision 1 and was away, goes on with it.
//
// With 20261112120000_life_blog_revision_continuity.sql the re-created post continues after the
// deleted revisions (revision 2 here), so the iPad sees a revision it does not hold: it receives
// the Mac's text, or, having changed the post itself, keeps both (the later one, and the other as
// a recovery copy). The earlier server rule (re-created at revision 1, the revision the iPad
// holds) loses the Mac's text without a recovery copy; that is checked too, so the scenario is
// the one the migration closes.
const test = require('node:test'), assert = require('node:assert/strict');
const { server, device, clock, post, copy, Core, Sync } = require('./helpers/blog-sync-cloud.cjs');

const MAC = '옛 앱 맥이 지워진 뒤 쓴 문장', IPAD = '아이패드 덧붙임';
const list = dev => dev.storage.listPhotoPosts(dev.ws);
const read = (dev, id) => dev.storage.readPhotoPost(dev.ws, id);
const text = doc => (doc.ops || []).map(op => typeof op.insert === 'string' ? op.insert : '').join('');
async function prepend(dev, id, sentence, updatedAt) {
  const cur = await read(dev, id);
  return dev.storage.savePhotoPost(dev.ws, { ...copy(cur), ops: [{ insert: sentence + ' ' + text(cur) }], updatedAt }, cur.revision);
}
// The earlier app's answer to `missing`: the same identity again, from revision 0. In c684213
// assets/life/blog-sync.js, send() on `missing` (lines 336-339) sets remoteRevision 0 and keeps
// remoteId, then pushLocked() (line 359) makes a new pending request { operationId: makeId(),
// manifest, expectedRevision: state.remoteRevision (0) } that send() posts with postId
// latest.remoteId (line 318): the same identity, a new operation id, expected revision 0 and the
// same document. This wrapper sends exactly that request. The same scenario was also run once with
// the c684213 modules themselves on the Mac (not committed): the same outcome on both rules.
function earlierApp(dev) {
  const save = dev.remote.save.bind(dev.remote), sent = [];
  dev.remote.save = async request => {
    const result = await save(request);
    if (result.status !== 'missing') return result;
    const again = { ...request, expectedRevision: 0, operationId: Core.id() }; sent.push(again);
    return save(again);
  };
  return sent;
}
async function everything(cloud, devices) {
  const out = [];
  for (const row of cloud.rows.values()) out.push(row.data.title + '|' + text(row.data));
  for (const dev of devices) for (const row of await list(dev)) { const doc = await read(dev, row.id); out.push(doc.title + '|' + text(doc)); }
  return out.join('\n');
}

for (const reuseRevisions of [false, true]) for (const offlineEdit of [false, true]) {
  const name = (reuseRevisions ? 'earlier server rule: ' : '') + 'an earlier app re-creates a post deleted on another device; a device that held revision 1 '
    + (offlineEdit ? 'and changed it while away' : 'and edits it after coming back') + (reuseRevisions ? ' overwrites it (the loss the migration fixes)' : ' loses nothing');
  test(name, async () => {
    const cloud = server({ reuseRevisions }), time = clock();
    const mac = await device(cloud, 'mac-old', { time }), phone = await device(cloud, 'phone', { time }), ipad = await device(cloud, 'ipad', { time });
    const recreations = earlierApp(mac);
    const draft = await mac.storage.savePhotoPost(mac.ws, await post({ title: '혼재 초안', body: '초안 본문.', status: 'draft' }), 0); time.advance(10000);
    await mac.sync.syncNow({ flushDrafts: true }); await phone.sync.syncNow(); await ipad.sync.syncNow();
    assert.equal(cloud.rows.get(draft.id).revision, 1);
    assert.equal((await ipad.storage.readBlogSyncState(ipad.ws, draft.id)).remoteRevision, 1, 'the iPad holds revision 1');
    // The iPad is away from here on. The phone deletes the post.
    await phone.sync.deletePost(phone.ws, draft.id); await phone.sync.syncNow();
    assert.equal(cloud.rows.has(draft.id), false);
    if (!reuseRevisions) assert.equal(cloud.retired.get(draft.id), 1, 'the deleted revision is recorded');
    // The Mac (earlier app) had not heard and changes it.
    await prepend(mac, draft.id, MAC, new Date(time.now + 60000).toISOString()); time.advance(70000);
    if (offlineEdit) await prepend(ipad, draft.id, IPAD, new Date(time.now).toISOString());
    time.advance(10000);
    for (let i = 0; i < 2; i++) { await mac.sync.syncNow({ flushDrafts: true }); await phone.sync.syncNow(); time.advance(60000); }
    assert.equal(recreations.length, 1, 'the earlier app sent the change again under the deleted identity');
    assert.equal(recreations[0].postId, draft.id);
    assert.equal(cloud.rows.get(draft.id)?.revision, reuseRevisions ? 1 : 2, reuseRevisions ? 'earlier rule: re-created at revision 1' : 're-created after the deleted revision: 2');
    assert.ok(text(cloud.rows.get(draft.id).data).includes(MAC));
    // The iPad comes back; if it did not change the post, it edits what it now has.
    for (let i = 0; i < 2; i++) { await ipad.sync.syncNow({ flushDrafts: true }); time.advance(60000); }
    if (!offlineEdit) {
      const held = (await list(ipad)).find(row => row.status === 'draft' && !row.title.startsWith(Sync.CONFLICT_PREFIX));
      await prepend(ipad, held.id, IPAD, new Date(time.now).toISOString()); time.advance(10000);
    }
    for (let i = 0; i < 4; i++) { time.advance(60000); await ipad.sync.syncNow({ flushDrafts: true }); await mac.sync.syncNow({ flushDrafts: true }); await phone.sync.syncNow(); }
    const all = await everything(cloud, [mac, phone, ipad]);
    assert.ok(all.includes(IPAD), 'the iPad\'s sentence is kept');
    if (reuseRevisions) {
      assert.equal(all.includes(MAC), false, 'earlier rule: the Mac\'s sentence is gone from every device and the server, with no recovery copy');
      return;
    }
    // Nothing is lost: on the server and on every device.
    const onServer = [...cloud.rows.values()].map(row => text(row.data)).join('\n');
    assert.ok(onServer.includes(MAC) && onServer.includes(IPAD), 'both sentences are on the server');
    for (const dev of [mac, phone, ipad]) {
      const here = (await Promise.all((await list(dev)).map(row => read(dev, row.id)))).map(text).join('\n');
      assert.ok(here.includes(MAC) && here.includes(IPAD), dev.name + ' has both sentences');
    }
    if (offlineEdit) assert.ok([...cloud.rows.values()].some(row => row.data.title.startsWith(Sync.CONFLICT_PREFIX)), 'the two changes are not merged: one is a recovery copy');
    else assert.ok(text(cloud.rows.get(draft.id).data).includes(MAC + ' ') && text(cloud.rows.get(draft.id).data).includes(IPAD), 'the iPad received the Mac\'s text and wrote on top of it');
    for (const dev of [mac, phone, ipad]) {
      const states = await Promise.all((await list(dev)).map(row => dev.storage.readBlogSyncState(dev.ws, row.id)));
      assert.ok(states.every(state => state?.status === 'synced'), dev.name + ' has nothing left to send: ' + JSON.stringify(states.map(state => state?.status)));
    }
    for (const dev of [mac, phone, ipad]) dev.sync.dispose();
  });
}

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../assets/life/core.js'), Photo = require('../assets/life/photo-post.js');
const N = require('../assets/life/nine-board.js'), W = require('../assets/life/workbench.js');
require('../assets/life/preservation-references.js'); require('../assets/life/preservation-package.js');
const Service = require('../assets/life/preservation.js');
function fixture() {
  const bundle = C.createWorkspace(), doc = Photo.create(C.id); doc.status = 'saved'; doc.revision = 1;
  doc.title = '선택 글'; doc.ops = [{ insert: '내가 고른 비공개 본문\n' }];
  const snapshot = { bundle, posts: [{ doc, evidence: { revision: 0, refs: [] } }], nineBoard: N.empty(bundle.workspaceId) };
  const state = { snapshot, current: true, installs: [], reads: 0 };
  const storage = {
    account: { projectUrl: 'https://example.supabase.co', userId: 'anonymous-test-account' }, isAccountScoped: true,
    async readPreservationSnapshot() { state.reads++; return structuredClone(state.snapshot); },
    async readPreservationCatalog() { return { workspace: { workspaceId: bundle.workspaceId, title: bundle.title }, posts: [{ id: doc.id, title: doc.title }], boards: [] }; },
    async listUnownedWorkspaces() { return []; },
    async installPreservationCopy(copy, options) { state.lastInstallOptions = structuredClone(options); state.installs.push(structuredClone(copy)); return structuredClone(copy); },
    async read() { return structuredClone(bundle); }, async listStages() { return []; },
    async readWorkbench() { return W.empty(bundle.workspaceId); }, async listPhotoPosts() { return [{ id: doc.id, status: 'saved' }]; },
    async readPageDrafts() { return { revision: 0, posts: [] }; }, async readCollection() { return { items: [] }; },
    async readNineBoard() { return structuredClone(snapshot.nineBoard); }, async readPostEvidence() { return { revision: 0, refs: [] }; }
  };
  const service = Service.create({ storage, workspaceId: bundle.workspaceId, isCurrent: () => state.current });
  return { service, storage, state, doc, bundle };
}
test('one failed inventory read remains unknown while independently readable material retains its count and server limits', async () => {
  const { service, storage } = fixture(); storage.readCollection = async () => { throw Error('injected read failure'); };
  const result = await service.inventory(); assert.equal(result.rows.length, 8);
  const failed = result.rows.find(row => row.key === 'collection');
  assert.equal(failed.status, 'error'); assert.equal(failed.count, null);
  const posts = result.rows.find(row => row.key === 'photoPosts'); assert.equal(posts.status, 'ready'); assert.equal(posts.count, 1);
  assert.match(posts.server, /미확인/); assert.match(result.rows.find(row => row.key === 'evidence').server, /제외/);
});
test('previewed saved post changed by another tab cannot be exported or installed from a stale selection', async () => {
  const { service, state, doc } = fixture();
  const review = await service.prepare({ postIds: [doc.id], boardIds: [] }); assert.equal(review.summary.posts.length, 1);
  state.snapshot.posts[0].doc.revision++; state.snapshot.posts[0].doc.ops = [{ insert: '다른 탭의 새 본문\n' }];
  await assert.rejects(service.export(review.ticket), { code: 'preservation_source_changed' });
  await assert.rejects(service.restore(review.ticket), { code: 'preservation_source_changed' });
  assert.equal(state.installs.length, 0); assert.equal(state.snapshot.posts[0].doc.revision, 2);
});
test('cancelled and previous-account candidates cannot trigger restoration or further source reads', async () => {
  const { service, state, doc } = fixture();
  const review = await service.prepare({ postIds: [doc.id], boardIds: [] });
  service.cancel(review.ticket); const reads = state.reads;
  await assert.rejects(service.restore(review.ticket), { code: 'preservation_candidate_missing' }); assert.equal(state.reads, reads);
  const next = await service.prepare({ postIds: [doc.id], boardIds: [] }); state.current = false;
  await assert.rejects(service.export(next.ticket), { code: 'preservation_cancelled' }); assert.equal(state.installs.length, 0);
});
test('account change during a delayed inventory read rejects the whole view without returning old-account data', async () => {
  const { service, storage, state } = fixture(); let release;
  const original = storage.read; storage.read = () => new Promise(resolve => { release = async () => resolve(await original()); });
  const pending = service.inventory(); await new Promise(resolve => setImmediate(resolve));
  state.current = false; await release(); await assert.rejects(pending, { code: 'preservation_cancelled' });
});
test('file round trip restores a new private copy and committed success survives a view-change notification', async () => {
  const { service, storage, state, doc, bundle } = fixture();
  const before = structuredClone(state.snapshot), review = await service.prepare({ postIds: [doc.id], boardIds: [] });
  const file = await service.export(review.ticket), imported = await service.read(file);
  const install = storage.installPreservationCopy;
  storage.installPreservationCopy = async value => { const result = await install(value); state.current = false; return result; };
  const result = await service.restore(imported.ticket);
  assert.notEqual(result.bundle.workspaceId, bundle.workspaceId); assert.notEqual(result.posts[0].doc.id, doc.id);
  assert.equal(result.posts[0].doc.status, 'saved'); assert.equal(result.posts[0].doc.revision, 1);
  assert.deepEqual(state.snapshot, before); assert.equal(state.installs.length, 1);
});

test('direct account-copy restoration supplies its original selected scope for the final transaction guard', async () => {
  const { service, state, doc, bundle } = fixture();
  const review = await service.prepare({ postIds: [doc.id], boardIds: [] });
  await service.restorePrepared(review.ticket);
  assert.equal(state.lastInstallOptions.source.workspaceId, bundle.workspaceId);
  assert.equal(state.lastInstallOptions.source.unowned, false);
  assert.deepEqual(state.lastInstallOptions.source.expected.posts.map(row => row.doc.id), [doc.id]);
  assert.equal(state.installs.length, 1);
});

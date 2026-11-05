'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Core = require('../assets/life/core.js'), Writing = require('../assets/life/material-writing.js');
const Model = require('../assets/life/material-continuity.js'), Blog = require('../assets/life/blog.js');
const Photo = require('../assets/life/photo-post.js');
const BlogRemote = require('../assets/life/blog-remote.js');
const Service = require(process.env.MATERIAL_CONTINUITY_SYNC_MODULE || '../assets/life/material-continuity-sync.js');
const clone = value => structuredClone(value);
const fault = code => Object.assign(new Error(code), { code });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function fixture({ useBlogRemote = false } = {}) {
  const bundle = Core.createWorkspace(), plan = Writing.create(Core.id);
  plan.title = '삭제한 글의 준비';
  plan.blocks.push({ id: Core.id(), kind: 'paragraph', text: '원문과 별개인 합성 작성문\n' });
  const post = Writing.project({ ...Writing.empty(bundle.workspaceId), plans: [plan] }, plan.id, Core.id).doc;
  post.status = 'saved'; post.revision = 1; plan.output = { postId: post.id };
  const output = { state: 'saved', postId: post.id, claimId: Core.id(), revision: 1, refs: [] };
  const row = { id: Core.id(), revision: 1, updated_at: post.updatedAt, data: Model.snapshot(bundle, plan, output) };
  const owner = { userId: Core.id(), projectUrl: 'https://synthetic.example.org' };
  let account = owner;
  const auth = { epoch: 1, user: { id: owner.userId }, getAccount: () => account };
  const stats = { materialReads: 0, blogReads: 0, markerReads: 0, installs: [], adopts: [] };
  const controls = { marker: false, blog: null, blogError: null, blogGate: null, markerGate: null, remoteTransform: null };
  const storage = {
    account: owner,
    async findMaterialContinuity() { return null; },
    async readMaterialWriting() { return Writing.empty(bundle.workspaceId); },
    async readMaterialContinuityOutputDeletion(input) {
      stats.markerReads++; assert.deepEqual(input, row);
      if (controls.markerGate) { controls.markerGate.started.resolve(); await controls.markerGate.release.promise; }
      return controls.marker;
    },
    async installMaterialContinuity(input, options) { stats.installs.push({ row: clone(input), options: clone(options) }); return { workspaceId: bundle.workspaceId, planId: plan.id }; },
    async adoptMaterialContinuity(input, options) { stats.adopts.push({ row: clone(input), options: clone(options) }); return { workspaceId: bundle.workspaceId, planId: plan.id }; }
  };
  const remote = { async read() { stats.materialReads++; const result = clone(row); controls.remoteTransform?.(result); return result; } };
  let blogRemote = { async read(id) {
    stats.blogReads++; assert.equal(id, post.id);
    const response = clone(controls.blog), error = controls.blogError;
    if (controls.blogGate) { controls.blogGate.started.resolve(); await controls.blogGate.release.promise; }
    if (error) throw error; return response;
  } };
  if (useBlogRemote) {
    const read = blogRemote.read;
    Object.assign(auth, { ready: true, verify: async () => auth.user, client: { async rpc(name, params) {
      assert.equal(name, 'life_blog_read'); return { data: await read(params.p_post_id), error: null };
    } } });
    blogRemote = BlogRemote.create({ auth, blog: Blog });
  }
  const manager = Service.create({ storage, auth, model: Model, remote, blogRemote, blog: Blog, photoPost: Photo });
  return { manager, row, post, bundle, plan, controls, stats, storage, blogRemote,
    receive: () => manager.receive(row.id, row.revision),
    livePost(revision = 1) { controls.blog = { id: post.id, workspace_id: bundle.workspaceId, revision, data: Blog.pack(post), assets: {}, updated_at: post.updatedAt }; },
    switchAccount() { account = { ...owner, userId: Core.id() }; auth.user = { id: account.userId }; auth.epoch++; } };
}

for (const path of ['receive', 'adopt']) test(`server-verified saved output plus a successful null read passes an exact deletion proof through ${path}`, async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  await (path === 'receive' ? f.receive() : f.manager.adopt({ id: f.row.id, revision: f.row.revision }));
  assert.equal(f.stats.blogReads, 1); assert.equal(f.stats.markerReads, 1);
  const installed = (path === 'receive' ? f.stats.installs : f.stats.adopts);
  assert.equal(installed.length, 1);
  assert.deepEqual(installed[0], { row: f.row, options: { deletedOutput: {
    binding: f.storage.account, remoteId: f.row.id, revision: f.row.revision,
    workspaceId: f.row.data.bundle.workspaceId, planId: f.row.data.plan.id, output: f.row.data.output
  } } });
});

test('an old storage module refusing the new proof is never retried as an unproven installation', async t => {
  const f = fixture(); t.after(() => f.manager.dispose()); delete f.storage.readMaterialContinuityOutputDeletion;
  let attempted = 0;
  f.storage.installMaterialContinuity = async (_row, options) => {
    attempted++; assert(options.deletedOutput); throw fault('invalid_request');
  };
  await assert.rejects(f.receive(), { code: 'invalid_request' }); assert.equal(attempted, 1);
  assert.deepEqual(f.stats.installs, []);
});

for (const path of ['receive', 'adopt']) test(`validated deletion evidence permits ${path} without inventing a saved post`, async t => {
  const f = fixture(); t.after(() => f.manager.dispose()); f.controls.marker = true;
  await (path === 'receive' ? f.receive() : f.manager.adopt({ id: f.row.id, revision: f.row.revision }));
  const installs = path === 'receive' ? f.stats.installs : f.stats.adopts;
  assert.equal(f.stats.blogReads, 1); assert.equal(f.stats.markerReads, 1); assert.equal(installs.length, 1);
  assert.deepEqual(installs[0].row, f.row); assert.deepEqual(installs[0].options, {});
  assert.equal(installs[0].row.data.output.postId, f.post.id);
});

test('a non-boolean marker result still requires the server deletion proof', async t => {
  const f = fixture(); t.after(() => f.manager.dispose()); f.controls.marker = { deleted: true };
  await f.receive();
  assert.equal(f.stats.installs.length, 1); assert.equal(f.stats.installs[0].options.deletedOutput.output.postId, f.post.id);
});

for (const code of ['network_error', 'auth_required', 'permission_denied', 'request_cancelled']) test(`a ${code} read never creates deletion evidence or installs a preparation`, async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  f.controls.marker = true; f.controls.blogError = fault(code);
  await assert.rejects(f.receive(), error => error === f.controls.blogError);
  assert.equal(f.stats.markerReads, 0); assert.deepEqual(f.stats.installs, []);
});

for (const partial of [undefined, false, {}, { revision: 1 }]) test(`a partial blog response ${JSON.stringify(partial)} is not a successful missing-post read`, async t => {
  const f = fixture(); t.after(() => f.manager.dispose()); f.controls.blog = partial;
  await assert.rejects(f.receive());
  assert.equal(f.stats.markerReads, 0); assert.deepEqual(f.stats.installs, []);
});

test('a writing claim never creates server deletion proof from an absent post', async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  f.row.data.output = { state: 'writing', postId: f.post.id, claimId: f.row.data.output.claimId };
  await f.receive();
  assert.equal(f.stats.blogReads, 0); assert.equal(f.stats.markerReads, 0);
  assert.deepEqual(f.stats.installs[0].options, {});
});

test('an invalid server descriptor cannot manufacture deletion proof from a null post', async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  f.controls.remoteTransform = row => { row.data.output.revision = 0; };
  await assert.rejects(f.receive(), { code: 'invalid_material_continuity' });
  assert.equal(f.stats.blogReads, 0); assert.deepEqual(f.stats.installs, []);
});

test('a response for a different preparation cannot create deletion proof for the requested one', async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  f.controls.remoteTransform = row => { row.id = Core.id(); };
  await assert.rejects(f.receive(), { code: 'material_receive_changed' });
  assert.equal(f.stats.blogReads, 0); assert.deepEqual(f.stats.installs, []);
});

test('an account switch during the successful null read discards the old deletion proof', async t => {
  const f = fixture(); t.after(() => f.manager.dispose());
  const gate = { started: deferred(), release: deferred() }; f.controls.blogGate = gate;
  const receiving = f.receive(), rejected = assert.rejects(receiving, { code: 'request_cancelled' });
  await gate.started.promise; f.switchAccount(); gate.release.resolve(); await rejected;
  assert.equal(f.stats.markerReads, 0); assert.deepEqual(f.stats.installs, []);
});

test('a deletion marker never permits an existing output at a different revision', async t => {
  const f = fixture(); t.after(() => f.manager.dispose()); f.controls.marker = true; f.livePost(2);
  await assert.rejects(f.receive(), { code: 'material_output_changed' });
  assert.equal(f.stats.markerReads, 0); assert.deepEqual(f.stats.installs, []);
});

test('the verified existing output wins over old deletion history', async t => {
  const f = fixture(); t.after(() => f.manager.dispose()); f.controls.marker = true; f.livePost();
  await f.receive();
  assert.equal(f.stats.markerReads, 0); assert.equal(f.stats.installs.length, 1);
  assert.deepEqual(Blog.pack(f.stats.installs[0].options.post), Blog.pack(f.post));
  assert.deepEqual(f.stats.installs[0].options.blogRow, f.controls.blog);
});

test('an account switch during deletion-evidence lookup discards the old receive', async t => {
  const f = fixture(); t.after(() => f.manager.dispose()); f.controls.marker = true;
  const gate = { started: deferred(), release: deferred() }; f.controls.markerGate = gate;
  const receiving = f.receive(), rejected = assert.rejects(receiving, { code: 'request_cancelled' });
  await gate.started.promise; f.switchAccount(); gate.release.resolve(); await rejected;
  assert.deepEqual(f.stats.installs, []);
});

const drain = () => new Promise(resolve => setImmediate(resolve));
function automaticReadFixture(t, options) {
  const f = fixture(options); t.after(() => { f.manager.dispose(); f.blogRemote.dispose?.(); });
  let notify = null;
  f.storage.listAccountLibraries = async () => [{ workspaceId: f.bundle.workspaceId, eligible: true }];
  f.storage.listMaterialContinuityOrphans = async () => [];
  f.storage.subscribeAll = listener => { notify = listener; return () => { notify = null; }; };
  const manager = { list: async () => ({ items: [{ id: f.row.id, revision: f.row.revision }], next: null }),
    adopt: item => f.manager.adopt(item) };
  const loop = Service.automatic({ storage: f.storage, auth: {}, manager });
  t.after(() => loop.dispose());
  return { ...f, loop, emitMarker() { notify?.({ type: 'account_doc_applied', key: 'materialOutputDeleted:synthetic-account:synthetic-plan' }); } };
}

for (const failure of ['network_error', 'auth_required', 'request_cancelled']) test(`a deferred ${failure} output read retries on the next sync pass without a marker event or time jump`, async t => {
  const f = automaticReadFixture(t), { loop } = f;
  f.controls.blogError = fault(failure);
  loop.start(); await loop.refresh();
  assert.equal(f.stats.blogReads, 1); assert.equal(f.stats.adopts.length, 0);
  f.controls.blogError = null; f.controls.blog = null;
  await loop.refresh();
  assert.equal(f.stats.blogReads, 2); assert.equal(f.stats.adopts.length, 1);
  assert.equal(f.stats.adopts[0].options.deletedOutput.output.postId, f.post.id);
});

// One consistent server read that fails verification cannot become valid by
// re-reading it: ordinary passes keep the 30-minute delay (no 16 MiB refetch
// loop) until the preparation revision changes.
const persistentlyInvalid = async (t, f) => {
  const { loop } = f;
  assert.equal(f.stats.blogReads, 1); assert.equal(f.stats.adopts.length, 0);
  f.controls.blogError = null; f.controls.blog = null;
  await loop.refresh(); await loop.refresh();
  assert.equal(f.stats.blogReads, 1); assert.equal(f.stats.adopts.length, 0);
  f.row.revision++; await loop.refresh();
  assert.equal(f.stats.blogReads, 2); assert.equal(f.stats.adopts.length, 1);
  assert.equal(f.stats.adopts[0].options.deletedOutput.output.postId, f.post.id);
};
for (const failure of ['invalid_remote_data', 'partial', 'partial-body', 'partial-assets']) test(`a ${failure} output read keeps the 30-minute delay on ordinary passes until the preparation changes`, async t => {
  const f = automaticReadFixture(t), { loop } = f;
  if (failure === 'partial') f.controls.blog = undefined;
  else if (failure === 'partial-body') f.controls.blog = { revision: 1 };
  else if (failure === 'partial-assets') { f.livePost(); delete f.controls.blog.assets; }
  else f.controls.blogError = fault(failure);
  loop.start(); await loop.refresh();
  await persistentlyInvalid(t, f);
});

for (const partial of ['body', 'assets']) test(`a ${partial}-incomplete row rejected by the real BlogRemote adapter keeps the 30-minute delay until the preparation changes`, async t => {
  const f = automaticReadFixture(t, { useBlogRemote: true });
  f.livePost(); delete f.controls.blog[partial === 'body' ? 'data' : 'assets'];
  f.loop.start(); await drain();
  await persistentlyInvalid(t, f);
});

test('persistent output revision mismatch skips body reads on poll, focus and visibility until 30 minutes or a changed preparation revision', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: 1800000000000 });
  const windowEvents = new EventTarget(), documentEvents = new EventTarget();
  const previous = new Map(['addEventListener', 'removeEventListener', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(documentEvents, { visibilityState: 'visible' });
  Object.assign(globalThis, { addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents), document: documentEvents });
  t.after(() => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const f = automaticReadFixture(t); f.livePost(2);
  f.loop.start(); await drain();
  assert.equal(f.stats.materialReads, 1); assert.equal(f.stats.blogReads, 1); assert.equal(f.stats.adopts.length, 0);
  t.mock.timers.tick(60000); await drain();
  windowEvents.dispatchEvent(new Event('focus')); await drain();
  documentEvents.dispatchEvent(new Event('visibilitychange')); await drain();
  await f.loop.refresh();
  assert.equal(f.stats.materialReads, 1); assert.equal(f.stats.blogReads, 1);
  t.mock.timers.tick(29 * 60000 - 1); await drain();
  assert.equal(f.stats.materialReads, 1); assert.equal(f.stats.blogReads, 1);
  t.mock.timers.tick(1); await drain();
  assert.equal(f.stats.materialReads, 2); assert.equal(f.stats.blogReads, 2);
  f.row.revision++; await f.loop.refresh();
  assert.equal(f.stats.materialReads, 3); assert.equal(f.stats.blogReads, 3); assert.equal(f.stats.adopts.length, 0);
  f.controls.blog = null; f.controls.marker = true; f.emitMarker();
  t.mock.timers.tick(2000); await drain();
  assert.equal(f.stats.materialReads, 4); assert.equal(f.stats.blogReads, 4); assert.equal(f.stats.adopts.length, 1);
  assert.deepEqual(f.stats.adopts[0].options, {});
});

test('a permission-denied original read keeps the ordinary adoption retry delay', async t => {
  const f = automaticReadFixture(t); f.controls.blogError = fault('permission_denied');
  f.loop.start(); await drain(); await f.loop.refresh();
  assert.equal(f.stats.materialReads, 1); assert.equal(f.stats.blogReads, 1); assert.equal(f.stats.adopts.length, 0);
});

test('a marker arriving during a real mismatched output read prevents its late failure from restoring the retry delay', async t => {
  const f = automaticReadFixture(t); f.livePost(2);
  const gate = { started: deferred(), release: deferred() }; f.controls.blogGate = gate;
  f.loop.start(); await gate.started.promise;
  f.controls.blog = null; f.controls.marker = true; f.emitMarker(); gate.release.resolve();
  await drain();
  assert.equal(f.stats.materialReads, 2); assert.equal(f.stats.blogReads, 2); assert.equal(f.stats.adopts.length, 1);
  assert.deepEqual(f.stats.adopts[0].options, {});
});

function automaticFixture() {
  const workspaceId = Core.id(), remoteId = Core.id(), calls = [];
  let notify = null, canAdopt = false, heldAttempt = null;
  const storage = { account: { userId: Core.id(), projectUrl: 'https://synthetic.example.org' },
    readMaterialWriting: async () => ({ plans: [] }), adoptMaterialContinuity() {},
    listAccountLibraries: async () => [{ workspaceId, eligible: true }],
    listMaterialContinuityOrphans: async () => [],
    subscribeAll(listener) { notify = listener; return () => { notify = null; }; } };
  const manager = { list: async () => ({ items: [{ id: remoteId, revision: 1 }], next: null }),
    async adopt() {
      calls.push('adopt');
      if (heldAttempt) { const gate = heldAttempt; heldAttempt = null; gate.started.resolve(); await gate.release.promise; throw fault('material_output_changed'); }
      if (!canAdopt) throw fault('material_output_changed');
      return { workspaceId, planId: 'synthetic-plan' };
    } };
  const loop = Service.automatic({ storage, auth: {}, manager, every: 3600000 });
  return { loop, calls, remoteId,
    allow() { canAdopt = true; },
    hold(gate) { heldAttempt = gate; },
    emit(type = 'account_doc_applied', key = 'materialOutputDeleted:synthetic-account:synthetic-plan') { notify?.({ type, key, workspaceId }); } };
}

test('late deletion evidence wakes a previously failed preparation receive without the 30-minute retry delay', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = automaticFixture(); t.after(() => f.loop.dispose()); f.loop.start(); await f.loop.refresh();
  assert.equal(f.calls.length, 1);
  f.allow(); f.emit(); t.mock.timers.tick(2000); await drain();
  assert.equal(f.calls.length, 2);
});

test('evidence arriving during failed adoption prevents that failure from reinstating the retry delay', async t => {
  const f = automaticFixture(); t.after(() => f.loop.dispose());
  const gate = { started: deferred(), release: deferred() }; f.hold(gate);
  f.loop.start(); await gate.started.promise;
  f.allow(); f.emit(); gate.release.resolve(); await drain();
  assert.equal(f.calls.length, 2);
});

test('unrelated account documents and writes during a pass do not create a receive loop', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = automaticFixture(); t.after(() => f.loop.dispose());
  const gate = { started: deferred(), release: deferred() }; f.hold(gate);
  f.loop.start(); await gate.started.promise;
  f.emit('account_doc_applied', 'annualPlan:synthetic-workspace'); f.emit('material_writing_changed');
  gate.release.resolve(); await drain(); t.mock.timers.tick(2000); await drain();
  assert.equal(f.calls.length, 1);
});

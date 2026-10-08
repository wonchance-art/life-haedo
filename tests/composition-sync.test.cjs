'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Workbench = require('../assets/life/workbench.js');
const source = fs.readFileSync(require.resolve('../assets/life/composition-sync.js'), 'utf8');
const copy = value => structuredClone(value);
const OWNER = { projectUrl: 'https://composition-fixture.example.invalid', userId: '11111111-1111-4111-8111-111111111111' };
const WORKSPACE = '33333333-3333-4333-8333-333333333333';
const OPERATION = '44444444-4444-4444-8444-444444444444';
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const cancelled = error => { assert.equal(error.code, 'request_cancelled'); return true; };

// Controller interleavings only. Real IndexedDB transactions/recovery and SQL CAS
// are verified by composition-storage-browser.cjs and the local SQL suite.
function fixture(t) {
  const binding = { ...OWNER, remoteId: WORKSPACE };
  const local = Workbench.empty(WORKSPACE); local.revision = 1; local.reflection.note = '이 기기의 독서 메모';
  const state = {
    account: copy(OWNER), local, epoch: 0, calls: [], mutations: [], reads: 0, sent: [],
    meta: { workspaceId: WORKSPACE, binding, enabled: true, remoteRevision: 1, sourceRevision: 1,
      syncedLocalRevision: 1, outbox: null, conflict: null, status: 'synced', error: null, lastRecoveryId: null },
    row: { workspace_id: WORKSPACE, revision: 1, source_revision: 1, data: copy(local), updated_at: '2026-10-06T00:00:00Z' }
  };
  const timers = new Map(), timerScheduled = deferred(); let nextTimer = 0;
  const storage = {
    account: copy(OWNER),
    async listWorkspaces() { return [{ workspaceId: WORKSPACE }]; },
    async getCompositionState() { return copy(state.meta); },
    subscribe() { return () => {}; },
    async bindCompositionSync() { state.mutations.push('bind'); state.meta.enabled = true; },
    async pauseCompositionSync() { state.mutations.push('pause'); state.meta.enabled = false; },
    async prepareCompositionUpload() { state.calls.push('prepare'); return copy(state.meta.outbox); },
    async applyCompositionRemote(_id, _binding, row) {
      state.mutations.push('apply');
      if (row.revision > state.meta.remoteRevision) {
        state.local = { ...copy(row.data), revision: state.local.revision + 1 };
        state.meta.remoteRevision = row.revision; state.meta.syncedLocalRevision = state.local.revision;
      }
      return { status: 'stored', revision: state.local.revision };
    },
    async ackCompositionSync(_id, _binding, operationId, revision) {
      state.mutations.push('ack');
      assert.equal(operationId, state.meta.outbox.operationId);
      state.meta.remoteRevision = revision; state.meta.syncedLocalRevision = state.meta.outbox.localRevision;
      state.meta.outbox = null; state.meta.status = 'synced';
    },
    async setCompositionError(_id, _binding, error) {
      state.mutations.push('error'); state.meta.error = copy(error);
      if (error) state.meta.status = 'error';
    },
    async setCompositionConflict(_id, _binding, row) {
      state.mutations.push('conflict');
      state.meta.conflict = { missing: !row, row: copy(row), remoteRevision: row?.revision ?? state.meta.remoteRevision,
        localRevision: state.local.revision };
      state.meta.status = 'conflict';
    }
  };
  const sourceSync = {
    async getState() { return { enabled: true, status: 'synced', binding, remoteRevision: 1 }; },
    async syncNow() { state.calls.push('sources'); },
    subscribe() { return () => {}; }
  };
  const remote = {
    async read() {
      state.calls.push('read'); state.reads++;
      if (state.readOverride) return state.readOverride(state.reads);
      return copy(state.row);
    },
    async write(request) {
      state.calls.push('write'); state.sent.push(copy(request));
      assert.ok(state.writeOverride, 'Unexpected remote write');
      return state.writeOverride(request);
    },
    dispose() {}
  };
  const auth = { getAccount: () => copy(state.account), get epoch() { return state.epoch; } };
  const context = {
    module: { exports: {} },
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); timerScheduled.resolve(); return id; },
    clearTimeout(id) { timers.delete(id); }, setInterval() { return 1; }, clearInterval() {}
  };
  vm.runInNewContext(source, context);
  const manager = context.module.exports.create({ storage, sourceSync, remote, auth });
  t.after(() => manager.dispose());
  return { manager, state, timers, timerScheduled, changeAccount(value) { state.account = copy(value); state.epoch++; } };
}

test('pausing a stalled read allows a new generation to resume before the old response arrives', async t => {
  const f = fixture(t), entered = deferred(), oldReply = deferred(), resumedRead = deferred();
  f.state.readOverride = count => {
    if (count === 1) { entered.resolve(); return oldReply.promise; }
    resumedRead.resolve(); return copy(f.state.row);
  };
  const oldRun = f.manager.syncNow(WORKSPACE);
  const rejectedOld = assert.rejects(oldRun, cancelled);
  await entered.promise;
  await f.manager.pause(WORKSPACE);
  assert.equal(f.state.meta.enabled, false);
  const resumed = f.manager.enable(WORKSPACE);
  // Convert failures to a settled outcome immediately so teardown cannot leak a rejection.
  const resumedOutcome = resumed.then(value => ({ value }), error => ({ error }));
  try {
    // Drain the finite promise chain. No wall-clock timeout or simulated network
    // completion: the old request deliberately stays unresolved during this check.
    const outcome = await Promise.race([
      resumedRead.promise.then(() => 'new request'),
      new Promise(resolve => setImmediate(() => resolve('no new request')))
    ]);
    assert.equal(outcome, 'new request', 'Resume must not wait behind the cancelled generation');
    const result = await resumedOutcome;
    assert.equal(result.error, undefined);
    assert.equal(result.value.status, 'synced');
    assert.equal(f.state.meta.enabled, true);
    const mutations = copy(f.state.mutations);
    oldReply.resolve(copy(f.state.row)); await rejectedOld;
    assert.deepEqual(f.state.mutations, mutations, 'Late old read cannot apply after the new generation');
  } finally {
    oldReply.resolve(copy(f.state.row));
    await rejectedOld; await resumedOutcome;
  }
});

test('an account change between scheduling and running a timer rejects asynchronously without an uncaught exception', async t => {
  const f = fixture(t); f.manager.start();
  await f.timerScheduled.promise;
  assert.equal(f.timers.size, 1);
  f.changeAccount(null);
  const callback = f.timers.values().next().value;
  assert.doesNotThrow(() => callback(), 'Timer must contain syncNow cancellation in its rejection handler');
  await assert.rejects(f.manager.syncNow(WORKSPACE), cancelled);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.state.calls, []);
  assert.deepEqual(f.state.mutations, []);
});

test('a durable lost-response outbox is replayed unchanged before reading the newer remote head', async t => {
  const f = fixture(t);
  f.state.local.revision = 2; f.state.local.reflection.note = '이어 쓰다 응답을 받지 못한 메모 🌱';
  f.state.local.books = [{ id: 'book_pending', title: '응답을 잃은 책', fromYear: '', toYear: '', question: '',
    chapters: [{ id: 'chapter_pending', title: '옛 글에서 시작', note: '보관한 책 원고\r\n🌱', versionIds: ['exact_old_version', 'missing_version'],
      insights: [{ id: 'insight_pending', statement: '재전송할 현재 해석', uncertainty: '', supportVersionIds: ['independent_missing'], counterVersionIds: ['exact_old_version'], excluded: false }] }] }];
  f.state.meta.outbox = { operationId: OPERATION, expectedRevision: 1, sourceRevision: 1,
    localRevision: 2, data: copy(f.state.local) };
  f.state.meta.status = 'pending';
  const durableOutbox = copy(f.state.meta.outbox);
  // The server already committed this operation; its successful receipt was lost.
  f.state.row = { ...f.state.row, revision: 2, data: copy(durableOutbox.data) };
  f.state.writeOverride = () => ({ status: 'stored', revision: 2 });
  const result = await f.manager.syncNow(WORKSPACE);
  assert.deepEqual(f.state.calls.filter(call => call === 'read' || call === 'write'), ['write', 'read']);
  assert.deepEqual(f.state.sent, [{ workspaceId: WORKSPACE, ...durableOutbox }]);
  assert.equal(f.state.meta.outbox, null);
  assert.equal(f.state.meta.remoteRevision, 2);
  assert.equal(result.status, 'synced');
  assert.deepEqual(f.state.local, durableOutbox.data);
  assert.equal(f.state.mutations.includes('conflict'), false);
});

test('a failed book upload preserves the durable outbox and retries the same complete operation', async t => {
  const f = fixture(t);
  f.state.local.revision = 2;
  f.state.local.books = [{ id: 'book_retry', title: '재시도할 책', fromYear: '', toYear: '', question: '그때와 지금',
    chapters: [{ id: 'chapter_retry', title: '첫 장', note: '지워지면 안 되는 원고', versionIds: ['exact_old_version', 'missing_version'],
      insights: [{ id: 'insight_retry', statement: '', uncertainty: '빈 해석의 입력 대기', supportVersionIds: ['independent_missing'], counterVersionIds: ['exact_old_version'], excluded: true }] }] }];
  f.state.meta.outbox = { operationId: OPERATION, expectedRevision: 1, sourceRevision: 1, localRevision: 2, data: copy(f.state.local) };
  f.state.meta.status = 'pending'; const durable = copy(f.state.meta.outbox), local = copy(f.state.local);
  f.state.writeOverride = () => { throw Object.assign(new Error('fixture transport failure'), { code: 'network_error' }); };
  await assert.rejects(f.manager.syncNow(WORKSPACE), { code: 'network_error' });
  assert.deepEqual(f.state.meta.outbox, durable); assert.deepEqual(f.state.local, local);
  assert.equal(f.state.mutations.includes('ack'), false);
  f.state.row = { ...f.state.row, revision: 2, data: copy(durable.data) };
  f.state.writeOverride = () => ({ status: 'stored', revision: 2 });
  assert.equal((await f.manager.syncNow(WORKSPACE)).status, 'synced');
  assert.deepEqual(f.state.sent, [{ workspaceId: WORKSPACE, ...durable }, { workspaceId: WORKSPACE, ...durable }]);
  assert.equal(f.state.meta.outbox, null); assert.deepEqual(f.state.local.books, local.books);
});

test('late remote responses after A changes to B or returns to A cannot mutate local composition', async t => {
  for (const returnsToA of [false, true]) {
    const f = fixture(t), entered = deferred(), reply = deferred();
    const before = { local: copy(f.state.local), metadata: copy(f.state.meta) };
    f.state.readOverride = () => { entered.resolve(); return reply.promise; };
    const pending = f.manager.syncNow(WORKSPACE), rejected = assert.rejects(pending, cancelled);
    await entered.promise;
    f.changeAccount({ ...OWNER, userId: '22222222-2222-4222-8222-222222222222' });
    if (returnsToA) f.changeAccount(OWNER);
    const remote = copy(f.state.row); remote.revision = 2; remote.data.reflection.note = '늦게 도착한 이전 계정 응답';
    reply.resolve(remote); await rejected;
    assert.deepEqual(f.state.local, before.local);
    assert.deepEqual(f.state.meta, before.metadata);
    assert.deepEqual(f.state.mutations, []);
    assert.deepEqual(f.state.sent, []);
    f.manager.dispose();
  }
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Workbench = require('../assets/life/workbench.js');
const source = fs.readFileSync(require.resolve('../assets/life/composition-sync.js'), 'utf8');
// The page loads sync-lifecycle.js before the engines (S2).
const lifecycleSource = fs.readFileSync(require.resolve('../assets/life/sync-lifecycle.js'), 'utf8');
const copy = value => structuredClone(value);
const OWNER = { projectUrl: 'https://composition-fixture.example.invalid', userId: '11111111-1111-4111-8111-111111111111' };
const WORKSPACE = '33333333-3333-4333-8333-333333333333';
const OPERATION = '44444444-4444-4444-8444-444444444444';
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const cancelled = error => { assert.equal(error.code, 'request_cancelled'); return true; };

function addArchivedEdition(book) {
  book.archived = true; book.chapters[0].archived = true;
  const chapters = copy(book.chapters);
  chapters.forEach(chapter => { chapter.id += '_edition'; chapter.insights?.forEach(thought => { thought.id += '_edition'; }); });
  chapters[0].versionIds.push('edition_missing_version');
  chapters[0].insights[0].counterVersionIds.push('edition_missing_version');
  book.editions = [{ id: book.id + '_edition', label: '전송할 개정본', createdAt: '2026-10-08T00:00:00.000Z', title: '그때의 책', fromYear: '', toYear: '', question: '그때의 질문', chapters }];
}

// Controller interleavings only. Real IndexedDB transactions/recovery and SQL CAS
// are verified by composition-storage-browser.cjs and the local SQL suite.
function fixture(t, options = {}) {
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
    async prepareCompositionUpload() {
      state.calls.push('prepare');
      if (state.prepareOverride && !state.meta.outbox && state.meta.syncedLocalRevision !== state.local.revision) state.meta.outbox = state.prepareOverride();
      return copy(state.meta.outbox);
    },
    async applyCompositionRemote(_id, _binding, row) {
      state.mutations.push('apply');
      if (state.applyOverride && row.revision !== state.meta.remoteRevision) return state.applyOverride(row);
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
    },
    async readWorkbenchSnapshot() { return { workbench: copy(state.local), bundle: {} }; },
    async readWorkbenchEditedAt() { return state.editedAt ?? null; },
    async resolveCompositionSync(_id, _binding, request) {
      state.mutations.push('resolve:' + request.choice); state.resolutions = (state.resolutions || []).concat(copy(request));
      assert.ok(state.meta.conflict && !state.meta.conflict.missing, 'resolve needs a recorded conflict');
      assert.equal(request.expectedLocalRevision, state.local.revision);
      const recoveryId = 'recovery_' + state.resolutions.length;
      state.recoveries = (state.recoveries || []).concat({ id: recoveryId, workbench: copy(request.choice === 'remote' ? state.local : request.remoteRow.data) });
      if (request.choice === 'remote') state.local = { ...copy(request.remoteRow.data), revision: state.local.revision + 1 };
      state.meta.remoteRevision = request.remoteRow.revision; state.meta.outbox = null; state.meta.conflict = null; state.meta.error = null;
      state.meta.syncedLocalRevision = request.choice === 'remote' ? state.local.revision : -1;
      state.meta.status = request.choice === 'remote' ? 'synced' : 'pending'; state.meta.lastRecoveryId = recoveryId;
      return { workbench: copy(state.local), metadata: copy(state.meta), recoveryId };
    }
  };
  // Originals: the revision this device holds and the one on the server. A head check
  // (syncNow) brings the local copy up to the server's.
  state.source = { local: 1, server: 1 };
  const sourceSync = {
    async getState() { return { enabled: true, status: state.source.pending ? 'pending' : 'synced', binding, remoteRevision: state.source.local }; },
    async syncNow() { state.calls.push('sources'); state.source.local = Math.max(state.source.local, state.source.server); state.source.pending = false; },
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
  vm.createContext(context); vm.runInContext(lifecycleSource, context); vm.runInContext(source, context);
  // Engine conflict-recording tests pass autoResolve: null; the default latest-wins
  // resolver is exercised by omitting the option (defaultResolver: true).
  const manager = context.module.exports.create({ storage, sourceSync, remote, auth,
    initialReceive: options.initialReceive ? (...args) => options.initialReceive(state, ...args) : null,
    ...(options.defaultResolver ? {} : { autoResolve: Object.hasOwn(options, 'autoResolve') ? options.autoResolve : null }) });
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
  addArchivedEdition(f.state.local.books[0]);
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
  addArchivedEdition(f.state.local.books[0]);
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

test('optional initial receive follows source readiness and only accepts the atomic pristine adoption result', async t => {
  const f = fixture(t, { initialReceive(state, id, binding, row) {
    state.calls.push('initial'); assert.equal(id, WORKSPACE); assert.equal(binding.remoteId, WORKSPACE);
    state.local = { ...copy(row.data), revision: 1 }; state.meta.remoteRevision = row.revision;
    state.meta.syncedLocalRevision = 1; state.meta.status = 'synced'; return { status: 'stored' };
  } });
  f.state.local = Workbench.empty(WORKSPACE); f.state.meta.remoteRevision = 0; f.state.meta.syncedLocalRevision = -1;
  const received = await f.manager.syncNow(WORKSPACE);
  assert.equal(received.status, 'synced'); assert.equal(f.state.calls.filter(x => x === 'initial').length, 1);
  assert.ok(f.state.calls.indexOf('sources') < f.state.calls.indexOf('initial')); assert.equal(f.state.sent.length, 0);
  const refused = fixture(t, { initialReceive() { return { status: 'conflict' }; } });
  refused.state.meta.remoteRevision = 0; refused.state.meta.syncedLocalRevision = -1;
  const before = copy(refused.state.local); assert.equal((await refused.manager.syncNow(WORKSPACE)).status, 'conflict'); assert.deepEqual(refused.state.local, before);
});

test('an old account cannot continue after a stalled initial-adoption callback returns', async t => {
  const entered = deferred(), reply = deferred();
  const f = fixture(t, { initialReceive() { entered.resolve(); return reply.promise; } });
  f.state.meta.remoteRevision = 0; f.state.meta.syncedLocalRevision = -1;
  const pending = f.manager.syncNow(WORKSPACE), rejected = assert.rejects(pending, cancelled);
  await entered.promise; const reads = f.state.reads; f.changeAccount({ ...OWNER, userId: '22222222-2222-4222-8222-222222222222' });
  reply.resolve({ status: 'stored' }); await rejected; assert.equal(f.state.reads, reads); assert.equal(f.state.sent.length, 0);
});

test('concurrent identical first writes converge only after the domain atomically accepts the exact initial outbox', async t => {
  const op = 'initial_operation'; let observed;
  const f = fixture(t, { initialReceive(state, id, binding, row, options) {
    observed = copy(options); assert.equal(id, WORKSPACE); assert.equal(binding.remoteId, WORKSPACE);
    assert.equal(state.meta.outbox.operationId, options.outboxOperationId);
    // The row's source revision is checked before adoption: this task asked the server once and
    // the originals it holds are at least as new as the row's.
    assert.ok(state.calls.includes('sources'), 'Remote source revision must be checked before adoption');
    assert.ok(state.source.local >= row.source_revision, 'Adoption must wait for the row\'s source revision');
    state.meta.remoteRevision = row.revision; state.meta.syncedLocalRevision = state.local.revision;
    state.meta.outbox = null; state.meta.status = 'synced'; return { status: 'stored' };
  } });
  f.state.local = Workbench.empty(WORKSPACE); f.state.meta.remoteRevision = 0; f.state.meta.syncedLocalRevision = -1;
  f.state.meta.outbox = { operationId: op, expectedRevision: 0, sourceRevision: 1, localRevision: 0, data: copy(f.state.local) };
  f.state.row.data = copy(f.state.local); f.state.writeOverride = () => ({ status: 'conflict', revision: 1 });
  const result = await f.manager.syncNow(WORKSPACE);
  assert.equal(result.status, 'synced'); assert.deepEqual(observed, { outboxOperationId: op });
  assert.equal(f.state.meta.conflict, null); assert.equal(f.state.meta.outbox, null); assert.equal(f.state.sent.length, 1);
});

test('refused initial-write adoption retains the durable request and the later local edit as a normal conflict', async t => {
  let calls = 0; const f = fixture(t, { initialReceive() { calls++; return { status: 'conflict' }; } });
  const empty = Workbench.empty(WORKSPACE); f.state.local = { ...copy(empty), revision: 1 };
  f.state.local.reflection.note = '첫 전송 후 새로 수정한 내용';
  f.state.meta.remoteRevision = 0; f.state.meta.syncedLocalRevision = -1;
  f.state.meta.outbox = { operationId: 'pending_initial', expectedRevision: 0, sourceRevision: 1, localRevision: 0, data: empty };
  f.state.row.data = copy(empty); f.state.writeOverride = () => ({ status: 'conflict', revision: 1 });
  const before = { local: copy(f.state.local), outbox: copy(f.state.meta.outbox) };
  assert.equal((await f.manager.syncNow(WORKSPACE)).status, 'conflict'); assert.equal(calls, 1);
  assert.deepEqual(f.state.local, before.local); assert.deepEqual(f.state.meta.outbox, before.outbox); assert.ok(!f.state.mutations.includes('ack'));
});

test('noninitial CAS conflicts and missing first-write replies never invoke initial adoption', async t => {
  for (const missing of [false, true]) {
    let calls = 0; const f = fixture(t, { initialReceive() { calls++; return { status: 'stored' }; } });
    f.state.meta.remoteRevision = missing ? 0 : 1; f.state.meta.syncedLocalRevision = missing ? -1 : 0;
    f.state.meta.outbox = { operationId: 'pending', expectedRevision: missing ? 0 : 1, sourceRevision: 1, localRevision: 1, data: copy(f.state.local) };
    f.state.writeOverride = () => missing ? { status: 'missing' } : { status: 'conflict', revision: 1 };
    const pending = copy(f.state.meta.outbox); assert.equal((await f.manager.syncNow(WORKSPACE)).status, 'conflict');
    assert.equal(calls, 0); assert.deepEqual(f.state.meta.outbox, pending); assert.equal(f.state.meta.conflict.missing, missing);
  }
});

// 2026-11-04 startup latency: one originals head check per engine task. A later need inside
// the same task asks the server again only when the local originals cannot satisfy it.
test('one engine task asks the originals server once when this device already holds the row\'s source revision', async t => {
  const f = fixture(t);
  f.state.row = { ...f.state.row, revision: 2, data: { ...copy(f.state.local), revision: 2 } };
  assert.equal((await f.manager.syncNow(WORKSPACE)).status, 'synced');
  assert.equal(f.state.calls.filter(x => x === 'sources').length, 1);
  assert.ok(f.state.calls.indexOf('sources') < f.state.calls.indexOf('read'));
  assert.ok(f.state.mutations.includes('apply'));
  const enabled = fixture(t); enabled.state.meta.enabled = false;
  assert.equal((await enabled.manager.enable(WORKSPACE)).status, 'synced');
  assert.equal(enabled.state.calls.filter(x => x === 'sources').length, 1, 'enable and its first pass share one check');
  // A new task checks again.
  assert.equal((await f.manager.syncNow(WORKSPACE)).status, 'synced');
  assert.equal(f.state.calls.filter(x => x === 'sources').length, 2);
});

test('a row that needs newer originals than this device holds asks the server again before it is applied', async t => {
  const f = fixture(t);
  // Another device saved originals 2 and then a composition made on them, after this task's first check.
  f.state.readOverride = () => { f.state.source.server = 2; return { ...copy(f.state.row), revision: 2, source_revision: 2, data: { ...copy(f.state.local), revision: 2 } }; };
  assert.equal((await f.manager.syncNow(WORKSPACE)).status, 'synced');
  assert.equal(f.state.calls.filter(x => x === 'sources').length, 2);
  assert.equal(f.state.source.local, 2);
  assert.ok(f.state.calls.lastIndexOf('sources') < f.state.calls.indexOf('prepare'));
  assert.ok(f.state.mutations.includes('apply'));
  // When the server still lacks them the row waits, unapplied.
  const behind = fixture(t);
  behind.state.readOverride = () => ({ ...copy(behind.state.row), revision: 2, source_revision: 2, data: { ...copy(behind.state.local), revision: 2 } });
  await assert.rejects(behind.manager.syncNow(WORKSPACE), error => error.code === 'composition_source_pending');
  assert.equal(behind.state.calls.filter(x => x === 'sources').length, 2);
  assert.ok(!behind.state.mutations.includes('apply'));
});

test('originals edited on this device during a task are checked with the server again before the row is applied', async t => {
  const f = fixture(t);
  // The originals engine reports pending until its next check sends the edit.
  f.state.readOverride = () => { f.state.source.pending = true; return { ...copy(f.state.row), revision: 2, data: { ...copy(f.state.local), revision: 2 } }; };
  assert.equal((await f.manager.syncNow(WORKSPACE)).status, 'synced');
  assert.equal(f.state.calls.filter(x => x === 'sources').length, 2);
  assert.equal(f.state.source.pending, false);
  assert.ok(f.state.mutations.includes('apply'));
});

// 2026-11-04 independent review M1: the stored originals status can stay "synced" after a local
// originals write that raised the bundle revision (material-continuity install). Storage then
// refuses the row; the pass checks with the server once more and retries instead of failing.
test('a row refused because the stored originals status was stale is retried after one more originals check', { timeout: 5000 }, async t => {
  const f = fixture(t); let refusals = 0;
  f.state.row = { ...f.state.row, revision: 2, data: { ...copy(f.state.local), revision: 2 } };
  f.state.applyOverride = row => {
    if (!refusals++) throw Object.assign(Error('원문 동기화를 먼저 완료해 주세요.'), { code: 'composition_source_pending' });
    f.state.local = { ...copy(row.data), revision: f.state.local.revision + 1 }; f.state.meta.remoteRevision = row.revision; f.state.meta.syncedLocalRevision = f.state.local.revision;
    return { status: 'stored', revision: f.state.local.revision };
  };
  assert.equal((await f.manager.syncNow(WORKSPACE)).status, 'synced');
  assert.equal(refusals, 2); assert.equal(f.state.calls.filter(x => x === 'sources').length, 2, 'the retry checks the originals with the server first');
  assert.equal(f.state.meta.error, null);
  // A second refusal in the same task is not retried again.
  const stuck = fixture(t); let tries = 0;
  stuck.state.row = { ...stuck.state.row, revision: 2, data: { ...copy(stuck.state.local), revision: 2 } };
  // Without the one-retry bound the pass would retry at once, forever, without yielding to timers
  // (so a timeout alone could not end it): the sixth refusal disposes the engine, which ends the
  // pass with request_cancelled and fails the assertions below instead of hanging the run.
  stuck.state.applyOverride = () => { if (++tries > 5) stuck.manager.dispose(); throw Object.assign(Error('pending'), { code: 'composition_source_pending' }); };
  await assert.rejects(stuck.manager.syncNow(WORKSPACE), error => error.code === 'composition_source_pending');
  assert.equal(tries, 2);
});

test('compare and resolve still check the originals with the server on every call', async t => {
  const f = fixture(t);
  f.state.meta.conflict = { remoteRevision: 1, localRevision: 1, missing: false, row: copy(f.state.row) };
  await f.manager.compare(WORKSPACE);
  assert.equal(f.state.calls.filter(x => x === 'sources').length, 2, 'compare: its own check and the row\'s check');
});

// Review M2: the first-write conflict → initial adoption path with a row that needs newer originals.
test('initial adoption after a first-write conflict waits for the row\'s newer originals revision', async t => {
  let seen = null; const op = 'initial_operation';
  const f = fixture(t, { initialReceive(state, id, binding, row) {
    seen = state.source.local; state.meta.remoteRevision = row.revision; state.meta.syncedLocalRevision = state.local.revision;
    state.meta.outbox = null; state.meta.status = 'synced'; return { status: 'stored' };
  } });
  f.state.local = Workbench.empty(WORKSPACE); f.state.meta.remoteRevision = 0; f.state.meta.syncedLocalRevision = -1;
  f.state.meta.outbox = { operationId: op, expectedRevision: 0, sourceRevision: 1, localRevision: 0, data: copy(f.state.local) };
  f.state.writeOverride = () => ({ status: 'conflict', revision: 1 });
  f.state.readOverride = () => { f.state.source.server = 2; return { ...copy(f.state.row), source_revision: 2, data: copy(f.state.local) }; };
  assert.equal((await f.manager.syncNow(WORKSPACE)).status, 'synced');
  assert.equal(seen, 2, 'adoption sees originals 2'); assert.equal(f.state.calls.filter(x => x === 'sources').length, 2);
});

test('default latest-wins keeps the newer server composition and stores the local side as a recovery copy', async t => {
  const f = fixture(t, { defaultResolver: true }), events = [];
  f.manager.subscribe(event => events.push(event));
  f.state.local.revision = 2; f.state.local.reflection.note = '오래된 이 기기 메모'; f.state.editedAt = '2026-10-06T00:00:00Z';
  f.state.meta.outbox = { operationId: OPERATION, expectedRevision: 1, sourceRevision: 1, localRevision: 2, data: copy(f.state.local) };
  f.state.meta.status = 'pending';
  const remoteData = { ...copy(f.state.local), reflection: { versionIds: [], note: '더 최근 다른 기기 메모' } };
  f.state.row = { ...f.state.row, revision: 2, data: remoteData, updated_at: '2026-10-07T00:00:00Z' };
  f.state.writeOverride = () => ({ status: 'conflict', revision: 2 });
  const result = await f.manager.syncNow(WORKSPACE);
  assert.equal(result.status, 'synced');
  assert.equal(f.state.local.reflection.note, '더 최근 다른 기기 메모');
  assert.equal(f.state.recoveries.length, 1); assert.equal(f.state.recoveries[0].workbench.reflection.note, '오래된 이 기기 메모');
  assert.deepEqual(f.state.mutations.filter(value => value.startsWith('resolve')), ['resolve:remote']);
  assert.ok(events.some(event => event.autoResolved && event.choice === 'remote' && event.recoveryId === 'recovery_1'));
});

test('default latest-wins keeps a newer local edit, uploads it and stores the server side as a recovery copy', async t => {
  const f = fixture(t, { defaultResolver: true });
  f.state.local.revision = 2; f.state.local.reflection.note = '방금 쓴 이 기기 메모'; f.state.editedAt = '2026-10-08T00:00:00Z';
  f.state.meta.syncedLocalRevision = 1; f.state.meta.status = 'pending';
  const remoteData = { ...copy(f.state.local), reflection: { versionIds: [], note: '이전 다른 기기 메모' } };
  f.state.row = { ...f.state.row, revision: 2, data: remoteData, updated_at: '2026-10-07T00:00:00Z' };
  // A local edit without an outbox: remote apply reports a conflict like the real storage.
  f.state.applyOverride = async () => ({ status: 'conflict', revision: f.state.local.revision });
  let wrote = null;
  f.state.writeOverride = request => { wrote = request; return { status: 'stored', revision: 3 }; };
  // After resolution the engine prepares and sends the kept local composition.
  f.state.prepareOverride = () => ({ operationId: OPERATION, expectedRevision: 2, sourceRevision: 1, localRevision: 2, data: copy(f.state.local) });
  const result = await f.manager.syncNow(WORKSPACE);
  assert.equal(f.state.local.reflection.note, '방금 쓴 이 기기 메모');
  assert.equal(f.state.recoveries[0].workbench.reflection.note, '이전 다른 기기 메모');
  assert.equal(wrote.data.reflection.note, '방금 쓴 이 기기 메모'); assert.equal(wrote.expectedRevision, 2);
  assert.equal(result.status, 'synced');
});

test('a deleted server composition stays a visible conflict and is never recreated automatically', async t => {
  const f = fixture(t, { defaultResolver: true });
  f.state.readOverride = () => null; f.state.meta.remoteRevision = 1;
  const result = await f.manager.syncNow(WORKSPACE);
  assert.equal(result.status, 'conflict'); assert.equal(f.state.meta.conflict.missing, true);
  assert.equal(f.state.resolutions, undefined);
});

test('latest resolver prefers the server when the local edit time is unknown or older', () => {
  const { latest } = require('../assets/life/composition-sync.js');
  assert.equal(latest({ remote: { updated_at: '2026-10-07T00:00:00Z' }, editedAt: null }), 'remote');
  assert.equal(latest({ remote: { updated_at: '2026-10-07T00:00:00Z' }, editedAt: '2026-10-06T00:00:00Z' }), 'remote');
  assert.equal(latest({ remote: { updated_at: '2026-10-07T00:00:00Z' }, editedAt: '2026-10-08T00:00:00Z' }), 'local');
  assert.equal(latest({ remote: {}, editedAt: '2026-10-08T00:00:00Z' }), 'local');
  // The remote side's own edit time wins over its upload time: an offline edit made earlier but
  // uploaded later does not beat a newer local edit.
  assert.equal(latest({ remote: { data: { editedAt: '2026-10-05T00:00:00Z' }, updated_at: '2026-10-09T00:00:00Z' }, editedAt: '2026-10-07T00:00:00Z' }), 'local');
  assert.equal(latest({ remote: { data: { editedAt: '2026-10-08T00:00:00Z' }, updated_at: '2026-10-09T00:00:00Z' }, editedAt: '2026-10-07T00:00:00Z' }), 'remote');
});

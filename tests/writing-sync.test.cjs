'use strict';
// Automatic draft sync orchestration only. The CAS engine, storage transactions and the
// fork/recovery copy are covered by composition-sync.test.cjs and the browser suites.
const test = require('node:test'), assert = require('node:assert/strict');
const WritingSync = require('../assets/life/writing-sync.js');
const OWNER = { projectUrl: 'https://writing-fixture.example.invalid', userId: '11111111-1111-4111-8111-111111111111' };
const WS = '22222222-2222-4222-8222-222222222222';
const id = n => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;
const copy = value => structuredClone(value);

function fixture({ stages = [], states = [], rows = [], source = { enabled: true, status: 'synced' }, listError = null } = {}) {
  const calls = [], created = new Map(), local = new Map(stages.map(stage => [stage.stageId, copy(stage)]));
  const stateMap = new Map(states.map(state => [state.draftId, copy(state)]));
  const storage = {
    account: copy(OWNER),
    async listWorkspaces() { return [{ workspaceId: WS }]; },
    async listStages() { return [...local.values()].map(copy); },
    async listWritingSyncStates() { return [...stateMap.values()].map(copy); },
    async getStage(stageId) { return copy(local.get(stageId) || null); },
    async getWritingSyncState(_, draftId) { return copy(stateMap.get(draftId) || null); },
    async installWritingRemote(ws, binding, row) {
      calls.push(['install', row.draft_id]); const stage = { ...copy(row.data), revision: 1 }; local.set(row.draft_id, stage);
      stateMap.set(row.draft_id, { draftId: row.draft_id, enabled: true, status: 'synced' }); return { stage };
    },
    subscribe() { return () => {}; }, subscribeAll() { return () => {}; }
  };
  // `source` stays mutable so a test can move the originals between states and emit their events.
  const sourceListeners = new Set();
  const sourceSync = { async getState() { calls.push(['sourceState']); return { ...source, binding: { ...OWNER, remoteId: WS }, remoteRevision: 3 }; }, async syncNow() { calls.push(['sourceSync']); },
    subscribe(listener) { sourceListeners.add(listener); return () => sourceListeners.delete(listener); } };
  const emitSource = event => { for (const listener of [...sourceListeners]) listener(event); };
  const remote = {
    async list(ws, after) { calls.push(['list', after]); if (listError) throw Object.assign(new Error('schema'), listError); return copy(rows); },
    async read(ws, draftId) { const row = rows.find(value => value.draft_id === draftId); return row ? { ...copy(row), source_revision: 1, data: { stageId: draftId, workspaceId: ws, kind: 'writing', state: 'draft', revision: 2 } } : null; },
    write() { throw new Error('unexpected write'); }, dispose() {}
  };
  const engine = { create(options) {
    const draft = () => options.storage; let started = false;
    const instance = {
      options, async enable(key) { calls.push(['enable', key]); stateMap.set(key, { draftId: key, enabled: true, status: 'pending' }); },
      async syncNow(key) { calls.push(['syncNow', key]); }, start() { started = true; calls.push(['start']); }, subscribe() { return () => {}; },
      dispose() {}, get started() { return started; }, draft
    };
    created.set(created.size, instance); return instance;
  } };
  let signedIn = copy(OWNER);
  const auth = { epoch: 1, getAccount: () => copy(signedIn) };
  const manager = WritingSync.create({ storage, sourceSync, auth, remote, engine, materials: null, interval: 3600000 });
  return { manager, calls, created, local, stateMap, source, sourceListeners, emitSource, auth, signIn: value => { signedIn = value; } };
}
const draft = (n, extra = {}) => ({ stageId: id(n), workspaceId: WS, kind: 'writing', state: 'draft', revision: 1, updatedAt: '2026-10-01T00:00:00.000Z', ...extra });

test('every local draft is enabled automatically, paused drafts resume and saved records stay closed', async t => {
  const f = fixture({ stages: [draft(1), draft(2), draft(3, { state: 'applied' }), draft(4), { stageId: id(9), workspaceId: WS, kind: 'import', revision: 1 }],
    states: [{ draftId: id(2), enabled: false, status: 'pending' }, { draftId: id(4), enabled: true, status: 'pending' }] });
  t.after(() => f.manager.dispose());
  await f.manager.refresh();
  const enabled = f.calls.filter(call => call[0] === 'enable').map(call => call[1]).sort();
  assert.deepEqual(enabled, [id(1), id(2)].sort());
  assert.deepEqual(f.calls.filter(call => call[0] === 'syncNow').map(call => call[1]), [id(4)], 'an enabled draft with a pending local change is sent');
  assert.equal(f.calls.some(call => call[0] === 'start'), false, 'engines are driven by the loop only, without their own polling');
  assert.ok(!f.calls.some(call => call[1] === id(3) || call[1] === id(9)));
  // Each engine carries the latest-wins resolver and recovery-capable fork choice, with polling off.
  for (const instance of f.created.values()) {
    assert.equal(instance.options.autoResolve, WritingSync.latest); assert.equal(instance.options.polling, false);
    assert.deepEqual(instance.options.resolutionChoices, ['local', 'remote', 'fork']);
  }
});

test('drafts that exist only on the server are installed automatically; saved and known drafts are not', async t => {
  const rows = [{ draft_id: id(5), state: 'draft', title: '다른 기기 초안', revision: 2 }, { draft_id: id(6), state: 'applied', title: '저장된 글', revision: 3 },
    { draft_id: id(1), state: 'draft', title: '이미 있는 초안', revision: 1 }];
  const f = fixture({ stages: [draft(1)], states: [{ draftId: id(1), enabled: true, status: 'synced' }], rows });
  t.after(() => f.manager.dispose());
  await f.manager.refresh();
  assert.deepEqual(f.calls.filter(call => call[0] === 'install').map(call => call[1]), [id(5)]);
  assert.ok(f.local.has(id(5)));
});

test('nothing is enabled or downloaded while the originals of the workspace are not synced for this account', async t => {
  const f = fixture({ stages: [draft(1)], rows: [{ draft_id: id(5), state: 'draft', title: '', revision: 2 }], source: { enabled: false, status: 'pending' } });
  t.after(() => f.manager.dispose());
  await f.manager.refresh();
  assert.deepEqual(f.calls.filter(call => ['enable', 'install', 'list'].includes(call[0])), []);
});

test('latest edit wins; a saved record keeps both sides through the fork recovery choice', () => {
  const at = value => ({ updatedAt: value, state: 'draft' });
  assert.equal(WritingSync.latest({ local: at('2026-10-02T00:00:00Z'), remote: { data: at('2026-10-01T00:00:00Z') } }), 'local');
  assert.equal(WritingSync.latest({ local: at('2026-10-01T00:00:00Z'), remote: { data: at('2026-10-02T00:00:00Z') } }), 'remote');
  assert.equal(WritingSync.latest({ local: at('2026-10-01T00:00:00Z'), remote: { data: at('2026-10-01T00:00:00Z') } }), 'remote');
  assert.equal(WritingSync.latest({ local: { ...at('2026-10-03T00:00:00Z'), state: 'applied' }, remote: { data: at('2026-10-01T00:00:00Z') } }), 'fork');
  assert.equal(WritingSync.latest({ local: at('2026-10-01T00:00:00Z'), remote: { data: { ...at('2026-10-02T00:00:00Z'), state: 'applied' } } }), 'fork');
});

test('a server without the draft schema is marked unavailable and not probed again every cycle', async t => {
  const f = fixture({ stages: [draft(1)], listError: { code: 'schema_missing' } }); t.after(() => f.manager.dispose());
  await f.manager.refresh(); await f.manager.refresh(); await f.manager.refresh();
  assert.equal(f.calls.filter(call => call[0] === 'list').length, 1); assert.equal(f.calls.filter(call => call[0] === 'enable').length, 0);
  assert.equal(f.manager.availability().status, 'unavailable'); assert.ok(f.manager.availability().until > Date.now());
});

test('nothing starts while the page is parked in the back/forward cache or suspended', async t => {
  const handlers = new Map(), previous = { add: globalThis.addEventListener, remove: globalThis.removeEventListener };
  globalThis.addEventListener = (name, fn) => handlers.set(name, fn); globalThis.removeEventListener = name => handlers.delete(name);
  const f = fixture({ stages: [draft(1)] });
  t.after(() => { f.manager.dispose(); globalThis.addEventListener = previous.add; globalThis.removeEventListener = previous.remove; });
  f.manager.start(); await f.manager.refresh(); const before = f.calls.length;
  handlers.get('pagehide')({ persisted: true });
  await f.manager.refresh(); assert.equal(f.calls.length, before, 'no list, enable or sync while parked');
  handlers.get('pageshow')({ persisted: true }); await f.manager.refresh(); assert.ok(f.calls.length > before, 'resumes after pageshow');
});

test('unchanged drafts cost one list call per cycle and no body reads', async t => {
  const rows = [1, 2, 3, 4, 5].map(n => ({ draft_id: id(n), state: 'draft', title: '', revision: 3 }));
  const states = [1, 2, 3, 4, 5].map(n => ({ draftId: id(n), enabled: true, status: 'synced', remoteRevision: 3, syncedLocalRevision: 1, outbox: null, conflict: null, error: null }));
  const f = fixture({ stages: [1, 2, 3, 4, 5].map(n => draft(n)), states, rows }); t.after(() => f.manager.dispose());
  for (let cycle = 1; cycle <= 3; cycle++) {
    await f.manager.refresh();
    assert.equal(f.calls.filter(call => call[0] === 'list').length, cycle, 'one list per cycle');
    assert.deepEqual(f.calls.filter(call => ['syncNow', 'enable', 'install'].includes(call[0])), [], 'no body read for unchanged drafts');
  }
  rows[2].revision = 4; await f.manager.refresh();
  assert.deepEqual(f.calls.filter(call => call[0] === 'syncNow').map(call => call[1]), [id(3)], 'only the draft whose server revision moved is read');
});

// The originals engine connects after the page has mounted (a reopen with a cached account
// library, or the legacy restart): the first pass finds the originals not ready. When they
// become ready, a pass runs then; the next 30 s poll is not needed.
const settled = () => new Promise(resolve => setTimeout(resolve, 20));
const lists = f => f.calls.filter(call => call[0] === 'list').length;
test('a pass that found the originals not ready runs again as soon as the originals engine connects', async t => {
  const rows = [{ draft_id: id(5), state: 'draft', title: '다른 기기 초안', revision: 2 }];
  const f = fixture({ rows, source: { enabled: false, status: 'auth_required' } }); t.after(() => f.manager.dispose());
  f.manager.start(); await f.manager.refresh(); await settled();
  assert.equal(lists(f), 0, 'not listed while the originals read auth_required');
  f.emitSource({ type: 'account' }); await settled();
  assert.equal(lists(f), 0, 'an account event that still reads not ready starts nothing');
  Object.assign(f.source, { enabled: true, status: 'synced' }); f.emitSource({ type: 'account' }); await settled();
  assert.equal(lists(f), 1); assert.deepEqual(f.calls.filter(call => call[0] === 'install').map(call => call[1]), [id(5)]);
  // Once ready, further originals events (edits, uploads) start no extra pass.
  const reads = f.calls.length; for (let n = 0; n < 5; n++) f.emitSource({ type: 'state', workspaceId: WS }); f.emitSource({ type: 'account' }); await settled();
  assert.equal(f.calls.length, reads, 'no state read or pass for a workspace that is not waiting');
});

test('a burst of originals events becomes one check and one pass; pending originals that finish uploading also start one', async t => {
  const f = fixture({ rows: [], source: { enabled: true, status: 'pending' } }); t.after(() => f.manager.dispose());
  f.manager.start(); await f.manager.refresh(); await settled(); assert.equal(lists(f), 0, 'listing waits for synced originals');
  f.source.status = 'synced';
  for (let n = 0; n < 20; n++) f.emitSource(n % 2 ? { type: 'account' } : { type: 'state', workspaceId: WS });
  await settled();
  assert.equal(lists(f), 1, 'one pass for the whole burst');
  assert.ok(f.calls.filter(call => call[0] === 'sourceState').length <= 4, 'events during a check join it');
});

test('originals events never start a pass for another account, a hidden page or after dispose', async t => {
  const f = fixture({ rows: [], source: { enabled: false, status: 'auth_required' } });
  f.manager.start(); await f.manager.refresh(); await settled();
  // Another signed-in account: the event is dropped by the account guard.
  f.signIn({ ...OWNER, userId: '99999999-9999-4999-8999-999999999999' }); Object.assign(f.source, { enabled: true, status: 'synced' });
  f.emitSource({ type: 'account' }); await settled(); assert.equal(lists(f), 0, 'no pass for a different account');
  f.signIn(copy(OWNER));
  // A hidden page keeps the existing rule: nothing runs until it is visible again.
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} };
  try { f.emitSource({ type: 'account' }); await settled(); assert.equal(lists(f), 0, 'hidden page starts no pass'); }
  finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; }
  f.manager.dispose(); assert.equal(f.sourceListeners.size, 0, 'dispose unsubscribes from the originals engine');
});

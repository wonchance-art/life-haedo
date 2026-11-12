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
  const hooks = {};
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
      if (hooks.installError) throw Object.assign(new Error('held'), { code: hooks.installError });
      calls.push(['install', row.draft_id]); const stage = { ...copy(row.data), revision: 1 }; local.set(row.draft_id, stage);
      stateMap.set(row.draft_id, { draftId: row.draft_id, enabled: true, status: 'synced' }); return { stage };
    },
    // Per-workspace listeners (each connected draft's engine listens here through its adapter).
    subscribe(_, listener) { (hooks.listeners ||= new Set()).add(listener); return () => hooks.listeners.delete(listener); },
    subscribeAll(listener) { hooks.storage = listener; return () => { hooks.storage = null; }; }
  };
  // `source` stays mutable so a test can move the originals between states and emit their events.
  const sourceListeners = new Set();
  // hooks.afterRead runs after a state snapshot is taken and before it is returned (an event in flight).
  // hooks.installError makes the storage refuse an install (a draft that points at an original not here yet).
  const sourceSync = { async getState() { calls.push(['sourceState']); const value = { ...source, binding: { ...OWNER, remoteId: WS }, remoteRevision: 3 }; const after = hooks.afterRead; hooks.afterRead = null; after?.(); return value; }, async syncNow() { calls.push(['sourceSync']); },
    subscribe(listener) { sourceListeners.add(listener); return () => sourceListeners.delete(listener); } };
  const emitSource = event => { for (const listener of [...sourceListeners]) listener(event); };
  const remote = {
    async list(ws, after) { calls.push(['list', after]); if (listError) throw Object.assign(new Error('schema'), listError); return copy(rows); },
    async read(ws, draftId) { calls.push(['read', draftId]); const row = rows.find(value => value.draft_id === draftId); return row ? { ...copy(row), source_revision: 1, data: { stageId: draftId, workspaceId: ws, kind: 'writing', state: 'draft', revision: 2 } } : null; },
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
  // emitStorage: a storage event as the page's storage hands it out (`local: true` on this page's own saves).
  return { manager, calls, created, local, stateMap, source, sourceListeners, emitSource, emitStorage: event => { hooks.storage?.(event); for (const listener of [...(hooks.listeners || [])]) listener(event); }, hooks, auth, signIn: value => { signedIn = value; } };
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

// Rule change (2026-11-11): the list no longer waits for synced originals. Connected originals
// (an acknowledged server revision) are enough, so a pending or failing originals sync does not
// stop drafts that point at no original. (Before: `lists === 0` while the originals were pending.)
test('a burst of originals events becomes one check and one pass; pending originals that finish uploading also start one', async t => {
  const f = fixture({ rows: [], source: { enabled: true, status: 'pending' } }); t.after(() => f.manager.dispose());
  f.manager.start(); await f.manager.refresh(); await settled();
  const before = lists(f), states = f.calls.filter(call => call[0] === 'sourceState').length;
  assert.ok(before >= 1, 'connected originals are enough for the list');
  f.source.status = 'synced';
  for (let n = 0; n < 20; n++) f.emitSource(n % 2 ? { type: 'account' } : { type: 'state', workspaceId: WS });
  await settled();
  assert.equal(lists(f), before + 1, 'one pass for the whole burst');
  assert.ok(f.calls.filter(call => call[0] === 'sourceState').length - states <= 4, 'events during a check join it');
});

test('pending originals do not stop drafts: local drafts are enabled and sent, server drafts installed; a held one is read once', async t => {
  const rows = [{ draft_id: id(5), state: 'draft', title: '다른 기기 초안', revision: 2 }];
  const f = fixture({ stages: [draft(1), draft(2, { revision: 2 })], states: [{ draftId: id(2), enabled: true, status: 'pending', syncedLocalRevision: 1 }], rows,
    source: { enabled: true, status: 'pending' } });
  t.after(() => f.manager.dispose());
  f.hooks.installError = 'writing_source_pending';
  await f.manager.refresh();
  assert.deepEqual(f.calls.filter(call => call[0] === 'enable').map(call => call[1]), [id(1)]);
  assert.deepEqual(f.calls.filter(call => call[0] === 'syncNow').map(call => call[1]), [id(2)]);
  assert.deepEqual(f.calls.filter(call => call[0] === 'read').map(call => call[1]), [id(5)], 'the server draft was tried');
  // It points at an original that has not arrived: the same server revision is not read again every pass.
  await f.manager.refresh(); await f.manager.refresh();
  assert.equal(f.calls.filter(call => call[0] === 'read').length, 1);
  rows[0].revision = 3; await f.manager.refresh();
  assert.equal(f.calls.filter(call => call[0] === 'read').length, 2, 'a new server revision is tried once');
  // A failure that is not about the originals (the network) is not held: the next pass tries again.
  f.hooks.installError = 'network_error'; rows[0].revision = 4; await f.manager.refresh(); await f.manager.refresh();
  assert.equal(f.calls.filter(call => call[0] === 'read').length, 4);
  // Once the originals are ready it is installed.
  f.hooks.installError = null; f.source.status = 'synced'; await f.manager.refresh();
  assert.deepEqual(f.calls.filter(call => call[0] === 'install').map(call => call[1]), [id(5)]);
});

// m1 (2026-11-11): typed, then switched away. A page that is being hidden or closed sends the drafts
// it saved itself and has not sent yet, once. It reads no server list and installs nothing, its
// poll stays quiet, and another tab's saves (which that tab sends itself) start nothing here.
test('a hidden page sends only its own unsent drafts, once (upload only); other tabs\' saves, the poll and focus start nothing', async t => {
  const win = new Map(), doc = new Map(), previous = { add: globalThis.addEventListener, remove: globalThis.removeEventListener, interval: globalThis.setInterval, timeout: globalThis.setTimeout,
    document: Object.getOwnPropertyDescriptor(globalThis, 'document') };
  let poll = null, nudges = [], delays = [];
  globalThis.addEventListener = (name, fn) => win.set(name, fn); globalThis.removeEventListener = name => win.delete(name);
  globalThis.setInterval = handler => { poll = handler; return { unref() {} }; };
  // The nudge (3 s on a visible page, 250 ms for a hidden page's own save) is run by hand; its delay is recorded.
  globalThis.setTimeout = (fn, ms, ...rest) => { if (ms === 3000 || ms === 250) { const timer = { fn, unref() {} }; nudges.push(timer); delays.push(ms); return timer; } return previous.timeout(fn, ms, ...rest); };
  const clear = globalThis.clearTimeout; previous.clear = clear;
  globalThis.clearTimeout = timer => { if (timer && nudges.includes(timer)) nudges = nudges.filter(value => value !== timer); else clear(timer); };
  const page = { visibilityState: 'visible', addEventListener: (name, fn) => doc.set(name, fn), removeEventListener: name => doc.delete(name) };
  globalThis.document = page;
  const rows = [{ draft_id: id(5), state: 'draft', title: '다른 기기 초안', revision: 2 }, { draft_id: id(1), state: 'draft', title: '', revision: 3 }, { draft_id: id(2), state: 'draft', title: '', revision: 3 }];
  const synced = n => ({ draftId: id(n), enabled: true, status: 'synced', remoteRevision: 3, syncedLocalRevision: 1, outbox: null, conflict: null, error: null });
  const f = fixture({ stages: [draft(1), draft(2)], states: [synced(1), synced(2)], rows });
  t.after(() => { f.manager.dispose(); globalThis.addEventListener = previous.add; globalThis.removeEventListener = previous.remove; globalThis.setInterval = previous.interval; globalThis.setTimeout = previous.timeout; globalThis.clearTimeout = previous.clear;
    if (previous.document) Object.defineProperty(globalThis, 'document', previous.document); else delete globalThis.document; });
  f.hooks.installError = 'writing_source_pending'; // keeps the server-only draft uninstalled: every full pass would try the list
  f.manager.start(); await f.manager.refresh(); await settled();
  const sent = () => f.calls.filter(call => call[0] === 'syncNow').map(call => call[1]);
  const save = (n, own) => { f.local.get(id(n)).revision++; f.emitStorage({ type: 'writing_draft_changed', workspaceId: WS, stageId: id(n), ...(own ? { local: true } : {}) }); };
  const runNudges = async () => { const timers = nudges; nudges = []; for (const timer of timers) timer.fn(); await settled(); };
  assert.deepEqual(sent(), [], 'nothing to send yet'); const listed = lists(f); assert.ok(listed >= 1);
  // The person types here (this page saves draft 1) and switches away before the nudge fires.
  delays = []; save(1, true); assert.deepEqual(delays, [3000], 'a visible page gathers its saves for 3 s');
  page.visibilityState = 'hidden';
  doc.get('visibilitychange')(); await settled();
  assert.deepEqual(sent(), [id(1)], 'this page\'s own unsent draft is sent while hidden');
  assert.equal(lists(f), listed, 'no server list while hidden');
  nudges = [];
  // The draft this page sent has its own engine now. It hears the storage through its adapter and
  // sends a change half a second later: `told` is what it was told about.
  const told = []; assert.equal(f.created.size, 1);
  for (const instance of f.created.values()) instance.draft().subscribe(null, event => { if (event.type === 'workbench_changed') told.push(event.workspaceId); });
  // Another tab saves draft 2 five times and draft 1 once: this hidden tab hears it and starts nothing; neither do the poll and focus.
  const quiet = f.calls.length;
  for (let n = 0; n < 5; n++) { save(2, false); await runNudges(); }
  save(1, false); await runNudges();
  poll(); win.get('focus')(); doc.get('visibilitychange')(); win.get('online')(); await settled();
  assert.equal(f.calls.length, quiet, 'a hidden page with nothing of its own to send does nothing');
  assert.deepEqual(told, [], 'the draft\'s own engine is not started for another tab\'s save either');
  // A save of its own while hidden (an autosave that lands after the switch) goes out a quarter
  // of a second later, not after the visible page's 3 s: that draft only.
  delays = []; save(1, true);
  assert.deepEqual(delays, [250], 'a hidden page\'s own save is sent after 250 ms');
  await runNudges();
  assert.deepEqual(sent(), [id(1), id(1)]); assert.equal(lists(f), listed); assert.deepEqual(told, [id(1)], 'its engine hears this page\'s own save');
  // A nudge already waiting its 3 s (saved while visible) is brought forward by a save that lands after the switch.
  page.visibilityState = 'visible'; delays = []; save(1, true); page.visibilityState = 'hidden'; save(1, true);
  assert.deepEqual([delays, nudges.length], [[3000, 250], 1], 'one nudge left, the 250 ms one');
  await runNudges(); assert.deepEqual(sent(), [id(1), id(1), id(1)]); assert.equal(lists(f), listed);
  // A page closed while it still reads "visible": pagehide itself starts nothing (the platform has
  // suspended the session by then). The unsent draft stays; the back/forward cache parks.
  page.visibilityState = 'visible'; save(1, true); nudges = [];
  const idle = f.calls.length; win.get('pagehide')({ persisted: false }); await settled(); assert.equal(f.calls.length, idle, 'pagehide is not an upload');
  win.get('pagehide')({ persisted: true }); page.visibilityState = 'hidden'; doc.get('visibilitychange')(); win.get('online')(); await settled();
  assert.equal(f.calls.length, idle, 'nothing starts while parked');
  win.get('pageshow')({ persisted: true }); page.visibilityState = 'visible'; doc.get('visibilitychange')(); await settled();
  assert.equal(lists(f), listed + 1, 'a visible page runs the full pass again');
  assert.ok(sent().slice(2).includes(id(1)), 'and that pass sends the draft that was left');
  // A visible page still sends a save it hears from another tab (that tab may be gone already).
  const before = told.length; save(1, false); assert.deepEqual(told.slice(before), [id(1)]);
});

test('originals that become ready while the pass reads their state still start a pass', async t => {
  const rows = [{ draft_id: id(5), state: 'draft', title: '다른 기기 초안', revision: 2 }];
  const f = fixture({ rows, source: { enabled: false, status: 'auth_required' } }); t.after(() => f.manager.dispose());
  // The first pass reads "not ready"; the engine connects and emits before that read returns,
  // while no workspace is waiting yet, so only the pass's own re-check can start the next pass.
  // Only start()'s own pass runs: a joined refresh() would re-read the state by itself.
  f.hooks.afterRead = () => { Object.assign(f.source, { enabled: true, status: 'synced' }); f.emitSource({ type: 'account' }); };
  f.manager.start(); await settled();
  assert.equal(lists(f), 1, 'the event that landed during the read was not lost');
  assert.deepEqual(f.calls.filter(call => call[0] === 'install').map(call => call[1]), [id(5)]);
});

// Safety conditions only: this also passes on the code before originals events were handled
// (it never subscribed), so it pins the guards and is not evidence for the regression fix.
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

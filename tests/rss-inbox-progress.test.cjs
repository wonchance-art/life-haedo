'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createStorage } = require('../assets/life/storage.js'), Core = require('../assets/life/core.js');
const accountA = { projectUrl: 'https://rss-progress.invalid', userId: 'synthetic-a' }, accountB = { ...accountA, userId: 'synthetic-b' };
const copy = value => structuredClone(value), key = value => JSON.stringify(value);

// Application-level fixture: transactions serialize, own their working copies,
// and publish no writes until done. Native IndexedDB is checked independently in
// the browser journey; this adapter does not claim to emulate its event loop.
function adapter() {
  const rows = new Map(), paths = new Map(), control = { fail: null, readFault: null, failCompletion: false, writes: [] }; let tail = Promise.resolve();
  const idb = { async openDB(_name, _version, callbacks) {
    let closed = false;
    const db = {
      objectStoreNames: { contains: name => rows.has(name) },
      createObjectStore(name, options) { rows.set(name, new Map()); paths.set(name, options.keyPath); return { createIndex() {} }; },
      close() { closed = true; },
      transaction(names, mode) {
        if (closed) throw new DOMException('closed', 'InvalidStateError');
        let resolve, reject, ended = false, written = 0, working;
        const done = new Promise((yes, no) => { resolve = yes; reject = no; }), previous = tail;
        tail = done.catch(() => {});
        function abort(error = new DOMException('aborted', 'AbortError')) { if (!ended) { ended = true; reject(error); } }
        const ready = previous.then(() => {
          if (ended) return;
          working = new Map(names.map(name => [name, copy(rows.get(name))]));
          setImmediate(() => {
            if (ended) return;
            if (mode === 'readwrite' && written && control.failCompletion) { control.failCompletion = false; abort(); return; }
            ended = true; if (mode === 'readwrite') for (const [name, data] of working) rows.set(name, data); resolve();
          });
        });
        async function run(name, method, value) {
          await ready; if (ended) throw new DOMException('inactive', 'AbortError');
          const store = working.get(name);
          if (method === 'get') {
            // A read-wrapper exception must reach the application transaction
            // boundary; do not abort here or a catch-all mutation goes unnoticed.
            const error = control.readFault?.({ name, id: value });
            if (error) { control.readFault = null; throw error; }
            return copy(store.get(key(value)));
          }
          if (method === 'getAll') return copy([...store.values()]);
          if (method === 'getAllKeys') return [...store.keys()].map(value => JSON.parse(value));
          if (method === 'getKey') return store.has(key(value)) ? copy(value) : undefined;
          assert.equal(mode, 'readwrite'); const path = paths.get(name), id = method === 'delete' ? value : Array.isArray(path) ? path.map(field => value[field]) : value[path];
          control.writes.push({ name, method, id }); written++;
          if (control.fail?.({ name, method, id, value })) { control.fail = null; const error = new DOMException('quota', 'QuotaExceededError'); abort(error); throw error; }
          if (method === 'delete') store.delete(key(id));
          else { if (method === 'add' && store.has(key(id))) throw new DOMException('duplicate', 'ConstraintError'); store.set(key(id), copy(value)); }
          control.afterWrite?.({ name, method, id });
          return id;
        }
        return { done, abort, objectStore(name) { return { get: value => run(name, 'get', value), getAll: () => run(name, 'getAll'), getAllKeys: () => run(name, 'getAllKeys'), getKey: value => run(name, 'getKey', value),
          put: value => run(name, 'put', value), add: value => run(name, 'add', value), delete: value => run(name, 'delete', value),
          index(field) { return { async getAll(value) { return (await run(name, 'getAll')).filter(row => row[field] === value); } }; } }; } };
      }
    };
    if (!rows.size) callbacks.upgrade(db, 0, 1); return db;
  } };
  return { rows, control, idb };
}

async function fixture() {
  const f = adapter(), options = { idb: f.idb, core: Core, channelFactory: null, account: accountA };
  const a = createStorage(options), b = createStorage(options), foreign = createStorage({ ...options, account: accountB });
  const ws = (await a.createWorkspace('RSS 합성 수신 기록')).workspaceId;
  async function source(number) {
    const bundle = await a.read(ws);
    const prepared = await Core.prepareImport({ origin: 'other', title: '합성 피드 ' + number,
      text: '보존할 피드 원문 ' + number + '\r\n서로 다른 본문 🌱', url: 'https://feed.example.test/' + number }, bundle);
    assert.equal((await a.commitLocal({ workspaceId: ws, operationId: Core.id(), baseRevision: bundle.revision,
      changes: Core.buildImportChanges(bundle, prepared) })).status, 'stored');
    const itemId = '10000000-0000-4000-8000-' + String(number).padStart(12, '0');
    return { kind: 'stored', itemId, cursor: { fetched_at: '2026-11-05T02:00:00.000Z', id: itemId },
      sourceId: prepared.source.id, sourceVersionId: prepared.version.id, contentHash: prepared.version.contentHash };
  }
  async function save(receipts, revision = 0, extra = {}) {
    return a.saveRssInboxProgress(ws, { cursor: receipts.at(-1)?.cursor || null, receipts }, revision,
      { expectedBundleRevision: (await a.read(ws)).revision, isCurrent: () => true, ...extra });
  }
  async function state(sourceId, status) {
    const bundle = await a.read(ws);
    assert.equal((await a.commitLocal({ workspaceId: ws, operationId: Core.id(), baseRevision: bundle.revision,
      changes: Core.buildSourceStateChanges(bundle, sourceId, status) })).status, 'stored');
    return Core.sourceState(await a.read(ws), sourceId);
  }
  return { ...f, a, b, foreign, ws, source, save, state, close() { a.close(); b.close(); foreign.close(); } };
}

test('durable progress returns only the valid prefix before a missing middle source, retaining the ACK revision', async t => {
  const f = await fixture(); t.after(f.close);
  const receipts = [await f.source(1), await f.source(2), await f.source(3)];
  const saved = await f.save(receipts); assert.equal(saved.status, 'stored');
  const before = await f.a.readRssInboxProgress(f.ws);
  assert.deepEqual(before.receipts, receipts); assert.deepEqual(before.cursor, receipts[2].cursor); assert.equal(before.needsRepair, false);
  // Simulate a valid restored bundle that lacks a previously acknowledged source.
  const bundle = f.rows.get('bundles').get(key(f.ws));
  bundle.sourceVersions = bundle.sourceVersions.filter(v => v.sourceId !== receipts[1].sourceId);
  bundle.sources = bundle.sources.filter(s => s.id !== receipts[1].sourceId);
  bundle.revision++; Core.validateWorkspace(bundle);
  const rows = copy(f.rows), rewind = await f.b.readRssInboxProgress(f.ws);
  assert.equal(rewind.revision, before.revision); assert.equal(rewind.bundleRevision, bundle.revision);
  assert.equal(rewind.needsRepair, true); assert.deepEqual(rewind.receipts, receipts.slice(0, 1));
  assert.deepEqual(rewind.cursor, receipts[0].cursor); assert.deepEqual(f.rows, rows, 'reading does not silently rewrite the stored ACK');
  const repaired = await f.save(rewind.receipts, rewind.revision);
  assert.equal(repaired.status, 'stored'); assert.equal((await f.a.readRssInboxProgress(f.ws)).needsRepair, false);
});

test('an ACK cannot substitute another valid body hash or version for the exact source proof', async t => {
  const f = await fixture(); t.after(f.close);
  const first = await f.source(1), other = await f.source(2), before = copy(f.rows);
  for (const forged of [{ ...first, contentHash: other.contentHash }, { ...first, sourceVersionId: other.sourceVersionId }]) {
    await assert.rejects(f.save([forged]), { code: 'invalid_rss_progress' });
    assert.deepEqual(f.rows, before); assert.equal((await f.a.readRssInboxProgress(f.ws)).revision, 0);
  }
  assert.equal((await f.save([first])).status, 'stored');
  assert.equal((await f.a.read(f.ws)).sourceVersions.length, 2);
  const progress = await f.a.readRssInboxProgress(f.ws);
  const progressKey = `rssInboxProgress:${JSON.stringify([accountA.projectUrl, accountA.userId])}:${f.ws}`;
  f.rows.get('meta').get(key(progressKey)).value.receipts[0].contentHash = other.contentHash;
  const rewind = await f.a.readRssInboxProgress(f.ws);
  assert.equal(rewind.revision, progress.revision); assert.equal(rewind.cursor, null);
  assert.deepEqual(rewind.receipts, []); assert.equal(rewind.needsRepair, true, 'persisted proof also requires the exact body hash');
});

test('body-only corruption and a forged hash field each rewind reads and reject ACK advancement', async () => {
  for (const changed of ['contentText', 'contentHash']) {
    const f = await fixture();
    try {
      const receipts = [await f.source(1), await f.source(2), await f.source(3)];
      assert.equal((await f.save(receipts)).status, 'stored');
      const progress = await f.a.readRssInboxProgress(f.ws), bundle = f.rows.get('bundles').get(key(f.ws));
      const version = bundle.sourceVersions.find(value => value.id === receipts[1].sourceVersionId);
      if (changed === 'contentText') {
        version.contentText = '해시 필드만 남겨 둔 손상 본문';
        assert.equal(version.contentHash, receipts[1].contentHash, 'a matching stored hash field alone is not proof of the body');
      } else {
        version.contentHash = receipts[2].contentHash;
        assert.equal(version.contentText, '보존할 피드 원문 2\r\n서로 다른 본문 🌱', 'the independent hash-field check sees an unchanged body');
      }
      const before = copy(f.rows), rewind = await f.a.readRssInboxProgress(f.ws);
      assert.equal(rewind.revision, progress.revision); assert.equal(rewind.needsRepair, true, changed);
      assert.deepEqual(rewind.receipts, receipts.slice(0, 1), changed); assert.deepEqual(rewind.cursor, receipts[0].cursor);
      await assert.rejects(f.save(receipts, progress.revision), { code: 'invalid_rss_progress' });
      assert.deepEqual(f.rows, before, 'neither reading nor rejected ACK repairs or overwrites the source bytes');
    } finally { f.close(); }
  }
});

test('a null persisted progress value replays from the start without changing originals and can be replaced by a valid ACK', async t => {
  const f = await fixture(); t.after(f.close);
  const receipt = await f.source(1); assert.equal((await f.save([receipt])).status, 'stored');
  const progressKey = `rssInboxProgress:${JSON.stringify([accountA.projectUrl, accountA.userId])}:${f.ws}`;
  f.rows.get('meta').get(key(progressKey)).value = null;
  const before = copy(f.rows), bundle = await f.a.read(f.ws), replay = await f.a.readRssInboxProgress(f.ws);
  assert.deepEqual(replay, { revision: 0, cursor: null, receipts: [], bundleRevision: bundle.revision, needsRepair: true });
  assert.deepEqual(f.rows, before, 'the read reports repair without rewriting damaged metadata or originals');
  assert.equal((await f.save([receipt], replay.revision)).status, 'stored');
  const repaired = await f.a.readRssInboxProgress(f.ws);
  assert.equal(repaired.needsRepair, false); assert.deepEqual(repaired.cursor, receipt.cursor); assert.deepEqual(repaired.receipts, [receipt]);
  assert.deepEqual(await f.a.read(f.ws), bundle);
});

test('held decisions need no source, but every manifest must be ordered and end at its exact cursor', async t => {
  const f = await fixture(); t.after(f.close);
  const first = await f.source(1), itemId = '10000000-0000-4000-8000-000000000002';
  const held = { kind: 'held', itemId, cursor: { fetched_at: first.cursor.fetched_at, id: itemId } };
  const options = { expectedBundleRevision: (await f.a.read(f.ws)).revision, isCurrent: () => true };
  const before = copy(f.rows);
  for (const input of [
    { receipts: [held, first], cursor: first.cursor },
    { receipts: [first, first], cursor: first.cursor },
    { receipts: [first, held], cursor: first.cursor },
    { receipts: [], cursor: held.cursor }
  ]) {
    await assert.rejects(f.a.saveRssInboxProgress(f.ws, input, 0, options), { code: 'invalid_rss_progress' });
    assert.deepEqual(f.rows, before);
  }
  assert.equal((await f.save([first, held])).status, 'stored');
  const progress = await f.b.readRssInboxProgress(f.ws);
  assert.deepEqual(progress.receipts, [first, held]); assert.deepEqual(progress.cursor, held.cursor); assert.equal(progress.needsRepair, false);
  const raw = f.rows.get('bundles').get(key(f.ws)); raw.sources = []; raw.sourceVersions = []; raw.revision++;
  const rewind = await f.a.readRssInboxProgress(f.ws);
  assert.equal(rewind.revision, progress.revision); assert.equal(rewind.cursor, null); assert.deepEqual(rewind.receipts, []);
  assert.equal(rewind.needsRepair, true, 'a valid later held decision cannot leap over the first missing source');
});

test('a trashed receipt stops advancing after its source is restored, including a new trash generation', async t => {
  const f = await fixture(); t.after(f.close);
  const first = await f.source(1), last = await f.source(2), trash = await f.state(last.sourceId, 'trash');
  const skipped = { kind: 'trashed', cursor: last.cursor, itemId: last.itemId, sourceId: last.sourceId,
    trashLinkId: trash.link.id, trashLinkRevision: trash.revision };
  assert.equal((await f.save([first, skipped])).status, 'stored');
  const saved = await f.a.readRssInboxProgress(f.ws); assert.equal(saved.needsRepair, false);
  await f.state(last.sourceId, 'active');
  let rewound = await f.a.readRssInboxProgress(f.ws);
  assert.deepEqual(rewound.receipts, [first]); assert.deepEqual(rewound.cursor, first.cursor);
  assert.equal(rewound.revision, saved.revision); assert.equal(rewound.needsRepair, true);
  await f.state(last.sourceId, 'trash');
  rewound = await f.a.readRssInboxProgress(f.ws);
  assert.deepEqual(rewound.receipts, [first]); assert.equal(rewound.needsRepair, true, 'a later trash action cannot authenticate an old skip');
});

test('ACK write and completion failures preserve already committed source text and do not advance progress', async () => {
  for (const point of ['write', 'completion']) {
    const f = await fixture();
    try {
      const first = await f.source(1); assert.equal((await f.save([first])).status, 'stored');
      const second = await f.source(2), progress = await f.a.readRssInboxProgress(f.ws), before = copy(f.rows);
      if (point === 'write') f.control.fail = ({ name }) => name === 'meta';
      else f.control.failCompletion = true;
      await assert.rejects(f.save([first, second], progress.revision), { code: point === 'write' ? 'storage_quota' : 'storage_aborted' });
      assert.deepEqual(f.rows, before); assert.deepEqual(await f.a.readRssInboxProgress(f.ws), progress);
      assert.equal((await f.a.read(f.ws)).sourceVersions[1].contentText, '보존할 피드 원문 2\r\n서로 다른 본문 🌱');
      assert.equal((await f.save([first, second], progress.revision)).status, 'stored');
    } finally { f.close(); }
  }
});

test('ACK and bundle CAS, account ownership and current-operation guards prevent stale advancement', async t => {
  const f = await fixture(); t.after(f.close);
  const first = await f.source(1), bundle = await f.a.read(f.ws), input = { cursor: first.cursor, receipts: [first] };
  const options = { expectedBundleRevision: bundle.revision, isCurrent: () => true };
  const concurrent = await Promise.all([f.a.saveRssInboxProgress(f.ws, input, 0, options), f.b.saveRssInboxProgress(f.ws, input, 0, options)]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), ['conflict', 'stored']);
  const progress = await f.a.readRssInboxProgress(f.ws), before = copy(f.rows);
  assert.equal((await f.a.saveRssInboxProgress(f.ws, input, progress.revision, { ...options, expectedBundleRevision: bundle.revision - 1 })).status, 'conflict');
  await assert.rejects(f.foreign.readRssInboxProgress(f.ws), { code: 'workspace_access_denied' });
  await assert.rejects(f.foreign.saveRssInboxProgress(f.ws, input, progress.revision, options), { code: 'workspace_access_denied' });
  await assert.rejects(f.a.saveRssInboxProgress(f.ws, input, progress.revision, { ...options, isCurrent: () => false }));
  for (const point of ['read', 'write']) {
    let current = true;
    const cancel = ({ name, id }) => { if (name === 'meta' && String(id).startsWith('rssInboxProgress:')) current = false; };
    if (point === 'read') f.control.readFault = cancel;
    else f.control.afterWrite = cancel;
    await assert.rejects(f.a.saveRssInboxProgress(f.ws, input, progress.revision, { ...options, isCurrent: () => current }), { code: 'request_cancelled' });
    f.control.readFault = f.control.afterWrite = null;
    assert.deepEqual(f.rows, before, point + ': changing account/navigation during transaction aborts its ACK');
  }
  assert.deepEqual(f.rows, before); assert.deepEqual(await f.a.readRssInboxProgress(f.ws), progress);
});

test('failure reading the persisted ACK is reported without turning it into an empty successful cursor', async t => {
  const f = await fixture(); t.after(f.close);
  const receipt = await f.source(1); assert.equal((await f.save([receipt])).status, 'stored');
  const before = copy(f.rows), progress = await f.a.readRssInboxProgress(f.ws);
  f.control.readFault = ({ name, id }) => name === 'meta' && String(id).startsWith('rssInboxProgress:')
    ? new DOMException('synthetic read failure', 'InvalidStateError') : null;
  await assert.rejects(f.a.readRssInboxProgress(f.ws), { code: 'storage_unavailable' });
  assert.deepEqual(f.rows, before); assert.deepEqual(await f.a.readRssInboxProgress(f.ws), progress);
});

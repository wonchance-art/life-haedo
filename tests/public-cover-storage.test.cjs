'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createStorage } = require('../assets/life/storage.js'), Core = require('../assets/life/core.js');
const M = require('../assets/life/public-cover.js');
const accountA = { projectUrl: 'https://material-test.supabase.co', userId: 'synthetic-a' }, accountB = { ...accountA, userId: 'synthetic-b' };
const copy = value => structuredClone(value), key = value => JSON.stringify(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };

// Application-level fixture: transactions serialize, own their working copies,
// and publish no writes until done. Native IndexedDB is checked independently in
// the browser journey; this adapter does not claim to emulate its event loop.
function adapter() {
  const rows = new Map(), paths = new Map(), control = { fail: null, failCompletion: false, writes: [] }; let tail = Promise.resolve();
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
          if (method === 'get') return copy(store.get(key(value)));
          if (method === 'getAll') return copy([...store.values()]);
          if (method === 'getAllKeys') return [...store.keys()].map(value => JSON.parse(value));
          assert.equal(mode, 'readwrite'); const path = paths.get(name), id = method === 'delete' ? value : Array.isArray(path) ? path.map(field => value[field]) : value[path];
          control.writes.push({ name, method, id }); written++;
          if (control.fail?.({ name, method, id, value })) { control.fail = null; const error = new DOMException('quota', 'QuotaExceededError'); abort(error); throw error; }
          if (method === 'delete') store.delete(key(id));
          else { if (method === 'add' && store.has(key(id))) throw new DOMException('duplicate', 'ConstraintError'); store.set(key(id), copy(value)); }
          return id;
        }
        return { done, abort, objectStore(name) { return { get: value => run(name, 'get', value), getAll: () => run(name, 'getAll'), getAllKeys: () => run(name, 'getAllKeys'),
          put: value => run(name, 'put', value), add: value => run(name, 'add', value), delete: value => run(name, 'delete', value),
          index(field) { return { async getAll(value) { return (await run(name, 'getAll')).filter(row => row[field] === value); } }; } }; } };
      }
    };
    if (!rows.size) callbacks.upgrade(db, 0, 1); return db;
  } };
  return { rows, control, idb };
}
async function fixture() {
  const f = adapter(), opts = { idb: f.idb, core: Core, channelFactory: null, account: accountA };
  const a = createStorage(opts), b = createStorage(opts), foreign = createStorage({ ...opts, account: accountB });
  let bundle = await a.createWorkspace('합성 공개 표지 자료'), ws = bundle.workspaceId;
  const imported = await Core.prepareImport({ origin: 'obsidian', title: '비공개 원자료', text: '원본 🌿\r\n정확한 내용', author: '원저자', authorRelation: 'other' }, bundle);
  await a.commitLocal({ workspaceId: ws, operationId: Core.id(), baseRevision: bundle.revision, changes: Core.buildImportChanges(bundle, imported) }); bundle = await a.read(ws);
  const cover = { ...M.create(Core.id), title: '내 대표 결과', intro: '직접 쓴 공개 소개', items: ['post', 'series', 'nine'].map(kind => M.item(kind, Core.id())) };
  return { ...f, a, b, foreign, ws, bundle, cover, close() { a.close(); b.close(); foreign.close(); } };
}
function withoutCover(rows, ws) { const value = copy(rows); value.get('meta').delete(key(`public-cover:${ws}`)); return value; }
test('public cover drafts are independent owned metadata and never enter sources, workbench or target publications', async t => {
  const f = await fixture(); t.after(f.close); const before = copy(f.rows), empty = await f.a.readPublicCover(f.ws);
  assert.deepEqual(empty, M.empty(f.ws)); assert.deepEqual(f.rows, before);
  const input = { ...empty, covers: [copy(f.cover)] }, original = copy(input), saved = await f.a.savePublicCover(f.ws, input, 0);
  assert.equal(saved.revision, 1); assert.deepEqual(input, original); assert.deepEqual(withoutCover(f.rows, f.ws), before); assert.deepEqual(await f.a.read(f.ws), f.bundle);
  saved.covers[0].title = '읽은 값만 바꿈'; assert.equal((await f.b.readPublicCover(f.ws)).covers[0].title, f.cover.title);
});
test('two-tab CAS keeps the winning draft and an explicit independent copy recovers the losing input without sharing its identity', async t => {
  const f = await fixture(); t.after(f.close); const initial = await f.a.savePublicCover(f.ws, { ...M.empty(f.ws), covers: [f.cover] }, 0);
  const a = copy(initial), b = copy(initial); a.covers[0].intro = '기기 A 입력'; b.covers[0].intro = '기기 B 입력';
  const outcomes = await Promise.allSettled([f.a.savePublicCover(f.ws, a, 1), f.b.savePublicCover(f.ws, b, 1)]);
  assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1); assert.equal(outcomes.find(value => value.status === 'rejected').reason.code, 'public_cover_conflict');
  const latest = await f.a.readPublicCover(f.ws), winner = copy(latest.covers[0]), loser = outcomes[0].status === 'rejected' ? a.covers[0] : b.covers[0], recovering = copy(loser);
  recovering.id = Core.id(); recovering.items.forEach(item => item.id = Core.id()); latest.covers.push(recovering);
  const saved = await f.a.savePublicCover(f.ws, latest, latest.revision); assert.equal(saved.covers.length, 2); assert.deepEqual(saved.covers[0], winner);
  assert.equal(saved.covers[1].intro, loser.intro); assert.notEqual(saved.covers[1].id, winner.id);
  assert(saved.covers[1].items.every(item => !winner.items.some(value => value.id === item.id))); assert.deepEqual(a.covers[0].intro, '기기 A 입력'); assert.deepEqual(b.covers[0].intro, '기기 B 입력');
});
test('failed draft write or transaction completion preserves every row and emits no success before retry', async () => {
  for (const point of ['write', 'completion']) {
    const f = await fixture();
    try {
      const before = copy(f.rows), notifications = []; f.a.subscribe(f.ws, event => notifications.push(event));
      if (point === 'write') f.control.fail = ({ id }) => id === `public-cover:${f.ws}`; else f.control.failCompletion = true;
      const input = { ...M.empty(f.ws), covers: [f.cover] };
      await assert.rejects(f.a.savePublicCover(f.ws, input, 0), { code: point === 'write' ? 'storage_quota' : 'storage_aborted' });
      assert.deepEqual(f.rows, before); assert.equal(notifications.length, 0);
      const saved = await f.a.savePublicCover(f.ws, input, 0); assert.equal(saved.revision, 1); assert.equal(notifications.length, 1); assert.equal(notifications[0].type, 'public_cover_changed');
    } finally { f.close(); }
  }
});
test('removing the last local draft retains revision so a late tab cannot resurrect an older version', async t => {
  const f = await fixture(); t.after(f.close); const previous = await f.a.savePublicCover(f.ws, { ...M.empty(f.ws), covers: [f.cover] }, 0);
  const cleared = await f.a.savePublicCover(f.ws, { ...previous, covers: [] }, previous.revision); assert.equal(cleared.revision, 2);
  await assert.rejects(f.b.savePublicCover(f.ws, previous, previous.revision), { code: 'public_cover_conflict' }); assert.deepEqual(await f.a.readPublicCover(f.ws), cleared);
});
test('foreign accounts, workspace mismatch and malformed cover input cause no writes', async t => {
  const f = await fixture(); t.after(f.close); const before = copy(f.rows);
  await assert.rejects(f.foreign.readPublicCover(f.ws), { code: 'workspace_access_denied' });
  await assert.rejects(f.foreign.savePublicCover(f.ws, { ...M.empty(f.ws), covers: [f.cover] }, 0), { code: 'workspace_access_denied' });
  await assert.rejects(f.a.savePublicCover(f.ws, M.empty(Core.id()), 0), { code: 'workspace_mismatch' });
  const invalid = { ...M.empty(f.ws), covers: [{ ...f.cover, privateNotes: '개인 메모' }] };
  await assert.rejects(f.a.savePublicCover(f.ws, invalid, 0), { code: 'invalid_public_cover' }); assert.deepEqual(f.rows, before);
});
test('account disposal during the actual draft put rolls back the transaction and preserves all original content', async t => {
  const f = await fixture(); t.after(f.close); const before = copy(f.rows); let reached = false;
  f.control.fail = ({ id }) => { if (id === `public-cover:${f.ws}`) { reached = true; f.a.dispose(); } return false; };
  await assert.rejects(f.a.savePublicCover(f.ws, { ...M.empty(f.ws), covers: [f.cover] }, 0), { code: 'storage_scope_closed' }); assert(reached); assert.deepEqual(f.rows, before);
});

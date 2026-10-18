'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStorage } = require('../assets/life/storage.js');
const Core = require('../assets/life/core.js');
const Workbench = require('../assets/life/workbench.js');
const Model = require('../assets/life/source-classification.js');

// Serial transactions, failure injection and rollback exercise storage decisions.
// Actual IndexedDB and BroadcastChannel serialization are covered in browser QA.
function database() {
  const rows = new Map(), schemas = new Map(), control = {};
  let tail = Promise.resolve();
  const idb = { async openDB(_name, _version, callbacks) {
    const connection = {
      objectStoreNames: { contains: name => schemas.has(name) },
      createObjectStore(name, options) { schemas.set(name, options.keyPath); rows.set(name, new Map()); return { createIndex() {} }; },
      close() {},
      transaction(names, mode) {
        let resolve, reject, ended = false;
        const done = new Promise((yes, no) => { resolve = yes; reject = no; });
        const ready = tail.then(() => new Map(names.map(name => [name, structuredClone(rows.get(name))])));
        tail = done.catch(() => {});
        const abort = error => { if (!ended) { ended = true; reject(error || new DOMException('aborted', 'AbortError')); } };
        ready.then(working => setImmediate(() => {
          if (ended) return;
          if (control.failCompletion) { control.failCompletion = false; abort(); return; }
          ended = true;
          if (mode === 'readwrite') for (const [name, value] of working) rows.set(name, value);
          resolve();
        }));
        return { done, abort, objectStore(name) {
          async function write(method, value) {
            const working = await ready;
            if (ended) throw new DOMException('inactive', 'InvalidStateError');
            if (control.failWrite) { control.failWrite = false; const error = new DOMException('quota', 'QuotaExceededError'); abort(error); throw error; }
            const keyPath = schemas.get(name), key = Array.isArray(keyPath) ? keyPath.map(k => value[k]) : value[keyPath];
            working.get(name).set(JSON.stringify(key), structuredClone(value));
            control.afterWrite?.({ name, value, method });
            return key;
          }
          return {
            async get(key) { const working = await ready; return structuredClone(working.get(name).get(JSON.stringify(key))); },
            async getAll() { const working = await ready; return structuredClone([...working.get(name).values()]); },
            put: value => write('put', value), add: value => write('add', value)
          };
        } };
      }
    };
    if (!schemas.size) callbacks.upgrade(connection, 0, 1);
    return connection;
  } };
  return { rows, control, idb };
}
const account = { projectUrl: 'https://classification-test.example.org', userId: 'anonymous-a' };
const foreign = { ...account, userId: 'anonymous-b' };
function manifest(count = 1) {
  return { format: 'life-source-classification-v1', sourceCommit: 'a'.repeat(40),
    taxonomy: [{ id: 'daily', label: '일상' }],
    records: Array.from({ length: count }, (_, index) => ({ path: `notes/anonymous-${index}.md`, sha256: 'b'.repeat(64), isContent: true,
      source: { id: 'manual', label: '직접 보관' }, kind: { id: 'note', label: '메모' }, topicIds: ['daily'], primaryTopic: 'daily', reviewReasons: [] })) };
}
function fixture(extra = {}) {
  const db = database(), options = { idb: db.idb, core: Core, workbench: Workbench, sourceClassification: Model, channelFactory: null, ...extra };
  const base = createStorage(options), scoped = base.forAccount(account);
  return { ...db, options, base, scoped };
}
const key = workspaceId => `sourceClassification:${JSON.stringify([account.projectUrl, account.userId])}:${workspaceId}`;

test('classification is an independent sanitized sidecar, cloned before async storage and on return', async t => {
  const { base, scoped, rows } = fixture(); t.after(() => base.clearAccount());
  const bundle = await scoped.createWorkspace('익명 작업공간'), id = bundle.workspaceId;
  const workbench = await scoped.readWorkbench(id), before = structuredClone(rows.get('meta'));
  assert.deepEqual(await scoped.readSourceClassification(id), { revision: 0, manifest: null });
  assert.deepEqual(rows.get('meta'), before);
  const events = []; scoped.subscribe(id, event => events.push(event));
  const input = manifest(); input.records[0].title = '저장하지 않을 제목'; input.records[0].preview = '저장하지 않을 미리보기';
  const pending = scoped.saveSourceClassification(id, input, 0); input.records[0].path = 'notes/changed.md';
  const saved = await pending;
  assert.equal(saved.status, 'stored'); assert.equal(saved.state.revision, 1);
  assert.deepEqual(saved.state.manifest, manifest());
  assert.deepEqual(events, [{ type: 'source_classification_changed', workspaceId: id, revision: 1 }]);
  assert.equal(JSON.stringify(rows.get('meta').get(JSON.stringify(key(id)))).includes('저장하지 않을'), false);
  saved.state.manifest.records.length = 0;
  assert.deepEqual((await scoped.readSourceClassification(id)).manifest, manifest());
  assert.deepEqual(await scoped.read(id), bundle); assert.deepEqual(await scoped.readWorkbench(id), workbench);
  assert.equal(JSON.stringify(Core.makeBackup(await scoped.read(id))).includes('sourceCommit'), false);
  assert.equal(await scoped.getSyncState(id), null);
  scoped.close(); assert.deepEqual(await base.forAccount(account).readSourceClassification(id), { revision: 1, manifest: manifest() });
});

test('two scoped readers have one CAS winner and clear tombstones block delayed resurrection', async t => {
  const f = fixture(), second = createStorage({ ...f.options, account }); t.after(() => { f.base.clearAccount(); second.dispose(); });
  const { workspaceId: id } = await f.scoped.createWorkspace('CAS 검사');
  const results = await Promise.all([f.scoped.saveSourceClassification(id, manifest(), 0), second.saveSourceClassification(id, manifest(), 0)]);
  assert.equal(results.filter(r => r.status === 'stored').length, 1); assert.equal(results.filter(r => r.status === 'conflict').length, 1);
  const clear = await second.clearSourceClassification(id, 1);
  assert.deepEqual(clear, { status: 'stored', state: { revision: 2, manifest: null } });
  assert.deepEqual(await f.scoped.saveSourceClassification(id, manifest(), 1), { status: 'conflict', state: clear.state });
  assert.equal((await f.scoped.clearSourceClassification(id, 2)).state.revision, 3);
  const { workspaceId: other } = await f.scoped.createWorkspace('다른 공간');
  assert.deepEqual(await f.scoped.readSourceClassification(other), { revision: 0, manifest: null });
  assert.equal((await f.scoped.clearSourceClassification(other, 0)).state.revision, 1);
  assert.equal((await f.scoped.saveSourceClassification(other, manifest(), 0)).status, 'conflict');
});

test('unscoped and foreign accounts/projects cannot read, replace or clear a classification', async t => {
  const f = fixture(); t.after(() => f.base.clearAccount());
  const { workspaceId: id } = await f.scoped.createWorkspace('계정 분리');
  await f.scoped.saveSourceClassification(id, manifest(), 0);
  for (const action of [() => f.base.readSourceClassification(id), () => f.base.saveSourceClassification(id, manifest(), 0), () => f.base.clearSourceClassification(id, 0)]) {
    await assert.rejects(action(), { code: 'auth_scope_required' });
  }
  for (const identity of [foreign, { ...account, projectUrl: 'https://other-classification.example.org' }]) {
    const other = createStorage({ ...f.options, account: identity });
    try { for (const action of [() => other.readSourceClassification(id), () => other.saveSourceClassification(id, manifest(), 1), () => other.clearSourceClassification(id, 1)]) {
      await assert.rejects(action(), { code: 'workspace_access_denied' });
    } } finally { other.dispose(); }
  }
  assert.deepEqual(await f.scoped.readSourceClassification(id), { revision: 1, manifest: manifest() });
});

test('quota and completion failures roll back sidecar writes and emit no success', async t => {
  for (const fail of ['failWrite', 'failCompletion']) await t.test(fail, async () => {
    const f = fixture();
    try {
      const { workspaceId: id } = await f.scoped.createWorkspace('저장 복구');
      const saved = await f.scoped.saveSourceClassification(id, manifest(), 0), before = structuredClone(f.rows.get('meta')), events = [];
      f.scoped.subscribe(id, event => events.push(event)); f.control[fail] = true;
      await assert.rejects(f.scoped.clearSourceClassification(id, 1), { code: fail === 'failWrite' ? 'storage_quota' : 'storage_aborted' });
      assert.deepEqual(f.rows.get('meta'), before); assert.deepEqual(await f.scoped.readSourceClassification(id), saved.state); assert.deepEqual(events, []);
    } finally { f.base.clearAccount(); }
  });
});

test('account disposal during a metadata write aborts the transaction and preserves previous state', async t => {
  const f = fixture(); t.after(() => f.base.clearAccount());
  const { workspaceId: id } = await f.scoped.createWorkspace('늦은 저장');
  await f.scoped.saveSourceClassification(id, manifest(), 0);
  const before = structuredClone(f.rows.get('meta')), events = []; f.scoped.subscribe(id, e => events.push(e));
  f.control.afterWrite = ({ name, value }) => {
    if (name === 'meta' && value.key === key(id)) { f.control.afterWrite = null; f.base.forAccount(foreign); }
  };
  await assert.rejects(f.scoped.clearSourceClassification(id, 1), { code: 'storage_scope_closed' });
  assert.deepEqual(f.rows.get('meta'), before); assert.deepEqual(events, []);
  const again = f.base.forAccount(account); assert.deepEqual(await again.readSourceClassification(id), { revision: 1, manifest: manifest() });
});

test('corrupt or cross-workspace metadata and revision overflow never silently reset a classification', async t => {
  const f = fixture(); t.after(() => f.base.clearAccount());
  const { workspaceId: id } = await f.scoped.createWorkspace('메타 검증'); await f.scoped.saveSourceClassification(id, manifest(), 0);
  const slot = JSON.stringify(key(id)), valid = structuredClone(f.rows.get('meta').get(slot));
  for (const mutate of [row => { row.value.workspaceId = 'wrong'; }, row => { row.value.extra = true; }, row => { row.value.revision = -1; }, row => { delete row.value.manifest; }, row => { row.value.manifest.sourceCommit = 'invalid'; }]) {
    const row = structuredClone(valid); mutate(row); f.rows.get('meta').set(slot, row);
    for (const action of [() => f.scoped.readSourceClassification(id), () => f.scoped.clearSourceClassification(id, 1), () => f.scoped.saveSourceClassification(id, manifest(), 1)]) {
      await assert.rejects(action(), { code: 'source_classification_invalid' });
    }
    assert.deepEqual(f.rows.get('meta').get(slot), row);
  }
  const maximal = structuredClone(valid); maximal.value.revision = Number.MAX_SAFE_INTEGER; f.rows.get('meta').set(slot, maximal);
  await assert.rejects(f.scoped.clearSourceClassification(id, Number.MAX_SAFE_INTEGER), { code: 'source_classification_invalid' });
  assert.deepEqual(f.rows.get('meta').get(slot), maximal);
});

test('classification accepts multi-megabyte metadata while bounding normalized storage at 32MiB', async t => {
  const f = fixture(); t.after(() => f.base.clearAccount());
  const { workspaceId: id } = await f.scoped.createWorkspace('큰 분류표');
  const input = manifest(9000);
  assert(Buffer.byteLength(JSON.stringify(input)) > 2 * 1024 * 1024);
  assert.equal((await f.scoped.saveSourceClassification(id, input, 0)).state.manifest.records.length, 9000);
  const oversized = { ...manifest(), extra: 'x'.repeat(32 * 1024 * 1024) };
  const bypass = createStorage({ ...f.options, account, sourceClassification: { validate: value => structuredClone(value) } });
  try { await assert.rejects(bypass.saveSourceClassification(id, oversized, 1), { code: 'source_classification_too_large' }); }
  finally { bypass.dispose(); }
  assert.equal((await f.scoped.readSourceClassification(id)).revision, 1);
});

test('account-scoped notifications contain only committed revisions and reject malformed remote events', async t => {
  const channels = [];
  const factory = name => { const c = { name, sent: [], postMessage(data) { this.sent.push(structuredClone(data)); }, close() {} }; channels.push(c); return c; };
  const f = fixture({ channelFactory: factory }); t.after(() => f.base.clearAccount());
  const { workspaceId: id } = await f.scoped.createWorkspace('알림'); const events = []; f.scoped.subscribe(id, e => events.push(e));
  await f.scoped.saveSourceClassification(id, manifest(), 0);
  const c = channels.find(value => value.name.endsWith(JSON.stringify([account.projectUrl, account.userId])));
  const savedEvent = c.sent.find(e => e.type === 'source_classification_changed');
  assert.deepEqual(Object.keys(savedEvent).sort(), ['revision', 'sender', 'type', 'workspaceId']);
  events.length = 0;
  for (const revision of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) c.onmessage({ data: { type: 'source_classification_changed', sender: 'other', workspaceId: id, revision } });
  c.onmessage({ data: { type: 'source_classification_changed', sender: savedEvent.sender, workspaceId: id, revision: 2 } });
  assert.deepEqual(events, []);
  c.onmessage({ data: { type: 'source_classification_changed', sender: 'other', workspaceId: id, revision: 2, manifest: 'ignored' } });
  assert.deepEqual(events, [{ type: 'source_classification_changed', workspaceId: id, revision: 2 }]);
});

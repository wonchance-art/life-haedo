'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Core = require('../assets/life/core.js'), { createStorage } = require('../assets/life/storage.js');
const Media = require('../assets/life/naver-media.js'), Capture = require('../assets/life/naver-capture.js');
const Receipt = require('../assets/life/naver-media-receipt.js'), F = require('./fixtures/naver-media.cjs');
const clone = value => structuredClone(value), key = value => JSON.stringify(value);
// Transaction decision/rollback fixture; native IndexedDB is tested separately.
function memoryAdapter() {
  const schemas = new Map(), rows = new Map();
  const control = { opens: 0, closes: 0, callbacks: null, failWrite: null, failCompletion: false, transactions: [] };
  const encode = key => JSON.stringify(key);
  function connection() {
    let closed = false;
    return {
      objectStoreNames: { contains: name => schemas.has(name) },
      createObjectStore(name, options) {
        schemas.set(name, options.keyPath); rows.set(name, new Map());
        return { createIndex() {} };
      },
      close() { if (!closed) { closed = true; control.closes += 1; } },
      transaction(names, mode) {
        if (closed) throw new DOMException('closed', 'InvalidStateError');
        control.transactions.push({ names: [...names], mode });
        const working = new Map(names.map(name => [name, structuredClone(rows.get(name))]));
        let finished = false, resolve, reject;
        const done = new Promise((yes, no) => { resolve = yes; reject = no; });
        function abort(error = new DOMException('aborted', 'AbortError')) {
          if (finished) return;
          finished = true;
          reject(error);
        }
        function store(name) {
          if (!working.has(name)) throw new Error('store not in transaction');
          const map = working.get(name);
          function keyOf(value) {
            const path = schemas.get(name);
            return Array.isArray(path) ? path.map(key => value[key]) : value[path];
          }
          async function write(method, value) {
            if (finished) throw new DOMException('inactive', 'InvalidStateError');
            if (mode !== 'readwrite') throw new Error('readonly');
            if (control.failWrite?.name === name && control.failWrite.method === method) {
              control.failWrite = null;
              const error = new DOMException('quota', 'QuotaExceededError');
              abort(error);
              throw error;
            }
            const key = method === 'delete' ? value : keyOf(value);
            if (method === 'delete') map.delete(encode(key));
            else {
              if (method === 'add' && map.has(encode(key))) throw new DOMException('duplicate', 'ConstraintError');
              map.set(encode(key), structuredClone(value));
            }
            control.afterWrite?.({ name, method, value });
            return key;
          }
          function requestWrite(method, value) {
            // Native IDB requests can throw before returning their promise.
            control.beforeWrite?.({ name, method, value });
            return write(method, value);
          }
          return {
            async get(key) { return structuredClone(map.get(encode(key))); },
            async getAll() { return structuredClone([...map.values()]); },
            async getAllKeys() { return [...map.keys()].map(key => JSON.parse(key)); },
            put: value => requestWrite('put', value), add: value => requestWrite('add', value), delete: key => requestWrite('delete', key),
            index(field) { return { async getAll(value) { return structuredClone([...map.values()].filter(row => row[field] === value)); } }; }
          };
        }
        setImmediate(() => {
          if (finished) return;
          if (control.failCompletion) { control.failCompletion = false; abort(); return; }
          finished = true;
          if (mode === 'readwrite') for (const [name, values] of working) rows.set(name, values);
          resolve();
        });
        return { done, objectStore: store, abort };
      }
    };
  }
  return {
    control, rows, schemas,
    idb: {
      async openDB(name, version, callbacks) {
        control.opens += 1; control.callbacks = callbacks;
        const db = connection();
        if (!schemas.size) callbacks.upgrade(db, 0, version);
        return db;
      }
    }
  };
}

async function fixture(t, { committed = true } = {}) {
  const f = memoryAdapter(), account = { projectUrl: 'https://receipt-test.supabase.co', userId: F.OWNER };
  const a = createStorage({ idb: f.idb, account, core: Core, channelFactory: null });
  const other = createStorage({ idb: f.idb, account: { ...account, userId: Core.id() }, core: Core, channelFactory: null });
  t.after(() => { a.close(); other.close(); });
  const restore = F.installDecoder(); t.after(restore);
  const bundle = await a.createWorkspace('원문 사진'), data = await F.fixture(bundle), ws = bundle.workspaceId;
  const receipt = Receipt.fromAttachment(ws, { ...data.attachment, localOnly: false });
  const request = { workspaceId: ws, baseRevision: 0, operationId: Core.id(), changes: data.changes, attachment: data.attachment };
  if (committed) assert.equal((await a.commitNaverCapture(request)).status, 'stored');
  return { ...f, a, other, data, ws, receipt, request, bundle,
    receiptKey: key('naver-media-receipt:' + ws + ':' + receipt.sourceVersionId),
    mediaKey: key('naver-capture:' + ws + ':' + receipt.sourceVersionId) };
}

test('source, capture and pending receipt commit and replay atomically; acknowledgement is exact and immutable', async t => {
  const f = await fixture(t), before = clone(f.rows), bundle = await f.a.read(f.ws), events = [];
  assert.deepEqual(await f.a.listNaverMediaReceipts(f.ws), [{ receipt: f.receipt, pending: true }]);
  assert.equal((await f.a.commitNaverCapture(f.request)).status, 'stored'); assert.deepEqual(f.rows, before);
  f.a.subscribe(f.ws, value => events.push(value));
  for (const changed of [{ ...f.receipt, captureHash: '0'.repeat(64) }, { ...f.receipt, captureId: Core.id() }]) {
    await assert.rejects(f.a.acknowledgeNaverMediaReceipt(f.ws, changed), { code: 'invalid_naver_media_receipt' });
  }
  assert.deepEqual(f.rows, before);
  assert.deepEqual(await f.a.acknowledgeNaverMediaReceipt(f.ws, f.receipt), { receipt: f.receipt, pending: false });
  const acknowledged = clone(f.rows);
  await f.a.acknowledgeNaverMediaReceipt(f.ws, f.receipt); assert.deepEqual(f.rows, acknowledged);
  assert.deepEqual(await f.a.listNaverMediaReceipts(f.ws, { pendingOnly: true }), []);
  assert.equal(events.length, 1); assert.equal(events[0].type, 'naver_media_changed');
  assert.deepEqual(await f.a.read(f.ws), bundle);
  await assert.rejects(f.other.listNaverMediaReceipts(f.ws), { code: 'workspace_access_denied' });
  await assert.rejects(f.other.acknowledgeNaverMediaReceipt(f.ws, f.receipt), { code: 'workspace_access_denied' });
});

test('new capture commit rolls graph, media and pending receipt back on quota or late navigation', async t => {
  for (const mode of ['quota', 'late']) {
    const f = await fixture(t, { committed: false }), before = clone(f.rows); let current = true;
    if (mode === 'quota') f.control.beforeWrite = ({ name, value }) => { if (name === 'meta' && value.key?.startsWith('naver-media-receipt:')) throw new DOMException('quota', 'QuotaExceededError'); };
    else f.control.afterWrite = ({ name, value }) => { if (name === 'meta' && value.key?.startsWith('naver-media-receipt:')) current = false; };
    assert.equal((await f.a.commitNaverCapture(f.request, { isCurrent: () => current })).status, 'rejected');
    assert.deepEqual(f.rows, before); f.control.beforeWrite = null; f.control.afterWrite = null;
  }
});

test('legacy owned sidecar stages once without graph mutation, confirmed receipt never regresses to pending', async t => {
  const f = await fixture(t); f.rows.get('meta').delete(f.receiptKey);
  const bundle = await f.a.read(f.ws), events = []; f.a.subscribe(f.ws, v => events.push(v));
  assert.deepEqual(await f.a.stageNaverMediaReceipt(f.ws, f.receipt.sourceVersionId), { receipt: f.receipt, pending: true });
  const staged = clone(f.rows); await f.a.stageNaverMediaReceipt(f.ws, f.receipt.sourceVersionId); assert.deepEqual(f.rows, staged);
  await f.a.acknowledgeNaverMediaReceipt(f.ws, f.receipt);
  assert.deepEqual(await f.a.stageNaverMediaReceipt(f.ws, f.receipt.sourceVersionId), { receipt: f.receipt, pending: false });
  assert.deepEqual(await f.a.read(f.ws), bundle); assert.equal(events.filter(v => v.type === 'changed').length, 0);
  assert.equal(events.filter(v => v.type === 'naver_media_changed').length, 2);
  const foreign = clone(f.rows.get('meta').get(f.mediaKey)); foreign.value.capture.owner_id = Core.id(); f.rows.get('meta').set(f.mediaKey, foreign);
  await assert.rejects(f.a.stageNaverMediaReceipt(f.ws, f.receipt.sourceVersionId));
});

test('portable ZIP is a new local-only copy and cannot become a server receipt', async t => {
  const f = await fixture(t), bundle = await f.a.read(f.ws), attachment = await f.a.readNaverCapture(f.ws, f.receipt.sourceVersionId);
  const copied = await Media.copy(await Media.read(await Media.pack({ bundle, attachment })));
  await f.a.installNaverCaptureCopy(copied);
  assert.deepEqual(await f.a.listNaverMediaReceipts(copied.bundle.workspaceId), []);
  assert.equal(await f.a.stageNaverMediaReceipt(copied.bundle.workspaceId, copied.attachment.sourceVersionId), null);
  await assert.rejects(f.a.installNaverCaptureForVersion(copied.bundle.workspaceId, copied.attachment, { ...f.receipt,
    workspaceId: copied.bundle.workspaceId, sourceId: copied.attachment.sourceId, sourceVersionId: copied.attachment.sourceVersionId }));
});

test('second device installs exact media and confirmed receipt without changing a single graph byte; same install is write-free', async t => {
  const f = await fixture(t), bundle = await f.a.read(f.ws), source = await f.a.readNaverCapture(f.ws, f.receipt.sourceVersionId);
  f.rows.get('meta').delete(f.mediaKey); f.rows.get('meta').delete(f.receiptKey);
  const events = []; f.a.subscribe(f.ws, v => events.push(v));
  assert.equal((await f.a.installNaverCaptureForVersion(f.ws, source, f.receipt)).status, 'stored');
  assert.deepEqual(await f.a.read(f.ws), bundle);
  assert.deepEqual(await f.a.listNaverMediaReceipts(f.ws), [{ receipt: f.receipt, pending: false }]);
  assert.deepEqual(new Uint8Array(await (await f.a.readNaverCapture(f.ws, f.receipt.sourceVersionId)).photos[0].blob.arrayBuffer()), F.bytes);
  const before = clone(f.rows), writes = []; f.control.afterWrite = v => writes.push(v);
  assert.equal((await f.a.installNaverCaptureForVersion(f.ws, source, f.receipt)).status, 'already_stored');
  assert.deepEqual(f.rows, before); assert.deepEqual(writes, []); f.control.afterWrite = null;
  assert.deepEqual(events.map(v => v.type), ['naver_media_changed']);
  await assert.rejects(f.other.installNaverCaptureForVersion(f.ws, source, f.receipt));
});

test('wrong exact receipt, changed capture and different bytes cannot replace an installed photo declaration', async t => {
  const f = await fixture(t), source = await f.a.readNaverCapture(f.ws, f.receipt.sourceVersionId), before = clone(f.rows);
  const changed = clone(source); changed.capture.id = Core.id(); changed.capture.payload.photos[0].caption += ' 다른 사진 판';
  changed.capture.capture_hash = await Capture.fingerprint(changed.capture.payload);
  await assert.rejects(f.a.installNaverCaptureForVersion(f.ws, changed, f.receipt), { code: 'invalid_naver_media_receipt' });
  await assert.rejects(f.a.installNaverCaptureForVersion(f.ws, changed, Receipt.fromAttachment(f.ws, changed)), { code: 'immutable_naver_capture' });
  const bad = clone(source); bad.photos[0].blob = new Blob([new Uint8Array(F.bytes.length)], { type: 'image/png' });
  await assert.rejects(f.a.installNaverCaptureForVersion(f.ws, bad, f.receipt));
  assert.deepEqual(f.rows, before);
});

test('sidecar-only receive and acknowledgement roll back every metadata write after late navigation or completion failure', async t => {
  for (const mode of ['late', 'completion']) {
    const f = await fixture(t), source = await f.a.readNaverCapture(f.ws, f.receipt.sourceVersionId);
    f.rows.get('meta').delete(f.mediaKey); f.rows.get('meta').delete(f.receiptKey);
    const before = clone(f.rows); let current = true;
    if (mode === 'completion') f.control.failCompletion = true;
    else f.control.afterWrite = ({ name, value }) => { if (name === 'meta' && value.key?.startsWith('naver-media-receipt:')) current = false; };
    await assert.rejects(f.a.installNaverCaptureForVersion(f.ws, source, f.receipt, { isCurrent: () => current }),
      { code: mode === 'late' ? 'request_cancelled' : 'storage_aborted' });
    assert.deepEqual(f.rows, before); f.control.afterWrite = null;
  }
  const f = await fixture(t), before = clone(f.rows); let current = true;
  f.control.afterWrite = ({ name, value }) => { if (name === 'meta' && value.key?.startsWith('naver-media-receipt:')) current = false; };
  await assert.rejects(f.a.acknowledgeNaverMediaReceipt(f.ws, f.receipt, { isCurrent: () => current }), { code: 'request_cancelled' });
  assert.deepEqual(f.rows, before); f.control.afterWrite = null;
});

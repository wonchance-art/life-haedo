'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const O = require('../assets/life/original-attachments.js');
const { fixture, sha } = require('./fixtures/original-attachments.cjs');
const owner = '11111111-1111-4111-8111-111111111111', foreign = '22222222-2222-4222-8222-222222222222';
const tick = () => new Promise(resolve => setImmediate(resolve));
// Serialized native-request-shaped application adapter. Actual IDB abort/event timing is a browser gate.
function database() {
  const rows = new Map(); let tail = Promise.resolve(); const control = { failNext: false };
  const connection = { createObjectStore() { return { createIndex() {} }; }, close() {}, transaction(_name, mode) {
    let release, ended = false, pending = 0, working, completion;
    const tx = { error: null, abort() { if (ended) return; ended = true; release?.(); setImmediate(() => tx.onabort?.()); } };
    const prev = tail; tail = new Promise(resolve => release = resolve); const ready = prev.then(() => { working = structuredClone(rows); finish(); });
    function finish() {
      clearImmediate(completion); completion = setImmediate(() => {
        if (ended || pending) return;
        ended = true; if (mode === 'readwrite') { rows.clear(); for (const [k, v] of working) rows.set(k, v); }
        release(); tx.oncomplete?.();
      });
    }
    function request(fn, write = false) {
      const req = {}; pending++;
      ready.then(() => setImmediate(() => {
        if (ended) return;
        try { if (write && control.failNext) { control.failNext = false; throw new DOMException('synthetic quota', 'QuotaExceededError'); }
          req.result = fn(); req.onsuccess?.({ target: req });
        } catch (error) { tx.error = error; tx.abort(); }
        pending--; finish();
      })); return req;
    }
    tx.objectStore = () => ({ get(id) { return request(() => structuredClone(working.get(id))); }, add(value) { const copy = structuredClone(value); return request(() => { if (working.has(copy.id)) throw new DOMException('duplicate', 'ConstraintError'); working.set(copy.id, copy); return copy.id; }, true); }, put(value) { const copy = structuredClone(value); return request(() => { working.set(copy.id, copy); return copy.id; }, true); }, index(name) { assert.equal(name, 'owner'); return { getAll(value) { return request(() => structuredClone([...working.values()].filter(r => r.owner === value))); } }; } });
    return tx;
  } };
  let opened = false;
  return { rows, control, indexedDB: { open() { const request = {}; setImmediate(() => { request.result = connection; if (!opened) { opened = true; request.onupgradeneeded?.(); } request.onsuccess?.(); }); return request; } } };
}
function server() {
  const archives = new Map(), chunks = new Map(), operations = new Map(), calls = [], control = { lostAck: false, failChunk: false, corrupt: false, capability: 1 };
  function remote(userId = owner) {
    return { async capabilities() { return { version: control.capability, originalsVersion: control.capability }; }, async list(after = null) {
      const items = [...archives.values()].filter(r => r.userId === userId && (!after || r.manifest.id > after)).sort((a, b) => a.manifest.id.localeCompare(b.manifest.id)).map(r => ({ id: r.manifest.id, revision: 1, created_at: r.createdAt, archive_sha256: r.manifest.archiveHash, archive_bytes: r.manifest.archiveBytes, part: r.manifest.part, part_count: r.manifest.partCount, source_head: r.manifest.sourceHead, entry_count: r.manifest.entries.length, total_file_bytes: r.manifest.entries.reduce((n, e) => n + e.bytes, 0) }));
      calls.push({ method: 'list', userId }); return { items, next: null };
    }, async read(id) { calls.push({ method: 'read', id, userId }); const row = archives.get(id); await control.readGate?.(); return row?.userId === userId ? { id, revision: 1, manifest: structuredClone(row.manifest), created_at: row.createdAt } : null; }, async uploadChunk(chunk, blob) {
      assert.equal(chunk.path.split('/')[0], userId); calls.push({ method: 'upload', path: chunk.path }); if (control.failChunk) throw Object.assign(new Error('synthetic failure'), { code: 'originals_network' });
      assert.equal(sha(Buffer.from(await blob.arrayBuffer())), chunk.sha256); chunks.set(chunk.path, blob);
    }, async downloadChunk(chunk) { calls.push({ method: 'download', path: chunk.path }); assert.equal(chunk.path.split('/')[0], userId); return control.corrupt ? new Blob([new Uint8Array(chunk.bytes)]) : chunks.get(chunk.path); }, async write(request) {
      O.validateManifest(request.manifest, userId); calls.push({ method: 'write', request: structuredClone(request), userId });
      if (control.missing) return { status: 'missing' };
      for (const c of request.manifest.chunks) assert.equal(chunks.get(c.path)?.size, c.bytes);
      if (operations.has(request.operationId)) assert.deepEqual(operations.get(request.operationId), request);
      else { operations.set(request.operationId, structuredClone(request)); archives.set(request.id, { userId, manifest: structuredClone(request.manifest), createdAt: new Date().toISOString() }); }
      if (control.lostAck) { control.lostAck = false; throw Object.assign(new Error('lost acknowledgement'), { code: 'originals_network' }); }
      return { status: 'stored', revision: 1 };
    }, dispose() {} };
  }
  return { remote, archives, chunks, operations, calls, control };
}
function service(db, remote, userId = owner) {
  const account = { projectUrl: 'https://synthetic.supabase.co', userId }, auth = { epoch: 0, getAccount: () => account };
  return { auth, account, api: O.create({ auth, account, remote, indexedDB: db.indexedDB, broadcast: false }) };
}
async function install(api) { const f = fixture(), prepared = await api.prepare(new Blob([f.zip])); return { result: await api.install(prepared.ticket), f }; }
test('same account fresh cache receives the catalog and lazily verifies exact archive, CRC and entry hashes', async t => {
  const dbA = database(), dbB = database(), s = server(), a = service(dbA, s.remote()), b = service(dbB, s.remote()); t.after(() => { a.api.dispose(); b.api.dispose(); });
  const { result, f } = await install(a.api); await a.api.retry(); assert.equal(a.api.getState().status, 'saved');
  const rows = await b.api.list(); assert.equal(rows.length, 1); assert.equal(rows[0].id, result.id); assert.equal(rows[0].storage, 'account'); assert.equal(dbB.rows.get(result.id).archive, undefined); assert.equal(s.calls.filter(c => c.method === 'download').length, 0);
  const entries = await b.api.entries(result.id); assert.equal(entries.length, 5); assert.equal(s.calls.filter(c => c.method === 'download').length, 1);
  const archive = await b.api.archive(result.id); assert.equal(sha(Buffer.from(await archive.blob.arrayBuffer())), sha(f.zip));
  const raw = await b.api.file(result.id, entries[0].snapshotPath); assert.equal(sha(Buffer.from(await raw.blob.arrayBuffer())), entries[0].sha256); assert.equal(s.calls.filter(c => c.method === 'download').length, 1);
});
test('lost manifest acknowledgement keeps an immutable operation and a reopened service replays it once', async t => {
  const db = database(), s = server(), a = service(db, s.remote()); s.control.lostAck = true;
  const { result } = await install(a.api); await assert.rejects(a.api.retry(), { code: 'originals_network' });
  assert.equal(a.api.getState().status, 'error'); assert.equal(db.rows.get(result.id).sync.status, 'pending'); const original = structuredClone(db.rows.get(result.id).sync);
  a.api.dispose(); const reopened = service(db, s.remote()); t.after(() => reopened.api.dispose()); await reopened.api.retry();
  const writes = s.calls.filter(c => c.method === 'write'); assert.equal(writes.length, 2); assert.equal(writes[0].request.operationId, original.operationId); assert.deepEqual(writes[1].request, writes[0].request); assert.equal(s.operations.size, 1); assert.equal(reopened.api.getState().status, 'saved');
});
test('a failed chunk never commits a manifest, retains pending bytes, and explicit retry finishes', async t => {
  const db = database(), s = server(), a = service(db, s.remote()); t.after(() => a.api.dispose()); s.control.failChunk = true;
  const { result, f } = await install(a.api); await assert.rejects(a.api.retry(), { code: 'originals_network' });
  assert.equal(s.archives.size, 0); assert.equal(s.calls.filter(c => c.method === 'write').length, 0); assert.equal(sha(Buffer.from(await db.rows.get(result.id).archive.arrayBuffer())), sha(f.zip)); const operationId = db.rows.get(result.id).sync.operationId;
  s.control.failChunk = false; await a.api.retry(); assert.equal(db.rows.get(result.id).sync.operationId, operationId); assert.equal(s.archives.size, 1);
});
test('corrupt downloads and cache transaction failure cannot install a partially verified archive', async t => {
  const dbA = database(), dbB = database(), s = server(), a = service(dbA, s.remote()), b = service(dbB, s.remote()); t.after(() => { a.api.dispose(); b.api.dispose(); });
  const { result } = await install(a.api); await a.api.retry(); await b.api.list();
  s.control.corrupt = true; await assert.rejects(b.api.entries(result.id), { code: 'originals_invalid_remote' }); assert.equal(dbB.rows.get(result.id).archive, undefined);
  s.control.corrupt = false; dbB.control.failNext = true; await assert.rejects(b.api.archive(result.id), { code: 'originals_quota' }); assert.equal(dbB.rows.get(result.id).archive, undefined);
  assert.equal((await b.api.entries(result.id)).length, 5); assert(dbB.rows.get(result.id).archive instanceof Blob);
});
test('account changes during remote loading block cache installation; foreign owners see no original', async t => {
  const dbA = database(), dbB = database(), s = server(), a = service(dbA, s.remote()), b = service(dbB, s.remote()); t.after(() => { a.api.dispose(); b.api.dispose(); });
  const { result } = await install(a.api); await a.api.retry(); await b.api.list();
  let release, enter; const entered = new Promise(r => enter = r); s.control.readGate = () => { enter(); return new Promise(r => release = r); };
  const pending = b.api.entries(result.id); await entered; b.auth.epoch++; release(); await assert.rejects(pending, { code: 'originals_scope_closed' }); assert.equal(dbB.rows.get(result.id).archive, undefined);
  s.control.readGate = null; const c = service(database(), s.remote(foreign), foreign); t.after(() => c.api.dispose()); assert.equal((await c.api.list()).length, 0); await assert.rejects(c.api.archive(result.id), { code: 'originals_remote_missing' });
});
test('two cache instances share the durable archive operation and legacy capability0 never uploads', async t => {
  const db = database(), s = server(), a = service(db, s.remote()), b = service(db, s.remote()); t.after(() => { a.api.dispose(); b.api.dispose(); });
  const { result } = await install(a.api); await Promise.all([a.api.retry(), b.api.retry()]);
  const writes = s.calls.filter(c => c.method === 'write'); assert(writes.length >= 1); assert.equal(new Set(writes.map(c => c.request.operationId)).size, 1); assert.equal(s.operations.size, 1); assert.equal(db.rows.get(result.id).sync.status, 'stored');
  const legacyServer = server(), legacyDb = database(); legacyServer.control.capability = 0; const legacy = service(legacyDb, legacyServer.remote()); t.after(() => legacy.api.dispose());
  const installed = await install(legacy.api); await legacy.api.retry(); assert.equal(legacy.api.getState().mode, 'legacy'); assert.equal(legacy.api.getState().status, 'unsupported'); assert.equal(legacyServer.archives.size, 0); assert.equal(legacyServer.calls.length, 0); assert.equal((await legacy.api.file(installed.result.id, installed.f.receipt.entries[0].snapshotPath)).blob.size, installed.f.receipt.entries[0].bytes);
});
test('archives crossing 8MiB use bounded immutable chunks and preserve the original ZIP byte for byte', async t => {
  const db = database(), s = server(), a = service(db, s.remote()); t.after(() => a.api.dispose());
  const f = fixture((receipt, files) => { const first = receipt.entries[0], content = Buffer.alloc(O.CHUNK_BYTES + 17, 23); first.bytes = content.length; first.sha256 = sha(content); files[first.snapshotPath] = content; });
  const prepared = await a.api.prepare(new Blob([f.zip])), installed = await a.api.install(prepared.ticket); await a.api.retry();
  const manifest = db.rows.get(installed.id).sync.manifest; assert.equal(manifest.chunks.length, 2); assert.equal(manifest.chunks[0].bytes, O.CHUNK_BYTES); assert(manifest.chunks[1].bytes > 0 && manifest.chunks[1].bytes < O.CHUNK_BYTES); assert.equal(manifest.chunks.reduce((n, c) => n + c.bytes, 0), f.zip.length);
  const fresh = service(database(), s.remote()); t.after(() => fresh.api.dispose()); const archived = await fresh.api.archive(installed.id); assert.equal(sha(Buffer.from(await archived.blob.arrayBuffer())), sha(f.zip));
});
test('a server tombstone during pending replay remains missing and cannot be acknowledged or recreated', async t => {
  const db = database(), s = server(), a = service(db, s.remote()); t.after(() => a.api.dispose()); s.control.lostAck = true;
  const { result } = await install(a.api); await assert.rejects(a.api.retry()); const operationId = db.rows.get(result.id).sync.operationId;
  s.archives.delete(result.id); s.control.missing = true; await a.api.retry(); assert.equal(db.rows.get(result.id).sync.status, 'missing'); assert.equal(a.api.getState().status, 'error'); assert.equal(a.api.getState().error.code, 'originals_remote_missing'); assert(db.rows.get(result.id).archive instanceof Blob); assert.equal(db.rows.get(result.id).sync.operationId, operationId);
  const before = s.calls.filter(c => c.method === 'write').length; await a.api.retry(); assert.equal(s.calls.filter(c => c.method === 'write').length, before); assert.equal(s.archives.size, 0);
});
test('a new local archive immediately clears prior saved status before any server acknowledgement', async t => {
  const db = database(), s = server(), a = service(db, s.remote()); t.after(() => a.api.dispose()); await install(a.api); await a.api.retry(); assert.equal(a.api.getState().status, 'saved');
  const seen = [], unsubscribe = a.api.subscribe(value => seen.push(value)); t.after(unsubscribe); s.control.failChunk = true;
  await install(a.api); assert.equal(seen[0].status, 'pending'); assert.equal(seen[0].pending, 1); await assert.rejects(a.api.retry());
  assert.equal(a.api.getState().status, 'error'); assert.equal(s.archives.size, 1);
});

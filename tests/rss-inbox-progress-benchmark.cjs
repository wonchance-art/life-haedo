/* Anonymous ACK cost benchmark; actual storage/core/hash code, in-memory IDB
 * adapter. This measures helper CPU, digest calls and serialized meta.put bytes,
 * not native IndexedDB disk latency or production throughput. */
'use strict';
const assert = require('node:assert/strict'), { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks'), path = require('node:path');
const Core = require('../assets/life/core.js');
const { createStorage } = require(process.env.RSS_STORAGE_PATH ? path.resolve(process.env.RSS_STORAGE_PATH) : '../assets/life/storage.js');
const account = { projectUrl: 'https://rss-cost.invalid', userId: 'synthetic-cost-account' };
const size = Number(process.env.RSS_PROGRESS_SIZE || 18000), bodyBytes = 14 * 1024;
assert(Number.isSafeInteger(size) && size >= 200);
const rows = new Map(), keyPaths = new Map(), writes = [];
const idb = { async openDB(_name, _version, callbacks) {
  const db = { objectStoreNames: { contains: name => rows.has(name) }, close() {},
    createObjectStore(name, options) { rows.set(name, new Map()); keyPaths.set(name, options.keyPath); return { createIndex() {} }; },
    transaction(names) {
      // No concurrent writers or injected failures in this measurement fixture.
      return { done: Promise.resolve(), abort() {}, objectStore(name) {
        const store = rows.get(name), jsonKey = value => JSON.stringify(value);
        const api = { async get(id) { const value = store.get(jsonKey(id)); return name === 'bundles' ? value : structuredClone(value); },
          async getKey(id) { return store.has(jsonKey(id)) ? id : undefined; },
          async getAll() { return [...store.values()]; },
          async put(value) {
            const id = Array.isArray(keyPaths.get(name)) ? keyPaths.get(name).map(field => value[field]) : value[keyPaths.get(name)];
            if (name === 'meta') writes.push({ bytes: Buffer.byteLength(JSON.stringify(value)), id });
            store.set(jsonKey(id), structuredClone(value)); return id;
          }, async delete(id) { store.delete(jsonKey(id)); } };
        api.add = value => api.put(value); return api;
      } };
    } };
  if (!rows.size) callbacks.upgrade(db, 0, 2); return db;
} };
async function main() {
  let validationMs = 0, validationCalls = 0, cloneMs = 0, cloneCalls = 0, digestMs = 0;
  const core = { ...Core, validateWorkspace(...args) {
    const start = performance.now(); try { return Core.validateWorkspace(...args); }
    finally { validationMs += performance.now() - start; validationCalls++; }
  } };
  let a = createStorage({ idb, core, channelFactory: null, account });
  const b = createStorage({ idb, core, channelFactory: null, account });
  const subtle = globalThis.crypto.subtle, digest = subtle.digest, clone = globalThis.structuredClone; let hashes = 0;
  const phases = [];
  try {
    const workspaceId = (await a.createWorkspace('익명 RSS 비용 측정')).workspaceId;
    const bundle = rows.get('bundles').get(JSON.stringify(workspaceId)), stamp = '2026-11-05T00:00:00.000Z', receipts = [];
    for (let index = 0; index < size; index++) {
      const sourceId = 'rss-cost-source-' + index, sourceVersionId = 'rss-cost-version-' + index;
      const prefix = '익명 RSS 정확 원문 ' + index + '\r\n', contentText = prefix + 'a'.repeat(bodyBytes - Buffer.byteLength(prefix));
      const contentHash = createHash('sha256').update(contentText).digest('hex');
      bundle.sources.push({ id: sourceId, origin: 'other', title: '익명 ' + index, revision: 1, createdAt: stamp, updatedAt: stamp });
      bundle.sourceVersions.push({ id: sourceVersionId, sourceId, format: 'text/plain', contentText, contentHash,
        coverage: { status: 'unknown', omissions: [] }, originalAuthor: { label: '', relation: 'unknown' }, originalCreatedAt: null, importedAt: stamp, revision: 1 });
      const itemId = '10000000-0000-4000-8000-' + String(index).padStart(12, '0');
      receipts.push({ kind: 'stored', itemId, cursor: { fetched_at: stamp, id: itemId }, sourceId, sourceVersionId, contentHash });
    }
    bundle.revision++; Core.validateWorkspace(bundle);
    subtle.digest = async function (...args) {
      hashes++; const start = performance.now(); try { return await digest.apply(this, args); }
      finally { digestMs += performance.now() - start; }
    };
    globalThis.structuredClone = function (...args) {
      const start = performance.now(); try { return clone(...args); }
      finally { cloneMs += performance.now() - start; cloneCalls++; }
    };
    async function measure(name, action) {
      globalThis.gc?.(); // Optional identical GC boundary for before/after CPU measurements.
      validationMs = validationCalls = cloneMs = cloneCalls = digestMs = 0;
      const start = performance.now(), initialHashes = hashes, initialWrites = writes.length;
      const result = await action(), changed = writes.slice(initialWrites);
      phases.push({ name, milliseconds: Math.round(performance.now() - start), hashes: hashes - initialHashes,
        validationCalls, validationMs: Math.round(validationMs), cloneCalls, cloneMs: Math.round(cloneMs), digestMs: Math.round(digestMs),
        putRecords: changed.length, putBytes: changed.reduce((total, item) => total + item.bytes, 0), memory: process.memoryUsage() });
      return result;
    }
    const save = (storage, count, revision) => storage.saveRssInboxProgress(workspaceId,
      { receipts: receipts.slice(0, count), cursor: receipts[count - 1].cursor }, revision,
      { expectedBundleRevision: bundle.revision, isCurrent: () => true });
    assert.equal((await measure('initial-save', () => save(a, size - 100, 0))).status, 'stored');
    a.close(); a = null; // Model restart instead of retaining an unused first installation's cache.
    for (const name of ['cold-new-instance-read', 'warm-poll-1', 'warm-poll-2']) {
      const progress = await measure(name, () => b.readRssInboxProgress(workspaceId));
      assert.equal(progress.needsRepair, false); assert.equal(progress.receipts.length, size - 100);
    }
    assert.equal((await measure('append-50', () => save(b, size - 50, 1))).status, 'stored');
    assert.equal((await measure('append-next-50', () => save(b, size, 2))).status, 'stored');
    const final = await measure('warm-final-read', () => b.readRssInboxProgress(workspaceId));
    assert.equal(final.receipts.length, size); assert.deepEqual(final.receipts, receipts);
    globalThis.gc?.(); const beforeClose = process.memoryUsage();
    b.close(); const afterCloseBeforeGc = process.memoryUsage();
    globalThis.gc?.(); const afterClose = process.memoryUsage();
    console.log(JSON.stringify({ size, bodyBytes, totalBodyBytes: size * bodyBytes, phases, maxRssKB: process.resourceUsage().maxRSS,
      gcBetweenPhases: typeof globalThis.gc === 'function', memoryRelease: { beforeClose, afterCloseBeforeGc, afterClose },
      limitation: 'In-memory adapter, unchanged bundle reads and full public receipt validation remain O(n); timings exclude native IDB serialization/disk latency and optional pre-phase GC.' }, null, 2));
    if (process.env.RSS_PROGRESS_ASSERT_OPTIMIZED === '1') {
      for (const phase of phases.filter(value => value.name.startsWith('warm-'))) assert.equal(phase.hashes, 0, phase.name + ': repeated body hash');
      for (const phase of phases.filter(value => value.name.startsWith('append-'))) {
        assert.equal(phase.hashes, 50, phase.name + ': only new exact bodies need hashes');
        assert(phase.putRecords <= 3 && phase.putBytes < 150000, phase.name + ': bounded compact-page writes');
      }
    }
  } finally { subtle.digest = digest; globalThis.structuredClone = clone; a?.close(); b.close(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

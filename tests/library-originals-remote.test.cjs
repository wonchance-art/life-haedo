'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const O = require('../assets/life/original-attachments.js'), R = require('../assets/life/library-originals-remote.js');
const { fixture, sha } = require('./fixtures/original-attachments.cjs');
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
async function data() {
  const f = fixture(), part = await O.readPart(new Blob([f.zip])), archiveHash = sha(f.zip), chunkHash = archiveHash;
  const manifest = { format: O.REMOTE_FORMAT, id: randomUUID(), sourceHead: part.sourceHead, part: part.part, partCount: part.partCount, archiveBytes: f.zip.length, archiveHash, entries: part.entries,
    chunks: [{ index: 0, path: `${owner}/${archiveHash}/0000-${chunkHash}`, bytes: f.zip.length, sha256: chunkHash }] };
  return { f, part, manifest, blob: new Blob([f.zip]) };
}
function transport() {
  const calls = [], auth = { ready: true, epoch: 0, user: { id: owner }, config: { url: 'https://synthetic.supabase.co', key: 'synthetic-public' } };
  const control = { auth, calls, result: null, error: null, stored: new Map(), closed: false };
  const client = { auth: { async getUser() { await control.verifyGate?.(); return { data: { user: auth.user }, error: null }; }, dispose() { control.closed = true; } }, async rpc(name, args) { calls.push({ name, args: structuredClone(args) }); return control.respond ? control.respond(name, args) : { data: control.result, error: control.error }; } };
  auth.client = { storage: { from(bucket) {
    assert.equal(bucket, 'life-library-originals');
    return { async upload(path, blob, options) { calls.push({ upload: path, options }); await control.storageGate?.(); if (control.stored.has(path)) return { error: { statusCode: '409' } }; control.stored.set(path, blob); return { data: { path }, error: null }; }, async download(path) { calls.push({ download: path }); await control.storageGate?.(); return { data: control.stored.get(path), error: null }; } };
  } } };
  control.remote = R.create({ auth, model: O, clientFactory(_auth, options) { assert.equal(options.scope, 'originals'); return () => client; } });
  return control;
}
test('bounded immutable manifest validates exact owner paths, original offsets and safe declarations', async () => {
  const d = await data(); assert.deepEqual(O.validateManifest(d.manifest, owner), d.manifest);
  for (const alter of [m => m.chunks[0].path = m.chunks[0].path.replace(owner, other), m => m.chunks[0].bytes++, m => m.chunks[0].index = 1, m => m.chunks.push(m.chunks[0]), m => m.archiveBytes = O.LIMITS.part + 1, m => m.entries[0].offset = -1, m => m.entries[0].crc = 2 ** 32, m => m.entries[0].snapshotPath = '../private', m => m.entries[0].credentials = 'synthetic', m => m.entries.push(m.entries[0]), m => m.sourceHead = 'invalid']) {
    const m = structuredClone(d.manifest); alter(m); assert.throws(() => O.validateManifest(m, owner), { code: 'originals_invalid_remote' });
  }
});
test('private Storage chunks preserve bytes and use immutable uploads; duplicate paths are hash-verified', async t => {
  const f = transport(); t.after(() => f.remote.dispose()); const d = await data(), c = d.manifest.chunks[0];
  await f.remote.uploadChunk(c, d.blob); await f.remote.uploadChunk(c, d.blob);
  assert.deepEqual(f.calls.filter(c => c.upload)[0].options, { upsert: false, contentType: 'application/octet-stream', cacheControl: '31536000' });
  assert.equal(sha(Buffer.from(await (await f.remote.downloadChunk(c)).arrayBuffer())), sha(d.f.zip));
  assert.equal(f.calls.filter(c => c.download).length, 2);
  f.stored.set(c.path, new Blob([new Uint8Array(c.bytes)]));
  await assert.rejects(f.remote.uploadChunk(c, d.blob), { code: 'originals_invalid_remote' });
  const foreign = { ...c, path: c.path.replace(owner, other) }; const before = f.calls.length;
  await assert.rejects(f.remote.downloadChunk(foreign), { code: 'originals_invalid_remote' }); assert.equal(f.calls.length, before);
});
test('account epoch changes during a raw Storage response prevent returning bytes or acknowledging upload', async t => {
  const f = transport(); t.after(() => f.remote.dispose()); const d = await data(), c = d.manifest.chunks[0]; f.stored.set(c.path, d.blob);
  let release, enter; const started = new Promise(r => enter = r); f.storageGate = () => { enter(); return new Promise(r => release = r); };
  const pending = f.remote.downloadChunk(c); await started; f.auth.epoch++; f.auth.user = { id: other }; release();
  await assert.rejects(pending, { code: 'originals_scope_closed' });
});
test('manifest writes capture their immutable operation before Auth awaits and sanitize server errors', async t => {
  const f = transport(); t.after(() => f.remote.dispose()); const d = await data(), request = { id: d.manifest.id, operationId: randomUUID(), manifest: d.manifest }, before = structuredClone(request);
  let release, enter; const started = new Promise(r => enter = r); f.verifyGate = () => { enter(); return new Promise(r => release = r); }; f.result = { status: 'stored', revision: 1 };
  const pending = f.remote.write(request); await started; request.manifest.entries[0].sourceRelativePath = 'changed.png'; release(); await pending;
  assert.deepEqual(f.calls[0].args, { p_id: before.id, p_operation_id: before.operationId, p_manifest: before.manifest });
  f.verifyGate = null; f.error = { message: 'synthetic-sensitive-detail', code: 'unexpected' };
  await assert.rejects(f.remote.read(before.id), e => e.code === 'originals_network' && !e.message.includes('synthetic-sensitive-detail'));
});
test('capability0 and absent backend preserve legacy mode while malformed advertised support is rejected', async t => {
  const f = transport(); t.after(() => f.remote.dispose()); f.error = { code: 'PGRST202' }; assert.equal((await f.remote.capabilities()).version, 0);
  f.error = null; f.result = { version: 0 }; assert.equal((await f.remote.capabilities()).version, 0);
  f.result = { version: 1, metadataVersion: 1, originalsVersion: 1 }; assert.equal((await f.remote.capabilities()).originalsVersion, 1);
  f.result = { version: 1, originalsVersion: 1 }; await assert.rejects(f.remote.capabilities(), { code: 'originals_invalid_remote' });
});
test('catalog is metadata-only with strict UUID pagination; malformed rows never reach callers', async t => {
  const f = transport(); t.after(() => f.remote.dispose()); const d = await data();
  const row = { id: d.manifest.id, revision: 1, created_at: '2026-10-23T01:02:03Z', archive_sha256: d.manifest.archiveHash, archive_bytes: d.blob.size, part: 1, part_count: 1, source_head: d.part.sourceHead, entry_count: d.part.entries.length, total_file_bytes: d.part.entries.reduce((n, e) => n + e.bytes, 0) };
  f.result = { items: [row], next: row.id }; assert.equal((await f.remote.list(null, 1)).next, row.id);
  for (const result of [{ items: [{ ...row, body: 'private' }], next: null }, { items: [row, row], next: null }, { items: [row], next: other }]) {
    f.result = result; await assert.rejects(f.remote.list(), { code: 'originals_invalid_remote' });
  }
  f.result = { id: row.id, revision: 1, created_at: row.created_at, manifest: d.manifest }; assert.equal((await f.remote.read(row.id)).manifest.archiveHash, d.manifest.archiveHash);
  f.result.manifest.chunks[0].path = 'foreign/private'; await assert.rejects(f.remote.read(row.id), { code: 'originals_invalid_remote' });
});

/* Protocol checks for the anonymous SDK HTTP fixture, not hosted SQL/RLS. */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { createHash } = require('node:crypto');
const { FakeCloud, accounts, session, cloud } = require('./life-sync-browser.cjs');
const Core = require('../assets/life/core.js'), Meta = require('../assets/life/library-meta.js');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function request(server, rpc, body = {}, owner = accounts.a, options = {}) {
  let response; const bytes = options.bytes, method = options.method || 'POST', url = cloud + (options.path || '/rest/v1/rpc/' + rpc);
  const headers = { authorization: 'Bearer ' + session(owner).access_token, 'content-type': 'application/json', ...options.headers };
  const route = { request: () => ({ url: () => url, method: () => method, headers: () => headers, postData: () => method === 'GET' ? null : bytes ? bytes.toString() : JSON.stringify(body), postDataJSON: () => structuredClone(body), postDataBuffer: () => bytes || Buffer.from(JSON.stringify(body)) }), fulfill: async value => { response = value; }, abort: async reason => { response = { aborted: reason }; } };
  await server.handle(route, options.device || 'fixture-a'); assert(response); return { ...response, json: typeof response.body === 'string' ? JSON.parse(response.body || 'null') : null };
}
test('older backend is explicit capability zero; probes are recorded without changing legacy workspace ledgers', async () => {
  const server = new FakeCloud(), capability = await request(server, 'life_library_capabilities'); assert.equal(capability.status, 200); assert.deepEqual(capability.json, { version: 0, metadataVersion: 0, originalsVersion: 0 }); assert.equal(server.libraryRequests.length, 1); assert.equal(server.requests.length, 0); assert.equal(server.writes().length, 0);
  assert.equal((await request(server, 'life_library_open')).status, 404); assert.equal(server.rows.size, 0);
});
test('same-account first opens agree, catalogs are owner scoped and deleted defaults are never recreated', async () => {
  const server = new FakeCloud().enableAccountLibrary(), preferred = Core.id();
  const [a, b] = await Promise.all([request(server, 'life_library_open', { p_preferred_workspace_id: preferred }), request(server, 'life_library_open')]);
  assert.equal(a.json.workspace_id, preferred); assert.equal(b.json.workspace_id, preferred); assert.equal(a.json.pristine, true); assert.equal(server.rows.size, 1);
  assert.deepEqual((await request(server, 'life_library_catalog', {}, accounts.b)).json, { items: [], next: null });
  const row = server.row(accounts.a.id, preferred); row.revision++; const changed = (await request(server, 'life_library_open')).json; assert.equal(changed.pristine, false); assert.equal(changed.default_revision, row.revision); server.rows.delete(server.key(accounts.a.id, preferred));
  const missing = (await request(server, 'life_library_open')).json; assert.equal(missing.status, 'missing'); assert.equal(missing.default_revision, 0); assert.equal(server.rows.size, 0);
});
test('metadata preserves exact operation receipts, source readiness and conflict heads', async () => {
  const server = new FakeCloud().enableAccountLibrary(), opened = await request(server, 'life_library_open'), id = opened.json.workspace_id;
  const body = { p_workspace_id: id, p_expected_revision: 0, p_operation_id: Core.id(), p_source_revision: 1, p_data: Meta.empty(id) };
  assert.deepEqual((await request(server, 'life_library_meta_put', body)).json, { status: 'stored', revision: 1 }); assert.deepEqual((await request(server, 'life_library_meta_put', body)).json, { status: 'stored', revision: 1 });
  assert.equal((await request(server, 'life_library_meta_put', { ...body, p_data: { ...body.p_data, revision: 1 } })).status, 400);
  assert.deepEqual((await request(server, 'life_library_meta_put', { ...body, p_operation_id: Core.id() })).json, { status: 'conflict', revision: 1 });
  assert.equal((await request(server, 'life_library_meta_put', { ...body, p_operation_id: Core.id(), p_source_revision: 2 })).status, 400);
  assert.equal((await request(server, 'life_library_meta_get', { p_workspace_id: id }, accounts.b)).json, null);
  server.rows.delete(server.key(accounts.a.id, id)); assert.deepEqual((await request(server, 'life_library_meta_put', body)).json, { status: 'missing' });
});
test('original manifests require immutable owner chunks and a tombstone beats an old stored receipt', async () => {
  const server = new FakeCloud().enableAccountLibrary(), id = Core.id(), bytes = require('./fixtures/original-attachments.cjs').fixture().zip, parsed = await require('../assets/life/original-attachments.js').readPart(new Blob([bytes])), hash = sha(bytes), path = accounts.a.id + '/' + hash + '/0000-' + hash;
  const manifest = { format: 'life-library-original-v1', id, sourceHead: 'a'.repeat(40), part: 1, partCount: 1, archiveBytes: bytes.length, archiveHash: hash, entries: parsed.entries, chunks: [{ index: 0, path, bytes: bytes.length, sha256: hash }] }, body = { p_id: id, p_operation_id: Core.id(), p_manifest: manifest };
  assert.equal((await request(server, 'life_library_original_put', body)).status, 400);
  const upload = { path: '/storage/v1/object/life-library-originals/' + path, bytes, headers: { 'content-type': 'application/octet-stream', 'x-upsert': 'false' } };
  assert.equal((await request(server, null, {}, accounts.a, upload)).status, 200); assert.equal((await request(server, null, {}, accounts.a, upload)).status, 409);
  assert.deepEqual((await request(server, 'life_library_original_put', body)).json, { status: 'stored', revision: 1 }); assert.deepEqual((await request(server, 'life_library_original_put', body)).json, { status: 'stored', revision: 1 });
  assert.equal((await request(server, 'life_library_original_get', { p_id: id }, accounts.b)).json, null);
  assert.equal((await request(server, null, {}, accounts.b, { path: upload.path, method: 'GET' })).status, 403);
  server.libraryOriginalTombstones.add(server.key(accounts.a.id, id)); server.libraryChunks.clear(); assert.deepEqual((await request(server, 'life_library_original_put', body)).json, { status: 'missing' });
});
test('catalog cursor covers every owned workspace without returning another account', async () => {
  const server = new FakeCloud().enableAccountLibrary();
  for (let i = 0; i < 103; i++) { const id = Core.id(), data = Core.createWorkspace({ workspaceId: id, title: 'Synthetic ' + i }); server.rows.set(server.key(accounts.a.id, id), { owner_id: accounts.a.id, id, title: data.title, revision: 1, data, updated_at: data.updatedAt }); }
  const a = await request(server, 'life_library_catalog', { p_limit: 100 }); assert.equal(a.json.items.length, 100); assert(a.json.next);
  const b = await request(server, 'life_library_catalog', { p_after: a.json.next, p_limit: 100 }); assert.equal(b.json.items.length, 3); assert.equal(b.json.next, null); assert.equal(new Set([...a.json.items, ...b.json.items].map(row => row.id)).size, 103);
});

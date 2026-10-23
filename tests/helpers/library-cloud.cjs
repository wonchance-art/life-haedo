/* Explicit old-backend (capability 0) / account-library (capability 1) HTTP
 * fixture. Real application SDK transport only; no operating SQL/RLS claim.
 * The legacy requests ledger keeps its old source/composition contract.
 * libraryRequests/libraryAssetCalls record every new probe/operation separately. */
'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const Core = require('../../assets/life/core.js');
const copy = value => structuredClone(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, function (key, item) { return item && !Array.isArray(item) && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item; });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, HASH = /^[a-f0-9]{64}$/;
const RPCS = new Set(['life_library_capabilities', 'life_library_open', 'life_library_catalog', 'life_library_meta_get', 'life_library_meta_put', 'life_library_originals_list', 'life_library_original_get', 'life_library_original_put']);
function withLibraryCloud(BaseCloud, accounts) {
  return class LibraryCloud extends BaseCloud {
    constructor(...args) {
      super(...args); this.libraryCapabilities = { version: 0, metadataVersion: 0, originalsVersion: 0 };
      this.libraryRequests = []; this.libraryAssetCalls = []; this.libraryRouteErrors = [];
      this.libraryDefaults = new Map(); this.libraryMetadata = new Map(); this.libraryMetaReceipts = new Map();
      this.libraryOriginals = new Map(); this.libraryOriginalReceipts = new Map(); this.libraryOriginalTombstones = new Set(); this.libraryChunks = new Map();
      this.libraryOffline = new Set(); this.loseLibraryResponses = new Set(); this.heldLibrary = null;
      this.corruptLibraryChunks = new Set(); this.missingLibraryChunks = new Set(); this.failLibraryUploads = new Set();
    }
    enableAccountLibrary() { this.libraryCapabilities = { version: 1, metadataVersion: 1, originalsVersion: 1 }; return this; }
    libraryOwner(request) { try { const value = JSON.parse(Buffer.from(request.headers().authorization.replace(/^Bearer /i, '').split('.')[1], 'base64url')); return Object.values(accounts).find(account => account.id === value.sub)?.id || null; } catch (_) { return null; } }
    libraryMeta(owner, id) { return this.libraryMetadata.get(this.key(owner, id)); }
    libraryWrites(device) { return this.libraryRequests.filter(row => ['life_library_meta_put', 'life_library_original_put'].includes(row.rpc) && (!device || row.device === device)); }
    async handle(route, device) {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      const rpc = url.pathname.startsWith('/rest/v1/rpc/life_library_') ? url.pathname.split('/').at(-1) : null;
      const parts = url.pathname.startsWith('/storage/v1/object/') ? url.pathname.split('/').slice(4).map(decodeURIComponent) : [];
      if (parts[0] === 'authenticated') parts.shift(); const bucket = parts.shift();
      if (!rpc && bucket !== 'life-library-originals') return super.handle(route, device);
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'content-type': 'application/json', 'cache-control': 'no-store' };
      const send = (value, status = 200) => route.fulfill({ status, headers, body: status === 204 ? '' : JSON.stringify(value) });
      if (method === 'OPTIONS') return send(null, 204);
      const owner = this.libraryOwner(request);
      if (!owner) return send({ code: 'PGRST301', message: 'Synthetic verified account required' }, 401);
      if (this.offline.has(device) || this.libraryOffline.has(device)) { this.expectedFailures++; return route.abort('internetdisconnected'); }
      try {
        if (!rpc) return await this.libraryAsset(route, { owner, device, parts, method, headers, send });
        assert(RPCS.has(rpc), 'Unexpected account-library RPC: ' + rpc); assert.equal(method, 'POST');
        const body = request.postData() ? request.postDataJSON() : {};
        const entry = { rpc, owner, device, body: copy(body), method }; this.libraryRequests.push(entry);
        if (rpc === 'life_library_capabilities') return send(copy(this.libraryCapabilities));
        if (this.libraryCapabilities.version !== 1) return send({ code: 'PGRST202', message: 'Synthetic explicitly older backend has no library capability' }, 404);
        const held = this.heldLibrary?.device === device && (!this.heldLibrary.rpc || this.heldLibrary.rpc === rpc) ? this.heldLibrary : null;
        if (held) this.heldLibrary = null;
        const respond = async value => {
          if (held) { (held.entered?.resolve || held.enter)?.(); await (held.release?.promise || held.released || held.release); }
          if (rpc.endsWith('_put') && this.loseLibraryResponses.has(device)) { this.expectedFailures++; return route.abort('failed'); }
          return send(copy(value));
        };
        const page = rows => {
          const limit = body.p_limit ?? 100, after = body.p_after ?? null; assert(Number.isInteger(limit) && limit >= 1 && limit <= 100); assert(after === null || UUID.test(after));
          const all = rows.sort((a, b) => a.id.localeCompare(b.id)).filter(row => after === null || row.id > after), items = all.slice(0, limit);
          return { items, next: all.length > items.length ? items.at(-1).id : null };
        };
        if (rpc === 'life_library_open') {
          const preferred = body.p_preferred_workspace_id ?? null; assert(preferred === null || UUID.test(preferred));
          let pointer = this.libraryDefaults.get(owner);
          if (!pointer) {
            const owned = [...this.rows.values()].filter(row => row.owner_id === owner).sort((a, b) => a.id.localeCompare(b.id));
            const foreignPreferred = preferred && [...this.rows.values()].some(row => row.id === preferred && row.owner_id !== owner);
            const id = preferred && !foreignPreferred ? preferred : owned[0]?.id || Core.id(); let row = this.row(owner, id), initialHash = null, initialRevision = null;
            if (!row) { const data = Core.createWorkspace({ workspaceId: id, title: '내 자료' }); row = { owner_id: owner, id, title: data.title, revision: 1, data, updated_at: new Date().toISOString() }; this.rows.set(this.key(owner, id), row); initialHash = sha(canonical(data)); initialRevision = row.revision; }
            pointer = { workspaceId: id, defaultRevision: 1, initialHash, initialRevision }; this.libraryDefaults.set(owner, pointer);
          }
          const row = this.row(owner, pointer.workspaceId);
          return respond({ status: row ? 'ready' : 'missing', workspace_id: pointer.workspaceId, default_revision: row?.revision || 0, pristine: !!row && pointer.initialHash !== null && row.revision === pointer.initialRevision && sha(canonical(row.data)) === pointer.initialHash });
        }
        if (rpc === 'life_library_catalog') return respond(page([...this.rows.values()].filter(row => row.owner_id === owner).map(({ id, title, revision, updated_at }) => ({ id, title, revision, updated_at }))));
        if (rpc === 'life_library_meta_get') { assert(UUID.test(body.p_workspace_id)); return respond(this.libraryMeta(owner, body.p_workspace_id) || null); }
        if (rpc === 'life_library_meta_put') {
          const { p_workspace_id: id, p_expected_revision: expected, p_operation_id: operation, p_source_revision: sourceRevision, p_data: data } = body;
          assert(UUID.test(id) && UUID.test(operation)); assert(Number.isSafeInteger(expected) && expected >= 0); assert(Number.isSafeInteger(sourceRevision) && sourceRevision >= 1);
          assert.equal(data?.workspaceId, id); assert(Buffer.byteLength(JSON.stringify(data)) <= 8 * 1024 * 1024);
          const Model = require('../../assets/life/library-meta.js'); Model.validate(data);
          const key = this.key(owner, id), old = this.libraryMetadata.get(key), receiptKey = key + ':' + operation, payload = canonical(body), receipt = this.libraryMetaReceipts.get(receiptKey), source = this.row(owner, id);
          if (!source) return respond({ status: 'missing' });
          Model.validateReferences(source.data, data);
          assert(sourceRevision <= source.revision, 'Metadata must reference a ready source revision');
          if (receipt) { assert.equal(receipt.payload, payload, 'Library receipt replay changed payload'); return respond(receipt.result); }
          if (!old && expected !== 0) return respond({ status: 'missing' });
          if (old && old.revision !== expected) return respond({ status: 'conflict', revision: old.revision });
          const result = { status: 'stored', revision: (old?.revision || 0) + 1 };
          this.libraryMetadata.set(key, { workspace_id: id, revision: result.revision, source_revision: sourceRevision, data: copy(data), updated_at: new Date().toISOString() }); this.libraryMetaReceipts.set(receiptKey, { payload, result }); return respond(result);
        }
        if (rpc === 'life_library_originals_list') return respond(page([...this.libraryOriginals.entries()].filter(([key]) => key.startsWith(owner + ':') && !this.libraryOriginalTombstones.has(key)).map(([, row]) => ({ id: row.id, revision: row.revision, created_at: row.created_at, archive_sha256: row.manifest.archiveHash, archive_bytes: row.manifest.archiveBytes, part: row.manifest.part, part_count: row.manifest.partCount, source_head: row.manifest.sourceHead, entry_count: row.manifest.entries.length, total_file_bytes: row.manifest.entries.reduce((n, entry) => n + entry.bytes, 0) }))));
        if (rpc === 'life_library_original_get') { assert(UUID.test(body.p_id)); const key = this.key(owner, body.p_id); return respond(this.libraryOriginalTombstones.has(key) ? null : this.libraryOriginals.get(key) || null); }
        if (rpc === 'life_library_original_put') {
          const { p_id: id, p_operation_id: operation, p_manifest: manifest } = body; assert(UUID.test(id) && UUID.test(operation));
          const key = this.key(owner, id); if (this.libraryOriginalTombstones.has(key)) return respond({ status: 'missing' });
          require('../../assets/life/original-attachments.js').validateManifest(manifest, owner);
          assert.equal(manifest?.format, 'life-library-original-v1'); assert.equal(manifest.id, id); assert(HASH.test(manifest.archiveHash)); assert(Number.isSafeInteger(manifest.archiveBytes) && manifest.archiveBytes > 0 && manifest.archiveBytes <= 128 * 1024 * 1024); assert(Buffer.byteLength(JSON.stringify(manifest)) <= 2 * 1024 * 1024);
          assert(Array.isArray(manifest.entries) && manifest.entries.length <= 500); assert(Array.isArray(manifest.chunks) && manifest.chunks.length > 0 && manifest.chunks.length <= 16);
          let total = 0;
          manifest.chunks.forEach((chunk, index) => { assert.equal(chunk.index, index); assert(HASH.test(chunk.sha256)); assert.equal(chunk.path, owner + '/' + manifest.archiveHash + '/' + String(index).padStart(4, '0') + '-' + chunk.sha256); assert(Number.isSafeInteger(chunk.bytes) && chunk.bytes > 0 && chunk.bytes <= 8 * 1024 * 1024); const stored = this.libraryChunks.get(chunk.path); assert(stored, 'Every original chunk must exist before manifest commit'); assert.equal(stored.bytes.length, chunk.bytes); assert.equal(sha(stored.bytes), chunk.sha256); total += chunk.bytes; }); assert.equal(total, manifest.archiveBytes);
          const receiptKey = owner + ':' + operation, payload = canonical(body);
          const prior = this.libraryOriginalReceipts.get(receiptKey); if (prior) { assert.equal(prior.payload, payload, 'Original receipt replay changed payload'); return respond(prior.result); }
          const old = this.libraryOriginals.get(key); if (old) assert.equal(canonical(old.manifest), canonical(manifest), 'Immutable original manifest cannot change');
          const result = { status: 'stored', revision: 1 }; if (!old) this.libraryOriginals.set(key, { id, revision: 1, manifest: copy(manifest), created_at: new Date().toISOString() }); this.libraryOriginalReceipts.set(receiptKey, { payload, result }); return respond(result);
        }
        throw Error('Unimplemented library RPC: ' + rpc);
      } catch (error) { this.libraryRouteErrors.push({ owner, device, rpc, message: error.message }); return send({ code: '22023', message: 'Synthetic library contract rejected request: ' + error.message }, 400); }
    }
    async libraryAsset(route, { owner, device, parts, method, headers, send }) {
      const request = route.request(), path = parts.join('/'); this.libraryAssetCalls.push({ owner, device, method, path });
      if (this.libraryCapabilities.version !== 1) return send({ error: 'Not found', message: 'Synthetic explicitly older backend has no original bucket', statusCode: '404' }, 404);
      if (!path.startsWith(owner + '/') || parts.some(part => !part || ['.', '..'].includes(part))) return send({ error: 'Unauthorized', message: 'Synthetic owner prefix denied', statusCode: '403' }, 403);
      const match = path.match(/^([a-f0-9-]+)\/([a-f0-9]{64})\/(\d{4})-([a-f0-9]{64})$/); assert(match && UUID.test(match[1]));
      if (method === 'POST') {
        if (this.failLibraryUploads.has(device)) { this.expectedFailures++; return send({ error: 'Unavailable', message: 'Synthetic chunk upload unavailable', statusCode: '503' }, 503); }
        assert.notEqual(request.headers()['x-upsert'], 'true', 'Original objects cannot be replaced');
        let bytes = request.postDataBuffer(); const type = request.headers()['content-type'] || '';
        if (type.startsWith('multipart/form-data')) { const form = await new Request(request.url(), { method: 'POST', headers: { 'content-type': type }, body: bytes }).formData(); const blobs = [...form.values()].filter(value => value instanceof Blob); assert.equal(blobs.length, 1); bytes = Buffer.from(await blobs[0].arrayBuffer()); }
        assert(bytes && bytes.length > 0 && bytes.length <= 8 * 1024 * 1024); assert.equal(sha(bytes), match[4]);
        if (this.libraryChunks.has(path)) return send({ error: 'Duplicate', message: 'The resource already exists', statusCode: '409' }, 409);
        this.libraryChunks.set(path, { bytes: Buffer.from(bytes), type: 'application/octet-stream' }); return send({ Key: 'life-library-originals/' + path, Id: path });
      }
      assert.equal(method, 'GET'); const object = this.libraryChunks.get(path); if (!object || this.missingLibraryChunks.has(path)) return send({ error: 'Not found', message: 'Synthetic original chunk missing', statusCode: '404' }, 404);
      const bytes = Buffer.from(object.bytes); if (this.corruptLibraryChunks.has(path)) bytes[0] ^= 255;
      return route.fulfill({ status: 200, headers: { ...headers, 'content-type': 'application/octet-stream' }, body: bytes });
    }
  };
}
module.exports = { withLibraryCloud };

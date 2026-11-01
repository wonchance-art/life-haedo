/* Shared synthetic transport for private material-writing preparations
 * (life_material_*). In-memory per-owner rows, operation receipts, CAS and
 * tombstones. No hosted SQL/RLS claim; the Local SQL fixture covers the
 * real functions. Any other life_material_* name is rejected loudly. */
'use strict';
const assert = require('node:assert/strict');
const copy = value => structuredClone(value);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const RPCS = new Set(['life_material_capabilities', 'life_material_list', 'life_material_get', 'life_material_put', 'life_material_delete']);
function withMaterialCloud(BaseCloud, accounts) {
  return class MaterialCloud extends BaseCloud {
    constructor(...args) {
      super(...args); this.materials = new Map(); this.materialReceipts = new Map(); this.materialCalls = [];
      this.materialSchemaMissing = false; this.materialOffline = new Set(); this.materialClock = Date.parse('2026-11-01T00:00:00.000Z');
    }
    materialOwner(request) {
      try { const sub = JSON.parse(Buffer.from(request.headers().authorization.replace(/^Bearer /i, '').split('.')[1], 'base64url')).sub; return Object.values(accounts).find(account => account.id === sub)?.id || null; }
      catch (_) { return null; }
    }
    material(owner, id) { return this.materials.get(owner + ':' + id); }
    materialRows(owner) { return [...this.materials.values()].filter(row => row.owner === owner && !row.deleted); }
    materialWrites(device) { return this.materialCalls.filter(call => ['life_material_put', 'life_material_delete'].includes(call.rpc) && (!device || call.device === device)); }
    nextMaterialTime() { this.materialClock += 1000; return new Date(this.materialClock).toISOString(); }
    async handle(route, device) {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      if (!url.pathname.startsWith('/rest/v1/rpc/life_material_')) return super.handle(route, device);
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'content-type': 'application/json', 'cache-control': 'no-store' };
      const send = (value, status = 200) => route.fulfill({ status, headers, body: status === 204 ? '' : JSON.stringify(value) });
      if (method === 'OPTIONS') return send(null, 204);
      if (this.offline.has(device) || this.materialOffline.has(device)) { this.expectedFailures++; return route.abort('internetdisconnected'); }
      const rpc = url.pathname.split('/').at(-1);
      assert(RPCS.has(rpc), 'Unexpected material RPC: ' + rpc); assert.equal(method, 'POST');
      if (this.materialSchemaMissing) { this.expectedFailures++; return send({ code: 'PGRST202', message: 'Synthetic material schema unavailable' }, 404); }
      const owner = this.materialOwner(request);
      if (!owner) return send({ code: 'PGRST301', message: 'Synthetic verified account required' }, 401);
      const body = request.postData() ? request.postDataJSON() : {};
      this.materialCalls.push({ rpc, owner, device, body: copy(body) });
      if (rpc === 'life_material_capabilities') return send({ source_edited_copy: 1 });
      if (rpc === 'life_material_list') {
        // Newest first by (updated_at, id); 20 per page; tombstones are not listed.
        const rows = this.materialRows(owner).sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.toLowerCase().localeCompare(a.id.toLowerCase()));
        const after = body.p_after_updated_at ? rows.findIndex(row => row.updated_at === body.p_after_updated_at && row.id === body.p_after_id) : -1;
        const page = rows.slice(after + 1, after + 21), items = page.map(row => ({ id: row.id, revision: row.revision, title: row.data.plan.title || '', updated_at: row.updated_at }));
        const last = items.at(-1), next = items.length === 20 && rows.length > after + 21 ? { updated_at: last.updated_at, id: last.id } : null;
        return send({ items, next });
      }
      assert(UUID.test(body.p_id), 'Material RPCs address one preparation by UUID');
      const key = owner + ':' + body.p_id, row = this.materials.get(key);
      if (rpc === 'life_material_get') return send(!row ? null : row.deleted ? { id: row.id, revision: row.revision, deleted: true, updated_at: row.updated_at } : { id: row.id, revision: row.revision, data: copy(row.data), updated_at: row.updated_at });
      const receiptKey = key + ':' + body.p_operation_id, payload = JSON.stringify(body), prior = this.materialReceipts.get(receiptKey);
      let result;
      if (prior) { assert.equal(payload, prior.payload, 'A retry must reuse exactly the same material request'); result = prior.result; }
      else if (rpc === 'life_material_delete' && (!row || row.deleted)) result = { status: 'missing', revision: row?.revision || 0 };
      else if ((row?.revision || 0) !== body.p_expected_revision) result = { status: 'conflict', revision: row.revision };
      else if (rpc === 'life_material_delete') {
        result = { status: 'deleted', revision: row.revision + 1 };
        this.materials.set(key, { ...row, revision: result.revision, deleted: true, updated_at: this.nextMaterialTime() });
        this.materialReceipts.set(receiptKey, { payload, result });
      } else {
        assert(body.p_data?.format === 'life-material-continuity-v1', 'Only the preparation snapshot format is stored');
        result = { status: 'stored', revision: (row?.revision || 0) + 1 };
        this.materials.set(key, { owner, id: body.p_id, revision: result.revision, data: copy(body.p_data), deleted: false, updated_at: this.nextMaterialTime() });
        this.materialReceipts.set(receiptKey, { payload, result });
      }
      return send(result);
    }
  };
}
module.exports = { withMaterialCloud };

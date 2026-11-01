/* Anonymous account-document HTTP fixture (life_account_document_put/changes).
 * Owner-scoped in-memory CAS with receipts and a seq cursor, modelled on
 * supabase/migrations/20261101090000_life_account_documents.sql. Requests are
 * recorded only in `accountDocRequests`, separate from the older ledgers, so
 * existing source/composition/library write audits keep their meaning. It is
 * not evidence of deployed SQL/RLS behavior (tests/run-account-docs-postgres.cjs). */
'use strict';
const assert = require('node:assert/strict');
const copy = value => structuredClone(value);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const RPCS = new Set(['life_account_document_put', 'life_account_document_changes']);
function withAccountDocsCloud(BaseCloud) {
  return class AccountDocsCloud extends BaseCloud {
    constructor(...args) {
      super(...args);
      this.accountDocs = new Map(); this.accountDocReceipts = new Map(); this.accountDocSeq = 0;
      this.accountDocRequests = []; this.accountDocsOffline = new Set();
    }
    accountDocWrites(device) { return this.accountDocRequests.filter(row => row.rpc === 'life_account_document_put' && (!device || row.device === device)); }
    async handle(route, device) {
      const request = route.request(), url = new URL(request.url()), rpc = url.pathname.startsWith('/rest/v1/rpc/') ? url.pathname.split('/').at(-1) : null;
      if (!RPCS.has(rpc)) return super.handle(route, device);
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'content-type': 'application/json', 'cache-control': 'no-store' };
      const send = (value, status = 200) => route.fulfill({ status, headers, body: status === 204 ? '' : JSON.stringify(value) });
      if (request.method() === 'OPTIONS') return send(null, 204);
      assert.equal(request.method(), 'POST');
      const owner = this.libraryOwner(request);
      if (!owner) return send({ code: '42501', message: 'life_account_document_auth_required' }, 401);
      if (this.offline?.has(device) || this.accountDocsOffline.has(device)) { this.expectedFailures++; return route.abort('internetdisconnected'); }
      const body = request.postData() ? request.postDataJSON() : {};
      this.accountDocRequests.push({ rpc, owner, device, body: copy(body) });
      const docs = this.accountDocs.get(owner) || new Map(); this.accountDocs.set(owner, docs);
      if (rpc === 'life_account_document_changes') {
        const after = body.p_after_seq, limit = body.p_limit;
        assert(Number.isSafeInteger(after) && after >= 0); assert(Number.isSafeInteger(limit) && limit >= 1 && limit <= 500);
        return send([...docs.entries()].map(([doc_key, row]) => ({ doc_key, ...copy(row) }))
          .filter(row => row.seq > after).sort((a, b) => a.seq - b.seq).slice(0, limit));
      }
      const { p_doc_key: key, p_expected_revision: expected, p_operation_id: operation, p_data: data, p_deleted: deleted, p_client_updated_at: at } = body;
      assert(typeof key === 'string' && key.length >= 1 && key.length <= 512); assert(Number.isSafeInteger(expected) && expected >= 0); assert(UUID.test(operation));
      assert.equal(typeof deleted, 'boolean'); assert(deleted ? data === null : data !== null && data !== undefined);
      if (JSON.stringify(data).length > 2 * 1024 * 1024) return send({ code: '22001', message: 'life_account_document_too_large' }, 400);
      const receiptKey = owner + ':' + operation, hash = JSON.stringify([key, expected, data, deleted, at]);
      const receipt = this.accountDocReceipts.get(receiptKey);
      if (receipt) {
        if (receipt.hash !== hash) return send({ code: '22023', message: 'life_account_document_operation_mismatch' }, 400);
        return send(copy(receipt.result));
      }
      const current = docs.get(key);
      if ((current?.revision || 0) !== expected) {
        return send({ status: 'conflict', revision: current?.revision || 0, seq: current?.seq ?? null,
          current: current ? { revision: current.revision, data: copy(current.data), deleted: current.deleted, client_updated_at: current.client_updated_at } : null });
      }
      const row = { revision: (current?.revision || 0) + 1, data: copy(data), deleted, client_updated_at: at ?? null, seq: ++this.accountDocSeq, updated_at: new Date().toISOString() };
      docs.set(key, row);
      const result = { status: 'stored', revision: row.revision, seq: row.seq };
      this.accountDocReceipts.set(receiptKey, { hash, result });
      return send(result);
    }
  };
}
module.exports = { withAccountDocsCloud };

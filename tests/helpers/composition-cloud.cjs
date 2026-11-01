/* Shared synthetic transport for private compositions (life_composition_get/put): per-owner
 * heads, operation receipts and CAS with the source-readiness rule. Compositions start syncing
 * by themselves once originals sync, so the shared fake cloud models them. Moved from
 * tests/composition-sync-browser.cjs; its ledger is compositionRequests. No hosted SQL/RLS claim. */
'use strict';
const copy = value => structuredClone(value);
function withCompositionCloud(BaseCloud, accounts) {
  return class CompositionCloud extends BaseCloud {
    constructor(...args) { super(...args); this.compositionRequests = []; this.compositions = new Map(); this.compositionReceipts = new Map(); this.compositionMissing = false; this.compositionOffline = new Set(); this.loseComposition = new Set(); this.heldComposition = null; }
    composition(owner, id) { return this.compositions.get(this.key(owner, id)); }
    compositionWrites(device) { return (this.compositionRequests || []).filter(value => value.kind === 'composition-write' && (!device || value.device === device)); }
    async handle(route, device) {
      const request = route.request(), url = new URL(request.url());
      if (!['/rest/v1/rpc/life_composition_get', '/rest/v1/rpc/life_composition_put'].includes(url.pathname)) return super.handle(route, device);
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'content-type': 'application/json' };
      const send = (body, status = 200) => route.fulfill({ status, headers, body: status === 204 ? '' : JSON.stringify(body) });
      if (request.method() === 'OPTIONS') return send(null, 204);
      if (this.offline.has(device) || this.compositionOffline.has(device)) { this.expectedFailures++; return route.abort('internetdisconnected'); }
      let account;
      try { const token = request.headers().authorization.replace(/^Bearer /i, ''), payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')); account = Object.values(accounts).find(value => value.id === payload.sub); } catch (_) {}
      if (!account) return send({ code: 'PGRST301', message: 'Anonymous account required' }, 401);
      const body = request.postDataJSON(), id = body.p_workspace_id, owner = account.id, key = this.key(owner, id), write = url.pathname.endsWith('_put');
      (this.compositionRequests ||= []).push({ kind: write ? 'composition-write' : 'composition-read', owner, id, device, operation: body.p_operation_id, expected: body.p_expected_revision });
      if (this.compositionMissing) { this.expectedFailures++; return send({ code: 'PGRST202', message: 'Anonymous composition schema missing' }, 404); }
      const hold = this.heldComposition?.device === device && this.heldComposition.write === write ? this.heldComposition : null;
      if (hold) this.heldComposition = null;
      if (!write) {
        const result = copy(this.compositions.get(key) || null);
        if (hold) { hold.entered.resolve(); await hold.release.promise; }
        return send(result);
      }
      const { p_expected_revision: expected, p_operation_id: operation, p_source_revision: sourceRevision, p_data: data } = body;
      const payload = JSON.stringify({ expected, sourceRevision, data }), receiptKey = key + ':' + operation;
      const receipt = this.compositionReceipts.get(receiptKey); let result;
      if (receipt) {
        if (receipt.payload !== payload) return send({ code: '22023', message: 'life_composition_operation_mismatch' }, 400);
        result = receipt.result;
      } else {
        const source = this.row(owner, id), old = this.compositions.get(key);
        if (!source || sourceRevision > source.revision) return send({ code: '22023', message: 'life_composition_source_not_ready' }, 400);
        if (!old && expected !== 0) result = { status: 'missing' };
        else if (old && old.revision !== expected) result = { status: 'conflict', revision: old.revision };
        else {
          result = { status: 'stored', revision: (old?.revision || 0) + 1 };
          this.compositions.set(key, { workspace_id: id, revision: result.revision, source_revision: sourceRevision, data: copy(data), updated_at: new Date().toISOString() });
          this.compositionReceipts.set(receiptKey, { payload, result });
        }
      }
      if (hold) { hold.entered.resolve(); await hold.release.promise; }
      if (this.loseComposition.has(device)) { this.expectedFailures++; return route.abort('failed'); }
      return send(result);
    }
  };
}
module.exports = { withCompositionCloud };

/* Shared synthetic transport for private writing drafts (life_writing_draft_*): per-owner
 * draft heads, operation receipts and CAS with the source-readiness rule of the SQL. Every
 * signed-in page syncs drafts automatically, so the shared fake cloud models them. No
 * hosted SQL/RLS claim. Moved from tests/writing-sync-browser.cjs; its ledger is
 * writingRequests so other suites' request audits are unchanged. */
'use strict';
const copy = value => structuredClone(value);
function withWritingCloud(BaseCloud, accounts) {
  return class WritingCloud extends BaseCloud {
    constructor(...args) { super(...args); this.writingRequests = []; this.drafts = new Map(); this.draftReceipts = new Map(); this.writingMissing = false; this.writingOffline = new Set(); this.loseWriting = new Set(); this.heldWriting = null; }
    draftKey(owner, workspace, id) { return this.key(owner, workspace) + ':' + id; }
    draft(owner, workspace, id) { return this.drafts.get(this.draftKey(owner, workspace, id)); }
    draftWrites(device) { return this.writingRequests.filter(value => value.kind === 'writing-put' && (!device || value.device === device)); }
    async handle(route, device) {
      const request = route.request(), url = new URL(request.url()), kind = url.pathname.split('/').at(-1).replace('life_writing_draft_', '');
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'content-type': 'application/json' };
      const send = (value, status = 200) => route.fulfill({ status, headers, body: status === 204 ? '' : JSON.stringify(value) });
      if (!['/rest/v1/rpc/life_writing_draft_get', '/rest/v1/rpc/life_writing_draft_put', '/rest/v1/rpc/life_writing_draft_list'].includes(url.pathname)) return super.handle(route, device);
      if (request.method() === 'OPTIONS') return send(null, 204);
      if (this.offline.has(device) || this.writingOffline.has(device)) { this.expectedFailures++; return route.abort('internetdisconnected'); }
      let account;
      try { const token = request.headers().authorization.replace(/^Bearer /i, ''), payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')); account = Object.values(accounts).find(value => value.id === payload.sub); } catch (_) {}
      if (!account) return send({ code: 'PGRST301', message: 'Anonymous account required' }, 401);
      const input = request.postDataJSON(), workspace = input.p_workspace_id, id = input.p_draft_id, owner = account.id, key = this.draftKey(owner, workspace, id);
      this.writingRequests.push({ kind: 'writing-' + kind, owner, workspace, id, device, operation: input.p_operation_id, expected: input.p_expected_revision, after: input.p_after_draft_id });
      if (this.writingMissing) { this.expectedFailures++; return send({ code: 'PGRST202', message: 'Anonymous writing schema missing' }, 404); }
      const hold = this.heldWriting?.device === device && this.heldWriting.kind === kind ? this.heldWriting : null;
      if (hold) this.heldWriting = null;
      if (kind === 'get' || kind === 'list') {
        const result = kind === 'get' ? copy(this.drafts.get(key) || null) : [...this.drafts.values()].filter(value => value.owner_id === owner && value.workspace_id === workspace && (!input.p_after_draft_id || value.draft_id > input.p_after_draft_id)).sort((a, b) => a.draft_id.localeCompare(b.draft_id)).slice(0, 100).map(value => ({ draft_id: value.draft_id, title: value.data.title, state: value.data.state, revision: value.revision, updated_at: value.updated_at }));
        if (kind === 'get' && result) delete result.owner_id;
        if (hold) { hold.entered.resolve(); await hold.release.promise; }
        return send(result);
      }
      const { p_expected_revision: expected, p_operation_id: operation, p_source_revision: sourceRevision, p_data: data } = input;
      const payload = JSON.stringify({ expected, sourceRevision, data }), receiptKey = key + ':' + operation;
      const receipt = this.draftReceipts.get(receiptKey); let result;
      if (receipt) {
        if (receipt.payload !== payload) return send({ code: '22023', message: 'life_writing_draft_operation_mismatch' }, 400);
        result = receipt.result;
      } else {
        const source = this.row(owner, workspace), old = this.drafts.get(key);
        const applied = data.state !== 'applied' || data.appliedResult && source?.data.sourceVersions.some(value => value.id === data.appliedResult.sourceVersionId && value.sourceId === data.appliedResult.sourceId);
        if (!source || sourceRevision > source.revision || (old && sourceRevision < old.source_revision) || !applied) return send({ code: '22023', message: 'life_writing_draft_source_not_ready' }, 400);
        if (!old && expected !== 0) result = { status: 'missing' };
        else if (old && (old.revision !== expected || old.data.state === 'applied')) result = { status: 'conflict', revision: old.revision };
        else {
          result = { status: 'stored', revision: (old?.revision || 0) + 1 };
          this.drafts.set(key, { owner_id: owner, workspace_id: workspace, draft_id: id, revision: result.revision, source_revision: sourceRevision, data: copy(data), updated_at: new Date().toISOString() });
          this.draftReceipts.set(receiptKey, { payload, result });
        }
      }
      if (hold) { hold.entered.resolve(); await hold.release.promise; }
      if (this.loseWriting.has(device)) { this.expectedFailures++; return route.abort('failed'); }
      return send(result);
    }
  };
}
module.exports = { withWritingCloud };

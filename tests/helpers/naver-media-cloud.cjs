/* Anonymous account library + immutable capture registry transport fixture.
 * Actual SDK/IDB/models execute in the browser; no hosted data or Naver access. */
'use strict';
const assert = require('node:assert/strict');
const { CaptureCloud } = require('../life-naver-capture-browser.cjs');
const { CompositionCloud } = require('../composition-sync-browser.cjs');
const copy = value => structuredClone(value);
class NaverMediaCloud extends CaptureCloud {
  constructor() {
    super();
    // CompositionCloud's handler uses these state maps against this fixture's
    // same source rows, owner identities and request ledger.
    this.compositions = new Map(); this.compositionReceipts = new Map();
    this.compositionMissing = false; this.compositionOffline = new Set();
    this.loseComposition = new Set(); this.heldComposition = null;
    this.mediaReceipts = new Map(); this.receiptRequests = []; this.receiptErrors = [];
    this.failedMedia = new Set(); this.corruptMedia = new Set(); this.failedReceiptWrites = new Set(); this.receiptHold = null;
    this.enableAccountLibrary();
  }
  receiptKey(owner, ws, source, version) { return [owner, ws, source, version].join(':'); }
  async handle(route, device) {
    const request = route.request(), url = new URL(request.url()), rpc = url.pathname.split('/').at(-1);
    if (['life_composition_get', 'life_composition_put'].includes(rpc)) return CompositionCloud.prototype.handle.call(this, route, device);
    const receiptRpc = ['life_naver_media_receipt_read', 'life_naver_media_receipt_put', 'life_naver_media_receipt_find'].includes(rpc);
    const media = url.pathname.includes('/haedo-naver-originals/');
    if (!receiptRpc && !media) return super.handle(route, device);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,GET,OPTIONS', 'content-type': 'application/json', 'cache-control': 'no-store' };
    const send = (value, status = 200) => route.fulfill({ status, headers, body: status === 204 ? '' : JSON.stringify(value) });
    if (request.method() === 'OPTIONS') return send(null, 204);
    const owner = this.libraryOwner(request);
    if (!owner) return send({ code: '42501', message: 'Synthetic verified owner required' }, 403);
    if (media) {
      const key = decodeURIComponent(url.pathname.split('/haedo-naver-originals/')[1]);
      if (this.failedMedia.has(key)) { this.expectedHttpErrors++; return send({ error: 'Synthetic selected media failure' }, 503); }
      if (this.corruptMedia.has(key)) { this.expectedHttpErrors++; return route.fulfill({ status: 200, headers: { ...headers, 'content-type': 'image/png' }, body: Buffer.from('not the declared PNG bytes') }); }
      return super.handle(route, device);
    }
    const body = request.postDataJSON(), ws = body.p_workspace_id, version = body.p_source_version_id, write = rpc.endsWith('_put');
    this.receiptRequests.push({ owner, device, rpc, body: copy(body) });
    if (write && this.failedReceiptWrites.has(device)) { this.expectedHttpErrors++; return send({ code: 'XX000', message: 'Synthetic selected receipt write failure' }, 503); }
    if (this.offline.has(device)) { this.expectedFailures++; return route.abort('internetdisconnected'); }
    const hold = this.receiptHold?.device === device && this.receiptHold.write === write ? this.receiptHold : null;
    if (hold) { this.receiptHold = null; hold.gate.enter(); await hold.gate.released; }
    try {
      assert.equal(request.method(), 'POST');
      if (rpc === 'life_naver_media_receipt_find') return send([...this.mediaReceipts.entries()].filter(([key, value]) => key.startsWith(owner + ':') && value.workspaceId === ws && value.captureId === body.p_capture_id && value.captureHash === body.p_capture_hash).map(([, value]) => copy(value)).slice(0, 51));
      const source = body.p_source_id || this.row(owner, ws)?.data.sourceVersions.find(value => value.id === version)?.sourceId;
      const key = this.receiptKey(owner, ws, source, version);
      const core = this.row(owner, ws), s = core?.data.sources.find(value => value.id === source), v = core?.data.sourceVersions.find(value => value.id === version);
      if (!s || !v || v.sourceId !== s.id) return send(null);
      if (!write) return send(copy(this.mediaReceipts.get(key) || null));
      assert.equal(s.origin, 'naver_blog');
      const capture = this.captureRows.get(body.p_capture_id);
      assert(capture && capture.owner_id === owner, 'Capture remains owner scoped');
      assert.equal(capture.capture_hash, body.p_capture_hash); assert.equal(v.contentHash, capture.payload.bodyHash); assert.equal(v.contentText, capture.payload.body);
      const value = { workspaceId: ws, sourceId: source, sourceVersionId: version, captureId: capture.id, captureHash: capture.capture_hash };
      const prior = this.mediaReceipts.get(key);
      if (prior && JSON.stringify(prior) !== JSON.stringify(value)) return send({ code: 'PT409', message: 'Immutable receipt conflict' }, 409);
      if (!prior) this.mediaReceipts.set(key, copy(value));
      return send(value);
    } catch (error) { this.receiptErrors.push(error.message); return send({ code: '22023', message: error.message }, 400); }
  }
}
module.exports = { NaverMediaCloud };

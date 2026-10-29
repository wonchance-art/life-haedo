/* Synthetic account HTTP for exact source-photo recovery. Real SDK/IDB and
 * unchanged existing capture/composition handlers; no production transport. */
'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { CaptureCloud } = require('../life-naver-capture-browser.cjs');
const { CompositionCloud } = require('../composition-sync-browser.cjs');
const { accounts } = require('../life-sync-browser.cjs');
const copy = value => structuredClone(value);
const columns = 'id,owner_id,blog_id,log_no,capture_hash,created_at,payload';
const compositionPaths = new Set(['/rest/v1/rpc/life_composition_get', '/rest/v1/rpc/life_composition_put']);
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
class SourcePhotoCloud extends CaptureCloud {
  constructor() {
    super(); this.enableAccountLibrary();
    this.compositions = new Map(); this.compositionReceipts = new Map(); this.compositionMissing = false;
    this.compositionOffline = new Set(); this.loseComposition = new Set(); this.heldComposition = null;
    this.photoRequests = []; this.photoFailures = []; this.photoRouteErrors = [];
    this.photoOffline = new Set(); this.failNextMedia = new Set(); this.corruptNextMedia = new Set();
    this.exactOverride = null; this.heldPhoto = null; this.photoHolds = [];
  }
  composition(owner, id) { return CompositionCloud.prototype.composition.call(this, owner, id); }
  compositionWrites(device) { return CompositionCloud.prototype.compositionWrites.call(this, device); }
  holdPhoto(device, kind = 'media') {
    assert.equal(this.heldPhoto, null); const value = { device, kind, entered: deferred(), release: deferred(), finished: deferred() };
    this.heldPhoto = value; this.photoHolds.push(value); return value;
  }
  async handle(route, device) {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (compositionPaths.has(url.pathname)) return CompositionCloud.prototype.handle.call(this, route, device);
    const exact = url.pathname === '/rest/v1/life_naver_captures';
    const media = url.pathname.includes('/haedo-naver-originals/');
    if (!exact && !media) return super.handle(route, device);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,OPTIONS', 'content-type': 'application/json', 'cache-control': 'no-store' };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const owner = this.owner(request), kind = exact ? 'exact' : 'media';
    const row = { device, owner, kind, method, path: url.pathname, query: [...url.searchParams], finished: false, response: null };
    this.photoRequests.push(row);
    let held;
    const send = async (body, status = 200, extra = {}) => {
      row.response = status;
      try { return await route.fulfill({ status, headers: { ...headers, ...extra }, body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }); }
      catch (error) { if (!/closed|disposed|handled|Target page|intercepted/i.test(error.message)) throw error; row.cancelledTransport = true; }
    };
    try {
      assert.equal(method, 'GET'); assert(Object.values(accounts).some(account => account.id === owner));
      if (this.photoOffline.has(device) || this.offline.has(device)) {
        this.photoFailures.push({ device, path: url.pathname, kind, expected: 'internetdisconnected' }); row.response = 'internetdisconnected';
        return route.abort('internetdisconnected');
      }
      if (this.heldPhoto?.device === device && this.heldPhoto.kind === kind) {
        held = this.heldPhoto; this.heldPhoto = null; held.entered.resolve(); await held.release.promise;
      }
      if (exact) {
        const query = Object.fromEntries(url.searchParams);
        assert.deepEqual(Object.keys(query).sort(), ['select', 'owner_id', 'blog_id', 'log_no', 'capture_hash', 'limit'].sort());
        assert.equal(query.select, columns); assert.equal(query.owner_id, 'eq.' + owner); assert.equal(query.limit, '2');
        assert(/^eq\.[a-z0-9_-]+$/.test(query.blog_id)); assert(/^eq\.[1-9][0-9]{0,29}$/.test(query.log_no)); assert(/^eq\.[a-f0-9]{64}$/.test(query.capture_hash));
        assert(!request.headers().accept?.includes('vnd.pgrst.object'), 'The unique capture is checked as an array, not maybeSingle');
        const results = [...this.captureRows.values()].filter(value => value.owner_id === owner && 'eq.' + value.blog_id === query.blog_id && 'eq.' + value.log_no === query.log_no && 'eq.' + value.capture_hash === query.capture_hash);
        const chosen = this.exactOverride ? await this.exactOverride(copy(results), row) : results;
        return send(copy(chosen).slice(0, 2));
      }
      const key = decodeURIComponent(url.pathname.split('/haedo-naver-originals/')[1]); row.key = key;
      this.captureCalls.push({ rpc: 'media', device, owner, key });
      if (this.failNextMedia.delete(device)) { this.photoFailures.push({ device, path: url.pathname, kind, expected: 503 }); return send({ error: 'synthetic_photo_failure' }, 503); }
      const value = this.media.get(key);
      if (!value || value.owner !== owner) { this.photoFailures.push({ device, path: url.pathname, kind, expected: 403 }); return send({ error: 'owner_required' }, 403); }
      const bytes = Buffer.from(value.bytes);
      if (this.corruptNextMedia.delete(device)) { bytes[bytes.length - 1] ^= 1; row.corrupted = true; }
      row.bytes = bytes.length; row.sha256 = createHash('sha256').update(bytes).digest('hex');
      return send(bytes, 200, { 'content-type': value.type });
    } catch (error) {
      this.photoRouteErrors.push({ device, kind, message: error.message });
      return send({ error: 'synthetic_photo_contract_rejected' }, 400);
    } finally { row.finished = true; held?.finished.resolve(); }
  }
}
module.exports = { SourcePhotoCloud, deferred, columns };

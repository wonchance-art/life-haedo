'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { FakeCloud } = require('../life-sync-browser.cjs');
const copy = value => structuredClone(value);
const endpoint = '/functions/v1/haedo-discovery-private';

// Anonymous HTTP fixture around the real bundled SDK. This models the Edge
// contract and distinct owner caches; it does not prove deployed SQL/RLS.
class DiscoveryPrivateCloud extends FakeCloud {
  constructor() {
    super(); this.privateArticles = new Map(); this.privateRequests = [];
    this.privateHolds = []; this.privateReplies = new Map(); this.privateRouteErrors = [];
  }
  articleKey(owner, sourceId, url) { return JSON.stringify([owner, sourceId, url]); }
  setArticles(owner, articles) {
    for (const article of articles) {
      if (article.coverage === 'link_only') { this.privateArticles.set(this.articleKey(owner, article.sourceId, article.url), { status: 'unavailable' }); continue; }
      const content = { summary: article.summary || '', coverage: article.coverage, rights: { ...copy(article.rights), mode: 'private_reading' },
        acquisition: { scope: 'private_account', method: 'publisher_xml', sourceUrl: article.url.replace(/\/full$/, '/xml'),
          fetchedAt: article.fetchedAt, license: { label: article.rights.label, url: article.rights.url } } };
      if (article.bodyText !== undefined) content.bodyText = article.bodyText;
      if (article.images !== undefined) content.images = copy(article.images);
      this.privateArticles.set(this.articleKey(owner, article.sourceId, article.url), {
        status: 'ready', sourceId: article.sourceId, url: article.url, content,
        contentHash: createHash('sha256').update(JSON.stringify(content)).digest('hex'), cached: false, stale: false
      });
    }
  }
  holdPrivate(match = () => true) {
    let enter, release, finish;
    const hold = { match, entered: new Promise(done => { enter = done; }), released: new Promise(done => { release = done; }),
      responded: new Promise(done => { finish = done; }), enter: value => enter(value), release: () => release(), finish: () => finish() };
    this.privateHolds.push(hold); return hold;
  }
  async handle(route, device) {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname !== endpoint) return super.handle(route, device);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': 'POST,OPTIONS', 'content-type': 'application/json', 'cache-control': 'no-store' };
    const send = (body, status = 200) => route.fulfill({ status, headers, body: status === 204 ? '' : JSON.stringify(body) });
    if (request.method() === 'OPTIONS') return send(null, 204);
    const owner = this.libraryOwner(request);
    if (!owner) { this.privateRequests.push({ device, owner: null }); return send({ error: 'unauthorized' }, 401); }
    try {
      assert.equal(request.method(), 'POST');
      assert.equal(request.headers().cookie, undefined, 'Private reader never sends publisher cookies');
      assert.equal(request.headers().referer, undefined, 'Private reader sends no page URL');
      const payload = request.postDataJSON(); assert.deepEqual(Object.keys(payload).sort(), ['sourceId', 'url']);
      const { sourceId, url: articleUrl } = payload;
      assert.equal(typeof sourceId, 'string'); assert.equal(typeof articleUrl, 'string');
      const entry = { device, owner, sourceId, url: articleUrl }; this.privateRequests.push(entry);
      const key = this.articleKey(owner, sourceId, articleUrl);
      const response = copy(this.privateReplies.get(key) || this.privateArticles.get(key) || { status: 'unavailable' });
      const holdIndex = this.privateHolds.findIndex(hold => hold.match(entry));
      const hold = holdIndex === -1 ? null : this.privateHolds.splice(holdIndex, 1)[0];
      if (hold) { hold.enter(entry); await hold.released; }
      // A caller may abort while a response is deliberately held.
      try { return await send(response); } catch (error) { if (!/closed|disposed|cancel|abort/i.test(error.message)) throw error; }
      finally { hold?.finish(); }
    } catch (error) {
      this.privateRouteErrors.push({ device, message: error.message });
      return send({ error: 'invalid_request' }, 400);
    }
  }
}
function publicMetadata(feed) {
  const result = copy(feed);
  result.articles = result.articles.map(article => {
    const { bodyText, images, acquisition, ...metadata } = article;
    return { ...metadata, summary: '', coverage: 'link_only', rights: { ...metadata.rights, mode: 'metadata_only' } };
  });
  return result;
}
module.exports = { DiscoveryPrivateCloud, publicMetadata, endpoint };

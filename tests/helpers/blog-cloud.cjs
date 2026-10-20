/* Shared synthetic private blog HTTP transport. No hosted SQL/RLS claim. */
'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const Blog = require('../../assets/life/blog.js');
const copy = value => structuredClone(value), sha = bytes => createHash('sha256').update(bytes).digest('hex');
function withBlogCloud(BaseCloud, accounts) {
return class BlogCloud extends BaseCloud {
  constructor() { super(); this.posts = new Map(); this.originals = new Map(); this.blogCalls = []; this.assetCalls = []; this.blogReceipts = new Map(); this.hold = null; }
  owner(request) {
    try { return JSON.parse(Buffer.from(request.headers().authorization.replace(/^Bearer /i, '').split('.')[1], 'base64url')).sub; }
    catch (_) { return null; }
  }
  async handle(route, device) {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (!url.pathname.startsWith('/rest/v1/rpc/life_blog_') && !url.pathname.startsWith('/storage/v1/object/')) return super.handle(route, device);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'content-type': 'application/json', 'cache-control': 'no-store' };
    const send = (value, status = 200) => route.fulfill({ status, headers, body: JSON.stringify(value) });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    if (this.offline.has(device)) { this.expectedFailures++; return route.abort('internetdisconnected'); }
    if (this.schemaMissing) { this.expectedFailures++; return send({ code: 'PGRST205', message: 'Synthetic blog schema unavailable' }, 404); }
    const owner = this.owner(request); assert(Object.values(accounts).some(account => account.id === owner), 'Private transport must use a synthetic verified owner');
    if (url.pathname.startsWith('/storage/v1/object/')) {
      const parts = url.pathname.split('/').slice(4).map(decodeURIComponent); if (parts[0] === 'authenticated') parts.shift();
      const bucket = parts.shift(), key = parts.join('/');
      assert.equal(bucket, 'haedo-blog-originals'); assert(key.startsWith(owner + '/'));
      this.assetCalls.push({ owner, device, method, key });
      if (method === 'POST') {
        const type = request.headers()['content-type'] || '';
        let bytes = request.postDataBuffer(), mime = type;
        if (type.startsWith('multipart/form-data')) {
          const form = await new Request(request.url(), { method: 'POST', headers: { 'content-type': type }, body: bytes }).formData();
          const files = [...form.values()].filter(value => value instanceof Blob); assert.equal(files.length, 1);
          bytes = Buffer.from(await files[0].arrayBuffer()); mime = files[0].type;
        }
        assert.equal(sha(bytes), parts.at(-1), 'Storage bytes must match the content-addressed original');
        const previous = this.originals.get(key); if (previous) assert.deepEqual(bytes, previous.bytes);
        this.originals.set(key, { bytes, type: mime }); return send({ Key: bucket + '/' + key, Id: key });
      }
      assert.equal(method, 'GET'); const photo = this.originals.get(key); assert(photo);
      return route.fulfill({ status: 200, headers: { ...headers, 'content-type': photo.type }, body: photo.bytes });
    }
    assert.equal(method, 'POST'); const rpc = url.pathname.split('/').at(-1), body = request.postDataJSON();
    this.blogCalls.push({ owner, device, rpc, body: copy(body) });
    if (rpc === 'life_blog_list') return send([...this.posts.values()].filter(row => row.owner === owner && (!body.p_workspace_id || row.workspace_id === body.p_workspace_id)).map(row => ({ id: row.id, workspace_id: row.workspace_id, revision: row.revision, title: row.data.title, updated_at: row.updated_at })));
    const key = owner + ':' + body.p_post_id, row = this.posts.get(key);
    if (rpc === 'life_blog_read') { const value = row ? copy(row) : null; if (value) delete value.owner; return send(value); }
    if (rpc === 'life_blog_prepare_asset') {
      const assetPath = owner + '/' + body.p_post_id + '/' + body.p_photo_id + '/' + body.p_digest;
      return send({ bucket: 'haedo-blog-originals', path: assetPath, exists: this.originals.has(assetPath) });
    }
    if (rpc !== 'life_blog_save') return send({ code: 'unsupported_blog_rpc', message: 'Synthetic private transport does not implement this RPC' }, 400);
    Blog.validateManifest(body.p_data); assert.equal(body.p_data.status, 'saved');
    const receiptKey = owner + ':' + body.p_operation_id, payload = JSON.stringify(body), prior = this.blogReceipts.get(receiptKey);
    let result;
    if (prior) { assert.equal(payload, prior.payload, 'A retry must reuse exactly the approved request'); result = prior.result; }
    else if ((row?.revision || 0) !== body.p_expected_revision) result = { status: 'conflict', revision: row.revision };
    else {
      const assets = {};
      for (const photo of body.p_data.photos) {
        const assetPath = owner + '/' + body.p_post_id + '/' + photo.id + '/' + photo.digest, original = this.originals.get(assetPath);
        assert(original); assert.equal(original.bytes.length, photo.size); assert.equal(sha(original.bytes), photo.digest); assert.equal(original.type, photo.type);
        assets[photo.id] = { bucket: 'haedo-blog-originals', path: assetPath };
      }
      result = { status: 'stored', revision: (row?.revision || 0) + 1 };
      this.posts.set(key, { owner, id: body.p_post_id, workspace_id: body.p_workspace_id, revision: result.revision, data: copy(body.p_data), assets, publication: row?.publication || null, updated_at: new Date().toISOString() });
      this.blogReceipts.set(receiptKey, { payload, result });
    }
    if (this.hold?.device === device) {
      const hold = this.hold; this.hold = null; hold.entered.resolve(); await hold.release.promise;
    }
    try { return await send(result); }
    catch (error) { if (!/closed|disposed|handled|Target page/i.test(error.message)) throw error; }
  }
  saves() { return this.blogCalls.filter(call => call.rpc === 'life_blog_save'); }
};
}
module.exports = { withBlogCloud };

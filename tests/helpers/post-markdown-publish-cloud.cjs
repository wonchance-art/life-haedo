'use strict';
/* Actual publication/media Edge handlers and isolated PostgreSQL, with only
 * Auth and Storage HTTP simulated. Never connects to a hosted project. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { LocalSQLBlogCloud } = require('../blog-completion-browser.cjs');
const { accounts, cloud, publicKey, session, base } = require('../life-sync-browser.cjs');
const SECRET = 'sb_secret_isolated_browser_fixture';
const SESSION_IDS = { [accounts.a.id]: '11111111-aaaa-4111-8111-111111111111', [accounts.b.id]: '22222222-bbbb-4222-8222-222222222222' };
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
function syntheticSession(account) {
  const value = session(account), pieces = value.access_token.split('.');
  const claims = JSON.parse(Buffer.from(pieces[1], 'base64url'));
  pieces[1] = Buffer.from(JSON.stringify({ ...claims, session_id: SESSION_IDS[account.id] })).toString('base64url');
  return { ...value, access_token: pieces.join('.') };
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

class MarkdownPublishCloud extends LocalSQLBlogCloud {
  constructor(options) { super(options); this.edgeRequests = []; this.edgeFetches = []; this.losePublishAck = false; this.publishGate = null; }
  async initialize() {
    await super.initialize();
    for (const account of Object.values(accounts)) {
      if (!SESSION_IDS[account.id]) continue;
      this.sql('insert into auth.users(id,is_anonymous) values(' + literal(account.id) + ',false) on conflict(id) do update set is_anonymous=false; ' +
        'insert into auth.sessions(id,user_id,not_after) values(' + literal(SESSION_IDS[account.id]) + ',' + literal(account.id) + ",'2099-01-01') on conflict(id) do update set not_after=excluded.not_after; select 'true'::jsonb;");
    }
    const environment = name => ({ SUPABASE_URL: cloud, SUPABASE_PUBLISHABLE_KEY: publicKey,
      SUPABASE_ANON_KEY: publicKey, SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }) })[name];
    const fetcher = this.edgeFetch.bind(this);
    const publish = await import(pathToFileURL(path.resolve(__dirname, '../../supabase/functions/haedo-blog-publish/handler.mjs')));
    const media = await import(pathToFileURL(path.resolve(__dirname, '../../supabase/functions/haedo-blog-media/index.ts')));
    // CI serves this same app on its assigned loopback port. Inject only that
    // fixture origin; the product handler's default allowlist stays unchanged.
    this.publishHandler = publish.createHandler({ fetcher, environment, origins: [new URL(base).origin] });
    this.mediaHandler = media.createHandler({ fetcher, environment });
  }
  sql(query, { owner = null, role = 'postgres' } = {}) {
    assert(['postgres', 'authenticated', 'anon', 'service_role'].includes(role));
    const claims = { role, ...(owner ? { sub: owner } : {}), ...(this.rpcSession ? { session_id: this.rpcSession } : {}) };
    const source = '\\set VERBOSITY verbose\nbegin;\nset local "request.jwt.claims" = ' + literal(JSON.stringify(claims)) + ';\nset local role ' + role + ';\n' + query.replace(/;?\s*$/, ';') + '\ncommit;';
    const raw = this.docker(['exec', '-i', this.container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '--dbname', this.database], source);
    const line = raw.trim().split('\n').filter(Boolean).at(-1); return line ? JSON.parse(line) : null;
  }
  account(headers) {
    const token = new Headers(headers).get('authorization')?.replace(/^Bearer /i, '');
    try { const sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub; return Object.values(accounts).find(account => account.id === sub) || null; }
    catch { return null; }
  }
  async edgeFetch(input, init) {
    const request = new Request(input, init), url = new URL(request.url), headers = request.headers;
    assert.equal(url.origin, cloud, 'Edge fetch must remain inside the synthetic project');
    const service = headers.get('apikey') === SECRET, account = this.account(headers);
    this.edgeFetches.push({ path: url.pathname, method: request.method, service, owner: account?.id || null });
    const send = (body, status = 200) => Response.json(body, { status });
    if (url.pathname === '/auth/v1/user') {
      assert.equal(request.method, 'GET'); assert.equal(service, false, 'authenticate the caller, never the service key');
      if (this.denyNextAuth) { this.denyNextAuth = false; return send({ message: 'Synthetic Auth revocation' }, 401); }
      return account ? send({ ...session(account).user, is_anonymous: false }) : send({ message: 'Invalid synthetic caller' }, 401);
    }
    if (url.pathname.startsWith('/rest/v1/rpc/life_blog_')) {
      assert.equal(request.method, 'POST'); assert(service || account, 'RPC requires verified synthetic credentials');
      const name = url.pathname.split('/').at(-1), body = await request.json();
      if (name === 'life_blog_markdown_publish_commit' && this.beforeCommit) {
        const hook = this.beforeCommit; this.beforeCommit = null; await hook(body);
      }
      try {
        this.rpcSession = service ? null : JSON.parse(Buffer.from(headers.get('authorization').replace(/^Bearer /i, '').split('.')[1], 'base64url')).session_id;
        const result = this.rpc(service ? null : account.id, name, body, service ? 'service_role' : 'authenticated');
        if (name === 'life_blog_markdown_publish_prepare' && result?.status === 'prepared' && this.failAuthAfterPrepare) {
          this.failAuthAfterPrepare = false; this.denyNextAuth = true;
        }
        return send(result);
      }
      catch (error) {
        if (error instanceof assert.AssertionError) throw error;
        const message = error.message.match(/ERROR:\s+[0-9A-Z]{5}:\s*([^\n]+)/)?.[1] || error.message;
        return send({ code: error.code, message }, error.code === '42501' ? 403 : 400);
      } finally { this.rpcSession = null; }
    }
    if (url.pathname.startsWith('/storage/v1/object/authenticated/haedo-blog-originals/')) {
      assert(service); assert.equal(request.method, 'GET');
      const key = decodeURIComponent(url.pathname.slice('/storage/v1/object/authenticated/'.length));
      const object = this.originals.get(key);
      return object ? new Response(object.bytes, { headers: { 'content-type': object.type, 'content-length': String(object.bytes.length) } }) : new Response(null, { status: 404 });
    }
    assert.fail('Unexpected Edge network request: ' + url.pathname);
  }
  async handle(route, device) {
    const request = route.request(), url = new URL(request.url());
    if (device.includes('visitor')) assert(!/^\/(?:auth\/|storage\/)/.test(url.pathname), 'Anonymous reading cannot use Auth or private Storage HTTP');
    const publish = url.pathname === '/functions/v1/haedo-blog-publish', media = url.pathname === '/functions/v1/haedo-blog-media';
    if (!publish && !media) return super.handle(route, device);
    const headers = request.headers();
    assert.notEqual(headers.apikey, SECRET, 'service key must never reach the browser');
    if (publish && request.method() === 'POST') {
      const body = request.postDataJSON();
      assert.deepEqual(Object.keys(body).sort(), ['p_author', 'p_copies', 'p_expected_publication_revision', 'p_expected_revision', 'p_operation_id', 'p_photo_ids', 'p_post_id']);
      this.edgeRequests.push({ device, owner: this.owner(request), body: structuredClone(body) });
    }
    const response = await (publish ? this.publishHandler : this.mediaHandler)(new Request(request.url(), {
      method: request.method(), headers, ...(request.method() === 'POST' ? { body: request.postDataBuffer() } : {}),
    }));
    const bytes = Buffer.from(await response.arrayBuffer());
    if (publish && request.method() === 'POST' && response.ok) {
      if (this.losePublishAck) { this.losePublishAck = false; this.expectedFailures++; return route.abort('failed'); }
      if (this.publishGate) { const gate = this.publishGate; this.publishGate = null; gate.entered.resolve(); await gate.release.promise; }
    }
    return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: bytes });
  }
  holdPublicationAck() { return this.publishGate = { entered: deferred(), release: deferred() }; }
}
module.exports = { MarkdownPublishCloud, syntheticSession, SESSION_IDS };

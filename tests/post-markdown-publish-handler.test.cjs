'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Photo = require('../assets/life/photo-post.js'), Markdown = require('../assets/life/post-markdown.js'), Blog = require('../assets/life/blog.js');
const endpoint = import('../supabase/functions/haedo-blog-publish/handler.mjs');
const adapter = import('../supabase/functions/haedo-blog-publish/projection.mjs');
const OWNER = '11111111-1111-4111-8111-111111111111', SESSION = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333', OP = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'fixture.user.signature', PROJECT = 'https://fixture.supabase.co';
const PUBLIC_KEY = 'sb_publishable_fixture', SECRET = 'sb_secret_fixture';
const RECEIPT = { status: 'stored', token: '55555555-5555-4555-8555-555555555555', blogToken: '66666666-6666-4666-8666-666666666666', revision: 2 };
const ENV = { SUPABASE_URL: PROJECT, SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLIC_KEY }), SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }) };

async function fixture(options = {}) {
  const { createHandler } = await endpoint, { projectMarkdownOps } = await adapter;
  const doc = Photo.create(() => POST, '2026-11-05T00:00:00.000Z'); doc.status = 'saved'; doc.title = '익명 게시 검수';
  for (const [id, byte] of [['first', 1], ['second', 2]]) {
    const blob = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, byte])], { type: 'image/png' });
    doc.photos.push({ id, name: '비공개 원본 ' + id, type: blob.type, width: 8, height: 8, size: blob.size, digest: await Photo.digest(blob), blob });
  }
  doc.ops = [{ insert: '직접 쓴 문장. ' }, { insert: 'AI가 도운 문장', attributes: { author: 'ai', bold: true } }, { insert: '\n' },
    { insert: { photo: { id: 'second', caption: '둘째 사진', alt: '두 번째' } } },
    { insert: { photo: { id: 'first', caption: '첫째 사진', alt: '첫 번째' } } }, { insert: '\n' }];
  const md = Markdown.fromV2(doc).document; md.photos = doc.photos;
  const manifest = Blog.pack(md);
  const copies = Object.fromEntries(doc.photos.map((p, i) => [p.id, { type: 'image/png', size: 40 + i, digest: String(i + 7).repeat(64), width: 4, height: 4 }]));
  const input = { p_post_id: POST, p_expected_revision: 7, p_expected_publication_revision: 1, p_operation_id: OP,
    p_photo_ids: options.photos ? ['first', 'second'] : [], p_author: { name: '검수 작성자', intro: '' }, p_copies: options.photos ? copies : {} };
  const prepared = { status: 'prepared', ownerId: OWNER, sessionId: SESSION, revision: 7, sourceHash: 'a'.repeat(64), document: manifest };
  const calls = [], projected = [];
  const fetcher = async (url, init) => {
    const call = { url, ...init, headers: { ...init.headers }, body: init.body ? JSON.parse(init.body) : null }; calls.push(call);
    if (options.fetcher) return options.fetcher(call, { calls, prepared, input });
    if (url.endsWith('/auth/v1/user')) return Response.json(options.user ?? { id: OWNER, role: 'authenticated', is_anonymous: false }, { status: options.authStatus ?? 200 });
    if (url.endsWith('/life_blog_markdown_publish_prepare')) return options.prepareResponse?.(call) || Response.json(options.prepare ?? prepared, { status: options.prepareStatus ?? 200 });
    if (url.endsWith('/life_blog_markdown_publish_commit')) return options.commitResponse?.(call) || Response.json(options.commit ?? RECEIPT, { status: options.commitStatus ?? 200 });
    throw new Error('unexpected fixture request');
  };
  const project = async (source, selection) => {
    projected.push({ source: structuredClone(source), selection: structuredClone(selection) });
    if (options.project) return options.project(source, selection);
    const ops = projectMarkdownOps(source, selection); options.afterProject?.(); return ops;
  };
  const environment = name => (options.environment || ENV)[name];
  const handler = createHandler({ fetcher, environment, project, ...(options.now ? { now: options.now } : {}),
    ...(options.origins ? { origins: options.origins } : {}) });
  const request = (value = input, extra = {}) => new Request(PROJECT + '/functions/v1/haedo-blog-publish', {
    method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', Origin: 'https://wonchance-art.github.io' },
    body: JSON.stringify(value), ...extra,
  });
  return { handler, request, input, manifest, prepared, calls, projected, copies };
}

test('authenticated stored Markdown is projected by the real shared codec and committed only through the service boundary', async () => {
  const f = await fixture({ photos: true }), before = structuredClone(f.manifest);
  const response = await f.handler(f.request());
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), RECEIPT);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://wonchance-art.github.io');
  assert.equal(f.calls.length, 4); assert.equal(f.projected.length, 1);
  for (const call of f.calls) { assert.equal(call.credentials, 'omit'); assert.equal(call.redirect, 'error'); assert(call.signal instanceof AbortSignal); }
  assert.deepEqual(f.calls[0].headers, { apikey: PUBLIC_KEY, Authorization: 'Bearer ' + TOKEN });
  assert.equal(f.calls[1].headers.apikey, PUBLIC_KEY); assert.equal(f.calls[1].headers.Authorization, 'Bearer ' + TOKEN);
  assert.deepEqual(f.calls[1].body, f.input);
  assert.equal(f.calls[2].url, PROJECT + '/auth/v1/user');
  assert.deepEqual(f.calls[2].headers, f.calls[0].headers);
  assert.deepEqual(f.calls.at(-1).headers, { apikey: SECRET, 'Content-Type': 'application/json' });
  const committed = f.calls.at(-1).body;
  assert.deepEqual({ ...committed, p_owner_id: undefined, p_session_id: undefined, p_source_hash: undefined, p_ops: undefined },
    { ...f.input, p_owner_id: undefined, p_session_id: undefined, p_source_hash: undefined, p_ops: undefined });
  assert.equal(committed.p_owner_id, OWNER); assert.equal(committed.p_session_id, SESSION); assert.equal(committed.p_source_hash, 'a'.repeat(64));
  assert.deepEqual(committed.p_ops.filter(op => typeof op.insert !== 'string').map(op => op.insert.photo), [
    { id: 'second', caption: '둘째 사진', alt: '두 번째' }, { id: 'first', caption: '첫째 사진', alt: '첫 번째' },
  ]);
  assert(!committed.p_ops.some(op => op.attributes?.author));
  assert(committed.p_ops.some(op => op.attributes?.bold));
  assert(!JSON.stringify(committed).includes('비공개 원본'));
  assert.equal(Object.hasOwn(committed, 'document'), false); assert.equal(Object.hasOwn(committed, 'markdown'), false);
  assert.deepEqual(f.projected[0].source, before); assert.deepEqual(f.manifest, before);
});

test('photo selection defaults to zero and no private photo or caption reaches commit', async () => {
  const f = await fixture(), response = await f.handler(f.request());
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls.at(-1).body.p_photo_ids, []); assert.deepEqual(f.calls.at(-1).body.p_copies, {});
  assert(f.calls.at(-1).body.p_ops.every(op => typeof op.insert === 'string'));
  assert(!JSON.stringify(f.calls.at(-1).body).includes('사진'));
});

test('strict intent input rejects client source, identity, unexpected fields, malformed IDs and copy metadata before Auth', async () => {
  const mutations = [
    x => x.document = {}, x => x.markdown = 'fake', x => x.p_ops = [], x => x.snapshot = {}, x => x.p_owner_id = OWNER, x => x.p_session_id = SESSION,
    x => x.p_source_hash = 'b'.repeat(64), x => x.p_post_id = [POST], x => x.p_operation_id = 'bad', x => x.p_expected_revision = 0,
    x => x.p_expected_publication_revision = Number.MAX_SAFE_INTEGER, x => x.p_author.email = 'private@example.invalid',
    x => x.p_author.name = '\ud800', x => x.p_photo_ids = ['first', 'first'], x => x.p_copies.extra = {},
    x => delete x.p_copies, x => { x.p_photo_ids = ['first']; }, x => x.p_photo_ids = Array(21).fill('first'),
  ];
  for (const mutate of mutations) {
    const f = await fixture(), input = structuredClone(f.input); mutate(input);
    const response = await f.handler(f.request(input));
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { code: 'invalid_request' }); assert.equal(f.calls.length, 0);
  }
  for (const mutate of [x => x.digest = ['f'.repeat(64)], x => x.type = 'image/heic', x => x.size = 0, x => x.width = Infinity, x => x.exif = 'secret']) {
    const f = await fixture({ photos: true }), input = structuredClone(f.input); mutate(input.p_copies.first);
    const response = await f.handler(f.request(input)); assert.equal(response.status, 400); assert.equal(f.calls.length, 0);
  }
});

test('API keys, anonymous/invalid users and Auth rejection never reach the database or projector', async () => {
  for (const credential of ['', 'Bearer sb_publishable_fixture', 'Bearer sb_secret_fixture', 'Bearer not-a-jwt', 'Bearer fixture.user.signature extra']) {
    const f = await fixture(), response = await f.handler(f.request(f.input, { headers: { Authorization: credential, 'Content-Type': 'application/json' } }));
    assert.equal(response.status, 401); assert.equal(f.calls.length, 0);
  }
  for (const options of [{ authStatus: 401 }, { user: { id: OWNER, role: 'authenticated', is_anonymous: true } },
    { user: { id: OWNER, role: 'service_role' } }, { user: { id: [OWNER], role: 'authenticated' } }]) {
    const f = await fixture(options), response = await f.handler(f.request());
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), { code: 'auth_required' });
    assert.equal(f.calls.length, 1); assert.equal(f.projected.length, 0);
  }
});

test('without gateway JWT verification the handler rejects missing, forged and expired tokens itself', async () => {
  const f = await fixture();
  const absent = await f.handler(f.request(f.input, { headers: { 'Content-Type': 'application/json' } }));
  assert.equal(absent.status, 401); assert.deepEqual(await absent.json(), { code: 'auth_required' }); assert.equal(f.calls.length, 0);
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  for (const [claims, authMessage] of [
    [{ sub: OWNER, role: 'authenticated', exp: 9999999999 }, 'invalid JWT signature'],
    [{ sub: OWNER, role: 'authenticated', exp: 1 }, 'JWT expired'],
  ]) {
    const supplied = encoded({ alg: 'HS256', typ: 'JWT' }) + '.' + encoded(claims) + '.tampered-signature';
    const bad = await fixture({ fetcher: call => {
      assert.equal(call.url, PROJECT + '/auth/v1/user');
      assert.equal(call.headers.Authorization, 'Bearer ' + supplied);
      return Response.json({ code: 'bad_jwt', message: authMessage + ': ' + supplied }, { status: 401 });
    } });
    const response = await bad.handler(bad.request(bad.input, { headers: { Authorization: 'Bearer ' + supplied, 'Content-Type': 'application/json' } }));
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), { code: 'auth_required' });
    assert.equal(bad.calls.length, 1); assert.equal(bad.projected.length, 0);
  }
});

test('Auth 429 and 5xx at either authentication point stay retryable and never dispatch service commit', async () => {
  for (const status of [429, 500, 502, 503]) for (const failingAuth of [1, 2]) {
    let authCalls = 0;
    const f = await fixture({ fetcher: (call, state) => {
      if (call.url.endsWith('/user')) {
        if (++authCalls === failingAuth) return Response.json({ message: 'upstream diagnostic ' + TOKEN + ' ' + SECRET }, { status });
        return Response.json({ id: OWNER, role: 'authenticated', is_anonymous: false });
      }
      assert(call.url.endsWith('_prepare'), 'service commit must not run after temporary Auth failure');
      return Response.json(state.prepared);
    } });
    const response = await f.handler(f.request());
    assert.equal(response.status, 502); assert.deepEqual(await response.json(), { code: 'network_error' });
    assert.equal(authCalls, failingAuth); assert.equal(f.projected.length, failingAuth - 1);
    assert.equal(f.calls.some(call => call.url.endsWith('_commit')), false);
    assert(f.calls.every(call => call.headers.apikey === PUBLIC_KEY));
  }
});

test('database owner/session and source revision are validated; editable user metadata never supplies identity', async () => {
  const f = await fixture({ user: { id: OWNER, role: 'authenticated', user_metadata: { ownerId: SESSION, sessionId: OWNER } } });
  assert.equal((await f.handler(f.request())).status, 200);
  assert.equal(f.calls.at(-1).body.p_owner_id, OWNER); assert.equal(f.calls.at(-1).body.p_session_id, SESSION);
  for (const mutate of [x => x.ownerId = SESSION, x => x.sessionId = null, x => x.sessionId = [SESSION], x => x.revision++,
    x => x.document.id = OP, x => x.sourceHash = 'bad', x => x.extra = 'private', x => x.document.format = 'life-post-md-v2',
    x => x.document.markdown = '![external](https://private.invalid/image.png)\n']) {
    const base = await fixture(), prepared = structuredClone(base.prepared); mutate(prepared);
    const bad = await fixture({ prepare: prepared }), response = await bad.handler(bad.request());
    assert.equal(response.status, 502); assert.deepEqual(await response.json(), { code: 'invalid_remote_data' }); assert.equal(bad.calls.length, 2);
  }
});

test('receipt replay returns only the committed receipt without rereading through the codec or committing twice', async () => {
  const f = await fixture({ prepare: RECEIPT, project: () => { throw new Error('must not project replay'); } });
  const response = await f.handler(f.request());
  assert.deepEqual(await response.json(), RECEIPT); assert.equal(f.calls.length, 2); assert.equal(f.projected.length, 0);
});

test('Auth is checked again after projection and revocation or changed identity prevents every service commit', async () => {
  for (const second of [new Response('{}', { status: 401 }), Response.json({ id: SESSION, role: 'authenticated' }),
    Response.json({ id: OWNER, role: 'authenticated', is_anonymous: true })]) {
    let authCalls = 0;
    const f = await fixture({ fetcher: (call, state) => {
      if (call.url.endsWith('/user')) return ++authCalls === 1 ? Response.json({ id: OWNER, role: 'authenticated' }) : second;
      if (call.url.endsWith('_prepare')) return Response.json(state.prepared);
      throw new Error('must not commit after the user was revoked or changed');
    } });
    const response = await f.handler(f.request());
    assert.deepEqual(await response.json(), { code: 'auth_required' });
    assert.equal(authCalls, 2); assert.equal(f.projected.length, 1);
    assert.equal(f.calls.some(call => call.url.endsWith('_commit')), false);
    assert(f.calls.every(call => call.headers.apikey === PUBLIC_KEY), 'no privileged request is dispatched');
  }
});

test('conflicts, missing source and SQL errors return only allowlisted client codes', async () => {
  for (const [prepare, expected] of [[{ status: 'missing' }, 'remote_missing'], [{ status: 'conflict', revision: 8 }, 'blog_conflict']]) {
    const f = await fixture({ prepare }), response = await f.handler(f.request());
    assert.deepEqual(await response.json(), { code: expected }); assert.equal(f.calls.length, 2);
  }
  for (const [code, message, status, expected] of [['22023', 'life_operation_mismatch', 400, 'operation_mismatch'],
    ['42501', 'life_blog_markdown_auth_required', 403, 'auth_required'], ['42501', 'unrelated private error', 403, 'permission_denied'],
    ['PGRST202', 'missing function', 404, 'schema_missing'], ['22023', 'life_blog_assets_incomplete', 400, 'invalid_request'],
    ['22023', 'life_blog_update_required', 400, 'blog_update_required'],
    ['22023', 'life_blog_markdown_publication_unavailable', 400, 'blog_publication_unavailable'],
    ['XX000', 'private source and ' + SECRET, 500, 'network_error']]) {
    const f = await fixture({ commit: { code, message, details: 'private source' }, commitStatus: status }), response = await f.handler(f.request());
    assert.deepEqual(await response.json(), { code: expected });
    if (expected === 'blog_update_required') assert.equal(response.status, 409);
    if (expected === 'blog_publication_unavailable') assert.equal(response.status, 503);
  }
  const f = await fixture({ commit: { ...RECEIPT, document: 'private' } });
  assert.deepEqual(await (await f.handler(f.request())).json(), { code: 'invalid_remote_data' });
});

test('new, legacy and mixed key environments keep caller JWT separate from service credentials', async () => {
  for (const [environment, expectedPublic, expectedServer] of [
    [ENV, PUBLIC_KEY, { apikey: SECRET }],
    [{ SUPABASE_URL: PROJECT, SUPABASE_ANON_KEY: 'legacy-anon', SUPABASE_SERVICE_ROLE_KEY: 'legacy-service' }, 'legacy-anon', { apikey: 'legacy-service', Authorization: 'Bearer legacy-service' }],
    [{ ...ENV, SUPABASE_ANON_KEY: 'legacy-anon', SUPABASE_SERVICE_ROLE_KEY: 'legacy-service' }, PUBLIC_KEY, { apikey: SECRET }],
  ]) {
    const f = await fixture({ environment }); assert.equal((await f.handler(f.request())).status, 200);
    assert.equal(f.calls[0].headers.apikey, expectedPublic); assert.equal(f.calls[1].headers.Authorization, 'Bearer ' + TOKEN);
    assert.deepEqual(f.calls.at(-1).headers, { ...expectedServer, 'Content-Type': 'application/json' });
  }
  for (const environment of [{ SUPABASE_URL: PROJECT }, { ...ENV, SUPABASE_URL: 'https://fixture.supabase.co/other' }]) {
    const f = await fixture({ environment }); assert.deepEqual(await (await f.handler(f.request())).json(), { code: 'schema_missing' }); assert.equal(f.calls.length, 0);
  }
});

test('origin, method, declared/streamed request bounds and upstream bounds fail without leaking private data', async () => {
  const { LIMITS } = await endpoint;
  const f = await fixture();
  const options = await f.handler(new Request(PROJECT, { method: 'OPTIONS', headers: { Origin: 'https://wonchance-art.github.io' } }));
  assert.equal(options.status, 204); assert.equal(f.calls.length, 0);
  const forbidden = await f.handler(f.request(f.input, { headers: { Origin: 'https://untrusted.invalid' } }));
  assert.equal(forbidden.status, 403); assert.equal(forbidden.headers.has('access-control-allow-origin'), false);
  assert.equal((await f.handler(new Request(PROJECT))).status, 405);
  for (const extra of [
    { headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', 'Content-Length': String(LIMITS.request + 1) } },
    { body: ' '.repeat(LIMITS.request + 1) }, { body: '{invalid JSON' }, { headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'text/plain' } },
  ]) assert.equal((await f.handler(f.request(f.input, extra))).status, 400);
  assert.equal(f.calls.length, 0);
  for (const endpointName of ['auth', 'prepare', 'commit']) {
    const bad = await fixture({ fetcher: (call, state) => {
      const here = call.url.endsWith('/user') ? 'auth' : call.url.endsWith('_prepare') ? 'prepare' : 'commit';
      if (here === endpointName) return new Response(' '.repeat(LIMITS[here === 'prepare' ? 'source' : here === 'auth' ? 'auth' : 'result'] + 1));
      return Response.json(here === 'auth' ? { id: OWNER, role: 'authenticated' } : state.prepared);
    } });
    const response = await bad.handler(bad.request());
    assert.deepEqual(await response.json(), { code: 'invalid_remote_data' });
  }
});

test('isolated harness origins are injectable without expanding or mutating the deployed product allowlist', async () => {
  const { ALLOWED_ORIGINS } = await endpoint;
  const original = ['https://wonchance-art.github.io', 'http://127.0.0.1:4173', 'http://localhost:4173'];
  assert.deepEqual(ALLOWED_ORIGINS, original);
  const ciOrigin = 'http://127.0.0.1:4184', headers = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', Origin: ciOrigin };
  const product = await fixture(), blocked = await product.handler(product.request(product.input, { headers }));
  assert.equal(blocked.status, 403); assert.equal(blocked.headers.has('access-control-allow-origin'), false); assert.equal(product.calls.length, 0);
  const origins = [ciOrigin], isolated = await fixture({ origins });
  origins.push('https://untrusted.invalid');
  const accepted = await isolated.handler(isolated.request(isolated.input, { headers }));
  assert.equal(accepted.status, 200); assert.equal(accepted.headers.get('access-control-allow-origin'), ciOrigin);
  assert.equal(isolated.calls.filter(call => call.url.endsWith('/user')).length, 2, 'injected origin never bypasses authentication');
  const excluded = await isolated.handler(isolated.request(isolated.input, { headers: { ...headers, Origin: 'https://untrusted.invalid' } }));
  assert.equal(excluded.status, 403); assert.equal(excluded.headers.has('access-control-allow-origin'), false);
  assert.deepEqual(ALLOWED_ORIGINS, original, 'test injection leaves product defaults unchanged');
});

test('abort or expired deadline after projection never dispatches commit', async () => {
  const controller = new AbortController();
  const aborted = await fixture({ afterProject: () => controller.abort() });
  const response = await aborted.handler(aborted.request(aborted.input, { signal: controller.signal }));
  assert.deepEqual(await response.json(), { code: 'request_cancelled' }); assert.equal(aborted.calls.length, 2);
  let time = 1000;
  const elapsed = await fixture({ now: () => time, afterProject: () => { time += 30001; } });
  assert.deepEqual(await (await elapsed.handler(elapsed.request())).json(), { code: 'network_error' }); assert.equal(elapsed.calls.length, 2);
});

test('oversized and aborted request streams are cancelled instead of keeping an unread body open', async () => {
  const { LIMITS } = await endpoint;
  let cancelled = false;
  const f = await fixture(), oversized = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(LIMITS.request + 1)); }, cancel() { cancelled = true; },
  });
  const tooLarge = await f.handler(f.request(f.input, { body: oversized, duplex: 'half' }));
  assert.equal(tooLarge.status, 400); assert.equal(cancelled, true); assert.equal(f.calls.length, 0);
  cancelled = false;
  const controller = new AbortController(), stalled = new ReadableStream({ cancel() { cancelled = true; } });
  const pending = f.handler(f.request(f.input, { body: stalled, duplex: 'half', signal: controller.signal }));
  controller.abort();
  assert.deepEqual(await (await pending).json(), { code: 'request_cancelled' });
  assert.equal(cancelled, true); assert.equal(f.calls.length, 0);
});

test('lost commit response retries the same intent and returns its database receipt without a second commit', async () => {
  let committed = false, commits = 0;
  const f = await fixture({ fetcher: (call, state) => {
    if (call.url.endsWith('/user')) return Response.json({ id: OWNER, role: 'authenticated' });
    if (call.url.endsWith('_prepare')) return Response.json(committed ? RECEIPT : state.prepared);
    commits++; committed = true; throw new Error('transport lost after atomic commit; ' + SECRET);
  } });
  assert.deepEqual(await (await f.handler(f.request())).json(), { code: 'network_error' });
  assert.deepEqual(await (await f.handler(f.request())).json(), RECEIPT);
  assert.equal(commits, 1);
  const intents = f.calls.filter(call => call.url.endsWith('_prepare')).map(call => call.body);
  assert.deepEqual(intents, [f.input, f.input]);
});

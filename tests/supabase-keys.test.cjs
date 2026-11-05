// Supabase API key matrix (2026-11-04): every Edge function works with only
// the new keys (SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS JSON), with
// only the legacy keys, and with both (new keys win). sb_secret_ keys are not
// JWTs and must never be sent as Authorization: Bearer. All values below are
// synthetic fixtures, not real keys.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const PROJECT = 'https://fixture.supabase.co';
const OWNER = '11111111-1111-4111-8111-111111111111';
const NEW = { secret: 'sb_secret_fixture_new_server', publishable: 'sb_publishable_fixture_new_public' };
const LEGACY = { service: 'legacy-service-fixture', anon: 'legacy-anon-fixture' };
const ENVIRONMENTS = {
  new: { SUPABASE_SECRET_KEYS: JSON.stringify({ default: NEW.secret }), SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: NEW.publishable }) },
  legacy: { SUPABASE_SERVICE_ROLE_KEY: LEGACY.service, SUPABASE_ANON_KEY: LEGACY.anon },
  both: { SUPABASE_SECRET_KEYS: JSON.stringify({ default: NEW.secret }), SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: NEW.publishable }),
    SUPABASE_SERVICE_ROLE_KEY: LEGACY.service, SUPABASE_ANON_KEY: LEGACY.anon },
};
const EXPECTED = {
  new: { server: { apikey: NEW.secret }, publicKey: NEW.publishable },
  legacy: { server: { apikey: LEGACY.service, Authorization: 'Bearer ' + LEGACY.service }, publicKey: LEGACY.anon },
  both: { server: { apikey: NEW.secret }, publicKey: NEW.publishable },
};
const credentials = headers => Object.fromEntries(Object.entries(headers).filter(([name]) => ['apikey', 'Authorization'].includes(name)));
const shared = import('../supabase/functions/_shared/supabase-keys.mjs');
const media = import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(fs.readFileSync(
  path.join(__dirname, '../supabase/functions/haedo-blog-media/index.ts'), 'utf8'))).toString('base64'));
const ai = import('../supabase/functions/haedo-ai/handler.mjs');
const naver = import('../supabase/functions/haedo-naver-blog/handler.mjs');
const discovery = import('../supabase/functions/haedo-discovery-private/handler.mjs');

test('shared key rules: new keys first, legacy fallback, never a public key as the server key', async () => {
  const { supabaseKeys, serverHeaders } = await shared;
  const { serverKey } = await media;
  for (const [name, env] of Object.entries(ENVIRONMENTS)) {
    const keys = supabaseKeys(key => env[key]);
    assert.deepEqual(serverHeaders(keys.server), EXPECTED[name].server, name);
    assert.equal(keys.publicKey, EXPECTED[name].publicKey, name);
    assert.equal(serverKey(key => env[key]), keys.server, 'blog-media inline copy agrees: ' + name);
  }
  const refused = [
    {},
    { SUPABASE_SECRET_KEYS: JSON.stringify({ default: NEW.publishable }) },
    { SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'same' }), SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'same' }) },
    { SUPABASE_SERVICE_ROLE_KEY: LEGACY.anon, SUPABASE_ANON_KEY: LEGACY.anon },
    { SUPABASE_SECRET_KEYS: '["sb_secret_fixture_array"]' },
    { SUPABASE_SECRET_KEYS: JSON.stringify({ other: NEW.secret }) },
  ];
  for (const env of refused) {
    assert.equal(supabaseKeys(key => env[key]).server, null, JSON.stringify(Object.keys(env)));
    assert.equal(serverKey(key => env[key]), null);
  }
  // A broken new-key value falls back to a valid legacy key instead of failing closed for every request.
  const broken = { SUPABASE_SECRET_KEYS: '{not json', SUPABASE_SERVICE_ROLE_KEY: LEGACY.service };
  assert.equal(supabaseKeys(key => broken[key]).server, LEGACY.service);
  assert.equal(serverKey(key => broken[key]), LEGACY.service);
});

test('haedo-blog-media reads published media with the server key in each key environment', async () => {
  const { createHandler } = await media;
  for (const [name, env] of Object.entries(ENVIRONMENTS)) {
    const calls = [];
    const fetcher = async (url, options) => { calls.push({ url, headers: options.headers }); return Response.json(null); };
    const handler = createHandler({ fetcher, environment: key => ({ SUPABASE_URL: PROJECT + '/', ...env })[key] });
    const result = await handler(new Request('https://edge.invalid/?token=' + OWNER + '&photo=' + OWNER));
    assert.equal(result.status, 404, name);
    assert.deepEqual(calls.map(c => c.url), [PROJECT + '/rest/v1/rpc/life_blog_public_media'], name);
    assert.deepEqual(credentials(calls[0].headers), EXPECTED[name].server, name);
  }
  const none = createHandler({ fetcher: async () => { throw new Error('no call without a server key'); },
    environment: key => ({ SUPABASE_URL: PROJECT, SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: NEW.publishable }) })[key] });
  assert.equal((await none(new Request('https://edge.invalid/?token=' + OWNER + '&photo=' + OWNER))).status, 503);
});

test('haedo-ai verifies the user with the publishable key and reserves with the server key in each key environment', async () => {
  const { createHandler } = await ai;
  for (const [name, env] of Object.entries(ENVIRONMENTS)) {
    const calls = [];
    const fetcher = async (url, options) => {
      calls.push({ url, headers: options.headers });
      if (url === PROJECT + '/auth/v1/user') return Response.json({ id: OWNER, role: 'authenticated' });
      if (url === PROJECT + '/rest/v1/rpc/life_ai_reserve') return Response.json({ status: 'limit' });
      throw new Error('unexpected fetch ' + url);
    };
    const handler = createHandler({ fetcher, log: () => {},
      environment: key => ({ SUPABASE_URL: PROJECT, ANTHROPIC_API_KEY: 'provider-fixture', HAEDO_AI_OWNER_ID: OWNER, ...env })[key] });
    const result = await handler(new Request('https://edge.invalid/', { method: 'POST',
      headers: { Authorization: 'Bearer eyJ1c2Vy.session-fixture.signature', apikey: EXPECTED[name].publicKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: '22222222-2222-4222-8222-222222222222', task: 'polish', selection: '합성 문장' }) }));
    assert.equal((await result.json()).error, 'ai_monthly_limit', name);
    assert.deepEqual(calls.map(c => c.url), [PROJECT + '/auth/v1/user', PROJECT + '/rest/v1/rpc/life_ai_reserve'], name);
    assert.deepEqual(calls[0].headers, { apikey: EXPECTED[name].publicKey, Authorization: 'Bearer eyJ1c2Vy.session-fixture.signature' }, name);
    assert.deepEqual(credentials(calls[1].headers), EXPECTED[name].server, name);
  }
  // An API key is never accepted as the user's session and is not forwarded to Auth.
  for (const presented of [NEW.secret, NEW.publishable]) {
    const handler = createHandler({ fetcher: async () => { throw new Error('no call for an API-key bearer'); }, log: () => {},
      environment: key => ({ SUPABASE_URL: PROJECT, ANTHROPIC_API_KEY: 'provider-fixture', HAEDO_AI_OWNER_ID: OWNER, ...ENVIRONMENTS.new })[key] });
    const result = await handler(new Request('https://edge.invalid/', { method: 'POST',
      headers: { Authorization: 'Bearer ' + presented, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: '22222222-2222-4222-8222-222222222222', task: 'polish', selection: '합성 문장' }) }));
    assert.equal((await result.json()).error, 'unauthorized');
  }
});

test('haedo-discovery-private authenticates and claims as the user; only finish uses server credentials in each key environment', async () => {
  const { createHandler } = await discovery;
  const input = { sourceId: 'frontiers-psychology', url: 'https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.1234567/full' };
  const lease = '22222222-2222-4222-8222-222222222222';
  const authorization = 'Bearer eyJ1c2Vy.session-fixture.signature';
  const content = { coverage: 'full_text', summary: 'Synthetic abstract', bodyText: 'Synthetic private body',
    rights: { mode: 'private_reading', label: 'Synthetic author', url: input.url },
    acquisition: { scope: 'private_account', method: 'publisher_xml', sourceUrl: input.url.replace('/full', '/xml'),
      fetchedAt: '2026-11-05T00:00:00.000Z', license: { label: 'Publisher terms', url: null } } };
  for (const [name, env] of Object.entries(ENVIRONMENTS)) {
    const calls = [], collected = [];
    const fetcher = async (url, options) => {
      calls.push({ url, headers: options.headers, body: options.body && JSON.parse(options.body) });
      if (url === PROJECT + '/auth/v1/user') return Response.json({ id: OWNER });
      if (url === PROJECT + '/rest/v1/rpc/life_discovery_article_claim') return Response.json({ status: 'claimed', leaseToken: lease });
      if (url === PROJECT + '/rest/v1/rpc/life_discovery_article_finish') return Response.json({ status: 'ready', ...input,
        content: JSON.parse(options.body).p_content, contentHash: 'a'.repeat(64), cached: false, stale: false });
      throw new Error('unexpected fetch ' + url);
    };
    const handler = createHandler({ fetcher, collect: async value => { collected.push(value); return content; },
      environment: key => ({ SUPABASE_URL: PROJECT, ...env })[key] });
    const result = await handler(new Request(PROJECT + '/functions/v1/haedo-discovery-private', { method: 'POST',
      headers: { Authorization: authorization, apikey: EXPECTED[name].publicKey, 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
    assert.equal(result.status, 200, name);
    assert.equal((await result.json()).status, 'ready', name);
    assert.deepEqual(collected, [input], name);
    assert.deepEqual(calls.map(c => c.url), [PROJECT + '/auth/v1/user', PROJECT + '/rest/v1/rpc/life_discovery_article_claim',
      PROJECT + '/rest/v1/rpc/life_discovery_article_finish'], name);
    for (const call of calls.slice(0, 2)) assert.deepEqual(credentials(call.headers), {
      apikey: EXPECTED[name].publicKey, Authorization: authorization }, name + ': Auth and claim retain the user session');
    assert.deepEqual(credentials(calls[2].headers), EXPECTED[name].server, name + ': server key is only used for finish');
    assert.equal(calls[2].body.p_owner_id, OWNER, name);
    assert.equal(calls[2].body.p_lease_token, lease, name);
  }
});

// A legacy service JWT with this project's claims (signature is not checked
// locally; the gateway decides). OTHER_SECRET is a second, non-default secret key.
const jwtPart = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const ROTATED_JWT = [jwtPart({ alg: 'HS256', typ: 'JWT' }), jwtPart({ role: 'service_role', ref: 'fixture', exp: Math.floor(Date.now() / 1000) + 3600 }), 'synthetic-signature'].join('.');
const OTHER_SECRET = 'sb_secret_fixture_second_key_abcdef';
// The gateway accepts these keys; anything else gets 401 at the remote check.
const GATEWAY = new Set([NEW.secret, LEGACY.service, ROTATED_JWT, OTHER_SECRET]);
function naverWorld(env, gateway = GATEWAY) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, headers: options.headers });
    if (url === PROJECT + '/auth/v1/user') return Response.json({ id: OWNER });
    if (url === PROJECT + '/rest/v1/rpc/life_naver_ready') {
      if (!gateway.has(options.headers.apikey)) return new Response('private gateway detail', { status: 401 });
      return Response.json(true);
    }
    throw new Error('unexpected fetch ' + url);
  };
  const handler = createNaver => createNaver({ fetcher, environment: key => ({ SUPABASE_URL: PROJECT, ...env })[key] });
  const request = (body, headers) => new Request(PROJECT + '/functions/v1/haedo-naver-blog', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { calls, handler, request };
}

test('haedo-naver-blog accepts its own server key in the apikey header without a remote check', async () => {
  const { createHandler } = await naver;
  for (const [name, env] of Object.entries(ENVIRONMENTS)) {
    const presented = name === 'legacy' ? LEGACY.service : NEW.secret;
    // New cron (operations/20261104-naver-cron-apikey.sql): apikey header only.
    const w = naverWorld(env), result = await w.handler(createHandler)(w.request({ action: 'readiness' }, { apikey: presented }));
    assert.equal(result.status, 200, name);
    assert.deepEqual(await result.json(), { ingestionEnabled: false, ready: true }, name);
    assert.deepEqual(w.calls.map(c => c.url), [PROJECT + '/rest/v1/rpc/life_naver_ready'], name);
    assert.deepEqual(credentials(w.calls[0].headers), EXPECTED[name].server, name);
  }
});

test('haedo-naver-blog verifies any other server key remotely with that key only', async () => {
  const { createHandler } = await naver;
  // Current cron (Bearer) and switched cron (apikey) with a legacy service JWT in Vault, and a second sb_secret_ key.
  for (const [env, headers, sent] of [
    [ENVIRONMENTS.legacy, { Authorization: 'Bearer ' + ROTATED_JWT }, { apikey: ROTATED_JWT, Authorization: 'Bearer ' + ROTATED_JWT }],
    [ENVIRONMENTS.both, { Authorization: 'Bearer ' + ROTATED_JWT }, { apikey: ROTATED_JWT, Authorization: 'Bearer ' + ROTATED_JWT }],
    [ENVIRONMENTS.new, { apikey: ROTATED_JWT }, { apikey: ROTATED_JWT, Authorization: 'Bearer ' + ROTATED_JWT }],
    [ENVIRONMENTS.both, { apikey: OTHER_SECRET }, { apikey: OTHER_SECRET }],
    // The retired legacy key is no longer this function's key in a new-key environment: it must prove itself too.
    [ENVIRONMENTS.both, { apikey: ROTATED_JWT, Authorization: 'Bearer eyJ1c2Vy.session-fixture.signature' }, { apikey: ROTATED_JWT, Authorization: 'Bearer ' + ROTATED_JWT }],
  ]) {
    const label = JSON.stringify(Object.keys(headers));
    const w = naverWorld(env), result = await w.handler(createHandler)(w.request({ action: 'readiness' }, headers));
    assert.equal(result.status, 200, label);
    assert.deepEqual(await result.json(), { ingestionEnabled: false, ready: true }, label);
    assert.equal(w.calls.length, 1, 'the remote check answers readiness itself: ' + label);
    assert.deepEqual(credentials(w.calls[0].headers), sent, 'only the presented credential is sent: ' + label);
    // A disabled or deleted key: the gateway refuses it and so does the function, after exactly one remote check.
    const off = naverWorld(env, new Set([NEW.secret, LEGACY.service]));
    const refused = await off.handler(createHandler)(off.request({ action: 'cron' }, headers));
    assert.equal(refused.status, 401, label); assert.deepEqual(await refused.json(), { error: 'unauthorized' });
    assert.deepEqual(off.calls.map(c => c.url), [PROJECT + '/rest/v1/rpc/life_naver_ready'], label);
  }
  // In the both environment the legacy key the runtime still holds is not accepted locally.
  const both = naverWorld(ENVIRONMENTS.both, new Set([NEW.secret]));
  const retired = await both.handler(createHandler)(both.request({ action: 'cron' }, { apikey: LEGACY.service }));
  assert.equal(retired.status, 401); assert.deepEqual(both.calls, [], 'a non-JWT legacy value is never even forwarded');
});

test('haedo-naver-blog refuses public keys and malformed server credentials without any call', async () => {
  const { createHandler } = await naver;
  for (const [env, headers] of [
    [ENVIRONMENTS.new, { apikey: NEW.publishable }],
    [ENVIRONMENTS.new, { apikey: 'sb_secret_short' }],
    [ENVIRONMENTS.new, { Authorization: 'Bearer ' + OTHER_SECRET }],
    [ENVIRONMENTS.new, { apikey: LEGACY.service }],
    [ENVIRONMENTS.new, { Authorization: 'Bearer ' + NEW.publishable }],
    [ENVIRONMENTS.legacy, { apikey: LEGACY.anon }],
    [ENVIRONMENTS.both, { apikey: LEGACY.anon, Authorization: 'Bearer ' + LEGACY.anon }],
  ]) {
    const w = naverWorld(env), result = await w.handler(createHandler)(w.request({ action: 'cron' }, headers));
    assert.equal(result.status, 401, JSON.stringify(headers));
    assert.deepEqual(await result.json(), { error: 'unauthorized' });
    assert.deepEqual(w.calls, []);
  }
});

test('haedo-naver-blog verifies a user with the publishable key in each key environment', async () => {
  const { createHandler } = await naver;
  for (const [name, env] of Object.entries(ENVIRONMENTS)) {
    const w = naverWorld(env);
    const result = await w.handler(createHandler)(w.request({ subscriptionId: OWNER },
      { Authorization: 'Bearer eyJ1c2Vy.session-fixture.signature', apikey: EXPECTED[name].publicKey }));
    // Ingestion is disabled in this fixture: the request stops after Auth, before any server-key call.
    assert.deepEqual(await result.json(), { error: 'setup_required' }, name);
    assert.deepEqual(w.calls.map(c => c.url), [PROJECT + '/auth/v1/user'], name);
    assert.deepEqual(w.calls[0].headers, { apikey: EXPECTED[name].publicKey, Authorization: 'Bearer eyJ1c2Vy.session-fixture.signature' }, name);
  }
  for (const headers of [{ apikey: NEW.publishable }, { Authorization: 'Bearer ' + NEW.secret }]) {
    const w = naverWorld(ENVIRONMENTS.new);
    const result = await w.handler(createHandler)(w.request({ subscriptionId: OWNER }, headers));
    assert.deepEqual(await result.json(), { error: 'unauthorized' });
    assert.deepEqual(w.calls, []);
  }
});

test('harvest storage calls never send an sb_secret_ key as a Bearer token', () => {
  const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/haedo-naver-blog/harvest-worker.mjs'), 'utf8');
  assert.doesNotMatch(source, /Authorization: 'Bearer ' \+ key/);
  assert.equal((source.match(/serverHeaders\(key\)/g) || []).length, 2);
});

test('a key with surrounding whitespace is treated as absent in both copies, never trimmed', async () => {
  const { supabaseKeys } = await shared;
  const { serverKey } = await media;
  for (const padded of [' ' + NEW.secret, NEW.secret + '\n', NEW.secret + ' ', '\t' + NEW.secret]) {
    const alone = { SUPABASE_SECRET_KEYS: JSON.stringify({ default: padded }) };
    assert.equal(supabaseKeys(key => alone[key]).server, null, JSON.stringify(padded));
    assert.equal(serverKey(key => alone[key]), null, JSON.stringify(padded));
    const withLegacy = { ...alone, SUPABASE_SERVICE_ROLE_KEY: LEGACY.service };
    assert.equal(supabaseKeys(key => withLegacy[key]).server, LEGACY.service);
    assert.equal(serverKey(key => withLegacy[key]), LEGACY.service);
    assert.equal(supabaseKeys(key => ({ SUPABASE_SERVICE_ROLE_KEY: padded })[key]).server, null);
  }
  const publics = { SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: NEW.publishable + '\n' }), SUPABASE_ANON_KEY: LEGACY.anon };
  assert.equal(supabaseKeys(key => publics[key]).publicKey, LEGACY.anon);
  assert.equal(supabaseKeys(key => ({ SUPABASE_ANON_KEY: ' ' + LEGACY.anon })[key]).publicKey, null);
});

test('without any public key the user path stops with setup_required: the server key never stands in for it', async () => {
  const { supabaseKeys } = await shared;
  const secretsOnly = { SUPABASE_SECRET_KEYS: JSON.stringify({ default: NEW.secret }), SUPABASE_SERVICE_ROLE_KEY: LEGACY.service };
  assert.equal(supabaseKeys(key => secretsOnly[key]).publicKey, null);
  const { createHandler: createAI } = await ai;
  const aiHandler = createAI({ fetcher: async () => { throw new Error('no call without a public key'); }, log: () => {},
    environment: key => ({ SUPABASE_URL: PROJECT, ANTHROPIC_API_KEY: 'provider-fixture', HAEDO_AI_OWNER_ID: OWNER, ...secretsOnly })[key] });
  const aiResult = await aiHandler(new Request('https://edge.invalid/', { method: 'POST',
    headers: { Authorization: 'Bearer eyJ1c2Vy.session-fixture.signature', 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: '22222222-2222-4222-8222-222222222222', task: 'polish', selection: '합성 문장' }) }));
  assert.deepEqual(await aiResult.json(), { error: 'setup_required' });
  const { createHandler } = await naver;
  const w = naverWorld(secretsOnly);
  const result = await w.handler(createHandler)(w.request({ subscriptionId: OWNER }, { Authorization: 'Bearer eyJ1c2Vy.session-fixture.signature' }));
  assert.deepEqual(await result.json(), { error: 'setup_required' });
  assert.deepEqual(w.calls, [], 'no Auth call is made with the server key');
});

test('haedo-naver-blog: its own sb_secret_ key is refused as a Bearer token; a legacy service JWT key still works as Bearer', async () => {
  const { createHandler } = await naver;
  for (const env of [ENVIRONMENTS.new, ENVIRONMENTS.both]) {
    const w = naverWorld(env), result = await w.handler(createHandler)(w.request({ action: 'cron' }, { Authorization: 'Bearer ' + NEW.secret }));
    assert.equal(result.status, 401); assert.deepEqual(await result.json(), { error: 'unauthorized' });
    assert.deepEqual(w.calls, []);
  }
  const w = naverWorld(ENVIRONMENTS.legacy), result = await w.handler(createHandler)(w.request({ action: 'readiness' }, { Authorization: 'Bearer ' + LEGACY.service }));
  assert.equal(result.status, 200);
  assert.deepEqual(credentials(w.calls[0].headers), EXPECTED.legacy.server, 'the legacy exact key as Bearer keeps the current cron working');
});

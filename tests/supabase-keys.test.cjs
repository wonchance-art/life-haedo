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

test('shared key rules: new keys first, legacy fallback, never a public key as the server key', async () => {
  const { supabaseKeys, serverHeaders } = await shared;
  const { serverKey } = await media;
  for (const [name, env] of Object.entries(ENVIRONMENTS)) {
    const keys = supabaseKeys(key => env[key]);
    assert.deepEqual(serverHeaders(keys.server), EXPECTED[name].server, name);
    assert.equal(keys.publicKey, EXPECTED[name].publicKey, name);
    assert.equal(serverKey(key => env[key]), keys.server, 'blog-media inline copy agrees: ' + name);
  }
  assert.deepEqual(supabaseKeys(key => ENVIRONMENTS.both[key]).servers, [NEW.secret, LEGACY.service]);
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
      headers: { Authorization: 'Bearer user-session-fixture', apikey: EXPECTED[name].publicKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: '22222222-2222-4222-8222-222222222222', task: 'polish', selection: '합성 문장' }) }));
    assert.equal((await result.json()).error, 'ai_monthly_limit', name);
    assert.deepEqual(calls.map(c => c.url), [PROJECT + '/auth/v1/user', PROJECT + '/rest/v1/rpc/life_ai_reserve'], name);
    assert.deepEqual(calls[0].headers, { apikey: EXPECTED[name].publicKey, Authorization: 'Bearer user-session-fixture' }, name);
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

function naverWorld(env) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, headers: options.headers });
    if (url === PROJECT + '/auth/v1/user') return Response.json({ id: OWNER });
    if (url === PROJECT + '/rest/v1/rpc/life_naver_ready') return Response.json(true);
    throw new Error('unexpected fetch ' + url);
  };
  const handler = createNaver => createNaver({ fetcher, environment: key => ({ SUPABASE_URL: PROJECT, ...env })[key] });
  const request = (body, headers) => new Request(PROJECT + '/functions/v1/haedo-naver-blog', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { calls, handler, request };
}

test('haedo-naver-blog accepts the server key in the apikey header and keeps legacy Bearer cron working', async () => {
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
  for (const name of ['legacy', 'both']) {
    // Current cron (operations/naver-collection-activation.sql): legacy service JWT as Bearer.
    const w = naverWorld(ENVIRONMENTS[name]);
    const result = await w.handler(createHandler)(w.request({ action: 'readiness' }, { Authorization: 'Bearer ' + LEGACY.service }));
    assert.equal(result.status, 200, name);
    assert.deepEqual(credentials(w.calls[0].headers), EXPECTED[name].server, name);
  }
  // A public key, an unknown secret or the retired legacy key alone never authorizes a service action.
  for (const [env, headers] of [
    [ENVIRONMENTS.new, { apikey: NEW.publishable }],
    [ENVIRONMENTS.new, { apikey: 'sb_secret_fixture_unknown' }],
    [ENVIRONMENTS.new, { apikey: LEGACY.service }],
    [ENVIRONMENTS.new, { Authorization: 'Bearer ' + NEW.publishable }],
    [ENVIRONMENTS.legacy, { apikey: LEGACY.anon }],
    [ENVIRONMENTS.both, { apikey: LEGACY.anon, Authorization: 'Bearer ' + LEGACY.anon }],
  ]) {
    const w = naverWorld(env), result = await w.handler(createHandler)(w.request({ action: 'cron' }, headers));
    assert.equal(result.status, 401, JSON.stringify(Object.keys(headers)));
    assert.deepEqual(await result.json(), { error: 'unauthorized' });
    assert.deepEqual(w.calls, []);
  }
});

test('haedo-naver-blog verifies a user with the publishable key in each key environment', async () => {
  const { createHandler } = await naver;
  for (const [name, env] of Object.entries(ENVIRONMENTS)) {
    const w = naverWorld(env);
    const result = await w.handler(createHandler)(w.request({ subscriptionId: OWNER },
      { Authorization: 'Bearer user-session-fixture', apikey: EXPECTED[name].publicKey }));
    // Ingestion is disabled in this fixture: the request stops after Auth, before any server-key call.
    assert.deepEqual(await result.json(), { error: 'setup_required' }, name);
    assert.deepEqual(w.calls.map(c => c.url), [PROJECT + '/auth/v1/user'], name);
    assert.deepEqual(w.calls[0].headers, { apikey: EXPECTED[name].publicKey, Authorization: 'Bearer user-session-fixture' }, name);
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

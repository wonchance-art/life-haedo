'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const A = '00000000-0000-4000-8000-000000000001', L = '00000000-0000-4000-8000-000000000002';
const input = { sourceId: 'frontiers-psychology', url: 'https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.1234567/full' };
const content = () => ({ coverage: 'full_text', summary: 'Synthetic abstract', bodyText: 'Synthetic private body',
  rights: { mode: 'private_reading', label: 'Synthetic author · Frontiers', url: input.url },
  acquisition: { scope: 'private_account', method: 'publisher_xml', sourceUrl: input.url.replace('/full','/xml'),
    fetchedAt: new Date().toISOString(), license: { label: 'Publisher terms', url: null } } });
const ready = (changes = {}) => ({ status: 'ready', ...input, content: content(), contentHash: 'a'.repeat(64), cached: true, stale: false, ...changes });
async function fixture(options = {}) {
  const { createHandler } = await import('../supabase/functions/haedo-discovery-private/handler.mjs');
  const calls = [], collected = [];
  const env = { SUPABASE_URL: 'https://synthetic.supabase.co', ...(options.environment || {
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service' }) };
  const handler = createHandler({ environment: key => env[key], collect: async (...args) => { collected.push(args);
    if (options.collectionError) throw Object.assign(new Error('PRIVATE upstream body or URL'), { code: options.collectionError }); return options.content || content(); },
    fetcher: async (url, init) => { calls.push({ url, init }); options.onFetch?.(url, init);
      if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify(options.user || { id: A }), { status: options.authStatus || 200 });
      if (url.endsWith('/life_discovery_article_claim')) return new Response(JSON.stringify(options.claim || { status: 'claimed', leaseToken: L }), { status: options.claimStatus || 200 });
      if (url.endsWith('/life_discovery_article_finish')) return Response.json(options.finish || ready({ cached: false, content: JSON.parse(init.body).p_content }));
      throw Error('Unexpected network'); } });
  const request = (value = input, token = 'user-jwt') => new Request('https://synthetic.supabase.co/functions/v1/haedo-discovery-private', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  return { handler, request, calls, collected };
}
test('private reader authenticates before claiming; only server-derived owner finishes and no secrets reach publisher', async () => {
  const f = await fixture(); const reply = await f.handler(f.request()); assert.equal(reply.status,200);
  assert.deepEqual(await reply.json(),ready({ cached: false, content: JSON.parse(f.calls[2].init.body).p_content }));
  assert.equal(f.calls.length,3); assert.equal(f.calls[1].init.headers.Authorization,'Bearer user-jwt');
  const finish = JSON.parse(f.calls[2].init.body); assert.equal(finish.p_owner_id,A); assert.equal(finish.p_lease_token,L);
  assert.equal(f.calls[2].init.headers.Authorization,'Bearer synthetic-service');
  assert.deepEqual(f.collected[0][0],input); assert(!('headers' in f.collected[0][1])); assert.equal(f.collected[0][1].signal.aborted,false);
  assert.equal(reply.headers.get('cache-control'),'private, no-store'); assert.equal(reply.headers.get('vary'),'Authorization');
});
test('cache hits still authenticate and return exact fetchedAt without acquiring again',async()=>{
  const value=ready(); const f=await fixture({claim:value}); const reply=await f.handler(f.request());
  assert.deepEqual(await reply.json(),value);assert.equal(f.calls.length,2);assert.equal(f.collected.length,0);
});
test('anonymous, deleted user, malformed or extra owner input never reach private cache or publisher',async()=>{
  for(const options of [{authStatus:401},{user:{id:A,is_anonymous:true}},{user:{id:'invalid'}}]){
    const f=await fixture(options),reply=await f.handler(f.request());assert.equal(reply.status,401);assert.equal(f.calls.length,1);assert.equal(f.collected.length,0);
  }
  for(const value of [{...input,ownerId:A},{...input,workspaceId:A},{...input,url:'https://127.0.0.1/private'},null]){
    const f=await fixture(),reply=await f.handler(f.request(value));assert.equal(reply.status,400);assert.equal(f.calls.length,0);
  }
  const f=await fixture();const reply=await f.handler(f.request(input,''));assert.equal(reply.status,401);assert.equal(f.calls.length,0);
});
test('cached content with a different article or malformed provenance never reaches browser',async()=>{
  for(const changed of [{sourceId:'llt-journal'},{url:input.url.replace('1234567','7654321')},{contentHash:'not-a-hash'},
    {content:{...content(),acquisition:{...content().acquisition,scope:'public'}}}]){
    const f=await fixture({claim:ready(changed)}),reply=await f.handler(f.request());assert.equal(reply.status,502);assert.deepEqual(await reply.json(),{error:'server_error'});assert.equal(f.collected.length,0);
  }
});
test('collection failures keep exact existing private content as stale and hide upstream failures',async()=>{
  const fallback=ready({stale:true});const f=await fixture({collectionError:'blocked',finish:fallback});
  const reply=await f.handler(f.request());assert.deepEqual(await reply.json(),fallback);
  const finish=JSON.parse(f.calls[2].init.body);assert.equal(finish.p_content,null);assert.equal(finish.p_error,'blocked');
});
test('busy, rate-limited and negative cache states cause no collection or finish',async()=>{
  for(const status of ['busy','rate_limited','unavailable']){const f=await fixture({claim:{status}}),r=await f.handler(f.request());assert.deepEqual(await r.json(),{status});assert.equal(f.collected.length,0);assert.equal(f.calls.length,2);}
});
test('expired session RPC rejects and absent installation reports setup without collection',async()=>{
  for(const [claimStatus,status,error] of [[403,401,'unauthorized'],[404,200,'setup_required']]){
    const f=await fixture({claimStatus}),r=await f.handler(f.request());assert.equal(r.status,status);assert.deepEqual(await r.json(),{error});assert.equal(f.collected.length,0);
  }
});
test('revoked or obsolete lease finish never returns the newly collected body',async()=>{
  const f=await fixture({finish:{status:'stale'}}),r=await f.handler(f.request());assert.deepEqual(await r.json(),{status:'unavailable'});
});
test('invalid collected snapshot is marked failed without writing malformed body',async()=>{
  const f=await fixture({content:{...content(),html:'<script>secret</script>'},finish:{status:'unavailable'}}),r=await f.handler(f.request());
  assert.deepEqual(await r.json(),{status:'unavailable'});const finish=JSON.parse(f.calls[2].init.body);assert.equal(finish.p_content,null);assert.equal(finish.p_error,'invalid_response');
});

// Keys are synthetic. A user JWT authenticates Auth and claim in every matrix
// cell; only finish uses a server key, and a new secret is never a Bearer token.
const KEY_ENVIRONMENTS = {
  new: { SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_new_fixture' }),
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_new_fixture' }) },
  legacy: { SUPABASE_ANON_KEY: 'legacy-anon-fixture', SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-fixture' },
  both: { SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_new_fixture' }),
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_new_fixture' }),
    SUPABASE_ANON_KEY: 'legacy-anon-fixture', SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-fixture' },
};
for (const [name, environment] of Object.entries(KEY_ENVIRONMENTS)) {
  test('private reader key matrix: ' + name + ' preserves user scope and server-only finish', async () => {
    const f = await fixture({ environment }), reply = await f.handler(f.request());
    assert.equal(reply.status, 200); assert.equal((await reply.json()).status, 'ready'); assert.equal(f.calls.length, 3);
    const publicKey = name === 'legacy' ? 'legacy-anon-fixture' : 'sb_publishable_new_fixture';
    const serverKey = name === 'legacy' ? 'legacy-service-fixture' : 'sb_secret_new_fixture';
    for (const call of f.calls.slice(0, 2)) {
      assert.equal(call.init.headers.apikey, publicKey);
      assert.equal(call.init.headers.Authorization, 'Bearer user-jwt');
      assert.equal(call.init.credentials, 'omit'); assert.equal(call.init.redirect, 'error');
    }
    assert.deepEqual(f.calls[2].init.headers, { apikey: serverKey,
      ...(name === 'legacy' ? { Authorization: 'Bearer ' + serverKey } : {}), 'Content-Type': 'application/json' });
    assert.equal(JSON.parse(f.calls[2].init.body).p_owner_id, A);
    assert(!JSON.stringify(f.collected).includes(serverKey));
  });
}
test('missing, malformed or public server credentials fail before Auth or article access', async () => {
  for (const environment of [
    {}, { SUPABASE_PUBLISHABLE_KEYS: KEY_ENVIRONMENTS.new.SUPABASE_PUBLISHABLE_KEYS },
    { ...KEY_ENVIRONMENTS.new, SUPABASE_SECRET_KEYS: '{broken' },
    { ...KEY_ENVIRONMENTS.new, SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_publishable_new_fixture' }) },
    { SUPABASE_ANON_KEY: 'same-fixture', SUPABASE_SERVICE_ROLE_KEY: 'same-fixture' },
    { ...KEY_ENVIRONMENTS.legacy, SUPABASE_SERVICE_ROLE_KEY: ' legacy-service-fixture ' },
    { ...KEY_ENVIRONMENTS.new, SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ other: 'sb_publishable_other_fixture' }) },
  ]) {
    const f = await fixture({ environment }), reply = await f.handler(f.request());
    assert.deepEqual(await reply.json(), { error: 'setup_required' });
    assert.equal(f.calls.length, 0); assert.equal(f.collected.length, 0);
  }
});
test('invalid new key configuration falls back to valid legacy credentials without changing the user JWT', async () => {
  const f = await fixture({ environment: { ...KEY_ENVIRONMENTS.legacy,
    SUPABASE_SECRET_KEYS: '{broken', SUPABASE_PUBLISHABLE_KEYS: '{broken' } });
  assert.equal((await (await f.handler(f.request())).json()).status, 'ready');
  assert.equal(f.calls[0].init.headers.apikey, 'legacy-anon-fixture');
  assert.equal(f.calls[1].init.headers.Authorization, 'Bearer user-jwt');
  assert.equal(f.calls[2].init.headers.Authorization, 'Bearer legacy-service-fixture');
});
test('request and cache response byte limits reject before collection or leaking response text', async () => {
  const f = await fixture();
  const oversized = new Request('https://synthetic.supabase.co/functions/v1/haedo-discovery-private', {
    method: 'POST', headers: { Authorization: 'Bearer user-jwt' }, body: JSON.stringify({ ...input, padding: 'p'.repeat(4097) }) });
  const reply = await f.handler(oversized); assert.equal(reply.status, 400);
  assert.deepEqual(await reply.json(), { error: 'invalid_request' }); assert.equal(f.calls.length, 0);
  const large = await fixture({ claim: ready({ content: { ...content(), bodyText: 'q'.repeat(3 * 1024 * 1024 + 1) } }) });
  const cacheReply = await large.handler(large.request()); assert.equal(cacheReply.status, 502);
  assert.deepEqual(await cacheReply.json(), { error: 'server_error' }); assert.equal(large.collected.length, 0);
});
test('one request deadline fences claim and finish; publisher receives its remaining bounded budget', async t => {
  const realNow = Date.now.bind(Date); let clock = realNow();
  t.mock.method(Date, 'now', () => clock);
  const exhausted = await fixture({ onFetch: () => { clock += 30001; } });
  const error = await exhausted.handler(exhausted.request());
  assert.equal(error.status, 502); assert.equal(exhausted.calls.length, 1); assert.equal(exhausted.collected.length, 0);
  clock = realNow(); const beginning = clock, normal = await fixture();
  assert.equal((await normal.handler(normal.request())).status, 200);
  assert.equal(normal.collected[0][1].deadline, beginning + 23000);
  assert(normal.calls.every(call => call.init.signal instanceof AbortSignal && !call.init.signal.aborted));
});
test('OPTIONS and invalid methods never authenticate or access a cache', async () => {
  const f = await fixture();
  const preflight = await f.handler(new Request('https://synthetic.supabase.co/functions/v1/haedo-discovery-private', { method: 'OPTIONS' }));
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('cache-control'), 'private, no-store');
  const method = await f.handler(new Request('https://synthetic.supabase.co/functions/v1/haedo-discovery-private'));
  assert.equal(method.status, 405); assert.equal(method.headers.get('cache-control'), 'private, no-store');
  assert.equal(f.calls.length, 0); assert.equal(f.collected.length, 0);
});

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
  const env = { SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service' };
  const handler = createHandler({ environment: key => env[key], collect: async (...args) => { collected.push(args);
    if (options.collectionError) throw Object.assign(new Error('PRIVATE upstream body or URL'), { code: options.collectionError }); return options.content || content(); },
    fetcher: async (url, init) => { calls.push({ url, init });
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

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dir = path.join(__dirname, '../supabase/functions/haedo-rss');
const modules = Promise.all([import('../supabase/functions/haedo-rss/feed.mjs'), import('../supabase/functions/haedo-rss/handler.mjs'), import('../supabase/functions/haedo-rss/vendor/fast-xml-parser.mjs')]);
const host = 'feed.fixture.invalid', url = 'https://' + host + '/rss';
const ids = { owner: '11111111-1111-4111-8111-111111111111', workspace: '22222222-2222-4222-8222-222222222222', connection: '33333333-3333-4333-8333-333333333333', lease: '44444444-4444-4444-8444-444444444444' };
const entry = (id='001', extra='') => `<item><guid>${id}</guid><title>한글 제목</title><link>https://${host}/post/${id}?exact=1&amp;x=2</link><description><![CDATA[<p>정확한 원문 &amp; 줄\n<img src="https://private.invalid/image" /></p>]]></description><pubDate>Thu, 05 Nov 2026 01:00:00 GMT</pubDate>${extra}</item>`;
const rss = (items=entry(), next='') => `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>fixture</title>${items}${next ? `<atom:link rel="next" href="${next}"/>` : ''}</channel></rss>`;
const json = v => new Response(JSON.stringify(v), {headers:{'Content-Type':'application/json'}});
const request = (body, headers={Authorization:'Bearer user-jwt'}) => new Request('https://edge.fixture.invalid/haedo-rss', {method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
async function parser() { const [f,,xml] = await modules; return f.createParser(xml); }
function fixture(options={}) {
  const calls=[]; const connection={id:ids.connection,workspace_id:ids.workspace,feed_url:url,status:options.status||'active',revision:1,baseline_at:'2026-11-04T01:00:00Z'};
  const state={connections:[connection],items:[],ready:true,has_more:false,next_cursor:null};
  const environment = name => ({SUPABASE_URL:'https://project.fixture.invalid',SUPABASE_SECRET_KEYS:JSON.stringify({default:'sb_secret_fixture_server'}),SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:'sb_publishable_fixture'})}[name]);
  const fetcher=async (endpoint,init={})=>{
    calls.push({endpoint,init});
    if(endpoint.endsWith('/auth/v1/user'))return options.authFailure?new Response('',{status:401}):json({id:ids.owner});
    if(endpoint.startsWith('https://'+host))return options.feedFailure?new Response('',{status:500}):new Response(rss());
    const name=endpoint.split('/').at(-1),args=JSON.parse(init.body||'{}');
    if(options.rpcError===name)return new Response(JSON.stringify({message:'rss_conflict'}),{status:409});
    if(name==='life_rss_list')return json(state);
    if(name==='life_rss_save')return json(connection);
    if(name==='life_rss_control'){connection.status=args.p_action==='pause'?'paused':args.p_action==='disconnect'?'disconnected':'active';connection.revision++;return json(connection);}
    if(name==='life_rss_due')return json([{connection_id:ids.connection,owner_id:ids.owner,workspace_id:ids.workspace}]);
    if(name==='life_rss_claim')return json(options.claimNull?null:{connection_id:ids.connection,owner_id:options.wrongOwner?'55555555-5555-4555-8555-555555555555':ids.owner,workspace_id:ids.workspace,feed_url:options.claimURL||url,revision:1,lease_token:ids.lease,cursor:null});
    if(name==='life_rss_finish'){state.items=args.p_items;connection.last_error=args.p_error;return json({status:args.p_error?'error':args.p_complete?'stored':'partial',inserted:args.p_items.length,held:0});}
    throw Error('Unexpected fake endpoint '+endpoint);
  };
  return {calls,environment,fetcher,state};
}
test('vendored parser is the same locked grammar in Node and Edge, no remote runtime import', async()=>{
  const raw=fs.readFileSync(path.join(dir,'vendor/fast-xml-parser.mjs'));
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),'438ed6e4997ab8a22fb76957c5a12b5956f95965d105cb0ac8cbc75bec627f55');
  assert.match(fs.readFileSync(path.join(dir,'index.ts'),'utf8'),/\.\/vendor\/fast-xml-parser\.mjs/);
  assert.doesNotMatch(raw.toString(),/\bfetch\(/);
});
test('RSS preserves opaque guid, exact decoded body/hash and URL parameters; never renders HTML', async()=>{
  const parse=await parser(),result=await parse(rss(),url),item=result.items[0];
  assert.equal(item.identity,'guid:001');assert.equal(item.published_at,'2026-11-05T01:00:00.000Z');
  assert.equal(item.content_text,'<p>정확한 원문 &amp; 줄\n<img src="https://private.invalid/image" /></p>');
  assert.equal(item.content_hash,crypto.createHash('sha256').update(item.content_text).digest('hex'));
  assert.equal(item.url,'https://'+host+'/post/001?exact=1&x=2');assert.equal(result.next,null);
});
test('Atom published is distinct from updated and XHTML is not silently reduced',async()=>{
  const parse=await parser();
  const atom='<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>urn:tag:0001</id><title>한글</title><link href="/one"/><content type="html">&lt;p&gt;본문&lt;/p&gt;</content><updated>2026-11-05T01:00:00Z</updated></entry><link rel="next" href="/page2"/></feed>';
  const result=await parse(atom,url);assert.equal(result.items[0].identity,'atom:urn:tag:0001');assert.equal(result.items[0].published_at,null);assert.equal(result.items[0].content_text,'<p>본문</p>');assert.equal(result.next,'https://'+host+'/page2');
  await assert.rejects(parse(atom.replace('type="html"','type="xhtml"'),url),{code:'invalid_feed'});
  await assert.rejects(parse(atom.replace('<entry>','<entry xml:base="https://feed.fixture.invalid/articles/">'),url),{code:'invalid_feed'});
  await assert.rejects(parse(atom.replace('<feed xmlns=','<feed xml:base="https://feed.fixture.invalid/articles/" xmlns='),url),{code:'invalid_feed'});
});
test('missing stable identity, missing link/content and malformed publication are held explicitly',async()=>{
  const parse=await parser();
  const missing=await parse(rss('<item><title>미상</title><description>본문</description></item>'),url);
  assert.equal(missing.items[0].hold_reason,'missing_identity');assert.match(missing.items[0].identity,/^unidentified:/);assert.equal(missing.items[0].url,null);
  const cases=[['<guid>x</guid>','missing_url'],['<guid>x</guid><link>https://example.invalid/x</link>','missing_content']];
  for(const [body,reason]of cases)assert.equal((await parse(rss('<item>'+body+'</item>'),url)).items[0].hold_reason,reason);
  const bad=await parse(rss(entry().replace('Thu, 05 Nov 2026 01:00:00 GMT','2026-11-05T01:00:00')),url);assert.equal(bad.items[0].hold_reason,'invalid_date');assert.equal(bad.items[0].published_at,null);
});
test('duplicate IDs with different content or link are all held; unchanged ID is stable across reads',async()=>{
  const parse=await parser();const result=await parse(rss(entry()+entry().replace('정확한','수정한')),url);
  assert.equal(result.items.length,2);assert.ok(result.items.every(x=>x.hold_reason==='identity_conflict'));
  assert.equal((await parse(rss(entry()),url)).items[0].identity,result.items[0].identity);
});
test('DTD/entity expansion, malformed XML, excessive depth and unsupported encoding fail closed',async()=>{
  const parse=await parser();
  for(const xml of ['<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+rss(),rss().replace('</channel>',''),'<a>'.repeat(40)+'</a>'.repeat(40),'<?xml version="1.0" encoding="iso-8859-1"?>'+rss(),rss('<item><guid>&evil;</guid></item>'),rss('<item><guid>&#0;</guid></item>'),rss('<item><guid>&#xD800;</guid></item>')])await assert.rejects(parse(xml,url),{code:'invalid_feed'});
});
test('per-feed 2MiB and 100 item budgets fail without truncation; >1MiB content held',async()=>{
  const parse=await parser();await assert.rejects(parse('x'.repeat(2*1024*1024+1),url),{code:'feed_too_large'});
  await assert.rejects(parse(rss(Array.from({length:101},(_,i)=>entry(String(i))).join('')),url),{code:'item_limit'});
  const large=rss('<item><guid>large</guid><link>https://example.invalid/x</link><description>'+ 'a'.repeat(1024*1024+1)+'</description></item>');
  const result=await parse(large,url);assert.equal(result.items[0].hold_reason,'content_too_large');assert.equal(result.items[0].content_text.length,1024*1024+1);
});
test('fixed allowlist rejects private/IP/credential/port/disguised targets before any fetch',async()=>{
  const [f]=await modules;assert.throws(()=>f.safeURL(url),{code:'blocked_url'});assert.equal(f.safeURL(url,[host]),url);
  for(const bad of ['http://'+host+'/rss','https://user@'+host+'/rss','https://'+host+':443/rss','https://'+host+'./rss','https://127.0.0.1/rss','https://2130706433/rss','https://[::1]/rss','https://localhost/rss','https://metadata.google.internal/rss','https://'+host+'/rss#x','https://'+host+'\\@other.invalid/rss'])assert.throws(()=>f.safeURL(bad,[host,'localhost','127.0.0.1','2130706433','metadata.google.internal']),{code:'blocked_url'});
});
test('collector follows at most two same-origin pages and returns durable cursor, with no credentials/media fetch',async()=>{
  const [f]=await modules,parse=await parser(),calls=[];
  const result=await f.collect({url,parse,allowedHosts:[host],fetcher:async(u,init)=>{calls.push({u,init});return new Response(rss(entry(String(calls.length)),'/page'+(calls.length+1)));}});
  assert.equal(calls.length,2);assert.equal(result.items.length,2);assert.equal(result.complete,false);assert.equal(result.cursor,'https://'+host+'/page3');
  assert.ok(calls.every(x=>x.init.redirect==='error'&&!x.init.headers.Authorization&&!x.init.headers.apikey));
});
test('second-page failure checkpoints successful page and failed cursor, never complete',async()=>{
  const [f]=await modules,parse=await parser();let count=0;
  const result=await f.collect({url,parse,allowedHosts:[host],fetcher:async()=>++count===1?new Response(rss(entry(),'/page2')):new Response('',{status:503})});
  assert.equal(result.items.length,1);assert.equal(result.complete,false);assert.equal(result.cursor,'https://'+host+'/page2');assert.equal(result.error,'network_error');
});
test('redirect responses, cross-origin pagination and unbounded streams do not succeed',async()=>{
  const [f]=await modules,parse=await parser();
  const redirected=new Response(rss());Object.defineProperty(redirected,'redirected',{value:true});
  await assert.rejects(f.collect({url,parse,allowedHosts:[host],fetcher:async()=>redirected}),{code:'blocked_url'});
  const cross=await f.collect({url,parse,allowedHosts:[host],fetcher:async()=>new Response(rss(entry(),'https://private.invalid/next'))});assert.equal(cross.complete,false);assert.equal(cross.error,'blocked_url');
  await assert.rejects(f.readBounded(new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(5));c.close();}})),4),{code:'feed_too_large'});
});
test('user poll validates Auth, then ownership, and server apikey is never sent as Bearer or to feed',async()=>{
  const [,h,xml]=await modules,fx=fixture();const handler=h.createHandler({...fx,...xml,allowedHosts:[host]});
  const res=await handler(request({action:'poll',workspaceId:ids.workspace,connectionId:ids.connection}));assert.equal(res.status,200);assert.equal((await res.json()).items.length,1);
  assert.ok(fx.calls[0].endpoint.endsWith('/auth/v1/user'));
  const service=fx.calls.filter(x=>/life_rss_(claim|finish)$/.test(x.endpoint));assert.equal(service.length,2);assert.ok(service.every(x=>x.init.headers.apikey==='sb_secret_fixture_server'&&!x.init.headers.Authorization));
  assert.equal(fx.calls.filter(x=>x.endpoint.startsWith('https://'+host)).length,1);
});
test('unauthenticated user and wrong owner claim cannot fetch feed or finish',async()=>{
  const [,h,xml]=await modules;
  for(const opts of [{authFailure:true},{wrongOwner:true}]){const fx=fixture(opts),handler=h.createHandler({...fx,...xml,allowedHosts:[host]});const res=await handler(request({action:'poll',workspaceId:ids.workspace,connectionId:ids.connection}));assert.ok(res.status>=400);assert.ok(!fx.calls.some(x=>x.endpoint.startsWith('https://'+host)));assert.ok(!fx.calls.some(x=>x.endpoint.endsWith('life_rss_finish')));}
});
test('list remains readable while real sources are disabled; user cannot inject allowlist/run/owner',async()=>{
  const [,h,xml]=await modules,fx=fixture(),handler=h.createHandler({...fx,...xml});
  assert.equal((await(await handler(request({action:'list',workspaceId:ids.workspace}))).json()).configured,false);
  for(const input of [{action:'list',workspaceId:ids.workspace,allowedHosts:[host]},{action:'poll',workspaceId:ids.workspace,connectionId:ids.connection,owner:ids.owner},{action:'run'}])assert.ok((await handler(request(input))).status>=400);
  assert.ok(!fx.calls.some(x=>x.endpoint.startsWith('https://'+host)));
});
test('feed failure is persisted and returned as connection error, while conflicts remain explicit',async()=>{
  const [,h,xml]=await modules,fx=fixture({feedFailure:true}),handler=h.createHandler({...fx,...xml,allowedHosts:[host]});
  const res=await handler(request({action:'poll',workspaceId:ids.workspace,connectionId:ids.connection}));assert.equal(res.status,200);assert.equal((await res.json()).connections[0].last_error,'network_error');
  const other=fixture({rpcError:'life_rss_control'}),control=h.createHandler({...other,...xml,allowedHosts:[host]});
  const conflict=await control(request({action:'pause',workspaceId:ids.workspace,connectionId:ids.connection,expectedRevision:1}));assert.equal((await conflict.json()).error,'rss_conflict');
});
test('service scheduler is bounded and accepts secret only as apikey, user JWT cannot dispatch',async()=>{
  const [,h,xml]=await modules,fx=fixture(),handler=h.createHandler({...fx,...xml,allowedHosts:[host]});
  assert.equal((await handler(request({action:'run'}))).status,401);
  assert.equal((await handler(request({action:'run'},{Authorization:'Bearer sb_secret_fixture_server'}))).status,401);
  const res=await handler(request({action:'run'},{apikey:'sb_secret_fixture_server'}));assert.equal(res.status,200);assert.equal((await res.json()).checked,1);
  assert.equal(JSON.parse(fx.calls.find(x=>x.endpoint.endsWith('life_rss_due')).init.body).p_limit,2);
});
test('pagination passes exact bounded cursor; paused and not-due polls never fetch',async()=>{
  const [,h,xml]=await modules,fx=fixture({claimNull:true}),handler=h.createHandler({...fx,...xml,allowedHosts:[host]});
  const before={fetched_at:'2026-11-05T01:00:00Z',id:ids.lease};
  await handler(request({action:'list',workspaceId:ids.workspace,before}));assert.deepEqual(JSON.parse(fx.calls.at(-1).init.body).p_before,before);
  assert.equal((await handler(request({action:'poll',workspaceId:ids.workspace,connectionId:ids.connection}))).status,200);assert.ok(!fx.calls.some(x=>x.endpoint.startsWith('https://'+host)));
  const paused=fixture({status:'paused'});assert.equal((await h.createHandler({...paused,...xml,allowedHosts:[host]})(request({action:'poll',workspaceId:ids.workspace,connectionId:ids.connection}))).status,400);
});
test('retry actually collects after revision-checked control instead of only rescheduling',async()=>{
  const [,h,xml]=await modules,fx=fixture(),handler=h.createHandler({...fx,...xml,allowedHosts:[host]});
  const res=await handler(request({action:'retry',workspaceId:ids.workspace,connectionId:ids.connection,expectedRevision:1}));
  assert.equal(res.status,200);assert.equal((await res.json()).items.length,1);
  const names=fx.calls.map(x=>x.endpoint.split('/').at(-1));assert.ok(names.indexOf('life_rss_control')<names.indexOf('life_rss_claim'));
  assert.equal(fx.calls.filter(x=>x.endpoint.startsWith('https://'+host)).length,1);
});

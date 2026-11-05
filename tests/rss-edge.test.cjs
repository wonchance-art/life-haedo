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
    if(options.rpcError===name)return new Response(JSON.stringify({message:options.rpcErrorCode||'rss_conflict'}),{status:options.rpcStatus||409});
    if(name==='life_rss_list')return json(state);
    if(name==='life_rss_save')return json(connection);
    if(name==='life_rss_control'){connection.status=args.p_action==='pause'?'paused':args.p_action==='disconnect'?'disconnected':'active';connection.revision++;return json(connection);}
    if(name==='life_rss_due')return json([{connection_id:ids.connection,owner_id:ids.owner,workspace_id:ids.workspace}]);
    if(name==='life_rss_known')return json([]);
    if(name==='life_rss_claim')return json(options.claimNull?null:{connection_id:ids.connection,owner_id:options.wrongOwner?'55555555-5555-4555-8555-555555555555':ids.owner,workspace_id:ids.workspace,status:connection.status,feed_url:options.claimURL||url,revision:1,lease_token:ids.lease,cursor:null,baseline_pages:options.scanPages||0,sweep_pages:options.scanPages||0});
    if(name==='life_rss_finish'){state.items=args.p_items;connection.last_error=args.p_error;return json({status:options.finishStatus||(args.p_error?'error':args.p_complete?'stored':'partial'),inserted:args.p_items.length,held:0});}
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
test('Atom absent published uses updated; invalid published never falls back and XHTML is held',async()=>{
  const parse=await parser();
  const atom='<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>urn:tag:0001</id><title>한글</title><link href="/one"/><content type="html">&lt;p&gt;본문&lt;/p&gt;</content><updated>2026-11-05T01:00:00Z</updated></entry><link rel="next" href="/page2"/></feed>';
  const result=await parse(atom,url);assert.equal(result.items[0].identity,'atom:urn:tag:0001');assert.equal(result.items[0].published_at,'2026-11-05T01:00:00.000Z');assert.equal(result.items[0].content_text,'<p>본문</p>');assert.equal(result.next,'https://'+host+'/page2');
  const invalid=await parse(atom.replace('<updated>','<published>invalid</published><updated>'),url);assert.equal(invalid.items[0].published_at,null);assert.equal(invalid.items[0].hold_reason,'invalid_date');
  const held=await parse(atom.replace('type="html"','type="xhtml"'),url);assert.equal(held.items[0].hold_reason,'unsupported_content');assert.equal(held.items[0].content_text,null);
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
  for(const xml of ['<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+rss(),'<!DOCTYPE rss>'+rss(),rss().replace('</channel>',''),'<a>'.repeat(40)+'</a>'.repeat(40),rss('<metadata>'+'<a>'.repeat(40)+'value'+'</a>'.repeat(40)+'</metadata>'),'<?xml version="1.0" encoding="iso-8859-1"?>'+rss(),rss('<item><guid>&evil;</guid></item>'),rss('<item><guid>&#0;</guid></item>'),rss('<item><guid>&#xD800;</guid></item>')])await assert.rejects(parse(xml,url),{code:'invalid_feed'});
  const entities=['<!ENTITY lol "lol">',...Array.from({length:9},(_,i)=>`<!ENTITY lol${i+1} "${('&lol'+(i||'')+';').repeat(10)}">`)];
  await assert.rejects(parse('<!DOCTYPE rss ['+entities.join('')+']>'+rss('<item><guid>x</guid><description>&lol9;</description></item>'),url),{code:'invalid_feed'});
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
  await assert.rejects(f.collect({url,parse,allowedHosts:[host],fetcher:async()=>new Response(rss(entry(),'https://private.invalid/next'))}),{code:'blocked_url'});
  await assert.rejects(f.readBounded(new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(5));c.close();}})),4),{code:'feed_too_large'});
});
test('user poll validates Auth, then ownership, and server apikey is never sent as Bearer or to feed',async()=>{
  const [,h,xml]=await modules,fx=fixture();const handler=h.createHandler({...fx,...xml,allowedHosts:[host]});
  const res=await handler(request({action:'poll',workspaceId:ids.workspace,connectionId:ids.connection}));assert.equal(res.status,200);assert.equal((await res.json()).items.length,1);
  assert.ok(fx.calls[0].endpoint.endsWith('/auth/v1/user'));
  const service=fx.calls.filter(x=>/life_rss_(claim|finish)$/.test(x.endpoint));assert.equal(service.length,2);assert.ok(service.every(x=>x.init.headers.apikey==='sb_secret_fixture_server'&&!x.init.headers.Authorization));
  const finish=JSON.parse(service.find(x=>x.endpoint.endsWith('life_rss_finish')).init.body);assert.deepEqual(finish.p_pages,[{url,identities:['guid:001'],next:null}]);
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
  const notDue=await handler(request({action:'poll',workspaceId:ids.workspace,connectionId:ids.connection}));assert.equal(notDue.status,200);assert.equal((await notDue.json()).execution.status,'not_due');assert.ok(!fx.calls.some(x=>x.endpoint.startsWith('https://'+host)));
  const paused=fixture({status:'paused'});assert.equal((await h.createHandler({...paused,...xml,allowedHosts:[host]})(request({action:'poll',workspaceId:ids.workspace,connectionId:ids.connection}))).status,400);
});
test('unsupported Atom content and ambiguous alternate links hold only those entries',async()=>{
  const parse=await parser();
  const good='<entry><id>good</id><link href="/good"/><content type="text">본문</content><published>2026-11-05T01:00:00Z</published></entry>';
  const bad=good.replace('<id>good</id>','<id>xhtml</id>').replace('<content type="text">본문</content>','<content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>본문</p></div></content>');
  const ambiguous=good.replace('<id>good</id>','<id>ambiguous</id>').replace('<link href="/good"/>','<link href="/one"/><link href="/two"/>');
  const {items}=await parse('<feed xmlns="http://www.w3.org/2005/Atom">'+bad+good+ambiguous+'</feed>',url);
  assert.equal(items.length,3);assert.equal(items[0].hold_reason,'unsupported_content');assert.equal(items[1].hold_reason,undefined);assert.equal(items[2].hold_reason,'ambiguous_links');assert.equal(items[2].url,null);
});
test('next cannot cross to a second allowed host',async()=>{
  const [f]=await modules,parse=await parser();const calls=[];
  await assert.rejects(f.collect({url,active:true,known:async()=>[],parse,allowedHosts:[host,'second.fixture.invalid'],fetcher:async(u)=>{calls.push(u);return new Response(rss(entry(),'https://second.fixture.invalid/next'));}}),{code:'blocked_url'});
  assert.deepEqual(calls,[url]);
});
test('active known-ID boundary stops pagination but still captures changed content; unidentified rows do not stop',async()=>{
  const [f]=await modules,parse=await parser(),calls=[];
  const result=await f.collect({url,active:true,cursor:'https://'+host+'/page19',known:async(ids)=>ids,parse,allowedHosts:[host],fetcher:async(u)=>{calls.push(u);return new Response(rss(entry().replace('정확한','수정한'),'/page2'));}});
  assert.equal(calls.length,1);assert.equal(result.complete,true);assert.equal(result.cursor,null);assert.match(result.items[0].content_text,/수정한/);
  let unidentifiedCalls=0;
  await f.collect({url,active:true,known:async(ids)=>ids,parse,allowedHosts:[host],fetcher:async()=>new Response(rss('<item><title>미상</title><description>본문</description></item>',++unidentifiedCalls===1?'/page2':''))});
  assert.equal(unidentifiedCalls,2);
});
test('all supported SQL errors preserve their meaning, including rss_not_found with HTTP403',async()=>{
  const [,h,xml]=await modules;
  for(const code of ['rss_retry_limit','rss_invalid_feed','rss_connection_exists','rss_not_found']){
    const fx=fixture({rpcError:'life_rss_control',rpcErrorCode:code,rpcStatus:code==='rss_not_found'?403:409});
    const res=await h.createHandler({...fx,...xml,allowedHosts:[host]})(request({action:'pause',workspaceId:ids.workspace,connectionId:ids.connection,expectedRevision:1}));
    assert.equal((await res.json()).error,code);
  }
  const fx=fixture({finishStatus:'stale'}),res=await h.createHandler({...fx,...xml,allowedHosts:[host]})(request({action:'poll',workspaceId:ids.workspace,connectionId:ids.connection}));assert.equal((await res.json()).execution.status,'stale');
});
test('caller cancellation stops collection but finish still uses an independent bounded signal',async()=>{
  const [,h,xml]=await modules,fx=fixture(),controller=new AbortController();let recorded=false;
  const fetcher=async(endpoint,init)=>{
    if(endpoint.startsWith('https://'+host)){controller.abort();assert.equal(init.signal.aborted,true);throw Error('caller disconnected');}
    if(endpoint.endsWith('life_rss_finish')){assert.equal(init.signal.aborted,false);assert.notEqual(init.signal,controller.signal);recorded=true;}
    return fx.fetcher(endpoint,init);
  };
  const req=new Request('https://edge.fixture.invalid/haedo-rss',{method:'POST',headers:{Authorization:'Bearer user-jwt','Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({action:'poll',workspaceId:ids.workspace,connectionId:ids.connection})});
  await h.createHandler({...fx,fetcher,...xml,allowedHosts:[host]})(req);assert.equal(recorded,true);
});
test('other-workspace connection status survives the actual Edge snapshot boundary',async()=>{
  const [,h,xml]=await modules,fx=fixture();
  const other={...fx.state.connections[0],workspace_id:'55555555-5555-4555-8555-555555555555'};
  fx.state.connections=[];fx.state.other_connections=[other];
  const result=await h.createHandler({...fx,...xml,allowedHosts:[host]})(request({action:'list',workspaceId:ids.workspace}));
  assert.equal(result.status,200);const data=await result.json();assert.deepEqual(data.other_connections,[other]);assert.deepEqual(data.connections,[]);
});
test('20-page baseline completes via scheduler alone and the next active run captures a new head item',async()=>{
  const [,h,xml]=await modules,fx=fixture(),seen=new Set(),calls=[];let status='pending',cursor=null,newHead=false,stored=[];
  const fetcher=async(endpoint,init)=>{
    if(endpoint.startsWith('https://'+host)){
      calls.push(endpoint);const page=endpoint===url?1:Number(new URL(endpoint).pathname.slice(5));
      return new Response(rss((newHead&&page===1?entry('fresh'): '')+entry('old'+page),page<20?'/page'+(page+1):''));
    }
    const name=endpoint.split('/').at(-1),args=JSON.parse(init.body||'{}');
    if(name==='life_rss_due')return json(status==='preview'?[]:[{connection_id:ids.connection,owner_id:ids.owner,workspace_id:ids.workspace}]);
    if(name==='life_rss_claim')return json({connection_id:ids.connection,owner_id:ids.owner,workspace_id:ids.workspace,feed_url:url,status,cursor,revision:1,lease_token:ids.lease});
    if(name==='life_rss_known')return json(args.p_identities.filter(id=>seen.has(id)));
    if(name==='life_rss_finish'){
      if(status==='active')stored.push(...args.p_items.filter(item=>!seen.has(item.identity)));
      for(const item of args.p_items)seen.add(item.identity);
      cursor=args.p_next_cursor;if(status==='pending'&&args.p_complete)status='preview';
      return json({status:args.p_complete?'stored':'partial',inserted:0,held:0});
    }
    return fx.fetcher(endpoint,init);
  };
  const handler=h.createHandler({...fx,fetcher,...xml,allowedHosts:[host]});
  for(let n=0;n<10;n++){const res=await handler(request({action:'run'},{apikey:'sb_secret_fixture_server'}));assert.equal(res.status,200);}
  assert.equal(status,'preview');assert.equal(seen.size,20);assert.equal(calls.length,20);
  status='active';cursor=null;newHead=true;calls.length=0;
  assert.equal((await handler(request({action:'run'},{apikey:'sb_secret_fixture_server'}))).status,200);
  assert.equal(calls[0],url);assert.equal(calls.length,2);assert.deepEqual(stored.map(x=>x.identity),['guid:fresh']);assert.equal(cursor,null);
});
test('retry actually collects after revision-checked control instead of only rescheduling',async()=>{
  const [,h,xml]=await modules,fx=fixture(),handler=h.createHandler({...fx,...xml,allowedHosts:[host]});
  const res=await handler(request({action:'retry',workspaceId:ids.workspace,connectionId:ids.connection,expectedRevision:1}));
  assert.equal(res.status,200);assert.equal((await res.json()).items.length,1);
  const names=fx.calls.map(x=>x.endpoint.split('/').at(-1));assert.ok(names.indexOf('life_rss_control')<names.indexOf('life_rss_claim'));
  assert.equal(fx.calls.filter(x=>x.endpoint.startsWith('https://'+host)).length,1);
});

// Independent in-memory model of durable observations, sweep cutoff and
// scheduler continuation. The PostgreSQL suite checks the actual RPC contract.
async function sweepScenario({pageSize,insertCount,insertPage=5}) {
  const [f]=await modules,parse=await parser(),old=Array.from({length:pageSize*3},(_,i)=>'old_'+i);
  let feed=[...Array.from({length:pageSize*3+5},(_,i)=>'new_'+i),...old];
  const expected=new Set(feed.filter(id=>id.startsWith('new_'))),stored=new Set(),observed=new Map(old.map(id=>['guid:'+id,0]));
  let cursor=null,cutoff=null,clock=1,pages=0,inserted=false,finished=false,maxCalls=0,maxItems=0,tailRuns=0;
  for(let run=0;run<180;run++) {
    if(!inserted&&cursor&&Number(new URL(cursor).pathname.slice(5))>=insertPage){
      const added=Array.from({length:insertCount},(_,i)=>'burst_'+i);feed=[...added,...feed];added.forEach(id=>expected.add(id));inserted=true;
    }
    if(cutoff===null){cutoff=clock++;pages=0;}
    const startedWithTail=!!cursor;let calls=0;
    const result=await f.collect({url,cursor,active:true,scanPages:pages,parse,allowedHosts:[host],
      known:async ids=>ids.filter(id=>observed.has(id)&&observed.get(id)<cutoff),
      fetcher:async target=>{calls++;const number=target===url?1:Number(new URL(target).pathname.slice(5));const start=(number-1)*pageSize;return new Response(rss(feed.slice(start,start+pageSize).map(id=>entry(id)).join(''),start+pageSize<feed.length?'/page'+(number+1):''));}});
    assert.equal(result.error,null,'finite newest-first sweep must not error');
    assert.ok(calls<=2);assert.ok(result.items.length<=100);assert.ok(result.pages.length<=2);
    maxCalls=Math.max(maxCalls,calls);maxItems=Math.max(maxItems,result.items.length);
    for(const item of result.items){if(!observed.has(item.identity))observed.set(item.identity,clock);const id=item.identity.slice(5);if(expected.has(id))stored.add(id);}
    clock++;pages+=result.pages.length;assert.ok(pages<=50);cursor=result.cursor;
    if(result.complete){cutoff=null;pages=0;if(!startedWithTail){finished=true;break;}}
    if(startedWithTail)tailRuns++;
  }
  assert.equal(inserted,true,'scenario must insert a burst while a tail exists');
  assert.equal(finished,true,'finite insertions must converge to idle');
  assert.deepEqual([...stored].sort(),[...expected].sort(),'no head, middle or tail identifiers are lost');
  assert.ok(tailRuns>0);return {maxCalls,maxItems,count:stored.size};
}
test('finite insertion matrix drains every gap despite 60+60/100+100 budgets and new head bursts',async()=>{
  for(const pageSize of [10,60,100])for(const insertCount of [25,250]){
    const result=await sweepScenario({pageSize,insertCount});assert.equal(result.count,pageSize*3+5+insertCount);
  }
});
test('cumulative 100-item budget preserves the entire unconsumed page without error',async()=>{
  const [f]=await modules,parse=await parser();
  for(const pageSize of [50,60,100]){
    const calls=[];const fetcher=async target=>{calls.push(target);const n=target===url?1:Number(new URL(target).pathname.slice(5));return new Response(rss(Array.from({length:pageSize},(_,i)=>entry('p'+n+'_'+i)).join(''),'/page'+(n+1)));};
    const first=await f.collect({url,parse,active:true,known:async()=>[],allowedHosts:[host],fetcher});
    assert.equal(first.error,null);assert.equal(first.complete,false);assert.equal(first.items.length,pageSize===50?100:pageSize);
    assert.equal(first.pages.length,pageSize===50?2:1);assert.equal(first.cursor,'https://'+host+'/page'+(pageSize===50?3:2));
    assert.equal(calls.length,pageSize===100?1:2);
    const second=await f.collect({url,cursor:first.cursor,scanPages:first.pages.length,parse,active:true,known:async()=>[],allowedHosts:[host],fetcher});
    assert.equal(second.error,null);assert.equal(second.items[0].identity,'guid:p'+(pageSize===50?3:2)+'_0');
  }
});
test('cumulative text budget is normal partial; single oversized page remains an explicit error',async()=>{
  const [f]=await modules,parse=await parser();const payload='a'.repeat(1200*1024),calls=[];
  const fetcher=async target=>{calls.push(target);const n=target===url?1:2;return new Response(rss('<item><guid>p'+n+'</guid><link>https://example.invalid/'+n+'</link><description>'+payload+'</description></item>',n===1?'/page2':''));};
  const first=await f.collect({url,parse,active:true,known:async()=>[],allowedHosts:[host],fetcher});
  assert.equal(first.error,null);assert.equal(first.pages.length,1);assert.equal(first.cursor,'https://'+host+'/page2');assert.equal(first.items[0].identity,'guid:p1');assert.equal(calls.length,2);
  const second=await f.collect({url,cursor:first.cursor,scanPages:1,parse,active:true,known:async()=>[],allowedHosts:[host],fetcher});assert.equal(second.complete,true);assert.equal(second.items[0].identity,'guid:p2');
  await assert.rejects(f.collect({url,parse,allowedHosts:[host],fetcher:async()=>new Response('a'.repeat(2*1024*1024+1))}),{code:'feed_too_large'});
});
test('pending cycles across executions and endless empty pages stop without losing accepted progress',async()=>{
  const [f]=await modules,parse=await parser(),seen=new Set();let cursor=null,pages=0,totalCalls=0,terminal;
  for(let run=0;run<4;run++){
    const result=await f.collect({url,cursor,scanPages:pages,parse,known:async ids=>ids.filter(id=>seen.has(id)),allowedHosts:[host],fetcher:async target=>{
      totalCalls++;const n=target===url?0:Number(new URL(target).pathname.slice(5));return new Response(rss(entry('cycle'+n),n===2?'/rss':'/page'+(n+1)));}});
    result.items.forEach(item=>seen.add(item.identity));pages+=result.pages.length;cursor=result.cursor;
    if(result.error){terminal=result;break;}
  }
  assert.equal(terminal?.error,'baseline_stalled');assert.ok(totalCalls<=4);assert.equal(seen.size,3);assert.equal(pages,3);
  let emptyCalls=0;const empty=await f.collect({url,parse,known:async()=>[],allowedHosts:[host],fetcher:async()=>{emptyCalls++;return new Response(rss('','/next'));}});
  assert.equal(empty.error,'baseline_stalled');assert.equal(empty.pages.length,0);assert.equal(emptyCalls,1);
});
test('50 accepted pages bound baseline and active sweeps; exactly page50 EOF is allowed',async()=>{
  const [f]=await modules,parse=await parser();
  for(const active of [false,true]){
    let cursor=null,pages=0,calls=0,terminal;const seen=new Set();
    for(let run=0;run<26;run++){
      const result=await f.collect({url,cursor,active,scanPages:pages,parse,known:async ids=>active?[]:ids.filter(id=>seen.has(id)),allowedHosts:[host],fetcher:async target=>{
        calls++;const n=target===url?1:Number(new URL(target).pathname.slice(5));return new Response(rss(entry('limit'+n),'/page'+(n+1)));}});
      result.items.forEach(item=>seen.add(item.identity));pages+=result.pages.length;cursor=result.cursor;
      if(result.error){terminal=result;break;}
    }
    assert.equal(terminal?.error,active?'catchup_page_limit':'baseline_page_limit');assert.equal(pages,50);assert.equal(calls,50);
    let capCalls=0;const capped=await f.collect({url,cursor,active,scanPages:50,parse,allowedHosts:[host],fetcher:async()=>{capCalls++;throw Error('must not fetch');}});assert.equal(capCalls,0);assert.equal(capped.error,terminal.error);
    const exact=await f.collect({url,cursor:'https://'+host+'/page50',active,scanPages:49,known:async()=>[],parse,allowedHosts:[host],fetcher:async()=>new Response(rss(entry('last')))});assert.equal(exact.error,null);assert.equal(exact.complete,true);assert.equal(exact.pages.length,1);
  }
});
test('handler honors durable page cap before feed requests and records its stop reason',async()=>{
  const [,h,xml]=await modules;
  for(const status of ['pending','active']){
    const fx=fixture({status,scanPages:50}),handler=h.createHandler({...fx,...xml,allowedHosts:[host]});
    const result=await handler(request({action:status==='pending'?'preview':'poll',workspaceId:ids.workspace,connectionId:ids.connection}));
    assert.equal(result.status,200);assert.equal((await result.json()).execution.error,status==='pending'?'baseline_page_limit':'catchup_page_limit');
    assert.equal(fx.calls.filter(x=>x.endpoint.startsWith('https://'+host)).length,0);
    const finish=JSON.parse(fx.calls.find(x=>x.endpoint.endsWith('life_rss_finish')).init.body);assert.deepEqual(finish.p_pages,[]);assert.equal(finish.p_complete,false);
  }
});

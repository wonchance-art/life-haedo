const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { deflateSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const fixtureRequire = createRequire(require('node:path').join(__dirname, 'fixtures/naver-extractor/package.json'));
const { load } = fixtureRequire('cheerio/slim');
const modules = Promise.all([import('../supabase/functions/haedo-naver-blog/extractor.mjs'),
  import('../supabase/functions/haedo-naver-blog/harvest-network.mjs'), import('../supabase/functions/haedo-naver-blog/harvest-worker.mjs'),
  import('../supabase/functions/haedo-naver-blog/handler.mjs')]);
const ids = { owner: '11111111-1111-4111-8111-111111111111', sub: '22222222-2222-4222-8222-222222222222',
  job: '33333333-3333-4333-8333-333333333333', lease: '44444444-4444-4444-8444-444444444444', other: '55555555-5555-4555-8555-555555555555' };
const BLOG = 'Case_blog', LOG = '123';
function crc32(bytes) { let n = -1; for (const byte of bytes) { n ^= byte; for (let i = 0; i < 8; i++) n = n >>> 1 ^ (n & 1 ? 0xedb88320 : 0); } return (n ^ -1) >>> 0; }
function png(width = 4032, height = 3024) {
  const chunk = (type, bytes) => { const name = Buffer.from(type), n = Buffer.alloc(4), crc = Buffer.alloc(4); n.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes]))); return Buffer.concat([n,name,bytes,crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height,4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.alloc((width*4+1)*height))),chunk('IEND',Buffer.alloc(0))]);
}
function html(count = 0) { return '<html><meta property="article:published_time" content="2026-10-21T12:00:00Z"><h1 class="se-title-text">합성 제목</h1><div data-post-editor-version="4" class="se-main-container"><div class="se-component se-text"><p>첫 문단 😀</p><p>첫 문단 😀</p><script>secret()</script></div>' + Array.from({length:count},(_,i)=>'<div class="se-component se-image"><img src="https://blogfiles.pstatic.net/image'+i+'.png" alt="사진 '+i+'"></div>').join('') + '</div></html>'; }
function fixture(options = {}) {
  const calls = [], rpcCalls = [], uploads = [], bytes = options.bytes || png(4032,3024);
  let progress = options.progress || null;
  const claim = () => ({ job_id: ids.job, owner_id: ids.owner, subscription_id: ids.sub, blog_id: BLOG, log_no: LOG,
    revision: 1, lease_token: ids.lease, lease_until: new Date(Date.now()+120000).toISOString(), progress, ...options.claim });
  const rpc = async (name,args) => {
    rpcCalls.push({name,args:structuredClone(args)});
    if (name === 'life_naver_capture_claim') return options.inventory ? [] : [claim()];
    if (name === 'life_naver_inventory_claim') return [{...claim(),page:1,page_size:30}];
    if (name === 'life_naver_capture_checkpoint') { progress=structuredClone(args.p_progress); return {status:'pending'}; }
    if (name === 'life_naver_capture_finish') { if (options.loseFinish) throw new Error('lost ACK'); return {status: options.stale ? 'stale' : 'stored'}; }
    if (name === 'life_naver_inventory_finish') return {status:'stored'};
    throw new Error('unexpected RPC');
  };
  const fetcher = async (raw,init={}) => {
    calls.push({url:raw,init}); const u = new URL(raw);
    if (u.pathname === '/robots.txt') return new Response(options.robots || 'User-agent: *\nAllow: /');
    if (u.hostname === 'blog.naver.com') {
      if (u.pathname === '/PostTitleListAsync.naver') return Response.json(options.list || {totalCount:'1',countPerPage:'30',postList:[{logNo:LOG,title:encodeURIComponent('합성 제목')}]});
      return new Response(options.html || html(options.images ?? 3));
    }
    if (u.hostname.endsWith('.pstatic.net')) return new Response(bytes, {headers:{'Content-Type':options.mime || 'image/png','Content-Length':String(bytes.length)}});
    if (u.hostname === 'fixture.supabase.co') {
      if (init.method === 'POST') { uploads.push({url:raw,bytes:new Uint8Array(init.body),headers:init.headers}); return new Response(null,{status:options.collision === true ? 409 : options.collision || 200}); }
      return new Response(options.corruptExisting ? new Uint8Array([1,2]) : bytes,{headers:{'Content-Type':'image/png'}});
    }
    throw new Error('unexpected network URL');
  };
  const worker = async () => {
    const [, ,{createHarvestWorker}] = await modules;
    const model = require('../assets/life/naver-capture.js');
    return createHarvestWorker({rpc,fetcher,load,model,origin:'https://fixture.supabase.co',key:'synthetic-private',deadline:Date.now()+80000});
  };
  return {calls,rpcCalls,uploads,bytes,worker,rpc,fetcher,progress:()=>progress};
}
test('upstream-derived selector order handles ONE, early 3 and legacy; missing body never becomes OG full text',async()=>{
  const [{extractHTML}] = await modules;
  const one=await extractHTML(html(),{load,blogId:BLOG,logNo:LOG});
  assert.equal(one.coverage,'partial');assert.equal(one.content_text.match(/첫 문단/g).length,2);assert.equal(one.content_text.includes('secret'),false);
  const early=await extractHTML('<h1 class="se_title">초기</h1><div data-post-editor-version="3"></div><div class="se_doc_contents_start"></div><div class="__se_component_area"><p>초기 본문</p></div>',{load,blogId:BLOG,logNo:LOG});
  assert.equal(early.content_text,'초기 본문');
  const legacy=await extractHTML('<div class="post"><h3 class="htitle">옛 제목</h3><div id="postViewArea"><p>옛 본문</p></div></div>',{load,blogId:BLOG,logNo:LOG});
  assert.equal(legacy.content_text,'옛 본문');
  await assert.rejects(extractHTML('<meta property="og:description" content="요약"><h1 class="se-title-text">제목</h1>',{load,blogId:BLOG,logNo:LOG}),{code:'body_unavailable'});
});
test('summary marker, unsupported blocks and blocked photos produce explicit omissions without extra requests',async()=>{
  const [{extractHTML}] = await modules;
  const result=await extractHTML(html(1).replace('</html>','<div class="_getSummaryContent"></div></html>').replace('</div></html>','<div class="se-component se-video">영상</div></div></html>')+'<img src="http://evil.invalid/x">',{load,blogId:BLOG,logNo:LOG});
  assert.equal(result.summary_required,true);assert.ok(result.omissions.some(v=>v.includes('접힌')));assert.equal(result.images.length,1);
  assert.equal(result.images[0].url,'https://blogfiles.pstatic.net/image0.png');
  const blank=await extractHTML('<h1 class="se-title-text">제목</h1><div class="se-main-container"></div>',{load,blogId:BLOG,logNo:LOG});
  assert.equal(blank.coverage,'link_only');assert.equal(blank.content_hash,null);
});
test('inventory validates exact page counts/identities and never returns regex-extracted partial success',async()=>{
  const [{parseInventory}]=await modules;
  const raw=JSON.stringify({totalCount:'1',countPerPage:'30',postList:[{logNo:LOG,title:'%ED%95%9C%EA%B8%80+%F0%9F%98%80'}]});
  assert.equal(parseInventory(raw,{blogId:BLOG}).entries[0].title,'한글 😀');
  assert.equal(parseInventory(raw,{blogId:BLOG}).has_more,false);
  assert.equal(parseInventory('\uFEFF'+raw,{blogId:BLOG}).entries[0].log_no,LOG);
  for(const invalid of [raw.replace('"totalCount":"1"','"totalCount":"2"'),raw.slice(0,-1),raw.replace('"123"','"00123"'),raw.replace('%ED%95%9C','%bad%')])assert.throws(()=>parseInventory(invalid,{blogId:BLOG}));
  assert.throws(()=>parseInventory(JSON.stringify({totalCount:30,postList:[]}),{blogId:BLOG}),{code:'incomplete_inventory'});
});
test('network rejects host suffixes, credentials, HTTP, redirects and non-approved endpoint URLs',async()=>{
  const [{imageURL}, {safeResource,createNetwork}]=await modules;
  for(const url of ['http://blogfiles.pstatic.net/x','https://blogfiles.pstatic.net.evil.invalid/x','https://127.0.0.1/x','https://user@blogfiles.pstatic.net/x'])assert.throws(()=>imageURL(url));
  for(const url of ['https://blog.naver.com/private','https://blog.naver.com/PostView.naver?blogId=x&logNo=1&target=http://127.0.0.1'])assert.throws(()=>safeResource(url,'html'));
  const calls=[];const network=createNetwork({fetcher:async url=>{calls.push(url);return new Response(null,{status:302,headers:{Location:'https://evil.invalid'}});}});
  await assert.rejects(network.resource('https://blog.naver.com/PostView.naver?blogId=x&logNo=1','html',100));assert.equal(calls.length,1);
});
test('CDN robots decision is checked for each image path, not reused as an origin-wide allow',async()=>{
  const [, {createNetwork}]=await modules;const calls=[];
  const n=createNetwork({fetcher:async url=>{calls.push(url);return new Response(url.endsWith('robots.txt')?'User-agent: *\nAllow: /one\nDisallow: /two':'x');}});
  await n.resource('https://blogfiles.pstatic.net/one.png','image',100);
  await assert.rejects(n.resource('https://blogfiles.pstatic.net/two.png','image',100),{code:'blocked'});
  assert.equal(calls.filter(v=>v.endsWith('robots.txt')).length,1);assert.equal(calls.some(v=>v.endsWith('two.png')),false);
});
test('4032×3024 PNG bytes produce exact metadata; malformed, wrong MIME and oversize are rejected',async()=>{
  const [, {imageMetadata,MEDIA_MAX_BYTES}]=await modules;const bytes=png();
  assert.deepEqual(imageMetadata(bytes,'image/png'),{mimeType:'image/png',width:4032,height:3024,bytes:bytes.length});
  assert.throws(()=>imageMetadata(bytes,'image/jpeg'));assert.throws(()=>imageMetadata(bytes.subarray(0,bytes.length-4),'image/png'));
  assert.throws(()=>imageMetadata(new Uint8Array(MEDIA_MAX_BYTES+1),'image/png'));
});
test('capture checkpoints after two photos and resumes same exact body/photos without refetching HTML',async()=>{
  const original='\uFEFF'+html(3).replace('<p>','\r\n<p>');
  const f=fixture({html:original});let w=await f.worker();assert.deepEqual(await w.execute({action:'capture',owner:ids.owner,subscriptionId:ids.sub,jobId:ids.job}),{status:'checked',stage:'capture',pending:true});
  assert.equal(f.progress().nextImage,2);const firstHash=f.progress().payload.bodyHash;
  assert.equal(f.uploads.length,2);for(const upload of f.uploads){assert.deepEqual(upload.bytes,new Uint8Array(f.bytes));assert.equal(upload.headers['x-upsert'],'false');assert.ok(upload.url.includes('/'+ids.owner+'/naver/'+BLOG+'/'+LOG+'/'));}
  const htmlCount=f.calls.filter(v=>v.url.includes('PostView.naver')).length;
  w=await f.worker();assert.equal((await w.execute({action:'capture',owner:ids.owner,jobId:ids.job})).pending,false);
  assert.equal(f.calls.filter(v=>v.url.includes('PostView.naver')).length,htmlCount);
  const finish=f.rpcCalls.find(v=>v.name==='life_naver_capture_finish');assert.equal(finish.args.p_payload.photos.length,3);assert.equal(finish.args.p_payload.bodyHash,firstHash);
  assert.equal(finish.args.p_payload.htmlHash,createHash('sha256').update(original).digest('hex'));
  for(const photo of finish.args.p_payload.photos){assert.equal(photo.originalStatus,'unverified');assert.equal(photo.width,4032);assert.equal(photo.height,3024);}
});
test('409 uploads reuse only exact same authenticated bytes; mismatch never overwrites object',async()=>{
  const f=fixture({collision:true,images:1});assert.equal((await (await f.worker()).execute({action:'capture',owner:ids.owner,jobId:ids.job})).pending,false);
  assert.equal(f.rpcCalls.find(v=>v.name==='life_naver_capture_finish').args.p_payload.photos[0].status,'stored');
  const duplicate400=fixture({collision:400,images:1});await(await duplicate400.worker()).execute({action:'capture',owner:ids.owner,jobId:ids.job});
  assert.equal(duplicate400.rpcCalls.find(v=>v.name==='life_naver_capture_finish').args.p_payload.photos[0].status,'stored');
  const bad=fixture({collision:true,corruptExisting:true,images:1});await(await bad.worker()).execute({action:'capture',owner:ids.owner,jobId:ids.job});
  assert.equal(bad.rpcCalls.find(v=>v.name==='life_naver_capture_finish').args.p_payload.photos[0].status,'failed');assert.equal(bad.uploads[0].headers['x-upsert'],'false');
});
test('wrong owner/expired lease stops all external requests; unknown completion ACK is not overwritten by error finish',async()=>{
  const f=fixture({claim:{owner_id:ids.other}});await assert.rejects((await f.worker()).execute({action:'capture',owner:ids.owner,jobId:ids.job}));assert.equal(f.calls.length,0);
  const lost=fixture({images:0,loseFinish:true});await assert.rejects((await lost.worker()).execute({action:'capture',owner:ids.owner,jobId:ids.job}));
  assert.equal(lost.rpcCalls.filter(v=>v.name==='life_naver_capture_finish').length,1);assert.equal(lost.rpcCalls.at(-1).args.p_error,null);
});
test('inventory errors preserve prior inventory and successful page carries checkpoint data without claiming whole completion',async()=>{
  const f=fixture({inventory:true});await(await f.worker()).execute({action:'inventory',owner:ids.owner,subscriptionId:ids.sub});
  const finish=f.rpcCalls.find(v=>v.name==='life_naver_inventory_finish').args;
  assert.deepEqual(finish.p_entries,[{logNo:LOG,title:'합성 제목',publishedAt:null}]);assert.equal(finish.p_total,1);assert.equal(finish.p_next_page,null);assert.equal(finish.p_error,null);
  const bad=fixture({inventory:true,list:{totalCount:31,postList:[]}});await(await bad.worker()).execute({action:'inventory',owner:ids.owner,subscriptionId:ids.sub});
  const error=bad.rpcCalls.find(v=>v.name==='life_naver_inventory_finish').args;assert.equal(error.p_error,'incomplete_inventory');assert.deepEqual(error.p_entries,[]);assert.equal(error.p_total,null);
});
test('new action handler verifies user before double gates and pins manual subscription; response contains no acquired body',async()=>{
  const [,,,{createHandler}]=await modules;const model=require('../assets/life/naver-capture.js');
  const f=fixture({images:0});const seen=[];
  const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'private-test-key',SUPABASE_ANON_KEY:'public-test-key',HAEDO_NAVER_INGESTION_ENABLED:'true'};
  const fetcher=async(url,init={})=>{
    seen.push(url);
    if(url.endsWith('/auth/v1/user'))return Response.json({id:ids.owner});
    if(url.endsWith('/life_naver_ready'))return Response.json(true);
    if(url.includes('/rest/v1/rpc/'))return Response.json(await f.rpc(url.split('/').at(-1),JSON.parse(init.body)));
    return f.fetcher(url,init);
  };
  const request=()=>new Request('https://fixture.supabase.co/functions/v1/haedo-naver-blog',{method:'POST',headers:{Authorization:'Bearer verified-fixture'},body:JSON.stringify({action:'run',subscriptionId:ids.sub})});
  let handler=createHandler({fetcher,environment:k=>env[k],load,captureModel:model});
  let result=await handler(request());assert.deepEqual(await result.json(),{status:'checked',stage:'capture',pending:false});
  assert.equal(seen[0],'https://fixture.supabase.co/auth/v1/user');
  assert.deepEqual(f.rpcCalls[0].args,{p_limit:1,p_job_id:null,p_owner_id:ids.owner,p_subscription_id:ids.sub});
  delete env.HAEDO_NAVER_INGESTION_ENABLED;seen.length=0;
  result=await handler(request());assert.deepEqual(await result.json(),{error:'setup_required'});assert.equal(seen.length,1);
});
test('new cron run requires exact service secret; actor cannot supply owner/blog/URL or expanded scope',async()=>{
  const [,,,{createHandler}]=await modules;const model=require('../assets/life/naver-capture.js');
  const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'private-test-key',SUPABASE_ANON_KEY:'public-test-key',HAEDO_NAVER_INGESTION_ENABLED:'true'};
  const calls=[];const handler=createHandler({environment:k=>env[k],load,captureModel:model,fetcher:async(url,init)=>{
    calls.push({url,args:init.body?JSON.parse(init.body):null});
    if(url.endsWith('life_naver_ready'))return Response.json(true);
    if(url.endsWith('life_naver_capture_claim')||url.endsWith('life_naver_inventory_claim'))return Response.json([]);
    throw Error('unexpected URL');
  }});
  const send=(body,key='private-test-key')=>handler(new Request('https://fixture.supabase.co/functions/v1/haedo-naver-blog',{method:'POST',headers:{Authorization:'Bearer '+key},body:JSON.stringify(body)}));
  assert.deepEqual(await(await send({action:'run'})).json(),{status:'busy'});
  assert.deepEqual(calls.find(c=>c.url.endsWith('life_naver_capture_claim')).args,{p_limit:1,p_job_id:null,p_owner_id:null,p_subscription_id:null});
  calls.length=0;assert.notEqual((await send({action:'run'},'public-test-key')).status,200);assert.equal(calls.length,0);
  assert.equal((await send({action:'inventory',subscriptionId:ids.sub,owner:ids.other})).status,400);assert.equal(calls.length,0);
});

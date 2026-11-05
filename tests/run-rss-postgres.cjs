/* Owned disposable PostgreSQL only: no host URL, real user, storage or cron. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
if(process.argv.length!==2)throw Error('This test accepts no endpoint or credential arguments.');
const root=path.resolve(__dirname,'..'),migration='supabase/migrations/20261105051010_rss_private_intake.sql',source=fs.readFileSync(path.join(root,migration),'utf8');
const image='postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3';
const owner=randomUUID(),container='haedo-rss-'+owner,database='haedo_rss_fixture',env={...process.env},label='haedo.rss-owner';
for(const key of Object.keys(env))if(/^(PG|DATABASE_URL$|SUPABASE|HAEDO_TEST_|DOCKER_HOST$|DOCKER_CONTEXT$|DOCKER_TLS$|DOCKER_TLS_VERIFY$|DOCKER_CERT_PATH$)/.test(key))delete env[key];
const docker=(args,input)=>execFileSync('docker',['--host=unix:///var/run/docker.sock',...args],{env,input,encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']});
const sql=q=>docker(['exec','-i',container,'psql','--host=127.0.0.1','-U','postgres','-d',database,'-qAt','-v','ON_ERROR_STOP=1'],q).trim();
const lit=x=>x==null?'null':"'"+String(x).replaceAll("'","''")+"'",jl=x=>lit(JSON.stringify(x))+'::jsonb';
const json=x=>x===''?null:JSON.parse(x.split('\n').findLast(l=>/^(\{|\[|null|true|false)/.test(l)));
const A=randomUUID(),B=randomUUID(),W=randomUUID(),feed='https://fixture.example.test/feed.xml';
const actor=(id,q)=>json(sql(`set role authenticated;select set_config('request.jwt.claims',${jl({sub:id})}::text,false);${q}`));
const worker=q=>json(sql('set role service_role;'+q));
const hash=s=>createHash('sha256').update(s).digest('hex');
const entry=(n,extra={})=>({identity:'guid:'+n,title:'글 '+n,url:'https://fixture.example.test/posts/'+n,content_text:'원문 '+n,content_hash:hash('원문 '+n),published_at:new Date().toISOString(),...extra});
const list=(who=A,before=null)=>actor(who,`select public.life_rss_list('${W}',${jl(before)});`);
const allItems=()=>{let rows=[],page=list();for(;;){rows.push(...page.items);if(!page.has_more)return rows;page=list(A,page.next_cursor);}};
let c,checks=0,mutations=0,started=false;
const test=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
const error=(fn,match)=>assert.throws(fn,e=>String(e.stderr||e.message).includes(match));
const state=()=>json(sql(`select to_jsonb(c) from haedo_rss_private.connections c where id='${c.id}';`));
const control=a=>{c=actor(A,`select public.life_rss_control('${c.id}',${state().revision},${lit(a)});`);return c;};
const due=()=>sql(`update haedo_rss_private.connections set next_check_at=clock_timestamp()-interval '1 second' where id='${c.id}';`);
const claim=()=>worker(`select public.life_rss_claim('${c.id}','${A}');`);
// Legacy lifecycle cases use a nonempty synthetic terminal baseline. Explicit
// collector pages always pass through unchanged, including empty-page failures.
const finish=(l,items=[],{next=null,complete=true,error=null,pages}={})=>{
 if(l.status==='pending'&&!items.length&&complete&&!error&&pages===undefined)items=[entry('fixture-baseline-'+randomUUID(),{published_at:'2000-01-01T00:00:00Z'})];
 const witness=pages===undefined?(items.length?[{url:l.cursor||l.feed_url,identities:[...new Set(items.map(i=>i.identity))],next}]:[]):pages;
 return worker(`select public.life_rss_finish('${l.connection_id}','${l.lease_token}',${l.revision},${jl(items)},${lit(next)},${complete},${lit(error)},${jl(witness)});`);
};
const definition=(signature='haedo_rss_private.finish(uuid,uuid,bigint,jsonb,text,boolean,text,jsonb)')=>sql('select pg_get_functiondef('+lit(signature)+'::regprocedure);');
const mutation=(name,from,to,check,signature)=>{const original=definition(signature);assert(original.includes(from),'mutation target exists');try{sql(original.replace(from,to));assert.throws(check,assert.AssertionError);mutations++;console.log('MUTATION DETECTED '+name);}finally{sql(original);}};
async function main(){try{
 docker(['image','inspect',image]);docker(['run','--detach','--pull=never','--network=none','--name',container,'--label',label+'='+owner,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);started=true;
 const info=JSON.parse(docker(['inspect',container,'--format','{{json .}}']));assert.equal(info.HostConfig.NetworkMode,'none');assert.equal(Object.keys(info.HostConfig.PortBindings||{}).length,0);
 for(let tries=0;;tries++){try{docker(['exec',container,'pg_isready','--host=127.0.0.1','-U','postgres']);break;}catch(e){if(tries>100)throw e;await new Promise(r=>setTimeout(r,200));}}
 docker(['exec',container,'createdb','--host=127.0.0.1','-U','postgres',database]);
 sql(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
 create table public.existing_material(id integer primary key,body text);insert into public.existing_material values(1,'unchanged 원문');`);
 test('migration rolls back atomically',()=>{error(()=>sql(source.replace(/commit;\s*$/,'select 1/0;commit;')),'division by zero');assert.equal(sql("select to_regnamespace('haedo_rss_private') is null;"),'t');});
 sql(source);
 test('disabled runtime, no source writes and no table exposure',()=>{
  assert.equal(sql('select body from public.existing_material;'),'unchanged 원문');
  assert.equal(list().ready,false);error(()=>actor(A,`select public.life_rss_save('${W}',${lit(feed)});`),'rss_setup_required');
  assert.equal(sql("select bool_and(relrowsecurity) from pg_class where relnamespace='haedo_rss_private'::regnamespace and relkind='r';"),'t');
  assert.equal(sql("select has_function_privilege('authenticated','public.life_rss_finish(uuid,uuid,bigint,jsonb,text,boolean,text,jsonb)','execute') or has_function_privilege('anon','public.life_rss_list(uuid,jsonb)','execute');"),'f');
  error(()=>sql('set role authenticated;select * from haedo_rss_private.items;'),'permission denied');
 });
 sql(`update haedo_rss_private.runtime set ready=true,allowed_feed_urls=array[${lit(feed)}];`);
 c=actor(A,`select public.life_rss_save('${W}',${lit(feed)});`);
 test('registration idempotency, one active source, owner isolation',()=>{
  assert.equal(actor(A,`select public.life_rss_save('${W}',${lit(feed)});`).id,c.id);
  error(()=>actor(A,`select public.life_rss_save('${randomUUID()}',${lit(feed)});`),'rss_connection_exists');
  error(()=>actor(B,`select public.life_rss_control('${c.id}',1,'disconnect');`),'rss_not_found');assert.deepEqual(list(B).connections,[]);
  error(()=>control('activate'),'rss_baseline_required');assert.equal(worker(`select public.life_rss_claim('${c.id}','${B}');`),null);
 });
 let lease=claim();
 test('single lease prevents competing work',()=>assert.equal(claim(),null));
 const base=entry('baseline',{published_at:'2020-01-01T00:00:00Z'});
 const first=finish(lease,[base],{next:'https://fixture.example.test/page2',complete:false,error:'network_error'});
 test('partial baseline stores identities and cursor but cannot activate',()=>{assert.equal(first.status,'error');assert.equal(state().baseline_at,null);assert.equal(state().baseline_count,1);assert.equal(state().cursor,'https://fixture.example.test/page2');error(()=>control('activate'),'rss_baseline_required');assert.deepEqual(list().items,[]);});
 test('receipt replays exactly and rejects altered result',()=>{assert.deepEqual(finish(lease,[base],{next:'https://fixture.example.test/page2',complete:false,error:'network_error'}),first);error(()=>finish(lease,[]),'rss_receipt_mismatch');});
 control('retry');lease=claim();assert.equal(lease.cursor,'https://fixture.example.test/page2');finish(lease,[]);
 test('complete inventory remains a preview until explicit activation',()=>{assert.equal(state().status,'preview');assert(state().baseline_at);assert.deepEqual(list().items,[]);assert.equal(claim(),null);});
 // This article appeared after baseline began but before user activation.
 const between=entry('between');control('activate');due();lease=claim();const captured=finish(lease,[base,between]);
 test('new-only uses baseline start, preserving activation-gap article',()=>{assert.equal(captured.inserted,1);assert.equal(list().items[0].identity,'guid:between');assert.equal(list().items[0].content_text,between.content_text);assert.deepEqual(list(B).items,[]);});
 test('normal successful poll and pause/resume respect the 60-minute budget',()=>{assert.equal(claim(),null);error(()=>control('retry'),'rss_retry_unavailable');control('pause');control('resume');assert.equal(claim(),null);});
 due();lease=claim();const bad=entry('bad',{content_hash:'bad'}),count=list().items.length;
 test('invalid item rolls back entire batch including cursor and receipt',()=>{error(()=>finish(lease,[entry('valid-first'),bad]),'rss_invalid_hash');assert.equal(list().items.length,count);assert.equal(state().lease_token,lease.lease_token);});
 const unknown=entry('unknown',{published_at:null}),old=entry('old',{published_at:'2000-01-01T00:00:00Z'}),future=entry('future',{published_at:'2099-01-01T00:00:00Z'});
 const big=entry('large',{content_text:'x'.repeat(1048577),content_hash:hash('x'.repeat(1048577))});
 finish(lease,[unknown,old,future,big]);
 test('unknown, old, future and oversized originals are held intact',()=>{const its=list().items;for(const [id,reason] of [['unknown','date_unknown'],['old','old_observed'],['future','future_date'],['large','content_too_large']])assert.equal(its.find(i=>i.identity==='guid:'+id).reason,reason);assert.equal(its.find(i=>i.identity==='guid:large').content_text,null);assert.equal(Number(sql("select octet_length(content_text) from haedo_rss_private.items where identity='guid:large';")),1048577);});
 due();lease=claim();const two=entry('conflict'),other={...two,url:'https://fixture.example.test/other'};finish(lease,[two,other]);
 test('same-page identity collision quarantines both records',()=>assert(list().items.filter(i=>i.identity==='guid:conflict').every(i=>i.disposition==='held')));
 due();lease=claim();const edited={...between,content_text:'새 정확 판',content_hash:hash('새 정확 판')};finish(lease,[edited]);
 test('body edits preserve prior immutable versions',()=>{const rows=list().items.filter(i=>i.identity==='guid:between');assert.equal(rows.length,2);assert(rows.some(i=>i.content_text===between.content_text));assert(rows.some(i=>i.content_text==='새 정확 판'));});
 due();lease=claim();control('pause');
 test('pause fences late worker response',()=>assert.equal(finish(lease,[entry('late')]).status,'stale'));
 control('resume');due();lease=claim();sql(`update haedo_rss_private.connections set lease_until=clock_timestamp()-interval '1 second' where id='${c.id}';`);
 test('expired lease cannot publish a result',()=>assert.equal(finish(lease,[entry('expired')]).status,'stale'));
 lease=claim();control('disconnect');
 test('disconnect fences late results but retains previously saved originals',()=>{assert.equal(finish(lease,[entry('disconnect-late')]).status,'stale');assert(list().items.some(i=>i.identity==='guid:between'));assert.equal(claim(),null);});
 // Reconnect creates a fresh inventory but never removes old immutable inbox data.
 c=actor(A,`select public.life_rss_save('${W}',${lit(feed)});`);lease=claim();finish(lease,[]);control('activate');due();lease=claim();
 const {createParser,collect}=await import('../supabase/functions/haedo-rss/feed.mjs');
 const XML=await import('../supabase/functions/haedo-rss/vendor/fast-xml-parser.mjs');
 const parse=createParser(XML),body='  원문 & <strong>HTML</strong>\n';
 const parsed=await parse(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>parser-exact</id><title>실제 parser</title><link href="https://fixture.example.test/parser"/><published>${new Date().toISOString()}</published><content type="html"><![CDATA[${body}]]></content></entry><entry><id>missing-link</id><title>링크 없음</title><content>보관할 원문</content></entry><entry><id>missing-body</id><title>본문 없음</title><link href="https://fixture.example.test/no-body"/></entry></feed>`,feed);
 finish(lease,parsed.items);
 test('real Edge parser output commits exact text and nullable held metadata',()=>{const rows=list().items;assert.equal(rows.find(i=>i.identity==='atom:parser-exact').content_text,body);assert.equal(rows.find(i=>i.identity==='atom:missing-link').reason,'missing_url');assert.equal(rows.find(i=>i.identity==='atom:missing-body').reason,'missing_content');});
 due();lease=claim();
 sql("update haedo_rss_private.runtime set allowed_feed_urls='{}';");
 test('removing allowlist fences inflight writes and scheduler',()=>{assert.equal(finish(lease,[entry('revoked')]).status,'stale');assert.deepEqual(worker('select public.life_rss_due(2);'),[]);});
 sql(`update haedo_rss_private.runtime set allowed_feed_urls=array[${lit(feed)}];`);
 finish(lease,[],{complete:false,error:'network_error'});
 control('retry');lease=claim();finish(lease,[],{complete:false,error:'network_error'});
 control('retry');lease=claim();finish(lease,[],{complete:false,error:'network_error'});
 test('failure retry limited to two per sixty minutes',()=>error(()=>control('retry'),'rss_retry_limit'));
 test('a reset transient failure series remains automatically retryable at its deadline',()=>{assert.equal(state().failure_count,1);due();assert(worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id));assert(claim());});
 sql(`update haedo_rss_private.connections set retry_window_at=clock_timestamp()-interval '2 hours' where id='${c.id}';`);control('retry');
 due();test('scheduler is bounded and service-only',()=>{assert(worker('select public.life_rss_due(2);').some(i=>i.connection_id===c.id));error(()=>worker('select public.life_rss_due(3);'),'rss_invalid_limit');error(()=>actor(A,'select public.life_rss_due(2);'),'permission denied');});
 lease=claim();finish(lease,Array.from({length:100},(_,i)=>entry('page'+i)));
 test('keyset pages retain every immutable item exactly once',()=>{let all=[],page=list();while(true){all.push(...page.items);if(!page.has_more)break;assert(page.items.length>0 && page.items.length<=100);page=list(A,page.next_cursor);}assert.equal(all.length,new Set(all.map(i=>i.id)).size);assert.equal(all.filter(i=>i.identity.startsWith('guid:page')).length,100);});
 due();lease=claim();const longBody='a\n'.repeat(300000);
 finish(lease,[entry('escaped1',{content_text:longBody,content_hash:hash(longBody)}),entry('escaped2',{content_text:longBody,content_hash:hash(longBody)}),entry('escaped3',{content_text:longBody,content_hash:hash(longBody)})]);
 test('serialized byte budget paginates large originals without truncation',()=>{let page=list(),rows=[],pages=0,largePages=0;for(;;){pages++;if(page.items.some(i=>i.identity.startsWith('guid:escaped')))largePages++;assert(Buffer.byteLength(JSON.stringify(page))<4*1024*1024);rows.push(...page.items);if(!page.has_more)break;page=list(A,page.next_cursor);}const large=rows.filter(i=>i.identity.startsWith('guid:escaped'));assert.equal(large.length,3);assert(large.every(i=>i.content_text===longBody));assert(pages>=2);assert(largePages>=2);});
 control('disconnect');
 // Real collector + PostgreSQL: cron discovers pending work, ten bounded
 // invocations finish a twenty-page baseline without manual checks or retry.
 c=actor(A,`select public.life_rss_save('${W}',${lit(feed)});`);
 let newHead=false,requested=[];
 const pageURL=n=>n===1?feed:feed+'?page='+n;
 const atomEntry=(id,date)=>`<entry><id>${id}</id><title>${id}</title><link href="https://fixture.example.test/${id}"/><published>${date}</published><content>${id} 원문</content></entry>`;
 const fixtureFetch=async url=>{requested.push(url);const n=Number(new URL(url).searchParams.get('page')||1);assert(n>=1&&n<=20);return new Response(`<feed xmlns="http://www.w3.org/2005/Atom">${n<20?`<link rel="next" href="${pageURL(n+1)}"/>`:''}${newHead&&n===1?atomEntry('new-head',new Date().toISOString()):''}${atomEntry('baseline-page-'+n,'2020-01-01T00:00:00Z')}</feed>`);};
 const known=ids=>worker(`select public.life_rss_known('${c.id}','${A}',${jl(ids)});`);
 for(let run=0;run<10;run++){
  assert(worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id),'pending baseline is scheduled automatically');
  lease=claim();assert(lease);const scanned=await collect({url:feed,cursor:lease.cursor,scanPages:lease.baseline_pages,known,parse,fetcher:fixtureFetch,allowedHosts:['fixture.example.test']});
  assert.equal(scanned.items.length,2);assert.equal(scanned.error,null);finish(lease,scanned.items,{next:scanned.cursor,complete:scanned.complete,pages:scanned.pages});
 }
 test('twenty-page baseline completes through cron without manual continuation',()=>{assert.equal(requested.length,20);assert.deepEqual(requested,Array.from({length:20},(_,i)=>pageURL(i+1)));assert.equal(state().status,'preview');assert.equal(state().baseline_count,20);assert(!worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id));});
 control('activate');lease=claim();
 test('new active sweep starts at head and known lookup is bounded and owner scoped',()=>{assert.equal(lease.cursor,null);assert.deepEqual(known(['atom:baseline-page-1','unknown']),['atom:baseline-page-1']);assert.deepEqual(worker(`select public.life_rss_known('${c.id}','${B}',${jl(['atom:baseline-page-1'])});`),[]);error(()=>known(Array(101).fill('a')),'rss_invalid_identities');error(()=>actor(A,`select public.life_rss_known('${c.id}','${A}','[]');`),'permission denied');});
 newHead=true;requested=[];
 const scan=await collect({url:feed,cursor:lease.cursor,active:true,known,parse,fetcher:fixtureFetch,allowedHosts:['fixture.example.test']});
 const headResult=finish(lease,scan.items,{next:scan.cursor,complete:scan.complete,error:scan.error,pages:scan.pages});
 test('next active run stores new first-page item then stops at known second page',()=>{assert.equal(headResult.inserted,1);assert.deepEqual(requested,[feed,pageURL(2)]);assert.equal(state().cursor,null);assert(allItems().some(i=>i.identity==='atom:new-head'&&i.disposition==='stored'));});
 const elsewhere=actor(A,`select public.life_rss_list('${randomUUID()}');`);
 test('other workspace sees only its owner connection metadata and no source body',()=>{assert.deepEqual(elsewhere.items,[]);assert.deepEqual(elsewhere.connections,[]);assert.equal(elsewhere.other_connections.length,1);assert.equal(elsewhere.other_connections[0].id,c.id);assert.equal(elsewhere.other_connections[0].workspace_id,W);assert(!('owner_id' in elsewhere.other_connections[0]));assert(!('lease_token' in elsewhere.other_connections[0]));assert.deepEqual(list(B).other_connections,[]);});
 control('disconnect');
 // Exercise the durable multi-run scheduler with real parsed feeds. No
 // clock advancement or manual "check" is used between catch-up invocations.
 const restart=()=>{c=actor(A,`select public.life_rss_save('${W}',${lit(feed)});`);};
 const rssKnown=ids=>worker(`select public.life_rss_known('${c.id}','${A}',${jl(ids)});`);
 const tick=async fetcher=>{
  assert(worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id));const job=claim();assert(job);
  const scan=await collect({url:feed,cursor:job.cursor,active:job.status==='active',scanPages:job.status==='active'?job.sweep_pages:job.baseline_pages,known:rssKnown,parse,fetcher,allowedHosts:['fixture.example.test']});
  return {job,scan,result:finish(job,scan.items,{next:scan.cursor,complete:scan.complete,error:scan.error,pages:scan.pages})};
 };
 const xmlFeed=(entries,next)=>`<feed xmlns="http://www.w3.org/2005/Atom">${next?`<link rel="next" href="${next}"/>`:''}${entries.map(e=>atomEntry(e.id,e.date)).join('')}</feed>`;
 const oldRows=Array.from({length:100},(_,i)=>({id:'known-old-'+i,date:'2000-01-01T00:00:00Z'}));
 const installOld=()=>{restart();const job=claim();finish(job,oldRows.map(e=>entry(e.id,{identity:'atom:'+e.id,published_at:e.date})));control('activate');};
 const knownTail=xmlFeed([oldRows[0]],null).replace('https://fixture.example.test/known-old-0','https://fixture.example.test/posts/known-old-0');
 const freshRows=(prefix,n)=>Array.from({length:n},(_,i)=>({id:prefix+i,date:new Date().toISOString()}));
 for(const size of [10,60,100]){
  installOld();let rows=[...freshRows('burst-'+size+'-',size===10?25:size*3),...oldRows],expected=new Set(rows.filter(e=>!e.id.startsWith('known-old')).map(e=>'atom:'+e.id)),runs=0,appended=false,overflow=false;
  const fake=async url=>{const page=Number(new URL(url).searchParams.get('page')||1),start=(page-1)*size;return new Response(xmlFeed(rows.slice(start,start+size),start+size<rows.length?pageURL(page+1):null));};
  while(worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id)){
   const step=await tick(fake);runs++;assert(runs<30,'finite backlog must reach idle');assert.equal(step.scan.error,null);assert.equal(step.result.error,null);
   if(size===60&&step.scan.pages.length===1&&!step.scan.complete)overflow=true;
   // Insert another 25-row prefix once the checkpoint is deep, exercising
   // shifted duplicates and fresh-head recheck rather than a head-only probe.
   if(size===10&&!appended&&runs===2){const extra=freshRows('during-tail-',25);rows=[...extra,...rows];extra.forEach(e=>expected.add('atom:'+e.id));appended=true;}
  }
  const captured=new Set(allItems().filter(i=>i.connection_id===c.id&&i.disposition==='stored').map(i=>i.identity));
  test('durable '+size+'-item pages collect every finite burst including tail-time head arrivals',()=>{assert.deepEqual([...captured].sort(),[...expected].sort());assert.equal(state().cursor,null);assert.equal(state().last_error,null);if(size===10)assert(appended);if(size===60)assert(overflow);});control('disconnect');
 }
 for(const kind of ['cycle','empty','fifty','fifty-one']){
  restart();let fetches=0,runs=0;
  const fake=async url=>{fetches++;const page=Number(new URL(url).searchParams.get('page')||1);const next=kind==='cycle'?pageURL(page===3?1:page+1):kind==='fifty'&&page===50?null:pageURL(page+1);return new Response(xmlFeed(kind==='empty'?[]:[{id:'baseline-'+kind+'-'+page,date:'2000-01-01T00:00:00Z'}],next));};
  while(worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id)){await tick(fake);runs++;assert(runs<=25,'baseline scheduler must stop within fifty accepted pages');}
  const row=state();
  test('bounded pending '+kind+' feed terminates without repeated automatic polling',()=>{if(kind==='fifty'){assert.equal(row.status,'preview');assert.equal(row.baseline_pages,50);assert.equal(row.last_error,null);}else{assert.equal(row.status,'pending');assert.equal(row.last_error,kind==='fifty-one'?'baseline_page_limit':'baseline_stalled');due();assert.equal(claim(),null);assert(!worker('select public.life_rss_due(2);').some(i=>i.connection_id===c.id));assert(fetches<=(kind==='empty'?1:kind==='cycle'?4:50));if(kind==='fifty-one')error(()=>control('retry'),'rss_retry_unavailable');}});control('disconnect');
 }
 installOld();let activeFetches=0;
 const many=async url=>{activeFetches++;const page=Number(new URL(url).searchParams.get('page')||1);return new Response(xmlFeed([{id:'active-limit-'+page,date:new Date().toISOString()}],pageURL(page+1)));};
 for(let run=0;run<25;run++)await tick(many);
 test('active page limit preserves collected data and refuses silent retry reset',()=>{assert.equal(state().last_error,'catchup_page_limit');assert.equal(state().sweep_pages,50);assert.equal(activeFetches,50);due();assert.equal(claim(),null);assert(!worker('select public.life_rss_due(2);').some(i=>i.connection_id===c.id));error(()=>control('retry'),'rss_retry_unavailable');assert.equal(allItems().filter(i=>i.connection_id===c.id&&i.disposition==='stored').length,50);control('pause');control('resume');assert.equal(state().last_error,'catchup_page_limit');assert.equal(claim(),null);});control('disconnect');
 installOld();lease=claim();
 const wirePrefix='<rss version="2.0"><channel><item><guid>wire-boundary</guid><description>',wireSuffix='</description></item></channel></rss>';
 const escapedBody='\\'.repeat(2097152-Buffer.byteLength(wirePrefix+wireSuffix));
 const wire=await parse(wirePrefix+escapedBody+wireSuffix,feed);
 assert(Buffer.byteLength(JSON.stringify(wire.items))>4194304,'valid feed expands past the old JSON wire guard');
 finish(lease,wire.items);
 test('exact two-MiB feed survives JSON escaping and preserves the held original',()=>{const stored=json(sql(`select jsonb_build_object('bytes',octet_length(content_text),'hash',content_hash,'reason',reason) from haedo_rss_private.items where connection_id='${c.id}' and identity='guid:wire-boundary';`));assert.equal(stored.bytes,escapedBody.length);assert.equal(stored.hash,hash(escapedBody));assert.equal(stored.reason,'content_too_large');assert.equal(state().last_error,null);});
 due();lease=claim();const escapedScalar='\u0001'.repeat(2097152),oversizedScalar=escapedScalar+'x';
 test('JSON sixfold escaping preserves the raw two-MiB SQL boundary',()=>{error(()=>finish(lease,[entry('raw-too-large',{content_text:oversizedScalar,content_hash:hash(oversizedScalar)})]),'rss_text_limit');const result=finish(lease,[entry('raw-boundary',{content_text:escapedScalar,content_hash:hash(escapedScalar)})]);assert.equal(result.held,1);const saved=json(sql(`select jsonb_build_object('bytes',octet_length(content_text),'hash',content_hash) from haedo_rss_private.items where connection_id='${c.id}' and identity='guid:raw-boundary';`));assert.equal(saved.bytes,2097152);assert.equal(saved.hash,hash(escapedScalar));});control('disconnect');
 // Unidentifiable records can never be a known-page boundary. Completing
 // such a sweep must nevertheless return to the ordinary hourly interval.
 for(const shape of [3,5,'mixed4']){
  restart();const total=shape==='mixed4'?4:shape;let activatedUnknown=false;
  const fake=async url=>{const page=Number(new URL(url).searchParams.get('page')||1),next=page<total?pageURL(page+1):null;
   if(shape==='mixed4'&&page>2)return new Response(xmlFeed([{id:'mixed-stable-'+page,date:'2000-01-01T00:00:00Z'}],next));
   return new Response(`<feed xmlns="http://www.w3.org/2005/Atom">${next?`<link rel="next" href="${next}"/>`:''}<entry><title>unknown page ${page}</title><content>${activatedUnknown?'new':'initial'} unidentified body ${page}</content></entry></feed>`);
  };
  for(let runs=0;state().status==='pending';runs++){assert(runs<3);await tick(fake);}activatedUnknown=true;control('activate');let runs=0;
  while(worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id)){await tick(fake);assert(++runs<=3);}
  test('unidentified '+shape+'-page sweep reaches hourly idle without endless fresh-head scheduling',()=>{assert.equal(state().last_error,null);assert.equal(state().cursor,null);assert.equal(state().sweep_new_count,0);assert(new Date(state().next_check_at).getTime()>Date.now()+3500000);});control('disconnect');
 }
 // An unstable real GUID/URL must not turn the one fresh-head recheck into
 // an unbounded loop, including old articles that are quarantined each time.
 for(const identityKind of ['guid','url'])for(const old of [false,true]){
  // RSS dates have second precision; place this fixture's baseline earlier.
  installOld();sql(`update haedo_rss_private.connections set baseline_started_at=baseline_started_at-interval '1 minute' where id='${c.id}';`);
  let changes=0,fetches=0,runs=0;const published=new Date(old?'2000-01-01T00:00:00Z':Date.now()).toUTCString();
  const unstable=async url=>{fetches++;const page=Number(new URL(url).searchParams.get('page')||1);
   if(page===3)return new Response(knownTail);
   if(page===2)return new Response(`<feed xmlns="http://www.w3.org/2005/Atom"><link rel="next" href="${pageURL(3)}"/><entry><title>unknown</title><content>고정 본문</content></entry></feed>`);
   changes++;const link='https://fixture.example.test/unstable'+(identityKind==='url'?'?v='+changes:'');
   return new Response(`<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><atom:link rel="next" href="${pageURL(2)}"/><item>${identityKind==='guid'?'<guid>unstable-'+changes+'</guid>':''}<title>같은 본문</title><link>${link}</link><pubDate>${published}</pubDate><description>변하지 않는 정확한 원문</description></item></channel></rss>`);
  };
  while(worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id)){await tick(unstable);assert(++runs<=4,'only one consecutive immediate recheck is allowed');}
  test('unstable '+identityKind+' '+(old?'old':'fresh')+' three-page feed reaches finite hourly idle',()=>{const rows=allItems().filter(i=>i.connection_id===c.id);assert.equal(runs,4);assert.equal(fetches,6);assert.equal(changes,2);assert.equal(rows.length,3);assert.equal(rows.filter(i=>i.disposition==='stored').length,old?0:2);assert.equal(state().sweep_is_recheck,false);assert.equal(state().last_error,null);assert(new Date(state().next_check_at).getTime()>Date.now()+3500000);});control('disconnect');
 }
 installOld();lease=claim();finish(lease,[entry('recheck-first')],{next:pageURL(3),complete:false});lease=claim();finish(lease,[entry('recheck-tail')]);
 assert.equal(state().sweep_is_recheck,true);lease=claim();finish(lease,[entry('recheck-new')],{next:pageURL(3),complete:false});lease=claim();finish(lease,[],{next:pageURL(3),complete:false,error:'network_error'});control('pause');control('resume');
 test('immediate recheck marker survives partial progress, transient failure and pause',()=>assert.equal(state().sweep_is_recheck,true));
 due();lease=claim();finish(lease,[entry('recheck-more')]);
 test('recovered immediate recheck completes at the hourly interval despite new IDs',()=>{assert.equal(state().sweep_is_recheck,false);assert.equal(state().failure_count,0);assert(!worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id));});control('disconnect');
 // The one-recheck bound delays a later head insertion until the next
 // scheduled cycle, but preserves it once that hourly deadline is reached.
 installOld();let delayedHead=false,recheckHead=false;const firstDate=new Date().toISOString();
 const delayed=async url=>{const page=Number(new URL(url).searchParams.get('page')||1);
  if(page===1)return new Response(xmlFeed([{id:'bounded-first',date:firstDate},...(recheckHead?[{id:'bounded-recheck',date:firstDate}]:[]),...(delayedHead?[{id:'bounded-delayed',date:firstDate}]:[])],pageURL(2)));
  if(page===2)return new Response(`<feed xmlns="http://www.w3.org/2005/Atom"><link rel="next" href="${pageURL(3)}"/><entry><title>unknown delayed</title><content>원문</content></entry></feed>`);
  return new Response(knownTail);
 };
 await tick(delayed);await tick(delayed);assert.equal(state().sweep_is_recheck,true);recheckHead=true;await tick(delayed);delayedHead=true;await tick(delayed);
 assert(!worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id));assert(!allItems().some(i=>i.connection_id===c.id&&i.identity==='atom:bounded-delayed'));
 due();let delayedRuns=0;while(worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id)){await tick(delayed);assert(++delayedRuns<=3);}
 test('new head arrival during the capped recheck tail is preserved on the next hourly cycle',()=>{assert.equal(allItems().filter(i=>i.connection_id===c.id&&i.identity==='atom:bounded-delayed'&&i.disposition==='stored').length,1);assert.equal(state().last_error,null);assert.equal(state().cursor,null);assert.equal(state().sweep_is_recheck,false);});control('disconnect');
 installOld();lease=claim();finish(lease,[],{complete:false,error:'network_error'});due();lease=claim();finish(lease,[entry('success-resets-failures')]);
 test('successful finish resets an automatic transient failure series',()=>assert.equal(state().failure_count,0));
 for(let attempt=1;attempt<=3;attempt++){due();lease=claim();assert(lease);finish(lease,[],{complete:false,error:attempt===2?'rate_limited':'network_error'});assert.equal(state().failure_count,attempt);assert.equal(list().connections.find(row=>row.id===c.id).auto_retry,attempt<3);assert.equal(claim(),null);}
 test('transient failures retry hourly twice then stop across pause and resume',()=>{due();assert.equal(claim(),null);assert(!worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id));control('pause');control('resume');assert.equal(state().failure_count,3);assert.equal(claim(),null);control('retry');assert.equal(state().failure_count,0);assert(claim());});control('disconnect');
 restart();const cyclic=async url=>{const page=Number(new URL(url).searchParams.get('page')||1);return new Response(xmlFeed([{id:'retry-page-'+page,date:'2000-01-01T00:00:00Z'}],pageURL(page===3?1:page+1)));};
 while(!state().last_error)await tick(cyclic);
 const originalBaseline=state().baseline_started_at;
 const originals=()=>sql(`select jsonb_agg(jsonb_build_array(identity,url,first_observed_at,baseline) order by identity) from haedo_rss_private.observations where connection_id='${c.id}';`);
 const beforeRetry=originals();control('retry');
 test('stalled baseline retry restarts at head and preserves historical observations',()=>{assert.equal(state().cursor,null);assert.equal(state().baseline_pages,0);assert.equal(state().baseline_generation,2);assert.equal(state().baseline_started_at,originalBaseline);assert.equal(originals(),beforeRetry);assert.deepEqual(rssKnown(['atom:retry-page-1']),[]);});
 let retryRuns=0;while(!state().last_error){await tick(cyclic);assert(++retryRuns<=2);}
 test('new baseline attempt detects a repeated old-ID cycle within that attempt',()=>{assert.equal(state().last_error,'baseline_stalled');assert.equal(originals(),beforeRetry);assert.equal(state().baseline_count,3);});
 control('retry');const repaired=async url=>{const page=Number(new URL(url).searchParams.get('page')||1);return new Response(xmlFeed([{id:'retry-page-'+page,date:'2000-01-01T00:00:00Z'}],page===3?null:pageURL(page+1)));};
 while(state().status==='pending')await tick(repaired);
 test('repaired baseline finishes from retained observations without deleting or duplicating them',()=>{assert.equal(state().status,'preview');assert.equal(state().baseline_count,3);assert.equal(originals(),beforeRetry);});control('disconnect');
 installOld();lease=claim();sql(`update haedo_rss_private.connections set sweep_pages=49 where id='${c.id}';`);
 const firstCap=entry('direct-cap'),secondCap={...firstCap,content_text:'같은 ID의 다른 쪽 본문',content_hash:hash('같은 ID의 다른 쪽 본문')};
 const capSnapshot=()=>sql(`select jsonb_build_object('connection',(select to_jsonb(x) from haedo_rss_private.connections x where id='${c.id}'),'observations',(select coalesce(jsonb_agg(to_jsonb(o) order by identity),'[]') from haedo_rss_private.observations o where connection_id='${c.id}'),'items',(select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') from haedo_rss_private.items i where connection_id='${c.id}'),'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by lease_token),'[]') from haedo_rss_private.receipts r where connection_id='${c.id}'));`);
 const capBefore=capSnapshot();
 test('SQL rejects a two-page finish at forty-nine atomically even when versions share an identity',()=>{error(()=>finish(lease,[firstCap,secondCap],{next:pageURL(3),complete:false,pages:[{url:feed,identities:[firstCap.identity],next:pageURL(2)},{url:pageURL(2),identities:[secondCap.identity],next:pageURL(3)}]}),'rss_invalid_pages');assert.equal(capSnapshot(),capBefore);});
 test('SQL permits the exact fiftieth page ending at EOF',()=>{const result=finish(lease,[firstCap],{pages:[{url:feed,identities:[firstCap.identity],next:null}]});assert.equal(result.error,null);assert.equal(result.inserted,1);assert.equal(state().cursor,null);assert.equal(state().last_error,null);});control('disconnect');
 installOld();lease=claim();error(()=>finish(lease,[entry('fallback-invalid',{content_hash:'bad'})]),'rss_invalid_hash');
 const fallback=finish(lease,[],{complete:false,error:'rss_invalid_hash',pages:[]});
 test('validation-error fallback records one durable hard failure and stops due work',()=>{assert.equal(fallback.error,'rss_invalid_hash');assert.deepEqual(finish(lease,[],{complete:false,error:'rss_invalid_hash',pages:[]}),fallback);due();assert.equal(claim(),null);assert(!worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id));assert.equal(sql(`select count(*) from haedo_rss_private.receipts where connection_id='${c.id}' and lease_token='${lease.lease_token}';`),'1');});control('disconnect');
 // Bridge the actual Edge handler's HTTP RPC calls into this owned database.
 // Only the fixture host is fetched; validation failure is a real SQL rollback.
 const {createHandler}=await import('../supabase/functions/haedo-rss/handler.mjs');
 for(const scenario of ['blank-title','validation','long-next']){
  installOld();let finishCalls=0,feedCalls=0,failedLease=null,receivedTitle=null;
  const environment=name=>({SUPABASE_URL:'https://project.fixture.invalid',SUPABASE_SECRET_KEYS:JSON.stringify({default:'sb_secret_fixture_server'}),SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:'sb_publishable_fixture'})}[name]);
  const bridge=async(url,options={})=>{
   if(url.startsWith('https://project.fixture.invalid/rest/v1/rpc/')){
    const name=url.split('/').at(-1);assert(/^life_rss_(due|claim|known|finish)$/.test(name));const args=JSON.parse(options.body);
    if(name==='life_rss_finish'){finishCalls++;failedLease=args.p_lease_token;receivedTitle=args.p_items[0]?.title||receivedTitle;if(scenario==='validation'&&finishCalls===1)args.p_items[0].content_hash='wrong';}
    const parts=Object.entries(args).map(([key,value])=>{assert(/^p_[a-z_]+$/.test(key));return key+'=>'+(value===null?'null':typeof value==='object'?jl(value):typeof value==='string'?lit(value):String(value));});
    try{return new Response(JSON.stringify(worker('select public.'+name+'('+parts.join(',')+');')));}
    catch(e){const code=String(e.stderr||e.message).match(/ERROR:\s+(rss_[a-z_]+)/)?.[1];if(!code)throw e;return new Response(JSON.stringify({message:code}),{status:400});}
   }
   assert.equal(url,feed);feedCalls++;const next=scenario==='long-next'?`<link rel="next" href="https://fixture.example.test/${'한'.repeat(400)}"/>`:'';
   return new Response(`<feed xmlns="http://www.w3.org/2005/Atom">${next}<entry><id>handler-${scenario}</id><title>   </title><link href="https://fixture.example.test/handler-${scenario}"/><published>${new Date().toISOString()}</published><content>정확한 본문</content></entry></feed>`);
  };
  const handler=createHandler({environment,fetcher:bridge,...XML,allowedHosts:['fixture.example.test']});
  const response=await handler(new Request('https://edge.fixture.invalid',{method:'POST',headers:{apikey:'sb_secret_fixture_server'},body:JSON.stringify({action:'run'})}));assert.equal(response.status,200);const reply=await response.json();
  test('actual Edge and PostgreSQL '+scenario+' completes without a silent lease retry loop',()=>{
   assert.equal(feedCalls,1);assert.equal(finishCalls,scenario==='validation'?2:1);assert.equal(reply.checked,1);
   if(scenario==='blank-title'){assert.equal(receivedTitle,'제목 없음');assert.equal(state().last_error,null);assert(allItems().some(i=>i.connection_id===c.id&&i.title==='제목 없음'&&i.disposition==='stored'));}
   else{assert.equal(state().last_error,scenario==='validation'?'rss_invalid_hash':'invalid_feed');due();assert.equal(claim(),null);assert(!worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id));assert.equal(sql(`select count(*) from haedo_rss_private.observations where connection_id='${c.id}' and identity='atom:handler-${scenario}';`),'0');}
   assert.equal(sql(`select count(*) from haedo_rss_private.receipts where connection_id='${c.id}' and lease_token='${failedLease}';`),'1');
  });control('disconnect');
 }
 // Unacknowledged finish failures do not get an unsafe error-only replay.
 // Real handler requests leave the lease; SQL bounds those abandoned attempts.
 const expireLease=()=>sql(`update haedo_rss_private.connections set lease_until=clock_timestamp()-interval '1 second' where id='${c.id}';`);
 for(const failure of ['unknown400','413','500','lost-timeout']){
  installOld();let finishCalls=0,feedCalls=0;
  const bridge=async(url,options={})=>{
   if(url.startsWith('https://project.fixture.invalid/rest/v1/rpc/')){
    const name=url.split('/').at(-1),args=JSON.parse(options.body);assert(/^life_rss_(due|claim|known|finish)$/.test(name));
    if(name==='life_rss_finish'){finishCalls++;if(failure==='lost-timeout')throw new TypeError('fixture interrupted before finish');return new Response(JSON.stringify({message:'unexpected_rejection'}),{status:failure==='unknown400'?400:Number(failure)});}
    const parts=Object.entries(args).map(([key,value])=>key+'=>'+(value===null?'null':typeof value==='object'?jl(value):typeof value==='string'?lit(value):String(value)));
    return new Response(JSON.stringify(worker('select public.'+name+'('+parts.join(',')+');')));
   }
   assert.equal(url,feed);feedCalls++;return new Response(xmlFeed([{id:'unfinished-'+failure,date:new Date().toISOString()}],null));
  };
  const environment=name=>({SUPABASE_URL:'https://project.fixture.invalid',SUPABASE_SECRET_KEYS:JSON.stringify({default:'sb_secret_fixture_server'}),SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:'sb_publishable_fixture'})}[name]);
  const handler=createHandler({environment,fetcher:bridge,...XML,allowedHosts:['fixture.example.test']});
  const run=()=>handler(new Request('https://edge.fixture.invalid',{method:'POST',headers:{apikey:'sb_secret_fixture_server'},body:JSON.stringify({action:'run'})}));
  let late;
  for(let attempt=0;attempt<3;attempt++){const response=await run();assert(response.status>=400);assert.equal(state().unfinished_count,attempt);assert.equal(state().last_error,null);assert(state().lease_token);assert.equal(claim(),null);late={...state(),connection_id:c.id};expireLease();}
  assert(worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id),'termination claim remains scheduled');
  const stopped=await run();assert.equal(stopped.status,200);const reply=await stopped.json();
  const frozen=state();for(let repeat=0;repeat<3;repeat++){const response=await run();assert.equal(response.status,200);assert.equal((await response.json()).checked,0);assert.deepEqual(state(),frozen);}
  test('actual handler '+failure+' stops after three abandoned leases with one durable error',()=>{assert.equal(reply.failed,1);assert.equal(reply.checked,1);assert.equal(feedCalls,3);assert.equal(finishCalls,3);assert.equal(frozen.unfinished_count,3);assert.equal(frozen.last_error,'server_error');assert.equal(frozen.lease_token,null);assert.equal(frozen.failure_count,0);assert.equal(list().connections.find(row=>row.id===c.id).auto_retry,false);assert.equal(sql(`select count(*) from haedo_rss_private.receipts where connection_id='${c.id}';`),'1');assert.equal(finish(late,[entry('too-late')]).status,'stale');assert.deepEqual(state(),frozen);});control('disconnect');
 }
 installOld();lease=claim();expireLease();lease=claim();assert.equal(state().unfinished_count,1);
 const completedLease=lease,completedError=finish(lease,[],{complete:false,error:'network_error'});assert.equal(state().unfinished_count,0);
 due();lease=claim();expireLease();lease=claim();assert.equal(state().unfinished_count,1);
 test('only a newly committed finish resets unfinished count, not receipt replay or stale work',()=>{assert.deepEqual(finish(completedLease,[],{complete:false,error:'network_error'}),completedError);assert.equal(state().unfinished_count,1);control('pause');control('resume');assert.equal(state().unfinished_count,1);assert.equal(finish(lease,[entry('paused-late')]).status,'stale');assert.equal(state().unfinished_count,1);lease=claim();finish(lease,[entry('unfinished-recovered')]);assert.equal(state().unfinished_count,0);});control('disconnect');
 installOld();
 for(let series=0;series<3;series++){
  for(let attempt=0;attempt<3;attempt++){assert(claim().lease_token);expireLease();}
  const stop=claim();assert.equal(stop.error,'server_error');assert.equal(state().unfinished_count,3);assert.equal(claim(),null);
  if(series<2){control('retry');assert.equal(state().unfinished_count,0);assert.equal(state().last_error,null);}
 }
 test('CPU-style claim without finish stops and manual recovery remains bounded twice hourly',()=>{error(()=>control('retry'),'rss_retry_limit');assert.equal(state().retry_count,2);assert.equal(state().unfinished_count,3);assert.equal(state().last_error,'server_error');assert(!worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id));});control('disconnect');
 // Independent executable mutations: remove whole guards and demand the same assertions fail.
 c=actor(A,`select public.life_rss_save('${W}',${lit(feed)});`);lease=claim();finish(lease,[]);control('activate');due();lease=claim();control('pause');
 mutation('revision/status lease fencing',"if not found or not(c.feed_url=any((select allowed_feed_urls from haedo_rss_private.runtime where singleton)::text[])) or c.revision<>p_revision or c.lease_token is distinct from p_lease_token or c.lease_until<=stamp or c.status not in('pending','active') then",'if false then',()=>assert.equal(finish(lease,[entry('mutation-late')]).status,'stale'));
 control('resume');due();lease=claim();
 mutation('date quarantine',"if published is null then reason:='date_unknown';","if false then reason:='date_unknown';",()=>{finish(lease,[entry('mutation-unknown',{published_at:null})]);assert.equal(allItems().find(i=>i.identity==='guid:mutation-unknown').disposition,'held');});
 control('disconnect');c=actor(A,`select public.life_rss_save('${W}',${lit(feed)});`);lease=claim();
 mutation('pending partial continuation stays immediately due',"next_check_at=case when p_error is null and (not p_complete or (status='active' and cursor is not null and sweep_new_count+new_identities>0 and not sweep_is_recheck)) then stamp else stamp+interval '60 minutes' end","next_check_at=stamp+interval '60 minutes'",()=>{finish(lease,[base],{next:pageURL(3),complete:false});assert(worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id));});
 due();
 mutation('scheduler includes pending baseline',"c.status in('pending','active')","c.status='active'",()=>assert(worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id)),'haedo_rss_private.due(integer)');
 control('disconnect');restart();lease=claim();finish(lease,[]);control('activate');lease=claim();
 mutation('active partial checkpoint is durable',"cursor=case when p_complete then null when p_next_cursor is not null then p_next_cursor else cursor end","cursor=null",()=>{finish(lease,[entry('checkpoint-mutation')],{next:pageURL(3),complete:false});assert.equal(state().cursor,pageURL(3));});
 mutation('known lookup excludes IDs first observed during this sweep',"((c.status='pending' and o.baseline_generation=c.baseline_generation) or (c.status='active' and o.first_observed_at<c.sweep_started_at))",'true',()=>assert.deepEqual(rssKnown(['guid:checkpoint-mutation']),[]),'haedo_rss_private.known(uuid,uuid,jsonb)');
 control('disconnect');restart();sql(`update haedo_rss_private.connections set baseline_pages=49 where id='${c.id}';`);lease=claim();
 mutation('fifty-page baseline partial halts automatically',"if page_cap+accepted_pages>=50 and not p_complete and p_error is null then","if false then",()=>{finish(lease,[entry('cap-mutation')],{next:pageURL(51),complete:false});assert.equal(state().last_error,'baseline_page_limit');});
 control('disconnect');restart();lease=claim();finish(lease,[]);control('activate');lease=claim();
 finish(lease,[entry('unknown-one',{identity:'unidentified:one',hold_reason:'missing_identity'})],{next:pageURL(3),complete:false});lease=claim();
 mutation('completed unidentified sweep returns to hourly cadence',"cursor is not null and sweep_new_count+new_identities>0 and not sweep_is_recheck)) then stamp","cursor is not null and not sweep_is_recheck)) then stamp",()=>{finish(lease,[entry('unknown-two',{identity:'unidentified:two',hold_reason:'missing_identity'})]);assert(!worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id));});
 control('disconnect');restart();lease=claim();finish(lease,[]);control('activate');lease=claim();
 mutation('new unidentified identities do not trigger another immediate sweep',"if c.status='active' and not observed_before and item->>'identity' ~ '^(guid:|atom:|url:)' then","if c.status='active' and not observed_before then",()=>{finish(lease,[entry('new-unknown-one',{identity:'unidentified:new-one',hold_reason:'missing_identity'})],{next:pageURL(3),complete:false});const tail=claim();finish(tail,[entry('new-unknown-two',{identity:'unidentified:new-two',hold_reason:'missing_identity'})]);assert(!worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id));});
 control('disconnect');installOld();lease=claim();finish(lease,[entry('limited-head')],{next:pageURL(3),complete:false});lease=claim();finish(lease,[entry('limited-tail')]);lease=claim();finish(lease,[entry('limited-recheck-head')],{next:pageURL(3),complete:false});lease=claim();
 mutation('one consecutive immediate fresh sweep limit',"and not sweep_is_recheck)) then stamp",")) then stamp",()=>{finish(lease,[entry('limited-recheck-tail')]);assert(!worker('select public.life_rss_due(2);').some(row=>row.connection_id===c.id));});
 control('disconnect');installOld();for(let attempt=0;attempt<3;attempt++){claim();expireLease();}
 mutation('three unfinished lease stop',"if c.lease_until is not null and c.unfinished_count>=2 then","if false then",()=>{assert.equal(claim().error,'server_error');},'haedo_rss_private.claim(uuid,uuid)');
 control('disconnect');installOld();claim();expireLease();lease=claim();
 mutation('committed finish resets unfinished lease series',"lease_until=null,unfinished_count=0,last_checked_at=stamp","lease_until=null,last_checked_at=stamp",()=>{finish(lease,[entry('reset-mutation')]);assert.equal(state().unfinished_count,0);});
 console.log(JSON.stringify({checks,mutations,pass:true,image,migration,liveDatabase:false,realFeed:false}));
 }finally{if(started){const v=docker(['inspect',container,'--format',`{{ index .Config.Labels "${label}" }}`]).trim();assert.equal(v,owner);docker(['rm','-f',container]);}}}
main().catch(e=>{console.error(e.stderr?.toString()||e.stack||e);process.exitCode=1;});

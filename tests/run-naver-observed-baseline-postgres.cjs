/* Disposable, pinned PostgreSQL only. Uses real migration/functions with Auth
 * and Storage metadata shims; no hosted database, Naver, cron or object bytes. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
if(process.argv.length!==2)throw Error('No endpoint, credential or SQL options are accepted.');
const root=path.resolve(__dirname,'..'),migration='supabase/migrations/20261029112456_naver_observed_inventory_baseline.sql';
const source=fs.readFileSync(path.join(root,migration),'utf8'),image='postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3';
const label='haedo.naver-observed-owner',owner=randomUUID(),container='haedo-naver-observed-'+process.pid+'-'+owner,database='haedo_naver_observed',env={...process.env};
for(const key of Object.keys(env))if(/^(PG|DATABASE_URL$|SUPABASE|HAEDO_TEST_|DOCKER_HOST$|DOCKER_CONTEXT$|DOCKER_TLS$|DOCKER_TLS_VERIFY$|DOCKER_CERT_PATH$)/.test(key))delete env[key];
const docker=(args,input)=>execFileSync('docker',['--host=unix:///var/run/docker.sock',...args],{env,input,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']});
const sql=s=>docker(['exec','-i',container,'psql','--host=127.0.0.1','-U','postgres','-d',database,'-qAt','-v','ON_ERROR_STOP=1'],s).trim();
const lit=x=>x===null?'null':"'"+String(x).replaceAll("'","''")+"'",jlit=x=>lit(JSON.stringify(x))+'::jsonb';
const json=x=>JSON.parse(x.split('\n').findLast(line=>/^(?:\{|\[|null|true|false)/.test(line)));
const actor=(who,q)=>json(sql("set role authenticated;select set_config('request.jwt.claims',"+lit(JSON.stringify({sub:who,role:'authenticated'}))+",false);"+q));
const worker=q=>json(sql('set role service_role;'+q));
const entry=n=>({logNo:String(n),title:'합성 관측 '+n,publishedAt:null});
const A=randomUUID(),B=randomUUID(),checks=[],report={pass:false,image,migration,checks,hostedDatabaseAccess:false,realNaverAccess:false,cronActivated:false};
let started=false,counter=0;
const check=(name,fn)=>{fn();checks.push(name);console.log('PASS '+name);};
const fresh=()=>{const sub=actor(A,`select public.life_naver_save('${randomUUID()}','observed_${++counter}',0,false);`);sub.owner=A;actor(A,`select public.life_naver_inventory_start('${sub.id}',${sub.revision});`);return sub;};
const inv=sub=>json(sql(`select to_jsonb(i) from haedo_naver_private.inventory i where subscription_id='${sub.id}';`));
const queue=sub=>json(sql(`select coalesce(jsonb_agg(log_no order by length(log_no),log_no),'[]') from haedo_naver_private.capture_jobs where subscription_id='${sub.id}';`));
const claim=sub=>worker(`select public.life_naver_inventory_claim(1,'${sub.id}','${sub.owner}');`)[0];
const finish=(lease,rows,total,next,probe=null,error=null,legacy=false)=>worker(`select public.life_naver_inventory_finish${legacy?'':'_observed'}('${lease.subscription_id}','${lease.lease_token}',${lease.revision},${lease.page},${jlit(rows)},${total??'null'},${next??'null'},${lit(error)}${legacy?'':','+jlit(probe)});`);
const ids=rows=>rows.map(row=>row.logNo);
const probe=(head,tail,total)=>({head:{total,logNos:ids(head)},tail:{total,logNos:ids(tail)}});
const start=sub=>actor(A,`select public.life_naver_inventory_start('${sub.id}',${sub.revision});`);
const scan=(sub,rows,total,{witness=true,mutateProbe}={})=>{
 let result,lease;const head=rows.slice(0,30);
 for(let offset=0;offset<rows.length;offset+=30){lease=claim(sub);assert(lease);const tail=rows.slice(offset,offset+30),terminal=offset+30>=rows.length;
  let p=terminal&&witness?probe(head,tail,total):null;if(p&&mutateProbe)p=mutateProbe(p);
  result=finish(lease,tail,total,terminal?null:lease.page+1,p);
 }return{result,lease};
};
const toggle=(sub,enabled)=>{const next=actor(A,`select public.life_naver_save('${sub.workspace_id}','${sub.blog_id}',${sub.revision},${enabled});`);Object.assign(sub,next);};
const rows32=Array.from({length:32},(_,n)=>entry(100-n));
const baseline=sub=>[inv(sub).baseline_completed_at,inv(sub).baseline_scan_id,inv(sub).baseline_count,inv(sub).baseline_method];
const errorLike=(fn,text)=>assert.throws(fn,e=>String(e.stderr||e.message).includes(text));
async function main(){
 try{
  docker(['image','inspect',image]);docker(['run','--detach','--pull=never','--network=none','--name',container,'--label',label+'='+owner,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);started=true;
  const info=JSON.parse(docker(['inspect',container,'--format','{{json .}}']));assert.equal(info.HostConfig.NetworkMode,'none');assert.equal(Object.keys(info.HostConfig.PortBindings||{}).length,0);
  const deadline=Date.now()+45000;for(;;){try{docker(['exec',container,'pg_isready','--host=127.0.0.1','-U','postgres']);break;}catch(_){if(Date.now()>=deadline)throw Error('Owned PostgreSQL not ready');await new Promise(r=>setTimeout(r,200));}}
  docker(['exec',container,'createdb','-U','postgres',database]);
  sql(fs.readFileSync(path.join(root,'supabase/tests/naver-bootstrap.sql'),'utf8'));
  sql(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;
   grant usage on schema storage to anon,authenticated,service_role;grant select,insert,update,delete on storage.objects to authenticated;`);
  for(const file of ['20261021093111_life_naver_subscriptions.sql','20261021094614_naver_conflict_http409.sql','20261021113658_life_naver_captures.sql','20261029040646_naver_inventory_automatic_rescan.sql'])sql(fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
  sql('update haedo_naver_private.runtime set ready=true;');
  const original=fresh();let lease=claim(original);finish(lease,rows32.slice(0,30),31,2,null,null,true);lease=claim(original);finish(lease,rows32.slice(30),null,null,null,null,true);
  check('original terminal count mismatch remains partial with all identities preserved and no baseline',()=>{
   assert.equal(inv(original).status,'partial');assert.equal(inv(original).baseline_completed_at,null);assert.deepEqual(queue(original),[]);
   assert.equal(Number(sql(`select count(*) from haedo_naver_private.inventory_seen where subscription_id='${original.id}';`)),32);
  });
  const capture=randomUUID(),job=randomUUID();sql(`insert into public.life_naver_captures(id,owner_id,blog_id,log_no,capture_hash,payload) values('${capture}','${A}','preserved_fixture','1','${'a'.repeat(64)}','{"exact":"body/photo fixture"}');
   insert into haedo_naver_private.capture_jobs(id,owner_id,subscription_id,blog_id,log_no,progress) values('${job}','${A}','${original.id}','preserved_fixture','1','{"exact":"pending photo checkpoint"}');
   insert into haedo_naver_private.capture_assets values('preserved/path','${A}','${'b'.repeat(64)}','image/jpeg',7);`);
  const preserved=()=>sql(`select jsonb_build_object('capture',(select to_jsonb(c) from public.life_naver_captures c where id='${capture}'),'job',(select to_jsonb(j) from haedo_naver_private.capture_jobs j where id='${job}'),'assets',(select jsonb_agg(to_jsonb(a)) from haedo_naver_private.capture_assets a),'oldSeen',(select jsonb_agg(to_jsonb(z) order by scan_id,log_no) from haedo_naver_private.inventory_seen z where subscription_id='${original.id}'),'oldReceipts',(select jsonb_agg(to_jsonb(r) order by lease_token) from haedo_naver_private.capture_receipts r where id='${original.id}'));`);
  const immutableBefore=preserved(),acl=()=>sql("select jsonb_agg(jsonb_build_array(oid::text,proowner,proacl::text,prosecdef,proconfig) order by oid) from pg_proc where oid in ('haedo_naver_private.inventory_finish(uuid,uuid,bigint,integer,jsonb,integer,integer,text)'::regprocedure,'haedo_naver_private.inventory_claim(integer,uuid,uuid)'::regprocedure);");
  const originalAcl=acl();
  check('migration failure rolls back additive schema and both existing function replacements',()=>{
   const old=sql("select pg_get_functiondef('haedo_naver_private.inventory_finish(uuid,uuid,bigint,integer,jsonb,integer,integer,text)'::regprocedure);");
   errorLike(()=>sql(source.replace(/commit;\s*$/,'select 1/0;commit;')),'division by zero');
   assert.equal(sql("select to_regclass('haedo_naver_private.inventory_scan_observations') is null;"),'t');
   assert.equal(sql("select pg_get_functiondef('haedo_naver_private.inventory_finish(uuid,uuid,bigint,integer,jsonb,integer,integer,text)'::regprocedure);"),old);
   assert.equal(preserved(),immutableBefore);
  });
  sql(source);
  check('additive install preserves readiness, old receipts, seen sets, source/photo checkpoints and ACLs',()=>{
   assert.equal(preserved(),immutableBefore);assert.equal(acl(),originalAcl);assert.equal(sql('select ready from haedo_naver_private.runtime;'),'t');
   assert.equal(sql("select bool_and(relrowsecurity) from pg_class where oid in ('haedo_naver_private.inventory_scan_observations'::regclass,'haedo_naver_private.inventory_observation_receipts'::regclass);"),'t');
   assert.equal(sql("select has_function_privilege('anon','public.life_naver_inventory_finish_observed(uuid,uuid,bigint,integer,jsonb,integer,integer,text,jsonb)','execute') or has_function_privilege('authenticated','public.life_naver_inventory_finish_observed(uuid,uuid,bigint,integer,jsonb,integer,integer,text,jsonb)','execute');"),'f');
  });
  check('old lease receipts cannot be retroactively converted into new witnesses',()=>errorLike(()=>finish(lease,rows32.slice(30),31,null,probe(rows32.slice(0,30),rows32.slice(30),31)),'observation_legacy_receipt'));
  const observed=fresh();let first;
  check('one complete witnessed mismatched scan remains partial and does not auto-collect baseline posts',()=>{
   first=scan(observed,rows32,31);assert.equal(first.result.observed_verified,true);assert.equal(first.result.baseline_promoted,false);
   assert.equal(inv(observed).baseline_completed_at,null);assert.equal(inv(observed).status,'partial');assert.deepEqual(queue(observed),[]);
  });
  check('exact proof replay returns the same receipt while changed proof is rejected',()=>{
   assert.deepEqual(finish(first.lease,rows32.slice(30),31,null,probe(rows32.slice(0,30),rows32.slice(30),31)),first.result);
   const altered=probe(rows32.slice(0,30),rows32.slice(30),31);altered.head.total=32;
   errorLike(()=>finish(first.lease,rows32.slice(30),31,null,altered),'operation_mismatch');
  });
  let accepted;
  check('two non-overlapping matching witnessed scans establish observed baseline without changing source total',()=>{
   start(observed);accepted=scan(observed,rows32,31);assert.notEqual(first.lease.scan_id,accepted.lease.scan_id);
   assert.equal(accepted.result.baseline_promoted,true);assert.equal(inv(observed).baseline_method,'observed_set');assert.equal(inv(observed).baseline_count,32);
   assert.equal(inv(observed).total_start,31);assert.equal(inv(observed).status,'complete');assert.deepEqual(queue(observed),[]);
   assert.equal(sql(`select bool_and(baseline and not auto_eligible and observed_discovery_revision is null) from haedo_naver_private.inventory_entries where subscription_id='${observed.id}';`),'t');
  });
  const fixedBaseline=baseline(observed);toggle(observed,true);
  check('observed follow-up discoveries are held until a witnessed full scan then queued once',()=>{
   start(observed);const rows=[entry(101),...rows32],head=rows.slice(0,30),tail=rows.slice(30);let l=claim(observed);
   finish(l,head,32,2);assert.deepEqual(queue(observed),[]);assert.equal(sql(`select auto_eligible from haedo_naver_private.inventory_entries where subscription_id='${observed.id}' and log_no='101';`),'f');
   l=claim(observed);const result=finish(l,tail,32,null,probe(head,tail,32));assert.equal(result.observed_verified,true);assert.equal(inv(observed).status,'complete');assert.deepEqual(queue(observed),['101']);
   assert.deepEqual(finish(l,tail,32,null,probe(head,tail,32)),result);assert.deepEqual(queue(observed),['101']);assert.deepEqual(baseline(observed),fixedBaseline);
  });
  check('missing proof preserves every row and defers new jobs; a fresh valid retry recovers the pending discovery',()=>{
   const rows=[entry(102),entry(101),...rows32];start(observed);const failed=scan(observed,rows,33,{witness:false});
   assert.equal(failed.result.observed_verified,false);assert.equal(inv(observed).status,'partial');assert.deepEqual(queue(observed),['101']);
   start(observed);scan(observed,rows,33);assert.deepEqual(queue(observed),['101','102']);assert.deepEqual(baseline(observed),fixedBaseline);
  });
  check('normal exact-count follow-up still requires proof and keeps observed baseline method',()=>{
   start(observed);const rows=[entry(103),entry(102),entry(101),...rows32];const failed=scan(observed,rows,35,{witness:false});
   assert.equal(failed.result.inventory.status,'partial');assert.deepEqual(queue(observed),['101','102']);
   start(observed);scan(observed,rows,35);assert.equal(inv(observed).baseline_method,'observed_set');assert.deepEqual(queue(observed),['101','102','103']);
  });
  check('legacy exact finish cannot complete or auto-queue an observed-method scan',()=>{
   start(observed);const rows=[entry(104),entry(103),entry(102),entry(101),...rows32];let l=claim(observed);finish(l,rows.slice(0,30),36,2,null,null,true);
   l=claim(observed);const r=finish(l,rows.slice(30),36,null,null,null,true);assert.equal(r.inventory.status,'partial');assert.deepEqual(queue(observed),['101','102','103']);
  });
  check('a stopped/re-enabled connection never retroactively auto-collects the prior revision discovery',()=>{
   toggle(observed,false);toggle(observed,true);start(observed);const rows=[entry(105),entry(104),entry(103),entry(102),entry(101),...rows32];
   scan(observed,rows,37);assert.deepEqual(queue(observed),['101','102','103','105']);assert.deepEqual(baseline(observed),fixedBaseline);
  });
  check('count-exact and null legacy baselines retain their original single-scan behavior',()=>{
   const exact=fresh();const r=scan(exact,[entry(5),entry(4)],2,{witness:false}).result;
   assert.equal(r.inventory.status,'complete');assert.equal(inv(exact).baseline_method,'count_exact');assert.equal(inv(exact).baseline_count,2);
   const legacy=fresh();const l=claim(legacy);finish(l,[entry(3)],1,null,null,null,true);
   assert.equal(inv(legacy).status,'complete');assert.equal(inv(legacy).baseline_method,null);assert.deepEqual(queue(legacy),[]);
  });
  check('a null first total and an unrecorded legacy page cannot count as a verified observation',()=>{
   for(const legacy of [false,true]){const sub=fresh();let l=claim(sub);finish(l,rows32.slice(0,30),legacy?31:null,2,null,null,legacy);l=claim(sub);
    const r=finish(l,rows32.slice(30),31,null,probe(rows32.slice(0,30),rows32.slice(30),31));assert.equal(r.observed_verified,false);assert.equal(inv(sub).baseline_completed_at,null);assert.deepEqual(queue(sub),[]);
   }
  });
  check('transport failure receipts resume the same scan without losing its valid page chain',()=>{
   const sub=fresh();let l=claim(sub);finish(l,rows32.slice(0,30),31,2);l=claim(sub);
   const failed=finish(l,[],null,null,null,'network_error');assert.deepEqual(finish(l,[],null,null,null,'network_error'),failed);
   const retry=claim(sub);assert.equal(retry.scan_id,l.scan_id);assert.equal(retry.page,2);
   const r=finish(retry,rows32.slice(30),31,null,probe(rows32.slice(0,30),rows32.slice(30),31));
   assert.equal(r.observed_verified,true);assert.equal(r.baseline_promoted,false);assert.deepEqual(queue(sub),[]);
  });
  check('changed source total and cross-page duplicates are preserved but never verified or promoted',()=>{
   for(const changed of [true,false]){const sub=fresh();let l=claim(sub);finish(l,rows32.slice(0,30),31,2);l=claim(sub);
    const tail=changed?rows32.slice(30):[rows32[0],rows32[31]],total=changed?32:31;
    const r=finish(l,tail,total,null,probe(rows32.slice(0,30),tail,total));assert.equal(r.observed_verified,false);assert.equal(inv(sub).baseline_completed_at,null);assert.deepEqual(queue(sub),[]);
   }
  });
  check('wrong head, tail order, probe shape and total never establish a witness',()=>{
   const mutations=[p=>({...p,extra:true}),p=>({...p,head:{...p.head,total:32}}),p=>({...p,head:{...p.head,logNos:[...p.head.logNos].reverse()}}),p=>({...p,tail:{...p.tail,logNos:[...p.tail.logNos].reverse()}}),p=>({...p,head:{...p.head,logNos:['bad']}}),p=>({...p,head:{...p.head,logNos:'not an array'}})];
   for(const mutateProbe of mutations){const sub=fresh();const r=scan(sub,rows32,31,{mutateProbe}).result;assert.equal(r.observed_verified,false);assert.equal(inv(sub).baseline_completed_at,null);assert.deepEqual(queue(sub),[]);}
  });
  check('different equal-sized ID sets and overlapping scan evidence do not form a baseline pair',()=>{
   const sub=fresh();scan(sub,rows32,31);start(sub);scan(sub,[...rows32.slice(0,31),entry(1)],31);assert.equal(inv(sub).baseline_completed_at,null);
   start(sub);scan(sub,rows32,31);assert.equal(inv(sub).baseline_completed_at,null,'A/B/A is not two consecutive matching observations');
   start(sub);scan(sub,rows32,31);assert.equal(inv(sub).baseline_method,'observed_set','the next A forms an independent consecutive A/A pair');
   assert.equal(sql(`select baseline and not auto_eligible from haedo_naver_private.inventory_entries where subscription_id='${sub.id}' and log_no='1';`),'t');
   const overlap=fresh();scan(overlap,rows32,31);start(overlap);const l=claim(overlap);finish(l,rows32.slice(0,30),31,2);
   sql(`update haedo_naver_private.inventory_scan_observations set started_at='2000-01-01' where subscription_id='${overlap.id}' and scan_id='${l.scan_id}';`);
   const end=claim(overlap),r=finish(end,rows32.slice(30),31,null,probe(rows32.slice(0,30),rows32.slice(30),31));assert.equal(r.baseline_promoted,false);assert.equal(inv(overlap).baseline_completed_at,null);
  });
  check('runtime pause and changed subscription revision fence late finishes without any witness or data mutation',()=>{
   const sub=fresh(),l=claim(sub);const before=sql(`select count(*) from haedo_naver_private.inventory_observation_receipts;`);
   sql('update haedo_naver_private.runtime set ready=false;');assert.equal(finish(l,rows32.slice(0,30),31,2).status,'stale');
   assert.equal(sql('select count(*) from haedo_naver_private.inventory_observation_receipts;'),before);sql('update haedo_naver_private.runtime set ready=true;');
   toggle(sub,true);assert.equal(finish(l,rows32.slice(0,30),31,2).status,'stale');assert.equal(sql('select count(*) from haedo_naver_private.inventory_observation_receipts;'),before);
   const expired=fresh(),late=claim(expired);sql(`update haedo_naver_private.inventory set lease_until=clock_timestamp()-interval '1 second' where subscription_id='${expired.id}';`);
   assert.equal(finish(late,rows32.slice(0,30),31,2).status,'stale');
   const cas=fresh(),current=claim(cas);assert.equal(finish({...current,revision:current.revision+1},rows32.slice(0,30),31,2).status,'stale');
   assert.equal(sql('select count(*) from haedo_naver_private.inventory_observation_receipts;'),before);
  });
  check('old row validation failure rolls back the wrapper observation and its receipt atomically',()=>{
   const sub=fresh(),l=claim(sub),before=inv(sub),row={...entry(2),title:''};
   errorLike(()=>finish(l,[row],1,null),'invalid_inventory');assert.deepEqual(inv(sub),before);
   assert.equal(sql(`select count(*) from haedo_naver_private.inventory_scan_observations where subscription_id='${sub.id}';`),'0');
   assert.equal(sql(`select count(*) from haedo_naver_private.inventory_observation_receipts where subscription_id='${sub.id}';`),'0');
  });
  check('foreign owners, anonymous and authenticated roles cannot supply worker evidence',()=>{
   const sub=fresh();assert.deepEqual(worker(`select public.life_naver_inventory_claim(1,'${sub.id}','${B}');`),[]);
   errorLike(()=>actor(B,`select public.life_naver_inventory_start('${sub.id}',1);`),'owner_required');
   for(const role of ['anon','authenticated'])errorLike(()=>sql(`set role ${role};select public.life_naver_inventory_finish_observed(null,null,1,1,'[]',0,null,null,null);`),'permission denied');
  });
  check('all source/photo checkpoints, old seen sets and old receipts remain byte-exact after the new flows',()=>assert.equal(preserved(),immutableBefore));
  report.pass=true;
 }finally{
  if(started){const info=JSON.parse(docker(['inspect',container,'--format','{{json .}}']));assert.equal(info.Config.Labels[label],owner);docker(['rm','--force','--volumes',info.Id]);report.containerRemoved=true;}
  report.migrationSHA256=createHash('sha256').update(source).digest('hex');fs.mkdirSync(path.join(root,'.local/naver-observed-baseline'),{recursive:true});fs.writeFileSync(path.join(root,'.local/naver-observed-baseline/report.json'),JSON.stringify(report,null,2)+'\n');
 }
 console.log(checks.length+' observed baseline PostgreSQL checks passed; owned container removed.');
}
main().catch(error=>{console.error('FAIL observed baseline SQL: '+error.message);process.exitCode=1;});

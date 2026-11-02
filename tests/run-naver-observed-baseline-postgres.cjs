/* Disposable, pinned PostgreSQL only. Uses real migration/functions with Auth
 * and Storage metadata shims; no hosted database, Naver, cron or object bytes. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
if(process.argv.length!==2)throw Error('No endpoint, credential or SQL options are accepted.');
const root=path.resolve(__dirname,'..'),migration='supabase/migrations/20261029112456_naver_observed_inventory_baseline.sql';
const enableMigration='supabase/migrations/20261102100000_naver_enable_schedules_first_inventory.sql',enableSource=fs.readFileSync(path.join(root,enableMigration),'utf8');
const conflictSource=fs.readFileSync(path.join(root,'supabase/migrations/20261021094614_naver_conflict_http409.sql'),'utf8');
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
const A=randomUUID(),B=randomUUID(),checks=[],report={pass:false,image,migration,enableMigration,checks,hostedDatabaseAccess:false,realNaverAccess:false,cronActivated:false};
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
  // 2026-11-02: saving a connection as enabled schedules its first inventory row.
  const saveBody=/create or replace function haedo_naver_private\.save\([^$]+?as \$\$([\s\S]*?)\$\$;/,oldSaveBody=conflictSource.match(saveBody)[1].trim(),newSaveBody=enableSource.match(saveBody)[1].trim();
  const anchor=" end if;\n return (to_jsonb(sub)";assert.equal(oldSaveBody.split(anchor).length,2);
  const saveMeta=()=>sql("select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_userbyid(p.proowner),p.proacl::text,p.prosecdef,p.proconfig,p.provolatile,pg_get_function_result(p.oid)) order by p.oid) from pg_proc p where p.oid in ('haedo_naver_private.save(uuid,text,bigint,boolean)'::regprocedure,'public.life_naver_save(uuid,text,bigint,boolean)'::regprocedure);");
  const saveSrc=()=>sql("select prosrc from pg_proc where oid='haedo_naver_private.save(uuid,text,bigint,boolean)'::regprocedure;");
  const allInventory=()=>sql('select coalesce(jsonb_agg(to_jsonb(i) order by subscription_id),\'[]\') from haedo_naver_private.inventory i;');
  const rowCount=sub=>Number(sql(`select count(*) from haedo_naver_private.inventory where subscription_id='${sub.id}';`));
  const save=(workspace,blog,revision,enabled)=>{const s=actor(A,`select public.life_naver_save('${workspace}','${blog}',${revision},${enabled});`);s.owner=A;return s;};
  const serviceClaim=()=>worker('select public.life_naver_inventory_claim(2);');
  const legacyOn=save(randomUUID(),'legacy_enabled',0,true),legacyOff=save(randomUUID(),'legacy_disabled',0,false);
  // Backfill conflict paths: enabled connections whose rows already exist (complete baseline / running lease).
  const legacyComplete=save(randomUUID(),'legacy_complete',0,true);start(legacyComplete);finish(claim(legacyComplete),[entry(17),entry(16)],2,null);
  const legacyRunning=save(randomUUID(),'legacy_running',0,true);start(legacyRunning);const runningLease=claim(legacyRunning);
  const rowText=sub=>sql(`select to_jsonb(i)::text from haedo_naver_private.inventory i where subscription_id='${sub.id}';`);
  const completeText=rowText(legacyComplete),runningText=rowText(legacyRunning);
  const naverCounts=()=>sql(`select jsonb_build_object(${['haedo_naver_private.inventory','haedo_naver_private.inventory_entries','haedo_naver_private.inventory_seen','haedo_naver_private.capture_jobs','haedo_naver_private.capture_receipts','haedo_naver_private.inventory_scan_observations','haedo_naver_private.inventory_observation_receipts','public.life_naver_subscriptions','public.life_naver_captures'].map(t=>`'${t}',(select count(*) from ${t})`).join(',')});`);
  const inventoryBefore=allInventory(),saveMetaBefore=saveMeta(),countsBefore=naverCounts();
  check('pre-change save leaves an enabled connection without inventory, so the service claim skips it',()=>{
   assert.equal(saveSrc(),oldSaveBody);assert.equal(rowCount(legacyOn),0);assert.deepEqual(serviceClaim(),[]);
   const complete=inv(legacyComplete),running=inv(legacyRunning);
   assert.equal(complete.status,'complete');assert.ok(complete.baseline_completed_at);assert.equal(complete.baseline_count,2);
   assert.equal(running.status,'running');assert.ok(running.lease_token);assert.equal(running.lease_token,runningLease.lease_token);
  });
  const unchangedSinceBefore=()=>{assert.equal(saveSrc(),oldSaveBody);assert.equal(saveMeta(),saveMetaBefore);assert.equal(allInventory(),inventoryBefore);assert.equal(naverCounts(),countsBefore);assert.equal(rowCount(legacyOn),0);};
  check('enable-schedule migration failure rolls back the save replacement and the backfill',()=>{
   errorLike(()=>sql(enableSource.replace(/commit;\s*$/,'select 1/0;commit;')),'division by zero');unchangedSinceBefore();
  });
  check('row guard violations during the backfill roll back the whole install with a fixed code',()=>{
   // Test-only trigger outside the migration forces each guarded mismatch while the backfill inserts.
   sql(`create function public.haedo_test_force_guard() returns trigger language plpgsql as $$begin
     if pg_trigger_depth()>1 then return null;end if;
     case current_setting('haedo_test.violation',true)
      when 'prior_row' then update haedo_naver_private.inventory set last_error='forced_guard' where subscription_id<>new.subscription_id;
      when 'other_table' then insert into haedo_naver_private.inventory_seen values(new.subscription_id,gen_random_uuid(),'1');
      when 'extra_inventory' then insert into haedo_naver_private.inventory(subscription_id,owner_id) select s.id,s.owner_id from public.life_naver_subscriptions s
        where not s.enabled and not exists(select 1 from haedo_naver_private.inventory i where i.subscription_id=s.id) limit 1;
      else null;
     end case;return null;end$$;
    create trigger haedo_test_force_guard after insert on haedo_naver_private.inventory for each row execute function public.haedo_test_force_guard();`);
   try{
    for(const mode of ['prior_row','other_table','extra_inventory']){
     errorLike(()=>sql(`set haedo_test.violation='${mode}';`+enableSource),'life_naver_enable_guard_mismatch');unchangedSinceBefore();
    }
   }finally{sql('drop trigger haedo_test_force_guard on haedo_naver_private.inventory;drop function public.haedo_test_force_guard();');}
   assert.equal(sql("select count(*) from pg_trigger where tgrelid='haedo_naver_private.inventory'::regclass and not tgisinternal;"),'0');unchangedSinceBefore();
  });
  sql(enableSource);
  check('install changes only the save body, keeps ACL/definer/search_path and backfills only enabled connections without rows',()=>{
   assert.equal(newSaveBody,oldSaveBody.replace(anchor," end if;\n if sub.enabled then\n  insert into haedo_naver_private.inventory(subscription_id,owner_id) values(sub.id,sub.owner_id) on conflict (subscription_id) do nothing;\n end if;\n return (to_jsonb(sub)"));
   assert.equal(saveSrc(),newSaveBody);assert.equal(saveMeta(),saveMetaBefore);
   const after=JSON.parse(allInventory()),before=JSON.parse(inventoryBefore);
   assert.deepEqual(after.filter(row=>row.subscription_id!==legacyOn.id),before,'existing inventory rows stay byte-exact');
   assert.equal(rowText(legacyComplete),completeText,'enabled complete-baseline row is byte-exact after the backfill conflict');
   assert.equal(rowText(legacyRunning),runningText,'enabled running/leased row is byte-exact after the backfill conflict');
   const counts=JSON.parse(naverCounts()),prior=JSON.parse(countsBefore);assert.equal(counts['haedo_naver_private.inventory'],prior['haedo_naver_private.inventory']+1);
   assert.deepEqual({...counts,'haedo_naver_private.inventory':0},{...prior,'haedo_naver_private.inventory':0});
   assert.equal(rowCount(legacyOff),0);const row=inv(legacyOn);assert.equal(row.status,'pending');assert.equal(row.page,1);assert.equal(row.baseline_completed_at,null);
   const reinstalled=allInventory();sql(enableSource);assert.equal(allInventory(),reinstalled,'reinstall is idempotent');assert.equal(saveMeta(),saveMetaBefore);
   assert.equal(rowText(legacyRunning),runningText);assert.equal(finish(runningLease,[entry(19)],1,null).inventory.status,'complete');
   const claimed=serviceClaim();assert.deepEqual(claimed.map(l=>l.subscription_id),[legacyOn.id]);assert.equal(claimed[0].page,1);
   finish(claimed[0],[entry(7)],1,null);assert.equal(inv(legacyOn).status,'complete');
  });
  let enabledNew;
  check('case1 new connection saved enabled gets a pending page-1 inventory row and the service claim picks it',()=>{
   enabledNew=save(randomUUID(),'enabled_new',0,true);const row=inv(enabledNew);
   assert.equal(row.status,'pending');assert.equal(row.page,1);assert.equal(row.revision,1);assert.equal(row.owner_id,A);assert.ok(row.scan_id);
   assert.equal(row.baseline_completed_at,null);assert.equal(row.lease_token,null);assert.equal(row.last_error,null);
   assert.equal(sql(`select next_check_at<=clock_timestamp() from haedo_naver_private.inventory where subscription_id='${enabledNew.id}';`),'t');
   const claimed=serviceClaim();assert.deepEqual(claimed.map(l=>l.subscription_id),[enabledNew.id]);assert.equal(claimed[0].page,1);assert.equal(claimed[0].scan_id,row.scan_id);
   assert.equal(claimed[0].subscription_revision,enabledNew.revision);
   const r=finish(claimed[0],[entry(9),entry(8)],2,null);assert.equal(r.inventory.status,'complete');assert.equal(inv(enabledNew).baseline_method,'count_exact');
  });
  let disabledNew;
  check('case2 new connection saved disabled still gets no inventory row',()=>{
   disabledNew=save(randomUUID(),'disabled_new',0,false);assert.equal(disabledNew.enabled,false);assert.equal(rowCount(disabledNew),0);assert.deepEqual(serviceClaim(),[]);
  });
  check('case3 enabling a disabled connection without a row creates the pending row',()=>{
   toggle(disabledNew,true);assert.equal(disabledNew.enabled,true);assert.equal(rowCount(disabledNew),1);
   const row=inv(disabledNew);assert.equal(row.status,'pending');assert.equal(row.page,1);assert.equal(row.baseline_completed_at,null);
   const claimed=serviceClaim();assert.deepEqual(claimed.map(l=>l.subscription_id),[disabledNew.id]);finish(claimed[0],[entry(11)],1,null);
  });
  check('case4 disabling and re-enabling a connection with a complete baseline never overwrites its row',()=>{
   const before=inv(enabledNew);assert.equal(before.status,'complete');assert.ok(before.baseline_completed_at);assert.ok(before.baseline_scan_id);assert.equal(before.baseline_count,2);
   toggle(enabledNew,false);assert.deepEqual(inv(enabledNew),before);toggle(enabledNew,true);const after=inv(enabledNew);
   for(const key of ['baseline_completed_at','baseline_scan_id','baseline_count','baseline_method','status','page','scan_id'])assert.deepEqual(after[key],before[key],key);
   assert.deepEqual(after,before,'the whole existing row is unchanged');
  });
  check('case5 CAS conflicts stay life_naver_conflict and create no subscription or inventory row',()=>{
   const workspace=randomUUID(),rows=allInventory();
   errorLike(()=>save(workspace,'conflict_new',1,true),'life_naver_conflict');
   assert.equal(sql(`select count(*) from public.life_naver_subscriptions where workspace_id='${workspace}';`),'0');
   const off=save(randomUUID(),'conflict_existing',0,false),stored=allInventory();
   errorLike(()=>save(off.workspace_id,off.blog_id,off.revision+1,true),'life_naver_conflict');
   assert.equal(rowCount(off),0);assert.equal(allInventory(),stored);assert.equal(JSON.parse(stored).length,JSON.parse(rows).length);
   assert.equal(sql(`select enabled::text||':'||revision from public.life_naver_subscriptions where id='${off.id}';`),'false:'+off.revision);
  });
  check('case6 inventory_start on the automatically created pending row returns it unchanged',()=>{
   const sub=save(randomUUID(),'start_after_auto',0,true),before=inv(sub),view=start(sub);
   assert.equal(view.status,'pending');assert.equal(view.page,1);assert.equal(view.scan_id,before.scan_id);assert.equal(view.revision,before.revision);
   assert.deepEqual(inv(sub),before);const claimed=serviceClaim();assert.deepEqual(claimed.map(l=>l.subscription_id),[sub.id]);finish(claimed[0],[entry(13)],1,null);
  });
  check('case7 runtime ready=false still rejects enabling with setup_required and creates no row',()=>{
   const off=save(randomUUID(),'setup_existing',0,false),rows=allInventory(),workspace=randomUUID();
   sql('update haedo_naver_private.runtime set ready=false;');
   try{
    errorLike(()=>save(workspace,'setup_new',0,true),'life_naver_setup_required');
    errorLike(()=>save(off.workspace_id,off.blog_id,off.revision,true),'life_naver_setup_required');
    assert.equal(sql(`select count(*) from public.life_naver_subscriptions where workspace_id='${workspace}';`),'0');
    assert.equal(rowCount(off),0);assert.equal(allInventory(),rows);
   }finally{sql('update haedo_naver_private.runtime set ready=true;');}
  });
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
  report.migrationSHA256=createHash('sha256').update(source).digest('hex');report.enableMigrationSHA256=createHash('sha256').update(enableSource).digest('hex');fs.mkdirSync(path.join(root,'.local/naver-observed-baseline'),{recursive:true});fs.writeFileSync(path.join(root,'.local/naver-observed-baseline/report.json'),JSON.stringify(report,null,2)+'\n');
 }
 console.log(checks.length+' observed baseline PostgreSQL checks passed; owned container removed.');
}
main().catch(error=>{console.error('FAIL observed baseline SQL: '+error.message);process.exitCode=1;});

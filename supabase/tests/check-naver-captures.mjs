/* Synthetic PostgreSQL/Storage metadata only. No hosted data or object bytes. */
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const image='postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3';
const container=`haedo-naver-captures-${Date.now()}${process.pid}`,database='haedo_naver_captures';
const migration='supabase/migrations/20261021113658_life_naver_captures.sql';
const output=resolve(project,'.local/naver-capture-backend'),env={...process.env};
for(const name of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[name];
if(process.argv.slice(2).some(x=>x!=='--keep'))throw Error('Only --keep is accepted; no external endpoints.');
const keep=process.argv.includes('--keep'),endpoint=['--host=unix:///var/run/docker.sock'];
const docker=(args,input)=>execFileSync('docker',[...endpoint,...args],{input,env,encoding:'utf8',maxBuffer:8*1024*1024});
const sql=input=>docker(['exec','-i',container,'psql','-U','postgres','-d',database,'-qAt','-v','ON_ERROR_STOP=1'],input);
const run=promisify(execFile),json=s=>JSON.parse(s.trim().split('\n').findLast(x=>/^[{["\d]|^(null|true|false)$/.test(x)));
const lit=x=>x===null?'null':"'"+String(x).replaceAll("'","''")+"'";
const jlit=x=>lit(JSON.stringify(x))+'::jsonb';
const owner=(id,query)=>sql(`set role authenticated;select set_config('request.jwt.claims',${lit(JSON.stringify({sub:id,role:'authenticated'}))},false);${query}`);
const worker=query=>sql('set role service_role;'+query);
const parallel=input=>{
 const child=execFile('docker',[...endpoint,'exec','-i',container,'psql','-U','postgres','-d',database,'-qAt','-v','ON_ERROR_STOP=1'],{env,encoding:'utf8'});let out='',error='';
 child.stdout.on('data',s=>out+=s);child.stderr.on('data',s=>error+=s);
 const result=new Promise((yes,no)=>child.on('error',no).on('exit',code=>code?no(Error(error)):yes(out)));child.stdin.end(input);return result;
};
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const sha=x=>createHash('sha256').update(x).digest('hex');
const fingerprint=p=>sha(canonical(Object.fromEntries(Object.entries(p).filter(([k])=>k!=='extractedAt').map(([k,v])=>[k,k==='photos'?v.map(({storagePath,...rest})=>rest):v]))));
let owns=false;const report={image,container,database,migration,checks:[],pass:false,productionAccess:false,realNaverAccess:false,objectByteVerification:false};
const check=(name,fn)=>{fn();report.checks.push(name);console.log('PASS '+name);};
await mkdir(output,{recursive:true});
try{
 docker(['info','--format','{{.ServerVersion}}']);
 docker(['run','--detach','--network','none','--label','haedo-test=naver-captures','--name',container,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);owns=true;
 const isolation=JSON.parse(docker(['inspect',container,'--format','{{json .HostConfig}}']));assert.equal(isolation.NetworkMode,'none');assert.equal(Object.keys(isolation.PortBindings||{}).length,0);
 const deadline=Date.now()+45000;for(;;){try{await run('docker',[...endpoint,'exec',container,'pg_isready','--host=127.0.0.1','-U','postgres'],{env});break;}catch{if(Date.now()>deadline)throw Error('Local PostgreSQL readiness failed');await new Promise(r=>setTimeout(r,200));}}
 docker(['exec',container,'createdb','-U','postgres',database]);
 sql(await readFile(resolve(project,'supabase/tests/naver-bootstrap.sql'),'utf8'));
 sql(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated,service_role;grant select,insert,update,delete on storage.objects to authenticated;
 create policy other_permissive on storage.objects for all to authenticated using(true) with check(true);
 grant select on storage.objects to anon;create policy existing_anonymous_read on storage.objects for select to anon using(bucket_id='existing');
 insert into storage.buckets values('existing','existing',false,42,null);insert into storage.objects(bucket_id,name,metadata) values('existing','keep','{"size":7}');`);
 for(const f of ['20261021093111_life_naver_subscriptions.sql','20261021094614_naver_conflict_http409.sql'])sql(await readFile(resolve(project,'supabase/migrations',f),'utf8'));
 const a=randomUUID(),b=randomUUID(),ws=randomUUID(),ws2=randomUUID();
 const sub=json(owner(a,`select life_naver_save('${ws}','Mixed_Blog',0,false);`));
 const sub2=json(owner(a,`select life_naver_save('${ws2}','Mixed_Blog',0,false);`));
 const foreign=json(owner(b,`select life_naver_save('${randomUUID()}','Foreign',0,false);`));
 const oldSnapshot=()=>sql("select jsonb_build_object('subs',(select jsonb_agg(to_jsonb(s) order by id) from life_naver_subscriptions s),'items',(select jsonb_agg(to_jsonb(i) order by id) from life_naver_items i),'oldBucket',(select to_jsonb(b) from storage.buckets b where id='existing'),'oldObject',(select to_jsonb(o) from storage.objects o where bucket_id='existing'));").trim();
 const old=oldSnapshot(),source=await readFile(resolve(project,migration),'utf8');report.migrationSha256=sha(source);
 check('new migration failure is atomic',()=>{assert.throws(()=>sql(source.replace(/commit;\s*$/,'select 1/0;commit;')),/division by zero/);assert.equal(sql("select to_regclass('public.life_naver_captures') is null;").trim(),'t');assert.equal(oldSnapshot(),old);});
 sql(source);
 check('old subscriptions and other Storage bucket bytes preserved',()=>assert.equal(oldSnapshot(),old));
 check('existing anonymous Storage access survives without exposing new bucket',()=>{
  assert.equal(sql("set role anon;select count(*) from storage.objects where bucket_id='existing';").trim(),'1');
  assert.equal(sql("set role anon;select count(*) from storage.objects where bucket_id='haedo-naver-originals';").trim(),'0');
 });
 check('new private bucket and owner/worker ACL installed',()=>{
  assert.equal(sql("select not public and file_size_limit=67108864 from storage.buckets where id='haedo-naver-originals';").trim(),'t');
  assert.equal(sql("select count(*) from pg_policies where schemaname='storage' and policyname like 'naver_originals%';").trim(),'5');
  assert.equal(sql("select has_function_privilege('anon','life_naver_capture_read(uuid)','execute') or has_function_privilege('authenticated','life_naver_capture_claim(integer,uuid,uuid,uuid)','execute');").trim(),'f');
 });
 check('account discovery spans own workspaces only',()=>{const result=json(owner(a,'select life_naver_account_list();'));assert.equal(result.subscriptions.length,2);assert.equal(result.ready,false);assert(!JSON.stringify(result).includes(b));assert(!JSON.stringify(result).includes('lease_token'));assert.equal(json(owner(b,'select life_naver_account_list();')).subscriptions.length,1);});
 check('foreign inventory owner denied',()=>assert.throws(()=>owner(a,`select life_naver_inventory_start('${foreign.id}',1);`),/owner_required/));
 let inventory=json(owner(a,`select life_naver_inventory_start('${sub.id}',1);`));
 check('runtime false claims no jobs',()=>assert.deepEqual(json(worker(`select life_naver_inventory_claim(1,'${sub.id}','${a}');`)),[]));
 sql('update haedo_naver_private.runtime set ready=true;');
 let lease=json(worker(`select life_naver_inventory_claim(1,'${sub.id}','${a}');`))[0];
 const entries=[{logNo:'100',title:'原文 😀',publishedAt:null},{logNo:'99',title:'Older',publishedAt:null}];
 const finishInv=(l,rows,total,next,error=null)=>`select life_naver_inventory_finish('${l.subscription_id}','${l.lease_token}',${l.revision},${l.page},${jlit(rows)},${total??'null'},${next??'null'},${lit(error)});`;
 let result=json(worker(finishInv(lease,entries,3,2)));
 check('first page incomplete and baseline queue empty',()=>{assert.equal(result.inventory.status,'pending');assert.equal(result.inventory.baseline_completed_at,null);assert.equal(sql('select count(*) from haedo_naver_private.capture_jobs;').trim(),'0');});
 check('inventory finish exact receipt replay',()=>assert.deepEqual(json(worker(finishInv(lease,entries,3,2))),result));
 check('inventory finish changed replay rejects',()=>assert.throws(()=>worker(finishInv(lease,entries,4,2)),/operation_mismatch/));
 lease=json(worker(`select life_naver_inventory_claim(1,'${sub.id}','${a}');`))[0];result=json(worker(finishInv(lease,[{logNo:'98',title:'Last',publishedAt:null}],3,null)));
 check('terminal distinct known total commits baseline',()=>{assert.equal(result.inventory.status,'complete');assert.equal(result.inventory.baseline_count,3);assert.equal(sql('select count(*) from haedo_naver_private.capture_jobs;').trim(),'0');});
 owner(b,`select life_naver_inventory_start('${foreign.id}',1);`);
 let otherLease=json(worker(`select life_naver_inventory_claim(1,'${foreign.id}','${b}');`))[0];
 let incomplete=json(worker(finishInv(otherLease,[{logNo:'1',title:'Observed',publishedAt:null}],null,null)));
 check('unknown total never completes baseline',()=>{assert.equal(incomplete.inventory.status,'partial');assert.equal(incomplete.inventory.baseline_completed_at,null);});
 owner(b,`select life_naver_inventory_start('${foreign.id}',1);`);
 otherLease=json(worker(`select life_naver_inventory_claim(1,'${foreign.id}','${b}');`))[0];
 worker(finishInv(otherLease,[{logNo:'1',title:'Observed',publishedAt:null}],2,2));
 otherLease=json(worker(`select life_naver_inventory_claim(1,'${foreign.id}','${b}');`))[0];
 incomplete=json(worker(finishInv(otherLease,[{logNo:'2',title:'Changed list',publishedAt:null}],3,null)));
 check('changing public total remains partial and preserves baseline unset',()=>{assert.equal(incomplete.inventory.status,'partial');assert.equal(incomplete.inventory.last_error,'inventory_changed');assert.equal(incomplete.inventory.baseline_completed_at,null);});
 check('inventory paging exact descending log numbers',()=>{const p=json(owner(a,`select life_naver_inventory_list('${sub.id}',2);`));assert.deepEqual(p.items.map(x=>x.logNo),['100','99']);assert.equal(p.hasMore,true);assert.equal(json(owner(a,`select life_naver_inventory_list('${sub.id}',2,'${p.nextCursor}');`)).items[0].logNo,'98');});
 check('inventory start stale revision conflicts via HTTP409',()=>assert.throws(()=>owner(a,`select life_naver_inventory_start('${sub.id}',0);`),/life_naver_conflict/));
 const enabled=json(owner(a,`select life_naver_save('${ws}','Mixed_Blog',1,true);`));
 inventory=json(owner(a,`select life_naver_inventory_start('${sub.id}',${enabled.revision});`));
 lease=json(worker(`select life_naver_inventory_claim(1,'${sub.id}','${a}');`))[0];
 result=json(worker(finishInv(lease,[{logNo:'101',title:'Newly discovered',publishedAt:null},...entries,{logNo:'98',title:'Last',publishedAt:null}],4,null)));
 check('only post-baseline new IDs queue automatically',()=>assert.deepEqual(JSON.parse(sql('select jsonb_agg(log_no) from haedo_naver_private.capture_jobs;').trim()),['101']));
 let job=json(owner(a,`select life_naver_capture_request('${sub.id}','100',${enabled.revision});`));
 check('unobserved capture denied',()=>assert.throws(()=>owner(a,`select life_naver_capture_request('${sub.id}','999',${enabled.revision});`),/post_not_observed/));
 check('same owner/blog/post job request deduplicates',()=>assert.equal(json(owner(a,`select life_naver_capture_request('${sub.id}','100',${enabled.revision});`)).id,job.id));
 let claim=json(worker(`select life_naver_capture_claim(1,'${job.id}','${a}','${sub.id}');`))[0];
 const progress={version:1,payload:{body:'accepted checkpoint'},images:[{url:'https://blogfiles.pstatic.net/a',alt:''}],nextImage:0};
 const checkpoint=`select life_naver_capture_checkpoint('${claim.job_id}','${claim.lease_token}',${claim.revision},${jlit(progress)});`;
 const checkpointResult=json(worker(checkpoint));
 check('checkpoint releases lease and exact ACK can replay',()=>{assert.equal(checkpointResult.status,'pending');assert.deepEqual(json(worker(checkpoint)),checkpointResult);});
 claim=json(worker(`select life_naver_capture_claim(1,'${job.id}','${a}','${sub.id}');`))[0];
 check('capture reclaims exact private checkpoint',()=>assert.deepEqual(claim.progress,progress));
 const photoSHA=sha('synthetic original bytes'),path=`${a}/naver/Mixed_Blog/100/${photoSHA}`;
 const payload={version:1,blogId:'Mixed_Blog',logNo:'100',url:'https://blog.naver.com/Mixed_Blog/100',title:'Title 😀',format:'text/markdown',body:'原文\r\nExact 😀 body',bodyHash:sha('原文\r\nExact 😀 body'),htmlHash:sha('<main>HTML</main>'),coverage:'full_text',omissions:['Original upload unverified'],publishedAt:null,author:'',extractedAt:'2026-10-21T00:00:00.000Z',extractor:'fixture@1',photos:[{index:0,url:'https://blogfiles.pstatic.net/original.jpg',storagePath:path,sha256:photoSHA,mimeType:'image/jpeg',width:4032,height:3024,bytes:99,alt:'alt',caption:'caption',status:'stored',error:null,originalStatus:'unverified'}]};
 const hash=fingerprint(payload);
 check('SQL hash matches client canonical CRLF/Unicode protocol',()=>assert.equal(sql(`select haedo_naver_private.capture_hash(${jlit(payload)});`).trim(),hash));
 const finish=(l,p=payload,h=fingerprint(p),error=null)=>`select life_naver_capture_finish('${l.job_id}','${l.lease_token}',${l.revision},${jlit(p)},${lit(h)},${lit(error)});`;
 check('partial upload cannot publish a stored photo capture',()=>{assert.throws(()=>worker(finish(claim)),/photo_not_uploaded/);assert.equal(sql('select count(*) from life_naver_captures;').trim(),'0');});
 sql(`insert into storage.objects(bucket_id,name,metadata) values('haedo-naver-originals',${lit(path)},'{"size":99,"mimetype":"image/jpeg"}');`);
 check('uncommitted uploaded object is not owner readable',()=>assert.equal(owner(a,"select count(*) from storage.objects where bucket_id='haedo-naver-originals';").trim().split('\n').at(-1),'0'));
 check('bad body SHA and capture hash reject without inserts',()=>{
  const p={...payload,body:'different'};assert.throws(()=>worker(finish(claim,p)),/invalid_capture/);
  assert.throws(()=>worker(finish(claim,payload,'0'.repeat(64))),/hash_mismatch/);assert.equal(sql('select count(*) from life_naver_captures;').trim(),'0');
 });
 sql(`create function haedo_naver_private.test_abort_receipt() returns trigger language plpgsql as $$begin if new.kind='capture' and new.id='${claim.job_id}'::uuid then raise exception 'synthetic_receipt_failure';end if;return new;end$$;
 create trigger test_abort_receipt before insert on haedo_naver_private.capture_receipts for each row execute function haedo_naver_private.test_abort_receipt();`);
 check('last receipt failure rolls back capture/assets/job then same lease retries',()=>{
  const before=sql(`select to_jsonb(j) from haedo_naver_private.capture_jobs j where id='${claim.job_id}';`).trim();
  assert.throws(()=>worker(finish(claim)),/synthetic_receipt_failure/);assert.equal(sql('select count(*) from life_naver_captures;').trim(),'0');assert.equal(sql('select count(*) from haedo_naver_private.capture_assets;').trim(),'0');assert.equal(sql(`select to_jsonb(j) from haedo_naver_private.capture_jobs j where id='${claim.job_id}';`).trim(),before);
 });
 sql('drop trigger test_abort_receipt on haedo_naver_private.capture_receipts;drop function haedo_naver_private.test_abort_receipt();');
 const stored=json(worker(finish(claim)));const captureId=stored.capture_id;
 check('capture and receipt commit once',()=>{assert(stored.capture_id);assert.deepEqual(json(worker(finish(claim))),stored);assert.equal(sql('select count(*) from life_naver_captures;').trim(),'1');});
 check('owner reads exact immutable capture; other owner cannot',()=>{
  const row=json(owner(a,`select life_naver_capture_read('${captureId}');`));assert.deepEqual(row.payload,payload);assert.equal(row.capture_hash,hash);
  assert.equal(json(owner(b,`select coalesce(life_naver_capture_read('${captureId}'),'null'::jsonb);`)),null);assert.equal(owner(b,'select count(*) from life_naver_captures;').trim().split('\n').at(-1),'0');
 });
 check('private image owner read and other owner denial',()=>{assert.equal(owner(a,"select count(*) from storage.objects where bucket_id='haedo-naver-originals';").trim().split('\n').at(-1),'1');assert.equal(owner(b,"select count(*) from storage.objects where bucket_id='haedo-naver-originals';").trim().split('\n').at(-1),'0');});
 check('broad unrelated Storage policies cannot grant client writes',()=>{
  assert.throws(()=>owner(a,`insert into storage.objects(bucket_id,name,metadata) values('haedo-naver-originals','malicious','{}');`),/row-level security/);
  assert.equal(owner(a,"update storage.objects set metadata='{}' where bucket_id='haedo-naver-originals' returning id;").trim().split('\n').length,1);
  assert.equal(sql(`select metadata->>'size' from storage.objects where name=${lit(path)};`).trim(),'99');
 });
 const later={...payload,extractedAt:'2026-10-22T00:00:00.000Z'};
 check('reobservation timestamp excluded and complete job remains same',()=>{assert.equal(fingerprint(later),hash);assert.equal(json(owner(a,`select life_naver_capture_request('${sub.id}','100',${enabled.revision});`)).id,job.id);assert.deepEqual(json(owner(a,`select life_naver_capture_read('${captureId}');`)).payload,payload);});
 job=json(owner(a,`select life_naver_capture_request('${sub.id}','100',${enabled.revision},true);`));claim=json(worker(`select life_naver_capture_claim(1,'${job.id}','${a}','${sub.id}');`))[0];
 check('explicit refresh reuses unchanged capture without replacing original',()=>{assert.equal(json(worker(finish(claim,later))).capture_id,captureId);assert.deepEqual(json(owner(a,`select life_naver_capture_read('${captureId}');`)).payload,payload);});
 job=json(owner(a,`select life_naver_capture_request('${sub.id}','100',${enabled.revision},true);`));claim=json(worker(`select life_naver_capture_claim(1,'${job.id}','${a}','${sub.id}');`))[0];
 const failedPayload={...payload,photos:[{...payload.photos[0],storagePath:null,sha256:null,mimeType:null,width:null,height:null,bytes:null,status:'failed',error:'network_error2'}]};
 const failedCapture=json(worker(finish(claim,failedPayload)));
 check('failed photo retains an immutable capture and retry state',()=>{
  assert.notEqual(failedCapture.capture_id,captureId);const state=json(owner(a,`select life_naver_capture_request('${sub.id}','100',${enabled.revision});`));assert.equal(state.id,job.id);assert.equal(state.capture_id,failedCapture.capture_id);assert.equal(state.status,'pending');assert.equal(state.progress,null);
 });
 claim=json(worker(`select life_naver_capture_claim(1,'${job.id}','${a}','${sub.id}');`))[0];
 check('retry recovers photo while keeping both capture versions',()=>{assert.equal(json(worker(finish(claim))).capture_id,captureId);assert.equal(json(owner(a,`select life_naver_capture_list('${sub2.id}');`)).captures.length,2);});
 job=json(owner(a,`select life_naver_capture_request('${sub.id}','98',${enabled.revision});`));
 for(let n=0;n<6;n++){
  const stage=json(worker(`select life_naver_capture_claim(1,'${job.id}','${a}','${sub.id}');`))[0];assert(stage);worker(`select life_naver_capture_checkpoint('${stage.job_id}','${stage.lease_token}',${stage.revision},${jlit({...progress,nextImage:n})});`);
 }
 check('successful media checkpoints do not consume failure retry budget',()=>assert.equal(sql(`select attempts from haedo_naver_private.capture_jobs where id='${job.id}';`).trim(),'0'));
 const automaticJob=json(sql("select to_jsonb(j) from haedo_naver_private.capture_jobs j where log_no='101';"));
 const competing=await Promise.all([parallel(`set role service_role;select life_naver_capture_claim(1,'${automaticJob.id}','${a}','${sub.id}');`),parallel(`set role service_role;select life_naver_capture_claim(1,'${automaticJob.id}','${a}','${sub.id}');`)]);
 check('simultaneous claim grants one lease only',()=>assert.deepEqual(competing.map(v=>json(v).length).sort(),[0,1]));
 job=json(owner(a,`select life_naver_capture_request('${sub.id}','99',${enabled.revision});`));claim=json(worker(`select life_naver_capture_claim(1,'${job.id}','${a}','${sub.id}');`))[0];
 const beforePauseCaptures=sql('select jsonb_agg(to_jsonb(c) order by id) from life_naver_captures c;').trim();
 owner(a,`select life_naver_save('${ws}','Mixed_Blog',${enabled.revision},false);`);
 check('pause revision fences late capture and checkpoint',()=>{assert.equal(json(worker(finish(claim))).status,'stale');assert.equal(json(worker(`select life_naver_capture_checkpoint('${claim.job_id}','${claim.lease_token}',${claim.revision},${jlit(progress)});`)).status,'stale');assert.equal(sql('select jsonb_agg(to_jsonb(c) order by id) from life_naver_captures c;').trim(),beforePauseCaptures);});
 // Expire only this synthetic lease before the next explicit manual attempt.
 sql(`update haedo_naver_private.capture_jobs set lease_until=clock_timestamp()-interval '1 second' where id='${job.id}';`);
 claim=json(worker(`select life_naver_capture_claim(1,'${job.id}','${a}','${sub.id}');`))[0];
 sql('update haedo_naver_private.runtime set ready=false;');
 check('global pause fences pending finish without changing old captures',()=>assert.equal(json(worker(finish(claim))).status,'stale'));
 const fullSnapshot=()=>sql("select jsonb_build_object('captures',(select jsonb_agg(to_jsonb(c) order by id) from life_naver_captures c),'inventory',(select jsonb_agg(to_jsonb(i) order by subscription_id) from haedo_naver_private.inventory i),'jobs',(select jsonb_agg(to_jsonb(j) order by id) from haedo_naver_private.capture_jobs j),'receipts',(select jsonb_agg(to_jsonb(r) order by kind,id,lease_token) from haedo_naver_private.capture_receipts r),'assets',(select jsonb_agg(to_jsonb(a) order by path) from haedo_naver_private.capture_assets a),'ready',(select ready from haedo_naver_private.runtime));").trim();
 const snapshot=fullSnapshot();sql(source);
 check('reinstall preserves captures/checkpoints/receipts and disabled gate',()=>assert.equal(fullSnapshot(),snapshot));
 report.installation=json(sql(await readFile(resolve(project,'supabase/tests/naver-capture-installation.sql'),'utf8')));
 check('installation metadata twelve conditions',()=>{assert.equal(Object.keys(report.installation).length,12);assert(Object.values(report.installation).every(x=>x===true));});
 const operations=await readFile(resolve(project,'supabase/operations/naver-collection-activation.sql'),'utf8');
 sql("create schema cron;create table cron.job(jobname text primary key);insert into cron.job values('haedo-naver-blog-poll'),('haedo-naver-capture-poll'),('foreign-job');create function cron.unschedule(text) returns boolean language plpgsql as $$begin delete from cron.job where jobname=$1;return found;end$$;");
 const disabledSnapshot=fullSnapshot();sql(operations);
 check('default operations inspect has no side effects',()=>assert.equal(fullSnapshot(),disabledSnapshot));
 sql('update haedo_naver_private.runtime set ready=true;');
 sql(operations.replace('\nbegin;\n',"\nbegin;\nset local haedo.naver_action='pause';\n"));
 check('pause removes both own schedulers and preserves other jobs/data',()=>{assert.equal(sql('select jobname from cron.job;').trim(),'foreign-job');assert.equal(fullSnapshot(),disabledSnapshot);});
 check('old Storage object remains byte-equivalent',()=>assert.equal(sql("select metadata::text from storage.objects where bucket_id='existing';").trim(),'{"size": 7}'));
 report.pass=true;
}catch(error){report.error={message:error.message};throw error;}
finally{
 if(owns&&!keep){docker(['rm','--force',container]);report.localContainerRemoved=true;}else if(owns){report.kept=true;}
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}

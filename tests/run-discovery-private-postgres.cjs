/* Disposable synthetic PostgreSQL only. No endpoint/account/credential options. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.local/discovery-private-sql');
const image='postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3';
const container='haedo-discovery-postgres-'+Date.now()+'-'+process.pid,tag=randomUUID(),label='haedo.discovery-test-owner';
if(process.argv.length!==2)throw Error('No endpoint, account, SQL, or credential options accepted.');
const env={...process.env};for(const key of Object.keys(env))if(/^(PG|DATABASE_URL$|SUPABASE|HAEDO_TEST_|DOCKER_HOST$|DOCKER_CONTEXT$|DOCKER_TLS|DOCKER_CERT_PATH$)/.test(key))delete env[key];
const docker=args=>execFileSync('docker',['--host=unix:///var/run/docker.sock',...args],{env,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
const migration='supabase/migrations/20261029084145_discovery_private_reader.sql',install='supabase/tests/discovery-private-installation.sql';
const files=[migration,install,'tests/run-discovery-private-postgres.cjs'],hash=file=>createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const report={scope:'Synthetic PostgreSQL 17 with Auth schema shims, three real sessions. No hosted project, user data or credentials.',image,checks:[],pass:false,cleanup:false};
const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
fs.mkdirSync(output,{recursive:true});let db,other,second;
const A=randomUUID(),B=randomUUID(),S1=randomUUID(),S2=randomUUID(),S3=randomUUID();
const base='https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.';
const url=n=>base+n+'/full',source='frontiers-psychology';
const content=n=>({coverage:'full_text',summary:'Synthetic abstract '+n,bodyText:'Synthetic private body '+n,
 rights:{mode:'private_reading',label:'Synthetic author',url:url(n)},
 acquisition:{scope:'private_account',method:'publisher_xml',sourceUrl:base+n+'/xml',fetchedAt:new Date().toISOString(),license:{label:'Publisher terms',url:null}}});
async function main(){
 const before=Object.fromEntries(files.map(f=>[f,hash(f)]));report.sourcesBefore=before;
 const check=async(name,fn)=>{await fn();report.checks.push({name,pass:true});console.log('PASS '+name);};
 const denied=fn=>assert.rejects(fn,e=>e.code==='42501'),invalid=fn=>assert.rejects(fn,e=>e.code==='22023');
 try{
  const {Client}=require('./sql-ci/node_modules/pg');
  report.containerId=docker(['run','--detach','--name',container,'--label',label+'='+tag,'--publish','127.0.0.1::5432','-e','POSTGRES_HOST_AUTH_METHOD=trust',image]).trim();
  const state=JSON.parse(docker(['inspect',container,'--format','{{json .}}']));assert.equal(state.Config.Labels[label],tag);
  const bindings=state.NetworkSettings.Ports['5432/tcp'];assert.equal(bindings.length,1);assert.equal(bindings[0].HostIp,'127.0.0.1');
  const config={host:'127.0.0.1',port:Number(bindings[0].HostPort),user:'postgres',database:'postgres'};
  // The image's temporary init server accepts Unix sockets before restarting.
  // Wait for TCP, the transport used by all three real test connections.
  const deadline=Date.now()+45000;for(;;){try{docker(['exec',container,'pg_isready','--host=127.0.0.1','-U','postgres']);break;}catch(error){if(Date.now()>deadline)throw Error('Synthetic PostgreSQL startup failed');await new Promise(r=>setTimeout(r,200));}}
  db=new Client(config);other=new Client(config);second=new Client(config);await Promise.all([db.connect(),other.connect(),second.connect()]);
  const q=(sql,args=[])=>db.query(sql,args),one=async(client,sql,args=[])=>{const r=await client.query(sql,args);return r.rows[0]?.result;};
  const actor=async(client,role,owner='',session='')=>{await client.query('reset role');await client.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:owner,session_id:session})]);if(role!=='postgres')await client.query('set role '+role);};
  const claim=(n,client=other)=>one(client,'select public.life_discovery_article_claim($1,$2) result',[source,url(n)]);
  const finish=(n,lease,data=content(n),owner=A,error=null)=>one(db,'select public.life_discovery_article_finish($1,$2,$3,$4,$5::jsonb,$6) result',[owner,source,url(n),lease,data===null?null:JSON.stringify(data),error]);
  const admin=()=>actor(db,'postgres'),service=()=>actor(db,'service_role');
  await q(`create role anon;create role authenticated;create role service_role;create schema auth;
   create table auth.users(id uuid primary key,is_anonymous boolean not null default false);
   create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,not_after timestamptz);
   create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
   create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
   grant usage on schema auth to anon,authenticated;create table public.discovery_sentinel(value text);insert into public.discovery_sentinel values('preserved');`);
  await q('insert into auth.users(id) values($1),($2)',[A,B]);await q('insert into auth.sessions(id,user_id) values($1,$2),($3,$2),($4,$5)',[S1,A,S2,S3,B]);
  await check('repeatable migration and installation inspect structure only',async()=>{
   await q(fs.readFileSync(path.join(root,migration),'utf8'));await q(fs.readFileSync(path.join(root,migration),'utf8'));await q(fs.readFileSync(path.join(root,install),'utf8'));
   assert.deepEqual((await q('select * from public.discovery_sentinel')).rows,[{value:'preserved'}]);
  });
  await actor(other,'authenticated',A,S1);await actor(second,'authenticated',B,S3);
  await check('anonymous, missing session and direct table reads/writes cannot reach private cache',async()=>{
   await actor(db,'anon');await denied(()=>claim(1,db));await actor(db,'authenticated',A,'');await denied(()=>claim(1,db));
   for(const client of [other,second]){await denied(()=>client.query('select * from haedo_discovery_private.articles'));await denied(()=>client.query('insert into haedo_discovery_private.limits values($1,now(),0,now(),0)',[A]));}
   await denied(()=>one(other,'select public.life_discovery_article_finish($1,$2,$3,$4,null,\'blocked\') result',[A,source,url(1),randomUUID()]));
  });
  let lease,first;
  await check('owner claim is user derived, finish is service-only and snapshot hash exact',async()=>{
   lease=(await claim(1)).leaseToken;assert(lease);await service();const wrong=await finish(1,lease,content(1),B);assert.equal(wrong.status,'stale');
   first=await finish(1,lease);assert.equal(first.status,'ready');assert.equal(first.cached,false);assert.equal(first.stale,false);
   await admin();const hashRow=await q("select encode(sha256(convert_to(content::text,'UTF8')),'hex') h from haedo_discovery_private.articles where owner_id=$1",[A]);assert.equal(first.contentHash,hashRow.rows[0].h);
  });
  await check('same account another session reopens exact snapshot; other account cannot receive it',async()=>{
   await actor(second,'authenticated',A,S2);assert.deepEqual(await claim(1,second),{...first,cached:true});
   await actor(second,'authenticated',B,S3);const b=await claim(1,second);assert.equal(b.status,'claimed');assert(!('content' in b));await service();await finish(1,b.leaseToken,null,B,'blocked');
   assert.equal((await claim(1,second)).status,'unavailable');assert.deepEqual(await claim(1),{...first,cached:true});
  });
  await check('concurrent requests have one lease and account-wide two-worker limit',async()=>{
   await actor(second,'authenticated',A,S2);const race=await Promise.all([claim(2),claim(2,second)]);assert.deepEqual(race.map(x=>x.status).sort(),['busy','claimed']);
   const third=await claim(3);assert.equal(third.status,'claimed');assert.equal((await claim(4)).status,'busy');
   await service();await finish(2,race.find(x=>x.status==='claimed').leaseToken,null,A,'blocked');await finish(3,third.leaseToken,null,A,'blocked');
  });
  await check('expired refresh failure retains exact old body/hash/date and negative cooldown',async()=>{
   await admin();await q("update haedo_discovery_private.articles set expires_at=now()-interval '1 second',next_attempt_at=now()-interval '1 second' where owner_id=$1 and url=$2",[A,url(1)]);
   const refresh=await claim(1);assert.equal(refresh.status,'claimed');await service();const stale=await finish(1,refresh.leaseToken,null,A,'network_error');
   assert.deepEqual(stale,{...first,cached:true,stale:true});assert.deepEqual(await claim(1),stale);
  });
  await check('late obsolete lease cannot overwrite a newer article snapshot',async()=>{
   const pending=await claim(5);await admin();await q("update haedo_discovery_private.articles set lease_until=now()-interval '1 second' where owner_id=$1 and url=$2",[A,url(5)]);
   const replacement=await claim(5);assert.notEqual(replacement.leaseToken,pending.leaseToken);await service();assert.equal((await finish(5,pending.leaseToken)).status,'stale');
   assert.equal((await finish(5,replacement.leaseToken)).status,'ready');
  });
  await check('malformed private provenance, null coverage, future date and oversized body reject atomically',async()=>{
   const c=await claim(6);await service();
   for(const bad of [{...content(6),coverage:null},{...content(6),acquisition:{...content(6).acquisition,scope:'public'}},
    {...content(6),acquisition:{...content(6).acquisition,fetchedAt:'2099-01-01T00:00:00Z'}},{...content(6),bodyText:'x'.repeat(2097153)}])await invalid(()=>finish(6,c.leaseToken,bad));
   assert.equal((await finish(6,c.leaseToken)).status,'ready');
  });
  await check('hour/day rate limits do not prevent existing cached reads',async()=>{
   await admin();await q('update haedo_discovery_private.limits set hour_count=30 where owner_id=$1',[A]);assert.equal((await claim(7)).status,'rate_limited');assert.equal((await claim(6)).status,'ready');
   await q("update haedo_discovery_private.limits set hour_started_at=now()-interval '2 hours',day_count=120 where owner_id=$1",[A]);assert.equal((await claim(7)).status,'rate_limited');
   await q("update haedo_discovery_private.limits set day_started_at=now()-interval '2 days' where owner_id=$1",[A]);const retry=await claim(7);assert.equal(retry.status,'claimed');await service();await finish(7,retry.leaseToken,null,A,'blocked');
  });
  await check('100-row bounded cache evicts oldest eligible entry and protects active lease',async()=>{
   await admin();await q('delete from haedo_discovery_private.articles where owner_id=$1',[A]);
   await q(`insert into haedo_discovery_private.articles(owner_id,source_id,url,touched_at)
    select $1,$2,$3||n||'/full',now()-interval '1 hour'+n*interval '1 second' from generate_series(1000,1099) n`,[A,source,base]);
   const next=await claim(1100);assert.equal(next.status,'claimed');assert.equal(Number((await q('select count(*) n from haedo_discovery_private.articles where owner_id=$1',[A])).rows[0].n),100);
   assert.equal(Number((await q('select count(*) n from haedo_discovery_private.articles where owner_id=$1 and url=$2',[A,url(1000)])).rows[0].n),0);
   await service();await finish(1100,next.leaseToken,null,A,'blocked');
  });
  await check('32 MiB account byte budget evicts exact prior snapshots before acknowledging new one',async()=>{
   await admin();await q('delete from haedo_discovery_private.articles where owner_id=$1',[A]);const large={...content(2000),bodyText:'x'.repeat(1800000)};
   await q(`insert into haedo_discovery_private.articles(owner_id,source_id,url,content,content_hash,content_bytes,fetched_at,expires_at)
    select $1,$2,$3||n||'/full',$4::jsonb,encode(sha256(convert_to(($4::jsonb)::text,'UTF8')),'hex'),octet_length(($4::jsonb)::text),now(),now()+interval '1 day' from generate_series(2000,2017) n`,[A,source,base,JSON.stringify(large)]);
   const next=await claim(2018);await service();assert.equal((await finish(2018,next.leaseToken,large)).status,'ready');await admin();
   const size=(await q('select sum(content_bytes) bytes,count(*) n from haedo_discovery_private.articles where owner_id=$1',[A])).rows[0];assert(Number(size.bytes)<=33554432);assert.equal(Number(size.n),18);
  });
  await check('session revocation denies cache hit and outstanding finish; deletion cascades only its owner',async()=>{
   const pending=await claim(3000);await admin();await q('delete from auth.sessions where id=$1',[S1]);await denied(()=>claim(2001));
   await service();assert.equal((await finish(3000,pending.leaseToken)).status,'stale');await actor(second,'authenticated',A,S2);assert.equal((await claim(2001,second)).status,'ready');
   await admin();await q('delete from auth.users where id=$1',[A]);assert.equal(Number((await q('select count(*) n from haedo_discovery_private.articles where owner_id=$1',[A])).rows[0].n),0);assert(Number((await q('select count(*) n from haedo_discovery_private.articles where owner_id=$1',[B])).rows[0].n)>0);await denied(()=>claim(2001,second));
  });
  report.sourcesAfter=Object.fromEntries(files.map(f=>[f,hash(f)]));assert.deepEqual(report.sourcesAfter,before);report.pass=true;
 }finally{
  await Promise.allSettled([db?.end(),other?.end(),second?.end()]);
  try{const state=JSON.parse(docker(['inspect',container,'--format','{{json .}}']));assert.equal(state.Config.Labels[label],tag);docker(['rm','--force','--volumes',state.Id]);report.cleanup=true;}catch(error){report.cleanupError=error.message;report.pass=false;}
  save();
 }
 assert(report.pass&&report.cleanup);console.log('Private discovery SQL: '+report.checks.length+' checks; owned synthetic container removed.');
}
main().catch(error=>{report.pass=false;report.error=error.message;save();console.error(error);process.exitCode=1;});

/* Disposable pinned PostgreSQL only. No endpoint, account, SQL, or credential options. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync,spawn}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.local/naver-media-postgres');
const image='postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3';
const owner=randomUUID(),container='haedo-naver-media-postgres-'+Date.now()+'-'+process.pid,label='haedo.naver-media-test-owner';
if(process.argv.length!==2)throw Error('No endpoint, account, SQL, or credential options are accepted.');
const env={...process.env};
for(const key of Object.keys(env))if(/^(PG|DATABASE_URL$|NAVER_MEDIA_SQL_|PG_MODULE_PATH$|PGLITE_MODULE_PATH$|SUPABASE|HAEDO_TEST_|DOCKER_HOST$|DOCKER_CONTEXT$|DOCKER_TLS$|DOCKER_TLS_VERIFY$|DOCKER_CERT_PATH$)/.test(key))delete env[key];
const dockerArgs=['--host=unix:///var/run/docker.sock'];
const docker=(args)=>execFileSync('docker',[...dockerArgs,...args],{env,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
const hash=p=>createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const sources=['supabase/migrations/20261003085426_life_sync_workspaces.sql','supabase/migrations/20261021093111_life_naver_subscriptions.sql','supabase/migrations/20261021094614_naver_conflict_http409.sql','supabase/migrations/20261021113658_life_naver_captures.sql','supabase/migrations/20261029030503_naver_media_receipts.sql','assets/life/core.js','assets/life/naver-blog.js','assets/life/naver-capture.js','tests/naver-media-receipts-sql.cjs','tests/run-naver-media-postgres.cjs','tests/sql-ci/package.json','tests/sql-ci/package-lock.json'];
const report={scope:'Disposable synthetic PostgreSQL 17 with Auth/Storage schema shims and two authenticated real connections; no hosted Supabase/Auth/Storage service, personal data, real account, production operation or deployment proof.',image,container,ownerLabel:owner,pass:false};
const cleanup={container,identityMatched:false,removed:false};let child;
fs.mkdirSync(output,{recursive:true});
const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
async function stop(){
 try{const state=JSON.parse(docker(['inspect',container,'--format','{{json .}}']));assert.equal(state.Config.Labels[label],owner);cleanup.identityMatched=true;docker(['rm','--force','--volumes',state.Id]);cleanup.removed=true;}catch(error){if(!/No such (object|container)/.test(String(error.stderr||error.message)))cleanup.error=error.message;}
 save('cleanup.json',cleanup);
}
async function main(){
 const before=Object.fromEntries(sources.map(p=>[p,hash(p)]));save('source-before.json',before);
 try{
  const modulePath=path.join(__dirname,'sql-ci/node_modules/pg');assert.equal(require(path.join(modulePath,'package.json')).version,'8.23.1');
  report.dockerVersion=docker(['info','--format','{{.ServerVersion}}']).trim();
  report.containerId=docker(['run','--detach','--name',container,'--label',label+'='+owner,'--publish','127.0.0.1::5432','-e','POSTGRES_HOST_AUTH_METHOD=trust',image]).trim();
  const state=JSON.parse(docker(['inspect',container,'--format','{{json .}}']));assert.equal(state.Id,report.containerId);assert.equal(state.Config.Labels[label],owner);
  assert.deepEqual(Object.keys(state.HostConfig.PortBindings),['5432/tcp']);assert.equal(state.HostConfig.PortBindings['5432/tcp'][0].HostIp,'127.0.0.1');
  const mapping=state.NetworkSettings.Ports['5432/tcp'];assert.equal(mapping.length,1);assert.equal(mapping[0].HostIp,'127.0.0.1');const port=Number(mapping[0].HostPort);assert(Number.isInteger(port)&&port>0&&port<65536);report.host='127.0.0.1';report.port=port;
  const deadline=Date.now()+45000;
  for(;;){try{docker(['exec',container,'pg_isready','--host=127.0.0.1','-U','postgres']);break;}catch(error){if(Date.now()>deadline)throw Error('Owned synthetic PostgreSQL did not become ready.');await new Promise(r=>setTimeout(r,200));}}
  const database='haedo_naver_media_'+owner.replaceAll('-','');docker(['exec',container,'createdb','-U','postgres',database]);
  const result=await new Promise((resolve,reject)=>{
   let stdout='',stderr='';child=spawn(process.execPath,[path.join(__dirname,'naver-media-receipts-sql.cjs')],{cwd:root,env:{...env,NAVER_MEDIA_SQL_PG_PORT:String(port),NAVER_MEDIA_SQL_PG_DATABASE:database,PG_MODULE_PATH:modulePath,NAVER_MEDIA_SQL_REPORT:path.join(output,'checks.json')},stdio:['ignore','pipe','pipe']});
   const timeout=setTimeout(()=>{child.kill('SIGTERM');reject(Error('Synthetic SQL tests exceeded 120 seconds.'));},120000);
   child.stdout.on('data',b=>{stdout+=b;process.stdout.write(b);});child.stderr.on('data',b=>{stderr+=b;process.stderr.write(b);});child.once('error',e=>{clearTimeout(timeout);reject(e);});child.once('exit',(code,signal)=>{clearTimeout(timeout);resolve({code,signal,stdout,stderr});});
  });
  fs.writeFileSync(path.join(output,'run.log'),result.stdout+result.stderr);assert.equal(result.code,0);
  const checks=JSON.parse(fs.readFileSync(path.join(output,'checks.json'),'utf8'));assert.equal(checks.pass,true);assert.equal(checks.engine,'PostgreSQL independent sessions');assert(checks.checks.includes('independent concurrent sessions select one immutable tuple and exact replay wins'));assert(checks.checks.includes('independent concurrent same tuple retries both return the exact receipt'));
  report.checks=checks.checks.length;report.concurrency=2;report.checksSha256=hash('.local/naver-media-postgres/checks.json');
  report.sourceHashesBefore=before;report.sourceHashesAfter=Object.fromEntries(sources.map(p=>[p,hash(p)]));assert.deepEqual(report.sourceHashesBefore,report.sourceHashesAfter);report.sourcesUnchanged=true;save('source-after.json',report.sourceHashesAfter);report.pass=true;
 }catch(error){report.error={message:error.message};throw error;}
 finally{await stop();if(!cleanup.removed||cleanup.error)report.pass=false;save('report.json',report);}
 assert.equal(report.pass,true);console.log('Naver media SQL: '+report.checks+' checks, two real races, owned container removed.');
}
process.once('SIGTERM',()=>{child?.kill('SIGTERM');stop().finally(()=>process.exit(143));});
process.once('SIGINT',()=>{child?.kill('SIGTERM');stop().finally(()=>process.exit(130));});
main().catch(error=>{console.error('FAIL Naver media PostgreSQL: '+error.message);process.exitCode=1;});

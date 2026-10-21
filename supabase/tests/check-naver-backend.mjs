/* Disposable PostgreSQL only: no project URL, account token, external DB or port. */
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const image = 'postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3';
const container = `haedo-naver-postgres-${Date.now()}${process.pid}`, database = 'haedo_naver_backend';
const migration = 'supabase/migrations/20261021093111_life_naver_subscriptions.sql';
const conflictFix = 'supabase/migrations/20261021094614_naver_conflict_http409.sql';
const output = resolve(project, '.local/naver-backend');
const env = { ...process.env };
for (const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete env[key];
if (process.argv.length !== 2) throw Error('No endpoint, account, or command options are accepted.');
const dockerArgs = ['--host=unix:///var/run/docker.sock'];
const docker = (args, input) => execFileSync('docker', [...dockerArgs, ...args], { env, input, encoding: 'utf8', maxBuffer: 8*1024*1024 });
const sql = input => docker(['exec','-i',container,'psql','-U','postgres','-d',database,'-qAt','-v','ON_ERROR_STOP=1'],input);
const run = promisify(execFile);
const concurrent = async input => {
  const child = execFile('docker', [...dockerArgs,'exec','-i',container,'psql','-U','postgres','-d',database,'-qAt','-v','ON_ERROR_STOP=1'], { env, encoding:'utf8' });
  let out='',error='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>error+=chunk);
  const done=new Promise((yes,no)=>child.on('error',no).on('exit',code=>code?no(Error(error)):yes(out)));
  child.stdin.end(input); return done;
};
const json = text => JSON.parse(text.trim().split('\n').filter(line=>/^[{[]/.test(line)).at(-1));
const literal = value => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
let owns=false;
await mkdir(output,{recursive:true});
const report={ image, database, migration, scope:'Network-isolated synthetic PostgreSQL only; no hosted Auth, Naver HTTP, scheduler or deployment claim.', checks:0, concurrency:0, pass:false };
try {
  const source=await readFile(resolve(project,migration),'utf8');report.migrationSha256=createHash('sha256').update(source).digest('hex');
  docker(['info','--format','{{.ServerVersion}}']);
  docker(['run','--detach','--network','none','--name',container,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);owns=true;
  const isolation=JSON.parse(docker(['inspect',container,'--format','{{json .HostConfig}}']));
  assert.equal(isolation.NetworkMode,'none');assert.equal(Object.keys(isolation.PortBindings||{}).length,0);
  const deadline=Date.now()+45000;
  for (;;) {
    try { await run('docker',[...dockerArgs,'exec',container,'pg_isready','--host=127.0.0.1','-U','postgres'],{env});break; }
    catch { if(Date.now()>=deadline)throw Error('Isolated PostgreSQL did not become ready');await new Promise(resolve=>setTimeout(resolve,200)); }
  }
  docker(['exec',container,'createdb','-U','postgres',database]);
  const fixSource=await readFile(resolve(project,conflictFix),'utf8');report.conflictFix={file:conflictFix,sha256:createHash('sha256').update(fixSource).digest('hex')};
  sql(await readFile(resolve(project,'supabase/tests/naver-bootstrap.sql'),'utf8'));sql(source);sql(fixSource);
  const result=sql(await readFile(resolve(project,'supabase/tests/naver-subscriptions.sql'),'utf8'));
  const installation=json(sql(await readFile(resolve(project,'supabase/tests/naver-installation.sql'),'utf8')));assert(Object.values(installation).every(value=>value===true));report.installation=installation;
  await writeFile(resolve(output,'sql.log'),result);report.checks=result.split('\n').filter(line=>line.startsWith('PASS ')).length;
  const owner=randomUUID(),workspace=randomUUID();
  sql(`update haedo_naver_private.runtime set ready=true;set role authenticated;select set_config('request.jwt.claims','${JSON.stringify({sub:owner,role:'authenticated'})}',false);select public.life_naver_save('${workspace}','concurrent',0,true);`);
  const [one,two]=await Promise.all([concurrent('set role service_role;select public.life_naver_claim(1);'),concurrent('set role service_role;select public.life_naver_claim(1);')]);
  const claims=[json(one),json(two)];assert.deepEqual(claims.map(rows=>rows.length).sort(),[0,1]);report.concurrency++;
  const lease=claims.find(rows=>rows.length)[0];
  const item={log_no:'777',title:'Anonymous concurrent item',url:'https://blog.naver.com/concurrent/777',content_text:null,content_hash:null,published_at:null,coverage:'link_only'};
  const finish=`set role service_role;select public.life_naver_finish('${lease.subscription_id}','${lease.lease_token}',${lease.revision},${literal([item])});`;
  const finishes=await Promise.all([concurrent(finish),concurrent(finish)]);assert.deepEqual(json(finishes[0]),{status:'stored',inserted:1});assert.deepEqual(json(finishes[1]),json(finishes[0]));
  assert.equal(sql('select count(*) from life_naver_items;').trim(),'1');report.concurrency++;
  const snapshot=()=>sql("select jsonb_build_object('subscriptions',(select jsonb_agg(to_jsonb(s) order by id) from life_naver_subscriptions s),'items',(select jsonb_agg(to_jsonb(i) order by id) from life_naver_items i),'receipts',(select jsonb_agg(to_jsonb(r) order by subscription_id,lease_token) from haedo_naver_private.receipts r),'ready',(select ready from haedo_naver_private.runtime));").trim();
  const before=snapshot();sql(source);sql(fixSource);assert.equal(snapshot(),before);report.reinstallPreservesRows=true;
  const operations=await readFile(resolve(project,'supabase/operations/naver-collection-activation.sql'),'utf8');
  const control=settings=>operations.replace('\nbegin;\n','\nbegin;\n'+settings+'\n');
  sql('update haedo_naver_private.runtime set ready=false;');
  const gated=snapshot();sql(operations);assert.equal(snapshot(),gated);
  assert.throws(()=>sql(control("set local haedo.naver_action='activate';")),/verification is required/);
  assert.throws(()=>sql(control("set local haedo.naver_action='activate';set local haedo.naver_external_validation='verified';set local haedo.naver_worker_environment='verified';")),/Vault provisioning is required/);
  assert.equal(snapshot(),gated);
  assert.equal(sql("select count(*) from pg_extension where extname in ('pg_cron','pg_net');").trim(),'0');
  // PostgreSQL's standard image has no Supabase cron/net/Vault extensions.
  // The pause fixture below stubs ONLY our own and a foreign cron job; it does
  // not claim that real extension installation or scheduled HTTP ran locally.
  sql("create schema cron;create table cron.job(jobname text primary key);insert into cron.job values('haedo-naver-blog-poll'),('unrelated-job');create function cron.unschedule(text) returns boolean language plpgsql as $$begin delete from cron.job where jobname=$1;return found;end$$;update haedo_naver_private.runtime set ready=true;");
  sql(control("set local haedo.naver_action='pause';"));
  assert.equal(snapshot(),gated);assert.equal(sql("select jobname from cron.job;").trim(),'unrelated-job');
  report.operations={inspectPreservesRows:true,missingAttestationRejected:true,missingVaultRejected:true,guardsLeaveExtensionsAbsent:true,pausePreservesRowsAndOtherJobs:true,
    actualActivation:'Not run: real Supabase extensions, Vault and worker environment require separate hosted verification.'};
  report.pass=true;
} catch(error) { report.error={message:error.message};throw error; }
finally { await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');if(owns)docker(['rm','--force',container]);console.log(JSON.stringify(report)); }

/* Real RSS operations in owned, network-disabled PostgreSQL. Cron/Vault/Net
 * are local signature/permission shims, never hosted services or HTTP calls. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process'), { randomUUID, createHash } = require('node:crypto');
if (process.argv.length !== 2) throw Error('No endpoint, account, credential or SQL arguments are accepted.');
const root = path.resolve(__dirname, '..'), migration = 'supabase/migrations/20261105051010_rss_private_intake.sql';
const files = Object.fromEntries(['activation', 'cron', 'rollback'].map(name => [name, 'supabase/operations/rss-' + name + '.sql']));
const sources = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, fs.readFileSync(path.join(root, file), 'utf8')]));
const image = 'postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3';
const owner = randomUUID(), container = 'haedo-rss-operations-' + owner, label = 'haedo.rss-operations-owner', env = { ...process.env };
for (const key of Object.keys(env)) if (/^(PG|DATABASE_URL$|SUPABASE|HAEDO_TEST_|DOCKER_HOST$|DOCKER_CONTEXT$|DOCKER_TLS$|DOCKER_TLS_VERIFY$|DOCKER_CERT_PATH$)/.test(key)) delete env[key];
const docker = (args, input) => execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], {
  env, input, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']
});
const sql = input => docker(['exec', '-i', container, 'psql', '--host=127.0.0.1', '--no-psqlrc', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], input).trim();
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const feed = 'https://fixture.example.test/feed.xml';
const json = text => JSON.parse(text.split('\n').findLast(line => line.startsWith('{') || line.startsWith('[')));
const checks = [], mutants = [], mutationEvidence = [];
const check = (name, fn) => { fn(); checks.push(name); console.log('PASS ' + name); };
const failure = error => String(error.stderr || error.message);
const rejects = (fn, pattern = /ERROR:/) => assert.throws(fn, error => pattern.test(failure(error)));

// Each returned statement is sent through a NEW psql session, with autocommit.
// Semicolons inside strings, comments and DO/function dollar quotes are not
// statement separators. No outer transaction or SET LOCAL can hide a split.
function statements(text) {
  let start = 0, quoteMode = null, tag = null, block = 0, line = false;
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '/' && next === '*') { block++; i++; } else if (c === '*' && next === '/') { block--; i++; } continue; }
    if (tag) { if (text.startsWith(tag, i)) { i += tag.length - 1; tag = null; } continue; }
    if (quoteMode) { if (c === quoteMode) { if (next === quoteMode) i++; else quoteMode = null; } continue; }
    if (c === '-' && next === '-') { line = true; i++; continue; }
    if (c === '/' && next === '*') { block = 1; i++; continue; }
    if (c === "'" || c === '"') { quoteMode = c; continue; }
    if (c === '$') { const match = text.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/); if (match) { tag = match[0]; i += tag.length - 1; continue; } }
    if (c === ';') { out.push(text.slice(start, i + 1)); start = i + 1; }
  }
  assert.equal(quoteMode || tag || block, 0, 'SQL has no unterminated literal/comment');
  if (text.slice(start).replace(/--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g, '').trim()) out.push(text.slice(start));
  return out;
}
function replaceOne(text, pattern, replacement) {
  const matches = text.match(pattern); assert.equal(matches?.length, 1, 'fixture replaces one reviewed input');
  return text.replace(pattern, replacement);
}
function prepared(name, options = {}, source = sources[name]) {
  let text = replaceOne(source, /action text := 'inspect';/g, "action text := '" + ({ activation: 'activate', cron: 'schedule', rollback: 'rollback' }[name]) + "';");
  if (name === 'activation') {
    text = replaceOne(text, /feed_url text := '__RSS_FEED_URL__';/g, 'feed_url text := ' + quote(options.feed ?? feed) + ';');
    text = replaceOne(text, /feed_review text := 'pending';/g, "feed_review text := '" + (options.feedReview ?? 'verified') + "';");
  }
  if (name !== 'rollback') text = replaceOne(text, /edge_review text := 'pending';/g, "edge_review text := '" + (options.edgeReview ?? 'verified') + "';");
  return text;
}
function run(name, { inspect = false, settings = '', role = '', source = sources[name], ...options } = {}) {
  const text = inspect ? source : prepared(name, options, source), parts = statements(text);
  assert.equal(parts.length, 1, name + ' has exactly one atomic statement');
  for (const part of parts) sql((role ? 'set role ' + role + ';\n' : '') + settings + part);
}
const state = () => json(sql(`select jsonb_build_object(
 'runtime',(select to_jsonb(r) from haedo_rss_private.runtime r),
 'jobs',(select coalesce(jsonb_agg(to_jsonb(j) order by jobid),'[]') from cron.job j),
 'materials',(select jsonb_agg(to_jsonb(m) order by id) from public.existing_material m),
 'storage',(select jsonb_agg(to_jsonb(s) order by id) from storage.objects s),
 'connections',(select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from haedo_rss_private.connections c),
 'observations',(select coalesce(jsonb_agg(to_jsonb(o) order by identity),'[]') from haedo_rss_private.observations o),
 'items',(select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') from haedo_rss_private.items i),
 'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by lease_token),'[]') from haedo_rss_private.receipts r));`));
const unchanged = (action, pattern) => { const before = state(); rejects(action, pattern); assert.deepEqual(state(), before, 'failed statement is atomic'); };
const permissions = () => sql(`select jsonb_agg(jsonb_build_object('table',c.relname,'acl',c.relacl,'rls',c.relrowsecurity) order by c.relname)
 from pg_class c where c.relnamespace='haedo_rss_private'::regnamespace and c.relkind='r';`);
const resetRuntime = () => sql("update haedo_rss_private.runtime set ready=false,allowed_feed_urls='{}';delete from cron.job where jobname='haedo-rss-poll';");
function mutation(name, operation, from, to, verify, arrange = () => {}, expectedSqlError = null) {
  assert.equal(sources[operation].split(from).length - 1, 1, 'mutation has one exact target');
  resetRuntime(); arrange();
  const changed = sources[operation].replace(from, to);
  let detected;
  assert.throws(() => verify(changed), error => {
    // A malformed mutant, a broken fixture or a Docker/psql failure is not a
    // killed regression. Only the intended assertion or named postcondition
    // guard may reject this mutant.
    const intended = expectedSqlError
      ? error.status === 3 && expectedSqlError.test(failure(error))
      : error instanceof assert.AssertionError;
    if (intended) detected = expectedSqlError ? failure(error).split('\n').find(line => line.startsWith('ERROR:')) : 'ERR_ASSERTION';
    return intended;
  }, 'regression must reject mutant ' + name);
  mutationEvidence.push({ name, expectedFailure: detected });
  mutants.push(name); console.log('MUTATION DETECTED ' + name);
}
const setup = `create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 grant usage on schema auth to anon,authenticated,service_role;
 create schema storage;create schema cron;create schema vault;create schema net;
 create table public.existing_material(id int primary key,body text);insert into public.existing_material values(1,'익명 원문'),(2,'unchanged fixture');
 create table storage.objects(id int primary key,name text);insert into storage.objects values(1,'private fixture byte reference');
 create table vault.decrypted_secrets(name text,decrypted_secret text);
 insert into vault.decrypted_secrets values('haedo_rss_project_url','https://fixture.supabase.co'),('haedo_rss_service_role_key','sb_secret_fixture_noncredential_1234567890');
 create table cron.job(jobid bigserial primary key,jobname text,schedule text,command text,nodename text default 'localhost',nodeport int default 5432,database text default current_database(),username text default current_user,active boolean default true,unique(jobname,username));
 insert into cron.job(jobname,schedule,command) values('unrelated-job','0 1 * * *','select 17;');
 create function cron.schedule(job_name text,job_schedule text,job_command text) returns bigint language plpgsql as $$declare id bigint;begin
  insert into cron.job(jobname,schedule,command) values(job_name,job_schedule,job_command)
   on conflict(jobname,username) do update set schedule=excluded.schedule,command=excluded.command returning jobid into id;
  if current_setting('test.rss_mutate_data',true)='yes' then delete from public.existing_material where existing_material.id=2;end if;
  if current_setting('test.rss_mutate_unrelated_job',true)='yes' then update cron.job set command='select 18;' where jobname='unrelated-job';end if;
  if current_setting('test.rss_schedule_failure',true)='yes' then raise exception 'synthetic schedule failure after insert';end if;
  return id;end$$;
 create function cron.unschedule(job_id bigint) returns boolean language plpgsql as $$declare removed boolean;begin
  delete from cron.job where jobid=job_id;removed:=found;
  if current_setting('test.rss_unschedule_failure',true)='yes' then raise exception 'synthetic unschedule failure after delete';end if;
  return removed;end$$;
 create table net.fixture_requests(id bigserial primary key,url text,body jsonb,params jsonb,headers jsonb,timeout int);
 create function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,headers jsonb default '{"Content-Type":"application/json"}'::jsonb,timeout_milliseconds int default 2000)
 returns bigint language plpgsql as $$declare request_id bigint;begin
 insert into net.fixture_requests(url,body,params,headers,timeout) values(url,body,params,headers,timeout_milliseconds) returning id into request_id;return request_id;end$$;`;
let started = false, removed = false;
async function main() {
  try {
    docker(['image', 'inspect', image]);
    docker(['run', '--detach', '--pull=never', '--network=none', '--name', container, '--label', label + '=' + owner, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image]); started = true;
    const info = JSON.parse(docker(['inspect', container, '--format', '{{json .}}']));
    assert.equal(info.Config.Labels[label], owner); assert.equal(info.HostConfig.NetworkMode, 'none'); assert.equal(Object.keys(info.HostConfig.PortBindings || {}).length, 0);
    const deadline = Date.now() + 45000;
    for (;;) { try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); break; }
      catch (error) { if (Date.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 200)); } }
    sql(setup); sql(fs.readFileSync(path.join(root, migration), 'utf8'));
    sql(`insert into haedo_rss_private.connections(id,owner_id,workspace_id,feed_url,status,revision,baseline_count,baseline_at)
      values('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',${quote(feed)},'paused',3,1,'2026-11-05T00:00:00Z');
      insert into haedo_rss_private.observations(connection_id,identity,url,baseline) values('10000000-0000-4000-8000-000000000001','guid:baseline',null,true);
      insert into haedo_rss_private.items(id,owner_id,connection_id,identity,title,url,content_text,content_hash,published_at,disposition,item_hash)
      values('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','guid:saved','보관 자료',null,'원문 그대로',encode(sha256(convert_to('원문 그대로','UTF8')),'hex'),'2026-11-05T00:01:00Z','stored',sha256('fixture'::bytea));
      insert into haedo_rss_private.receipts(connection_id,lease_token,request_hash,result)
      values('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',sha256('receipt'::bytea),'{"status":"stored","inserted":1}');`);
    const originalPermissions = permissions();
    check('default inspect is unchanged in independent autocommit sessions', () => {
      const before = state(); for (const name of Object.keys(files)) run(name, { inspect: true }); assert.deepEqual(state(), before);
    });
    check('placeholder, invalid URL and missing review attestations fail without changes', () => {
      for (const value of ['__RSS_FEED_URL__', 'http://fixture.example.test/feed.xml', 'https://user:pass@fixture.example.test/feed.xml', 'https://127.0.0.1/feed.xml', 'https://fixture.example.test:443/feed.xml', 'https://fixture.example.test/a\\b'])
        unchanged(() => run('activation', { feed: value }));
      unchanged(() => run('activation', { feedReview: 'pending' })); unchanged(() => run('activation', { edgeReview: 'pending' }));
    });
    check('anonymous, signed-in and service clients cannot run any administrative operation', () => {
      for (const role of ['anon', 'authenticated', 'service_role'])
        for (const name of Object.keys(files)) unchanged(() => run(name, { role }), /permission denied/);
    });
    check('activation is idempotent and preserves all source rows and ACL/RLS', () => {
      const before = state(); run('activation'); run('activation'); const current = state();
      assert.equal(current.runtime.ready, true); assert.deepEqual(current.runtime.allowed_feed_urls, [feed]);
      assert.deepEqual({ ...current, runtime: before.runtime }, before); assert.equal(permissions(), originalPermissions);
    });
    check('Cron refuses absent readiness or unverified Edge', () => {
      unchanged(() => run('cron', { edgeReview: 'pending' })); sql('update haedo_rss_private.runtime set ready=false;');
      unchanged(() => run('cron')); run('activation');
    });
    check('missing, duplicate and public Vault credentials never schedule work', () => {
      const keyName = 'haedo_rss_service_role_key';
      sql('delete from vault.decrypted_secrets where name=' + quote(keyName)); unchanged(() => run('cron'));
      sql('insert into vault.decrypted_secrets values(' + quote(keyName) + ",'sb_publishable_fixture_not_server');"); unchanged(() => run('cron'));
      sql("update vault.decrypted_secrets set decrypted_secret='sb_secret_fixture_noncredential_1234567890' where name=" + quote(keyName));
      sql('insert into vault.decrypted_secrets select * from vault.decrypted_secrets where name=' + quote(keyName)); unchanged(() => run('cron'));
      sql('delete from vault.decrypted_secrets where ctid in (select ctid from vault.decrypted_secrets where name=' + quote(keyName) + ' limit 1)');
      sql("update vault.decrypted_secrets set decrypted_secret='http://fixture.supabase.co' where name='haedo_rss_project_url';"); unchanged(() => run('cron'));
      sql("update vault.decrypted_secrets set decrypted_secret='https://fixture.supabase.co' where name='haedo_rss_project_url';");
    });
    check('Cron insertion failure and unrelated row/job mutations roll back atomically', () => {
      for (const [fault, reason] of [
        ['rss_schedule_failure', /ERROR:  synthetic schedule failure after insert/],
        ['rss_mutate_data', /ERROR:  Row count changed in public[.]existing_material/],
        ['rss_mutate_unrelated_job', /ERROR:  An unrelated cron job changed; rolled back/]
      ]) unchanged(() => run('cron', { settings: "set test." + fault + "='yes';\n" }), reason);
    });
    check('one named Cron preserves unrelated jobs and uses Vault apikey with 120-second timeout', () => {
      const unrelated = state().jobs; run('cron'); run('cron'); const jobs = state().jobs;
      assert.deepEqual(jobs.filter(job => job.jobname !== 'haedo-rss-poll'), unrelated);
      const ours = jobs.filter(job => job.jobname === 'haedo-rss-poll'); assert.equal(ours.length, 1); assert.equal(ours[0].schedule, '* * * * *');
      const command = ours[0].command;
      assert.match(command, /vault\.decrypted_secrets/); assert.match(command, /'apikey'/); assert.doesNotMatch(command, /Authorization|Bearer|sb_secret_fixture/);
      sql(command);
      const request = json(sql('select to_jsonb(r) from net.fixture_requests r order by id desc limit 1;'));
      assert.equal(request.url, 'https://fixture.supabase.co/functions/v1/haedo-rss'); assert.deepEqual(request.body, { action: 'run' });
      assert.equal(request.timeout, 120000); assert.equal(request.headers.apikey, 'sb_secret_fixture_noncredential_1234567890'); assert.equal(request.headers.Authorization, undefined);
    });
    check('rollback failure keeps both readiness and Cron unchanged', () => {
      unchanged(() => run('rollback', { settings: "set test.rss_unschedule_failure='yes';\n" }), /synthetic unschedule failure/);
    });
    check('rollback is idempotent, preserves all data and fences an already copied Cron command', () => {
      const before = state(), command = before.jobs.find(job => job.jobname === 'haedo-rss-poll').command;
      run('rollback'); run('rollback'); const after = state(); assert.equal(after.runtime.ready, false);
      assert.deepEqual(after.runtime.allowed_feed_urls, before.runtime.allowed_feed_urls);
      assert.deepEqual(after.jobs, before.jobs.filter(job => job.jobname !== 'haedo-rss-poll'));
      for (const key of ['materials', 'storage', 'connections', 'observations', 'items', 'receipts']) assert.deepEqual(after[key], before[key]);
      const requests = sql('select count(*) from net.fixture_requests;'); sql(command); assert.equal(sql('select count(*) from net.fixture_requests;'), requests);
    });
    check('reactivation and rescheduling after rollback retain exact rows and permissions', () => {
      run('activation'); run('cron'); assert.equal(state().runtime.ready, true); assert.equal(state().jobs.filter(job => job.jobname === 'haedo-rss-poll').length, 1);
      assert.equal(permissions(), originalPermissions);
    });
    mutation('activation omission cannot report success', 'activation', 'set ready=true,', 'set ready=false,', source => {
      run('activation', { source }); assert.equal(state().runtime.ready, true);
    }, () => {}, /ERROR:  Unexpected RSS runtime change; rolled back/);
    mutation('Bearer replacement is rejected by real scheduled request assertions', 'cron', "'application/json','apikey',", "'application/json','Authorization',", source => {
      run('cron', { source }); const command = state().jobs.find(job => job.jobname === 'haedo-rss-poll').command; sql(command);
      const request = json(sql('select to_jsonb(r) from net.fixture_requests r order by id desc limit 1;'));
      assert.equal(request.headers.apikey, 'sb_secret_fixture_noncredential_1234567890'); assert.equal(request.headers.Authorization, undefined);
    }, () => run('activation'));
    mutation('short HTTP timeout is rejected', 'cron', 'timeout_milliseconds := 120000', 'timeout_milliseconds := 1000', source => {
      run('cron', { source }); sql(state().jobs.find(job => job.jobname === 'haedo-rss-poll').command);
      assert.ok(Number(sql('select timeout from net.fixture_requests order by id desc limit 1;')) >= 60000);
    }, () => run('activation'));
    mutation('row-count guard removal exposes injected row loss', 'cron',
      "raise exception 'Row count changed in % (% -> %); rolled back', r.relation, r.rows, n;", 'null;', source => {
        unchanged(() => run('cron', { source, settings: "set test.rss_mutate_data='yes';\n" }));
      }, () => run('activation'));
    // Restore the synthetic row removed by the guard mutant, never a user row.
    sql("insert into public.existing_material values(2,'unchanged fixture') on conflict(id) do nothing;");
    mutation('rollback must disable runtime as well as remove Cron', 'rollback', 'set ready=false where singleton;', 'set ready=ready where singleton;', source => {
      run('rollback', { source }); assert.equal(state().runtime.ready, false);
    }, () => { run('activation'); run('cron'); }, /ERROR:  Unexpected RSS rollback state; rolled back/);
  } finally {
    if (started) { const info = JSON.parse(docker(['inspect', container, '--format', '{{json .}}'])); assert.equal(info.Config.Labels[label], owner); docker(['rm', '--force', '--volumes', info.Id]); removed = true; }
  }
  const report = { pass: true, checks, mutants, mutationEvidence, engine: 'owned PostgreSQL 17 with local Cron/Vault/Net shims', network: 'none', removed,
    hostedDatabaseAccess: false, realFeedRequests: 0, realExtensions: false,
    files: Object.fromEntries(Object.entries(sources).map(([name, source]) => [files[name], createHash('sha256').update(source).digest('hex')])) };
  const output = path.join(root, '.local/rss-operations-postgres'); fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(checks.length + ' RSS operations checks passed; ' + mutants.length + ' mutants caught; owned container removed.');
}
main().catch(error => { console.error('FAIL RSS operations: ' + error.message); process.exitCode = 1; });

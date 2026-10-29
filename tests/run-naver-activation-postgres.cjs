/* Owned network-disabled PostgreSQL only. Real control SQL with Cron/Vault
 * shims; no hosted DB, Naver, credentials, extension installation or HTTP calls. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process'), { randomUUID, createHash } = require('node:crypto');
if (process.argv.length !== 2) throw Error('No endpoint, account, SQL or credential options are accepted.');
const root = path.resolve(__dirname, '..'), file = path.join(root, 'supabase/operations/naver-collection-activation.sql');
const source = fs.readFileSync(file, 'utf8'), owner = randomUUID(), container = 'haedo-naver-activation-' + process.pid + '-' + owner;
const label = 'haedo.naver-activation-test-owner', image = 'postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3';
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(PG|DATABASE_URL$|SUPABASE|HAEDO_TEST_|DOCKER_HOST$|DOCKER_CONTEXT$|DOCKER_TLS$|DOCKER_TLS_VERIFY$|DOCKER_CERT_PATH$)/.test(key)) delete env[key];
const docker = (args, input) => execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], {
  env, input, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']
});
const sql = input => docker(['exec', '-i', container, 'psql', '--host=127.0.0.1', '--no-psqlrc', '--set=ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--username=postgres'], input).trim();
// Only extension DDL is substituted: actual mode/guard/transaction/schedule
// statements execute in PostgreSQL against fixed local shims below.
assert.equal((source.match(/create extension if not exists (pg_cron|pg_net);/g) || []).length, 2);
const executable = source.replace(/create extension if not exists (pg_cron|pg_net);/g, (_, name) => "insert into extension_calls values ('" + name + "');");
const run = settings => sql(executable.replace(/^begin;$/m, 'begin;\n' + settings));
const activate = mode => "set local haedo.naver_action='activate';set local haedo.naver_external_validation='verified';set local haedo.naver_worker_environment='verified';" + (mode === undefined ? '' : "set local haedo.naver_mode='" + mode + "';");
const state = () => JSON.parse(sql(`select json_build_object(
 'ready',(select ready from haedo_naver_private.runtime),
 'jobs',(select json_agg(j order by jobname) from cron.job j),
 'extensionCalls',(select count(*) from extension_calls),
 'preserved',(select payload from public.life_naver_captures));`));
const rejected = (settings, message) => assert.throws(() => run(settings), error => String(error.stderr).includes(message));
const checks = [], check = (name, fn) => { fn(); checks.push(name); console.log('PASS ' + name); };
let started = false, removed = false;
async function main() {
  try {
    docker(['image', 'inspect', image]); // Never pull implicitly or accept an arbitrary image.
    docker(['run', '--detach', '--pull=never', '--network=none', '--name', container, '--label', label + '=' + owner,
      '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image]); started = true;
    const info = JSON.parse(docker(['inspect', container, '--format', '{{json .}}']));
    assert.equal(info.Config.Labels[label], owner); assert.equal(info.HostConfig.NetworkMode, 'none');
    assert.equal(Object.keys(info.HostConfig.PortBindings || {}).length, 0);
    const deadline = Date.now() + 45000;
    for (;;) {
      try { docker(['exec', container, 'pg_isready', '--host=127.0.0.1', '-U', 'postgres']); break; }
      catch (_) { if (Date.now() >= deadline) throw Error('Owned test PostgreSQL was not ready.'); await new Promise(resolve => setTimeout(resolve, 200)); }
    }
    check('default inspect needs no schema and does not install extensions', () => run(''));
    sql(`create schema haedo_naver_private;create schema vault;create schema cron;
      create table haedo_naver_private.runtime(singleton boolean,ready boolean);insert into haedo_naver_private.runtime values(true,false);
      create table public.life_naver_captures(payload text);insert into public.life_naver_captures values('immutable fixture body/photo receipt');
      create table vault.decrypted_secrets(name text,decrypted_secret text);
      insert into vault.decrypted_secrets values('haedo_naver_project_url','https://fixture.supabase.co'),('haedo_naver_service_role_key',repeat('synthetic-',8));
      create table extension_calls(name text);create table cron.job(jobname text primary key,schedule text,command text);
      insert into cron.job values('unrelated-job','0 1 * * *','unrelated fixture');
      create function cron.schedule(job_name text,job_schedule text,job_command text) returns bigint language plpgsql as $$begin
        if job_name='haedo-naver-capture-poll' and current_setting('test.fail_capture_schedule',true)='yes' then raise exception 'synthetic schedule failure';end if;
        insert into cron.job values(job_name,job_schedule,job_command) on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command;
        return 1;end$$;
      create function cron.unschedule(job_name text) returns boolean language plpgsql as $$begin delete from cron.job where jobname=job_name;return found;end$$;`);
    check('inspect leaves runtime, existing jobs and data unchanged even with an unknown mode', () => {
      const before = state(); run("set local haedo.naver_mode='unknown';"); assert.deepEqual(state(), before);
    });
    check('invalid mode and missing attestations fail before extension or schedule changes', () => {
      const before = state(); rejected(activate('unknown'), 'Unknown Naver collection mode');
      rejected("set local haedo.naver_action='activate';set local haedo.naver_mode='public';", 'verification is required');
      assert.deepEqual(state(), before);
    });
    check('duplicate Vault secret blocks public mode atomically', () => {
      sql("insert into vault.decrypted_secrets values('haedo_naver_service_role_key',repeat('duplicate-',8));");
      const before = state(); rejected(activate('public'), 'Exactly one server-only'); assert.deepEqual(state(), before);
      sql("delete from vault.decrypted_secrets where decrypted_secret=repeat('duplicate-',8);");
    });
    check('public mode creates only the PC run schedule and preserves unrelated work', () => {
      run(activate('public')); const current = state(); assert.equal(current.ready, true);
      assert.deepEqual(current.jobs.map(j => j.jobname), ['haedo-naver-capture-poll', 'unrelated-job']);
      const job = current.jobs[0]; assert.equal(job.schedule, '*/15 * * * *'); assert.match(job.command, /body:='\{"action":"run"\}'::jsonb/);
      assert.match(job.command, /\/functions\/v1\/haedo-naver-blog/); assert.match(job.command, /vault\.decrypted_secrets/);
      assert.equal(job.command.includes('synthetic-'), false); assert.equal(current.preserved, 'immutable fixture body/photo receipt');
    });
    check('default all mode schedules RSS cron and PC run without duplicating named jobs', () => {
      run(activate()); run(activate()); const jobs = state().jobs;
      assert.deepEqual(jobs.map(j => j.jobname), ['haedo-naver-blog-poll', 'haedo-naver-capture-poll', 'unrelated-job']);
      assert.match(jobs[0].command, /body:='\{"action":"cron"\}'::jsonb/); assert.equal(jobs[0].schedule, '*/15 * * * *');
    });
    check('switching all to public removes the old RSS schedule and keeps PC work', () => {
      run(activate('public')); run(activate('public'));
      assert.deepEqual(state().jobs.map(j => j.jobname), ['haedo-naver-capture-poll', 'unrelated-job']);
    });
    check('capture scheduling failure rolls back RSS unschedule, extension changes and ready', () => {
      run(activate()); sql('update haedo_naver_private.runtime set ready=false;'); const before = state();
      rejected(activate('public') + "set local test.fail_capture_schedule='yes';", 'synthetic schedule failure');
      assert.deepEqual(state(), before);
    });
    check('pause ignores activation mode and attestations while preserving data and unrelated jobs', () => {
      run("set local haedo.naver_action='pause';set local haedo.naver_mode='unknown';");
      const current = state(); assert.equal(current.ready, false); assert.deepEqual(current.jobs.map(j => j.jobname), ['unrelated-job']);
      assert.equal(current.preserved, 'immutable fixture body/photo receipt');
    });
  } finally {
    if (started) {
      const info = JSON.parse(docker(['inspect', container, '--format', '{{json .}}'])); assert.equal(info.Config.Labels[label], owner);
      docker(['rm', '--force', '--volumes', info.Id]); removed = true;
    }
  }
  const report = { pass: true, engine: 'owned PostgreSQL 17 with schedule/Vault shims', checks, containerRemoved: removed,
    sourceSha256: createHash('sha256').update(source).digest('hex'), network: 'none', hostedDatabaseAccess: false, installedRealExtensions: false };
  fs.mkdirSync(path.join(root, '.local/naver-activation-postgres'), { recursive: true });
  fs.writeFileSync(path.join(root, '.local/naver-activation-postgres/report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(checks.length + ' activation SQL checks passed; owned container removed.');
}
main().catch(error => { console.error('FAIL activation SQL: ' + error.message); process.exitCode = 1; });

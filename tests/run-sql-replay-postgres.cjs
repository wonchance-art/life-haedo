/* Disposable local PostgreSQL only. No endpoint, account or credential options.
 * npm run test:sql-replay [-- path/to/change.sql ...]
 *
 * 1. Replays the test-only Supabase stub plus every supabase/migrations/*.sql file in
 *    filename order (tests/helpers/supabase-pg-stub.cjs). The first failing file stops
 *    the run with its name, SQLSTATE and line.
 * 2. Applies supabase/operations/20261101-account-sync-install.sql on top (its six
 *    migrations then run a second time), then the later installs that redefine the same
 *    functions (20261102-blog-ai-authorship-install.sql) and the idempotent AI cap install
 *    (20261104-ai-usage-install.sql), and requires every result check
 *    to be true and the schema/grant/policy/bucket catalog to be unchanged.
 * 3. Runs supabase/operations/naver-status-check.sql and requires its 12 rows (1-11 plus 5.5).
 * 4. Cross-checks scripts/sql-final-definitions.mjs against the replayed functions.
 * 4.5 Runs supabase/tests/blog-ai-authorship.sql (rolled back) on a fresh replayed copy.
 * 4.6 Runs supabase/tests/life-ai-usage.sql (rolled back) on a fresh replayed copy, then two
 *     sessions of two DIFFERENT accounts race for the last of the project-wide monthly AI
 *     budget: exactly one reservation wins.
 * 4.7 Runs supabase/operations/20261104-naver-cron-apikey.sql on a fresh replayed copy with a
 *     pg_cron alter_job shim: inspect changes nothing; apikey rewrites only the two existing
 *     Naver schedules' commands (same jobid/schedule/active/database/user, no key value in the
 *     command), is idempotent and reversible; unknown modes, an sb_secret_ Bearer, a change
 *     beyond the command, a row-count change and a database without the schedules roll back.
 * 4.8 Runs the withdrawal-before-publication contract (tests/run-blog-unpublish-postgres.cjs,
 *     20261111120000) on a fresh replayed copy: every publish path, owner and visitor reads,
 *     deletion, receipts, privileges and other owners. That file run directly also checks the
 *     earlier definition and the installation itself.
 * 5. Optional arguments: repository .sql files (for example a production SQL change under
 *    review) applied in order to a fresh copy of the replayed database.
 * Skips (exit 0) when the machine has no PostgreSQL server binaries, unless
 * SQL_REPLAY_REQUIRED=1 (CI), which turns the skip into a failure.
 */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const pgStub = require('./helpers/supabase-pg-stub.cjs');

const ROOT = pgStub.ROOT;
const INSTALL = path.join(ROOT, 'supabase/operations/20261101-account-sync-install.sql');
const STATUS = path.join(ROOT, 'supabase/operations/naver-status-check.sql');
// Installs applied after INSTALL, in order. Each redefines functions INSTALL also
// defines, so the replayed catalog is only restored once all of them have run.
const LATER_INSTALLS = [
  { file: path.join(ROOT, 'supabase/operations/20261102-blog-ai-authorship-install.sql'), checks: 5 },
  // Not a redefinition of INSTALL: re-applied to prove the AI cap install is idempotent.
  { file: path.join(ROOT, 'supabase/operations/20261104-ai-usage-install.sql'), checks: 5 },
];
const AUTHORSHIP_SQL = path.join(ROOT, 'supabase/tests/blog-ai-authorship.sql');
const AI_USAGE_SQL = path.join(ROOT, 'supabase/tests/life-ai-usage.sql');
const NAVER_CRON_SQL = path.join(ROOT, 'supabase/operations/20261104-naver-cron-apikey.sql');
const STUB_SCHEMAS = ['auth', 'storage', 'cron', 'vault', 'net', 'extensions'];

function extraFiles() {
  return process.argv.slice(2).map(arg => {
    const file = path.resolve(arg);
    if (/:\/\/|=/.test(arg) || !file.startsWith(ROOT + path.sep) || !file.endsWith('.sql') || !fs.statSync(file, { throwIfNoEntry: false })?.isFile())
      throw Error(`Only existing repository .sql files are accepted, not: ${arg}`);
    if (file.startsWith(path.join(ROOT, 'supabase/operations/archive') + path.sep)) throw Error(`Archived one-off SQL is never run again: ${arg}`);
    return file;
  });
}

// Schema-level fingerprint: functions (definition + ACL), columns, constraints, indexes,
// policies, triggers, relation ACL/RLS, schema ACL and storage bucket settings.
const CATALOG_SQL = `
with ns as (select oid, nspname from pg_namespace where nspname not in ('pg_catalog','information_schema','pg_toast') and nspname not like 'pg_temp%' and nspname not like 'pg_toast_temp%')
select line from (
  select 'function ' || ns.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') def:' || md5(pg_get_functiondef(p.oid)) || ' acl:' || coalesce(p.proacl::text, '-') as line
    from pg_proc p join ns on ns.oid = p.pronamespace where p.prokind <> 'a'
  union all select 'column ' || ns.nspname || '.' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' notnull:' || a.attnotnull || ' default:' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-') || ' acl:' || coalesce(a.attacl::text, '-')
    from pg_attribute a join pg_class c on c.oid = a.attrelid join ns on ns.oid = c.relnamespace left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attnum > 0 and not a.attisdropped and c.relkind in ('r','v','m','p','f')
  union all select 'constraint ' || ns.nspname || '.' || co.conrelid::regclass::text || ' ' || co.conname || ' ' || pg_get_constraintdef(co.oid)
    from pg_constraint co join ns on ns.oid = co.connamespace
  union all select 'index ' || schemaname || '.' || indexname || ' ' || indexdef from pg_indexes where schemaname in (select nspname from ns)
  union all select 'policy ' || schemaname || '.' || tablename || '.' || policyname || ' ' || permissive || ' ' || cmd || ' ' || roles::text || ' using:' || coalesce(qual, '-') || ' check:' || coalesce(with_check, '-')
    from pg_policies
  union all select 'trigger ' || t.tgrelid::regclass::text || ' ' || pg_get_triggerdef(t.oid) from pg_trigger t where not t.tgisinternal
  union all select 'relation ' || ns.nspname || '.' || c.relname || ' kind:' || c.relkind::text || ' rls:' || c.relrowsecurity || '/' || c.relforcerowsecurity || ' acl:' || coalesce(c.relacl::text, '-')
    from pg_class c join ns on ns.oid = c.relnamespace where c.relkind in ('r','v','m','p','f','S')
  union all select 'schema ' || nspname || ' acl:' || coalesce(n.nspacl::text, '-') from pg_namespace n where n.oid in (select oid from ns)
  union all select 'bucket ' || row_to_json(b)::text from storage.buckets b
) x order by line`;

async function catalog(client) {
  return (await client.query(CATALOG_SQL)).rows.map(row => row.line);
}

function diff(before, after) {
  const a = new Set(before), b = new Set(after);
  return [...before.filter(x => !b.has(x)).map(x => '- ' + x), ...after.filter(x => !a.has(x)).map(x => '+ ' + x)];
}

async function main() {
  const extras = extraFiles();
  if (!pgStub.findPostgres()) {
    const reason = 'no local PostgreSQL server binaries (/usr/lib/postgresql/<n>/bin, HAEDO_PG_BIN or pg_config). Nothing was checked.';
    if (process.env.SQL_REPLAY_REQUIRED === '1') throw Error(reason + ' SQL_REPLAY_REQUIRED=1 forbids skipping.');
    console.log('SKIP sql replay: ' + reason);
    return;
  }
  const started = Date.now();
  const pg = await pgStub.startReplayedCluster({ label: 'sql-replay' });
  const pass = name => console.log('PASS ' + name);
  try {
    const client = await pg.connect(pg.database);
    try {
      const version = (await client.query('show server_version')).rows[0].server_version;
      const migrations = pg.timings.filter(t => t.file !== 'stub');
      const slowest = [...migrations].sort((a, b) => b.ms - a.ms).slice(0, 3).map(t => `${t.file} ${t.ms}ms`).join(', ');
      pass(`replayed stub + ${migrations.length} migrations on PostgreSQL ${version} in ${pg.replayMs}ms (slowest: ${slowest})`);

      const before = await catalog(client);
      const installStart = Date.now();
      const results = [].concat(await pgStub.applyFile(client, INSTALL));
      const checks = results[results.length - 1].rows;
      assert.equal(checks.length, 4, 'account sync install result table');
      for (const row of checks) assert.equal(row.ok, true, `install check failed: ${row.check_name}`);
      for (const later of LATER_INSTALLS) {
        const rows = [].concat(await pgStub.applyFile(client, later.file)).at(-1).rows;
        assert.equal(rows.length, later.checks, path.basename(later.file) + ' result table');
        for (const row of rows) assert.equal(row.ok, true, `${path.basename(later.file)} check failed: ${row.check_name}`);
      }
      const changed = diff(before, await catalog(client));
      assert.deepEqual(changed, [], 'account sync install changed the replayed catalog:\n' + changed.slice(0, 40).join('\n'));
      pass(`account sync install + ${LATER_INSTALLS.length} later install(s) re-applied on top in ${Date.now() - installStart}ms: ${checks.length}+${LATER_INSTALLS.reduce((n, l) => n + l.checks, 0)} checks true, ${before.length} catalog entries unchanged`);

      const status = [].concat(await pgStub.applyFile(client, STATUS));
      const rows = status[status.length - 1].rows;
      assert.deepEqual(rows.map(row => Number(row.ord)), [1, 2, 3, 4, 5, 5.5, 6, 7, 8, 9, 10, 11], 'naver status check rows');
      assert(rows.every(row => typeof row.item === 'string' && row.value !== null), 'every status row has a value');
      pass(`naver status check returned ${rows.length} rows (${rows.map(row => `${row.ord}=${row.value}`).join('; ')})`);

      const generator = await import(pathToFileURL(path.join(ROOT, 'scripts/sql-final-definitions.mjs')).href);
      const summary = generator.summarize(generator.scan(await generator.load(pathToFileURL(ROOT + path.sep))));
      const live = (await client.query(`select n.nspname || '.' || p.proname as name, count(*)::int as n
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname not in ('pg_catalog','information_schema') and not (n.nspname = any($1)) group by 1`, [STUB_SCHEMAS])).rows;
      const inDb = new Map(live.map(row => [row.name, row.n]));
      const parsed = new Map(summary.functions.filter(f => !f.dropped).map(f => [f.name, f.live.length]));
      assert.deepEqual([...inDb.keys()].filter(name => !parsed.has(name)).sort(), [], 'functions in the database but not found by the final-definition scan');
      assert.deepEqual([...parsed.keys()].filter(name => !inDb.has(name)).sort(), [], 'functions found by the scan but missing from the database');
      for (const [name, count] of parsed) assert.equal(inDb.get(name), count, `${name}: overload count differs from the scan`);
      pass(`final-definition scan matches the replayed catalog (${parsed.size} functions, ${summary.redefinedFunctions.length} redefined)`);
    } finally { await client.end(); }

    const authorshipDb = await pg.cloneDatabase('replay_ai_authorship');
    const authorship = await pg.connect(authorshipDb);
    try {
      const rows = [].concat(await pgStub.applyFile(authorship, AUTHORSHIP_SQL)).filter(result => result.rows?.length).at(-1).rows;
      const result = rows[0].result;
      assert.equal(result.failures, 0); assert(result.passed >= 25, 'blog AI authorship assertions ran: ' + result.passed);
      pass(`supabase/tests/blog-ai-authorship.sql: ${result.passed} assertions on a fresh replayed copy (rolled back)`);
      // The install's precheck: a re-run over its own definitions proceeds; a
      // function whose body differs from the repository stops it unchanged.
      const install = LATER_INSTALLS[0].file, body = name => authorship.query(`select prosrc from pg_proc where oid = to_regprocedure($1)`, [name]).then(r => r.rows[0].prosrc);
      const again = [].concat(await pgStub.applyFile(authorship, install)).at(-1).rows;
      assert(again.length === LATER_INSTALLS[0].checks && again.every(row => row.ok === true), 're-running the authorship install');
      const definition = (await authorship.query(`select pg_get_functiondef(to_regprocedure('haedo_blog_private.valid_document(jsonb,uuid)')) d`)).rows[0].d;
      await authorship.query(definition.replace('\nbegin\n', '\nbegin\n -- drifted copy\n'));
      const drifted = await body('haedo_blog_private.valid_document(jsonb,uuid)');
      await assert.rejects(pgStub.applyFile(authorship, install), /valid_document differs from the repository definition/);
      assert.equal(await body('haedo_blog_private.valid_document(jsonb,uuid)'), drifted, 'a stopped install changes nothing');
      pass('authorship install proceeds on a re-run and stops unchanged when a function body differs from the repository');
    } finally { await authorship.end(); }

    const usageDb = await pg.cloneDatabase('replay_ai_usage');
    const usage = await pg.connect(usageDb), rival = await pg.connect(usageDb);
    try {
      const rows = [].concat(await pgStub.applyFile(usage, AI_USAGE_SQL)).filter(result => result.rows?.length).at(-1).rows;
      const result = rows[0].result;
      assert.equal(result.failures, 0); assert(result.passed >= 50, 'AI usage assertions ran: ' + result.passed);
      pass(`supabase/tests/life-ai-usage.sql: ${result.passed} assertions on a fresh replayed copy (rolled back)`);
      // Two Edge requests of two different accounts race for the last 1,000 micro-USD of the
      // project. Session 1 reserves for account 1 and holds its transaction open; session 2
      // (account 2, no usage of its own) must wait for the project lock, then see the cap.
      const [owner, other] = (await usage.query('select gen_random_uuid() a, gen_random_uuid() b')).rows.map(r => [r.a, r.b])[0];
      await usage.query('insert into auth.users(id) values($1),($2)', [owner, other]);
      await usage.query(`insert into haedo_ai_private.usage(owner_id,month,cost_micro_usd) values($1,date_trunc('month',clock_timestamp() at time zone 'UTC')::date,9999000)`, [owner]);
      const reserve = (client, id, who = owner) => client.query(`select public.life_ai_reserve($1,$2,'claude-haiku-5-5',1000,1000)->>'status' s`, [who, id]).then(r => r.rows[0].s);
      const ids = (await usage.query('select gen_random_uuid() a, gen_random_uuid() b')).rows[0];
      await usage.query('begin'); await usage.query('set local role service_role');
      await rival.query('begin'); await rival.query('set local role service_role');
      assert.equal(await reserve(usage, ids.a), 'reserved');
      const pid = (await rival.query('select pg_backend_pid() p')).rows[0].p;
      const waiting = reserve(rival, ids.b, other);
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        blocked = (await pg.connect(usageDb).then(async c => { try { return (await c.query(`select wait_event_type='Lock' w from pg_stat_activity where pid=$1`, [pid])).rows[0]?.w; } finally { await c.end(); } })) === true;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert(blocked, 'the second account\'s reservation waits for the project lock');
      await usage.query('commit');
      assert.equal(await waiting, 'limit', 'the waiting reservation sees the first one and is refused at the cap');
      await rival.query('commit');
      const totals = (await usage.query(`select sum(cost_micro_usd+reserved_micro_usd) t, (select count(*)::int from haedo_ai_private.reservations where owner_id = any($1)) n from haedo_ai_private.usage where owner_id = any($1)`, [[owner, other]])).rows[0];
      assert.equal(Number(totals.t), 9999600); assert.equal(totals.n, 1);
      pass('two accounts reserving the last project budget at once: one reserved, the other waited on the project lock and got limit; project total 9,999,600 <= 10,000,000 micro-USD');
    } finally { await usage.end(); await rival.end(); }

    // Production path for the AI cap: a database that has every earlier migration but not
    // 20261104090000 gets it from the SQL Editor install. The result must equal the replay.
    {
      const admin = await pg.connect();
      try { await admin.query('create database replay_ai_install'); } finally { await admin.end(); }
      const fresh = await pg.connect('replay_ai_install'), full = await pg.connect(pg.database);
      try {
        await pgStub.replayMigrations(fresh, { files: pgStub.migrationFiles().filter(file => path.basename(file) !== '20261104090000_life_ai_usage.sql') });
        const rows = [].concat(await pgStub.applyFile(fresh, LATER_INSTALLS[1].file)).at(-1).rows;
        assert(rows.length === LATER_INSTALLS[1].checks && rows.every(row => row.ok === true), 'AI usage install on a database without the migration');
        const changed = diff(await catalog(full), await catalog(fresh));
        assert.deepEqual(changed, [], 'the AI usage install differs from the migration:\n' + changed.slice(0, 40).join('\n'));
        pass(`AI usage install on a database without its migration: ${rows.length} checks true, catalog identical to the replay`);
      } finally { await fresh.end(); await full.end(); }
    }

    // Naver cron header switch (legacy keys retire by the end of 2026; sb_secret_ is apikey-only).
    {
      const cronDb = await pg.cloneDatabase('replay_naver_cron');
      const db = await pg.connect(cronDb);
      try {
        const source = fs.readFileSync(NAVER_CRON_SQL, 'utf8');
        assert.equal((source.match(/^begin;$/mg) || []).length, 1, 'one transaction');
        const run = settings => db.query(source.replace(/^begin;$/m, 'begin;\n' + settings)).then(r => [].concat(r).at(-1).rows);
        const refused = async (settings, message) => {
          await assert.rejects(run(settings), error => String(error.message).includes(message), message);
          await db.query('rollback');
        };
        const SECRET = 'sb_secret_' + 'synthetic'.repeat(6), JWT = 'eyJsynthetic.' + 'legacy'.repeat(8) + '.signature';
        const bearer = action => `select net.http_post(url:=(select decrypted_secret from vault.decrypted_secrets where name='haedo_naver_project_url')||'/functions/v1/haedo-naver-blog',
          headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='haedo_naver_service_role_key')),
          body:='{"action":"${action}"}'::jsonb,timeout_milliseconds:=120000);`;
        // Same signature as pg_cron 1.6 cron.alter_job; test settings inject the failures the SQL must catch.
        await db.query(`alter table cron.job add column command text, add column database text default current_database(), add column username text default current_user;
          create function cron.alter_job(job_id bigint, schedule text default null, command text default null, database text default null,
            username text default null, active boolean default null) returns void language plpgsql as $f$ begin
            if current_setting('test.cron_insert_extra', true) = 'yes' then
              insert into cron.job(jobname, schedule, command, active) select 'extra-' || j.jobname, j.schedule, j.command, j.active from cron.job j where j.jobid = job_id; end if;
            update cron.job j set schedule = coalesce(alter_job.schedule, j.schedule), command = coalesce(alter_job.command, j.command),
              active = case when current_setting('test.cron_flip_active', true) = 'yes' then not j.active else coalesce(alter_job.active, j.active) end
              where j.jobid = job_id;
            if not found then raise exception 'could not find valid entry for job %', job_id; end if;
            end $f$;`);
        await db.query(`insert into vault.decrypted_secrets values ('haedo_naver_project_url', 'https://fixture.supabase.co'), ('haedo_naver_service_role_key', $1)`, [SECRET]);
        await db.query(`insert into cron.job(jobname, schedule, command, active) values
          ('haedo-naver-blog-poll', '*/15 * * * *', $1, true), ('haedo-naver-capture-poll', '7,22,37,52 * * * *', $2, false),
          ('unrelated-job', '0 1 * * *', 'select 1', true)`, [bearer('cron'), bearer('run')]);
        const jobs = () => db.query('select jobid, jobname, schedule, active, command from cron.job order by jobname').then(r => r.rows);
        const initial = await jobs();
        const inspect = await run('');
        assert.deepEqual(inspect.map(r => [r.check_name, r.header, r.ok]), [['haedo-naver-blog-poll', 'bearer', false], ['haedo-naver-capture-poll', 'bearer', false]]);
        assert.deepEqual(await jobs(), initial, 'inspect changes nothing');
        await refused("set local haedo.naver_cron_action='other';", 'Unknown Naver cron header operation');
        // The worker credential must be an sb_secret_ key or JWT-shaped (no length rule; key lengths are undocumented).
        for (const bad of ['x'.repeat(60), ' ' + SECRET, SECRET + '\n', 'sb_publishable_' + 'synthetic'.repeat(6), 'sb_secret_short', 'a.b']) {
          await db.query(`update vault.decrypted_secrets set decrypted_secret = $1 where name = 'haedo_naver_service_role_key'`, [bad]);
          await refused("set local haedo.naver_cron_action='apikey';", 'Exactly one server-only named worker credential is required');
        }
        await db.query(`update vault.decrypted_secrets set decrypted_secret = $1 where name = 'haedo_naver_service_role_key'`, [SECRET]);
        await refused("set local haedo.naver_cron_action='bearer';", 'cannot be sent as a Bearer token');
        await refused("set local haedo.naver_cron_action='apikey';set local test.cron_insert_extra='yes';", 'Row count changed in cron.job');
        await refused("set local haedo.naver_cron_action='apikey';set local test.cron_flip_active='yes';", 'changed beyond its command');
        assert.deepEqual(await jobs(), initial, 'refused runs roll back');
        for (let i = 0; i < 2; i++) {
          const rows = await run("set local haedo.naver_cron_action='apikey';");
          assert.deepEqual(rows.map(r => [r.check_name, r.schedule, r.header, r.ok]),
            [['haedo-naver-blog-poll', '*/15 * * * *', 'apikey', true], ['haedo-naver-capture-poll', '7,22,37,52 * * * *', 'apikey', true]]);
        }
        const after = await jobs();
        assert.deepEqual(after.map(j => [j.jobid, j.jobname, j.schedule, j.active]), initial.map(j => [j.jobid, j.jobname, j.schedule, j.active]), 'same jobs, schedules and active state');
        assert.equal(after.find(j => j.jobname === 'unrelated-job').command, 'select 1');
        for (const [name, action] of [['haedo-naver-blog-poll', 'cron'], ['haedo-naver-capture-poll', 'run']]) {
          const command = after.find(j => j.jobname === name).command;
          assert.match(command, /'apikey',\(select decrypted_secret from vault\.decrypted_secrets where name='haedo_naver_service_role_key'\)/);
          assert(command.includes(`'{"action":"${action}"}'::jsonb`) && !command.includes('Authorization') && !command.includes(SECRET), name);
        }
        // Recovery path for a rolled-back Edge function: a legacy JWT in Vault may go back to Bearer.
        await db.query(`update vault.decrypted_secrets set decrypted_secret = $1 where name = 'haedo_naver_service_role_key'`, [JWT]);
        const back = await run("set local haedo.naver_cron_action='bearer';");
        assert.deepEqual(back.map(r => [r.header, r.ok]), [['bearer', false], ['bearer', false]]);
        assert(!(await jobs()).some(j => j.command.includes(JWT)), 'no key value in any command');
        // A database where collection was never activated: nothing to switch, nothing changes.
        await db.query("delete from cron.job where jobname like 'haedo-naver-%'");
        const empty = await jobs();
        await refused("set local haedo.naver_cron_action='apikey';", 'No Naver schedule to change');
        assert.deepEqual(await jobs(), empty);
        pass('naver cron apikey switch: inspect unchanged; 2 existing schedules rewritten in place (idempotent, reversible); unknown mode, malformed or padded credential, sb_secret_ Bearer, non-command change, row-count change and no schedules rolled back');
      } finally { await db.end(); }
    }

    {
      const withdrawDb = await pg.cloneDatabase('replay_blog_withdraw'), db = await pg.connect(withdrawDb);
      const log = console.log; let count;
      try { console.log = () => {}; count = await require('./run-blog-unpublish-postgres.cjs').contract(db, { installed: true, connect: () => pg.connect(withdrawDb) }); }
      finally { console.log = log; await db.end(); }
      assert(count >= 50, 'withdrawal-before-publication checks ran: ' + count);
      pass(`withdrawal before publication (20261111120000): ${count} checks on a fresh replayed copy`);
    }

    const clone = await pg.cloneDatabase('replay_clone');
    const copy = await pg.connect(clone);
    try {
      const count = sql => copy.query(sql).then(r => r.rows[0].n);
      assert.equal(await count("select count(*)::int n from public.life_account_documents"), 0);
      pass(`cloneDatabase() gives other SQL tests an isolated copy (${await count("select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public'")} public functions)`);
    } finally { await copy.end(); }

    if (extras.length) {
      const db = await pg.cloneDatabase('replay_extra');
      const extra = await pg.connect(db);
      try {
        for (const file of extras) {
          const t = Date.now();
          const result = [].concat(await pgStub.applyFile(extra, file));
          const last = result[result.length - 1];
          pass(`${path.relative(ROOT, file)} applied on a fresh replayed copy in ${Date.now() - t}ms (${last.command || 'no statement'}, ${last.rows?.length ?? 0} rows)`);
          if (last.rows?.length) console.table(last.rows.slice(0, 20));
        }
      } finally { await extra.end(); }
    }
    console.log(`sql replay finished in ${Date.now() - started}ms`);
  } finally {
    await pg.stop();
  }
}

main().catch(error => { console.error('FAIL sql replay: ' + error.message); process.exitCode = 1; });

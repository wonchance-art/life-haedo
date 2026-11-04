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
 *     sessions race for the last of the monthly AI budget: exactly one reservation wins.
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
      // Two Edge requests of one owner race for the last 1,000 micro-USD. Session 1 reserves
      // and holds its transaction open; session 2 must wait for it, then see the cap.
      const owner = (await usage.query('select gen_random_uuid() id')).rows[0].id;
      await usage.query('insert into auth.users(id) values($1)', [owner]);
      await usage.query(`insert into haedo_ai_private.usage(owner_id,month,cost_micro_usd) values($1,date_trunc('month',clock_timestamp() at time zone 'UTC')::date,9999000)`, [owner]);
      const reserve = (client, id) => client.query(`select public.life_ai_reserve($1,$2,'claude-haiku-5-5',1000,1000)->>'status' s`, [owner, id]).then(r => r.rows[0].s);
      const ids = (await usage.query('select gen_random_uuid() a, gen_random_uuid() b')).rows[0];
      await usage.query('begin'); await usage.query('set local role service_role');
      await rival.query('begin'); await rival.query('set local role service_role');
      assert.equal(await reserve(usage, ids.a), 'reserved');
      const pid = (await rival.query('select pg_backend_pid() p')).rows[0].p;
      const waiting = reserve(rival, ids.b);
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        blocked = (await pg.connect(usageDb).then(async c => { try { return (await c.query(`select wait_event_type='Lock' w from pg_stat_activity where pid=$1`, [pid])).rows[0]?.w; } finally { await c.end(); } })) === true;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert(blocked, 'the second reservation waits for the first one\'s owner lock');
      await usage.query('commit');
      assert.equal(await waiting, 'limit', 'the waiting reservation sees the first one and is refused at the cap');
      await rival.query('commit');
      const totals = (await usage.query(`select cost_micro_usd+reserved_micro_usd t, (select count(*)::int from haedo_ai_private.reservations where owner_id=$1) n from haedo_ai_private.usage where owner_id=$1`, [owner])).rows[0];
      assert.equal(Number(totals.t), 9999600); assert.equal(totals.n, 1);
      pass('two concurrent reservations for the last budget: one reserved, the other waited on the owner lock and got limit; total 9,999,600 <= 10,000,000 micro-USD');
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

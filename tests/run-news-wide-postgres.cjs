/* Disposable local PostgreSQL only. No endpoint, account or credential options.
 *   npm ci --prefix tests/sql-ci --ignore-scripts --no-audit --no-fund
 *   node tests/run-news-wide-postgres.cjs
 *
 * supabase/migrations/20261111130000_news_wide_feed.sql on top of the replay of every
 * earlier migration (tests/helpers/supabase-pg-stub.cjs), with a test-only Auth
 * session shim:
 *   1. the migration changes no existing object and applies twice with the same result;
 *   2. tables, schema and functions are closed to anon, to other accounts and to the
 *      wrong role (catalog and real calls);
 *   3. claim/finish/clear: input validation, lease, TTL, retry delay, hourly and daily
 *      allowance, retention, row cap, owner isolation, concurrency;
 *   4. the real Edge handler (supabase/functions/haedo-news-wide) against these
 *      functions, with a fixture supplier: fresh -> cached -> stale -> limited;
 *   5. the allow list: empty means nobody; only the operations SQL
 *      (supabase/operations/20261111-news-wide-allow-first-account.sql) fills it, and
 *      only when exactly one non-anonymous account exists;
 *   5b. the owner-accounts operations SQL
 *      (supabase/operations/20261112-news-wide-allow-owner-accounts.sql, its own database):
 *      adds every non-anonymous account only when there are exactly the expected number;
 *   6. md5(prosrc) of the installed functions equals the table in
 *      docs/design-review/news-wide-feed.md (--hashes prints the current table).
 * --mutation=<name> weakens one guard in memory (no file is rewritten); the unchanged
 * checks must then fail. Names: MUTATIONS below.
 * Skips (exit 0) when the machine has no PostgreSQL server binaries, unless
 * SQL_REPLAY_REQUIRED=1 (CI), which turns the skip into a failure.
 */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const pgStub = require('./helpers/supabase-pg-stub.cjs');

const ROOT = pgStub.ROOT, NAME = '20261111130000_news_wide_feed.sql';
const FILE = path.join(ROOT, 'supabase/migrations', NAME);
const OPS = path.join(ROOT, 'supabase/operations/20261111-news-wide-allow-first-account.sql');
const OWNERS = path.join(ROOT, 'supabase/operations/20261112-news-wide-allow-owner-accounts.sql');
const DOC = path.join(ROOT, 'docs/design-review/news-wide-feed.md');
const SUPPLIER = 'google-news-rss';
const ALLOWED_CHECK = " if not exists (select 1 from haedo_news_wide_private.allowed_accounts a where a.owner_id = who) then\n  return jsonb_build_object('status', 'not_allowed'); end if;\n";
// Mutations of the operations SQL instead of the migration.
const OPS_MUTATIONS = {
  'ops-two-accounts': sql => sql.replace('if accounts <> 1 then', 'if accounts < 1 then').replace('if listed_after <> 1 or not exists (', 'if not exists ('),
  'ops-count-not-exact': sql => sql.replace('if accounts <> 1 then', 'if accounts < 1 then'),
  'ops-anonymous-counted': sql => sql.replaceAll('where not coalesce(u.is_anonymous, false)', 'where true'),
  // The before/after row-count comparison: removed, or auth.users left out of it.
  'ops-row-count-not-compared': sql => sql.replace("    if n <> (before ->> (r.nspname || '.' || r.relname))::bigint then", '    if false then'),
  'ops-users-not-counted': sql => sql.replace(" or (ns.nspname = 'auth' and c.relname = 'users')", ''),
  'ops-prints-account': sql => sql.replace("raise notice 'news-wide allow list: % account(s) before, % after; % existing tables unchanged',\n    listed_before,", "raise notice 'news-wide allow list: % account(s) before, % after; % existing tables unchanged',\n    (select owner_id from haedo_news_wide_private.allowed_accounts limit 1),"),
};
// Mutations of the owner-accounts operations SQL (2026-11-12, three accounts).
const OWNERS_MUTATIONS = {
  // The exact count: the first check removed (the later list check still stops it, with the wrong reason), or both.
  'owners-count-not-compared': sql => sql.replace('if accounts <> expected then', 'if false then'),
  'owners-count-unchecked': sql => sql.replace('if accounts <> expected then', 'if false then').replace('if listed_after <> expected\n     or exists (', 'if exists ('),
  'owners-anonymous-included': sql => sql.replaceAll('where not coalesce(u.is_anonymous, false)', 'where true'),
  // The creation cutoff: the stop removed (the insert and the set check still exclude a later account, with the wrong reason), or all of it.
  'owners-cutoff-not-checked': sql => sql.replace('if late <> 0 then', 'if false then'),
  'owners-cutoff-removed': sql => sql.replace('if late <> 0 then', 'if false then').replaceAll(' and coalesce(u.created_at < created_cutoff, false)', ''),
  // The before/after row-count comparison: removed, or auth.users left out of it.
  'owners-row-count-not-compared': sql => sql.replace("    if n <> (before ->> (r.nspname || '.' || r.relname))::bigint then", '    if false then'),
  'owners-users-not-counted': sql => sql.replace(" or (ns.nspname = 'auth' and c.relname = 'users')", ''),
  'owners-haedo-not-counted': sql => sql.replace(" or left(ns.nspname, 6) = 'haedo_'", ''),
  'owners-prints-account': sql => sql.replace("% expected; % existing tables unchanged',\n    listed_before,", "% expected; % existing tables unchanged',\n    (select owner_id from haedo_news_wide_private.allowed_accounts limit 1),"),
};
const MUTATIONS = {
  // The allow list: removed from one function, or open while the table is empty.
  'allow-check-removed-claim': sql => sql.replace(ALLOWED_CHECK, ''),
  'allow-check-removed-finish': sql => sql.replace(" if not exists (select 1 from haedo_news_wide_private.allowed_accounts a where a.owner_id = p_owner_id) then\n  return jsonb_build_object('status', 'not_allowed', 'stored', 0, 'failed', 0, 'stale', 0); end if;\n", ''),
  'empty-list-allows': sql => sql.replace(ALLOWED_CHECK, ALLOWED_CHECK.replace(' if not exists (', ' if exists (select 1 from haedo_news_wide_private.allowed_accounts) and not exists (')),
  'allow-list-writable': sql => sql.replace('notify pgrst', "grant insert on haedo_news_wide_private.allowed_accounts to authenticated;\nnotify pgrst"),
  'allow-list-self-service': sql => sql.replace(" delete from haedo_news_wide_private.feeds where owner_id = who;\n get diagnostics removed = row_count;", " insert into haedo_news_wide_private.allowed_accounts(owner_id) values (who) on conflict do nothing;\n delete from haedo_news_wide_private.feeds where owner_id = who;\n get diagnostics removed = row_count;"),
  'escape-typo': sql => sql.replace('u2000-', 'u200-'),
  'row-cap-once': sql => sql.replace("    while (select count(*) from haedo_news_wide_private.feeds where owner_id = who) >= 64 loop", "    if (select count(*) from haedo_news_wide_private.feeds where owner_id = who) >= 64 then").replace("     exit when not found;\n    end loop;", "    end if;"),
  'boolean-word-allowed': sql => sql.replace("  and p_topic !~ ' (OR|AND|NOT) '\n", ''),
  'minus-word-allowed': sql => sql.replace("  and p_topic !~ '(^| )[-+]'\n", ''),
  // A hyphen after a mark (a,-b), the right single quote as an apostrophe, two dots, the backslash.
  'minus-after-mark-allowed': sql => sql.replace("[''\\u2019-]|[''\\u2019-]($|", "[''\\u2019]|[''\\u2019]($|"),
  'right-quote-not-apostrophe': sql => sql.replace("[''\\u2019-]|[''\\u2019-]($|", "[''-]|[''-]($|"),
  'double-dot-allowed': sql => sql.replace("  and position('..' in p_topic) = 0\n", ''),
  'backslash-allowed': sql => sql.replace(" and position(chr(92) in p_topic) = 0", ''),
  // The old form of the ASCII symbol rule: its meaning followed the caller's standard_conforming_strings.
  'escape-depends-on-setting': sql => sql.replace("  and p_topic !~ '[][\"$()*:;<=>@^_`{|}~]' and position(chr(92) in p_topic) = 0", "  and p_topic !~ '[\"$()*:;<=>@^_`{|}~\\[\\]\\\\]'"),
  // RLS/grant relaxation: the owner could read the table (and everybody's rows) directly.
  'table-grant': sql => sql.replace('notify pgrst', "grant select on haedo_news_wide_private.feeds to authenticated;\ndrop policy if exists leak on haedo_news_wide_private.feeds;\ncreate policy leak on haedo_news_wide_private.feeds for select to authenticated using (true);\nnotify pgrst"),
  'no-rls': sql => sql.replace('alter table haedo_news_wide_private.feeds enable row level security;', ''),
  'anon-claim': sql => sql.replace('grant execute on function public.life_news_wide_claim(text,jsonb), public.life_news_wide_clear() to authenticated;',
    'grant execute on function public.life_news_wide_claim(text,jsonb), public.life_news_wide_clear() to authenticated,anon;\ngrant execute on function haedo_news_wide_private.claim(text,jsonb) to anon;'),
  'no-session-check': sql => sql.replace("where u.id = who and s.id = sid::uuid and not coalesce(u.is_anonymous, false)\n    and (s.not_after is null or s.not_after > statement_timestamp())", 'where u.id = who'),
  'user-finish': sql => sql.replace('grant execute on function public.life_news_wide_finish(uuid,text,jsonb) to service_role;', 'grant execute on function public.life_news_wide_finish(uuid,text,jsonb) to service_role,authenticated;')
    .replace('grant execute on function haedo_news_wide_private.finish(uuid,text,jsonb) to service_role;', 'grant execute on function haedo_news_wide_private.finish(uuid,text,jsonb) to service_role,authenticated;'),
  'no-hour-limit': sql => sql.replace('elsif quota.hour_count >= 60 then', 'elsif false then'),
  'no-day-limit': sql => sql.replace('elsif quota.day_count >= 600 then', 'elsif false then'),
  'no-ttl': sql => sql.replace("expired := has and r.fetched_at <= stamp - interval '30 minutes';", 'expired := false;'),
  'no-lease': sql => sql.replace("elsif present and r.lease_until > stamp then state := 'busy';", ''),
  'no-backoff': sql => sql.replace("elsif present and r.next_attempt_at > stamp then state := 'backoff';", ''),
  'any-link': sql => sql.replace("and i->>'link' ~ '^https://news[.]google[.]com/[!-~]*$'", ''),
  'any-topic': sql => sql.replace(/  and p_topic !~ '\[\]\["[^\n]+\n/, ''),
  'lease-not-checked': sql => sql.replace("if not found or r.lease_token is distinct from (e->>'leaseToken')::uuid or r.lease_until <= stamp then", 'if not found then'),
  'clear-everyone': sql => sql.replace('delete from haedo_news_wide_private.feeds where owner_id = who;', 'delete from haedo_news_wide_private.feeds;'),
  'no-retention': sql => sql.replace(/ delete from haedo_news_wide_private\.feeds where owner_id = who and touched_at < stamp - interval '7 days'\n  and \(lease_until is null or lease_until <= stamp\);\n/, ''),
};
const args = process.argv.slice(2), printHashes = args.length === 1 && args[0] === '--hashes';
if (!printHashes && (args.length > 1 || args.length && !(/^--mutation=[a-z-]+$/.test(args[0]) && [MUTATIONS, OPS_MUTATIONS, OWNERS_MUTATIONS].some(set => Object.hasOwn(set, args[0].slice(11))))))
  throw Error('Only --hashes or --mutation=' + [...Object.keys(MUTATIONS), ...Object.keys(OPS_MUTATIONS), ...Object.keys(OWNERS_MUTATIONS)].join('|') + ' is accepted.');
const mutation = printHashes ? undefined : args[0]?.slice(11);
function mutated(file, set) {
  const original = fs.readFileSync(file, 'utf8');
  if (!mutation || !Object.hasOwn(set, mutation)) return original;
  const changed = set[mutation](original);
  if (changed === original) throw Error('Mutation ' + mutation + ' no longer matches ' + path.basename(file) + '.');
  return changed;
}
const migration = () => mutated(FILE, MUTATIONS), operations = () => mutated(OPS, OPS_MUTATIONS), ownersSQL = () => mutated(OWNERS, OWNERS_MUTATIONS);
const UUID_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const HASH_QUERY = "select p.proname, md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='haedo_news_wide_private' order by 1;";
// The expected md5(prosrc) table in the operations guide: | `name` | `32 hex` | between the two markers.
function documentedHashes() {
  const text = fs.readFileSync(DOC, 'utf8'), start = text.indexOf('<!-- news-wide-function-hashes:start -->'), end = text.indexOf('<!-- news-wide-function-hashes:end -->');
  assert(start >= 0 && end > start, 'the function hash table markers are in ' + path.basename(DOC));
  assert(text.includes(HASH_QUERY), 'the guide shows the exact hash query');
  return [...text.slice(start, end).matchAll(/^\| `([a-z_]+)` \| `([a-f0-9]{32})` \|$/gm)].map(match => [match[1], match[2]]);
}

// Same shape as run-sql-replay-postgres: functions, columns, constraints, indexes, policies,
// triggers, relation ACL/RLS and schema ACL.
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
) x order by line`;
const catalog = client => client.query(CATALOG_SQL).then(result => result.rows.map(row => row.line));
const OWN = /^(?:function|column|constraint|index|policy|trigger|relation|schema) (?:haedo_news_wide_private\b|public\.life_news_wide_(?:claim|finish|clear)\()/;

// Test-only Auth pieces the functions read: sessions, the anonymous flag and the JWT claims.
const AUTH_SHIM = `
alter table auth.users add column if not exists is_anonymous boolean;
create table if not exists auth.sessions (id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, not_after timestamptz);
create or replace function auth.jwt() returns jsonb language sql stable as $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;`;

let passed = 0;
const pass = name => { passed++; console.log('PASS ' + name); };
const link = n => 'https://news.google.com/rss/articles/CBMiFIXTURE' + n + '?oc=5';
const item = (n, changes = {}) => ({ id: String(n).padStart(32, '0'), title: '가상 제목 ' + n, link: link(n), publishedAt: '2026-11-11T09:00:00.000Z', sourceName: '가상일보', sourceUrl: 'https://outlet.example/', ...changes });

// 5b. The owner-accounts operations SQL (owner decision 2026-11-12: all three non-anonymous
// accounts are the owner's). Its own database, so the cases start from a known state.
async function ownerAccounts(pg) {
  const text = fs.readFileSync(OWNERS, 'utf8');
  // Plain ASCII with no \u sequence (the orchestrator's tool would turn one into a character),
  // one expected count, and the result check names the same number.
  assert(!/[^\x00-\x7f]/.test(text) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) && !/\r/.test(text), 'the owner-accounts SQL is plain ASCII');
  assert(!/\\u/i.test(text), 'the owner-accounts SQL holds no \\u sequence');
  assert(!text.includes('\\'), 'the owner-accounts SQL holds no backslash at all (a tool that doubles one would change a pattern silently)');
  assert(!UUID_TEXT.test(text) && !/@[a-z0-9-]+\./i.test(text), 'no account ID or e-mail address in the owner-accounts SQL');
  assert.deepEqual([...text.matchAll(/^ {2}expected constant bigint := (\d+);$/gm)].map(match => Number(match[1])), [3], 'one expected constant, 3');
  assert.deepEqual([...text.matchAll(/allowed_accounts\) = (\d+) as ok/g)].map(match => Number(match[1])), [3], 'the result check expects the same 3');
  assert.deepEqual([...text.matchAll(/^ {2}created_cutoff constant timestamptz := '([^']+)';$/gm)].map(match => match[1]), ['2026-10-04 00:00:00+00'], 'one creation cutoff');
  assert.deepEqual([...text.matchAll(/u\.created_at < '([^']+)'::timestamptz/g)].map(match => match[1]), ['2026-10-04 00:00:00+00', '2026-10-04 00:00:00+00'], 'the result check uses the same cutoff');
  assert.equal((text.match(/^do \$haedo_news_wide_allow_owners\$$/gm) || []).length, 1, 'one DO block');
  // Outside comments and string literals (the result check names privileges as strings).
  assert(!/\b(delete|truncate|drop|grant|revoke|alter|update)\b/i.test(text.replace(/^\s*--.*$/gm, '').replace(/'[^']*'/g, "''")), 'no delete, truncate, drop, grant, revoke, alter or update');

  const admin = await pg.connect();
  try { await admin.query('create database news_wide_owners'); await admin.query('create database news_wide_owners_bare'); } finally { await admin.end(); }
  {
    const empty = await pg.connect('news_wide_owners_bare');
    try { await pgStub.replayMigrations(empty, { files: [] }); await assert.rejects(empty.query(text), /apply migration 20261111130000_news_wide_feed\.sql first/); } finally { await empty.end(); }
  }
  const db = await pg.connect('news_wide_owners'), rival = await pg.connect('news_wide_owners');
  try {
    await pgStub.replayMigrations(db, { files: pgStub.migrationFiles().filter(file => path.basename(file) !== NAME) });
    await db.query(AUTH_SHIM);
    await db.query(migration());
    const said = [];
    db.on('notice', notice => said.push(String(notice.message)));
    const rows = table => db.query(`select count(*)::int n from ${table}`).then(result => result.rows[0].n);
    const listed = () => db.query('select owner_id::text id, added_at::text at from haedo_news_wide_private.allowed_accounts order by 1').then(result => result.rows);
    const install = async () => { const results = [].concat(await db.query(ownersSQL())); return results.at(-1).rows; };
    const refused = async (pattern, label) => {
      const state = await listed();
      await assert.rejects(install(), error => { said.push(String(error.message)); return pattern.test(error.message); }, label);
      assert.deepEqual(await listed(), state, label + ': the allow list did not change');
    };
    // created: the owner's accounts exist before the cutoff (2026-10-04); a later sign-up gets now(), or null.
    const OWNED = '2026-09-01 08:00:00+00';
    const account = async (anonymous, n, created = 'now') => {
      const id = randomUUID(), session = randomUUID();
      await db.query('insert into auth.users(id, email, is_anonymous, created_at) values ($1, $2, $3, $4)', [id, anonymous === true ? null : 'owner' + n + '@example.invalid', anonymous, created === 'now' ? new Date() : created]);
      await db.query('insert into auth.sessions(id, user_id) values ($1, $2)', [session, id]);
      return { id, session };
    };
    const late = n => new RegExp('^Found ' + n + ' non-anonymous account\\(s\\) created on or after the cutoff of the owner decision 2026-11-12 \\(or with no creation time\\)\\. Nothing was added\\. Ask the owner again\\.$');
    const found = n => new RegExp('^Expected exactly 3 non-anonymous accounts \\(owner decision 2026-11-12\\), found ' + n + '\\. Nothing was added\\. Ask the owner again\\.$');

    await refused(found(0), 'no account at all');
    const ANON = await account(true, 0);
    await refused(found(0), 'only an anonymous account');
    const A = await account(false, 1, OWNED);
    await refused(found(1), 'one real account');
    const B = await account(null, 2, OWNED); // no flag at all counts as a real account
    await refused(found(2), 'two real accounts');
    const C = await account(false, 3, '2026-10-03 11:46:00+00');
    // Three real accounts, but the list already holds another (anonymous) account: stop.
    await db.query('insert into haedo_news_wide_private.allowed_accounts(owner_id) values ($1)', [ANON.id]); // test setup only
    await refused(/^The allow list would hold 4 account\(s\) and must hold exactly the 3 non-anonymous accounts\. Nothing was changed\.$/, 'the list already holds another account');
    await db.query('delete from haedo_news_wide_private.allowed_accounts');
    // A row count that changes while it runs rolls it back, in another table and in auth.users
    // (the same waiting scheme as for the first operations SQL above).
    const installPid = (await db.query('select pg_backend_pid() p')).rows[0].p;
    const racing = async (change, values, pattern, label) => {
      const state = await listed();
      await rival.query('begin');
      let outcome;
      try {
        await rival.query('lock table haedo_news_wide_private.allowed_accounts in row exclusive mode');
        outcome = install().then(() => null, error => error);
        let waiting = false;
        for (let attempt = 0; attempt < 500 && !waiting; attempt++) {
          const probe = await pg.connect('news_wide_owners');
          try { waiting = (await probe.query(`select wait_event_type = 'Lock' w from pg_stat_activity where pid = $1`, [installPid])).rows[0]?.w === true; } finally { await probe.end(); }
          if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert(waiting, label + ': the operations SQL waits for the allow list after its first count');
        await rival.query(change, values);
        await rival.query('commit');
      } catch (error) { await rival.query('rollback').catch(() => {}); throw error; }
      const error = await outcome;
      assert(error instanceof Error, label + ': the operations SQL must not succeed');
      said.push(String(error.message));
      assert.match(error.message, pattern, label);
      assert.deepEqual(await listed(), state, label + ': the allow list did not change');
    };
    await db.query('create table public.news_wide_probe_rows (n integer)'); // test-only, counted like any other table
    await racing('insert into public.news_wide_probe_rows values (1)', [], /Row count changed in public\.news_wide_probe_rows \(before 0, after 1\)\. Rolled back/, 'another table changes meanwhile');
    const LATE = randomUUID();
    await racing('insert into auth.users(id, is_anonymous) values ($1, true)', [LATE], /Row count changed in auth\.users \(before 4, after 5\)\. Rolled back/, 'an anonymous account appears meanwhile (the account check alone would pass)');
    await db.query('create schema haedo_probe; create table haedo_probe.rows (n integer)'); // test-only, a haedo_* table
    await racing('insert into haedo_probe.rows values (1)', [], /Row count changed in haedo_probe\.rows \(before 0, after 1\)\. Rolled back/, 'a haedo_* table changes meanwhile');
    await db.query('delete from auth.users where id = $1', [LATE]); await db.query('drop table public.news_wide_probe_rows; drop schema haedo_probe cascade');
    // One of the three is already listed (as the first operations SQL could have left it): its row is kept, the other two are added.
    await db.query('insert into haedo_news_wide_private.allowed_accounts(owner_id) values ($1)', [A.id]); // test setup only
    const kept = (await listed())[0];
    const counts = async () => ({ feeds: await rows('haedo_news_wide_private.feeds'), limits: await rows('haedo_news_wide_private.limits'), users: await rows('auth.users'), sessions: await rows('auth.sessions') });
    const countsBefore = await counts();
    const expectedReport = [['allowed accounts equal the expected 3', true, 3], ['the allow list is exactly the non-anonymous accounts', true, 3],
      ['no non-anonymous account created on or after the cutoff', true, 0], ['no anonymous account on the allow list', true, 0], ['no API role can read or write the allow list', true, 0], ['row level security is on', true, null]];
    const shape = report => report.map(row => [row.check_name, row.ok, row.n === null ? null : Number(row.n)]);
    let report = await install();
    assert.deepEqual(shape(report), expectedReport);
    const installed = await listed();
    assert.deepEqual(installed.map(row => row.id), [A.id, B.id, C.id].sort(), 'exactly the three real accounts, not the anonymous one');
    assert.deepEqual(installed.find(row => row.id === A.id), kept, 'the account already listed keeps its row');
    assert.deepEqual(await counts(), countsBefore, 'no other row count changed');
    report = await install();
    assert.deepEqual(shape(report), expectedReport); assert.deepEqual(await listed(), installed, 'running it again changes nothing (same rows, same times)');
    // Each of the three can now use the feature (rolled back, nothing kept); the anonymous account still cannot.
    const claim = async who => {
      await db.query('begin');
      try {
        await db.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [JSON.stringify({ sub: who.id, role: 'authenticated', session_id: who.session }), who.id]);
        await db.query('set local role authenticated');
        return (await db.query('select public.life_news_wide_claim($1, $2::jsonb) value', [SUPPLIER, JSON.stringify([{ topic: '기후', language: 'ko' }])])).rows[0].value;
      } catch (error) { return { status: 'error: ' + error.message }; } finally { await db.query('rollback'); }
    };
    for (const who of [A, B, C]) assert.equal((await claim(who)).entries?.[0]?.status, 'claimed', 'an allowed account gets a lease');
    assert.notEqual((await claim(ANON)).status, 'ok', 'the anonymous account is not allowed');
    assert.deepEqual(await counts(), countsBefore, 'the claims were rolled back');
    // A fourth real account appears: stop, the three stay as they are.
    const D = await account(false, 4);
    await refused(found(4), 'four real accounts');
    await db.query('delete from auth.users where id = $1', [D.id]);
    // An anonymous account that becomes a real one counts as a fourth.
    await db.query('update auth.users set is_anonymous = false where id = $1', [ANON.id]);
    await refused(found(4), 'an anonymous account turned real');
    await db.query('update auth.users set is_anonymous = true where id = $1', [ANON.id]);
    // One of the three is deleted (its list row goes with it): two left, stop.
    await db.query('delete from auth.users where id = $1', [C.id]);
    await refused(found(2), 'one of the three accounts removed');
    // The count is three again, but not with the accounts the owner confirmed: stop.
    const E = await account(false, 5);
    await refused(late(1), 'one owner account removed and a new account signed up after the cutoff');
    await db.query('delete from auth.users where id = $1', [E.id]);
    const F = await account(false, 6, null);
    await refused(late(1), 'an account with no creation time');
    await db.query('delete from auth.users where id = $1', [F.id]);
    await db.query('update auth.users set is_anonymous = false where id = $1', [ANON.id]);
    await refused(late(1), 'an anonymous account created after the cutoff turned real');
    await db.query('update auth.users set is_anonymous = true where id = $1', [ANON.id]);
    assert.deepEqual((await listed()).map(row => row.id), [A.id, B.id].sort(), 'the two remaining owner accounts stay listed, nothing else');
    // What it says (notices, errors, result rows) holds counts only.
    for (const line of [...said, JSON.stringify(report)]) assert(!UUID_TEXT.test(line) && !line.includes('@'), 'no account ID or e-mail in the output: ' + line);
    const notices = said.filter(line => line.startsWith('news-wide allow list: '));
    assert.equal(notices.length, 2, 'one notice per successful run');
    assert.match(notices[0], /^news-wide allow list: 1 account\(s\) before, 3 after, 3 expected; \d+ existing tables unchanged$/);
    assert.match(notices[1], /^news-wide allow list: 3 account\(s\) before, 3 after, 3 expected; \d+ existing tables unchanged$/);
    assert(said.length >= 12, 'errors were captured');
    pass('owner-accounts SQL (expected 3, cutoff 2026-10-04): 0, anonymous-only, 1, 2 and 4 real accounts (also an anonymous one turned real, and one of three removed) refused with the list unchanged; three accounts with one created after the cutoff (a new sign-up, no creation time, a late anonymous one turned real) refused; a list holding another account refused; a row count that changes during the run, in public, in a haedo_* table or in auth.users, rolls it back; 3 real accounts beside an anonymous one: all three added, the anonymous one not, an already listed one kept; re-run unchanged; each listed account can claim; counts only in its output');
  } finally { await db.end().catch(() => {}); await rival.end().catch(() => {}); }
}

async function main() {
  if (!pgStub.findPostgres()) {
    const reason = 'no local PostgreSQL server binaries (/usr/lib/postgresql/<n>/bin, HAEDO_PG_BIN or pg_config). Nothing was checked.';
    if (process.env.SQL_REPLAY_REQUIRED === '1') throw Error(reason + ' SQL_REPLAY_REQUIRED=1 forbids skipping.');
    console.log('SKIP news wide SQL: ' + reason); return;
  }
  const pg = await pgStub.startCluster({ label: 'newswide' });
  try {
    const admin = await pg.connect();
    await admin.query('create database news_wide'); await admin.end();
    const db = await pg.connect('news_wide'), rival = await pg.connect('news_wide');
    try {
      // 1. Additive and repeatable.
      // Later migrations (20261112120000 and after) may exist; this one is applied on top of exactly the
      // migrations that sort before it, which are the ones it was written against.
      const all = pgStub.migrationFiles(), at = all.indexOf(FILE);
      assert.ok(at >= 0, 'the migration file is in supabase/migrations');
      const earlier = all.slice(0, at);
      assert.ok(earlier.every(file => path.basename(file) < NAME) && all.slice(at + 1).every(file => path.basename(file) > NAME),
        'it sorts after every earlier migration');
      await pgStub.replayMigrations(db, { files: earlier });
      await db.query(AUTH_SHIM);
      const before = await catalog(db), sql = migration();
      const rows = table => db.query(`select count(*)::int n from ${table}`).then(result => result.rows[0].n);
      await db.query(sql);
      const after = await catalog(db);
      assert.deepEqual(after.filter(line => !OWN.test(line)), before, 'an existing function, table, policy, grant or schema changed');
      const own = after.filter(line => OWN.test(line));
      assert(own.length > 20 && before.every(line => !OWN.test(line)));
      await db.query(sql);
      assert.deepEqual(await catalog(db), after, 'applying it again changes nothing');
      const text = fs.readFileSync(FILE, 'utf8');
      assert.match(text, /^--[^\n]+\n/); assert.equal((text.match(/^begin;$/gm) || []).length, 1); assert.match(text, /\ncommit;\s*$/);
      assert(!/\b(drop|truncate|alter\s+(?!table haedo_news_wide_private\.(feeds|limits|allowed_accounts) enable row level security))\b/i.test(text.replace(/^\s*--.*$/gm, '')), 'no drop, truncate or alter of anything else');
      assert(!/[^\x00-\x7f]/.test(text) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text), 'the migration is plain ASCII: nothing invisible can be lost when it is copied');
      assert(!UUID_TEXT.test(text) && !UUID_TEXT.test(fs.readFileSync(OPS, 'utf8')) && !UUID_TEXT.test(fs.readFileSync(OWNERS, 'utf8')), 'no account ID in the migration or the operations SQL');
      const hashes = (await db.query(HASH_QUERY)).rows.map(row => [row.proname, row.md5]);
      if (printHashes) { console.log(hashes.map(([name, md5]) => '| `' + name + '` | `' + md5 + '` |').join('\n')); return; }
      if (!mutation) assert.deepEqual(hashes, documentedHashes(), 'md5(prosrc) differs from the table in docs/design-review/news-wide-feed.md (node tests/run-news-wide-postgres.cjs --hashes prints the current one)');
      pass(`migration adds ${own.length} catalog entries of its own, leaves the other ${before.length} unchanged, and re-applies to the same catalog`);

      // 2. Closed by default (catalog).
      const privilege = (role, kind, object, right) => db.query(`select has_${kind}_privilege($1, $2, $3) ok`, [role, object, right]).then(result => result.rows[0].ok);
      for (const table of ['haedo_news_wide_private.feeds', 'haedo_news_wide_private.limits', 'haedo_news_wide_private.allowed_accounts']) {
        for (const role of ['anon', 'authenticated', 'service_role'])
          for (const right of ['select', 'insert', 'update', 'delete', 'truncate']) assert.equal(await privilege(role, 'table', table, right), false, `${role} ${right} ${table}`);
        const state = (await db.query(`select relrowsecurity rls, (select count(*)::int from pg_policy where polrelid = c.oid) policies from pg_class c where oid = $1::regclass`, [table])).rows[0];
        assert.deepEqual(state, { rls: true, policies: 0 }, table + ': RLS on, no policy');
      }
      assert.equal(await privilege('anon', 'schema', 'haedo_news_wide_private', 'usage'), false);
      const expected = { 'haedo_news_wide_private.claim(text,jsonb)': ['authenticated'], 'haedo_news_wide_private.clear()': ['authenticated'], 'haedo_news_wide_private.finish(uuid,text,jsonb)': ['service_role'],
        'haedo_news_wide_private.owner()': [], 'haedo_news_wide_private.topic_valid(text)': [], 'haedo_news_wide_private.items_valid(text,jsonb)': [],
        'public.life_news_wide_claim(text,jsonb)': ['authenticated'], 'public.life_news_wide_clear()': ['authenticated'], 'public.life_news_wide_finish(uuid,text,jsonb)': ['service_role'] };
      const functions = (await db.query(`select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' sig, p.oid, p.prosecdef definer, p.proconfig config
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'haedo_news_wide_private' or p.proname like 'life_news_wide_%' order by 1`)).rows;
      assert.deepEqual(functions.map(row => row.sig.replace(/\b(p_\w+) /g, '').replace(/, /g, ',')).sort(), Object.keys(expected).sort());
      for (const row of functions) {
        const signature = row.sig.replace(/\b(p_\w+) /g, '').replace(/, /g, ',');
        const allowed = [];
        for (const role of ['anon', 'authenticated', 'service_role', 'public']) if ((await db.query('select has_function_privilege($1, $2::oid, $3) ok', [role, row.oid, 'execute'])).rows[0].ok) allowed.push(role);
        assert.deepEqual(allowed, expected[signature], signature + ' execute');
        assert.deepEqual(row.config, ['search_path=pg_catalog'], signature + ' search_path');
        assert.equal(row.definer, /private\.(claim|finish|clear|owner)\(/.test(signature), signature + ' definer');
      }
      // The allow list has no writer among the functions: only the operations SQL fills it.
      const writers = (await db.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where (n.nspname = 'haedo_news_wide_private' or p.proname like 'life_news_wide_%') and p.prosrc ~* '(insert[[:space:]]+into|update|delete[[:space:]]+from|truncate)[[:space:]]+(only[[:space:]]+)?haedo_news_wide_private[.]allowed_accounts'`)).rows[0].n;
      assert.equal(writers, 0, 'no function writes allowed_accounts');
      pass('tables: RLS on, no policy, no table right for anon/authenticated/service_role; 9 functions with a fixed search_path and exactly the intended role each; none writes the allow list; md5(prosrc) matches the operations guide');

      // Accounts and sessions (synthetic).
      const A = randomUUID(), B = randomUUID(), C = randomUUID(), ANON = randomUUID(), SA = randomUUID(), SB = randomUUID(), SC = randomUUID(), SANON = randomUUID(), EXPIRED = randomUUID();
      const as = async (client, role, claims, query, values = []) => {
        await client.query('begin');
        try {
          await client.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [JSON.stringify(claims || {}), claims?.sub || '']);
          if (role !== 'postgres') await client.query('set local role ' + role);
          const result = await client.query(query, values); await client.query('commit'); return result.rows[0]?.value;
        } catch (error) { await client.query('rollback'); throw error; }
      };
      const user = (sub, session) => ({ sub, role: 'authenticated', session_id: session });
      // An allowed account gets its entries; anything else comes back whole ({status:'not_allowed'}).
      const claim = (who, session, requests, client = db) => as(client, 'authenticated', user(who, session), 'select public.life_news_wide_claim($1, $2::jsonb) value', [SUPPLIER, JSON.stringify(requests)])
        .then(value => value.status === 'ok' && Object.keys(value).length === 2 ? value.entries : value);
      const finish = (owner, results) => as(db, 'service_role', { role: 'service_role' }, 'select public.life_news_wide_finish($1, $2, $3::jsonb) value', [owner, SUPPLIER, JSON.stringify(results)])
        .then(value => { if (value.status !== 'ok') return value; const { status, ...counts } = value; return counts; });
      const one = (topic, language = 'ko') => [{ topic, language }];
      const refused = (promise, pattern, label) => assert.rejects(promise, error => pattern.test(error.message), label);
      const feed = (owner, topic, language = 'ko') => db.query('select * from haedo_news_wide_private.feeds where owner_id = $1 and topic = $2 and language = $3', [owner, topic, language]).then(result => result.rows[0]);
      const quota = owner => db.query('select hour_count, day_count from haedo_news_wide_private.limits where owner_id = $1', [owner]).then(result => result.rows[0]);

      // 5. The allow list. Nobody is allowed until the operations SQL has run, and that SQL adds
      // an account only when exactly one non-anonymous account exists.
      const said = [];
      db.on('notice', notice => said.push(String(notice.message)));
      const allowList = () => db.query(`select count(*)::int n, coalesce(min(added_at)::text, '') first from haedo_news_wide_private.allowed_accounts`).then(result => result.rows[0]);
      const install = async () => { const results = [].concat(await db.query(operations())); return results.at(-1).rows; };
      const installRefused = async (pattern, label) => {
        const state = await allowList();
        await assert.rejects(install(), error => { said.push(String(error.message)); return pattern.test(error.message); }, label);
        assert.deepEqual(await allowList(), state, label + ': nothing changed');
      };
      {
        const bare = await pg.connect();
        try { await bare.query('create database news_wide_bare'); } finally { await bare.end(); }
        const empty = await pg.connect('news_wide_bare');
        try { await pgStub.replayMigrations(empty, { files: [] }); await assert.rejects(empty.query(fs.readFileSync(OPS, 'utf8')), /apply migration 20261111130000_news_wide_feed\.sql first/); } finally { await empty.end(); }
      }
      await installRefused(/found 0\b/, 'no account at all');
      await db.query('insert into auth.users(id, is_anonymous) values ($1, true)', [ANON]);
      await db.query('insert into auth.sessions(id, user_id) values ($1, $2)', [SANON, ANON]);
      await installRefused(/found 0\b/, 'only an anonymous account');
      await db.query('insert into auth.users(id, is_anonymous) values ($1, false)', [A]);
      await db.query(`insert into auth.sessions(id, user_id, not_after) values ($1, $2, null), ($3, $2, now() - interval '1 minute')`, [SA, A, EXPIRED]);
      // Before the install even the only real account is refused, and nothing is created for it.
      assert.deepEqual(await claim(A, SA, [{ topic: '기후', language: 'ko' }]), { status: 'not_allowed' }, 'an empty allow list allows nobody');
      assert.deepEqual(await claim(A, SA, 'not even valid input'), { status: 'not_allowed' }, 'refused before the input is looked at');
      assert.deepEqual(await finish(A, [{ topic: '기후', language: 'ko', leaseToken: randomUUID(), items: [], error: null }]), { status: 'not_allowed', stored: 0, failed: 0, stale: 0 });
      assert.deepEqual(await as(db, 'authenticated', user(A, SA), 'select public.life_news_wide_clear() value'), { status: 'not_allowed', removed: 0 });
      assert.deepEqual([await rows('haedo_news_wide_private.feeds'), await rows('haedo_news_wide_private.limits'), await rows('haedo_news_wide_private.allowed_accounts')], [0, 0, 0]);
      // A list that already holds some other account is not silently extended.
      await db.query('insert into haedo_news_wide_private.allowed_accounts(owner_id) values ($1)', [ANON]);
      await installRefused(/must hold exactly the one non-anonymous account/, 'the list already holds another account');
      await db.query('delete from haedo_news_wide_private.allowed_accounts');
      // A row count that changes while the operations SQL runs rolls it back, in any other table and
      // in auth.users: another connection holds the allow list until the SQL has counted every table
      // once, then writes and lets it go on.
      const pidOf = async client => (await client.query('select pg_backend_pid() p')).rows[0].p;
      const installPid = await pidOf(db);
      const installRacing = async (change, values, pattern, label) => {
        const state = await allowList();
        await rival.query('begin');
        let outcome;
        try {
          await rival.query('lock table haedo_news_wide_private.allowed_accounts in row exclusive mode');
          outcome = install().then(() => null, error => error);
          let waiting = false;
          for (let attempt = 0; attempt < 500 && !waiting; attempt++) {
            const probe = await pg.connect('news_wide');
            try { waiting = (await probe.query(`select wait_event_type = 'Lock' w from pg_stat_activity where pid = $1`, [installPid])).rows[0]?.w === true; } finally { await probe.end(); }
            if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
          }
          assert(waiting, label + ': the operations SQL waits for the allow list after its first count');
          await rival.query(change, values);
          await rival.query('commit');
        } catch (error) { await rival.query('rollback').catch(() => {}); throw error; }
        const error = await outcome;
        assert(error instanceof Error, label + ': the operations SQL must not succeed');
        said.push(String(error.message));
        assert.match(error.message, pattern, label);
        assert.deepEqual(await allowList(), state, label + ': nothing changed');
      };
      await db.query('create table public.news_wide_probe_rows (n integer)'); // test-only, counted like any other table
      await installRacing('insert into public.news_wide_probe_rows values (1)', [], /Row count changed in public\.news_wide_probe_rows \(before 0, after 1\)\. Rolled back/, 'another table changes meanwhile');
      const LATE = randomUUID();
      await installRacing('insert into auth.users(id, is_anonymous) values ($1, true)', [LATE], /Row count changed in auth\.users \(before 2, after 3\)\. Rolled back/, 'an account appears meanwhile (anonymous, so the account check alone would pass)');
      await db.query('delete from auth.users where id = $1', [LATE]); await db.query('drop table public.news_wide_probe_rows');
      // Exactly one non-anonymous account (an anonymous one beside it does not count): added.
      const counts = { feeds: await rows('haedo_news_wide_private.feeds'), users: await rows('auth.users') };
      let report = await install();
      assert.deepEqual(report.map(row => [row.check_name, row.ok, row.n === null ? null : Number(row.n)]), [['exactly one allowed account', true, 1], ['it is the only non-anonymous account', true, 1],
        ['no API role can read or write the allow list', true, 0], ['row level security is on', true, null]]);
      assert.equal((await db.query('select count(*)::int n from haedo_news_wide_private.allowed_accounts where owner_id = $1', [A])).rows[0].n, 1, 'the one real account, not the anonymous one');
      const installed = await allowList();
      report = await install();
      assert(report.every(row => row.ok === true)); assert.deepEqual(await allowList(), installed, 'running it again changes nothing (same row, same time)');
      assert.deepEqual({ feeds: await rows('haedo_news_wide_private.feeds'), users: await rows('auth.users') }, counts);
      // A second and third real account appear: the install stops and adds nobody.
      await db.query('insert into auth.users(id, is_anonymous) values ($1, null)', [B]); // no flag at all counts as a real account
      await installRefused(/found 2\b.*Ask the owner/, 'two real accounts');
      await db.query('insert into auth.users(id, is_anonymous) values ($1, false)', [C]);
      await db.query(`insert into auth.sessions(id, user_id, not_after) values ($1, $2, now() + interval '1 hour'), ($3, $4, null)`, [SB, B, SC, C]);
      await installRefused(/found 3\b.*Ask the owner/, 'three real accounts');
      // With two real accounts and an empty list the install adds neither.
      await db.query('delete from haedo_news_wide_private.allowed_accounts');
      await installRefused(/found 3\b/, 'an empty list and several accounts');
      assert.equal((await allowList()).n, 0);
      await db.query('insert into haedo_news_wide_private.allowed_accounts(owner_id, added_at) values ($1, $2)', [A, installed.first]); // put the installed row back
      assert.equal((await db.query('select count(*)::int n from haedo_news_wide_private.allowed_accounts where owner_id = any($1)', [[B, C]])).rows[0].n, 0);
      // What the operations SQL says (notices, errors, result rows) holds counts only.
      for (const line of [...said, JSON.stringify(report)]) assert(!UUID_TEXT.test(line) && !line.includes('@'), 'no account ID or e-mail in the output');
      assert(said.length >= 8 && said.some(line => /1 account\(s\) before, 1 after/.test(line)), 'notices were captured');
      // C is a real, signed-in account that is not on the list: refused, and nothing exists for it.
      assert.deepEqual(await claim(C, SC, [{ topic: '기후', language: 'ko' }]), { status: 'not_allowed' });
      assert.deepEqual(await finish(C, [{ topic: '기후', language: 'ko', leaseToken: randomUUID(), items: [], error: null }]), { status: 'not_allowed', stored: 0, failed: 0, stale: 0 });
      assert.deepEqual(await as(db, 'authenticated', user(C, SC), 'select public.life_news_wide_clear() value'), { status: 'not_allowed', removed: 0 });
      assert.deepEqual([await rows('haedo_news_wide_private.feeds'), await rows('haedo_news_wide_private.limits')], [0, 0], 'no row, no counter for an account that is not allowed');
      // No API role can put itself on the list.
      for (const role of ['anon', 'authenticated', 'service_role'])
        for (const statement of [`insert into haedo_news_wide_private.allowed_accounts(owner_id) values ('${C}')`, 'select count(*) value from haedo_news_wide_private.allowed_accounts',
          'delete from haedo_news_wide_private.allowed_accounts', `update haedo_news_wide_private.allowed_accounts set owner_id = '${C}'`, 'truncate haedo_news_wide_private.allowed_accounts'])
          await assert.rejects(as(db, role, role === 'authenticated' ? user(C, SC) : { role }, statement), /permission denied for (table|schema)/, role + ': ' + statement);
      assert.deepEqual((await allowList()).n, 1);
      // Test setup only: the isolation checks below need a second allowed account. In production
      // the operations SQL above is the only way onto the list.
      await db.query('insert into haedo_news_wide_private.allowed_accounts(owner_id) values ($1)', [B]);
      pass('allow list: empty allows nobody; the operations SQL adds the account only when exactly one non-anonymous account exists (0, anonymous-only, 2, 3 and a pre-filled list refused; a row count that changes during the run, in another table or in auth.users, rolls it back; re-run unchanged; counts only in its output); a real account that is not listed gets not_allowed and no row; no API role can write the list');
      await ownerAccounts(pg);

      // 2b. Closed by default (real calls).
      await refused(as(db, 'anon', { role: 'anon' }, 'select public.life_news_wide_claim($1, $2::jsonb) value', [SUPPLIER, JSON.stringify(one('기후'))]), /permission denied for function life_news_wide_claim/, 'anon claim');
      await refused(as(db, 'anon', { role: 'anon' }, 'select public.life_news_wide_clear() value'), /permission denied for function life_news_wide_clear/, 'anon clear');
      await refused(as(db, 'anon', { role: 'anon' }, 'select public.life_news_wide_finish($1, $2, $3::jsonb) value', [A, SUPPLIER, '[]']), /permission denied for function life_news_wide_finish/, 'anon finish');
      await refused(as(db, 'anon', { role: 'anon' }, 'select haedo_news_wide_private.claim($1, $2::jsonb) value', [SUPPLIER, JSON.stringify(one('기후'))]), /permission denied for schema haedo_news_wide_private/, 'anon private claim');
      for (const role of ['anon', 'authenticated', 'service_role']) {
        for (const statement of ['select count(*) value from haedo_news_wide_private.feeds', 'select count(*) value from haedo_news_wide_private.limits',
          "insert into haedo_news_wide_private.limits values (gen_random_uuid(), now(), 0, now(), 0)", 'delete from haedo_news_wide_private.feeds', 'update haedo_news_wide_private.limits set hour_count = 0'])
          await refused(as(db, role, role === 'authenticated' ? user(A, SA) : { role }, statement), /permission denied for (table|schema)/, role + ': ' + statement);
      }
      await refused(as(db, 'authenticated', user(A, SA), 'select public.life_news_wide_finish($1, $2, $3::jsonb) value', [A, SUPPLIER, '[]']), /permission denied for function life_news_wide_finish/, 'a user cannot write the cache');
      await refused(as(db, 'authenticated', user(A, SA), 'select haedo_news_wide_private.finish($1, $2, $3::jsonb) value', [A, SUPPLIER, '[]']), /permission denied for function finish/, 'a user cannot write the cache (private)');
      await refused(as(db, 'service_role', { role: 'service_role' }, 'select public.life_news_wide_claim($1, $2::jsonb) value', [SUPPLIER, JSON.stringify(one('기후'))]), /permission denied for function life_news_wide_claim/, 'the server key cannot claim for nobody');
      for (const role of ['authenticated', 'service_role'])
        for (const helper of ['owner()', "topic_valid('기후')", "items_valid('google-news-rss', '[]')"])
          await refused(as(db, role, role === 'authenticated' ? user(A, SA) : { role }, `select haedo_news_wide_private.${helper} value`), /permission denied for function/, role + ' ' + helper);
      // A session is required: missing, malformed, expired, someone else's, unknown user, anonymous sign-in.
      const sessions = { 'no session claim': { sub: A, role: 'authenticated' }, 'malformed session': user(A, 'x'), 'expired session': user(A, EXPIRED), "another account's session": user(A, SB),
        'unknown session': user(A, randomUUID()), 'unknown user': user(randomUUID(), SA), 'anonymous sign-in': user(ANON, SANON), 'no subject': { role: 'authenticated', session_id: SA } };
      for (const [name, claims] of Object.entries(sessions)) {
        await refused(as(db, 'authenticated', claims, 'select public.life_news_wide_claim($1, $2::jsonb) value', [SUPPLIER, JSON.stringify(one('기후'))]), /life_news_wide_auth_required/, name);
        await refused(as(db, 'authenticated', claims, 'select public.life_news_wide_clear() value'), /life_news_wide_auth_required/, name + ' (clear)');
      }
      assert.equal(await rows('haedo_news_wide_private.feeds'), 0); assert.equal(await rows('haedo_news_wide_private.limits'), 0);
      pass('anon, the wrong role, direct table access and 8 kinds of missing or foreign session are refused; nothing was written');

      // 3a. Input validation (claim).
      const badRequests = { 'not a list': { topic: '기후', language: 'ko' }, 'empty': [], '17 pairs': Array.from({ length: 17 }, (_, n) => ({ topic: 't' + n, language: 'ko' })), 'not an object': ['기후'],
        'extra key': [{ topic: '기후', language: 'ko', owner: B }], 'missing language': [{ topic: '기후' }], 'language': one('기후', 'ja'), 'number topic': [{ topic: 1, language: 'ko' }],
        'duplicate': [...one('기후'), ...one('기후')], 'empty topic': one(''), '41 characters': one('가'.repeat(41)), 'untrimmed': one(' 기후'), 'double space': one('기후  변화'),
        'NFD': one('기후'.normalize('NFD')), 'quote': one('"기후"'), 'curly quote': one('“기후”'), 'colon': one('site:example.com'), 'when': one('when:1d'), 'star': one('기후*'), 'paren': one('(기후)'),
        'pipe': one('a|b'), 'angle': one('a<b'), 'backslash': one('a\\b'), 'newline': one('기후\n변화'), 'tab': one('기후\t변화'), 'escape': one('기후\u001b'), 'zero width': one('기\u200b후'),
        'bidi override': one('\u202e기후'), 'line separator': one('기후\u2028'), 'null item': [null] };
      for (const [name, requests] of Object.entries(badRequests)) await refused(claim(A, SA, requests), /life_news_wide_invalid_request/, name);
      await refused(as(db, 'authenticated', user(A, SA), 'select public.life_news_wide_claim($1, $2::jsonb) value', ['other-supplier', JSON.stringify(one('기후'))]), /life_news_wide_invalid_request/, 'unknown supplier');
      await refused(as(db, 'authenticated', user(A, SA), 'select public.life_news_wide_claim($1, null) value', [SUPPLIER]), /life_news_wide_invalid_request/, 'null requests');
      assert.equal(await rows('haedo_news_wide_private.feeds'), 0); assert.equal(await rows('haedo_news_wide_private.limits'), 0);
      // The same rule on both sides. Listed cases first, then 20,000 random topics that the Edge
      // rule accepts: every one must pass here too (otherwise that topic would always answer 500).
      const { normalizeTopic } = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/haedo-news-wide/topics.mjs')).href);
      const edgeAccepts = topic => { try { return normalizeTopic(topic) === topic; } catch (_) { return false; } };
      const sqlAccepts = list => db.query('select t, haedo_news_wide_private.topic_valid(t) ok from unnest($1::text[]) t', [list]).then(result => new Map(result.rows.map(row => [row.t, row.ok])));
      const acceptedTopics = ['기후', 'climate change', 'K-pop', 'C++', 'C#', '.NET', 'R&D', 'AI/ML', "O'Reilly", 'O’Reilly', '3·1 운동', '𠀀'.repeat(40), '10%', '10,000', '1,000원', 'Yahoo!', '왜?',
        'Oregon OR', 'Portland OR', 'OR 연산', 'OR', 'NOT 기후', 'AND', 'Rock AND', 'São Paulo', '日本 経済', 'Node.js 22', '3-1', 'COVID-19', '서울-부산', '3.5', 'v1.2.3', 'a%26b'];
      const cp = (...points) => String.fromCodePoint(...points);
      const refusedTopics = ['"기후"', cp(0x201c) + '기후' + cp(0x201d), cp(0x2018) + '기후' + cp(0x2019), cp(0xab) + '기후' + cp(0xbb), cp(0xff02) + '기후', "'기후'", "기후'", "rock 'n' roll", '`기후`',
        'site:example.com', 'when:1d', '50:50', '기후' + cp(0xff1a) + '변화', '-기후', '기후 -날씨', '+기후', '기후 +날씨', '기후 OR 날씨', '기후 AND 날씨', 'a NOT b', 'x OR OR y', 'a|b', '기후*', '(기후)',
        '기후~', 'a<b', 'a=b', '[기후]', '{기후}', 'a;b', '@handle', '$100', 'a\\b', 'a_b', 'a^b', '...', '& &', '#', '?!', cp(0x1f33f), '기후 ' + cp(0x1f33f), cp(0x2764), cp(0x2192),
        cp(0x115f), '기' + cp(0x3164) + '후', cp(0xffa0) + 'a', 'a' + cp(0x034f), 'a' + cp(0xfe0f), 'a' + cp(0x200d) + 'b', 'a' + cp(0xad) + 'b', 'a' + cp(0x61c), 'a' + cp(0xe0001), cp(0x3000) + 'a',
        'a' + cp(0xa0) + 'b', cp(0x300c) + '기후' + cp(0x300d), '기후' + cp(0x3002),
        // The right single quote is an apostrophe only inside a word; a hyphen only between two letters or digits.
        cp(0x2019) + '기후' + cp(0x2019), '기후' + cp(0x2019), cp(0x2019) + 'a', 'a' + cp(0x2019) + ' b', 'a ' + cp(0x2019) + 'b',
        'a,-b', 'a/-b', 'a.-b', 'a&-b', 'a!-b', 'a?-b', 'a%-b', 'a#-b', 'a+-b', 'a' + cp(0xb7) + '-b', "a'-b", 'a-' + cp(0x2019) + 'b', 'a-', '기후-', 'a- b', 'a--b',
        '1..10', 'a..b', '..NET', 'a"b', 'a[b', 'a]b', 'a$b', 'a:b'];
      const listed = await sqlAccepts([...acceptedTopics, ...refusedTopics]);
      for (const topic of acceptedTopics) assert.deepEqual([edgeAccepts(topic), listed.get(topic)], [true, true], 'accepted by both: ' + JSON.stringify(topic));
      for (const topic of refusedTopics) assert.deepEqual([edgeAccepts(topic), listed.get(topic)], [false, false], 'refused by both: ' + JSON.stringify(topic));
      // Characters the Edge rule can accept (letters, digits and marks of many kinds, spaces that
      // normalize, the allowed punctuation). The always-refused ones are in refusedTopics above.
      const pool = [...'abzAZ09 .&+#\'/-,%!?', ' ', ' ', 'OR', 'AND', 'NOT', ...[0x2019, 0xb7, 0xac00, 0xd7a3, 0x3131, 0x65e5, 0xe9, 0x65, 0x301, 0x300, 0x3099, 0xfb01, 0xff21, 0xff11, 0xb2, 0xbd, 0x2163, 0x663, 0x1d49c, 0x1d7d8,
        0xaa, 0x1c5, 0x2b0, 0xa0, 0x3000, 0x2002, 0x2009, 0x202f, 0xe33, 0xf73, 0x1100, 0x1161, 0x20dd, 0x488, 0x130, 0xdf, 0x17f, 0x212a, 0x212b,
        0x958, 0xfb1d, 0x2126, 0xf900, 0x2f800, 0x344, 0x1e9b, 0x323, 0xa9c0, 0xff2f, 0xff32, 0x3005, 0x3007, 0x2460, 0x2776, 0x1f101].map(point => cp(point))];
      // Fixed-seed generator (mulberry32): the same 20,000 topics on every run.
      let seed = 20261111;
      const random = n => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) % n; };
      const accepted = new Set();
      for (let tries = 0; tries < 400000 && accepted.size < 20000; tries++) {
        let text = ''; for (let n = 1 + random(12); n > 0; n--) text += pool[random(pool.length)];
        try { accepted.add(normalizeTopic(text)); } catch (_) { /* refused by the Edge rule */ }
      }
      assert(accepted.size >= 20000, 'enough random topics: ' + accepted.size);
      const disagreed = [];
      for (let at = 0, all = [...accepted]; at < all.length; at += 2000) for (const [topic, ok] of await sqlAccepts(all.slice(at, at + 2000))) if (!ok) disagreed.push(topic);
      assert.deepEqual(disagreed.slice(0, 5).map(topic => [...topic].map(char => 'U+' + char.codePointAt(0).toString(16)).join(' ')), [], 'accepted by the Edge rule but refused by SQL');
      // The caller's standard_conforming_strings does not change the rule (it used to: with it off,
      // a:b, a"b, a[b, a]b, a\b and a$b passed). Values travel as parameters, so only the function
      // body is read under the setting.
      const settingCases = ['test', 'a:b', 'a"b', 'a[b', 'a]b', 'a\\b', 'a' + cp(0x200b) + 'b', 'O' + cp(0x2019) + 'Reilly', cp(0x2019) + 'a', "O'Reilly", "'a",
        'a' + cp(0x1f33f) + 'b', 'a' + cp(0xe0001) + 'b', 'a' + cp(0xfe0f) + 'b', 'a' + cp(0xa0) + 'b', 'a' + cp(0x3164) + 'b', '3' + cp(0xb7) + '1', 'a OR b', 'Portland OR', '-a',
        'a' + cp(0x201c) + 'b', 'a' + cp(0xff1a) + 'b', 'a' + cp(0x2192) + 'b', '기후', 'a$b', 'R&D', '10%', 'a' + cp(1) + 'b', 'a' + cp(0x7f) + 'b',
        'site:example.com', 'a{b', 'a}b', 'a^b', 'a_b', 'a`b', 'a|b', 'a~b', 'a*b', 'a,-b', '1..10', 'K-pop'];
      const under = async setting => {
        await db.query(`set standard_conforming_strings = ${setting}`);
        try {
          assert.equal((await db.query('show standard_conforming_strings')).rows[0].standard_conforming_strings, setting);
          const itemChecks = (await db.query("select haedo_news_wide_private.items_valid('google-news-rss', $1::jsonb) a, haedo_news_wide_private.items_valid('google-news-rss', $2::jsonb) b, haedo_news_wide_private.items_valid('google-news-rss', $3::jsonb) c",
            [JSON.stringify([item(1)]), JSON.stringify([item(1, { title: '줄' + cp(1) + '바꿈' })]), JSON.stringify([item(1, { link: 'https://news.google.com/a\\b' })])])).rows[0];
          assert.deepEqual(itemChecks, { a: true, b: false, c: false }, 'items_valid with standard_conforming_strings ' + setting);
          return await sqlAccepts(settingCases);
        } finally { await db.query('reset standard_conforming_strings'); }
      };
      const settingOn = await under('on'), settingOff = await under('off');
      for (const topic of settingCases) assert.deepEqual([settingOn.get(topic), settingOff.get(topic)], [edgeAccepts(topic), edgeAccepts(topic)], 'the same answer with standard_conforming_strings on and off: ' + JSON.stringify(topic));
      assert(settingCases.filter(edgeAccepts).length >= 8 && settingCases.filter(topic => !edgeAccepts(topic)).length >= 25);
      // The same through claim and the table check, with the setting off in the caller's transaction.
      await db.query('begin');
      try {
        await db.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('standard_conforming_strings', 'off', true)", [JSON.stringify(user(A, SA)), A]);
        await db.query('set local role authenticated');
        await refused(db.query('select public.life_news_wide_claim($1, $2::jsonb) value', [SUPPLIER, JSON.stringify(one('site:example.com'))]), /life_news_wide_invalid_request/, 'site: with standard_conforming_strings off');
      } finally { await db.query('rollback'); }
      await db.query('begin');
      try {
        await db.query("set local standard_conforming_strings = off");
        await refused(db.query(`insert into haedo_news_wide_private.feeds(owner_id, supplier, language, topic) values ($1, $2, 'ko', 'a:b')`, [A, SUPPLIER]), /violates check constraint/, 'table check with standard_conforming_strings off');
      } finally { await db.query('rollback'); }
      assert.equal(await rows('haedo_news_wide_private.feeds'), 0); assert.equal(await rows('haedo_news_wide_private.limits'), 0);
      pass(`claim refuses ${Object.keys(badRequests).length + 2} malformed inputs with life_news_wide_invalid_request and stores nothing; ${acceptedTopics.length} topics accepted and ${refusedTopics.length} refused by both rules; ${settingCases.length} topics get the same answer with standard_conforming_strings on and off; ${accepted.size} random Edge-accepted topics all pass SQL`);

      // 3b. Lease, storing, owner isolation.
      let [entry] = await claim(A, SA, one('기후'));
      assert.deepEqual({ ...entry, leaseToken: null }, { topic: '기후', language: 'ko', status: 'claimed', items: null, fetchedAt: null, expired: false, leaseToken: null, limit: null });
      assert.match(entry.leaseToken, /^[a-f0-9-]{36}$/);
      const lease = entry.leaseToken;
      assert.deepEqual(await quota(A), { hour_count: 1, day_count: 1 });
      [entry] = await claim(A, SA, one('기후'));
      assert.deepEqual([entry.status, entry.leaseToken, entry.items], ['busy', null, null], 'a second request while the first is fetching');
      assert.deepEqual(await quota(A), { hour_count: 1, day_count: 1 }, 'busy costs nothing');
      // Account B asks for the same topic: its own row, never A's.
      const [other] = await claim(B, SB, one('기후'));
      assert.equal(other.status, 'claimed'); assert.notEqual(other.leaseToken, lease);
      const result = (topic, leaseToken, extra, language = 'ko') => ({ topic, language, leaseToken, ...extra });
      assert.deepEqual(await finish(B, [result('기후', lease, { items: [item(1)], error: null })]), { stored: 0, failed: 0, stale: 1 }, "A's lease does nothing under B's account");
      assert.deepEqual(await finish(A, [result('기후', other.leaseToken, { items: [item(1)], error: null })]), { stored: 0, failed: 0, stale: 1 }, "B's lease does nothing under A's account");
      assert.deepEqual(await finish(A, [result('기후', randomUUID(), { items: [item(1)], error: null })]), { stored: 0, failed: 0, stale: 1 }, 'an unknown lease');
      assert.deepEqual(await finish(A, [result('없는주제', lease, { items: [item(1)], error: null })]), { stored: 0, failed: 0, stale: 1 }, 'a topic that was never claimed');
      assert.equal((await feed(A, '기후')).items, null);
      assert.deepEqual(await finish(A, [result('기후', lease, { items: [item(1), item(2)], error: null })]), { stored: 1, failed: 0, stale: 0 });
      assert.deepEqual(await finish(A, [result('기후', lease, { items: [item(3)], error: null })]), { stored: 0, failed: 0, stale: 1 }, 'a lease is used once');
      [entry] = await claim(A, SA, one('기후'));
      assert.deepEqual([entry.status, entry.items, entry.expired, entry.leaseToken], ['fresh', [item(1), item(2)], false, null]);
      assert(Math.abs(Date.parse(entry.fetchedAt) - Date.now()) < 60000);
      assert.deepEqual(await quota(A), { hour_count: 1, day_count: 1 }, 'fresh cache costs nothing');
      assert.deepEqual(await finish(B, [result('기후', other.leaseToken, { items: [item(9, { title: 'B만 보는 글' })], error: null })]), { stored: 1, failed: 0, stale: 0 });
      assert.deepEqual((await claim(A, SA, one('기후')))[0].items.map(row => row.title), ['가상 제목 1', '가상 제목 2'], "A never receives B's items");
      assert.deepEqual((await claim(B, SB, one('기후')))[0].items.map(row => row.title), ['B만 보는 글'], "B never receives A's items");
      pass('lease: one fetch at a time, used once, bound to its account and topic; each account reads only its own cache');

      // 3c. Input validation (finish). A refused report rolls back and leaves the lease usable.
      const [second] = await claim(A, SA, one('날씨'));
      const good = { items: [item(1)], error: null };
      const badResults = { 'not a list': result('날씨', second.leaseToken, good), 'empty': [], '17 results': Array.from({ length: 17 }, () => result('날씨', second.leaseToken, good)),
        'extra key': [result('날씨', second.leaseToken, { ...good, owner: B })], 'both items and error': [result('날씨', second.leaseToken, { items: [], error: 'network_error' })],
        'neither': [result('날씨', second.leaseToken, { items: null, error: null })], 'unknown error': [result('날씨', second.leaseToken, { items: null, error: 'upstream said: 비밀' })],
        'error is not text': [result('날씨', second.leaseToken, { items: null, error: 5 })], 'bad lease': [result('날씨', 'lease', good)], 'bad topic': [result('"날씨"', second.leaseToken, good)],
        'bad language': [result('날씨', second.leaseToken, good, 'ja')], 'items not a list': [result('날씨', second.leaseToken, { items: { 0: item(1) }, error: null })] };
      for (const [name, results] of Object.entries(badResults)) await refused(finish(A, results), /life_news_wide_invalid_(finish|items)/, name);
      const badItems = { 'another host': item(1, { link: 'https://evil.example/a' }), 'look-alike host': item(1, { link: 'https://news.google.com.evil.example/a' }), 'userinfo': item(1, { link: 'https://news.google.com@evil.example/a' }),
        'http': item(1, { link: 'http://news.google.com/a' }), 'javascript': item(1, { link: 'javascript:alert(1)' }), 'space in link': item(1, { link: 'https://news.google.com/a b' }),
        'backslash in link': item(1, { link: 'https://news.google.com/a\\b' }), 'long link': item(1, { link: 'https://news.google.com/' + 'a'.repeat(2048) }), 'body': { ...item(1), body: '<p>본문</p>' },
        'description': { ...item(1), description: '요약' }, 'image': { ...item(1), image: 'https://img.example/a.png' }, 'missing key': (({ sourceUrl, ...rest }) => rest)(item(1)), 'bad id': item(1, { id: 'x' }),
        'empty title': item(1, { title: '' }), 'long title': item(1, { title: '가'.repeat(301) }), 'control in title': item(1, { title: '줄\n바꿈' }), 'title not text': item(1, { title: 5 }),
        'date not ISO': item(1, { publishedAt: 'Wed, 11 Nov 2026 09:35:00 GMT' }), 'http outlet': item(1, { sourceUrl: 'http://outlet.example/' }), 'empty outlet name': item(1, { sourceName: '' }),
        'long outlet name': item(1, { sourceName: '가'.repeat(101) }), 'not an object': 'text' };
      for (const [name, bad] of Object.entries(badItems)) await refused(finish(A, [result('날씨', second.leaseToken, { items: [item(2), bad], error: null })]), /life_news_wide_invalid_items/, name);
      await refused(finish(A, [result('날씨', second.leaseToken, { items: Array.from({ length: 31 }, (_, n) => item(n)), error: null })]), /life_news_wide_invalid_items/, '31 items');
      await refused(as(db, 'service_role', { role: 'service_role' }, 'select public.life_news_wide_finish(null, $1, $2::jsonb) value', [SUPPLIER, JSON.stringify([result('날씨', second.leaseToken, good)])]), /life_news_wide_invalid_finish/, 'no owner');
      await refused(as(db, 'service_role', { role: 'service_role' }, 'select public.life_news_wide_finish($1, $2, $3::jsonb) value', [A, 'other-supplier', JSON.stringify([result('날씨', second.leaseToken, good)])]), /life_news_wide_invalid_finish/, 'unknown supplier');
      assert.equal((await feed(A, '날씨')).items, null);
      const full = Array.from({ length: 30 }, (_, n) => item(n, { title: '가'.repeat(300), sourceName: null, sourceUrl: null, publishedAt: null }));
      assert.deepEqual(await finish(A, [result('날씨', second.leaseToken, { items: full, error: null })]), { stored: 1, failed: 0, stale: 0 }, 'the lease survived every refused report; 30 full-length items fit');
      const stored = await feed(A, '날씨');
      assert.deepEqual([stored.item_count, stored.items_bytes, stored.lease_token, stored.lease_until], [30, Buffer.byteLength((await db.query('select items::text t from haedo_news_wide_private.feeds where owner_id=$1 and topic=$2', [A, '날씨'])).rows[0].t), null, null]);
      // The table itself refuses what the functions refuse.
      for (const [name, statement] of Object.entries({
        'topic check': `insert into haedo_news_wide_private.feeds(owner_id, supplier, language, topic) values ('${A}', '${SUPPLIER}', 'ko', 'site:example.com')`,
        'supplier check': `insert into haedo_news_wide_private.feeds(owner_id, supplier, language, topic) values ('${A}', 'other', 'ko', '기후x')`,
        'language check': `insert into haedo_news_wide_private.feeds(owner_id, supplier, language, topic) values ('${A}', '${SUPPLIER}', 'ja', '기후x')`,
        'items check': `update haedo_news_wide_private.feeds set items = '[{"link":"https://evil.example/"}]'::jsonb where owner_id = '${A}' and topic = '날씨'`,
        'count check': `update haedo_news_wide_private.feeds set item_count = 3 where owner_id = '${A}' and topic = '날씨'`,
        'lease pair check': `update haedo_news_wide_private.feeds set lease_token = gen_random_uuid() where owner_id = '${A}' and topic = '날씨'`,
        'hour bound': `update haedo_news_wide_private.limits set hour_count = 61 where owner_id = '${A}'`, 'day bound': `update haedo_news_wide_private.limits set day_count = 601 where owner_id = '${A}'`,
        'unknown owner': `insert into haedo_news_wide_private.feeds(owner_id, supplier, language, topic) values (gen_random_uuid(), '${SUPPLIER}', 'ko', '기후x')` })) await refused(db.query(statement), /violates (check|foreign key) constraint/, name);
      pass(`finish refuses ${Object.keys(badResults).length + Object.keys(badItems).length + 3} malformed reports (other hosts, bodies, images, extra keys) and rolls back; the table constraints refuse the same directly`);

      // 3d. TTL, retry delay, lease expiry.
      const age = (owner, topic, column, interval) => db.query(`update haedo_news_wide_private.feeds set ${column} = clock_timestamp() - $3::interval where owner_id = $1 and topic = $2`, [owner, topic, interval]);
      await age(A, '기후', 'fetched_at', '29 minutes');
      assert.equal((await claim(A, SA, one('기후')))[0].status, 'fresh', '29 minutes old');
      await age(A, '기후', 'fetched_at', '31 minutes');
      [entry] = await claim(A, SA, one('기후'));
      assert.deepEqual([entry.status, entry.expired, entry.items.length, typeof entry.leaseToken], ['claimed', true, 2, 'string'], '31 minutes old: fetch again, old items offered as fallback');
      assert.deepEqual(await quota(A), { hour_count: 3, day_count: 3 });
      assert.deepEqual(await finish(A, [result('기후', entry.leaseToken, { items: null, error: 'network_error' })]), { stored: 0, failed: 1, stale: 0 });
      [entry] = await claim(A, SA, one('기후'));
      assert.deepEqual([entry.status, entry.expired, entry.items.length, entry.leaseToken], ['backoff', true, 2, null], 'after a failure: wait, with the old items');
      assert.deepEqual(await quota(A), { hour_count: 3, day_count: 3 }, 'waiting costs nothing');
      const wait = async error => {
        await age(A, '기후', 'next_attempt_at', '1 second');
        const [again] = await claim(A, SA, one('기후')); assert.equal(again.status, 'claimed');
        await finish(A, [result('기후', again.leaseToken, { items: null, error })]);
        const row = await feed(A, '기후'); return Math.round((row.next_attempt_at - row.touched_at) / 60000);
      };
      assert.deepEqual([await wait('network_error'), await wait('invalid_response'), await wait('rate_limited'), await wait('blocked'), await wait('not_attempted')], [5, 5, 30, 30, 0]);
      [entry] = await claim(A, SA, one('기후'));
      assert.equal(entry.status, 'claimed', 'a call that was never attempted may be tried again at once');
      await db.query(`update haedo_news_wide_private.feeds set lease_until = clock_timestamp() - interval '1 second' where owner_id = $1 and topic = $2`, [A, '기후']);
      assert.deepEqual(await finish(A, [result('기후', entry.leaseToken, { items: [item(5)], error: null })]), { stored: 0, failed: 0, stale: 1 }, 'a report after the 60 s lease is discarded');
      assert.deepEqual((await feed(A, '기후')).items.map(row => row.title), ['가상 제목 1', '가상 제목 2']);
      [entry] = await claim(A, SA, one('기후'));
      assert.equal(entry.status, 'claimed', 'an expired lease no longer blocks');
      const leaseSeconds = Math.round(((await feed(A, '기후')).lease_until - (await feed(A, '기후')).touched_at) / 1000);
      assert.equal(leaseSeconds, 60);
      assert.deepEqual(await finish(A, [result('기후', entry.leaseToken, { items: [item(6)], error: null })]), { stored: 1, failed: 0, stale: 0 });
      pass('TTL 30 min (29 fresh, 31 refetch with fallback), retry delay 5/5/30/30/0 min by failure kind, 60 s lease, late reports discarded');

      // 3e. Allowance: 60 per hour, 600 per day, per account.
      const setQuota = (owner, hour, day, hourAge = '1 minute', dayAge = '1 minute') => db.query(`update haedo_news_wide_private.limits set hour_count = $2, day_count = $3,
        hour_started_at = clock_timestamp() - $4::interval, day_started_at = clock_timestamp() - $5::interval where owner_id = $1`, [owner, hour, day, hourAge, dayAge]);
      await setQuota(A, 59, 100);
      await age(A, '날씨', 'fetched_at', '2 hours');
      let entries = await claim(A, SA, [...one('새주제1'), ...one('날씨'), ...one('새주제2'), ...one('기후')]);
      assert.deepEqual(entries.map(row => [row.topic, row.status, row.limit, row.items?.length ?? null, row.leaseToken === null]),
        [['새주제1', 'claimed', null, null, false], ['날씨', 'limited', 'hour', 30, true], ['새주제2', 'limited', 'hour', null, true], ['기후', 'fresh', null, 1, true]],
        'the 60th call is allowed, the rest get cache only and a reason; fresh cache is still served');
      assert.deepEqual(await quota(A), { hour_count: 60, day_count: 101 });
      assert.equal(await feed(A, '새주제2'), undefined, 'a limited topic leaves no row');
      assert.equal((await claim(B, SB, one('새주제1')))[0].status, 'claimed', "A's allowance is not B's");
      await setQuota(A, 60, 101, '61 minutes');
      entries = await claim(A, SA, one('새주제2'));
      assert.equal(entries[0].status, 'claimed', 'a new hour'); assert.deepEqual(await quota(A), { hour_count: 1, day_count: 102 });
      await setQuota(A, 5, 600);
      entries = await claim(A, SA, [...one('새주제3'), ...one('날씨')]);
      assert.deepEqual(entries.map(row => [row.status, row.limit, row.items?.length ?? null]), [['limited', 'day', null], ['limited', 'day', 30]]);
      assert.deepEqual(await quota(A), { hour_count: 5, day_count: 600 });
      await setQuota(A, 5, 600, '1 minute', '25 hours');
      assert.equal((await claim(A, SA, one('새주제3')))[0].status, 'claimed', 'a new day'); assert.deepEqual(await quota(A), { hour_count: 6, day_count: 1 });
      // 16 pairs in one request with 10 calls left: exactly 10 are claimed.
      await setQuota(A, 50, 100);
      entries = await claim(A, SA, Array.from({ length: 16 }, (_, n) => ({ topic: '묶음' + n, language: n % 2 ? 'en' : 'ko' })));
      assert.deepEqual(entries.map(row => row.status), [...Array(10).fill('claimed'), ...Array(6).fill('limited')]);
      assert.equal(new Set(entries.slice(0, 10).map(row => row.leaseToken)).size, 10);
      pass('allowance: the 60th call of the hour and the 600th of the day pass, the next are limited with cache only; windows reset; one account does not spend another\'s');

      // 3f. Retention, row cap, clear, account deletion.
      await db.query(`update haedo_news_wide_private.feeds set touched_at = clock_timestamp() - interval '8 days', lease_token = null, lease_until = null where topic in ('새주제1', '묶음0')`);
      await db.query(`update haedo_news_wide_private.feeds set touched_at = clock_timestamp() - interval '6 days' where owner_id = $1 and topic = '묶음2'`, [A]);
      await setQuota(A, 0, 0);
      await claim(A, SA, one('기후'));
      assert.equal(await feed(A, '새주제1'), undefined, "A's row untouched for 8 days is removed on A's next claim");
      assert.equal(await feed(A, '묶음0'), undefined); assert(await feed(A, '묶음2'), '6 days is kept');
      assert(await feed(B, '새주제1'), "B's old row is not A's to remove");
      await db.query('delete from haedo_news_wide_private.feeds where owner_id = $1', [A]);
      await db.query(`insert into haedo_news_wide_private.feeds(owner_id, supplier, language, topic, touched_at) select $1, $2, 'ko', '채움' || n, clock_timestamp() - make_interval(mins => 100 - n) from generate_series(1, 64) n`, [A, SUPPLIER]);
      await setQuota(A, 0, 0);
      assert.equal((await claim(A, SA, one('예순다섯째')))[0].status, 'claimed');
      assert.equal((await db.query('select count(*)::int n from haedo_news_wide_private.feeds where owner_id = $1', [A])).rows[0].n, 64, 'at most 64 topics per account');
      assert.equal(await feed(A, '채움1'), undefined, 'the least recently used row made room'); assert(await feed(A, '채움2'));
      // Rows that were being fetched can push the count past 64; the next new topic brings it back.
      await db.query(`insert into haedo_news_wide_private.feeds(owner_id, supplier, language, topic, touched_at) select $1, $2, 'en', 'overflow' || n, clock_timestamp() - make_interval(mins => 200 - n) from generate_series(1, 30) n`, [A, SUPPLIER]);
      assert.equal((await db.query('select count(*)::int n from haedo_news_wide_private.feeds where owner_id = $1', [A])).rows[0].n, 94);
      assert.equal((await claim(A, SA, one('다시예순넷')))[0].status, 'claimed');
      assert.equal((await db.query('select count(*)::int n from haedo_news_wide_private.feeds where owner_id = $1', [A])).rows[0].n, 64, 'an overflow is trimmed back to 64 at once, oldest first');
      assert.equal((await db.query(`select count(*)::int n from haedo_news_wide_private.feeds where owner_id = $1 and topic like 'overflow%'`, [A])).rows[0].n, 0);
      assert(await feed(A, '예순다섯째') && await feed(A, '다시예순넷'));
      const before2 = { b: (await db.query('select count(*)::int n from haedo_news_wide_private.feeds where owner_id = $1', [B])).rows[0].n, quota: await quota(A) };
      assert(before2.b >= 2);
      assert.deepEqual(await as(db, 'authenticated', user(A, SA), 'select public.life_news_wide_clear() value'), { status: 'cleared', removed: 64 });
      assert.equal((await db.query('select count(*)::int n from haedo_news_wide_private.feeds where owner_id = $1', [A])).rows[0].n, 0);
      assert.equal((await db.query('select count(*)::int n from haedo_news_wide_private.feeds where owner_id = $1', [B])).rows[0].n, before2.b, "clearing removes only the caller's rows");
      assert.deepEqual(await quota(A), before2.quota, 'clearing does not return the allowance');
      assert.deepEqual(await as(db, 'authenticated', user(A, SA), 'select public.life_news_wide_clear() value'), { status: 'cleared', removed: 0 });
      // Taken off the list while a fetch is running: the result is not stored and nothing new starts.
      await setQuota(A, 0, 0);
      const [running] = await claim(A, SA, one('도중제거'));
      await db.query('delete from haedo_news_wide_private.allowed_accounts where owner_id = $1', [A]);
      assert.deepEqual(await finish(A, [result('도중제거', running.leaseToken, { items: [item(7)], error: null })]), { status: 'not_allowed', stored: 0, failed: 0, stale: 0 });
      assert.equal((await feed(A, '도중제거')).items, null);
      assert.deepEqual(await claim(A, SA, one('기후')), { status: 'not_allowed' });
      assert.deepEqual(await quota(A), { hour_count: 1, day_count: 1 }, 'a refused claim counts nothing');
      assert.deepEqual(await as(db, 'authenticated', user(A, SA), 'select public.life_news_wide_clear() value'), { status: 'not_allowed', removed: 1 }, 'its old rows can still be removed');
      assert.equal((await db.query('select count(*)::int n from haedo_news_wide_private.feeds where owner_id = $1', [B])).rows[0].n, before2.b, "another account's rows are not touched");
      await db.query('insert into haedo_news_wide_private.allowed_accounts(owner_id) values ($1)', [A]);
      assert.equal((await claim(A, SA, one('기후')))[0].status, 'claimed', 'back on the list: starts from an empty cache');
      await db.query('delete from auth.users where id = $1', [B]);
      assert.equal((await db.query('select (select count(*) from haedo_news_wide_private.feeds where owner_id = $1)::int + (select count(*) from haedo_news_wide_private.limits where owner_id = $1)::int n', [B])).rows[0].n, 0, 'deleting the account removes its cache and counters');
      pass('retention 7 days on the same account only, 64 topics per account (an overflow is trimmed at once), clear removes only the caller\'s rows and keeps the counters, an account taken off the list mid-fetch stores nothing, account deletion cascades');

      // 3g. Two requests of one account at the same moment: one fetches, the other waits and sees busy.
      await setQuota(A, 0, 0);
      const claimSQL = ['select public.life_news_wide_claim($1, $2::jsonb) value', [SUPPLIER, JSON.stringify(one('동시'))]];
      const open = async client => { await client.query('begin'); await client.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [JSON.stringify(user(A, SA)), A]); await client.query('set local role authenticated'); };
      await open(db); await open(rival);
      const first = (await db.query(...claimSQL)).rows[0].value.entries[0];
      const pid = (await rival.query('select pg_backend_pid() p')).rows[0].p, waiting = rival.query(...claimSQL);
      let blocked = false;
      for (let attempt = 0; attempt < 200 && !blocked; attempt++) {
        const probe = await pg.connect('news_wide');
        try { blocked = (await probe.query(`select wait_event_type = 'Lock' w from pg_stat_activity where pid = $1`, [pid])).rows[0]?.w === true; } finally { await probe.end(); }
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert(blocked, 'the second claim waits for the account lock');
      await db.query('commit');
      const secondClaim = (await waiting).rows[0].value.entries[0]; await rival.query('commit');
      assert.deepEqual([first.status, secondClaim.status], ['claimed', 'busy']); assert.deepEqual(await quota(A), { hour_count: 1, day_count: 1 }, 'one call counted');
      pass('two simultaneous requests of one account for one topic: one lease, one call counted, the other sees busy');

      // 4. The real handler against the real functions.
      await db.query('delete from haedo_news_wide_private.feeds'); await db.query('delete from haedo_news_wide_private.limits');
      const B2 = randomUUID(), SB2 = randomUUID();
      await db.query('insert into auth.users(id) values ($1)', [B2]); await db.query('insert into auth.sessions(id, user_id) values ($1, $2)', [SB2, B2]);
      await db.query('insert into haedo_news_wide_private.allowed_accounts(owner_id) values ($1)', [B2]); // test setup only
      const { createHandler } = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/haedo-news-wide/handler.mjs')).href);
      const xml = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/haedo-rss/vendor/fast-xml-parser.mjs')).href);
      const fixture = name => fs.readFileSync(path.join(ROOT, 'tests/fixtures/news-wide', name));
      const PROJECT = 'https://project-fixture.supabase.co', SECRET = 'sb_secret_fixture_news_sql', PUBLIC = 'sb_publishable_fixture_news_sql';
      const tokens = { 'aaa.bbb.ccc': user(A, SA), 'ddd.eee.fff': user(B2, SB2), 'ggg.hhh.iii': user(A, EXPIRED), 'jjj.kkk.lll': user(C, SC) };
      let supplierCalls = [], supplierFails = false;
      const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
      // Stands in for Auth and PostgREST: the user token becomes the authenticated role with its
      // claims, the server key becomes service_role. SQL errors map as PostgREST maps them.
      const fetcher = async (url, init = {}) => {
        if (url.startsWith('https://news.google.com/')) {
          supplierCalls.push(url);
          if (supplierFails) return new Response('unavailable', { status: 503 });
          return new Response(fixture(new URL(url).searchParams.get('hl') === 'ko' ? 'google-news-ko.xml' : 'google-news-en.xml'), { headers: { 'content-type': 'application/xml; charset=utf-8' } });
        }
        assert(url.startsWith(PROJECT + '/'), 'unexpected address ' + url);
        const bearer = /^Bearer (.+)$/.exec(init.headers.Authorization || '')?.[1];
        if (url.endsWith('/auth/v1/user')) return tokens[bearer] && init.headers.apikey === PUBLIC ? reply({ id: tokens[bearer].sub, role: 'authenticated', is_anonymous: false }) : reply({ message: 'invalid' }, 401);
        const name = url.split('/rpc/')[1], body = JSON.parse(init.body);
        try {
          if (name === 'life_news_wide_claim') {
            assert(tokens[bearer] && init.headers.apikey === PUBLIC);
            return reply(await as(db, 'authenticated', tokens[bearer], 'select public.life_news_wide_claim($1, $2::jsonb) value', [body.p_supplier, JSON.stringify(body.p_requests)]));
          }
          assert.equal(name, 'life_news_wide_finish'); assert.equal(init.headers.apikey, SECRET); assert.equal(init.headers.Authorization, undefined);
          return reply(await as(db, 'service_role', { role: 'service_role' }, 'select public.life_news_wide_finish($1, $2, $3::jsonb) value', [body.p_owner_id, body.p_supplier, JSON.stringify(body.p_results)]));
        } catch (error) { return reply({ message: error.message }, error.code === '42501' ? 403 : error.code === '22023' ? 400 : 500); }
      };
      const handler = createHandler({ fetcher, ...xml, log: () => {}, environment: key => ({ SUPABASE_URL: PROJECT, SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }), SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLIC }) })[key] });
      const call = async (token, body) => {
        supplierCalls = [];
        const response = await handler(new Request('https://edge.fixture.invalid/haedo-news-wide', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) }));
        return { status: response.status, body: await response.json(), calls: supplierCalls.length };
      };
      const ask = { topics: ['기후', 'climate'], languages: ['ko', 'en'] }, statuses = answer => answer.body.topics.map(topic => topic.status + (topic.reason ? ':' + topic.reason : ''));
      let answer = await call('aaa.bbb.ccc', ask);
      assert.deepEqual([answer.status, answer.calls, statuses(answer), answer.body.stale, answer.body.items.length], [200, 4, ['fresh', 'fresh', 'fresh', 'fresh'], false, 10]);
      assert.equal(await rows('haedo_news_wide_private.feeds'), 4); assert.deepEqual(await quota(A), { hour_count: 4, day_count: 4 });
      const firstItems = answer.body.items;
      answer = await call('aaa.bbb.ccc', ask);
      assert.deepEqual([answer.status, answer.calls, statuses(answer), answer.body.stale], [200, 0, ['cached', 'cached', 'cached', 'cached'], false], 'within the TTL the supplier is not called');
      assert.deepEqual(answer.body.items, firstItems, 'the cache returns exactly what was fetched'); assert.deepEqual(await quota(A), { hour_count: 4, day_count: 4 });
      // Another account, same topics: its own fetch and its own rows.
      answer = await call('ddd.eee.fff', { topics: ['기후'], languages: ['ko'] });
      assert.deepEqual([answer.status, answer.calls, statuses(answer)], [200, 1, ['fresh']]); assert.equal(await rows('haedo_news_wide_private.feeds'), 5);
      // 31 minutes later the supplier is down: old items, marked stale; then the retry delay holds.
      await db.query(`update haedo_news_wide_private.feeds set fetched_at = fetched_at - interval '31 minutes' where owner_id = $1`, [A]);
      supplierFails = true;
      answer = await call('aaa.bbb.ccc', ask);
      assert.deepEqual([answer.status, answer.calls, statuses(answer), answer.body.stale, answer.body.items.length], [200, 4, Array(4).fill('stale:network_error'), true, 10]);
      answer = await call('aaa.bbb.ccc', ask);
      assert.deepEqual([answer.calls, statuses(answer), answer.body.stale], [0, Array(4).fill('stale:backoff'), true], 'no retry storm while the supplier is down');
      // The supplier is back and the delay has passed, but the hour's allowance has 2 calls left.
      supplierFails = false;
      await db.query(`update haedo_news_wide_private.feeds set next_attempt_at = clock_timestamp() - interval '1 second' where owner_id = $1`, [A]);
      await setQuota(A, 58, 58);
      answer = await call('aaa.bbb.ccc', ask);
      assert.deepEqual([answer.calls, statuses(answer), answer.body.stale], [2, ['fresh', 'fresh', 'limited:hourly_limit', 'limited:hourly_limit'], true]);
      assert.deepEqual(await quota(A), { hour_count: 60, day_count: 60 });
      // A topic with no cache under the limit: nothing to show, no call.
      answer = await call('aaa.bbb.ccc', { topics: ['처음보는주제'], languages: ['ko'] });
      assert.deepEqual([answer.status, answer.calls, statuses(answer), answer.body.items, answer.body.fetchedAt], [200, 0, ['limited:hourly_limit'], [], null]);
      // An expired session passes Auth here (the stand-in knows the token) but the database refuses it.
      answer = await call('ggg.hhh.iii', ask);
      assert.deepEqual([answer.status, answer.body, answer.calls], [401, { error: 'unauthorized' }, 0], 'the database checks the live session itself');
      answer = await call('zzz.zzz.zzz', ask);
      assert.deepEqual([answer.status, answer.calls], [401, 0]);
      // A real, signed-in account that is not on the allow list: 403, no supplier call, no row, no counter.
      const beforeC = [await rows('haedo_news_wide_private.feeds'), await rows('haedo_news_wide_private.limits')];
      answer = await call('jjj.kkk.lll', ask);
      assert.deepEqual([answer.status, answer.body, answer.calls], [403, { error: 'not_enabled_for_account' }, 0]);
      assert.deepEqual([await rows('haedo_news_wide_private.feeds'), await rows('haedo_news_wide_private.limits')], beforeC);
      assert.equal((await db.query('select count(*)::int n from haedo_news_wide_private.limits where owner_id = $1', [C])).rows[0].n, 0);
      const kept = (await db.query(`select bool_and(haedo_news_wide_private.items_valid(supplier, items)) ok, count(*)::int n from haedo_news_wide_private.feeds where items is not null`)).rows[0];
      assert.deepEqual(kept, { ok: true, n: 5 });
      pass('handler + SQL: fresh (4 calls) -> cached (0 calls) -> stale on supplier failure -> backoff (0 calls) -> 2 calls left then limited; other account isolated; dead session refused by the database; an account that is not listed gets 403 and no supplier call');
    } finally { await db.end().catch(() => {}); await rival.end().catch(() => {}); }
    console.log(`news wide SQL: ${passed} groups passed`);
  } finally { await pg.stop(); }
}

main().catch(error => { console.error('FAIL news wide SQL' + (mutation ? ' (mutation ' + mutation + ')' : '') + ': ' + error.message); process.exitCode = 1; });

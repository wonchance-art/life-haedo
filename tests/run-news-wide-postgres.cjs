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
 *      functions, with a fixture supplier: fresh -> cached -> stale -> limited.
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
const SUPPLIER = 'google-news-rss';
const MUTATIONS = {
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
  'any-topic': sql => sql.replace(/  and p_topic !~ '\["[^\n]+\n/, '  , false)\n'),
  'lease-not-checked': sql => sql.replace("if not found or r.lease_token is distinct from (e->>'leaseToken')::uuid or r.lease_until <= stamp then", 'if not found then'),
  'clear-everyone': sql => sql.replace('delete from haedo_news_wide_private.feeds where owner_id = who;', 'delete from haedo_news_wide_private.feeds;'),
  'no-retention': sql => sql.replace(/ delete from haedo_news_wide_private\.feeds where owner_id = who and touched_at < stamp - interval '7 days'\n  and \(lease_until is null or lease_until <= stamp\);\n/, ''),
};
const args = process.argv.slice(2);
if (args.length > 1 || args.length && !(/^--mutation=[a-z-]+$/.test(args[0]) && Object.hasOwn(MUTATIONS, args[0].slice(11)))) throw Error('Only --mutation=' + Object.keys(MUTATIONS).join('|') + ' is accepted.');
const mutation = args[0]?.slice(11);
function migration() {
  const original = fs.readFileSync(FILE, 'utf8');
  if (!mutation) return original;
  const changed = MUTATIONS[mutation](original);
  if (changed === original) throw Error('Mutation ' + mutation + ' no longer matches the migration text.');
  return changed;
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
      const earlier = pgStub.migrationFiles().filter(file => path.basename(file) !== NAME);
      assert.equal(earlier.length + 1, pgStub.migrationFiles().length, 'the migration file is in supabase/migrations');
      assert.equal(pgStub.migrationFiles().at(-1), FILE, 'it sorts after every earlier migration');
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
      assert(!/\b(drop|truncate|alter\s+(?!table haedo_news_wide_private\.(feeds|limits) enable row level security))\b/i.test(text.replace(/^\s*--.*$/gm, '')), 'no drop, truncate or alter of anything else');
      pass(`migration adds ${own.length} catalog entries of its own, leaves the other ${before.length} unchanged, and re-applies to the same catalog`);

      // 2. Closed by default (catalog).
      const privilege = (role, kind, object, right) => db.query(`select has_${kind}_privilege($1, $2, $3) ok`, [role, object, right]).then(result => result.rows[0].ok);
      for (const table of ['haedo_news_wide_private.feeds', 'haedo_news_wide_private.limits']) {
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
      pass('tables: RLS on, no policy, no table right for anon/authenticated/service_role; 9 functions with a fixed search_path and exactly the intended role each');

      // Accounts and sessions (synthetic).
      const A = randomUUID(), B = randomUUID(), ANON = randomUUID(), SA = randomUUID(), SB = randomUUID(), SANON = randomUUID(), EXPIRED = randomUUID();
      await db.query('insert into auth.users(id, is_anonymous) values ($1, false), ($2, null), ($3, true)', [A, B, ANON]);
      await db.query(`insert into auth.sessions(id, user_id, not_after) values ($1, $2, null), ($3, $4, now() + interval '1 hour'), ($5, $6, null), ($7, $2, now() - interval '1 minute')`, [SA, A, SB, B, SANON, ANON, EXPIRED]);
      const as = async (client, role, claims, query, values = []) => {
        await client.query('begin');
        try {
          await client.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [JSON.stringify(claims || {}), claims?.sub || '']);
          if (role !== 'postgres') await client.query('set local role ' + role);
          const result = await client.query(query, values); await client.query('commit'); return result.rows[0]?.value;
        } catch (error) { await client.query('rollback'); throw error; }
      };
      const user = (sub, session) => ({ sub, role: 'authenticated', session_id: session });
      const claim = (who, session, requests, client = db) => as(client, 'authenticated', user(who, session), 'select public.life_news_wide_claim($1, $2::jsonb) value', [SUPPLIER, JSON.stringify(requests)]).then(value => value.entries);
      const finish = (owner, results) => as(db, 'service_role', { role: 'service_role' }, 'select public.life_news_wide_finish($1, $2, $3::jsonb) value', [owner, SUPPLIER, JSON.stringify(results)]);
      const one = (topic, language = 'ko') => [{ topic, language }];
      const refused = (promise, pattern, label) => assert.rejects(promise, error => pattern.test(error.message), label);
      const feed = (owner, topic, language = 'ko') => db.query('select * from haedo_news_wide_private.feeds where owner_id = $1 and topic = $2 and language = $3', [owner, topic, language]).then(result => result.rows[0]);
      const quota = owner => db.query('select hour_count, day_count from haedo_news_wide_private.limits where owner_id = $1', [owner]).then(result => result.rows[0]);

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
        'pipe': one('a|b'), 'angle': one('a<b'), 'backslash': one('a\\b'), 'newline': one('기후\n변화'), 'tab': one('기후\t변화'), 'escape': one('기후\u001b'), 'zero width': one('기​후'),
        'bidi override': one('‮기후'), 'line separator': one('기후 '), 'null item': [null] };
      for (const [name, requests] of Object.entries(badRequests)) await refused(claim(A, SA, requests), /life_news_wide_invalid_request/, name);
      await refused(as(db, 'authenticated', user(A, SA), 'select public.life_news_wide_claim($1, $2::jsonb) value', ['other-supplier', JSON.stringify(one('기후'))]), /life_news_wide_invalid_request/, 'unknown supplier');
      await refused(as(db, 'authenticated', user(A, SA), 'select public.life_news_wide_claim($1, null) value', [SUPPLIER]), /life_news_wide_invalid_request/, 'null requests');
      assert.equal(await rows('haedo_news_wide_private.feeds'), 0); assert.equal(await rows('haedo_news_wide_private.limits'), 0);
      for (const topic of ['기후', 'climate change', 'K-pop', 'C++', 'C#', '.NET', 'R&D', 'AI/ML', "O'Reilly", 'O’Reilly', '3·1 운동', '𠀀'.repeat(40)])
        assert.equal((await db.query('select haedo_news_wide_private.topic_valid($1) ok', [topic])).rows[0].ok, true, 'a topic the Edge function accepts: ' + topic);
      pass(`claim refuses ${Object.keys(badRequests).length + 2} malformed inputs with life_news_wide_invalid_request and stores nothing; 12 Edge-valid topics are valid here too`);

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
      const before2 = { b: (await db.query('select count(*)::int n from haedo_news_wide_private.feeds where owner_id = $1', [B])).rows[0].n, quota: await quota(A) };
      assert(before2.b >= 2);
      assert.deepEqual(await as(db, 'authenticated', user(A, SA), 'select public.life_news_wide_clear() value'), { status: 'cleared', removed: 64 });
      assert.equal((await db.query('select count(*)::int n from haedo_news_wide_private.feeds where owner_id = $1', [A])).rows[0].n, 0);
      assert.equal((await db.query('select count(*)::int n from haedo_news_wide_private.feeds where owner_id = $1', [B])).rows[0].n, before2.b, "clearing removes only the caller's rows");
      assert.deepEqual(await quota(A), before2.quota, 'clearing does not return the allowance');
      assert.deepEqual(await as(db, 'authenticated', user(A, SA), 'select public.life_news_wide_clear() value'), { status: 'cleared', removed: 0 });
      await db.query('delete from auth.users where id = $1', [B]);
      assert.equal((await db.query('select (select count(*) from haedo_news_wide_private.feeds where owner_id = $1)::int + (select count(*) from haedo_news_wide_private.limits where owner_id = $1)::int n', [B])).rows[0].n, 0, 'deleting the account removes its cache and counters');
      pass('retention 7 days on the same account only, 64 topics per account, clear removes only the caller\'s rows and keeps the counters, account deletion cascades');

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
      const { createHandler } = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/haedo-news-wide/handler.mjs')).href);
      const xml = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/haedo-rss/vendor/fast-xml-parser.mjs')).href);
      const fixture = name => fs.readFileSync(path.join(ROOT, 'tests/fixtures/news-wide', name));
      const PROJECT = 'https://project-fixture.supabase.co', SECRET = 'sb_secret_fixture_news_sql', PUBLIC = 'sb_publishable_fixture_news_sql';
      const tokens = { 'aaa.bbb.ccc': user(A, SA), 'ddd.eee.fff': user(B2, SB2), 'ggg.hhh.iii': user(A, EXPIRED) };
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
        if (url.endsWith('/auth/v1/user')) return tokens[bearer] && init.headers.apikey === PUBLIC ? reply({ id: tokens[bearer].sub, role: 'authenticated' }) : reply({ message: 'invalid' }, 401);
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
      const kept = (await db.query(`select bool_and(haedo_news_wide_private.items_valid(supplier, items)) ok, count(*)::int n from haedo_news_wide_private.feeds where items is not null`)).rows[0];
      assert.deepEqual(kept, { ok: true, n: 5 });
      pass('handler + SQL: fresh (4 calls) -> cached (0 calls) -> stale on supplier failure -> backoff (0 calls) -> 2 calls left then limited; other account isolated; dead session refused by the database');
    } finally { await db.end().catch(() => {}); await rival.end().catch(() => {}); }
    console.log(`news wide SQL: ${passed} groups passed`);
  } finally { await pg.stop(); }
}

main().catch(error => { console.error('FAIL news wide SQL' + (mutation ? ' (mutation ' + mutation + ')' : '') + ': ' + error.message); process.exitCode = 1; });

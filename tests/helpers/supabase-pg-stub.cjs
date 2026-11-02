/* Disposable local PostgreSQL with a minimal, TEST-ONLY Supabase surface, replaying
 * every supabase/migrations/*.sql file in filename order.
 *
 * No endpoint, account, credential or production option exists here: the cluster is
 * created under /tmp with trust auth on 127.0.0.1 and a private socket, and removed
 * on stop(). It uses the installed server binaries (/usr/lib/postgresql/<n>/bin,
 * HAEDO_PG_BIN or `pg_config --bindir`) and the pinned test-only `pg` client from
 * tests/sql-ci (npm ci --prefix tests/sql-ci). When run as root, the cluster is owned
 * by the `postgres` OS user (runuser), like tests/run-account-docs-postgres.cjs.
 *
 * Reuse from another SQL test:
 *   const { startReplayedCluster, PostgresUnavailable } = require('./helpers/supabase-pg-stub.cjs');
 *   const pg = await startReplayedCluster({ label: 'my-check' });   // throws PostgresUnavailable to skip
 *   try {
 *     const db = await pg.cloneDatabase('my_check');               // fresh copy of the replayed schema
 *     const client = await pg.connect('my_check'); ...; await client.end();
 *   } finally { await pg.stop(); }
 *
 * STUB_SQL is NOT Supabase. It only declares what the migrations reference (roles,
 * auth.uid/role/users, storage.buckets/objects/foldername, cron.job tables, vault,
 * net, extensions) so they apply. It has no GoTrue, Storage API, PostgREST, pg_cron
 * scheduler, pg_net or Vault encryption, and grants are a simplified approximation.
 */
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations');
const PG_MODULE_PATH = path.join(ROOT, 'tests/sql-ci/node_modules/pg');
const TEMPLATE_DB = 'haedo_replay';

class PostgresUnavailable extends Error {}

// Test-only Supabase surface. Keep it minimal: add an object only when a migration
// or an operations script references it, and say so in the comment beside it.
const STUB_SQL = String.raw`
-- TEST-ONLY STUB. Never run against a real Supabase project.
do $$ begin
  -- PostgREST request roles; service_role bypasses RLS like the hosted role.
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- GoTrue: only the columns and helpers the migrations use.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb,
  created_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable
  as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
create or replace function auth.role() returns text language sql stable
  as $f$ select nullif(current_setting('request.jwt.claim.role', true), '')::text $f$;
grant usage on schema auth to anon, authenticated, service_role;

-- Storage: bucket/object rows and the folder helper used by storage policies.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid default gen_random_uuid() primary key,
  bucket_id text,
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz,
  path_tokens text[],
  owner_id text,
  version text,
  last_accessed_at timestamptz
);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $f$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $f$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

-- pg_cron catalog tables read by supabase/operations/naver-status-check.sql (no scheduler).
create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, jobname text, schedule text, active boolean);
create table if not exists cron.job_run_details (runid bigserial, jobid bigint, status text, start_time timestamptz);

-- Vault view shape and pg_net schema only; no encryption, no HTTP.
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (name text, decrypted_secret text);
create schema if not exists net;
`;

function versionedBins() {
  const base = '/usr/lib/postgresql';
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base).filter(v => /^\d+$/.test(v)).sort((a, b) => b - a).map(v => path.join(base, v, 'bin'));
}

// Returns the server bin directory, or null when this machine has no PostgreSQL server.
function findPostgres() {
  const candidates = [process.env.HAEDO_PG_BIN, ...versionedBins()];
  try { candidates.push(execFileSync('pg_config', ['--bindir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch (_) { /* no pg_config */ }
  return candidates.find(dir => dir && fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl'))) || null;
}

function migrationFiles(dir = MIGRATIONS_DIR) {
  return fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort().map(name => path.join(dir, name));
}

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});

function loadPg() {
  if (!fs.existsSync(PG_MODULE_PATH)) throw Error('Run npm ci --prefix tests/sql-ci first (pinned test-only pg client).');
  return require(PG_MODULE_PATH);
}

// 1-based line/column of a PostgreSQL error position inside the executed text.
function locate(sql, position) {
  const offset = Number(position);
  if (!Number.isFinite(offset) || offset < 1) return '';
  const before = sql.slice(0, offset - 1).split('\n');
  const line = before.length;
  const text = sql.split('\n')[line - 1] || '';
  return ` at line ${line}:${before[before.length - 1].length + 1}\n    ${text.trim().slice(0, 160)}`;
}

function describeError(file, sql, error) {
  const shown = file.startsWith(ROOT + path.sep) ? path.relative(ROOT, file) : file;
  const parts = [`${shown}: ${error.message}${locate(sql, error.position)}`];
  if (error.code) parts.push(`SQLSTATE ${error.code}`);
  if (error.where) parts.push(`where: ${error.where.split('\n')[0]}`);
  if (error.internalQuery) parts.push(`internal query: ${error.internalQuery.slice(0, 160)}${locate(error.internalQuery, error.internalPosition)}`);
  return parts.join('\n  ');
}

// Runs one SQL file (simple protocol, multi-statement). On error the message names the
// file, SQLSTATE and line, and the session is rolled back so the caller can report it.
async function applyFile(client, file) {
  const sql = fs.readFileSync(file, 'utf8');
  try {
    return await client.query(sql);
  } catch (error) {
    try { await client.query('rollback'); } catch (_) { /* not in a transaction */ }
    const wrapped = Error(describeError(file, sql, error));
    wrapped.file = file; wrapped.cause = error;
    throw wrapped;
  }
}

async function startCluster({ label = 'sql' } = {}) {
  const binDir = findPostgres();
  if (!binDir) throw new PostgresUnavailable('no local PostgreSQL server binaries (/usr/lib/postgresql/<n>/bin, HAEDO_PG_BIN or pg_config)');
  const { Client } = loadPg();
  const bin = name => path.join(binDir, name);
  const asRoot = process.getuid?.() === 0;
  const run = (cmd, args) => asRoot
    ? execFileSync('runuser', ['-u', 'postgres', '--', cmd, ...args], { stdio: 'pipe', encoding: 'utf8' })
    : execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8' });
  // The postgres OS user cannot reach per-session scratch directories, so the cluster lives in /tmp.
  const tmpRoot = fs.existsSync('/tmp') ? '/tmp' : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(tmpRoot, `haedo-${label.replace(/[^a-z0-9-]/gi, '')}-pg-`));
  const data = path.join(dir, 'data'), socket = path.join(dir, 'socket'), log = path.join(dir, 'server.log');
  fs.mkdirSync(socket);
  if (asRoot) execFileSync('chown', ['-R', 'postgres', dir]);
  const port = await freePort();
  let started = false, stopped = false;
  const stopSync = () => {
    if (stopped) return; stopped = true;
    if (started) { try { run(bin('pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']); } catch (_) { /* best effort */ } }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  process.once('exit', stopSync);
  try {
    run(bin('initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '--no-sync', '-E', 'UTF8', '--locale=C']);
    run(bin('pg_ctl'), ['-D', data, '-w', '-l', log, '-o', `-p ${port} -c listen_addresses=127.0.0.1 -k ${socket} -c fsync=off`, 'start']);
    started = true;
  } catch (error) {
    const tail = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').slice(-15).join('\n') : '';
    stopSync();
    throw Error(`could not start disposable PostgreSQL: ${(error.stderr || error.message).trim()}\n${tail}`);
  }
  const connect = async (database = 'postgres') => {
    const client = new Client({ host: '127.0.0.1', port, user: 'postgres', database });
    client.on('notice', () => {}); // migrations raise informational notices
    await client.connect();
    return client;
  };
  return {
    host: '127.0.0.1', port, user: 'postgres', binDir, connect,
    async stop() { stopSync(); process.removeListener('exit', stopSync); },
  };
}

// Creates the stubs and applies every migration in filename order into `database`.
// Fails on the first error with the failing file, SQLSTATE and line.
async function replayMigrations(client, { files = migrationFiles(), onApplied } = {}) {
  const timings = [];
  let start = Date.now();
  try { await client.query(STUB_SQL); } catch (error) { throw Error(describeError(__filename, STUB_SQL, error)); }
  timings.push({ file: 'stub', ms: Date.now() - start });
  for (const file of files) {
    start = Date.now();
    await applyFile(client, file);
    const entry = { file: path.basename(file), ms: Date.now() - start };
    timings.push(entry);
    if (onApplied) onApplied(entry);
  }
  return timings;
}

// Disposable cluster whose `haedo_replay` database holds the stubs plus every migration.
// cloneDatabase(name) copies it (CREATE DATABASE ... TEMPLATE) for an isolated test.
async function startReplayedCluster({ label = 'sql-replay', onApplied } = {}) {
  const cluster = await startCluster({ label });
  try {
    const t0 = Date.now();
    const admin = await cluster.connect();
    await admin.query(`create database ${TEMPLATE_DB}`);
    await admin.end();
    const client = await cluster.connect(TEMPLATE_DB);
    let timings;
    try { timings = await replayMigrations(client, { onApplied }); } finally { await client.end(); }
    return {
      ...cluster, database: TEMPLATE_DB, timings, replayMs: Date.now() - t0,
      async cloneDatabase(name) {
        if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw Error('clone name must be a lowercase identifier');
        const c = await cluster.connect();
        try { await c.query(`create database ${name} template ${TEMPLATE_DB}`); } finally { await c.end(); }
        return name;
      },
    };
  } catch (error) {
    await cluster.stop();
    throw error;
  }
}

module.exports = {
  ROOT, MIGRATIONS_DIR, STUB_SQL, TEMPLATE_DB, PostgresUnavailable,
  findPostgres, migrationFiles, startCluster, replayMigrations, startReplayedCluster, applyFile, describeError,
};

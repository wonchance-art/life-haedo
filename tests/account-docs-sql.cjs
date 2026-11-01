/* Synthetic local SQL execution only. No project credentials or live database.
 * Started by tests/run-account-docs-postgres.cjs against a disposable local cluster:
 * ACCOUNT_DOCS_PG_PORT=<port> PG_MODULE_PATH=<test-only pg module> node tests/account-docs-sql.cjs
 */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
const migration = path.join(__dirname, '../supabase/migrations/20261101090000_life_account_documents.sql');

async function main() {
  const { Client } = require(process.env.PG_MODULE_PATH || 'pg');
  const config = { host: process.env.ACCOUNT_DOCS_PG_HOST || '127.0.0.1', port: Number(process.env.ACCOUNT_DOCS_PG_PORT), user: 'postgres', database: 'postgres' };
  const db = new Client(config); await db.connect();
  const report = { engine: 'PostgreSQL real sessions', checks: [] };
  const q = (sql, args = []) => db.query(sql, args);
  const check = async (name, fn) => { await fn(); report.checks.push({ name, pass: true }); console.log('PASS ' + name); };
  const as = async (role, owner, fn) => {
    await q('reset role'); await q("select set_config('request.jwt.claim.sub',$1,false)", [owner || '']);
    if (role !== 'postgres') await q('set role ' + role);
    try { return await fn(); } finally { await q('reset role'); }
  };
  const put = (owner, key, expected, data, { op = randomUUID(), deleted = false, at = '2026-11-01T00:00:00Z' } = {}) => as('authenticated', owner, async () =>
    (await q('select public.life_account_document_put($1,$2,$3,$4::jsonb,$5,$6) result', [key, expected, op, data === null ? null : JSON.stringify(data), deleted, at])).rows[0].result);
  const changes = (owner, after, limit = 100) => as('authenticated', owner, async () =>
    (await q('select * from public.life_account_document_changes($1,$2)', [after, limit])).rows);
  const rejected = (fn, code) => assert.rejects(fn, error => error.code === code);
  try {
    await q(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;
      create schema if not exists auth;
      create table if not exists auth.users(id uuid primary key);
      create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;`);
    const sql = fs.readFileSync(migration, 'utf8');
    await q(sql);
    await check('migration is idempotent when applied twice', async () => { await q(sql); });
    const A = randomUUID(), B = randomUUID();
    await q('insert into auth.users(id) values ($1),($2)', [A, B]);
    const key = 'discoverySettings:["https://example.supabase.co","' + A + '"]:ws-1';

    await check('first put stores revision 1 with a sequence', async () => {
      const result = await put(A, key, 0, { revision: 1, value: '한글' });
      assert.equal(result.status, 'stored'); assert.equal(result.revision, 1); assert(Number.isSafeInteger(result.seq));
    });
    await check('CAS conflict returns the current document', async () => {
      const result = await put(A, key, 0, { revision: 9 });
      assert.equal(result.status, 'conflict'); assert.equal(result.revision, 1);
      assert.deepEqual(result.current.data, { revision: 1, value: '한글' }); assert.equal(result.current.deleted, false);
      assert.equal(new Date(result.current.client_updated_at).toISOString(), '2026-11-01T00:00:00.000Z');
      const missing = await put(A, key + ':absent', 3, { x: 1 });
      assert.equal(missing.status, 'conflict'); assert.equal(missing.revision, 0); assert.equal(missing.current, null);
    });
    await check('idempotent replay returns the same receipt and rejects a changed request', async () => {
      const op = randomUUID();
      const first = await put(A, key, 1, { revision: 2 }, { op });
      const replay = await put(A, key, 1, { revision: 2 }, { op });
      assert.deepEqual(replay, first); assert.equal(first.status, 'stored'); assert.equal(first.revision, 2);
      await rejected(() => put(A, key, 1, { revision: 3 }, { op }), '22023');
      const rows = (await q('select revision from public.life_account_documents where owner_id=$1 and doc_key=$2', [A, key])).rows;
      assert.deepEqual(rows.map(row => Number(row.revision)), [2]);
    });
    await check('every update moves the document to a new seq and changes are ordered', async () => {
      const before = await changes(A, 0);
      const other = await put(A, 'page-drafts:ws-1', 0, { revision: 1, posts: [] });
      const updated = await put(A, key, 2, { revision: 3 });
      assert(updated.seq > other.seq);
      const all = await changes(A, 0);
      assert.deepEqual(all.map(row => row.doc_key), ['page-drafts:ws-1', key]);
      assert(all.every((row, index) => index === 0 || Number(row.seq) > Number(all[index - 1].seq)));
      const after = await changes(A, Number(other.seq));
      assert.deepEqual(after.map(row => row.doc_key), [key]); assert.equal(Number(after[0].revision), 3);
      assert(before.length >= 1);
      const limited = await changes(A, 0, 1); assert.equal(limited.length, 1);
      await rejected(() => changes(A, 0, 501), '22023'); await rejected(() => changes(A, -1, 10), '22023');
    });
    await check('tombstones carry no data and stay readable through changes', async () => {
      const tomb = await put(A, 'page-drafts:ws-1', 1, null, { deleted: true });
      assert.equal(tomb.status, 'stored');
      const row = (await changes(A, 0)).find(item => item.doc_key === 'page-drafts:ws-1');
      assert.equal(row.deleted, true); assert.equal(row.data, null);
      await rejected(() => put(A, 'x', 0, { a: 1 }, { deleted: true }), '22023');
      await rejected(() => put(A, 'y', 0, null), '22023');
    });
    await check('owner isolation: another user never reads or overwrites the document', async () => {
      assert.deepEqual(await changes(B, 0), []);
      const own = await put(B, key, 0, { revision: 1, owner: 'B' });
      assert.equal(own.status, 'stored'); assert.equal(own.revision, 1);
      const mine = (await changes(A, 0)).find(row => row.doc_key === key);
      assert.equal(mine.data.owner, undefined); assert.equal(Number(mine.revision), 3);
      const direct = await as('authenticated', B, async () => (await q('select doc_key, data from public.life_account_documents')).rows);
      assert.deepEqual(direct.map(row => row.data.owner), ['B']);
      await rejected(() => as('authenticated', B, () => q('update public.life_account_documents set data=$1::jsonb', ['{"x":1}'])), '42501');
      await rejected(() => as('authenticated', B, () => q("insert into public.life_account_documents(doc_key,revision,data) values ('z',1,'{}')")), '42501');
      await rejected(() => as('authenticated', B, () => q('delete from public.life_account_documents')), '42501');
      await rejected(() => as('authenticated', B, () => q('select * from public.life_account_document_receipts')), '42501');
    });
    await check('size cap rejects data above 2 MiB compact JSON', async () => {
      const fits = { text: 'a'.repeat(2 * 1024 * 1024 - 20) };
      assert(Buffer.byteLength(JSON.stringify(fits)) <= 2 * 1024 * 1024);
      assert.equal((await put(A, 'big-ok', 0, fits)).status, 'stored');
      await rejected(() => put(A, 'big', 0, { text: 'a'.repeat(2 * 1024 * 1024) }), '22001');
      await rejected(() => put(A, 'k'.repeat(513), 0, { a: 1 }), '22023');
    });
    await check('anonymous and unauthenticated callers are denied', async () => {
      await rejected(() => as('anon', '', () => q("select public.life_account_document_put('k',0,$1,'{}'::jsonb,false,null)", [randomUUID()])), '42501');
      await rejected(() => as('anon', '', () => q('select * from public.life_account_document_changes(0,10)')), '42501');
      await rejected(() => as('anon', '', () => q('select * from public.life_account_documents')), '42501');
      await rejected(() => as('authenticated', '', () => q("select public.life_account_document_put('k',0,$1,'{}'::jsonb,false,null)", [randomUUID()])), '42501');
      await rejected(() => as('authenticated', '', () => q('select * from public.life_account_document_changes(0,10)')), '42501');
    });
    await check('two real sessions racing the same CAS store one winner and one conflict', async () => {
      const clients = [new Client(config), new Client(config)];
      try {
        await Promise.all(clients.map(c => c.connect()));
        await Promise.all(clients.map(c => c.query("select set_config('request.jwt.claim.sub',$1,false)", [A])));
        await Promise.all(clients.map(c => c.query('set role authenticated')));
        const results = await Promise.all(clients.map((c, i) => c.query('select public.life_account_document_put($1,0,$2,$3::jsonb,false,null) result',
          ['race-key', randomUUID(), JSON.stringify({ i })])));
        assert.deepEqual(results.map(r => r.rows[0].result.status).sort(), ['conflict', 'stored']);
      } finally { await Promise.all(clients.map(c => c.end())); }
    });
    await check('deleting the auth user removes documents and receipts', async () => {
      await q('delete from auth.users where id=$1', [B]);
      assert.equal(Number((await q('select count(*) n from public.life_account_documents where owner_id=$1', [B])).rows[0].n), 0);
      assert.equal(Number((await q('select count(*) n from public.life_account_document_receipts where owner_id=$1', [B])).rows[0].n), 0);
    });
    report.pass = true;
  } finally {
    await db.end();
    if (process.env.ACCOUNT_DOCS_SQL_REPORT) fs.writeFileSync(process.env.ACCOUNT_DOCS_SQL_REPORT, JSON.stringify(report, null, 2) + '\n');
  }
  console.log('Account documents SQL: ' + report.checks.length + ' checks passed.');
}
main().catch(error => { console.error('FAIL account documents SQL: ' + error.message); process.exitCode = 1; });

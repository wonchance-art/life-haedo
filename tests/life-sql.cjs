/* Optional PostgreSQL-WASM execution checks; no application dependency.
 * npm install --prefix /tmp/life-pglite-check --ignore-scripts @electric-sql/pglite@0.5.8
 * PGLITE_MODULE_PATH=/tmp/life-pglite-check/node_modules/@electric-sql/pglite node tests/life-sql.cjs
 * PGlite uses one connection: this checks SQL/RLS semantics, not real concurrent sessions
 * or Supabase Auth/PostgREST. Use scripts/check-life-cloud.py for the installed server.
 */
'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../assets/life/core.js');
let PGlite;
try { ({ PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite')); }
catch (_) { console.error('PGlite is unavailable. Set PGLITE_MODULE_PATH to the test-only installation.'); process.exit(2); }

(async () => {
  const db = new PGlite();
  const ownerA = randomUUID(), ownerB = randomUUID(), wid = randomUUID();
  const snapshot = core.createWorkspace({ workspaceId: wid, title: '익명 SQL 검사' });
  let passed = 0;
  async function check(name, action) {
    await action(); passed++; console.log('PASS ' + name);
  }
  async function as(role, owner, action) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner || '']);
    assert(['anon', 'authenticated', 'postgres'].includes(role));
    if (role !== 'postgres') await db.exec('set role ' + role);
    try { return await action(); } finally { await db.exec('reset role'); }
  }
  async function put(expected = 0, op = randomUUID(), data = snapshot, id = wid) {
    return (await db.query('select public.life_sync_put($1::uuid,$2::bigint,$3::uuid,$4::jsonb) as result', [id, expected, op, JSON.stringify(data)])).rows[0].result;
  }
  const denied = action => assert.rejects(action, error => error.code === '42501');
  try {
    // Test-only Auth shim. Real Supabase supplies these roles and auth.uid().
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to anon, authenticated;
      create table public.charts (sentinel text);
      insert into public.charts values ('untouched');`);
    const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261003085426_life_sync_workspaces.sql'), 'utf8');
    await check('migration executes and is repeatable without touching charts', async () => {
      await db.exec(sql); await db.exec(sql);
      assert.deepEqual((await db.query('select * from public.charts')).rows, [{ sentinel: 'untouched' }]);
    });
    await check('fixed search_path and SECURITY DEFINER are installed', async () => {
      const fn = (await db.query("select prosecdef, proconfig from pg_proc where oid='public.life_sync_put(uuid,bigint,uuid,jsonb)'::regprocedure")).rows[0];
      assert.equal(fn.prosecdef, true); assert.deepEqual(fn.proconfig, ['search_path=pg_catalog']);
    });
    await check('anonymous SELECT/write/receipt/RPC access denied', () => as('anon', '', async () => {
      await denied(() => db.query('select * from public.life_workspaces'));
      await denied(() => db.query('select * from public.life_sync_receipts'));
      await denied(() => put());
    }));
    await check('authenticated role without auth.uid cannot invoke RPC', () => as('authenticated', '', async () => {
      await denied(() => put());
    }));
    const firstOperation = randomUUID();
    await check('owner creates at revision 1 and retries identical request once', () => as('authenticated', ownerA, async () => {
      assert.deepEqual(await put(0, firstOperation), { status: 'stored', revision: 1 });
      assert.deepEqual(await put(0, firstOperation), { status: 'stored', revision: 1 });
      assert.equal((await db.query('select revision from public.life_workspaces')).rows[0].revision, 1);
    }));
    await check('direct INSERT/UPDATE/DELETE and receipts remain denied to owner', () => as('authenticated', ownerA, async () => {
      await denied(() => db.query('insert into public.life_workspaces (owner_id,id,title,revision,data) values ($1,$2,$3,1,$4)', [ownerA, randomUUID(), 'blocked', JSON.stringify(snapshot)]));
      await denied(() => db.query('update public.life_workspaces set revision=4 where id=$1', [wid]));
      await denied(() => db.query('delete from public.life_workspaces where id=$1', [wid]));
      await denied(() => db.query('select * from public.life_sync_receipts'));
    }));
    await check('other account cannot see row or detect its revision', () => as('authenticated', ownerB, async () => {
      assert.deepEqual((await db.query('select * from public.life_workspaces where id=$1', [wid])).rows, []);
      assert.deepEqual(await put(7), { status: 'missing' });
    }));
    await check('same UUID and operation are independent across owners', () => as('authenticated', ownerB, async () => {
      assert.deepEqual(await put(0, firstOperation), { status: 'stored', revision: 1 });
      assert.equal((await db.query('select count(*)::int as n from public.life_workspaces')).rows[0].n, 1);
    }));
    await check('same operation rejects changed payload or CAS base', () => as('authenticated', ownerA, async () => {
      await assert.rejects(() => put(0, firstOperation, { ...snapshot, title: '변경' }), e => e.code === '22023' && e.message === 'life_operation_mismatch');
      await assert.rejects(() => put(1, firstOperation), e => e.code === '22023' && e.message === 'life_operation_mismatch');
    }));
    await check('JSON object key order does not invalidate a lost-response retry', () => as('authenticated', ownerA, async () => {
      const reordered = Object.fromEntries(Object.entries(snapshot).reverse());
      assert.deepEqual(await put(0, firstOperation, reordered), { status: 'stored', revision: 1 });
    }));
    await check('stale create and update return conflict without overwriting', () => as('authenticated', ownerA, async () => {
      assert.deepEqual(await put(0), { status: 'conflict', revision: 1 });
      assert.deepEqual(await put(1), { status: 'stored', revision: 2 });
      assert.deepEqual(await put(1), { status: 'conflict', revision: 2 });
      assert.deepEqual(await put(0, firstOperation), { status: 'stored', revision: 1 });
      assert.equal((await db.query('select revision from public.life_workspaces')).rows[0].revision, 2);
    }));
    await check('missing nonzero base cannot recreate a removed or unknown workspace', () => as('authenticated', ownerA, async () => {
      const missing = core.createWorkspace();
      assert.deepEqual(await put(1, randomUUID(), missing, missing.workspaceId), { status: 'missing' });
      assert.equal((await db.query('select count(*)::int as n from public.life_workspaces')).rows[0].n, 1);
    }));
    await check('failed conflict has no receipt and can be retried with corrected base', () => as('authenticated', ownerA, async () => {
      const op = randomUUID();
      assert.deepEqual(await put(0, op), { status: 'conflict', revision: 2 });
      assert.deepEqual(await put(2, op), { status: 'stored', revision: 3 });
    }));
    await check('null/negative/oversized base and malformed snapshot rejected', () => as('authenticated', ownerA, async () => {
      for (const base of [null, -1, '9007199254740992']) await assert.rejects(() => put(base), e => e.code === '22023');
      for (const data of [null, {}, [], { ...snapshot, workspaceId: randomUUID() }, { ...snapshot, schemaVersion: '1' }, { ...snapshot, title: '' }]) {
        await assert.rejects(() => put(3, randomUUID(), data), e => e.code === '22023');
      }
    }));
    await check('server rejects snapshots above 16 MiB without a write', () => as('authenticated', ownerA, async () => {
      await assert.rejects(() => put(3, randomUUID(), { ...snapshot, extra: 'x'.repeat(16 * 1024 * 1024) }), e => e.code === '22001' && e.message === 'life_snapshot_too_large');
      assert.equal((await db.query('select revision from public.life_workspaces')).rows[0].revision, 3);
    }));
    await check('transaction rollback removes snapshot and receipt together', async () => {
      const another = core.createWorkspace(), op = randomUUID();
      await as('authenticated', ownerA, async () => {
        await db.exec('begin');
        assert.equal((await put(0, op, another, another.workspaceId)).status, 'stored');
        await db.exec('rollback');
      });
      assert.equal((await db.query('select count(*)::int as n from public.life_sync_receipts where workspace_id=$1', [another.workspaceId])).rows[0].n, 0);
      await as('authenticated', ownerA, async () => assert.deepEqual(await put(0, op, another, another.workspaceId), { status: 'stored', revision: 1 }));
    });
    await check('admin removal cannot be resurrected with old nonzero base', async () => {
      await db.query('delete from public.life_workspaces where owner_id=$1 and id=$2', [ownerA, wid]);
      await as('authenticated', ownerA, async () => assert.deepEqual(await put(3), { status: 'missing' }));
    });
    console.log(`${passed} PostgreSQL-WASM checks passed. Multi-session races and live Supabase remain separate checks.`);
  } finally { await db.close(); }
})().catch(error => { console.error('FAIL SQL checks: ' + error.message); process.exitCode = 1; });

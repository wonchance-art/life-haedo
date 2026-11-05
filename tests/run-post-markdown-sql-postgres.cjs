/* Disposable PostgreSQL only. No URL, host, account or credential input.
 * npm ci --prefix tests/sql-ci
 * node tests/run-post-markdown-sql-postgres.cjs
 * Uses local server binaries, or a disposable Docker PostgreSQL container bound
 * only to an ephemeral loopback port. Supabase Auth/Storage are local SQL stubs.
 * --mutation=downgrade|publication|envelope removes the corresponding guard in
 * memory; the unchanged regression must fail. No source file is rewritten.
 */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const pgStub = require('./helpers/supabase-pg-stub.cjs');
const Markdown = require('../assets/life/post-markdown.js');
const ROOT = path.resolve(__dirname, '..');
const FILE = 'supabase/migrations/20261105051632_life_post_markdown.sql';
const IMAGE = 'postgres:17-bookworm@sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5';
const arg = process.argv.slice(2);
if (arg.length > 1 || arg.length && !/^--mutation=(downgrade|publication|envelope)$/.test(arg[0])) throw Error('Only a named local mutation is accepted.');
const mutation = arg[0]?.split('=')[1];
const dockerEnv = { ...process.env };
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete dockerEnv[key];
const docker = (...args) => execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], { encoding: 'utf8', env: dockerEnv, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function cluster() {
  if (pgStub.findPostgres()) return pgStub.startCluster({ label: 'post-markdown' });
  docker('info', '--format', '{{.ServerVersion}}');
  const id = docker('run', '--rm', '-d', '-p', '127.0.0.1::5432', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', IMAGE);
  try {
    const port = Number(docker('port', id, '5432/tcp').split(':').at(-1));
    assert(Number.isInteger(port) && port > 0);
    const { Client } = require('./sql-ci/node_modules/pg');
    const connect = async () => { const db = new Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' }); await db.connect(); return db; };
    for (let attempt = 0; ; attempt++) {
      try { const db = await connect(); await db.end(); break; }
      catch (error) { if (attempt >= 60) throw error; await pause(250); }
    }
    return { connect, stop: async () => { docker('rm', '-f', id); } };
  } catch (error) { docker('rm', '-f', id); throw error; }
}
const read = name => fs.readFileSync(path.join(ROOT, name), 'utf8');
function migration() {
  let sql = read(FILE);
  if (mutation === 'downgrade') sql = sql.replace("old.data->>'format'='life-post-md-v1'", 'false');
  if (mutation === 'publication') {
    sql = sql.replaceAll(" if p.data->>'format'='life-post-md-v1' then raise exception using errcode='22023',message='life_blog_markdown_publication_unavailable'; end if;", '');
    sql = sql.replace('if new.active and exists(select 1 from haedo_blog_private.posts', 'if false and exists(select 1 from haedo_blog_private.posts');
  }
  if (mutation === 'envelope') sql = sql.replace(" if not haedo_blog_private.keys(j,array['format','id','revision','title','status','replaces','createdAt','updatedAt','markdown','photos','attachments','archived'],\n  array['format','id','revision','title','status','replaces','createdAt','updatedAt','markdown','photos','attachments','archived'])", ' if false');
  return sql;
}
let count = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); count++; console.log('PASS ' + label); };
async function main() {
 const pg = await cluster();
 try {
  const db = await pg.connect();
  try {
   for (const file of ['supabase/tests/blog-bootstrap.sql', 'supabase/migrations/20261017144744_life_blog_originals.sql',
    'supabase/migrations/20261101091500_life_blog_account_sync.sql', 'supabase/migrations/20261101160000_life_blog_delete_guard.sql',
    'supabase/migrations/20261102110000_life_blog_ai_authorship.sql', 'supabase/migrations/20261102120000_life_blog_public_photo_copies.sql']) await db.query(read(file));
   const owner = randomUUID(), other = randomUUID(), workspace = randomUUID(), post = randomUUID();
   const as = async (role, sub, sql, values = []) => {
    await db.query('begin');
    try {
     if (role !== 'postgres') await db.query('set local role ' + role);
     await db.query("select set_config('request.jwt.claims',$1,true)", [sub ? JSON.stringify({ sub, role }) : '{}']);
     const result = await db.query(sql, values); await db.query('commit'); return result.rows[0]?.value;
    } catch (error) { await db.query('rollback'); throw error; }
   };
   const rpc = (name, args, who = owner) => as('authenticated', who, `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as value`, args);
   const state = async () => (await db.query(`select jsonb_build_object(${['posts', 'assets', 'receipts', 'publications', 'profiles'].map(name => `'${name}',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from haedo_blog_private.${name} t)`).join(',')}) as value`)).rows[0].value;
   const acl = async () => (await db.query("select p.oid::regprocedure::text as signature,p.proacl,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('haedo_blog_private','public') order by signature")).rows;
   const error = async (task, message, label) => { await assert.rejects(task, e => e.code === '22023' && e.message === message, label); count++; console.log('PASS ' + label); };
   const legacy = { format: 'life-photo-post-v2', id: post, revision: 1, title: '익명 보존 표본', status: 'saved', replaces: null,
    createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z',
    ops: [{ insert: '한글 원문 ' }, { insert: 'AI 제안', attributes: { author: 'ai', bold: true } }, { insert: '\n' }], photos: [], attachments: [], archived: false };
   check(await rpc('life_blog_save', [workspace, post, 0, randomUUID(), legacy]), { status: 'stored', revision: 1 }, 'legacy private save before migration');
   const published = await rpc('life_blog_publish', [post, 1, randomUUID(), [], { name: '익명', intro: '' }, 0]);
   check(published.status, 'stored', 'legacy public copy before migration');
   const before = await state(), beforeAcl = await acl();
   await db.query(migration());
   check(await state(), before, 'populated migration preserves every blog row');
   const currentAcl = await acl();
   check(currentAcl.filter(p => beforeAcl.some(old => old.signature === p.signature)), beforeAcl, 'existing routine privileges and security configuration unchanged');
   const helpers = currentAcl.filter(p => !beforeAcl.some(old => old.signature === p.signature));
   check(helpers.every(p => !p.prosecdef), true, 'new helpers are invokers');
   for (const helper of helpers) {
    const grants = (await db.query("select has_function_privilege('anon',$1,'execute') as anon,has_function_privilege('authenticated',$1,'execute') as authenticated,has_function_privilege('service_role',$1,'execute') as service_role", [helper.signature])).rows[0];
    check(grants, { anon: false, authenticated: false, service_role: false }, helper.signature + ': internal execute revoked');
   }
   await db.query(migration());
   check(await state(), before, 'reapplying migration preserves populated rows');
   const doc = Markdown.fromV2(legacy).document;
   const valid = async value => (await db.query('select haedo_blog_private.valid_document($1,$2) as value', [value, post])).rows[0].value;
   check(await valid(doc), true, 'Markdown envelope accepts exact canonical source');
   check(await valid({ ...doc, privateMemo: 'never sent' }), false, 'unknown top-level fields rejected');
   check(await valid({ ...doc, ops: legacy.ops }), false, 'dual-source Markdown plus ops rejected');
   check(await valid({ ...doc, markdown: {} }), false, 'non-string source rejected');
   check(await valid({ ...doc, markdown: '본문' }), false, 'missing final newline rejected');
   check(await valid({ ...doc, markdown: '\x01\n' }), false, 'unsafe control characters rejected');
   check(await valid({ ...doc, markdown: '가'.repeat(349526) + '\n' }), false, 'UTF-8 source larger than one MiB rejected');
   check(await valid({ ...doc, markdown: 'x'.repeat(1048576) + '\n' }), false, 'ASCII source larger than one MiB rejected');
   check(await valid({ ...doc, revision: -1 }), false, 'revision bound unchanged');
   check(await valid({ ...doc, archived: 'false' }), false, 'archive type unchanged');
   check(await valid({ ...doc, id: other }), false, 'document identity bound to request');
   check(await valid({ ...doc, photos: [{ id: 'p' }] }), false, 'malformed photo metadata rejected');
   const photo = { id: 'p', name: 'private.heic', type: 'image/heic', width: 2, height: 3, size: 24, digest: 'a'.repeat(64) };
   check(await valid({ ...doc, photos: [photo] }), false, 'HEIC still requires valid JPEG view');
   photo.view = { type: 'image/jpeg', width: 2, height: 3, size: 25, digest: 'b'.repeat(64) };
   check(await valid({ ...doc, photos: [photo] }), true, 'valid original and view metadata accepted (source remains opaque to SQL)');
   check(await valid({ ...doc, photos: [photo, photo] }), false, 'duplicate photo identifiers rejected');
   check(await valid({ ...doc, attachments: [{ type: 'article', title: '첨부', creator: '', url: 'javascript:alert(1)' }] }), false, 'attachment URL policy unchanged');
   check(await valid({ ...doc, title: '', markdown: '&nbsp;\n', status: 'draft' }), true, 'empty Markdown draft accepted');
   check(await valid({ ...doc, title: '', markdown: '&nbsp;\n' }), false, 'empty saved canonical paragraph rejected');
   check(await rpc('life_blog_save', [workspace, post, 1, randomUUID(), doc]), { status: 'stored', revision: 2 }, 'legacy to Markdown private upgrade');
   check((await rpc('life_blog_read', [post])).data, doc, 'private read preserves exact Markdown source');
   const afterUpgrade = await state();
   check(await rpc('life_blog_save', [workspace, post, 1, randomUUID(), legacy]), { status: 'conflict', revision: 2 }, 'stale old client receives existing CAS conflict');
   await error(() => rpc('life_blog_save', [workspace, post, 2, randomUUID(), legacy]), 'life_blog_update_required', 'same-revision old v2 client cannot overwrite Markdown');
   const { attachments, archived, ...v1 } = legacy;
   await error(() => rpc('life_blog_save', [workspace, post, 2, randomUUID(), { ...v1, format: 'life-photo-post-v1' }]), 'life_blog_update_required', 'same-revision old v1 client cannot overwrite Markdown');
   check(await state(), afterUpgrade, 'rejected downgrades preserve source/publication/receipts');
   for (const [label, task] of [
    ['public legacy RPC', () => rpc('life_blog_publish', [post, 2, randomUUID(), [], { name: 'must rollback', intro: '' }, 1])],
    ['public copies RPC', () => rpc('life_blog_publish_copies', [post, 2, randomUUID(), ['not-a-photo'], { name: 'must rollback', intro: '' }, 1, {}])],
    ['private historical publisher', () => as('authenticated', owner, 'select haedo_blog_private.publish($1,2,$2,\'{}\',\'{"name":"must rollback","intro":""}\',1) as value', [post, randomUUID()])]
   ]) await error(task, 'life_blog_markdown_publication_unavailable', label + ' explicitly refuses Markdown');
   check(await state(), afterUpgrade, 'publication rejection changes no profile, receipt or public copy');
   // Restore historical routines without the new body checks. Table triggers
   // must still reject a same-revision downgrade and an empty public projection.
   for (const [file, name] of [
    ['supabase/migrations/20261101091500_life_blog_account_sync.sql', 'save'],
    ['supabase/migrations/20261102110000_life_blog_ai_authorship.sql', 'publish'],
    ['supabase/migrations/20261102120000_life_blog_public_photo_copies.sql', 'publish_copies']
   ]) {
    const original = read(file), start = original.indexOf('create or replace function haedo_blog_private.' + name + '(');
    assert(start >= 0); const end = original.indexOf('end $$;', start); assert(end > start);
    await db.query(original.slice(start, end + 'end $$;'.length));
   }
   await error(() => rpc('life_blog_save', [workspace, post, 2, randomUUID(), legacy]), 'life_blog_update_required', 'old save routine replay cannot bypass downgrade trigger');
   await error(() => rpc('life_blog_publish', [post, 2, randomUUID(), [], { name: 'must rollback', intro: '' }, 1]), 'life_blog_markdown_publication_unavailable', 'old copies publisher replay cannot bypass publication trigger');
   await error(() => as('authenticated', owner, 'select haedo_blog_private.publish($1,2,$2,\'{}\',\'{"name":"must rollback","intro":""}\',1) as value', [post, randomUUID()]), 'life_blog_markdown_publication_unavailable', 'old private publisher replay cannot bypass publication trigger');
   check(await state(), afterUpgrade, 'legacy routine replay attempts preserve all source, profile and receipt rows');
   await db.query(migration());
   check(await state(), afterUpgrade, 'reinstall after legacy routine replay preserves data');
   const publicCopy = await as('anon', null, 'select public.life_blog_public_read($1) as value', [published.token]);
   check(publicCopy.snapshot.ops.some(op => op.attributes?.author), false, 'previous public copy still omits AI authorship');
   check(publicCopy.snapshot.ops.map(op => op.insert).join(''), '한글 원문 AI 제안\n', 'previous public body remains readable unchanged');
   check(await rpc('life_blog_read', [post], other), null, 'another account cannot read Markdown source');
   check(await rpc('life_blog_publish', [post, 2, randomUUID(), [], { name: '', intro: '' }, 1], other), { status: 'missing' }, 'another account cannot publish owner Markdown');
   await assert.rejects(() => as('anon', null, 'select public.life_blog_read($1) as value', [post]), e => e.code === '42501'); count++; console.log('PASS anonymous private read denied');
   const withdrawn = await rpc('life_blog_unpublish', [post, 1, randomUUID()]);
   check(withdrawn.status, 'stored', 'withdrawal remains allowed after private Markdown upgrade');
   const noTitle = { ...doc, title: '', revision: 2 };
   check(await rpc('life_blog_save', [workspace, post, 2, randomUUID(), noTitle]), { status: 'stored', revision: 3 }, 'Markdown update remains allowed');
   await error(() => rpc('life_blog_publish', [post, 3, randomUUID(), [], { name: '', intro: '' }, 2]), 'life_blog_markdown_publication_unavailable', 'empty title does not disguise the Markdown publication error');
   // Existing SQL regressions use independent rolled-back fixtures.
   for (const file of ['supabase/tests/blog-ai-authorship.sql', 'supabase/tests/blog-public-copies.sql', 'supabase/tests/blog-installation.sql']) {
    const result = await db.query(read(file)); const value = [].concat(result).filter(r => r.rows?.length).at(-1).rows[0].result;
    if ('failures' in value) check(value.failures, 0, file + ': failures 0 (' + value.passed + ' assertions)');
    else check(Object.values(value).every(Boolean), true, file + ': all ' + Object.keys(value).length + ' checks');
   }
   console.log(JSON.stringify({ passed: count, failures: 0, migration: FILE, mutation: mutation || null, scope: 'disposable PostgreSQL; synthetic data only; private source schema, CAS, publication refusal and legacy preservation' }));
  } finally { await db.end(); }
 } finally { await pg.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

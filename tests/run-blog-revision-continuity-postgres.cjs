/* A deleted post's revisions are never handed out again (2026-11-12, account sync review B1, ABA).
 * Disposable local PostgreSQL only; no endpoint, account or credential options. Absence of
 * PostgreSQL is a failure, never a SKIP.
 *   node tests/run-blog-revision-continuity-postgres.cjs            (after npm ci --prefix tests/sql-ci)
 *   node tests/run-blog-revision-continuity-postgres.cjs --mutation=<name>   must FAIL (guard check)
 * CI also runs the same contract through tests/run-sql-replay-postgres.cjs (step 4.9), on a copy
 * with every migration replayed.
 *
 * supabase/migrations/20261112120000_life_blog_revision_continuity.sql records the highest
 * revision of every deleted identity (trigger) and stores a post created again under that
 * identity after it (save_post behind public.life_blog_save). This file fixes: the earlier
 * behaviour (re-created at revision 1), the installation (no row changes, other routines and
 * privileges unchanged, idempotent, refuses drifted predecessors), continuation over repeated
 * deletions, the device that still holds an old revision (conflict, never an overwrite), receipt
 * replay, a lost answer retried after a deletion, a late publication request, the published-post
 * deletion refusal, photos, Markdown, other owners, the backstop trigger, privileges and a
 * deletion racing a re-creation on two connections. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { startCluster } = require('./helpers/supabase-pg-stub.cjs');
const ROOT = path.resolve(__dirname, '..');
const FILE = 'supabase/migrations/20261112120000_life_blog_revision_continuity.sql';
const BEFORE = ['supabase/tests/blog-bootstrap.sql', 'supabase/migrations/20261017144744_life_blog_originals.sql',
  'supabase/migrations/20261101091500_life_blog_account_sync.sql', 'supabase/migrations/20261101160000_life_blog_delete_guard.sql',
  'supabase/migrations/20261102110000_life_blog_ai_authorship.sql', 'supabase/migrations/20261102120000_life_blog_public_photo_copies.sql',
  'supabase/migrations/20261105051632_life_post_markdown.sql'];
const LATER = ['supabase/migrations/20261105081055_life_post_markdown_publish.sql', 'supabase/migrations/20261111120000_life_blog_withdraw_before_publication.sql'];
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const MUTATIONS = {
  // A re-created post starts at revision 1 again (the earlier rule); the backstop then refuses it.
  'restart-at-one': sql => sql.replace('rev:=coalesce(retired,0)+1;', 'rev:=1;'),
  // Deletions are not recorded.
  // (Each trigger mutation also lowers the installation's own trigger count, so the contract has to find it.)
  'no-record': sql => sql.replace("execute 'create trigger blog_retire_post_revision after delete on haedo_blog_private.posts for each row execute function haedo_blog_private.retire_post_revision()';\n", '').replace("tgenabled='O')<>2", "tgenabled='O')<>1"),
  // No backstop for a path that still uses the earlier save.
  'no-guard': sql => sql.replace("execute 'create trigger blog_retired_revision_guard before insert on haedo_blog_private.posts for each row execute function haedo_blog_private.retired_revision_guard()';\n", '').replace("tgenabled='O')<>2", "tgenabled='O')<>1"),
  // The retired revision of another owner's identity is used.
  'any-owner': sql => sql.replace('where t.owner_id=who and t.post_id=p_post_id;', 'where t.post_id=p_post_id;'),
  // The wrapper keeps calling the earlier save.
  'old-wrapper': sql => sql.replace('$fn$select haedo_blog_private.save_post(', '$fn$select haedo_blog_private.save(').replace(/983ed6402056f10522ce2f7adba06bcf/g, '525b3f80d22992179296eea2df0e26fe'),
  // The new routine is callable by anonymous callers.
  'grant-anon': sql => sql.replace("to authenticated';\n -- CREATE OR REPLACE", "to authenticated,anon';\n -- CREATE OR REPLACE").replace("or has_function_privilege('anon','haedo_blog_private.save_post(uuid,uuid,bigint,uuid,jsonb)','execute')\n", ''),
  // The retired table is readable through the API roles.
  'grant-table': sql => sql.replace("execute 'revoke all on table haedo_blog_private.retired_posts from public,anon,authenticated,service_role';", "execute 'grant select on table haedo_blog_private.retired_posts to authenticated';"),
  // The guard also refuses an update of a re-created post (any row of a retired identity).
  'guard-any-row': sql => sql.replace('and r.revision>=new.revision) then', ') then'),
  // The recreation does not take the post's advisory lock.
  'no-lock': sql => sql.replace(" perform pg_advisory_xact_lock(hashtextextended('blog:'||who::text||':'||p_post_id::text,0));\n", ''),
  // The drifted-predecessor check is gone.
  'no-precheck': sql => sql.replace("raise exception 'haedo_blog_private.save differs from the repository definition (20261101091500); nothing was changed';", 'null;'),
};
const direct = require.main === module, mutation = direct ? process.argv[2]?.replace(/^--mutation=/, '') : undefined;
if (direct && (process.argv.length > 3 || mutation && !Object.hasOwn(MUTATIONS, mutation))) throw Error('Only named local guard mutations are accepted: ' + Object.keys(MUTATIONS).join(', '));
function installation() {
  const sql = read(FILE); if (!mutation) return sql;
  const changed = MUTATIONS[mutation](sql); assert.notEqual(changed, sql, 'named mutation must change the migration'); return changed;
}
let passed = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); passed++; console.log('PASS ' + label); };
const refused = async (promise, test, label) => { await assert.rejects(promise, test, label); passed++; console.log('PASS ' + label); };

/* contract(db): the whole contract.
 * - installed:false (this file run directly): db holds the blog migrations before this one; the
 *   earlier behaviour is recorded first and the installation itself is checked.
 * - installed:true (tests/run-sql-replay-postgres.cjs, a copy with every migration replayed):
 *   the earlier-behaviour checks are skipped and the file is applied again on top (idempotent).
 * - connect(): another connection to the same database (the two-connection case). */
async function contract(db, { installed = false, connect } = {}) {
  passed = 0;
  await db.query(`create table if not exists auth.users(id uuid primary key);
    alter table auth.users add column if not exists is_anonymous boolean not null default false;
    create table if not exists auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,not_after timestamptz);
    create or replace function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;`);
  if (!installed) for (const file of LATER) await db.query(read(file));
  const owner = randomUUID(), other = randomUUID(), sid = randomUUID(), workspace = randomUUID();
  await db.query('insert into auth.users(id) values($1),($2)', [owner, other]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [sid, owner]);
  const claim = async (client, role, who) => {
    if (role !== 'postgres') await client.query('set local role ' + role);
    await client.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claim.role',$3,true)", [JSON.stringify({ role, sub: who, session_id: sid }), who || '', role]);
  };
  const as = async (role, who, sql, values = []) => {
    await db.query('begin');
    try { await claim(db, role, who); const result = await db.query(sql, values); await db.query('commit'); return result.rows[0]?.value; }
    catch (error) { await db.query('rollback'); throw error; }
  };
  const rpc = (name, args, { role = 'authenticated', who = owner, schema = 'public' } = {}) => as(role, who, `select ${schema}.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) value`, args);
  const at = '2026-11-12T00:00:00.000Z';
  const v2 = (id, title, status = 'draft', body = '익명 본문') => ({ format: 'life-photo-post-v2', id, revision: 1, status, title, ops: [{ insert: body + '\n' }], photos: [], attachments: [], archived: false, replaces: null, createdAt: at, updatedAt: at });
  const md = (id, title) => ({ format: 'life-post-md-v1', id, revision: 1, title, status: 'saved', replaces: null, createdAt: at, updatedAt: at, markdown: '익명 본문\n', photos: [], attachments: [], archived: false });
  const save = (doc, expected = 0, { who = owner, operation = randomUUID() } = {}) => rpc('life_blog_save', [workspace, doc.id, expected, operation, doc], { who });
  const remove = (id, expected, who = owner) => rpc('life_blog_delete', [id, expected], { who });
  const head = async (id, who = owner) => (await rpc('life_blog_sync_list', [], { who })).find(row => row.id === id) || null;
  const body = async (id, who = owner) => (await rpc('life_blog_read', [id], { who }))?.data.ops[0].insert ?? null;
  const retired = async (id, who = owner) => (await db.query('select to_jsonb(t) value from haedo_blog_private.retired_posts t where owner_id=$1 and post_id=$2', [who, id])).rows[0]?.value || null;
  const retiredRevision = async (id, who = owner) => { const row = await retired(id, who); return row ? Number(row.revision) : null; };
  const tables = ['posts', 'assets', 'receipts', 'publications', 'profiles'];
  const rows = async () => {
    const value = (await db.query(`select jsonb_build_object(${tables.map(name => `'${name}',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from haedo_blog_private.${name} t)`).join(',')}) value`)).rows[0].value;
    const exists = (await db.query("select to_regclass('haedo_blog_private.retired_posts') is not null value")).rows[0].value;
    value.retired_posts = exists ? (await db.query("select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') value from haedo_blog_private.retired_posts t")).rows[0].value : null;
    return value;
  };
  const CHANGED = ['public.life_blog_save(uuid,uuid,bigint,uuid,jsonb)'];
  const ADDED = ['haedo_blog_private.retire_post_revision()', 'haedo_blog_private.retired_revision_guard()', 'haedo_blog_private.save_post(uuid,uuid,bigint,uuid,jsonb)'];
  // regprocedure text is schema-qualified only for schemas outside the search_path.
  const qualified = async (sql, values) => { await db.query('begin'); try { await db.query('set local search_path=pg_catalog'); return (await db.query(sql, values)).rows; } finally { await db.query('commit'); } };
  const catalog = async () => (await qualified(`select p.oid::regprocedure::text name,p.proacl::text acl,p.prosecdef definer,p.proconfig::text config,p.proowner::regrole::text owner,
      case when p.oid::regprocedure::text = any($1) then null else pg_get_functiondef(p.oid) end definition
      from pg_proc p where p.pronamespace in ('public'::regnamespace,'haedo_blog_private'::regnamespace) order by 1`, [CHANGED]));
  const triggers = async () => (await db.query("select tgname::text name,pg_get_triggerdef(oid) def from pg_trigger where tgrelid='haedo_blog_private.posts'::regclass and not tgisinternal order by 1")).rows;
  const wrapper = async () => (await db.query("select prosrc value from pg_proc where oid='public.life_blog_save(uuid,uuid,bigint,uuid,jsonb)'::regprocedure")).rows[0].value;

  // ---- The earlier behaviour (before this file is installed) ----
  if (!installed) {
    const early = v2(randomUUID(), '설치 전 지운 초안');
    check(await save(early), { status: 'stored', revision: 1 }, 'before: a draft is stored at revision 1');
    check((await remove(early.id, 1)).status, 'deleted', 'before: it is deleted');
    check(await save(v2(early.id, '설치 전 다시 만든 초안', 'draft', '옛 앱이 다시 만든 문장')), { status: 'stored', revision: 1 }, 'before: the same identity is created again at revision 1, the revision a device that missed the deletion still holds');
    check(await save(v2(early.id, '그 기기가 이어 쓴 초안'), 1), { status: 'stored', revision: 2 }, 'before: that device\'s save at revision 1 overwrites the re-created text without a conflict');
    // A first publication request sent for the deleted revision 1 and answered late.
    const late = v2(randomUUID(), '설치 전 게시 요청 글', 'saved'); await save(late); await remove(late.id, 1);
    await save(v2(late.id, '설치 전 다시 만든 글', 'saved', '공개를 고른 적 없는 문장'));
    check((await rpc('life_blog_publish', [late.id, 1, randomUUID(), [], { name: '익명', intro: '' }, 0])).status, 'stored', 'before: a late publication request for the deleted revision 1 publishes the re-created text');
    await rpc('life_blog_unpublish', [late.id, 1, randomUUID()]);
  }

  // ---- Installing ----
  const kept = v2(randomUUID(), '설치 전부터 있던 글', 'saved'); await save(kept); await save({ ...kept, title: '설치 전부터 있던 글 (고침)' }, 1);
  const beforeRows = await rows(), beforeCatalog = await catalog(), beforeTriggers = await triggers();
  if (!installed) { check(beforeRows.retired_posts, null, 'before: there is no retired table'); check(await wrapper(), 'select haedo_blog_private.save(p_workspace_id,p_post_id,p_expected_revision,p_operation_id,p_data)', 'before: the wrapper calls the earlier save'); }
  await db.query(installation());
  const afterRows = await rows(), afterCatalog = await catalog();
  check(installed ? afterRows : { ...afterRows, retired_posts: null }, beforeRows, 'installing changes no blog row');
  if (!installed) check(afterRows.retired_posts, [], 'installing records nothing in the new table');
  const keep = list => list.filter(row => !ADDED.includes(row.name));
  check(keep(afterCatalog), keep(beforeCatalog), 'every other routine keeps its definition, privileges, SECURITY DEFINER, search_path and owner; the wrapper keeps its privileges');
  if (!installed) check(afterCatalog.filter(row => ADDED.includes(row.name)).map(row => row.name), ADDED, 'three routines are added');
  check(await wrapper(), 'select haedo_blog_private.save_post(p_workspace_id,p_post_id,p_expected_revision,p_operation_id,p_data)', 'the wrapper calls save_post');
  check((await triggers()).map(row => row.name), [...new Set([...beforeTriggers.map(row => row.name), 'blog_retire_post_revision', 'blog_retired_revision_guard'])].sort(), 'two triggers are added to posts; the earlier ones stay');
  const once = { rows: await rows(), catalog: await db.query("select p.oid::regprocedure::text name,pg_get_functiondef(p.oid) d,p.proacl::text acl from pg_proc p where p.pronamespace in ('public'::regnamespace,'haedo_blog_private'::regnamespace) order by 1").then(r => r.rows), triggers: await triggers() };
  await db.query(installation());
  check({ rows: await rows(), catalog: await db.query("select p.oid::regprocedure::text name,pg_get_functiondef(p.oid) d,p.proacl::text acl from pg_proc p where p.pronamespace in ('public'::regnamespace,'haedo_blog_private'::regnamespace) order by 1").then(r => r.rows), triggers: await triggers() }, once, 'installing it again changes nothing');
  for (const [role, expected] of [['anon', false], ['authenticated', true], ['service_role', false]]) {
    check((await db.query("select has_function_privilege($1,'public.life_blog_save(uuid,uuid,bigint,uuid,jsonb)','execute') value", [role])).rows[0].value, expected, role + (expected ? ' may' : ' may not') + ' call the save wrapper');
    check((await db.query("select has_function_privilege($1,'haedo_blog_private.save_post(uuid,uuid,bigint,uuid,jsonb)','execute') value", [role])).rows[0].value, expected, role + (expected ? ' may' : ' may not') + ' execute save_post (through the invoker wrapper)');
    check((await db.query("select has_table_privilege($1,'haedo_blog_private.retired_posts','select') or has_table_privilege($1,'haedo_blog_private.retired_posts','insert') or has_table_privilege($1,'haedo_blog_private.retired_posts','update') or has_table_privilege($1,'haedo_blog_private.retired_posts','delete') value", [role])).rows[0].value, false, role + ' has no privilege on the retired table');
  }
  check((await db.query("select relrowsecurity value from pg_class where oid='haedo_blog_private.retired_posts'::regclass")).rows[0].value, true, 'row level security is on for the retired table');
  check((await db.query("select array_agg(attname::text order by attnum) value from pg_attribute where attrelid='haedo_blog_private.retired_posts'::regclass and attnum>0 and not attisdropped")).rows[0].value, ['owner_id', 'post_id', 'revision', 'retired_at'], 'the retired table holds identifiers, a revision and a time: no title, body, photo or workspace');
  check((await save({ ...kept, title: '설치 뒤 이어 쓴 글' }, 2)).revision, 3, 'a post stored before the installation goes on as before');

  // ---- A deleted identity created again continues after its last revision ----
  const draft = v2(randomUUID(), '지울 초안', 'draft', '첫 문장');
  check(await save(draft), { status: 'stored', revision: 1 }, 'a new identity still starts at revision 1');
  check(await save({ ...draft, title: '지울 초안 (고침)' }, 1), { status: 'stored', revision: 2 }, 'and grows by one');
  check(await retired(draft.id), null, 'nothing is retired while the post exists');
  const deleted = await remove(draft.id, 2);
  check([deleted.status, deleted.revision], ['deleted', 2], 'the post is deleted at revision 2');
  check(await retiredRevision(draft.id), 2, 'its highest revision is recorded');
  check(Object.keys(await retired(draft.id)).sort(), ['owner_id', 'post_id', 'retired_at', 'revision'], 'and nothing else');
  check(await head(draft.id), null, 'the deleted identity is not listed');
  check(await save(v2(draft.id, '지운 뒤 다시 만든 초안', 'draft', '옛 앱이 다시 만든 문장'), 1), { status: 'missing' }, 'a save at an old revision of a deleted post still answers missing');
  const recreate = randomUUID(), recreated = v2(draft.id, '지운 뒤 다시 만든 초안', 'draft', '옛 앱이 다시 만든 문장');
  check(await save(recreated, 0, { operation: recreate }), { status: 'stored', revision: 3 }, 'created again with expected revision 0: stored at revision 3, after the deleted revisions');
  check([(await head(draft.id)).revision, await body(draft.id)], [3, '옛 앱이 다시 만든 문장\n'], 'the list and the read show revision 3 and the new text');
  // A device that missed the deletion holds revision 1 or 2 of it.
  for (const stale of [2, 1]) check(await save(v2(draft.id, '놓친 기기의 초안', 'draft', '놓친 기기가 쓴 문장'), stale), { status: 'conflict', revision: 3 }, `a device holding revision ${stale} gets a conflict, not an overwrite`);
  check(await body(draft.id), '옛 앱이 다시 만든 문장\n', 'the re-created text is still there');
  check(await save(recreated, 0, { operation: recreate }), { status: 'stored', revision: 3 }, 'the same operation again returns its receipt');
  check((await db.query('select count(*)::int value from haedo_blog_private.receipts where post_id=$1 and operation_id=$2', [draft.id, recreate])).rows[0].value, 1, 'one receipt for it');
  await refused(save({ ...recreated, title: '바뀐 요청' }, 0, { operation: recreate }), error => error.message === 'life_operation_mismatch', 'the same operation with another document is a mismatch');
  check(await save({ ...recreated, title: '다시 만든 초안을 이어 씀' }, 3), { status: 'stored', revision: 4 }, 'the re-created post is edited as usual');
  check(await remove(draft.id, 3), { status: 'conflict', revision: 4 }, 'a stale deletion is a conflict');
  check(await retiredRevision(draft.id), 2, 'and records nothing');
  check((await remove(draft.id, 4)).status, 'deleted', 'deleted again at revision 4');
  check(await retiredRevision(draft.id), 4, 'the recorded revision moves up');
  check(await save(v2(draft.id, '세 번째 초안')), { status: 'stored', revision: 5 }, 'created a third time at revision 5');
  check((await remove(draft.id, null)).status, 'deleted', 'an unconditional deletion records it too');
  check(await retiredRevision(draft.id), 5, 'at revision 5');
  check((await remove(draft.id, null)).status, 'missing', 'deleting a missing identity changes nothing');
  check(await retiredRevision(draft.id), 5, 'and keeps the recorded revision');
  check(await save(v2(draft.id, '네 번째 저장 글', 'saved')), { status: 'stored', revision: 6 }, 'a saved post created again continues as well');

  // ---- An answer lost before another device deleted the post (a new app retrying its request) ----
  const lost = v2(randomUUID(), '응답을 잃은 첫 저장'), lostOp = randomUUID();
  check(await save(lost, 0, { operation: lostOp }), { status: 'stored', revision: 1 }, 'a first save is applied; its answer is lost');
  check((await remove(lost.id, 1)).status, 'deleted', 'another device deletes it (its receipts go with it)');
  check(await save(lost, 0, { operation: lostOp }), { status: 'stored', revision: 2 }, 'the retried request is stored at revision 2, never at the deleted revision 1');

  // ---- A late publication request of the deleted revision ----
  const pub = v2(randomUUID(), '게시 요청을 보낸 글', 'saved');
  await save(pub);
  check((await remove(pub.id, 1)).status, 'deleted', 'a never-public post with an unanswered publication request is deleted');
  check((await save(v2(pub.id, '다시 만든 글', 'saved', '공개를 고른 적 없는 문장'))).revision, 2, 'created again at revision 2');
  check(await rpc('life_blog_publish', [pub.id, 1, randomUUID(), [], { name: '익명', intro: '' }, 0]), { status: 'conflict', revision: 2 }, 'the late request for revision 1 ends in conflict: nothing is published');
  check((await db.query('select count(*)::int value from haedo_blog_private.publications where post_id=$1', [pub.id])).rows[0].value, 0, 'no publication row');

  // ---- A published post is still never deleted ----
  const open = v2(randomUUID(), '공개 중인 글', 'saved'); await save(open);
  const published = await rpc('life_blog_publish', [open.id, 1, randomUUID(), [], { name: '익명', intro: '' }, 0]);
  check(published.status, 'stored', 'a post is published');
  check(await remove(open.id, 1), { status: 'published', revision: 1 }, 'its deletion is refused as before');
  check(await retired(open.id), null, 'and records nothing');
  check((await rpc('life_blog_public_read', [published.token], { role: 'anon', who: null })).revision, 1, 'the public copy still answers');
  check((await rpc('life_blog_unpublish', [open.id, 1, randomUUID()])).status, 'stored', 'withdrawn first');
  check((await remove(open.id, 1)).status, 'deleted', 'then deleted');
  check(await retiredRevision(open.id), 1, 'at revision 1');
  check(await save(v2(open.id, '공개했다 지운 글', 'saved')), { status: 'stored', revision: 2 }, 'created again at revision 2');
  check(await rpc('life_blog_public_read', [published.token], { role: 'anon', who: null }), null, 'the earlier public address stays gone');
  check((await rpc('life_blog_read', [open.id])).publication, null, 'and the re-created post has no publication');

  // ---- Markdown and photos ----
  const mark = md(randomUUID(), 'Markdown 글'); await save(mark);
  await remove(mark.id, 1);
  check(await save({ ...mark, title: 'Markdown 글 (다시)' }), { status: 'stored', revision: 2 }, 'a Markdown post created again continues the same way');
  const photoPost = { ...v2(randomUUID(), '사진 글', 'saved'), photos: [{ id: 'p1', name: '익명.png', type: 'image/png', width: 1, height: 1, size: 10, digest: 'a'.repeat(64) }] };
  photoPost.ops = [{ insert: '사진 본문\n' }, { insert: { photo: { id: 'p1', caption: '', alt: '' } } }, { insert: '\n' }];
  const prepared = await rpc('life_blog_prepare_asset', [photoPost.id, 'p1', 'a'.repeat(64), 10, 'image/png', 1, 1]);
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('haedo-blog-originals',$1,'{\"size\":\"10\",\"mimetype\":\"image/png\"}')", [prepared.path]);
  check(await save(photoPost), { status: 'stored', revision: 1 }, 'a post with a photo is stored');
  const gone = await remove(photoPost.id, 1);
  check([gone.status, gone.paths], ['deleted', [prepared.path]], 'deleted: its original becomes removable');
  await rpc('life_blog_prepare_asset', [photoPost.id, 'p1', 'a'.repeat(64), 10, 'image/png', 1, 1]);
  check(await save(photoPost), { status: 'stored', revision: 2 }, 'created again with the same original (prepared again) at revision 2');

  // ---- Other owners ----
  check(await save(v2(draft.id, '다른 계정의 같은 식별자'), 0, { who: other }), { status: 'stored', revision: 1 }, 'another owner\'s identity is independent: revision 1');
  check(await retired(draft.id, other), null, 'and has nothing retired');
  check((await remove(draft.id, 1, other)).status, 'deleted', 'that owner deletes it');
  check([await retiredRevision(draft.id, other), await retiredRevision(draft.id)], [1, 5], 'each owner\'s identity keeps its own revision');
  check(await head(draft.id, other), null, 'the first owner\'s post is not the other owner\'s');

  // ---- The backstop and privileges ----
  const back = v2(randomUUID(), '이전 저장 경로'); await save(back); await remove(back.id, 1);
  await refused(rpc('save', [workspace, back.id, 0, randomUUID(), v2(back.id, '이전 저장 경로로 다시 만듦')], { schema: 'haedo_blog_private' }),
    error => error.code === '22023' && error.message === 'life_blog_revision_retired', 'the earlier save cannot create a deleted identity again at revision 1');
  check(await head(back.id), null, 'nothing was stored');
  await refused(as('postgres', null, `insert into haedo_blog_private.posts(owner_id,id,workspace_id,revision,data) values($1,$2,$3,1,'{}')`, [owner, back.id, workspace]),
    error => error.message === 'life_blog_revision_retired', 'no path inserts a row at or below a retired revision');
  check((await save(v2(back.id, '새 경로로 다시 만듦'))).revision, 2, 'the current path stores it after the retired revision');
  await refused(save(v2(randomUUID(), '익명 요청'), 0, { who: null }), error => error.code === '42501', 'an anonymous caller cannot save');
  await refused(as('anon', null, 'select public.life_blog_save($1,$2,0,$3,$4) value', [workspace, randomUUID(), randomUUID(), v2(randomUUID(), 'x')]), error => error.code === '42501', 'the anon role cannot call the wrapper');
  await refused(as('anon', null, 'select haedo_blog_private.save_post($1,$2,0,$3,$4) value', [workspace, randomUUID(), randomUUID(), v2(randomUUID(), 'x')]), error => error.code === '42501', 'nor save_post');
  await refused(as('authenticated', owner, 'select count(*) value from haedo_blog_private.retired_posts'), error => error.code === '42501', 'the owner cannot read the retired table directly');

  // ---- Two connections: a deletion and a re-creation of the same identity ----
  // Connection 1 deletes and keeps its transaction open. Connection 2 then sends the re-creation
  // (expected 0). Both take the post's advisory lock first, so connection 2 waits for exactly that
  // lock and, once connection 1 commits, sees the recorded revision. Nothing depends on timing.
  assert.equal(typeof connect, 'function', 'a second connection is required');
  const raced = v2(randomUUID(), '동시에 지우고 다시 만든 글'); await save(raced); await save({ ...raced, title: '동시에 (고침)' }, 1);
  const holder = await connect(), sender = await connect();
  try {
    const open = async client => { await client.query('begin'); await claim(client, 'authenticated', owner); };
    await open(holder);
    check((await holder.query('select public.life_blog_delete($1,$2) value', [raced.id, 2])).rows[0].value.status, 'deleted', 'connection 1 deletes inside an open transaction');
    await open(sender);
    const pid = (await sender.query('select pg_backend_pid() pid')).rows[0].pid;
    const sending = sender.query('select public.life_blog_save($1,$2,0,$3,$4) value', [workspace, raced.id, randomUUID(), v2(raced.id, '동시에 다시 만듦')]).then(result => result.rows[0].value, error => ({ error: error.code + ' ' + error.message }));
    let waiting = null;
    for (let i = 0; i < 400 && !waiting; i++) {
      const row = (await db.query("select wait_event_type as type,wait_event as event from pg_stat_activity where pid=$1 and state='active' and wait_event_type='Lock'", [pid])).rows[0];
      if (row) waiting = row; else if (await Promise.race([sending.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 25))])) break;
    }
    check(waiting, { type: 'Lock', event: 'advisory' }, 'connection 2 (re-creation, expected 0) waits for the post\'s advisory lock');
    await holder.query('commit');
    check(await sending, { status: 'stored', revision: 3 }, 'and is stored at revision 3 once the deletion is committed');
    await sender.query('commit');
  } finally {
    for (const client of [holder, sender]) { await client.query('rollback').catch(() => {}); await client.end().catch(() => {}); }
  }

  // ---- A drifted predecessor stops the installation unchanged ----
  if (!installed) {
    const stopped = await rows();
    const original = (await db.query("select pg_get_functiondef('haedo_blog_private.save(uuid,uuid,bigint,uuid,jsonb)'::regprocedure) value")).rows[0].value;
    await db.query(original.replace('\nbegin\n', '\nbegin\n -- drifted copy\n'));
    await refused(db.query(installation()), /haedo_blog_private\.save differs from the repository definition/, 'a save whose body differs from the repository stops the installation');
    await db.query(original);
    await db.query("create or replace function public.life_blog_save(p_workspace_id uuid,p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_data jsonb) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_blog_private.save(p_workspace_id,p_post_id,p_expected_revision,p_operation_id,p_data)||'{}'$$");
    await refused(db.query(installation()), /public\.life_blog_save differs from the repository definition/, 'a wrapper that differs from both known bodies stops it');
    check(await wrapper(), "select haedo_blog_private.save(p_workspace_id,p_post_id,p_expected_revision,p_operation_id,p_data)||'{}'", 'and nothing was changed');
    check(await rows(), stopped, 'no row changed');
    await db.query("create or replace function public.life_blog_save(p_workspace_id uuid,p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_data jsonb) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_blog_private.save(p_workspace_id,p_post_id,p_expected_revision,p_operation_id,p_data)$$");
    await db.query(installation());
    check(await wrapper(), 'select haedo_blog_private.save_post(p_workspace_id,p_post_id,p_expected_revision,p_operation_id,p_data)', 'the reviewed earlier wrapper is replaced again');
  }
  return passed;
}
async function main() {
  const pg = await startCluster({ label: 'blog-revision-continuity' }), db = await pg.connect();
  try {
    for (const file of BEFORE) await db.query(read(file));
    const count = await contract(db, { connect: () => pg.connect() });
    console.log(`PASS revision continuity SQL contract: ${count} checks; PostgreSQL ${(await db.query('show server_version')).rows[0].server_version}`);
  } finally { await db.end(); await pg.stop(); }
}
if (direct) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
module.exports = { contract, FILE };

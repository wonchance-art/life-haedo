/* Withdrawal before any publication (2026-11-11, review R2-M1). Disposable local PostgreSQL only;
 * no endpoint, account or credential options. Absence of PostgreSQL is a failure, never a SKIP.
 *   node tests/run-blog-unpublish-postgres.cjs            (after npm ci --prefix tests/sql-ci)
 *   node tests/run-blog-unpublish-postgres.cjs --mutation=<name>   must FAIL (guard check)
 * CI runs the same contract through tests/run-sql-replay-postgres.cjs (step 4.8), on a copy
 * with every migration replayed.
 *
 * supabase/migrations/20261111120000_life_blog_withdraw_before_publication.sql makes a
 * withdrawal with expected publication revision 0 record a withdrawn row at revision 1, so
 * that a first publication request sent earlier (expected revision 0) can no longer be
 * applied. This file fixes that and everything the new row touches: every publish path,
 * the owner's reads, anonymous reads, deletion, receipts, privileges and other owners. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { startCluster } = require('./helpers/supabase-pg-stub.cjs');
const ROOT = path.resolve(__dirname, '..');
const FILE = 'supabase/migrations/20261111120000_life_blog_withdraw_before_publication.sql';
const BEFORE = ['supabase/tests/blog-bootstrap.sql', 'supabase/migrations/20261017144744_life_blog_originals.sql',
  'supabase/migrations/20261101091500_life_blog_account_sync.sql', 'supabase/migrations/20261101160000_life_blog_delete_guard.sql',
  'supabase/migrations/20261102110000_life_blog_ai_authorship.sql', 'supabase/migrations/20261102120000_life_blog_public_photo_copies.sql',
  'supabase/migrations/20261105051632_life_post_markdown.sql'];
const MARKDOWN_PUBLISH = 'supabase/migrations/20261105081055_life_post_markdown_publish.sql';
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const MUTATIONS = {
  // The withdrawal answers "stored" but records no row: nothing moved for a late publication.
  'no-row': sql => sql.replace("  insert into haedo_blog_private.publications(owner_id,post_id,token,revision,source_revision,active,snapshot,media)\n  values(who,p_post_id,gen_random_uuid(),1,source_revision,false,null,null);\n", ''),
  // The recorded row is active: a withdrawal would publish an (empty) copy.
  'active-row': sql => sql.replace("values(who,p_post_id,gen_random_uuid(),1,source_revision,false,null,null);", "values(who,p_post_id,gen_random_uuid(),1,source_revision,true,'{\"photos\":[]}'::jsonb,'{}'::jsonb);"),
  // Withdrawing an existing row no longer moves its revision.
  'no-revision': sql => sql.replace('set active=false,snapshot=null,media=null,revision=revision+1,updated_at=clock_timestamp()', 'set active=false,snapshot=null,media=null,updated_at=clock_timestamp()'),
  // The earlier definition's answer for an unpublished post.
  'missing-as-before': sql => sql.replace("if p_expected_revision<>0 then return '{\"status\":\"missing\"}'::jsonb; end if;", "return '{\"status\":\"missing\"}'::jsonb;"),
  // The profile added for the new row replaces an existing name and intro.
  'blank-profile': sql => sql.replace('insert into haedo_blog_private.profiles(owner_id) values(who) on conflict(owner_id) do nothing;', "insert into haedo_blog_private.profiles(owner_id) values(who) on conflict(owner_id) do update set author='{\"name\":\"\",\"intro\":\"\"}'::jsonb;"),
  // Another owner's post gets a row.
  'any-owner': sql => sql.replace('select revision into source_revision from haedo_blog_private.posts where owner_id=who and id=p_post_id for update;', 'select revision into source_revision from haedo_blog_private.posts where id=p_post_id for update;'),
};
const direct = require.main === module, mutation = direct ? process.argv[2]?.replace(/^--mutation=/, '') : undefined;
if (direct && (process.argv.length > 3 || mutation && !Object.hasOwn(MUTATIONS, mutation))) throw Error('Only named local guard mutations are accepted: ' + Object.keys(MUTATIONS).join(', '));
function installation() {
  const sql = read(FILE); if (!mutation) return sql;
  const changed = MUTATIONS[mutation](sql); assert.notEqual(changed, sql, 'named mutation must change the migration'); return changed;
}
let passed = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); passed++; console.log('PASS ' + label); };

/* contract(db): the whole contract on one connection.
 * - installed:false (this file run directly): db holds the blog migrations before this one; the
 *   earlier answers are recorded first and the installation itself is checked.
 * - installed:true (tests/run-sql-replay-postgres.cjs, a copy with every migration replayed):
 *   the earlier-definition and replacement checks are skipped; everything else is the same. */
async function contract(db, { installed = false } = {}) {
  passed = 0;
  {
    await db.query(`create table if not exists auth.users(id uuid primary key);
      alter table auth.users add column if not exists is_anonymous boolean not null default false;
      create table if not exists auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,not_after timestamptz);
      create or replace function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;`);
    if (!installed) await db.query(read(MARKDOWN_PUBLISH));
    const owner = randomUUID(), other = randomUUID(), sid = randomUUID(), workspace = randomUUID();
    await db.query('insert into auth.users(id) values($1),($2)', [owner, other]);
    await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [sid, owner]);
    const as = async (role, who, sql, values = []) => {
      await db.query('begin');
      try {
        if (role !== 'postgres') await db.query('set local role ' + role);
        await db.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claim.role',$3,true)", [JSON.stringify({ role, sub: who, session_id: sid }), who || '', role]);
        const result = await db.query(sql, values); await db.query('commit'); return result.rows[0]?.value;
      } catch (error) { await db.query('rollback'); throw error; }
    };
    const rpc = (name, args, { role = 'authenticated', who = owner } = {}) => as(role, who, `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) value`, args);
    const at = '2026-11-11T00:00:00.000Z';
    const v2 = (id, title) => ({ format: 'life-photo-post-v2', id, revision: 1, status: 'saved', title, ops: [{ insert: '익명 본문\n' }], photos: [], attachments: [], archived: false, replaces: null, createdAt: at, updatedAt: at });
    const md = (id, title) => ({ format: 'life-post-md-v1', id, revision: 1, title, status: 'saved', replaces: null, createdAt: at, updatedAt: at, markdown: '익명 본문\n', photos: [], attachments: [], archived: false });
    const save = async (doc, who = owner, expected = 0) => rpc('life_blog_save', [workspace, doc.id, expected, randomUUID(), doc], { who });
    const rows = async () => (await db.query(`select jsonb_build_object(${['posts', 'assets', 'receipts', 'publications', 'profiles'].map(name => `'${name}',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from haedo_blog_private.${name} t)`).join(',')}) value`)).rows[0].value;
    const publication = async id => (await db.query('select token,revision,active,snapshot,media,source_revision from haedo_blog_private.publications where post_id=$1', [id])).rows[0] || null;
    const profile = async who => (await db.query('select token,author from haedo_blog_private.profiles where owner_id=$1', [who])).rows[0] || null;
    const definition = async () => (await db.query("select pg_get_functiondef('haedo_blog_private.unpublish(uuid,bigint,uuid)'::regprocedure) value")).rows[0].value;
    const catalog = async () => (await db.query(`select p.oid::regprocedure::text name,p.proacl::text acl,p.prosecdef definer,p.proconfig::text config,p.proowner::regrole::text owner,
      case when p.oid='haedo_blog_private.unpublish(uuid,bigint,uuid)'::regprocedure then null else pg_get_functiondef(p.oid) end definition
      from pg_proc p where p.pronamespace in ('public'::regnamespace,'haedo_blog_private'::regnamespace) order by 1`)).rows;
    const publish = (id, expectedPublic, { revision = 1, operation = randomUUID(), author = { name: '익명', intro: '' }, who = owner } = {}) =>
      rpc('life_blog_publish', [id, revision, operation, [], author, expectedPublic], { who });
    const withdraw = (id, expected, { operation = randomUUID(), who = owner, role = 'authenticated' } = {}) => rpc('life_blog_unpublish', [id, expected, operation], { who, role });

    // ---- The earlier definition (the state before this file is installed) ----
    const first = v2(randomUUID(), '철회 전 게시 요청 글'); check((await save(first)).status, 'stored', 'a saved post without any publication');
    if (!installed) {
      check(await withdraw(first.id, 1), { status: 'missing' }, 'before: a withdrawal without a publication row answers missing');
      await assert.rejects(withdraw(first.id, 0), error => error.message === 'life_invalid_request' && error.code === '22023', 'before: expected revision 0 is refused'); passed++; console.log('PASS before: expected revision 0 is an invalid request');
      check(await publication(first.id), null, 'before: nothing was recorded, so a late first publication would still be applied');
    }

    // ---- Installing: nothing but the one function changes ----
    const seeded = v2(randomUUID(), '이미 공개했다 철회한 글'); await save(seeded);
    const seededPublished = await publish(seeded.id, 0, { author: { name: '기존 공개 이름', intro: '기존 소개' } }); await withdraw(seeded.id, 1);
    const beforeRows = await rows(), beforeCatalog = await catalog(), earlier = await definition();
    await db.query(installation());
    check(await rows(), beforeRows, 'installing changes no blog row');
    check(await catalog(), beforeCatalog, 'installing keeps every other function, and the signature, privileges, SECURITY DEFINER, search_path and owner of unpublish');
    if (!installed) { assert.notEqual(await definition(), earlier); passed++; console.log('PASS the definition of unpublish was replaced'); }
    else check(await definition(), earlier, 'installing over the replayed migrations leaves the same definition');
    await db.query(installation());
    check(await rows(), beforeRows, 'installing it again changes nothing');
    for (const [role, expected] of [['anon', false], ['authenticated', true], ['service_role', false]])
      check((await db.query("select has_function_privilege($1,'public.life_blog_unpublish(uuid,bigint,uuid)','execute') value", [role])).rows[0].value, expected, role + (expected ? ' may' : ' may not') + ' call the withdrawal');

    // ---- A withdrawal before any publication ----
    const operation = randomUUID();
    check(await withdraw(first.id, 0, { operation }), { status: 'stored', revision: 1 }, 'expected revision 0 without a row: stored at publication revision 1');
    const placeholder = await publication(first.id);
    assert(placeholder, 'the withdrawal records a publication row'); passed++; console.log('PASS the withdrawal records a publication row');
    check({ revision: Number(placeholder.revision), active: placeholder.active, snapshot: placeholder.snapshot, media: placeholder.media, source: Number(placeholder.source_revision) },
      { revision: 1, active: false, snapshot: null, media: null, source: 1 }, 'the recorded row is withdrawn: not active, no snapshot, no media');
    check(await withdraw(first.id, 0, { operation }), { status: 'stored', revision: 1 }, 'the same operation again returns its receipt');
    check((await db.query('select count(*)::int value from haedo_blog_private.receipts where post_id=$1 and operation_id=$2', [first.id, operation])).rows[0].value, 1, 'one receipt for it');
    await assert.rejects(withdraw(first.id, 1, { operation }), error => error.message === 'life_operation_mismatch', 'the same operation with another revision is a mismatch'); passed++; console.log('PASS the same operation id with another expected revision is refused');
    check(await withdraw(first.id, 0), { status: 'conflict', revision: 1 }, 'expected revision 0 with a row: conflict');
    check(await profile(owner).then(row => row.author), { name: '기존 공개 이름', intro: '기존 소개' }, 'an existing public name and intro are not touched');

    // ---- The late first publication is refused on every publish path ----
    check(await publish(first.id, 0), { status: 'conflict', revision: 1 }, 'publish (text) expecting revision 0: conflict');
    check(await rpc('life_blog_publish_copies', [first.id, 1, randomUUID(), [], { name: '익명', intro: '' }, 0, {}]), { status: 'conflict', revision: 1 }, 'publish_copies expecting revision 0: conflict');
    const marked = md(randomUUID(), 'Markdown 철회 전 게시 요청 글'); await save(marked); await save({ ...marked, title: 'Markdown 철회 전 게시 요청 글 (고침)' }, owner, 1);
    check(await withdraw(marked.id, 0), { status: 'stored', revision: 1 }, 'a Markdown post is withdrawn before publication the same way');
    const markdownArgs = expected => [marked.id, 2, randomUUID(), [], { name: '익명', intro: '' }, expected, {}];
    check(await rpc('life_blog_markdown_publish_prepare', markdownArgs(0)), { status: 'conflict', revision: 1 }, 'markdown_publish_prepare expecting revision 0: conflict');
    const prepared = await rpc('life_blog_markdown_publish_prepare', markdownArgs(1)); check(prepared.status, 'prepared', 'markdown_publish_prepare with the moved revision prepares');
    const stale = markdownArgs(0);
    // The post is at revision 2 and the publication at 1: the answer names the publication revision, so this is its check.
    check(await rpc('life_blog_markdown_publish_commit', [...stale, prepared.ownerId, prepared.sessionId, prepared.sourceHash, JSON.stringify([{ insert: '익명 본문\n' }])], { role: 'service_role', who: null }), { status: 'conflict', revision: 1 }, 'markdown_publish_commit expecting revision 0: conflict');
    check((await publication(first.id)).active, false, 'nothing became public');

    // ---- What the owner and visitors read ----
    const head = await rpc('life_blog_read', [first.id]);
    check({ revision: head.publication.revision, active: head.publication.active, token: head.publication.token === placeholder.token, blogToken: typeof head.publication.blogToken },
      { revision: 1, active: false, token: true, blogToken: 'string' }, 'read: the owner sees a withdrawn publication at revision 1 (the next expected revision)');
    const listed = (await rpc('life_blog_sync_list', [])).find(row => row.id === first.id), plain = (await rpc('life_blog_list', [null])).find(row => row.id === first.id);
    check([listed.publication.revision, listed.publication.active, plain.publication.revision, plain.publication.active], [1, false, 1, false], 'sync_list and list report the same');
    check(await rpc('life_blog_public_read', [placeholder.token], { role: 'anon', who: null }), null, 'the row\'s token answers nothing to a visitor');
    check(await rpc('life_blog_public_media', [placeholder.token, randomUUID()], { role: 'service_role', who: null }), null, 'and serves no media');
    const blogToken = (await profile(owner)).token;
    check(await rpc('life_blog_public_list', [blogToken, 40, null], { role: 'anon', who: null }), { blogToken, author: { name: '', intro: '' }, posts: [], nextCursor: null }, 'the public list counts no withdrawn row and shows no name');

    // ---- The first real publication after it ----
    const real = await publish(first.id, 1, { author: { name: '새 공개 이름', intro: '' } });
    check([real.status, real.revision], ['stored', 2], 'publishing with the moved revision is stored at revision 2');
    assert.notEqual(real.token, placeholder.token); passed++; console.log('PASS the public address is created by the first real publication, not by the withdrawal');
    check((await rpc('life_blog_public_read', [real.token], { role: 'anon', who: null })).revision, 2, 'that address answers');
    check((await rpc('life_blog_public_list', [blogToken, 40, null], { role: 'anon', who: null })).posts.map(row => row.token), [real.token], 'the public list shows exactly the published post');
    check(await withdraw(first.id, 2), { status: 'stored', revision: 3 }, 'withdrawing an active publication moves its revision as before');
    check([Number((await publication(first.id)).revision), (await publication(first.id)).active], [3, false], 'the row itself is at revision 3 and not active');
    check(await withdraw(first.id, 3), { status: 'stored', revision: 4 }, 'withdrawing a withdrawn row moves its revision too');
    check(Number((await publication(first.id)).revision), 4, 'the row itself is at revision 4');
    check(await publish(first.id, 3), { status: 'conflict', revision: 4 }, 'a publication request made before that withdrawal ends in conflict');
    check(await withdraw(seeded.id, 5), { status: 'conflict', revision: 2 }, 'another revision of an existing row: conflict, as before');
    check((await publication(seeded.id)).token, seededPublished.token, 'an existing withdrawn row keeps its values');

    // ---- An owner without a profile; other owners ----
    const foreign = v2(randomUUID(), '다른 계정의 글'); await save(foreign, other);
    check(await profile(other), null, 'the other owner has no profile yet');
    check(await withdraw(foreign.id, 0), { status: 'missing' }, 'another owner\'s post: missing');
    check(await publication(foreign.id), null, 'and no row is recorded for it');
    check(await withdraw(foreign.id, 0, { who: other }), { status: 'stored', revision: 1 }, 'its owner withdraws before publication');
    check((await profile(other)).author, { name: '', intro: '' }, 'a profile with the default empty author is added so the owner can read the row');
    check((await rpc('life_blog_read', [foreign.id], { who: other })).publication.revision, 1, 'the owner without an earlier profile reads the withdrawn row');
    check(await rpc('life_blog_read', [foreign.id]), null, 'the first owner cannot read it');
    check(await withdraw(randomUUID(), 0), { status: 'missing' }, 'a post that does not exist: missing');
    await assert.rejects(withdraw(first.id, 0, { role: 'anon', who: null }), error => error.code === '42501', 'anonymous callers are refused'); passed++; console.log('PASS an anonymous caller cannot withdraw');
    await assert.rejects(withdraw(first.id, -1), error => error.message === 'life_invalid_request', 'a negative revision is refused'); passed++; console.log('PASS a negative expected revision is an invalid request');
    check(await withdraw(v2(randomUUID(), '').id, 1), { status: 'missing' }, 'expected revision 1 or more without a row keeps the earlier answer');

    // ---- Deleting a post that only has the withdrawn row ----
    const removed = await rpc('life_blog_delete', [foreign.id, 1], { who: other });
    check(removed.status, 'deleted', 'a post with only a withdrawn row is deleted (not refused as published)');
    check(await publication(foreign.id), null, 'its withdrawn row goes with it');
    check((await db.query('select count(*)::int value from haedo_blog_private.receipts where post_id=$1', [foreign.id])).rows[0].value, 0, 'and so do its receipts');
  }
  return passed;
}
async function main() {
  const pg = await startCluster({ label: 'blog-unpublish' }), db = await pg.connect();
  try {
    for (const file of BEFORE) await db.query(read(file));
    const count = await contract(db);
    console.log(`PASS withdrawal before publication SQL contract: ${count} checks; PostgreSQL ${(await db.query('show server_version')).rows[0].server_version}`);
  } finally { await db.end(); await pg.stop(); }
}
if (direct) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
module.exports = { contract, FILE };

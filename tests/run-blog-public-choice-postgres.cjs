/* Public name/intro separated from publication, and attachments chosen one by one (owner
 * decisions 7 and 9, 2026-11-16). Disposable local PostgreSQL only; no endpoint, account or
 * credential options. Absence of PostgreSQL is a failure, never a SKIP.
 *   node tests/run-blog-public-choice-postgres.cjs            (after npm ci --prefix tests/sql-ci)
 *   node tests/run-blog-public-choice-postgres.cjs --mutation=<name>   must FAIL (guard check)
 * CI runs the same contract through tests/run-sql-replay-postgres.cjs (step 4.10), on a copy
 * with every migration replayed.
 *
 * supabase/migrations/20261116120000_life_blog_public_choice.sql: owner-only read and save of
 * the public name and intro; every publish path takes an attachment choice (list positions,
 * default none), and no publish request writes the name or intro any more (owner decision 7, the
 * review of 2026-11-16 M1). A request without a choice (an earlier app or a request recorded
 * before the file) keeps its hash and receipt and publishes no attachment. EXECUTE on the
 * unused private publish(6) is revoked from authenticated. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { startCluster } = require('./helpers/supabase-pg-stub.cjs');
const ROOT = path.resolve(__dirname, '..');
const FILE = 'supabase/migrations/20261116120000_life_blog_public_choice.sql';
const BEFORE = ['supabase/tests/blog-bootstrap.sql', 'supabase/migrations/20261017144744_life_blog_originals.sql',
  'supabase/migrations/20261101091500_life_blog_account_sync.sql', 'supabase/migrations/20261101160000_life_blog_delete_guard.sql',
  'supabase/migrations/20261102110000_life_blog_ai_authorship.sql', 'supabase/migrations/20261102120000_life_blog_public_photo_copies.sql',
  'supabase/migrations/20261105051632_life_post_markdown.sql'];
const AFTER_AUTH = ['supabase/migrations/20261105081055_life_post_markdown_publish.sql',
  'supabase/migrations/20261111120000_life_blog_withdraw_before_publication.sql', 'supabase/migrations/20261112120000_life_blog_revision_continuity.sql'];
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
// Each mutation reopens one path the contract closes. The install's own final md5 check would
// stop a changed body, so a mutation also drops that check (the contract must catch it).
const unguarded = sql => sql.replace("if to_regprocedure(sig) is null or (select md5(prosrc) from pg_proc where oid=to_regprocedure(sig)) is distinct from want\n", "if to_regprocedure(sig) is null\n");
const MUTATIONS = {
  // A v1/v2 request still writes the public name and intro.
  'profile-write': sql => unguarded(sql).replace(" -- saved by set_public_profile alone. A first publication without a profile row starts it empty.\n insert into haedo_blog_private.profiles(owner_id) values(who) on conflict(owner_id) do nothing;",
    " insert into haedo_blog_private.profiles(owner_id,author) values(who,p_author) on conflict(owner_id) do update set author=excluded.author;"),
  // Only a request without a choice (an earlier app) writes them, as before the review (M1).
  'legacy-profile-write': sql => unguarded(sql).replace(" -- saved by set_public_profile alone. A first publication without a profile row starts it empty.\n insert into haedo_blog_private.profiles(owner_id) values(who) on conflict(owner_id) do nothing;",
    " if p_attachments is null then insert into haedo_blog_private.profiles(owner_id,author) values(who,p_author) on conflict(owner_id) do update set author=excluded.author;\n else insert into haedo_blog_private.profiles(owner_id) values(who) on conflict(owner_id) do nothing; end if;"),
  // A Markdown commit still writes them.
  'markdown-profile-write': sql => unguarded(sql).replace(" picked:=haedo_blog_private.picked_attachments(p.data->'attachments',p_attachments);\n insert into haedo_blog_private.profiles(owner_id) values(who) on conflict(owner_id) do nothing;",
    " picked:=haedo_blog_private.picked_attachments(p.data->'attachments',p_attachments);\n insert into haedo_blog_private.profiles(owner_id,author) values(who,p_author) on conflict(owner_id) do update set author=excluded.author;"),
  // The unused private publish(6) keeps EXECUTE for authenticated.
  'publish-grant': sql => sql.replace(",\n  'haedo_blog_private.publish(uuid,bigint,uuid,text[],jsonb,bigint)','');", ");")
    .replace(" revoke all on function haedo_blog_private.publish(uuid,bigint,uuid,text[],jsonb,bigint) from public,anon,authenticated,service_role;\n", ''),
  // Every attachment is published whatever was chosen.
  'all-attachments': sql => unguarded(sql).replace("picked:=haedo_blog_private.picked_attachments(coalesce(p.data->'attachments','[]'::jsonb),p_attachments);", "picked:=coalesce(p.data->'attachments','[]'::jsonb);"),
  // A request without a choice keeps publishing every attachment.
  'legacy-all': sql => unguarded(sql).replace(" if p_choice is null then return '[]'::jsonb; end if;", " if p_choice is null then return p_all; end if;"),
  // The choice is not part of the receipt identity.
  'hash-without-choice': sql => unguarded(sql).replace("when p_attachments is not null then jsonb_build_array('publish',p_expected_revision,p_chosen,p_author,p_expected_publication_revision,p_copies,jsonb_build_object('attachments',p_attachments))\n", ''),
  // A position outside the stored list is ignored instead of refused.
  'no-range-check': sql => unguarded(sql).replace("  if (v#>>'{}')::integer>=total then raise exception using errcode='22023',message='life_blog_unknown_attachment'; end if;\n", "  if (v#>>'{}')::integer>=total then continue; end if;\n"),
  // The empty-publication check counts the stored attachments, not the chosen ones.
  'empty-check-stored': sql => unguarded(sql).replace(" if (snapshot->>'title') ~ '^[[:space:]]*$' and cardinality(chosen)=0 and jsonb_array_length(picked)=0\n and (select coalesce(string_agg(j->>'insert',''),'') ~ '^[[:space:]]*$' from jsonb_array_elements(ops) j) then\n  raise exception using errcode='22023',message='life_blog_empty_publication';\n end if;",
    () => " if (snapshot->>'title') ~ '^[[:space:]]*$' and cardinality(chosen)=0 and jsonb_array_length(coalesce(p.data->'attachments','[]'::jsonb))=0\n and (select coalesce(string_agg(j->>'insert',''),'') ~ '^[[:space:]]*$' from jsonb_array_elements(ops) j) then\n  raise exception using errcode='22023',message='life_blog_empty_publication';\n end if;"),
  // The profile read names a row by anything but the caller.
  'any-profile': sql => unguarded(sql).replace(" select * into f from haedo_blog_private.profiles where owner_id=who;\n saved:=found;", " select * into f from haedo_blog_private.profiles limit 1;\n saved:=found;"),
  // Visitors may read the profile through the owner RPC.
  'anon-profile': sql => sql.replace("'public.life_blog_get_public_profile()','authenticated',", "'public.life_blog_get_public_profile()','anon',").replace("'haedo_blog_private.get_public_profile()','authenticated',", "'haedo_blog_private.get_public_profile()','anon',")
    .replace("  or has_function_privilege('authenticated',sig,'execute') is distinct from (role_name='authenticated')\n", '').replace("  if has_function_privilege('anon',sig,'execute')\n  or", '  if'),
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
const invalid = error => error.code === '22023' && error.message === 'life_invalid_request';

/* contract(db): the whole contract.
 * - installed:false (this file run directly): db holds the blog migrations before this one; the
 *   earlier answers are recorded first and the installation itself is checked.
 * - installed:true (tests/run-sql-replay-postgres.cjs, a copy with every migration replayed):
 *   the earlier-definition and installation checks are skipped; everything else is the same. */
async function contract(db, { installed = false } = {}) {
  passed = 0;
  await db.query(`create table if not exists auth.users(id uuid primary key);
    alter table auth.users add column if not exists is_anonymous boolean not null default false;
    create table if not exists auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,not_after timestamptz);
    create or replace function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
    grant execute on function auth.jwt() to authenticated,service_role;`);
  if (!installed) for (const file of AFTER_AUTH) await db.query(read(file));
  const owner = randomUUID(), other = randomUUID(), fresh = randomUUID(), sid = randomUUID(), otherSid = randomUUID(), workspace = randomUUID();
  await db.query('insert into auth.users(id) values($1),($2),($3)', [owner, other, fresh]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2),($3,$4)', [sid, owner, otherSid, other]);
  const as = async (role, who, sql, values = []) => {
    await db.query('begin');
    try {
      if (role !== 'postgres') await db.query('set local role ' + role);
      const session = who === other ? otherSid : sid;
      await db.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claim.role',$3,true)",
        [JSON.stringify({ role, ...(who ? { sub: who } : {}), session_id: session }), who || '', role]);
      const result = await db.query(sql, values); await db.query('commit'); return result.rows[0]?.value;
    } catch (error) { await db.query('rollback'); throw error; }
  };
  // Named arguments, as PostgREST sends them (jsonb arrays as JSON, text[] as arrays).
  const rpc = (name, args, { role = 'authenticated', who = owner } = {}) => {
    const keys = Object.keys(args);
    return as(role, who, `select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')}) value`, keys.map(key => ['p_attachments', 'p_ops'].includes(key) && args[key] !== null ? JSON.stringify(args[key]) : args[key]));
  };
  const at = '2026-11-16T00:00:00.000Z';
  const cards = [{ type: 'book', title: '익명 첨부 하나', creator: '익명 작가', url: 'https://example.com/one' },
    { type: 'article', title: '익명 첨부 둘', creator: '', url: 'https://example.com/two' },
    { type: 'music', title: '익명 첨부 셋', creator: '익명 음악가', url: '' }];
  const v2 = (id, { title = '첨부 고르기 글', text = '익명 본문\n', attachments = cards } = {}) => ({ format: 'life-photo-post-v2', id, revision: 1, status: 'saved', title,
    ops: [{ insert: text }], photos: [], attachments, archived: false, replaces: null, createdAt: at, updatedAt: at });
  const md = (id, { title = '첨부 고르기 Markdown', attachments = cards } = {}) => ({ format: 'life-post-md-v1', id, revision: 1, title, status: 'saved', replaces: null,
    createdAt: at, updatedAt: at, markdown: '익명 본문\n', photos: [], attachments, archived: false });
  const save = (doc, who = owner) => rpc('life_blog_save', { p_workspace_id: workspace, p_post_id: doc.id, p_expected_revision: 0, p_operation_id: randomUUID(), p_data: doc }, { who });
  const rows = async () => (await db.query(`select jsonb_build_object(${['posts', 'assets', 'receipts', 'publications', 'profiles', 'retired_posts'].map(name => `'${name}',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from haedo_blog_private.${name} t)`).join(',')}) value`)).rows[0].value;
  const snapshot = async id => (await db.query('select snapshot from haedo_blog_private.publications where post_id=$1 and active', [id])).rows[0]?.snapshot || null;
  const profileRow = async who => (await db.query('select token,author from haedo_blog_private.profiles where owner_id=$1', [who])).rows[0] || null;
  const author = { name: '익명 게시자', intro: '익명 소개' };
  // The v1/v2 request of this app: every route through life_blog_publish_copies, copies {} without photos.
  const choose = (id, attachments, { expectedPublic = 0, operation = randomUUID(), by = author, who = owner, photos = [] } = {}) =>
    rpc('life_blog_publish_copies', { p_post_id: id, p_expected_revision: 1, p_operation_id: operation, p_photo_ids: photos, p_author: by,
      p_expected_publication_revision: expectedPublic, p_copies: {}, ...(attachments === undefined ? {} : { p_attachments: attachments }) }, { who });
  // The earlier app's requests: exactly its argument sets.
  const earlierText = (id, { expectedPublic = 0, operation = randomUUID(), by = author } = {}) =>
    rpc('life_blog_publish', { p_post_id: id, p_expected_revision: 1, p_operation_id: operation, p_photo_ids: [], p_author: by, p_expected_publication_revision: expectedPublic });
  const earlierCopies = (id, { expectedPublic = 0, operation = randomUUID(), by = author } = {}) =>
    rpc('life_blog_publish_copies', { p_post_id: id, p_expected_revision: 1, p_operation_id: operation, p_photo_ids: [], p_author: by, p_expected_publication_revision: expectedPublic, p_copies: {} });
  const titles = value => value.attachments.map(item => item.title);

  // ---- Before this file (direct run): every attachment was published; record an earlier request ----
  const queued = v2(randomUUID(), { title: '설치 전에 보낸 게시 요청' }); check((await save(queued)).status, 'stored', 'a saved post with three attachments');
  const queuedOperation = randomUUID();
  // A second request recorded by the earlier app before the install that never reached the
  // server; it is sent only after the install (its post must exist then).
  const unsentQueued = v2(randomUUID(), { title: '설치 전에 기록만 된 게시 요청' }); await save(unsentQueued);
  let queuedReceipt = null;
  if (!installed) {
    queuedReceipt = await earlierText(queued.id, { operation: queuedOperation, by: { name: '설치 전 이름', intro: '설치 전 소개' } });
    check(queuedReceipt.status, 'stored', 'before: an earlier app publishes');
    check(titles(await snapshot(queued.id)), cards.map(card => card.title), 'before: every attachment became public');
    await refused(rpc('life_blog_get_public_profile', {}), error => error.code === '42883' || /does not exist/.test(error.message), 'before: there is no owner profile read');
    // An earlier install that a drifted function must stop.
    await db.query("create or replace function haedo_blog_private.markdown_publish_hash(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[],p_author jsonb,p_expected_publication_revision bigint,p_copies jsonb) returns bytea language plpgsql immutable set search_path=pg_catalog as $$begin return null; end$$");
    const drifted = await rows();
    await refused(db.query(installation()), error => /differs from the repository definition/.test(error.message), 'a drifted function stops the install');
    check(await rows(), drifted, 'and nothing was changed');
    await db.query(read('supabase/migrations/20261105081055_life_post_markdown_publish.sql'));
  }

  // ---- Installing: no row changes ----
  if (!installed) {
    const beforeRows = await rows();
    await db.query(installation());
    check(await rows(), beforeRows, 'installing changes no blog row');
    await db.query(installation());
    check(await rows(), beforeRows, 'installing it again changes nothing');
  }

  // ---- Privileges ----
  const privilege = async (role, signature) => (await db.query('select has_function_privilege($1,$2,$3) value', [role, signature, 'execute'])).rows[0].value;
  for (const [signature, roleName] of [['public.life_blog_get_public_profile()', 'authenticated'], ['public.life_blog_set_public_profile(jsonb)', 'authenticated'],
    ['public.life_blog_publish(uuid,bigint,uuid,text[],jsonb,bigint)', 'authenticated'], ['public.life_blog_publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)', 'authenticated'],
    ['public.life_blog_markdown_publish_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,jsonb)', 'authenticated'],
    ['public.life_blog_markdown_publish_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb,jsonb)', 'service_role']])
  {
    const roles = ['anon', 'authenticated', 'service_role'], granted = [];
    for (const role of roles) granted.push(await privilege(role, signature));
    check(granted, roles.map(role => role === roleName), signature + ': only ' + roleName + ' may call it');
  }
  {
    const granted = [];
    for (const role of ['anon', 'authenticated', 'service_role']) granted.push(await privilege(role, 'haedo_blog_private.publish(uuid,bigint,uuid,text[],jsonb,bigint)'));
    check(granted, [false, false, false], 'the unused private publish(6) keeps no API role');
  }
  check((await db.query("select to_regprocedure('public.life_blog_publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)') is null and to_regprocedure('public.life_blog_markdown_publish_prepare(uuid,bigint,uuid,text[],jsonb,bigint,jsonb)') is null value")).rows[0].value, true,
    'the earlier public signatures are replaced, not overloaded');

  // ---- The public name and intro: owner-only read and explicit save ----
  const empty = { name: '', intro: '' };
  const freshOwner = installed ? null : { author: { name: '설치 전 이름', intro: '설치 전 소개' }, saved: true };
  const mine = await rpc('life_blog_get_public_profile', {});
  if (freshOwner) check({ author: mine.author, saved: mine.saved, posts: mine.posts }, { ...freshOwner, posts: 1 }, 'the owner reads the name and intro the earlier publish set');
  else check({ author: mine.author, saved: mine.saved, blogToken: mine.blogToken, posts: mine.posts }, { author: empty, saved: false, blogToken: null, posts: 0 }, 'an owner without a profile reads an empty name and intro');
  await refused(rpc('life_blog_get_public_profile', {}, { role: 'anon', who: null }), error => error.code === '42501', 'a visitor cannot read the owner profile');
  await refused(rpc('life_blog_set_public_profile', { p_author: author }, { role: 'anon', who: null }), error => error.code === '42501', 'a visitor cannot save a profile');
  await refused(rpc('life_blog_get_public_profile', {}, { role: 'service_role', who: owner }), error => error.code === '42501', 'the service role has no profile read either');
  const saved = await rpc('life_blog_set_public_profile', { p_author: author });
  check({ author: saved.author, saved: saved.saved }, { author, saved: true }, 'the owner saves the name and intro');
  assert.match(saved.blogToken, /^[a-f0-9-]{36}$/); passed++; console.log('PASS the answer names the public list token');
  check(await rpc('life_blog_get_public_profile', {}), saved, 'and reads the same back');
  if (freshOwner) check(saved.blogToken, mine.blogToken, 'saving keeps the public list token');
  const theirs = await rpc('life_blog_get_public_profile', {}, { who: other });
  check({ author: theirs.author, saved: theirs.saved, posts: theirs.posts }, { author: empty, saved: false, posts: 0 }, 'another account reads only its own (empty) profile');
  check(await rpc('life_blog_set_public_profile', { p_author: { name: '다른 계정', intro: '' } }, { who: other }).then(value => value.author), { name: '다른 계정', intro: '' }, 'another account saves its own');
  check((await profileRow(owner)).author, author, 'which leaves the owner profile as it was');
  for (const [value, label] of [[{ name: '이름' }, 'a missing intro'], [{ name: '', intro: '', extra: '' }, 'an extra key'], [{ name: 'x'.repeat(501), intro: '' }, 'a name over 500'],
    [{ name: '', intro: 'x'.repeat(2001) }, 'an intro over 2000'], [{ name: 'a\u0001b', intro: '' }, 'a control character'], [{ name: 1, intro: '' }, 'a number'], [null, 'null']])
    await refused(rpc('life_blog_set_public_profile', { p_author: value }), invalid, 'a profile with ' + label + ' is refused');
  check((await profileRow(owner)).author, author, 'refused saves change nothing');

  // ---- Choosing attachments ----
  const post = v2(randomUUID()); await save(post);
  const none = await choose(post.id, []);
  check(none.status, 'stored', 'publishing with no attachment chosen');
  check(titles(await snapshot(post.id)), [], 'default 0: the public copy holds no attachment');
  check((await snapshot(post.id)).author, author, 'the copy byline is the reviewed name and intro');
  const byOther = { name: '미리보기에서 읽은 다른 이름', intro: '다른 소개' };
  check((await choose(post.id, [1], { expectedPublic: 1, by: byOther })).revision, 2, 'an update choosing the second attachment');
  check(titles(await snapshot(post.id)), ['익명 첨부 둘'], 'only the chosen attachment is public');
  check((await profileRow(owner)).author, author, 'publishing with a choice does not overwrite the saved name and intro');
  check((await snapshot(post.id)).author, byOther, 'the byline of the copy is what that request reviewed');
  check((await choose(post.id, [0, 1, 2], { expectedPublic: 2 })).revision, 3, 'an update choosing every attachment');
  check(titles(await snapshot(post.id)), cards.map(card => card.title), 'all three, in document order');
  check((await choose(post.id, [0, 2], { expectedPublic: 3 })).revision, 4, 'an update not choosing the second one again');
  check(titles(await snapshot(post.id)), ['익명 첨부 하나', '익명 첨부 셋'], 'drops the attachment that was not chosen again');
  check((await choose(post.id, [], { expectedPublic: 4 })).revision, 5, 'an update choosing none');
  check(titles(await snapshot(post.id)), [], 'drops every attachment');
  for (const [choice, label] of [[[1, 0], 'positions out of order'], [[0, 0], 'a repeated position'], [[12], 'position 12'], [[-1], 'a negative position'], [['0'], 'a string'],
    [[0.5], 'a fraction'], [{}, 'an object'], [Array.from({ length: 13 }, (_, i) => i), 'thirteen positions']])
    await refused(choose(post.id, choice, { expectedPublic: 5 }), invalid, 'a choice with ' + label + ' is refused');
  await refused(choose(post.id, [3], { expectedPublic: 5 }), error => error.code === '22023' && error.message === 'life_blog_unknown_attachment', 'a position past the stored attachments is refused');
  check((await db.query('select revision from haedo_blog_private.publications where post_id=$1', [post.id])).rows[0].revision, '5', 'refused choices publish nothing');

  // ---- Receipts ----
  const operation = randomUUID();
  const first = await choose(post.id, [0], { expectedPublic: 5, operation });
  check(await choose(post.id, [0], { expectedPublic: 5, operation }), first, 'the same request again returns its receipt');
  await refused(choose(post.id, [1], { expectedPublic: 5, operation }), error => error.message === 'life_operation_mismatch', 'the same operation with another choice is a mismatch');
  await refused(choose(post.id, [], { expectedPublic: 5, operation }), error => error.message === 'life_operation_mismatch', 'and with no attachment chosen');
  await refused(choose(post.id, undefined, { expectedPublic: 5, operation }), error => error.message === 'life_operation_mismatch', 'and without a choice (the earlier argument set)');
  check(titles(await snapshot(post.id)), ['익명 첨부 하나'], 'the receipt did not publish again');

  // ---- An earlier app: no attachment, same hash and receipt, the saved name and intro untouched ----
  const older = v2(randomUUID(), { title: '이전 앱의 게시' }); await save(older);
  const beforeEarlier = (await profileRow(owner)).author;
  const earlierOperation = randomUUID(), earlierAnswer = await earlierText(older.id, { operation: earlierOperation, by: { name: '이전 앱 이름', intro: '' } });
  check(earlierAnswer.status, 'stored', 'the earlier text publish still works');
  check(titles(await snapshot(older.id)), [], 'and now publishes no attachment');
  check((await profileRow(owner)).author, beforeEarlier, 'an earlier app no longer replaces the saved name and intro (owner decision 7)');
  check((await snapshot(older.id)).author, { name: '이전 앱 이름', intro: '' }, 'its copy shows the byline it reviewed');
  check(await earlierCopies(older.id, { operation: earlierOperation, by: { name: '이전 앱 이름', intro: '' } }), earlierAnswer, 'the earlier publish_copies arguments replay the same receipt (same hash as before)');
  await refused(choose(older.id, [], { operation: earlierOperation, by: { name: '이전 앱 이름', intro: '' } }), error => error.message === 'life_operation_mismatch', 'a choice can never replay an earlier receipt');
  const legacyHash = (await db.query("select encode(sha256(convert_to(jsonb_build_array('publish',1::bigint,'{}'::text[],$1::jsonb,0::bigint)::text,'UTF8')),'hex') value", [{ name: '이전 앱 이름', intro: '' }])).rows[0].value;
  check((await db.query("select encode(request_hash,'hex') value from haedo_blog_private.receipts where operation_id=$1", [earlierOperation])).rows[0].value, legacyHash, 'the receipt hash is the earlier formula');
  check((await profileRow(owner)).author, beforeEarlier, 'replaying its receipt writes nothing either');
  // The request recorded before the install and sent only now: published without attachments, the saved values kept.
  check((await earlierText(unsentQueued.id, { by: { name: '기기에 남은 옛 이름', intro: '옛 소개' } })).status, 'stored', 'a request recorded before the install and sent after it is applied');
  check(titles(await snapshot(unsentQueued.id)), [], 'with no attachment');
  check((await profileRow(owner)).author, beforeEarlier, 'and without replacing the saved name and intro');
  // An earlier app publishing first for an account without a profile row: the row starts empty.
  const freshPost = v2(randomUUID(), { title: '처음 공개하는 계정의 글' }); await save(freshPost, fresh);
  check((await rpc('life_blog_publish', { p_post_id: freshPost.id, p_expected_revision: 1, p_operation_id: randomUUID(), p_photo_ids: [], p_author: { name: '옛 앱에서 쓴 이름', intro: '옛 소개' },
    p_expected_publication_revision: 0 }, { who: fresh })).status, 'stored', 'an earlier app publishes first for an account without a profile');
  check((await profileRow(fresh)).author, empty, 'its profile row starts with an empty name and intro (documented)');
  check((await rpc('life_blog_get_public_profile', {}, { who: fresh })).author, empty, 'and the owner reads it as empty until saving one');
  if (queuedReceipt) {
    // The request recorded before the file: its operation replays with the original arguments.
    check(await earlierText(queued.id, { operation: queuedOperation, by: { name: '설치 전 이름', intro: '설치 전 소개' } }), queuedReceipt, 'a request recorded before the install replays its receipt unchanged');
    check(titles(await snapshot(queued.id)), cards.map(card => card.title), 'and its existing public copy keeps what it published');
    check((await profileRow(owner)).author, beforeEarlier, 'a replayed receipt writes nothing');
  }

  // ---- The empty-publication check counts the chosen attachments ----
  const linksOnly = v2(randomUUID(), { title: '', text: '\n', attachments: [cards[0]] }); await save(linksOnly);
  const emptyError = error => error.code === '22023' && error.message === 'life_blog_empty_publication';
  await refused(choose(linksOnly.id, []), emptyError, 'a post with only an attachment and none chosen is empty');
  await refused(earlierText(linksOnly.id), emptyError, 'so is the earlier request for it (it publishes no attachment)');
  check((await choose(linksOnly.id, [0])).status, 'stored', 'choosing the attachment publishes it');
  check(titles(await snapshot(linksOnly.id)), ['익명 첨부 하나'], 'the attachment-only copy');

  // ---- Markdown: prepare (owner session) and commit (service role) ----
  const markdown = md(randomUUID()); await save(markdown);
  const intent = (choice, overrides = {}) => ({ p_post_id: markdown.id, p_expected_revision: 1, p_operation_id: overrides.operation || randomUUID(), p_photo_ids: [], p_author: overrides.by || author,
    p_expected_publication_revision: overrides.expectedPublic || 0, p_copies: {}, ...(choice === undefined ? {} : { p_attachments: choice }) });
  const commit = async (input, prepared) => rpc('life_blog_markdown_publish_commit', { ...input, p_owner_id: prepared.ownerId, p_session_id: prepared.sessionId,
    p_source_hash: prepared.sourceHash, p_ops: [{ insert: '익명 본문\n' }] }, { role: 'service_role', who: null });
  await refused(rpc('life_blog_markdown_publish_prepare', intent([3])), error => error.message === 'life_blog_unknown_attachment', 'Markdown prepare refuses a position past the stored attachments');
  await refused(rpc('life_blog_markdown_publish_prepare', intent([2, 1])), invalid, 'and a choice out of order');
  const mdIntent = intent([2], { by: byOther }), prepared = await rpc('life_blog_markdown_publish_prepare', mdIntent);
  check(prepared.status, 'prepared', 'Markdown prepare with a choice');
  const mdAnswer = await commit(mdIntent, prepared);
  check(mdAnswer.status, 'stored', 'Markdown commit with a choice');
  check(titles(await snapshot(markdown.id)), ['익명 첨부 셋'], 'the Markdown copy holds only the chosen attachment');
  check((await profileRow(owner)).author, beforeEarlier, 'Markdown with a choice does not overwrite the name and intro');
  check(await rpc('life_blog_markdown_publish_prepare', mdIntent), mdAnswer, 'the same Markdown intent prepares into its receipt');
  check(await commit(mdIntent, prepared), mdAnswer, 'and commits into the same receipt');
  await refused(rpc('life_blog_markdown_publish_prepare', { ...mdIntent, p_attachments: [] }), error => error.message === 'life_operation_mismatch', 'the Markdown receipt is bound to the choice');
  const oldIntent = intent(undefined, { expectedPublic: 1, by: { name: '이전 Edge 이름', intro: '' } }), oldPrepared = await rpc('life_blog_markdown_publish_prepare', oldIntent);
  check((await commit(oldIntent, oldPrepared)).revision, 2, 'an earlier Edge (no choice) still publishes Markdown');
  check(titles(await snapshot(markdown.id)), [], 'with no attachment');
  check((await profileRow(owner)).author, beforeEarlier, 'and does not replace the saved name and intro (owner decision 7)');
  await refused(rpc('life_blog_markdown_publish_commit', { ...intent([0], { expectedPublic: 2 }), p_owner_id: owner, p_session_id: sid, p_source_hash: oldPrepared.sourceHash, p_ops: [{ insert: '익명 본문\n' }] }),
    error => error.code === '42501', 'an owner session cannot call the Markdown commit');
  check(await rpc('life_blog_markdown_publish_prepare', intent([0], { expectedPublic: 2 }), { who: other }), { status: 'missing' }, 'another account preparing the owner Markdown post finds nothing');
  return passed;
}
async function main() {
  const pg = await startCluster({ label: 'blog-public-choice' }), db = await pg.connect();
  try {
    for (const file of BEFORE) await db.query(read(file));
    const count = await contract(db);
    console.log(`PASS public name and attachment choice SQL contract: ${count} checks; PostgreSQL ${(await db.query('show server_version')).rows[0].server_version}`);
  } finally { await db.end(); await pg.stop(); }
}
if (direct) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
module.exports = { contract, FILE };

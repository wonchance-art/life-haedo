/* Disposable PostgreSQL only. Verifies historical operations bundles on fresh,
 * fully installed and partial/drifted Markdown schemas. No remote endpoint.
 * node tests/run-post-markdown-install-replay.cjs (local PostgreSQL required)
 */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const pgStub = require('./helpers/supabase-pg-stub.cjs');
const ROOT = path.resolve(__dirname, '..');
const FILES = ['supabase/operations/20261101-account-sync-install.sql', 'supabase/operations/20261102-blog-ai-authorship-install.sql'];
const MARKDOWN = '20261105051632_life_post_markdown.sql';
const MARKDOWN_PUBLISH = '20261105081055_life_post_markdown_publish.sql';
const isPreMarkdown = file => ![MARKDOWN,MARKDOWN_PUBLISH].includes(path.basename(file));
const markdownFunctions = list => list.filter(f=>f.signature.includes('.markdown_') || f.signature.includes('.life_blog_markdown_'));
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
if (process.argv.length !== 2) throw Error('This isolated test accepts no arguments.');
const signatures = ['valid_document(jsonb,uuid)', 'publish(uuid,bigint,uuid,text[],jsonb,bigint)'];
const functions = async db => (await db.query("select n.nspname,p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','haedo_blog_private') order by 1,2")).rows;
const rows = async db => (await db.query(`select jsonb_build_object(${['posts','assets','receipts','publications','profiles'].map(name => `'${name}',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from haedo_blog_private.${name} t)`).join(',')}) data`)).rows[0].data;
const definition = async (db, name) => (await db.query('select pg_get_functiondef(to_regprocedure($1)) value', ['haedo_blog_private.' + name])).rows[0].value;
let passed = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); passed++; console.log('PASS ' + label); };
async function main() {
 if (!pgStub.findPostgres()) throw Error('Local PostgreSQL required; run in the pinned PostgreSQL test container when unavailable.');
 const pg = await pgStub.startReplayedCluster({ label: 'post-markdown-install' });
 try {
  const database = await pg.cloneDatabase('markdown_install'), db = await pg.connect(database);
  try {
   const owner = randomUUID(), workspace = randomUUID(), post = randomUUID();
   const doc = { format: 'life-post-md-v1', id: post, revision: 1, title: '설치 보존 표본', status: 'saved', replaces: null,
    createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z', markdown: '본문\n', photos: [], attachments: [], archived: false };
   const rpc = async (name, args) => {
    await db.query('begin');
    try {
     await db.query('set local role authenticated');
     await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)", [owner]);
     const result = (await db.query(`select public.${name}(${args.map((_,i) => '$' + (i+1)).join(',')}) value`,args)).rows[0].value;
     await db.query('commit'); return result;
    } catch (error) { await db.query('rollback'); throw error; }
   };
   check((await rpc('life_blog_save',[workspace,post,0,randomUUID(),doc])).status,'stored','populated Markdown fixture saved before operations replay');
   for (const file of FILES) {
    const before = await functions(db), saved = await rows(db);
    await db.query(read(file));
    // Account install intentionally restores pre-AI definitions for unrelated
    // functions until later installs; the two D2 functions must independently
    // stay exact, not merely recover after a later install.
    const after = await functions(db);
    for (const signature of signatures) check(after.find(f => f.signature === 'haedo_blog_private.' + signature), before.find(f => f.signature === 'haedo_blog_private.' + signature), path.basename(file) + ': retains ' + signature);
    check(markdownFunctions(after),markdownFunctions(before),path.basename(file) + ': B3 parser trigger and private/public projection helpers stay exact');
    check(await rows(db),saved,path.basename(file) + ': populated rows unchanged');
    check((await rpc('life_blog_read',[post])).data,doc,path.basename(file) + ': exact Markdown still reads');
    const update = { ...doc, revision: 2, markdown: '본문 다음\n' };
    const current = (await rpc('life_blog_read',[post])).revision;
    check((await rpc('life_blog_save',[workspace,post,current,randomUUID(),update])).status,'stored',path.basename(file) + ': Markdown update still validates');
    await assert.rejects(() => rpc('life_blog_publish',[post,current+1,randomUUID(),[],{name:'',intro:''},0]), e=>e.code==='22023' && e.message==='life_blog_markdown_publication_unavailable');
    passed++; console.log('PASS ' + path.basename(file) + ': explicit publication refusal retained');
    await assert.rejects(() => rpc('life_blog_publish_copies',[post,current+1,randomUUID(),[],{name:'',intro:''},0,{}]), e=>e.code==='22023' && e.message==='life_blog_markdown_publication_unavailable');
    passed++; console.log('PASS ' + path.basename(file) + ': copies publication refusal retained');
    const { markdown, ...legacy } = update;
    legacy.format='life-photo-post-v2'; legacy.ops=[{insert:'old client\n'}];
    await assert.rejects(() => rpc('life_blog_save',[workspace,post,current+1,randomUUID(),legacy]), e=>e.code==='22023' && e.message==='life_blog_update_required');
    passed++; console.log('PASS ' + path.basename(file) + ': same-revision old-client downgrade rejected');
    // Keep the expected doc exact for the next independent replay.
    await rpc('life_blog_save',[workspace,post,current+1,randomUUID(),doc]);
   }
  } finally { await db.end(); }
  for (const variant of ['drifted-valid','partial-old-valid','partial-old-publish','missing-helper','pre-d2-drifted-valid','pre-d2-drifted-publish']) {
   let name = 'markdown_' + variant.replaceAll('-','_');
   if (variant.startsWith('pre-d2-')) {
    const admin=await pg.connect();try{await admin.query('create database '+name);}finally{await admin.end();}
   } else name = await pg.cloneDatabase(name);
   const partial = await pg.connect(name);
   try {
    if (variant.startsWith('pre-d2-')) {
     await pgStub.replayMigrations(partial,{files:pgStub.migrationFiles().filter(isPreMarkdown)});
     const signature=variant.endsWith('valid')?signatures[0]:signatures[1];
     await partial.query((await definition(partial,signature)).replace('\nbegin\n','\nbegin\n -- unexpected operator drift\n'));
    }
    else if (variant === 'missing-helper') await partial.query('drop function haedo_blog_private.valid_delta_document(jsonb,uuid)');
    else if (variant === 'drifted-valid') await partial.query((await definition(partial,signatures[0])).replace('\nbegin\n','\nbegin\n -- unexpected operator drift\n'));
    else {
     const fn = variant === 'partial-old-valid' ? 'valid_document' : 'publish';
     const source=read('supabase/migrations/20261102110000_life_blog_ai_authorship.sql'),start=source.indexOf('create or replace function haedo_blog_private.'+fn+'(');
     assert(start>=0);const end=source.indexOf('end $$;',start);assert(end>start);await partial.query(source.slice(start,end+8));
    }
    for(const file of FILES) {
     const before=await functions(partial),saved=await rows(partial);
     await assert.rejects(()=>partial.query(read(file)),/differs from the repository definition/);
     passed++;console.log('PASS '+path.basename(file)+': rejects '+variant);
     check(await functions(partial),before,path.basename(file)+': '+variant+' definitions unchanged');
     check(await rows(partial),saved,path.basename(file)+': '+variant+' rows unchanged');
    }
   } finally { await partial.end(); }
  }
  const admin=await pg.connect();
  try{await admin.query('create database markdown_fresh_install');}finally{await admin.end();}
  const fresh=await pg.connect('markdown_fresh_install');
  try{
   await pgStub.replayMigrations(fresh,{files:pgStub.migrationFiles().filter(isPreMarkdown)});
   const before=await functions(fresh),saved=await rows(fresh);
   for(const file of FILES)await fresh.query(read(file));
   check(await functions(fresh),before,'fresh pre-D2 installation keeps exact pre-D2 function catalog');
   check(await rows(fresh),saved,'fresh pre-D2 installation preserves all rows');
   check((await fresh.query("select to_regprocedure('haedo_blog_private.valid_delta_document(jsonb,uuid)') value")).rows[0].value,null,'fresh pre-D2 installation has no new helper dependency');
   const result=[].concat(await fresh.query(read('supabase/tests/blog-ai-authorship.sql'))).filter(x=>x.rows?.length).at(-1).rows[0].result;
   check(result.failures,0,'fresh pre-D2 legacy AI validation/public projection ('+result.passed+' assertions)');
   await fresh.query(read('supabase/migrations/'+MARKDOWN));
   await fresh.query(read('supabase/migrations/'+MARKDOWN_PUBLISH));
   const full=await pg.connect(pg.database);
   try{check(await functions(fresh),await functions(full),'installers then B1 and B3 migrations produce exact latest function catalog');}finally{await full.end();}
  }finally{await fresh.end();}
  // First installation, not just reinstallation: start before the six account
  // migrations and compare the operations path to those immutable migrations.
  const create=await pg.connect();
  try{await create.query('create database markdown_first_install');await create.query('create database markdown_first_expected');}finally{await create.end();}
  const first=await pg.connect('markdown_first_install'),expected=await pg.connect('markdown_first_expected');
  try{
   const beforeAccount=pgStub.migrationFiles().filter(file=>path.basename(file)<'20261101090000');
   await pgStub.replayMigrations(first,{files:beforeAccount});
   await pgStub.replayMigrations(expected,{files:beforeAccount});
   const originals=['20261101090000_life_account_documents.sql','20261101091500_life_blog_account_sync.sql','20261101130000_life_material_tombstones.sql','20261101140000_life_sync_edit_times.sql','20261101150000_life_account_documents_owner_lock.sql','20261101160000_life_blog_delete_guard.sql','20261102110000_life_blog_ai_authorship.sql'];
   for(const name of originals)await expected.query(read('supabase/migrations/'+name));
   for(const file of FILES)await first.query(read(file));
   check(await functions(first),await functions(expected),'first account+AI install matches original migration function definitions and ACLs');
   check(await rows(first),await rows(expected),'first account+AI install preserves original empty blog rows');
   const result=[].concat(await first.query(read('supabase/tests/blog-ai-authorship.sql'))).filter(x=>x.rows?.length).at(-1).rows[0].result;
   check(result.failures,0,'first installation preserves legacy v2 AI/publication ('+result.passed+' assertions)');
  }finally{await first.end();await expected.end();}
  console.log(JSON.stringify({passed,failures:0,scope:'isolated PostgreSQL; historical installers on complete, partial, drifted and pre-D2 schemas'}));
 } finally { await pg.stop(); }
}
main().catch(error => { console.error(error); process.exitCode=1; });

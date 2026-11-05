/* B3 SQL contract, disposable PostgreSQL only; no endpoint/credential options.
 * Run with native PG17 or in the repository's pinned PG17.11 test container.
 * Absence of PostgreSQL is a failure, never a successful SKIP.
 */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { startCluster } = require('./helpers/supabase-pg-stub.cjs');
const { Client } = require('./sql-ci/node_modules/pg');
const ROOT = path.resolve(__dirname, '..');
const FILE = 'supabase/migrations/20261105081055_life_post_markdown_publish.sql';
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const mutation=process.argv[2]?.replace(/^--mutation=/,'');
if(process.argv.length>3 || mutation && !['source-hash','copy-flag','session-recheck','commit-acl','commit-owner'].includes(mutation)) throw Error('Only named local guard mutations are accepted.');
function installation() {
 let sql=read(FILE);
 if(mutation==='source-hash')sql=sql.replace('if p_source_hash is distinct from encode','if false and p_source_hash is distinct from encode');
 if(mutation==='copy-flag')sql=sql.replace('and deleted_at is null and public_copy;','and deleted_at is null;');
 if(mutation==='session-recheck')sql=sql.replace("perform pg_advisory_xact_lock(hashtextextended('blog:'||who::text||':'||p_post_id::text,0));\n if not haedo_blog_private.markdown_session_live(who,p_session_id)","perform pg_advisory_xact_lock(hashtextextended('blog:'||who::text||':'||p_post_id::text,0));\n if false and not haedo_blog_private.markdown_session_live(who,p_session_id)");
 if(mutation==='commit-acl')sql=sql.replace('public.life_blog_markdown_publish_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb) to service_role;',
  'public.life_blog_markdown_publish_commit(uuid,bigint,uuid,text[],jsonb,bigint,jsonb,uuid,uuid,text,jsonb) to service_role,authenticated;');
 if(mutation==='commit-owner')sql=sql.replace('select * into p from haedo_blog_private.posts where owner_id=who and id=p_post_id for update;',
  'select * into p from haedo_blog_private.posts where id=p_post_id for update;');
 if(mutation)assert.notEqual(sql,read(FILE),'named mutation must change target guard');
 return sql;
}
let passed = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); passed++; console.log('PASS ' + label); };
// SQL Editor simulation: split only top-level semicolons, preserving SQL strings,
// dollar-quoted function/DO bodies, identifiers and comments. Each query commits
// independently; no surrounding BEGIN can hide a multipart installer failure.
function statements(sql) {
 const out=[];let start=0,quote=null;
 for(let i=0;i<sql.length;i++) {
  if(quote) {if(sql.startsWith(quote,i)) {if(quote.length===1 && sql[i+1]===quote){i++;continue;}i+=quote.length-1;quote=null;}continue;}
  if(sql.startsWith('--',i)){const end=sql.indexOf('\n',i);i=end<0?sql.length:end;continue;}
  if(sql.startsWith('/*',i)){const end=sql.indexOf('*/',i+2);assert(end>=0);i=end+1;continue;}
  if(sql[i]==="'"||sql[i]==='"'){quote=sql[i];continue;}
  const dollar=sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/);
  if(dollar){quote=dollar[0];i+=quote.length-1;continue;}
  if(sql[i]===';'){out.push(sql.slice(start,i+1));start=i+1;}
 }
 assert.equal(quote,null);assert.equal(sql.slice(start).trim(),'');return out;
}
async function main() {
 const pg = await startCluster({ label: 'markdown-publish' }), db = await pg.connect();
 try {
  for (const file of ['supabase/tests/blog-bootstrap.sql', 'supabase/migrations/20261017144744_life_blog_originals.sql',
   'supabase/migrations/20261101091500_life_blog_account_sync.sql', 'supabase/migrations/20261101160000_life_blog_delete_guard.sql',
   'supabase/migrations/20261102110000_life_blog_ai_authorship.sql', 'supabase/migrations/20261102120000_life_blog_public_photo_copies.sql',
   'supabase/migrations/20261105051632_life_post_markdown.sql']) await db.query(read(file));
  await db.query(`create table auth.users(id uuid primary key,is_anonymous boolean not null default false);
   create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,not_after timestamptz);
   create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
   create role markdown_client login inherit; grant authenticated to markdown_client;
   create role markdown_authenticator login noinherit; grant anon,authenticated,service_role to markdown_authenticator;`);
  const owner = randomUUID(), other = randomUUID(), sid = randomUUID(), otherSid = randomUUID(), workspace = randomUUID();
  await db.query('insert into auth.users(id) values($1),($2)', [owner,other]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2),($3,$4)', [sid,owner,otherSid,other]);
  const as = async (role, who, session, sql, values = [], connection = db) => {
   await connection.query('begin');
   try {
    if (role !== 'postgres') await connection.query('set local role ' + role);
    await connection.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role,sub:who,session_id:session })]);
    const result = await connection.query(sql, values); await connection.query('commit'); return result.rows[0]?.value;
   } catch (error) { await connection.query('rollback'); throw error; }
  };
  const rpc = (name,args,role='authenticated',who=owner,session=sid,connection=db) =>
   as(role,who,session,`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args,connection);
  const state = async () => (await db.query(`select jsonb_build_object(${['posts','assets','receipts','publications','profiles'].map(name=>`'${name}',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from haedo_blog_private.${name} t)`).join(',')}) value`)).rows[0].value;
  const acl = async () => (await db.query("select p.oid::regprocedure::text signature,p.proacl,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('haedo_blog_private','public') order by 1")).rows;
  const catalog = async () => (await db.query(`select 'function' kind,p.oid::regprocedure::text name,
   jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',p.proowner) detail
   from pg_proc p where p.pronamespace in ('public'::regnamespace,'haedo_blog_private'::regnamespace)
   union all select 'table',c.oid::regclass::text,jsonb_build_object('acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity)
   from pg_class c where c.relnamespace='haedo_blog_private'::regnamespace
   union all select 'trigger',t.tgname,jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled)
   from pg_trigger t where t.tgrelid in (select oid from pg_class where relnamespace='haedo_blog_private'::regnamespace)
   order by 1,2`)).rows;
  const denied = async (fn, message, label, code='22023') => {
   const before=await state(); await assert.rejects(fn,e=>e.message===message && e.code===code,label);
   check(await state(),before,label+' (all blog rows unchanged)');
  };
  const author = {name:'익명',intro:''};
  const document = (extra={}) => ({format:'life-post-md-v1',id:randomUUID(),revision:1,title:'검증 표본',status:'saved',replaces:null,
   createdAt:'2026-11-05T00:00:00.000Z',updatedAt:'2026-11-05T00:00:00.000Z',markdown:'본문\n',photos:[],attachments:[],archived:false,...extra});
  const save = (doc,expected=0) => rpc('life_blog_save',[workspace,doc.id,expected,randomUUID(),doc]);
  const args = (doc,extra={}) => {
   const r={revision:1,operation:randomUUID(),selected:[],author,publicRevision:0,copies:{},...extra};
   return [doc.id,r.revision,r.operation,r.selected,r.author,r.publicRevision,r.copies];
  };
  const prepare = (a,...rest) => rpc('life_blog_markdown_publish_prepare',a,...rest);
  const commit = (a,p,ops=[{insert:'본문\n'}],connection=db) => rpc('life_blog_markdown_publish_commit',
   [...a,p.ownerId,p.sessionId,p.sourceHash,JSON.stringify(ops)],'service_role',null,null,connection);
  const legacy=document({format:'life-photo-post-v2',ops:[{insert:'legacy\n'}]}); delete legacy.markdown;
  await save(legacy); const legacyReply=await rpc('life_blog_publish',args(legacy).slice(0,6));
  const before=await state(),beforeAcl=await acl();
  const legacyDefs=(await db.query("select oid::regprocedure::text signature,pg_get_functiondef(oid) definition from pg_proc where pronamespace='haedo_blog_private'::regnamespace and proname in ('publish','publish_copies','valid_document','valid_delta_document') order by 1")).rows;
  const migration=installation(),parts=statements(migration),beforeCatalog=await catalog();
  check(parts.length,1,'installer is exactly one top-level SQL Editor statement');
  const midFailure=migration.replace('create or replace function public.life_blog_markdown_publish_prepare(',
   'select 1/0;\ncreate or replace function public.life_blog_markdown_publish_prepare(');
  await assert.rejects(async()=>{for(const part of statements(midFailure)) await db.query(part);},e=>e.code==='22012');
  check(await catalog(),beforeCatalog,'mid-DDL failure rolls back every created/replaced function and grant');
  check(await state(),before,'mid-DDL failure preserves all populated row bytes');
  const changedRows=migration.replace('\n$markdown_ddl$;',"\nupdate haedo_blog_private.posts set data=jsonb_set(data,'{title}','\"mutation\"'::jsonb);\n$markdown_ddl$;");
  await assert.rejects(async()=>{for(const part of statements(changedRows)) await db.query(part);},e=>/Markdown publish install changed/.test(e.message));
  check(await catalog(),beforeCatalog,'same-count row hash failure rolls back all DDL');
  check(await state(),before,'same-count row hash failure restores exact source rows');
  const notifications=[];db.on('notification',message=>notifications.push(message.payload));await db.query('listen pgrst');
  for(const part of parts) await db.query(part);
  check(await state(),before,'populated installation preserves every original/publication/receipt row');
  check(notifications,['reload schema'],'successful atomic installation requests PostgREST schema reload');
  check((await acl()).filter(p=>beforeAcl.some(old=>old.signature===p.signature)),beforeAcl,'all existing routine ACL/security settings unchanged');
  check((await db.query("select oid::regprocedure::text signature,pg_get_functiondef(oid) definition from pg_proc where pronamespace='haedo_blog_private'::regnamespace and proname in ('publish','publish_copies','valid_document','valid_delta_document') order by 1")).rows,legacyDefs,'all four B1 legacy function definitions byte-exact');
  check((await rpc('life_blog_public_read',[legacyReply.token],'anon',null,null)).snapshot.ops,[{insert:'legacy\n'}],'legacy public bytes remain readable');
  await db.query(migration); check(await state(),before,'idempotent installation preserves all rows');

  // This fixture installs all public blog entry points and their private
  // implementations. Conservatively forbid any dynamic EXECUTE or set_config
  // call in those deployed function bodies, not just a known attack string.
  // Installer DO statements are not callable RPCs and are outside this scan.
  const bodies=(await db.query("select oid::regprocedure::text signature,prosrc from pg_proc where pronamespace in ('public'::regnamespace,'haedo_blog_private'::regnamespace)")).rows;
  assert(bodies.some(row=>row.signature.startsWith('life_blog_markdown_publish_commit(')));
  check(bodies.filter(row=>/\b(?:execute\b|set_config\s*\()/i.test(row.prosrc.replace(/--[^\n]*/g,''))).map(row=>row.signature),[],
   'public blog RPCs and private implementations expose no dynamic SQL or configuration setter');

  const doc=document(); await save(doc); const intent=args(doc), prepared=await prepare(intent);
  check({...prepared,sourceHash:null},{status:'prepared',ownerId:owner,sessionId:sid,revision:1,document:doc,sourceHash:null},'prepare uses stored document and database-derived identity');
  check(/^[a-f0-9]{64}$/.test(prepared.sourceHash),true,'prepare returns bounded SHA256 of whole stored document');
  check(await prepare(intent,'authenticated',other,otherSid),{status:'missing'},'other owner cannot read prepared document');
  const otherDoc=document({title:'다른 계정 글'}),otherIntent=args(otherDoc);
  await rpc('life_blog_save',[workspace,otherDoc.id,0,randomUUID(),otherDoc],'authenticated',other,otherSid);
  const otherPrepared=await prepare(otherIntent,'authenticated',other,otherSid),beforeWrongOwner=await state();
  let wrongOwnerResult;
  await assert.doesNotReject(async()=>{wrongOwnerResult=await commit(otherIntent,{...otherPrepared,ownerId:owner,sessionId:sid});},
   'cross-owner service commit must return missing before touching another owner post');
  check(wrongOwnerResult,{status:'missing'},
   'service commit with A owner/session and B post returns missing');
  check(await state(),beforeWrongOwner,'cross-owner service commit changes no original/profile/publication/receipt rows');
  await denied(()=>prepare(intent,'anon',null,null),'permission denied for function life_blog_markdown_publish_prepare','anonymous prepare denied','42501');
  await denied(()=>prepare(intent,'authenticated',owner,null),'life_auth_required','missing user session denied','42501');
  await denied(()=>prepare(intent,'authenticated',owner,otherSid),'life_auth_required','cross-owner session denied','42501');
  await denied(()=>rpc('life_blog_markdown_publish_commit',[...intent,owner,sid,prepared.sourceHash,'[]']),
   'permission denied for function life_blog_markdown_publish_commit','authenticated projected-ops forgery denied','42501');
  await denied(()=>rpc('life_blog_markdown_publish_commit',[...intent,owner,sid,prepared.sourceHash,'[]'],'anon',null,null),
   'permission denied for function life_blog_markdown_publish_commit','anonymous projected-ops forgery denied','42501');
  await denied(()=>prepare(intent,'service_role',owner,sid),'permission denied for function life_blog_markdown_publish_prepare','service role cannot use user prepare capability','42501');
  await denied(()=>rpc('life_blog_publish_copies',intent),'life_blog_markdown_publication_unavailable','legacy Markdown publish stays explicitly blocked');
  await denied(()=>prepare(args(legacy,{publicRevision:1})),'life_blog_update_required','Markdown endpoint refuses unsupported legacy format');
  for (const [change,label] of [[{title:'changed'},'title'],[{markdown:'다른 본문\n'},'source'],[{attachments:[{type:'book',title:'책',creator:'',url:''}]},'attachments']]) {
   await db.query('update haedo_blog_private.posts set data=data||$1 where owner_id=$2 and id=$3',[change,owner,doc.id]);
   check(await commit(intent,prepared),{status:'conflict',revision:1},'whole document hash catches same-revision '+label+' change');
   await db.query('update haedo_blog_private.posts set data=$1 where owner_id=$2 and id=$3',[doc,owner,doc.id]);
  }
  for (const [ops,label] of [ [[{insert:'본문\n',attributes:{author:'ai'}}]], [[{insert:'본문\n',secret:'private'}]],
   [[{insert:'본문\n',attributes:{link:'javascript:alert(1)'}}]], [[{insert:'x'.repeat(50001)+'\n'}]], [Array.from({length:5001},()=>({insert:'\n'}))], [[{insert:'no newline'}]] ].map((x,i)=>[x[0],['AI marker','unknown op key','unsafe URL','decoded text overflow','operation overflow','incomplete text paragraph'][i]])) {
   await denied(()=>commit(intent,prepared,ops),'life_invalid_request',label+' rejected before publication');
  }
  await db.query('update auth.sessions set not_after=now()-interval \'1 second\' where id=$1',[sid]);
  await denied(()=>commit(intent,prepared),'life_auth_required','session expiry between prepare and commit denied','42501');
  await db.query('update auth.sessions set not_after=null where id=$1',[sid]);
  await db.query('update auth.users set is_anonymous=true where id=$1',[owner]);
  await denied(()=>commit(intent,prepared),'life_auth_required','anonymous Auth user cannot commit','42501');
  await db.query('update auth.users set is_anonymous=false where id=$1',[owner]);
  const waiting=await pg.connect();
  try {
   await db.query('begin');
   await db.query("select pg_advisory_xact_lock(hashtextextended('blog:'||$1||':'||$2,0))",[owner,doc.id]);
   const outcome=commit(intent,prepared,[{insert:'본문\n'}],waiting).then(value=>({value}),error=>({error}));
   for(let attempt=0;;attempt++) {
    const row=(await db.query('select wait_event from pg_stat_activity where pid=$1',[waiting.processID])).rows[0];
    if(row?.wait_event==='advisory')break;
    assert(attempt<100,'commit must reach advisory wait');await new Promise(resolve=>setTimeout(resolve,20));
   }
   await db.query('delete from auth.sessions where id=$1',[sid]);await db.query('commit');
   const result=await outcome;check(result.error?.message,'life_auth_required','session revoked while waiting for post lock is freshly rechecked');
   await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[sid,owner]);
  } finally { await db.query('rollback');await waiting.end(); }
  const publicResult=await commit(intent,prepared);
  check(publicResult.status,'stored','service commit crosses parser trigger with native role');
  check((await rpc('life_blog_public_read',[publicResult.token],'anon',null,null)).snapshot,
   {format:'life-blog-public-v1',title:doc.title,ops:[{insert:'본문\n'}],photos:[],attachments:[],author},'exact existing public snapshot format with no private source');
  const afterPublish=await state();
  check(await commit(intent,{...prepared,sourceHash:'late-hash'},[]),publicResult,'same intent replays exact receipt before new projection/hash');
  check(await state(),afterPublish,'receipt replay changes no profile/publication/receipt rows');
  const changed={...doc,revision:2,markdown:'새 원문\n'}; await save(changed,1);
  check(await prepare(intent),publicResult,'lost response prepare replays before newer source revision');
  check(await commit(intent,prepared),publicResult,'lost response commit replays before newer source revision');
  await denied(()=>prepare([...intent.slice(0,4),{name:'different',intro:''},...intent.slice(5)]),'life_operation_mismatch','operation cannot be reused for different intent');
  await db.query('delete from auth.sessions where id=$1',[sid]);
  await denied(()=>prepare(intent),'life_auth_required','receipt does not bypass revoked session','42501');
  await denied(()=>commit(intent,prepared),'life_auth_required','commit receipt does not bypass revoked session','42501');
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[sid,owner]);
  const late=args(doc,{revision:2,publicRevision:1}),latePrepared=await prepare(late);
  await rpc('life_blog_unpublish',[doc.id,1,randomUUID()]);
  check(await commit(late,latePrepared,[{insert:'새 원문\n'}]),{status:'conflict',revision:2},'late response cannot republish after withdrawal');
  check(await prepare(intent),publicResult,'withdrawn publication still returns exact completed receipt');

  // Supabase/PostgREST's authenticator is a member of service_role. It can
  // switch roles with arbitrary SQL, but a verified user request is dispatched
  // as authenticated and has no arbitrary-SQL RPC. Model both facts explicitly.
  const gateway=new Client({host:pg.host,port:pg.port,user:'markdown_authenticator',database:'postgres'});await gateway.connect();
  try {
   await denied(()=>rpc('life_blog_markdown_publish_commit',[...intent,owner,sid,prepared.sourceHash,'[]'],'authenticated',owner,sid,gateway),
    'permission denied for function life_blog_markdown_publish_commit','authenticator dispatched as authenticated cannot commit','42501');
   await gateway.query('begin');await gateway.query('set local role authenticated');
   check((await gateway.query("select set_config('role','service_role',true) value")).rows[0].value,'service_role',
    'authenticator can promote role with arbitrary SQL; no such client RPC exists');
   await gateway.query('rollback');
  } finally {await gateway.end();}
  // A direct SQL login with only authenticated membership is a separate,
  // narrower model; these checks do not stand in for the authenticator above.
  const login = new Client({host:pg.host,port:pg.port,user:'markdown_client',database:'postgres'}); await login.connect();
  try {
   await assert.rejects(()=>login.query('set role service_role'),e=>e.code==='42501'); passed++; console.log('PASS authenticated membership cannot SET ROLE service_role');
   await assert.rejects(()=>login.query("select set_config('role','service_role',false)"),e=>e.code==='42501'); passed++; console.log('PASS authenticated membership cannot forge native role via set_config');
   await login.query("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)");
   check((await login.query("select current_setting('role') value")).rows[0].value,'none','forged JWT role cannot change native role');
  } finally { await login.end(); }
  await db.query(`create function public.test_definer_role() returns text language plpgsql security definer as $$begin
   perform set_config('role','service_role',true); return current_setting('role'); end$$;`);
  await denied(()=>as('authenticated',owner,sid,'select public.test_definer_role() value'),'cannot set parameter "role" within security-definer function','definer cannot promote role','42501');

  // Originals plus metadata-free copies, deliberately reversed selection order.
  const media=(id,digest,type='image/jpeg')=>({id,name:'private-'+id,type,width:4,height:3,size:20,digest:digest.repeat(64)});
  const p1=media('first','a'),p2=media('second','b','image/heic'); p2.view={type:'image/jpeg',width:4,height:3,size:21,digest:'c'.repeat(64)};
  const photoDoc=document({title:'사진',markdown:'![첫](haedo-photo:first "첫 설명")\n![둘](haedo-photo:second "둘 설명")\n',photos:[p1,p2]});
  const putAsset=async (p,copy=false) => {
   const result=await rpc(copy?'life_blog_publish_prepare_copy':'life_blog_prepare_asset',[photoDoc.id,p.id,p.digest,p.size,p.type,p.width,p.height]);
   await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3) on conflict(bucket_id,name) do nothing',[result.bucket,result.path,{size:p.size,mimetype:p.type}]);
   return result;
  };
  await putAsset(p1); await putAsset(p2); await putAsset({...p2.view,id:p2.id}); await save(photoDoc);
  const copy1={type:'image/jpeg',width:4,height:3,size:18,digest:'d'.repeat(64)},copy2={type:'image/jpeg',width:4,height:3,size:19,digest:'e'.repeat(64)};
  const location1=await putAsset({...copy1,id:p1.id},true); await putAsset({...copy2,id:p2.id},true);
  const photoArgs=args(photoDoc,{selected:['second','first'],copies:{first:copy1,second:copy2}}),photoPrepared=await prepare(photoArgs);
  const photoOps=[{insert:{photo:{id:'first',caption:'첫 설명',alt:'첫'}}},{insert:{photo:{id:'second',caption:'둘 설명',alt:'둘'}}}];
  await denied(()=>commit(photoArgs,photoPrepared,[photoOps[0]]),'life_blog_unknown_photo','selected photo set must equal projected photo set');
  await denied(()=>commit(photoArgs,photoPrepared,[photoOps[0],photoOps[0]]),'life_blog_unknown_photo','duplicate projected photo rejected');
  const missingCopy=[...photoArgs]; missingCopy[6]={first:copy1};
  await denied(()=>prepare(missingCopy),'life_invalid_request','copy keys must exactly equal selection');
  for(const [bad,label] of [[{...copy1,name:'private.jpg'},'private filename'],[{...copy1,digest:'short'},'bad digest'],[{...copy1,size:0},'zero bytes'],[{...copy1,width:0},'zero dimensions'],[{...copy1,type:'image/webp'},'unsupported public MIME']]) {
   const invalid=[...photoArgs];invalid[6]={first:bad,second:copy2};
   await denied(()=>prepare(invalid),'life_invalid_request','copy '+label+' rejected');
  }
  await db.query('update haedo_blog_private.assets set public_copy=false where path=$1',[location1.path]);
  await denied(()=>commit(photoArgs,photoPrepared,photoOps),'life_blog_assets_incomplete','registered original cannot masquerade as public copy');
  await db.query('update haedo_blog_private.assets set public_copy=true where path=$1',[location1.path]);
  await db.query("update storage.objects set metadata=jsonb_set(metadata,'{size}','999'::jsonb) where name=$1",[location1.path]);
  await denied(()=>commit(photoArgs,photoPrepared,photoOps),'life_blog_assets_incomplete','copy storage metadata must match immutable registration');
  await db.query('update storage.objects set metadata=$1 where name=$2',[{size:copy1.size,mimetype:copy1.type},location1.path]);
  await db.query('delete from storage.objects where name=$1',[location1.path]);
  await denied(()=>commit(photoArgs,photoPrepared,photoOps),'life_blog_assets_incomplete','missing copy object rolls back profile and publication');
  await putAsset({...copy1,id:p1.id},true);
  const photoResult=await commit(photoArgs,photoPrepared,photoOps);
  const publicPhoto=(await rpc('life_blog_public_read',[photoResult.token],'anon',null,null)).snapshot;
  check(publicPhoto.photos.map(p=>p.digest),[copy1.digest,copy2.digest],'public IDs/photos follow original document order despite reversed selection');
  check(publicPhoto.ops.map(op=>op.insert.photo.id),publicPhoto.photos.map(p=>p.id),'captions and photos retain exact mapping');
  check(publicPhoto.ops.map(op=>op.insert.photo.caption),['첫 설명','둘 설명'],'photo-ending projection preserves captions and adds no visible newline');
  check(publicPhoto.photos.every(p=>!('name'in p)&&!('view'in p)&&!('blob'in p)&&!['first','second'].includes(p.id)),true,'public metadata excludes private filename/IDs/view');
  const resolved=await rpc('life_blog_public_media',[photoResult.token,publicPhoto.photos[0].id],'service_role',null,null);
  check(resolved.path,location1.path,'anonymous media route resolves only selected public-copy object');
  check('copy'in resolved,false,'private resolver marker omitted');
  const omissionArgs=args(photoDoc,{publicRevision:1}),omissionPrepared=await prepare(omissionArgs);
  const titleOnly=await commit(omissionArgs,omissionPrepared,[]);
  check((await rpc('life_blog_public_read',[titleOnly.token],'anon',null,null)).snapshot.ops,[],'omitting all photos preserves empty visible ops when title remains');
  const maxArgs=args(photoDoc,{publicRevision:2,selected:['first'],copies:{first:copy1}}),maxPrepared=await prepare(maxArgs);
  const maxOps=[{insert:'x'.repeat(45001)+'\n'},...Array.from({length:4998},()=>({insert:'x'})),photoOps[0]];
  const maximum=await commit(maxArgs,maxPrepared,maxOps);
  const maxSnapshot=(await rpc('life_blog_public_read',[maximum.token],'anon',null,null)).snapshot;
  check(maxSnapshot.ops.length,5000,'5,000 actual ops accepted with photo at end');
  check(maxSnapshot.ops.slice(0,-1),maxOps.slice(0,-1),'50,000 characters keep operation boundaries; validation moves no visible paragraph');
  check(typeof maxSnapshot.ops.at(-1).insert,'object','limit-bound photo-ending projection gets no added visible newline');

  const noContent=document({title:'',markdown:'![첫](haedo-photo:first "첫 설명")\n',photos:[p1]});
  // This post reuses only the synthetic metadata, never another post's assets.
  const original=await rpc('life_blog_prepare_asset',[noContent.id,p1.id,p1.digest,p1.size,p1.type,p1.width,p1.height]);
  await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[original.bucket,original.path,{size:p1.size,mimetype:p1.type}]);
  await save(noContent); const emptyArgs=args(noContent),emptyPrepared=await prepare(emptyArgs);
  await denied(()=>commit(emptyArgs,emptyPrepared,[]),'life_invalid_request','all photos omitted with no title/text/attachment cannot publish empty page');

  // Identical concurrent operations share a receipt; different operations race
  // on the same publication revision, so one stores and the other conflicts.
  const concurrent=document(); await save(concurrent); const concurrentArgs=args(concurrent),cp=await prepare(concurrentArgs);
  const connection=await pg.connect();
  try {
   const results=await Promise.all([commit(concurrentArgs,cp),commit(concurrentArgs,cp,[{insert:'본문\n'}],connection)]);
   check(results[0],results[1],'concurrent duplicate commits return one exact receipt');
   const next=args(concurrent,{publicRevision:1}),np=await prepare(next),competing=[...next];competing[2]=randomUUID();
   const race=await Promise.all([commit(next,np),commit(competing,np,[{insert:'본문\n'}],connection)]);
   check(race.map(x=>x.status).sort(),['conflict','stored'],'concurrent distinct intents respect publication revision CAS');
  } finally { await connection.end(); }
  console.log(`PASS Markdown public SQL contract: ${passed} checks; ${ (await db.query('show server_version')).rows[0].server_version }`);
 } finally { await db.end(); await pg.stop(); }
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});

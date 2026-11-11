/* Actual UI → shared SDK/IndexedDB → actual Edge handlers → isolated PostgreSQL
 * → anonymous public reader. Auth/Storage HTTP uses synthetic fixtures only.
 * BASE_URL=http://127.0.0.1:4173 BLOG_POSTGRES_CONTAINER=haedo-blog-postgres-...
 * BLOG_POSTGRES_DATABASE=haedo_blog_qa_... node tests/blog-publish-pending-browser.cjs
 * --prepare-database creates a fresh isolated DB; it refuses an existing name. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4192';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { openBlogMenu } = require('./helpers/feature-menus.cjs');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const { MarkdownPublishCloud, syntheticSession, SESSION_IDS } = require('./helpers/post-markdown-publish-cloud.cjs');
const output = path.resolve(process.env.PUBLISH_PENDING_OUTPUT || '.local/blog-publish-pending');
const report = { pass: false, checks: [], consoleErrors: [], pageErrors: [], external: [], expectedTransportErrors: [],
  scope: 'Historical pending fixture only; all completion is actual app/SDK/IndexedDB, publication/media Edge code and isolated PostgreSQL. Synthetic Auth and Storage HTTP; no hosted account, operation, deployment or Apple device.' };
// The existing SQL transport returns psql diagnostics; normalize them to the
// exact PostgREST error envelope, just as MarkdownPublishCloud.edgeFetch does.
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
class PendingCloud extends MarkdownPublishCloud {
  constructor(options){super(options);this.expected=[];this.legacy=[];this.abortLegacy=false;this.legacyGate=null;this.activeGates=new Set();this.cancelledOperations=new Set();this.cancelledResponses=0;this.expectedResponses=0;}
  consumeExpected(url,message){const i=this.expected.findIndex(e=>e.url===url&&message.includes(e.marker));if(i<0)return false;this.expected.splice(i,1);return true;}
  holdLegacy(){const gate={entered:deferred(),release:deferred()};this.activeGates.add(gate);return this.legacyGate=gate;}
  async handle(route,device){
    const request=route.request(),url=new URL(request.url()),rpc=url.pathname.split('/').at(-1);
    if(request.method()!=='POST'||!['life_blog_publish','life_blog_publish_copies'].includes(rpc))return super.handle(route,device);
    const body=request.postDataJSON(),owner=this.owner(request),call={device,rpc,owner,body:structuredClone(body)};this.legacy.push(call);
    let result,status=200;
    try{result=this.rpc(owner,rpc,body);call.status=result?.status;}
    catch(error){if(error instanceof assert.AssertionError)throw error;status=error.code==='42501'?403:400;result={code:error.code,message:error.message.match(/ERROR:\s+[0-9A-Z]{5}:\s*([^\n]+)/)?.[1]||'Synthetic SQL error'};call.error={...result};}
    if(this.legacyGate){const gate=this.legacyGate;this.legacyGate=null;gate.entered.resolve(call);await gate.release.promise;this.activeGates.delete(gate);}
    if(this.cancelledOperations.has(body.p_operation_id)){this.cancelledResponses++;return route.abort('aborted').catch(()=>{});}
    if(this.abortLegacy){this.abortLegacy=false;this.expectedResponses++;this.expected.push({url:request.url(),marker:'ERR_FAILED'});return route.abort('failed');}
    if(status>=400){this.expectedResponses++;this.expected.push({url:request.url(),marker:String(status)});}
    return route.fulfill({status,headers:{'access-control-allow-origin':'*','content-type':'application/json','cache-control':'no-store'},body:JSON.stringify(result)});
  }
}
async function main() {
  assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname));
  const server = new PendingCloud({ container: process.env.BLOG_POSTGRES_CONTAINER, database: process.env.BLOG_POSTGRES_DATABASE });
  if (process.argv.includes('--prepare-database')) {
    server.docker(['exec', '-i', server.container, 'createdb', '-U', 'postgres', server.database]);
    const apply = sql => server.docker(['exec', '-i', server.container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '--dbname', server.database], sql);
    for (const file of ['supabase/tests/blog-bootstrap.sql',
      'supabase/migrations/20261017144744_life_blog_originals.sql', 'supabase/migrations/20261101091500_life_blog_account_sync.sql',
      'supabase/migrations/20261101160000_life_blog_delete_guard.sql', 'supabase/migrations/20261102110000_life_blog_ai_authorship.sql',
      'supabase/migrations/20261102120000_life_blog_public_photo_copies.sql', 'supabase/migrations/20261105051632_life_post_markdown.sql'])
      apply(await fs.readFile(path.resolve(__dirname, '..', file), 'utf8'));
    apply("create table auth.users(id uuid primary key,is_anonymous boolean not null default false); create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz); " +
      "create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$; grant execute on function auth.jwt() to authenticated,service_role;");
    apply(await fs.readFile(path.resolve(__dirname, '../supabase/migrations/20261105081055_life_post_markdown_publish.sql'), 'utf8'));
  }
  await server.initialize(); assert.equal(server.sql('select count(*)::int from haedo_blog_private.posts;'),0,'Every run needs a fresh QA database: Storage fixture bytes live only for this run.'); await fs.mkdir(output, { recursive: true });
  report.testHash=createHash('sha256').update(await fs.readFile(__filename)).digest('hex');
  report.sources = [];
  for (const file of ['assets/life/blog.js', 'assets/life/post-markdown.js', 'assets/life/blog-remote.js', 'assets/life/blog-sync.js', 'assets/life/blog-manager.js']) {
    const response = await fetch(base + '/' + file); assert(response.ok);
    const actual = Buffer.from(await response.arrayBuffer()), expected = await fs.readFile(path.resolve(__dirname, '..', file));
    const sha = value => createHash('sha256').update(value).digest('hex');
    assert.equal(sha(actual), sha(expected), 'Serve this exact checkout: ' + file); report.sources.push({ file, sha256: sha(expected) });
  }
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); const contexts = [];
  async function device(name, width, account = accounts.a) {
    const context = await makeContext(browser, server, name, account, { viewport: { width, height: 1000 } }); contexts.push(context);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback();
      report.external.push(url.origin); return route.abort();
    });
    if (process.env.PUBLISH_PENDING_SYNC_MUTANT) await context.route(base+'/assets/life/blog-sync.js',route=>route.fulfill({contentType:'application/javascript',path:path.resolve(process.env.PUBLISH_PENDING_SYNC_MUTANT)}));
    if (!account) await context.addInitScript(() => {
      for (const key of ['indexedDB', 'localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw Error('Anonymous reader must not open private storage: ' + key); } });
    });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('requestfailed',request=>{if(request.failure()?.errorText==='net::ERR_ABORTED'&&/\/rpc\/life_blog_publish(?:_copies)?$/.test(request.url())){const operation=request.postDataJSON()?.p_operation_id;if(operation)server.cancelledOperations.add(operation);}});
    page.on('pageerror', error => report.pageErrors.push({ name, message: error.message }));
    page.on('console', event => {
      if (event.type() !== 'error') return;
      const entry = { name, message: event.text(), url: event.location().url };
      if (server.consumeExpected(entry.url,entry.message)) report.expectedTransportErrors.push(entry);
      else report.consoleErrors.push(entry);
    });
    if (account) {
      await page.goto(base + '/index.html'); await ready(page);
      await page.evaluate(async value => { const result = await HaedoAuth.client.auth.setSession(value); if (result.error) throw result.error; await HaedoAuth.verify(); }, syntheticSession(account));
    }
    return { page, context, name };
  }
  async function seed(page, label, legacy=false) {
    return page.evaluate(async ({label,legacy}) => {
      const L = HaedoLife, s = L.Shell.storage, ws = await s.getActive(), P = L.PhotoPost, photos = [];
      for (const [name, color] of [['A 빨강', '#dc1e1e'], ['B 초록', '#1eb43c']]) {
        const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 16;
        canvas.getContext('2d').fillStyle = color; canvas.getContext('2d').fillRect(0, 0, 24, 16);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        photos.push(await P.readPhoto(new File([blob], name + '.png', { type: 'image/png' }), L.Core.id));
      }
      const v2 = P.create(L.Core.id); v2.title = '서버 Markdown 공개 검수 ' + label; v2.status = 'saved'; v2.photos = photos;
      v2.ops = [{ insert: '직접 쓴 첫 문단\n' }, { insert: 'AI 도움 문장', attributes: { author: 'ai', bold: true } }, { insert: '\n' },
        { insert: { photo: { id: photos[1].id, caption: 'B 초록 설명', alt: 'B 초록 사진' } } },
        { insert: '사진 사이\n' }, { insert: { photo: { id: photos[0].id, caption: 'A 빨강 설명', alt: 'A 빨강 사진' } } }, { insert: '\n끝 문단\n' }];
      const md = legacy ? v2 : L.PostMarkdown.fromV2(v2).document; md.photos = photos;
      const saved = await s.savePhotoPost(ws, md, 0), sync = L.BlogSync.create({ storage: s, auth: HaedoAuth });
      try { await sync.saveDefault(ws, saved.id, { expectedLocalRevision: saved.revision }); } finally { sync.dispose(); }
      const doc = await s.readPhotoPost(ws, saved.id), state = await s.readBlogSyncState(ws, saved.id);
      return { ws, id: doc.id, photoIds: photos.map(photo => photo.id), private: L.Blog.pack(doc), state };
    }, {label,legacy});
  }
  async function manager(page, id) {
    await openBlogMenu(page); await page.getByRole('button', { name: '글 공개·보관', exact: true }).click();
    await page.locator('.blog-manager-list[data-state="ready"]').waitFor();
    await page.locator('.blog-post[data-post-id="' + id + '"]').getByRole('button', { name: '공개 내용 검토', exact: true }).click();
    await page.locator('.blog-manager-preview').waitFor();
  }
  async function preview(page, selected = []) {
    for (const checkbox of await page.locator('[data-photo-id]').all()) await checkbox.setChecked(selected.includes(await checkbox.getAttribute('data-photo-id')));
    await page.getByRole('button', { name: '공개 미리보기 갱신', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.blog-manager[aria-busy="true"]'));
    await page.getByRole('checkbox', { name: '이 내용을 공개합니다', exact: true }).check();
  }
  async function publish(page) {
    await page.getByRole('button', { name: '공개 게시·갱신', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.blog-manager[aria-busy="true"]'));
  }
  const state = (page, f) => page.evaluate(({ ws, id }) => HaedoLife.Shell.storage.readBlogSyncState(ws, id), f);
  const read = f => server.rpc(accounts.a.id, 'life_blog_read', { p_post_id: f.state.remoteId });
  async function publicPage(page, url) { await page.goto(url); await page.waitForFunction(() => document.querySelector('#blogStatus')?.dataset.state === 'published'); }
  async function unchanged(page, f) { const current=await page.evaluate(async ({ws,id})=>{const doc=await HaedoLife.Shell.storage.readPhotoPost(ws,id);return {manifest:HaedoLife.Blog.pack(doc),photos:await Promise.all(doc.photos.map(async p=>({expected:p.digest,actual:await HaedoLife.PhotoPost.digest(p.blob)})))};},f);assert.deepEqual(current.manifest,f.private);for(const photo of current.photos)assert.equal(photo.actual,photo.expected); }
  const pass = name => { report.checks.push({ name, pass: true }); console.log('PASS ' + name); };
  async function pendingFixture(page,f,photoIds=[],{missingCopies=false}={}) {
    return page.evaluate(async ({f,photoIds,missingCopies})=>{
      const L=HaedoLife,s=L.Shell.storage,doc=await s.readPhotoPost(f.ws,f.id),state=await s.readBlogSyncState(f.ws,f.id),copies=[];
      const remote=L.BlogRemote.create({auth:HaedoAuth});
      try {if(!missingCopies)for(const id of photoIds){const copy=await L.PhotoPost.publicCopy(doc.photos.find(p=>p.id===id));const {type,size,digest,width,height}=copy;const meta={id,type,size,digest,width,height};await remote.uploadPublicCopy(state.remoteId,meta,copy.blob);copies.push(meta);}}
      finally{remote.dispose();}
      const pending={operationId:L.Core.id(),expectedRevision:state.remoteRevision,expectedPublicRevision:state.publication?.revision||0,localRevision:doc.revision,selection:{photoIds,author:{name:'',intro:''}},...(copies.length?{copies}:{} )};
      await s.writeBlogSyncState(f.ws,f.id,{...state,publishPending:pending},state.revision);return pending;
    },{f,photoIds,missingCopies});
  }
  const busyDone=page=>page.waitForFunction(()=>!document.querySelector('.blog-manager[aria-busy="true"]'));
  const statusText=page=>page.locator('.blog-manager > [role="status"]').textContent();
  async function gateEntered(gate){let timer;try{return await Promise.race([gate.entered.promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Legacy RPC response gate not reached')),20000))]);}finally{clearTimeout(timer);}}
  async function snap(page,name){await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));scrollTo({top:0,behavior:'instant'});});await page.screenshot({path:path.join(output,name+'.png'),fullPage:false});}
  const receipts=(f,op)=>server.sql("select count(*)::int from haedo_blog_private.receipts where post_id='"+f.state.remoteId+"' and operation_id='"+op+"';");
  async function upgraded(page,f,pending){
    return page.evaluate(async({f,pending})=>{
      const L=HaedoLife,s=L.Shell.storage,old=await s.readPhotoPost(f.ws,f.id),md=L.PostMarkdown.fromV2(old).document;md.photos=old.photos;
      const saved=await s.savePhotoPost(f.ws,md,old.revision),sync=L.BlogSync.create({storage:s,auth:HaedoAuth});
      try{await sync.saveDefault(f.ws,saved.id,{expectedLocalRevision:saved.revision});}finally{sync.dispose();}
      const state=await s.readBlogSyncState(f.ws,f.id),historical={...pending,localRevision:saved.revision};
      // This is the historical migration boundary under test, not a completion:
      // retain the old wire request/receipt while its local document is now Markdown.
      await s.writeBlogSyncState(f.ws,f.id,{...state,publishPending:historical},state.revision);
      return {pending:historical,private:L.Blog.pack(saved),state};
    },{f,pending});
  }
  const check=async(name,run)=>{
    if(process.env.PUBLISH_PENDING_MATCH&&!new RegExp(process.env.PUBLISH_PENDING_MATCH).test(name))return;
    try{await run();pass(name);}catch(error){report.checks.push({name,pass:false,error:error.stack});console.error('FAIL '+name+'\n'+error.stack);}finally{server.beforeCommit=null;for(const gate of server.activeGates)gate.release.resolve();server.legacyGate=null;}
  };
  try {
    for(const width of [390,1440])await check('confirmed legacy rollback upgrades only the exact pending route '+width,async()=>{
      const owner=await device('pending-owner-'+width,width),visitor=await device('pending-visitor-'+width,width,null),page=owner.page;
      const f=await seed(page,'rollback-'+width),ids=width===390?[]:f.photoIds,pending=await pendingFixture(page,f,ids);
      await manager(page,f.id);await preview(page,ids);const edgeBefore=server.edgeRequests.length,legacyBefore=server.legacy.length;let promoted;server.beforeCommit=async()=>{promoted=(await state(page,f)).publishPending;};
      await publish(page);
      assert.equal(server.legacy.length,legacyBefore+1,'Replay the durable legacy request before changing its route');
      assert.equal(server.legacy.at(-1).error?.message,'life_blog_markdown_publication_unavailable');
      assert.equal(server.edgeRequests.length,edgeBefore+1,'Confirmed rollback resumes through Markdown Edge in the same explicit operation');
      assert.deepEqual(promoted,{...pending,documentFormat:'life-post-md-v1'},'Only documentFormat changes before the actual Edge commit');
      const request=server.edgeRequests.at(-1).body;
      assert.equal(request.p_operation_id,pending.operationId);assert.equal(request.p_expected_revision,pending.expectedRevision);assert.equal(request.p_expected_publication_revision,pending.expectedPublicRevision);
      assert.deepEqual(request.p_photo_ids,pending.selection.photoIds);assert.deepEqual(request.p_author,pending.selection.author);
      const named=Object.fromEntries((pending.copies||[]).map(({id,...copy})=>[id,copy]));assert.deepEqual(request.p_copies,named);
      assert.equal((await state(page,f)).publishPending,null);assert.equal(receipts(f,pending.operationId),1);
      const url=await page.getByRole('link',{name:'공개한 글 열기',exact:true}).getAttribute('href');await publicPage(visitor.page,url);
      assert.match(await visitor.page.locator('#blogContent').innerText(),/직접 쓴 첫 문단/);assert.match(await visitor.page.locator('#blogContent').innerText(),/AI 도움 문장/);
      assert.equal(await visitor.page.locator('#blogContent img').count(),ids.length);
      if(ids.length)await visitor.page.waitForFunction(()=>[...document.querySelectorAll('#blogContent img')].every(i=>i.complete&&i.naturalWidth===24&&i.naturalHeight===16));
      await unchanged(page,f);assert.equal(await visitor.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      await snap(page,'recovered-manager-'+width);await snap(visitor.page,'recovered-anonymous-'+width);
      report.recoveries||=[];report.recoveries.push({width,legacyCalls:1,edgeCalls:1,receiptCount:1,photos:ids.length,sameOperation:true});
      await owner.context.close();await visitor.context.close();
    });
    await check('lost legacy rejection ACK preserves the exact pending request until confirmed retry',async()=>{
      const owner=await device('pending-lost-ack',390),page=owner.page,f=await seed(page,'unknown-ack'),pending=await pendingFixture(page,f);
      await manager(page,f.id);await preview(page);const edgeBefore=server.edgeRequests.length;server.abortLegacy=true;await publish(page);
      assert.deepEqual((await state(page,f)).publishPending,pending);assert.equal(server.edgeRequests.length,edgeBefore);assert.equal(receipts(f,pending.operationId),0);
      // 2026-11-11: a publication failure no longer borrows the document-save message (it promised an automatic retry that never happens for publishing).
      assert.match(await statusText(page),/공개 게시 결과를 받지 못했습니다/);assert.doesNotMatch(await statusText(page),/자동으로 다시 시도/);await snap(page,'unknown-ack-preserved-390');await unchanged(page,f);
      await publish(page);assert.equal((await state(page,f)).publishPending,null);assert.equal(server.edgeRequests.length,edgeBefore+1);assert.equal(server.edgeRequests.at(-1).body.p_operation_id,pending.operationId);assert.equal(receipts(f,pending.operationId),1);
      await owner.context.close();
    });
    // 2026-11-11 (publication recovery): a completed request whose answer was lost is settled from the
    // server head (by the first cycle or when the review opens) instead of waiting for the owner to press
    // publish again. The completed legacy receipt is therefore recognized without sending it again through
    // either route; the earlier form of this check replayed it. A later explicit publication is an update
    // of the same public address through the Markdown route. The receipt replay itself stays covered by
    // tests/blog-publish-pending-recovery.test.cjs and the lost-ACK check above.
    await check('completed legacy receipt on a now-Markdown document is settled from the server head without any publication request',async()=>{
      const owner=await device('pending-completed-receipt',1440),page=owner.page,f=await seed(page,'receipt',true),pending=await pendingFixture(page,f);
      await manager(page,f.id);await preview(page);server.abortLegacy=true;await publish(page);
      assert.deepEqual((await state(page,f)).publishPending,pending);assert.equal(receipts(f,pending.operationId),1);
      const original=read(f).publication,converted=await upgraded(page,f,pending);f.private=converted.private;
      const legacyBefore=server.legacy.length,edgeBefore=server.edgeRequests.length;
      await page.reload();await ready(page);await manager(page,f.id);
      const settled=await state(page,f);
      assert.equal(settled.publishPending,null);assert.deepEqual(settled.publication,original,'the completed publication is recorded as the server holds it');
      assert.equal(await page.locator('.blog-manager-current').getAttribute('data-publication'),'public');
      assert.equal(server.legacy.length,legacyBefore,'the completed request is not sent again');assert.equal(server.edgeRequests.length,edgeBefore,'and is not replaced through Edge');
      assert.deepEqual(read(f).publication,original);assert.equal(receipts(f,pending.operationId),1);await unchanged(page,f);
      await preview(page);await publish(page);
      assert.equal(server.legacy.length,legacyBefore);assert.equal(server.edgeRequests.length,edgeBefore+1,'an explicit update uses the Markdown route');
      assert.notEqual(server.edgeRequests.at(-1).body.p_operation_id,pending.operationId);assert.equal(server.edgeRequests.at(-1).body.p_expected_publication_revision,original.revision);
      const updated=read(f).publication;assert.equal(updated.token,original.token,'the same public address');assert.equal(updated.revision,original.revision+1);assert.equal(updated.active,true);
      assert.equal((await state(page,f)).publishPending,null);await unchanged(page,f);
      await owner.context.close();
    });
    await check('missing historical public copies keep the pending intent and explain recovery',async()=>{
      const owner=await device('pending-missing-copies',390),page=owner.page,f=await seed(page,'missing-copies'),pending=await pendingFixture(page,f,f.photoIds,{missingCopies:true});
      await manager(page,f.id);await preview(page,f.photoIds);const edgeBefore=server.edgeRequests.length;await publish(page);
      assert.deepEqual((await state(page,f)).publishPending,pending);assert.equal(server.edgeRequests.length,edgeBefore);assert.equal(receipts(f,pending.operationId),0);
      assert.match(await statusText(page),/사진.*사본|사본.*사진/);assert.doesNotMatch(await statusText(page),/life_blog_|자동으로 다시 시도/);await unchanged(page,f);await snap(page,'missing-copies-390');
      await owner.context.close();
    });
    await check('a local revision change while rollback response waits preserves pending and the newer local text',async()=>{
      const owner=await device('pending-local-change',1440),page=owner.page,f=await seed(page,'local-change'),pending=await pendingFixture(page,f);
      await manager(page,f.id);await preview(page);const edgeBefore=server.edgeRequests.length,gate=server.holdLegacy();await page.getByRole('button',{name:'공개 게시·갱신',exact:true}).click();await gateEntered(gate);
      const changed=await page.evaluate(async f=>{const s=HaedoLife.Shell.storage,d=await s.readPhotoPost(f.ws,f.id);d.title+=' · 다른 합성 탭의 수정';const next=await s.savePhotoPost(f.ws,d,d.revision);return HaedoLife.Blog.pack(next);},f);
      gate.release.resolve();await busyDone(page);assert.equal(server.edgeRequests.length,edgeBefore);assert.deepEqual((await state(page,f)).publishPending,pending);assert.equal(receipts(f,pending.operationId),0);
      assert.deepEqual(await page.evaluate(async f=>HaedoLife.Blog.pack(await HaedoLife.Shell.storage.readPhotoPost(f.ws,f.id)),f),changed);
      await owner.context.close();
    });
    await check('legacy revision conflict keeps its exact pending request and cannot enter Edge',async()=>{
      const owner=await device('pending-revision-conflict',390),page=owner.page,f=await seed(page,'revision-conflict'),old=await pendingFixture(page,f);
      const pending=await page.evaluate(async({f,old})=>{const s=HaedoLife.Shell.storage,state=await s.readBlogSyncState(f.ws,f.id),next={...old,expectedRevision:old.expectedRevision+1};await s.writeBlogSyncState(f.ws,f.id,{...state,publishPending:next},state.revision);return next;},{f,old});
      await manager(page,f.id);await preview(page);const edgeBefore=server.edgeRequests.length;await publish(page);
      assert.equal(server.legacy.at(-1).status,'conflict');assert.equal(server.edgeRequests.length,edgeBefore);assert.deepEqual((await state(page,f)).publishPending,pending);assert.equal(receipts(f,pending.operationId),0);await unchanged(page,f);await snap(page,'legacy-conflict-390');await owner.context.close();
    });
    await check('same-operation late intent replacement survives without replaying the stale selection',async()=>{
      const owner=await device('pending-same-operation',1440),page=owner.page,f=await seed(page,'same-operation'),old=await pendingFixture(page,f);
      await manager(page,f.id);await preview(page);const edgeBefore=server.edgeRequests.length,gate=server.holdLegacy();await page.getByRole('button',{name:'공개 게시·갱신',exact:true}).click();await gateEntered(gate);
      const replacement=await page.evaluate(async({f,old})=>{const s=HaedoLife.Shell.storage,state=await s.readBlogSyncState(f.ws,f.id),next={...old,selection:{...old.selection,author:{name:'다른 합성 탭에서 고른 이름',intro:''}}};await s.writeBlogSyncState(f.ws,f.id,{...state,publishPending:next},state.revision);return next;},{f,old});
      gate.release.resolve();await busyDone(page);assert.equal(server.edgeRequests.length,edgeBefore);assert.deepEqual((await state(page,f)).publishPending,replacement);assert.equal(receipts(f,old.operationId),0);await unchanged(page,f);await owner.context.close();
    });
    await check('an account change while rollback response waits cannot rewrite the former account pending',async()=>{
      const owner=await device('pending-account-change',390),page=owner.page,f=await seed(page,'account-change'),pending=await pendingFixture(page,f);
      await manager(page,f.id);await preview(page);const edgeBefore=server.edgeRequests.length,gate=server.holdLegacy();await page.getByRole('button',{name:'공개 게시·갱신',exact:true}).click();await gateEntered(gate);
      await page.evaluate(async value=>{await HaedoAuth.client.auth.setSession(value);await HaedoAuth.verify();},syntheticSession(accounts.b));gate.release.resolve();
      await page.waitForFunction(()=>HaedoAuth.user?.id===HaedoAuth.session?.user?.id);assert.equal(server.edgeRequests.length,edgeBefore);assert.equal(await page.getByRole('link',{name:'공개한 글 열기',exact:true}).count(),0);
      await page.evaluate(async value=>{await HaedoAuth.client.auth.setSession(value);await HaedoAuth.verify();},syntheticSession(accounts.a));await page.reload();await ready(page);
      assert.deepEqual((await state(page,f)).publishPending,pending);assert.equal(receipts(f,pending.operationId),0);await unchanged(page,f);await owner.context.close();
    });
    report.transport={expectedResponses:server.expectedResponses,observedConsoleErrors:report.expectedTransportErrors.length,cancelledResponses:server.cancelledResponses,cancelledOperations:server.cancelledOperations.size};
    assert.deepEqual(server.expected,[],'Every non-cancelled injected transport failure is accounted for');assert.equal(server.expectedResponses,report.expectedTransportErrors.length);assert.equal(server.cancelledResponses,server.cancelledOperations.size);
    assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.external,[]);
    report.pass=report.checks.length>0&&report.checks.every(c=>c.pass);
  } finally {
    await Promise.allSettled(contexts.map(context=>context.close()));await browser.close();report.resourcesClosed=true;
    report.sourceHashesAfter=[];for(const entry of report.sources){const hash=createHash('sha256').update(await fs.readFile(entry.file)).digest('hex');report.sourceHashesAfter.push({file:entry.file,sha256:hash});if(hash!==entry.sha256)report.pass=false;}
    if(process.env.PUBLISH_PENDING_SYNC_MUTANT)report.mutation={file:'blog-sync.js',sha256:createHash('sha256').update(await fs.readFile(process.env.PUBLISH_PENDING_SYNC_MUTANT)).digest('hex'),isolatedBrowserRoute:true};
    report.testHashAfter=createHash('sha256').update(await fs.readFile(__filename)).digest('hex');if(report.testHash!==report.testHashAfter)report.pass=false;
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  }
  if(!report.pass)process.exitCode=1;
}
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});

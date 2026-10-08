/* Public page publication: actual local application, bundled SDK and IndexedDB.
 * BASE_URL=http://127.0.0.1:4184 node tests/life-share-browser.cjs
 * Anonymous intercepted HTTP is not evidence of deployed SQL/RLS or Apple hardware. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base, publicKey } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext, observe, nav } = require('./unified-home-browser.cjs');
const { current, go, inspect } = require('./life-workbench-browser.cjs');
const out = path.resolve(__dirname, '../.local/share');
const markers = Object.freeze({
  title: '산책과 전시 사이에서 모은 생각 — 오래된 질문과 사진 속 빛을 따라 천천히 다시 읽는 기록',
  ownBody: '내가 직접 쓴 공개 본문: 걷다가 멈춘 자리에서 새로운 질문을 발견했다.🌱\r\n정답보다 오래 머물렀던 순간을 기록한다.',
  ownNote: '내 공개 코멘트: 다음 산책에서 다시 읽고 싶은 이야기.',
  otherBody: '원문 앞부분\r\n다시 읽을 구절🌱\r\n타인의 전체 본문은 보관했어도 자동 재게시하지 않는 비공개 표식 OTHER_BODY_PRIVATE_42',
  unknownBody: '작성자 미확인 전체 원문 비공개 표식 UNKNOWN_BODY_PRIVATE_53',
  intro: '숨긴 소개 PRIVATE_INTRO_64',
  hiddenEntry: '숨긴 항목 PRIVATE_ENTRY_75',
  unplaced: '표시하지 않는 최근 항목 PRIVATE_RECENT_86',
  hiddenBody: '본문 표시를 끈 내 글 PRIVATE_BODY_97',
  hiddenNote: '코멘트 표시를 끈 내 생각 PRIVATE_NOTE_108',
  hiddenPart: '부분 표시를 끈 원문 PRIVATE_PART_119',
  reflection: '회고와 묶음은 공개 payload에 포함하지 않는다 PRIVATE_REFLECTION_120'
});

async function shareFixture(page, { many = false } = {}) {
  await go(page, 'page');
  return page.evaluate(async ({ marker, many }) => {
    const s=HaedoLife.Shell.storage,c=HaedoLife.Core; let b=await s.read(await s.getActive()); const refs=[];
    const specs=[
      {origin:'apple_notes',title:marker.title,text:marker.ownBody,author:'익명 작성자',authorRelation:'self',url:'https://example.invalid/my-own-post'},
      {origin:'naver_blog',title:'다른 사람의 산책에 관한 글',text:marker.otherBody,author:'다른 익명 작성자',authorRelation:'other',url:'https://blog.naver.com/anonymous_fixture/222000000000'},
      {origin:'instagram',title:'작성자를 확인하지 못한 사진 설명',text:marker.unknownBody,authorRelation:'unknown',url:'https://www.instagram.com/p/AnonymousOnly/',coverage:{status:'partial',omissions:['사진과 댓글 미보관']}},
      {origin:'obsidian',title:'본문 표시를 끈 기록',text:marker.hiddenBody,authorRelation:'self'},
      {origin:'other',title:marker.hiddenPart,text:'부분 표시 해제 본문',authorRelation:'self',url:'https://example.invalid/private-part-119'}
    ];
    for(const spec of specs){const p=await c.prepareImport({...spec,forceSeparate:true},b),r=await s.commitLocal({workspaceId:b.workspaceId,baseRevision:b.revision,operationId:c.id(),changes:c.buildImportChanges(b,p,[])});if(r.status!=='stored')throw new Error('Anonymous publication fixture rejected');refs.push({sourceId:p.source.id,versionId:p.version.id});b=await s.read(b.workspaceId);}
    const w=await s.readWorkbench(b.workspaceId),entry=(title,ids,extra={})=>({id:c.id(),title,parts:ids.map(versionId=>({versionId,enabled:true})),note:'',pinned:true,enabled:true,showBody:true,showNote:true,...extra});
    w.page.title='산책하며 발견한 질문들';w.page.intro=marker.intro;w.page.showIntro=false;w.page.showRecent=false;
    const main=entry(marker.title,refs.slice(0,3).map(r=>r.versionId),{note:marker.ownNote});main.parts.push({versionId:refs[4].versionId,enabled:false});
    w.page.entries=[main,entry(marker.hiddenEntry,[refs[0].versionId],{enabled:false}),entry(marker.unplaced,[refs[0].versionId],{pinned:false}),entry('제목과 출처만 남긴 기록',[refs[3].versionId],{showBody:false,note:marker.hiddenNote,showNote:false})];
    if(many)for(let i=0;i<8;i++)w.page.entries.push(entry('산책 중 다시 이어 읽을 기록 '+(i+1)+' — 긴 한글 제목에서도 본문과 출처를 구분합니다',[refs[0].versionId],{note:'익명 공개 코멘트 '+(i+1)}));
    w.groups.push({id:c.id(),title:marker.reflection,versionIds:refs.map(r=>r.versionId)});w.reflection.note=marker.reflection;
    await s.saveWorkbench(b.workspaceId,w,w.revision);return {workspaceId:b.workspaceId,refs,entryId:main.id};
  }, { marker: markers, many });
}
function assertNoPrivateSnapshot(snapshot, fixture) {
  const serialized=JSON.stringify(snapshot);
  for(const key of ['otherBody','unknownBody','intro','hiddenEntry','unplaced','hiddenBody','hiddenNote','hiddenPart','reflection']) { assert(!serialized.includes(markers[key]), 'Private marker leaked: '+key); const token=markers[key].match(/[A-Z_]*PRIVATE_[A-Z_]*[0-9]+/)?.[0]; if(token)assert(!serialized.includes(token),'Private token leaked: '+key); }
  for(const id of [fixture.workspaceId,...fixture.refs.flatMap(r=>[r.sourceId,r.versionId]),fixture.entryId]) assert(!serialized.includes(id),'Private workspace/source identity leaked');
  assert(!/"(?:owner_id|workspaceId|sourceVersionId|contentHash|locator|revision|sourceBackup|reflection|groups)"\s*:/.test(serialized),'Private storage fields leaked into content');
}
async function instrumentPrivacy(context) {
  await context.addInitScript(() => {
    window.__shareFetches=[];const originalFetch=window.fetch;window.fetch=function(input,options){const request=input instanceof Request?input:null;__shareFetches.push({url:String(request?.url||input),cache:options?.cache||request?.cache||'default'});return originalFetch.apply(this,arguments);};
    window.__shareDbOpens=[]; const open=IDBFactory.prototype.open;
    IDBFactory.prototype.open=function(...args){__shareDbOpens.push(args[0]);return open.apply(this,args);};
    window.__shareStorageWrites=[];
    const set=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){__shareStorageWrites.push({kind:this===localStorage?'local':'session',key});return set.call(this,key,value);};
  });
}
module.exports={shareFixture,assertNoPrivateSnapshot,instrumentPrivacy,markers};

const clone=value=>JSON.parse(JSON.stringify(value));
class ShareCloud extends FakeCloud {
  constructor(){super();this.pages=new Map();this.shareReceipts=new Map();this.shareRequests=[];this.shareFailures=0;this.failNext=null;this.loseNext=false;this.holdNext=null;this.publicSequence=0;}
  metadata(row){return row?{status:row.published?'published':'revoked',revision:row.revision,publicId:row.published?row.publicId:null,updatedAt:row.updatedAt,lastOperationId:row.lastOperationId}:{status:'missing',revision:0,publicId:null,updatedAt:null,lastOperationId:null};}
  async handle(route,device){
    const request=route.request(),url=new URL(request.url()),rpc=url.pathname.split('/').at(-1);
    if(!url.pathname.startsWith('/rest/v1/rpc/life_public_page_'))return super.handle(route,device);
    const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS','content-type':'application/json','cache-control':'no-store, max-age=0'};
    const send=(value,status=200)=>route.fulfill({status,headers,body:status===204?'':JSON.stringify(value)});
    if(request.method()==='OPTIONS')return send(null,204);
    assert.equal(request.method(),'POST','Only named share RPC POSTs are permitted');
    const bearer=request.headers().authorization?.replace(/^Bearer /i,'');let owner=null;
    if(bearer?.includes('.')){try{const payload=JSON.parse(Buffer.from(bearer.split('.')[1],'base64url'));owner=Object.values(accounts).find(a=>a.id===payload.sub)?.id||null;}catch(_){}}
    const body=request.postDataJSON();this.shareRequests.push({rpc,device,owner,body:clone(body),cacheControl:request.headers()['cache-control']||null});
    if(this.failNext===rpc){this.failNext=null;this.shareFailures++;return send({code:'PGRST205',message:'Anonymous publication fixture schema unavailable'},404);}
    if(this.offline.has(device)){this.shareFailures++;return route.abort('internetdisconnected');}
    let response;
    if(rpc==='life_public_page_read'){
      assert.deepEqual(Object.keys(body),['p_public_id'],'Anonymous reader must request one exact public ID');
      const row=[...this.pages.values()].find(r=>r.published&&r.publicId===body.p_public_id);
      response=row?{status:'published',publicId:row.publicId,revision:row.revision,updatedAt:row.updatedAt,snapshot:clone(row.snapshot)}:{status:'missing'};
    }else{
      if(!owner)return send({code:'PGRST301',message:'Anonymous owner operation forbidden'},401);
      const key=owner+':'+body.p_workspace_id,row=this.pages.get(key);
      if(rpc==='life_public_page_list'){
        assert.deepEqual(Object.keys(body),['p_after']);
        const rows=[...this.pages.values()].filter(r=>r.owner===owner&&r.published&&(!body.p_after||r.workspaceId>body.p_after)).sort((a,b)=>a.workspaceId.localeCompare(b.workspaceId));
        const selected=rows.slice(0,50);response={pages:selected.map(r=>({workspaceId:r.workspaceId,title:r.snapshot.title,revision:r.revision,publicId:r.publicId,updatedAt:r.updatedAt,lastOperationId:r.lastOperationId})),nextCursor:rows.length>50?selected.at(-1).workspaceId:null};
      }else if(rpc==='life_public_page_get')response=this.metadata(row);
      else if(rpc==='life_public_page_put'){
        const identity=key+':'+body.p_operation_id,payload=JSON.stringify({action:body.p_action,expected:body.p_expected_revision,snapshot:body.p_snapshot}),receipt=this.shareReceipts.get(identity);
        if(receipt){if(receipt.payload!==payload)return send({code:'operation_mismatch',message:'Anonymous publication operation mismatch'},400);response=clone(receipt.response);}
        else if(!row&&body.p_expected_revision!==0)response={status:'missing'};
        else if(row&&row.revision!==body.p_expected_revision)response={status:'conflict',revision:row.revision};
        else{
          assert(['publish','revoke'].includes(body.p_action));if(body.p_action==='revoke')assert.equal(body.p_snapshot,null);
          const publicId=body.p_action==='publish'?(row?.published?row.publicId:`33333333-3333-4333-8333-${String(++this.publicSequence).padStart(12,'0')}`):(row?.publicId||null);
          const next={owner,workspaceId:body.p_workspace_id,revision:(row?.revision||0)+1,publicId,published:body.p_action==='publish',snapshot:body.p_action==='publish'?clone(body.p_snapshot):null,lastOperationId:body.p_operation_id,updatedAt:new Date().toISOString()};
          this.pages.set(key,next);response={status:'stored',revision:next.revision,publicId:next.published?next.publicId:null,published:next.published,updatedAt:next.updatedAt,action:body.p_action};this.shareReceipts.set(identity,{payload,response:clone(response)});
        }
        if(this.loseNext){this.loseNext=false;this.shareFailures++;return route.abort('failed');}
      }else throw new Error('Unexpected publication RPC '+rpc);
    }
    if(this.holdNext?.rpc===rpc&&(!this.holdNext.device||this.holdNext.device===device)){const gate=this.holdNext;this.holdNext=null;gate.entered();await gate.release;}
    return send(response);
  }
  held(rpc,device){let enter,release;const entered=new Promise(r=>enter=r),released=new Promise(r=>release=r);this.holdNext={rpc,device,entered:enter,release:released};return {entered,release};}
  publicationWrites(){return this.shareRequests.filter(r=>r.rpc==='life_public_page_put');}
}

async function openShare(page){await go(page,'page');await page.locator('#wbPageShare').click();await page.locator('#wbSharePanel').waitFor();await page.locator('#wbSharePreview').waitFor();}
async function publish(page){await page.locator('#wbShareConsent').check();await page.locator('#wbSharePublish').click();await page.waitForFunction(()=>document.querySelector('#wbSharePanel')?.getAttribute('aria-busy')==='false');await page.locator('#wbShareUrl').waitFor({state:'visible'});return page.locator('#wbShareUrl').getAttribute('href');}
async function editWorkbench(page,source){await page.evaluate(async source=>{const s=HaedoLife.Shell.storage,id=await s.getActive(),w=await s.readWorkbench(id);new Function('w',source)(w);await s.saveWorkbench(id,w,w.revision);},source);}
function expectPrivatePreserved(before,after){assert.deepEqual(after.bundle,before.bundle);assert.deepEqual(after.workbench,before.workbench);}
function observeShare(page,report,name){
  page.on('pageerror',error=>report.pageErrors.push({check:name,message:error.message}));
  page.on('console',event=>{if(event.type()!=='error')return;if(page.expectedShareFailure&&event.location().url.startsWith(cloud)&&/Failed to load resource:.*(?:ERR_FAILED|ERR_INTERNET_DISCONNECTED|status of 404)/.test(event.text()))report.expectedErrors++;else report.consoleErrors.push({check:name,message:event.text()});});
}

async function main(){
  await fs.mkdir(out,{recursive:true});
  const report={createdAt:new Date().toISOString(),scope:'Actual local app/SDK/IndexedDB with anonymous HTTP share-RPC simulator; not live SQL/RLS, Apple hardware or real Google login',checks:[],visual:[],consoleErrors:[],pageErrors:[],expectedErrors:0,external:[]};
  const browser=await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});report.browser=browser.version();
  async function contextFor(server,device,seed=accounts.a,options={}){
    const context=await makeContext(browser,server,device,seed,options);await instrumentPrivacy(context);
    await context.route('**/*',route=>{const u=new URL(route.request().url());if([new URL(base).origin,cloud].includes(u.origin))return route.fallback();report.external.push({origin:u.origin,path:u.pathname});return route.abort('blockedbyclient');});return context;
  }
  async function check(name,run,options={}){
    if(process.env.SHARE_TEST_MATCH&&!new RegExp(process.env.SHARE_TEST_MATCH).test(name))return;
    const server=new ShareCloud(),device='share-'+report.checks.length,context=await contextFor(server,device,accounts.a,options),page=await context.newPage(),visitors=[];page.setDefaultTimeout(10000);observeShare(page,report,name);
    async function visitor(label='visitor',config=options,seed=null){const deviceId=device+'-'+label,c=await contextFor(server,deviceId,seed,config),p=await c.newPage();p.setDefaultTimeout(10000);observeShare(p,report,name+' '+label);visitors.push(c);return {page:p,context:c,device:deviceId};}
    try{await run({page,context,server,device,visitor});assert.equal(server.writes().length,0,'Publication must not upload a private workspace');report.checks.push({name,pass:true});console.log('PASS '+name);}
    catch(error){report.checks.push({name,pass:false,error:error.stack});console.error('FAIL '+name+'\n'+error.stack);if(process.env.CI)console.log('::error::'+(name+'\n'+error.stack).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'));await page.screenshot({path:path.join(out,'failure-'+report.checks.length+'.png'),fullPage:true}).catch(()=>{});}
    finally{await Promise.allSettled(visitors.map(c=>c.close()));await context.close();}
  }
  async function publicState(page,state){await page.waitForFunction(state=>document.querySelector('#shareStatus')?.dataset.state===state,state);}
  async function take(page,scene,size,owner=false){
    if(process.env.SHARE_VISUAL_SCENES&&!process.env.SHARE_VISUAL_SCENES.split(',').some(value=>value===scene||value===scene+':'+size.width))return;
    const metrics=owner?await page.evaluate(inspect):await page.evaluate(require('./home-entry-browser.cjs').inspectHome,'.share-page');
    await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));const file=scene+'-'+size.width+'.png';await page.screenshot({path:path.join(out,file),fullPage:!scene.includes('many')});report.visual.push({scene,file,...metrics});
    assert(!metrics.horizontalOverflow&&!metrics.overflow.length,scene+' overflow');assert.deepEqual(metrics.smallTargets,[],scene+' targets below 44px');assert.deepEqual(metrics.unnamed,[],scene+' controls need names');assert.deepEqual(metrics.contrastFailures,[],scene+' contrast');if(owner)assert.deepEqual(metrics.smallInputs,[],scene+' inputs below 16px');
  }
  try{
    await check('review defaults exclude all source bodies and private fields; explicit publish has no private workspace write',async({page,server,visitor})=>{
      const f=await shareFixture(page),before=await current(page);await openShare(page);
      assert.equal(await page.locator('.wb-share-body:checked').count(),0);assert.equal(server.publicationWrites().length,0);assert(await page.locator('#wbSharePublish').isDisabled());
      const preview=await page.locator('#wbSharePreview').textContent();assert(preview.includes(markers.ownNote));assert(!preview.includes(markers.ownBody));
      await page.locator('#wbShareBack').click();expectPrivatePreserved(before,await current(page));assert.equal(server.publicationWrites().length,0);
      await page.locator('#wbPageShare').click();await page.locator('#wbSharePreview').waitFor();const url=await publish(page),row=server.pages.get(accounts.a.id+':'+f.workspaceId);
      assertNoPrivateSnapshot(row.snapshot,f);assert(row.snapshot.entries.every(e=>e.parts.every(p=>p.text===null&&p.textKind==='none')));expectPrivatePreserved(before,await current(page));
      const v=await visitor();await v.page.goto(new URL(url,base).href);await publicState(v.page,'published');assert((await v.page.locator('#shareContent').textContent()).includes(markers.ownNote));
      assert.deepEqual(await v.page.evaluate(()=>__shareDbOpens),[]);assert.deepEqual(await v.page.evaluate(()=>__shareStorageWrites),[]);
      assert.equal(await v.page.evaluate(()=>!!globalThis.HaedoAuth||!!globalThis.HaedoLife?.Shell||!!globalThis.HaedoLife?.Storage),false);
      const requests=server.shareRequests.filter(r=>r.device===v.device);assert.equal(requests.length,1);assert.equal(requests[0].rpc,'life_public_page_read');assert.equal(requests[0].owner,null);assert.deepEqual(Object.keys(requests[0].body),['p_public_id']);
      const fetches=await v.page.evaluate(()=>__shareFetches.filter(r=>r.url.includes('/life_public_page_read')));assert(fetches.length&&fetches.every(r=>r.cache==='no-store'));
      for(const link of await v.page.locator('.share-source-link').all()){assert.equal(await link.getAttribute('rel'),'noopener noreferrer');assert.equal(await link.getAttribute('referrerpolicy'),'no-referrer');}
    });
    await check('only explicitly selected own body and exact original excerpt reach the anonymous snapshot',async({page,server,visitor})=>{
      const f=await shareFixture(page),before=await current(page);await openShare(page);await page.locator('#wbShareChoices > summary').click();await page.locator(`.wb-share-body[data-version-id="${f.refs[0].versionId}"]`).check();
      const quote='다시 읽을 구절🌱';const reader=page.locator(`.wb-share-excerpt[data-version-id="${f.refs[1].versionId}"]`);
      await reader.locator('..').locator('summary').click();
      await reader.evaluate((el,quote)=>{const start=el.value.indexOf(quote);el.focus();el.setSelectionRange(start,start+quote.length);el.dispatchEvent(new Event('select',{bubbles:true}));},quote);
      await reader.locator('..').locator('.wb-share-use-excerpt').click();const url=await publish(page),snapshot=server.pages.get(accounts.a.id+':'+f.workspaceId).snapshot;
      assertNoPrivateSnapshot(snapshot,f);const parts=snapshot.entries.flatMap(e=>e.parts);assert(parts.some(p=>p.text===markers.ownBody&&p.textKind==='body'));assert(parts.some(p=>p.text===quote&&p.textKind==='excerpt'));expectPrivatePreserved(before,await current(page));
      const v=await visitor();await v.page.goto(new URL(url,base).href);await publicState(v.page,'published');assert((await v.page.locator('#shareContent').textContent()).includes(markers.ownBody));assert.equal(await v.page.locator('blockquote.share-body').textContent(),quote);
    });
    await check('local edits stay private until explicit update; revoke hides content and republish rotates the address',async({page,server,visitor})=>{
      const f=await shareFixture(page);await openShare(page);const first=await publish(page),publicId=new URL(first,base).searchParams.get('id'),v=await visitor();await v.page.goto(new URL(first,base).href);await publicState(v.page,'published');
      await page.locator('#wbShareBack').click();await editWorkbench(page,"w.page.entries[0].note='명시 갱신 전 비공개 새 코멘트';");await go(page,'page');await v.page.reload();await publicState(v.page,'published');assert(!(await v.page.locator('#shareContent').textContent()).includes('명시 갱신 전 비공개 새 코멘트'));
      await page.locator('#wbPageShare').click();await page.locator('#wbSharePreview').waitFor();const second=await publish(page);assert.equal(new URL(second,base).searchParams.get('id'),publicId);await v.page.locator('#shareRefresh').click();await publicState(v.page,'published');assert((await v.page.locator('#shareContent').textContent()).includes('명시 갱신 전 비공개 새 코멘트'));
      await page.locator('#wbShareRevoke').click();assert.equal(server.pages.get(accounts.a.id+':'+f.workspaceId).published,true);await page.locator('#wbShareRevokeConfirm').click();await page.waitForFunction(()=>!document.querySelector('#wbShareUrl')||document.querySelector('#wbShareUrl').hidden);
      await v.page.locator('#shareRefresh').click();await publicState(v.page,'missing');assert.equal(await v.page.locator('#shareContent').textContent(),'');assert.equal(await v.page.title(),'공유 페이지 · 해도');
      await v.page.reload();await publicState(v.page,'missing');await page.locator('#wbShareReview').click();const third=await publish(page);assert.notEqual(new URL(third,base).searchParams.get('id'),publicId);await v.page.reload();await publicState(v.page,'missing');
    });
    await check('lost publish response retries one operation without duplicate revisions or auto retries',async({page,server})=>{
      const f=await shareFixture(page);await openShare(page);server.loseNext=true;page.expectedShareFailure=true;await page.locator('#wbShareConsent').check();await page.locator('#wbSharePublish').click();await page.locator('#wbShareRetry').waitFor();
      const first=server.publicationWrites()[0];assert.equal(server.pages.get(accounts.a.id+':'+f.workspaceId).revision,1);assert.equal(server.publicationWrites().length,1);
      await page.locator('#wbShareRetry').click();await page.locator('#wbShareUrl').waitFor({state:'visible'});const writes=server.publicationWrites();assert.equal(writes.length,2);assert.deepEqual(writes[1].body,first.body);assert.equal(server.pages.get(accounts.a.id+':'+f.workspaceId).revision,1);
    });
    await check('historical publish retry after server revocation never revives the old publication',async({page,server})=>{
      const f=await shareFixture(page);await openShare(page);server.loseNext=true;page.expectedShareFailure=true;await page.locator('#wbShareConsent').check();await page.locator('#wbSharePublish').click();await page.locator('#wbShareRetry').waitFor();
      const row=server.pages.get(accounts.a.id+':'+f.workspaceId);row.published=false;row.snapshot=null;row.revision=2;row.lastOperationId='55555555-5555-4555-8555-555555555555';
      await page.locator('#wbShareRetry').click();await page.waitForFunction(()=>document.querySelector('#wbSharePanel')?.getAttribute('aria-busy')==='false');
      assert.match(await page.locator('#wbShareStatus').textContent(),/철회/);assert.equal(await page.locator('#wbShareUrl').count(),0);assert.equal(row.published,false);assert.equal(row.revision,2);assert.deepEqual(server.publicationWrites()[0].body,server.publicationWrites()[1].body);
    });
    await check('private composition changed after review must be reviewed again before any public write',async({page,server})=>{
      await shareFixture(page);await openShare(page);await page.locator('#wbShareConsent').check();await editWorkbench(page,"w.page.entries[0].note='검토 이후 다른 탭에서 변경한 문장';");
      await page.locator('#wbSharePublish').click();await page.locator('#wbShareError').waitFor({state:'visible'});assert.equal(server.publicationWrites().length,0);assert.match(await page.locator('#wbShareError').textContent(),/바뀌|검토|확인/);
      assert.equal((await current(page)).workbench.page.entries[0].note,'검토 이후 다른 탭에서 변경한 문장');
    });
    await check('revision conflict preserves remote publication and requires a fresh explicit review',async({page,server})=>{
      const f=await shareFixture(page);await openShare(page);await publish(page);const row=server.pages.get(accounts.a.id+':'+f.workspaceId);row.revision++;row.snapshot.title='다른 기기에서 먼저 공개한 제목';row.lastOperationId='44444444-4444-4444-8444-444444444444';
      await page.locator('#wbShareReview').click();await page.locator('#wbShareConsent').check();await page.locator('#wbSharePublish').click();await page.locator('#wbShareError').waitFor({state:'visible'});
      assert.equal(server.pages.get(accounts.a.id+':'+f.workspaceId).snapshot.title,'다른 기기에서 먼저 공개한 제목');assert.match(await page.locator('#wbShareError').textContent(),/다른|바뀌|충돌|확인/);
      await page.locator('#wbShareRefresh').click();await page.locator('#wbShareReview').click();await publish(page);assert.equal(server.pages.get(accounts.a.id+':'+f.workspaceId).revision,3);
    });
    await check('keyboard consent is required and one explicit Enter publishes the reviewed snapshot',async({page,server})=>{
      await shareFixture(page);await openShare(page);assert(await page.locator('#wbSharePublish').isDisabled());await page.locator('#wbShareChoices > summary').click();await page.locator('.wb-share-body').first().focus();await page.keyboard.press('Space');await page.waitForFunction(()=>document.activeElement?.matches('.wb-share-body'));assert(await page.locator('.wb-share-body').first().isChecked());await page.locator('#wbShareConsent').focus();await page.keyboard.press('Space');assert(await page.locator('#wbShareConsent').isChecked());
      const focus=await page.locator('#wbShareConsent').evaluate(el=>({visible:el.matches(':focus-visible'),outline:parseFloat(getComputedStyle(el).outlineWidth)}));assert(focus.visible&&focus.outline>=2);assert.equal(server.publicationWrites().length,0);
      await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'wbSharePublish');await page.keyboard.press('Enter');await page.locator('#wbShareUrl').waitFor({state:'visible'});assert.equal(server.publicationWrites().length,1);await page.waitForFunction(()=>document.activeElement?.id==='wbShareUrl');
    });
    await check('unavailable publication schema stays an error and never reports an empty successful public page',async({page,server})=>{
      await shareFixture(page);server.failNext='life_public_page_get';page.expectedShareFailure=true;await go(page,'page');await page.locator('#wbPageShare').click();await page.locator('#wbShareError').waitFor({state:'visible'});assert.equal(server.publicationWrites().length,0);assert(!await page.locator('#wbShareUrl').isVisible());await page.locator('#wbShareRefresh').click();await page.locator('#wbSharePreview').waitFor();
    });
    await check('late owner response cannot display the previous account public link after signout',async({page,server,device})=>{
      const f=await shareFixture(page);await openShare(page);const gate=server.held('life_public_page_put',device);await page.locator('#wbShareConsent').check();await page.locator('#wbSharePublish').click();await gate.entered;
      await page.evaluate(()=>{window.__shareSignout=HaedoAuth.client.auth.signOut({scope:'local'});});await page.waitForFunction(()=>document.querySelector('#lifeApp').hidden&&!HaedoLife.Shell.storage);gate.release();await page.waitForFunction(()=>HaedoAuth.user===null);
      server.oauthAccounts.set(device,accounts.b);await page.locator('[data-life-login]').click();await page.locator('#googleLogin').click();await page.waitForURL(u=>u.pathname.endsWith('/index.html'));await ready(page);await go(page,'page');await page.locator('#wbPageShare').click();await page.locator('#wbSharePreview').waitFor();
      assert.equal((await current(page)).bundle.sources.length,0);assert(!await page.locator('#wbShareUrl').isVisible());assert(!(await page.locator('body').textContent()).includes(f.workspaceId));
    });
    await check('anonymous late reads, navigation return and offline events never revive a revoked cached body',async({page,server,visitor})=>{
      const f=await shareFixture(page);await openShare(page);const url=await publish(page),v=await visitor();await v.page.goto(new URL(url,base).href);await publicState(v.page,'published');
      await v.page.evaluate(()=>dispatchEvent(new Event('offline')));await publicState(v.page,'error');assert.equal(await v.page.locator('#shareContent').textContent(),'');await v.page.evaluate(()=>dispatchEvent(new Event('online')));await publicState(v.page,'published');
      const gate=server.held('life_public_page_read',v.device);await v.page.locator('#shareRefresh').click();await gate.entered;await v.page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await publicState(v.page,'paused');
      const row=server.pages.get(accounts.a.id+':'+f.workspaceId);row.published=false;row.snapshot=null;row.revision++;gate.release();await v.page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await publicState(v.page,'missing');assert.equal(await v.page.locator('#shareContent').textContent(),'');
      await v.page.goto(base+'/privacy.html');await v.page.goBack();await publicState(v.page,'missing');assert.equal(await v.page.locator('#shareContent').textContent(),'');assert.deepEqual(await v.page.evaluate(()=>__shareDbOpens),[]);
    });
    await check('anonymous malformed IDs and malformed snapshots fail closed without executing markup',async({page,server,visitor})=>{
      const f=await shareFixture(page);await openShare(page);const url=await publish(page),v=await visitor();
      for(const suffix of ['','?id=invalid','?id=33333333-3333-4333-8333-000000000001&id=33333333-3333-4333-8333-000000000002']){await v.page.goto(base+'/share.html'+suffix);await publicState(v.page,'missing');}assert.equal(server.shareRequests.filter(r=>r.device===v.device).length,0);
      const row=server.pages.get(accounts.a.id+':'+f.workspaceId);row.snapshot.entries[0].note='<img src=x onerror="window.__shareInjected=1">';await v.page.goto(new URL(url,base).href);await publicState(v.page,'published');assert.equal(await v.page.locator('#shareContent img').count(),0);assert.equal(await v.page.evaluate(()=>window.__shareInjected),undefined);assert((await v.page.locator('#shareContent').textContent()).includes('<img src=x'));
      row.snapshot.owner_id='private-must-not-render';await v.page.locator('#shareRefresh').click();await publicState(v.page,'error');assert.equal(await v.page.locator('#shareContent').textContent(),'');assert(!(await v.page.locator('body').textContent()).includes('private-must-not-render'));
    });
    await check('a new authenticated device can find and revoke its existing public page without private local records',async({page,server,visitor})=>{
      const f=await shareFixture(page);await openShare(page);const url=await publish(page),fresh=await visitor('new-owner',{hasTouch:true},accounts.a);
      await fresh.page.goto(base+'/index.html?section=manage&view=public-pages');await ready(fresh.page);await fresh.page.locator('#wbPublicPages').waitFor();
      const row=fresh.page.locator(`article.wb-public-page[data-workspace-id="${f.workspaceId}"]`);await row.waitFor();
      for(const size of [{width:1440,height:1000},{width:820,height:1000},{width:390,height:844}]){await fresh.page.setViewportSize(size);await take(fresh.page,'published-management',size,true);}
      const local=await current(fresh.page);assert.equal(local.bundle.sources.length,0);assert.notEqual(local.bundle.workspaceId,f.workspaceId);
      assert.equal(new URL(await row.locator('.wb-public-link').getAttribute('href'),base).searchParams.get('id'),new URL(url,base).searchParams.get('id'));
      await row.locator('.wb-public-revoke').tap();await row.locator('.wb-public-revoke-confirm').waitFor();assert.equal(server.pages.get(accounts.a.id+':'+f.workspaceId).published,true);
      const changed=server.pages.get(accounts.a.id+':'+f.workspaceId);changed.revision++;changed.snapshot.title='확인 이후 다른 기기에서 갱신한 공개 제목';
      await row.locator('.wb-public-revoke-confirm').click();await fresh.page.waitForFunction(()=>document.querySelector('#wbPublicPages')?.getAttribute('aria-busy')==='false');assert.equal(changed.published,true);assert.equal(server.publicationWrites().length,1);assert.equal(await row.locator('.wb-public-revoke-confirm').count(),0);
      await row.locator('.wb-public-revoke').click();await row.locator('.wb-public-revoke-confirm').click();await fresh.page.waitForFunction(id=>!document.querySelector(`article.wb-public-page[data-workspace-id="${id}"] .wb-public-link`),f.workspaceId);assert.equal(server.pages.get(accounts.a.id+':'+f.workspaceId).published,false);
      const anon=await visitor();await anon.page.goto(new URL(url,base).href);await publicState(anon.page,'missing');assert.equal((await current(fresh.page)).bundle.sources.length,0);
    });
    await check('owner public list paginates exact metadata and excludes another account',async({page,server,visitor})=>{
      const f=await shareFixture(page);await openShare(page);await publish(page);const original=server.pages.get(accounts.a.id+':'+f.workspaceId);
      for(let i=1;i<=50;i++){
        const workspaceId='66666666-6666-4666-8666-'+String(i).padStart(12,'0'),publicId='77777777-7777-4777-8777-'+String(i).padStart(12,'0');
        const row={...clone(original),workspaceId,publicId,snapshot:{...clone(original.snapshot),title:'공개 목록 익명 사례 '+i}};server.pages.set(accounts.a.id+':'+workspaceId,row);
      }
      const bId='88888888-8888-4888-8888-888888888888';server.pages.set(accounts.b.id+':'+bId,{...clone(original),owner:accounts.b.id,workspaceId:bId,publicId:'99999999-9999-4999-8999-999999999999',snapshot:{...clone(original.snapshot),title:'B 계정 전용 공개 제목'}});
      const fresh=await visitor('list-owner',{},accounts.a);await fresh.page.goto(base+'/index.html?section=manage&view=public-pages');await ready(fresh.page);await fresh.page.waitForFunction(()=>document.querySelectorAll('article.wb-public-page').length===50);
      assert(!(await fresh.page.locator('#wbPublicPages').textContent()).includes('B 계정 전용'));await fresh.page.locator('#wbPublicPagesMore').click();await fresh.page.waitForFunction(()=>document.querySelectorAll('article.wb-public-page').length===51);
      assert.equal(new Set(await fresh.page.locator('article.wb-public-page').evaluateAll(nodes=>nodes.map(n=>n.dataset.workspaceId))).size,51);
      const listRequests=server.shareRequests.filter(r=>r.device===fresh.device&&r.rpc==='life_public_page_list');assert.equal(listRequests.length,2);assert.equal(listRequests[0].body.p_after,null);assert.equal(typeof listRequests[1].body.p_after,'string');
      const other=await visitor('list-other',{},accounts.b);await other.page.goto(base+'/index.html?section=manage&view=public-pages');await ready(other.page);await other.page.waitForFunction(()=>document.querySelectorAll('article.wb-public-page').length===1);
      assert.equal(await other.page.locator('article.wb-public-page').getAttribute('data-workspace-id'),bId);assert(!(await other.page.locator('#wbPublicPages').textContent()).includes('공개 목록 익명 사례'));
    });
    for(const size of [{width:1440,height:1000},{width:820,height:1000},{width:390,height:844}])await check('visual public and owner review long Korean empty loading error '+size.width,async({page,server,visitor})=>{
      const f=await shareFixture(page,{many:true});await openShare(page);await page.locator('#wbShareChoices > summary').click();await page.locator(`.wb-share-body[data-version-id="${f.refs[0].versionId}"]`).first().check();await take(page,'owner-review',size,true);const url=await publish(page),v=await visitor();await v.page.goto(new URL(url,base).href);await publicState(v.page,'published');await take(v.page,'public-many',size);
      const gate=server.held('life_public_page_read',v.device);if(size.width<1440)await v.page.locator('#shareRefresh').tap();else await v.page.locator('#shareRefresh').click();await gate.entered;await take(v.page,'public-loading',size);gate.release();await publicState(v.page,'published');
      server.failNext='life_public_page_read';v.page.expectedShareFailure=true;await v.page.locator('#shareRefresh').click();await publicState(v.page,'error');await take(v.page,'public-error',size);assert.equal(await v.page.locator('#shareContent').textContent(),'');
      const row=server.pages.get(accounts.a.id+':'+f.workspaceId);row.snapshot.entries=[];await v.page.locator('#shareRefresh').click();await publicState(v.page,'published');await take(v.page,'public-empty',size);
      row.published=false;row.snapshot=null;await v.page.locator('#shareRefresh').click();await publicState(v.page,'missing');await take(v.page,'public-missing',size);
    },{viewport:size,hasTouch:size.width<1440});
  }finally{await browser.close();const text=JSON.stringify(report,null,2)+'\n';await fs.writeFile(path.join(out,process.env.SHARE_TEST_MATCH?'recheck-report.json':'browser-report.json'),text);await fs.writeFile(path.join(out,'run-'+report.createdAt.replace(/[:.]/g,'-')+'.json'),text);}
  console.log(`Publication: ${report.checks.filter(c=>c.pass).length}/${report.checks.length} journeys; ${report.visual.length} visual states; console ${report.consoleErrors.length}; page ${report.pageErrors.length}.`);
  if(report.checks.some(c=>!c.pass)||report.consoleErrors.length||report.pageErrors.length||report.external.length)process.exitCode=1;
}
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});

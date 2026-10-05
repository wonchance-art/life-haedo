/* Real application/SDK/IndexedDB with anonymous intercepted Auth only.
 * BASE_URL=http://127.0.0.1:4184 node tests/life-workbench-browser.cjs
 * No live Supabase/SNS, production credentials or Apple hardware claims. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {FakeCloud,accounts,cloud,base}=require('./life-sync-browser.cjs');
const {playwright,ready,settle,makeContext,observe}=require('./unified-home-browser.cjs');
const out=path.resolve(__dirname,'../.local/workbench');
const sections={activities:'records',page:'records',discover:'tools',reflection:'tools','workbench-backup':'manage'};
const report={createdAt:new Date().toISOString(),scope:'Real local app/SDK/IDB with anonymous HTTP interception; no live SQL/SNS or Apple-device verification',checks:[],visual:[],consoleErrors:[],pageErrors:[],expectedErrors:0,external:[],realRemoteWrites:0};
const longTitle='전시를 보고 돌아오는 길에서 다시 만난 오래된 질문과 사진 속 빛의 방향을 따라 천천히 이어 읽는 기록 — 긴 제목과 여러 원문이 함께 있어도 선택 도구와 본문이 겹치지 않는 익명 사례';
const oldBody='작품 사이의 빈자리에 오래 머물렀다.\r\n보존할 구절🌱: 산책과 공간을 다시 읽는다.\r\n이것은 처음 받은 본문이다.';
const newBody='최신 원문으로 바뀌면 안 되는 문장.\r\n이 버전에서는 기록한 장소와 관찰이 달라졌다.';

async function go(page,view='activities') {await page.goto(`${base}/index.html?section=${sections[view]}&view=${view}`);await ready(page);await page.locator(`.life-workbench[data-mode="${view}"]`).waitFor();await page.waitForFunction(()=>!document.querySelector('.life-workbench')?.getAttribute('aria-busy')||document.querySelector('.life-workbench')?.getAttribute('aria-busy')==='false');}
async function current(page) {return page.evaluate(async()=>{const s=HaedoLife.Shell.storage,id=await s.getActive();return {bundle:await s.read(id),workbench:await s.readWorkbench(id)};});}
async function fixture(page,{many=false}={}) {
  await go(page);
  const result=await page.evaluate(async({title,oldBody,newBody,many})=>{
    const s=HaedoLife.Shell.storage,c=HaedoLife.Core;let b=await s.read(await s.getActive());const refs=[];
    const specs=[{origin:'naver_blog',title,text:oldBody,url:'https://blog.naver.com/anonymous_fixture/222000000000'},{origin:'instagram',title:'전시에서 가장 오래 머문 빛',text:'오후 네 시의 빛. 산책을 마치고 다시 생각한 공간.',url:'https://www.instagram.com/p/AnonymousOnly/',coverage:{status:'partial',omissions:['사진과 댓글 미보관']}},{origin:'apple_notes',title:'혼자 남긴 질문',text:'혼자 남긴 질문: 내가 오래 머무는 장소들의 공통점은 무엇일까?'},{origin:'obsidian',title:'다시 읽고 싶은 문장',text:'산책과 공간을 연결해 더 읽어 보고 싶다.'},{origin:'other',title:'본문 없이 주소만 보관한 읽기 자료',text:null,url:'https://example.invalid/only-a-link',coverage:{status:'link_only',omissions:['본문 미확보']}}];
    if(many)for(let i=1;i<=18;i++)specs.push({origin:'other',title:`추가 익명 자료 ${i} — 산책과 공간에 관한 긴 제목을 다시 읽어 보는 기록`,text:`산책과 공간 ${i}. 자료가 많아도 원문과 선택을 구분합니다.`});
    for(const spec of specs){const p=await c.prepareImport({...spec,forceSeparate:true},b);const result=await s.commitLocal({workspaceId:b.workspaceId,baseRevision:b.revision,operationId:c.id(),changes:c.buildImportChanges(b,p,[])});if(result.status!=='stored')throw new Error('Anonymous source fixture rejected');refs.push({sourceId:p.source.id,versionId:p.version.id,title:p.source.title});b=await s.read(b.workspaceId);}
    const p=await c.prepareImport({origin:'naver_blog',title,text:newBody,existingSourceId:refs[0].sourceId},b);const result=await s.commitLocal({workspaceId:b.workspaceId,baseRevision:b.revision,operationId:c.id(),changes:c.buildImportChanges(b,p,[])});if(result.status!=='stored')throw new Error('Anonymous second version rejected');refs.push({sourceId:p.source.id,versionId:p.version.id,title:p.source.title,newer:true});
    b=await s.read(b.workspaceId);const quote='보존할 구절🌱',start=oldBody.indexOf(quote),now=new Date().toISOString();const record={id:c.id(),kind:'excerpt',text:quote,topic:'산책과 공간',note:'원문 버전과 위치를 보존할 익명 발췌',sourceRefs:[{sourceId:refs[0].sourceId,sourceVersionId:refs[0].versionId,locator:{start,end:start+quote.length}}],provenance:{kind:'user'},revision:1,createdAt:now,updatedAt:now};const excerpt=await s.commitLocal({workspaceId:b.workspaceId,baseRevision:b.revision,operationId:c.id(),changes:{put:{records:[record]}}});if(excerpt.status!=='stored')throw new Error('Anonymous excerpt rejected');
    return {workspaceId:b.workspaceId,refs};
  },{title:longTitle,oldBody,newBody,many});await go(page);return result;
}
async function seedComposition(page,refs) {
  return page.evaluate(async refs=>{const s=HaedoLife.Shell.storage,c=HaedoLife.Core,id=await s.getActive(),state=await s.readWorkbench(id);const groupId=c.id(),entryId=c.id();state.groups.push({id:groupId,title:'한 활동으로 모은 전시와 산책',versionIds:refs.slice(0,3).map(r=>r.versionId)});state.page.title='선택한 기록으로 만든 내 페이지';state.page.intro='보고, 걷고, 오래 생각한 것들.';state.page.entries.push({id:entryId,title:refs[0].title,parts:refs.slice(0,3).map((r,i)=>({versionId:r.versionId,enabled:i!==2})),note:'공유 사본에만 남길 생각',pinned:true,enabled:true,showBody:true,showNote:true});state.reflection.versionIds=[refs[0].versionId,refs[1].versionId];await s.saveWorkbench(id,state,state.revision);return {groupId,entryId};},refs);
}
async function abortWorkbenchWrites(page,enabled) {await page.evaluate(enabled=>{window.__wbOriginalPut||=IDBObjectStore.prototype.put;window.__wbAborted=0;IDBObjectStore.prototype.put=enabled?function(...args){const result=__wbOriginalPut.apply(this,args);if(this.name==='meta'&&typeof args[0]?.key==='string'&&args[0].key.startsWith('workbench:')){__wbAborted++;this.transaction.abort();}return result;}:__wbOriginalPut;},enabled);}
function inspect() {
  const visible=el=>el.checkVisibility({checkVisibilityCSS:true})&&el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0&&!el.closest('[hidden],.life-sr-only,.life-skip,.sr-only');
  const desc=el=>({tag:el.tagName.toLowerCase(),id:el.id,name:(el.getAttribute('aria-label')||el.labels?.[0]?.textContent||el.textContent||'').trim().slice(0,80)});
  const controls=[...document.querySelectorAll('.life-workbench button,.life-workbench input,.life-workbench select,.life-workbench textarea,.life-workbench summary,.life-workbench a[href]')].filter(visible);
  const dimensions=el=>{const input=el.getBoundingClientRect(),label=el.matches('input[type=checkbox]')?el.labels?.[0]?.getBoundingClientRect():null;const r=label&&label.width>=input.width&&label.height>=input.height?label:input;return {...desc(el),width:r.width,height:r.height};};
  const inputs=controls.filter(el=>el.matches('input:not([type=checkbox]),textarea,select'));
  const overflow=[...document.querySelectorAll('.life-workbench *')].filter(visible).filter(el=>{const r=el.getBoundingClientRect();return r.left < -1||r.right > innerWidth+1;}).slice(0,12).map(desc);
  const rgba=value=>{const m=value.match(/^rgba?\(([^)]+)\)$/);if(!m)return null;const a=m[1].split(/[, /]+/).map(Number);return [a[0],a[1],a[2],a[3]??1];};
  const over=(a,b)=>a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3])).concat(1);
  const background=el=>{const chain=[];for(let p=el;p;p=p.parentElement)chain.unshift(p);return chain.reduce((b,p)=>over(rgba(getComputedStyle(p).backgroundColor)||[0,0,0,0],b),[255,255,255,1]);};
  const luminance=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const ratio=(a,b)=>{const l=[luminance(a),luminance(b)].sort((a,b)=>b-a);return(l[0]+.05)/(l[1]+.05);};
  const text=[],walker=document.createTreeWalker(document.querySelector('.life-workbench'),NodeFilter.SHOW_TEXT);
  function measure(el){const css=getComputedStyle(el),fg=rgba(css.color),bg=background(el);if(!fg)return;const large=parseFloat(css.fontSize)>=24||(parseFloat(css.fontSize)>=18.66&&parseInt(css.fontWeight)>=700);text.push({...desc(el),ratio:+ratio(over(fg,bg),bg).toFixed(3),required:large?3:4.5});}
  while(walker.nextNode()){const n=walker.currentNode;if(n.textContent.trim()&&visible(n.parentElement))measure(n.parentElement);}inputs.forEach(measure);
  return {width:innerWidth,horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,overflow,smallTargets:controls.map(dimensions).filter(r=>r.width<43.9||r.height<43.9),unnamed:controls.filter(el=>!desc(el).name).map(desc),smallInputs:inputs.filter(el=>parseFloat(getComputedStyle(el).fontSize)<16).map(desc),font:getComputedStyle(document.querySelector('.life-workbench')).fontFamily,minTextContrast:Math.min(...text.map(t=>t.ratio)),measuredTexts:text.length,contrastFailures:text.filter(t=>t.ratio<t.required)};
}

async function openDetails(locator) {for(const detail of await locator.locator('details').all())if(!(await detail.evaluate(el=>el.open)))await detail.locator('summary').first().click();}
async function save(page){await page.getByRole('button',{name:'지금 저장',exact:true}).click();await page.waitForFunction(()=>document.getElementById('wbStatus')?.dataset.state==='saved');}
async function togglePreview(page){const on=await page.locator('#wbPagePreview').getAttribute('aria-pressed')!=='true';await page.locator('#wbPagePreview').click();await page.waitForFunction(on=>document.getElementById('wbPagePreview')?.getAttribute('aria-pressed')===String(on),on);if(on)await page.locator('#wbVisitor').waitFor();else await page.locator('#wbVisitor').waitFor({state:'detached'});}
async function waitSaved(page,predicate) {
  const deadline=Date.now()+10000;let value;
  do{value=await current(page);if(predicate(value.workbench))return value;await page.waitForTimeout(30);}while(Date.now()<deadline);
  throw new Error('Expected saved composition was not observed');
}
async function snapshot(page,scene,size) {
  await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
  const metrics=await page.evaluate(inspect),file=`${scene}-${size.width}.png`;await page.screenshot({path:path.join(out,file),fullPage:true});report.visual.push({scene,file,...metrics});
  assert(!metrics.horizontalOverflow&&!metrics.overflow.length,`${scene}/${size.width}: horizontal overflow ${JSON.stringify(metrics.overflow)}`);
  assert.deepEqual(metrics.smallTargets,[],`${scene}/${size.width}: targets smaller than 44px`);assert.deepEqual(metrics.unnamed,[],`${scene}/${size.width}: missing names`);assert.deepEqual(metrics.smallInputs,[],`${scene}/${size.width}: text inputs smaller than 16px`);
  assert.deepEqual(metrics.contrastFailures,[],`${scene}/${size.width}: text contrast`);
}
async function installReadGate(context) {
  // Test-only boundary wrapper preserves all actual storage implementation below it.
  // It lets the otherwise fast local read expose its loading/error UI deterministically.
  await context.route(`${base}/assets/life/storage.js`,async route=>{
    const response=await route.fetch(),source=await response.text();
    const hook=`\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,async readWorkbench(...readArgs){if(window.__wbHoldRead){window.__wbReadEntered=true;await new Promise(resolve=>{window.__wbReleaseRead=()=>{window.__wbHoldRead=false;resolve();};});}const result=await actual.readWorkbench(...readArgs);window.__wbReadFinished=true;return result;},async installWorkbenchCopy(...installArgs){if(window.__wbHoldInstall){window.__wbInstallEntered=true;await new Promise(resolve=>{window.__wbReleaseInstall=()=>{window.__wbHoldInstall=false;resolve();};});}return actual.installWorkbenchCopy(...installArgs);}});}});})();`;
    await route.fulfill({response,body:source+hook});
  });
}

async function main() {
  await fs.mkdir(out,{recursive:true});
  const browser=await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});report.browser=browser.version();
  async function check(name,run,{viewport={width:1440,height:1000},hasTouch=false,readGate=false}={}) {
    if(process.env.WORKBENCH_TEST_MATCH&&!new RegExp(process.env.WORKBENCH_TEST_MATCH).test(name))return;
    const server=new FakeCloud(),context=await makeContext(browser,server,`workbench-${report.checks.length}`,accounts.a,{viewport,hasTouch}),page=await context.newPage();page.setDefaultTimeout(10000);observe(page,report,name);
    await context.route('**/*',route=>{const u=new URL(route.request().url());if([new URL(base).origin,cloud].includes(u.origin))return route.fallback();report.external.push({origin:u.origin,path:u.pathname});return route.abort('blockedbyclient');});
    if(readGate)await installReadGate(context);
    try{await run({page,context,server});assert.equal(server.requests.length,0,'composition flow requested simulated remote workspace data');report.checks.push({name,pass:true});console.log('PASS '+name);}
    catch(error){report.checks.push({name,pass:false,error:error.stack});console.error('FAIL '+name+'\n'+error.stack);await page.screenshot({path:path.join(out,`failure-${report.checks.length}.png`),fullPage:true}).catch(()=>{});}
    finally{await context.close();}
  }
  try {
    await check('all five real sections open with empty local compositions',async({page})=>{
      for(const view of Object.keys(sections)){await go(page,view);await page.locator('#wbStatus[data-state="saved"]').waitFor();assert.equal(await page.locator('[data-haedo-navigation] [data-haedo-section="'+sections[view]+'"]').getAttribute('aria-current'),'page');assert.equal(await page.locator('#wbError').isHidden(),true);}
      const value=await current(page);assert.equal(value.bundle.sources.length,0);assert.deepEqual(value.workbench.groups,[]);assert.deepEqual(value.workbench.page.entries,[]);
    });
    await check('create activity, select fixed sources, copy and edit page, preview and reload preserve data',async({page})=>{
      const f=await fixture(page),original=(await current(page)).bundle;
      await page.locator('#wbGroupTitle').fill('전시와 산책을 한 활동으로 묶기');await page.locator('#wbCreateGroup').click();await save(page); // Exercise editing after a completed save, not only before debounce.
      const group=page.locator('article[data-group-id]').first(),groupId=await group.getAttribute('data-group-id');await openDetails(group);
      for(const ref of f.refs.slice(0,3))await group.locator(`input[data-version-id="${ref.versionId}"]`).check();await save(page);
      assert.deepEqual((await current(page)).workbench.groups[0].versionIds,f.refs.slice(0,3).map(r=>r.versionId));
      await group.getByRole('button',{name:'이 묶음을 내 페이지에 추가',exact:true}).click();await save(page);await go(page,'page');
      const entry=page.locator('article[data-entry-id]').first(),entryId=await entry.getAttribute('data-entry-id');await openDetails(entry);
      await entry.getByLabel('내 코멘트',{exact:true}).fill('첫 코멘트를 먼저 저장');await save(page);
      const note='다시 고친 내 코멘트 <img src=x onerror="window.__wbInjection=1"> & 🌱';await entry.getByLabel('내 코멘트',{exact:true}).fill(note);
      await entry.locator(`[data-part-version-id="${f.refs[2].versionId}"] input[type=checkbox]`).uncheck();await save(page);
      await togglePreview(page);assert(await page.locator('#wbVisitor').isVisible());const text=await page.locator('#wbVisitor').textContent();assert(text.includes(oldBody));assert(!text.includes(newBody));assert(!text.includes('혼자 남긴 질문:'));assert(text.includes(note));assert.equal(await page.locator('#wbVisitor img').count(),0);assert.equal(await page.evaluate(()=>window.__wbInjection),undefined);assert.equal(await page.evaluate(()=>document.activeElement.id),'wbPagePreview');
      await togglePreview(page);assert.equal(await page.evaluate(()=>document.activeElement.id),'wbPagePreview');await page.reload();await ready(page);await page.locator(`article[data-entry-id="${entryId}"]`).waitFor();await togglePreview(page);assert((await page.locator('#wbVisitor').textContent()).includes(note));
      const stored=await current(page);assert.equal(stored.workbench.groups[0].id,groupId);assert.equal(stored.workbench.page.entries[0].parts[2].enabled,false);assert.deepEqual(stored.bundle,original);
    });
    await check('editing or deleting an activity does not mutate an existing page copy',async({page})=>{
      const f=await fixture(page),ids=await seedComposition(page,f.refs),before=await current(page);await go(page);
      const group=page.locator(`[data-group-id="${ids.groupId}"]`);await openDetails(group);await group.getByLabel('묶음 이름',{exact:true}).fill('이후에 고친 활동 제목');await group.locator(`input[data-version-id="${f.refs[1].versionId}"]`).uncheck();await save(page);assert.deepEqual((await current(page)).workbench.page,before.workbench.page);
      await group.getByRole('button',{name:'묶음만 삭제',exact:true}).click();await save(page);const after=await current(page);assert.equal(after.workbench.groups.length,0);assert.deepEqual(after.workbench.page,before.workbench.page);assert.deepEqual(after.bundle,before.bundle);await go(page,'page');await togglePreview(page);assert((await page.locator('#wbVisitor').textContent()).includes('오후 네 시의 빛.'));
    });
    await check('missing fixed version stays missing and existing older version never substitutes latest',async({page})=>{
      const f=await fixture(page);await seedComposition(page,f.refs);await page.evaluate(async()=>{const s=HaedoLife.Shell.storage,id=await s.getActive(),w=await s.readWorkbench(id);w.page.entries[0].parts.push({versionId:'missing-fixed-version',enabled:true});await s.saveWorkbench(id,w,w.revision);});await go(page,'page');await togglePreview(page);const visitor=page.locator('#wbVisitor');assert((await visitor.textContent()).includes(oldBody));assert(!(await visitor.textContent()).includes(newBody));assert.match(await visitor.locator('[data-version-id="missing-fixed-version"]').textContent(),/연결된 원문 없음/);assert.equal(await visitor.locator('[data-version-id="missing-fixed-version"] .wb-source-body').count(),0);
    });
    await check('page placement and visibility remain separate and toggles remove preview DOM',async({page})=>{
      const f=await fixture(page);await seedComposition(page,f.refs);await go(page,'page');let entry=page.locator('article[data-entry-id]').first();await entry.getByRole('button',{name:'항목 고정 해제',exact:true}).click();await page.getByText('제목·소개·표시 설정',{exact:true}).click();await page.locator('#wbShowRecent').uncheck();await save(page);await togglePreview(page);assert.equal(await page.locator('#wbVisitor article').count(),0);assert.equal((await current(page)).workbench.page.entries[0].enabled,true);
      await togglePreview(page);entry=page.locator('article[data-entry-id]').first();await entry.getByRole('button',{name:'항목 고정',exact:true}).click();await togglePreview(page);assert.equal(await page.locator('#wbVisitor article').count(),1);await togglePreview(page);entry=page.locator('article[data-entry-id]').first();await entry.getByRole('button',{name:'이 항목 숨기기',exact:true}).click();await togglePreview(page);assert.equal(await page.locator('#wbVisitor article').count(),0);
    });
    await check('integrated download restores a remapped unbound copy with exact raw text and excerpt',async({page})=>{
      const f=await fixture(page);await seedComposition(page,f.refs);await go(page,'workbench-backup');const before=await current(page);const waiting=page.waitForEvent('download');await page.locator('#wbBackupDownload').click();const download=await waiting,content=JSON.parse(await fs.readFile(await download.path(),'utf8'));assert.equal(content.format,'life-workbench-backup-v1');assert.equal(content.sourceBackup.workspace.sourceVersions[0].contentText,oldBody);assert.equal(content.sourceBackup.workspace.records[0].text,'보존할 구절🌱');assert.deepEqual(content.workbench.page,before.workbench.page);
      await page.locator('#wbRestoreFile').setInputFiles({name:'익명-활동-페이지-사본.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(content))});await page.locator('#wbRestoreInstall').waitFor();assert.equal((await current(page)).bundle.workspaceId,before.bundle.workspaceId);await page.locator('#wbRestoreInstall').click();await page.waitForFunction(id=>HaedoLife.Shell.storage.getActive().then(value=>value!==id),before.bundle.workspaceId);await page.locator('.life-workbench[data-mode="page"]').waitFor();const after=await current(page);assert.notEqual(after.bundle.workspaceId,before.bundle.workspaceId);assert.equal(after.workbench.page.entries[0].note,before.workbench.page.entries[0].note);assert.notEqual(after.workbench.page.entries[0].id,before.workbench.page.entries[0].id);assert.notEqual(after.workbench.page.entries[0].parts[0].versionId,before.workbench.page.entries[0].parts[0].versionId);const exact=after.bundle.sourceVersions.find(v=>v.id===after.workbench.page.entries[0].parts[0].versionId);assert.equal(exact.contentText,oldBody);const record=after.bundle.records[0],ref=record.sourceRefs[0],version=after.bundle.sourceVersions.find(v=>v.id===ref.sourceVersionId);assert.equal(version.contentText.slice(ref.locator.start,ref.locator.end),record.text);assert.equal(await page.evaluate(id=>HaedoLife.Shell.storage.getSyncState(id),after.bundle.workspaceId),null);assert.deepEqual(await page.evaluate(id=>HaedoLife.Shell.storage.read(id),before.bundle.workspaceId),before.bundle);assert.equal(await page.locator('#wbRestoreInstall').count(),0);
    });
    await check('invalid backup replaces valid candidate without installing anything',async({page})=>{
      const f=await fixture(page);await seedComposition(page,f.refs);await go(page,'workbench-backup');const before=await current(page),backup=await page.evaluate(({bundle,workbench})=>HaedoLife.Workbench.makeBackup(bundle,workbench),before);await page.locator('#wbRestoreFile').setInputFiles({name:'valid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.locator('#wbRestoreInstall').waitFor();await page.locator('#wbRestoreFile').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{broken')});await page.locator('#wbError').waitFor({state:'visible'});assert.equal(await page.locator('#wbRestoreInstall').count(),0);assert.deepEqual(await current(page),before);
    });
    await check('discover uses actual stored versions and reflection counts selected scope only',async({page})=>{
      const f=await fixture(page);await go(page,'discover');await page.locator('#wbDiscoverQuery').fill('보존할 구절');const hits=page.locator('#wbDiscoverResults article');assert.equal(await hits.count(),1);assert.equal(await hits.first().getAttribute('data-version-id'),f.refs[0].versionId);assert((await hits.textContent()).includes('보존할 구절🌱'));await page.locator('#wbDiscoverQuery').fill('존재하지않는익명검색어');assert.equal(await hits.count(),0);await page.locator('#wbDiscoverQuery').fill('주소만');assert.match(await page.locator('#wbDiscoverResults').textContent(),/본문 미확보/);
      await go(page,'reflection');await page.getByText('회고할 원문 선택',{exact:true}).click();for(const ref of [f.refs[0],f.refs[4]])await page.locator(`input[data-version-id="${ref.versionId}"]`).check();assert.match(await page.locator('#wbReflectionSummary').textContent(),/선택한 원문 버전 2개/);assert.match(await page.locator('#wbReflectionSummary').textContent(),/본문 미확보1개/);await page.locator('#wbReflectionNote').fill('저장한 글은 나의 동의나 실제 경험 횟수를 뜻하지 않는다.');await save(page);await page.reload();await ready(page);await page.locator('#wbReflectionNote').waitFor();assert.equal(await page.locator('#wbReflectionNote').inputValue(),'저장한 글은 나의 동의나 실제 경험 횟수를 뜻하지 않는다.');assert.deepEqual((await current(page)).workbench.reflection.versionIds,[f.refs[0].versionId,f.refs[4].versionId]);
    });
    await check('real IDB write abort preserves visible edits and retry saves once',async({page})=>{
      await fixture(page);await go(page,'page');const before=await current(page);await abortWorkbenchWrites(page,true);await page.locator('#wbPageIntro').fill('실패 뒤에도 사라지면 안 되는 소개');await page.getByRole('button',{name:'지금 저장',exact:true}).click();await page.locator('#wbError').waitFor({state:'visible'});assert.equal(await page.locator('#wbPageIntro').inputValue(),'실패 뒤에도 사라지면 안 되는 소개');assert((await page.evaluate(()=>window.__wbAborted))>0);assert.deepEqual((await current(page)).workbench,before.workbench);await abortWorkbenchWrites(page,false);await page.getByRole('button',{name:'다시 저장',exact:true}).click();await waitSaved(page,w=>w.page.intro==='실패 뒤에도 사라지면 안 되는 소개');assert.deepEqual((await current(page)).bundle,before.bundle);
    });
    await check('keyboard Space and preview return keep a visible focus target',async({page})=>{
      const f=await fixture(page);await seedComposition(page,f.refs);await go(page,'page');await page.getByText('제목·소개·표시 설정',{exact:true}).click();await page.locator('#wbShowIntro').focus();await page.keyboard.press('Space');assert(!(await page.locator('#wbShowIntro').isChecked()));const focus=await page.evaluate(()=>({visible:document.activeElement.matches(':focus-visible'),outline:getComputedStyle(document.activeElement).outlineWidth}));assert(focus.visible);assert(parseFloat(focus.outline)>=3);await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'wbShowRecent');await togglePreview(page);assert.equal(await page.locator('#wbVisitor .wb-visitor-intro').count(),0);await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'wbPagePreview');assert.equal(await page.locator('#wbVisitor').count(),0);
    });
    await check('boundary: failed workbench save blocks global navigation and preserves same draft',async({page})=>{
      await fixture(page);await go(page,'page');await abortWorkbenchWrites(page,true);await page.locator('#wbPageIntro').fill('전역 이동 실패 뒤에도 남아야 하는 소개');await page.getByRole('button',{name:'지금 저장',exact:true}).click();await page.locator('#wbError').waitFor({state:'visible'});await page.locator('[data-haedo-navigation] [data-haedo-section="tools"]').click();await page.locator('#lifeError').waitFor({state:'visible'});assert.equal(await page.locator('[data-haedo-navigation] [data-haedo-section="records"]').getAttribute('aria-current'),'page');assert.equal(await page.locator('.life-workbench').getAttribute('data-mode'),'page');assert.equal(await page.locator('#wbPageIntro').inputValue(),'전역 이동 실패 뒤에도 남아야 하는 소개');await abortWorkbenchWrites(page,false);await page.getByRole('button',{name:'다시 저장',exact:true}).click();await waitSaved(page,w=>w.page.intro==='전역 이동 실패 뒤에도 남아야 하는 소개');
    });
    await check('boundary: malformed UTF-8 composition note is rejected without replacement characters or install',async({page})=>{
      const f=await fixture(page);await seedComposition(page,f.refs);await go(page,'workbench-backup');const before=await current(page),backup=await page.evaluate(({bundle,workbench})=>HaedoLife.Workbench.makeBackup(bundle,workbench),before);backup.workbench.page.intro='UTF8_MARKER';const json=JSON.stringify(backup),offset=json.indexOf('UTF8_MARKER'),bytes=Buffer.concat([Buffer.from(json.slice(0,offset)),Buffer.from([0xc3,0x28]),Buffer.from(json.slice(offset+'UTF8_MARKER'.length))]);await page.locator('#wbRestoreFile').setInputFiles({name:'invalid-utf8.json',mimeType:'application/json',buffer:bytes});await page.locator('#wbError').waitFor({state:'visible'});assert.match(await page.locator('#wbError').textContent(),/UTF-8|인코딩|문자/);assert.equal(await page.locator('#wbRestoreInstall').count(),0);assert.deepEqual(await current(page),before);
    });
    await check('boundary: pending restore blocks scope navigation and opens only its new copy after completion',async({page})=>{
      const f=await fixture(page);await seedComposition(page,f.refs);await go(page,'workbench-backup');const before=await current(page),backup=await page.evaluate(({bundle,workbench})=>HaedoLife.Workbench.makeBackup(bundle,workbench),before);await page.locator('#wbRestoreFile').setInputFiles({name:'restore-scope.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.locator('#wbRestoreInstall').waitFor();await page.evaluate(()=>{window.__wbHoldInstall=true;});await page.locator('#wbRestoreInstall').click();await page.waitForFunction(()=>window.__wbInstallEntered);assert(await page.locator('#wbRestoreInstall').isDisabled());await page.locator('[data-haedo-navigation] [data-haedo-section="tools"]').click();await page.locator('#lifeError').waitFor({state:'visible'});assert.equal(await page.locator('.life-workbench').getAttribute('data-mode'),'workbench-backup');assert.equal(await page.evaluate(()=>HaedoLife.Shell.storage.getActive()),before.bundle.workspaceId);await page.evaluate(()=>window.__wbReleaseInstall());await page.waitForFunction(id=>HaedoLife.Shell.storage.getActive().then(v=>v!==id),before.bundle.workspaceId);await page.locator('.life-workbench[data-mode="page"]').waitFor();assert.equal((await current(page)).workbench.page.entries.length,1);assert.equal(await page.evaluate(()=>HaedoAuth.user.id),accounts.a.id);assert.deepEqual(await page.evaluate(id=>HaedoLife.Shell.storage.read(id),before.bundle.workspaceId),before.bundle);
    },{readGate:true});
    await check('boundary: delayed composition read cannot overwrite a different section',async({page,context})=>{
      await context.addInitScript(()=>{window.__wbHoldRead=true;});await page.goto(`${base}/index.html?section=records&view=activities`);await ready(page);await page.waitForFunction(()=>window.__wbReadEntered);assert.match(await page.locator('#wbStatus').textContent(),/불러오는 중/);await page.locator('[data-haedo-navigation] [data-haedo-section="tools"]').click();await page.waitForFunction(()=>document.getElementById('lifeMain')?.dataset.mode==='tools');await page.evaluate(()=>window.__wbReleaseRead());await page.waitForFunction(()=>window.__wbReadFinished);assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'),'tools');assert.equal(await page.locator('.life-workbench').count(),0);assert.equal(await page.locator('[data-haedo-navigation] [data-haedo-section="tools"]').getAttribute('aria-current'),'page');
    },{readGate:true});
    for(const size of [{width:1440,height:1000},{width:820,height:1000},{width:390,height:844}])await check('visual populated empty loading error '+size.width,async({page,context})=>{
      await go(page);await page.locator('#wbCreateGroup').waitFor();await snapshot(page,'empty-activities',size);const f=await fixture(page,{many:true});await seedComposition(page,f.refs);
      for(const view of Object.keys(sections)){await go(page,view);await page.locator('#wbStatus[data-state="saved"]').waitFor();if(view==='activities')await openDetails(page.locator('article[data-group-id]').first());if(view==='discover')await page.locator('#wbDiscoverQuery').fill('산책');await snapshot(page,view,size);if(view==='page'){await togglePreview(page);await snapshot(page,'visitor',size);}}
      await go(page,'page');await page.getByText('제목·소개·표시 설정',{exact:true}).click();await abortWorkbenchWrites(page,true);await page.locator('#wbPageIntro').fill('저장 오류에서도 유지되는 익명 초안');await page.getByRole('button',{name:'지금 저장',exact:true}).click();await page.locator('#wbError').waitFor({state:'visible'});await snapshot(page,'save-error',size);await abortWorkbenchWrites(page,false);await page.getByRole('button',{name:'다시 저장',exact:true}).click();await waitSaved(page,w=>w.page.intro==='저장 오류에서도 유지되는 익명 초안');
      await context.addInitScript(()=>{window.__wbHoldRead=true;});await page.reload();await ready(page);await page.waitForFunction(()=>window.__wbReadEntered);assert.match(await page.locator('#wbStatus').textContent(),/불러오는 중/);await snapshot(page,'loading',size);await page.evaluate(()=>window.__wbReleaseRead());await page.locator('#wbStatus[data-state="saved"]').waitFor();assert.equal((await current(page)).workbench.page.intro,'저장 오류에서도 유지되는 익명 초안');
    },{viewport:size,hasTouch:size.width<=820,readGate:true});
    assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.external,[]);
  } finally {await browser.close();await fs.writeFile(path.join(out,process.env.WORKBENCH_TEST_MATCH?'recheck-report.json':'browser-report.json'),JSON.stringify(report,null,2)+'\n');}
  console.log(`Workbench browser: ${report.checks.filter(c=>c.pass).length}/${report.checks.length} functional journeys; ${report.visual.length} visual states; console ${report.consoleErrors.length}; page ${report.pageErrors.length}; external ${report.external.length}. Anonymous intercepted Auth only.`);
  if(report.checks.some(c=>!c.pass)||report.consoleErrors.length||report.pageErrors.length||report.external.length)process.exitCode=1;
}

module.exports={fixture,current,seedComposition,abortWorkbenchWrites,go,inspect,longTitle,oldBody,newBody};
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});

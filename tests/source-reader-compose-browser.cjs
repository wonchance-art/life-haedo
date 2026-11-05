/* Actual app/SDK/IDB, synthetic Auth and anonymous sources only.
 * BASE_URL=http://127.0.0.1:4190 node tests/source-reader-compose-browser.cjs
 * SOURCE_COMPOSE_CSS_MUTANT overrides only ui.css in an isolated browser route.
 * Viewport simulation is not physical Apple hardware verification. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4190';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { FakeCloud, accounts, base, cloud } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, observe, nav } = require('./unified-home-browser.cjs');
const out = path.resolve(process.env.SOURCE_COMPOSE_OUTPUT || '.local/source-reader-compose');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const widths = process.env.SOURCE_COMPOSE_WIDTHS ? process.env.SOURCE_COMPOSE_WIDTHS.split(',').map(Number) : [320, 390, 760, 761, 820, 1440];
const title = '긴 원문 제목에서도 글쓰기 자리를 지키며 읽던 문장과 메모를 그대로 이어 갑니다 '.repeat(3);
const raw = '\ufeff첫 판의 정확한 문장입니다.\r\n\r\n' + Array.from({length: 90}, (_, i) => `${i + 1}. 산책하며 남긴 합성 기록입니다. 🌿 긴 본문을 읽다가 글쓰기를 열어도 원문과 읽던 위치는 그대로 남아야 합니다.`).join('\r\n\r\n');
const note = '아직 발췌하지 않은 비공개 합성 메모 🌱';
async function fixture(page) {
  return page.evaluate(async ({title, raw}) => {
    const s=HaedoLife.Shell.storage, C=HaedoLife.Core; let b=await s.read(await s.getActive());
    const first=await C.prepareImport({origin:'apple_notes',title,text:raw,coverage:'full_text',forceSeparate:true},b);
    await s.commitLocal({workspaceId:b.workspaceId,baseRevision:b.revision,operationId:C.id(),changes:C.buildImportChanges(b,first)});
    b=await s.read(b.workspaceId);
    const newer=await C.prepareImport({origin:'apple_notes',title,text:raw+'\r\n둘째 판에서만 보이는 문장.',coverage:'full_text',existingSourceId:first.source.id},b);
    await s.commitLocal({workspaceId:b.workspaceId,baseRevision:b.revision,operationId:C.id(),changes:C.buildImportChanges(b,newer)});
    b=await s.read(b.workspaceId);const W=HaedoLife.Writing,draft=W.createDraft(b);draft.title='직접 쓴 긴 제목 — '+title;draft.text=raw;
    const stage=await s.saveStage(draft),writing=await W.prepareSave(b,stage);
    const stored=await s.commitLocal({workspaceId:b.workspaceId,baseRevision:b.revision,operationId:C.id(),stageId:stage.stageId,stageRevision:stage.revision,changes:writing.changes,stageResult:writing.stageResult});
    if(stored.status!=='stored')throw Error('Anonymous own writing fixture failed');
    return {sourceId:first.source.id,older:first.version.id,newer:newer.version.id,own:writing.version.id};
  }, {title,raw});
}
async function rest(page) { await page.waitForFunction(()=>document.getAnimations().every(a=>a.playState!=='running')); }
async function mode(page, value) { await settle(page); await page.waitForFunction(value=>document.querySelector('#lifeMain')?.dataset.mode===value,value); await rest(page); }
async function library(page) { await nav(page,'records'); if(await page.locator('#lifeSourceText').isVisible())await page.locator('.life-reader-tools > button').first().click(); await mode(page,'sources'); }
async function snapshot(page) { return page.evaluate(async()=>{const s=HaedoLife.Shell.storage,b=await s.read(await s.getActive());return {sources:b.sources,versions:b.sourceVersions,records:b.records,links:b.links};}); }
async function geometry(page) {
  // Measure the resting layout after the app's native screen transition, as app-motion-browser does.
  await page.waitForFunction(()=>document.getAnimations().every(a=>a.playState!=='running'));
  return page.evaluate(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const compose=document.querySelector('[data-haedo-compose]'), box=rect(compose);
    const overlaps=a=>box.x<a.right-1&&box.right>a.x+1&&box.y<a.bottom-1&&box.bottom>a.y+1;
    const tools=[...document.querySelectorAll('.life-reader-tools button')].filter(e=>e.checkVisibility());
    const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
    const body=document.querySelector('#lifeSourceText'),bar=document.querySelector('.life-reader-tools');
    const obscuredTools=tools.filter(e=>{const r=rect(e),p=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !p||!(p===e||e.contains(p));}).map(e=>e.id||e.getAttribute('aria-label'));
    const outsideTools=tools.filter(e=>{const r=rect(e);return r.x<0||r.right>innerWidth||r.y<0||r.bottom>innerHeight;}).map(e=>e.id||e.getAttribute('aria-label'));
    return {tools:tools.map(e=>({name:e.id||e.getAttribute('aria-label'),...rect(e)})),accountControls:[...document.querySelectorAll('.haedo-account-host button')].filter(e=>e.checkVisibility()).map(e=>({name:e.getAttribute('aria-label'),...rect(e)})),toolCount:tools.length,obscuredTools,outsideTools,visible:compose.checkVisibility({checkVisibilityCSS:true}),box,hit:!!hit&&(hit===compose||compose.contains(hit)),smallTools:tools.filter(e=>{const r=rect(e);return r.width<44||r.height<44;}).map(e=>e.id),overlapTools:tools.filter(e=>overlaps(rect(e))).map(e=>e.id),bodyOverlap:!!body&&overlaps({...rect(body),y:Math.max(rect(body).y,bar?rect(bar).bottom:0)}),overflow:document.documentElement.scrollWidth>innerWidth+1};
  });
}
async function screenshot(page,name,report){await page.evaluate(()=>document.fonts.ready);await rest(page);await page.mouse.move(0,990);await page.screenshot({path:path.join(out,name+'.png')});report.screenshots.push(name+'.png');}
async function main(){
  await fs.mkdir(out,{recursive:true});const css=await fs.readFile('assets/life/ui.css'),test=await fs.readFile(__filename);
  const mutant=process.env.SOURCE_COMPOSE_CSS_MUTANT?await fs.readFile(process.env.SOURCE_COMPOSE_CSS_MUTANT):null;
  const report={scope:'Real app/SDK/IDB with synthetic Auth/sources; no production requests, real account or Apple hardware',checks:[],geometry:[],screenshots:[],consoleErrors:[],pageErrors:[],external:[],expectedErrors:0,cssHash:hash(css),testHash:hash(test),mutation:mutant?{sha256:hash(mutant),isolatedBrowserRoute:true}:null};
  const browser=await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});report.browser=browser.version();
  try{for(const width of widths){
    const server=new FakeCloud(),context=await makeContext(browser,server,'source-compose-'+width,accounts.a,{viewport:{width,height:1000}});
    await context.route('**/*',route=>{const u=new URL(route.request().url());if([new URL(base).origin,cloud].includes(u.origin))return route.fallback();report.external.push(u.origin+u.pathname);return route.abort('blockedbyclient');});
    if(mutant)await context.route(base+'/assets/life/ui.css',route=>route.fulfill({contentType:'text/css',body:mutant}));
    const page=await context.newPage();page.setDefaultTimeout(12000);observe(page,report,String(width));
    try{
      await page.goto(base+'/index.html?section=records');await ready(page);await mode(page,'sources');
      const refs=await fixture(page);await page.reload();await ready(page);await mode(page,'sources');
      const compose=page.locator('[data-haedo-compose]');const listBox=await compose.boundingBox();assert(listBox,'List compose is visible');
      await page.locator('.life-source-open[data-version-id="'+refs.newer+'"]').click();await mode(page,'source');
      await page.locator('#lifeSourceInfoToggle').click();await page.locator('#lifeVersion').selectOption(refs.older);await settle(page);
      if(await page.locator('#lifeSourceInfoToggle').getAttribute('aria-expanded')==='true')await page.locator('#lifeSourceInfoToggle').click();
      assert.equal(await page.locator('#lifeSourceInfoToggle').getAttribute('aria-expanded'),'false');
      await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
      const initial=await geometry(page);report.geometry.push({width,scene:'reader-top',...initial,listBox});
      await screenshot(page,'reader-top-'+width,report);
      assert.equal(initial.visible,true,'Source reader keeps the shared compose control visible');
      for(const key of ['x','y','width','height'])assert(Math.abs(initial.box[key]-listBox[key])<=1,'Compose retains list '+key);
      assert(initial.box.width>=44&&initial.box.height>=44,'Compose touch target is at least 44px');
      assert.equal(initial.hit,true);assert.deepEqual(initial.obscuredTools,[]);assert.deepEqual(initial.outsideTools,[]);assert.deepEqual(initial.overlapTools,[]);assert.deepEqual(initial.smallTools,[]);assert.equal(initial.bodyOverlap,false);assert.equal(initial.overflow,false);
      assert.equal(await page.locator('#lifeSourceText').textContent(),raw);
      // Real sequential keyboard traversal, not focus() masquerading as keyboard reachability.
      await page.locator('.life-reader-tools button').first().focus();let found=false;
      for(let i=0;i<80;i++){await page.keyboard.press('Tab');if(await compose.evaluate(e=>e===document.activeElement)){found=true;break;}}
      assert(found,'Compose is reachable by keyboard');assert.equal(await compose.evaluate(e=>e.matches(':focus-visible')),true);
      await page.keyboard.press('Enter');await page.locator('#photoTitle').waitFor();
      await screenshot(page,'photo-editor-'+width,report);
      assert.equal(await page.locator('.photo-editor .ql-editor[contenteditable=true]').isVisible(),true);
      if(width<=760){assert.equal(await page.locator('[data-haedo-navigation]').isVisible(),false,'Photo editor keeps its focus mode');assert.equal(await compose.isVisible(),false);}
      await page.goBack();await mode(page,'source');
      assert.equal(await page.locator('#lifeSourceText').textContent(),raw,'Keyboard round-trip restores the exact older body');
      await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
      const before=await snapshot(page);
      await page.locator('#lifeExcerptToggle').click();await page.locator('#lifeSourceNote').fill(note);await page.locator('#lifeExcerptToggle').click();
      await page.evaluate(()=>{document.activeElement?.blur();scrollTo({top:1800,behavior:'instant'});});await page.mouse.wheel(0,100);await page.waitForFunction(()=>scrollY>=1890);
      const scrollBefore=await page.evaluate(()=>scrollY),scrolled=await geometry(page);
      const readingBefore=await page.evaluate(()=>{const e=document.querySelector('#lifeSourceText'),r=e.getBoundingClientRect(),c=document.caretRangeFromPoint(r.left+12,150);return {scrollY,bodyTop:r.top,bodyHeight:r.height,offset:c?.startContainer===e.firstChild?c.startOffset:null,tools:document.querySelector('.life-reader-tools').getBoundingClientRect().toJSON(),info:document.querySelector('#lifeSourceInfoToggle').getAttribute('aria-expanded')};});report.geometry.push({width,scene:'reader-scrolled',...scrolled});
      assert.deepEqual(scrolled.obscuredTools,[]);assert.deepEqual(scrolled.outsideTools,[]);assert.equal(scrolled.visible,true);assert.equal(scrolled.hit,true);assert.deepEqual(scrolled.overlapTools,[]);assert.equal(scrolled.bodyOverlap,false);assert.equal(scrolled.overflow,false);
      for(const key of ['x','y','width','height'])assert(Math.abs(scrolled.box[key]-listBox[key])<=1,'Scrolled compose retains '+key);
      await screenshot(page,'reader-scrolled-'+width,report);
      // A pointer opens the fixed control without keyboard focus scrolling the long document.
      await compose.click();await page.locator('#photoTitle').waitFor();await rest(page);
      await page.goBack();await mode(page,'source');
      assert.equal(await page.locator('#lifeSourceText').textContent(),raw,'Back restores the exact older body');
      const readingAfter=await page.evaluate(offset=>{const e=document.querySelector('#lifeSourceText'),r=e.getBoundingClientRect(),c=document.createRange();if(offset!=null){c.setStart(e.firstChild,offset);c.setEnd(e.firstChild,offset+1);}return {scrollY,bodyTop:r.top,bodyHeight:r.height,anchorY:offset!=null?c.getBoundingClientRect().y:null,tools:document.querySelector('.life-reader-tools').getBoundingClientRect().toJSON(),info:document.querySelector('#lifeSourceInfoToggle').getAttribute('aria-expanded')};},readingBefore.offset);report.geometry.push({width,scene:'reading-return-detail',before:readingBefore,after:readingAfter});
      await page.waitForFunction(top=>Math.abs(scrollY-top)<=2,scrollBefore).catch(async error=>{throw new Error('Back restores reading position: expected '+scrollBefore+', actual '+await page.evaluate(()=>scrollY)+'; '+error.message);});
      report.geometry.push({width,scene:'restored-position',before:scrollBefore,after:await page.evaluate(()=>scrollY)});
      await page.locator('#lifeExcerptToggle').click();assert.equal(await page.locator('#lifeSourceNote').inputValue(),note,'Unsaved source note survives compose round-trip');await page.locator('#lifeExcerptToggle').click();
      assert.deepEqual(await snapshot(page),before,'Reading and composing preserve original versions and excerpts');
      await compose.click();await page.locator('#photoTitle').waitFor();await page.locator('#photoTitle').fill('합성 사진 글 화면 회귀');await page.locator('.ql-editor').fill('사진 글 작성기의 기존 집중 화면을 확인합니다.');
      await page.getByRole('button',{name:'글 저장',exact:true}).click();await page.locator('.photo-article').waitFor();
      if(width<=760)assert.equal(await compose.isVisible(),true,'E218 photo reader keeps its restored compose control');
      assert.equal(await page.locator('.photo-read-heading').textContent(),'합성 사진 글 화면 회귀');
      await screenshot(page,'photo-reader-'+width,report);
      await library(page);await page.locator('.life-source-open[data-version-id="'+refs.newer+'"]').click();await mode(page,'source');
      await page.locator('#lifeSourceInfoToggle').click();await page.locator('#lifeSourceEdit').click();await page.locator('#lifeSourceEditText').waitFor();
      await screenshot(page,'source-edit-'+width,report);
      if(width<=760){assert.equal(await compose.isVisible(),false,'Source editing keeps its focus mode');assert.equal(await page.locator('[data-haedo-navigation]').isVisible(),false);}
      await page.goBack();await mode(page,'source');assert.equal(await page.locator('#lifeSourceText').textContent(),raw+'\r\n둘째 판에서만 보이는 문장.');
      await library(page);await page.locator('.life-source-open[data-version-id="'+refs.own+'"]').click();await mode(page,'source');
      assert.equal(await page.getByRole('button',{name:'내 글 수정',exact:true}).isVisible(),true);
      await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));const own=await geometry(page);report.geometry.push({width,scene:'own-writing-five-tools',...own});
      assert.equal(own.toolCount,5);assert.deepEqual(own.smallTools,[]);assert.deepEqual(own.overlapTools,[]);assert.deepEqual(own.obscuredTools,[]);assert.deepEqual(own.outsideTools,[]);assert.equal(own.overflow,false);
      assert.equal(await page.locator('#lifeReaderArrangePanel').isVisible(),false);assert.equal(await page.locator('#lifeExcerptPanel').isVisible(),false);assert.equal(await page.locator('#lifeVersion').isVisible(),false);
      await screenshot(page,'own-writing-'+width,report);
      await page.evaluate(()=>scrollTo({top:1900,behavior:'instant'}));const ownScrolled=await geometry(page);report.geometry.push({width,scene:'own-writing-scrolled',...ownScrolled});
      assert.equal(ownScrolled.toolCount,5);assert.equal(ownScrolled.hit,true);assert.deepEqual(ownScrolled.smallTools,[]);assert.deepEqual(ownScrolled.overlapTools,[]);assert.deepEqual(ownScrolled.obscuredTools,[]);assert.deepEqual(ownScrolled.outsideTools,[]);assert.equal(ownScrolled.bodyOverlap,false);

      await page.getByRole('button',{name:'내 글 수정',exact:true}).click();await page.locator('#lifeWritingBody').waitFor();if(width<=760)assert.equal(await compose.isVisible(),false,'Direct writing remains focused');
      assert.equal(server.writes().length,0,'No production-style forbidden platform writes');
      report.checks.push({width,pass:true});console.log('PASS source reader compose '+width);
    }catch(error){report.checks.push({width,pass:false,error:error.stack});await screenshot(page,'failure-'+width,report).catch(()=>{});console.error('FAIL '+width+' '+error.stack);}
    finally{await context.close();}
  }}finally{await browser.close();report.resourcesClosed=true;report.cssHashAfter=hash(await fs.readFile('assets/life/ui.css'));report.testHashAfter=hash(await fs.readFile(__filename));report.pass=report.checks.every(x=>x.pass)&&!report.consoleErrors.length&&!report.pageErrors.length&&!report.external.length&&report.cssHash===report.cssHashAfter&&report.testHash===report.testHashAfter;await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
  if(!report.pass)process.exitCode=1;
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});

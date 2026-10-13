'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4186';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.cwd(),phase=process.env.REFLECTION_AUDIT_PHASE||'before',out=path.join(root,'.local/reflection-to-outline',phase);
const {FakeCloud,accounts,cloud,base}=require(root+'/tests/life-sync-browser.cjs');
const {playwright,makeContext,observe}=require(root+'/tests/unified-home-browser.cjs');
const {importUI,arrangeReflection,samples,bookTitle,bookQuestion,reflectionNote}=require(root+'/tests/book-workshop-browser.cjs');
const {current,save,details}=require(root+'/tests/book-projects-browser.cjs');
const {inspect}=require(root+'/scripts/check-site-design.cjs');
async function geometry(page){return page.evaluate(()=>{
 const box=selector=>{const el=document.querySelector(selector);if(!el)return null;const r=el.getBoundingClientRect(),css=getComputedStyle(el),visible=el.checkVisibility({visibilityProperty:true});return{selector,visible,top:r.top,absoluteTop:r.top+scrollY,height:r.height,width:r.width,firstViewport:visible&&r.top<innerHeight&&r.bottom>0,fullyInViewport:visible&&r.top>=0&&r.bottom<=innerHeight,text:(el.value||el.getAttribute('aria-label')||el.innerText||'').slice(0,100),font:css.fontSize,line:css.lineHeight,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight}};
 return{scrollY,documentHeight:document.documentElement.scrollHeight,focus:document.activeElement?.id||document.activeElement?.tagName,heading:box('.life-workbench .wb-heading'),selection:box('details:has(> .wb-picker-list)'),period:box('#wbReflectionFrom')?.visible?box('#wbReflectionFrom'):box('.wb-reflection-controls > details'),time:box('#wbReflectionTime'),themes:box('#wbReflectionThemes'),facts:box('#wbReflectionSummary'),firstSource:box('#wbReflectionReading .wb-source'),note:box('#wbReflectionNote'),plan:box('#wbReflectionPlan'),planTitle:box('#wbPlanTitle'),planQuestion:box('#wbPlanQuestion'),firstCandidate:box('#wbPlanChapters > li'),create:box('#wbPlanCreate'),close:box('#wbPlanClose'),sourceBodies:[...document.querySelectorAll('#wbReflectionReading pre')].map(el=>({top:el.getBoundingClientRect().top,height:el.getBoundingClientRect().height,characters:el.textContent.length,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,scrollTop:el.scrollTop})),sourceRows:document.querySelectorAll('#wbReflectionReading .wb-source').length};
});}
async function capture(page,report,scene,width,{top=true}={}){
 const arrival=await geometry(page);await page.mouse.move(width-2,2);await page.evaluate(async top=>{document.activeElement?.blur();if(top)scrollTo({top:0,behavior:'instant'});await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))},top);
 const layout=await geometry(page),metrics=await page.evaluate(inspect),stem=`${scene}-${width}`;
 await page.screenshot({path:path.join(out,stem+'.png')});await page.screenshot({path:path.join(out,stem+'-full.png'),fullPage:true});
 report.screens.push({scene,width,arrival,layout,metrics,viewport:stem+'.png',full:stem+'-full.png'});await fs.writeFile(path.join(out,'audit-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({scene,width,firstSourceY:layout.firstSource?.top,noteY:layout.note?.top,firstCandidateY:layout.firstCandidate?.top,createY:layout.create?.top}));
}
async function period(page,from,to){const scope=await details(page,'작성 연도로 좁히기');await page.locator('#wbReflectionFrom').fill(from);await page.locator('#wbReflectionTo').fill(to);await page.locator('#wbReflectionApplyPeriod').click();if(await scope.evaluate(el=>el.open))await scope.locator(':scope > summary').click();}
async function main(){
 await fs.mkdir(out,{recursive:true});const backup=JSON.parse(await fs.readFile(path.join(root,'docs/design-review/evidence/book-edition/reader-book-backup.json'),'utf8'));
 samples[0].text+='\n\n'+backup.workbench.books[0].chapters[0].note;
 const thought=reflectionNote+'\n\n'+backup.workbench.books[0].chapters[1].note;
 const browser=await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const report={createdAt:new Date().toISOString(),phase,base,browser:browser.version(),scope:'Actual UI imported anonymous six sources/seven versions plus one exact old excerpt. First old-source text and present reflection use existing anonymous reader-book paragraphs for realistic long-reading stress; no IDB/source seeding, no production. Chromium viewports/touch only.',screens:[],journeys:[],consoleErrors:[],pageErrors:[],external:[],expectedErrors:0,remoteWrites:0};
 try{for(const width of(process.env.REFLECTION_AUDIT_WIDTHS||'390,820,1440').split(',').map(Number)){
  const server=new FakeCloud(),context=await makeContext(browser,server,'reflection-audit-'+width,accounts.a,{viewport:{width,height:width===390?844:1000},hasTouch:width<=820,reducedMotion:'reduce'});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if([new URL(base).origin,cloud].includes(url.origin))return route.fallback();report.external.push(url.origin);return route.abort()});
  const page=await context.newPage();page.setDefaultTimeout(12000);observe(page,report,''+width);
  try{
   const {refs,bundle}=await importUI(page);await arrangeReflection(page,refs);await page.locator('#wbReflectionNote').fill(thought);await save(page);
   await capture(page,report,'chronology',width);
   const selectedBefore=(await current(page)).workbench.reflection;await period(page,'2016','2019');assert.deepEqual((await current(page)).workbench.reflection,selectedBefore);
   const filtered=await geometry(page);assert.equal(filtered.sourceRows,3);await page.locator('#wbReflectionGroup').click();await page.locator('#wbIncomingSelection').waitFor();await page.locator(`#wbIncomingSelection input[data-version-id="${refs.link.versionId}"]`).uncheck();await page.locator('#wbIncomingTitle').fill('일과 쉼의 기준');await page.locator('#wbIncomingApply').click();await page.locator('#wbGroupsReflection').click();await page.locator('#wbReflectionNote').waitFor();await period(page,'','');await page.locator('#wbReflectionThemes').click();await capture(page,report,'themes',width);
   const saved=await current(page);assert.equal(saved.workbench.groups.length,1);assert.deepEqual(new Set(saved.workbench.groups[0].versionIds),new Set([refs.work.versionId,refs.rest.versionId]));assert.deepEqual(saved.workbench.reflection,selectedBefore);
   await page.locator('#wbReflectionTime').click();const old=page.locator(`#wbReflectionReading [data-version-id="${refs.work.versionId}"]`);const sourceBody=old.locator('details').filter({has:page.locator('summary', {hasText:'본문 읽기'})});await sourceBody.locator(':scope > summary').click();const pre=sourceBody.locator('pre');await pre.waitFor();assert.equal(await pre.textContent(),samples[0].text);
   if(width===390)await capture(page,report,'long-original',width);
   await pre.evaluate(el=>{el.scrollTop=el.scrollHeight;el.scrollIntoView({block:'end',behavior:'instant'})});const endOfSource=await geometry(page);
   await page.locator('#wbReflectionNote').click();const writingArrival=await geometry(page);if(width===390)await capture(page,report,'current-thought',width,{top:false});
   const beforePlan=await geometry(page);await page.locator('#wbReflectionPlan').click();await page.locator('#wbPlanTitle').fill(bookTitle);await page.locator('#wbPlanQuestion').fill(bookQuestion);await capture(page,report,'outline',width);
   const candidates=await page.locator('#wbPlanChapters [data-plan-key]').evaluateAll(nodes=>nodes.map(n=>n.dataset.planKey));assert.equal(candidates.length,5);await page.locator('#wbPlanThemes').click();assert.equal(await page.locator('#wbPlanChapters > li').count(),2);await page.locator('#wbPlanTime').click();await page.locator('#wbPlanClose').click();await page.locator('#wbReflectionNote').waitFor();const afterReturn=await geometry(page);assert.equal(await page.locator('#wbReflectionNote').inputValue(),thought);assert.deepEqual((await current(page)).bundle,bundle);assert.deepEqual((await current(page)).workbench.reflection,selectedBefore);assert.equal((await current(page)).workbench.books,undefined);assert.equal(server.writes().length,0);
   report.journeys.push({width,pass:true,sourceTextCharacters:samples[0].text.length,thoughtCharacters:thought.length,filtered,sourceEnd:endOfSource,writingArrival,beforePlan,afterReturn,selectionUnchanged:true,oldExactText:true,groupIntersectionOnly:true,bookNotCreatedDuringReview:true});console.log('PASS audit '+width);
  }catch(error){report.journeys.push({width,pass:false,error:error.stack});console.error(error.stack);await page.screenshot({path:path.join(out,`failure-${width}.png`),fullPage:true}).catch(()=>{});}
  finally{await context.close();}
 }}finally{await browser.close();report.finishedAt=new Date().toISOString();report.pass=report.journeys.every(j=>j.pass)&&!report.consoleErrors.length&&!report.pageErrors.length&&!report.external.length;const json=JSON.stringify(report,null,2);await fs.writeFile(path.join(out,'run-'+report.createdAt.replace(/[:.]/g,'-')+'.json'),json);await fs.writeFile(path.join(out,'audit-report.json'),json);if(!report.pass)process.exitCode=1;}
}
main().catch(error=>{console.error(error);process.exitCode=1});

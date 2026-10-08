/* Actual manuscript layout: anonymous UI restore, Korean title/input and visible-chapter return.
 * BASE_URL, PW_MODULE_PATH/PLAYWRIGHT_MODULE, CHROMIUM_PATH; BOOK_MANUSCRIPT_LAYOUT_WIDTHS. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
if(!process.env.PW_MODULE_PATH && process.env.PLAYWRIGHT_MODULE)process.env.PW_MODULE_PATH=process.env.PLAYWRIGHT_MODULE;
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.cwd(),out=path.join(root,'.local/book-design-reset-app/caret');
const {FakeCloud,accounts,cloud,base}=require(root+'/tests/life-sync-browser.cjs');
const {playwright,makeContext,observe}=require(root+'/tests/unified-home-browser.cjs');
const {restore,chapterFrom}=require(root+'/tests/book-completion-browser.cjs');
const {current}=require(root+'/tests/book-projects-browser.cjs');
const {inspect}=require(root+'/scripts/check-site-design.cjs');
const {abortWorkbenchWrites}=require(root+'/tests/life-workbench-browser.cjs');
const brief=({value,...position})=>({...position,characters:value.length});
function annotation(error){if(process.env.GITHUB_ACTIONS)console.error('::error title=Book manuscript layout::'+String(error.stack||error).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'));}
const snap=page=>page.locator('#wbChapterNote').evaluate(el=>({start:el.selectionStart,end:el.selectionEnd,scrollY,top:el.getBoundingClientRect().top,height:el.clientHeight,scrollHeight:el.scrollHeight,value:el.value,focus:document.activeElement?.id}));
// Coordinate input needs the font/textarea layout and native caret reveal to
// finish first. Keep the insertion/save/return invariants below unchanged.
const settle=page=>page.evaluate(async()=>{
 await document.fonts.ready;
 await new Promise((resolve,reject)=>{
  const began=performance.now();let previous='',stableAt=began;
  const frame=now=>{const el=document.querySelector('#wbChapterNote'),rect=el.getBoundingClientRect(),next=[scrollY,rect.top,rect.height,el.selectionStart,el.selectionEnd].join(':');if(next!==previous){previous=next;stableAt=now;}if(now-began>=200&&now-stableAt>=150)resolve();else if(now-began>3000)reject(new Error('Manuscript layout did not settle before coordinate input'));else requestAnimationFrame(frame);};requestAnimationFrame(frame);
 });
});
async function main(){
 await fs.mkdir(out,{recursive:true});const browser=await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const report={createdAt:new Date().toISOString(),browser:browser.version(),scope:'Actual restored app: long title and mid-manuscript input/reading return. Plain Korean insertion and synthetic composition events only; not native Apple IME.',checks:[],observations:[],consoleErrors:[],pageErrors:[],external:[],expectedErrors:0,remoteWrites:0};
 report.runtime={};for(const file of['assets/life/workbench-ui.js','assets/life/workbench.css'])report.runtime[file]=require('node:crypto').createHash('sha256').update(await fs.readFile(file)).digest('hex');
 try{for(const width of(process.env.BOOK_MANUSCRIPT_LAYOUT_WIDTHS||'390,820,1440').split(',').map(Number)){
  const server=new FakeCloud(),context=await makeContext(browser,server,'app-caret-'+width,accounts.a,{viewport:{width,height:width===390?844:1000},hasTouch:width<=820,reducedMotion:'reduce'});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if([new URL(base).origin,cloud].includes(url.origin))return route.fallback();report.external.push(url.origin);return route.abort()});
  const page=await context.newPage();page.setDefaultTimeout(12000);observe(page,report,''+width);
  try{
   const pending=await restore(page),before=await pending.install(),book=before.workbench.books[0],chapter=book.chapters[1];
   await chapterFrom(page,page.locator(`#wbBookList [data-book-id="${book.id}"]`),chapter);
   const title='쉬는 동안 생긴 기준 — 할 일을 줄이는 대신 하루의 순서를 정하고, 오래 좋아하던 산책과 메모를 다시 생활 안으로 가져온 시간';
   await page.locator('#wbChapterTitle').fill(title);await page.keyboard.press('End');await page.keyboard.press('Enter');assert.equal(await page.locator('#wbChapterTitle').inputValue(),title);
   await page.keyboard.insertText('\n다시 읽으며');assert.equal(await page.locator('#wbChapterTitle').inputValue(),title+'다시 읽으며');
   await page.locator('#wbChapterTitle').dispatchEvent('compositionstart');await page.locator('#wbChapterTitle').fill(title+'\n나의 기준');assert((await page.locator('#wbChapterTitle').inputValue()).includes('\n'));
   await page.locator('#wbChapterTitle').dispatchEvent('compositionend');const finalTitle=title+'나의 기준';assert.equal(await page.locator('#wbChapterTitle').inputValue(),finalTitle);
   const titleMetrics=await page.locator('#wbChapterTitle').evaluate(el=>({client:el.clientHeight,scroll:el.scrollHeight,line:parseFloat(getComputedStyle(el).lineHeight)}));assert(titleMetrics.client>titleMetrics.line*1.5);assert(titleMetrics.scroll<=titleMetrics.client+1);
   await settle(page);
   await page.evaluate(()=>{const el=document.querySelector('#wbChapterNote');el.focus({preventScroll:true});scrollTo({top:scrollY+el.getBoundingClientRect().top+200,behavior:'instant'})});await settle(page);
   const inputBox=await page.locator('#wbChapterNote').boundingBox();await page.mouse.click(inputBox.x+Math.min(inputBox.width/2,160),360);await settle(page);const inputBefore=await snap(page);assert(inputBefore.start>0&&inputBefore.start<chapter.note.length);assert(inputBefore.scrollY>200);
   await page.keyboard.insertText(' 지금의 나로 다시 읽는다.');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const inputAfter=await snap(page);assert(Math.abs(inputAfter.scrollY-inputBefore.scrollY)<2,'Auto height input must not jump the page');assert.equal(inputAfter.scrollHeight,inputAfter.height);assert.equal(inputAfter.start,inputBefore.start+' 지금의 나로 다시 읽는다.'.length);
   const finalNote=inputAfter.value;await page.waitForFunction(async({workspace,chapterId,note,title})=>{const w=await HaedoLife.Shell.storage.readWorkbench(workspace),c=w.books[0].chapters.find(c=>c.id===chapterId);return c.note===note&&c.title===title},{workspace:before.bundle.workspaceId,chapterId:chapter.id,note:finalNote,title:finalTitle});
   const afterSave=await snap(page),readButton=await page.locator('#wbBookPreviewOpen').boundingBox();await page.evaluate(()=>document.querySelector('#wbBookPreviewOpen').addEventListener('pointerdown',()=>{const n=document.querySelector('#wbChapterNote');window.__pointerRead={scrollY,top:n.getBoundingClientRect().top};},{capture:true,once:true}));await page.evaluate(()=>document.querySelector('#wbBookPreviewOpen').addEventListener('click',()=>{const n=document.querySelector('#wbChapterNote');window.__beforeRead={scrollY,top:n.getBoundingClientRect().top,start:n.selectionStart,end:n.selectionEnd};},{capture:true,once:true}));assert(readButton.y>=0&&readButton.y+readButton.height< (width===390?844:1000));const point={x:readButton.x+readButton.width/2,y:readButton.y+readButton.height/2};assert.equal(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.closest('button')?.id,point),'wbBookPreviewOpen');if(width<=820)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);const beforeRead=await page.evaluate(()=>window.__beforeRead),pointerRead=await page.evaluate(()=>window.__pointerRead);await page.locator('#wbBookPreview').waitFor();await page.locator('#wbBookPreviewOutline > summary').click();await page.locator('#wbBookPreviewOutline').getByRole('button',{name:finalTitle,exact:true}).click();const readChapters=await page.locator('[data-preview-chapter-id]').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.previewChapterId,top:n.getBoundingClientRect().top,bottom:n.getBoundingClientRect().bottom})));await page.locator('#wbBookPreviewBack').click();await page.locator('#wbChapterNote').waitFor();const returned=await snap(page);assert.equal(await page.locator('.wb-book-editor').getAttribute('data-active-chapter-id'),chapter.id,'Outline jump then global writing edits the currently visible chapter, not the previous chapter trailing margin');
   report.observations.push({width,titleMetrics,inputBefore:brief(inputBefore),inputAfter:brief(inputAfter),afterSave:brief(afterSave),pointerRead,beforeRead,returned:brief(returned),readChapters});assert(Math.abs(afterSave.scrollY-inputAfter.scrollY)<2,'Saving must not shift the manuscript');assert(Math.abs(pointerRead.scrollY-inputAfter.scrollY)<2,'Visible coordinate click does not auto-scroll the page');assert.equal(returned.focus,'wbChapterNote');assert.equal(returned.start,inputAfter.start);assert.equal(returned.end,inputAfter.end);assert.equal(returned.value,finalNote);assert(Math.abs(returned.top-inputAfter.top)<3,'Reading return keeps the same manuscript viewport offset');
   await page.locator('#wbChapterEvidence > summary').focus();await page.keyboard.press('Enter');const opened=await snap(page);assert.equal(opened.start,inputAfter.start);assert.equal(opened.end,inputAfter.end);assert.equal(opened.value,finalNote);assert.equal(await page.locator('#wbChapterTitle').inputValue(),finalTitle);
   await page.keyboard.press('Enter');const closed=await snap(page);assert.equal(closed.start,inputAfter.start);assert.equal(closed.value,finalNote);
   const stored=await current(page);assert.deepEqual(stored.bundle,before.bundle);assert.deepEqual(stored.workbench.books[0].editions,book.editions);assert.deepEqual(stored.workbench.reflection,before.workbench.reflection);
   await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0)});await page.mouse.move(width-2,2);const metrics=await page.evaluate(inspect);assert.equal(metrics.horizontalOverflow,false);for(const key of['smallTargets','smallInputs','unnamed','contrastFailures'])assert.deepEqual(metrics[key],[]);
   await page.screenshot({path:path.join(out,`long-title-${width}.png`)});assert.equal(server.writes().length,0);
   let saveError=null;
   if(width===390){
    await abortWorkbenchWrites(page,true);const failedNote=finalNote+'\n저장 실패에도 보존할 문장.';await page.locator('#wbChapterNote').fill(failedNote);await page.evaluate(()=>scrollTo(0,500));await page.locator('#wbBookPreviewReturn').click();await page.locator('#wbError').waitFor({state:'visible'});assert.equal(await page.locator('#wbBookPreview').count(),0);assert.equal(await page.locator('#wbChapterNote').inputValue(),failedNote);
    await page.mouse.move(width-2,2);saveError=await page.locator('#wbError').evaluate(el=>({top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom,viewport:innerHeight,text:el.innerText}));assert(saveError.top>=0&&saveError.top<saveError.viewport-44,'Failed save remains visibly discoverable in the manuscript viewport');await page.screenshot({path:path.join(out,'save-error-390.png')});
    await abortWorkbenchWrites(page,false);await page.locator('#wbError').getByRole('button',{name:'다시 저장',exact:true}).click();await page.waitForFunction(async({workspace,chapterId,note})=>{const w=await HaedoLife.Shell.storage.readWorkbench(workspace);return w.books[0].chapters.find(c=>c.id===chapterId).note===note},{workspace:before.bundle.workspaceId,chapterId:chapter.id,note:failedNote});
   }
   report.checks.push({width,pass:true,titleMetrics,inputBefore:brief(inputBefore),inputAfter:brief(inputAfter),returned:brief(returned),readChapters,sourceToggleSelectionPreserved:true,saveError,metrics});console.log('PASS '+width+' long title, midpoint input, reading return and source toggle');
  }catch(error){report.checks.push({width,pass:false,error:error.stack});console.error(error.stack);annotation(error);await page.screenshot({path:path.join(out,`failure-${width}.png`),fullPage:true}).catch(()=>{});}
  finally{await context.close();}
 }}finally{await browser.close();report.finishedAt=new Date().toISOString();report.pass=report.checks.every(c=>c.pass)&&!report.consoleErrors.length&&!report.pageErrors.length&&!report.external.length;const json=JSON.stringify(report,null,2);await fs.writeFile(path.join(out,'run-'+report.createdAt.replace(/[:.]/g,'-')+'.json'),json);await fs.writeFile(path.join(out,'report.json'),json);console.log(JSON.stringify({checks:report.checks.length,passed:report.checks.filter(c=>c.pass).length,consoleErrors:report.consoleErrors.length,pageErrors:report.pageErrors.length,external:report.external.length,report:path.join(out,'report.json')}));if(!report.pass)process.exitCode=1;}
}
if(require.main===module)main().catch(e=>{console.error(e);annotation(e);process.exitCode=1});

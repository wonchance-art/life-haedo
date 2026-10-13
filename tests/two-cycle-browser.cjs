'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {playwright,makeContext,ready,nav}=require('./unified-home-browser.cjs');
const {accounts,cloud,base}=require('./life-sync-browser.cjs');
const {ShareCloud}=require('./life-share-browser.cjs');
const {importUI,arrangeReflection,latestBody}=require('./book-workshop-browser.cjs');
const {current,abortWorkbenchWrites}=require('./life-workbench-browser.cjs');
const {inspect}=require('../scripts/check-site-design.cjs');
const out=path.resolve('.local/two-cycle'),thought='좋아하는 일을 다시 만날 시간을 남겨 두기\n\n예전에는 잘하는 모습부터 보여 주고 싶었다. 지금은 오래 궁금한 것을 천천히 읽어 보고 싶다. 타인의 문장은 그 사람의 생각으로 남겨 둔다.\n\n다음 질문: 주말에 같은 길을 걸으면 무엇을 새로 알아차릴까?';
const report={checks:[],visual:[],pageErrors:[],consoleErrors:[],external:[],scope:'Anonymous Korean imports via actual UI, real IndexedDB, mock Auth and publication HTTP. No production, AI or real Apple devices.'};
async function main(){await fs.mkdir(out,{recursive:true});const browser=await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});report.browser=browser.version();const server=new ShareCloud(),context=await makeContext(browser,server,'two-cycle',accounts.a,{viewport:{width:1440,height:1000},hasTouch:true});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if([new URL(base).origin,cloud].includes(u.origin))return route.fallback();report.external.push(u.origin);return route.abort();});
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
 const click=name=>page.getByRole('button',{name,exact:true}).click();
 const snap=async scene=>{for(const width of [1440,820,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(out,`${scene}-${width}.png`)});const metrics=await page.evaluate(inspect);report.visual.push({scene,width,metrics});assert(!metrics.horizontalOverflow);for(const k of ['smallTargets','smallInputs','unnamed','contrastFailures'])assert.deepEqual(metrics[k],[],scene+' '+k);}};
 const readDrafts=()=>page.evaluate(async()=>{const s=HaedoLife.Shell.storage;return s.readPageDrafts(await s.getActive());});
 const outputs=async()=>{await page.locator('#wbReflectionFileOpen').click();};
 let original,refs,firstDraft;
 try{
 await check('Import original versions, excerpt, selected evidence and current thought through the UI',async()=>{
  const imported=await importUI(page);original=imported.bundle;refs=imported.refs;await arrangeReflection(page,refs,['work','taste','other']);await page.locator('#wbReflectionNote').fill(thought);await click('지금 저장');assert.equal((await current(page)).workbench.reflection.note,thought);assert.deepEqual((await current(page)).workbench.reflection.versionIds,[refs.work.versionId,refs.taste.versionId,refs.other.versionId]);await snap('reflection');
 });
 await check('Lens reading and thought editing return to a visible exact source',async()=>{
  await page.locator('#wbReflectionLenses').click();await page.locator('#wbLenses [data-kind=interests]').click();const row=page.locator('#wbLenses .wb-source').first();await row.scrollIntoViewIfNeeded();await page.locator('#wbReflectionWrite').click();await page.locator('#wbReflectionReadReturn').click();assert(await page.locator('#wbLenses').isVisible());assert(await page.evaluate(()=>document.activeElement.closest('#wbLenses')!==null));await snap('evidence');
 });
 await check('Private Markdown contains the authored thought and selected exact references',async()=>{
  await outputs();const pending=page.waitForEvent('download');await page.locator('#wbReflectionExport').click();const text=await fs.readFile(await(await pending).path(),'utf8');assert(text.includes(thought));assert(!text.includes(latestBody));await fs.writeFile(path.join(out,'private-reflection.md'),text);
 });
 await check('Failed reflection save and failed draft write keep the thought on its original screen',async()=>{
  await page.locator('#wbReflectionNote').fill(thought+'\n추가 질문');await abortWorkbenchWrites(page,true);await page.locator('#wbReflectionToPage').click();await page.locator('#wbError:not([hidden])').waitFor();assert.equal(await page.locator('#wbReflectionNote').inputValue(),thought+'\n추가 질문');assert.equal((await readDrafts()).posts.length,0);await abortWorkbenchWrites(page,false);await page.locator('#wbReflectionNote').fill(thought);await click('지금 저장');
  await page.evaluate(()=>{window.__cyclePut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const result=__cyclePut.apply(this,args);if(this.name==='meta'&&args[0]?.key?.startsWith('page-drafts:'))this.transaction.abort();return result;};});await page.locator('#wbReflectionToPage').click();await page.locator('#wbError:not([hidden])').waitFor();assert.equal(await page.locator('#wbReflectionNote').inputValue(),thought);assert.equal((await readDrafts()).posts.length,0);await snap('copy-error');await page.evaluate(()=>{IDBObjectStore.prototype.put=__cyclePut;delete window.__cyclePut;});
 });
 await check('Copy only authored thought to a private draft; return and retry do not duplicate it',async()=>{
  await page.locator('#wbReflectionToPage').click();await page.locator('#ppBody').waitFor();assert.equal(await page.locator('#ppBody').inputValue(),thought);assert.equal(await page.locator('#ppVisibility').inputValue(),'private');let d=await readDrafts();assert.equal(d.posts.length,1);firstDraft=d.posts[0].id;assert.deepEqual(d.posts[0].attachments,[]);assert.deepEqual((await current(page)).bundle,original);assert(!(await current(page)).workbench.page.posts?.length);await snap('draft');
  await click('회고로 돌아가기');await page.waitForFunction(()=>document.activeElement.id==='wbReflectionToPage');await page.locator('#wbReflectionToPage').click();await page.locator('#ppBody').waitFor();d=await readDrafts();assert.equal(d.posts.length,1);assert.equal(d.posts[0].id,firstDraft);
 });
 await check('Attach a taste without preregistration, save, revisit and preserve the source reflection',async()=>{
  await click('음악·책·대상 붙이기');await page.locator('#clPickerQuery').fill('조용한 산책을 위한 음악');await click('직접 입력');await page.getByRole('textbox',{name:'아티스트·저자',exact:true}).fill('익명 음악가');await page.getByRole('textbox',{name:'출처 링크',exact:true}).fill('https://example.org/anonymous-music');await click('첨부');await click('저장');await page.locator('.pp-feed .pp-post').waitFor();assert.equal((await current(page)).workbench.reflection.note,thought);assert.equal((await current(page)).workbench.page.posts[0].visibility,'private');await click('방문자 미리보기');assert.equal(await page.locator('#wbVisitor .pp-post').count(),0);await click('편집으로 돌아가기');await snap('saved-feed');
  await page.reload();await ready(page);await page.locator('.pp-feed .pp-post').waitFor();assert.equal((await current(page)).workbench.page.posts[0].body,thought);
 });
 await check('Select output explicitly, publish mock copy, read it and revoke it without leaking the source',async()=>{
  await page.locator('.pp-feed').getByRole('button',{name:'글 수정',exact:true}).click();await page.locator('#ppVisibility').selectOption('page');await click('저장');await page.locator('#wbPageShare').click();await page.locator('#wbSharePreview').waitFor();assert.equal(server.publicationWrites().length,0);await snap('output-review');await page.locator('#wbShareConsent').check();await page.locator('#wbSharePublish').click();await page.locator('#wbShareUrl').waitFor({state:'visible'});const url=await page.locator('#wbShareUrl').getAttribute('href'),row=[...server.pages.values()][0];assert(JSON.stringify(row.snapshot).includes(JSON.stringify(thought)));assert(!JSON.stringify(row.snapshot).includes(refs.work.versionId));assert(!JSON.stringify(row.snapshot).includes(original.sourceVersions.find(v=>v.id===refs.other.versionId).contentText));
  const visitor=await context.newPage();await visitor.goto(url);await visitor.locator('#shareContent').waitFor({state:'visible'});assert((await visitor.locator('#shareContent').textContent()).includes(thought));await visitor.close();await page.locator('#wbShareRevoke').click();await page.locator('#wbShareRevokeConfirm').click();await page.waitForFunction(()=>!document.querySelector('#wbShareUrl')||document.querySelector('#wbShareUrl').hidden);assert.equal([...server.pages.values()][0].published,false);await page.locator('#wbShareBack').click();
 });
 await check('Saved private result and originals survive actual backup download and new-copy restoration',async()=>{
  await nav(page,'manage');await click('자료·구성 백업');await page.locator('#wbBackupDownload').waitFor();const download=page.waitForEvent('download');await page.locator('#wbBackupDownload').click();const bytes=await fs.readFile(await(await download).path());await page.locator('#wbRestoreFile').setInputFiles({name:'anonymous-cycle-backup.json',mimeType:'application/json',buffer:bytes});await page.locator('#wbRestoreInstall').click();await page.locator('#lifeRestoreResult').waitFor();const value=await current(page);assert.notEqual(value.bundle.workspaceId,original.workspaceId);assert.equal(value.workbench.reflection.note,thought);assert.equal(value.workbench.page.posts[0].body,thought);assert.deepEqual(value.bundle.sourceVersions.map(v=>v.contentText),original.sourceVersions.map(v=>v.contentText));assert.deepEqual(await page.evaluate(id=>HaedoLife.Shell.storage.read(id),original.workspaceId),original);
 });
 await check('Return to the same evidence and record a new question without changing the saved output',async()=>{
  await nav(page,'tools');await click('회고');await page.locator('#wbReflectionNote').waitFor();await page.locator('#wbReflectionNote').fill(thought+'\n\n다녀온 뒤: 같은 길에서도 지난번과 다른 소리가 들렸다. 다음에는 무엇을 기록할까?');await click('지금 저장');assert.equal((await current(page)).workbench.page.posts[0].body,thought);await page.reload();await ready(page);await page.locator('#wbReflectionNote').waitFor();assert.match(await page.locator('#wbReflectionNote').inputValue(),/다녀온 뒤/);await snap('return-question');
 });
 assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.external,[]);report.mockPublicationWrites=server.publicationWrites().length;report.pass=true;
 }finally{await browser.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
}
main().catch(e=>{console.error(e);if(process.env.GITHUB_ACTIONS)console.error('::error title=Two-cycle flow::'+String(e.stack||e).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'));process.exitCode=1;});

'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {fixture,sha}=require('./fixtures/original-attachments.cjs');
const {playwright,makeContext,ready}=require('./unified-home-browser.cjs');
const {FakeCloud,accounts,cloud,base}=require('./life-sync-browser.cjs');
const integrated=process.env.ORIGINALS_INTEGRATED==='1';
const out=path.resolve(integrated?'.local/original-attachments-integrated':'.local/original-attachments');
const report={integrated,checks:[],screenshots:[],errors:[],consoleErrors:[],external:[],scope:'Anonymous fixtures, real app/SDK/IndexedDB, intercepted Auth. No original user files, real server writes or Apple device validation.'};
async function main(){
 await fs.mkdir(out,{recursive:true}); const f=fixture(),server=new FakeCloud();
 const browser=await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 report.browser=browser.version(); const context=await makeContext(browser,server,'original-attachments',accounts.a);
 await context.route('**/*',route=>{const origin=new URL(route.request().url()).origin;if([new URL(base).origin,cloud].includes(origin))return route.fallback();report.external.push(origin);return route.abort();});
 const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 const check=async(name,fn)=>{try{await fn();report.checks.push(name);console.log('PASS '+name);}catch(error){await fs.writeFile(path.join(out,'failure.txt'),await page.locator('body').innerText());await page.screenshot({path:path.join(out,'failure.png')});throw error;}};
 const inject=async()=>{if(integrated){assert.equal(await page.evaluate(()=>!!HaedoLife.OriginalAttachments&&!!HaedoLife.OriginalAttachmentsUI&&!!document.querySelector('link[href*="original-attachments.css"]')),true,'production scripts/CSS must already be connected');return;}if(!await page.evaluate(()=>!!HaedoLife.OriginalAttachments))await page.addScriptTag({url:base+'/assets/life/original-attachments.js'});if(!await page.evaluate(()=>!!HaedoLife.OriginalAttachmentsUI))await page.addScriptTag({url:base+'/assets/life/original-attachments-ui.js'});await page.addStyleTag({url:base+'/assets/life/original-attachments.css'});};
 const open=async()=>{if(integrated){await page.locator('[data-haedo-navigation] [data-haedo-section="manage"]').click();await page.locator('#lifeOriginalAttachmentsOpen').click();await page.locator('#lifeOriginalAttachments').waitFor();}else await page.evaluate(async()=>{window.__originalsDialog=await LifeOriginalAttachmentsUI.open();});};
 const upload=async(buffer=f.zip)=>{await page.locator('#originalAttachmentsFile').setInputFiles({name:'anonymous-part.zip',mimeType:'application/zip',buffer});await page.locator('#originalAttachmentsInstall').waitFor();};
 const workspace=()=>page.evaluate(async()=>{const s=HaedoLife.Shell.storage;return JSON.stringify({rows:await s.listWorkspaces(),active:await s.getActive()});});
 let baseline,batchBaseline,id;
 try{
  await page.goto(base+'/index.html?section=manage');await ready(page);await inject();baseline=await workspace();
  await check('verified account preview/cancel and invalid ZIP leave existing materials untouched',async()=>{
   await open();await upload();assert.equal(await workspace(),baseline);
   assert.match(await page.locator('#originalAttachmentsReview').innerText(),/5개/);
   await page.getByRole('button',{name:'보관 취소',exact:true}).click();assert.equal(await workspace(),baseline);
   await page.locator('#originalAttachmentsFile').setInputFiles({name:'broken.zip',mimeType:'application/zip',buffer:Buffer.from('broken')});await page.locator('#originalAttachmentsError:not([hidden])').waitFor();assert.equal(await workspace(),baseline);
  });
  await check('aborted IndexedDB install leaves zero copies; retry preserves originals and versions',async()=>{
   await upload();await page.evaluate(()=>{const add=IDBObjectStore.prototype.add;window.__originalAdd=add;IDBObjectStore.prototype.add=function(...args){const result=add.apply(this,args);if(this.name==='copies')this.transaction.abort();return result;};});
   await page.locator('#originalAttachmentsInstall').click();await page.locator('#originalAttachmentsError:not([hidden])').waitFor();
   assert.equal(await page.locator('#originalAttachmentsCopies .original-attachments-copy').count(),0);
   await page.evaluate(()=>{IDBObjectStore.prototype.add=__originalAdd;});
   await page.locator('#originalAttachmentsInstall').click();await page.locator('.original-attachments-entry').first().waitFor();
   assert.equal(await page.locator('.original-attachments-entry').count(),5);assert.equal(await workspace(),baseline);
   id=await page.evaluate(async()=>{const s=HaedoLife.OriginalAttachments.create();try{return(await s.list())[0].id;}finally{s.dispose();}});
   assert.equal(await page.locator('embed,object,#lifeOriginalAttachments iframe,#lifeOriginalAttachments img').count(),0);
  });
  await check('raw file and ZIP download retain exact bytes; note HTML stays literal',async()=>{
   const fileEvent=page.waitForEvent('download');await page.locator('.original-attachments-entry').first().getByRole('button',{name:'원본 파일 받기',exact:true}).click();const file=await fileEvent;assert.equal(sha(await fs.readFile(await file.path())),f.receipt.entries[0].sha256);
   const zipEvent=page.waitForEvent('download');await page.getByRole('button',{name:'파트 원본 ZIP 받기',exact:true}).click();const zip=await zipEvent;assert.equal(sha(await fs.readFile(await zip.path())),sha(f.zip));
   const working=page.locator('[data-role="working-note-version"]');await working.getByRole('button',{name:'원문 그대로 읽기',exact:true}).click();assert.match(await working.locator('pre').innerText(),/<script>/);assert.equal(await page.evaluate(()=>globalThis.__originalsXSS),undefined);
  });
  await check('desktop/tablet/mobile widths retain named touch controls and no dialog overflow',async()=>{
   for(const width of[1440,820,390]){await page.setViewportSize({width,height:1000});await page.locator('#lifeOriginalAttachments').evaluate(n=>n.scrollTop=0);
    const metrics=await page.locator('#lifeOriginalAttachments').evaluate(n=>({overflow:n.scrollWidth>n.clientWidth+1,small:[...n.querySelectorAll('button,input')].filter(e=>!e.hidden&&e.getBoundingClientRect().height>0&&e.getBoundingClientRect().height<40).map(e=>e.textContent),unnamed:[...n.querySelectorAll('button')].filter(e=>!e.textContent.trim()&&!e.getAttribute('aria-label')).length}));assert.equal(metrics.overflow,false);assert.deepEqual(metrics.small,[]);assert.equal(metrics.unnamed,0);
    const target=path.join(out,'originals-'+width+'.png');await page.screenshot({path:target});report.screenshots.push({width,path:target,metrics});}
  });
  await check('new-copy restore and reload preserve both immutable copies',async()=>{
   await upload();await page.locator('#originalAttachmentsInstall').click();await page.waitForFunction(()=>document.querySelectorAll('.original-attachments-copy').length===2);assert.equal(await workspace(),baseline);
   await page.reload();await ready(page);await inject();await open();assert.equal(await page.locator('.original-attachments-copy').count(),2);
  });
  await check('cancel after async hash and account change before commit cannot write',async()=>{
   await page.locator('#lifeOriginalAttachments').getByRole('button',{name:'닫기',exact:true}).click();
   const result=await page.evaluate(async array=>{
    const blob=new Blob([new Uint8Array(array)]);let current=true;
    const owner=HaedoLife.OriginalAttachments.create({isCurrent:()=>current});
    let failed;try{await owner.prepare(blob,{onProgress:()=>{current=false;}});}catch(e){failed=e.code;}finally{owner.dispose();}
    const second=HaedoLife.OriginalAttachments.create({isCurrent:()=>current=true});const candidate=await second.prepare(blob);second.dispose();let beforeCommit;try{await second.install(candidate.ticket);}catch(e){beforeCommit=e.code;}
    const live=HaedoLife.OriginalAttachments.create();const count=(await live.list()).length;live.dispose();return{failed,beforeCommit,count};
   },[...f.zip]);assert.deepEqual(result,{failed:'originals_scope_closed',beforeCommit:'originals_scope_closed',count:2});
  });
  await check('account switch during hashing or insert aborts download and transaction before commit',async()=>{
   const result=await page.evaluate(async({id,array,rawPath})=>{
    let current=true;const owner=HaedoLife.OriginalAttachments.create({isCurrent:()=>current});const candidate=await owner.prepare(new Blob([new Uint8Array(array)]));
    const add=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(...args){const req=add.apply(this,args);if(this.name==='copies')req.addEventListener('success',()=>{current=false;});return req;};let insert;
    try{await owner.install(candidate.ticket);}catch(e){insert=e.code;}finally{IDBObjectStore.prototype.add=add;owner.dispose();}
    current=true;const reader=HaedoLife.OriginalAttachments.create({isCurrent:()=>current}),digest=SubtleCrypto.prototype.digest;
    SubtleCrypto.prototype.digest=async function(...args){const value=await digest.apply(this,args);current=false;return value;};let download;
    try{await reader.file(id,rawPath);}catch(e){download=e.code;}finally{SubtleCrypto.prototype.digest=digest;reader.dispose();}
    const live=HaedoLife.OriginalAttachments.create();const count=(await live.list()).length;live.dispose();return{insert,download,count};
   },{id,array:[...f.zip],rawPath:f.receipt.entries[0].snapshotPath});assert.deepEqual(result,{insert:'originals_scope_closed',download:'originals_scope_closed',count:2});
  });
  await check('exact source path and hash match only the requested note version',async()=>{
   const result=await page.evaluate(async({id,hash})=>{const owner=HaedoLife.OriginalAttachments.create();try{const rows=await owner.entries(id),entry=rows.find(e=>e.role==='git-note-version');const storage={listWorkspaces:async()=>[{workspaceId:'anonymous-space'}],read:async()=>({workspaceId:'anonymous-space',sources:[{id:'source',sourceKey:'notes/익명.md',title:'익명 원문'}],sourceVersions:[{id:'exact',sourceId:'source',contentHash:hash},{id:'wrong',sourceId:'source',contentHash:'0'.repeat(64)}]})};return(await owner.matchSource(entry,storage)).map(m=>m.versionId);}finally{owner.dispose();}},{id,hash:f.receipt.entries[1].sha256});assert.deepEqual(result,['exact']);
  });
  if(integrated)await check('management entry opens the exact older source version across workspaces and returns to management',async()=>{
   const expected=f.files[f.receipt.entries[1].snapshotPath].toString('utf8');
   const seeded=await page.evaluate(async({expected,path})=>{const s=HaedoLife.Shell.storage,c=HaedoLife.Core,old=await s.getActive();let bundle=c.createWorkspace({title:'익명 정확 버전 통합 검증'});
    const first=await c.prepareImport({origin:'obsidian',title:'익명 정확 원문',fileName:path,text:expected},bundle);bundle=c.applyChanges(bundle,c.buildImportChanges(bundle,first));
    const next=await c.prepareImport({origin:'obsidian',title:'익명 정확 원문',fileName:path,text:'# 나중 버전\n자동 선택되면 안 되는 원문',existingSourceId:first.source.id},bundle);bundle=c.applyChanges(bundle,c.buildImportChanges(bundle,next));
    await s.installWorkspace(bundle);await s.setActive(old);return{workspaceId:bundle.workspaceId,versionId:first.version.id,latestId:next.version.id,before:JSON.stringify(bundle),old};
   },{expected,path:f.receipt.entries[1].sourceRelativePath});
   await open();await page.locator('.original-attachments-copy').first().getByRole('button').first().click();const entry=page.locator('[data-role="git-note-version"]');
   await entry.getByRole('button',{name:'같은 원문 버전 찾기',exact:true}).click();await entry.getByRole('button',{name:'해도 원문 열기',exact:true}).click();await page.locator('#lifeSourceText').waitFor({timeout:5000});
   assert.equal(await page.locator('#lifeOriginalAttachments').count(),0);
   // Markdown opens with formatting; use the actual raw-view control before
   // checking the unchanged stored source bytes and exact older version.
   await page.locator('#lifeSourceInfoToggle').click();await page.locator('#lifeSourceFormatToggle').click();
   assert.equal(await page.locator('#lifeSourceText').getAttribute('data-reading-mode'),'raw');
   assert.equal(await page.locator('#lifeSourceText').textContent(),expected);
   assert.equal(await page.locator('#lifeVersion').inputValue(),seeded.versionId);assert.notEqual(seeded.versionId,seeded.latestId);
   assert.equal(await page.evaluate(()=>HaedoLife.Shell.storage.getActive()),seeded.workspaceId);assert.equal(await page.evaluate(id=>HaedoLife.Shell.storage.read(id).then(JSON.stringify),seeded.workspaceId),seeded.before);
   await page.locator('#lifeSearchReturn').click();await page.locator('#lifeOriginalAttachmentsOpen').waitFor();
  });
  await check('multiple parts validate together; duplicate, mixed and broken selections store nothing',async()=>{
   batchBaseline=await workspace();await open();
   const file=(buffer,name)=>({name,mimeType:'application/zip',buffer});
   const first=fixture(r=>{r.partCount=2;}),second=fixture(r=>{r.part=2;r.partCount=2;});
   await page.locator('#originalAttachmentsFile').setInputFiles([file(second.zip,'part-2.zip'),file(first.zip,'part-1.zip')]);
   await page.locator('#originalAttachmentsInstall').waitFor();
   assert.match(await page.locator('#originalAttachmentsReview').innerText(),/선택 2\/2개 파트.*10개/);
   assert.equal(await page.locator('.original-attachments-copy').count(),2);assert.equal(await workspace(),batchBaseline);
   for(const width of[1440,820,390]){await page.setViewportSize({width,height:1000});await page.locator('#lifeOriginalAttachments').evaluate(n=>n.scrollTop=0);
    assert.equal(await page.locator('#lifeOriginalAttachments').evaluate(n=>n.scrollWidth>n.clientWidth+1),false);
    const target=path.join(out,'originals-batch-'+width+'.png');await page.screenshot({path:target});report.screenshots.push({width,path:target});}
   await page.getByRole('button',{name:'보관 취소',exact:true}).click();
   const mixed=fixture(r=>{r.part=2;r.partCount=2;r.sourceHead='b'.repeat(40);r.entries.filter(e=>e.role==='git-note-version').forEach(e=>e.sourceGitCommit=r.sourceHead);});
   for(const pair of[[file(first.zip,'first.zip'),file(first.zip,'duplicate.zip')],[file(first.zip,'first.zip'),file(mixed.zip,'mixed.zip')],[file(first.zip,'first.zip'),file(Buffer.from('broken'),'broken.zip')]]){
    await page.locator('#originalAttachmentsFile').setInputFiles(pair);await page.locator('#originalAttachmentsError:not([hidden])').waitFor();
    assert.equal(await page.locator('#originalAttachmentsInstall').count(),0);assert.equal(await page.locator('.original-attachments-copy').count(),2);
   }
  });
  await check('partial batch failure retries only the remaining part and preserves ZIP bytes after reload',async()=>{
   const first=fixture(r=>{r.partCount=2;}),second=fixture(r=>{r.part=2;r.partCount=2;});
   await page.locator('#originalAttachmentsFile').setInputFiles([{name:'part-2.zip',mimeType:'application/zip',buffer:second.zip},{name:'part-1.zip',mimeType:'application/zip',buffer:first.zip}]);await page.locator('#originalAttachmentsInstall').waitFor();
   await page.evaluate(()=>{const add=IDBObjectStore.prototype.add;let count=0;window.__originalBatchAdd=add;IDBObjectStore.prototype.add=function(...args){const req=add.apply(this,args);if(this.name==='copies'&&++count===2)this.transaction.abort();return req;};});
   await page.locator('#originalAttachmentsInstall').click();await page.locator('#originalAttachmentsError:not([hidden])').waitFor();
   assert.equal(await page.locator('.original-attachments-copy').count(),3);assert.match(await page.locator('#originalAttachmentsReview').innerText(),/1개 보관 완료.*남은 1개/);
   await page.evaluate(()=>{IDBObjectStore.prototype.add=__originalBatchAdd;});
   await page.locator('#originalAttachmentsInstall').click();await page.waitForFunction(()=>document.querySelectorAll('.original-attachments-copy').length===4);
   assert.equal(await workspace(),batchBaseline);assert.match(await page.locator('#originalAttachmentsStatus').innerText(),/2개 파트.*보관/);
   const zipEvent=page.waitForEvent('download');await page.locator('.original-attachments-copy').filter({hasText:'파트 2/2'}).getByRole('button',{name:'파트 원본 ZIP 받기',exact:true}).click();assert.equal(sha(await fs.readFile(await(await zipEvent).path())),sha(second.zip));
   await page.reload();await ready(page);await inject();await open();assert.equal(await page.locator('.original-attachments-copy').count(),4);assert.equal(await workspace(),batchBaseline);
   await page.locator('#lifeOriginalAttachments').getByRole('button',{name:'닫기',exact:true}).click();
  });
  await check('real Auth binding switch closes dialog; other account cannot query raw IDs or paths',async()=>{
   await open();await page.evaluate(async()=>{await HaedoAuth.signOut();});await page.waitForFunction(()=>!document.querySelector('#lifeOriginalAttachments'));
   server.oauthAccounts.set('original-attachments',accounts.b);await page.goto(base+'/login.html?next=index.html');await page.locator('#googleLogin').click();await page.waitForURL('**/index.html');await ready(page);await inject();
   const result=await page.evaluate(async({id,rawPath})=>{const owner=HaedoLife.OriginalAttachments.create();try{const count=(await owner.list()).length,errors=[];for(const fn of[()=>owner.entries(id),()=>owner.file(id,rawPath),()=>owner.archive(id)])try{await fn();errors.push(null);}catch(e){errors.push(e.code);}return{count,errors};}finally{owner.dispose();}},{id,rawPath:f.receipt.entries[0].snapshotPath});assert.deepEqual(result,{count:0,errors:['originals_not_found','originals_not_found','originals_not_found']});
  });
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.external,[]);assert.equal(server.requests.filter(r=>r.kind==='write').length,0);
 }finally{report.capturedAt=new Date().toISOString();await fs.writeFile(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));await browser.close();}
 console.log(JSON.stringify({passed:report.checks.length,pageErrors:report.errors.length,consoleErrors:report.consoleErrors.length,realServerWrites:0}));
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});

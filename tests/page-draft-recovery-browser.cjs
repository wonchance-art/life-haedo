'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const {playwright, ready, makeContext} = require('./unified-home-browser.cjs');
const {FakeCloud, accounts, base, cloud} = require('./life-sync-browser.cjs');
const {inspect} = require('./life-workbench-browser.cjs');
const out = path.resolve('.local/page-draft-recovery');
const report = {checks:[], visual:[], errors:[], consoleErrors:[], external:[], scope:'Linux Chromium, anonymous mocked Auth, real IndexedDB; no production writes or Apple hardware.'};
async function main() {
 await fs.mkdir(out,{recursive:true});
 const browser = await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
 report.browser = browser.version();
 const context = await makeContext(browser,new FakeCloud(),'draft-recovery',accounts.a,{viewport:{width:1440,height:1000},hasTouch:true});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if([new URL(base).origin,cloud].includes(url.origin))return route.fallback();report.external.push(url.origin);return route.abort();});
 // Hold one completed read, so a real second tab can deterministically win the following CAS.
 const source = await fs.readFile(path.resolve('assets/life/page-composer.js'),'utf8');
 await context.route(base+'/assets/life/page-composer.js',route=>route.fulfill({contentType:'application/javascript',body:source+`
 {const original=HaedoLife.PageComposer.create;HaedoLife.PageComposer.create=options=>original({...options,storage:{...options.storage,readPageDrafts:async(...args)=>{const result=await options.storage.readPageDrafts(...args);if(window.__holdDraftRead){window.__holdDraftRead=false;window.__readHeld=true;await new Promise(resolve=>window.__releaseDraftRead=resolve);}return result;}}});}
 `}));
 const page = await context.newPage(); page.setDefaultTimeout(12000);
 const observe=p=>{p.on('pageerror',e=>report.errors.push(e.message));p.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});};observe(page);
 const click=name=>page.getByRole('button',{name,exact:true}).click();
 const go=async()=>{await page.goto(base+'/index.html?section=records&view=page');await ready(page);await require('./page-composer-entry.cjs').openCompatibility(page);};
 const read=()=>page.evaluate(async()=>{const s=HaedoLife.Shell.storage,w=await s.getActive();return {workspaceId:w,drafts:await s.readPageDrafts(w),wb:await s.readWorkbench(w),bundle:await s.read(w),collection:await s.readCollection(w)};});
 const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
 const file=posts=>({name:'anonymous-drafts.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'life-page-drafts-v1',posts}))});
 const choose=async(value)=>{const tools=page.locator('.pp-draft-tools');if(!await tools.evaluate(el=>el.open))await tools.locator('summary').click();await page.getByLabel('초안 파일 불러오기',{exact:true}).setInputFiles(value);};
 const dialog=()=>page.getByRole('dialog',{name:'불러올 초안 확인',exact:true});
 const checks=()=>dialog().locator('input[type=checkbox]');
 let exportedBackup;
 const snap=async(name,width,height=1000)=>{
  await page.setViewportSize({width,height}); await page.evaluate(()=>{const body=document.querySelector('.pp-draft-import .cl-picker-body');if(body)body.scrollTop=0;}); await page.screenshot({path:path.join(out,`${name}-${width}.png`),fullPage:true});
  // Use the existing audit on the portal dialog too, without changing production DOM.
  const audit=inspect.toString().replaceAll('.life-workbench', ':is(.life-workbench,.pp-draft-import)').replaceAll("document.querySelector(':is(.life-workbench,.pp-draft-import)')", "(document.querySelector('.pp-draft-import') || document.querySelector('.life-workbench'))");
  const metrics=await page.evaluate(new Function('return ('+audit+')')());
  if(await dialog().count()){assert(await dialog().locator('.pp-draft-copy').evaluateAll(els=>els.every(el=>el.getBoundingClientRect().width>=Math.min(240,innerWidth/2))), 'import label has too little readable width');assert(await dialog().evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=-1 && r.bottom<=innerHeight+1;}),'dialog controls extend beyond viewport');}
  report.visual.push({name,width,height,...metrics});for(const k of ['overflow','smallTargets','smallInputs','unnamed','contrastFailures'])assert.deepEqual(metrics[k],[],k);assert.equal(metrics.horizontalOverflow,false);
 };
 try {
  await go();
  await page.evaluate(async()=>{
   const s=HaedoLife.Shell.storage,w=await s.getActive(),M=HaedoLife.PagePosts,wb=await s.readWorkbench(w),t='2026-10-12T01:00:00.000Z';
   const p=M.draft([],HaedoLife.Core.id(),t);p.body='이미 저장한 글 — 원래 글을 고치지 않는 파일 복구';wb.page.posts=M.finish([p],p.id,t).posts;await s.saveWorkbench(w,wb,wb.revision);
   const d=M.draft(wb.page.posts,HaedoLife.Core.id(),t,p.id);d.body='같은 첫 문장\n원래 글을 수정하던 내용';d.attachments=[M.attachment({type:'artwork',title:'빛이 지나간 오후 — 익명 자료',creator:'익명 작가',url:'https://example.org/art?original=1'})];
   const newer=M.draft([],HaedoLife.Core.id(),'2026-10-13T01:00:00.000Z');newer.body='같은 첫 문장\n새 글로 작성한 다른 내용';
   const orphan={...structuredClone(d),id:HaedoLife.Core.id(),replaces:HaedoLife.Core.id(),updatedAt:'2026-10-14T01:00:00.000Z',body:'원래 글이 없는 수정 초안'};
   await s.savePageDrafts(w,{revision:0,posts:[d,newer,orphan]},0);
  });await go();const original=await read();
  const duplicate={...structuredClone(original.drafts.posts[0]),id:'file_duplicate',visibility:'page'};
  const unique={...structuredClone(duplicate),id:'file_unique',body:'느린 관찰의 기록 — 같은 파일을 여러 번 옮겨도 먼저 내용을 확인한다.\n\n원문·공개 범위·날짜를 보존하면서 복구하는 익명 샘플. 🌱',attachments:[{type:'book',title:'낯선 문장을 다시 읽는 시간 — 아주 긴 제목과 원출처를 함께 확인하는 익명 책',creator:'익명 저자',url:'https://example.org/book/'+ 'long-source-'.repeat(12)}]};
  const repeat={...structuredClone(unique),id:'file_repeat'};
  await check('Draft list distinguishes identical headings, edited/missing originals and orders by actual updatedAt',async()=>{
   await page.locator('.pp-drafts summary').click();const rows=page.locator('.pp-draft-row');assert.equal(await rows.count(),3);assert.match(await rows.nth(0).innerText(),/원래 글 없음/);assert.match(await rows.nth(1).innerText(),/새 글/);assert.match(await rows.nth(2).innerText(),/수정 초안/);assert.match(await rows.nth(2).innerText(),/첨부 1개/);
   for(const width of [1440,820,390])await snap('draft-list',width);
   await rows.nth(1).click();assert.equal(await page.locator('#ppBody').inputValue(),original.drafts.posts[1].body);assert(await page.locator('#ppBody').evaluate(el=>el===document.activeElement));
  });
  await check('Preview changes no drafts; cancel keeps input DOM, cursor and accepted data',async()=>{
   await page.locator('#ppBody').evaluate(el=>{el.focus();el.setSelectionRange(3,7);window.__draftBodyNode=el;});
   await choose(file([duplicate,unique,repeat]));await dialog().waitFor();assert.deepEqual(await checks().evaluateAll(els=>els.map(e=>e.checked)),[false,true,false]);assert.equal((await read()).drafts.revision,original.drafts.revision);
   assert.match(await dialog().innerText(),/같은 본문·첨부가 보관함/);assert.match(await dialog().innerText(),/파일 안에 같은 본문/);assert(await checks().first().evaluate(el=>el===document.activeElement));
   await page.keyboard.press('Shift+Tab');assert(await dialog().evaluate(el=>el.contains(document.activeElement)));await page.keyboard.press('Escape');await dialog().waitFor({state:'detached'});
   assert(await page.locator('#ppBody').evaluate(el=>el===__draftBodyNode && el.selectionStart===3 && el.selectionEnd===7));assert.deepEqual((await read()).drafts,original.drafts);
  });
  await check('Selected private copy retains exact text/date/URLs; existing post and all local content remain unchanged',async()=>{
   await choose(file([duplicate,unique,repeat]));await dialog().waitFor();await dialog().locator('.pp-import-detail summary').nth(1).click();assert.match(await dialog().innerText(),/공개 후보입니다/);assert.equal(await dialog().locator('.pp-import-row').nth(1).locator('a.pp-attachment-title').getAttribute('href'),unique.attachments[0].url);assert.equal(await dialog().locator('.pp-import-row').nth(1).locator('.pp-import-url').innerText(),unique.attachments[0].url);
   for(const width of [1440,820,390])await snap('import-review',width);await snap('import-review-landscape',844,390);await snap('import-review-split',592,740);await page.setViewportSize({width:390,height:1000});
   await click('선택한 초안 불러오기');await dialog().waitFor({state:'detached'});const after=await read();assert.equal(after.drafts.posts.length,4);assert.deepEqual(after.drafts.posts.slice(0,3),original.drafts.posts);const added=after.drafts.posts[3];assert.equal(added.body,unique.body);assert.equal(added.createdAt,unique.createdAt);assert.equal(added.updatedAt,unique.updatedAt);assert.equal(added.visibility,'private');assert.equal(added.replaces,null);assert.equal(added.baseUpdatedAt,null);assert.notEqual(added.id,unique.id);assert.deepEqual(added.attachments,unique.attachments);for(const k of ['wb','bundle','collection'])assert.deepEqual(after[k],original[k]);assert.equal(await page.locator('#ppBody').inputValue(),unique.body);
   await click('초안 닫기');await page.locator('#ppBody').waitFor({state:'detached'});await go();await choose(file([unique]));await dialog().waitFor();assert.equal(await checks().first().isChecked(),false);assert(await page.getByRole('button',{name:'선택한 초안 불러오기',exact:true}).isDisabled());await page.keyboard.press('Escape');
  });
  const retry={...structuredClone(unique),id:'retry',body:'저장 실패 뒤 한 번만 복원할 초안'};
  await check('Aborted transaction preserves choices and store; retry commits once and exports reusable v1 file',async()=>{
   const before=await read();await choose(file([retry]));await dialog().waitFor();
   await page.evaluate(()=>{window.__draftPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const request=__draftPut.apply(this,args);if(this.name==='meta'&&args[0]?.key?.startsWith('page-drafts:'))this.transaction.abort();return request;};});
   await click('선택한 초안 불러오기');await dialog().locator('[role=alert]').waitFor();assert.deepEqual((await read()).drafts,before.drafts);assert(await checks().first().isChecked());await snap('import-error',390);
   await page.evaluate(()=>IDBObjectStore.prototype.put=__draftPut);await click('선택한 초안 불러오기');await dialog().waitFor({state:'detached'});const after=await read();assert.equal(after.drafts.posts.length,before.drafts.posts.length+1);assert.deepEqual(after.drafts.posts.slice(0,-1),before.drafts.posts);
   await click('초안 닫기');await page.locator('#ppBody').waitFor({state:'detached'});await page.locator('.pp-draft-tools summary').click();const download=page.waitForEvent('download');await click('초안 파일 받기');const exported=JSON.parse(await fs.readFile(await (await download).path(),'utf8'));assert.equal(exported.format,'life-page-drafts-v1');assert.deepEqual(exported.posts,after.drafts.posts);exportedBackup=exported;
  });
  await check('Fresh competing draft prompts another review; merging preserves its edits and intentional duplicate copy',async()=>{
   const other=await context.newPage();observe(other);await other.goto(base+'/index.html?section=records&view=page');await ready(other);await require('./page-composer-entry.cjs').openCompatibility(other);
   const competing={...structuredClone(unique),id:'competing_file',body:'파일 검토 중 다른 탭에서도 보관한 내용'};await choose(file([competing]));await dialog().waitFor();
   await other.evaluate(async d=>{const s=HaedoLife.Shell.storage,w=await s.getActive(),v=await s.readPageDrafts(w);v.posts[0].body+='\n다른 탭의 새 수정';v.posts.push({...d,id:HaedoLife.Core.id(),visibility:'private',replaces:null,baseUpdatedAt:null});await s.savePageDrafts(w,v,v.revision);},competing);
   const before=await read();await click('선택한 초안 불러오기');await dialog().getByText(/다른 탭에서 같은 내용/).waitFor();assert.deepEqual((await read()).drafts,before.drafts);assert(await checks().first().isChecked());assert.match(await dialog().innerText(),/같은 본문·첨부가 보관함/);
   // The second explicit click authorizes a separate identical copy, never an overwrite.
   await click('선택한 초안 불러오기');await dialog().waitFor({state:'detached'});const after=await read();assert.deepEqual(after.drafts.posts.slice(0,-1),before.drafts.posts);assert.equal(after.drafts.posts.filter(p=>p.body===competing.body).length,2);await other.close();await click('초안 닫기');await page.locator('#ppBody').waitFor({state:'detached'});
  });
  await check('Real second-tab CAS race leaves no partial addition; retry merges the latest data',async()=>{
   const race={...structuredClone(unique),id:'race_file',body:'두 탭의 저장 경합 뒤 복구할 파일 내용'};await choose(file([race]));await dialog().waitFor();await page.evaluate(()=>window.__holdDraftRead=true);
   await click('선택한 초안 불러오기');await page.waitForFunction(()=>window.__readHeld);const other=await context.newPage();observe(other);await other.goto(base+'/index.html?section=records&view=page');await ready(other);await require('./page-composer-entry.cjs').openCompatibility(other);
   await other.evaluate(async()=>{const s=HaedoLife.Shell.storage,w=await s.getActive(),v=await s.readPageDrafts(w);v.posts[0].body+='\nCAS 경합에서 먼저 저장한 문장';await s.savePageDrafts(w,v,v.revision);});const before=await read();
   await page.evaluate(()=>__releaseDraftRead());await dialog().getByText(/다른 탭에서 초안이 바뀌었습니다/).waitFor();assert.deepEqual((await read()).drafts,before.drafts);assert(await checks().first().isChecked());assert(await page.getByRole('button',{name:'선택한 초안 불러오기',exact:true}).isEnabled());await click('선택한 초안 불러오기');await dialog().waitFor({state:'detached'});const after=await read();assert.deepEqual(after.drafts.posts.slice(0,-1),before.drafts.posts);assert.equal(after.drafts.posts.filter(p=>p.body===race.body).length,1);await other.close();await click('초안 닫기');await page.locator('#ppBody').waitFor({state:'detached'});
  });
  await check('Invalid, oversized, empty files and full draft storage fail without changing accepted data',async()=>{
   const before=await read();for(const value of [{name:'invalid.json',mimeType:'application/json',buffer:Buffer.from([0xc3,0x28])},{name:'large.json',mimeType:'application/json',buffer:Buffer.alloc(2097153)},file([]),{name:'saved.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'life-page-drafts-v1',posts:before.wb.page.posts}))}]){
    await choose(value);await page.locator('.pp-status').filter({hasText:/./}).waitFor();await page.waitForFunction(()=>document.querySelector('.pp-draft-tools input').value==='');assert.equal(await dialog().count(),0);assert.deepEqual((await read()).drafts,before.drafts);
   }
   await page.evaluate(async()=>{const s=HaedoLife.Shell.storage,w=await s.getActive(),v=await s.readPageDrafts(w);while(v.posts.length<200){const d=HaedoLife.PagePosts.draft([],HaedoLife.Core.id(),new Date().toISOString());d.body='용량 한도 익명 초안 '+v.posts.length;v.posts.push(d);}await s.savePageDrafts(w,v,v.revision);});await go();const full=await read();await choose(file([{...retry,id:'over_limit',body:'한도 밖의 초안'}]));await dialog().waitFor();await click('선택한 초안 불러오기');await dialog().getByText(/200개/).waitFor();assert.deepEqual((await read()).drafts,full.drafts);await page.keyboard.press('Escape');
   // An individually small file may still exceed the combined local draft budget.
   await page.evaluate(async()=>{const s=HaedoLife.Shell.storage,b=await s.createWorkspace('결합 용량 익명 검사');await s.setActive(b.workspaceId);const posts=Array.from({length:35},(_,i)=>({...HaedoLife.PagePosts.draft([],HaedoLife.Core.id(),new Date().toISOString()),body:'가'.repeat(19000)+i}));await s.savePageDrafts(b.workspaceId,{revision:0,posts},0);});await go();const capacity=await read();
   const largeDrafts=Array.from({length:4},(_,i)=>({...structuredClone(retry),id:'large_'+i,body:'나'.repeat(19000)+i}));
   // Korean text is three UTF-8 bytes per code point. Keep the fixture under 2 MiB first.
   assert(Buffer.byteLength(JSON.stringify(capacity.drafts))<2097152);await choose(file(largeDrafts));await dialog().waitFor();await click('선택한 초안 불러오기');await dialog().getByText(/2 MiB/).waitFor();assert.deepEqual((await read()).drafts,capacity.drafts);await page.keyboard.press('Escape');
  });
  await check('Late file read cannot reopen a review after navigation or overwrite a newer chosen file',async()=>{
   await page.evaluate(()=>{window.__fileArrayBuffer=File.prototype.arrayBuffer;File.prototype.arrayBuffer=async function(){File.prototype.arrayBuffer=__fileArrayBuffer;const buffer=await __fileArrayBuffer.call(this);window.__fileReadHeld=true;await new Promise(resolve=>window.__releaseFileRead=resolve);return buffer;};});
   await choose(file([unique]));await page.waitForFunction(()=>window.__fileReadHeld);await page.locator('[data-haedo-navigation] [data-haedo-section=tools]').click();await page.waitForFunction(()=>document.querySelector('[data-haedo-section=tools][aria-current=page]'));await page.evaluate(()=>__releaseFileRead());await page.waitForTimeout(80);assert.equal(await dialog().count(),0);
   await go();await page.evaluate(()=>{window.__fileReadHeld=false;window.__fileArrayBuffer=File.prototype.arrayBuffer;File.prototype.arrayBuffer=async function(){File.prototype.arrayBuffer=__fileArrayBuffer;const buffer=await __fileArrayBuffer.call(this);window.__fileReadHeld=true;await new Promise(resolve=>window.__releaseFileRead=resolve);return buffer;};});
   await choose(file([unique]));await page.waitForFunction(()=>window.__fileReadHeld);await choose(file([retry]));await dialog().waitFor();assert.match(await dialog().innerText(),/저장 실패 뒤 한 번만/);await page.evaluate(()=>__releaseFileRead());await page.waitForTimeout(80);assert.match(await dialog().innerText(),/저장 실패 뒤 한 번만/);await page.keyboard.press('Escape');
  });
  await check('Exported legacy file is reusable in an independent workspace without touching its original drafts',async()=>{
   const old=await page.evaluate(async w=>HaedoLife.Shell.storage.readPageDrafts(w),original.workspaceId);
   await page.evaluate(async()=>{const s=HaedoLife.Shell.storage,b=await s.createWorkspace('파일 사본 재사용 익명 검사');await s.setActive(b.workspaceId);});await go();await choose(file(exportedBackup.posts));await dialog().waitFor();
   for(const choice of await checks().all())await choice.uncheck();for(const i of [0,3,4])await checks().nth(i).check();await click('선택한 초안 불러오기');await dialog().waitFor({state:'detached'});
   const restored=await read();assert.notEqual(restored.workspaceId,original.workspaceId);assert.equal(restored.drafts.posts.length,3);assert.deepEqual(restored.wb.page.posts || [],[]);
   for(const [position,index] of [0,3,4].entries()){const d=restored.drafts.posts[position],source=exportedBackup.posts[index];assert.notEqual(d.id,source.id);assert.equal(d.body,source.body);assert.deepEqual(d.attachments,source.attachments);assert.equal(d.createdAt,source.createdAt);assert.equal(d.updatedAt,source.updatedAt);assert.equal(d.visibility,'private');assert.equal(d.replaces,null);assert.equal(d.baseUpdatedAt,null);}
   assert.deepEqual(await page.evaluate(async w=>HaedoLife.Shell.storage.readPageDrafts(w),original.workspaceId),old);await click('초안 닫기');await page.locator('#ppBody').waitFor({state:'detached'});await go();assert.deepEqual((await read()).drafts,restored.drafts);
  });
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.external,[]);
 } catch(e) { await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw e; }
 finally {await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await context.close();await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

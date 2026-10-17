'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {playwright,ready,makeContext}=require('./unified-home-browser.cjs');
const {FakeCloud,accounts,base,cloud}=require('./life-sync-browser.cjs');
const {inspect}=require('./life-workbench-browser.cjs');
const out=path.resolve('.local/edition-collection'),report={checks:[],visual:[],errors:[],consoleErrors:[],requests:[],environment:'Linux Chromium, anonymous mock Auth/provider, real IndexedDB. No production writes or Apple hardware.'};
async function main(){
 await fs.mkdir(out,{recursive:true});const browser=await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});report.browser=browser.version();
 const context=await makeContext(browser,new FakeCloud(),'edition-collection',accounts.a,{viewport:{width:1440,height:1000},hasTouch:true});
 let mode='ok',release;
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());if([new URL(base).origin,cloud].includes(url.origin))return route.fallback();assert.equal(url.hostname,'openlibrary.org');report.requests.push(url.pathname+url.search);
  if(!url.pathname.endsWith('/editions.json'))return route.fulfill({json:{docs:[{key:'/works/OL123W',title:'관찰의 기록',author_name:['작품 저자'],first_publish_year:2007}]}});
  if(mode==='hold')await new Promise(r=>release=r);
  if(mode==='error')return route.fulfill({status:429,body:''});
  const offset=Number(url.searchParams.get('offset'));
  return route.fulfill({json:{size:8,entries:mode==='empty'?[]:Array.from({length:offset?2:6},(_,i)=>({key:'/books/OL'+(100+offset+i)+'M',title:offset?'관찰의 기록 — 우리가 살던 계절을 다시 읽는 한국어판':'Observation '+i,works:[{key:'/works/OL123W'}],languages:[{key:'/languages/'+(offset?'kor':'eng')}],publishers:[offset?'익명 출판사':'Sample Press'],publish_date:offset?'2021':'2017'}))}});
 });
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 const click=async name=>{if(name==='글쓰기')return require('./page-composer-entry.cjs').openLegacy(page);await page.getByRole('button',{name,exact:true}).click();};
 const go=async()=>{await page.goto(base+'/index.html?section=records&view=page');await ready(page);await require('./page-composer-entry.cjs').openCompatibility(page);};
 const read=()=>page.evaluate(async()=>{const s=HaedoLife.Shell.storage,w=await s.getActive();return {collection:await s.readCollection(w),wb:await s.readWorkbench(w),bundle:await s.read(w)};});
 const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
 async function snap(scene,width,selector='.cl-picker'){
  await page.setViewportSize({width,height:width===390?844:1000});await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
  const metrics=await page.evaluate('('+inspect.toString().replaceAll('.life-workbench',selector)+')()');for(const key of ['smallTargets','smallInputs','unnamed','contrastFailures'])assert.deepEqual(metrics[key],[],scene+' '+key);assert(!metrics.horizontalOverflow);report.visual.push({scene,width,...metrics});await page.screenshot({path:path.join(out,scene+'-'+width+'.png')});
 }
 const search=async()=>{await click('음악·책·대상 붙이기');await page.locator('#clPickerQuery').fill('관찰의 기록');await click('책 찾기 · Open Library');await page.locator('.cl-candidate').waitFor();};
 const editions=()=>click('관찰의 기록 · 판본 찾기');
 try{
  await go();const original=await read();
  await check('Explicit work to paginated edition selection, editable attribution, private save and exact source',async()=>{
   await click('글쓰기');await page.locator('#ppBody').fill('서로 다른 언어와 시기에 읽었던 같은 책.\n\n번역에 따라 다르게 느낀 부분을 다시 비교해 보고 싶다. 이 문장은 컬렉션 메모로 자동 복사하면 안 된다.');await search();assert.equal(report.requests.length,1);await editions();await page.locator('.cl-editions .cl-pick-row').first().waitFor();assert.equal(await page.locator('.cl-editions .cl-pick-row').count(),6);await click('다음 판본');await page.getByText(/한국어 · 익명 출판사 · 2021/).first().waitFor();
   for(const w of [1440,820,390])await snap('editions',w);
   await page.locator('.cl-editions .cl-pick-row').first().click();assert.equal(await page.getByLabel('출처 링크',{exact:true}).inputValue(),'https://openlibrary.org/books/OL106M');assert.equal(await page.getByLabel('아티스트·저자',{exact:true}).inputValue(),'');assert.match(await page.locator('.pp-manual').innerText(),/작품 저자: 작품 저자/);await page.getByLabel('아티스트·저자',{exact:true}).fill('확인한 저자');await click('첨부');await click('저장');await page.locator('.pp-collect').waitFor();
   const saved=await read();assert.equal(saved.collection.items.length,0);assert.equal(saved.wb.page.posts[0].attachments[0].url,'https://openlibrary.org/books/OL106M');assert.equal(saved.wb.page.posts[0].visibility,'private');assert.deepEqual(saved.bundle,original.bundle);
  });
  await check('Explicit collection copy, repeated clicks, archived duplicate and backup preserve all existing data',async()=>{
   const before=await read();await page.locator('.pp-collect').click();await page.getByText(/컬렉션에 보관했습니다/).waitFor();const first=await read();assert.equal(first.collection.items.length,1);assert.equal(first.collection.items[0].note,'');assert.deepEqual(first.collection.items[0].tags,[]);assert.deepEqual(first.wb,before.wb);assert.deepEqual(first.bundle,before.bundle);
   for(const w of [1440,820,390])await snap('saved-collection',w,'.life-workbench');
   await page.locator('.pp-collect').click();await page.getByText(/이미 컬렉션에 있습니다/).waitFor();assert.deepEqual((await read()).collection,first.collection);
   await page.evaluate(async()=>{const s=HaedoLife.Shell.storage,w=await s.getActive(),c=await s.readCollection(w);c.items[0].archived=true;c.items[0].note='기존의 개인 메모';await s.saveCollection(w,c,c.revision);});const archived=(await read()).collection;await page.locator('.pp-collect').click();await page.getByText(/보관함에 있는 항목/).waitFor();assert.deepEqual((await read()).collection,archived);
   const restored=await page.evaluate(c=>HaedoLife.Collection.readBackup(JSON.stringify(HaedoLife.Collection.makeBackup(c))),archived);assert.deepEqual(restored.items,archived.items);
   await page.locator('.pp-feed').getByRole('button',{name:'글 수정',exact:true}).click();await page.locator('#ppVisibility').selectOption('page');await click('저장');await click('방문자 미리보기');assert.equal(await page.locator('#wbVisitor .pp-collect').count(),0);await click('편집으로 돌아가기');
  });
  await check('Collection write failure and racing revision retain the saved post and competing notes, then retry once',async()=>{
   await click('글쓰기');await page.locator('#ppBody').fill('작은 도구에 대한 개인적인 생각');await click('음악·책·대상 붙이기');await page.locator('#clPickerQuery').fill('기록 도구');await click('직접 입력');await page.getByLabel('첨부 종류',{exact:true}).selectOption('tool');await click('첨부');await click('저장');await page.locator('.pp-collect').nth(1).waitFor();const before=await read();
   const target=page.locator('.pp-collect').first();await page.evaluate(()=>{window.__put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const req=__put.apply(this,args);if(this.name==='meta'&&args[0]?.key?.startsWith('collection:'))this.transaction.abort();return req;};});await target.click();await page.getByText(/글은 유지됩니다/).waitFor();assert.deepEqual(await read(),before);await page.evaluate(()=>IDBObjectStore.prototype.put=__put);
   await page.evaluate(async()=>{const s=HaedoLife.Shell.storage,w=await s.getActive(),c=await s.readCollection(w);c.items[0].note='경합 중 다른 탭의 메모';window.__get=IDBObjectStore.prototype.get;IDBObjectStore.prototype.get=function(key){const req=__get.call(this,key);if(this.name==='meta'&&key==='collection:'+w){IDBObjectStore.prototype.get=__get;req.addEventListener('success',()=>{window.__racingSave=s.saveCollection(w,c,c.revision);});}return req;};});
   await target.click();await page.getByText(/다른 탭에서 컬렉션이 바뀌었습니다/).waitFor();await page.evaluate(()=>__racingSave);const conflict=await read();assert.equal(conflict.collection.items.length,1);assert.equal(conflict.collection.items[0].note,'경합 중 다른 탭의 메모');assert.deepEqual(conflict.wb,before.wb);
   await snap('save-conflict',390,'.life-workbench');await target.click();await page.getByText(/컬렉션에 보관했습니다/).waitFor();const after=await read();assert.equal(after.collection.items.length,2);assert.equal(after.collection.items[0].note,'경합 중 다른 탭의 메모');assert.deepEqual(after.wb,before.wb);assert.deepEqual(after.bundle,before.bundle);
  });
  await check('Edition empty/error/loading retain work selection; changed query and close reject late responses',async()=>{
   for(const state of ['empty','error','hold']){
    await go();await click('글쓰기');await page.locator('#ppBody').fill('판본 조회 실패에도 유지할 글');await search();mode=state;await editions();
    if(state==='empty'){await page.getByText(/확인 가능한 판본이 없어요/).waitFor();await snap('edition-empty',390);}
    if(state==='error'){await page.getByRole('button',{name:'판본 다시 확인',exact:true}).waitFor();await snap('edition-error',390);}
    if(state==='hold'){await page.getByText('판본 확인 중…',{exact:true}).waitFor();await snap('edition-loading',390);await page.waitForFunction(()=>true);while(!release)await new Promise(r=>setTimeout(r,10));await page.locator('#clPickerQuery').fill('다른 책');mode='ok';release();release=null;await page.waitForTimeout(100);assert.equal(await page.locator('.cl-editions').count(),0);}
    await page.keyboard.press('Escape');assert.equal(await page.locator('#ppBody').inputValue(),'판본 조회 실패에도 유지할 글');await click('초안 닫기');mode='ok';
   }
  });
  assert.deepEqual(report.errors,[]);assert(report.consoleErrors.every(t=>/429/.test(t)),JSON.stringify(report.consoleErrors));
 }finally{if(release)release();await browser.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
}
main().catch(e=>{console.error(e);if(process.env.GITHUB_ACTIONS)console.error('::error title=Edition collection::'+String(e.stack||e).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'));process.exitCode=1;});

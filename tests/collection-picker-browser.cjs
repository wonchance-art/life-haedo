'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {playwright,ready,makeContext}=require('./unified-home-browser.cjs');
const {FakeCloud,accounts,base,cloud}=require('./life-sync-browser.cjs');
const {inspect}=require('./life-workbench-browser.cjs');
const out=path.resolve(process.env.COLLECTION_PICKER_OUTPUT||'.local/collection-picker');
const report={checks:[],visual:[],errors:[],consoleErrors:[],requests:[],environment:'Linux Chromium, mock Auth/provider responses, real IndexedDB. No Apple hardware or production writes.'};
async function main(){
 await fs.mkdir(out,{recursive:true});const browser=await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});report.browser=browser.version();
 const context=await makeContext(browser,new FakeCloud(),'collection-picker',accounts.a,{viewport:{width:1440,height:1000},hasTouch:true});
 let mode='ok',release;
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());if([new URL(base).origin,cloud].includes(url.origin))return route.fallback();
  assert(['api.github.com','www.youtube.com'].includes(url.hostname),url.origin);report.requests.push(url.origin);
  if(mode==='hold')await new Promise(r=>release=r);
  if(mode==='error')return route.fulfill({status:429,body:'',headers:{'Access-Control-Allow-Origin':'*'}});
  return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(url.hostname==='api.github.com'?{private:false,name:'느린 관찰을 돕는 열린 도구',owner:{login:'sample-studio'}}:{title:'비 오는 오후, 작업실에서 듣는 음악',author_name:'익명 음악 채널'})});
 });
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 const click=name=>page.getByRole('button',{name,exact:true}).click();
 const go=async()=>{await page.goto(base+'/index.html?section=records&view=collection');await ready(page);await page.locator('#clGrid').waitFor();};
 const read=()=>page.evaluate(async()=>HaedoLife.Shell.storage.readCollection(await HaedoLife.Shell.storage.getActive()));
 const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
 async function snap(scene,width,selector='.cl-picker'){
  await page.setViewportSize({width,height:width===390?844:1000});await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
  const metrics=await page.evaluate('('+inspect.toString().replaceAll('.life-workbench',selector)+')()');
  for(const key of ['smallTargets','smallInputs','unnamed','contrastFailures'])assert.deepEqual(metrics[key],[],scene+' '+key);
  assert(!metrics.horizontalOverflow);report.visual.push({scene,...metrics});await page.screenshot({path:path.join(out,scene+'-'+width+'.png')});
 }
 const open=()=>click('컬렉션 항목 추가');
 try{
  await go();
  await check('Empty picker: local text only, keyboard focus trap, Escape restores focus, manual query preserved',async()=>{
   await open();assert.equal(await page.locator('#clPickerQuery').evaluate(e=>e===document.activeElement),true);
   await page.locator('#clPickerQuery').fill('작은 관찰의 기록');assert.equal(report.requests.length,0);
   for(const w of [1440,820,390])await snap('empty',w);
   await page.getByRole('button',{name:'선택창 닫기',exact:true}).focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.getByRole('button',{name:'직접 입력',exact:true}).evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'선택창 닫기',exact:true}).evaluate(e=>e===document.activeElement),true);
   await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'컬렉션 항목 추가',exact:true}).evaluate(e=>e===document.activeElement),true);
   await open();await page.locator('#clPickerQuery').fill('작은 관찰의 기록');await page.getByRole('dialog').getByRole('button',{name:'책',exact:true}).click();await click('직접 입력');assert.equal(await page.locator('#clTitle').inputValue(),'작은 관찰의 기록');assert.equal(await page.locator('#clType').inputValue(),'book');await page.locator('#clNote').fill('지난 계절의 생각');await click('저장');await click('컬렉션 목록으로');
  });
  await check('Saved selection edits same identity, compact note first, explicit save, reload and backup',async()=>{
   const before=await read();await open();await page.locator('#clPickerQuery').fill('관찰');
   for(const w of [1440,820,390])await snap('saved-choice',w);
   await page.locator('.cl-pick-row').tap();assert.equal(await page.locator('#clNote').evaluate(e=>e===document.activeElement),true);assert.equal(await page.locator('#clNote').inputValue(),'지난 계절의 생각');assert.equal(await page.locator('#clTitle').isVisible(),false);
   await page.locator('#clNote').fill('다시 읽으며 새롭게 발견한 생각.\n느리게 관찰하는 태도를 기억하고 싶다.');
   for(const w of [1440,820,390])await snap('note-first',w,'.life-collection');
   assert.deepEqual(await read(),before);await click('저장');await go();const after=await read();assert.equal(after.items.length,1);assert.equal(after.items[0].id,before.items[0].id);assert.match(after.items[0].note,/새롭게/);
   const backup=await page.evaluate(s=>HaedoLife.Collection.readBackup(JSON.stringify(HaedoLife.Collection.makeBackup(s))),after);assert.deepEqual(backup.items,after.items);
  });
  await check('Explicit URL lookup, IME protection, channel not artist; choose then save',async()=>{
   await open();await page.locator('#clPickerQuery').fill('https://youtu.be/jNQXAC9IVRw?si=tracking');const n=report.requests.length;
   await page.locator('#clPickerQuery').dispatchEvent('compositionstart');await page.keyboard.press('Enter');assert.equal(report.requests.length,n);await page.locator('#clPickerQuery').dispatchEvent('compositionend');await click('링크 확인');await page.locator('.cl-picker-remote .cl-pick-row').waitFor();
   for(const w of [1440,820,390])await snap('link-choice',w);
   assert.equal((await read()).items.length,1);await page.locator('.cl-picker-remote .cl-pick-row').click();assert.equal(await page.locator('#clCreator').inputValue(),'');assert.equal(await page.locator('#clType').inputValue(),'video');await page.locator('#clNote').fill('채널이 아닌 음악 자체에 관한 나의 메모');await click('저장');await click('컬렉션 목록으로');
  });
  await check('Canonical duplicate opens existing, including under a different kind filter',async()=>{
   await open();await page.getByRole('dialog').getByRole('button',{name:'책',exact:true}).click();await page.locator('#clPickerQuery').fill('https://youtu.be/jNQXAC9IVRw');await click('링크 확인');await page.getByText('이미 담아 둔 항목이에요. 메모를 이어 쓸 수 있어요.',{exact:true}).waitFor();await page.locator('.cl-picker-remote .cl-pick-row').click();assert.equal(await page.locator('#clNote').inputValue(),'채널이 아닌 음악 자체에 관한 나의 메모');await click('편집 취소');await click('컬렉션 목록으로');assert.equal((await read()).items.length,2);
  });
  await check('Lookup failure retains URL; query changes and close reject late responses',async()=>{
   await open();mode='error';await page.locator('#clPickerQuery').fill('https://github.com/sample-studio/notes');await click('링크 확인');await page.getByText(/직접 입력으로 이어갈 수 있어요/).waitFor();await snap('error',390);
   mode='hold';await click('링크 확인');await page.getByRole('button',{name:'확인 중…'}).waitFor();await snap('loading',390);while(!release)await new Promise(r=>setTimeout(r,10));await page.locator('#clPickerQuery').fill('새 검색');mode='ok';release();release=null;await page.waitForTimeout(100);assert.equal(await page.locator('.cl-picker-remote .cl-pick-row').count(),0);
   mode='hold';await page.locator('#clPickerQuery').fill('https://github.com/sample-studio/notes');await click('링크 확인');while(!release)await new Promise(r=>setTimeout(r,10));await page.keyboard.press('Escape');mode='ok';release();release=null;await page.waitForTimeout(100);assert.equal(await page.locator('#clForm').count(),0);assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
  });
  await check('Compact editor save failure retains memo; editing information reveals required fields',async()=>{
   await open();await page.locator('#clPickerQuery').fill('관찰');await page.locator('.cl-pick-row').click();await page.locator('#clNote').fill('저장 실패에도 남아야 하는 메모');
   await page.evaluate(()=>{window.__put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const r=__put.apply(this,args);if(this.name==='meta'&&args[0]?.key?.startsWith('collection:'))this.transaction.abort();return r;};});await click('저장');await page.locator('#clError:not([hidden])').waitFor();assert.equal(await page.locator('#clNote').inputValue(),'저장 실패에도 남아야 하는 메모');await page.evaluate(()=>IDBObjectStore.prototype.put=__put);
   await page.locator('.cl-edit-information>summary').click();await page.locator('#clTitle').fill('');await page.locator('.cl-edit-information>summary').click();await click('저장');assert.equal(await page.locator('#clTitle').isVisible(),true);await page.locator('#clTitle').fill('작은 관찰의 기록');await click('저장');await click('컬렉션 목록으로');
  });
  await check('Compact metadata controls retain expansion and draft through type changes',async()=>{
   await open();await page.locator('#clPickerQuery').fill('관찰');await page.locator('.cl-pick-row').click();await page.locator('.cl-edit-information>summary').click();await page.locator('#clType').selectOption('article');assert.equal(await page.locator('#clType').isVisible(),true);assert.match(await page.locator('#clNote').inputValue(),/실패/);await page.locator('#clTitle').fill('관찰에서 시작한 글');assert.equal(await page.locator('.cl-selected-object h3').innerText(),'관찰에서 시작한 글');await click('저장');await click('컬렉션 목록으로');
  });
  await check('Many long Korean entries, archived identity and compact conflict recovery',async()=>{
   await page.evaluate(async()=>{const s=HaedoLife.Shell.storage,w=await s.getActive(),state=await s.readCollection(w),now=new Date().toISOString();for(let i=0;i<45;i++)state.items.push({id:HaedoLife.Core.id(),type:['music','book','film','artwork','person','tool'][i%6],title:['밤 산책을 함께한 음악','타인의 시선으로 다시 보는 일상','오랫동안 기억하고 싶은 영화','빛과 그림자를 바라보는 방식','새로운 관점을 알려 준 사람','일상의 작은 문제를 해결하는 도구'][i%6]+' — 취향의 변화를 돌아보며 남겨 둔 기록 '+i,creator:i%6===4?'':'익명 창작자',url:'',note:'이전의 메모',tags:['관찰'],details:{},archived:i===0,createdAt:now,updatedAt:now});await s.saveCollection(w,state,state.revision);});await go();await open();
   for(const w of [1440,820,390])await snap('many-items',w);assert.equal(await page.locator('.cl-picker-results .cl-pick-row').count(),30);await click('더 보기');assert.equal(await page.locator('.cl-picker-results .cl-pick-row').count(),47);assert.equal(await page.locator('.cl-picker-results .cl-pick-row').nth(30).evaluate(e=>e===document.activeElement),true);
   await page.locator('#clPickerQuery').fill('밤 산책');await page.locator('.cl-pick-row').filter({hasText:'보관 중'}).click();await page.locator('#clNote').fill('현재 탭에서 이어 쓴 메모');
   await page.evaluate(async()=>{const s=HaedoLife.Shell.storage,w=await s.getActive(),state=await s.readCollection(w);const item=state.items.find(i=>i.archived);item.note='다른 탭에서 바꾼 메모';await s.saveCollection(w,state,state.revision);});await click('저장');await page.getByRole('region',{name:'다른 탭 변경 비교'}).waitFor();assert.equal(await page.locator('#clNote').inputValue(),'현재 탭에서 이어 쓴 메모');await click('내 입력을 새 사본으로 저장');await page.getByRole('button',{name:'항목 수정',exact:true}).waitFor();const state=await read();assert(state.items.some(i=>i.note==='다른 탭에서 바꾼 메모'&&i.archived));assert(state.items.some(i=>i.note==='현재 탭에서 이어 쓴 메모'));await click('컬렉션 목록으로');
  });
  assert.deepEqual(report.errors,[]);assert(report.consoleErrors.every(t=>/429|ERR_FAILED/.test(t)),JSON.stringify(report.consoleErrors));
 }finally{if(release)release();await browser.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

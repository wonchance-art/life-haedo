'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {playwright,ready,makeContext}=require('./unified-home-browser.cjs');
const {FakeCloud,accounts,base,cloud}=require('./life-sync-browser.cjs');
const {inspect}=require('./life-workbench-browser.cjs');
const out=path.resolve('.local/book-search-navigation'),report={checks:[],visual:[],errors:[],consoleErrors:[],requests:[],environment:'Linux Chromium; anonymous mock Auth/provider, real IndexedDB. Not Apple hardware or production data.'};
async function main(){
 await fs.mkdir(out,{recursive:true});const browser=await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});report.browser=browser.version();
 const context=await makeContext(browser,new FakeCloud(),'book-search-navigation',accounts.a,{viewport:{width:1440,height:1000},hasTouch:true});
 let mode='ok',release;
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());if([new URL(base).origin,cloud].includes(u.origin))return route.fallback();assert.equal(u.hostname,'openlibrary.org');report.requests.push(u.pathname+u.search);
  const korean=u.searchParams.get('q')?.includes('language:kor');
  if(mode==='hold'&&korean)await new Promise(r=>release=r);
  if(mode==='error'&&(korean||u.searchParams.get('page')==='2'))return route.fulfill({status:429,body:''});
  if(korean)return route.fulfill({json:{docs:mode==='empty'?[]:[{key:'/works/OL123W',editions:{docs:[{key:'/books/OL456M',title:'관찰의 기록 — 우리가 살던 계절을 다시 읽는 한국어판',language:['kor'],publisher:['익명 출판사'],publish_date:['2021']}]}}]}});
  const n=Number(u.searchParams.get('page')||1);
  return route.fulfill({json:{numFound:7,docs:n===1?Array.from({length:6},(_,i)=>({key:'/works/OL'+(300+i)+'W',title:'관찰과 기록 '+(i+1),author_name:['익명 저자']})):[{key:'/works/OL123W',title:'관찰의 기록',author_name:['작품 저자']}]}});
 });
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 const click=name=>page.getByRole('button',{name,exact:true}).click();
 const read=()=>page.evaluate(async()=>{const s=HaedoLife.Shell.storage,w=await s.getActive();return {collection:await s.readCollection(w),wb:await s.readWorkbench(w),bundle:await s.read(w)};});
 const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
 async function snap(scene,width){
  await page.setViewportSize({width,height:width===390?844:1000});await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
  const metrics=await page.evaluate('('+inspect.toString().replaceAll('.life-workbench','.cl-picker')+')()');for(const key of ['smallTargets','smallInputs','unnamed','contrastFailures'])assert.deepEqual(metrics[key],[],scene+' '+key);assert(!metrics.horizontalOverflow);report.visual.push({scene,width,...metrics});await page.screenshot({path:path.join(out,scene+'-'+width+'.png')});
 }
 const search=async()=>{await page.waitForTimeout(1150);await click('음악·책·대상 붙이기');await page.locator('#clPickerQuery').fill('관찰의 기록');await click('책 찾기 · Open Library');await page.locator('.cl-candidate').first().waitFor();};
 const second=async()=>{await click('다음 검색 결과');await page.getByText('검색 결과 · 2쪽',{exact:true}).waitFor();};
 const korean=()=>click('관찰의 기록 · 한국어판 찾기');
 try{
  await page.goto(base+'/index.html?section=records&view=page');await ready(page);await page.locator('.pp-toolbar').waitFor();const original=await read();
  await click('글쓰기');await page.locator('#ppBody').fill('다른 언어로 읽었을 때와 지금의 생각을 비교하고 싶다. 이 본문은 검색어나 컬렉션 메모로 전송되지 않는다.');
  await check('Paginate beyond six candidates; failed page preserves candidates and keyboard recovery',async()=>{
   await search();assert.equal(report.requests.length,1);assert.equal(await page.locator('.cl-candidate').count(),6);
   mode='error';await click('다음 검색 결과');await page.getByText(/제공자가 조회를 제한했습니다/).waitFor();assert.equal(await page.locator('.cl-candidate').count(),6);assert.equal(await page.locator('.cl-picker-remote').evaluate(e=>e.inert),false);assert(await page.getByRole('button',{name:'다음 검색 결과',exact:true}).evaluate(e=>e===document.activeElement));await snap('page-error',390);
   mode='ok';await page.getByRole('button',{name:'다음 검색 결과',exact:true}).focus();await page.keyboard.press('Enter');await page.getByText('검색 결과 · 2쪽',{exact:true}).waitFor();assert.equal(await page.locator('.cl-candidate').count(),1);assert(await page.locator('.cl-picker-remote').evaluate(e=>e===document.activeElement));
   for(const w of [1440,820,390])await snap('search-page',w);
   const count=report.requests.length;await click('이전 검색 결과');assert(await page.locator('.cl-picker-remote').evaluate(e=>e===document.activeElement));assert.equal(await page.locator('.cl-candidate').count(),6);await second();assert.equal(report.requests.length,count);
  });
  await check('Explicit Korean edition review saves exact edition, preserving body/source/private scope and collection',async()=>{
   const count=report.requests.length;await korean();await page.locator('.cl-editions .cl-pick-row').waitFor();assert.equal(report.requests.length,count+1);assert.match(await page.locator('.cl-editions').innerText(),/전체 판본 목록은 아닙니다/);
   for(const w of [1440,820,390])await snap('korean-edition',w);
   await page.locator('.cl-editions .cl-pick-row').click();assert.equal(await page.getByLabel('출처 링크',{exact:true}).inputValue(),'https://openlibrary.org/books/OL456M');assert.equal(await page.getByLabel('아티스트·저자',{exact:true}).inputValue(),'');await page.getByLabel('아티스트·저자',{exact:true}).fill('확인한 창작자');await click('첨부');assert.match(await page.locator('#ppBody').inputValue(),/다른 언어/);await click('저장');await page.locator('.pp-collect').waitFor();
   const saved=await read();assert.deepEqual(saved.bundle,original.bundle);assert.deepEqual(saved.collection,original.collection);assert.equal(saved.wb.page.posts[0].visibility,'private');assert.equal(saved.wb.page.posts[0].attachments[0].url,'https://openlibrary.org/books/OL456M');
   await page.reload();await ready(page);await page.locator('.pp-collect').waitFor();assert.equal((await read()).wb.page.posts[0].attachments[0].url,'https://openlibrary.org/books/OL456M');
  });
  await check('Empty/error/late Korean response retains manual input and never revives a closed or changed selection',async()=>{
   await click('글쓰기');await page.locator('#ppBody').fill('실패해도 남겨야 하는 새 글');
   for(const state of ['empty','error']){
    await search();await second();mode=state;await korean();await page.getByText(state==='empty'?/제공자 검색에서 한국어판을 확인하지 못했어요/:/작품 정보는 그대로 사용할 수 있습니다/).waitFor();await snap('korean-'+state,390);assert(await page.getByRole('button',{name:'직접 입력',exact:true}).isVisible());
    if(state==='error'){mode='ok';await click('판본 다시 확인');await page.locator('.cl-editions .cl-pick-row').waitFor();}
    await click('선택창 닫기');mode='ok';assert.equal(await page.locator('#ppBody').inputValue(),'실패해도 남겨야 하는 새 글');
   }
   await search();await second();mode='hold';await korean();await page.getByText('판본 확인 중…',{exact:true}).waitFor();while(!release)await new Promise(r=>setTimeout(r,10));await snap('korean-loading',390);
   await page.locator('#clPickerQuery').fill('새로운 질문');release();await page.waitForTimeout(150);assert.equal(await page.locator('.cl-editions').count(),0);assert.equal(await page.locator('#clPickerQuery').inputValue(),'새로운 질문');await click('선택창 닫기');assert.equal(await page.locator('#ppBody').inputValue(),'실패해도 남겨야 하는 새 글');
  });
  assert.deepEqual(report.errors,[]);assert.equal(report.consoleErrors.length,2,'Only deliberate 429 failures expected');
 }catch(error){await page.screenshot({path:path.join(out,'failure.png')});throw error;}
 finally{await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await context.close();await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

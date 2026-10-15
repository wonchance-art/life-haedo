'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {playwright,ready,makeContext}=require('./unified-home-browser.cjs');
const {FakeCloud,accounts,base,cloud}=require('./life-sync-browser.cjs');
const {inspect,abortWorkbenchWrites}=require('./life-workbench-browser.cjs');
const out=path.resolve('.local/artwork-reference'),report={checks:[],visual:[],errors:[],consoleErrors:[],external:[],environment:'Linux Chromium; anonymous mock Auth and museum source popup; real IndexedDB. No live museum API/Apple hardware/production writes.'};
const source='https://www.artic.edu/artworks/129884/starry-night-and-the-astronauts';
async function main(){
 await fs.mkdir(out,{recursive:true});const browser=await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});report.browser=browser.version();
 const context=await makeContext(browser,new FakeCloud(),'artwork-reference',accounts.a,{viewport:{width:1440,height:1000},hasTouch:true});let permitSource=false;
 await context.route('**/*',async route=>{const u=new URL(route.request().url());if([new URL(base).origin,cloud].includes(u.origin))return route.fallback();report.external.push(route.request().url());assert(permitSource&&route.request().url()===source,'Unexpected automatic external request');return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Mock museum source</title><p>모의 미술관 출처</p>'});});
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 const click=async name=>{if(name==='글쓰기')return require('./page-composer-entry.cjs').openLegacy(page);await page.getByRole('button',{name,exact:true}).click();};
 const read=()=>page.evaluate(async()=>{const s=HaedoLife.Shell.storage,w=await s.getActive();return {collection:await s.readCollection(w),wb:await s.readWorkbench(w),bundle:await s.read(w)};});
 const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
 async function snap(scene,width,selector='.life-workbench'){
  await page.setViewportSize({width,height:width===390?844:1000});await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
  if(scene==='collection-review')await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
  const metrics=await page.evaluate('('+inspect.toString().replaceAll('.life-workbench',selector)+')()');for(const key of ['smallTargets','smallInputs','unnamed','contrastFailures'])assert.deepEqual(metrics[key],[],scene+' '+key);assert(!metrics.horizontalOverflow);report.visual.push({scene,width,...metrics});await page.screenshot({path:path.join(out,scene+'-'+width+'.png')});
 }
 try{
  await page.goto(base+'/index.html?section=records&view=page');await ready(page);await page.locator('.pp-toolbar').waitFor();const original=await read();
  await check('Museum link enters artwork review without a request; explicit source popup preserves manuscript',async()=>{
   await click('글쓰기');await page.locator('#ppBody').fill('색의 반복을 오래 바라보다가 내 하루의 리듬을 떠올렸다. 이 문장은 개인적인 감상이다.');await click('음악·책·대상 붙이기');await page.locator('#clPickerQuery').fill(source);assert.equal(await page.getByRole('button',{name:'작품 정보 확인',exact:true}).count(),1);await click('직접 입력');assert.equal(await page.getByLabel('첨부 종류',{exact:true}).inputValue(),'artwork');assert.equal(await page.getByLabel('출처 링크',{exact:true}).inputValue(),source);assert.match(await page.locator('.pp-manual').innerText(),/정보를 조회한 것은 아닙니다/);assert.deepEqual(report.external,[]);
   await page.getByLabel('제목 또는 이름',{exact:true}).fill('Starry Night and the Astronauts');await page.getByLabel('작가',{exact:true}).fill('Alma Thomas');
   for(const w of [1440,820,390])await snap('artwork-review',w);
   const link=page.getByRole('link',{name:'원출처 열기 · 새 탭',exact:true});assert.equal(await link.getAttribute('rel'),'noopener noreferrer');permitSource=true;const [popup]=await Promise.all([context.waitForEvent('page'),link.click()]);await popup.waitForLoadState();assert.equal(popup.url(),source);await popup.close();permitSource=false;assert.match(await page.locator('#ppBody').inputValue(),/개인적인 감상/);
   await page.getByLabel('출처 링크',{exact:true}).fill('javascript:alert(1)');assert.equal(await link.count(),0);await page.getByLabel('출처 링크',{exact:true}).fill(source);assert.equal(await link.getAttribute('href'),source);
   await click('첨부');assert.equal(await page.locator('.pp-edit-attachment').count(),1);
  });
  await check('Save failure keeps artwork/source/body, retry and explicit collection retention preserve private scope',async()=>{
   await abortWorkbenchWrites(page,true);await click('저장');await page.locator('.pp-status').filter({hasText:/./}).waitFor();assert.match(await page.locator('#ppBody').inputValue(),/개인적인 감상/);assert.match(await page.locator('.pp-edit-attachments').innerText(),/Alma Thomas/);assert.deepEqual((await read()).wb,original.wb);await snap('save-error',390);
   await abortWorkbenchWrites(page,false);await click('저장');await page.locator('.pp-collect').waitFor();const saved=await read();assert.equal(saved.wb.page.posts[0].visibility,'private');assert.deepEqual(saved.wb.page.posts[0].attachments[0],{type:'artwork',title:'Starry Night and the Astronauts',creator:'Alma Thomas',url:source});assert.deepEqual(saved.bundle,original.bundle);assert.deepEqual(saved.collection,original.collection);
   await page.reload();await ready(page);await page.locator('.pp-collect').waitFor();await page.locator('.pp-collect').click();await page.getByText(/컬렉션에 보관했습니다/).waitFor();const retained=await read();assert.deepEqual(retained.wb,saved.wb);assert.equal(retained.collection.items[0].url,source);assert.equal(retained.collection.items[0].note,'');assert.deepEqual(retained.collection.items[0].details,{});
  });
  await check('Collection source review keeps artwork details, notes and backup independent of page attachments',async()=>{
   await page.goto(base+'/index.html?section=records&view=collection');await ready(page);await page.locator('.life-collection').waitFor();await click('컬렉션 항목 추가');await page.locator('#clPickerQuery').fill('https://www.artic.edu/artworks/27992/a-sunday-on-la-grande-jatte-1884');await click('직접 입력');assert.equal(await page.locator('#clType').inputValue(),'artwork');assert.match(await page.locator('#clLookup').innerText(),/작품 번호만 보내 조회/);assert.equal(await page.getByRole('button',{name:'주소로 정보 확인',exact:true}).count(),1);
   await page.locator('#clTitle').fill('A Sunday on La Grande Jatte — 1884');await page.locator('#clCreator').fill('Georges Seurat');await page.locator('#clyear').fill('1884–86');await page.locator('#clmedium').fill('유화');await page.locator('#clholding').fill('Art Institute of Chicago');await page.locator('#clrights').fill('이미지 사용 조건은 별도 확인');await page.locator('#clNote').fill('비공개 메모: 점과 색을 다시 관찰하기');
   for(const w of [1440,820,390])await snap('collection-review',w,'.life-collection');
   await page.locator('#clUrl').fill('https://example.org/art');assert.equal(await page.getByRole('button',{name:'주소로 정보 확인',exact:true}).count(),1);await page.locator('#clUrl').fill('https://www.artic.edu/artworks/27992/a-sunday-on-la-grande-jatte-1884');assert.equal(await page.locator('#clNote').inputValue(),'비공개 메모: 점과 색을 다시 관찰하기');
   const before=await read();await click('저장');await page.getByRole('button',{name:'항목 수정',exact:true}).waitFor();const saved=await read();assert.deepEqual(saved.wb,before.wb);const item=saved.collection.items.find(i=>i.title.startsWith('A Sunday'));assert.equal(item.details.holding,'Art Institute of Chicago');assert.equal(item.type,'artwork');assert.match(item.note,/비공개/);
   const restored=await page.evaluate(c=>HaedoLife.Collection.readBackup(JSON.stringify(HaedoLife.Collection.makeBackup(c))),saved.collection);assert.deepEqual(restored.items,saved.collection.items);
  });
  assert.deepEqual(report.external,[source]);assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);
 }catch(error){await page.screenshot({path:path.join(out,'failure.png')});throw error;}
 finally{await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await context.close();await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

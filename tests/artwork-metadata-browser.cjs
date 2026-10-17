'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {playwright,ready,makeContext}=require('./unified-home-browser.cjs');
const {FakeCloud,accounts,base,cloud}=require('./life-sync-browser.cjs');
const {inspect,abortWorkbenchWrites}=require('./life-workbench-browser.cjs');
const out=path.resolve('.local/artwork-metadata'),report={checks:[],visual:[],errors:[],consoleErrors:[],requests:[],environment:'Linux Chromium; mock Auth/AIC responses and real IndexedDB. Live AIC adapter verification is separate.'};
const source='https://www.artic.edu/artworks/27992/a-sunday-on-la-grande-jatte-1884';
const row={id:27992,title:'A Sunday on La Grande Jatte — 1884',artist_title:'Georges Seurat',artist_display:'Georges Seurat (French, 1859–1891)',date_display:'1884–86, border added 1888–89',medium_display:'Oil on canvas'};
async function main(){
 await fs.mkdir(out,{recursive:true});const browser=await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});report.browser=browser.version();
 const context=await makeContext(browser,new FakeCloud(),'artwork-metadata',accounts.a,{viewport:{width:1440,height:1000},hasTouch:true});let mode='ok',release;
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());if([new URL(base).origin,cloud].includes(u.origin))return route.fallback();
  assert.equal(u.origin,'https://api.artic.edu','Unexpected image/source/provider request');assert.equal(route.request().method(),'GET');
  report.requests.push(u.href);const params=u.searchParams.has('params')?JSON.parse(u.searchParams.get('params')):null;
  if(mode==='hold')await new Promise(r=>release=r);
  if(mode==='error')return route.fulfill({status:429,body:''});
  if(!params)return route.fulfill({json:{data:row}});
  const query=params.query.multi_match.query;
  assert.equal(params.limit,6);assert.equal(params.query.multi_match.type,'cross_fields');assert.equal(params.query.multi_match.operator,'and');
  assert(!params.fields.includes('image_id'));assert(!params.fields.includes('description'));
  const data=query==='모네'?[]:params.page===2?[{...row,id:61616,title:'Oil Sketch for A Sunday on La Grande Jatte — 1884'}]:Array.from({length:6},(_,i)=>({...row,id:i===0?27992:30000+i,title:i===0?row.title:'긴 제목의 작품 — 관찰한 색과 선의 반복을 기억하기 위한 익명 한글 검수 후보 '+(i+1)}));
  return route.fulfill({json:{data,pagination:{total:query==='모네'?0:7}}});
 });
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 const click=async name=>{if(name==='글쓰기')return require('./page-composer-entry.cjs').openLegacy(page);await page.getByRole('button',{name,exact:true}).click();};
 const read=()=>page.evaluate(async()=>{const s=HaedoLife.Shell.storage,w=await s.getActive();return {collection:await s.readCollection(w),wb:await s.readWorkbench(w),bundle:await s.read(w)};});
 const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
 async function snap(scene,width,selector='.cl-picker'){
  await page.setViewportSize({width,height:width===390?844:1000});await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
  const metrics=await page.evaluate('('+inspect.toString().replaceAll('.life-workbench',selector)+')()');for(const key of ['smallTargets','smallInputs','unnamed','contrastFailures'])assert.deepEqual(metrics[key],[],scene+' '+key);assert(!metrics.horizontalOverflow);report.visual.push({scene,width,...metrics});await page.screenshot({path:path.join(out,scene+'-'+width+'.png')});
 }
 const open=async(query)=>{await click('음악·책·대상 붙이기');await page.locator('#clPickerQuery').fill(query);};
 const search=()=>click('작품 찾기 · 시카고 미술관');
 try{
  await page.goto(base+'/index.html?section=records&view=page');await ready(page);await require('./page-composer-entry.cjs').openCompatibility(page);const original=await read();await click('글쓰기');await page.locator('#ppBody').fill('점과 색을 보며 느낀 개인적인 감상. 이 본문은 미술관에 보내지 않는다.');
  await check('Explicit artwork search, IME guard, literal Korean empty result and manual recovery',async()=>{
   await open('모네');assert.equal(report.requests.length,0);await page.locator('#clPickerQuery').dispatchEvent('compositionstart');await search();assert.equal(report.requests.length,0);await page.locator('#clPickerQuery').dispatchEvent('compositionend');await search();await page.getByText(/찾은 후보가 없어요/).waitFor();assert.equal(await page.locator('.cl-candidate').count(),0);assert.match(await page.locator('.cl-picker-remote').innerText(),/한국어 검색은 제한적/);await snap('empty',390);
   await page.locator('#clPickerQuery').fill('Van Gogh');mode='error';await search();await page.getByText(/제공자가 조회를 제한/).waitFor();assert.equal(await page.locator('#clPickerQuery').inputValue(),'Van Gogh');assert(await page.getByRole('button',{name:'작품 찾기 · 시카고 미술관',exact:true}).evaluate(e=>e===document.activeElement));mode='ok';await click('선택창 닫기');assert.match(await page.locator('#ppBody').inputValue(),/개인적인/);
  });
  await check('Combined title/artist query, next-page error recovery, keyboard and cached previous candidates',async()=>{
   await open('La Grande Jatte Seurat');await search();await page.locator('.cl-candidate').first().waitFor();assert.equal(await page.locator('.cl-candidate').count(),6);
   for(const w of [1440,820,390])await snap('search',w);
   mode='error';await click('다음 검색 결과');await page.getByText(/제공자가 조회를 제한/).waitFor();assert.equal(await page.locator('.cl-candidate').count(),6);assert.equal(await page.locator('.cl-picker-remote').evaluate(e=>e.inert),false);assert(await page.getByRole('button',{name:'다음 검색 결과',exact:true}).evaluate(e=>e===document.activeElement));await snap('page-error',390);
   mode='ok';await page.keyboard.press('Enter');await page.getByText('검색 결과 · 2쪽',{exact:true}).waitFor();assert.equal(await page.locator('.cl-candidate').count(),1);const count=report.requests.length;await click('이전 검색 결과');assert.equal(report.requests.length,count);assert.equal(await page.locator('.cl-candidate').count(),6);
   await page.locator('.cl-candidate .cl-pick-row').first().click();assert.equal(await page.getByLabel('첨부 종류',{exact:true}).inputValue(),'artwork');assert.equal(await page.getByLabel('작가',{exact:true}).inputValue(),row.artist_display);assert.match(await page.locator('.pp-manual').innerText(),/1884–86/);assert.equal(await page.getByLabel('출처 링크',{exact:true}).inputValue(),'https://www.artic.edu/artworks/27992');
  });
  await check('Editable review, failed save/retry, reload, private attachment and explicit collection retention',async()=>{
   await page.getByLabel('제목 또는 이름',{exact:true}).fill('그랑드 자트섬의 일요일 오후 — 확인한 작품');for(const w of [1440,820,390])await snap('review',w,'.life-workbench');await click('첨부');await abortWorkbenchWrites(page,true);await click('저장');await page.locator('.pp-status').filter({hasText:/./}).waitFor();assert.match(await page.locator('#ppBody').inputValue(),/개인적인/);assert.deepEqual((await read()).wb,original.wb);await snap('save-error',390,'.life-workbench');await abortWorkbenchWrites(page,false);await click('저장');await page.locator('.pp-collect').waitFor();const saved=await read();assert.equal(saved.wb.page.posts[0].visibility,'private');assert.equal(saved.wb.page.posts[0].attachments[0].creator,row.artist_display);assert.equal(saved.wb.page.posts[0].attachments[0].url,'https://www.artic.edu/artworks/27992');assert.deepEqual(saved.collection,original.collection);assert.deepEqual(saved.bundle,original.bundle);
   await page.reload();await ready(page);await require('./page-composer-entry.cjs').openCompatibility(page);await page.locator('.pp-collect').waitFor();await page.locator('.pp-collect').click();await page.getByText(/컬렉션에 보관했습니다/).waitFor();const retained=await read();assert.equal(retained.collection.items[0].note,'');assert.deepEqual(retained.collection.items[0].details,{});assert.deepEqual(retained.wb,saved.wb);
  });
  await check('Link lookup matches existing slug/canonical identity without overwriting personal title or note',async()=>{
   await click('글쓰기');await page.locator('#ppBody').fill('다시 연결하는 감상');await open(source);const before=report.requests.length;await click('작품 정보 확인');await page.locator('.cl-picker-remote .cl-pick-row').waitFor();assert.equal(report.requests.length,before+1);await page.locator('.cl-picker-remote .cl-pick-row').click();assert.equal(await page.locator('.pp-manual').isVisible(),false);assert.match(await page.locator('.pp-edit-attachments').innerText(),/확인한 작품/);
  });
  await check('Input/close cancels delayed provider results and never revives selection or loses body',async()=>{
   mode='hold';await open('Hokusai');await search();await page.getByText('검색 중…',{exact:true}).waitFor();while(!release)await page.waitForTimeout(10);await snap('loading',390);await page.locator('#clPickerQuery').fill('새로운 검색');release();release=null;mode='ok';await page.waitForTimeout(100);assert.equal(await page.locator('.cl-candidate').count(),0);assert.equal(await page.locator('#clPickerQuery').inputValue(),'새로운 검색');await click('선택창 닫기');assert.equal(await page.locator('#ppBody').inputValue(),'다시 연결하는 감상');
   mode='hold';await open('Monet');await search();while(!release)await page.waitForTimeout(10);await click('선택창 닫기');release();release=null;mode='ok';await page.waitForTimeout(100);assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.locator('#ppBody').inputValue(),'다시 연결하는 감상');
  });
  await check('Collection link review uses explicit field choices; editing creator clears its choice; detail/note/backup preserved',async()=>{
   await click('초안 닫기');await page.goto(base+'/index.html?section=records&view=collection');await ready(page);await page.locator('.life-collection').waitFor();await click('컬렉션 항목 추가');await page.locator('#clPickerQuery').fill(source);await click('직접 입력');await page.locator('#clTitle').fill('내가 적은 제목');await page.locator('#clCreator').fill('내가 확인한 작가');await page.locator('#clNote').fill('비공개 관찰 메모');await page.locator('#clholding').fill('내가 확인한 소장처');await click('주소로 정보 확인');await page.locator('#clApplyMetadata').waitFor();assert.equal(await page.locator('[data-metadata-field=title]').isChecked(),false);assert.equal(await page.locator('[data-metadata-field=creator]').isChecked(),false);await page.locator('[data-metadata-field=creator]').check();await page.locator('#clCreator').fill('편집 중 새로 확인한 작가');assert.equal(await page.locator('[data-metadata-field=creator]').isChecked(),false);await page.locator('[data-metadata-field=url]').check();for(const w of [1440,820,390])await snap('collection-review',w,'.life-collection');await click('선택한 정보 적용');assert.equal(await page.locator('#clTitle').inputValue(),'내가 적은 제목');assert.equal(await page.locator('#clCreator').inputValue(),'편집 중 새로 확인한 작가');assert.equal(await page.locator('#clNote').inputValue(),'비공개 관찰 메모');assert.equal(await page.locator('#clholding').inputValue(),'내가 확인한 소장처');await click('저장');await page.getByRole('button',{name:'항목 수정',exact:true}).waitFor();const saved=await read();const copy=await page.evaluate(c=>HaedoLife.Collection.readBackup(JSON.stringify(HaedoLife.Collection.makeBackup(c))),saved.collection);assert.deepEqual(copy.items,saved.collection.items);
  });
  assert.deepEqual(report.errors,[]);assert.equal(report.consoleErrors.length,2,'Only deliberate 429 responses should be reported');
 }catch(error){await page.screenshot({path:path.join(out,'failure.png')});throw error;}
 finally{if(release)release();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await context.close();await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

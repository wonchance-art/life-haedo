'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {playwright,ready,makeContext}=require('./unified-home-browser.cjs');
const {FakeCloud,accounts,base,cloud}=require('./life-sync-browser.cjs');
const {inspect}=require('./life-workbench-browser.cjs');
const out=path.resolve(process.env.TASTE_OUTPUT||'.local/taste-writing');
const report={checks:[],visual:[],errors:[],consoleErrors:[],requests:[],environment:'Linux Chromium; anonymous mock Auth/search, real IndexedDB. Not Apple hardware or live account testing.'};
async function main(){
 await fs.mkdir(out,{recursive:true});const browser=await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});report.browser=browser.version();
 const context=await makeContext(browser,new FakeCloud(),'taste-writing',accounts.a,{viewport:{width:1440,height:1000},hasTouch:true});
 let mode='ok',release;
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());if([new URL(base).origin,cloud].includes(url.origin))return route.fallback();
  assert(['api.github.com','openlibrary.org'].includes(url.hostname),'Unexpected external request '+url.origin);
  report.requests.push({host:url.hostname,query:url.searchParams.get('q')});
  if(mode==='hold')await new Promise(r=>release=r);
  if(mode==='error')return route.fulfill({status:429,body:'',headers:{'Access-Control-Allow-Origin':'*'}});
  return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(url.hostname==='openlibrary.org'?{docs:mode==='empty'?[]:[{key:'/works/OL123W',title:'느린 관찰의 기록 — 일상에서 새로운 질문을 발견하는 방법',author_name:['익명 저자'],first_publish_year:2021}]}:{items:[{private:false,name:'작은 기록 도구',full_name:'sample-studio/notes',owner:{login:'sample-studio'},description:'읽고 쓰는 일을 돕는 오픈소스 프로젝트'}]})});
 });
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 const click=name=>page.getByRole('button',{name,exact:true}).click();
 const go=async()=>{await page.goto(base+'/index.html?section=records&view=page');await ready(page);await page.locator('.pp-toolbar').waitFor();};
 const read=()=>page.evaluate(async()=>{const s=HaedoLife.Shell.storage,w=await s.getActive();return {wb:await s.readWorkbench(w),collection:await s.readCollection(w),bundle:await s.read(w)};});
 const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
 async function snap(scene,width,selector='.cl-picker'){
  await page.setViewportSize({width,height:width===390?844:1000});await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
  const metrics=await page.evaluate('('+inspect.toString().replaceAll('.life-workbench',selector)+')()');
  for(const key of ['smallTargets','smallInputs','unnamed','contrastFailures'])assert.deepEqual(metrics[key],[],scene+' '+key);
  assert(!metrics.horizontalOverflow);report.visual.push({scene,width,...metrics});await page.screenshot({path:path.join(out,scene+'-'+width+'.png')});
 }
 try{
  await go();const original=await read();
  await page.evaluate(async()=>{const s=HaedoLife.Shell.storage,w=await s.getActive(),c=await s.readCollection(w),now=new Date().toISOString();for(const [type,title,tags] of [['book','다시 읽는 산책의 문장',['관찰']],['tool','생각을 연결하는 도구',['기록']],['film','빛이 남은 오후',['관찰']]])c.items.push({id:HaedoLife.Core.id(),type,title,creator:'익명 창작자',url:'https://example.org/'+type,note:'개인 메모: 오래 남은 이유를 다시 생각하기',tags,details:{},archived:false,createdAt:now,updatedAt:now});await s.saveCollection(w,c,c.revision);});
  const collection=(await read()).collection;
  await check('Write first, inspect saved topic and note, attach without copying private context',async()=>{
   await click('글쓰기');await page.locator('#ppBody').fill('퇴근길에 다시 읽은 문장.\n\n빠르게 수집하는 것보다 오래 바라보는 일이 필요했다. 책과 작은 도구를 함께 남겨 다음 주의 읽기에 이어가고 싶다.');
   await click('음악·책·대상 붙이기');await page.locator('#clPickerTopic').selectOption('관찰');assert.equal(await page.locator('.cl-picker-results .cl-pick-row').count(),2);
   await page.getByRole('dialog').getByRole('button',{name:'책',exact:true}).click();assert.equal(await page.locator('.cl-picker-results .cl-pick-row').count(),1);
   await page.locator('.cl-pick-note summary').click();assert.match(await page.locator('.cl-pick-note').innerText(),/개인 메모/);
   for(const w of [1440,820,390])await snap('reuse',w);
   assert.equal(report.requests.length,0);await page.locator('.cl-picker-results .cl-pick-row').click();assert.equal(await page.locator('.pp-edit-attachment').count(),1);assert(!await page.locator('.pp-edit-attachments').innerText().then(t=>t.includes('개인 메모')));
  });
  await check('Explicit book search, review editable author/work metadata, preserve body and collection',async()=>{
   await click('음악·책·대상 붙이기');await page.locator('#clPickerQuery').fill('느린 관찰');assert.equal(report.requests.length,0);
   await page.locator('#clPickerQuery').dispatchEvent('compositionstart');await click('책 찾기 · Open Library');assert.equal(report.requests.length,0);await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),1);await page.locator('#clPickerQuery').dispatchEvent('compositionend');
   await click('책 찾기 · Open Library');await page.locator('.cl-picker-remote .cl-pick-row').waitFor();
   assert.match(await page.locator('.cl-picker-remote').innerText(),/판본 미지정/);
   for(const w of [1440,820,390])await snap('book-results',w);
   const count=report.requests.length;await click('책 찾기 · Open Library');assert.equal(report.requests.length,count); // dialog-only cache
   await page.locator('.cl-picker-remote .cl-pick-row').click();assert.equal(await page.getByRole('textbox',{name:'아티스트·저자',exact:true}).inputValue(),'익명 저자');
   assert.match(await page.locator('.pp-manual').innerText(),/판본 미지정/);await click('첨부');assert.equal(await page.getByRole('button',{name:'음악·책·대상 붙이기',exact:true}).evaluate(e=>e===document.activeElement),true);assert.match(await page.locator('#ppBody').inputValue(),/퇴근길/);
   await click('음악·책·대상 붙이기');await page.locator('#clPickerQuery').fill('기록 도구');await click('프로젝트 찾기 · GitHub');await page.locator('.cl-picker-remote .cl-pick-row').waitFor();assert.match(await page.locator('.cl-picker-remote').innerText(),/저장소 소유자/);await page.locator('.cl-picker-remote .cl-pick-row').click();assert.equal(await page.getByRole('textbox',{name:'아티스트·저자',exact:true}).inputValue(),'');await click('첨부');
   for(const w of [1440,820,390])await snap('composer',w,'.life-workbench');
   await click('저장');await page.locator('.pp-feed .pp-post').waitFor();const saved=await read();assert.equal(saved.wb.page.posts[0].visibility,'private');assert.equal(saved.wb.page.posts[0].attachments.length,3);assert(!JSON.stringify(saved.wb.page.posts).includes('개인 메모'));assert.deepEqual(saved.bundle,original.bundle);assert.deepEqual(saved.collection,collection);
  });
  await check('Profile edit, explicit candidate scope, preview width and edit return preserve exact saved attachments',async()=>{
   await click('페이지 설정');await page.locator('#wbPageTitle').fill('오래 바라본 것들');await page.locator('#wbPageIntro').fill('읽고, 만들고, 다시 생각한 것들을 모읍니다.');
   await click('방문자 미리보기');assert.equal(await page.locator('#wbVisitor .pp-post').count(),0);await click('편집으로 돌아가기');await page.locator('.pp-feed').getByRole('button',{name:'글 수정',exact:true}).first().click();await page.locator('#ppVisibility').selectOption('page');await click('저장');await page.locator('.pp-feed .pp-post').waitFor();
   const before=await read();await click('방문자 미리보기');assert.equal(await page.locator('#wbVisitor .pp-post').count(),1);assert.match(await page.locator('#wbVisitor').innerText(),/오래 바라본/);
   for(const w of [1440,820,390])await snap('preview',w,'.life-workbench');
   await page.setViewportSize({width:1440,height:1000});await click('좁은 폭으로 보기');assert(await page.locator('#wbVisitor').evaluate(e=>e.getBoundingClientRect().width<=390));await snap('narrow-preview',1440,'.life-workbench');
   await click('편집으로 돌아가기');assert.deepEqual((await read()).wb.page.posts,before.wb.page.posts);
   await go();assert.match(await page.locator('.wb-page-lead').innerText(),/오래 바라본/);
   const backup=await page.evaluate(async()=>{const s=HaedoLife.Shell.storage,w=await s.getActive(),snap=await s.readWorkbenchSnapshot(w);return HaedoLife.Workbench.restoreBackup(HaedoLife.Workbench.makeBackup(snap.bundle,snap.workbench));});assert.deepEqual(backup.workbench.page.posts[0].attachments,before.wb.page.posts[0].attachments);
  });
  await check('Empty, error, loading, changed-query late response, Escape and manual recovery',async()=>{
   await go();await click('글쓰기');await page.locator('#ppBody').fill('검색에 실패해도 남겨 둘 생각');await click('음악·책·대상 붙이기');
   mode='empty';await page.locator('#clPickerQuery').fill('없는 책');await click('책 찾기 · Open Library');await page.getByText(/찾은 후보가 없어요/).waitFor();await snap('empty',390);
   await page.keyboard.press('Escape');await click('초안 닫기');await go();await page.locator('.pp-drafts summary').click();await click('검색에 실패해도 남겨 둘 생각');await click('음악·책·대상 붙이기');mode='error';await page.locator('#clPickerQuery').fill('실패 예제');await click('책 찾기 · Open Library');await page.getByText(/직접 입력으로 이어갈 수 있어요/).waitFor();await snap('error',390);
   await page.keyboard.press('Escape');await click('초안 닫기');await go();await page.locator('.pp-drafts summary').click();await click('검색에 실패해도 남겨 둘 생각');await click('음악·책·대상 붙이기');mode='hold';await page.locator('#clPickerQuery').fill('느린 검색');await click('책 찾기 · Open Library');await page.getByText('검색 중…',{exact:true}).waitFor();await snap('loading',390);assert(release);
   await page.locator('#clPickerQuery').fill('바뀐 검색');mode='ok';release();release=null;await page.waitForTimeout(100);assert.equal(await page.locator('.cl-picker-remote .cl-pick-row').count(),0);
   await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'음악·책·대상 붙이기',exact:true}).evaluate(e=>e===document.activeElement),true);assert.equal(await page.locator('#ppBody').inputValue(),'검색에 실패해도 남겨 둘 생각');
   await click('음악·책·대상 붙이기');await page.locator('#clPickerQuery').fill('직접 확인한 제목');await click('직접 입력');await click('첨부');await click('저장');await page.locator('.pp-feed .pp-post').first().waitFor();assert.equal((await read()).wb.page.posts.length,2);
  });
  assert.deepEqual(report.errors,[]);assert(report.consoleErrors.every(t=>/429/.test(t)),JSON.stringify(report.consoleErrors));
 }finally{if(release)release();await browser.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
}
main().catch(e=>{console.error(e);if(process.env.GITHUB_ACTIONS)console.error('::error title=Taste writing::'+String(e.stack||e).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'));process.exitCode=1;});

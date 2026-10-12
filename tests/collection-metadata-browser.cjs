'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {playwright,ready,makeContext}=require('./unified-home-browser.cjs');
const {FakeCloud,accounts,base,cloud}=require('./life-sync-browser.cjs');
const {inspect}=require('./life-workbench-browser.cjs');
const out=path.resolve(process.env.COLLECTION_METADATA_OUTPUT||'.local/collection-metadata');
const report={checks:[],visual:[],requests:[],errors:[],consoleErrors:[],external:[],environment:'Linux Chromium; intercepted public APIs and anonymous Auth; real IndexedDB. Not Apple hardware or live YouTube.'};
async function main(){
 await fs.mkdir(out,{recursive:true});const browser=await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});report.browser=browser.version();
 const context=await makeContext(browser,new FakeCloud(),'collection-metadata',accounts.a);
 context.on('page',p=>{p.on('pageerror',e=>report.errors.push(e.message));p.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});});
 let mode='ok',release;
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if([new URL(base).origin,cloud].includes(url.origin))return route.fallback();
  if(!['https://api.github.com','https://www.youtube.com'].includes(url.origin)){report.external.push(url.origin);return route.abort();}
  report.requests.push({url:request.url(),headers:request.headers(),method:request.method()});
  if(mode==='hold')await new Promise(resolve=>release=resolve);
  if(mode==='error')return route.fulfill({status:429,body:'',headers:{'Access-Control-Allow-Origin':'*'}});
  return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(url.hostname==='api.github.com'?{private:false,name:'느린 관찰을 돕는 열린 도구 — 기록을 연결하고 다시 읽는 프로젝트',owner:{login:'sample-studio'},description:'외부 설명은 개인 메모가 아님'}:{title:'비 오는 오후, 작업실에서 듣는 음악',author_name:'익명 음악 채널',html:'<iframe src="https://unexpected.invalid">'})});
 });
 const page=await context.newPage();const click=name=>page.getByRole('button',{name,exact:true}).click();
 const go=async()=>{await page.goto(base+'/index.html?section=records&view=collection');await ready(page);await page.locator('.life-collection').waitFor();};
 const read=()=>page.evaluate(async()=>HaedoLife.Shell.storage.readCollection(await HaedoLife.Shell.storage.getActive()));
 const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
 async function snap(scene,width){await page.setViewportSize({width,height:width===390?844:1000});await page.evaluate(()=>document.fonts.ready);await page.locator('#clLookup').scrollIntoViewIfNeeded();const metrics=await page.evaluate('('+inspect.toString().replaceAll('.life-workbench','.life-collection')+')()');for(const key of ['smallTargets','smallInputs','unnamed','contrastFailures'])assert.deepEqual(metrics[key],[],scene+' '+key);assert(!metrics.horizontalOverflow);report.visual.push({scene,...metrics});await page.screenshot({path:path.join(out,scene+'-'+width+'.png')});}
 try{
  await go();await click('컬렉션 항목 추가'); await click('직접 입력');
  await check('No automatic fetch; query sends canonical public resource only',async()=>{
   await page.locator('#clTitle').fill('내가 붙인 제목');await page.locator('#clNote').fill('외부로 보내지 않을 생각');await page.locator('#clUrl').fill('https://github.com/sample-studio/open-notebook?token=private#readme');assert.equal(report.requests.length,0);await click('주소로 정보 확인');await page.locator('.cl-candidate').waitFor();
   assert.equal(report.requests[0].url,'https://api.github.com/repos/sample-studio/open-notebook');assert.equal(report.requests[0].headers.authorization,undefined);assert.equal(report.requests[0].headers.cookie,undefined);assert.equal(report.requests[0].headers.referer,undefined);assert.equal((await read()).items.length,0);assert.equal(await page.locator('[data-metadata-field=title]').isChecked(),false);
   for(const width of [1440,820,390])await snap('candidate',width);
  });
  await check('Explicit selected application preserves author, memo and existing title; save/reload/backup match',async()=>{
   await page.locator('[data-metadata-field=url]').check();await click('선택한 정보 적용');assert.equal(await page.locator('#clTitle').inputValue(),'내가 붙인 제목');assert.equal(await page.locator('#clCreator').inputValue(),'');assert.equal(await page.locator('#clNote').inputValue(),'외부로 보내지 않을 생각');assert.equal(await page.locator('#clUrl').inputValue(),'https://github.com/sample-studio/open-notebook');
   await click('저장');await page.getByRole('button',{name:'항목 수정',exact:true}).waitFor();await go();const state=await read();assert.equal(state.items.length,1);const backup=await page.evaluate(s=>HaedoLife.Collection.readBackup(JSON.stringify(HaedoLife.Collection.makeBackup(s))),state);assert.deepEqual(backup.items,state.items);
   await page.locator('.cl-card').click();await click('항목 수정');
  });
  await check('Failed provider lookup and cancel retain form; unsupported input never requests',async()=>{
   mode='error';await click('주소로 정보 확인');await page.getByText('제공자가 조회를 제한했습니다.',{exact:false}).waitFor();await snap('error',390);assert.equal(await page.locator('#clNote').inputValue(),'외부로 보내지 않을 생각');
   await page.locator('#clUrl').fill('https://example.org/article');const count=report.requests.length;await click('주소로 정보 확인');await page.getByText('YouTube 영상 또는 GitHub 공개 저장소 주소를 넣어 주세요.',{exact:false}).waitFor();assert.equal(report.requests.length,count);
  });
  await check('URL changes and editor cancellation discard late responses',async()=>{
   mode='hold';await page.locator('#clUrl').fill('https://youtu.be/jNQXAC9IVRw?si=tracking');await click('주소로 정보 확인');await page.getByRole('button',{name:'조회 취소',exact:true}).waitFor();await snap('loading',390);await page.waitForFunction(()=>true);while(!release)await new Promise(r=>setTimeout(r,10));await page.locator('#clUrl').fill('https://example.org/new');mode='ok';release();release=null;await page.waitForTimeout(100);assert.equal(await page.locator('.cl-candidate').count(),0);assert.equal(await page.locator('#clUrl').inputValue(),'https://example.org/new');
   mode='hold';await page.locator('#clUrl').fill('https://youtu.be/jNQXAC9IVRw');await click('주소로 정보 확인');while(!release)await new Promise(r=>setTimeout(r,10));page.once('dialog',d=>d.accept());await click('편집 취소');mode='ok';release();release=null;await page.waitForTimeout(100);assert.equal(await page.locator('.cl-candidate').count(),0);await click('컬렉션 목록으로');await click('컬렉션 항목 추가'); await click('직접 입력');
  });
  await check('YouTube candidate distinguishes channel from artist; typed changes during review survive',async()=>{
   await page.locator('#clUrl').fill('https://youtu.be/jNQXAC9IVRw');await click('주소로 정보 확인');await page.locator('.cl-candidate').waitFor();await page.getByText('YouTube · 게시 채널: 익명 음악 채널',{exact:true}).waitFor();assert.equal(await page.locator('iframe').count(),0);
   await page.locator('#clTitle').fill('검토하면서 바꾼 제목');assert.equal(await page.locator('[data-metadata-field=title]').isChecked(),false);await page.locator('#clCreator').fill('내가 확인한 아티스트');assert.equal(await page.locator('[data-metadata-field=type]').isDisabled(),true);await page.locator('[data-metadata-field=url]').check();await click('선택한 정보 적용');assert.equal(await page.locator('#clTitle').inputValue(),'검토하면서 바꾼 제목');assert.equal(await page.locator('#clCreator').inputValue(),'내가 확인한 아티스트');assert.equal(await page.locator('#clType').inputValue(),'music');
   await click('저장');await page.getByRole('button',{name:'항목 수정',exact:true}).waitFor();
  });
  await check('Empty draft can adopt video title/type without inventing an artist',async()=>{
   await click('컬렉션 목록으로');await click('컬렉션 항목 추가'); await click('직접 입력');await page.locator('#clUrl').fill('https://youtu.be/jNQXAC9IVRw');await click('주소로 정보 확인');await page.locator('.cl-candidate').waitFor();await click('선택한 정보 적용');assert.equal(await page.locator('#clType').inputValue(),'video');assert.equal(await page.locator('#clCreator').inputValue(),'');await page.locator('#clTitle').focus();await page.keyboard.press('Tab');assert.equal(await page.locator('#clCreator').evaluate(e=>e===document.activeElement),true);await click('저장');await page.getByRole('button',{name:'항목 수정',exact:true}).waitFor();assert.equal((await read()).items.length,3);
  });
  await check('New tool classification clears only empty incompatible detail keys',async()=>{
   await click('컬렉션 목록으로');await click('컬렉션 항목 추가'); await click('직접 입력');await page.locator('#clyear').fill('2020');await page.locator('#clyear').fill('');await page.locator('#clUrl').fill('https://github.com/sample-studio/open-notebook');await click('주소로 정보 확인');await page.locator('.cl-candidate').waitFor();await click('선택한 정보 적용');assert.equal(await page.locator('#clType').inputValue(),'tool');await click('저장');await page.getByRole('button',{name:'항목 수정',exact:true}).waitFor();assert.deepEqual((await read()).items[0].details,{});
  });
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);assert(report.consoleErrors.every(message=>/429|ERR_FAILED/.test(message)),JSON.stringify(report.consoleErrors));
 }finally{if(release)release();await browser.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

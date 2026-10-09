/* Workspace recovery, real platform model/store + anonymous Auth HTTP Response mock.
 * BASE_URL localhost only. TIMELINE_RECOVERY_PHASE=before routes frozen local baseline.
 * No live auth, Supabase, private storage, Apple hardware or native Files validation. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4187';
if (!process.env.PW_MODULE_PATH && process.env.PLAYWRIGHT_MODULE) process.env.PW_MODULE_PATH = process.env.PLAYWRIGHT_MODULE;
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const {base, accounts} = require('./life-sync-browser.cjs');
const {playwright} = require('./unified-home-browser.cjs');
const {inspect} = require('../scripts/check-site-design.cjs');
const root = path.resolve(__dirname, '..'), phase = process.env.TIMELINE_RECOVERY_PHASE || 'after';
assert(['before', 'after'].includes(phase));
const out = path.join(root, '.local/timeline-recovery', phase), origin = new URL(base).origin;
const documentFixture = {profile:{name:'익명 연표 · 일과 산책을 다시 살펴보기',birth:'1993-04'},scale:'signed1',
 events:[{date:'2017-03-02',title:'첫 일을 시작하며 남긴 기록',desc:'개인 자료가 아닌 검증용 기록입니다.\r\n기록의 줄바꿈과 🪴 표시도 보존합니다.',happiness:-0.25}],
 spans:[{start:'2020-03',end:'2021-02',title:'천천히 생활의 속도를 바꾸던 시기',color:'#2E5E63'}],eras:[],happiness:[{month:'2020-03',value:0.5}],thoughts:[{date:'2024-09-21',text:'오래된 연표를 다시 읽으며 기록한 익명 생각'}],records:[],trips:[],layers:[]};
const legacyValues = {'caeyeon_life_registry':JSON.stringify({docs:[{id:'legacy-recovery',name:documentFixture.profile.name}],current:'legacy-recovery'},null,2),
 'caeyeon_life_doc_legacy-recovery':JSON.stringify(documentFixture,null,2)+'\n', 'caeyeon_life_doc_unreadable':'{anonymous invalid JSON kept byte for byte\r\n'};
const secondFixture = structuredClone(documentFixture); secondFixture.profile.name = '익명 연표 · 둘째 사본의 복구'; secondFixture.events[0].title = '두 번째 연표의 원래 사건';
if(phase==='after'){const reg=JSON.parse(legacyValues.caeyeon_life_registry);reg.docs.push({id:'legacy-second',name:secondFixture.profile.name});legacyValues.caeyeon_life_registry=JSON.stringify(reg,null,2);legacyValues['caeyeon_life_doc_legacy-second']=JSON.stringify(secondFixture,null,2)+'\n';}
function annotation(error){if(process.env.GITHUB_ACTIONS)console.error('::error title=Timeline recovery::'+String(error.stack||error).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'));}
async function contextFor(browser,report,width,{legacy=true,remote=[],failOnPosts=[]}={}){
 const context=await browser.newContext({viewport:{width,height:width===390?844:1000},hasTouch:width<=820,reducedMotion:'reduce',serviceWorkers:'block',acceptDownloads:true});
 await context.addInitScript(({account,values,remote,failOnPosts})=>{
  for(const [key,value] of Object.entries(values))if(localStorage.getItem(key)===null)localStorage.setItem(key,value);
  globalThis.__recoveryMock={requests:[],rows:remote,failOnPosts};
  globalThis.HaedoAuth={user:{id:account.id},epoch:0,config:{url:'https://fixture.invalid'},requireUser:async function(){return this.user;},request:async function(url,options){
   const u=new URL(url),method=options?.method||'GET',body=options?.body?JSON.parse(options.body):null,m=__recoveryMock;
   m.requests.push({method,table:u.pathname.split('/').pop(),owner:this.user.id,ids:body?(Array.isArray(body)?body:[body]).map(r=>r.id):[]});
   if(method==='GET'){let rows=u.pathname.endsWith('/haedo_documents')?m.rows:[];const id=u.searchParams.get('id');if(id)rows=rows.filter(r=>r.id===id.slice(3));return new Response(JSON.stringify(rows),{status:200});}
   if(!['POST','PATCH'].includes(method)||!u.pathname.endsWith('/haedo_documents'))throw Error('Unexpected simulated operation');
   if(m.holdNextWrite){m.holdNextWrite=false;m.writeEntered=true;await new Promise(resolve=>{m.releaseWrite=resolve});}
   if(m.failOnPosts.includes(m.requests.filter(r=>r.method==='POST').length))return new Response('{"message":"synthetic upload failure"}',{status:500});
   const rows=Array.isArray(body)?body:[body];for(const row of rows){const index=m.rows.findIndex(r=>r.id===row.id);if(index<0)m.rows.push(row);else m.rows[index]=row;}
   return new Response(JSON.stringify(rows),{status:200});
  }};
 },{account:accounts.a,values:legacy?legacyValues:{},remote,failOnPosts});
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin){report.external.push(u.origin);return route.abort();}
  if(['/assets/platform-auth.js','/assets/platform-config.js'].includes(u.pathname))return route.fulfill({contentType:'application/javascript',body:'/* anonymous platform recovery fixture */'});
  if(phase==='before'&&['/workspace.html','/assets/platform-ui.js','/assets/platform.css','/assets/haedo-shell.css'].includes(u.pathname))return route.fulfill({path:path.join(root,'.local/timeline-recovery/before/runtime',path.basename(u.pathname))});
  return route.continue();
 });
 return context;
}
async function ready(page){await page.goto(base+'/workspace.html');await page.waitForFunction(()=>document.querySelector('[data-private]')?.hidden===false&&typeof document.getElementById('backupFile')?.onchange==='function'&&!document.getElementById('syncRetry').disabled);}
async function state(page){return page.evaluate(()=>{const k=HaedoPlatformData.keys(HaedoAuth.user.id),reg=HaedoPlatformData.registry(localStorage,HaedoAuth.user.id);return{registry:reg,docs:reg.docs.map(r=>({id:r.id,data:JSON.parse(localStorage.getItem(k.docs+r.id))})),legacy:Object.fromEntries(Object.keys(localStorage).filter(k=>k==='caeyeon_life_registry'||k.startsWith('caeyeon_life_doc_')).map(k=>[k,localStorage.getItem(k)])),requests:__recoveryMock.requests,rows:__recoveryMock.rows};});}
async function capture(page,report,scene,width){await page.mouse.move(width-2,2);await page.evaluate(()=>document.fonts.ready);const metrics=await page.evaluate(inspect),file=`${scene}-${width}.png`;await page.screenshot({path:path.join(out,file)});report.screens.push({scene,width,file,metrics});assert.equal(metrics.horizontalOverflow,false,scene+' must not overflow');if(phase==='after'){for(const key of['smallTargets','smallInputs','unnamed','contrastFailures'])assert.deepEqual(metrics[key],[],scene+':'+key);}}
async function authorizeLegacy(page,width){
 const entry=phase==='before'?'#openLegacy':'#recoverLegacy';
 if(phase==='before')await page.locator('#timelineBackups > summary').click();
 await page.locator(entry).focus();await page.keyboard.press('Enter');await page.locator('#importDialog').waitFor({state:'visible'});
 assert.equal(await page.locator('#legacyImport').isDisabled(),true);
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#legacyBackup').click()]);const backup=JSON.parse(await fs.readFile(await download.path(),'utf8'));assert.deepEqual(backup.docs[0].data,documentFixture);assert.equal(backup.raw[0].value,legacyValues.caeyeon_life_doc_unreadable);
 assert.equal(await page.locator('#legacyImport').isDisabled(),true);await page.locator('#legacyOwnership').check();assert.equal(await page.locator('#legacyImport').isEnabled(),true);
}
async function main(){
 await fs.mkdir(out,{recursive:true});const browser=await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const report={createdAt:new Date().toISOString(),phase,browser:browser.version(),scope:'Real platform model/store and workspace DOM; anonymous Auth request returns simulated HTTP Responses. No live credentials/production calls.',checks:[],screens:[],consoleErrors:[],pageErrors:[],external:[],productionWrites:0};
 async function run(name,width,options,fn){const context=await contextFor(browser,report,width,options),page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.pageErrors.push({name,error:e.message}));page.on('console',msg=>{if(msg.type()==='error')report.consoleErrors.push({name,text:msg.text()});});try{await ready(page);const detail=await fn(page);report.checks.push({name,width,pass:true,...detail});console.log('PASS '+name);}catch(error){report.checks.push({name,width,pass:false,error:error.stack});console.error(error.stack);annotation(error);await page.screenshot({path:path.join(out,'failure-'+name+'.png'),fullPage:true}).catch(()=>{});}finally{await context.close();}}
 try{
  for(const width of(phase==='before'?[390]:[390,820,1440]))await run('legacy-recovery-'+width,width,{failOnPosts:width===390?[phase==='before'?1:2]:[]},async page=>{
   const starting=await state(page);assert.deepEqual(starting.legacy,legacyValues);assert.equal(starting.docs.length,0);
   if(phase==='after'){await page.locator('#timelineRecovery').waitFor({state:'visible'});assert.equal(await page.locator('#recoverLegacy').isVisible(),true);assert.equal(await page.locator('#recoverBackup').isVisible(),true);assert.match(await page.locator('#recoverySummary').textContent(),/연표 2개.*사본/);}
   await capture(page,report,'recovery-found',width);await authorizeLegacy(page,width);
   if(width!==390){await page.keyboard.press('Escape');assert.equal(await page.locator('#importDialog').isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement?.id),'recoverLegacy');assert.deepEqual((await state(page)).legacy,legacyValues);assert.equal((await state(page)).docs.length,0);return{keyboardEntryAndEscape:true,backupBeforeImport:true};}
   await page.locator('#legacyImport').click();await page.waitForFunction(expected=>document.getElementById('legacyMessage').textContent.includes(expected)&&!document.getElementById('legacyImport').disabled,phase==='before'?'HTTP 500':'서버에 저장하지 못했습니다');
   const failed=await state(page);assert.equal(failed.docs.length,phase==='before'?1:2);assert.deepEqual(failed.docs[0].data,documentFixture);assert.deepEqual(failed.legacy,legacyValues);assert.equal(failed.requests.filter(r=>r.method==='POST').length,phase==='before'?1:2);assert.equal(failed.rows.length,phase==='before'?0:1);await capture(page,report,'recovery-upload-failed',width);
   await page.locator('#legacyImport').click();
   if(phase==='before'){await page.waitForFunction(()=>document.getElementById('legacyMessage').textContent.includes('이미 사본'));const after=await state(page);assert.equal(after.requests.filter(r=>r.method==='POST').length,1);assert.equal(after.docs.length,1);assert.equal(after.rows.length,0);assert.deepEqual(after.legacy,legacyValues);await capture(page,report,'retry-stuck',width);return{confirmedAppDefect:'Retry stops at already-connected message without re-upload',postAttempts:1,localCopies:1};}
   await page.locator('#importDialog').waitFor({state:'hidden'});const after=await state(page),posts=after.requests.filter(r=>r.method==='POST');assert.equal(posts.length,3);assert.notDeepEqual(posts[0].ids,posts[1].ids);assert.deepEqual(posts[1].ids,posts[2].ids);assert.equal(after.docs.length,2);assert.deepEqual(after.docs.map(r=>r.id),failed.docs.map(r=>r.id));assert.equal(after.rows.length,2);assert.deepEqual(after.rows[0].data,documentFixture);assert.deepEqual(after.rows[1].data,secondFixture);assert(after.registry.docs.every(r=>r.updated===r.syncedAt));assert.deepEqual(after.legacy,legacyValues);assert.equal(await page.locator('#documentList .document-title').count(),2);
   // Reopening is a UI retry, not another import. A synchronized copy must not be duplicated.
   await page.locator('#recoverLegacy').click();await page.locator('#legacyBackup').click();await page.locator('#legacyOwnership').check();await page.locator('#legacyImport').click();await page.waitForFunction(()=>document.getElementById('importDialog').open===false||document.getElementById('legacyMessage').textContent.includes('이미'));
   const repeated=await state(page);assert.equal(repeated.docs.length,2);assert.equal(repeated.requests.filter(r=>r.method==='POST').length,3);assert.deepEqual(repeated.legacy,legacyValues);return{sameIdRetry:true,partialUploadRetry:true,localCopies:2,simulatedPostAttempts:3,originalBytesUnchanged:true};
  });
  if(phase==='after'){
   await run('no-legacy-backup-entry',390,{legacy:false},async page=>{
    assert.equal(await page.locator('#recoverLegacy').isVisible(),false);assert.equal(await page.locator('#recoverBackup').isVisible(),true);assert.match(await page.locator('#recoverySummary').textContent(),/현재 계정.*예전 기기·서버.*별도로/);await capture(page,report,'recovery-no-local',390);
    const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#recoverBackup').click()]);await chooser.setFiles({name:'anonymous-timeline-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'haedo-backup-v1',docs:[{id:'file-source',data:documentFixture}]}))});
    await page.waitForFunction(()=>HaedoPlatformData.registry(localStorage,HaedoAuth.user.id).docs.some(r=>r.updated===r.syncedAt));const value=await state(page);assert.equal(value.docs.length,1);assert.deepEqual(value.docs[0].data,documentFixture);assert.deepEqual(value.legacy,{});assert.equal(value.rows.length,1);return{actualFileChooserAndImport:true};
   });
   await run('late-upload-account-change',390,{},async page=>{
    await authorizeLegacy(page,390);await page.evaluate(()=>{__recoveryMock.holdNextWrite=true});await page.locator('#legacyImport').click();await page.waitForFunction(()=>__recoveryMock.writeEntered===true);
    const before=await state(page);assert.equal(before.docs.length,2);assert.equal(before.requests.filter(r=>r.method==='POST').length,1);
    await page.evaluate(account=>{HaedoAuth.user={id:account.id};HaedoAuth.epoch++;HaedoPlatformStore.init(account.id);__recoveryMock.releaseWrite();},accounts.b);
    await page.waitForFunction(()=>__recoveryMock.rows.length===1);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const after=await state(page);assert.equal(after.docs.length,0);assert.deepEqual(after.legacy,legacyValues);assert.equal(after.requests.filter(r=>r.method==='POST').length,1);assert.equal(after.requests.filter(r=>r.owner!==accounts.a.id).length,0);
    assert.equal(await page.locator('#importDialog').isVisible(),true);assert.doesNotMatch(await page.locator('#platformToast').textContent(),/연결했습니다/);return{latePreviousAccountSuccessSuppressed:true,newAccountCopies:0,originalBytesUnchanged:true};
   });
   const remote=[{id:'d_remote_fixture',name:'다른 기기에서 보관한 익명 연표',data:documentFixture,updated_at:'2026-10-08T12:00:00.000Z'}];
   await run('remote-list-preserved',820,{legacy:false,remote},async page=>{
    const link=page.locator('#documentList .document-title');assert.equal(await link.count(),1);assert.match(await link.textContent(),/다른 기기에서 보관한 익명 연표/);assert.equal(await link.getAttribute('href'),'timeline.html?doc=d_remote_fixture');const value=await state(page);assert.deepEqual(value.docs[0].data,documentFixture);assert.equal(value.requests.filter(r=>r.method!=='GET').length,0);assert.equal(await page.locator('#recoverLegacy').isVisible(),false);assert.equal(await page.locator('#timelineRecovery').isVisible(),false);await capture(page,report,'recovery-remote-loaded',820);await page.locator('#timelineBackups > summary').click();const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#importFile').click()]);assert(chooser);return{remoteDocumentUnchanged:true,backupThroughExistingManagement:true};
   });
  }
 }finally{await browser.close();report.finishedAt=new Date().toISOString();report.pass=report.checks.every(c=>c.pass)&&!report.consoleErrors.length&&!report.pageErrors.length&&!report.external.length;const text=JSON.stringify(report,null,2);await fs.writeFile(path.join(out,'report.json'),text);await fs.writeFile(path.join(out,'run-'+report.createdAt.replace(/[:.]/g,'-')+'.json'),text);console.log(JSON.stringify({phase,checks:report.checks.length,passed:report.checks.filter(c=>c.pass).length,screens:report.screens.length,consoleErrors:report.consoleErrors.length,pageErrors:report.pageErrors.length,report:path.join(out,'report.json')}));if(!report.pass)process.exitCode=1;}
}
if(require.main===module)main().catch(error=>{console.error(error.stack);annotation(error);process.exitCode=1});

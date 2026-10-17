/* Current-workspace storage scope. Real app/SDK/IDB, synthetic Auth/remote only. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, nav, observe } = require('./unified-home-browser.cjs');
const { fixture, current, seedComposition } = require('./life-workbench-browser.cjs');
const { inspectHome } = require('./home-entry-browser.cjs');
const { button, enable, waitSyncState } = require('./life-management-browser.cjs');
const out = path.resolve('.local/management-clarity');
const report = { createdAt: new Date().toISOString(), scope: 'Actual SDK/IndexedDB with intercepted anonymous Auth; Chromium widths, not Apple devices', checks: [], visual: [], consoleErrors: [], pageErrors: [], expectedErrors: 0 };
async function instrument(context) {
  await context.route(`${base}/assets/life/sync.js`, async route => {
    const response = await route.fetch(), source = await response.text();
    const hook = `\n;(()=>{const original=HaedoLife.Sync;HaedoLife.Sync=Object.freeze({...original,create(...args){const actual=original.create(...args);return Object.freeze({...actual,async getState(id){if(window.__managementFailState)throw new Error('익명 검사: 연결 상태 읽기 실패');const result=await actual.getState(id);if(window.__managementHoldId===id){window.__managementHeld=true;await new Promise(resolve=>{(window.__managementRelease||=[]).push(resolve);});}return result;}});}});})();`;
    await route.fulfill({ response, body: source + hook });
  });
}
async function manage(page) { await nav(page, 'manage'); await page.locator('#lifeCurrentWorkspace').waitFor(); }
async function status(page, key) { await page.waitForFunction(key => document.querySelector('#lifeManagementSyncStatus')?.dataset.syncState === key, key); }
async function capture(page, scene, width) {
  await page.evaluate(async () => { await document.fonts.ready; document.activeElement?.blur(); scrollTo({top:0,behavior:'instant'}); }); await page.mouse.move(0,0);
  const metrics = await page.evaluate(inspectHome, '#lifeApp');
  const file = `${scene}-${width}.png`; await page.screenshot({path:path.join(out,file),fullPage:true});
  report.visual.push({scene,width,file,...metrics});
  assert.equal(metrics.horizontalOverflow,false); assert.deepEqual(metrics.overflow,[]); assert.deepEqual(metrics.smallTargets,[]); assert.deepEqual(metrics.unnamed,[]); assert.deepEqual(metrics.contrastFailures,[]);
}
async function fileFrom(page, control) {
  const download = page.waitForEvent('download'); await control.click(); const saved = await download;
  return JSON.parse(await fs.readFile(await saved.path(),'utf8'));
}
async function main() {
  await fs.mkdir(out,{recursive:true});
  const browser=await playwright().chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']}); report.browser=browser.version();
  async function check(name, run, width=820) {
    const server=new FakeCloud(), context=await makeContext(browser,server,'clarity-'+report.checks.length,accounts.a,{viewport:{width,height:width===390?844:1000},hasTouch:width<=820});
    await instrument(context); const page=await context.newPage(); observe(page,report,name); page.setDefaultTimeout(12000);
    try {await run({page,server});report.checks.push({name,pass:true});console.log('PASS '+name);}
    catch(error){report.checks.push({name,pass:false,error:error.stack});console.error('FAIL '+name+'\n'+error.stack);await page.screenshot({path:path.join(out,'failure-'+report.checks.length+'.png'),fullPage:true}).catch(()=>{});}
    finally {await context.close();}
  }
  try {
    for(const width of [1440,820,390]) await check('empty, populated and explicit backup scopes '+width,async({page,server})=>{
      await page.goto(base+'/index.html');await ready(page);await manage(page);await status(page,'unbound');
      assert.match(await page.locator('#lifeCurrentWorkspace').innerText(),/이 브라우저/);
      await capture(page,'empty',width);
      await page.evaluate(async()=>{const s=HaedoLife.Shell.storage,b=await s.createWorkspace('다시 읽을 글과 산책하며 남긴 생각을 출처와 함께 모아 두고 천천히 연결해 보는 나의 작업공간');await s.setActive(b.workspaceId);});
      const f=await fixture(page,{many:true});await seedComposition(page,f.refs);await manage(page);await status(page,'unbound');
      const before=await current(page);
      assert.match(await page.locator('#lifeManagementSyncStatus').innerText(),/원문·발췌/);
      await capture(page,'manage',width);
      await page.getByRole('button',{name:'자료 관리',exact:true}).focus();await page.keyboard.press('Enter');
      assert.equal(await page.locator('#lifeWorkspace').inputValue(),before.bundle.workspaceId);
      await button(page,'자료 관리 닫기');
      const integrated=page.getByRole('button',{name:'자료·구성 백업',exact:true});
      if(width===1440){await integrated.focus();await page.keyboard.press('Enter');}else await integrated.tap();
      await page.locator('#wbBackupScope summary').click();
      assert.match(await page.locator('#wbBackupScope').innerText(),/글쓰기·가져오기 초안/);assert.match(await page.locator('#wbBackupScope').innerText(),/이미 게시한 사본/);
      await capture(page,'combined-scope',width);
      const combined=await fileFrom(page,page.locator('#wbBackupDownload'));
      assert.deepEqual(combined.workbench,before.workbench);
      await page.locator('[data-subview-return]').click();await settle(page);
      await button(page,'내보내기·사본 복원');await page.locator('#lifeTransferScope summary').click();
      assert.match(await page.locator('#lifeTransferScope').innerText(),/묶음·내 페이지·회고·책/);
      await capture(page,'source-scope',width);
      const source=await fileFrom(page,page.getByRole('button',{name:'JSON 백업',exact:true}));
      assert.equal('workbench' in source,false);
      assert.deepEqual(await current(page),before);assert.equal(server.writes().length,0);
    },width);
    await check('live sync summary preserves focus, reports pause and permits recovery after read error',async({page})=>{
      await page.goto(base+'/index.html');await ready(page);await manage(page);await status(page,'unbound');
      await button(page,'기기 간 동기화');await enable(page);await manage(page);await status(page,'synced');
      const control=page.getByRole('button',{name:'기기 간 동기화',exact:true});await control.focus();
      await page.evaluate(async()=>{const s=HaedoLife.Shell;await s.sync.pause(await s.storage.getActive());});await status(page,'paused');
      assert.equal(await control.evaluate(el=>el===document.activeElement),true);
      await page.evaluate(()=>{window.__managementFailState=true;});await nav(page,'tools');await manage(page);await status(page,'read_error');await capture(page,'read-error',390);
      await button(page,'기기 간 동기화');await page.getByRole('button',{name:'동기화 상태 다시 확인',exact:true}).waitFor();
      await page.evaluate(()=>{window.__managementFailState=false;});await button(page,'동기화 상태 다시 확인');await page.locator('#lifeSyncState[data-sync-state=paused]').waitFor();
      await manage(page);await status(page,'paused');
    },390);
    await check('switching workspaces never labels an unbound copy with a previous server state',async({page,server})=>{
      await page.goto(base+'/index.html');await ready(page);await manage(page);await button(page,'기기 간 동기화');await enable(page);
      const ids=await page.evaluate(async()=>{const s=HaedoLife.Shell.storage,a=await s.getActive(),b=await s.createWorkspace('연결하지 않은 두 번째 공간'),c=await s.createWorkspace('나중에 고른 세 번째 공간');await s.setActive(a);window.__managementHoldId=b.workspaceId;return {a,b:b.workspaceId,c:c.workspaceId};});
      await page.reload();await ready(page);await page.evaluate(id=>{window.__managementHoldId=id;},ids.b);
      await manage(page);await status(page,'synced');await button(page,'자료 관리');await page.locator('#lifeWorkspace').selectOption(ids.b);await settle(page);await manage(page);
      await page.waitForFunction(()=>window.__managementHeld);await status(page,'loading');await capture(page,'loading',820);
      await button(page,'자료 관리');await page.locator('#lifeWorkspace').selectOption(ids.c);await settle(page);await manage(page);await status(page,'unbound');
      await page.evaluate(()=>{window.__managementHoldId=null;window.__managementRelease.splice(0).forEach(release=>release());});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await status(page,'unbound');
      assert.equal((await current(page)).bundle.workspaceId,ids.c);assert.equal(server.rows.size,1);
    });
    assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.pageErrors,[]);
  }finally{await browser.close();await fs.writeFile(path.join(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({passed:report.checks.filter(c=>c.pass).length,total:report.checks.length,visual:report.visual.length,console:report.consoleErrors.length,page:report.pageErrors.length}));
  if(report.checks.some(c=>!c.pass)||report.consoleErrors.length||report.pageErrors.length)process.exitCode=1;
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});

/* Actual editors and IDB with controllable sync status; no production account or requests. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { playwright, ready, makeContext } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, base, cloud } = require('./life-sync-browser.cjs');
const out = path.resolve('.local/account-save-status');
async function main() {
  await fs.mkdir(out, { recursive: true });
  const report = { checks: [], errors: [], consoleErrors: [], external: [], scope: 'Real local UI and IndexedDB, anonymous fake Auth and controllable account acknowledgement; no production writes.' };
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const context = await makeContext(browser, new FakeCloud(), 'account-save-status', accounts.a, { viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback(); report.external.push(u.origin); return route.abort(); });
  const sourceRoot = process.env.SAVE_STATUS_SOURCE_ROOT || '.';
  const source = await fs.readFile(path.join(sourceRoot, 'assets/life/workbench-ui.js'), 'utf8');
  if (process.env.SAVE_STATUS_SOURCE_ROOT) await context.route(base + '/assets/life/nine-board-ui.js', route => route.fulfill({ path: path.join(sourceRoot, 'assets/life/nine-board-ui.js'), contentType: 'application/javascript' }));
  await context.route(base + '/assets/life/workbench-ui.js', route => route.fulfill({ contentType: 'application/javascript', body: source + `
  {const original=HaedoLife.WorkbenchUI;HaedoLife.WorkbenchUI={...original,create(options){
    const managers={};for(const domain of ['composition','library']){
      const listeners=new Set();let phase='pending',held=null,failRead=false;
      managers[domain]={
        getState:async id=>{if(failRead)throw Error('status unavailable');const saved=domain==='composition'?await options.storage.readWorkbench(id):(await options.storage.readLibraryMetaSnapshot(id)).metadata;
          const result={workspaceId:id,binding:{...options.storage.account,remoteId:id},enabled:true,status:phase==='error'?'error':phase==='pending'?'pending':'synced',remoteRevision:1,syncedLocalRevision:saved.revision-(phase==='stale'?1:0),outbox:null,error:phase==='error'?{code:'network_error'}:null,conflict:null};
          if(held){const release=held;held=null;await new Promise(resolve=>window[release]=resolve);}return result;},
        subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},syncNow:async()=>{phase='synced';for(const fn of listeners)fn({});},
        set:value=>{phase=value;for(const fn of listeners)fn({});},hold:key=>held=key,fail:value=>{failRead=value;for(const fn of listeners)fn({});}
      };
    }window.testSync=managers;
    return original.create({...options,compositionSync:managers.composition,libraryMetaSync:managers.library});
  }};}
  ` }));
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', e => report.errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(m.text()); });
  const check = async (name, fn) => { await fn(); report.checks.push(name); console.log('PASS ' + name); };
  const expect = async (selector, text) => { await page.waitForFunction(([selector, text]) => document.querySelector(selector)?.textContent === text, [selector, text]); };
  const set = (domain, phase) => page.evaluate(([domain, phase]) => testSync[domain].set(phase), [domain, phase]);
  try {
    await page.goto(base + '/index.html?section=records&view=page'); await ready(page); await page.locator('#wbPageNine').waitFor();
    await check('Workbench shows pending, exact ACK, stale ACK and retry without changing saved inputs', async () => {
      await expect('#wbStatus', '저장됨 · 계정에 올리기 대기');
      await set('composition', 'synced'); await expect('#wbStatus', '저장됨 · 계정에 올림');
      await set('composition', 'stale'); await expect('#wbStatus', '저장됨 · 계정에 올리기 대기');
      await set('composition', 'error'); await expect('#wbStatus', '저장됨 · 계정에 올리지 못함 · 다시 시도');
      await page.locator('#wbSyncRetry').click(); await expect('#wbStatus', '저장됨 · 계정에 올림');
      await page.evaluate(()=>testSync.composition.fail(true)); await expect('#wbStatus', '저장됨 · 계정에 올리지 못함 · 다시 시도');
      await page.evaluate(()=>testSync.composition.fail(false)); await expect('#wbStatus', '저장됨 · 계정에 올림');
    });
    await page.locator('#wbPageNine').click(); await page.getByRole('button', { name: '새 9칸 구성', exact: true }).click();
    await page.locator('#nbTitle').fill('계정 저장 상태를 확인하는 구성'); await page.waitForFunction(()=>document.querySelector('.nb-status')?.dataset.state==='saved');
    await check('Nine board uses its library metadata ACK independently from composition, and retry preserves the editor DOM', async () => {
      await expect('.nb-status', '저장됨 · 계정에 올리기 대기');
      assert(await page.locator('.wb-storage-line').isHidden(), 'page composition receipt is not the nine-board receipt');
      await page.locator('#nbTitle').evaluate(e=>window.savedTitle=e);
      await set('composition','synced'); await expect('.nb-status','저장됨 · 계정에 올리기 대기');
      await set('library','synced'); await expect('.nb-status','저장됨 · 계정에 올림');
      await set('library','stale'); await expect('.nb-status','저장됨 · 계정에 올리기 대기');
      await set('library','error'); await expect('.nb-status','저장됨 · 계정에 올리지 못함 · 다시 시도');
      await page.locator('.nb-sync-retry').click(); await expect('.nb-status','저장됨 · 계정에 올림');
      assert(await page.locator('#nbTitle').evaluate(e=>e===window.savedTitle));
    });
    await check('A late success cannot replace a later failure, and IME input survives sync-only refreshes', async () => {
      await page.evaluate(()=>{testSync.library.hold('releaseOldAck');testSync.library.set('synced');});
      await page.waitForFunction(()=>!!window.releaseOldAck);await set('library','error');await expect('.nb-status','저장됨 · 계정에 올리지 못함 · 다시 시도');
      await page.evaluate(()=>releaseOldAck());await expect('.nb-status','저장됨 · 계정에 올리지 못함 · 다시 시도');
      await page.locator('#nbTitle').dispatchEvent('compositionstart');await page.locator('#nbTitle').fill('한글 조합 중 새 입력');
      await set('library','synced');await expect('.nb-status','저장 전 변경 있음');
      assert(await page.locator('#nbTitle').evaluate(e=>e===window.savedTitle));assert.equal(await page.locator('#nbTitle').inputValue(),'한글 조합 중 새 입력');
      await page.locator('#nbTitle').dispatchEvent('compositionend');await page.waitForFunction(()=>document.querySelector('.nb-status')?.dataset.state==='saved');
      await set('library','synced');await expect('.nb-status','저장됨 · 계정에 올림');
    });
    for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await set('library','error'); await expect('.nb-status','저장됨 · 계정에 올리지 못함 · 다시 시도'); await page.screenshot({path:path.join(out,`status-${width}.png`),fullPage:true}); assert(await page.locator('.nb-sync-retry').isVisible()); assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)); }
    await check('Leaving the nine-board editor ignores its late status response and restores the page composition status', async () => {
      await page.evaluate(()=>{testSync.library.hold('releaseDetached');testSync.library.set('synced');});
      await page.waitForFunction(()=>!!window.releaseDetached);
      await page.getByRole('button',{name:'내 페이지로 돌아가기',exact:true}).click();
      await page.locator('#wbPageNine').waitFor();
      await page.evaluate(()=>releaseDetached());
      assert.equal(await page.locator('.nb-status').count(),0);
      await expect('#wbStatus','저장됨 · 계정에 올림');
      assert(await page.locator('.wb-storage-line').isVisible());
    });
    await check('A mixed cached workbench without the status helper still opens and edits the nine-board view', async () => {
      await page.evaluate(()=>{const current=HaedoLife.WorkbenchUI;window.restoreStatusHelper=current;HaedoLife.WorkbenchUI={...current,savedPresentation:undefined};});
      await page.locator('#wbPageNine').click();
      await page.locator('#nbTitle').waitFor();
      await expect('.nb-status','저장됨 · 계정에 올리기 대기');
      await page.locator('#nbTitle').fill('혼합 캐시에서도 보존한 입력');
      await page.waitForFunction(()=>document.querySelector('.nb-status')?.dataset.state==='saved');
      assert.equal(await page.locator('#nbTitle').inputValue(),'혼합 캐시에서도 보존한 입력');
      await page.evaluate(()=>HaedoLife.WorkbenchUI=restoreStatusHelper);
    });
    await check('A competing composition reload preserves a preparation IME input, then saves it before reloading', async () => {
      await page.getByRole('button',{name:'내 페이지로 돌아가기',exact:true}).click();
      await page.evaluate(async()=>{const s=HaedoLife.Shell.storage,M=HaedoLife.MaterialWriting,C=HaedoLife.Core,ws=await s.getActive(),state=await s.readMaterialWriting(ws),plan=M.create(C.id);plan.title='자료 준비';plan.question='기존 질문';state.plans.push(plan);await s.saveMaterialWriting(ws,state,state.revision);window.testPreparationId=plan.id;});
      await page.locator('#wbPageMaterialWriting').click();await page.locator('#mwQuestion').waitFor();
      await page.locator('#mwQuestion').dispatchEvent('compositionstart');await page.locator('#mwQuestion').fill('조합중 미완성 새 질문');
      await page.locator('#mwQuestion').evaluate(e=>{window.preparationInput=e;e.setSelectionRange(2,5);});
      await page.evaluate(async()=>{const s=HaedoLife.Shell.storage,ws=await s.getActive(),state=await s.readWorkbench(ws);state.page.intro='다른 탭에서 바꾼 구성';await s.saveWorkbench(ws,state,state.revision);});
      await page.locator('#wbReloadSaved').click();await page.locator('#wbError').waitFor({state:'visible'});
      assert(await page.locator('#mwQuestion').evaluate(e=>e===window.preparationInput));
      assert.equal(await page.locator('#mwQuestion').inputValue(),'조합중 미완성 새 질문');
      assert.deepEqual(await page.locator('#mwQuestion').evaluate(e=>[e.selectionStart,e.selectionEnd]),[2,5]);
      await page.locator('#mwQuestion').dispatchEvent('compositionend');
      await page.locator('#wbReloadSaved').click();await page.locator('#wbReloadSaved').waitFor({state:'detached'});
      await page.locator('#mwQuestion').waitFor();assert.equal(await page.locator('#mwQuestion').inputValue(),'조합중 미완성 새 질문');
      assert.equal(await page.evaluate(async()=>{const s=HaedoLife.Shell.storage,v=await s.readMaterialWriting(await s.getActive());return v.plans.find(p=>p.id===testPreparationId).question;}),'조합중 미완성 새 질문');
    });
    assert.deepEqual(report.errors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.external, []);
  } finally { await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); await browser.close(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});

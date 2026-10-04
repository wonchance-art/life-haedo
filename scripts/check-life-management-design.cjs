/* Isolated management visual audit. No production server or real account.
 * BASE_URL=http://127.0.0.1:4175 MANAGEMENT_PHASE=before node scripts/check-life-management-design.cjs
 * MANAGEMENT_PHASE=after node scripts/check-life-management-design.cjs
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud } = require('../tests/life-sync-browser.cjs');
const { playwright, makeContext, observe, settle } = require('../tests/unified-home-browser.cjs');
const { fixture, transfer, syncing, choose, bundle, enable, conflict, button, waitSyncState } = require('../tests/life-management-browser.cjs');
const { inspect } = require('./check-site-design.cjs');
const phase = process.env.MANAGEMENT_PHASE || 'after'; assert(['before','after'].includes(phase));
const selectedScenes = new Set((process.env.MANAGEMENT_SCENES || '').split(',').filter(Boolean));
const root = path.resolve(__dirname, '..'), out = path.join(root, '.local/life-management', phase, 'visual');
const evidence = path.join(root, 'docs/design-review/evidence/life-management');
const sizes = [{ name:'desktop', width:1440, height:1000 }, { name:'tablet', width:820, height:1000 }, { name:'phone', width:390, height:844 }];
const representatives = new Set(['transfer-desktop','restore-preview-desktop','restore-preview-phone','restore-invalid-phone','restore-complete-phone','sync-unbound-desktop','sync-unbound-phone','sync-pending-tablet','sync-details-phone','sync-paused-phone','sync-error-phone','sync-conflict-desktop','sync-conflict-open-tablet']);
async function main() {
  await fs.mkdir(out, { recursive:true });
  const browser = await playwright().chromium.launch({ executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless:true, args:['--no-sandbox'] });
  const report = { phase, capturedAt:new Date().toISOString(), browser:browser.version(),
    environment:'Linux Chromium viewport and touch simulation; no actual Google/Supabase, Apple hardware, IME, Files or VoiceOver',
    fixture:'Existing six-source/twelve-excerpt collections sample plus one URL-only material and one newer original version: 7 sources, 8 versions, 12 excerpts',
    checks:[], captures:[], errors:[], consoleErrors:[], pageErrors:[], expectedErrors:0, realRemoteWrites:0 };
  const check = (name, pass, detail) => report.checks.push({ name, pass, ...(detail === undefined ? {} : { detail }) });
  async function capture(page, scene, size) {
    if (selectedScenes.size && !selectedScenes.has(scene)) return;
    if (scene==='restore-preview') await page.locator('#lifeRestoreFile').evaluate(el=>{el.closest('section').scrollIntoView({block:'start',behavior:'instant'});scrollBy({top:-24,behavior:'instant'});});
    if (scene.startsWith('sync-conflict')) await page.locator('#lifeSyncConflict').evaluate(el=>{el.scrollIntoView({block:'start',behavior:'instant'});scrollBy({top:-24,behavior:'instant'});});
    await page.evaluate(async () => { await document.fonts.ready; document.activeElement.blur(); for (const animation of document.getAnimations()) if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish(); });
    await page.mouse.move(0,0);
    const metrics = await page.evaluate(inspect), file = `${scene}-${size.name}.png`;
    const syncState = scene.startsWith('sync-') ? await page.evaluate(async()=>{const state=await HaedoLife.Shell.sync.getState(await HaedoLife.Shell.storage.getActive());return {status:state.status,enabled:state.enabled,remoteRevision:state.remoteRevision};}) : undefined;
    await page.screenshot({ path:path.join(out,file) }); report.captures.push({ scene, size, file, ...metrics, ...(syncState ? { syncState } : {}) });
    for (const [name, pass, detail] of [['no horizontal overflow',!metrics.horizontalOverflow],['text contrast',!metrics.contrastFailures.length,metrics.contrastFailures],['44px targets',!metrics.smallTargets.length,metrics.smallTargets],['named controls',!metrics.unnamed.length,metrics.unnamed],['16px inputs',!metrics.smallInputs.length,metrics.smallInputs]]) check(`${size.name} ${scene}: ${name}`,pass,detail);
  }
  try {
    for (const size of sizes) {
      const server = new FakeCloud();
      async function run(name, run) {
        const device = `management-${phase}-${size.name}-${name}`, context = await makeContext(browser,server,device,accounts.a,{viewport:{width:size.width,height:size.height},hasTouch:size.width<=820});
        const page = await context.newPage(); page.setDefaultTimeout(15000); observe(page,report,`${size.name} ${name}`);
        try { await run(page,context,device); } catch(error) { report.errors.push({ scene:name,size:size.name,error:error.stack }); }
        finally { await context.close(); }
      }
      await run('restore',async page => {
        const initial = await fixture(page); await transfer(page); await capture(page,'transfer',size);
        await choose(page,initial.backup); await capture(page,'restore-preview',size);
        await choose(page,'{invalid','읽을-수-없는-백업.json'); await capture(page,'restore-invalid',size);
        await choose(page,initial.backup); await button(page,'새 사본으로 복원'); await capture(page,'restore-complete',size);
        assert.notEqual((await bundle(page)).workspaceId,initial.original.workspaceId);
        assert.equal(server.writes().length,0);
      });
      await run('sync',async (page,context,device) => {
        const initial = await fixture(page); await syncing(page); await capture(page,'sync-unbound',size);
        let release; const gate = new Promise(resolve=>{release=resolve;});
        await context.route(`${cloud}/rest/v1/rpc/life_sync_put`,async route=>{await gate;return route.fallback();});
        try {
          await page.getByRole('button',{name:'이 작업공간 동기화 시작',exact:true}).click();
          await waitSyncState(page,state=>!!state?.outbox,{storage:true});
          await capture(page,'sync-pending',size);
        } finally { release(); }
        await settle(page); await context.unroute(`${cloud}/rest/v1/rpc/life_sync_put`);
        await waitSyncState(page,state=>state?.status==='synced');
        await capture(page,'sync-connected',size);
        if (await page.locator('#lifeSyncDetails').count()) {
          const summary=page.locator('#lifeSyncDetails > summary'); await summary.focus(); await page.keyboard.press('Enter');
          const focus=(await page.evaluate(inspect)).focus; check(size.name+' sync details keyboard focus',focus.visible && focus.width>=3 && focus.contrast>=3,focus);
        }
        await capture(page,'sync-details',size);
        if (await page.locator('#lifeSyncDetails[open]').count()) await page.locator('#lifeSyncDetails > summary').click();
        await button(page,'연결 중지'); await capture(page,'sync-paused',size);
        await enable(page); server.offline.add(device); page.expectedAuthFailure=true;
        await button(page,'지금 동기화'); await capture(page,'sync-error',size); server.offline.delete(device);
        await button(page,'지금 동기화'); page.expectedAuthFailure=false;
        await conflict(page,server); await button(page,'양쪽 변경 비교'); await capture(page,'sync-conflict',size);
        for (const section of await page.locator('#lifeSyncConflict .life-conflict-grid > section').all()) await section.locator('.life-conflict-text > summary').first().click();
        await capture(page,'sync-conflict-open',size);
        assert.deepEqual(await bundle(page),initial.original);
      });
    }
    check('no unexpected console errors',!report.consoleErrors.length,report.consoleErrors); check('no page errors',!report.pageErrors.length,report.pageErrors);
  } finally { await browser.close(); await fs.writeFile(path.join(out,selectedScenes.size?'detail-report.json':'report.json'),JSON.stringify(report,null,2)+'\n'); }
  if (phase==='after') {
    await fs.mkdir(evidence,{recursive:true});
    for (const entry of report.captures) if (representatives.has(entry.file.replace('.png',''))) {
      await fs.copyFile(path.join(out,entry.file),path.join(evidence,'after-'+entry.file));
      try { await fs.copyFile(path.join(root,'.local/life-management/before/visual',entry.file),path.join(evidence,'before-'+entry.file)); } catch(error) { if(error.code!=='ENOENT') throw error; }
    }
  }
  const failed=report.checks.filter(check=>!check.pass);
  console.log(JSON.stringify({phase,passed:report.checks.length-failed.length,failed,errors:report.errors,captures:report.captures.length,expectedErrors:report.expectedErrors,report:path.relative(root,path.join(out,selectedScenes.size?'detail-report.json':'report.json'))},null,2));
  if(report.errors.length || (phase==='after' && failed.length)) process.exitCode=1;
}
if(require.main===module) main().catch(error=>{console.error(error.stack);process.exitCode=1;});

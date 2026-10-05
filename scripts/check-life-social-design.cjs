/* Social import visual audit: isolated SDK/Auth/IndexedDB and anonymous copied text.
 * BASE_URL=http://127.0.0.1:4176 SOCIAL_PHASE=before node scripts/check-life-social-design.cjs
 * SOCIAL_PHASE=after node scripts/check-life-social-design.cjs
 * Network access to Naver/Instagram is blocked; viewport/touch simulation is not Apple-device validation.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('../tests/life-sync-browser.cjs');
const { playwright, makeContext, observe, ready, settle } = require('../tests/unified-home-browser.cjs');
const { inspect } = require('./check-site-design.cjs');
const phase = process.env.SOCIAL_PHASE || 'after'; assert(['before', 'after'].includes(phase));
const selected = new Set((process.env.SOCIAL_SCENES || '').split(',').filter(Boolean));
const root = path.resolve(__dirname, '..'), out = path.join(root, '.local/life-social', phase, 'visual');
const evidence = path.join(root, 'docs/design-review/evidence/social-import');
const sizes = [{ name:'desktop', width:1440, height:1000 }, { name:'tablet', width:820, height:1000 }, { name:'phone', width:390, height:844 }];
const title = '동네 도서관에서 다시 읽은 한 문장을 산책 메모와 연결하며 출처와 사진의 맥락까지 잊지 않으려고 남겨 둔 긴 기록';
const text = '퇴근길에 작은 도서관에 들렀다. 지난주 블로그에서 읽은 문장을 다시 떠올렸다.\n\n“좋은 문장은 한 번 저장하고 끝내기보다, 돌아올 이유를 함께 남겨 두면 좋다.”\n\n오늘은 산책 메모와 같은 주제로 연결했다. 사진 속 표지와 댓글의 대화는 이 본문에 포함하지 않았다. 🌱\n\n#다시읽기 #산책기록';
const naver = 'https://blog.naver.com/example_haedo/223000000000?example_note=' + 'anonymous-reading-context-'.repeat(5);
const instagram = 'https://www.instagram.com/p/EXAMPLE_HAEDO/?example_note=' + 'anonymous-reading-context-'.repeat(5);
const representatives = new Set(['partial-desktop','partial-tablet','partial-phone','scope-phone','link-phone','review-desktop','review-phone','review-details-phone','invalid-phone']);
async function click(page, name) { await page.getByRole('button', { name, exact:true }).click(); await settle(page); }
async function top(page) { await page.evaluate(() => scrollTo({ top:0, behavior:'instant' })); }
async function main() {
  await fs.mkdir(out, { recursive:true });
  const browser = await playwright().chromium.launch({ executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless:true, args:['--no-sandbox'] });
  const report = { phase, capturedAt:new Date().toISOString(), browser:browser.version(),
    environment:'Linux Chromium viewport and touch simulation; no actual Apple hardware, IME, Files, VoiceOver, Google or production Supabase',
    fixture:'One anonymous Korean passage and long title, Naver/Instagram example addresses, explicit partial text and link-only variations; no real social platform requests',
    checks:[], captures:[], errors:[], consoleErrors:[], pageErrors:[], external:[], expectedErrors:0, realRemoteWrites:0 };
  const check = (name, pass, detail) => report.checks.push({ name, pass, ...(detail === undefined ? {} : { detail }) });
  async function capture(page, scene, size) {
    if (selected.size && !selected.has(scene)) return;
    await page.evaluate(async () => { await document.fonts.ready; document.activeElement.blur(); for(const animation of document.getAnimations()) if(Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish(); });
    await page.mouse.move(0,0);
    const metrics = await page.evaluate(inspect), file = `${scene}-${size.name}.png`;
    await page.screenshot({ path:path.join(out,file) }); report.captures.push({ scene, size, file, ...metrics });
    for(const [name, pass, detail] of [['no horizontal overflow',!metrics.horizontalOverflow],['text contrast',!metrics.contrastFailures.length,metrics.contrastFailures],['44px targets',!metrics.smallTargets.length,metrics.smallTargets],['named controls',!metrics.unnamed.length,metrics.unnamed],['16px inputs',!metrics.smallInputs.length,metrics.smallInputs]]) check(`${size.name} ${scene}: ${name}`,pass,detail);
  }
  async function coverage(page) {
    const field=page.locator('#lifeImportCoverage');
    if (!await field.isVisible()) await field.evaluate(el=>{el.closest('details').open=true;});
    await field.selectOption('partial');
  }
  try {
    for(const size of sizes) {
      const server=new FakeCloud(), context=await makeContext(browser,server,`social-visual-${phase}-${size.name}`,accounts.a,{viewport:{width:size.width,height:size.height},hasTouch:size.width<=820});
      await context.route('**/*',route=>{
        const url=new URL(route.request().url());
        if(url.origin===new URL(base).origin || url.origin===cloud || ['fonts.googleapis.com','fonts.gstatic.com','cdn.jsdelivr.net'].includes(url.hostname)) return route.fallback();
        report.external.push(url.hostname); return route.abort('blockedbyclient');
      });
      const page=await context.newPage(); page.setDefaultTimeout(15000); observe(page,report,size.name);
      try {
        await page.goto(base+'/index.html'); await ready(page); await click(page,'가져오기'); await top(page); await capture(page,'empty',size);
        await page.locator('#lifeImportTitle').fill(title); await page.locator('#lifeImportUrl').fill(naver);
        if(phase==='after') {
          const suggestion=page.locator('#lifeImportOriginSuggestion > button'); await suggestion.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
          const focus=(await page.evaluate(inspect)).focus; check(size.name+' source suggestion keyboard focus',focus.visible && focus.width>=3 && focus.contrast>=3,focus);
          await page.keyboard.press('Enter'); assert.equal(await page.locator('#lifeImportOrigin').inputValue(),'naver_blog');
        } else await page.locator('#lifeImportOrigin').selectOption('naver_blog');
        await page.locator('#lifeImportText').fill(text); await coverage(page);
        if(phase==='before') await page.locator('#lifeImportCoverage').evaluate(el=>{el.closest('details').open=false;});
        await top(page); await capture(page,'partial',size);
        await page.locator('#lifeImportCoverage').evaluate(el=>{const details=el.closest('details');if(details)details.open=true;el.scrollIntoView({block:'center',behavior:'instant'});});
        await capture(page,'scope',size);
        if(phase==='after') {
          const help=page.locator('#lifeImportWebHelp > summary'); await help.focus(); await page.keyboard.press('Enter');
          const focus=(await page.evaluate(inspect)).focus; check(size.name+' source help keyboard focus',focus.visible && focus.width>=3 && focus.contrast>=3,focus);
          await help.evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'})); await capture(page,'help',size); await help.click();
        }
        await click(page,'원문·출처 확인'); await top(page); await capture(page,'review',size);
        const sourceDetails=page.locator('.life-review > details > summary').first();
        await sourceDetails.focus(); await page.keyboard.press('Enter');
        const sourceFocus=(await page.evaluate(inspect)).focus; check(size.name+' review source keyboard focus',sourceFocus.visible && sourceFocus.width>=3 && sourceFocus.contrast>=3,sourceFocus);
        await sourceDetails.evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'})); await capture(page,'review-details',size); await sourceDetails.click();
        await click(page,'입력 수정');
        await page.locator('#lifeImportUrl').fill('javascript:example'); await click(page,'원문·출처 확인');
        await page.locator('#lifeError').scrollIntoViewIfNeeded(); await capture(page,'invalid',size);
        await page.locator('#lifeImportUrl').fill(naver);
        // The public storage API is frozen. Hold only completion of a real staging
        // put request; do not replace the persistence function or paint a fake busy state.
        await page.evaluate(()=>{
          const put=IDBObjectStore.prototype.put; let release; const gate=new Promise(resolve=>{release=resolve;});
          IDBObjectStore.prototype.put=function(...args) {
            const request=put.apply(this,args);
            if(this.name==='staging') {
              const listen=request.addEventListener.bind(request);
              request.addEventListener=(type,callback,...options)=>listen(type,type==='success'?event=>{gate.then(()=>callback.call(request,event));}:callback,...options);
            }
            return request;
          };
          globalThis.__releaseSocialSave=()=>{IDBObjectStore.prototype.put=put;release();delete globalThis.__releaseSocialSave;};
        });
        try {
          await page.getByRole('button',{name:'검토 내용 보관',exact:true}).click();
          await page.waitForFunction(()=>document.querySelector('.life-app[aria-busy="true"]'));
          await capture(page,'saving',size);
        } finally { await page.evaluate(()=>__releaseSocialSave()); }
        await settle(page);
        await click(page,'다른 기록 가져오기'); await click(page,'링크 보관');
        await page.locator('#lifeImportTitle').fill(title); await page.locator('#lifeImportUrl').fill(instagram);
        if(phase==='after') {
          const suggestion=page.locator('#lifeImportOriginSuggestion > button'); if(size.width<=820) await suggestion.tap(); else await suggestion.click();
        } else await page.locator('#lifeImportOrigin').selectOption('instagram');
        await top(page); await capture(page,'link',size);
        await click(page,'원문·출처 확인'); await top(page); await capture(page,'link-review',size);
        assert.equal(server.writes().length,0);
      } catch(error) { report.errors.push({ size:size.name,error:error.stack }); }
      finally { await context.close(); }
    }
    check('no unexpected console errors',!report.consoleErrors.length,report.consoleErrors); check('no page errors',!report.pageErrors.length,report.pageErrors); check('no social or unexpected external requests',!report.external.length,report.external);
  } finally { await browser.close(); await fs.writeFile(path.join(out,selected.size?'detail-report.json':'report.json'),JSON.stringify(report,null,2)+'\n'); }
  if(phase==='after') {
    await fs.mkdir(evidence,{recursive:true});
    for(const file of await fs.readdir(evidence)) if(/^(before|after)-.+\.png$/.test(file) && !representatives.has(file.replace(/^(before|after)-/,'').replace(/\.png$/,''))) await fs.unlink(path.join(evidence,file));
    for(const entry of report.captures) if(representatives.has(entry.file.replace('.png',''))) {
      await fs.copyFile(path.join(out,entry.file),path.join(evidence,'after-'+entry.file));
      try { await fs.copyFile(path.join(root,'.local/life-social/before/visual',entry.file),path.join(evidence,'before-'+entry.file)); } catch(error) { if(error.code!=='ENOENT') throw error; }
    }
  }
  const failed=report.checks.filter(check=>!check.pass);
  console.log(JSON.stringify({phase,passed:report.checks.length-failed.length,failed,errors:report.errors,captures:report.captures.length,report:path.relative(root,path.join(out,selected.size?'detail-report.json':'report.json'))},null,2));
  if(report.errors.length || (phase==='after' && failed.length)) process.exitCode=1;
}
if(require.main===module) main().catch(error=>{console.error(error.stack);process.exitCode=1;});

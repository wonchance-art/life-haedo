/* Run against scripts/dev-server.py. No account or personal records required. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'./browser-ci/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const F=require('../docs/prototypes/analysis-lenses/fixtures.js');
const base=process.env.BASE_URL||'http://127.0.0.1:4188';
const target=base+'/docs/prototypes/analysis-lenses/';
const out=process.env.EVIDENCE_DIR||'.local/analysis-lenses';
const {inspectHome}=require('./home-entry-browser.cjs');
(async()=>{
 await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const errors=[],requests=[],checks=[],visual=[];
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 await context.addInitScript(()=>{localStorage.setItem('haedo-preservation-sentinel','unchanged');});
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>requests.push(r.url()));page.on('dialog',d=>d.accept());
 await page.goto(target);await page.locator('.finding').first().waitFor();
 for(const width of [1440,820,390]){
   await page.setViewportSize({width,height:1000});
   for(const lens of F.lenses){await page.getByRole('tab',{name:lens.label,exact:true}).click();await page.evaluate(()=>scrollTo(0,0));
    const audit=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,small:[...document.querySelectorAll('button,select,summary')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().height<43.5).map(e=>e.textContent),headings:[...document.querySelectorAll('.finding h3')].map(e=>e.textContent)}));
    const quality=await page.evaluate(inspectHome,'#prototype');assert.deepEqual(quality.contrastFailures,[]);assert.deepEqual(quality.smallTargets,[]);assert.deepEqual(quality.unnamed,[]);audit.minTextContrast=quality.minTextContrast;assert.equal(audit.overflow,false);assert.deepEqual(audit.small,[]);await page.screenshot({path:path.join(out,`${lens.id}-${width}.png`),fullPage:true});visual.push({width,lens:lens.id,...audit});
   }
 }
 checks.push('3 lenses × 3 widths: no horizontal overflow, 44px named controls, text contrast');
 await page.setViewportSize({width:820,height:1000});await page.getByRole('tab',{name:'관심',exact:true}).click();await page.getByRole('tab',{name:'관심',exact:true}).press('ArrowRight');assert.equal(await page.getByRole('tab',{name:'질문',exact:true}).getAttribute('aria-selected'),'true');await page.getByRole('tab',{name:'질문',exact:true}).press('End');assert.equal(await page.getByRole('tab',{name:'변화',exact:true}).getAttribute('aria-selected'),'true');checks.push('keyboard tabs: ArrowRight and End');
 const first=page.locator('.finding').first();const source=first.getByRole('button',{name:/원문 확인/}).first();await source.click();assert.equal(await page.locator('#source-body mark').textContent(),F.findings[4].refs[0].text);await page.screenshot({path:path.join(out,'source-820.png')});await page.keyboard.press('Escape');assert(await source.evaluate(e=>e===document.activeElement));checks.push('exact source highlight and Escape focus return');
 await first.locator('summary').click();const input=first.locator('textarea');await first.getByRole('button',{name:'장 후보 담기'}).click();assert.match(await first.locator('.local-status').textContent(),/먼저 적어/);
 const draft='인정받고 싶은 마음은 남아 있다. 🌱\n다만 오래 궁금한 일을 함께 고르고 싶다. <img src=x onerror=alert(1)>';
 await input.fill(draft);await page.getByRole('tab',{name:'관심',exact:true}).click();await page.getByRole('tab',{name:'변화',exact:true}).click();assert.equal(await first.locator('textarea').inputValue(),draft);
 await first.getByRole('button',{name:'장 후보 담기'}).click();assert.equal(await page.locator('#count').textContent(),'1');
 await page.locator('#candidates').click();assert.equal(await page.locator('#candidate-list img').count(),0);
 for(const kind of ['json','md']){const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#download-'+kind).click()]);const saved=path.join(out,'candidate.'+kind);await download.saveAs(saved);const content=await fs.readFile(saved,'utf8');if(kind==='json'){const data=JSON.parse(content);assert.equal(data.candidates[0].userInterpretation,draft);assert.equal(data.modelUsed,null);assert.equal(data.candidates[0].evidence.at(-1).versionId,'v08');assert.equal(data.candidates[0].evidence.at(-1).role,'counter');}else{assert(content.includes(draft));assert(content.includes('v08'));}}
 await page.screenshot({path:path.join(out,'candidates-820.png')});await page.keyboard.press('Escape');checks.push('empty-note refusal, draft survives navigation, safe text rendering, JSON/Markdown exact evidence');
 await first.getByRole('button',{name:'보류',exact:true}).click();assert.equal(await page.locator('#count').textContent(),'0');await first.getByRole('button',{name:'다시 살펴보기'}).click();assert(await first.locator('textarea').evaluate(e=>e===document.activeElement));assert.equal(await first.locator('textarea').inputValue(),draft);checks.push('exclude removes candidate, restore retains interpretation');
 await page.locator('#period').selectOption('early');assert.equal(await page.locator('.finding').count(),0);await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'empty-390.png'),fullPage:true});await page.getByRole('button',{name:'전체 시기로 돌아가기'}).click();assert.equal(await first.locator('textarea').inputValue(),draft);checks.push('scope refusal and draft retention');
 // In-memory example intentionally resets on a fresh page; no persistent app storage is touched.
 const storage=await page.evaluate(async()=>({keys:Object.keys(localStorage),sentinel:localStorage.getItem('haedo-preservation-sentinel'),dbs:await indexedDB.databases(),registrations:(await navigator.serviceWorker.getRegistrations()).length}));assert.deepEqual(storage.keys,['haedo-preservation-sentinel']);assert.equal(storage.sentinel,'unchanged');assert.deepEqual(storage.dbs,[]);assert.equal(storage.registrations,0);
 await page.goto(target+'?case=error');await page.locator('.finding').first().locator('summary').click();assert(await page.locator('.finding').first().getByRole('button',{name:'장 후보 담기'}).isDisabled());await page.screenshot({path:path.join(out,'error-390.png'),fullPage:true});await page.getByRole('button',{name:'예시 다시 불러오기'}).first().click();assert.equal(await page.locator('.error').count(),0);checks.push('mismatched quote blocks action and retry restores examples');
 await page.goto(target+'?case=loading');await page.locator('[aria-busy=true]').waitFor();await page.screenshot({path:path.join(out,'loading-390.png')});await page.locator('.finding').first().waitFor();checks.push('loading resolves without claiming AI execution');
 const touch=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const touchPage=await touch.newPage();await touchPage.goto(target);await touchPage.getByRole('tab',{name:'질문',exact:true}).tap();assert.equal(await touchPage.getByRole('tab',{name:'질문',exact:true}).getAttribute('aria-selected'),'true');await touch.close();checks.push('touch-emulated tab selection; not an Apple device test');
 assert.deepEqual(errors,[]);assert(requests.every(u=>u.startsWith(base+'/')));checks.push('no external requests, console/page errors, app storage changes or service worker');
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify({browser:await browser.version(),checks,visual,errors,requestOrigins:[...new Set(requests.map(u=>new URL(u).origin))],storage,limitations:['Synthetic examples only; no AI semantic evaluation','Chromium viewport/touch simulation, not Apple devices or native IME','Session-only prototype, not production integration']},null,2));
 console.log(JSON.stringify({passed:checks.length,visual:visual.length,errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

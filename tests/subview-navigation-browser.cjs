/* Actual app/SDK/IndexedDB with synthetic HTTP Auth. No production writes or Apple hardware. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, base, cloud } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, nav, observe } = require('./unified-home-browser.cjs');
const { fixture, current, seedComposition, abortWorkbenchWrites } = require('./life-workbench-browser.cjs');
const { instrumentStorage, inspectHome } = require('./home-entry-browser.cjs');
const out = path.resolve('.local/subview-navigation');
const report = { createdAt: new Date().toISOString(), scope: 'Actual app/SDK/IDB, intercepted Auth; viewport/keyboard/touch simulation only', checks: [], visual: [], consoleErrors: [], pageErrors: [], expectedErrors: 0 };
const heading = page => page.locator('#lifeApp .haedo-page-heading h1');
async function mode(page, name) { await settle(page); await page.waitForFunction(name => document.querySelector('#lifeMain')?.dataset.mode === name, name); }
async function back(page, target) { await page.locator('[data-subview-return]').click(); await mode(page, target); }
async function home(page) { await nav(page, 'home'); await page.waitForFunction(() => document.querySelector('#homeComposition')?.getAttribute('aria-busy') === 'false'); }
async function capture(page, scene, width) {
  await page.evaluate(async () => { await document.fonts.ready; document.activeElement?.blur(); scrollTo({ top: 0, behavior: 'instant' }); }); await page.mouse.move(0, 0);
  const metrics = await page.evaluate(inspectHome, '#lifeApp');
  const file = `${scene}-${width}.png`; await page.screenshot({ path: path.join(out, file) });
  report.visual.push({ scene, file, ...metrics });
  assert(!metrics.horizontalOverflow && !metrics.overflow.length, JSON.stringify(metrics.overflow));
  assert.deepEqual(metrics.smallTargets, []); assert.deepEqual(metrics.unnamed, []); assert.deepEqual(metrics.contrastFailures, []);
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] }); report.browser = browser.version();
  async function check(name, run, width = 820) {
    if (process.env.SUBVIEW_TEST_MATCH && !new RegExp(process.env.SUBVIEW_TEST_MATCH).test(name)) return;
    const server = new FakeCloud(), context = await makeContext(browser, server, 'subview-' + report.checks.length, accounts.a, { viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width <= 820 });
    await context.route(`${cloud}/rest/v1/rpc/life_public_page_list`, route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
    await instrumentStorage(context); const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
    try { await run({ page, context, server }); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png') }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    for (const width of [1440, 820, 390]) await check('home origin, keyboard/touch return and draft resume ' + width, async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); await home(page);
      for (const [destination, title] of [['write', '글쓰기'], ['import', '가져오기'], ['time', '연표']]) {
        const start = page.locator(`[data-home-destination="${destination}"]`);
        if (width === 1440) { await start.focus(); await page.keyboard.press('Enter'); } else await start.tap();
        await mode(page, destination); assert.equal(await heading(page).textContent(), title);
        assert.equal(await page.locator('[data-subview-return]').count(), 1);
        if (destination === 'write') assert.equal(await page.locator('#lifeWritingClose').count(), 1);
        assert.equal(await page.locator('[data-subview-return]').getAttribute('aria-label'), '홈으로 돌아가기');
        if (destination === 'write') { await page.locator('#lifeWritingTitle').fill('산책 뒤 남긴 생각'); await page.locator('#lifeWritingBody').fill('홈으로 돌아갔다가 다시 이어 쓸 한글 초안.'); }
        if (destination === 'import') { await page.locator('#lifeImportTitle').fill('아직 검토 중인 기록'); await page.locator('#lifeImportText').fill('원문을 자동 확정하지 않습니다.'); }
        await capture(page, destination, width);
        await back(page, 'home'); await page.waitForFunction(destination => document.activeElement?.dataset.homeDestination === destination, destination);
      }
      await page.locator('[data-home-destination="write"]').click(); await mode(page, 'write');
      assert.equal(await page.locator('#lifeWritingBody').inputValue(), '홈으로 돌아갔다가 다시 이어 쓸 한글 초안.');
      await back(page, 'home'); await page.locator('[data-home-destination="import"]').click(); await mode(page, 'import');
      assert.equal(await page.locator('#lifeImportText').inputValue(), '원문을 자동 확정하지 않습니다.');
      assert.equal((await current(page)).bundle.sources.length, 0);
    }, width);
    for (const width of [1440, 820, 390]) await check('search, tool and management origins and active menu roots ' + width, async ({ page }) => {
      await fixture(page, { many: true }); await nav(page, 'records'); await mode(page, 'sources');
      const before = await current(page);
      await page.locator('#lifeSearch').fill('산책');
      const resultIds = await page.locator('#lifeSearchResults .life-source-open').evaluateAll(nodes => nodes.map(node => node.dataset.versionId));
      await page.getByRole('button', { name: '내 페이지', exact: true }).click(); await mode(page, 'page');
      assert.equal(await heading(page).textContent(), '내 페이지'); await back(page, 'sources');
      assert.equal(await page.locator('#lifeSearch').inputValue(), '산책');
      assert.deepEqual(await page.locator('#lifeSearchResults .life-source-open').evaluateAll(nodes => nodes.map(node => node.dataset.versionId)), resultIds);
      await page.waitForFunction(() => document.activeElement?.textContent === '내 페이지');
      await page.getByRole('button', { name: '가져오기', exact: true }).click(); await mode(page, 'import');
      await nav(page, 'records'); await mode(page, 'sources'); assert.equal(await page.locator('#lifeSearch').inputValue(), '산책');
      await nav(page, 'tools'); await page.getByRole('button', { name: '다시 찾기', exact: true }).click(); await mode(page, 'discover');
      assert.equal(await heading(page).textContent(), '다시 찾기'); await back(page, 'tools');
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '다시 찾기');
      await page.getByRole('button', { name: '다시 찾기', exact: true }).click(); await mode(page, 'discover'); await nav(page, 'tools'); await mode(page, 'tools');
      await nav(page, 'manage');
      for (const [label, destination, title] of [['내보내기·사본 복원', 'transfer', '자료 백업·복원'], ['기기 간 동기화', 'sync', '기기 간 동기화'], ['자료·구성 백업', 'workbench-backup', '자료·구성 백업']]) {
        await page.getByRole('button', { name: label, exact: true }).click(); await mode(page, destination);
        assert.equal(await heading(page).textContent(), title);
        if (destination === 'transfer') await capture(page, 'transfer', width);
        await back(page, 'manage'); await page.waitForFunction(label => document.activeElement?.getAttribute('aria-label') === label, label);
        await page.getByRole('button', { name: label, exact: true }).click(); await mode(page, destination); await nav(page, 'manage'); await mode(page, 'manage');
      }
      assert.deepEqual(await current(page), before);
    }, width);
    await check('renamed home group and page editing return to the same entry', async ({ page }) => {
      const f = await fixture(page); const { groupId } = await seedComposition(page, f.refs); await home(page);
      await page.locator(`#homeGroups [data-group-id="${groupId}"]`).click(); await mode(page, 'activities');
      await page.getByRole('textbox', { name: '묶음 이름', exact: true }).fill('새 이름으로 다듬은 산책 묶음');
      await back(page, 'home');
      await page.waitForFunction(id => document.activeElement?.dataset.groupId === id, groupId, { timeout: 2000 });
      assert.match(await page.locator(`#homeGroups [data-group-id="${groupId}"]`).textContent(), /새 이름으로 다듬은 산책 묶음/);
      await page.locator('#homePage').getByRole('button', { name: '편집', exact: true }).click(); await mode(page, 'page');
      await back(page, 'home');
      await page.waitForFunction(() => document.activeElement?.closest('#homePage') && document.activeElement.textContent === '편집');
    }, 390);
    await check('failed import save blocks both return paths and retry preserves input', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); await home(page); await page.locator('[data-home-destination="import"]').click(); await mode(page, 'import');
      await page.evaluate(() => { window.__homeFailStage = true; });
      await page.locator('#lifeImportText').fill('실패해도 남아야 할 입력');
      for (const control of [page.locator('[data-subview-return]'), page.locator('[data-haedo-navigation] [data-haedo-section="records"]')]) {
        const url = page.url(); await control.click(); await settle(page); assert.equal(page.url(), url); assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'import'); assert.equal(await page.locator('#lifeImportText').inputValue(), '실패해도 남아야 할 입력');
      }
      await page.evaluate(() => { window.__homeFailStage = false; });
      await page.getByRole('button', { name: '검토 내용 보관', exact: true }).click(); await settle(page); await back(page, 'home');
      await page.locator('[data-home-destination="import"]').click(); await mode(page, 'import'); assert.equal(await page.locator('#lifeImportText').inputValue(), '실패해도 남아야 할 입력');
    }, 390);
    await check('late home response cannot block navigation or steal focus after return', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); await home(page);
      await page.locator('[data-home-destination="import"]').click(); await mode(page, 'import');
      await page.evaluate(() => { window.__homeHoldRead = true; window.__homeReadEntered = false; });
      await back(page, 'home'); await page.waitForFunction(() => __homeReadEntered);
      await nav(page, 'tools'); await mode(page, 'tools');
      const focus = await page.evaluate(() => document.activeElement?.outerHTML);
      await page.evaluate(() => __homeReleaseRead());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'tools');
      assert.equal(await page.evaluate(() => document.activeElement?.outerHTML), focus);
    });
    await check('page save failure blocks active records menu and contextual return', async ({ page }) => {
      await page.goto(base + '/index.html?view=page'); await ready(page); await mode(page, 'page');
      if (!await page.locator('#wbPageIntro').isVisible()) await page.getByText('제목·소개·표시 설정', { exact: true }).click();
      const before = await current(page); await abortWorkbenchWrites(page, true);
      await page.locator('#wbPageIntro').fill('돌아가기 실패에도 보존할 소개');
      for (const control of [page.locator('[data-subview-return]'), page.locator('[data-haedo-navigation] [data-haedo-section="records"]')]) {
        const url = page.url(); await control.click(); await settle(page);
        assert.equal(page.url(), url); assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'page');
        assert.equal(await page.locator('#wbPageIntro').inputValue(), '돌아가기 실패에도 보존할 소개');
        assert.deepEqual(await current(page), before);
      }
      await abortWorkbenchWrites(page, false); await page.getByRole('button', { name: '다시 저장', exact: true }).click();
      await page.locator('#wbError').waitFor({ state: 'hidden' }); await back(page, 'sources');
      assert.equal((await current(page)).workbench.page.intro, '돌아가기 실패에도 보존할 소개');
    });
    await check('direct deep links have stable parent fallback and no persistent origin data', async ({ page }) => {
      for (const [view, title, parent] of [['import','가져오기','sources'], ['write','글쓰기','sources'], ['time','연표','sources'], ['activities','묶음','sources'], ['page','내 페이지','sources'], ['discover','다시 찾기','tools'], ['transfer','자료 백업·복원','manage'], ['sync','기기 간 동기화','manage'], ['workbench-backup','자료·구성 백업','manage'], ['public-pages','공개 페이지 관리','manage']]) {
        await page.goto(base + '/index.html?view=' + view); await ready(page); await mode(page, view);
        const before = await current(page); assert.equal(await heading(page).textContent(), title); await back(page, parent); assert.deepEqual(await current(page), before);
      }
    });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []);
  } finally { await browser.close(); await fs.writeFile(path.join(out, process.env.SUBVIEW_TEST_MATCH ? 'recheck-report.json' : 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify({ passed: report.checks.filter(x => x.pass).length, total: report.checks.length, visual: report.visual.length, console: report.consoleErrors.length, page: report.pageErrors.length }));
  if (report.checks.some(x => !x.pass) || report.consoleErrors.length || report.pageErrors.length) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

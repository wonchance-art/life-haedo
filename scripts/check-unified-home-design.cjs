/* Unified home visual audit. Anonymous local fixtures and FakeCloud only.
 * npm run dev; node scripts/check-unified-home-design.cjs
 * Feature journey results live separately in unified-home-browser.cjs.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base, openManagement } = require('../tests/life-sync-browser.cjs');
const { playwright, ready, shellReady, nav, makeContext, observe } = require('../tests/unified-home-browser.cjs');
const { seed } = require('./check-life-collections-design.cjs');
const { inspect } = require('./check-life-design.cjs');
const sizes = [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'tablet', width: 820, height: 1000 }, { name: 'phone', width: 390, height: 844 }];
const out = path.resolve(__dirname, '../.local/unified-home/visual');
const evidence = path.resolve(__dirname, '../docs/design-review/evidence/unified-home');
async function clean(page) { await page.evaluate(() => document.activeElement.blur()); await page.mouse.move(0, 0); }
async function main() {
  await fs.mkdir(out, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { capturedAt: new Date().toISOString(), browser: browser.version(), environment: 'Linux Chromium viewport/touch simulation; no Apple hardware, IME, Files, VoiceOver or actual Google login',
    fixture: 'Existing anonymous six-source/twelve-excerpt collections fixture with long Korean title, multiple source references and notes', checks: [], captures: [], errors: [], consoleErrors: [], pageErrors: [], expectedErrors: 0 };
  const check = (name, pass, detail) => report.checks.push({ name, pass, ...(detail === undefined ? {} : { detail }) });
  async function capture(page, scene, size, publish = false) {
    await page.evaluate(() => document.fonts.ready); const metrics = await page.evaluate(inspect);
    const file = `${scene}-${size.name}.png`; await page.screenshot({ path: path.join(out, file) });
    if (publish) await fs.copyFile(path.join(out, file), path.join(evidence, file));
    report.captures.push({ scene, size, file, publish, ...metrics });
    for (const [name, pass, detail] of [['no horizontal overflow', !metrics.horizontalOverflow], ['text contrast', !metrics.contrastFailures.length, metrics.contrastFailures],
      ['44px targets', !metrics.smallTargets.length, metrics.smallTargets], ['named controls', !metrics.unnamed.length, metrics.unnamed], ['16px inputs', !metrics.smallInputs.length, metrics.smallInputs]]) check(`${size.name} ${scene}: ${name}`, pass, detail);
    check(`${size.name} ${scene}: three common destinations`, await page.locator('[data-haedo-navigation] [data-haedo-section]').evaluateAll(links => links.length === 3 && links.map(link => link.getAttribute('aria-label')).join(',') === '기록,도구,관리'));
  }
  try {
    for (const size of sizes) {
      const server = new FakeCloud();
      const options = { viewport: { width: size.width, height: size.height }, hasTouch: size.width <= 820 };
      const guest = await makeContext(browser, server, 'guest-' + size.name, null, options), guestPage = await guest.newPage(); observe(guestPage, report, size.name + ' guest');
      try {
        await guestPage.goto(base + '/index.html'); await shellReady(guestPage); await clean(guestPage);
        assert.equal(await guestPage.locator('#lifeWelcome').isVisible(), true); assert.deepEqual(await guestPage.evaluate(() => __homeDbOpens), []);
        await capture(guestPage, 'welcome', size, size.name === 'phone');
      } catch (error) { report.errors.push({ scene: 'guest', size: size.name, error: error.stack }); }
      finally { await guest.close(); }
      const device = 'visual-home-' + size.name, context = await makeContext(browser, server, device, accounts.a, options), page = await context.newPage();
      page.setDefaultTimeout(15000); observe(page, report, size.name);
      let release; const gate = new Promise(resolve => { release = resolve; });
      await context.route(`${cloud}/auth/v1/user`, async route => { await gate; return route.fallback(); });
      try {
        await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' }); await page.locator('#lifeStartup').waitFor({ state: 'visible' });
        await capture(page, 'loading', size, size.name === 'tablet'); release(); await ready(page); await context.unroute(`${cloud}/auth/v1/user`);
        await clean(page); await capture(page, 'empty', size, size.name === 'desktop');
        await seed(page); await clean(page); await capture(page, 'feed', size, true);
        const common = page.locator('[data-haedo-navigation] [data-haedo-section]');
        await common.first().focus(); await page.keyboard.press('Tab');
        const focus = (await page.evaluate(inspect)).focus;
        check(size.name + ' common navigation keyboard focus', focus.visible && focus.width >= 3 && focus.contrast >= 3, focus);
        assert.equal(await common.nth(1).evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('[data-haedo-navigation] a[data-haedo-section="tools"]').getAttribute('aria-current'), 'page');
        await clean(page); await capture(page, 'tools', size, size.name !== 'tablet');
        await nav(page, 'manage'); await clean(page); await capture(page, 'manage', size, size.name === 'phone');
        await openManagement(page); await clean(page); await capture(page, 'management-options', size);
        await nav(page, 'records'); await page.getByRole('button', { name: '원천 기록', exact: true }).click(); await clean(page);
        await capture(page, 'source-results', size, size.name === 'desktop');
        const longest = page.locator('#lifeSearchResults h3').filter({ hasText: '좋은 문장을 모으는 일에서' });
        assert.equal(await longest.count(), 1);
        check(size.name + ' long Korean title stays inside content', await longest.evaluate(el => el.scrollWidth <= el.clientWidth && getComputedStyle(el).overflowWrap === 'anywhere'));
        assert.equal(server.writes().length, 0);
      } catch (error) { report.errors.push({ size: size.name, error: error.stack }); }
      finally { release(); await context.close(); }
      const errorDevice = 'error-home-' + size.name, failure = await makeContext(browser, server, errorDevice, accounts.a, options), errorPage = await failure.newPage();
      errorPage.expectedAuthFailure = true; errorPage.setDefaultTimeout(15000); observe(errorPage, report, size.name + ' auth failure'); server.offline.add(errorDevice);
      try {
        await errorPage.goto(base + '/index.html'); await shellReady(errorPage); await clean(errorPage);
        assert.equal(await errorPage.getByRole('button', { name: '다시 확인', exact: true }).isVisible(), true);
        assert.deepEqual(await errorPage.evaluate(() => __homeDbOpens), []); await capture(errorPage, 'auth-error', size, size.name === 'phone');
      } catch (error) { report.errors.push({ scene: 'error', size: size.name, error: error.stack }); }
      finally { await failure.close(); }
    }
    check('no unexpected console errors', !report.consoleErrors.length, report.consoleErrors);
    check('no page errors', !report.pageErrors.length, report.pageErrors);
  } finally {
    await browser.close(); await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  const failed = report.checks.filter(item => !item.pass);
  console.log(JSON.stringify({ passed: report.checks.length - failed.length, failed, errors: report.errors, captures: report.captures.length,
    published: report.captures.filter(item => item.publish).length, expectedErrors: report.expectedErrors, report: '.local/unified-home/visual/report.json' }, null, 2));
  if (failed.length || report.errors.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

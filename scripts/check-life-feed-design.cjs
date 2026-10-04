/* Focused feed refinement audit; reuses the anonymous collection fixtures.
 * npm run dev; node scripts/check-life-feed-design.cjs
 * Existing collection/integration evidence is never overwritten.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, platformContext, cloud, base } = require('../tests/life-sync-browser.cjs');
const { seed } = require('./check-life-collections-design.cjs');
const { inspect } = require('./check-life-design.cjs');
const out = path.resolve(__dirname, '../.local/feed-refinement');
const evidence = path.resolve(__dirname, '../docs/design-review/evidence/feed');
const sizes = [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'tablet', width: 820, height: 1000 }, { name: 'phone', width: 390, height: 844 }];
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
function playwright() {
  for (const name of [process.env.PW_MODULE_PATH, 'playwright', 'playwright-core', '/opt/codex/cua_node/lib/node_modules/playwright'].filter(Boolean)) {
    try { return require(name); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Set PW_MODULE_PATH to the installed Playwright module.');
}
const settle = page => page.waitForFunction(() => !document.querySelector('.life-app[aria-busy="true"]'));
async function ready(page) {
  await page.waitForFunction(() => globalThis.HaedoLife?.Shell?.storage && !document.querySelector('#lifeApp').hidden);
  await page.evaluate(() => HaedoLife.Shell.ready);
}
async function clean(page) { await page.evaluate(() => document.activeElement.blur()); await page.mouse.move(0, 0); }
async function main() {
  await fs.mkdir(out, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const server = new FakeCloud();
  const report = { capturedAt: new Date().toISOString(), browser: browser.version(), environment: 'Linux Chromium viewport/touch simulation; no Apple hardware, IME, Files, VoiceOver or real OAuth verification',
    fixtures: 'Existing anonymous collections audit fixtures: six sources, twelve excerpts, one excerpt with two exact references', checks: [], captures: [], errors: [], consoleErrors: [], pageErrors: [], externalRequests: [] };
  const check = (name, pass, detail) => report.checks.push({ name, pass, ...(detail === undefined ? {} : { detail }) });
  async function capture(page, scene, size, publish = false) {
    await page.evaluate(() => document.fonts.ready); const metrics = await page.evaluate(inspect);
    const file = `${scene}-${size.name}.png`; await page.screenshot({ path: path.join(out, file) });
    if (publish) await fs.copyFile(path.join(out, file), path.join(evidence, file));
    report.captures.push({ scene, size, file, publish, ...metrics });
    for (const [name, pass, detail] of [['no horizontal overflow', !metrics.horizontalOverflow], ['text contrast', !metrics.contrastFailures.length, metrics.contrastFailures],
      ['44px targets', !metrics.smallTargets.length, metrics.smallTargets], ['named controls', !metrics.unnamed.length, metrics.unnamed], ['16px inputs', !metrics.smallInputs.length, metrics.smallInputs]]) check(`${size.name} ${scene}: ${name}`, pass, detail);
  }
  try {
    for (const size of sizes) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.width <= 820, serviceWorkers: 'block' });
      await platformContext(context, server, 'feed-' + size.name);
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === new URL(base).origin || url.origin === cloud) return route.fallback();
        report.externalRequests.push(url.origin); return route.abort('blockedbyclient');
      });
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ size: size.name, message: event.text() }); });
      page.on('pageerror', error => report.pageErrors.push({ size: size.name, message: error.message }));
      try {
        await page.goto(base + '/life.html'); await ready(page); const data = await seed(page); await clean(page);
        const card = page.locator('.life-excerpt-card').first(), quote = data.records[0].text;
        const primary = card.locator('.life-excerpt-open');
        const info = card.getByRole('button', { name: /^발췌 출처 정보/ });
        const manage = card.getByRole('button', { name: '발췌 관리', exact: true });
        assert.equal(await card.locator('.life-excerpt-sources').isHidden(), true);
        assert.equal(await card.locator('.life-excerpt-manage').isHidden(), true);
        assert.equal(await card.locator('blockquote').textContent(), quote);
        assert.equal(await card.locator('.life-note').textContent(), data.records[0].note);
        check(size.name + ' compact toolbar SVGs share geometry and centers', await card.locator('.life-feed-footer .life-icon-button').evaluateAll(buttons => {
          const rects = buttons.map(button => button.querySelector('svg')?.getBoundingClientRect());
          return rects.length === 3 && rects.every(r => r && Math.abs(r.width - 20) < .1 && Math.abs(r.height - 20) < .1 && Math.abs(r.y + r.height / 2 - rects[0].y - rects[0].height / 2) < .5);
        }));
        await capture(page, 'feed', size, true);
        await primary.focus(); await page.keyboard.press('Tab'); assert.equal(await info.evaluate(el => el === document.activeElement), true);
        const focus = (await page.evaluate(inspect)).focus;
        check(size.name + ' info keyboard focus ring', focus.visible && focus.width >= 3 && focus.contrast >= 3, focus);
        await page.keyboard.press('Enter'); assert.equal(await card.locator('.life-excerpt-sources').isVisible(), true);
        assert.equal(await card.locator('.life-source-refs button').count(), 2);
        await page.keyboard.press('Escape');
        assert.equal(await card.locator('.life-excerpt-sources').isHidden(), true);
        assert.equal(await info.evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Enter');
        await clean(page); await capture(page, 'source-info', size, size.name !== 'tablet');
        const second = card.locator('.life-source-refs button').nth(1), key = await second.getAttribute('data-focus-key');
        await second.click(); await settle(page); await page.waitForFunction(expected => getSelection().toString() === expected, quote);
        assert.equal(await page.locator('#lifeSourceText').textContent(), data.sources[3].raw);
        await page.locator('#lifeSearchReturn').click(); await settle(page);
        await page.waitForFunction(expected => document.activeElement?.dataset.focusKey === expected, key);
        assert.equal(await second.isVisible(), true); check(size.name + ' exact second source and return focus', true);
        await info.click(); assert.equal(await card.locator('.life-excerpt-sources').isHidden(), true);
        await info.focus(); await page.keyboard.press('Tab'); assert.equal(await manage.evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Enter'); assert.equal(await card.getByRole('button', { name: '발췌 제거', exact: true }).isVisible(), true);
        const manageFocus = (await page.evaluate(inspect)).focus;
        check(size.name + ' management keyboard focus ring', manageFocus.visible && manageFocus.width >= 3 && manageFocus.contrast >= 3, manageFocus);
        check(size.name + ' focused control clear of bottom navigation', await manage.evaluate(el => {
          if (innerWidth > 700) return true;
          const css = getComputedStyle(el), ring = parseFloat(css.outlineWidth) + parseFloat(css.outlineOffset);
          return el.getBoundingClientRect().bottom + ring + 8 <= document.querySelector('.haedo-nav, .life-nav').getBoundingClientRect().top;
        }));
        await capture(page, 'management', size, size.name === 'phone');
        await page.keyboard.press('Escape'); assert.equal(await card.locator('.life-excerpt-manage').isHidden(), true);
        assert.equal(await manage.evaluate(el => el === document.activeElement), true);
        const longTitleControl = page.locator('.life-excerpt-card').nth(3).locator('.life-excerpt-open');
        await longTitleControl.focus();
        const tooltip = longTitleControl.locator('.life-tooltip');
        assert.equal(await tooltip.isVisible(), true);
        check(size.name + ' long-title tooltip stays inside viewport and wraps', await tooltip.evaluate(el => {
          const rect = el.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth && rect.width <= 220.1 && getComputedStyle(el).whiteSpace === 'normal';
        }));
        await page.keyboard.press('Escape'); assert.equal(await tooltip.isHidden(), true);
        await page.getByRole('button', { name: '원천 기록', exact: true }).click(); await settle(page); await clean(page);
        await capture(page, 'source-results', size, size.name === 'tablet');
        const sourceCard = page.locator('#lifeSearchResults article[data-version-id]').first();
        const sourceInfo = sourceCard.getByRole('button', { name: /^자료 출처 정보/ });
        const sourcePanelId = await sourceInfo.getAttribute('aria-controls');
        assert.equal(await page.locator('#' + sourcePanelId).isHidden(), true);
        if (size.width <= 820) await sourceInfo.tap(); else await sourceInfo.click();
        assert.equal(await page.locator('#' + sourcePanelId).isVisible(), true);
        await clean(page); await capture(page, 'result-info', size, size.name === 'tablet');
        const sourceKey = await sourceCard.getByRole('button', { name: /^자료 읽기/ }).getAttribute('data-focus-key');
        await sourceCard.getByRole('button', { name: /^자료 읽기/ }).click(); await settle(page);
        await page.locator('#lifeSearchReturn').click(); await settle(page);
        await page.waitForFunction(expected => document.activeElement?.dataset.focusKey === expected, sourceKey);
        check(size.name + ' source results return focus', true);
      } catch (error) { report.errors.push({ size: size.name, error: error.stack }); }
      finally { await context.close(); }
    }
    check('no unexpected console errors', !report.consoleErrors.length, report.consoleErrors);
    check('no page errors', !report.pageErrors.length, report.pageErrors);
    check('no external requests', !report.externalRequests.length, report.externalRequests);
    check('no remote writes', !server.writes().length);
  } finally {
    report.syntheticRemoteWrites = server.writes().length; await browser.close();
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  const failed = report.checks.filter(item => !item.pass);
  console.log(JSON.stringify({ passed: report.checks.length - failed.length, failed, errors: report.errors, captures: report.captures.length, published: report.captures.filter(item => item.publish).length, report: '.local/feed-refinement/report.json' }, null, 2));
  if (failed.length || report.errors.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

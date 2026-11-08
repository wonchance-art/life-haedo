/* 일정 통합 정리 PR #243 review fixes (2026-11-08) on the real app, SDK and IDB with the anonymous
 * intercepted Auth; haedo_items are the owner-scoped in-memory table of schedule-entries-browser.
 * - Leaving 일정 for the habit screen (D 습관 추가, an M tracker row, the 습관 체크 fallback) with a
 *   source draft that is already saved to its stage asks nothing on the way out (no beforeunload
 *   dialog) and the draft stays stored.
 * - 통합 검색 opened from Q·M·W·D is named back as 일정으로 돌아가기 and returns to the same view and date.
 * - The list's 글 메뉴 closes when keyboard focus leaves it, so at 390 its panel never covers the next
 *   focus target; returning from one of its items still reopens it on that item.
 * npm run dev; node tests/schedule-exits-browser.cjs
 * Never uses real Google, production Supabase or Apple-device claims. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, nav, importExcerpt } = require('./unified-home-browser.cjs');
const { PlatformTables } = require('./schedule-entries-browser.cjs');

const output = path.resolve(process.env.SCHEDULE_EXITS_OUTPUT || '.local/schedule-exits-browser');
const TODAY = '2026-11-07T12:00:00+09:00';
const TOPIC = '떠나기 전 쓰던 주제';
const report = { checks: [], consoleErrors: [], pageErrors: [], dialogs: [] };

const mode = (page, value) => page.locator('#lifeMain[data-mode="' + value + '"]').waitFor();
async function scheduleReady(page, value) {
  await page.waitForFunction(m => document.querySelector('#lifeMain')?.dataset.mode === m && document.querySelector('#lifeSchedule')?.getAttribute('aria-busy') === 'false', value);
}
async function stageTopics(page) {
  return page.evaluate(async () => { const s = HaedoLife.Shell.storage; return (await s.listStages(await s.getActive())).map(stage => stage.draftTopic || ''); });
}
// A source memo typed on a source, kept in this screen's drafts while moving to 일정 in the app.
// Leaving the page saves it to its stage first; it then stayed counted as unsaved and asked again.
async function savedSourceDraft(page) {
  await page.goto(base + '/index.html'); await ready(page);
  await importExcerpt(page, '익명 자료', '첫 문장입니다.\n둘째 문장🌱 입니다.', '둘째 문장🌱');
  await nav(page, 'records'); if (await page.locator('#lifeMain').getAttribute('data-mode') !== 'sources') await nav(page, 'records');
  await page.locator('#lifeSearchResults .life-source-open').first().click(); await settle(page);
  // The memo field sits in the source's excerpt panel.
  if (!await page.locator('#lifeSourceTopic').isVisible()) await page.getByRole('button', { name: /발췌/ }).first().click();
  await page.locator('#lifeSourceTopic').fill(TOPIC);
  await page.locator('[data-haedo-navigation] [data-haedo-section="schedule"]').click(); await settle(page);
  assert.equal((await stageTopics(page)).includes(TOPIC), false, 'the memo is still only a draft here');
}
async function scheduleView(page, view) {
  await page.locator('#lifeApp [data-schedule-view="' + view + '"]').click(); await settle(page); await scheduleReady(page, view);
}
async function leaveAndCheck(page, dialogs, link) {
  const before = dialogs.length;
  await link.click();
  await page.waitForURL(url => url.pathname.endsWith('/habits.html'), { timeout: 10000 });
  assert.deepEqual(dialogs.slice(before), [], 'no beforeunload dialog on the way out');
  await page.goto(base + '/index.html?section=records'); await ready(page);
  assert((await stageTopics(page)).includes(TOPIC), 'leaving saved the memo to its stage');
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, run, viewport = { width: 1440, height: 960 }) {
    if (process.env.SCHEDULE_EXITS_MATCH && !new RegExp(process.env.SCHEDULE_EXITS_MATCH).test(name)) return;
    const server = new FakeCloud(), tables = new PlatformTables('2026-11-07T02:00:00Z'), device = 'exits-' + report.checks.length;
    const context = await makeContext(browser, server, device, accounts.a, { viewport, timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
    await tables.attach(context);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    await page.clock.setFixedTime(new Date(TODAY));
    const dialogs = [];
    page.on('dialog', dialog => { dialogs.push(dialog.type() + ':' + dialog.message()); report.dialogs.push({ check: name, type: dialog.type() }); dialog.accept().catch(() => {}); });
    page.on('pageerror', error => report.pageErrors.push({ check: name, message: error.message }));
    page.on('console', event => {
      if (event.type() !== 'error') return;
      if (page.__expectBlocked && /Failed to load resource:.*ERR_FAILED/.test(event.text())) return;
      report.consoleErrors.push({ check: name, message: event.text() });
    });
    try { await run({ page, context, tables, dialogs }); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    await check('a saved source draft: D 습관 추가 leaves for the habit screen without a beforeunload dialog', async ({ page, dialogs }) => {
      await savedSourceDraft(page);
      await scheduleView(page, 'day');
      await leaveAndCheck(page, dialogs, page.locator('.schedule-entries').getByRole('link', { name: '습관 추가', exact: true }));
    });

    await check('a saved source draft: an M tracker row leaves for that month without a beforeunload dialog', async ({ page, dialogs, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: { title: '아침 산책', days: [0, 1, 2, 3, 4, 5, 6], created: '2026-10-26', checks: ['2026-11-02'] } });
      await savedSourceDraft(page);
      await scheduleView(page, 'month');
      const row = page.locator('.schedule-entries-month a[href^="habits.html?month="]').first(); await row.waitFor();
      await leaveAndCheck(page, dialogs, row);
    });

    await check('a saved source draft: the 습관 체크 fallback leaves without a beforeunload dialog', async ({ page, context, dialogs }) => {
      // The day's entry panel cannot load: 일정 D falls back to its 습관 체크 link.
      page.__expectBlocked = true;
      await context.route(/\/assets\/life\/schedule-entries\.js/, route => route.abort('failed'));
      await savedSourceDraft(page);
      await scheduleView(page, 'day');
      const link = page.locator('#lifeMain .schedule-links a', { hasText: '습관 체크' }); await link.waitFor();
      await leaveAndCheck(page, dialogs, link);
    });

    for (const view of ['quarter', 'month', 'week', 'day']) {
      await check('통합 검색 from ' + view + ' is named 일정으로 돌아가기 and returns to the same ' + view + ' and date', async ({ page }) => {
        await page.goto(base + '/index.html?section=schedule&view=' + view + '&date=2026-10-14'); await ready(page); await scheduleReady(page, view);
        const title = await page.locator('.life-page-title').innerText();
        await page.locator('#lifeFindOpen').click(); await mode(page, 'find');
        const back = page.locator('#lifeSubviewReturn');
        assert.equal(await back.getAttribute('aria-label'), '일정으로 돌아가기');
        await back.click(); await scheduleReady(page, view);
        const url = new URL(page.url());
        assert.equal(url.searchParams.get('view'), view); assert.equal(url.searchParams.get('date'), '2026-10-14');
        assert.equal(await page.locator('.life-page-title').innerText(), title, 'the same period');
      });
    }

    await check('글 메뉴 at 390: keyboard focus leaving closes it, its panel never covers the next focus target; return reopens it on its item', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); await mode(page, 'home');
      const menu = page.locator('#lifeBlogMenu'), summary = menu.locator(':scope > summary'), isOpen = () => menu.evaluate(node => node.open);
      // The focused control is what the pointer would hit at its centre (no panel over it).
      const uncovered = () => page.evaluate(() => { const node = document.activeElement, box = node.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return box.width > 0 && (hit === node || node.contains(hit)); });
      // Forward: the last item, then Tab out.
      await summary.focus(); await page.keyboard.press('Enter'); assert.equal(await isOpen(), true);
      const items = await menu.locator('.life-feature-menu-panel button').count();
      for (let i = 0; i < items; i++) await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.closest('#lifeBlogMenu') !== null), true, 'Tab walks the menu items');
      await page.screenshot({ path: path.join(output, 'blog-menu-open-390.png') });
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => !document.activeElement?.closest('#lifeBlogMenu')), true, 'focus left the menu');
      assert.equal(await isOpen(), false, 'leaving by Tab closes the menu');
      await page.screenshot({ path: path.join(output, 'blog-menu-tab-out-390.png') });
      for (let i = 0; i < 5; i++) {
        assert.equal(await uncovered(), true, 'focus target ' + i + ' after the menu is not under a panel');
        await page.keyboard.press('Tab');
      }
      // Backward: Shift+Tab from the menu's own button.
      await summary.focus(); await page.keyboard.press('Enter'); assert.equal(await isOpen(), true);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await isOpen(), false, 'leaving by Shift+Tab closes the menu'); assert.equal(await uncovered(), true);
      await page.locator('.life-page-title').focus(); // the skip link that took focus hides again
      // A pointer press outside still closes it; inside it does not.
      await summary.click(); assert.equal(await isOpen(), true);
      await menu.locator('.life-feature-menu-panel').click({ position: { x: 4, y: 4 } }); assert.equal(await isOpen(), true, 'a press inside keeps it');
      await page.mouse.click(4, 400); assert.equal(await isOpen(), false, 'a press outside closes it');
      // An item opened and returned from: the menu reopens on that item.
      await summary.click();
      await menu.getByRole('button', { name: '글 공개·보관', exact: true }).click(); await mode(page, 'blog');
      await page.locator('[data-subview-return]:visible').click(); await mode(page, 'home');
      await page.waitForFunction(() => document.activeElement?.textContent?.includes('글 공개·보관'));
      assert.equal(await isOpen(), true, 'the menu reopens on the item used');
      assert.equal(await uncovered(), true);
      await page.keyboard.press('Shift+Tab'); assert.equal(await isOpen(), true, 'moving within the menu keeps it');
    }, { width: 390, height: 844 });
  } finally { await browser.close(); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(report.pageErrors, [], 'page errors'); assert.deepEqual(report.consoleErrors, [], 'console errors');
  assert(report.checks.length && report.checks.every(item => item.pass), 'all checks pass');
  console.log(JSON.stringify({ checks: report.checks.length }));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

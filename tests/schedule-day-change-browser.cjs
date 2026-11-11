/* 일정이 켜진 채 날짜가 바뀔 때 (2026-11-11 M1). The app is left open on a calendar screen, the
 * day changes, and the owner comes back without a reload. The screen that showed today follows the
 * new today; a chosen past date stays; 오늘 and ‹ › move from the date on screen; a habit check is
 * stored for the date on screen; a control in use is not redrawn under the hand.
 * Real app, SDK and IDB with the anonymous intercepted Auth and in-memory owner-scoped tables.
 * npm run dev; node tests/schedule-day-change-browser.cjs
 * Never uses real Google, production Supabase or Apple-device claims (a hidden→visible page is
 * simulated; a real bfcache restore and an iOS app switch are not covered here). */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { PlatformTables } = require('./schedule-entries-browser.cjs');

const output = path.resolve(process.env.SCHEDULE_DAY_CHANGE_OUTPUT || '.local/schedule-day-change-browser');
const report = { checks: [], consoleErrors: [], pageErrors: [] };
const habit = checks => ({ title: '아침 산책', days: [0, 1, 2, 3, 4, 5, 6], created: '2026-10-01', checks });
const at = (page, iso) => page.clock.setFixedTime(new Date(iso));
// The page goes to the background and comes back (no reload).
const flip = (page, hidden) => page.evaluate(h => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => h ? 'hidden' : 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  if (!h) window.dispatchEvent(new Event('focus'));
}, hidden);
async function overnight(page, iso) { await flip(page, true); await at(page, iso); await flip(page, false); }
const snap = page => page.evaluate(() => ({ title: document.querySelector('#lifeApp .life-page-title')?.innerText, date: new URLSearchParams(location.search).get('date'),
  today: [...document.querySelectorAll('#lifeSchedule [data-today="true"]')].map(n => n.dataset.date || n.innerText.replace(/\s/g, '')).filter(Boolean) }));
async function shown(page, mode) {
  await page.waitForFunction(m => document.querySelector('#lifeMain')?.dataset.mode === m && document.querySelector('#lifeSchedule')?.getAttribute('aria-busy') === 'false' && !document.querySelector('.life-app[aria-busy="true"]'), mode);
}
const titled = (page, text) => page.waitForFunction(t => document.querySelector('#lifeApp .life-page-title')?.innerText === t && document.querySelector('#lifeSchedule')?.getAttribute('aria-busy') === 'false', text);
const entries = page => page.waitForFunction(() => { const slot = document.querySelector('.schedule-entries'); return slot && slot.getAttribute('aria-busy') === 'false' && slot.dataset.happiness !== 'loading' && slot.querySelector('.schedule-entry-body')?.childElementCount > 0; });
const list = page => page.waitForFunction(() => document.querySelector('#lifeMain')?.dataset.mode === 'home' && document.querySelector('#homePosts')?.getAttribute('aria-busy') === 'false');
const step = (page, n) => page.locator('[data-focus-key="schedule:step:' + n + '"]').click();
const todayButton = page => page.locator('[data-focus-key="schedule:today"]');

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, run, viewport = { width: 1440, height: 960 }) {
    if (process.env.SCHEDULE_DAY_CHANGE_MATCH && !new RegExp(process.env.SCHEDULE_DAY_CHANGE_MATCH).test(name)) return;
    const server = new FakeCloud(), tables = new PlatformTables('2026-11-01T00:00:00Z'), device = 'day-change-' + report.checks.length;
    const phone = viewport.width < 761;
    const context = await makeContext(browser, server, device, accounts.a, { viewport, timezoneId: 'Asia/Seoul', locale: 'ko-KR', ...(phone ? { hasTouch: true, isMobile: true } : {}) });
    await tables.attach(context);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.pageErrors.push({ check: name, message: error.message }));
    page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ check: name, message: event.text() }); });
    console.log('RUN ' + name);
    try { await run({ page, context, server, tables, phone }); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  // Opens a calendar unit the way a person does: the unit bar on a wide screen, the dateless address on a phone.
  async function openUnit(page, phone, view) {
    await page.goto(base + '/index.html'); await ready(page); await list(page);
    if (phone) { await page.goto(base + '/index.html?section=schedule&view=' + view); await ready(page); }
    else await page.locator('[data-schedule-view="' + view + '"]').first().click();
    await shown(page, view);
  }
  try {
    for (const width of [1440, 390]) {
      await check('D ' + width + ': the day shown as today follows the new day; 오늘, ‹ › and the habit check use the date on screen', async ({ page, tables, phone }) => {
        tables.seed('haedo_items', accounts.a.id, { id: 'habit-1', kind: 'habit', data: habit([]) });
        await at(page, '2026-11-11T23:40:00+09:00');
        await openUnit(page, phone, 'day'); await entries(page);
        assert.deepEqual(await snap(page), { title: '11월 11일 수요일', date: '2026-11-11', today: ['수11'] });
        await overnight(page, '2026-11-12T07:30:00+09:00');
        await titled(page, '11월 12일 목요일'); await entries(page);
        const morning = await snap(page);
        assert.equal(morning.date, '2026-11-12', 'the address names the day on screen');
        assert.deepEqual(morning.today, ['목12'], 'today is marked on the 12th');
        const box = page.getByRole('checkbox', { name: '아침 산책', exact: true });
        assert.equal(await box.getAttribute('data-focus-key'), 'schedule:habit:habit-1:2026-11-12');
        await box.check();
        await page.waitForFunction(() => /저장됨 · 계정에 올림/.test(document.querySelector('.schedule-entry-status')?.innerText || ''));
        assert.deepEqual(tables.owned('haedo_items', accounts.a.id).map(row => row.data.checks), [['2026-11-12']], 'the check is stored for the day on screen');
        await page.screenshot({ path: path.join(output, 'day-next-morning-' + width + '.png') });
        // 오늘 on today's screen changes nothing; › and ‹ move one day each.
        await todayButton(page).click(); await page.waitForTimeout(300);
        assert.equal((await snap(page)).title, '11월 12일 목요일');
        await step(page, 1); await titled(page, '11월 13일 금요일');
        assert.equal((await snap(page)).date, '2026-11-13');
        await step(page, -1); await titled(page, '11월 12일 목요일');
        await todayButton(page).click(); await page.waitForTimeout(300);
        assert.equal((await snap(page)).date, '2026-11-12');
      }, width === 390 ? { width: 390, height: 844 } : { width: 1440, height: 960 });
    }

    await check('W: the week shown as this week follows; › moves one week, ‹ comes back', async ({ page, phone }) => {
      await at(page, '2026-11-15T23:40:00+09:00'); // Sunday, the last day of its week
      await openUnit(page, phone, 'week');
      assert.equal((await snap(page)).title, '11.9 – 11.15');
      await overnight(page, '2026-11-16T07:30:00+09:00');
      await titled(page, '11.16 – 11.22');
      assert.equal((await snap(page)).date, '2026-11-16');
      await step(page, 1); await titled(page, '11.23 – 11.29');
      await step(page, -1); await titled(page, '11.16 – 11.22');
    });

    await check('M: the month shown as this month follows; › moves one month, ‹ comes back', async ({ page, phone }) => {
      await at(page, '2026-11-30T23:40:00+09:00');
      await openUnit(page, phone, 'month');
      assert.equal((await snap(page)).title, '11월');
      await overnight(page, '2026-12-01T07:30:00+09:00');
      await titled(page, '12월');
      const december = await snap(page);
      assert.equal(december.date, '2026-12-01'); assert.ok(december.today.includes('2026-12-01') || december.today.includes('1'), 'the 1st is marked today: ' + JSON.stringify(december.today));
      await step(page, 1); await titled(page, '2027년 1월');
      await step(page, -1); await titled(page, '12월');
    });

    await check('a chosen past date stays; only the 오늘 mark moves', async ({ page }) => {
      await at(page, '2026-11-11T23:40:00+09:00');
      await page.goto(base + '/index.html?section=schedule&view=week&date=2026-11-09'); await ready(page); await shown(page, 'week');
      const before = await snap(page);
      assert.equal(before.title, '11.9 – 11.15'); assert.ok(before.today.includes('수11'), JSON.stringify(before.today));
      await overnight(page, '2026-11-12T07:30:00+09:00');
      await page.waitForFunction(() => [...document.querySelectorAll('#lifeSchedule [data-today="true"]')].some(n => n.innerText.replace(/\s/g, '') === '목12'));
      const after = await snap(page);
      assert.equal(after.title, '11.9 – 11.15'); assert.equal(after.date, '2026-11-09', 'the chosen date is kept');
      assert.ok(after.today.includes('목12') && !after.today.includes('수11'), 'today is marked on the 12th only: ' + JSON.stringify(after.today));
      // A past day: the date and its address stay.
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-05'); await ready(page); await shown(page, 'day');
      await overnight(page, '2026-11-13T07:30:00+09:00'); await page.waitForTimeout(1200);
      assert.deepEqual({ ...(await snap(page)), today: undefined }, { title: '11월 5일 목요일', date: '2026-11-05', today: undefined });
      // 오늘 from there opens the new today.
      await todayButton(page).click(); await titled(page, '11월 13일 금요일');
    });

    await check('before the screen is drawn again: 오늘 opens the new day, › moves one day from the day on screen, a check is stored for the day on screen', async ({ page, tables, phone }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'habit-1', kind: 'habit', data: habit([]) });
      await at(page, '2026-11-11T23:40:00+09:00');
      await openUnit(page, phone, 'day'); await entries(page);
      // The clock passes midnight with no event at all (the screen still shows the 11th).
      await at(page, '2026-11-12T00:10:00+09:00');
      assert.equal((await snap(page)).title, '11월 11일 수요일');
      await page.getByRole('checkbox', { name: '아침 산책', exact: true }).check();
      await page.waitForFunction(() => /저장됨 · 계정에 올림/.test(document.querySelector('.schedule-entry-status')?.innerText || ''));
      assert.deepEqual(tables.owned('haedo_items', accounts.a.id).map(row => row.data.checks), [['2026-11-11']], 'stored for the 11th, the day on screen');
      await step(page, 1); await titled(page, '11월 12일 목요일');
      assert.deepEqual((await snap(page)).today, ['목12']);
      // Again from a stale screen: 오늘.
      await at(page, '2026-11-13T00:10:00+09:00');
      assert.equal((await snap(page)).title, '11월 12일 목요일');
      await todayButton(page).click(); await titled(page, '11월 13일 금요일');
      assert.equal((await snap(page)).date, '2026-11-13');
    });

    await check('a control in use is not redrawn: an open dialog and a held goal bar finish first', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'goal-1', kind: 'goal', data: { title: '책 열두 권 읽기', progress: 40, target: '2027-06-30' } });
      await at(page, '2026-12-31T23:40:00+09:00');
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      await page.locator('[data-schedule-view="tools"]').first().click(); await shown(page, 'tools');
      const bar = page.getByRole('slider', { name: '책 열두 권 읽기 진행률' }); await bar.waitFor();
      assert.equal((await snap(page)).title, '2026년');
      // The bar is held down while the year changes.
      const box = await bar.boundingBox();
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2); await page.mouse.down();
      await overnight(page, '2027-01-01T07:30:00+09:00');
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 4 });
      await page.waitForTimeout(1600);
      assert.equal((await snap(page)).title, '2026년', 'the screen waits while the bar is held');
      assert.equal(await bar.isVisible(), true, 'the held bar is still the same control');
      await page.mouse.up();
      await titled(page, '2027년');
      await page.waitForFunction(() => globalThis.HaedoPlatformStore?.items.every(item => item.state === 'ok'));
      const stored = tables.owned('haedo_items', accounts.a.id)[0].data.progress;
      assert.ok(stored >= 70 && stored <= 90, 'the dragged value was stored (' + stored + ')');
      assert.equal(await page.getByRole('slider', { name: '책 열두 권 읽기 진행률' }).inputValue(), String(stored), 'the new year shows the stored value');
      // An open dialog (단축키) holds the screen as well.
      await page.locator('.schedule-help').click(); await page.locator('#scheduleShortcuts').waitFor();
      await overnight(page, '2028-01-01T07:30:00+09:00'); await page.waitForTimeout(1600);
      assert.equal((await snap(page)).title, '2027년'); assert.equal(await page.locator('#scheduleShortcuts').isVisible(), true);
      await page.locator('#scheduleShortcuts').getByRole('button', { name: '닫기' }).click();
      await titled(page, '2028년');
    });

    await check('another screen overnight: the next calendar screen opens on the new day; a reload of a screen that showed today opens today', async ({ page }) => {
      await at(page, '2026-11-11T23:40:00+09:00');
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      await page.locator('[data-schedule-view="day"]').first().click(); await shown(page, 'day');
      await page.locator('[data-schedule-view="home"]').first().click(); await list(page);
      await overnight(page, '2026-11-12T07:30:00+09:00');
      await page.locator('[data-schedule-view="day"]').first().click(); await shown(page, 'day');
      await titled(page, '11월 12일 목요일');
      // The tab is reloaded on a later day (its address still names the 12th): it showed today, so today opens.
      assert.equal((await snap(page)).date, '2026-11-12');
      await at(page, '2026-11-14T09:00:00+09:00');
      await page.reload(); await ready(page); await shown(page, 'day');
      await titled(page, '11월 14일 토요일');
      assert.equal((await snap(page)).date, '2026-11-14');
      // A chosen date in the address is kept on a reload.
      await step(page, -1); await titled(page, '11월 13일 금요일');
      await at(page, '2026-11-15T09:00:00+09:00');
      await page.reload(); await ready(page); await shown(page, 'day');
      assert.deepEqual({ ...(await snap(page)), today: undefined }, { title: '11월 13일 금요일', date: '2026-11-13', today: undefined });
    });

    await check('midnight passes while the screen is in front: it is drawn for the new day without any return', async ({ page }) => {
      await page.clock.install({ time: new Date('2026-11-11T23:59:20+09:00') });
      await page.goto(base + '/index.html?section=schedule&view=day'); await ready(page); await shown(page, 'day');
      assert.equal((await snap(page)).title, '11월 11일 수요일');
      await page.clock.fastForward(45000);
      await titled(page, '11월 12일 목요일');
      assert.equal((await snap(page)).date, '2026-11-12');
    });

    await check('습관 화면: this month follows the new month, a chosen earlier month stays, and a check is stored for its cell', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'habit-1', kind: 'habit', data: habit([]) });
      const habits = () => page.evaluate(() => ({ month: document.querySelector('#habitMonthLabel')?.innerText, search: location.search, thisMonth: !document.querySelector('#habitThisMonth').hidden,
        today: [...document.querySelectorAll('#habitList [aria-current="date"]')].map(n => n.getAttribute('aria-label')) }));
      await at(page, '2026-11-30T23:40:00+09:00');
      await page.goto(base + '/habits.html'); await page.locator('#habitList [aria-current="date"]').waitFor();
      assert.deepEqual(await habits(), { month: '2026년 11월', search: '', thisMonth: false, today: ['아침 산책 2026-11-30 완료'] });
      await overnight(page, '2026-12-01T07:30:00+09:00');
      await page.waitForFunction(() => document.querySelector('#habitMonthLabel')?.innerText === '2026년 12월');
      const december = await habits();
      assert.deepEqual(december, { month: '2026년 12월', search: '', thisMonth: false, today: ['아침 산책 2026-12-01 완료'] });
      await page.locator('#habitList [aria-current="date"]').click();
      await page.waitForFunction(() => globalThis.HaedoPlatformStore?.items.every(item => item.state === 'ok'));
      assert.deepEqual(tables.owned('haedo_items', accounts.a.id).map(row => row.data.checks), [['2026-12-01']]);
      // A chosen earlier month stays where it is; the 오늘 mark and "이번 달" are drawn for the new day.
      await page.goto(base + '/habits.html?month=2026-11'); await page.locator('#habitList .habit-tracker-card, #habitList [data-habit]').first().waitFor();
      assert.equal((await habits()).month, '2026년 11월');
      await overnight(page, '2027-01-01T07:30:00+09:00'); await page.waitForTimeout(1200);
      assert.deepEqual(await habits(), { month: '2026년 11월', search: '?month=2026-11', thisMonth: true, today: [] });
    }, { width: 390, height: 844 });

    await check('목표 화면: a deadline that passed overnight is said after the return', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'goal-1', kind: 'goal', data: { title: '책 열두 권 읽기', progress: 40, target: '2026-11-30' } });
      await at(page, '2026-11-30T23:40:00+09:00');
      await page.goto(base + '/goals.html'); await page.locator('.goal-row').waitFor();
      assert.equal(await page.locator('.goal-copy small').innerText(), '2026-11-30 마감');
      await overnight(page, '2026-12-01T07:30:00+09:00');
      await page.waitForFunction(() => document.querySelector('.goal-copy small')?.innerText === '2026-11-30 · 마감일 지남');
    }, { width: 390, height: 844 });
  } finally { await browser.close(); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(report.pageErrors, [], 'page errors'); assert.deepEqual(report.consoleErrors, [], 'console errors');
  assert(report.checks.length && report.checks.every(item => item.pass), 'all checks pass');
  console.log(JSON.stringify({ checks: report.checks.length }));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

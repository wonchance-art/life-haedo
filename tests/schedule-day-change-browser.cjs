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
const focused = page => page.evaluate(() => document.activeElement === document.body ? 'BODY' : document.activeElement?.dataset.focusKey || document.activeElement?.tagName);
const happiness = page => page.evaluate(async () => (await HaedoLife.Shell.storage.readHappinessDays()).entries.map(entry => [entry.date, entry.v]));
// The 행복도 document's write: held open until released (hold), or refused (fail).
const patchHappinessWrite = page => page.evaluate(() => {
  window.__hold = false; window.__fail = false; const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const key = args[0]?.key, mine = typeof key === 'string' && /happiness/i.test(key);
    if (mine && window.__hold) { const store = this, spin = () => { if (window.__hold) { try { store.get('test-keepalive').onsuccess = spin; } catch (_) { /* The transaction ended. */ } } }; spin(); }
    const request = put.apply(this, args);
    if (mine && window.__fail) this.transaction.abort();
    return request;
  };
});
const held = page => page.evaluate(() => { const notice = document.querySelector('.schedule-day-held'); return { shown: !!notice && !notice.hidden, text: notice?.querySelector('p')?.innerText || '', buttons: [...(notice?.querySelectorAll('button') || [])].map(node => node.innerText),
  inert: document.querySelector('.schedule-entry-body')?.inert === true, checked: [...document.querySelectorAll('.schedule-happiness input:checked')].map(node => node.value) }; });

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

    await check('an address that names today, and today reached again with ‹ ›, follow the new day (2026-11-11 review; owner’s call recorded in schedule-consolidation.md)', async ({ page }) => {
      await at(page, '2026-11-11T23:40:00+09:00');
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-11'); await ready(page); await shown(page, 'day');
      assert.deepEqual({ ...(await snap(page)), today: undefined }, { title: '11월 11일 수요일', date: '2026-11-11', today: undefined });
      await overnight(page, '2026-11-12T07:30:00+09:00'); await titled(page, '11월 12일 목요일');
      assert.equal((await snap(page)).date, '2026-11-12');
      // Away and back to today with ‹ ›: the screen shows today again, and follows.
      await step(page, -1); await titled(page, '11월 11일 수요일'); await step(page, 1); await titled(page, '11월 12일 목요일');
      await overnight(page, '2026-11-13T07:30:00+09:00'); await titled(page, '11월 13일 금요일');
      // One day back is a chosen day: it stays.
      await step(page, -1); await titled(page, '11월 12일 목요일');
      await overnight(page, '2026-11-14T07:30:00+09:00'); await page.waitForTimeout(1200);
      assert.equal((await snap(page)).title, '11월 12일 목요일');
    });

    await check('a 행복도 choice on its way to the store holds the screen until it is stored, then the screen follows (no input is lost)', async ({ page }) => {
      await at(page, '2026-11-11T23:50:00+09:00');
      await page.goto(base + '/index.html?section=schedule&view=day'); await ready(page); await shown(page, 'day'); await entries(page);
      await patchHappinessWrite(page); await page.evaluate(() => { window.__hold = true; });
      await page.getByRole('radio', { name: '행복도 7', exact: true }).check();
      await page.waitForFunction(() => HaedoLife.ScheduleEntries.saving());
      await overnight(page, '2026-11-12T00:05:00+09:00'); await page.waitForTimeout(2500);
      assert.equal((await snap(page)).title, '11월 11일 수요일', 'the screen waits for the write');
      assert.deepEqual([await page.evaluate(() => HaedoLife.ScheduleEntries.saving()), (await held(page)).shown], [true, false]);
      await page.evaluate(() => { window.__hold = false; });
      await titled(page, '11월 12일 목요일');
      assert.deepEqual(await happiness(page), [['2026-11-11', 0.4]], 'the choice was stored for the day it was made on');
      assert.deepEqual((await held(page)).checked, [], 'the new day has no choice yet');
    });

    for (const action of ['다시 저장', '선택 취소']) {
      await check('a 행복도 choice that failed: the day changes → the screen says so and takes no other input until ' + action + ', then it opens today', async ({ page, tables }) => {
        tables.seed('haedo_items', accounts.a.id, { id: 'habit-1', kind: 'habit', data: habit([]) });
        await at(page, '2026-11-11T23:50:00+09:00');
        await page.goto(base + '/index.html?section=schedule&view=day'); await ready(page); await shown(page, 'day'); await entries(page);
        await patchHappinessWrite(page); await page.evaluate(() => { window.__fail = true; });
        await page.getByRole('radio', { name: '행복도 3', exact: true }).check();
        await page.waitForFunction(() => { const notice = document.querySelector('.schedule-happiness-error'); return notice && !notice.hidden; });
        assert.deepEqual(await page.evaluate(() => [HaedoLife.ScheduleEntries.saving(), HaedoLife.ScheduleEntries.failed()]), [false, ['2026-11-11']]);
        assert.equal((await held(page)).shown, false, 'nothing is said about the date while it is still that day');
        // No timer runs for a failed choice: count the timers armed from here to the morning after.
        await page.evaluate(() => { window.__timers = []; const arm = window.setTimeout; window.setTimeout = function (...args) { __timers.push(args[1]); return arm.apply(this, args); }; });
        await overnight(page, '2026-11-12T07:30:00+09:00');
        await page.waitForFunction(() => { const notice = document.querySelector('.schedule-day-held'); return notice && !notice.hidden; });
        const morning = await held(page);
        assert.deepEqual(morning, { shown: true, text: '날짜가 바뀌었습니다. 이 화면(11월 11일 수요일)의 행복도 3을 저장하지 못했습니다. 다시 저장하거나 취소하면 오늘 화면으로 옮깁니다.', buttons: ['다시 저장', '선택 취소'], inert: true, checked: ['3'] });
        assert.equal((await snap(page)).title, '11월 11일 수요일');
        // The earlier day takes no other input: neither a 행복도 choice nor a habit check lands on it by mistake.
        // (Read from the DOM and by a real pointer press: role queries do not see an inert subtree reliably.)
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.schedule-entries input[aria-label="행복도 9"], .schedule-entries input[type=checkbox]')].map(node => !!node.closest('[inert]'))), [true, true]);
        for (const selector of ['.schedule-entries input[aria-label="행복도 9"]', '.schedule-entries input[type=checkbox]']) {
          const box = await page.locator(selector).evaluate(node => { const r = (node.closest('label') || node).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
          await page.mouse.click(box.x, box.y);
        }
        await page.waitForTimeout(400);
        assert.deepEqual([(await held(page)).checked, await page.locator('.schedule-entries input[type=checkbox]').evaluate(node => node.checked), await happiness(page), tables.owned('haedo_items', accounts.a.id)[0].data.checks], [['3'], false, [], []], 'a press on the earlier day changes nothing');
        await page.waitForTimeout(3200);
        assert.equal((await snap(page)).title, '11월 11일 수요일', 'the screen stays for the owner');
        // The earlier wait for an unsaved choice was a 1-second timer armed again and again.
        const armed = await page.evaluate(() => __timers);
        assert.deepEqual(armed.filter(delay => delay === 1000), [], 'the held day is not polled: ' + JSON.stringify(armed));
        await page.screenshot({ path: path.join(output, 'held-day-' + (action === '다시 저장' ? 'retry' : 'discard') + '.png') });
        if (action === '다시 저장') {
          // Still failing: the screen stays and the notice keeps its focus.
          await page.locator('.schedule-day-held').getByRole('button', { name: '다시 저장', exact: true }).click();
          await page.waitForFunction(() => !HaedoLife.ScheduleEntries.saving()); await page.waitForTimeout(300);
          assert.deepEqual([(await held(page)).shown, (await snap(page)).title, await focused(page)], [true, '11월 11일 수요일', 'schedule:held:retry']);
          await page.evaluate(() => { window.__fail = false; });
        }
        await page.locator('.schedule-day-held').getByRole('button', { name: action, exact: true }).click();
        await titled(page, '11월 12일 목요일'); await entries(page);
        assert.deepEqual(await happiness(page), action === '다시 저장' ? [['2026-11-11', -0.4]] : [], action === '다시 저장' ? 'the failed choice was stored for its own day' : 'nothing was stored');
        const today = await held(page);
        assert.deepEqual([today.shown, today.inert, today.checked], [false, false, []]);
        // Focus goes to the title that names the new day, not to the page (the notice's button is gone).
        await page.waitForFunction(() => document.activeElement?.tagName === 'H1');
        await page.waitForTimeout(300); assert.equal(await focused(page), 'H1');
        // Today takes input as usual.
        await page.evaluate(() => { window.__fail = false; });
        await page.getByRole('radio', { name: '행복도 9', exact: true }).check();
        await page.waitForFunction(() => !HaedoLife.ScheduleEntries.saving() && !HaedoLife.ScheduleEntries.failed().length);
        assert.deepEqual((await happiness(page)).filter(([date]) => date === '2026-11-12'), [['2026-11-12', 0.8]]);
      });
    }

    await check('keyboard focus follows the day: the same habit’s box, the same 행복도 choice; focus that was nowhere stays nowhere', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'habit-1', kind: 'habit', data: habit([]) });
      await at(page, '2026-11-11T23:40:00+09:00');
      await page.goto(base + '/index.html?section=schedule&view=day'); await ready(page); await shown(page, 'day'); await entries(page);
      await page.getByRole('checkbox', { name: '아침 산책', exact: true }).focus();
      assert.equal(await focused(page), 'schedule:habit:habit-1:2026-11-11');
      await overnight(page, '2026-11-12T07:30:00+09:00'); await titled(page, '11월 12일 목요일'); await entries(page);
      await page.waitForFunction(() => document.activeElement?.dataset.focusKey === 'schedule:habit:habit-1:2026-11-12');
      await page.getByRole('radio', { name: '행복도 4', exact: true }).focus();
      await overnight(page, '2026-11-13T07:30:00+09:00'); await titled(page, '11월 13일 금요일'); await entries(page);
      await page.waitForFunction(() => document.activeElement?.dataset.focusKey === 'schedule:happiness:2026-11-13:4');
      assert.deepEqual((await held(page)).checked, [], 'focus alone chose nothing');
      await page.evaluate(() => document.activeElement.blur());
      await overnight(page, '2026-11-14T07:30:00+09:00'); await titled(page, '11월 14일 토요일'); await entries(page); await page.waitForTimeout(300);
      assert.equal(await focused(page), 'BODY');
      // W: the focused box of the day that was today moves to today's column of the new week.
      await at(page, '2026-11-15T23:40:00+09:00');
      await page.goto(base + '/index.html?section=schedule&view=week'); await ready(page); await shown(page, 'week'); await entries(page);
      await page.locator('[data-focus-key="schedule:habit:habit-1:2026-11-15"]').focus();
      await overnight(page, '2026-11-16T07:30:00+09:00'); await titled(page, '11.16 – 11.22'); await entries(page);
      await page.waitForFunction(() => document.activeElement?.dataset.focusKey === 'schedule:habit:habit-1:2026-11-16');
    });

    await check('Back to a screen that showed today opens today, as its reload does; Back to a chosen day opens that day', async ({ page }) => {
      await at(page, '2026-11-11T23:40:00+09:00');
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      await page.locator('[data-schedule-view="day"]').first().click(); await shown(page, 'day');
      await step(page, -1); await titled(page, '11월 10일 화요일');
      await page.locator('[data-schedule-view="week"]').first().click(); await shown(page, 'week');
      await todayButton(page).click(); await titled(page, '11.9 – 11.15');
      await page.locator('[data-schedule-view="day"]').first().click(); await shown(page, 'day'); await titled(page, '11월 11일 수요일');
      await page.locator('[data-schedule-view="month"]').first().click(); await shown(page, 'month');
      await overnight(page, '2026-11-12T07:30:00+09:00'); await page.waitForTimeout(600);
      // month ← day (showed today) ← week (showed today's week) ← day (the chosen 10th)
      await page.goBack(); await shown(page, 'day'); await titled(page, '11월 12일 목요일');
      assert.equal((await snap(page)).date, '2026-11-12');
      await page.goBack(); await shown(page, 'week'); await titled(page, '11.9 – 11.15');
      await page.goBack(); await shown(page, 'day'); await titled(page, '11월 10일 화요일');
      await page.goForward(); await shown(page, 'week'); await page.goForward(); await shown(page, 'day'); await titled(page, '11월 12일 목요일');
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

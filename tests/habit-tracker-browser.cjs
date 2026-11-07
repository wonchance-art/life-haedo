/* 습관 트래커 (2026-11-07 소유자 요청 "습관은 트래커 처럼 볼 수 있도록") on the real app, SDK and IDB
 * with the anonymous intercepted Auth and the owner-scoped in-memory haedo_items table of
 * schedule-entries-browser.cjs (server-stamped updated_at, conditional PATCH).
 * habits.html: a month per habit, toggles through the existing store, month steps, layout.
 * 일정 M: the same tracker through the 일정 save path with its two-step status.
 * npm run dev; node tests/habit-tracker-browser.cjs
 * Never uses real Google, production Supabase or Apple-device claims. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { PlatformTables } = require('./schedule-entries-browser.cjs');

const output = path.resolve(process.env.HABIT_TRACKER_OUTPUT || '.local/habit-tracker');
const TODAY = '2026-11-07T12:00:00+09:00'; // a Saturday
const report = { checks: [], consoleErrors: [], pageErrors: [], overflow: [] };
const LONG = '저녁에 일기 한 줄 쓰기와 다음 날 할 일 세 가지 적어 두기';
// Mon/Wed/Fri since October; 11-02 done. November: open 11-04, 11-06; 11-09 on is future.
const walk = { title: '아침 산책', days: [1, 3, 5], created: '2026-10-01', checks: ['2026-10-30', '2026-11-02'] };
// 11-03 is before its start: a kept check that takes no tap (and is not counted).
const daily = { title: LONG, days: [0, 1, 2, 3, 4, 5, 6], created: '2026-11-04', checks: ['2026-11-03', '2026-11-05'] };
const cell = (scope, id, date) => `[data-focus-key="${scope}:${id}:${date}"]`;
const focusKey = page => page.evaluate(() => document.activeElement?.dataset?.focusKey || document.activeElement?.id || document.activeElement?.tagName);

async function overflow(page, label) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (wide) report.overflow.push(label);
  assert.equal(wide, false, label + ': no horizontal page scroll');
}
async function habitsReady(page, count) {
  await page.waitForFunction(n => document.body.dataset.page === 'habits' && !document.querySelector('[data-private]').hidden &&
    document.querySelectorAll('#habitList .habit-tracker-card').length === n, count);
}
async function scheduleMonth(page) {
  await page.waitForFunction(() => document.querySelector('#lifeMain')?.dataset.mode === 'month' && document.querySelector('#lifeSchedule')?.getAttribute('aria-busy') === 'false');
  await page.waitForFunction(() => { const slot = document.querySelector('.schedule-entries-month'); return slot && slot.getAttribute('aria-busy') === 'false' && slot.querySelector('.schedule-entry-body')?.childElementCount > 0; });
}
// Every visible day cell is a 44px target; cards fit their column; nothing scrolls sideways.
async function layout(page, scope, label) {
  await overflow(page, label);
  // Queried and measured in one evaluation: locator.evaluateAll resolves the nodes first and runs
  // later, and the 일정 slot repaints on store notices in between (the old cells were then detached,
  // 0 × 0). Measured here, every cell is the one in the page.
  const { sizes, outside } = await page.evaluate(selector => ({
    sizes: [...document.querySelectorAll(selector + ' .habit-tracker-day')].map(n => { const b = n.getBoundingClientRect(); return [b.width, b.height]; }),
    outside: [...document.querySelectorAll(selector + ' .habit-tracker-card')].filter(card => {
      const box = card.getBoundingClientRect(), grid = card.querySelector('.habit-tracker-grid').getBoundingClientRect();
      return grid.right > box.right + 1 || box.right > innerWidth;
    }).length,
  }), scope);
  assert.ok(sizes.length >= 30, label + ': the month is shown (' + sizes.length + ' cells)');
  const small = sizes.filter(([w, h]) => w < 44 || h < 44).map(([w, h]) => Math.round(w) + '×' + Math.round(h));
  assert.deepEqual(small, [], label + ': day cells are at least 44 × 44');
  assert.equal(outside, 0, label + ': each month grid stays inside its card');
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, run, viewport = { width: 1440, height: 960 }) {
    if (process.env.HABIT_TRACKER_MATCH && !new RegExp(process.env.HABIT_TRACKER_MATCH).test(name)) return;
    const server = new FakeCloud(), tables = new PlatformTables('2026-11-07T02:00:00Z'), device = 'tracker-' + report.checks.length;
    const context = await makeContext(browser, server, device, accounts.a, { viewport, timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
    await tables.attach(context);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    await page.clock.setFixedTime(new Date(TODAY));
    page.on('pageerror', error => report.pageErrors.push({ check: name, message: error.message }));
    page.on('console', event => {
      if (event.type() !== 'error') return;
      // A check that blocks a module on purpose expects exactly that failed request (that file only).
      const url = event.location()?.url || '';
      if (/Failed to load resource/.test(event.text()) && (page.__expectBlocked || []).some(file => new URL(url, base).pathname.endsWith('/assets/' + file))) {
        report.expectedErrors = (report.expectedErrors || 0) + 1; return;
      }
      report.consoleErrors.push({ check: name, message: event.text() });
    });
    console.log('RUN ' + name);
    try { await run({ page, context, tables }); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  const seed = tables => {
    tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: walk.title, data: walk });
    tables.seed('haedo_items', accounts.a.id, { id: 'h2', kind: 'habit', name: daily.title, data: daily });
  };
  try {
    await check('habits.html shows each habit as this month: done filled, open outlined, the rest disabled', async ({ page, tables }) => {
      seed(tables);
      // Saturdays only, with a check kept on a Wednesday (the days were changed later).
      tables.seed('haedo_items', accounts.a.id, { id: 'h3', kind: 'habit', name: '주말 정리', data: { title: '주말 정리', days: [6], created: '2026-10-01', checks: ['2026-11-04'] } });
      await page.goto(base + '/habits.html'); await habitsReady(page, 3);
      assert.equal(await page.locator('#habitMonthLabel').textContent(), '2026년 11월');
      assert.equal(await page.locator('#habitMonthLabel').getAttribute('aria-live'), 'polite', 'a month change is announced');
      assert.equal(await page.getByRole('button', { name: '다음 달' }).isDisabled(), true, 'not past the current month');
      assert.equal(await page.locator('#habitThisMonth').isHidden(), true);
      const card = page.locator('.habit-tracker-card[data-habit="h1"]');
      assert.equal(await card.locator('.habit-tracker-summary').textContent(), '이번 달 1/3회 · 연속 0회 · 월, 수, 금');
      assert.deepEqual(await card.locator('.habit-tracker-weekday').allTextContents(), ['월', '화', '수', '목', '금', '토', '일']);
      // 11-01 is a Sunday: six leading blanks in a Monday-first grid.
      assert.equal(await card.locator('.habit-tracker-blank').count(), 6);
      const cells = await card.locator('.habit-tracker-day').evaluateAll(nodes => nodes.map(n => [n.dataset.date.slice(8), n.dataset.state, n.disabled, n.getAttribute('aria-pressed')]));
      assert.equal(cells.length, 30);
      const at = day => cells.find(c => c[0] === day);
      assert.deepEqual(at('02'), ['02', 'done', false, 'true']);
      assert.deepEqual(at('04'), ['04', 'open', false, 'false']);
      assert.deepEqual(at('05'), ['05', 'off', true, 'false'], 'Thursday is not scheduled');
      assert.deepEqual(at('09'), ['09', 'future', true, 'false'], 'a scheduled day after today');
      assert.equal(cells.filter(c => !c[2]).length, 3, 'only 11-02, 11-04, 11-06 take a tap');
      assert.equal(await card.locator('[aria-current=date]').getAttribute('data-date'), '2026-11-07');
      // Today: a short straight line under the bold number (not a shadow that bends with the corners).
      const todayMark = await page.evaluate(() => [...document.querySelectorAll('#habitList [aria-current=date]')].map(n => {
        const line = getComputedStyle(n.querySelector('.habit-tracker-number'), '::after');
        return [n.dataset.state, getComputedStyle(n).boxShadow, getComputedStyle(n).fontWeight, line.width, line.height, line.backgroundColor];
      }));
      assert.deepEqual(todayMark, [['off', 'none', '750', '16px', '2px', 'rgb(20, 91, 80)'], ['open', 'none', '750', '16px', '2px', 'rgb(20, 91, 80)'], ['open', 'none', '750', '16px', '2px', 'rgb(20, 91, 80)']]);
      assert.equal(await card.getByRole('button', { name: '아침 산책 2026-11-02 완료 취소' }).count(), 1);
      assert.equal(await card.getByRole('button', { name: '아침 산책 2026-11-04 완료', exact: true }).count(), 1);
      // Created mid-month: days before 11-04 take no tap; 11-05 done.
      const second = page.locator('.habit-tracker-card[data-habit="h2"]');
      assert.equal(await second.locator('.habit-tracker-summary').textContent(), '이번 달 1/4회 · 연속 0회 · 월, 화, 수, 목, 금, 토, 일');
      assert.equal(await second.locator(cell('habits', 'h2', '2026-11-03')).isDisabled(), true);
      // Kept checks that take no tap say why instead of offering "완료 취소".
      const kept = async (id, date) => page.locator('#habitList ' + cell('habits', id, date)).evaluate(n => [n.dataset.state, n.disabled, n.getAttribute('aria-label')]);
      assert.deepEqual(await kept('h2', '2026-11-03'), ['done', true, LONG + ' 2026-11-03 완료(시작 전)']);
      assert.deepEqual(await kept('h3', '2026-11-04'), ['done', true, '주말 정리 2026-11-04 완료(정한 요일 아님)']);
      assert.equal(await page.locator('.habit-tracker-card[data-habit="h3"] .habit-tracker-summary').textContent(), '이번 달 0/1회 · 연속 0회 · 토', 'the kept check is not counted');
      assert.equal(await second.locator(cell('habits', 'h2', '2026-11-07')).isDisabled(), false, 'today is open');
      // Done is the ink fill with white (contrast on the real white surface).
      // Styles and boxes are read in one page evaluation (a locator resolves first and runs later; a repaint
      // in between would hand over a detached cell).
      const look = await page.evaluate(sel => { const n = document.querySelector('#habitList ' + sel), s = getComputedStyle(n); return [s.backgroundColor, s.color, getComputedStyle(n.closest('main')).backgroundColor]; }, cell('habits', 'h1', '2026-11-02'));
      assert.deepEqual(look, ['rgb(24, 37, 34)', 'rgb(255, 255, 255)', 'rgb(255, 255, 255)']);
      assert.match(await page.locator('.habit-note').textContent(), /정한 요일의 오늘까지 날짜를 체크하거나 취소할 수 있습니다\./);
      assert.doesNotMatch(await page.locator('#content').innerText(), /지난 7일/);
    });

    await check('a tap saves through the store and reaches the account; focus stays on the same day; the title opens the editor', async ({ page, tables }) => {
      seed(tables);
      await page.goto(base + '/habits.html'); await habitsReady(page, 2);
      await page.waitForFunction(() => HaedoPlatformStore.items.every(i => i.state === 'ok'));
      const day = page.locator(cell('habits', 'h1', '2026-11-04'));
      await day.click();
      await page.waitForFunction(() => document.querySelector('[data-focus-key="habits:h1:2026-11-04"]')?.getAttribute('aria-pressed') === 'true');
      assert.equal(await focusKey(page), 'habits:h1:2026-11-04', 'focus stays on the day after the repaint');
      assert.deepEqual(await page.evaluate(id => JSON.parse(localStorage.getItem('caeyeon_life_account_' + id + '_items')).find(i => i.id === 'h1').data.checks, accounts.a.id),
        ['2026-10-30', '2026-11-02', '2026-11-04'], 'the device copy first');
      await page.waitForFunction(() => HaedoPlatformStore.items.every(i => i.state === 'ok'), null, { timeout: 10000 });
      assert.deepEqual(tables.rows.haedo_items.get('h1').data.checks, ['2026-10-30', '2026-11-02', '2026-11-04'], 'then the account');
      assert.equal(await page.locator('.habit-tracker-card[data-habit="h1"] .habit-tracker-summary').textContent(), '이번 달 2/3회 · 연속 0회 · 월, 수, 금');
      // Keyboard: Enter on the focused day cancels it, focus still there.
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('[data-focus-key="habits:h1:2026-11-04"]')?.getAttribute('aria-pressed') === 'false');
      assert.equal(await focusKey(page), 'habits:h1:2026-11-04');
      await page.waitForFunction(() => HaedoPlatformStore.items.every(i => i.state === 'ok'), null, { timeout: 10000 });
      assert.deepEqual(tables.rows.haedo_items.get('h1').data.checks, ['2026-10-30', '2026-11-02']);
      // Tab moves to the next day that takes a tap (disabled days are skipped).
      await page.keyboard.press('Tab');
      assert.equal(await focusKey(page), 'habits:h1:2026-11-06');
      // A disabled future day: a forced click changes nothing.
      await page.locator(cell('habits', 'h1', '2026-11-09')).click({ force: true });
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => HaedoPlatformStore.items.find(i => i.id === 'h1').data.checks.includes('2026-11-09')), false);
      // The title still opens the existing edit dialog.
      await page.getByRole('button', { name: '아침 산책 수정' }).click();
      await page.locator('#itemDialog[open]').waitFor();
      assert.equal(await page.locator('#itemTitle').inputValue(), '아침 산책');
      assert.equal(await page.locator('#itemDialogTitle').textContent(), '습관 수정');
    });

    await check('the previous month is shown and checkable; the month never goes past the current one', async ({ page, tables }) => {
      seed(tables);
      await page.goto(base + '/habits.html'); await habitsReady(page, 2);
      await page.getByRole('button', { name: '이전 달' }).click();
      assert.equal(await page.locator('#habitMonthLabel').textContent(), '2026년 10월');
      assert.equal(await page.getByRole('button', { name: '다음 달' }).isDisabled(), false);
      assert.equal(await page.locator('#habitThisMonth').isVisible(), true, '이번 달 returns');
      const card = page.locator('.habit-tracker-card[data-habit="h1"]');
      // October: 13 Mon/Wed/Fri days (10-01 is a Thursday; Fri 2 to Fri 30); 10-30 is done.
      assert.equal(await card.locator('.habit-tracker-summary').textContent(), '10월 1/13회 · 연속 0회 · 월, 수, 금');
      assert.equal(await card.locator('.habit-tracker-day').count(), 31);
      assert.equal(await page.locator('.habit-tracker-card[data-habit="h2"] .habit-tracker-day:not(:disabled)').count(), 0, 'created in November: nothing to tap in October');
      await card.locator(cell('habits', 'h1', '2026-10-28')).click();
      await page.waitForFunction(() => HaedoPlatformStore.items.every(i => i.state === 'ok') && HaedoPlatformStore.items.find(i => i.id === 'h1').data.checks.includes('2026-10-28'), null, { timeout: 10000 });
      assert.equal(await focusKey(page), 'habits:h1:2026-10-28');
      assert.ok(tables.rows.haedo_items.get('h1').data.checks.includes('2026-10-28'));
      await page.getByRole('button', { name: '이전 달' }).click();
      assert.equal(await page.locator('#habitMonthLabel').textContent(), '2026년 9월');
      await page.getByRole('button', { name: '다음 달' }).click();
      await page.getByRole('button', { name: '다음 달' }).click();
      assert.equal(await page.locator('#habitMonthLabel').textContent(), '2026년 11월');
      assert.equal(await page.getByRole('button', { name: '다음 달' }).isDisabled(), true);
      assert.equal(await focusKey(page), 'habitMonthLabel', 'the disabled 다음 달 hands focus to the month label');
      await page.getByRole('button', { name: '다음 달' }).click({ force: true });
      assert.equal(await page.locator('#habitMonthLabel').textContent(), '2026년 11월', 'a forced click does not go past');
      await page.getByRole('button', { name: '이전 달' }).click();
      await page.locator('#habitThisMonth').click();
      assert.equal(await page.locator('#habitMonthLabel').textContent(), '2026년 11월');
      assert.equal(await page.locator('#habitThisMonth').isHidden(), true);
      assert.equal(await focusKey(page), 'habitMonthLabel');
    });

    await check('no habits: the empty state and its 습관 추가 stay; the back link keeps the legacy address', async ({ page }) => {
      await page.goto(base + '/habits.html');
      await page.waitForFunction(() => document.body.dataset.page === 'habits' && !document.querySelector('[data-private]').hidden && document.querySelector('#habitList .p-empty'));
      assert.match(await page.locator('#habitList').innerText(), /반복하고 싶은 일을 정해보세요\./);
      await page.locator('#habitList').getByRole('button', { name: '습관 추가' }).click();
      await page.locator('#itemDialog[open]').waitFor();
      assert.equal(await page.locator('#itemDialogTitle').textContent(), '습관 추가');
      assert.equal(await page.locator('[data-section-back]').getAttribute('href'), 'index.html?section=tools');
    });

    await check('a cell of a habit no longer in the list saves nothing, says so and repaints', async ({ page, tables }) => {
      seed(tables);
      await page.goto(base + '/habits.html'); await habitsReady(page, 2);
      await page.waitForFunction(() => HaedoPlatformStore.items.every(i => i.state === 'ok'));
      // Removed while this card stays on screen (the repaint notice is held back once).
      await page.evaluate(() => { const hold = event => event.stopImmediatePropagation();
        document.addEventListener('haedo:store', hold, { capture: true }); HaedoPlatformStore.remove('h1'); document.removeEventListener('haedo:store', hold, { capture: true }); });
      assert.equal(await page.locator('.habit-tracker-card[data-habit="h1"]').count(), 1, 'the old card is still shown');
      await page.locator(cell('habits', 'h1', '2026-11-04')).click();
      await page.locator('#platformToast').filter({ hasText: '습관을 찾지 못했습니다. 화면을 다시 열어 주세요.' }).waitFor();
      assert.equal(await page.locator('.habit-tracker-card[data-habit="h1"]').count(), 0, 'repainted without it');
      assert.equal(await page.evaluate(() => HaedoPlatformStore.items.some(i => i.id === 'h1')), false, 'not brought back');
      const stored = await page.evaluate(id => JSON.parse(localStorage.getItem('caeyeon_life_account_' + id + '_items')).find(i => i.id === 'h1').data, accounts.a.id);
      assert.equal(stored.deleted, true);
      assert.deepEqual(stored.checks, ['2026-10-30', '2026-11-02'], 'no check added to the removed habit');
    });

    for (const blocked of ['habit-tracker.js', 'habit-tracker.css']) await check('a failed ' + blocked + ' falls back only in 일정 M; W and D keep their habit checks', async ({ page, context, tables }) => {
      seed(tables);
      page.__expectBlocked = [blocked];
      const asked = [];
      await context.route('**/assets/' + blocked, route => { asked.push(new URL(page.url()).searchParams.get('view')); return route.abort(); });
      await page.goto(base + '/index.html?section=schedule&view=week&date=2026-11-07'); await ready(page);
      await page.locator('.schedule-entries-week .schedule-habit-grid input[type=checkbox]').first().waitFor();
      assert.ok(await page.locator('.schedule-entries-week .schedule-habit-grid input[type=checkbox]').count() >= 3);
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-06'); await ready(page);
      await page.locator('.schedule-entries-day').getByRole('checkbox', { name: '아침 산책', exact: true }).waitFor();
      assert.deepEqual(asked, [], 'W and D do not ask for the tracker');
      await page.goto(base + '/index.html?section=schedule&view=month&date=2026-11-07'); await ready(page);
      await page.waitForFunction(() => document.querySelector('.schedule-entries-month')?.getAttribute('aria-busy') === 'false');
      await page.locator('.schedule-entries-month').getByRole('link', { name: '습관 체크' }).waitFor();
      assert.equal(await page.locator('.schedule-entries-month .habit-tracker-day').count(), 0, 'no unstyled or partial tracker');
      assert.deepEqual([...new Set(asked)], ['month'], 'only the month slot asks for it');
    });

    // One file fails while the other is still on its way (re-review MINOR): the slot asks again (first
    // frame, refresh frame, a month step) and must reuse the pending file, not add a second tag.
    for (const [failing, slow] of [['habit-tracker.css', 'habit-tracker.js'], ['habit-tracker.js', 'habit-tracker.css']]) await check('a failed ' + failing + ' while ' + slow + ' is slow adds each tag once and the month still shows', async ({ page, context, tables }) => {
      seed(tables);
      page.__expectBlocked = [failing];
      let failed = 0, slowAsked = 0;
      await context.route('**/assets/' + failing, route => { if (failed++ === 0) return route.abort(); return route.continue(); });
      await context.route('**/assets/' + slow, async route => {
        slowAsked++;
        const response = await route.fetch();
        await new Promise(done => setTimeout(done, 2000));
        // Counts how many times the tracker script runs.
        const body = slow.endsWith('.js') ? (await response.text()) + '\n;window.__trackerRuns = (window.__trackerRuns || 0) + 1;' : undefined;
        return route.fulfill({ response, body });
      });
      await page.goto(base + '/index.html?section=schedule&view=month&date=2026-11-07'); await ready(page); await scheduleMonth(page);
      // Wait until the slow file is in, then step the month and back (a person retrying).
      await page.waitForTimeout(2600);
      const stepped = !(await page.locator('.schedule-entries-month .habit-tracker-day').count());
      if (stepped) {
        await page.locator('[data-schedule-step="1"]').click(); await scheduleMonth(page);
        await page.locator('[data-schedule-step="-1"]').click(); await scheduleMonth(page);
      }
      console.log('  (' + failing + ' failed first; month shown ' + (stepped ? 'after a month step' : 'without a step') + ')');
      await page.waitForFunction(() => document.querySelectorAll('.schedule-entries-month .habit-tracker-day').length >= 30, null, { timeout: 10000 });
      const tags = await page.evaluate(() => ({ scripts: document.querySelectorAll('script[src$="assets/habit-tracker.js"]').length, links: document.querySelectorAll('link[href$="assets/habit-tracker.css"]').length, runs: window.__trackerRuns ?? null }));
      assert.deepEqual({ scripts: tags.scripts, links: tags.links }, { scripts: 1, links: 1 }, 'one tag each');
      if (slow.endsWith('.js')) assert.equal(tags.runs, 1, 'the tracker script ran once');
      assert.equal(slowAsked, 1, 'the slow file was asked for once');
      assert.equal(failed, 2, 'the failed file was asked for again once');
    });

    for (const width of [1440, 820, 390]) await check('habits.html fits ' + width + ' (44px days, no sideways scroll)', async ({ page, tables }) => {
      seed(tables);
      tables.seed('haedo_items', accounts.a.id, { id: 'h3', kind: 'habit', name: '물 마시기', data: { title: '물 마시기', days: [0, 6], created: '2026-09-01', checks: ['2026-11-01', '2026-11-07'] } });
      await page.goto(base + '/habits.html'); await habitsReady(page, 3);
      // A done today keeps its mark: a white line on the ink fill.
      const doneToday = await page.evaluate(() => { const n = document.querySelector('#habitList [data-focus-key="habits:h3:2026-11-07"]');
        const line = getComputedStyle(n.querySelector('.habit-tracker-number'), '::after'), box = n.getBoundingClientRect(), mark = n.querySelector('.habit-tracker-number').getBoundingClientRect();
        return [n.dataset.state, n.getAttribute('aria-current'), getComputedStyle(n).backgroundColor, line.backgroundColor, line.width, mark.bottom + 4 <= box.bottom - 4]; });
      assert.deepEqual(doneToday, ['done', 'date', 'rgb(24, 37, 34)', 'rgb(255, 255, 255)', '16px', true]);
      await layout(page, '#habitList', 'habits ' + width);
      const columns = await page.evaluate(() => new Set([...document.querySelectorAll('#habitList .habit-tracker-card')].map(c => Math.round(c.getBoundingClientRect().left))).size);
      if (width >= 1440) assert.equal(columns, 2, 'two columns in the 720px content column');
      if (width <= 390) assert.equal(columns, 1, 'one column on a phone');
      const title = await page.evaluate(() => { const n = document.querySelector('.habit-tracker-card[data-habit="h2"] .habit-tracker-title strong'); return [n.textContent, n.clientWidth > 0 && n.scrollWidth <= n.clientWidth + 1]; });
      assert.deepEqual(title, [LONG, true], 'a long title wraps, not cut');
      await page.screenshot({ path: path.join(output, 'habits-' + width + '.png'), fullPage: true });
    }, { width, height: width <= 390 ? 844 : 960 });

    await check('일정 M shows the tracker; a tap goes through the 일정 save path with its two-step status', async ({ page, tables }) => {
      seed(tables);
      await page.goto(base + '/index.html?section=schedule&view=month&date=2026-11-07'); await ready(page); await scheduleMonth(page);
      await page.waitForFunction(() => HaedoPlatformStore.items.length === 2 && document.querySelectorAll('.schedule-entries-month .habit-tracker-card').length === 2);
      const slot = page.locator('.schedule-entries-month');
      assert.equal(await slot.locator('.habit-tracker-card[data-habit="h1"] .habit-tracker-summary').textContent(), '이번 달 1/3회 · 연속 0회 · 월, 수, 금');
      assert.equal(await slot.locator('.habit-tracker-card').first().locator('h4').textContent(), '아침 산책');
      assert.equal(await slot.getAttribute('aria-label'), '이 달 습관');
      assert.equal(await slot.locator('[aria-label="이 달 습관"]').count(), 0, 'named once, by the slot');
      const day = slot.locator(cell('schedule:month-habit', 'h1', '2026-11-04'));
      await day.click();
      await slot.locator('.schedule-entry-status').filter({ hasText: '계정에 올리기 대기' }).waitFor();
      await slot.locator('.schedule-entry-status').filter({ hasText: '저장됨 · 계정에 올림' }).waitFor({ timeout: 10000 });
      assert.deepEqual(tables.rows.haedo_items.get('h1').data.checks, ['2026-10-30', '2026-11-02', '2026-11-04']);
      assert.equal(await day.getAttribute('aria-pressed'), 'true');
      assert.equal(await focusKey(page), 'schedule:month-habit:h1:2026-11-04', 'focus stays on the day');
      // Two quick taps on the same day: each from the stored state, stored as shown.
      await day.click(); await day.click();
      await page.waitForFunction(() => document.querySelector('.schedule-entry-status')?.dataset.state === 'ok', null, { timeout: 10000 });
      await page.waitForTimeout(300);
      assert.equal(await day.getAttribute('aria-pressed'), 'true');
      assert.deepEqual(tables.rows.haedo_items.get('h1').data.checks, ['2026-10-30', '2026-11-02', '2026-11-04']);
      assert.equal(await slot.locator(cell('schedule:month-habit', 'h1', '2026-11-09')).isDisabled(), true, 'future day');
      assert.equal(await slot.locator(cell('schedule:month-habit', 'h1', '2026-11-05')).isDisabled(), true, 'not scheduled');
      // A later month: nothing to tap. The calendar's own step changes the month (no tracker arrows here).
      await page.goto(base + '/index.html?section=schedule&view=month&date=2026-12-01'); await ready(page); await scheduleMonth(page);
      await page.waitForFunction(() => document.querySelectorAll('.schedule-entries-month .habit-tracker-card').length === 2);
      assert.equal(await page.locator('.schedule-entries-month .habit-tracker-day:not(:disabled)').count(), 0);
      assert.equal(await page.locator('.schedule-entries-month .habit-tracker-card[data-habit="h1"] .habit-tracker-summary').textContent(), '12월 0/0회 · 연속 0회 · 월, 수, 금');
      // The week panel stays as it was (checkbox grid).
      await page.goto(base + '/index.html?section=schedule&view=week&date=2026-11-07'); await ready(page);
      await page.locator('.schedule-habit-grid input[type=checkbox]').first().waitFor();
      assert.equal(await page.locator('.schedule-entries .habit-tracker').count(), 0);
    });

    await check('일정 M with no habit that month says so', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: walk.title, data: { ...walk, created: '2026-12-01' } });
      await page.goto(base + '/index.html?section=schedule&view=month&date=2026-11-07'); await ready(page); await scheduleMonth(page);
      await page.waitForFunction(() => HaedoPlatformStore.items.length === 1);
      await page.locator('.schedule-entries-month').getByText('이 달에 할 습관이 없어요.').waitFor();
    });

    for (const width of [1440, 820, 390]) await check('일정 M fits ' + width + ' with the tracker', async ({ page, tables }) => {
      seed(tables);
      await page.goto(base + '/index.html?section=schedule&view=month&date=2026-11-07'); await ready(page); await scheduleMonth(page);
      await page.waitForFunction(() => document.querySelectorAll('.schedule-entries-month .habit-tracker-card').length === 2);
      await layout(page, '.schedule-entries-month', 'schedule month ' + width);
      await page.screenshot({ path: path.join(output, 'schedule-month-' + width + '.png'), fullPage: true });
    }, { width, height: width <= 390 ? 844 : 960 });
  } finally { await browser.close(); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(report.pageErrors, [], 'page errors'); assert.deepEqual(report.consoleErrors, [], 'console errors');
  assert(report.checks.length && report.checks.every(item => item.pass), 'all checks pass');
  console.log(JSON.stringify({ checks: report.checks.length }));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

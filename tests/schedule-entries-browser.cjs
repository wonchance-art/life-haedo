/* B2 일정 습관·행복도·목표 입력 (2026-11-04) on the real app, SDK and IDB with the anonymous
 * intercepted Auth. haedo_items / haedo_documents are in-memory tables here: owner-scoped like
 * RLS, server-stamped updated_at (haedo_stamp) and conditional PATCH, so a conflict is a real CAS
 * failure. npm run dev; node tests/schedule-entries-browser.cjs
 * Never uses real Google, production Supabase or Apple-device claims. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');

const output = path.resolve(process.env.SCHEDULE_ENTRIES_OUTPUT || '.local/schedule-entries-browser');
// Finds and measures in one evaluation. locator.evaluateAll() resolves the nodes in one round trip and runs the
// function in the next; the slot rebuilds on store notices, so a node resolved first could be detached (0 × 0) by then.
const measureAll = (page, selector, run) => page.evaluate(({ selector, source }) => new Function('nodes', 'return (' + source + ')(nodes)')([...document.querySelectorAll(selector)]), { selector, source: run.toString() });
const TODAY = '2026-11-03T12:00:00+09:00'; // a Tuesday
const report = { checks: [], consoleErrors: [], pageErrors: [], overflow: [], expectedErrors: 0 };
const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS', 'content-type': 'application/json' };

// Owner-scoped tables with a server clock (later than the page's fixed clock by default).
class PlatformTables {
  constructor(start = '2026-11-03T04:00:00Z') { this.rows = { haedo_items: new Map(), haedo_documents: new Map() }; this.clock = Date.parse(start); this.fail = null; this.hold = null; this.calls = []; }
  stamp() { this.clock += 1000; return new Date(this.clock).toISOString(); }
  seed(table, owner, row) { const next = { ...row, user_id: owner, updated_at: this.stamp() }; this.rows[table].set(row.id, next); return next; }
  owned(table, owner) { return [...this.rows[table].values()].filter(row => row.user_id === owner); }
  async attach(context) {
    await context.route(new RegExp('^' + cloud.replace(/[.]/g, '\\.') + '/rest/v1/haedo_(items|documents)'), async route => {
      const request = route.request(), url = new URL(request.url()), table = url.pathname.split('/').pop(), method = request.method();
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
      const bearer = request.headers().authorization?.replace(/^Bearer /i, '') || '';
      let owner = null; try { owner = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url')).sub; } catch (_) {}
      if (!owner) return route.fulfill({ status: 401, headers, body: '{}' });
      this.calls.push({ table, method, owner });
      if (this.hold) await this.hold;
      if (this.fail && method !== 'GET' && this.fail === table) return route.fulfill({ status: 500, headers, body: '{"message":"anonymous failure"}' });
      const rows = this.rows[table], id = url.searchParams.get('id')?.replace(/^eq\./, ''), seen = url.searchParams.get('updated_at')?.replace(/^eq\./, '');
      const send = value => route.fulfill({ status: 200, headers, body: JSON.stringify(value) });
      if (method === 'GET') return send(id ? (rows.get(id)?.user_id === owner ? [rows.get(id)] : []) : this.owned(table, owner));
      const body = request.postDataJSON();
      if (method === 'POST') {
        const row = { ...body[0], user_id: owner, updated_at: this.stamp() };
        if (rows.has(row.id)) return route.fulfill({ status: 409, headers, body: '{}' });
        rows.set(row.id, row); return send([row]);
      }
      if (method === 'PATCH') {
        const row = rows.get(id);
        if (!row || row.user_id !== owner || row.updated_at !== seen) return send([]);
        const next = { ...row, ...body, user_id: owner, updated_at: this.stamp() }; rows.set(id, next); return send([next]);
      }
      return route.fulfill({ status: 405, headers, body: '{}' });
    });
  }
}
const habitData = checks => ({ title: '아침 산책', days: [0, 1, 2, 3, 4, 5, 6], created: '2026-10-26', checks });
const goalData = progress => ({ title: '책 열두 권 읽기', progress, target: '2026-12-31' });
const entryText = page => page.locator('.schedule-entries').first().innerText();
const statusOf = page => page.locator('.schedule-entry-status').first();
async function shown(page, mode) {
  await page.waitForFunction(m => document.querySelector('#lifeMain')?.dataset.mode === m && document.querySelector('#lifeSchedule')?.getAttribute('aria-busy') === 'false', mode);
}
async function entries(page) { await page.waitForFunction(() => { const slot = document.querySelector('.schedule-entries'); return slot && slot.getAttribute('aria-busy') === 'false' && slot.dataset.happiness !== 'loading' && slot.querySelector('.schedule-entry-body')?.childElementCount > 0; }); }
async function overflow(page, label) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (wide) report.overflow.push(label);
  assert.equal(wide, false, label + ': no horizontal page scroll');
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, run, viewport = { width: 1440, height: 960 }) {
    if (process.env.SCHEDULE_ENTRIES_MATCH && !new RegExp(process.env.SCHEDULE_ENTRIES_MATCH).test(name)) return;
    const server = new FakeCloud(), tables = new PlatformTables(), device = 'entries-' + report.checks.length;
    const context = await makeContext(browser, server, device, accounts.a, { viewport, timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
    await tables.attach(context);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    await page.clock.setFixedTime(new Date(TODAY));
    page.on('pageerror', error => report.pageErrors.push({ check: name, message: error.message }));
    page.on('console', event => {
      if (event.type() !== 'error') return;
      if (page.__expectFailure && /Failed to load resource:.*500/.test(event.text())) { report.expectedErrors++; return; }
      report.consoleErrors.push({ check: name, message: event.text() });
    });
    console.log('RUN ' + name);
    try { await run({ page, context, server, tables, device }); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    await check('the first screen loads no goal/habit store; opening a day loads it and shows the device copy', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: habitData(['2026-11-02']) });
      const scripts = []; page.on('request', request => { const p = new URL(request.url()).pathname; if (/\/assets\/(sync|platform-store)\.js$|schedule-entries\.js$/.test(p)) scripts.push(p); });
      await page.goto(base + '/index.html'); await ready(page);
      await page.waitForFunction(() => document.querySelector('#lifeMain')?.dataset.mode === 'home' && document.querySelector('#homePostList, .home-empty, #homeComposition'));
      await page.waitForTimeout(800);
      assert.deepEqual(scripts, [], 'the 일정 list does not load the store');
      assert.equal(await page.evaluate(() => typeof HaedoPlatformStore), 'undefined');
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-02'); await ready(page); await shown(page, 'day'); await entries(page);
      assert.deepEqual(scripts.sort(), ['/assets/life/schedule-entries.js', '/assets/platform-store.js', '/assets/sync.js']);
      const box = page.getByRole('checkbox', { name: '아침 산책', exact: true });
      await box.waitFor(); assert.equal(await box.isChecked(), true, 'the server check of 11-02 is shown');
      // 2026-11-04 owner decision (happiness-single-writer.md): 행복도 is entered in 일정 D, 0–10.
      assert.equal(await page.locator('.schedule-entries').getByRole('radio').count(), 11, '행복도 0–10 is entered here');
    });

    await check('a habit check saves on the device first, then reaches the account (two-step state)', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: habitData([]) });
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-03'); await ready(page); await shown(page, 'day'); await entries(page);
      await page.waitForFunction(() => HaedoPlatformStore.items.length === 1);
      assert.equal(await page.evaluate(id => JSON.parse(localStorage.getItem('caeyeon_life_account_' + id + '_registry') || '{"docs":[]}').docs.length, accounts.a.id), 0, 'viewing creates no timeline');
      await page.getByRole('checkbox', { name: '아침 산책', exact: true }).check();
      await statusOf(page).filter({ hasText: '계정에 올리기 대기' }).waitFor();
      await statusOf(page).filter({ hasText: '저장됨 · 계정에 올림' }).waitFor({ timeout: 10000 });
      assert.deepEqual(tables.rows.haedo_items.get('h1').data.checks, ['2026-11-03']);
      // Reopening shows the saved check.
      await page.reload(); await ready(page); await shown(page, 'day'); await entries(page);
      assert.equal(await page.getByRole('checkbox', { name: '아침 산책', exact: true }).isChecked(), true);
      assert.equal(tables.owned('haedo_documents', accounts.a.id).length, 0, 'no timeline was made');
    });

    // 2026-11-04 owner decision (happiness-single-writer.md): 일정 D enters 행복도 into the account
    // document (happinessDays). The timeline keeps its own points: the 일정 never writes a timeline.
    await check('the 일정 shows a timeline\'s 행복도 as the chosen score and never writes a timeline or its list', async ({ page, tables }) => {
      const doc = { profile: { name: '내 연표', birth: '1990-01' }, scale: 'signed1', events: [], spans: [], eras: [], happiness: [{ date: '2026-11-03', v: 0.6 }], thoughts: [], records: [], trips: [], layers: [] };
      tables.seed('haedo_documents', accounts.a.id, { id: 'd_timeline', name: '내 연표', data: doc });
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-03'); await ready(page); await shown(page, 'day'); await entries(page);
      await page.waitForFunction(() => document.querySelector('.schedule-happiness input[value="8"]')?.checked);
      // Nor on the device: the timeline's body and the document list stay exactly as they were
      // (watched through every localStorage write the page makes from here on).
      const keys = await page.evaluate(id => ['caeyeon_life_account_' + id + '_registry', 'caeyeon_life_account_' + id + '_doc_d_timeline'], accounts.a.id);
      const before = await page.evaluate(list => list.map(key => localStorage.getItem(key)), keys);
      await page.evaluate(list => { window.__docWrites = []; const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) { if (list.includes(key)) window.__docWrites.push(key); return set.call(this, key, value); }; }, keys);
      await page.getByRole('radio', { name: '행복도 9' }).check();
      await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); dispatchEvent(new Event('online')); });
      await page.waitForTimeout(1500);
      assert.deepEqual(await page.evaluate(() => window.__docWrites), [], 'no write to the timeline or the list');
      assert.deepEqual(await page.evaluate(list => list.map(key => localStorage.getItem(key)), keys), before);
      assert.equal(tables.calls.filter(call => call.table === 'haedo_documents' && call.method !== 'GET').length, 0, 'the 일정 sent no timeline');
      assert.equal(tables.rows.haedo_documents.get('d_timeline').data.happiness[0].v, 0.6, 'the timeline keeps its own point');
    });

    await check('a future day cannot be checked; a repeated click toggles from the stored state', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: habitData([]) });
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-05'); await ready(page); await shown(page, 'day'); await entries(page);
      assert.equal(await page.getByRole('checkbox', { name: '아침 산책', exact: true }).isDisabled(), true);
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-03'); await ready(page); await shown(page, 'day'); await entries(page);
      const box = page.getByRole('checkbox', { name: '아침 산책', exact: true });
      await box.click(); await box.click(); await box.click();
      await page.waitForFunction(() => document.querySelector('.schedule-entry-status')?.dataset.state === 'ok', null, { timeout: 10000 });
      assert.equal(await box.isChecked(), true);
      assert.deepEqual(tables.rows.haedo_items.get('h1').data.checks, ['2026-11-03'], 'three clicks: checked once, stored once');
    });

    await check('the week grid checks a past day, shows each day\'s 행복도 and opens that day', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: { ...habitData([]), days: [1, 2, 3] } }); // Mon–Wed
      tables.seed('haedo_documents', accounts.a.id, { id: 'd_timeline', name: '내 연표', data: { profile: { name: '내 연표', birth: '1990-01' }, scale: 'signed1', events: [], spans: [], eras: [], happiness: [{ date: '2026-11-02', v: 0.35 }], thoughts: [], records: [], trips: [], layers: [] } });
      await page.goto(base + '/index.html?section=schedule&view=week&date=2026-11-03'); await ready(page); await shown(page, 'week'); await entries(page);
      await page.waitForFunction(() => HaedoPlatformStore.items.length === 1 && document.querySelector('.schedule-happiness-day[data-focus-key$="2026-11-02"]')?.textContent === '7');
      const grid = page.locator('.schedule-habit-grid');
      assert.equal(await grid.locator('input[type=checkbox]').count(), 3, 'only the habit\'s weekdays');
      assert.equal(await grid.getByRole('checkbox', { name: '아침 산책, 수요일' }).isDisabled(), true, 'Wednesday is after today');
      await grid.getByRole('checkbox', { name: '아침 산책, 월요일' }).check();
      await page.waitForFunction(() => document.querySelector('.schedule-entry-status')?.dataset.state === 'ok', null, { timeout: 10000 });
      assert.deepEqual(tables.rows.haedo_items.get('h1').data.checks, ['2026-11-02']);
      assert.equal(tables.rows.haedo_documents.get('d_timeline').data.happiness[0].v, 0.35, 'viewing does not rewrite 0.35');
      await page.locator('.schedule-happiness-day[data-focus-key$="2026-11-02"]').click(); await shown(page, 'day');
      assert.equal(new URL(page.url()).searchParams.get('date'), '2026-11-02');
      await entries(page);
      await page.waitForFunction(() => document.querySelector('.schedule-happiness input[value="7"]')?.checked);
    });

    await check('the year shows unfinished goals and saves a progress change', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'g1', kind: 'goal', name: '책 열두 권 읽기', data: goalData(40) });
      tables.seed('haedo_items', accounts.a.id, { id: 'g2', kind: 'goal', name: '끝난 목표', data: { title: '끝난 목표', progress: 100, target: '' } });
      await page.goto(base + '/index.html?section=schedule&view=tools&date=2026-11-03'); await ready(page); await shown(page, 'tools');
      await page.locator('.schedule-entries-year .schedule-goal').waitFor();
      assert.match(await page.locator('.schedule-entries-year').innerText(), /책 열두 권 읽기/);
      assert.doesNotMatch(await page.locator('.schedule-entries-year').innerText(), /끝난 목표/);
      const range = page.getByRole('slider', { name: '책 열두 권 읽기 진행률' });
      await range.focus(); await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('.schedule-entry-status')?.dataset.state === 'ok' && HaedoPlatformStore.items.find(i => i.id === 'g1')?.data.progress === 45, null, { timeout: 10000 });
      await page.waitForFunction(() => true);
      await new Promise(done => setTimeout(done, 2500));
      assert.equal(tables.rows.haedo_items.get('g1').data.progress, 45);
    });

    await check('a failed upload says so with a retry; the edit stays on the device and is sent on retry', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: habitData([]) });
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-03'); await ready(page); await shown(page, 'day'); await entries(page);
      await page.waitForFunction(() => HaedoPlatformStore.items.length === 1);
      page.__expectFailure = true; tables.fail = 'haedo_items';
      await page.getByRole('checkbox', { name: '아침 산책', exact: true }).check();
      await statusOf(page).filter({ hasText: '계정에 올리지 못함 · 다시 시도' }).waitFor({ timeout: 10000 });
      assert.equal(await page.getByRole('checkbox', { name: '아침 산책', exact: true }).isChecked(), true, 'the check stays');
      assert.deepEqual(tables.rows.haedo_items.get('h1').data.checks, []);
      tables.fail = null;
      // A text action styled with the shared tokens, 44px tall (re-review minor 7).
      const look = await page.locator('.schedule-entry-status').getByRole('button', { name: '다시 시도' }).evaluate(node => {
        const style = getComputedStyle(node), box = node.getBoundingClientRect(); return { h: box.height >= 44, border: style.borderTopStyle, bg: style.backgroundColor }; });
      assert.deepEqual(look, { h: true, border: 'none', bg: 'rgba(0, 0, 0, 0)' });
      // 2026-11-08 S9: the state and its button say 다시 시도 once (계정에 올리지 못함 · [다시 시도]).
      assert.equal((await statusOf(page).innerText()).match(/다시 시도/g).length, 1, '다시 시도 once');
      // Keyboard retry: the button stays focused (aria-disabled, not disabled) while the retry runs, and a
      // success leaves focus on the status line that says so, not on the page.
      let release; tables.hold = new Promise(done => { release = done; });
      const retry = page.locator('.schedule-entry-status').getByRole('button', { name: '다시 시도' });
      await retry.focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.activeElement?.dataset.focusKey === 'schedule:entry:retry' && document.activeElement.getAttribute('aria-disabled') === 'true');
      tables.hold = null; release();
      await statusOf(page).filter({ hasText: '저장됨 · 계정에 올림' }).waitFor({ timeout: 10000 });
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('schedule-entry-status')), true, 'focus stays on the status line');
      assert.deepEqual(tables.rows.haedo_items.get('h1').data.checks, ['2026-11-03']);
    });

    await check('another device\'s later change wins; this device\'s losing edit is kept as a recovery copy', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: habitData([]) });
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-03'); await ready(page); await shown(page, 'day'); await entries(page);
      await page.waitForFunction(() => HaedoPlatformStore.items[0]?.state === 'ok');
      page.__expectFailure = true; tables.fail = 'haedo_items';
      await page.getByRole('checkbox', { name: '아침 산책', exact: true }).check();               // edit at the page's 2026-11-03T03:00Z
      await statusOf(page).filter({ hasText: '계정에 올리지 못함' }).waitFor({ timeout: 10000 });
      // Another device unchecks yesterday and checks today's later (server clock is ahead).
      const later = tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: habitData(['2026-11-01']) });
      tables.fail = null;
      await page.locator('.schedule-entry-status').getByRole('button', { name: '다시 시도' }).click();
      await page.waitForFunction(() => JSON.stringify(HaedoPlatformStore.items[0]?.data.checks) === '["2026-11-01"]', null, { timeout: 10000 });
      assert.equal(await page.getByRole('checkbox', { name: '아침 산책', exact: true }).isChecked(), false, 'the newer server copy is shown');
      assert.equal(tables.rows.haedo_items.get('h1').updated_at, later.updated_at, 'nothing was written over it');
      const kept = await page.evaluate(id => JSON.parse(localStorage.getItem('caeyeon_life_account_' + id + '_items_recovery')), accounts.a.id);
      assert.equal(kept.length, 1); assert.deepEqual(kept[0].data.checks, ['2026-11-03']); assert.equal(kept[0].reason, 'remote_newer');
      // The goals/habits screen states that a recovery copy exists (no conflict dialog).
      await page.goto(base + '/habits.html'); await page.locator('#syncMessage').filter({ hasText: '복구 사본으로 남겼습니다' }).waitFor();
      assert.equal(await page.locator('#conflictDialog[open]').count(), 0);
    });

    await check('a recovery copy: the notice shows until acknowledged, the list revives it as a new item, and it follows the account', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: habitData([]) });
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-03'); await ready(page); await shown(page, 'day'); await entries(page);
      await page.waitForFunction(() => HaedoPlatformStore.items[0]?.state === 'ok');
      page.__expectFailure = true; tables.fail = 'haedo_items';
      await page.getByRole('checkbox', { name: '아침 산책', exact: true }).check();
      await statusOf(page).filter({ hasText: '계정에 올리지 못함' }).waitFor({ timeout: 10000 });
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: habitData(['2026-11-01']) });
      tables.fail = null;
      await statusOf(page).getByRole('button', { name: '다시 시도' }).click();
      await statusOf(page).filter({ hasText: '1개를 복구 사본으로 남겼습니다' }).waitFor({ timeout: 10000 });
      // The copy reaches the account document list (platformRecovery) on this device.
      const mirrored = () => page.evaluate(async () => (await HaedoLife.Shell.storage.readPlatformRecovery()).items);
      const deadline = Date.now() + 10000; let rows = [];
      while (Date.now() < deadline && !(rows = await mirrored()).length) await page.waitForTimeout(200);
      assert.equal(rows.length, 1); assert.deepEqual(rows[0].data.checks, ['2026-11-03']);
      // 확인 hides the sentence; the copy stays.
      await statusOf(page).getByRole('button', { name: '복구 사본 알림 확인' }).click();
      await page.waitForFunction(() => !document.querySelector('.schedule-entry-status')?.textContent.includes('복구 사본'));
      assert.equal(await page.evaluate(() => HaedoPlatformStore.recovery.length), 1);
      // The list (habits.html#recovery) revives it as a new item; the item it lost to is unchanged.
      await page.goto(base + '/habits.html#recovery');
      const dialog = page.locator('#recoveryDialog[open]'); await dialog.waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'recoveryDialogTitle', 'starts on the title, no tooltip over the text');
      assert.match(await dialog.innerText(), /아침 산책/);
      await dialog.getByRole('button', { name: '새 항목으로 되살리기' }).click();
      await page.waitForFunction(() => HaedoPlatformStore.items.filter(i => i.data.title === '아침 산책').length === 2);
      const [kept, revived] = await page.evaluate(() => [HaedoPlatformStore.items.find(i => i.id === 'h1').data.checks, HaedoPlatformStore.items.find(i => i.id !== 'h1').data.checks]);
      assert.deepEqual(kept, ['2026-11-01']); assert.deepEqual(revived, ['2026-11-03']);
      assert.equal(await page.evaluate(() => HaedoPlatformStore.recovery.length), 1, 'the kept copy stays');
      await page.waitForFunction(() => HaedoPlatformStore.items.every(i => i.state === 'ok'), null, { timeout: 10000 });
      assert.equal(tables.owned('haedo_items', accounts.a.id).length, 2, 'the revived item is a new row');
    });

    await check('a full account recovery list is said in the status line, not swallowed (re-review minor 4)', async ({ page, context, tables }) => {
      await context.route('**/assets/life/storage.js', async route => {
        const response = await route.fetch();
        const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,async addPlatformRecovery(){throw Object.assign(new Error('full'),{code:'platform_recovery_too_large'});}});}});})();`;
        await route.fulfill({ response, body: (await response.text()) + hook });
      });
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: habitData([]) });
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-03'); await ready(page); await shown(page, 'day'); await entries(page);
      await page.waitForFunction(() => HaedoPlatformStore.items[0]?.state === 'ok');
      page.__expectFailure = true; tables.fail = 'haedo_items';
      await page.getByRole('checkbox', { name: '아침 산책', exact: true }).check();
      await statusOf(page).filter({ hasText: '계정에 올리지 못함' }).waitFor({ timeout: 10000 });
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: habitData(['2026-11-01']) });
      tables.fail = null;
      await statusOf(page).getByRole('button', { name: '다시 시도' }).click();
      await statusOf(page).filter({ hasText: '복구 사본 목록이 가득 차 새 사본은 이 기기와 백업에만 남습니다.' }).waitFor({ timeout: 10000 });
      assert.equal(await page.evaluate(() => HaedoPlatformStore.recovery.length), 1, 'the copy stays on this device');
    });

    await check('a late store response after signing out shows nothing of account A to account B', async ({ page, server, device, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: 'A만의 습관', data: { ...habitData([]), title: 'A만의 습관' } });
      let release; tables.hold = new Promise(done => { release = done; });
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-03'); await ready(page); await shown(page, 'day');
      await page.waitForFunction(() => typeof HaedoPlatformStore === 'object');
      await page.evaluate(() => HaedoAuth.client.auth.signOut({ scope: 'local' }));
      await page.waitForFunction(() => document.querySelector('#lifeApp').hidden && HaedoAuth.user === null);
      tables.hold = null; release();
      server.oauthAccounts.set(device, accounts.b); await page.locator('[data-life-login]').click(); await page.locator('#googleLogin').click();
      await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page);
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-03'); await ready(page); await shown(page, 'day'); await entries(page);
      await page.waitForTimeout(800);
      assert.doesNotMatch(await page.locator('#lifeApp').innerText(), /A만의 습관/);
      assert.equal(await page.evaluate(() => HaedoPlatformStore.account), accounts.b.id);
      assert.equal(await page.evaluate(id => localStorage.getItem('caeyeon_life_account_' + id + '_items'), accounts.b.id) === null ||
        !(await page.evaluate(id => localStorage.getItem('caeyeon_life_account_' + id + '_items'), accounts.b.id)).includes('A만의'), true);
    });

    // 2026-11-08 S7: when the entry slot cannot load, D offers the habit screen only; the timeline is not a
    // second place for 행복도 (entered in D alone).
    await check('a D slot that cannot load falls back to the habit screen only', async ({ page, context }) => {
      page.__expectFailure = true;
      await context.route('**/assets/life/schedule-entries.js', route => route.fulfill({ status: 500, body: '' }));
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-03'); await ready(page); await shown(page, 'day');
      await page.waitForFunction(() => document.querySelector('.schedule-entries-day')?.getAttribute('aria-busy') === 'false');
      const links = await measureAll(page, '.schedule-entries-day a', nodes => nodes.map(n => [n.textContent.trim(), n.getAttribute('href')]));
      assert.deepEqual(links, [['습관 체크', 'habits.html']]);
    });

    // 2026-11-08 S7: with no habit at all, D·W·M link 습관 추가 to the habit screen (where one is added).
    await check('no habit at all: D, W and M link 습관 추가 to the habit screen and write nothing', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'g1', kind: 'goal', name: '책 열두 권 읽기', data: goalData(40) });
      for (const view of ['day', 'week', 'month']) {
        await page.goto(base + '/index.html?section=schedule&view=' + view + '&date=2026-11-03'); await ready(page); await shown(page, view); await entries(page);
        await page.waitForFunction(() => HaedoPlatformStore.items.length === 1);
        const add = page.locator('.schedule-entries').getByRole('link', { name: '습관 추가' });
        await add.waitFor();
        assert.equal(await add.getAttribute('href'), 'habits.html', view);
        assert.ok((await add.boundingBox()).height >= 44, view + ': 44px');
        assert.match(await page.locator('.schedule-entries').innerText(), /아직 습관이 없어요\./, view);
      }
      await page.locator('.schedule-entries').getByRole('link', { name: '습관 추가' }).click();
      await page.waitForURL(url => url.pathname.endsWith('/habits.html'));
      await page.locator('#habitList').getByRole('button', { name: '습관 추가' }).waitFor();
      assert.equal(tables.calls.filter(call => call.method !== 'GET').length, 0, 'viewing and following the link wrote nothing');
    });

    // Review 3 m2 (2026-11-08): 행복도 0–10 is one row only where each choice gets 44px (the slot ≥ 524px); else two
    // rows, 0–5 and 6–10, at every width (1101–1300px beside the aside too, not only phones).
    for (const width of [1101, 1200, 1300, 1440, 820, 320]) await check('행복도 choices are never under 44px at ' + width, async ({ page }) => {
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-03'); await ready(page); await shown(page, 'day'); await entries(page);
      const scale = await page.evaluate(() => ({ body: document.querySelector('.schedule-entries-day > .schedule-entry-body').getBoundingClientRect().width,
        options: [...document.querySelectorAll('.schedule-happiness-option')].map(n => { const b = n.getBoundingClientRect(); return { n: n.textContent, top: Math.round(b.top), w: b.width, h: b.height, right: b.right }; }),
        right: document.querySelector('.schedule-entries-day').getBoundingClientRect().right }));
      const rows = [...new Set(scale.options.map(o => o.top))].map(top => scale.options.filter(o => o.top === top).map(o => o.n));
      assert.deepEqual(scale.options.filter(o => o.w < 44 || o.h < 44).map(o => o.n + ':' + Math.round(o.w)), [], width + ': each choice is 44 × 44 (slot ' + scale.body + 'px)');
      assert.deepEqual(rows, scale.body >= 524 ? [['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']] : [['0', '1', '2', '3', '4', '5'], ['6', '7', '8', '9', '10']], width + ': rows');
      if ([1101, 1200, 320].includes(width)) assert.equal(rows.length, 2, width + ': the slot beside the aside (or a phone) is narrower than eleven 44px choices');
      assert.ok(scale.options.every(o => o.right <= scale.right + 1), width + ': the choices stay inside the slot');
      await overflow(page, 'happiness ' + width);
    }, { width, height: 900 });

    // Review 3 m5·m6: 지우기 by keyboard leaves focus on the day's choice 0 (not the page); in forced colors each
    // choice keeps a 1px CanvasText edge and the chosen one a 2px Highlight ring.
    await check('행복도: 지우기 by keyboard keeps focus in the group; forced colors show the chosen choice', async ({ page }) => {
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-03'); await ready(page); await shown(page, 'day'); await entries(page);
      await page.getByRole('radio', { name: '행복도 7' }).focus(); await page.keyboard.press('Space');
      await page.locator('.schedule-happiness-clear').waitFor();
      await page.waitForFunction(() => document.activeElement?.dataset.focusKey === 'schedule:happiness:2026-11-03:7');
      await page.emulateMedia({ forcedColors: 'active' });
      const forced = await page.evaluate(() => {
        const system = name => { const probe = document.createElement('span'); probe.style.color = name; document.body.append(probe); const value = getComputedStyle(probe).color; probe.remove(); return value; };
        const style = n => { const c = getComputedStyle(n); return { outline: c.outlineStyle + ' ' + c.outlineWidth + ' ' + c.outlineColor, border: c.borderTopStyle + ' ' + c.borderTopWidth + ' ' + c.borderTopColor }; };
        const options = [...document.querySelectorAll('.schedule-happiness-option')];
        return { chosen: style(options.find(n => n.querySelector('input').checked)), other: style(options[0]), highlight: system('Highlight'), text: system('CanvasText') };
      });
      assert.equal(forced.chosen.outline, 'solid 2px ' + forced.highlight, 'forced colors: the chosen choice has a 2px Highlight ring');
      assert.equal(forced.other.border, 'solid 1px ' + forced.text, 'forced colors: each choice has a 1px CanvasText edge');
      assert.equal(forced.chosen.border, 'solid 1px ' + forced.text);
      await page.emulateMedia({ forcedColors: 'none' });
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), '지우기');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('.schedule-happiness-clear') && !document.querySelector('.schedule-happiness-option input:checked'));
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => document.activeElement?.dataset?.focusKey || document.activeElement?.tagName), 'schedule:happiness:2026-11-03:0', 'focus is on choice 0, not the page');
      assert.equal(await page.evaluate(() => document.activeElement?.checked), false, 'focusing 0 does not choose it');
    });

    // Review 3 n1: the status line (a live region) is rebuilt only when what it says changes.
    await check('the entry status line is not rewritten by a repaint that says the same', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: habitData([]) });
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-03'); await ready(page); await shown(page, 'day'); await entries(page);
      await page.getByRole('checkbox', { name: '아침 산책', exact: true }).check();
      await statusOf(page).filter({ hasText: '저장됨 · 계정에 올림' }).waitFor({ timeout: 10000 });
      await page.waitForTimeout(400);
      const counted = await page.evaluate(async () => {
        const status = document.querySelector('.schedule-entry-status'), changes = [];
        const watch = new MutationObserver(list => changes.push(...list.map(m => m.type))); watch.observe(status, { childList: true, subtree: true, characterData: true });
        const box = document.querySelector('.schedule-entries input[type=checkbox]');
        for (const type of ['haedo:store', 'haedo:happiness', 'haedo:store']) document.dispatchEvent(new Event(type));
        await new Promise(resolve => setTimeout(resolve, 300));
        watch.disconnect();
        return { changes: changes.length, repainted: !box.isConnected, text: status.textContent };
      });
      assert.deepEqual(counted, { changes: 0, repainted: true, text: '저장됨 · 계정에 올림' }, 'the panel repainted, the status line stayed as it was');
      // A change of what it says still rewrites it.
      page.__expectFailure = true; tables.fail = 'haedo_items';
      await page.getByRole('checkbox', { name: '아침 산책', exact: true }).uncheck();
      await statusOf(page).filter({ hasText: '계정에 올리지 못함' }).waitFor({ timeout: 10000 });
    });

    // A store notice rebuilt the whole panel also when nothing shown had changed: a press that spanned the rebuild
    // was lost and a node found just before it was detached (the 1440 week measurement failed that way under load).
    for (const view of ['day', 'week']) await check('a store notice that changes nothing shown leaves the ' + view + ' panel\'s nodes in place; a real change rebuilds it', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: habitData([]) });
      await page.goto(base + '/index.html?section=schedule&view=' + view + '&date=2026-11-03'); await ready(page); await shown(page, view); await entries(page);
      await page.waitForFunction(() => HaedoPlatformStore.items.length === 1 && document.querySelector('.schedule-entries input[type=checkbox]'));
      await page.waitForTimeout(400);   // start-up notices (account documents, 행복도) have passed
      const result = await page.evaluate(async () => {
        const wait = () => new Promise(resolve => setTimeout(resolve, 150));
        const box = document.querySelector('.schedule-entries input[type=checkbox]'), mood = document.querySelector('.schedule-happiness input[type=radio], .schedule-happiness-day');
        for (let n = 0; n < 5; n++) document.dispatchEvent(new Event('haedo:store'));
        await wait();
        const same = { box: box.isConnected && box === document.querySelector('.schedule-entries input[type=checkbox]'), mood: mood.isConnected, size: box.getBoundingClientRect().width > 0 };
        // What is shown changes (the habit's name): the next notice rebuilds.
        const item = HaedoPlatformStore.items[0]; HaedoPlatformStore.change(item.id, 'habit', { ...item.data, title: '저녁 산책' });
        await wait();
        return { same, rebuilt: !box.isConnected, name: document.querySelector('.schedule-entries input[type=checkbox]').getAttribute('aria-label') };
      });
      assert.deepEqual(result.same, { box: true, mood: true, size: true }, 'the same notice kept the nodes');
      assert.equal(result.rebuilt, true, 'a change of what is shown rebuilt the panel'); assert.match(result.name, /^저녁 산책/);
    });

    // Review 2 m6: Y without a goal says so at body size and links 목표 추가 to the goal screen (drafts kept first).
    await check('Y with no goal links 목표 추가 to the goal screen and writes nothing', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: habitData([]) });
      await page.goto(base + '/index.html?section=tools&date=2026-11-03'); await ready(page); await shown(page, 'tools'); await entries(page);
      await page.waitForFunction(() => HaedoPlatformStore.items.length === 1);
      const add = page.locator('.schedule-entries-year').getByRole('link', { name: '목표 추가' });
      assert.equal(await add.getAttribute('href'), 'goals.html');
      assert.ok((await add.boundingBox()).height >= 44);
      assert.match(await page.locator('.schedule-entries-year').innerText(), /진행 중인 목표가 없어요\./);
      await add.click();
      await page.waitForURL(url => url.pathname.endsWith('/goals.html'));
      assert.equal(tables.calls.filter(call => call.method !== 'GET').length, 0, 'viewing and following the link wrote nothing');
    });

    for (const width of [1440, 390, 360]) await check('day and week panels fit ' + width + ' without horizontal scroll or errors', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: habitData(['2026-11-02']) });
      tables.seed('haedo_items', accounts.a.id, { id: 'h2', kind: 'habit', name: '저녁에 일기 한 줄 쓰기와 다음 날 할 일 세 가지 적기', data: { ...habitData([]), title: '저녁에 일기 한 줄 쓰기와 다음 날 할 일 세 가지 적기' } });
      tables.seed('haedo_items', accounts.a.id, { id: 'g1', kind: 'goal', name: '책 열두 권 읽기', data: goalData(40) });
      const longGoal = '올해 안에 동네 도서관의 한국 근현대 소설 서가를 처음부터 끝까지 한 권씩 읽어 보기';
      tables.seed('haedo_items', accounts.a.id, { id: 'g2', kind: 'goal', name: longGoal, data: { ...goalData(10), title: longGoal } });
      // Goals are in Y only (2026-11-08 S7): a long goal title is shown whole there (wrapped), not cut.
      await page.goto(base + '/index.html?section=schedule&view=tools&date=2026-11-03'); await ready(page); await shown(page, 'tools');
      await page.waitForFunction(() => typeof HaedoPlatformStore === 'object' && HaedoPlatformStore.items.length === 4 && document.querySelectorAll('.schedule-entries-year .schedule-goal').length === 2);
      // Found and measured in one evaluation (the slot repaints on store notices; a resolved node may be detached by then).
      const title = await page.evaluate(text => { const n = [...document.querySelectorAll('.schedule-entries-year .schedule-goal-title')].find(node => node.textContent === text);
        return { text: n.textContent, fits: n.scrollWidth <= n.clientWidth + 1, ellipsis: getComputedStyle(n).textOverflow }; }, longGoal);
      assert.deepEqual(title, { text: longGoal, fits: true, ellipsis: 'clip' });
      await overflow(page, 'year ' + width);
      for (const view of ['day', 'week']) {
        await page.goto(base + '/index.html?section=schedule&view=' + view + '&date=2026-11-03'); await ready(page); await shown(page, view); await entries(page);
        await page.waitForFunction(() => HaedoPlatformStore.items.length === 4);
        if (view === 'day') {
          // 2026-11-08 S7: 체크 (습관 + 행복도) → 그날 기록 → 다른 해; no goal in the day.
          const order = await page.evaluate(() => {
            const parts = [['check', '.schedule-entries-day'], ['records', '.schedule-day-records'], ['others', '.schedule-other-years']].map(([name, sel]) => [name, document.querySelector('#lifeSchedule ' + sel)]).filter(([, n]) => n);
            const sorted = [...parts].sort(([, a], [, b]) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1).map(([name]) => name);
            const slot = document.querySelector('.schedule-entries-day');
            return { sorted, inSlot: [...slot.querySelectorAll('h2')].map(n => n.textContent), goals: document.querySelectorAll('#lifeSchedule .schedule-goal, #lifeSchedule input[type=range]').length };
          });
          assert.deepEqual(order, { sorted: ['check', 'records'], inSlot: ['습관', '행복도'], goals: 0 }, 'the day shows its checks, then its records, and no goal');
          // An empty day says so at body size.
          const empty = await page.locator('.schedule-day-records .schedule-empty').evaluate(n => ({ text: n.textContent, size: getComputedStyle(n).fontSize,
            body: (() => { const probe = document.createElement('span'); probe.style.fontSize = 'var(--haedo-text-body)'; n.append(probe); const size = getComputedStyle(probe).fontSize; probe.remove(); return size; })() }));
          assert.deepEqual([empty.text, empty.size], ['이 날 기록이 없어요.', empty.body], 'the empty day at body size');
          // 행복도 0–10: one row on wide screens; on a phone two rows (0–5, 6–10), each choice 44 × 44.
          const scale = await measureAll(page, '.schedule-happiness-option', nodes => nodes.map(n => { const b = n.getBoundingClientRect(); return { n: n.textContent, top: Math.round(b.top), w: b.width, h: b.height }; }));
          const rows = [...new Set(scale.map(o => o.top))].map(top => scale.filter(o => o.top === top).map(o => o.n));
          if (width <= 760) assert.deepEqual(rows, [['0', '1', '2', '3', '4', '5'], ['6', '7', '8', '9', '10']]);
          else assert.equal(rows.length, 1, 'one row on a wide screen');
          assert.deepEqual(scale.filter(o => o.w < 44 || o.h < 44).map(o => o.n), [], '행복도 choices are 44 × 44');
        }
        await overflow(page, view + ' ' + width);
        if (view === 'week') {
          // Every habit name is shown whole: its own line at phone width, the row header on wide screens.
          const names = await measureAll(page, '.schedule-grid-label td', cells => cells.filter(c => c.checkVisibility()).map(c => [c.textContent, c.scrollWidth <= c.clientWidth + 1]));
          if (width <= 760) assert.deepEqual(names, [['아침 산책', true], ['저녁에 일기 한 줄 쓰기와 다음 날 할 일 세 가지 적기', true], ['행복도', true]]);
          else {
            assert.deepEqual(names, [], 'wide: names stay in the row headers');
            // Wide: the row header wraps instead of cutting, and keeps the name as its title.
            const heads = await measureAll(page, '.schedule-habit-grid tbody tr:not(.schedule-grid-label) > th', cells => cells.map(c => [c.textContent, c.title, c.scrollWidth <= c.clientWidth + 1]));
            assert.deepEqual(heads.filter(([text]) => text !== '행복도'), [['아침 산책', '아침 산책', true], ['저녁에 일기 한 줄 쓰기와 다음 날 할 일 세 가지 적기', '저녁에 일기 한 줄 쓰기와 다음 날 할 일 세 가지 적기', true]]);
          }
          // The whole cell takes the tap, not only the 22px box.
          const targets = await measureAll(page, '.schedule-grid-check', nodes => nodes.map(n => { const b = n.getBoundingClientRect(), cell = n.closest('td'), style = getComputedStyle(cell);
            const inner = cell.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight); return b.height >= 44 && b.width >= inner - 1; }));
          assert.ok(targets.length && targets.every(Boolean), 'week ' + width + ': each check cell is a full-size target');
          // Seven day columns only (no empty eighth column at phone width), each at least 44px wide.
          const columns = await page.evaluate(() => { const row = [...document.querySelectorAll('.schedule-habit-grid tbody tr:not(.schedule-grid-label)')][0];
            const cells = [...row.children].filter(c => c.checkVisibility()); return { count: cells.filter(c => c.tagName === 'TD').length, narrowest: Math.min(...cells.filter(c => c.tagName === 'TD').map(c => c.getBoundingClientRect().width)),
              table: document.querySelector('.schedule-habit-grid').getBoundingClientRect().right, last: cells.at(-1).getBoundingClientRect().right }; });
          assert.equal(columns.count, 7); assert.ok(columns.narrowest >= 44, 'week ' + width + ': day cells ' + columns.narrowest + 'px');
          assert.ok(Math.abs(columns.table - columns.last) <= 1, 'week ' + width + ': no empty column after Sunday');
          // All seven days show without sideways scrolling inside the grid either (Sunday included).
          const fit = await page.evaluate(() => { const scroll = document.querySelector('.schedule-habit-scroll'), sunday = document.querySelector('.schedule-habit-grid thead th:last-child');
            const box = scroll.getBoundingClientRect(), day = sunday.getBoundingClientRect();
            return { scrolls: scroll.scrollWidth > scroll.clientWidth + 1, sunday: sunday.textContent, inside: day.right <= box.right + 1 && day.right <= innerWidth }; });
          assert.deepEqual(fit, { scrolls: false, sunday: '일', inside: true }, 'week ' + width + ': Monday to Sunday visible');
        }
        const small = await measureAll(page, '.schedule-entries input, .schedule-entries button, .schedule-entries a', nodes => nodes.filter(n => n.checkVisibility()).map(n => {
          const box = (n.matches('input[type=checkbox],input[type=radio]') ? n.closest('label,td') || n : n).getBoundingClientRect(); return { w: box.width, h: box.height, name: n.getAttribute('aria-label') || n.textContent };
        }).filter(r => r.h < 44 || r.w < 24));
        assert.deepEqual(small, [], view + ' ' + width + ': controls are at least 44px tall');
        await page.screenshot({ path: path.join(output, view + '-' + width + '.png'), fullPage: true });
      }
    }, { width, height: 960 });
  } finally { await browser.close(); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(report.pageErrors, [], 'page errors'); assert.deepEqual(report.consoleErrors, [], 'console errors');
  assert(report.checks.length && report.checks.every(item => item.pass), 'all checks pass');
  console.log(JSON.stringify({ checks: report.checks.length, expectedErrors: report.expectedErrors }));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { PlatformTables };

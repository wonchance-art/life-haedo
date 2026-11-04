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
async function entries(page) { await page.waitForFunction(() => { const slot = document.querySelector('.schedule-entries'); return slot && slot.getAttribute('aria-busy') === 'false' && slot.querySelector('.schedule-entry-body')?.childElementCount > 0; }); }
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
      assert.equal(await page.locator('.schedule-entries').getByRole('radio').count(), 11);
    });

    await check('a habit check and 행복도 save on the device first, then reach the account (two-step state)', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: habitData([]) });
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-03'); await ready(page); await shown(page, 'day'); await entries(page);
      await page.waitForFunction(() => HaedoPlatformStore.items.length === 1);
      assert.equal(tables.owned('haedo_documents', accounts.a.id).length, 0);
      assert.equal(await page.evaluate(id => JSON.parse(localStorage.getItem('caeyeon_life_account_' + id + '_registry') || '{"docs":[]}').docs.length, accounts.a.id), 0, 'viewing creates no timeline');
      await page.getByRole('checkbox', { name: '아침 산책', exact: true }).check();
      await statusOf(page).filter({ hasText: '계정에 올리기 대기' }).waitFor();
      await page.locator('.schedule-happiness-option', { hasText: /^8$/ }).click();
      await statusOf(page).filter({ hasText: '저장됨 · 계정에 올림' }).waitFor({ timeout: 10000 });
      assert.deepEqual(tables.rows.haedo_items.get('h1').data.checks, ['2026-11-03']);
      const docs = tables.owned('haedo_documents', accounts.a.id);
      assert.equal(docs.length, 1); assert.equal(docs[0].name, '내 연표');
      assert.deepEqual(docs[0].data.happiness, [{ date: '2026-11-03', v: 0.6 }]);
      // Reopening shows the saved values.
      await page.reload(); await ready(page); await shown(page, 'day'); await entries(page);
      assert.equal(await page.getByRole('checkbox', { name: '아침 산책', exact: true }).isChecked(), true);
      assert.equal(await page.locator('.schedule-happiness-option:has(input:checked)').innerText(), '8');
      // 지우기 removes only that day's entry.
      await page.getByRole('button', { name: '지우기' }).click();
      await page.waitForFunction(() => !document.querySelector('.schedule-happiness-option input:checked'));
      await page.waitForFunction(() => document.querySelector('.schedule-entry-status')?.dataset.state === 'ok');
      assert.deepEqual(tables.owned('haedo_documents', accounts.a.id)[0].data.happiness, []);
    });

    await check('a future day cannot be checked or rated; a repeated click toggles from the stored state', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: habitData([]) });
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-05'); await ready(page); await shown(page, 'day'); await entries(page);
      assert.equal(await page.getByRole('checkbox', { name: '아침 산책', exact: true }).isDisabled(), true);
      assert.equal(await page.locator('.schedule-entries input[type=radio]:not(:disabled)').count(), 0);
      assert.match(await entryText(page), /오지 않은 날은 기록할 수 없어요/);
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
      assert.equal(await page.locator('.schedule-happiness-option:has(input:checked)').innerText(), '7');
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
      await page.locator('.schedule-entry-status').getByRole('button', { name: '다시 시도' }).click();
      await statusOf(page).filter({ hasText: '저장됨 · 계정에 올림' }).waitFor({ timeout: 10000 });
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

    for (const width of [1440, 390]) await check('day and week panels fit ' + width + ' without horizontal scroll or errors', async ({ page, tables }) => {
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: habitData(['2026-11-02']) });
      tables.seed('haedo_items', accounts.a.id, { id: 'h2', kind: 'habit', name: '저녁에 일기 한 줄 쓰기와 다음 날 할 일 세 가지 적기', data: { ...habitData([]), title: '저녁에 일기 한 줄 쓰기와 다음 날 할 일 세 가지 적기' } });
      tables.seed('haedo_items', accounts.a.id, { id: 'g1', kind: 'goal', name: '책 열두 권 읽기', data: goalData(40) });
      for (const view of ['day', 'week']) {
        await page.goto(base + '/index.html?section=schedule&view=' + view + '&date=2026-11-03'); await ready(page); await shown(page, view); await entries(page);
        await page.waitForFunction(() => HaedoPlatformStore.items.length === 3);
        await overflow(page, view + ' ' + width);
        const small = await page.locator('.schedule-entries input, .schedule-entries button, .schedule-happiness-option').evaluateAll(nodes => nodes.filter(n => n.checkVisibility()).map(n => {
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

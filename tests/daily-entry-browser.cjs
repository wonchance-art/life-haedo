/* 매일 쓰는 진입 경로 (2026-11-11 m1·m2·m3) on the real app, SDK and IDB with the anonymous
 * intercepted Auth.
 *  m1  a login brings the owner back to the place the address named (calendar unit and date,
 *      백업·복원, the open post, the habit month); nothing but those values is carried.
 *  m2  an account check that never answers ends after the limit with 다시 확인; a failed check is
 *      tried again by itself a limited number of times; the plan pages open again when the
 *      connection or the page comes back; the ordinary opening still asks Auth once, and no
 *      personal store is opened before the account is verified.
 *  m3  글쓰기 opened from 목표·습관·연표 목록 closes back to that page and leaves no empty editor in
 *      the browser history.
 *  m5  backup files are named by this device's day (모두 받기 is checked in full-backup-dates-browser.cjs).
 * npm run dev; node tests/daily-entry-browser.cjs
 * Never uses real Google, production Supabase or Apple-device claims. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { PlatformTables } = require('./schedule-entries-browser.cjs');

const output = path.resolve(process.env.DAILY_ENTRY_OUTPUT || '.local/daily-entry-browser');
const report = { checks: [], consoleErrors: [], pageErrors: [], expectedErrors: 0 };
const TODAY = '2026-11-11T08:30:00+09:00';
const json = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
const list = page => page.waitForFunction(() => document.querySelector('#lifeMain')?.dataset.mode === 'home' && document.querySelector('#homePosts')?.getAttribute('aria-busy') === 'false');
const where = page => page.evaluate(() => location.pathname.split('/').pop() + location.search);
const startup = page => page.evaluate(() => ({ app: !document.querySelector('#lifeApp').hidden, text: document.querySelector('#lifeStartup').hidden ? null : document.querySelector('#lifeStartup p')?.innerText,
  retry: !!document.querySelector('#lifeStartup button'), welcome: !document.querySelector('#lifeWelcome')?.hidden, stores: (globalThis.__homeDbOpens || []).length }));
// The app's own account checks (GET /auth/v1/user of the platform client; the RSS client checks apart) seen by the page.
function userChecks(page) {
  const seen = []; page.on('request', request => { if (request.method() === 'GET' && request.url() === cloud + '/auth/v1/user' && request.headers()['x-client-info'] === 'haedo-platform') seen.push(Date.now()); });
  return seen;
}
async function seedPost(page, title) {
  return page.evaluate(async value => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, m = HaedoLife.PhotoPost, ws = await s.getActive();
    const doc = m.create(c.id, '2026-11-09T03:00:00.000Z'); doc.title = value; doc.status = 'saved'; doc.ops = [{ insert: '천변을 따라 걸었다.\n' }];
    await s.savePhotoPost(ws, doc, 0); return doc.id;
  }, title);
}
// The browser went back or forward to this page of the app (also from its back/forward cache).
const at = (page, file) => page.waitForFunction(name => location.pathname.endsWith('/' + name) && document.readyState === 'complete', file);
const postCount = page => page.evaluate(async () => { const s = HaedoLife.Shell.storage; return (await s.listPhotoPosts(await s.getActive())).length; });

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, run, { viewport = { width: 390, height: 844 }, seed = accounts.a, expect = null } = {}) {
    if (process.env.DAILY_ENTRY_MATCH && !new RegExp(process.env.DAILY_ENTRY_MATCH).test(name)) return;
    const server = new FakeCloud(), tables = new PlatformTables('2026-11-01T00:00:00Z'), device = 'daily-entry-' + report.checks.length;
    const context = await makeContext(browser, server, device, seed, { viewport, timezoneId: 'Asia/Seoul', locale: 'ko-KR', ...(viewport.width < 761 ? { hasTouch: true, isMobile: true } : {}) });
    await tables.attach(context);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    await page.clock.setFixedTime(new Date(TODAY));
    page.on('pageerror', error => report.pageErrors.push({ check: name, message: error.message }));
    // `expect` names the console errors a check causes on purpose (a failed or abandoned account check).
    page.on('console', event => { if (event.type() !== 'error') return; if (expect && expect.test(event.text())) report.expectedErrors++; else report.consoleErrors.push({ check: name, message: event.text() }); });
    console.log('RUN ' + name);
    try { await run({ page, context, server, tables, device }); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  const failedCheck = /Failed to load resource|AbortError|signal is aborted|AuthRetryableFetchError|net::ERR/;
  try {
    // ── m1 ──
    for (const address of ['index.html?section=schedule&view=day&date=2026-10-29', 'index.html?section=schedule&view=month&date=2026-09-01', 'index.html?section=schedule&view=tools&date=2025-06-01',
      'index.html?section=manage&view=backup', 'habits.html?month=2026-09']) {
      await check('m1: signed out at ' + address + ' → login → the same place', async ({ page, server, device }) => {
        await page.goto(base + '/' + address);
        if (address.startsWith('index.html')) {
          const login = page.locator('#lifeWelcome [data-life-login], #lifeWelcome [data-life-return-login]').first();
          await page.waitForFunction(() => !document.querySelector('#lifeWelcome')?.hidden);
          assert.equal(await login.getAttribute('href'), 'login.html?next=' + encodeURIComponent(address));
          await login.click();
        }
        await page.waitForURL(url => url.pathname.endsWith('/login.html'));
        assert.equal(new URL(page.url()).searchParams.get('next'), address);
        server.oauthAccounts.set(device, accounts.a);
        await page.locator('#googleLogin').click();
        await page.waitForURL(url => !url.pathname.endsWith('/login.html'));
        if (address.startsWith('index.html')) { await ready(page); await page.waitForFunction(() => !document.querySelector('.life-app[aria-busy="true"]')); }
        else await page.locator('#habitMonthLabel').waitFor();
        assert.equal(await where(page), address);
        const title = await page.evaluate(() => document.querySelector('#lifeApp .life-page-title')?.innerText || document.querySelector('#habitMonthLabel')?.innerText);
        assert.equal(title, { 'index.html?section=schedule&view=day&date=2026-10-29': '10월 29일 목요일', 'index.html?section=schedule&view=month&date=2026-09-01': '9월',
          'index.html?section=schedule&view=tools&date=2025-06-01': '2025년', 'index.html?section=manage&view=backup': '백업·복원', 'habits.html?month=2026-09': '2026년 9월' }[address]);
      }, { seed: null });
    }
    await check('m1: the session ends while a post is open → login → the same post, not 선택 자료 페이지; a hostile next is dropped', async ({ page, server, device }) => {
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      const id = await seedPost(page, '세션이 끊긴 글');
      await page.goto(base + '/index.html?view=page&blog=photo.' + id); await ready(page);
      await page.getByRole('heading', { name: '세션이 끊긴 글' }).first().waitFor();
      const address = await where(page);
      assert.equal(address, 'index.html?view=page&blog=photo.' + id);
      // The stored session is gone (expired and not renewable): the next opening is signed out.
      await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('caeyeon_life_platform_session')) localStorage.removeItem(key); });
      await page.reload();
      await page.waitForFunction(() => !document.querySelector('#lifeWelcome')?.hidden);
      const login = page.locator('#lifeWelcome [data-life-login], #lifeWelcome [data-life-return-login]').first();
      assert.equal(await login.getAttribute('href'), 'login.html?next=' + encodeURIComponent(address));
      await login.click(); await page.waitForURL(url => url.pathname.endsWith('/login.html'));
      server.oauthAccounts.set(device, accounts.a);
      await page.locator('#googleLogin').click();
      await page.waitForURL(url => !url.pathname.endsWith('/login.html')); await ready(page);
      await page.getByRole('heading', { name: '세션이 끊긴 글' }).first().waitFor();
      assert.equal(await where(page), address);
      // The login page itself: whatever `next` says, the page it will go to is one of the app's own.
      const hostile = await page.evaluate(() => ['https://evil.invalid/index.html', '//evil.invalid/index.html', 'javascript:alert(1)', 'index.html?view=day&date=2026-10-29&next=//evil.invalid&code=x',
        'index.html?section=schedule&view=page&blog=photo.a%2F..%2Fb', 'habits.html?month=2026-13'].map(value => HaedoAuth.safeNext(value)));
      assert.deepEqual(hostile, ['index.html', 'index.html', 'index.html', 'index.html?view=day&date=2026-10-29', 'index.html?section=schedule', 'habits.html']);
    });

    // ── m2 ──
    await check('m2: the ordinary opening makes no extra account check, shows no failure notice and opens no personal store before the account is verified', async ({ page }) => {
      const checks = userChecks(page);
      await page.addInitScript(() => { window.__startupNotices = []; document.addEventListener('DOMContentLoaded', () => new MutationObserver(() => {
        const text = document.querySelector('#lifeStartup p')?.textContent; if (text && __startupNotices.at(-1) !== text) __startupNotices.push(text); }).observe(document.querySelector('#lifeStartup'), { childList: true, subtree: true })); });
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      // How many checks an opening makes is asserted where it is defined (platform-auth.test.cjs: one server request per
      // check; life-discovery-automation and home-startup-performance: the shell's check). Here: none is added afterwards,
      // through the first timed retry's wait and beyond.
      const opened = checks.length;
      assert.ok(opened >= 1);
      await page.waitForTimeout(3000);
      assert.equal(checks.length, opened, 'no automatic retry follows an opening that succeeded');
      // A warm opening (the account is already on this device) is the same.
      await page.reload(); await ready(page); await list(page);
      const warm = checks.length - opened;
      await page.waitForTimeout(3000);
      assert.equal(checks.length - opened, warm, 'no automatic retry follows a warm opening');
      assert.deepEqual((await page.evaluate(() => __startupNotices)).filter(text => !/확인하고 있습니다/.test(text)), [], 'only the checking lines were shown');
      const opens = await page.evaluate(() => __homeDbOpens);
      assert.ok(opens.length && opens.every(open => open.verified), 'every store was opened after the account was verified');
    });

    await check('m2: an account check that never answers → 다시 확인 after the limit, nothing personal opened; the next try opens the app by itself', async ({ page, context }) => {
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      let stalled = true; const waiting = [];
      await context.route(cloud + '/auth/v1/user', async route => { if (stalled) await new Promise(resolve => waiting.push(resolve)); return route.fallback().catch(() => {}); });
      const checks = userChecks(page), started = Date.now();
      await page.goto(base + '/index.html');
      await page.waitForFunction(() => document.querySelector('#lifeStartup p')?.innerText === '로그인을 확인하고 있습니다.');
      await page.waitForTimeout(6000);
      assert.deepEqual(await startup(page), { app: false, text: '로그인을 확인하고 있습니다.', retry: false, welcome: false, stores: 0 }, 'still within the limit');
      await page.locator('#lifeStartup').getByRole('button', { name: '다시 확인', exact: true }).waitFor({ timeout: 8000 });
      const waited = Date.now() - started;
      assert.ok(waited >= 9500 && waited < 14000, 'the limit is about ten seconds (' + waited + ' ms)');
      const failed = await startup(page);
      assert.equal(failed.app, false); assert.equal(failed.stores, 0, 'no personal store was opened'); assert.match(failed.text, /로그인을 확인해야 합니다/);
      assert.equal(await page.locator('#lifeStartup').getByRole('link', { name: '로그인 화면' }).count(), 1);
      await page.screenshot({ path: path.join(output, 'stalled-check.png') });
      // The connection works again: the first automatic try (2 s later) opens the app, without a press.
      stalled = false; waiting.splice(0).forEach(resolve => resolve());
      await page.waitForFunction(() => !document.querySelector('#lifeApp').hidden, null, { timeout: 8000 });
      await list(page);
      assert.ok(checks.length >= 2, 'the stalled check, then the automatic try that opened the app');
      assert.equal(await page.locator('#lifeStartup').isVisible(), false);
    }, { expect: failedCheck });

    await check('m2: a failing account check is tried again by itself three times (2, 5, 15 s) and no more; 다시 확인 then opens the app', async ({ page, context }) => {
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      let failing = true;
      await context.route(cloud + '/auth/v1/user', route => failing ? route.fulfill({ status: 503, headers: json, body: '{"message":"anonymous upstream failure"}' }) : route.fallback());
      const checks = userChecks(page);
      await page.goto(base + '/index.html');
      await page.locator('#lifeStartup').getByRole('button', { name: '다시 확인', exact: true }).waitFor();
      const t0 = checks[0];
      await page.waitForFunction(() => true, null, { timeout: 1000 });
      await page.waitForTimeout(24500);
      assert.equal(checks.length, 4, 'the opening and three automatic tries: ' + JSON.stringify(checks.map(at => at - t0)));
      const gaps = checks.slice(1).map((at, index) => at - checks[index]);
      assert.ok(gaps[0] > 1500 && gaps[0] < 4000 && gaps[1] > 4500 && gaps[1] < 7500 && gaps[2] > 14000 && gaps[2] < 18000, 'waits of about 2, 5 and 15 s: ' + JSON.stringify(gaps));
      await page.waitForTimeout(6000);
      assert.equal(checks.length, 4, 'no further automatic try');
      const state = await startup(page);
      assert.equal(state.app, false); assert.equal(state.retry, true); assert.equal(state.stores, 0);
      failing = false;
      await page.locator('#lifeStartup').getByRole('button', { name: '다시 확인', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('#lifeApp').hidden); await list(page);
      assert.ok(checks.length >= 5);
    }, { expect: failedCheck });

    for (const file of ['habits.html', 'goals.html', 'workspace.html']) {
      await check('m2: ' + file + ' that could not check the account opens again when the connection comes back, and when the page is shown again', async ({ page, context }) => {
        let failing = true;
        await context.route(cloud + '/auth/v1/user', route => failing ? route.fulfill({ status: 503, headers: json, body: '{"message":"anonymous upstream failure"}' }) : route.fallback());
        await page.goto(base + '/' + file);
        await page.locator('#accessRetry').waitFor();
        assert.match(await page.locator('#accessState p').innerText(), /개인 공간을 열지 못했습니다/);
        assert.equal(await page.locator('[data-private]').first().isVisible(), false);
        // Nothing changes by itself while the server still fails.
        await page.waitForTimeout(1500); assert.equal(await page.locator('#accessRetry').isVisible(), true);
        failing = false;
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await page.locator('[data-private]').first().waitFor({ state: 'visible' });
        // The same after the page was in the background.
        failing = true; await page.reload(); await page.locator('#accessRetry').waitFor();
        failing = false;
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await page.locator('[data-private]').first().waitFor({ state: 'visible' });
      }, { expect: failedCheck });
    }

    // ── m3 ──
    for (const [origin, width] of [['goals.html', 390], ['habits.html?month=2026-09', 390], ['workspace.html', 1440]]) {
      await check('m3 ' + width + ': 글쓰기 from ' + origin + ' → 닫기 returns there; Back and Forward never reopen an empty editor', async ({ page }) => {
        await page.goto(base + '/index.html'); await ready(page); await list(page);
        await seedPost(page, '먼저 쓴 글');
        await page.goto(base + '/' + origin); await page.locator('[data-private]').first().waitFor({ state: 'visible' });
        await page.locator('a[data-haedo-compose]').locator('visible=true').first().click();
        await page.locator('#photoTitle').waitFor();
        await page.getByRole('button', { name: '닫기', exact: true }).click();
        await at(page, origin.split('?')[0]);
        await page.locator('[data-private]').first().waitFor({ state: 'visible' });
        assert.equal(await where(page), origin, '닫기 returns to the page 글쓰기 was opened from');
        // Forward is the 일정 list, not an empty editor.
        await page.goForward(); await ready(page); await list(page);
        assert.equal(await where(page), 'index.html'); assert.equal(await page.locator('#photoTitle').count(), 0);
        assert.equal(await page.locator('#lifeApp').evaluate(node => getComputedStyle(node).visibility), 'visible');
        await page.goBack(); await at(page, origin.split('?')[0]);
        // Back from there is what came before that page.
        await page.goBack(); await ready(page); await list(page);
        assert.equal(await where(page), 'index.html'); assert.equal(await page.locator('#photoTitle').count(), 0);
        assert.equal(await postCount(page), 1, 'the untouched new post left nothing behind');
      }, { viewport: width === 390 ? { width: 390, height: 844 } : { width: 1440, height: 960 } });
    }
    await check('m3: words typed there are kept as a draft when 닫기 returns to the page; a reloaded editor still returns there', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      await page.goto(base + '/goals.html'); await page.locator('[data-private]').first().waitFor({ state: 'visible' });
      await page.locator('a[data-haedo-compose]').locator('visible=true').first().click();
      await page.locator('#photoTitle').fill('목표 화면에서 쓰기 시작한 글');
      await page.waitForFunction(() => document.querySelector('.photo-status')?.textContent === '자동 저장됨');
      await page.reload(); await ready(page);
      await page.waitForFunction(() => document.querySelector('#photoTitle')?.value === '목표 화면에서 쓰기 시작한 글');
      await page.getByRole('button', { name: '닫기', exact: true }).click();
      await at(page, 'goals.html');
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      const drafts = await page.evaluate(async () => { const s = HaedoLife.Shell.storage; return (await s.listPhotoPosts(await s.getActive())).map(row => [row.title, row.status]); });
      assert.deepEqual(drafts, [['목표 화면에서 쓰기 시작한 글', 'draft']]);
    });
    await check('m3: 글쓰기 from a screen of the app itself still closes to that screen; the bare 글쓰기 address closes to the list', async ({ page }) => {
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-10-20'); await ready(page);
      await page.locator('a[data-haedo-compose]').locator('visible=true').first().click();
      await page.locator('#photoTitle').waitFor();
      await page.getByRole('button', { name: '닫기', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#lifeMain')?.dataset.mode === 'day');
      assert.equal(await where(page), 'index.html?section=schedule&view=day&date=2026-10-20');
      // Typed or bookmarked (no page it came from): the list, as before.
      await page.goto('about:blank'); await page.goto(base + '/index.html?compose=1'); await ready(page);
      await page.locator('#photoTitle').waitFor();
      await page.getByRole('button', { name: '닫기', exact: true }).click();
      await list(page); assert.equal(await where(page), 'index.html');
    });

    // ── m5 ──
    await check('m5: at 08:30 KST (the day before in UTC) the 자료 JSON·Markdown and the 컬렉션 backup are named for today', async ({ page }) => {
      assert.equal(await page.evaluate(() => new Date().toISOString().slice(0, 10)), '2026-11-10', 'the clock of this check: UTC is still the 10th');
      const received = async press => { const download = page.waitForEvent('download'); await press(); return (await download).suggestedFilename(); };
      await page.goto(base + '/index.html?section=manage&view=transfer'); await ready(page);
      await page.locator('#lifeMain[data-mode="transfer"]').waitFor();
      assert.equal(await received(() => page.getByRole('button', { name: 'JSON 백업', exact: true }).click()), 'life-tools-2026-11-11.json');
      assert.equal(await received(() => page.getByRole('button', { name: 'Markdown 내보내기', exact: true }).click()), 'life-tools-2026-11-11.md');
      await page.goto(base + '/index.html?section=records&view=collection'); await ready(page);
      await page.locator('.cl-files summary').click();
      assert.equal(await received(() => page.getByRole('button', { name: '컬렉션 백업 받기', exact: true }).click()), 'haedo-collection-2026-11-11.json');
    }, { viewport: { width: 1440, height: 960 } });
  } finally { await browser.close(); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(report.pageErrors, [], 'page errors'); assert.deepEqual(report.consoleErrors, [], 'console errors');
  assert(report.checks.length && report.checks.every(item => item.pass), 'all checks pass');
  console.log(JSON.stringify({ checks: report.checks.length, expectedErrors: report.expectedErrors }));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

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
const FAILED_NOTICE = '로그인을 확인하지 못했습니다. 연결이 끊겼거나 느립니다. 다시 확인해 주세요. 저장된 자료는 보존돼 있습니다.';
// Recorded in the page, on the page's own clock: the app's account checks (GET /auth/v1/user of the platform client;
// the RSS client checks apart) with when each went out and how it ended, and every notice drawn on the first screen.
async function watchAuth(page) {
  await page.addInitScript(() => {
    window.__auth = { checks: [], notices: [] };
    const real = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input?.url, method = String(init?.method || input?.method || 'GET').toUpperCase();
      let platform = false; try { platform = new Headers(init?.headers || input?.headers || {}).get('x-client-info') === 'haedo-platform'; } catch (_) { /* Not a header set. */ }
      const out = real.apply(this, arguments);
      if (method === 'GET' && /\/auth\/v1\/user$/.test(url || '') && platform) {
        const row = { at: Date.now(), ended: null, how: null }; __auth.checks.push(row);
        out.then(response => { row.ended = Date.now(); row.how = response.ok ? 'answered' : 'status ' + response.status; }, error => { row.ended = Date.now(); row.how = error?.name === 'AbortError' ? 'aborted' : 'failed'; });
      }
      return out;
    };
    document.addEventListener('DOMContentLoaded', () => {
      const box = document.querySelector('#lifeStartup'); if (!box) return;
      new MutationObserver(() => { const text = box.querySelector('p')?.textContent; if (text) __auth.notices.push({ at: Date.now(), text, retry: !!box.querySelector('button') }); }).observe(box, { childList: true });
    });
  });
}
const timeline = page => page.evaluate(() => window.__auth);
// The app's account checks are held unanswered until the test answers them (or releases all that follow).
async function holdUserChecks(page, context) {
  const rows = []; let open = false;
  await context.route(cloud + '/auth/v1/user', async route => {
    const request = route.request();
    if (request.method() !== 'GET' || request.headers()['x-client-info'] !== 'haedo-platform' || open) return route.fallback();
    const row = {}; rows.push(row);
    await new Promise(resolve => { row.answer = resolve; });
    return route.fallback().catch(() => { /* The page gave the request up meanwhile. */ });
  });
  const until = async (test, what, timeout = 6000) => { for (const end = Date.now() + timeout; !await test();) { if (Date.now() > end) throw new Error('timed out waiting for ' + what + ' (' + rows.length + ' requests)'); await new Promise(resolve => setTimeout(resolve, 25)); } };
  return { request: (n, timeout) => until(() => rows.length >= n, 'account check ' + n, timeout), ended: n => until(async () => (await timeline(page))?.checks[n - 1]?.ended != null, 'account check ' + n + ' to end'),
    answer: n => rows[n - 1]?.answer(), release: () => { open = true; rows.forEach(row => row.answer()); } };
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
  async function check(name, run, { viewport = { width: 390, height: 844 }, seed = accounts.a, expect = null, clock = 'fixed' } = {}) {
    if (process.env.DAILY_ENTRY_MATCH && !new RegExp(process.env.DAILY_ENTRY_MATCH).test(name)) return;
    const server = new FakeCloud(), tables = new PlatformTables('2026-11-01T00:00:00Z'), device = 'daily-entry-' + report.checks.length;
    const context = await makeContext(browser, server, device, seed, { viewport, timezoneId: 'Asia/Seoul', locale: 'ko-KR', ...(viewport.width < 761 ? { hasTouch: true, isMobile: true } : {}) });
    await tables.attach(context);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    // 'install': time runs and the test moves it (runFor); 'fixed': one instant.
    if (clock === 'install') await page.clock.install({ time: new Date(TODAY) }); else await page.clock.setFixedTime(new Date(TODAY));
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
    await check('m1: the session ends while a post is open → login → the same post, not 선택 자료 페이지; a hostile next is dropped', async ({ page, context, server, device }) => {
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      const id = await seedPost(page, '세션이 끊긴 글');
      await page.goto(base + '/index.html?view=page&blog=photo.' + id); await ready(page);
      await page.getByRole('heading', { name: '세션이 끊긴 글' }).first().waitFor();
      const address = await where(page);
      assert.equal(address, 'index.html?view=page&blog=photo.' + id);
      // The session has ended on the server (expired and not renewable): Auth refuses the account check and the
      // refresh, and the next opening is signed out. (The stored session is not removed under the running page: its
      // background requests would then go out without an owner.)
      const ended = { status: 401, headers: json, body: '{"code":"bad_jwt","message":"expired"}' };
      const refuseUser = route => route.fulfill(ended), refuseRefresh = route => route.fulfill({ ...ended, status: 400, body: '{"code":"refresh_token_not_found","message":"revoked"}' });
      const refresh = url => url.href.startsWith(cloud + '/auth/v1/token') && url.searchParams.get('grant_type') === 'refresh_token';
      await context.route(cloud + '/auth/v1/user', refuseUser); await context.route(refresh, refuseRefresh);
      await page.reload();
      await page.waitForFunction(() => !document.querySelector('#lifeWelcome')?.hidden);
      const login = page.locator('#lifeWelcome [data-life-login], #lifeWelcome [data-life-return-login]').first();
      assert.equal(await login.getAttribute('href'), 'login.html?next=' + encodeURIComponent(address));
      await login.click(); await page.waitForURL(url => url.pathname.endsWith('/login.html'));
      await page.locator('#googleLogin:not([disabled])').waitFor();   // the login page was refused as well: it offers Google
      // A new login is accepted from here on.
      await context.unroute(cloud + '/auth/v1/user', refuseUser); await context.unroute(refresh, refuseRefresh);
      server.oauthAccounts.set(device, accounts.a);
      await page.locator('#googleLogin').click();
      await page.waitForURL(url => !url.pathname.endsWith('/login.html')); await ready(page);
      await page.getByRole('heading', { name: '세션이 끊긴 글' }).first().waitFor();
      assert.equal(await where(page), address);
      // The login page itself: whatever `next` says, the page it will go to is one of the app's own.
      const hostile = await page.evaluate(() => ['https://evil.invalid/index.html', '//evil.invalid/index.html', 'javascript:alert(1)', 'index.html?view=day&date=2026-10-29&next=//evil.invalid&code=x',
        'index.html?section=schedule&view=page&blog=photo.a%2F..%2Fb', 'habits.html?month=2026-13'].map(value => HaedoAuth.safeNext(value)));
      assert.deepEqual(hostile, ['index.html', 'index.html', 'index.html', 'index.html?view=day&date=2026-10-29', 'index.html?section=schedule', 'habits.html']);
    }, { expect: /Failed to load resource.*40[01]/ });

    // ── m2 ──
    // The checks that depend on the limits and the retry waits run on a clock the test moves (page.clock.install +
    // runFor), and they compare times recorded in the page on that same clock (watchAuth): when each account check
    // went out and how it ended, when each notice was shown. Nothing is measured in real seconds, so load on the
    // machine does not change the outcome.
    await check('m2: the ordinary opening makes no extra account check, shows no failure notice and opens no personal store before the account is verified', async ({ page }) => {
      await watchAuth(page);
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      // How many checks an opening makes is asserted where it is defined (platform-auth.test.cjs: one server request per
      // check; life-discovery-automation and home-startup-performance: the shell's check). Here: none is added afterwards,
      // through the first timed retry's wait and beyond.
      const opened = (await timeline(page)).checks.length;
      assert.ok(opened >= 1);
      await page.waitForTimeout(3000);
      assert.equal((await timeline(page)).checks.length, opened, 'no automatic retry follows an opening that succeeded');
      // A warm opening (the account is already on this device) is the same.
      await page.reload(); await ready(page); await list(page);
      const warm = (await timeline(page)).checks.length;
      await page.waitForTimeout(3000);
      const end = await timeline(page);
      assert.equal(end.checks.length, warm, 'no automatic retry follows a warm opening');
      assert.deepEqual(end.notices.filter(row => !/확인하고 있습니다/.test(row.text)), [], 'only the checking lines were shown');
      assert.ok(end.checks.filter(row => row.ended !== null).every(row => row.how === 'answered'));
      const opens = await page.evaluate(() => __homeDbOpens);
      assert.ok(opens.length && opens.every(open => open.verified), 'every store was opened after the account was verified');
    });

    await check('m2: an account check that is never answered → 다시 확인 ten seconds after the request; tries after 2, 5 and 15 s wait 20, 30 and 30 s and keep the notice, the button and its focus; nothing personal is opened', async ({ page, context }) => {
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      const held = await holdUserChecks(page, context);
      await watchAuth(page);
      await page.goto(base + '/index.html');
      await held.request(1);
      assert.deepEqual(await startup(page), { app: false, text: '로그인을 확인하고 있습니다.', retry: false, welcome: false, stores: 0 });
      await page.clock.runFor(10500);
      const retry = page.locator('#lifeStartup').getByRole('button', { name: '다시 확인', exact: true });
      await retry.waitFor(); await held.ended(1);
      assert.deepEqual([(await startup(page)).text, (await startup(page)).stores], [FAILED_NOTICE, 0]);
      assert.equal(await page.locator('#lifeStartup').getByRole('link', { name: '로그인 화면' }).count(), 1);
      await page.screenshot({ path: path.join(output, 'stalled-check.png') });
      // The owner puts keyboard focus on 다시 확인; the timed tries that follow leave the screen as it is.
      await retry.focus();
      const shown = (await timeline(page)).notices.length;
      for (const [wait, limit, n] of [[2000, 20000, 2], [5000, 30000, 3], [15000, 30000, 4]]) {
        await page.clock.runFor(wait + 500); await held.request(n);
        await page.clock.runFor(limit + 500); await held.ended(n);
        assert.deepEqual([(await startup(page)).text, (await startup(page)).retry, await page.evaluate(() => document.activeElement?.textContent)], [FAILED_NOTICE, true, '다시 확인'], 'try ' + (n - 1) + ': same notice, same button, same focus');
      }
      await page.clock.runFor(300000); await page.waitForTimeout(300);
      const seen = await timeline(page);
      assert.equal(seen.checks.length, 4, 'the opening and three timed tries, then none');
      assert.deepEqual(seen.checks.map(row => row.how), ['aborted', 'aborted', 'aborted', 'aborted']);
      // On the page's clock: each check was given up at its limit, and each try began its wait after the failure before.
      const lasted = seen.checks.map(row => row.ended - row.at), waited = seen.checks.slice(1).map((row, index) => row.at - seen.checks[index].ended);
      [10000, 20000, 30000, 30000].forEach((limit, index) => assert.ok(lasted[index] >= limit - 100 && lasted[index] < limit + 1500, 'check ' + (index + 1) + ' lasted ' + lasted[index] + ' ms (limit ' + limit + ')'));
      // (A try's request goes out a moment after its check begins, and that check began at the failure: wide bounds, far apart.)
      [2000, 5000, 15000].forEach((wait, index) => assert.ok(waited[index] >= wait - 1000 && waited[index] < wait + 1500, 'try ' + (index + 1) + ' began ' + waited[index] + ' ms after the failure (wait ' + wait + ')'));
      const first = seen.notices.find(row => row.text === FAILED_NOTICE);
      assert.ok(first.at - seen.checks[0].at >= 9000 && first.at - seen.checks[0].at < 11500, 'the failure notice came ' + (first.at - seen.checks[0].at) + ' ms after the request');
      assert.deepEqual(seen.notices.slice(shown), [], 'the notice was not replaced once during the three tries (no checking line flashed)');
      assert.equal((await startup(page)).stores, 0, 'no personal store was opened');
    }, { expect: failedCheck, clock: 'install' });

    await check('m2: a connection that answers every account check after 12 seconds: the app opens by itself on the second try (its limit is 20 s) and stays open', async ({ page, context }) => {
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      const held = await holdUserChecks(page, context);
      await watchAuth(page);
      await page.goto(base + '/index.html');
      await held.request(1);
      await page.clock.runFor(12000); held.answer(1);   // too late: this check was given up at 10 s
      await page.locator('#lifeStartup').getByRole('button', { name: '다시 확인', exact: true }).waitFor();
      const appOpen = () => page.locator('#lifeApp').isVisible();
      // Every check from here on is answered 12 s after it went out, until the app is open.
      for (let n = 2; n <= 12 && !await appOpen(); n++) {
        if (n === 2) await page.clock.runFor(2500);
        const out = await Promise.race([held.request(n, 6000).then(() => true, () => false), page.waitForFunction(() => !document.querySelector('#lifeApp').hidden, null, { timeout: 6000 }).then(() => false, () => false)]);
        if (!out) break;
        await page.clock.runFor(12000); held.answer(n);
      }
      await page.waitForFunction(() => !document.querySelector('#lifeApp').hidden);
      const seen = await timeline(page);
      held.release(); await list(page);
      assert.equal(seen.checks[0].how, 'aborted'); assert.ok(seen.checks[0].ended - seen.checks[0].at < 11500);
      const later = seen.checks.slice(1).filter(row => row.ended !== null);
      assert.ok(later.length >= 1 && later.every(row => row.how === 'answered' && row.ended - row.at >= 11900), 'every later check waited its 12 s and was answered: ' + JSON.stringify(later.map(row => [row.how, row.ended - row.at])));
      assert.equal(await page.locator('#lifeStartup').isVisible(), false);
    }, { expect: failedCheck, clock: 'install' });

    await check('m2: 다시 확인 while a quiet try has not been answered: that request is given up at once, a new one goes out and may take 30 s, and nothing of the earlier try shows afterwards', async ({ page, context }) => {
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      const held = await holdUserChecks(page, context);
      await watchAuth(page);
      await page.goto(base + '/index.html');
      await held.request(1);
      await page.clock.runFor(10500);
      const retry = page.locator('#lifeStartup').getByRole('button', { name: '다시 확인', exact: true });
      await retry.waitFor(); await held.ended(1);
      await page.clock.runFor(2500); await held.request(2);   // the quiet try is out, with 20 s to go
      const shown = (await timeline(page)).notices.length;
      await retry.click();
      await held.ended(2);                                     // given up at the press
      await held.request(3);                                   // a new request, not the stalled one
      assert.equal((await startup(page)).text, '로그인을 확인하고 있습니다. 연결이 느리면 30초까지 걸립니다.');
      await page.clock.runFor(25000);
      assert.equal((await timeline(page)).checks[2].ended, null, 'the pressed check is still out after 25 s');
      held.answer(3); held.release();
      await page.waitForFunction(() => !document.querySelector('#lifeApp').hidden); await list(page);
      await page.clock.runFor(60000); await page.waitForTimeout(300);
      assert.equal(await page.locator('#lifeApp').isVisible(), true, 'the app stays open');
      const seen = await timeline(page);
      assert.deepEqual([seen.checks[1].how, seen.checks[1].ended - seen.checks[1].at < 5000], ['aborted', true], 'the quiet try’s request ended at the press, not at its 20 s limit');
      assert.deepEqual(seen.notices.slice(shown).filter(row => !/확인하고 있습니다/.test(row.text)), [], 'after the press only checking lines were shown: the earlier try’s failure never reached the screen');
    }, { expect: failedCheck, clock: 'install' });

    await check('m2: a failing account check is tried again by itself after 2, 5 and 15 seconds and no more; 다시 확인 then opens the app', async ({ page, context }) => {
      await page.goto(base + '/index.html'); await ready(page); await list(page);
      let failing = true;
      await context.route(cloud + '/auth/v1/user', route => failing ? route.fulfill({ status: 503, headers: json, body: '{"message":"anonymous upstream failure"}' }) : route.fallback());
      await watchAuth(page);
      const count = async n => { for (let i = 0; i < 100 && (await timeline(page)).checks.filter(row => row.ended !== null).length < n; i++) await new Promise(resolve => setTimeout(resolve, 50)); return (await timeline(page)).checks.length; };
      await page.goto(base + '/index.html');
      await page.locator('#lifeStartup').getByRole('button', { name: '다시 확인', exact: true }).waitFor();
      assert.equal(await count(1), 1);
      for (const [wait, total] of [[2000, 2], [5000, 3], [15000, 4]]) { await page.clock.runFor(wait + 500); assert.equal(await count(total), total, 'a try after ' + wait + ' ms'); }
      await page.clock.runFor(300000); await page.waitForTimeout(400);
      const seen = await timeline(page);
      assert.equal(seen.checks.length, 4, 'no further automatic try');
      const waited = seen.checks.slice(1).map((row, index) => row.at - seen.checks[index].ended);
      [2000, 5000, 15000].forEach((wait, index) => assert.ok(waited[index] >= wait - 1000 && waited[index] < wait + 1500, 'try ' + (index + 1) + ' began ' + waited[index] + ' ms after the failure (wait ' + wait + ')'));
      const state = await startup(page);
      assert.deepEqual([state.app, state.retry, state.stores, state.text], [false, true, 0, FAILED_NOTICE]);
      assert.equal(seen.notices.filter(row => row.text === FAILED_NOTICE).length, 1, 'the notice was drawn once and kept through the tries');
      failing = false;
      await page.locator('#lifeStartup').getByRole('button', { name: '다시 확인', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('#lifeApp').hidden); await list(page);
    }, { expect: failedCheck, clock: 'install' });

    for (const file of ['habits.html', 'goals.html', 'workspace.html']) {
      await check('m2: ' + file + ' that could not check the account opens again when the connection comes back, and when the page is shown again', async ({ page, context }) => {
        let failing = true;
        await context.route(cloud + '/auth/v1/user', route => failing ? route.fulfill({ status: 503, headers: json, body: '{"message":"anonymous upstream failure"}' }) : route.fallback());
        await page.goto(base + '/' + file);
        await page.locator('#accessRetry').waitFor();
        assert.equal(await page.locator('#accessState p').innerText(), '개인 공간을 열지 못했습니다. 연결이 끊겼거나 느립니다. 다시 확인해 주세요. 기기의 기록은 보존돼 있습니다.');
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

    await check('m2: a plan page whose account check takes 25 seconds opens after 다시 확인 (that check waits up to 30 s); before the press it says the connection may be slow', async ({ page, context }) => {
      const held = await holdUserChecks(page, context);
      await watchAuth(page);
      await page.goto(base + '/habits.html');
      await held.request(1);
      await page.clock.runFor(10500);
      await page.locator('#accessRetry').waitFor();
      assert.equal(await page.locator('#accessState p').innerText(), '개인 공간을 열지 못했습니다. 연결이 끊겼거나 느립니다. 다시 확인해 주세요. 기기의 기록은 보존돼 있습니다.');
      assert.equal(await page.locator('[data-private]').first().isVisible(), false);
      await page.locator('#accessRetry').click();   // the page opens again
      const open = () => page.locator('[data-private]').first().isVisible();
      for (let n = 2; n <= 8 && !await open(); n++) {
        const out = await Promise.race([held.request(n, 6000).then(() => true, () => false), page.locator('[data-private]').first().waitFor({ state: 'visible', timeout: 6000 }).then(() => false, () => false)]);
        if (!out) break;
        await page.clock.runFor(25000); held.answer(n);
      }
      await page.locator('[data-private]').first().waitFor({ state: 'visible' });
      const seen = await timeline(page);
      held.release();
      assert.ok(seen.checks.length >= 1 && seen.checks.filter(row => row.ended !== null).every(row => row.how === 'answered' && row.ended - row.at >= 24900), 'after the press the check waited its 25 s: ' + JSON.stringify(seen.checks.map(row => [row.how, row.ended - row.at])));
    }, { expect: failedCheck, clock: 'install' });

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
    await check('m3: 글쓰기 opened from a page of the same name in another folder of this site, or on another site, closes to the list (only the app’s own pages are returned to)', async ({ page, context }) => {
      const html = '<!doctype html><meta charset="utf-8"><meta name="referrer" content="unsafe-url"><title>elsewhere</title><a id="go" href="' + base + '/index.html?compose=1">글쓰기</a>';
      for (const from of [base + '/elsewhere/goals.html', 'https://other.invalid/goals.html']) await context.route(from, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
      for (const from of [base + '/elsewhere/goals.html', 'https://other.invalid/goals.html']) {
        await page.goto(from); await page.locator('#go').click(); await ready(page); await page.locator('#photoTitle').waitFor();
        assert.equal(await page.evaluate(() => document.referrer), from, 'the editor did arrive from that page, with its full address');
        await page.getByRole('button', { name: '닫기', exact: true }).click();
        await list(page);
        await page.waitForTimeout(1800); // a return to that page would have left by now
        assert.equal(await where(page), 'index.html', '닫기 from ' + from + ' stays in the app');
        assert.equal(await page.locator('#lifeApp').evaluate(node => getComputedStyle(node).visibility), 'visible');
      }
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

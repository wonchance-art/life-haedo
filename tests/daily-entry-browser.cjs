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
const PLAN_FAILED = '개인 공간을 열지 못했습니다. 연결이 끊겼거나 느립니다. 다시 확인해 주세요. 기기의 기록은 보존돼 있습니다.';
// How long the test waits, in real time, for the browser to do something that takes no time on the page's clock (a
// page to load, a request to go out, a screen to be drawn). It only bounds a hang and is no part of any expectation:
// every time that is compared is read from the page's own clock, which the clock checks keep standing still.
// Sized by measurement (2026-11-11): one opening of index.html (about 190 files from the dev server) takes about
// 1.5 s on an idle machine and 6–21 s when every core is busy several times over (load ≈ 50 on 4 cores).
const LIVENESS_MS = 120000;
const until = async (test, what) => { for (const end = Date.now() + LIVENESS_MS; !await test();) { if (Date.now() > end) throw new Error('nothing happened: ' + what); await new Promise(resolve => setTimeout(resolve, 25)); } };
// Recorded in the page, on the page's own clock:
//   checks   the app's account checks (GET /auth/v1/user of the platform client; the RSS client checks apart): when
//            each went out, when and how it ended. With hold, a check is not sent on until the test answers it.
//   notices  every notice drawn on the first screen.
//   retries  every timed retry the shell armed (a 2, 5 or 15 s timer set from shell.js).
async function watchAuth(page, hold = false) {
  await page.addInitScript(held => {
    const send = [];
    window.__auth = { checks: [], sent: [], notices: [], retries: [], hold: held };
    window.__authSend = index => send[index]?.();
    const real = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input?.url, method = String(init?.method || input?.method || 'GET').toUpperCase();
      let platform = false; try { platform = new Headers(init?.headers || input?.headers || {}).get('x-client-info') === 'haedo-platform'; } catch (_) { /* Not a header set. */ }
      if (!(method === 'GET' && /\/auth\/v1\/user$/.test(url || '') && platform)) return real.apply(this, arguments);
      const row = { at: Date.now(), ended: null, how: null }, index = __auth.checks.push(row) - 1, self = this, args = arguments, signal = init?.signal || input?.signal;
      __auth.sent.push(false);
      const end = how => { if (row.ended === null) { row.ended = Date.now(); row.how = how; } };
      return new Promise((resolve, reject) => {
        // The app gives the check up (its limit, or a newer check): the request ends there, sent on or not.
        signal?.addEventListener('abort', () => { end('aborted'); reject(new DOMException('The operation was aborted.', 'AbortError')); });
        send[index] = () => {
          if (__auth.sent[index] || row.ended !== null) return;
          __auth.sent[index] = true;
          real.apply(self, args).then(response => { end(response.ok ? 'answered' : 'status ' + response.status); resolve(response); }, error => { end(error?.name === 'AbortError' ? 'aborted' : 'failed'); reject(error); });
        };
        if (!__auth.hold) send[index]();
      });
    };
    const arm = window.setTimeout;
    window.setTimeout = function (run, delay) {
      if ([2000, 5000, 15000].includes(delay) && /\/life\/shell\.js/.test(new Error().stack || '')) __auth.retries.push({ at: Date.now(), delay });
      return arm.apply(this, arguments);
    };
    document.addEventListener('DOMContentLoaded', () => {
      const box = document.querySelector('#lifeStartup'); if (!box) return;
      new MutationObserver(() => { const text = box.querySelector('p')?.textContent; if (text) __auth.notices.push({ at: Date.now(), text, retry: !!box.querySelector('button') }); }).observe(box, { childList: true });
    });
  }, hold);
}
const timeline = page => page.evaluate(() => window.__auth);
// (A page that is being replaced answers nothing for a moment: asked again.)
const asked = (page, test, value) => page.evaluate(test, value).catch(() => false);
const checks = {
  out: (page, n) => until(() => asked(page, count => (window.__auth?.checks.length || 0) >= count, n), 'account check ' + n + ' to go out'),
  ended: (page, n) => until(() => asked(page, count => window.__auth?.checks[count - 1]?.ended != null, n), 'account check ' + n + ' to end'),
  answer: (page, n) => page.evaluate(count => window.__authSend(count - 1), n),
  // Every check from here on is sent on as it comes (this document only).
  release: page => page.evaluate(() => { __auth.hold = false; __auth.checks.forEach((_, index) => window.__authSend(index)); }),
};
// The shell armed its n-th timed retry (it does so when a check has failed, with nothing to see on the screen).
const armed = (page, n) => until(() => asked(page, count => (window.__auth?.retries.length || 0) >= count, n), 'timed retry ' + n + ' to be armed');
const retryShown = page => until(() => asked(page, () => !!document.querySelector('#lifeStartup:not([hidden]) button')), '다시 확인 on the first screen');
const appOpen = page => asked(page, () => !document.querySelector('#lifeApp').hidden);
const listReady = page => until(() => asked(page, () => document.querySelector('#lifeMain')?.dataset.mode === 'home' && document.querySelector('#homePosts')?.getAttribute('aria-busy') === 'false'), 'the list');
// A slow connection: every held account check is answered `delay` ms after it went out (on the page's clock), until
// `done` holds. The clock is moved only to the next instant an answer is due; then the test waits for what follows.
async function answerAfter(page, delay, done) {
  for (let turn = 0; turn < 60; turn++) {
    if (await done()) return;
    const seen = await page.evaluate(() => ({ now: Date.now(), checks: __auth.checks, sent: __auth.sent }));
    const waiting = seen.checks.map((row, index) => ({ index, due: row.at + delay })).filter(row => seen.checks[row.index].ended === null && !seen.sent[row.index]);
    if (waiting.length) {
      const due = Math.min(...waiting.map(row => row.due));
      if (due > seen.now) await page.clock.runFor(due - seen.now);
      for (const row of waiting.filter(row => row.due === due)) await page.evaluate(index => window.__authSend(index), row.index);
    }
    const mark = JSON.stringify([seen.checks.length, seen.checks.filter(row => row.ended !== null).length]);
    await until(async () => await done() || await asked(page, was => JSON.stringify([__auth.checks.length, __auth.checks.filter(row => row.ended !== null).length]) !== was, mark), 'the page to open, to ask again or to get its answer');
  }
  throw new Error('the page did not open on a connection that answers after ' + delay + ' ms');
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
    const page = await context.newPage(); page.setDefaultTimeout(LIVENESS_MS);
    // 'fixed': Date stands at one instant and timers run in real time. 'paused': the whole clock (Date, timers,
    // animation frames) stands still and moves only when the test says so (runFor). (An installed clock runs until
    // it is paused, and it cannot be paused at an instant already past: it starts an hour early and is paused at TODAY.)
    if (clock === 'paused') { await page.clock.install({ time: new Date(Date.parse(TODAY) - 3600000) }); await page.clock.pauseAt(new Date(TODAY)); } else await page.clock.setFixedTime(new Date(TODAY));
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
    // The checks that depend on the limits and the retry waits run on a clock that stands still unless the test moves
    // it (clock: 'paused' — page.clock.install and pauseAt, then runFor). Account checks are held and answered in the
    // page (watchAuth), and every time that is compared is read from that same clock: when a check went out and ended,
    // when a notice was drawn, when the shell armed its next try. The test moves the clock to the instant something is
    // due and then waits, the clock standing still, for what follows from it; so how fast the machine is changes how
    // long the run takes and nothing else. Real time appears in two places, neither of them an expected value:
    // LIVENESS_MS above, and a short pause before "nothing more happened" is read (it can only miss a fault, on a
    // machine too slow to show it; it cannot fail a run).
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
      assert.deepEqual(end.retries, [], 'no timed retry was armed');
      assert.deepEqual(end.notices.filter(row => !/확인하고 있습니다/.test(row.text)), [], 'only the checking lines were shown');
      assert.ok(end.checks.filter(row => row.ended !== null).every(row => row.how === 'answered'));
      const opens = await page.evaluate(() => __homeDbOpens);
      assert.ok(opens.length && opens.every(open => open.verified), 'every store was opened after the account was verified');
    });

    const CHECKING = '로그인을 확인하고 있습니다.', CHECKING_SLOW = '로그인을 확인하고 있습니다. 연결이 느려 평소보다 오래 걸릴 수 있습니다.';
    const retryButton = page => page.locator('#lifeStartup').getByRole('button', { name: '다시 확인', exact: true });
    // The first account check of an opening is never answered: the failure notice after its 10 s limit.
    async function stalledOpening(page) {
      await page.goto(base + '/index.html');
      await checks.out(page, 1);
      await page.clock.runFor(10000);
      await retryShown(page); await checks.ended(page, 1); await armed(page, 1);
    }

    await check('m2: an account check that is never answered → 다시 확인 exactly ten seconds after the request; the tries 2, 5 and 15 s after each failure wait 20, 30 and 30 s and keep the notice, the button and its focus; nothing personal is opened', async ({ page }) => {
      await watchAuth(page, true);
      await page.goto(base + '/index.html');
      await checks.out(page, 1);
      const checking = { app: false, text: CHECKING, retry: false, welcome: false, stores: 0 };
      assert.deepEqual(await startup(page), checking);
      await page.clock.runFor(9999);
      assert.deepEqual(await startup(page), checking, 'still only checking one millisecond before the limit');
      await page.clock.runFor(1);
      await retryShown(page); await checks.ended(page, 1); await armed(page, 1);
      assert.deepEqual([(await startup(page)).text, (await startup(page)).stores], [FAILED_NOTICE, 0]);
      assert.equal(await page.locator('#lifeStartup').getByRole('link', { name: '로그인 화면' }).count(), 1);
      await page.screenshot({ path: path.join(output, 'stalled-check.png') });
      // The owner puts keyboard focus on 다시 확인; the timed tries that follow leave the screen as it is.
      await retryButton(page).focus();
      const shown = (await timeline(page)).notices.length;
      for (const [wait, limit, n] of [[2000, 20000, 2], [5000, 30000, 3], [15000, 30000, 4]]) {
        await page.clock.runFor(wait - 1);
        assert.equal((await timeline(page)).checks.length, n - 1, 'try ' + (n - 1) + ' does not go out before its wait is over');
        await page.clock.runFor(1); await checks.out(page, n);
        await page.clock.runFor(limit); await checks.ended(page, n); if (n < 4) await armed(page, n);
        assert.deepEqual([(await startup(page)).text, (await startup(page)).retry, await page.evaluate(() => document.activeElement?.textContent)], [FAILED_NOTICE, true, '다시 확인'], 'try ' + (n - 1) + ': same notice, same button, same focus');
      }
      await page.clock.runFor(300000); await page.waitForTimeout(300);
      const seen = await timeline(page);
      assert.equal(seen.checks.length, 4, 'the opening and three timed tries, then none');
      // On the page's clock: each check was given up at its limit, and each try went out after its wait from the failure before.
      assert.deepEqual(seen.checks.map(row => [row.how, row.ended - row.at]), [['aborted', 10000], ['aborted', 20000], ['aborted', 30000], ['aborted', 30000]]);
      assert.deepEqual(seen.checks.slice(1).map((row, index) => row.at - seen.checks[index].ended), [2000, 5000, 15000]);
      assert.deepEqual(seen.retries, [2000, 5000, 15000].map((delay, index) => ({ at: seen.checks[index].ended, delay })), 'three timed tries were armed, each at the failure before it');
      const first = seen.notices.find(row => row.text === FAILED_NOTICE);
      assert.equal(first.at - seen.checks[0].at, 10000, 'the failure notice came with the limit of the first check');
      assert.deepEqual(seen.notices.slice(shown), [], 'the notice was not replaced once during the three tries (no checking line flashed)');
      assert.equal((await startup(page)).stores, 0, 'no personal store was opened');
    }, { expect: failedCheck, clock: 'paused' });

    await check('m2: a connection that answers every account check after 12 seconds: the opening’s own check is given up at 10 s, the first timed try (limit 20 s) is answered and the app opens by itself; the opening does not ask again for what that try answered', async ({ page }) => {
      // The account's library is already on this device (the daily opening). (A first opening on a device also writes
      // to the account, and each write asks again.)
      await page.goto(base + '/index.html'); await until(() => appOpen(page), 'the app to open'); await listReady(page);
      await watchAuth(page, true);
      const rows = seen => seen.checks.map(row => [row.at - seen.checks[0].at, row.how, row.ended === null ? null : row.ended - row.at]);
      // The ordinary opening, every check answered at once: the checks it makes before the screen is shown.
      await page.goto(base + '/index.html');
      await checks.out(page, 1);
      await answerAfter(page, 0, () => appOpen(page));
      const ordinary = await timeline(page);
      await checks.release(page); await listReady(page);
      assert.deepEqual(rows(ordinary), [[0, 'answered', 0], [0, 'answered', 0]], 'the ordinary opening: the shell’s check and one more, then the screen');
      // The same opening when every answer takes 12 s.
      await page.reload();
      await checks.out(page, 1);
      await answerAfter(page, 12000, () => appOpen(page));
      const seen = await timeline(page), now = await page.evaluate(() => Date.now());
      await checks.release(page); await listReady(page);
      // The opening's own check is given up at 10 s; the try 2 s later may take 20 s and is answered. From there the
      // opening asks as often as the ordinary one: what follows uses the try's answer while the opening's budget lasts
      // (platform-auth beginStartup: the budget grows with the check's limit, here to 20 s). With a budget of 10 s for
      // every opening, the answer that took 12 s is too old at once and everything that follows asks again.
      assert.deepEqual(rows(seen), [[0, 'aborted', 10000], [12000, 'answered', 12000], [24000, 'answered', 12000]], 'after the check that was given up: as many checks as the ordinary opening, each answered after its 12 s');
      assert.equal(now - seen.checks[0].at, 36000, 'the app was shown when the last of them was answered');
      assert.equal(await page.locator('#lifeStartup').isVisible(), false);
      await page.clock.runFor(60000); await page.waitForTimeout(300);
      assert.equal(await appOpen(page), true, 'the app stays open');
    }, { expect: failedCheck, clock: 'paused' });

    await check('m2: 다시 확인 while a quiet try has not been answered: that request is given up at once, a new one goes out and may take 30 s, and nothing of the earlier try shows afterwards', async ({ page }) => {
      await watchAuth(page, true);
      await stalledOpening(page);
      await page.clock.runFor(2000); await checks.out(page, 2);   // the quiet try is out, with 20 s to go
      const shown = (await timeline(page)).notices.length;
      await retryButton(page).click();
      await checks.ended(page, 2);                               // given up at the press
      await checks.out(page, 3);                                 // a new request, not the stalled one
      assert.equal((await startup(page)).text, '로그인을 확인하고 있습니다. 연결이 느리면 30초까지 걸립니다.');
      await page.clock.runFor(29999);
      const late = await timeline(page);
      assert.deepEqual([late.checks[1].how, late.checks[1].ended - late.checks[1].at, late.checks[2].at - late.checks[1].ended, late.checks[2].ended], ['aborted', 0, 0, null],
        'the quiet try’s request ended at the press, not at its 20 s limit; the pressed check is still out one millisecond before 30 s');
      assert.deepEqual([(await startup(page)).text, (await startup(page)).retry], ['로그인을 확인하고 있습니다. 연결이 느리면 30초까지 걸립니다.', false], 'a check the owner asked for keeps its checking line');
      await checks.answer(page, 3); await checks.release(page);
      await until(() => appOpen(page), 'the app to open'); await listReady(page);
      await page.clock.runFor(60000); await page.waitForTimeout(300);
      assert.equal(await appOpen(page), true, 'the app stays open');
      const seen = await timeline(page);
      assert.deepEqual(seen.notices.slice(shown).filter(row => !/확인하고 있습니다/.test(row.text)), [], 'after the press only checking lines were shown: the earlier try’s failure never reached the screen');
    }, { expect: failedCheck, clock: 'paused' });

    await check('m2: a failing account check is tried again by itself 2, 5 and 15 seconds after each failure and no more; 다시 확인 then opens the app', async ({ page, context }) => {
      let failing = true;
      await context.route(cloud + '/auth/v1/user', route => failing ? route.fulfill({ status: 503, headers: json, body: '{"message":"anonymous upstream failure"}' }) : route.fallback());
      await watchAuth(page);
      await page.goto(base + '/index.html');
      await retryShown(page); await checks.ended(page, 1); await armed(page, 1);
      for (const [wait, n] of [[2000, 2], [5000, 3], [15000, 4]]) {
        await page.clock.runFor(wait - 1);
        assert.equal((await timeline(page)).checks.length, n - 1, 'try ' + (n - 1) + ' does not go out before its wait is over');
        await page.clock.runFor(1); await checks.out(page, n); await checks.ended(page, n); if (n < 4) await armed(page, n);
      }
      await page.clock.runFor(300000); await page.waitForTimeout(400);
      const seen = await timeline(page);
      assert.equal(seen.checks.length, 4, 'no further automatic try');
      assert.deepEqual(seen.checks.map(row => [row.how, row.ended - row.at]), [['status 503', 0], ['status 503', 0], ['status 503', 0], ['status 503', 0]]);
      assert.deepEqual(seen.checks.slice(1).map((row, index) => row.at - seen.checks[index].ended), [2000, 5000, 15000]);
      assert.deepEqual(seen.retries.map(row => row.delay), [2000, 5000, 15000], 'three timed tries were armed');
      const state = await startup(page);
      assert.deepEqual([state.app, state.retry, state.stores, state.text], [false, true, 0, FAILED_NOTICE]);
      assert.equal(seen.notices.filter(row => row.text === FAILED_NOTICE).length, 1, 'the notice was drawn once and kept through the tries');
      failing = false;
      await retryButton(page).click();
      await until(() => appOpen(page), 'the app to open'); await listReady(page);
    }, { expect: failedCheck, clock: 'paused' });

    // The connection (online) or the screen (shown again) comes back while a check is out behind the failure notice.
    const signal = (page, kind) => page.evaluate(name => name === 'online' ? window.dispatchEvent(new Event('online')) : document.dispatchEvent(new Event('visibilitychange')), kind);
    for (const [kind, stage] of [['online', 'first'], ['visibilitychange', 'last']]) {
      await check('m2: ' + kind + ' while the ' + stage + ' timed try is out unanswered: that try is given up, the account is asked anew behind the same notice, and the app opens with that answer', async ({ page }) => {
        await watchAuth(page, true);
        await stalledOpening(page);
        let n = 2;
        await page.clock.runFor(2000); await checks.out(page, n);
        if (stage === 'last') for (const [limit, wait] of [[20000, 5000], [30000, 15000]]) {
          await page.clock.runFor(limit); await checks.ended(page, n); await armed(page, n);
          n += 1; await page.clock.runFor(wait); await checks.out(page, n);
        }
        // Five seconds into the try: its request was sent before the connection came back.
        await page.clock.runFor(5000);
        const shown = (await timeline(page)).notices.length, sent = await page.evaluate(() => Date.now());
        await retryButton(page).focus();
        await signal(page, kind);
        await checks.ended(page, n); await checks.out(page, n + 1);
        const state = await startup(page), seen = await timeline(page);
        assert.deepEqual([state.text, state.retry, await page.evaluate(() => document.activeElement?.textContent), seen.notices.length - shown], [FAILED_NOTICE, true, '다시 확인', 0], 'quietly: the same notice, button and focus');
        assert.deepEqual([seen.checks[n - 1].how, seen.checks[n - 1].ended - seen.checks[n - 1].at, seen.checks[n].at - sent], ['aborted', 5000, 0], 'the try ended at the signal, and the new check went out at the signal');
        await checks.answer(page, n + 1); await checks.release(page);
        await until(() => appOpen(page), 'the app to open');
        assert.equal(await page.evaluate(() => Date.now()) - sent, 0, 'the app opened with that answer: the clock has not moved since the signal');
        await listReady(page);
      }, { expect: failedCheck, clock: 'paused' });
    }

    await check('m2: sixty signals in a row while nothing is answered start three new checks and no more; with the three timed tries the page asks seven times in all', async ({ page }) => {
      await watchAuth(page, true);
      await stalledOpening(page);
      await page.clock.runFor(2000); await checks.out(page, 2);
      const burst = async () => { for (let i = 0; i < 30; i++) { await signal(page, 'online'); await signal(page, 'visibilitychange'); } };
      // The try only just went out (on the connection the signals are about): it is not given up.
      await burst(); await page.waitForTimeout(300);
      assert.equal((await timeline(page)).checks.length, 2, 'a check that went out this instant is not replaced');
      // One second later a burst replaces it once: the new check is itself fresh for the rest of the burst.
      for (const total of [3, 4, 5]) {
        await page.clock.runFor(1000);
        await burst(); await checks.out(page, total); await page.waitForTimeout(300);
        assert.equal((await timeline(page)).checks.length, total, 'one new check for one burst');
      }
      // The budget of three is spent: further bursts start nothing, now or during the rest of the timed tries.
      for (let i = 0; i < 12; i++) { await page.clock.runFor(1000 + i * 5000); await burst(); }
      await page.clock.runFor(600000); await burst(); await page.waitForTimeout(400);
      const seen = await timeline(page);
      assert.equal(seen.checks.length, 7, 'the opening, three timed tries and three restarts: ' + JSON.stringify(seen.checks.map(row => [row.at - seen.checks[0].at, row.how, row.ended === null ? null : row.ended - row.at])));
      assert.ok(seen.checks.every(row => row.how === 'aborted'));
      const state = await startup(page);
      assert.deepEqual([state.app, state.text, state.retry, state.stores], [false, FAILED_NOTICE, true, 0]);
    }, { expect: failedCheck, clock: 'paused' });

    await check('m2: a screen opened in a tab whose checks have been lapsing: it says the connection is slow, shows the notice and 다시 확인 at 10 s while the check goes on (it may take 20 s), and opens when the answer comes at 15 s', async ({ page }) => {
      await watchAuth(page, true);
      await stalledOpening(page);                      // this tab's level is raised: the next check may take 20 s
      await page.reload();
      await checks.out(page, 1);
      const checking = { app: false, text: CHECKING_SLOW, retry: false, welcome: false, stores: 0 };
      assert.deepEqual(await startup(page), checking);
      await page.clock.runFor(9999);
      assert.deepEqual(await startup(page), checking, 'still only checking one millisecond before 10 s');
      await page.clock.runFor(1); await retryShown(page);
      let seen = await timeline(page);
      assert.deepEqual([(await startup(page)).text, (await startup(page)).retry, (await startup(page)).stores, seen.checks.length, seen.checks[0].ended, seen.retries.length], [FAILED_NOTICE, true, 0, 1, null, 0],
        'the notice and the button are there; the same check is still out, and no timed try is armed for it');
      assert.equal(seen.notices.find(row => row.text === FAILED_NOTICE).at - seen.checks[0].at, 10000);
      await page.screenshot({ path: path.join(output, 'slow-check-notice.png') });
      await page.clock.runFor(5000);
      await checks.answer(page, 1); await checks.release(page);
      await until(() => appOpen(page), 'the app to open'); await listReady(page);
      seen = await timeline(page);
      assert.deepEqual([seen.checks[0].how, seen.checks[0].ended - seen.checks[0].at, await page.evaluate(() => Date.now()) - seen.checks[0].at], ['answered', 15000, 15000], 'the check that was still out opened the app when it was answered');
      assert.equal(await page.locator('#lifeStartup').isVisible(), false);
      // Open: a signal starts nothing on the first screen any more.
      const before = seen.notices.length;
      await signal(page, 'online'); await page.clock.runFor(30000); await page.waitForTimeout(300);
      assert.deepEqual([await appOpen(page), (await timeline(page)).notices.length - before, (await timeline(page)).retries.length], [true, 0, 0]);
    }, { expect: failedCheck, clock: 'paused' });

    await check('m2: the same screen when no answer comes: the check is given up at its 20 s, the notice shown at 10 s is not drawn again, and the timed tries follow; a signal in between asks anew', async ({ page }) => {
      await watchAuth(page, true);
      await stalledOpening(page);
      await page.reload();
      await checks.out(page, 1);
      await page.clock.runFor(10000); await retryShown(page);
      await retryButton(page).focus();
      const shown = (await timeline(page)).notices.length;
      // 14 s: the connection comes back. The check that has been out since the opening is replaced, quietly.
      await page.clock.runFor(4000); await signal(page, 'online');
      await checks.ended(page, 1); await checks.out(page, 2);
      // That one is not answered either: it is given up at its limit (30 s, as for 다시 확인) and the timed tries begin.
      await page.clock.runFor(30000); await checks.ended(page, 2); await armed(page, 1);
      await page.clock.runFor(2000); await checks.out(page, 3);
      const seen = await timeline(page);
      assert.deepEqual(seen.checks.map(row => [row.at - seen.checks[0].at, row.how, row.ended === null ? null : row.ended - row.at]), [[0, 'aborted', 14000], [14000, 'aborted', 30000], [46000, null, null]]);
      assert.deepEqual([(await startup(page)).text, (await startup(page)).retry, await page.evaluate(() => document.activeElement?.textContent), seen.notices.length - shown, (await startup(page)).stores], [FAILED_NOTICE, true, '다시 확인', 0, 0],
        'one notice from 10 s on: same text, same button, same focus');
    }, { expect: failedCheck, clock: 'paused' });

    for (const file of ['habits.html', 'goals.html', 'workspace.html']) {
      await check('m2: ' + file + ' that could not check the account opens again when the connection comes back, and when the page is shown again', async ({ page, context }) => {
        let failing = true;
        await context.route(cloud + '/auth/v1/user', route => failing ? route.fulfill({ status: 503, headers: json, body: '{"message":"anonymous upstream failure"}' }) : route.fallback());
        await page.goto(base + '/' + file);
        await page.locator('#accessRetry').waitFor();
        assert.equal(await page.locator('#accessState p').innerText(), PLAN_FAILED);
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

    // A plan page: what its access box says, whether 다시 확인 is offered, whether the page itself is shown.
    const plan = page => page.evaluate(() => ({ text: document.querySelector('#accessState').hidden ? null : document.querySelector('#accessState p').innerText, retry: !document.querySelector('#accessRetry').hidden && !document.querySelector('#accessState').hidden,
      open: !document.querySelector('[data-private]').hidden }));
    await check('m2: a plan page whose account check takes 25 seconds: 다시 확인 opens it again saying the connection is slow, offers 다시 확인 again at 10 s while that check goes on (up to 30 s), and the page opens when it is answered; open, it does not reload on a signal', async ({ page }) => {
      await watchAuth(page, true);
      await page.goto(base + '/habits.html');
      await checks.out(page, 1);
      assert.deepEqual(await plan(page), { text: CHECKING, retry: false, open: false });
      await page.clock.runFor(10000); await checks.ended(page, 1);
      await until(async () => (await plan(page)).retry, '다시 확인 on the plan page');
      assert.deepEqual(await plan(page), { text: PLAN_FAILED, retry: true, open: false });
      // 다시 확인: the page opens again, and its check may take 30 s.
      await page.evaluate(() => { window.__before = true; });
      await page.locator('#accessRetry').click();
      await until(() => asked(page, () => !window.__before && window.__auth?.checks.length >= 1), 'the page to open again and check the account');
      await page.evaluate(() => { window.__opened = true; });
      const checking = { text: CHECKING_SLOW, retry: false, open: false };
      assert.deepEqual(await plan(page), checking);
      await page.clock.runFor(9999);
      assert.deepEqual(await plan(page), checking, 'still only checking one millisecond before 10 s');
      await page.clock.runFor(1);
      await until(async () => (await plan(page)).retry, '다시 확인 at 10 s');
      assert.deepEqual([await plan(page), (await timeline(page)).checks[0].ended], [{ text: PLAN_FAILED, retry: true, open: false }, null], 'the notice and the button, with the same check still out');
      await page.clock.runFor(15000);
      await checks.answer(page, 1); await checks.release(page);
      await until(async () => (await plan(page)).open, 'the plan page to open');
      const seen = await timeline(page);
      assert.deepEqual([seen.checks[0].how, seen.checks[0].ended - seen.checks[0].at, await plan(page)], ['answered', 25000, { text: null, retry: false, open: true }]);
      // The page is in use from here on: the connection or the screen coming back does not open it again.
      await signal(page, 'online'); await signal(page, 'visibilitychange'); await page.waitForTimeout(500);
      assert.deepEqual([await page.evaluate(() => window.__opened === true), await plan(page)], [true, { text: null, retry: false, open: true }], 'the same document, still open');
    }, { expect: failedCheck, clock: 'paused' });

    // 연표 has its own access box (timeline-entry.js).
    const chart = page => asked(page, () => ({ page: location.pathname.split('/').pop(), text: document.querySelector('#timelineAccessMessage')?.innerText ?? null, retry: document.querySelector('#timelineRetry') ? !document.querySelector('#timelineRetry').hidden : null }));
    await check('m2: timeline.html whose account check takes 25 seconds: opened again with 다시 확인 it says the connection is slow, offers 다시 확인 at 10 s while the check goes on, and goes on when the check is answered', async ({ page, context }) => {
      await watchAuth(page, true);
      await page.goto(base + '/timeline.html');
      await checks.out(page, 1);
      assert.deepEqual(await chart(page), { page: 'timeline.html', text: CHECKING, retry: false });
      await page.clock.runFor(10000); await checks.ended(page, 1);
      await until(async () => (await chart(page)).retry, '다시 확인 on the timeline page');
      assert.deepEqual(await chart(page), { page: 'timeline.html', text: '계정을 확인하려면 인터넷 연결이 필요합니다. 연결 후 다시 시도해 주세요.', retry: true });
      await page.evaluate(() => { window.__before = true; });
      await page.locator('#timelineRetry').click();
      await until(() => asked(page, () => !window.__before && window.__auth?.checks.length >= 1), 'the page to open again and check the account');
      const checking = { page: 'timeline.html', text: CHECKING_SLOW, retry: false };
      assert.deepEqual(await chart(page), checking);
      await page.clock.runFor(9999);
      assert.deepEqual(await chart(page), checking, 'still only checking one millisecond before 10 s');
      await page.clock.runFor(1);
      await until(async () => (await chart(page)).retry, '다시 확인 at 10 s');
      assert.deepEqual([await chart(page), (await timeline(page)).checks[0].ended], [{ page: 'timeline.html', text: '연표를 열지 못했습니다. 연결이 끊겼거나 느립니다. 다시 확인해 주세요. 기기 사본은 보존했습니다.', retry: true }, null],
        'the notice and the button, with the same check still out');
      await page.clock.runFor(15000);
      // Answered at 25 s: the page goes on to read its documents, and says so instead of the notice (no 다시 확인).
      let read; const reading = new Promise(resolve => { read = resolve; });
      await context.route(/\/rest\/v1\/haedo_documents/, async route => { await reading; await route.fallback().catch(() => { /* The page moved on. */ }); });
      await checks.answer(page, 1);
      await until(async () => (await chart(page))?.text === '연표를 불러오고 있습니다.', 'the timeline page to say it is reading');
      assert.deepEqual(await chart(page), { page: 'timeline.html', text: '연표를 불러오고 있습니다.', retry: false });
      // This account has no 연표 yet, so the page goes on to the list of them (workspace.html), which checks the account itself.
      read();
      await until(async () => (await chart(page))?.page === 'workspace.html' && await asked(page, () => window.__auth?.checks.length >= 1), 'the timeline page to go on to its list');
      await checks.release(page);
      await until(async () => (await plan(page)).open, 'the list of 연표 to open');
    }, { expect: failedCheck, clock: 'paused' });

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

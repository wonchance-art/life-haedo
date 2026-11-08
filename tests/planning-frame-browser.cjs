/* 일정 통합 정리 C (2026-11-08, docs/design-review/schedule-consolidation.md S1·S8·S9) on the real
 * app, SDK and IDB with the anonymous intercepted Auth. haedo_items / haedo_documents are the
 * owner-scoped in-memory tables of schedule-entries-browser; account documents use FakeCloud.
 * - The label menu does not move between 일정 Y and the four 계획 screens (1440, 820).
 * - The 계획 tabs are the same four links in the same place, the current one marked aria-current="true"
 *   (the global menu keeps the document's one aria-current="page").
 * - Goals·habits·연표 headings hold only ‹ 일정으로 돌아가기, the title and that screen's add button; ‹
 *   and the title sit at the same x on all four screens (1440, 820, 390).
 * - Save state uses the two-step wording; a failed upload is retried from the status line. Nothing is
 *   said before the first account confirmation or offline with nothing to send; this device's own
 *   failure says 저장하지 못함; a settled state is for screen readers only on all four screens.
 * - habits.html?month=YYYY-MM opens that month (validated, never past the current month).
 * npm run dev; node tests/planning-frame-browser.cjs
 * Never uses real Google, production Supabase or Apple-device claims. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { PlatformTables } = require('./schedule-entries-browser.cjs');

const output = path.resolve(process.env.PLANNING_FRAME_OUTPUT || '.local/planning-frame-browser');
const TODAY = '2026-11-07T12:00:00+09:00';
const report = { checks: [], consoleErrors: [], pageErrors: [], expectedErrors: 0 };
const TABS = [['연간 계획', 'index.html?section=schedule&view=annual-plan'], ['목표', 'goals.html'], ['습관', 'habits.html'], ['연표', 'workspace.html']];
const BACK = ['일정으로 돌아가기', 'index.html?section=schedule&view=tools'];

function seed(tables) {
  const a = accounts.a.id;
  tables.seed('haedo_items', a, { id: 'h1', kind: 'habit', name: '아침 산책', data: { title: '아침 산책', days: [0, 2, 4], created: '2026-08-01', checks: ['2026-09-02', '2026-11-04'] } });
  tables.seed('haedo_items', a, { id: 'g1', kind: 'goal', name: '책 열두 권 읽기', data: { title: '책 열두 권 읽기', progress: 40, target: '2026-12-31' } });
  tables.seed('haedo_documents', a, { id: 'd_timeline', name: '내 연표', data: { profile: { name: '내 연표', birth: '1990-01' }, scale: 'signed1',
    events: [{ id: 'e1', date: '2026-03', title: '새 일 시작' }], spans: [], eras: [], happiness: [], thoughts: [], records: [], trips: [], layers: [] } });
}
async function platformReady(page) {
  await page.waitForFunction(() => document.querySelector('[data-private]')?.hidden === false && document.querySelector('.p-status-line')?.dataset.sync === 'idle');
}
async function open(page, url) {
  await page.goto(base + url);
  if (/^\/index\.html/.test(url)) { await ready(page); await page.waitForFunction(() => !document.querySelector('#lifeSchedule[aria-busy=true]') && (document.querySelector('#lifeMain')?.dataset.mode !== 'annual-plan' || document.querySelector('#apGrid'))); }
  else await platformReady(page);
}
// Frame facts of the screen on view: label menu box, 계획 tabs, heading controls.
async function frame(page) {
  return page.evaluate(() => {
    const shown = node => { const box = node.getBoundingClientRect(), style = getComputedStyle(node); return box.width > 1 && box.height > 1 && style.visibility !== 'hidden' && style.display !== 'none'; };
    const nav = document.querySelector('.haedo-nav').getBoundingClientRect();
    const planning = [...document.querySelectorAll('.haedo-planning-nav')].filter(shown);
    const heading = [...document.querySelectorAll('.haedo-page-heading')].find(shown);
    const tabs = planning.map(group => ({ name: group.getAttribute('aria-label'), box: [Math.round(group.getBoundingClientRect().left), Math.round(group.getBoundingClientRect().top + scrollY)],
      links: [...group.querySelectorAll('a')].map(link => [link.textContent, link.getAttribute('href')]), current: [...group.querySelectorAll('a[aria-current=true]')].map(link => link.textContent),
      currentAny: group.querySelectorAll('a[aria-current]').length,
      heights: [...group.querySelectorAll('a')].map(link => Math.round(link.getBoundingClientRect().height)) }));
    const controls = heading ? [...heading.querySelectorAll('a,button,summary')].filter(shown).map(node => node.getAttribute('aria-label') || node.textContent.trim()) : [];
    const back = heading?.querySelector('[data-section-back]'), backControl = heading?.querySelector('[aria-label="일정으로 돌아가기"]'), title = heading?.querySelector('h1');
    return { nav: [Math.round(nav.left), Math.round(nav.top), Math.round(nav.width)], tabs, controls, back: back && [back.getAttribute('aria-label'), back.getAttribute('href')],
      x: backControl && title ? { back: backControl.getBoundingClientRect().left, title: title.getBoundingClientRect().left } : null,
      pages: [...document.querySelectorAll('[aria-current=page]')].map(node => node.dataset.haedoSection || node.textContent.trim()),
      cloud: heading ? heading.querySelectorAll('#syncRetry, [data-haedo-icon=cloud], [data-account-menu], [data-login-link]').length : 0,
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
}
const statusText = page => page.evaluate(() => document.querySelector('#syncMessage').innerText.replace(/\s+/g, ' ').trim());

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, run, viewport = { width: 1440, height: 960 }) {
    if (process.env.PLANNING_FRAME_MATCH && !new RegExp(process.env.PLANNING_FRAME_MATCH).test(name)) return;
    const server = new FakeCloud(), tables = new PlatformTables('2026-11-07T02:00:00Z'), device = 'planning-' + report.checks.length;
    const context = await makeContext(browser, server, device, accounts.a, { viewport, timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
    await tables.attach(context); seed(tables);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    await page.clock.setFixedTime(new Date(TODAY));
    page.on('pageerror', error => report.pageErrors.push({ check: name, message: error.message }));
    page.on('console', event => {
      if (event.type() !== 'error') return;
      if (page.__expectFailure && /Failed to load resource:.*(500|503)/.test(event.text())) { report.expectedErrors++; return; }
      if (page.__expectOffline && /ERR_INTERNET_DISCONNECTED/.test(event.text())) { report.expectedErrors++; return; }
      report.consoleErrors.push({ check: name, message: event.text() });
    });
    try { await run({ page, context, server, tables }); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    for (const width of [1440, 820, 390]) {
      await check('the label menu stays put and the 계획 tabs match from 일정 Y through the four 계획 screens at ' + width, async ({ page }) => {
        await open(page, '/index.html'); // the first open sets up the account's local workspace
        const screens = [['year', '/index.html?section=schedule&view=tools', null], ['annual-plan', '/index.html?section=schedule&view=annual-plan', '연간 계획'],
          ['goals', '/goals.html', '목표'], ['habits', '/habits.html', '습관'], ['workspace', '/workspace.html', '연표']];
        const seen = {};
        for (const [name, url, current] of screens) {
          await open(page, url); seen[name] = await frame(page);
          assert.equal(seen[name].overflow, 0, name + ': no horizontal page scroll');
          if (current) await page.screenshot({ path: path.join(output, 'header-' + name + '-' + width + '.png'), clip: { x: 0, y: 0, width, height: 240 } });
          if (!current) continue;
          assert.equal(seen[name].tabs.length, 1, name + ': one 계획 tab group');
          const [tabs] = seen[name].tabs;
          assert.equal(tabs.name, '계획', name + ': the tab group is named 계획');
          assert.deepEqual(tabs.links, TABS, name + ': the same four tabs in the same order');
          assert.deepEqual(tabs.current, [current], name + ': only this screen is marked, as the current item of the set');
          assert.equal(tabs.currentAny, 1, name + ': no other tab carries aria-current');
          assert.deepEqual(seen[name].pages, ['schedule'], name + ': the global menu holds the one aria-current=page');
          assert(tabs.heights.every(height => height >= 44), name + ': tabs are 44px targets');
        }
        for (const name of ['annual-plan', 'goals', 'habits', 'workspace']) {
          assert.deepEqual(seen[name].nav, seen.year.nav, name + ': the label menu is where 일정 Y puts it');
          assert.deepEqual(seen[name].tabs[0].box, seen['annual-plan'].tabs[0].box, name + ': the tabs are in the same place');
          // ‹ and the title line up across the four screens (review #2 m1: 연간 계획 sat 12px to the right).
          assert(Math.abs(seen[name].x.back - seen.goals.x.back) <= 1, name + ': ‹ at the x of 목표 (' + seen[name].x.back + ' vs ' + seen.goals.x.back + ')');
          assert(Math.abs(seen[name].x.title - seen.goals.x.title) <= 1, name + ': the title at the x of 목표 (' + seen[name].x.title + ' vs ' + seen.goals.x.title + ')');
        }
        for (const [name, add] of [['goals', '목표 추가'], ['habits', '습관 추가'], ['workspace', '새 연표']]) {
          assert.deepEqual(seen[name].back, BACK, name + ': ‹ goes back to 일정 Y');
          // On a phone the global 글쓰기 takes its fixed place at the heading's right end (2026-11-02).
          assert.deepEqual(seen[name].controls, width === 390 ? [BACK[0], add, '글쓰기'] : [BACK[0], add], name + ': the heading holds only ‹, the title and its add button');
          assert.equal(seen[name].cloud, 0, name + ': no sync or account icon in the heading');
        }
        await page.screenshot({ path: path.join(output, 'workspace-' + width + '.png') });
      }, { width, height: width === 820 ? 1180 : 960 });
    }

    await check('goals: two-step save state, a failed upload retried from the status line keeps focus and reaches the account', async ({ page, tables }) => {
      page.__expectFailure = true;
      await open(page, '/goals.html');
      const line = page.locator('.p-status-line');
      assert.equal(await statusText(page), '저장됨 · 계정에 올림');
      assert.equal(await line.getAttribute('data-state'), 'ok'); assert.equal(await page.locator('#syncRetry').isHidden(), true);
      assert.equal(await line.getAttribute('data-idle'), 'true', 'a settled state is for screen readers only');
      // Held upload: stored on this device, not yet in the account.
      let release; tables.hold = new Promise(resolve => { release = resolve; });
      await page.locator('#addItem').click(); await page.locator('#itemTitle').fill('긴 산책 열 번'); await page.locator('#itemForm [type=submit]').click();
      await page.waitForFunction(() => document.querySelector('.p-status-line').dataset.state === 'pending');
      assert.equal(await statusText(page), '계정에 올리기 대기');
      // The status line is the one save sentence; no third phrase (review #1: 기기에 저장했습니다).
      assert.equal(await page.locator('#platformToast').isHidden(), true, 'no save toast');
      assert.doesNotMatch(await page.locator('body').innerText(), /기기에 저장했습니다/);
      tables.hold = null; release();
      await page.waitForFunction(() => document.querySelector('.p-status-line').dataset.state === 'ok');
      assert.equal(await statusText(page), '저장됨 · 계정에 올림');
      assert(tables.owned('haedo_items', accounts.a.id).some(row => row.data.title === '긴 산책 열 번'));
      // Failed upload: the retry is part of the sentence, reachable by keyboard.
      tables.fail = 'haedo_items';
      await page.locator('#addItem').click(); await page.locator('#itemTitle').fill('편지 세 통'); await page.locator('#itemForm [type=submit]').click();
      await page.waitForFunction(() => document.querySelector('.p-status-line').dataset.state === 'error');
      assert.equal(await statusText(page), '계정에 올리지 못함 · 다시 시도');
      assert.equal(await line.getAttribute('data-idle'), 'false'); assert.equal(await page.locator('#syncRetry').isVisible(), true);
      assert.equal(tables.owned('haedo_items', accounts.a.id).some(row => row.data.title === '편지 세 통'), false);
      assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem(HaedoPlatformData.keys(HaedoAuth.user.id).items))).some(item => item.data.title === '편지 세 통'), true, 'the device copy is kept');
      const box = await page.locator('#syncRetry').boundingBox(); assert(box.height >= 44, 'retry is a 44px target');
      tables.fail = null;
      await page.locator('#syncRetry').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.p-status-line').dataset.state === 'ok');
      assert.equal(await statusText(page), '저장됨 · 계정에 올림');
      assert(tables.owned('haedo_items', accounts.a.id).some(row => row.data.title === '편지 세 통'), 'the retry sent the item');
      assert.equal(await page.evaluate(() => document.activeElement?.matches('.haedo-page-heading h1')), true, 'focus stays on the screen after the retry button goes');
    });

    await check('a failed account pass says 계정에 올리지 못함 with its reason; 다시 시도 reruns the pass', async ({ page, context }) => {
      page.__expectFailure = true;
      let failing = true;
      await context.route(new RegExp('^' + cloud.replace(/[.]/g, '\\.') + '/rest/v1/haedo_items'), route => failing && route.request().method() === 'GET'
        ? route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: '{}' }) : route.fallback());
      await page.goto(base + '/habits.html');
      await page.waitForFunction(() => document.querySelector('.p-status-line')?.dataset.state === 'error');
      assert.match(await statusText(page), /^계정에 올리지 못함 · 다시 시도 \S/, 'the state, then its reason');
      failing = false;
      await page.locator('#syncRetry').click();
      await page.waitForFunction(() => document.querySelector('.p-status-line').dataset.state === 'ok');
      assert.equal(await statusText(page), '저장됨 · 계정에 올림');
    });

    await check('habits.html?month= opens a valid past month, ignores invalid or future values and keeps the month on reload', async ({ page }) => {
      const label = () => page.locator('#habitMonthLabel').textContent();
      await open(page, '/habits.html?month=2026-09'); assert.equal(await label(), '2026년 9월');
      assert.equal(await page.locator('#habitThisMonth').isVisible(), true);
      for (const value of ['2027-01', '2026-13', '26-09', 'x', '1899-12']) { await open(page, '/habits.html?month=' + value); assert.equal(await label(), '2026년 11월', value + ' is not opened'); }
      await open(page, '/habits.html?month=2026-09');
      const length = await page.evaluate(() => history.length);
      await page.locator('#habitPrevMonth').click(); assert.equal(await label(), '2026년 8월');
      assert.equal(new URL(page.url()).searchParams.get('month'), '2026-08'); assert.equal(await page.evaluate(() => history.length), length, 'the same screen replaces its address');
      await page.reload(); await platformReady(page); assert.equal(await label(), '2026년 8월');
      await page.locator('#habitThisMonth').click(); assert.equal(new URL(page.url()).searchParams.has('month'), false);
      // The recovery list keeps its address.
      await open(page, '/habits.html?month=2026-10#recovery'); await page.locator('#recoveryDialog[open]').waitFor(); assert.equal(await label(), '2026년 10월');
    });

    await check('goals: nothing is said during the first account check; 저장됨 · 계정에 올림 only after it', async ({ page, context, tables }) => {
      // Every text the line shows from the first paint, with the line's data-sync at that moment.
      await context.addInitScript(() => {
        window.__statusSeen = [];
        const record = () => { const line = document.querySelector('.p-status-line'), text = document.querySelector('#syncMessage [data-status-state]')?.textContent;
          if (line && text !== undefined) window.__statusSeen.push([line.dataset.sync, line.dataset.state, text]); };
        document.addEventListener('DOMContentLoaded', () => new MutationObserver(record).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-sync', 'data-state'] }));
      });
      let release; tables.hold = new Promise(resolve => { release = resolve; });
      await page.goto(base + '/goals.html');
      await page.waitForFunction(() => document.querySelector('[data-private]')?.hidden === false && document.querySelector('#syncMessage [data-status-state]'));
      const line = page.locator('.p-status-line');
      assert.equal(await line.getAttribute('data-sync'), 'busy'); assert.equal(await line.getAttribute('data-state'), 'unknown');
      assert.equal(await statusText(page), '', 'nothing is known yet'); assert.equal(await line.getAttribute('data-idle'), 'true');
      tables.hold = null; release();
      await platformReady(page);
      assert.equal(await statusText(page), '저장됨 · 계정에 올림');
      const seen = await page.evaluate(() => window.__statusSeen);
      assert(seen.length, 'the line was observed');
      assert.deepEqual(seen.filter(([sync, , text]) => sync === 'busy' && text), [], 'no state sentence before the first account check finished');
    });

    await check('goals offline: nothing to send says nothing; an unsent item waits (계정에 올리기 대기) and goes up when online', async ({ page, context, tables }) => {
      await context.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => window.__online === true }); });
      let offline = true;
      await context.route(new RegExp('^' + cloud.replace(/[.]/g, '\\.') + '/rest/v1/haedo_'), route => offline ? route.abort('internetdisconnected') : route.fallback());
      page.__expectOffline = true;
      await page.goto(base + '/goals.html');
      await page.waitForFunction(() => document.querySelector('[data-private]')?.hidden === false && document.querySelector('.p-status-line')?.dataset.sync === 'idle');
      const line = page.locator('.p-status-line');
      assert.equal(await line.getAttribute('data-state'), 'unknown', 'offline with nothing to send is not a failure');
      assert.equal(await statusText(page), ''); assert.equal(await page.locator('#syncRetry').isHidden(), true); assert.equal(await line.getAttribute('data-idle'), 'true');
      await page.locator('#addItem').click(); await page.locator('#itemTitle').fill('오프라인 산책'); await page.locator('#itemForm [type=submit]').click();
      await page.waitForFunction(() => document.querySelector('.p-status-line').dataset.state === 'pending');
      await page.waitForTimeout(400);
      assert.equal(await line.getAttribute('data-state'), 'pending', 'the failed upload offline waits, it is not 계정에 올리지 못함');
      assert.equal(await statusText(page), '계정에 올리기 대기'); assert.equal(await page.locator('#syncRetry').isHidden(), true);
      offline = false;
      await page.evaluate(() => { window.__online = true; dispatchEvent(new Event('online')); });
      await page.waitForFunction(() => document.querySelector('.p-status-line').dataset.state === 'ok');
      assert.equal(await statusText(page), '저장됨 · 계정에 올림');
      assert(tables.owned('haedo_items', accounts.a.id).some(row => row.data.title === '오프라인 산책'), 'the waiting item reached the account');
    });

    await check('goals: an account pass that changes nothing does not rewrite the status sentence', async ({ page, tables }) => {
      await open(page, '/goals.html');
      await page.evaluate(() => { window.__statusWrites = 0; new MutationObserver(list => { window.__statusWrites += list.length; }).observe(document.querySelector('#syncMessage'), { subtree: true, childList: true, characterData: true }); });
      const calls = tables.calls.length;
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForFunction(calls => document.querySelector('.p-status-line').dataset.sync === 'idle', calls);
      await page.waitForTimeout(400);
      assert(tables.calls.length > calls, 'a pass ran');
      assert.equal(await statusText(page), '저장됨 · 계정에 올림');
      assert.equal(await page.evaluate(() => window.__statusWrites), 0, 'the live region is not rewritten with the same sentence');
    });

    await check('annual plan: 저장 중… then 저장됨 · 계정에 올림 only after the account row is synced; a failed upload is retried', async ({ page, context }) => {
      page.__expectFailure = true;
      let failing = false;
      await context.route(new RegExp('^' + cloud.replace(/[.]/g, '\\.') + '/rest/v1/rpc/life_account_document_put'), route => failing
        ? route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: '{"message":"anonymous failure"}' }) : route.fallback());
      await open(page, '/index.html?section=schedule&view=annual-plan');
      const state = () => page.locator('.annual-plan').getAttribute('data-save-state'), text = () => page.locator('#apSaveStatus').textContent();
      const hidden = () => page.locator('.ap-save-line').evaluate(node => node.dataset.idle === 'true' && node.getBoundingClientRect().width <= 1);
      // No plan stored yet: nothing to say (review #1 m1: it said 저장됨 · 계정에 올림 before any record).
      await page.waitForTimeout(400);
      assert.equal(await state(), 'none'); assert.equal(await text(), ''); assert.equal(await hidden(), true);
      await page.locator('[data-ap-annual]').first().fill('처음 적는 계획');
      await page.waitForFunction(() => document.querySelector('.annual-plan')?.dataset.saveState === 'ok');
      assert.equal(await text(), '저장됨 · 계정에 올림');
      assert.equal(await hidden(), true, 'a settled state is for screen readers only, like goals·habits·연표');
      // An account pass that changes nothing does not rewrite the live region (review #3 n1).
      await page.evaluate(() => { window.__apWrites = 0; new MutationObserver(list => { window.__apWrites += list.length; }).observe(document.querySelector('#apSaveStatus'), { subtree: true, childList: true, characterData: true }); });
      await page.evaluate(async () => { for (let i = 0; i < 3; i++) await HaedoLife.Shell.accountDocsSync.syncNow(); });
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => window.__apWrites), 0, 'the same sentence is not written again'); assert.equal(await text(), '저장됨 · 계정에 올림');
      failing = true;
      const input = page.locator('[data-ap-annual]').first();
      await input.fill('천천히 오래 걷기');
      assert.equal(await text(), '저장 중…', 'unsaved input is never called saved');
      await page.waitForFunction(() => document.querySelector('.annual-plan').dataset.saveState === 'error');
      assert.equal((await page.locator('.ap-save-line').textContent()).replace(/\s+/g, ' ').trim(), '계정에 올리지 못함 · 다시 시도');
      assert.equal(await page.locator('#apRetry').isVisible(), true);
      const local = await page.evaluate(async () => { const s = HaedoLife.Shell.storage; return (await s.readAnnualPlan(await s.getActive())).rows[0]?.text; });
      assert.equal(local, '천천히 오래 걷기', 'the plan is stored on this device');
      assert.equal(await input.inputValue(), '천천히 오래 걷기');
      failing = false;
      await page.locator('#apRetry').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.annual-plan').dataset.saveState === 'ok');
      assert.equal(await text(), '저장됨 · 계정에 올림'); assert.equal(await state(), 'ok');
      assert.equal(await page.evaluate(() => document.activeElement?.matches('.life-page-title')), true, 'focus stays on the screen after the retry button goes');
    });

    await check('annual plan offline: an edit waits (계정에 올리기 대기), never 계정에 올리지 못함, and goes up when online', async ({ page, context }) => {
      await context.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => window.__online !== false }); });
      page.__expectOffline = true;
      await open(page, '/index.html?section=schedule&view=annual-plan');
      const input = page.locator('[data-ap-annual]').first();
      await input.fill('연결 전 계획'); await page.waitForFunction(() => document.querySelector('.annual-plan')?.dataset.saveState === 'ok');
      let offline = true;
      await context.route(new RegExp('^' + cloud.replace(/[.]/g, '\\.') + '/rest/v1/rpc/life_account_document'), route => offline ? route.abort('internetdisconnected') : route.fallback());
      await page.evaluate(() => { window.__online = false; dispatchEvent(new Event('offline')); });
      await input.fill('연결 없이 고친 계획');
      await page.waitForFunction(() => document.querySelector('.annual-plan').dataset.saveState === 'pending');
      await page.waitForTimeout(600);
      assert.equal(await page.locator('.annual-plan').getAttribute('data-save-state'), 'pending');
      assert.equal(await page.locator('#apSaveStatus').textContent(), '계정에 올리기 대기'); assert.equal(await page.locator('#apRetry').isHidden(), true);
      offline = false;
      await page.evaluate(() => { window.__online = true; dispatchEvent(new Event('online')); });
      await page.waitForFunction(() => document.querySelector('.annual-plan').dataset.saveState === 'ok');
      assert.equal(await page.locator('#apSaveStatus').textContent(), '저장됨 · 계정에 올림');
    });

    await check('annual plan without an account-document engine looks for it a bounded number of times', async ({ page, context }) => {
      // The shell's engine never appears (e.g. a failed start): the plan stops looking instead of
      // reading IndexedDB every second for as long as it is open (review #1 NIT).
      await context.addInitScript(() => {
        window.__engineLooks = 0; let shell;
        const life = window.HaedoLife = window.HaedoLife || {};
        Object.defineProperty(life, 'Shell', { configurable: true, get: () => shell, set(value) {
          shell = value; Object.defineProperty(value, 'accountDocsSync', { configurable: true, get: () => { window.__engineLooks++; return null; } });
        } });
      });
      await page.goto(base + '/index.html?section=schedule&view=annual-plan');
      await ready(page); await page.locator('#apGrid').waitFor();
      const start = await page.evaluate(() => window.__engineLooks);
      await page.clock.runFor(60000);
      const looks = await page.evaluate(() => window.__engineLooks) - start;
      assert(looks <= 12, 'bounded looks in a minute, not one a second (' + looks + ')');
      await page.clock.runFor(60000);
      assert.equal(await page.evaluate(() => window.__engineLooks) - start, looks, 'no more looks after the bound');
    });

    await check('연표 from 설정 > 백업·복원 keeps its own back link and no 계획 tabs; the timeline editor goes back to 연표 목록', async ({ page }) => {
      await open(page, '/workspace.html?section=manage');
      const facts = await frame(page);
      assert.deepEqual(facts.back, ['백업·복원으로 돌아가기', 'index.html?section=manage&view=backup']);
      assert.equal(facts.tabs.length, 0);
      await page.goto(base + '/timeline.html?doc=d_timeline');
      assert.deepEqual(await page.locator('header [data-section-back]').evaluate(node => [node.getAttribute('aria-label'), node.getAttribute('href')]), ['연표 목록으로 돌아가기', 'workspace.html']);
    });
  } finally { await browser.close(); }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(report.pageErrors, [], 'page errors'); assert.deepEqual(report.consoleErrors, [], 'console errors');
  assert(report.checks.length && report.checks.every(item => item.pass), 'all checks pass');
  console.log(JSON.stringify({ checks: report.checks.length, expectedErrors: report.expectedErrors }));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

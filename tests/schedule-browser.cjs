/* 일정 B1 (2026-11-02 부드러운 판): 목록·Y·Q·M·W·D on the real app, SDK and IDB with an
 * anonymous intercepted Auth only. npm run dev; node tests/schedule-browser.cjs
 * Checks: old addresses open the exact unit, list↔Y↔D keeps the list's scroll and search,
 * the iPhone 연→월→일 hierarchy with ‹ and browser back/forward, late reads across a unit
 * change and an account change, and 1440·820·390 without horizontal overflow or errors.
 * SCHEDULE_OUTPUT keeps screenshots and static copies for scripts/check-alignment.cjs.
 * Never uses real Google, production Supabase or Apple-device claims. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');

const output = path.resolve(process.env.SCHEDULE_OUTPUT || '.local/schedule-browser');
const TODAY = '2026-11-03T12:00:00+09:00';
const PRIVATE = '계정 A에서만 보일 일정 글';
const report = { checks: [], consoleErrors: [], pageErrors: [], overflow: [], visual: [], aligned: [] };

// Faults surround real storage reads; a held result is a genuine read finished late.
async function instrumentStorage(context) {
  await context.route(`${base}/assets/life/storage.js`, async route => {
    const response = await route.fetch(), source = await response.text();
    const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);
      const hold=async(name,result)=>{if(window.__scheduleHold===name){window.__scheduleHeld=true;await new Promise(resolve=>{window.__scheduleRelease=()=>{window.__scheduleHold=null;resolve();};});}window.__scheduleReads=(window.__scheduleReads||0)+1;return result;};
      return Object.freeze({...actual,async readAnnualPlan(...v){return hold('plan',await actual.readAnnualPlan(...v));}});}});})();`;
    await route.fulfill({ response, body: source + hook });
  });
}
async function seed(page) {
  return page.evaluate(async ({ PRIVATE }) => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, m = HaedoLife.PhotoPost, ws = await s.getActive(), ids = {};
    const rows = [['2026-11-02T22:10:00+09:00', PRIVATE], ['2026-10-29T11:40:00+09:00', '비 오는 날 동네 도서관'], ['2026-10-28T21:05:00+09:00', '창가 자리에서 읽은 책'],
      ['2026-10-21T14:30:00+09:00', '천변을 따라 걸은 날'], ['2026-09-14T09:00:00+09:00', '추석 장보기'], ['2026-03-02T10:00:00+09:00', '달리기 첫 주'], ['2025-10-28T12:00:00+09:00', '새 일 두 번째 달']];
    for (const [at, title] of rows) {
      const doc = m.create(c.id, new Date(at).toISOString()); doc.title = title; doc.status = 'saved';
      doc.ops = [{ insert: '퇴근길에 한 정거장 먼저 내려 천변을 따라 걸었다. 가로등이 켜지는 순서를 세다가 집 앞까지 왔다.\n' }];
      if (title === '비 오는 날 동네 도서관') {
        const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600; const g = canvas.getContext('2d'); g.fillStyle = '#b9cbc4'; g.fillRect(0, 0, 800, 600); g.fillStyle = '#c7b79a'; g.fillRect(0, 380, 800, 220);
        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', .9)); const image = await m.readPhoto(new File([blob], 'anonymous.jpg', { type: blob.type }), c.id);
        doc.photos = [image]; doc.ops.push({ insert: { photo: { id: image.id, caption: '창가 자리', alt: '창가 자리를 그린 합성 이미지' } } }, { insert: '\n' });
      }
      await s.savePhotoPost(ws, doc, 0); ids[title] = doc.id;
    }
    // Twenty more posts make the list long enough to scroll.
    for (let i = 0; i < 20; i++) {
      const doc = m.create(c.id, new Date(Date.UTC(2026, 7, 28 - i, 3)).toISOString()); doc.title = '여름 산책 기록 ' + (i + 1); doc.status = 'saved';
      doc.ops = [{ insert: '여름 저녁의 산책을 남긴다. ' + i + '\n' }]; await s.savePhotoPost(ws, doc, 0);
    }
    const plan = await s.readAnnualPlan(ws), baseRevision = plan.revision;
    plan.entries = [{ id: 'p1', date: '2026-10-30', text: '도서관 야간 개관' }, { id: 'p2', date: '2026-11-14', text: '제주 여행' }, { id: 'p3', date: '2026-12-19', text: '원고 마감 준비' }];
    plan.rows = [{ year: 2026, text: '천천히 오래 걷기' }];
    plan.revision = baseRevision + 1; plan.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
    const saved = await s.saveAnnualPlan(ws, plan, baseRevision); if (saved.status !== 'stored') throw new Error('plan fixture');
    return { workspaceId: ws, ids };
  }, { PRIVATE });
}
const mode = page => page.locator('#lifeMain').getAttribute('data-mode');
async function shown(page, expected) {
  await page.waitForFunction(value => document.querySelector('#lifeMain')?.dataset.mode === value && !document.querySelector('.life-app[aria-busy="true"]') &&
    (!document.querySelector('#lifeSchedule') || document.querySelector('#lifeSchedule').getAttribute('aria-busy') === 'false') &&
    (value !== 'home' || document.querySelector('#homePosts')?.getAttribute('aria-busy') === 'false'), expected);
}
async function overflow(page, scene) {
  const value = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const width = page.viewportSize().width;
  report.overflow.push({ scene, width, value });
  assert.equal(value, 0, 'no horizontal overflow: ' + scene + ' ' + width);
}
// A static copy of the rendered app for scripts/check-alignment.cjs (no scripts run there).
async function alignmentCopy(page, name) {
  const html = await page.evaluate(href => {
    const copy = document.documentElement.cloneNode(true);
    copy.querySelectorAll('script').forEach(node => node.remove());
    // A closed <details> shows only its summary; the static copy keeps just that (the measurer reads text rects).
    copy.querySelectorAll('details:not([open])').forEach(node => [...node.children].forEach(child => { if (child.tagName !== 'SUMMARY') child.remove(); }));
    (copy.querySelector('#lifeApp .life-app') || copy.querySelector('#lifeApp'))?.setAttribute('data-align-root', '');
    const baseNode = document.createElement('base'); baseNode.href = href; copy.querySelector('head').prepend(baseNode);
    return '<!doctype html>\n' + copy.outerHTML;
  }, base + '/');
  const file = path.join(output, 'align', name + '.html');
  await fs.writeFile(file, html); report.aligned.push(file);
}

async function main() {
  await fs.mkdir(path.join(output, 'align'), { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, run, viewport = { width: 1440, height: 960 }) {
    if (process.env.SCHEDULE_TEST_MATCH && !new RegExp(process.env.SCHEDULE_TEST_MATCH).test(name)) return;
    const server = new FakeCloud(), device = 'schedule-' + report.checks.length;
    const context = await makeContext(browser, server, device, accounts.a, { viewport, timezoneId: 'Asia/Seoul', locale: 'ko-KR' });
    await instrumentStorage(context);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    await page.clock.setFixedTime(new Date(TODAY));
    page.on('pageerror', error => report.pageErrors.push({ check: name, message: error.message }));
    page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ check: name, message: event.text() }); });
    console.log('RUN ' + name);
    try { await run({ page, context, server, device }); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    await check('old addresses open the exact 일정 unit and a dated unit reopens after reload', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); await seed(page);
      const cases = [
        ['/index.html', 'home', null], ['/index.html?section=home', 'home', null], ['/index.html?section=schedule', 'home', null],
        ['/index.html?section=tools', 'tools', 'tools'], ['/index.html?section=schedule&view=tools', 'tools', 'tools'],
        ['/index.html?section=tools&view=annual-plan', 'annual-plan', null], ['/index.html?view=time', 'time', null]
      ];
      for (const [address, expected, current] of cases) {
        await page.goto(base + address); await ready(page); await shown(page, expected);
        assert.equal(await page.locator('[data-haedo-navigation] [data-haedo-section="schedule"]').getAttribute('aria-current'), 'page', address + ' is 일정');
        if (current) assert.equal(await page.locator('[data-schedule-view="' + current + '"]').getAttribute('aria-current'), 'true', address);
        if (expected === 'annual-plan') {
          // Y의 계획 칸: the plan editor, returning to Y.
          await page.locator('#apGrid').waitFor(); assert.equal(new URL(page.url()).searchParams.get('view'), 'annual-plan');
          await page.locator('#lifeSubviewReturn').click(); await shown(page, 'tools');
          await page.waitForFunction(() => document.activeElement?.dataset.focusKey === 'tools:annual-plan');
        }
        if (expected === 'tools') {
          assert.deepEqual(await page.locator('#lifeMain .life-destination strong').allTextContents(), ['연간 계획', '목표', '습관', '연표']);
          assert.match(await page.locator('.schedule-aside').innerText(), /제주 여행/);
          assert.equal(await page.locator('#lifeApp .life-page-title').innerText(), '2026년');
        }
      }
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-10-29'); await ready(page); await shown(page, 'day');
      assert.equal(await page.locator('#lifeApp .life-page-title').innerText(), '10월 29일 목요일');
      assert.match(await page.locator('#lifeSchedule').innerText(), /비 오는 날 동네 도서관/);
      await page.reload(); await ready(page); await shown(page, 'day');
      assert.equal(new URL(page.url()).searchParams.get('date'), '2026-10-29');
      assert.equal(await page.locator('#lifeApp .life-page-title').innerText(), '10월 29일 목요일');
      // ‹ › replace the same screen; a unit change is a new entry.
      const before = await page.evaluate(() => history.length);
      await page.locator('[data-schedule-step="1"]').click(); await shown(page, 'day');
      assert.equal(new URL(page.url()).searchParams.get('date'), '2026-10-30'); assert.equal(await page.evaluate(() => history.length), before);
      assert.match(await page.locator('#lifeSchedule').innerText(), /도서관 야간 개관/);
      await page.keyboard.press('m'); await shown(page, 'month');
      assert.equal(await page.locator('#lifeApp .life-page-title').innerText(), '10월');
      await page.goBack(); await shown(page, 'day'); assert.equal(new URL(page.url()).searchParams.get('date'), '2026-10-30');
      await page.keyboard.press('t'); await shown(page, 'day'); assert.equal(new URL(page.url()).searchParams.get('date'), '2026-11-03');
    });

    await check('list → Y → D → list keeps the list scroll, tab and search; Y and D open exact posts and return', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); const fixture = await seed(page);
      await page.reload(); await ready(page); await shown(page, 'home');
      // Date headings group the posts; the newest post comes first.
      assert.equal(await page.locator('#homePostList .home-day-heading').first().innerText(), '11월 2일 월요일');
      assert.equal(await page.locator('#homePostList .home-post-open').first().innerText(), PRIVATE);
      await page.locator('.home-search-toggle').click(); await page.locator('#homePostSearch').fill('산책');
      await page.waitForFunction(() => document.querySelectorAll('#homePostList .home-post').length > 5);
      await page.evaluate(() => scrollTo({ top: 900, behavior: 'instant' })); const listScroll = await page.evaluate(() => scrollY);
      // A pointer press on the sticky heading does not scroll (Playwright's own click would scroll the control into view).
      const press = selector => page.locator(selector).evaluate(node => node.click());
      await press('[data-schedule-view="tools"]'); await shown(page, 'tools');
      assert.equal(await page.evaluate(() => scrollY), 0);
      await press('[data-schedule-view="day"]'); await shown(page, 'day');
      assert.equal(await page.locator('#lifeApp .life-page-title').innerText(), '11월 3일 화요일');
      await press('[data-schedule-view="home"]'); await shown(page, 'home');
      assert.equal(await page.locator('#homePostSearch').inputValue(), '산책');
      await page.waitForFunction(top => Math.abs(scrollY - top) < 2, listScroll);
      // A post opened from D returns to the same day.
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-10-29'); await ready(page); await shown(page, 'day');
      await page.locator('[data-schedule-item="photo:' + fixture.ids['비 오는 날 동네 도서관'] + '"]').click();
      await page.locator('#lifeMain[data-mode="page"]').waitFor(); await page.locator('.photo-article').waitFor();
      assert.match(await page.locator('.photo-article').innerText(), /비 오는 날 동네 도서관/);
      await page.locator('#lifeSubviewReturn, [data-subview-return]').first().click(); await shown(page, 'day');
      assert.equal(new URL(page.url()).searchParams.get('date'), '2026-10-29');
      await page.waitForFunction(id => document.activeElement?.dataset.scheduleItem === 'photo:' + id, fixture.ids['비 오는 날 동네 도서관']);
      // Y: a month row opens M; a plan opens its day.
      await page.locator('[data-schedule-view="tools"]').click(); await shown(page, 'tools');
      await page.locator('[data-focus-key="schedule:month:2026-10"]').click(); await shown(page, 'month');
      await page.locator('[data-focus-key="schedule:day:2026-10-28"]').click(); await shown(page, 'day');
      assert.match(await page.locator('#lifeSchedule').innerText(), /창가 자리에서 읽은 책/);
      assert.match(await page.locator('.schedule-other-years').innerText(), /2025[\s\S]*새 일 두 번째 달/);
    });

    await check('iPhone opens the list first, goes 연 → 월 → 일, ‹ goes up and back/forward follow the levels', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); await seed(page);
      await page.reload(); await ready(page); await shown(page, 'home');
      assert.equal(await page.locator('#lifeApp nav[aria-label="보기 단위"] [data-schedule-view="month"]').isVisible(), false, 'no unit buttons on a phone');
      await page.locator('[data-schedule-view="tools"]').click(); await shown(page, 'tools');
      assert.equal(await page.locator('[data-schedule-up="home"]').isVisible(), true);
      await page.locator('[data-focus-key="schedule:month:2026-10"]').click(); await shown(page, 'month');
      assert.equal(await page.locator('[data-schedule-up="tools"]').innerText(), '2026');
      await page.locator('[data-focus-key="schedule:day:2026-10-29"]').click(); await shown(page, 'day');
      assert.equal(await page.locator('[data-schedule-up="month"]').innerText(), '10월');
      assert.equal(await page.locator('.schedule-week-strip').isVisible(), true);
      await page.locator('.schedule-strip-day[aria-label^="10월 28일"]').click(); await shown(page, 'day');
      assert.equal(new URL(page.url()).searchParams.get('date'), '2026-10-28');
      await page.goBack(); await shown(page, 'month');
      await page.goBack(); await shown(page, 'tools');
      await page.goBack(); await shown(page, 'home');
      await page.goForward(); await shown(page, 'tools');
      await page.goForward(); await shown(page, 'month');
      await page.goForward(); await shown(page, 'day'); assert.equal(new URL(page.url()).searchParams.get('date'), '2026-10-28');
      await page.locator('[data-schedule-up="month"]').click(); await shown(page, 'month');
      await page.locator('[data-schedule-up="tools"]').click(); await shown(page, 'tools');
      await page.locator('[data-schedule-up="home"]').click(); await shown(page, 'home');
    }, { width: 390, height: 844 });

    await check('a late plan read cannot replace the next unit or reveal account A after an account change', async ({ page, server, device }) => {
      await page.goto(base + '/index.html'); await ready(page); await seed(page);
      await page.goto(base + '/index.html?section=schedule&view=month&date=2026-10-28'); await ready(page); await shown(page, 'month');
      await page.evaluate(() => { window.__scheduleHold = 'plan'; window.__scheduleHeld = false; });
      await page.locator('[data-schedule-view="tools"]').click(); await page.waitForFunction(() => __scheduleHeld);
      await page.locator('[data-schedule-view="day"]').click(); await page.waitForFunction(() => document.querySelector('#lifeMain')?.dataset.mode === 'day');
      const reads = await page.evaluate(() => __scheduleReads || 0);
      await page.evaluate(() => __scheduleRelease()); await page.waitForFunction(n => __scheduleReads > n, reads); await shown(page, 'day');
      assert.equal(await mode(page), 'day'); assert.equal(await page.locator('.schedule-year-rows').count(), 0);
      // Account change while a Y read is held.
      await page.evaluate(() => { window.__scheduleHold = 'plan'; window.__scheduleHeld = false; });
      await page.locator('[data-schedule-view="tools"]').click(); await page.waitForFunction(() => __scheduleHeld);
      await page.evaluate(() => { window.__scheduleSignout = HaedoAuth.client.auth.signOut({ scope: 'local' }); });
      await page.waitForFunction(() => document.querySelector('#lifeApp').hidden && !HaedoLife.Shell.storage);
      await page.evaluate(() => __scheduleRelease()); await page.waitForFunction(() => HaedoAuth.user === null);
      assert(!(await page.locator('body').innerText()).includes(PRIVATE));
      server.oauthAccounts.set(device, accounts.b); await page.locator('[data-life-login]').click(); await page.locator('#googleLogin').click();
      await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page);
      await page.goto(base + '/index.html?section=tools'); await ready(page); await shown(page, 'tools');
      const text = await page.locator('#lifeApp').innerText();
      assert(!text.includes(PRIVATE) && !text.includes('제주 여행') && !text.includes('비 오는 날'), 'account B sees none of account A');
    });

    await check('every unit at 1440, 820 and 390 has no horizontal overflow and keeps accessible names', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); await seed(page);
      const scenes = [['list', '/index.html', 'home'], ['year', '/index.html?section=tools', 'tools'], ['quarter', '/index.html?section=schedule&view=quarter&date=2026-10-28', 'quarter'],
        ['month', '/index.html?section=schedule&view=month&date=2026-10-28', 'month'], ['week', '/index.html?section=schedule&view=week&date=2026-10-28', 'week'],
        ['day', '/index.html?section=schedule&view=day&date=2026-10-29', 'day']];
      for (const [scene, address, expected] of scenes) {
        await page.goto(base + address); await ready(page); await shown(page, expected);
        for (const width of [1440, 820, 390]) {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 960 }); await page.waitForTimeout(150);
          await page.evaluate(() => { document.activeElement?.blur(); scrollTo({ top: 0, behavior: 'instant' }); });
          await overflow(page, scene);
          const audit = await page.evaluate(() => {
            const shown = [...document.querySelectorAll('#lifeApp button, #lifeApp a')].filter(el => el.checkVisibility());
            const unnamed = shown.filter(el => !(el.getAttribute('aria-label') || el.textContent).trim()).map(el => el.className);
            const small = shown.filter(el => el.closest('.life-toolbar,.schedule-aside,.schedule-links,.schedule-week-strip')).filter(el => { const r = el.getBoundingClientRect(); return r.height < 44 && r.width < 44; }).map(el => el.getAttribute('aria-label') || el.textContent);
            return { unnamed, small };
          });
          assert.deepEqual(audit.unnamed, [], scene + ' ' + width + ' controls have names');
          assert.deepEqual(audit.small, [], scene + ' ' + width + ' toolbar targets are 44px');
          const file = scene + '-' + width + '.png'; await page.screenshot({ path: path.join(output, file) }); report.visual.push({ scene, width, file });
          await alignmentCopy(page, scene + '-' + width);
        }
        await page.setViewportSize({ width: 1440, height: 960 });
      }
      // The shortcut help is a real dialog that returns focus.
      await page.locator('.schedule-help').click(); await page.locator('#scheduleShortcuts[open]').waitFor();
      await page.keyboard.press('Escape'); await page.waitForFunction(() => document.activeElement?.classList.contains('schedule-help'));
    });
  } finally {
    await browser.close();
    report.passed = report.checks.filter(item => item.pass).length; report.failed = report.checks.filter(item => !item.pass).length;
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ passed: report.passed, failed: report.failed, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length }));
    if (report.failed || report.consoleErrors.length || report.pageErrors.length) process.exitCode = 1;
  }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

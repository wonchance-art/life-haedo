/* 노트 메뉴와 일정 정리 (2026-11-16 owner decision, docs/design-review/notes-menu.md): real app, SDK and IDB with an
 * anonymous intercepted Auth only. npm run dev; BASE_URL=… node tests/notes-menu-browser.cjs
 * Checks: the five-tab menu at 1440·820·390·320 (no overflow, 44px, uncut labels), the first screen after login is 노트,
 * the address table opens the screen it names, 노트 ↔ 글 읽기·편집 ↔ 노트 and 일정 ↔ D ↔ 일정 keep scroll, search, tab and
 * filter, a late read cannot show another account's posts, and the five calendar units share one frame (거르기, side
 * column 예정 → 습관·행복도 → 목표·계획, no empty table, W's date columns hold records only).
 * NOTES_MENU_OUTPUT keeps the screenshots. Never uses real Google, production Supabase or Apple-device claims. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');

const output = path.resolve(process.env.NOTES_MENU_OUTPUT || '.local/notes-menu');
const TODAY = '2026-11-03T12:00:00+09:00';
const PRIVATE = '계정 A에서만 보일 노트 글';
const report = { checks: [], consoleErrors: [], pageErrors: [], screenshots: [] };

// A held post list read is a genuine read that finishes late.
async function instrumentStorage(context) {
  await context.route(`${base}/assets/life/storage.js`, async route => {
    const response = await route.fetch(), source = await response.text();
    const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);
      return Object.freeze({...actual,async listPhotoPosts(...v){const result=await actual.listPhotoPosts(...v);if(window.__notesHold){window.__notesHeld=true;await new Promise(resolve=>{window.__notesRelease=()=>{window.__notesHold=false;resolve();};});}return result;}});}});})();`;
    await route.fulfill({ response, body: source + hook });
  });
}
async function seed(page) {
  return page.evaluate(async ({ PRIVATE }) => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, m = HaedoLife.PhotoPost, ws = await s.getActive(), ids = {};
    const rows = [['2026-11-02T22:10:00+09:00', PRIVATE], ['2026-10-29T11:40:00+09:00', '비 오는 날 동네 도서관'], ['2026-10-28T21:05:00+09:00', '창가 자리에서 읽은 책']];
    for (const [at, title] of rows) {
      const doc = m.create(c.id, new Date(at).toISOString()); doc.title = title; doc.status = 'saved';
      doc.ops = [{ insert: '퇴근길에 한 정거장 먼저 내려 천변을 따라 걸었다.\n' }]; await s.savePhotoPost(ws, doc, 0); ids[title] = doc.id;
    }
    for (let i = 0; i < 24; i++) {
      const doc = m.create(c.id, new Date(Date.UTC(2026, 7, 28 - i, 3)).toISOString()); doc.title = '여름 산책 기록 ' + (i + 1); doc.status = 'saved';
      doc.ops = [{ insert: '여름 저녁의 산책을 남긴다. ' + i + '\n' }]; await s.savePhotoPost(ws, doc, 0); ids[doc.title] = doc.id;
    }
    const draft = m.create(c.id, new Date('2026-11-01T09:00:00+09:00').toISOString()); draft.title = '쓰다 만 익명 초안'; draft.ops = [{ insert: '초안 본문\n' }];
    await s.savePhotoPost(ws, draft, 0); ids.draft = draft.id;
    const plan = await s.readAnnualPlan(ws), baseRevision = plan.revision;
    // p0 is past (10-27), p1 in the week of 11-03 (11-05), p2 later in the month (11-14).
    plan.entries = [{ id: 'p0', date: '2026-10-27', text: '지난 예정 익명' }, { id: 'p1', date: '2026-11-05', text: '이번 주 예정 익명' }, { id: 'p2', date: '2026-11-14', text: '제주 여행' }];
    plan.revision = baseRevision + 1; plan.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
    const saved = await s.saveAnnualPlan(ws, plan, baseRevision); if (saved.status !== 'stored') throw new Error('plan fixture');
    return { workspaceId: ws, ids };
  }, { PRIVATE });
}
async function shown(page, expected) {
  await page.waitForFunction(value => document.querySelector('#lifeMain')?.dataset.mode === value && !document.querySelector('.life-app[aria-busy="true"]') &&
    (!document.querySelector('#lifeSchedule') || document.querySelector('#lifeSchedule').getAttribute('aria-busy') === 'false') &&
    (value !== 'home' || document.querySelector('#homePosts')?.getAttribute('aria-busy') === 'false'), expected);
}
const current = page => page.locator('[data-haedo-navigation] a[aria-current="page"]').evaluateAll(links => links.map(link => link.dataset.haedoSection).join());
const tab = section => '[data-haedo-navigation] [data-haedo-section="' + section + '"]';

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function check(name, run, viewport = { width: 1440, height: 960 }) {
    if (process.env.NOTES_MENU_MATCH && !new RegExp(process.env.NOTES_MENU_MATCH).test(name)) return;
    const server = new FakeCloud(), device = 'notes-' + report.checks.length;
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
    await check('the five menu tabs fit 1440, 820, 390 and 320: no overflow, 44px targets, uncut labels; 노트 is the first screen', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); await seed(page);
      await page.reload(); await ready(page); await shown(page, 'home');
      assert.equal(await current(page), 'notes', 'the first screen after login is 노트');
      assert.equal(await page.title(), '노트 · 해도');
      assert.equal(await page.locator('#lifeApp .life-page-title').innerText(), '노트');
      for (const [width, height] of [[1440, 960], [820, 1180], [390, 844], [320, 640]]) {
        await page.setViewportSize({ width, height }); await page.waitForTimeout(200);
        const menu = await page.evaluate(() => [...document.querySelectorAll('[data-haedo-navigation] a[data-haedo-section]')].map(link => {
          const box = link.getBoundingClientRect(), text = link.querySelector('.haedo-nav-text'), shown = text && getComputedStyle(text).display !== 'none';
          return { id: link.dataset.haedoSection, label: link.getAttribute('aria-label'), width: box.width, height: box.height, left: box.left, right: box.right,
            text: shown ? text.textContent : null, cut: shown ? text.scrollWidth > text.clientWidth + 0.5 || text.getBoundingClientRect().right > box.right + 0.5 || text.getBoundingClientRect().left < box.left - 0.5 : false };
        }));
        const scene = 'menu ' + width;
        assert.deepEqual(menu.map(item => [item.id, item.label]), [['news', '뉴스'], ['schedule', '일정'], ['notes', '노트'], ['records', '자료'], ['manage', '설정']], scene);
        assert.deepEqual(menu.filter(item => item.width < 44 || item.height < 44).map(item => item.id), [], scene + ': each tab is 44px');
        assert.deepEqual(menu.filter(item => item.left < 0 || item.right > width).map(item => item.id), [], scene + ': inside the screen');
        assert.deepEqual(menu.filter(item => item.cut).map(item => item.id), [], scene + ': no label is cut');
        if (width <= 760) assert.deepEqual(menu.map(item => item.text), ['뉴스', '일정', '노트', '자료', '설정'], scene + ': the bottom tabs show their labels');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, scene + ': no horizontal overflow');
        const file = 'notes-' + width + '.png'; await page.screenshot({ path: path.join(output, file) }); report.screenshots.push(file);
      }
    });

    await check('the address table opens the screen it names, also after a reload and from an older version history entry', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); await seed(page);
      const cases = [
        // [address, mode, section, written address]
        ['/index.html', 'home', 'notes', '/index.html?section=notes'],
        ['/index.html?section=notes', 'home', 'notes', '/index.html?section=notes'],
        ['/index.html?section=home', 'home', 'notes', '/index.html?section=notes'],
        ['/index.html?section=schedule', 'home', 'notes', '/index.html?section=notes'],
        ['/index.html?view=blog', 'blog', 'notes', '/index.html?view=blog'],
        ['/index.html?view=account-blog', 'account-blog', 'notes', '/index.html?view=account-blog'],
        ['/index.html?section=schedule&view=month', 'month', 'schedule', '/index.html?section=schedule&view=month&date=2026-11-03'],
        ['/index.html?section=schedule&view=year', 'tools', 'schedule', '/index.html?section=schedule&view=tools'],
        ['/index.html?section=schedule&view=quarter&date=2026-10-28', 'quarter', 'schedule', '/index.html?section=schedule&view=quarter&date=2026-10-28'],
        ['/index.html?section=schedule&view=week&date=2026-10-28', 'week', 'schedule', '/index.html?section=schedule&view=week&date=2026-10-28'],
        ['/index.html?section=home&view=day&date=2026-10-28', 'day', 'schedule', '/index.html?section=schedule&view=day&date=2026-10-28'],
        ['/index.html?section=schedule&date=2026-10-28', 'month', 'schedule', '/index.html?section=schedule&date=2026-10-28&view=month'],
        // A date the router does not read is the former list address: 노트.
        ['/index.html?section=schedule&date=2026-02-30', 'home', 'notes', '/index.html?section=notes'],
        ['/index.html?section=tools', 'tools', 'schedule', '/index.html?section=schedule&view=tools'],
        ['/index.html?section=tools&view=annual-plan', 'annual-plan', 'schedule', '/index.html?section=schedule&view=annual-plan'],
        ['/life.html?section=schedule', 'home', 'notes', '/life.html?section=notes']
      ];
      for (const [address, mode, section, written] of cases) {
        await page.goto(base + address); await ready(page); await page.locator('#lifeMain[data-mode="' + mode + '"]').waitFor(); await settle(page);
        assert.equal(await current(page), section, address + ' marks ' + section);
        assert.equal(await page.evaluate(() => location.pathname + location.search), written, address + ' is written as ' + written);
        await page.reload(); await ready(page); await page.locator('#lifeMain[data-mode="' + mode + '"]').waitFor(); await settle(page);
        assert.equal(await current(page), section, address + ' after a reload');
      }
      // A pinned date (2026-11-16 decision 11) is still pinned: the address keeps it on 오늘's day.
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-03'); await ready(page); await shown(page, 'day');
      assert.equal(await page.evaluate(() => history.state?.haedo?.entry?.schedulePinned), true);
      // 연표 opens the 연표 목록, as before.
      await page.goto(base + '/index.html?view=time'); await page.waitForURL(url => url.pathname.endsWith('/workspace.html'));
      // An entry an older version wrote for its 일정 list (mode home, address index.html) opens 노트 with its tab.
      await page.goto(base + '/index.html?section=records'); await ready(page); await shown(page, 'sources');
      const workspaceId = await page.evaluate(() => HaedoLife.Shell.storage.getActive());
      await page.evaluate(id => {
        history.pushState({ haedo: { v: 1, idx: 50, key: 'old-version-list', doc: 'old-doc', entry: { mode: 'home', workspaceId: id, homeState: { workspaceId: id, tab: 'drafts', query: '' } }, back: null } }, '', '/index.html');
        history.pushState({ haedo: { v: 1, idx: 51, key: 'old-version-day', doc: 'old-doc', entry: { mode: 'day', workspaceId: id, scheduleDate: '2026-10-28' }, back: null } }, '', '/index.html?section=schedule&view=day&date=2026-10-28');
        history.pushState(null, '', '/index.html?section=records');
      }, workspaceId);
      await page.goBack(); await shown(page, 'day'); assert.equal(await current(page), 'schedule');
      assert.equal(await page.locator('#lifeApp .life-page-title').innerText(), '10월 28일 수요일');
      await page.goBack(); await shown(page, 'home'); assert.equal(await current(page), 'notes');
      assert.equal(await page.locator('#homeTab-drafts').getAttribute('aria-selected'), 'true', 'the old entry\'s tab');
    });

    await check('노트 ↔ 글 읽기·편집 ↔ 노트 keeps scroll, search and tab; 일정 ↔ D ↔ 일정 keeps the unit, scroll and filter', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); const fixture = await seed(page);
      await page.reload(); await ready(page); await shown(page, 'home');
      // 노트 keeps the single-key / (통합 검색) and ? (단축키 도움말); the calendar's keys do nothing here.
      await page.locator('#lifeApp .life-page-title').focus();
      await page.keyboard.press('m'); await page.keyboard.press('t'); await page.waitForTimeout(300);
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'home', 'no calendar key on 노트');
      await page.keyboard.press('?'); await page.locator('#scheduleShortcuts[open]').waitFor();
      // The help on 노트 lists only what 노트 takes.
      assert.equal(await page.locator('#scheduleShortcutsTitle').innerText(), '노트 단축키');
      assert.deepEqual(await page.locator('#scheduleShortcuts dt').allInnerTexts(), ['/', '?']);
      await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#scheduleShortcuts'));
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('life-page-title')), true, 'focus returns from the help');
      await page.keyboard.press('/'); await page.locator('#lifeMain[data-mode="find"]').waitFor(); await settle(page);
      assert.equal(await current(page), 'notes', '통합 검색 from 노트 is 노트\'s');
      await page.locator('#lifeSubviewReturn').click(); await shown(page, 'home');
      // Reading: search, scroll, open a post, come back with the app's return.
      await page.locator('#homePostSearch').fill('산책');
      await page.waitForFunction(() => document.querySelectorAll('#homePostList .home-post').length > 10);
      const target = page.locator('#homePostList .home-post-open', { hasText: '여름 산책 기록 12' });
      await target.scrollIntoViewIfNeeded(); await page.evaluate(() => scrollBy({ top: 120, behavior: 'instant' }));
      const scroll = await page.evaluate(() => scrollY); assert.ok(scroll > 300, 'the list is scrolled (' + scroll + ')');
      await target.click(); await page.locator('#lifeMain[data-mode="page"]').waitFor(); await page.locator('.photo-article').waitFor();
      assert.equal(await current(page), 'notes', 'a post read from 노트 is 노트\'s');
      await page.locator('#lifeSubviewReturn, [data-subview-return]').first().click(); await shown(page, 'home');
      assert.equal(await page.locator('#homePostSearch').inputValue(), '산책');
      await page.waitForFunction(() => document.activeElement?.textContent === '여름 산책 기록 12');
      await page.waitForFunction(top => Math.abs(scrollY - top) < 4, scroll);
      // Editing a draft from the 초안 tab, then the browser's back: the 초안 tab again.
      await page.locator('#homePostSearch').fill(''); await page.locator('#homeTab-drafts').click(); await settle(page);
      await page.locator('#homePostList .home-draft-open', { hasText: '쓰다 만 익명 초안' }).click(); await page.locator('#photoTitle').waitFor(); await settle(page);
      assert.equal(await current(page), 'notes');
      await page.goBack(); await shown(page, 'home');
      assert.equal(await page.locator('#homeTab-drafts').getAttribute('aria-selected'), 'true', 'back to the 초안 tab');
      // 일정: M with the 글 filter, scrolled; a day cell opens D; up/back returns to M with its filter and scroll.
      await page.setViewportSize({ width: 1440, height: 600 });
      await page.locator(tab('schedule')).click(); await shown(page, 'month');
      await page.goto(base + '/index.html?section=schedule&view=month&date=2026-10-28'); await ready(page); await shown(page, 'month');
      await page.locator('#lifeSchedule [data-schedule-filter="posts"]').click();
      await page.evaluate(() => scrollTo({ top: 200, behavior: 'instant' })); const monthScroll = await page.evaluate(() => scrollY);
      await page.locator('[data-focus-key="schedule:day:2026-10-29"]').click(); await shown(page, 'day');
      assert.equal(await page.locator('#lifeSchedule [data-schedule-filter="posts"]').getAttribute('aria-selected'), 'true', 'D keeps the filter');
      await page.goBack(); await shown(page, 'month');
      assert.equal(await page.locator('#lifeSchedule [data-schedule-filter="posts"]').getAttribute('aria-selected'), 'true', 'M keeps the filter');
      await page.waitForFunction(top => Math.abs(scrollY - top) < 4, monthScroll);
      await page.waitForFunction(() => document.activeElement?.dataset.focusKey === 'schedule:day:2026-10-29');
      // Leaving 일정 for 노트 and coming back opens the unit shown last, at its date.
      await page.locator(tab('notes')).click(); await shown(page, 'home');
      await page.locator(tab('schedule')).click(); await shown(page, 'month');
      assert.equal(await page.locator('#lifeApp .life-page-title').innerText(), '10월');
      // A post opened from D is 일정's, and its return goes back to that D.
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-10-29'); await ready(page); await shown(page, 'day');
      await page.locator('[data-schedule-item="photo:' + fixture.ids['비 오는 날 동네 도서관'] + '"]').click(); await page.locator('.photo-article').waitFor();
      assert.equal(await current(page), 'schedule');
      await page.locator('#lifeSubviewReturn, [data-subview-return]').first().click(); await shown(page, 'day');
      assert.equal(new URL(page.url()).searchParams.get('date'), '2026-10-29');
    });

    await check('a late post read cannot show account A\'s posts in 노트 after an account change', async ({ page, server, device }) => {
      await page.goto(base + '/index.html'); await ready(page); await seed(page);
      await page.goto(base + '/index.html?section=schedule&view=month&date=2026-10-28'); await ready(page); await shown(page, 'month');
      await page.evaluate(() => { window.__notesHold = true; window.__notesHeld = false; });
      await page.locator(tab('notes')).click(); await page.waitForFunction(() => __notesHeld);
      await page.evaluate(() => { window.__notesSignout = HaedoAuth.client.auth.signOut({ scope: 'local' }); });
      await page.waitForFunction(() => document.querySelector('#lifeApp').hidden && !HaedoLife.Shell.storage);
      await page.evaluate(() => __notesRelease()); await page.waitForFunction(() => HaedoAuth.user === null);
      assert(!(await page.locator('body').innerText()).includes(PRIVATE));
      server.oauthAccounts.set(device, accounts.b); await page.locator('[data-life-return-login]').click(); await page.locator('#googleLogin').click();
      await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page); await shown(page, 'home');
      assert.equal(await current(page), 'notes');
      const text = await page.locator('#lifeApp').innerText();
      assert(!text.includes(PRIVATE) && !text.includes('여름 산책') && !text.includes('쓰다 만 익명 초안'), 'account B sees none of account A');
    });

    await check('the five calendar units share one frame: 거르기 above the body, 예정 → 습관·행복도 → 목표·계획 beside or under it, no empty table', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); await seed(page);
      const units = [['tools', '?section=schedule&view=tools'], ['quarter', '?section=schedule&view=quarter&date=2026-11-03'], ['month', '?section=schedule&view=month&date=2026-11-03'],
        ['week', '?section=schedule&view=week&date=2026-11-03'], ['day', '?section=schedule&view=day&date=2026-11-05']];
      for (const [width, height] of [[1440, 960], [1100, 900], [820, 1180], [390, 844], [320, 640]]) {
        await page.setViewportSize({ width, height });
        for (const [unit, query] of units) {
          await page.goto(base + '/index.html' + query); await ready(page); await shown(page, unit);
          await page.waitForFunction(() => [...document.querySelectorAll('#lifeSchedule .schedule-entries')].every(slot => slot.getAttribute('aria-busy') === 'false'));
          const frame = await page.evaluate(() => {
            const schedule = document.querySelector('#lifeSchedule'), primary = schedule.querySelector('.schedule-primary'), aside = schedule.querySelector('.schedule-aside');
            const filter = primary?.querySelector(':scope > .schedule-filter'), box = node => node?.getBoundingClientRect();
            return { primary: !!primary, filterFirst: !!filter && [...primary.children].filter(node => !node.matches('.schedule-week-strip')).indexOf(filter) === 0,
              filter: filter ? [...filter.querySelectorAll('[role=tab]')].map(node => node.textContent) : null, filterShown: !!filter?.checkVisibility(),
              sides: aside ? [...aside.querySelectorAll(':scope > [data-side]')].map(node => node.dataset.side) : null,
              beside: !!aside && box(aside).left >= box(primary).right - 1, under: !!aside && box(aside).top >= box(primary).bottom - 1,
              tables: [...aside.querySelectorAll('table')].filter(table => !table.querySelector('tbody tr:not(.schedule-grid-label)')).length,
              overflow: document.documentElement.scrollWidth - innerWidth };
          });
          const scene = unit + ' ' + width;
          assert.equal(frame.primary, true, scene);
          assert.deepEqual(frame.filter, ['전체', '글', '발췌', '사진'], scene + ': the 거르기');
          assert.equal(frame.filterFirst, true, scene + ': the 거르기 above the body');
          assert.equal(frame.filterShown, width > 760, scene + ': shown from 761px (the phone keeps its calendar without it)');
          assert.deepEqual(frame.sides, ['plans', 'habits', 'goals'], scene + ': 예정 → 습관·행복도 → 목표·계획');
          assert.equal(width > 1100 ? frame.beside : frame.under, true, scene + (width > 1100 ? ': beside the body' : ': under the body'));
          assert.equal(frame.tables, 0, scene + ': no empty table');
          assert.equal(frame.overflow, 0, scene + ': no horizontal overflow');
          if (width === 1440 || width === 390 || width === 820 || width === 320) {
            const file = 'schedule-' + unit + '-' + width + '.png'; await page.screenshot({ path: path.join(output, file) }); report.screenshots.push(file);
          }
        }
      }
      await page.setViewportSize({ width: 1440, height: 960 });
      // Each part holds what fits its period.
      const side = async query => { await page.goto(base + '/index.html' + query); await ready(page); await page.waitForFunction(() => document.querySelector('#lifeSchedule')?.getAttribute('aria-busy') === 'false');
        await page.waitForFunction(() => [...document.querySelectorAll('#lifeSchedule .schedule-entries')].every(slot => slot.getAttribute('aria-busy') === 'false'));
        return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#lifeSchedule .schedule-aside > [data-side]')].map(node => [node.dataset.side, node.innerText.replace(/\s+/g, ' ').trim()]))); };
      const week = await side('?section=schedule&view=week&date=2026-11-03');
      assert.match(week.plans, /이번 주 예정 익명/); assert.doesNotMatch(week.plans, /제주 여행|지난 예정/, 'W: only the week\'s remaining plans');
      assert.match(week.habits, /아직 습관이 없어요\. 습관 추가/); assert.match(week.habits, /이번 주 행복도 기록이 없어요\./);
      assert.equal(await page.locator('#lifeSchedule .schedule-aside table').count(), 0, 'W: no habit or 행복도 table without either');
      assert.equal(await page.locator('#lifeSchedule .schedule-week-grid').innerText().then(text => /이번 주 예정 익명/.test(text)), false, 'W: no plan in a date column');
      assert.match(week.goals, /연간 계획\s*·\s*목표\s*·\s*습관\s*·\s*연표/);
      // A past week: its past day keeps its plan in the date column (as D does); 예정 has none left.
      const pastWeek = await side('?section=schedule&view=week&date=2026-10-28');
      assert.match(pastWeek.plans, /이 주의 남은 예정이 없어요\./);
      assert.match(await page.locator('#lifeSchedule .schedule-week-day[aria-label^="10월 27일"]').innerText(), /지난 예정 익명/, 'W: a past day shows its plan');
      const month = await side('?section=schedule&view=month&date=2026-11-03');
      assert.match(month.plans, /이번 주 예정 익명[\s\S]*제주 여행/); assert.match(month.habits, /습관 추가/);
      const year = await side('?section=schedule&view=tools');
      assert.match(year.habits, /^습관 · 행복도 습관$/); assert.match(year.goals, /올해 계획[\s\S]*목표[\s\S]*연간 계획\s*·\s*목표\s*·\s*습관\s*·\s*연표/);
      const quarter = await side('?section=schedule&view=quarter&date=2026-11-03');
      assert.match(quarter.habits, /^습관 · 행복도 습관$/); assert.match(quarter.goals, /^목표 · 계획 연간 계획\s*·\s*목표\s*·\s*습관\s*·\s*연표$/);
      // D: a remaining plan of the day is in 예정, not in its records; a past day keeps its plan among its records.
      const day = await side('?section=schedule&view=day&date=2026-11-05');
      assert.match(day.plans, /이번 주 예정 익명/); assert.doesNotMatch(await page.locator('.schedule-day-records').innerText(), /이번 주 예정 익명/);
      const past = await side('?section=schedule&view=day&date=2026-10-27');
      assert.match(past.plans, /이 날의 남은 예정이 없어요\./); assert.match(await page.locator('.schedule-day-records').innerText(), /지난 예정 익명/);
      // The 거르기 filters the body of M, W and D too: 발췌 hides the posts.
      await page.goto(base + '/index.html?section=schedule&view=week&date=2026-10-28'); await ready(page); await shown(page, 'week');
      assert.match(await page.locator('.schedule-week-grid').innerText(), /창가 자리에서 읽은 책/);
      await page.locator('#lifeSchedule [data-schedule-filter="excerpts"]').click();
      assert.doesNotMatch(await page.locator('.schedule-week-grid').innerText(), /창가 자리에서 읽은 책/);
      await page.locator('[data-schedule-view="day"]').click(); await shown(page, 'day');
      assert.match(await page.locator('.schedule-day-records').innerText(), /이 날 발췌가 없어요\./);
      await page.locator('#lifeSchedule [data-schedule-filter="all"]').click();
      assert.match(await page.locator('.schedule-day-records').innerText(), /창가 자리에서 읽은 책/);
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

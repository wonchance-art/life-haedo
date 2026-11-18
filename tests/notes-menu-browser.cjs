/* 노트 메뉴와 일정 정리 (2026-11-16 owner decision, docs/design-review/notes-menu.md): real app, SDK and IDB with an
 * anonymous intercepted Auth only. npm run dev; BASE_URL=… node tests/notes-menu-browser.cjs
 * Checks: the five-tab menu at 1440·820·390·320 (no overflow, 44px, uncut labels), the first screen after login is 노트,
 * the address table opens the screen it names, 노트 ↔ 글 읽기·편집 ↔ 노트 and 일정 ↔ D ↔ 일정 keep scroll, search, tab and
 * filter, a late read cannot show another account's posts, and the five calendar units share one frame (거르기, side
 * column 예정 → 습관·행복도 → 목표·계획, no empty table, W's date columns hold records only), and 일정 M·W·D come back to the
 * exact position they were left at, also from the middle of the page (2026-11-18, the browser's own restore is off there).
 * NOTES_MENU_OUTPUT keeps the screenshots. Never uses real Google, production Supabase or Apple-device claims. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { PlatformTables } = require('./schedule-entries-browser.cjs');

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
// A day with enough posts for W and D to scroll at these screen heights, and a direct writing of that day (its reader
// is the 자료 reader, whose 돌아가기 is another return path than a post's).
async function seedDay(page) {
  // A direct writing is dated when it is saved: the clock stands on that day while it is written.
  await page.clock.setFixedTime(new Date('2026-10-28T20:30:00+09:00'));
  await page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, m = HaedoLife.PhotoPost, w = HaedoLife.Writing, ws = await s.getActive();
    for (let i = 0; i < 12; i++) {
      const doc = m.create(c.id, new Date('2026-10-28T' + String(8 + i).padStart(2, '0') + ':15:00+09:00').toISOString()); doc.title = '하루 익명 기록 ' + (i + 1); doc.status = 'saved';
      doc.ops = [{ insert: '그날 본 것을 한 줄로 남긴다. ' + i + '\n' }]; await s.savePhotoPost(ws, doc, 0);
    }
    const bundle = await s.read(ws), own = w.createDraft(bundle); own.title = '직접 쓴 익명 기록';
    own.text = Array.from({ length: 40 }, (_, i) => (i + 1) + '번째 문단. 천변을 따라 걸으며 본 것을 적는다.').join('\n\n');
    const prepared = await w.prepareSave(bundle, own);
    const stored = await s.commitLocal({ workspaceId: ws, baseRevision: bundle.revision, operationId: c.id(), changes: prepared.changes });
    if (stored.status !== 'stored') throw new Error('direct writing fixture');
  });
  await page.clock.setFixedTime(new Date(TODAY));
}
// A control that can be pressed where the page is: whole inside the screen and not under the fixed header or the bottom
// tabs. It is pressed at its place with the mouse (press()): Playwright's own click scrolls a control clear of the root's
// scroll padding first (120 became 73 for a cell in M's first row), and the position left would not be the one set.
async function pressable(page, selector, scene) {
  const found = await page.evaluate(selector => {
    const nodes = [...document.querySelectorAll(selector)], index = nodes.findIndex(node => {
      const box = node.getBoundingClientRect();
      if (!box.width || box.top < 0 || box.bottom > innerHeight || box.left < 0 || box.right > innerWidth) return false;
      return [[box.left + 2, box.top + 2], [box.right - 2, box.bottom - 2], [box.left + box.width / 2, box.top + box.height / 2]].every(([x, y]) => node.contains(document.elementFromPoint(x, y)));
    });
    if (index < 0) return null;
    const box = nodes[index].getBoundingClientRect();
    return { key: nodes[index].dataset.focusKey, x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, selector);
  assert.ok(found?.key, scene + ': a control of ' + selector + ' is on screen');
  return found;
}
// The scroll position once it has stopped (the same for 20 frames): a restore still moving is not read as its end.
const rest = page => page.evaluate(() => new Promise(resolve => {
  let last = scrollY, same = 0;
  const tick = () => { if (scrollY === last) same += 1; else { last = scrollY; same = 0; } if (same >= 20) resolve(last); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}));
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
      // M is left in the middle of its page again (2026-11-18): from 40369e1 this ran at M's end only, because a position
      // short of the end came back 3–25px further down (the browser's own restore met the app's; the check after this
      // one holds the positions and paths). The position is read at the click itself: Playwright's click first moves
      // the cell clear of the root's scroll padding. 1px is allowed for the whole number kept in history.state.
      await page.evaluate(() => { scrollTo({ top: 150, behavior: 'instant' }); addEventListener('click', () => { window.__monthScroll = scrollY; window.__monthEnd = document.documentElement.scrollHeight - innerHeight; }, { once: true, capture: true }); });
      await page.locator('[data-focus-key="schedule:day:2026-10-29"]').click(); await shown(page, 'day');
      const [monthScroll, monthEnd] = await page.evaluate(() => [window.__monthScroll, window.__monthEnd]);
      assert.ok(monthScroll >= 100 && monthScroll < monthEnd - 20, 'M was left in the middle of its page (' + monthScroll + ' of ' + monthEnd + ')');
      assert.equal(await page.locator('#lifeSchedule [data-schedule-filter="posts"]').getAttribute('aria-selected'), 'true', 'D keeps the filter');
      await page.goBack(); await shown(page, 'month');
      assert.equal(await page.locator('#lifeSchedule [data-schedule-filter="posts"]').getAttribute('aria-selected'), 'true', 'M keeps the filter');
      await page.waitForFunction(() => document.activeElement?.dataset.focusKey === 'schedule:day:2026-10-29');
      const monthBack = await rest(page);
      assert.ok(Math.abs(monthBack - monthScroll) <= 1, 'M comes back where it was left (' + monthScroll + ' → ' + monthBack + ')');
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

    // 2026-11-18 (W2 review m-2): a calendar unit left in the middle of its page came back 11–42px further down. The
    // browser restored the entry's scroll itself, animated by the root's smooth scrolling, and that animation was still
    // moving when the app set the recorded position: Chromium added its remaining step. Measured on 8c3c54f at
    // 1440×600: 152 → 165, 162 → 175, 200 → 211; ‹ up on a phone ended at 3–15 instead of the top. The entries of 일정 now
    // leave the position to the app alone (history.scrollRestoration manual, ui.js writeRoute).
    // Allowed difference 1px: history.state keeps the position as a whole number (historyPublic rounds it).
    await check('일정 M·W·D come back to the position they were left at, from the middle of the page too (1440, 820, 390)', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); await seed(page); await seedDay(page);
      const misses = [], trips = [];
      const post = '#lifeSchedule .schedule-post-open[data-schedule-item^="photo:"]', writing = '#lifeSchedule .schedule-post-open[data-schedule-item^="source:"]';
      const cell = '#lifeSchedule .schedule-day-cell:not([data-outside])', head = '#lifeSchedule .schedule-week-head';
      const read = () => page.locator('.photo-article').waitFor();
      const readWriting = async () => { await page.locator('#lifeMain[data-mode="source"]').waitFor(); await page.locator('#lifeSourceText').waitFor(); await settle(page); };
      const browserBack = () => page.goBack(), appReturn = () => page.locator('#lifeSubviewReturn, [data-subview-return]').first().click();
      const readerReturn = () => page.locator('#lifeSearchReturn').click();
      async function trip(scene, unit, query, top, control, arrive, back, { expected, wait } = {}) {
        // A new entry each time (an address opened again in place is a reload to the browser, which restores its scroll).
        await page.goto('about:blank'); await page.goto(base + '/index.html' + query); await ready(page); await shown(page, unit);
        await page.waitForFunction(() => [...document.querySelectorAll('#lifeSchedule .schedule-entries')].every(slot => slot.getAttribute('aria-busy') === 'false'));
        const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
        // Without a position of its own the screen is left where the control stands at the middle of the screen.
        top ??= await page.evaluate(({ control, max }) => { const box = document.querySelector(control).getBoundingClientRect(); return Math.round(Math.min(max - 20, Math.max(20, scrollY + box.top + box.height / 2 - innerHeight / 2))); }, { control, max });
        assert.ok(top > 0 && top < max - 1, scene + ': ' + top + ' is a middle position (the page ends at ' + max + ')');
        await page.evaluate(top => { scrollTo({ top, behavior: 'instant' }); addEventListener('click', () => { window.__left = scrollY; }, { once: true, capture: true }); }, top);
        const target = await pressable(page, control, scene), key = target.key;
        await page.mouse.click(target.x, target.y); await arrive();
        const left = await page.evaluate(() => window.__left);
        assert.equal(left, top, scene + ': pressed where the page was');
        await back(); await shown(page, unit);
        // The return puts focus back on the control and sets the position in the same frame (restoreOriginView).
        if (wait) await wait(); else await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, key);
        const got = await rest(page), want = expected ?? left;
        trips.push(scene + ' ' + want + '→' + got);
        if (Math.abs(got - want) > 1) misses.push(scene + ': left at ' + left + ', expected ' + want + ', came back at ' + got);
      }
      const dayShown = () => shown(page, 'day');
      const monthLabel = '#lifeSchedule .schedule-month-label', weekLabel = '#lifeSchedule .schedule-week-label';
      for (const [width, height, monthTops, weekTops, dayTops] of [[1440, 600, [60, 120, 162, 200], [80, 160], [100, 200]], [820, 700, [60, 120, 200], [90, 170], [100, 200]], [390, 600, [60, 120, 189], [90, 170], [100, 200]]]) {
        await page.setViewportSize({ width, height });
        const size = width + '×' + height;
        for (const top of monthTops) await trip(size + ' M ' + top + ' → D → 뒤로', 'month', '?section=schedule&view=month&date=2026-10-28', top, cell, dayShown, browserBack);
        await trip(size + ' W ' + weekTops[0] + ' → 글 읽기 → 돌아가기', 'week', '?section=schedule&view=week&date=2026-10-28', weekTops[0], post, read, appReturn);
        await trip(size + ' W ' + weekTops[1] + ' → 글 읽기 → 뒤로', 'week', '?section=schedule&view=week&date=2026-10-28', weekTops[1], post, read, browserBack);
        await trip(size + ' D ' + dayTops[0] + ' → 글 읽기 → 돌아가기', 'day', '?section=schedule&view=day&date=2026-10-28', dayTops[0], post, read, appReturn);
        await trip(size + ' D ' + dayTops[1] + ' → 글 읽기 → 뒤로', 'day', '?section=schedule&view=day&date=2026-10-28', dayTops[1], post, read, browserBack);
        // Y and Q are entries of 일정 too: a month opened from Y, a week opened from Q, then the browser's back.
        await trip(size + ' Y 120 → M → 뒤로', 'tools', '?section=schedule&view=tools', 120, monthLabel, () => shown(page, 'month'), browserBack);
        await trip(size + ' Q 130 → W → 뒤로', 'quarter', '?section=schedule&view=quarter&date=2026-10-28', 130, weekLabel, () => shown(page, 'week'), browserBack);
        // A direct writing opens in the 자료 reader. Its 돌아가기 set the position before the calendar was drawn again, so
        // it was cut to the empty frame's height (on 8c3c54f at 1440×600: D left at 1169 came back at 58).
        await trip(size + ' D → 직접 쓴 글 → 돌아가기', 'day', '?section=schedule&view=day&date=2026-10-28', null, writing, readWriting, readerReturn);
        await trip(size + ' D → 직접 쓴 글 → 뒤로', 'day', '?section=schedule&view=day&date=2026-10-28', null, writing, readWriting, browserBack);
        await trip(size + ' W → 직접 쓴 글 → 돌아가기', 'week', '?section=schedule&view=week&date=2026-10-28', null, writing, readWriting, readerReturn);
        // W's day heads stand under one another below 1101px, so one is on screen in the middle of the page.
        if (width <= 1100) await trip(size + ' W ' + weekTops[0] + ' → D → 뒤로', 'week', '?section=schedule&view=week&date=2026-10-28', weekTops[0], head, dayShown, browserBack);
        // A phone's ‹ goes one level up to the top of the parent (not to where it was left): exactly the top.
        if (width <= 760) await trip(size + ' M ' + monthTops[1] + ' → D → ‹ 올라가기', 'month', '?section=schedule&view=month&date=2026-10-28', monthTops[1], cell, dayShown,
          () => page.locator('#lifeApp .schedule-up').click(), { expected: 0, wait: () => page.waitForFunction(() => document.activeElement && document.activeElement !== document.body) });
      }
      report.restoreTrips = trips;
      assert.deepEqual(misses, [], 'every return is within 1px of where the screen was left');
      // The entries of 일정 are put back by the app alone; other screens keep the browser's restore.
      await page.setViewportSize({ width: 1440, height: 600 });
      const mode = () => page.evaluate(() => history.scrollRestoration);
      const to = top => page.evaluate(top => scrollTo({ top, behavior: 'instant' }), top);
      const dayFocus = () => page.waitForFunction(() => document.activeElement?.dataset.focusKey === 'schedule:day:2026-10-28');
      // Pressed with the keyboard's focus on it and without moving the page (the return puts focus back on the cell).
      const openDay = async () => {
        await page.goto('about:blank'); await page.goto(base + '/index.html?section=schedule&view=month&date=2026-10-27'); await ready(page); await shown(page, 'month');
        assert.equal(await mode(), 'manual', 'M');
        await to(140); await page.evaluate(() => { const day = document.querySelector('[data-focus-key="schedule:day:2026-10-28"]'); day.focus({ preventScroll: true }); day.click(); }); await shown(page, 'day');
        assert.equal(await mode(), 'manual', 'D');
      };
      // Back and forward land where each entry was left.
      await openDay();
      const dayEnd = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      assert.ok(dayEnd > 130, 'D scrolls (' + dayEnd + ')');
      await to(110); await page.goBack(); await shown(page, 'month'); await dayFocus(); assert.equal(await rest(page), 140, 'back to M');
      await page.goForward(); await shown(page, 'day'); await page.waitForFunction(() => document.activeElement && document.activeElement !== document.body);
      assert.equal(await rest(page), 110, 'forward to D');
      // A reload in D, then back: M's entry kept its position in history.state when D was opened from it.
      await openDay();
      await page.reload(); await ready(page); await shown(page, 'day'); assert.equal(await rest(page), 0, 'a reloaded D opens at its top');
      await page.goBack(); await shown(page, 'month'); await dayFocus(); assert.equal(await rest(page), 140, 'back to M after a reload in D');
      // A reload in M, then forward: the position of an entry left with the browser's back is kept in this page's memory
      // only, so after the reload D opens at its top (not at the 90 M was at).
      await page.reload(); await ready(page); await shown(page, 'month'); await to(90);
      await page.goForward(); await shown(page, 'day'); await page.waitForFunction(() => document.activeElement && document.activeElement !== document.body);
      assert.equal(await rest(page), 0, 'forward to D after a reload');
      // 노트 and a post keep the browser's restore; coming back to 일정 is the app's again.
      await page.locator(tab('notes')).click(); await shown(page, 'home'); assert.equal(await mode(), 'auto', '노트');
      await page.locator('#homePostList .home-post-open').first().click(); await page.locator('.photo-article').waitFor(); assert.equal(await mode(), 'auto', '글 읽기');
      await page.goBack(); await shown(page, 'home'); await page.goBack(); await shown(page, 'day'); assert.equal(await mode(), 'manual', 'back in 일정');
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
      for (const [width, height] of [[1440, 960], [1101, 900], [1100, 900], [820, 1180], [390, 844], [320, 640]]) {
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
          // Rule change 2026-11-18 (W2 review m-3): M alone keeps the column under its calendar up to 1279px (below).
          const beside = width > 1100 && !(unit === 'month' && width < 1280);
          assert.equal(beside ? frame.beside : frame.under, true, scene + (beside ? ': beside the body' : ': under the body'));
          assert.equal(frame.tables, 0, scene + ': no empty table');
          assert.equal(frame.overflow, 0, scene + ': no horizontal overflow');
          if (width === 1440 || width === 390 || width === 820 || width === 320) {
            const file = 'schedule-' + unit + '-' + width + '.png'; await page.screenshot({ path: path.join(output, file) }); report.screenshots.push(file);
          }
        }
      }
      // 2026-11-18 (W2 review m-3): beside the 305px column M's cells were 58–70px wide between 1101 and 1279px and their
      // tags showed one or two characters (on 8c3c54f at 1101: a title 2 of 12, a plan 1 of 10). There the column goes
      // under the calendar, as up to 1100px. A tag shows at least three characters or its whole text; the cell keeps its
      // 104px, the 1px grid and its name (dayLabel).
      for (const [width, under] of [[1101, true], [1279, true], [1280, false], [1440, false], [820, true]]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(base + '/index.html?section=schedule&view=month&date=2026-11-03'); await ready(page); await shown(page, 'month');
        await page.waitForFunction(() => [...document.querySelectorAll('#lifeSchedule .schedule-entries')].every(slot => slot.getAttribute('aria-busy') === 'false'));
        const month = await page.evaluate(() => {
          const D = HaedoLife.ScheduleData, box = node => node.getBoundingClientRect();
          const primary = box(document.querySelector('#lifeSchedule .schedule-primary')), aside = document.querySelector('#lifeSchedule .schedule-aside');
          // The characters of a tag that are drawn whole inside it.
          const shownOf = node => {
            const text = (node.matches('.schedule-cell-plan') ? node.querySelector('span') : node).firstChild, holder = text.parentElement, style = getComputedStyle(holder);
            const right = box(holder).right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth), range = document.createRange();
            let count = 0;
            for (let i = 0; i < text.length; i++) { range.setStart(text, i); range.setEnd(text, i + 1); if (range.getBoundingClientRect().right > right + 0.5) break; count = i + 1; }
            return { kind: node.className, shown: count, length: text.length };
          };
          const cells = [...document.querySelectorAll('#lifeSchedule .schedule-day-cell')];
          return { under: box(aside).top >= primary.bottom - 1, beside: box(aside).left >= primary.right - 1, aside: Math.round(box(aside).width), line: getComputedStyle(aside).borderLeftWidth,
            tags: [...document.querySelectorAll('#lifeSchedule :is(.schedule-cell-title, .schedule-cell-plan)')].map(shownOf),
            low: cells.filter(cell => box(cell).height < 104).length, grid: [...new Set(cells.map(cell => getComputedStyle(cell).borderRightWidth + ' ' + getComputedStyle(cell).borderBottomWidth))],
            unnamed: cells.filter(cell => !cell.getAttribute('aria-label').startsWith(D.dayTitle(cell.dataset.scheduleGo.slice(4)))).length,
            sides: [...aside.querySelectorAll(':scope > [data-side]')].map(node => node.dataset.side), overflow: document.documentElement.scrollWidth - innerWidth };
        });
        const scene = 'M ' + width;
        assert.equal(under ? month.under : month.beside, true, scene + (under ? ': the side column under the calendar' : ': the side column beside the calendar'));
        // Beside: the 280px column with its 24px and 1px line. Under: no line, 560px at most.
        if (under) assert.ok(month.aside <= 560 && month.line === '0px', scene + ': the column under is 560px at most, without the line (' + month.aside + ', ' + month.line + ')');
        else assert.deepEqual([month.aside, month.line], [305, '1px'], scene + ': the 280px column, its 24px and the 1px line');
        assert.ok(month.tags.length >= 3, scene + ': the fixture has tags');
        assert.deepEqual(month.tags.filter(tag => tag.shown < Math.min(3, tag.length)), [], scene + ': no tag is cut to one or two characters');
        assert.deepEqual([month.low, month.grid, month.unnamed], [0, ['1px 1px'], 0], scene + ': 104px cells, the 1px grid and each cell named by its day');
        assert.deepEqual(month.sides, ['plans', 'habits', 'goals'], scene);
        assert.equal(month.overflow, 0, scene + ': no horizontal overflow');
        if (width === 1101 || width === 1279 || width === 1280) { const file = 'schedule-month-' + width + '.png'; await page.screenshot({ path: path.join(output, file) }); report.screenshots.push(file); }
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
    // 2026-11-18 (review of S2, F1): with habits, M's tracker table follows where the side column stands. Under the
    // calendar (to 1279px) it is the table of 761–1100px: 31 dots on one line under the day scale 1 · 3 · 10 · 20 · 30.
    // Beside it (from 1280px, the 280px column) the dots wrap 16 to a line, without the scale, today ringed. On b795605
    // the table kept the 280px shape from 1101px although the column had gone under the calendar.
    await check('M with habits: the tracker table under the calendar is one line of dots under the day scale to 1279px; in the side column from 1280px it wraps', async ({ page, context }) => {
      const tables = new PlatformTables('2026-11-03T02:00:00Z'); await tables.attach(context);
      tables.seed('haedo_items', accounts.a.id, { id: 'h1', kind: 'habit', name: '아침 산책', data: { title: '아침 산책', days: [1, 3, 5], created: '2026-10-01', checks: ['2026-10-30', '2026-11-02'] } });
      tables.seed('haedo_items', accounts.a.id, { id: 'h2', kind: 'habit', name: '저녁 일기 한 줄', data: { title: '저녁 일기 한 줄', days: [0, 1, 2, 3, 4, 5, 6], created: '2026-10-20', checks: ['2026-11-01', '2026-11-02'] } });
      await page.goto(base + '/index.html'); await ready(page); await seed(page);
      for (const [width, under] of [[1100, true], [1101, true], [1279, true], [1280, false], [1440, false]]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(base + '/index.html?section=schedule&view=month&date=2026-11-03'); await ready(page); await shown(page, 'month');
        await page.waitForFunction(() => document.querySelectorAll('#lifeSchedule .schedule-entries-month .habit-compact-row').length === 2);
        const table = await page.evaluate(() => {
          const box = node => node.getBoundingClientRect(), slot = document.querySelector('#lifeSchedule .schedule-entries-month');
          const primary = box(document.querySelector('#lifeSchedule .schedule-primary')), aside = box(document.querySelector('#lifeSchedule .schedule-aside'));
          const head = slot.querySelector('.habit-compact-head'), scale = head.querySelector('.habit-compact-days');
          const rows = [...slot.querySelectorAll('.habit-compact-row')].map(row => {
            const dots = [...row.querySelectorAll('.habit-compact-dot')].map(box), days = box(row.querySelector('.habit-compact-days')), name = box(row.querySelector('.habit-compact-name'));
            return { dots: dots.length, lines: new Set(dots.map(dot => Math.round(dot.top))).size, sizes: [...new Set(dots.map(dot => Math.round(dot.width) + 'x' + Math.round(dot.height)))],
              inside: dots.every(dot => dot.left >= days.left - 1 && dot.right <= days.right + 1) && days.right <= aside.right + 1, nameAbove: name.bottom <= days.top + 1, tall: box(row).height >= 44,
              // Each dot stands under its day of the scale (both are centred in the day's column).
              columns: scale.checkVisibility() ? dots.every((dot, i) => { const day = box(scale.children[i]); return Math.abs((dot.left + dot.right) / 2 - (day.left + day.right) / 2) <= 1; }) : null };
          });
          const today = slot.querySelector('.habit-compact-rows .habit-compact-dot[data-today]');
          return { under: aside.top >= primary.bottom - 1, beside: aside.left >= primary.right - 1, rows, scaleShown: head.checkVisibility() && scale.checkVisibility(),
            scale: scale.checkVisibility() ? [...scale.children].filter(node => node.textContent).map(node => node.textContent) : null,
            scaleInside: scale.checkVisibility() ? [...scale.children].filter(node => node.textContent).every(node => { const range = document.createRange(); range.selectNodeContents(node); const text = range.getBoundingClientRect(); return text.left >= box(scale).left - 0.5 && text.right <= box(scale).right + 0.5; }) : null,
            todayNumber: head.querySelector('.habit-compact-number[data-today]')?.textContent || null, todayRing: getComputedStyle(today).boxShadow !== 'none',
            links: [...slot.querySelectorAll('a.habit-compact-row')].map(row => row.getAttribute('aria-label') || row.textContent).length, overflow: document.documentElement.scrollWidth - innerWidth };
        });
        const scene = 'M with habits ' + width;
        assert.equal(under ? table.under : table.beside, true, scene + (under ? ': the side column under the calendar' : ': the side column beside the calendar'));
        assert.deepEqual(table.rows.map(row => [row.dots, row.sizes, row.inside, row.nameAbove, row.tall]), table.rows.map(() => [30, ['10x10'], true, true, true]), scene + ': 30 dots of 10px inside their row, under the name, in a 44px row');
        if (under) {
          assert.deepEqual(table.rows.map(row => [row.lines, row.columns]), table.rows.map(() => [1, true]), scene + ': the dots are one line, each under its day of the scale');
          assert.deepEqual([table.scaleShown, table.scale, table.scaleInside, table.todayNumber, table.todayRing], [true, ['1', '3', '10', '20', '30'], true, '3', false], scene + ': the day scale 1 · 3 · 10 · 20 · 30 with today\'s number, no ring');
        } else {
          assert.deepEqual(table.rows.map(row => row.lines), table.rows.map(() => 2), scene + ': the dots wrap to two lines in the 280px column');
          assert.deepEqual([table.scaleShown, table.todayRing], [false, true], scene + ': no day scale; today is the ringed dot');
        }
        assert.equal(table.links, 2, scene + ': each row is still its link');
        assert.equal(table.overflow, 0, scene + ': no horizontal overflow');
        const file = 'schedule-month-habits-' + width + '.png'; await page.screenshot({ path: path.join(output, file), fullPage: true }); report.screenshots.push(file);
      }
    });
    // 2026-11-18 (W2 review m-5; contract 일정 iPhone: the title and 오늘 ‹ › share one row). On 8c3c54f at 320px D's
    // "11월 3일 화요일" and W's "12.21 – 12.27" took two lines in the 146px the row leaves the title. To 374px D shows its
    // weekday short and to 350px the title's size follows its column (schedule.css). The heading keeps its whole name.
    // A date of another year is longer than the row at these widths and still takes two lines (not asserted).
    await check('a phone\'s 일정 title is one line beside 오늘 ‹ › at 320–390; D shows its weekday short to 374px and is named by the whole date', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page);
      // [unit, date, title, the short title shown to 374px]
      const cases = [['day', '2026-11-03', '11월 3일 화요일', '11월 3일 (화)'], ['day', '2026-12-25', '12월 25일 금요일', '12월 25일 (금)'], ['week', '2026-11-03', '11.2 – 11.8'],
        ['week', '2026-12-23', '12.21 – 12.27'], ['month', '2026-11-03', '11월'], ['quarter', '2026-11-03', '2026년 4분기'], ['tools', '2026-11-03', '2026년']];
      for (const width of [320, 350, 351, 360, 374, 375, 390]) {
        await page.setViewportSize({ width, height: 640 });
        for (const [unit, date, title, short] of cases) {
          await page.goto(base + '/index.html?section=schedule&view=' + unit + '&date=' + date); await ready(page); await shown(page, unit);
          const head = await page.evaluate(() => {
            const h1 = document.querySelector('#lifeApp .life-page-title'), brief = h1.querySelector('.schedule-title-short'), whole = h1.querySelector('.schedule-title-full') || h1;
            const seen = brief?.checkVisibility() ? brief : whole, range = document.createRange(); range.selectNodeContents(seen);
            const rects = [...range.getClientRects()], box = h1.getBoundingClientRect(), today = document.querySelector('#lifeApp .schedule-today').getBoundingClientRect(), step = document.querySelector('#lifeApp .schedule-step').getBoundingClientRect();
            return { seen: seen.textContent, lines: new Set(rects.map(rect => Math.round(rect.top))).size, inside: rects.every(rect => rect.left >= box.left - 0.5 && rect.right <= Math.min(box.right, today.left) + 0.5),
              row: [today, step].every(part => part.top < box.bottom && part.bottom > box.top), size: parseFloat(getComputedStyle(h1).fontSize), overflow: document.documentElement.scrollWidth - innerWidth };
          });
          const scene = unit + ' ' + date + ' at ' + width;
          assert.equal(head.seen, short && width <= 374 ? short : title, scene + ': the title shown');
          assert.equal(head.lines, 1, scene + ': one line (' + JSON.stringify(head) + ')');
          assert.deepEqual([head.inside, head.row, head.overflow], [true, true, 0], scene + ': whole, on the row of 오늘 ‹ ›, no horizontal overflow');
          assert.ok(head.size >= 24 && head.size <= 28 && (width <= 350 ? head.size < 28 : head.size === 28), scene + ': 28px from 351px, smaller to 350px, never under 24px (W5) (' + head.size + ')');
          assert.equal(await page.getByRole('heading', { level: 1, name: title, exact: true }).count(), 1, scene + ': the heading is named ' + title);
          if (width === 320 && (unit === 'day' || unit === 'week')) { const file = 'schedule-title-' + unit + '-' + date + '-320.png'; await page.screenshot({ path: path.join(output, file) }); report.screenshots.push(file); }
        }
      }
      // From 761px the whole title is shown as before.
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto(base + '/index.html?section=schedule&view=day&date=2026-11-03'); await ready(page); await shown(page, 'day');
      assert.equal(await page.locator('#lifeApp .life-page-title').innerText(), '11월 3일 화요일');
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

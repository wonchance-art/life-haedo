/* 설정(묶음 E, 2026-11-03): 왼쪽 항목 목록·오른쪽 상세(넓은 칸)와 묶음별 행(좁은 칸).
 * Real app/SDK/IndexedDB with intercepted anonymous Auth (FakeCloud). Chromium widths only, not Apple devices.
 * npm run dev (or scripts/dev-server.py --port 4184); BASE_URL, PW_MODULE_PATH, CHROMIUM_PATH as in README. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, nav, observe } = require('./unified-home-browser.cjs');
const { inspectHome } = require('./home-entry-browser.cjs');
const { awaitCondition } = require('./helpers/await-condition.cjs');
const out = path.resolve('.local/settings-browser');
const report = { createdAt: new Date().toISOString(), scope: 'Actual SDK/IndexedDB with intercepted anonymous Auth; Chromium widths, not Apple devices', checks: [], visual: [], consoleErrors: [], pageErrors: [] };
const ITEMS = ['계정', '자료공간', '뉴스', '일정', '백업', '공개 페이지', '단축키'];

async function mode(page, value) { await page.locator('#lifeMain[data-mode="' + value + '"]').waitFor(); await settle(page); }
async function openSettings(page) { await nav(page, 'manage'); await mode(page, 'manage'); await page.locator('#lifeSettings').waitFor(); }
const activeId = page => page.evaluate(() => document.activeElement?.id || '');
// The address as the page has it now. page.url() follows history.replaceState through a later browser event
// and can still name the previous item right after a press (seen 1 in 240 presses).
const addressHash = page => page.evaluate(() => location.hash);
// Two animation frames and a short task: any focus placed "in the next frame" has run.
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 100)))));
// Focus that 설정 places in a frame after its screen has settled: a returned-to row (ui.js
// restoreOriginView) and an item named by the address (SettingsUI.mount). A same-document history move to
// an address with a fragment (#settings-…) also clears focus natively at the end of that task (Chromium
// fragment focus reset), so a read right after settle() can see <body>. Wait shortly for exactly the
// expected element, then require focus not to leave it during the following frames.
const focusMatches = ({ id, focusKey }) => { const el = document.activeElement; return !!el && el.isConnected && (id ? el.id === id : el.dataset.focusKey === focusKey); };
async function focusSettles(page, expected, label) {
  await awaitCondition(page, focusMatches, expected, { timeout: 5000, label: label + ': focus on ' + JSON.stringify(expected) });
  const moves = await page.evaluate(async () => {
    const seen = [], record = event => seen.push(event.target.id || event.target.dataset?.focusKey || event.target.tagName);
    document.addEventListener('focusout', record, true);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 100))));
    document.removeEventListener('focusout', record, true);
    return seen;
  });
  assert.deepEqual(moves, [], label + ': focus does not move away afterwards');
  assert.equal(await page.evaluate(focusMatches, expected), true, label + ': focus stays on ' + JSON.stringify(expected));
}
// Every element that receives focus from now on (capture phase on document; kept across in-app screens).
const recordFocus = page => page.evaluate(() => {
  window.__settingsFocus = [];
  if (!window.__settingsFocusListener) document.addEventListener('focusin', window.__settingsFocusListener = event => {
    const el = event.target; window.__settingsFocus.push(el.id ? { id: el.id } : { focusKey: el.dataset?.focusKey, tag: el.tagName });
  }, true);
});
// A return or back focuses its origin control directly: after the control used to leave (if any), the only
// element that receives focus is the origin row. No heading of 설정 is focused in between (2026-11-04).
async function returnFocus(page, expected, label, trigger = null) {
  await focusSettles(page, expected, label);
  assert.deepEqual(await page.evaluate(() => window.__settingsFocus), [...(trigger ? [trigger] : []), expected], label + ': focus goes to the origin row only');
}
// The item named by the address is marked in that same later frame (SettingsUI.mount); until then the first item is.
const currentItemSettles = (page, text, label) => awaitCondition(page, text => {
  const marked = [...document.querySelectorAll('.settings-index-link[aria-current]')].map(link => link.textContent);
  return marked.length === 1 && marked[0] === text;
}, text, { timeout: 12000, label: label + ': the only current item is ' + text });
const stored = (page, key) => page.evaluate(key => localStorage.getItem(key), key);
async function capture(page, scene, width) {
  await page.evaluate(async () => { await document.fonts.ready; document.activeElement?.blur(); scrollTo({ top: 0, behavior: 'instant' }); });
  await page.mouse.move(0, 0);
  const metrics = await page.evaluate(inspectHome, '#lifeApp');
  const file = `${scene}-${width}.png`; await page.screenshot({ path: path.join(out, file), fullPage: true });
  report.visual.push({ scene, width, file, ...metrics });
  assert.equal(metrics.horizontalOverflow, false, scene + ' horizontal overflow');
  assert.deepEqual(metrics.overflow, [], scene + ' element outside the viewport');
  assert.deepEqual(metrics.smallTargets, [], scene + ' target below 44px');
  assert.deepEqual(metrics.unnamed, [], scene + ' unnamed control');
  assert.deepEqual(metrics.contrastFailures, [], scene + ' text contrast');
}
// A draft that cannot be stored: photo-post writes abort (same technique as app-motion-browser).
async function failPostWrites(page) {
  await page.evaluate(() => {
    window.__settingsPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { const request = __settingsPut.apply(this, args); if (args[0]?.key?.startsWith('photo-post:')) this.transaction.abort(); return request; };
  });
}

async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  async function check(name, run, width = 1440) {
    const server = new FakeCloud();
    const context = await makeContext(browser, server, 'settings-' + report.checks.length, accounts.a, { viewport: { width, height: width === 390 ? 844 : width === 820 ? 1180 : 960 }, hasTouch: width <= 820 });
    const page = await context.newPage(); observe(page, report, name); page.setDefaultTimeout(12000);
    try { await page.goto(base + '/index.html'); await ready(page); await run({ page, context, server }); assert.equal(server.writes().length, 0, 'settings never write to the server'); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    for (const width of [1440, 820, 390]) await check('layout, current values and visual metrics ' + width, async ({ page }) => {
      const keysBefore = await page.evaluate(() => Object.keys(localStorage).sort());
      await openSettings(page);
      const wide = width > 760;
      assert.equal(await page.locator('.settings-index').isVisible(), wide);
      if (wide) {
        assert.deepEqual(await page.locator('.settings-index-link').allInnerTexts(), ITEMS);
        assert.equal(await page.locator('.settings-index-link[aria-current]').innerText(), '계정');
        assert.equal(await page.locator('#settings-keys').isVisible(), true);
        assert.equal(await page.locator('#settings-schedule [role="radiogroup"] input[value="36"]').isChecked(), true, '저장값이 없으면 연표와 같은 시기(36)');
      } else {
        // 묶음: 계정(계정·자료공간), 뉴스, 일정, 보관(백업·공개 페이지). 단축키는 넓은 칸만.
        assert.deepEqual(await page.locator('.settings-heading').evaluateAll(nodes => nodes.filter(el => el.getBoundingClientRect().width > 1 && el.checkVisibility()).map(el => el.innerText)), ['계정', '뉴스', '일정', '보관']);
        assert.equal(await page.locator('#settings-keys').isVisible(), false);
        assert.equal(await page.locator('#lifeSettingsCurve').inputValue(), '36');
        assert.equal(await page.locator('#lifeSettingsAge').inputValue(), 'intl');
      }
      // Existing rows and IDs keep their names (other journeys find them).
      for (const name of ['현재 자료공간', '동기화', '백업·복원', '공개 표지', '공개한 페이지', '관심 주제 편집', '뉴스 설정']) assert.equal(await page.getByRole('button', { name, exact: true }).isVisible(), true, name);
      assert.match(await page.locator('#lifeCurrentWorkspace').innerText(), /이 브라우저 · 자료 0개 · 발췌 0개/);
      await page.waitForFunction(() => document.querySelector('#lifeManagementSyncStatus')?.dataset.syncState === 'unbound');
      assert.match(await page.locator('#lifeManagementSyncStatus').innerText(), /원문·발췌/);
      await page.locator('#lifeSettingsNewsLanguage:text("전체 언어")').waitFor();
      assert.match(await page.locator('#lifeSettingsAccount').innerText(), /device-a@example\.invalid/);
      // Fixed schedule values (week start, first stage, happiness unit) are not offered as settings.
      assert.doesNotMatch(await page.locator('#settings-schedule').innerText(), /주 시작|처음 여는 단계|행복도 입력/);
      await capture(page, 'settings', width);
      // Showing values never writes a key.
      assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).sort()), keysBefore);
    }, width);

    await check('item moves and hash entry keep the app history entry', async ({ page }) => {
      await openSettings(page);
      const before = await page.evaluate(() => ({ length: history.length, key: history.state?.haedo?.key }));
      await page.locator('.settings-index-link', { hasText: '백업' }).click();
      assert.equal(await addressHash(page), '#settings-backup');
      assert.equal(await page.locator('.settings-index-link[aria-current]').innerText(), '백업');
      assert.equal(await activeId(page), 'settings-heading-backup');
      // The item starts just below the fixed header: html scroll-padding-top plus the section's scroll-margin-top.
      const place = await page.locator('#settings-backup').evaluate(el => ({ top: el.getBoundingClientRect().top, header: document.querySelector('.life-header').getBoundingClientRect().bottom,
        expected: parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) + parseFloat(getComputedStyle(el).scrollMarginTop) }));
      assert(Math.abs(place.top - place.expected) <= 1 && place.top >= place.header, 'selected item is brought to the top: ' + JSON.stringify(place));
      // Keyboard: Tab to the item, Enter.
      await page.locator('.settings-index-link', { hasText: '단축키' }).focus(); await page.keyboard.press('Enter');
      assert.equal(await addressHash(page), '#settings-keys'); assert.equal(await activeId(page), 'settings-heading-keys');
      assert.deepEqual(await page.evaluate(() => ({ length: history.length, key: history.state?.haedo?.key })), before, 'item moves replace the address; the app entry is kept');
      // Scrolling by hand moves the current item and the address with it; focus stays where it was.
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await page.mouse.move(900, 500);
      await page.mouse.wheel(0, 1); await page.waitForFunction(() => location.hash === '#settings-account');
      const schedule = await page.locator('#settings-schedule').evaluate(el => el.getBoundingClientRect().top + scrollY - parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) - 8);
      await page.mouse.wheel(0, schedule - 1);
      await page.waitForFunction(() => location.hash === '#settings-schedule' && document.querySelector('.settings-index-link[aria-current]')?.textContent === '일정');
      assert.equal(await activeId(page), 'settings-heading-keys', 'scrolling never moves focus');
      await page.mouse.wheel(0, 4000);
      await page.waitForFunction(() => location.hash === '#settings-keys' && document.querySelector('.settings-index-link[aria-current]')?.textContent === '단축키');
      assert.deepEqual(await page.evaluate(() => ({ length: history.length, key: history.state?.haedo?.key })), before, 'scroll following replaces the address only');
      // Names are the item; the current value is the description.
      const described = selector => page.locator(selector).evaluate(el => (el.getAttribute('aria-describedby') || '').split(' ').map(id => document.getElementById(id)?.textContent || '').join(' '));
      assert.equal(await page.getByRole('button', { name: '계정', exact: true }).getAttribute('id'), 'lifeSettingsAccount');
      assert.match(await described('#lifeSettingsAccount'), /device-a@example\.invalid/);
      assert.match(await described('[data-focus-key="manage:news-settings"]'), /전체 언어/);
      assert.match(await described('#lifeCurrentWorkspace'), /내 자료.*이 브라우저 · 자료 0개.*다른 작업공간을 선택/);
      // Reload and direct addresses open the named item.
      await page.reload(); await ready(page); await mode(page, 'manage');
      await currentItemSettles(page, '단축키', 'reload of #settings-keys'); await focusSettles(page, { id: 'settings-heading-keys' }, 'reload of #settings-keys');
      // Fresh loads (a bookmark), not same-document fragment moves.
      await page.goto('about:blank'); await page.goto(base + '/index.html?section=manage#settings-news'); await ready(page); await mode(page, 'manage');
      await currentItemSettles(page, '뉴스', 'fresh load of #settings-news'); await focusSettles(page, { id: 'settings-heading-news' }, 'fresh load of #settings-news');
      // An item moved to from the list survives leaving and returning with the browser.
      await page.locator('#lifeBackupOpen').click(); await mode(page, 'backup'); await recordFocus(page); await page.goBack(); await mode(page, 'manage');
      await returnFocus(page, { id: 'lifeBackupOpen' }, 'browser back restores the row that was used');
      // The three former settings-file hashes open 백업·복원 with the format list focused.
      for (const hash of ['#lifeBackupChoices', '#lifeBackupMaterials', '#lifeBackupPlanning']) {
        await page.goto('about:blank'); await page.goto(base + '/index.html?section=manage' + hash); await ready(page); await mode(page, 'backup');
        await page.waitForFunction(() => document.activeElement?.id === 'lifeBackupFormatsHeading');
        assert.equal(await page.locator('a[href="workspace.html?section=manage#backupAll"]').count(), 1);
      }
      // A screen's own hash does not follow the person: an item of 설정 to another section, or an
      // old backup anchor back to 설정 (review m3 of bundle E).
      await page.goto('about:blank'); await page.goto(base + '/index.html?section=manage#settings-public'); await ready(page); await mode(page, 'manage');
      await nav(page, 'news'); await mode(page, 'external-discovery');
      assert.equal(await addressHash(page), '', 'another section does not carry #settings-public');
      await nav(page, 'manage'); await mode(page, 'manage');
      // The address may then name the item that the restored scroll position shows (scroll following).
      assert.match(await addressHash(page), /^(#settings-[a-z]+)?$/);
      await frames(page);
      assert.notEqual(await activeId(page), 'settings-heading-public', 'returning to 설정 does not reselect the item of an earlier visit');
      await page.goto('about:blank'); await page.goto(base + '/index.html?section=manage#lifeBackupMaterials'); await ready(page); await mode(page, 'backup');
      assert.equal(await addressHash(page), '#lifeBackupMaterials');
      await nav(page, 'manage'); await mode(page, 'manage');
      // 설정 may name the item its restored scroll position shows, never the backup anchor.
      assert.match(await addressHash(page), /^(#settings-[a-z]+)?$/, '설정 does not keep the backup anchor');
      await page.reload(); await ready(page); await mode(page, 'manage');
      await page.goto(base + '/workspace.html?section=manage#backupAll');
      await page.locator('#backupAll').waitFor({ state: 'visible' });
    });

    await check('390 rows open their screens and return with back and forward', async ({ page, context }) => {
      // 공개한 페이지 reads the owner's list; this anonymous simulator answers with an empty one.
      await context.route('**/rest/v1/rpc/life_public_page_list', route => route.request().method() === 'OPTIONS' ? route.fallback()
        : route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ pages: [], nextCursor: null }) }));
      // Direct entries on the narrow layout focus a visible place: the joined items' first row; 단축키 (wide only) opens the plain list.
      for (const [hash, focusKey] of [['#settings-public', 'manage:public-cover'], ['#settings-workspace', 'manage:workspace'], ['#settings-news', null]]) {
        await page.goto('about:blank'); await page.goto(base + '/index.html?section=manage' + hash); await ready(page); await mode(page, 'manage');
        await page.waitForFunction(key => { const el = document.activeElement, box = el?.getBoundingClientRect(); return el && box.width > 40 && box.height >= (key ? 44 : 16) && box.top >= 0 && box.bottom <= innerHeight &&
          (key ? el.dataset.focusKey === key : el.id === 'settings-heading-news'); }, focusKey);
      }
      await page.goto('about:blank'); await page.goto(base + '/index.html?section=manage#settings-keys'); await ready(page); await mode(page, 'manage');
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => scrollY), 0); assert.doesNotMatch(await activeId(page), /^settings-heading-keys$/);
      await openSettings(page);
      // 백업·복원: in-app back, browser back and forward.
      await page.locator('#lifeBackupOpen').tap(); await mode(page, 'backup');
      await recordFocus(page); await page.getByRole('button', { name: '설정으로 돌아가기', exact: true }).tap(); await mode(page, 'manage');
      await returnFocus(page, { id: 'lifeBackupOpen' }, '설정으로 돌아가기 from 백업·복원', { id: 'lifeSubviewReturn' });
      await page.locator('#lifeBackupOpen').tap(); await mode(page, 'backup');
      await recordFocus(page); await page.goBack(); await mode(page, 'manage'); await returnFocus(page, { id: 'lifeBackupOpen' }, 'browser back from 백업·복원');
      await page.goForward(); await mode(page, 'backup'); await page.locator('#fbInventory [data-kind]').first().waitFor();
      await capture(page, 'backup', 390);
      // The restore frame also scrolls back to the row; a tap aimed before it lands on the neighbouring row.
      await recordFocus(page); await page.goBack(); await mode(page, 'manage'); await returnFocus(page, { id: 'lifeBackupOpen' }, 'browser back from 백업·복원 after forward');
      // 공개 표지 and 공개한 페이지.
      for (const [name, destination] of [['공개 표지', 'public-cover'], ['공개한 페이지', 'public-pages']]) {
        await page.getByRole('button', { name, exact: true }).tap(); await mode(page, destination);
        await recordFocus(page); await page.goBack(); await mode(page, 'manage');
        await returnFocus(page, { focusKey: 'manage:' + destination, tag: 'BUTTON' }, 'browser back from ' + name);
      }
      // 뉴스: the existing news settings screen and the existing topic editor.
      await page.getByRole('button', { name: '뉴스 설정', exact: true }).tap(); await mode(page, 'external-discovery');
      await page.locator('#discoveryNewsSettingsPanel').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-haedo-navigation] [data-haedo-section="news"]').getAttribute('aria-current'), 'page');
      await recordFocus(page); await page.goBack(); await mode(page, 'manage'); await returnFocus(page, { focusKey: 'manage:news-settings', tag: 'BUTTON' }, 'browser back from 뉴스 설정');
      await page.getByRole('button', { name: '관심 주제 편집', exact: true }).tap(); await mode(page, 'interests');
      await recordFocus(page); await page.goBack(); await mode(page, 'manage'); await returnFocus(page, { focusKey: 'manage:news-interests', tag: 'BUTTON' }, 'browser back from 관심 주제 편집');
      // 로그인 opens the one account menu; 로그아웃 stays there only.
      await page.locator('#lifeSettingsAccount').tap();
      await page.waitForFunction(() => document.getElementById('lifeAccount').open && document.activeElement?.id === 'lifeLogout');
      assert.equal(await page.locator('#lifeSettingsAccount').getAttribute('aria-expanded'), 'true');
      assert.equal(await page.getByRole('button', { name: '로그아웃', exact: true }).count(), 1);
      await page.keyboard.press('Escape'); await page.waitForFunction(() => document.querySelector('#lifeSettingsAccount').getAttribute('aria-expanded') === 'false' && !document.getElementById('lifeAccount').open);
      // 일정: the timeline's existing values, shown and changed in the row.
      await page.locator('#lifeSettingsCurve').selectOption('60'); assert.equal(await stored(page, 'caeyeon_life_ma'), '60');
      await page.locator('#lifeSettingsAge').selectOption('kr'); assert.equal(await stored(page, 'caeyeon_life_age'), 'kr');
      await page.reload(); await ready(page); await mode(page, 'manage');
      assert.equal(await page.locator('#lifeSettingsCurve').inputValue(), '60'); assert.equal(await page.locator('#lifeSettingsAge').inputValue(), 'kr');
    }, 390);

    await check('wide choices write the timeline value and follow another tab', async ({ page, context }) => {
      await page.evaluate(() => localStorage.setItem('caeyeon_life_ma', '18'));
      await page.reload(); await ready(page); await openSettings(page);
      // The timeline's rule: an old 18 is read as the nearest step, the larger one on a tie (36). Reading does not rewrite it.
      assert.equal(await page.locator('#settings-schedule input[value="36"]').isChecked(), true); assert.equal(await stored(page, 'caeyeon_life_ma'), '18');
      await page.locator('.settings-curve-card[data-settings-curve="60"]').click(); assert.equal(await stored(page, 'caeyeon_life_ma'), '60');
      await page.locator('.settings-segment', { hasText: '한국 나이' }).click(); assert.equal(await stored(page, 'caeyeon_life_age'), 'kr');
      const other = await context.newPage(); observe(other, report, 'other tab');
      await other.goto(base + '/index.html'); await ready(other);
      await other.evaluate(() => { localStorage.setItem('caeyeon_life_ma', '0'); localStorage.setItem('caeyeon_life_age', 'intl'); });
      await page.waitForFunction(() => document.querySelector('#settings-schedule input[value="0"]').checked && document.querySelector('#settings-schedule input[value="intl"]').checked);
      await other.close();
    });

    await check('a draft that cannot be stored keeps the editor and refuses opening settings', async ({ page }) => {
      await page.locator('[data-haedo-navigation] [data-haedo-compose]:visible').first().click(); await page.locator('.ql-editor').waitFor();
      await failPostWrites(page); await page.locator('.ql-editor').fill('설정으로 옮기기 전에 남아야 하는 문장');
      await page.locator('.photo-status[role="alert"]').waitFor();
      await page.locator('[data-haedo-navigation] [data-haedo-section="manage"]').click();
      await page.locator('#lifeError:not([hidden])').waitFor();
      assert.equal((await page.locator('.ql-editor').innerText()).trim(), '설정으로 옮기기 전에 남아야 하는 문장');
      assert.equal(await page.locator('#lifeSettings').count(), 0);
      assert.equal(await page.locator('[data-haedo-navigation] [data-haedo-section="manage"]').getAttribute('aria-current'), null);
      await page.evaluate(() => { IDBObjectStore.prototype.put = __settingsPut; });
      await page.getByRole('button', { name: '다시 보관', exact: true }).click(); await page.locator('.photo-status[data-state="draft"]').waitFor();
      await nav(page, 'manage'); await mode(page, 'manage'); await page.locator('#lifeSettings').waitFor();
    }, 820);

    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []);
  } finally { await browser.close(); await fs.writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify({ passed: report.checks.filter(c => c.pass).length, total: report.checks.length, visual: report.visual.length, console: report.consoleErrors.length, page: report.pageErrors.length }));
  if (report.checks.some(c => !c.pass) || report.consoleErrors.length || report.pageErrors.length) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

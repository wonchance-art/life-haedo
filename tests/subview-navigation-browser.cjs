/* Actual app/SDK/IndexedDB with synthetic HTTP Auth. No production writes or Apple hardware. */
'use strict';
const { openRecordsMenu, openBlogMenu } = require('./helpers/feature-menus.cjs');
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, base, cloud } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, nav, observe } = require('./unified-home-browser.cjs');
const { fixture, current, seedComposition, abortWorkbenchWrites } = require('./life-workbench-browser.cjs');
const { instrumentStorage, inspectHome } = require('./home-entry-browser.cjs');
const out = path.resolve('.local/subview-navigation');
const report = { createdAt: new Date().toISOString(), scope: 'Actual app/SDK/IDB, intercepted Auth; viewport/keyboard/touch simulation only', checks: [], visual: [], consoleErrors: [], pageErrors: [], expectedErrors: 0 };
const heading = page => page.locator('#lifeApp .haedo-page-heading h1');
async function mode(page, name) { await settle(page); await page.waitForFunction(name => document.querySelector('#lifeMain')?.dataset.mode === name, name); }
async function back(page, target) {
  const contextualReturn = page.locator('[data-subview-return]:visible');
  if (await page.locator('.photo-editor').isVisible() && !await contextualReturn.count()) await page.getByRole('button', { name: '닫기', exact: true }).click();
  else await contextualReturn.click();
  await mode(page, target);
}
async function openLibrary(page) {
  const library = page.locator('.home-library');
  if (!await library.evaluate(node => node.open)) await library.locator(':scope > summary').click();
}
async function home(page) {
  await nav(page, 'home'); await page.waitForFunction(() => document.querySelector('#homeComposition')?.getAttribute('aria-busy') === 'false');
  await openLibrary(page);
}
async function photoPosts(page) {
  return page.evaluate(async () => { const s = HaedoLife.Shell.storage; return (await s.listPhotoPosts(await s.getActive())).map(({ id, status, title }) => ({ id, status, title })); });
}
async function durablePhoto(page, title, status) {
  // Poll awaited IDB reads; a pending Promise is truthy inside waitForFunction.
  const deadline = Date.now() + 10000; let rows = [];
  do {
    rows = await photoPosts(page);
    const row = rows.find(post => post.title === title && (!status || post.status === status));
    if (row) return row;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw new Error('Photo post was not stored: ' + JSON.stringify(rows));
}
// A screen is ready for a browser move when its own content finished loading:
// the preparation's source cards, or the post's rendered article.
async function materialReady(page) { await page.locator('#mwTitle').waitFor(); await page.locator('.mw-material').first().waitFor(); }
async function postReady(page) { await page.locator('.photo-article').waitFor(); }
// Holds one real storage read (next post, or the preparation's source bundle)
// until the test releases it; every other call uses real IndexedDB unchanged.
async function holdStorage(context) {
  await context.addInitScript(() => {
    const life = window.HaedoLife = window.HaedoLife || {};
    let stored;
    const hold = async (flag, ready, call) => {
      if (window[flag] && ready()) {
        window[flag] = false; window[flag + 'Held'] = true;
        await new Promise(resolve => { window[flag + 'Release'] = resolve; });
      }
      return call();
    };
    const wrap = original => !original || original.__historyHold ? original : Object.freeze({ ...original, __historyHold: true, forAccount(...args) {
      const actual = original.forAccount(...args);
      return Object.freeze({ ...actual,
        readPhotoPost: (...a) => hold('__holdPostRead', () => document.querySelector('#lifeMain')?.dataset.mode === 'page', () => actual.readPhotoPost(...a)),
        read: (...a) => hold('__holdBundleRead', () => !!document.querySelector('#mwTitle'), () => actual.read(...a)) });
    } });
    Object.defineProperty(life, 'Storage', { configurable: true, enumerable: true, get: () => stored, set: value => { stored = wrap(value); } });
  });
}
const historyRecord = page => page.evaluate(() => ({ idx: history.state?.haedo?.idx, key: history.state?.haedo?.key }));
async function capture(page, scene, width) {
  await page.evaluate(async () => { await document.fonts.ready; document.activeElement?.blur(); scrollTo({ top: 0, behavior: 'instant' }); }); await page.mouse.move(0, 0);
  const metrics = await page.evaluate(inspectHome, '#lifeApp');
  const file = `${scene}-${width}.png`; await page.screenshot({ path: path.join(out, file) });
  report.visual.push({ scene, file, ...metrics });
  assert(!metrics.horizontalOverflow && !metrics.overflow.length, JSON.stringify(metrics.overflow));
  assert.deepEqual(metrics.smallTargets, []); assert.deepEqual(metrics.unnamed, []); assert.deepEqual(metrics.contrastFailures, []);
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] }); report.browser = browser.version();
  async function check(name, run, width = 820) {
    if (process.env.SUBVIEW_TEST_MATCH && !new RegExp(process.env.SUBVIEW_TEST_MATCH).test(name)) return;
    const server = new FakeCloud(), context = await makeContext(browser, server, 'subview-' + report.checks.length, accounts.a, { viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width <= 820 });
    await context.route(`${cloud}/rest/v1/rpc/life_public_page_list`, route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
    await context.addInitScript(() => {
      window.__subviewEvents = [];
      const identify = target => {
        const node = target instanceof Element ? target.closest('button,a,summary,input,textarea') || target : null;
        return { tag: node?.tagName, id: node?.id, home: node?.dataset.homeDestination, focusKey: node?.dataset.focusKey };
      };
      for (const type of ['focusin', 'keydown', 'keyup', 'click']) document.addEventListener(type, event => {
        if ((type === 'keydown' || type === 'keyup') && event.key !== 'Enter') return;
        __subviewEvents.push({ type, key: event.key, time: performance.now(), mode: document.querySelector('#lifeMain')?.dataset.mode,
          target: identify(event.target), active: identify(document.activeElement), libraryOpen: document.querySelector('.home-library')?.open });
        if (__subviewEvents.length > 120) __subviewEvents.shift();
      }, true);
    });
    await instrumentStorage(context); const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
    try { await run({ page, context, server }); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { const trace = await page.evaluate(() => ({ mode: document.querySelector('#lifeMain')?.dataset.mode, events: window.__subviewEvents })).catch(() => null); report.checks.push({ name, pass: false, destination: page.subviewDestination, error: error.stack, trace }); console.error('FAIL ' + name + '\n' + error.stack + '\n' + JSON.stringify({ destination: page.subviewDestination, trace })); await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png') }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    for (const width of [1440, 820, 390]) await check('home origin, keyboard/touch return and draft resume ' + width, async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); await home(page);
      for (const [destination, targetMode, title] of [['write', 'page', '글쓰기'], ['import', 'import', '가져오기']]) {
        page.subviewDestination = destination;
        const start = page.locator(`[data-home-destination="${destination}"]:visible`);
        if (width === 1440) { await start.focus(); await page.keyboard.press('Enter'); } else await start.tap();
        await mode(page, targetMode);
        if (destination === 'write') await page.locator('#photoTitle').waitFor();
        assert.equal(await heading(page).textContent(), title);
        if (destination === 'write') {
          assert.equal(await page.locator('[data-subview-return]').count(), 0, 'Editor keeps one close action');
          assert.equal(await page.getByRole('button', { name: '닫기', exact: true }).count(), 1);
        } else {
          assert.equal(await page.locator('[data-subview-return]').count(), 1);
          assert.equal(await page.locator('[data-subview-return]').getAttribute('aria-label'), '일정으로 돌아가기');
        }
        if (destination === 'write') { await page.locator('#photoTitle').fill('산책 뒤 남긴 생각'); await page.locator('.ql-editor').fill('홈으로 돌아갔다가 다시 이어 쓸 한글 초안.'); }
        if (destination === 'import') { await page.locator('#lifeImportTitle').fill('아직 검토 중인 기록'); await page.locator('#lifeImportText').fill('원문을 자동 확정하지 않습니다.'); }
        await capture(page, destination, width);
        await back(page, 'home'); await page.waitForFunction(destination => document.activeElement?.dataset.homeDestination === destination || destination === 'write' && document.activeElement?.id === 'homeFirstWrite', destination);
      }
      await page.locator('#homeTab-drafts').click();
      const homeDraft = page.locator('.home-draft[data-draft-kind="photo-draft"] .home-draft-open');
      const homeDraftFocusKey = await homeDraft.getAttribute('data-focus-key');
      assert(homeDraftFocusKey, 'The home draft must retain its exact return target');
      await homeDraft.click(); await mode(page, 'page');
      await page.locator('#photoTitle').waitFor();
      assert.equal(await page.locator('#photoTitle').inputValue(), '산책 뒤 남긴 생각');
      assert.equal((await page.locator('.ql-editor').innerText()).trim(), '홈으로 돌아갔다가 다시 이어 쓸 한글 초안.');
      await back(page, 'home');
      // Mode changes before asynchronous home lists and their tabs finish.
      await page.waitForFunction(() => document.querySelector('#homeComposition')?.getAttribute('aria-busy') === 'false');
      assert.equal(await page.locator('#homeTab-drafts').getAttribute('aria-selected'), 'true');
      await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, homeDraftFocusKey);

      // Keep the separate manager-origin return contract as well as home resume.
      await openBlogMenu(page);
      await page.getByRole('button', { name: '글 공개·보관', exact: true }).click(); await mode(page, 'blog');
      await page.locator('.blog-manager-list[data-state="ready"]').waitFor();
      const draftButton = page.getByRole('button', { name: '산책 뒤 남긴 생각', exact: true });
      const draftFocusKey = await draftButton.getAttribute('data-focus-key');
      assert(draftFocusKey?.startsWith('blog:post:photo:'));
      await draftButton.click(); await mode(page, 'page');
      await page.locator('#photoTitle').waitFor();
      assert.equal(await page.locator('#photoTitle').inputValue(), '산책 뒤 남긴 생각');
      assert.equal((await page.locator('.ql-editor').innerText()).trim(), '홈으로 돌아갔다가 다시 이어 쓸 한글 초안.');
      await back(page, 'blog');
      await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, draftFocusKey);
      await back(page, 'home'); await home(page);
      await page.locator('[data-home-destination="import"]').click(); await mode(page, 'import');
      assert.equal(await page.locator('#lifeImportText').inputValue(), '원문을 자동 확정하지 않습니다.');
      assert.equal((await current(page)).bundle.sources.length, 0);

      // The record writer remains a separate preserved entry, reached through records.
      await nav(page, 'records'); await mode(page, 'sources');
      await openRecordsMenu(page);
      await page.getByRole('button', { name: '자료 작성', exact: true }).click(); await mode(page, 'write');
      assert.equal(await page.locator('#lifeWritingClose').count(), 1);
      await page.locator('#lifeWritingTitle').fill('기록 작성기의 이전 초안');
      await page.locator('#lifeWritingBody').fill('기존 평문 작성기의 입력도 복귀 뒤 이어집니다.');
      await back(page, 'sources');
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '자료 작성');
      await page.getByRole('button', { name: '자료 작성', exact: true }).click(); await mode(page, 'write');
      assert.equal(await page.locator('#lifeWritingBody').inputValue(), '기존 평문 작성기의 입력도 복귀 뒤 이어집니다.');
      assert.equal((await current(page)).bundle.sources.length, 0);
    }, width);
    await check('delayed native library toggle preserves keyboard destinations after home return', async ({ page, context }) => {
      // Native toggle notification may run after navigation. Hold only its first
      // listener delivery; DOM state, keyboard events, navigation and IDB stay real.
      await context.addInitScript(() => {
        const add = EventTarget.prototype.addEventListener;
        window.__subviewToggleGate = { held: false, released: false };
        EventTarget.prototype.addEventListener = function (type, listener, options) {
          if (type === 'toggle' && this instanceof Element && this.matches('.home-library') && typeof listener === 'function') {
            return add.call(this, type, function (event) {
              if (!__subviewToggleGate.held && this.open) {
                __subviewToggleGate.held = true;
                const target = this;
                window.__subviewReleaseToggle = () => { __subviewToggleGate.released = true; listener.call(target, event); };
              } else listener.call(this, event);
            }, options);
          }
          return add.call(this, type, listener, options);
        };
      });
      await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' }); await ready(page); await home(page);
      await page.waitForFunction(() => __subviewToggleGate.held);
      const before = await current(page);
      const write = page.locator('[data-home-destination="write"]:visible');
      assert.equal(await write.count(), 1, 'One visible writing destination');
      await write.focus(); await page.keyboard.press('Enter'); await mode(page, 'page');
      // The route changes before the asynchronous photo editor finishes mounting.
      await page.locator('#photoTitle').waitFor();
      await page.evaluate(() => __subviewReleaseToggle());
      assert.equal(await page.evaluate(() => __subviewToggleGate.released), true);
      await back(page, 'home');
      await page.waitForFunction(() => document.activeElement?.dataset.homeDestination === 'write');
      assert.equal(await page.locator('.home-library').evaluate(node => node.open), true, 'opening survives a native toggle delivered after leaving home');
      page.subviewDestination = 'import';
      await page.locator('[data-home-destination="import"]').focus();
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.homeDestination), 'import');
      await page.keyboard.press('Enter'); await mode(page, 'import');
      assert.equal(await page.locator('[data-subview-return]').getAttribute('aria-label'), '일정으로 돌아가기');
      await back(page, 'home');
      await page.waitForFunction(() => document.activeElement?.dataset.homeDestination === 'import');
      assert.deepEqual(await current(page), before);
    }, 1440);
    for (const width of [1440, 820, 390]) await check('search, tool and management origins and active menu roots ' + width, async ({ page }) => {
      await fixture(page, { many: true }); await nav(page, 'records'); await mode(page, 'sources');
      const before = await current(page);
      await page.locator('#lifeSearch').fill('산책');
      const resultIds = await page.locator('#lifeSearchResults .life-source-open').evaluateAll(nodes => nodes.map(node => node.dataset.versionId));
      await openRecordsMenu(page);
      await page.getByRole('button', { name: '선택 자료 페이지', exact: true }).click(); await mode(page, 'page');
      assert.equal(await heading(page).textContent(), '선택 자료 페이지'); await back(page, 'sources');
      assert.equal(await page.locator('#lifeSearch').inputValue(), '산책');
      assert.deepEqual(await page.locator('#lifeSearchResults .life-source-open').evaluateAll(nodes => nodes.map(node => node.dataset.versionId)), resultIds);
      await page.waitForFunction(() => document.activeElement?.textContent === '선택 자료 페이지');
      await page.getByRole('button', { name: '가져오기', exact: true }).click(); await mode(page, 'import');
      await nav(page, 'records'); await mode(page, 'sources'); assert.equal(await page.locator('#lifeSearch').inputValue(), '산책');
      await openRecordsMenu(page); await page.getByRole('button', { name: '다시 찾기', exact: true }).click(); await mode(page, 'discover');
      assert.equal(await heading(page).textContent(), '다시 찾기'); await back(page, 'sources');
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '다시 찾기');
      await page.getByRole('button', { name: '다시 찾기', exact: true }).click(); await mode(page, 'discover'); await nav(page, 'tools'); await mode(page, 'tools');
      await nav(page, 'manage');
      for (const [label, destination, title] of [['내보내기·사본 복원', 'transfer', '자료 백업·복원'], ['동기화', 'sync', '동기화'], ['자료·구성 백업', 'workbench-backup', '자료·구성 백업']]) {
        // File formats open from 설정 → 백업·복원 and return there (2026-11-01).
        const parent = destination === 'sync' ? 'manage' : 'backup';
        if (parent === 'backup') { await page.getByRole('button', { name: '백업·복원', exact: true }).click(); await mode(page, 'backup'); }
        await page.getByRole('button', { name: label, exact: true }).click(); await mode(page, destination);
        assert.equal(await heading(page).textContent(), title);
        if (destination === 'transfer') await capture(page, 'transfer', width);
        await back(page, parent); await page.waitForFunction(label => document.activeElement?.getAttribute('aria-label') === label, label);
        await page.getByRole('button', { name: label, exact: true }).click(); await mode(page, destination); await nav(page, 'manage'); await mode(page, 'manage');
      }
      assert.deepEqual(await current(page), before);
    }, width);
    await check('renamed home group and page editing return to the same entry', async ({ page }) => {
      const f = await fixture(page); const { groupId } = await seedComposition(page, f.refs); await home(page);
      await page.locator(`#homeGroups [data-group-id="${groupId}"]`).click(); await mode(page, 'activities');
      await page.getByRole('textbox', { name: '묶음 이름', exact: true }).fill('새 이름으로 다듬은 산책 묶음');
      await back(page, 'home');
      await page.waitForFunction(id => document.activeElement?.dataset.groupId === id, groupId, { timeout: 2000 });
      assert.match(await page.locator(`#homeGroups [data-group-id="${groupId}"]`).textContent(), /새 이름으로 다듬은 산책 묶음/);
      await page.locator('[data-home-destination="page"]').click(); await mode(page, 'page');
      await page.locator('#wbPageTitle').waitFor();
      await back(page, 'home');
      await page.waitForFunction(() => document.activeElement?.dataset.homeDestination === 'page');
    }, 390);
    await check('failed import save blocks both return paths and retry preserves input', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); await home(page); await page.locator('[data-home-destination="import"]').click(); await mode(page, 'import');
      await page.evaluate(() => { window.__homeFailStage = true; });
      await page.locator('#lifeImportText').fill('실패해도 남아야 할 입력');
      for (const control of [page.locator('[data-subview-return]'), page.locator('[data-haedo-navigation] [data-haedo-section="records"]')]) {
        const url = page.url(); await control.click(); await settle(page); assert.equal(page.url(), url); assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'import'); assert.equal(await page.locator('#lifeImportText').inputValue(), '실패해도 남아야 할 입력');
      }
      await page.evaluate(() => { window.__homeFailStage = false; });
      await page.getByRole('button', { name: '검토 내용 보관', exact: true }).click(); await settle(page); await back(page, 'home');
      await page.locator('[data-home-destination="import"]').click(); await mode(page, 'import'); assert.equal(await page.locator('#lifeImportText').inputValue(), '실패해도 남아야 할 입력');
    }, 390);
    await check('late home response cannot block navigation or steal focus after return', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); await home(page);
      await page.locator('[data-home-destination="import"]').click(); await mode(page, 'import');
      await page.evaluate(() => { window.__homeHoldRead = true; window.__homeReadEntered = false; });
      await back(page, 'home'); await page.waitForFunction(() => __homeReadEntered);
      await nav(page, 'tools'); await mode(page, 'tools');
      const focus = await page.evaluate(() => document.activeElement?.outerHTML);
      await page.evaluate(() => __homeReleaseRead());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'tools');
      assert.equal(await page.evaluate(() => document.activeElement?.outerHTML), focus);
    });
    await check('page save failure blocks active records menu and contextual return', async ({ page }) => {
      await page.goto(base + '/index.html?view=page'); await ready(page); await mode(page, 'page');
      if (!await page.locator('#wbPageIntro').isVisible()) await page.getByText('제목·소개·표시 설정', { exact: true }).click();
      const before = await current(page); await abortWorkbenchWrites(page, true);
      await page.locator('#wbPageIntro').fill('돌아가기 실패에도 보존할 소개');
      for (const control of [page.locator('[data-subview-return]'), page.locator('[data-haedo-navigation] [data-haedo-section="records"]')]) {
        const url = page.url(); await control.click(); await settle(page);
        assert.equal(page.url(), url); assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'page');
        assert.equal(await page.locator('#wbPageIntro').inputValue(), '돌아가기 실패에도 보존할 소개');
        assert.deepEqual(await current(page), before);
      }
      await abortWorkbenchWrites(page, false); await page.getByRole('button', { name: '다시 저장', exact: true }).click();
      await page.locator('#wbError').waitFor({ state: 'hidden' }); await back(page, 'sources');
      assert.equal((await current(page)).workbench.page.intro, '돌아가기 실패에도 보존할 소개');
    });
    await check('direct deep links have stable parent fallback and no persistent origin data', async ({ page }) => {
      for (const [view, title, parent] of [['import','가져오기','sources'], ['write','자료 작성','sources'], ['time','연표','tools'], ['annual-plan','연간 계획','tools'], ['activities','묶음','sources'], ['page','선택 자료 페이지','sources'], ['discover','다시 찾기','sources'], ['transfer','자료 백업·복원','backup'], ['sync','동기화','manage'], ['workbench-backup','자료·구성 백업','backup'], ['public-pages','공개 페이지 관리','manage']]) {
        await page.goto(base + '/index.html?view=' + view); await ready(page); await mode(page, view);
        const before = await current(page); assert.equal(await heading(page).textContent(), title); await back(page, parent); assert.deepEqual(await current(page), before);
      }
      // A reloaded plan subview returns to 일정's 계획, not to the list (review M2).
      await page.goto(base + '/index.html?section=schedule&view=annual-plan'); await ready(page); await mode(page, 'annual-plan');
      await page.reload(); await ready(page); await mode(page, 'annual-plan');
      assert.equal(await page.locator('[data-subview-return]').getAttribute('aria-label'), '계획으로 돌아가기');
      await back(page, 'tools');
      assert.equal(await page.locator('#lifeApp [data-schedule-view="tools"]').getAttribute('aria-current'), 'true');
      // 계획 → 연표 → 돌아가기 returns focus to the exact 연표 row.
      await page.getByRole('button', { name: '연표', exact: true }).click(); await mode(page, 'time');
      assert.equal(await page.locator('[data-subview-return]').getAttribute('aria-label'), '계획으로 돌아가기');
      await back(page, 'tools');
      await page.waitForFunction(() => document.activeElement?.dataset.focusKey === 'tools:time');
    });
    // History contract (2026-11-02): a screen change adds one history entry,
    // browser back/forward reopen the exact recorded screen, and a reload keeps
    // the blog editor/reader instead of opening the selected-material page.
    for (const width of [1440, 390]) await check('history: reload keeps the blog editor and reader ' + width, async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); await home(page);
      await page.locator('[data-home-destination="write"]:visible').click(); await mode(page, 'page'); await page.locator('#photoTitle').waitFor();
      await page.locator('#photoTitle').fill('새로고침 뒤에도 이어 쓸 글'); await page.locator('.ql-editor').fill('한글 본문은 다시 불러와도 같은 편집기에 남습니다.');
      const draft = await durablePhoto(page, '새로고침 뒤에도 이어 쓸 글');
      assert.equal(draft.status, 'draft');
      await page.reload(); await ready(page); await mode(page, 'page'); await page.locator('#photoTitle').waitFor();
      assert.equal(await heading(page).textContent(), '글쓰기');
      assert.equal(new URL(page.url()).searchParams.get('section'), null, 'The blog editor stays in home');
      // A never-saved new post reopens as the 글쓰기 screen (review minor 1); the section frame stays 일정.
      assert.equal(await page.locator('[data-haedo-navigation] [data-haedo-compose]').getAttribute('aria-current'), 'page');
      assert.equal(await page.evaluate(() => document.body.dataset.haedoSection), 'schedule');
      assert.equal(await page.locator('#photoTitle').inputValue(), '새로고침 뒤에도 이어 쓸 글');
      assert.equal((await page.locator('.ql-editor').innerText()).trim(), '한글 본문은 다시 불러와도 같은 편집기에 남습니다.');
      assert.equal((await photoPosts(page)).length, 1, 'Reload reopens the same draft instead of adding a copy');
      await page.getByRole('button', { name: '글 저장', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#lifeApp .haedo-page-heading h1')?.textContent === '글 읽기');
      const saved = await durablePhoto(page, '새로고침 뒤에도 이어 쓸 글', 'saved');
      await page.reload(); await ready(page); await mode(page, 'page');
      await page.waitForFunction(() => document.querySelector('#lifeApp .haedo-page-heading h1')?.textContent === '글 읽기');
      assert.equal(new URL(page.url()).searchParams.get('section'), null);
      assert.match(await page.locator('#lifeMain').innerText(), /새로고침 뒤에도 이어 쓸 글/);
      assert.deepEqual((await photoPosts(page)).map(post => [post.id, post.status]), [[saved.id, 'saved']]);
      await back(page, 'home');
    }, width);
    for (const width of [1440, 390]) await check('history: browser back returns to the previous app screen ' + width, async ({ page }) => {
      await page.goto(base + '/index.html?section=records'); await ready(page); await mode(page, 'sources');
      await nav(page, 'home'); await mode(page, 'home'); await openLibrary(page);
      await page.locator('[data-home-destination="write"]:visible').click(); await mode(page, 'page'); await page.locator('#photoTitle').waitFor();
      await page.locator('#photoTitle').fill('뒤로 가기로 닫을 글'); await page.locator('.ql-editor').fill('뒤로 가도 초안은 남습니다.');
      await page.goBack(); await mode(page, 'home');
      assert.equal(new URL(page.url()).searchParams.get('section'), null);
      assert.equal((await durablePhoto(page, '뒤로 가기로 닫을 글')).status, 'draft');
      await page.goForward(); await mode(page, 'page'); await page.locator('#photoTitle').waitFor();
      assert.equal(await page.locator('#photoTitle').inputValue(), '뒤로 가기로 닫을 글');
      await page.goBack(); await mode(page, 'home');
      await page.goBack(); await mode(page, 'sources');
      // Parent lists stay between their subviews and the app's previous screen.
      await nav(page, 'manage'); await mode(page, 'manage');
      await page.getByRole('button', { name: '백업·복원', exact: true }).click(); await mode(page, 'backup');
      await page.goBack(); await mode(page, 'manage');
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '백업·복원' || document.activeElement?.textContent?.includes('백업·복원'));
      // 2026-11-02: the plan is 일정's second view, so it is two screens away from 설정.
      await nav(page, 'home'); await mode(page, 'home');
      await page.locator('[data-schedule-view="tools"]').click(); await mode(page, 'tools');
      await page.getByRole('button', { name: /^연간 계획/ }).first().click(); await mode(page, 'annual-plan');
      await page.goBack(); await mode(page, 'tools');
      await page.goBack(); await mode(page, 'home');
      await page.goBack(); await mode(page, 'manage');
    }, width);
    await check('history: back keeps the exact reader version, search and position', async ({ page }) => {
      const f = await fixture(page); await nav(page, 'records'); await mode(page, 'sources');
      await page.locator('#lifeSearch').fill('산책');
      await page.locator('#lifeSearchResults .life-source-open', { hasText: '전시를 보고 돌아오는 길' }).first().click(); await mode(page, 'source');
      const older = f.refs[0].versionId;
      await page.locator('#lifeVersion').selectOption(older); await settle(page);
      await page.waitForFunction(id => document.querySelector('#lifeVersion')?.value === id, older);
      await page.goBack(); await mode(page, 'sources');
      assert.equal(await page.locator('#lifeSearch').inputValue(), '산책');
      await page.goForward(); await mode(page, 'source');
      assert.equal(await page.locator('#lifeVersion').inputValue(), older, 'Forward reopens the exact version that was read');
      await nav(page, 'home'); await mode(page, 'home');
      await page.goBack(); await mode(page, 'source');
      assert.equal(await page.locator('#lifeVersion').inputValue(), older, 'Back reopens the exact version that was read');
    }, 1440);
    for (const width of [1440, 390]) await check('history: unsaved input and Korean composition keep the screen on back ' + width, async ({ page }) => {
      await page.goto(base + '/index.html?section=records'); await ready(page); await mode(page, 'sources');
      await nav(page, 'home'); await mode(page, 'home'); await openLibrary(page);
      await page.locator('[data-home-destination="import"]').click(); await mode(page, 'import');
      const importUrl = page.url(), importEntry = await historyRecord(page);
      await page.evaluate(() => { window.__homeFailStage = true; });
      await page.locator('#lifeImportText').fill('뒤로 가기 실패에도 남길 입력');
      await page.goBack(); await settle(page);
      await page.waitForFunction(url => location.href === url, importUrl);
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'import');
      assert.equal(await page.locator('#lifeImportText').inputValue(), '뒤로 가기 실패에도 남길 입력');
      assert.match(await page.locator('#lifeApp .life-error').textContent(), /초안 저장 실패/, 'The refused move keeps its failure message');
      // Two presses in one task while the save keeps failing: the browser ends
      // on the entry of the screen that is still shown, not further back.
      await page.evaluate(() => { history.back(); history.back(); });
      await page.waitForFunction(key => history.state?.haedo?.key === key && !document.querySelector('.life-app[aria-busy="true"]'), importEntry.key);
      await page.waitForTimeout(300); // let any further traversal land before re-checking
      assert.equal((await historyRecord(page)).key, importEntry.key);
      assert.equal(page.url(), importUrl);
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'import');
      assert.equal(await page.locator('#lifeImportText').inputValue(), '뒤로 가기 실패에도 남길 입력');
      // A failed review save is retried explicitly, as for the in-app return.
      await page.evaluate(() => { window.__homeFailStage = false; });
      await page.getByRole('button', { name: '검토 내용 보관', exact: true }).click(); await settle(page);
      await page.goBack(); await mode(page, 'home'); await openLibrary(page);
      await page.locator('[data-home-destination="write"]:visible').click(); await mode(page, 'page'); await page.locator('#photoTitle').waitFor();
      const writeUrl = page.url();
      const title = page.locator('#photoTitle');
      await title.evaluate(node => { window.__historyComposing = node; node.focus(); node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '한' })); node.value = '조합 중인 한'; node.dispatchEvent(new InputEvent('input', { bubbles: true, data: '한', inputType: 'insertCompositionText', isComposing: true })); });
      await page.goBack(); await settle(page);
      await page.waitForFunction(url => location.href === url, writeUrl);
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'page');
      assert.equal(await title.evaluate(node => node === window.__historyComposing), true, 'The composing input is not rebuilt');
      assert.equal(await title.inputValue(), '조합 중인 한');
      await title.evaluate(node => { node.value = '조합 중인 한글'; node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '글' })); node.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.goBack(); await mode(page, 'home');
      assert.equal((await durablePhoto(page, '조합 중인 한글')).status, 'draft');
    }, width);
    for (const width of [1440, 390]) await check('history: material writing returns to the exact reader ' + width, async ({ page }) => {
      const f = await fixture(page); await nav(page, 'records'); await mode(page, 'sources');
      await page.locator('#lifeSearchResults .life-source-open, .life-source-open', { hasText: '전시를 보고 돌아오는 길' }).first().click(); await mode(page, 'source');
      const older = f.refs[0].versionId;
      await page.locator('#lifeVersion').selectOption(older); await settle(page);
      await page.waitForFunction(id => document.querySelector('#lifeVersion')?.value === id, older);
      await page.locator('#lifeSourceMaterialWriting').click(); await mode(page, 'page'); await materialReady(page);
      await page.locator('#mwTitle').fill('읽던 자료로 돌아갈 준비');
      await page.locator('#mwClose').click(); await mode(page, 'source');
      assert.equal(await page.locator('#lifeVersion').inputValue(), older, '돌아가기 returns to the exact version');
      await page.waitForFunction(() => document.activeElement?.id === 'lifeSourceMaterialWriting');
      // Reopening resumes the same preparation; browser back also returns to the reader.
      await page.locator('#lifeSourceMaterialWriting').click(); await mode(page, 'page'); await materialReady(page);
      assert.equal(await page.locator('#mwTitle').inputValue(), '읽던 자료로 돌아갈 준비');
      await page.goBack(); await mode(page, 'source');
      assert.equal(await page.locator('#lifeVersion').inputValue(), older);
      // The heading return keeps its existing destination: the reader's origin list.
      await page.locator('#lifeSourceMaterialWriting').click(); await mode(page, 'page'); await materialReady(page);
      assert.equal(await page.locator('[data-subview-return]').getAttribute('aria-label'), '자료로 돌아가기');
      await page.locator('[data-subview-return]').click(); await mode(page, 'sources');
    }, width);
    await check('history: back pressed during a move is refused and positions stay exact', async ({ page }) => {
      const f = await fixture(page); await nav(page, 'records'); await mode(page, 'sources');
      const list = await historyRecord(page);
      await page.locator('.life-source-open', { hasText: '전시를 보고 돌아오는 길' }).first().click(); await mode(page, 'source');
      const older = f.refs[0].versionId;
      await page.locator('#lifeVersion').selectOption(older); await settle(page);
      await page.waitForFunction(id => document.querySelector('#lifeVersion')?.value === id, older);
      const reader = await historyRecord(page);
      // Click and browser back in the same task: the move finishes, the back press is undone.
      // Retry only when another action made the app ignore the click itself.
      let pressed = false;
      for (let attempt = 0; attempt < 5 && !pressed; attempt++) {
        await settle(page);
        pressed = await page.evaluate(() => {
          document.querySelector('#lifeSourceMaterialWriting').click();
          if (document.querySelector('.life-app')?.getAttribute('aria-busy') !== 'true') return false;
          history.back(); return true;
        });
      }
      assert.equal(pressed, true, 'The move started before the back press');
      // The shown screen always matches its entry. A back press that arrives
      // during the move is undone (writing stays); one the browser applies after
      // the move was recorded opens the list, with reader and writing ahead of it.
      await settle(page);
      await page.waitForFunction(() => { const shown = document.querySelector('#lifeMain')?.dataset.mode, entry = history.state?.haedo?.entry?.mode;
        return !document.querySelector('.life-app[aria-busy="true"]') && ['page', 'sources'].includes(shown) && shown === entry; });
      if (await page.locator('#lifeMain').getAttribute('data-mode') === 'sources') {
        assert.equal((await historyRecord(page)).key, list.key);
        await page.goForward(); await mode(page, 'source');
        assert.equal((await historyRecord(page)).key, reader.key);
        assert.equal(await page.locator('#lifeVersion').inputValue(), older);
        await page.goForward();
      }
      await mode(page, 'page'); await materialReady(page);
      await page.waitForFunction(idx => history.state?.haedo?.idx === idx + 1, reader.idx);
      assert.equal(new URL(page.url()).searchParams.get('view'), 'page');
      // A refused back during Korean composition returns to exactly this entry.
      const writing = await historyRecord(page);
      const title = page.locator('#mwTitle');
      await title.evaluate(node => { window.__historyComposing = node; node.focus(); node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '한' })); node.value = '조합 중인 한'; node.dispatchEvent(new InputEvent('input', { bubbles: true, data: '한', inputType: 'insertCompositionText', isComposing: true })); });
      await page.goBack(); await settle(page);
      await page.waitForFunction(key => history.state?.haedo?.key === key, writing.key);
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'page');
      assert.equal(await title.evaluate(node => node === window.__historyComposing), true);
      assert.equal(await title.inputValue(), '조합 중인 한');
      await title.evaluate(node => { node.value = '조합 중인 한글'; node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '글' })); node.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.goBack(); await mode(page, 'source');
      assert.equal((await historyRecord(page)).key, reader.key, 'Back reaches the reader, not an entry before it');
      assert.equal(await page.locator('#lifeVersion').inputValue(), older);
      await page.goBack(); await mode(page, 'sources');
      assert.equal((await historyRecord(page)).key, list.key);
    }, 1440);
    await check('history: state holds identifiers only, never titles, bodies or search text', async ({ page, context }) => {
      await context.addInitScript(() => {
        window.__historyWrites = [];
        for (const name of ['pushState', 'replaceState']) {
          const original = History.prototype[name];
          History.prototype[name] = function (data, unused, url) { window.__historyWrites.push(JSON.stringify(data)); return original.call(this, data, unused, url); };
        }
      });
      const f = await fixture(page);
      await home(page);
      await page.locator('[data-home-destination="write"]:visible').click(); await mode(page, 'page'); await page.locator('#photoTitle').waitFor();
      await page.locator('#photoTitle').fill('이력비공개제목'); await page.locator('.ql-editor').fill('이력비공개본문 문장');
      await page.getByRole('button', { name: '글 저장', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#lifeApp .haedo-page-heading h1')?.textContent === '글 읽기');
      await back(page, 'home');
      await page.locator('[aria-controls="homeSearchPanel"]').click(); await page.locator('#homePostSearch').fill('이력비공개'); await settle(page);
      await page.locator('#lifeMain').getByText('이력비공개제목').first().click(); await mode(page, 'page'); await postReady(page);
      await page.goBack(); await mode(page, 'home');
      await nav(page, 'records'); if (await page.locator('#lifeMain').getAttribute('data-mode') !== 'sources') await nav(page, 'records');
      await mode(page, 'sources');
      await page.locator('#lifeSearch').fill('산책과 공간');
      await page.locator('#lifeSearchResults .life-source-open').first().click(); await mode(page, 'source');
      await page.goBack(); await mode(page, 'sources');
      const writes = await page.evaluate(() => window.__historyWrites.join('\n'));
      assert(writes.includes('"haedo"'), 'history entries were written');
      for (const secret of ['이력비공개제목', '이력비공개본문', '이력비공개', '산책과 공간', f.refs[0].title.slice(0, 12), 'instagram.com', 'blog.naver.com'])
        assert.equal(writes.includes(secret), false, 'history.state must not contain ' + secret);
    }, 1440);
    await check('history: a blog task never follows the records tab', async ({ page }) => {
      await fixture(page); await nav(page, 'records'); await mode(page, 'sources');
      await openRecordsMenu(page); await page.getByRole('button', { name: '선택 자료 페이지', exact: true }).click(); await mode(page, 'page');
      await nav(page, 'home'); await mode(page, 'home'); await openLibrary(page);
      await page.locator('[data-home-destination="write"]:visible').click(); await mode(page, 'page'); await page.locator('#photoTitle').waitFor();
      await page.locator('#photoTitle').fill('자료실 탭 확인용 글');
      await nav(page, 'records'); await mode(page, 'page');
      assert.equal(await heading(page).textContent(), '선택 자료 페이지');
      assert.equal(await page.locator('#photoTitle').isVisible(), false);
      const url = new URL(page.url()); assert.equal(url.searchParams.get('section'), 'records'); assert.equal(url.searchParams.get('blog'), null);
      await page.goBack(); await mode(page, 'page'); await page.locator('#photoTitle').waitFor();
      assert.equal(await page.locator('#photoTitle').inputValue(), '자료실 탭 확인용 글');
    }, 1440);
    await check('history: in-app return to the previous entry does not stack the closed screen', async ({ page }) => {
      await page.goto(base + '/index.html?section=records'); await ready(page); await mode(page, 'sources');
      await nav(page, 'home'); await mode(page, 'home'); await openLibrary(page);
      const homeEntry = await historyRecord(page);
      await page.locator('[data-home-destination="import"]').click(); await mode(page, 'import');
      await back(page, 'home');
      await page.waitForFunction(key => history.state?.haedo?.key === key, homeEntry.key);
      await page.goBack(); await mode(page, 'sources');
      await page.goForward(); await mode(page, 'home');
      await page.goForward(); await mode(page, 'import');
    }, 390);
    await check('history: back while a post is only loading opens the previous screen and drops the late read', async ({ page, context }) => {
      await holdStorage(context);
      await page.goto(base + '/index.html'); await ready(page); await home(page);
      await page.locator('[data-home-destination="write"]:visible').click(); await mode(page, 'page'); await page.locator('#photoTitle').waitFor();
      await page.locator('#photoTitle').fill('늦게 열리는 글'); await page.locator('.ql-editor').fill('읽는 중에 뒤로 가도 됩니다.');
      await page.getByRole('button', { name: '글 저장', exact: true }).click(); await postReady(page);
      await back(page, 'home');
      const homeEntry = await historyRecord(page);
      await page.evaluate(() => { window.__holdPostRead = true; });
      await page.locator('#lifeMain').getByText('늦게 열리는 글').first().click(); await mode(page, 'page');
      await page.waitForFunction(() => window.__holdPostReadHeld === true);
      // The held read must be the reader's own open(): its post is not drawn yet. (A background
      // reader such as BlogSync catching the hold would leave this check testing only the idle path.)
      assert.equal(await page.locator('.photo-article').count(), 0, 'The held read is the open of the post, not another reader');
      // Nothing of the user's is at stake while the post is read: the move is allowed.
      await page.goBack(); await mode(page, 'home');
      assert.equal((await historyRecord(page)).key, homeEntry.key);
      await page.evaluate(() => window.__holdPostReadRelease());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await settle(page);
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'home');
      assert.equal(await page.locator('.photo-article').count(), 0, 'The late read does not draw the post over home');
      assert.equal(await page.locator('#lifeApp .life-error:not([hidden])').count(), 0);
      assert.equal((await historyRecord(page)).key, homeEntry.key);
      await page.goForward(); await mode(page, 'page'); await postReady(page);
      assert.match(await page.locator('.photo-article').innerText(), /늦게 열리는 글/);
    }, 390);
    await check('history: back while preparation sources only load returns to the reader; input still refuses', async ({ page, context }) => {
      await holdStorage(context);
      const f = await fixture(page); await nav(page, 'records'); await mode(page, 'sources');
      await page.locator('.life-source-open', { hasText: '전시를 보고 돌아오는 길' }).first().click(); await mode(page, 'source');
      const older = f.refs[0].versionId;
      await page.locator('#lifeVersion').selectOption(older); await settle(page);
      await page.waitForFunction(id => document.querySelector('#lifeVersion')?.value === id, older);
      const reader = await historyRecord(page);
      await page.evaluate(() => { window.__holdBundleRead = true; });
      await page.locator('#lifeSourceMaterialWriting').click(); await mode(page, 'page'); await page.locator('#mwTitle').waitFor();
      await page.waitForFunction(() => window.__holdBundleReadHeld === true);
      assert.equal(await page.locator('.mw-material').count(), 0, 'Sources are still loading');
      await page.goBack(); await mode(page, 'source');
      assert.equal((await historyRecord(page)).key, reader.key);
      assert.equal(await page.locator('#lifeVersion').inputValue(), older);
      await page.evaluate(() => window.__holdBundleReadRelease());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await settle(page);
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'source');
      assert.equal(await page.locator('.mw-material').count(), 0, 'The late source list does not draw over the reader');
      assert.equal(await page.locator('#lifeApp .life-error:not([hidden]), .mw-error:not([hidden])').count(), 0);
      // While loading, Korean composition is still input at stake: back is refused.
      await page.evaluate(() => { window.__holdBundleReadHeld = false; window.__holdBundleRead = true; });
      await page.locator('#lifeSourceMaterialWriting').click(); await mode(page, 'page'); await page.locator('#mwTitle').waitFor();
      await page.waitForFunction(() => window.__holdBundleReadHeld === true);
      const writing = await historyRecord(page), title = page.locator('#mwTitle');
      await title.evaluate(node => { window.__historyComposing = node; node.focus(); node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '한' })); node.value = '불러오는 중 조합 한'; node.dispatchEvent(new InputEvent('input', { bubbles: true, data: '한', inputType: 'insertCompositionText', isComposing: true })); });
      await page.goBack(); await settle(page);
      await page.waitForFunction(key => history.state?.haedo?.key === key, writing.key);
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'page');
      assert.equal(await title.evaluate(node => node === window.__historyComposing), true);
      assert.equal(await title.inputValue(), '불러오는 중 조합 한');
      await page.evaluate(() => window.__holdBundleReadRelease());
      await title.evaluate(node => { node.value = '불러오는 중 조합 한글'; node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '글' })); node.dispatchEvent(new Event('input', { bubbles: true })); });
      await materialReady(page);
      await page.goBack(); await mode(page, 'source');
      assert.equal((await historyRecord(page)).key, reader.key);
    }, 390);
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []);
  } finally { await browser.close(); await fs.writeFile(path.join(out, process.env.SUBVIEW_TEST_MATCH ? 'recheck-report.json' : 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify({ passed: report.checks.filter(x => x.pass).length, total: report.checks.length, visual: report.visual.length, console: report.consoleErrors.length, page: report.pageErrors.length }));
  if (report.checks.some(x => !x.pass) || report.consoleErrors.length || report.pageErrors.length) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

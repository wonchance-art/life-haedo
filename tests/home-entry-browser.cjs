/* Personal home + unified records: actual app, bundled SDK and IndexedDB.
 * BASE_URL=http://127.0.0.1:4184 node tests/home-entry-browser.cjs
 * Isolated anonymous Auth fixtures only; no production DB/SNS or Apple hardware. */
'use strict';
const { awaitCondition } = require('./helpers/await-condition.cjs');
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { openRecordsMenu } = require('./helpers/feature-menus.cjs');
const { FakeCloud, accounts, cloud, base, openAccount } = require('./life-sync-browser.cjs');
const { playwright, ready, settle, makeContext, observe, nav } = require('./unified-home-browser.cjs');
const { fixture, current, seedComposition, oldBody, newBody } = require('./life-workbench-browser.cjs');
const out = process.env.ENTRY_OUT_DIR ? path.resolve(process.env.ENTRY_OUT_DIR) : path.resolve(__dirname, '../.local/home-entry');
const report = { createdAt: new Date().toISOString(), scope: 'Actual local app/SDK/IDB, synthetic HTTP Auth; viewport simulation, not Apple device testing', checks: [], visual: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [] };

// Inject read/save failures at the storage boundary; successful calls use real IndexedDB.
// A captured successful read can arrive late, like a slow device read already in flight.
async function instrumentStorage(context) {
  await context.route(`${base}/assets/life/storage.js`, async route => {
    const response = await route.fetch(), source = await response.text();
    const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,async saveStage(...saveArgs){if(window.__homeFailStage)throw new Error('익명 검사: 초안 저장 실패');return actual.saveStage(...saveArgs);},async readWorkbench(...readArgs){window.__homeReadCount=(window.__homeReadCount||0)+1;if(window.__homeFailRead)throw Object.assign(new Error('익명 검사에서 구성 읽기를 중단했습니다.'),{code:'home_fixture_read'});const result=await actual.readWorkbench(...readArgs);if(window.__homeHoldRead){window.__homeReadEntered=true;window.__homeHeldWorkspace=readArgs[0];await new Promise(resolve=>{window.__homeReleaseRead=()=>{window.__homeHoldRead=false;resolve();};});}window.__homeReadFinished=(window.__homeReadFinished||0)+1;return result;}});}});})();`;
    await route.fulfill({ response, body: source + hook });
  });
  await context.addInitScript(() => {
    window.__homeWrites = [];
    for (const method of ['put', 'add', 'delete', 'clear']) {
      const actual = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (...args) {
        if (window.__homeObserveWrites) __homeWrites.push({ store: this.name, method });
        return actual.apply(this, args);
      };
    }
  });
}

// 2026-11-08 일정 통합 정리 S3: 일정's list is posts only. Its former 자료 block (가져오기, 자료 목록,
// 컬렉션, 선택 자료 페이지, 최근 기록, 묶음, 책) is reached from the global 자료, as below.
async function preview(page) {
  const menu = await openRecordsMenu(page); await menu.getByRole('button', { name: '선택 자료 페이지', exact: true }).click();
  const toggle = page.locator('#wbPagePreview'); await toggle.waitFor();
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
  await page.locator('#wbVisitor').waitFor();
}
async function openImport(page) {
  await nav(page, 'records');
  if (await page.locator('#lifeMain').getAttribute('data-mode') !== 'import') await page.getByRole('button', { name: '가져오기', exact: true }).click();
  await page.locator('#lifeMain[data-mode="import"]').waitFor(); await settle(page);
}
async function recordWrite(page) { await openRecordsMenu(page); await page.getByRole('button', { name: '자료 작성', exact: true }).click(); await settle(page); }
async function recordActions(page) {
  const selection = await page.locator('#lifeSelectionToggle').getAttribute('aria-label');
  const menu = await openRecordsMenu(page);
  const destinations = await menu.locator('section[aria-label="모아 보기"] button').allTextContents();
  await menu.locator(':scope > summary').click();
  return [selection, ...destinations];
}
async function home(page) {
  if (!await page.locator('[data-haedo-navigation] a[data-haedo-section="schedule"]').isVisible()) {
    if (await page.locator('.photo-editor').isVisible()) await page.getByRole('button', { name: '닫기', exact: true }).click();
    else await page.locator('[data-subview-return]').click();
    await settle(page);
  }
  await nav(page, 'home');
  await page.locator('.life-home').waitFor();
  await page.waitForFunction(() => document.querySelector('#homeComposition')?.getAttribute('aria-busy') === 'false');
  if (await page.locator('#homeTab-posts').getAttribute('aria-selected') !== 'true') await page.locator('#homeTab-posts').click();
}
async function freshHome(page) { await page.goto(base + '/index.html'); await ready(page); await page.locator('.life-home').waitFor(); await page.waitForFunction(() => document.querySelector('#homeComposition')?.getAttribute('aria-busy') === 'false'); }
async function setPage(page, edit) {
  return page.evaluate(async source => {
    const storage = HaedoLife.Shell.storage, id = await storage.getActive(), w = await storage.readWorkbench(id);
    const change = new Function('w', 'c', source); change(w, HaedoLife.Core);
    await storage.saveWorkbench(id, w, w.revision);
  }, edit);
}

function inspectHome(selector = '.life-home') {
  const root = document.querySelector(selector);
  const visible = el => el.checkVisibility({ checkVisibilityCSS: true }) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && !el.closest('[hidden],.life-sr-only,.life-skip,.sr-only');
  const describe = el => ({ tag: el.tagName.toLowerCase(), id: el.id, name: (el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.textContent || '').trim().slice(0, 80) });
  const controls = [...root.querySelectorAll('button,a[href],input,textarea,select,summary'), ...document.querySelectorAll('[data-haedo-navigation] a')].filter(visible);
  const targetRect = el => {
    const input = el.getBoundingClientRect();
    if (!el.matches('input[type=checkbox],input[type=radio]')) return input;
    const label = [...(el.labels || [])].filter(visible).map(node => node.getBoundingClientRect()).find(rect => rect.width >= input.width && rect.height >= input.height);
    return label || input;
  };
  const overflow = [...root.querySelectorAll('*')].filter(visible).filter(el => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; }).map(describe);
  const rgba = value => { const m = value.match(/^rgba?\(([^)]+)\)$/); if (!m) return null; const a = m[1].split(/[, /]+/).map(Number); return [a[0], a[1], a[2], a[3] ?? 1]; };
  const over = (a, b) => a.slice(0, 3).map((v, i) => v * a[3] + b[i] * (1 - a[3])).concat(1);
  const background = el => { const chain = []; for (let p = el; p; p = p.parentElement) chain.unshift(p); return chain.reduce((b, p) => over(rgba(getComputedStyle(p).backgroundColor) || [0, 0, 0, 0], b), [255, 255, 255, 1]); };
  const luminance = color => color.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const texts = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode, el = n.parentElement;
    if (!n.textContent.trim() || !visible(el)) continue;
    const css = getComputedStyle(el), fg = rgba(css.color), bg = background(el); if (!fg) continue;
    const ls = [luminance(over(fg, bg)), luminance(bg)].sort((a, b) => b - a);
    const large = parseFloat(css.fontSize) >= 24 || (parseFloat(css.fontSize) >= 18.66 && parseInt(css.fontWeight) >= 700);
    texts.push({ ...describe(el), ratio: +( (ls[0] + .05) / (ls[1] + .05) ).toFixed(3), required: large ? 3 : 4.5 });
  }
  return { width: innerWidth, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1, overflow, smallTargets: controls.map(el => { const r = targetRect(el); return { ...describe(el), width: r.width, height: r.height }; }).filter(r => r.width < 43.9 || r.height < 43.9), unnamed: controls.filter(el => !describe(el).name).map(describe), minTextContrast: Math.min(...texts.map(t => t.ratio)), measuredTexts: texts.length, contrastFailures: texts.filter(t => t.ratio < t.required), font: getComputedStyle(root).fontFamily };
}
async function snapshot(page, scene, size, selector = '.life-home') {
  await page.evaluate(() => document.fonts.ready); await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.mouse.move(size.width - 1, 0);
  const metrics = await page.evaluate(inspectHome, selector), file = `${scene}-${size.width}.png`;
  await page.screenshot({ path: path.join(out, file), fullPage: !scene.startsWith('records') }); report.visual.push({ scene, file, ...metrics });
  assert(!metrics.horizontalOverflow && !metrics.overflow.length, `${scene}/${size.width} overflow ${JSON.stringify(metrics.overflow)}`);
  assert.deepEqual(metrics.smallTargets, [], `${scene}/${size.width} target below 44px`);
  assert.deepEqual(metrics.unnamed, [], `${scene}/${size.width} unnamed control`);
  assert.deepEqual(metrics.contrastFailures, [], `${scene}/${size.width} text contrast`);
}

async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] }); report.browser = browser.version();
  async function check(name, run, options = {}) {
    if (process.env.ENTRY_TEST_MATCH && !new RegExp(process.env.ENTRY_TEST_MATCH).test(name)) return;
    const server = new FakeCloud(), device = 'entry-' + report.checks.length, context = await makeContext(browser, server, device, accounts.a, options), page = await context.newPage();
    page.setDefaultTimeout(10000); observe(page, report, name); await instrumentStorage(context);
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push({ origin: url.origin, path: url.pathname }); return route.abort('blockedbyclient'); });
    try { await run({ page, context, server, device }); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(out, `failure-${report.checks.length}.png`), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    await check('index starts at home, legacy life stays records, and quick links enter working sections', async ({ page }) => {
      await freshHome(page);
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'home');
      assert.equal(await page.locator('[data-haedo-navigation] a[data-haedo-section]').count(), 4); // 2026-11-02: 뉴스·일정·자료·설정
      assert.equal(await page.locator('[data-haedo-navigation] .haedo-brand').getAttribute('href'), 'index.html');
      assert.equal(await page.locator('a[data-haedo-section="schedule"]').getAttribute('aria-current'), 'page');
      assert.equal(await page.locator('#homeFirstWrite').isVisible(), true);
      // 2026-11-08 S3: no 자료 block or second write button in the list; 가져오기 is 자료's, 글쓰기 the global one.
      assert.equal(await page.locator('#lifeHome .home-library, #lifeHome [data-home-destination="import"], #lifeHome [data-home-destination="sources"], .home-blog-write').count(), 0);
      await openImport(page); await home(page);
      await page.locator('#homeFirstWrite').click(); await page.locator('#lifeMain[data-mode="page"]').waitFor(); await home(page);
      await page.goto(base + '/life.html'); await ready(page);
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'sources');
      assert.equal(await page.locator('a[data-haedo-section="records"]').getAttribute('aria-current'), 'page');
      assert.equal(await page.locator('.life-record-sections').count(), 0);
      assert.deepEqual(await recordActions(page), ['기록 선택', '컬렉션', '묶음', '선택 자료 페이지']);
      assert.equal(await page.locator('#lifeSelectionToggle').getAttribute('aria-label'), '기록 선택');
      for (const view of ['topics', 'sources', 'activities', 'page', 'import']) { // view=time opens workspace.html (S8)
        await page.goto(`${base}/life.html?view=${view}`); await ready(page);
        assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), view);
      }
    });
    await check('the list leaves recent originals, groups and the selected page to 자료 without changing stored data', async ({ page }) => {
      const f = await fixture(page, { many: true }); await seedComposition(page, f.refs);
      await setPage(page, `for(let i=2;i<=3;i++)w.groups.push({id:c.id(),title:'추가 묶음 '+i,versionIds:[]});`);
      const before = await current(page);
      await page.evaluate(() => { window.__homeObserveWrites = true; __homeWrites.length = 0; });
      await home(page);
      // 2026-11-08 S3: the former home blocks are not in 일정's list.
      assert.equal(await page.locator('#homeRecent, #homeGroups, #homeBooks, #homeReadingResume, .home-library').count(), 0);
      assert.equal(await page.locator('#homePage').count(), 0, 'Home must not duplicate the selected-content page');
      assert.deepEqual(await current(page), before); assert.deepEqual(await page.evaluate(() => __homeWrites), []);
      // 자료 lists the newest original first, exactly.
      await nav(page, 'records'); if (await page.locator('#lifeMain').getAttribute('data-mode') !== 'sources') await nav(page, 'records');
      const cards = page.locator('#lifeSearchResults .life-source-card');
      assert((await cards.count()) >= 3); assert.equal(await cards.first().getAttribute('data-version-id'), f.refs.at(-1).versionId);
      assert.deepEqual(await current(page), before); assert.deepEqual(await page.evaluate(() => __homeWrites), []);
      await preview(page);
      assert((await page.locator('#wbVisitor').textContent()).includes(oldBody.split('\r\n')[0]));
      assert(!(await page.locator('#wbVisitor').textContent()).includes(newBody.split('\r\n')[0]));
      assert.deepEqual(await current(page), before); assert.deepEqual(await page.evaluate(() => __homeWrites), []);
      // 묶음 opens from 자료's menu with every group.
      const menu = await openRecordsMenu(page); await menu.getByRole('button', { name: '묶음', exact: true }).click(); await settle(page);
      await page.locator(`article[data-group-id="${before.workbench.groups[0].id}"]`).waitFor();
      assert.equal(await page.locator('article[data-group-id]').count(), before.workbench.groups.length);
      assert.deepEqual(await current(page), before);
    });
    await check('home selected-content preview preserves visibility, pinned placement and fixed source versions', async ({ page }) => {
      const f = await fixture(page); await seedComposition(page, f.refs);
      await setPage(page, `w.page.intro='숨긴소개';w.page.showIntro=false;w.page.showRecent=false;const e=w.page.entries[0];e.showBody=false;e.showNote=false;e.note='숨긴코멘트';e.parts[1].enabled=false;w.page.entries.unshift({...structuredClone(e),id:c.id(),title:'숨긴항목',enabled:false});w.page.entries.push({...structuredClone(e),id:c.id(),title:'고정하지않은항목',pinned:false});`);
      await home(page); await preview(page); let text = await page.locator('#wbVisitor').textContent();
      for (const hidden of ['숨긴소개', '숨긴코멘트', '숨긴항목', '고정하지않은항목', oldBody.split('\r\n')[0], '전시에서 가장 오래 머문 빛', '혼자 남긴 질문']) assert(!text.includes(hidden), hidden);
      assert.equal(await page.locator('#wbVisitor .wb-page-entry').count(), 1);
      assert.equal(await page.locator('#wbVisitor .wb-page-part').getAttribute('data-version-id'), f.refs[0].versionId);
      await nav(page, 'tools');
      await setPage(page, `w.page.showIntro=true;const e=w.page.entries.find(e=>e.enabled&&e.pinned);e.showBody=true;e.showNote=true;`);
      await home(page); await preview(page); text = await page.locator('#wbVisitor').textContent();
      for (const visible of ['숨긴소개', '숨긴코멘트', oldBody.split('\r\n')[0]]) assert(text.includes(visible), visible);
      assert(!text.includes(newBody.split('\r\n')[0]));
      assert.equal(await page.locator('#wbPagePreview').getAttribute('aria-pressed'), 'true');
      assert(!(await page.locator('#wbVisitor').textContent()).includes('숨긴항목'));
      await page.getByRole('button', { name: '편집으로 돌아가기', exact: true }).click();
      await page.locator('#wbPagePreview').waitFor(); assert.equal(await page.locator('#wbPagePreview').getAttribute('aria-pressed'), 'false');
    });
    await check('a 자료 original reader returns to its exact control and records finds saved notes', async ({ page }) => {
      const f = await fixture(page); await seedComposition(page, f.refs); const before = await current(page); await home(page);
      await nav(page, 'records'); await settle(page);
      if (await page.locator('#lifeMain').getAttribute('data-mode') !== 'sources') await nav(page, 'records');
      const open = page.locator('#lifeSearchResults .life-source-card h3 .life-source-open').first();
      const expectedId = await open.locator('xpath=ancestor::*[@data-version-id][1]').getAttribute('data-version-id');
      const expectedText = before.bundle.sourceVersions.find(version => version.id === expectedId).contentText;
      const key = await open.getAttribute('data-focus-key'); await open.click(); await settle(page);
      assert.equal(await page.locator('#lifeSourceText').textContent(), expectedText);
      assert.equal(await page.locator('#lifeVersion').inputValue(), expectedId);
      await page.locator('#lifeSearchReturn').click(); await settle(page); await page.locator('#lifeMain[data-mode="sources"]').waitFor();
      await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, key);
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'sources');
      assert.equal(await page.locator('.life-record-sections').count(), 0);
      assert.deepEqual(await recordActions(page), ['기록 선택', '컬렉션', '묶음', '선택 자료 페이지']);
      assert.equal(await page.locator('#lifeSelectionToggle').getAttribute('aria-label'), '기록 선택');
      await page.locator('#lifeSearch').fill('원문 버전과 위치를 보존할 익명 발췌');
      const notes = page.locator('.life-record-notes .life-excerpt-card'); assert.equal(await notes.count(), 1);
      assert.equal(await notes.getAttribute('data-record-id'), before.bundle.records[0].id);
      const quote = notes.locator('.life-excerpt-open'); const quoteKey = await quote.getAttribute('data-focus-key'); await quote.click(); await settle(page);
      assert.equal(await page.locator('#lifeSourceText').textContent(), oldBody); await page.waitForFunction(() => getSelection().toString() === '보존할 구절🌱');
      await page.locator('#lifeSearchReturn').click(); await settle(page); assert.equal(await page.locator('#lifeSearch').inputValue(), '원문 버전과 위치를 보존할 익명 발췌');
      await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, quoteKey); assert.deepEqual(await current(page), before);
    });
    await check('late home composition keeps the always-shown search field, its focus and typed text', async ({ page }) => {
      const f = await fixture(page); await seedComposition(page, f.refs);
      const before = await current(page);
      await page.evaluate(() => { window.__homeHoldRead = true; window.__homeReadEntered = false; });
      await nav(page, 'home'); await page.waitForFunction(() => __homeReadEntered);
      assert.equal(await page.locator('#homeComposition').getAttribute('aria-busy'), 'true');
      // 2026-11-08 S3: from 761px the list search is a field in the tab row, usable before the list arrives.
      const field = page.locator('#homePostSearch'); assert.equal(await field.isVisible(), true);
      assert.equal(await page.locator('.home-search-toggle').isVisible(), false);
      await field.focus(); await page.keyboard.type('구절'); const handle = await field.elementHandle();
      assert.equal(await page.locator('#homePosts .home-load-error').count(), 0, 'typing before the first read is not a failed read');
      await page.evaluate(() => __homeReleaseRead());
      await page.waitForFunction(() => document.querySelector('#homeComposition')?.getAttribute('aria-busy') === 'false');
      assert.equal(await handle.evaluate(node => node.isConnected && document.activeElement === node), true, 'A slow composition read must keep the focused search field');
      assert.equal(await field.inputValue(), '구절');
      assert.equal(await page.locator('#homePosts .home-load-error').count(), 0);
      assert.deepEqual(await current(page), before);
    });
    await check('late home composition cannot replace a different section', async ({ page }) => {
      const f = await fixture(page); await seedComposition(page, f.refs);
      await page.evaluate(() => { window.__homeHoldRead = true; window.__homeReadEntered = false; });
      await nav(page, 'home'); await page.waitForFunction(() => __homeReadEntered);
      assert.equal(await page.locator('#homeComposition').getAttribute('aria-busy'), 'true');
      await nav(page, 'tools'); const completed = await page.evaluate(() => window.__homeReadFinished || 0);
      await page.evaluate(() => __homeReleaseRead()); await page.waitForFunction(n => __homeReadFinished > n, completed);
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'tools'); assert.equal(await page.locator('#lifeHome').count(), 0);
      assert.equal(await page.locator('a[data-haedo-section="schedule"]').getAttribute('aria-current'), 'page');
    });
    await check('late home composition cannot replace a newly selected workspace', async ({ page }) => {
      const f = await fixture(page); await seedComposition(page, f.refs); await setPage(page, `w.page.title='이전작업공간의페이지';`);
      const other = await page.evaluate(async active => { const s = HaedoLife.Shell.storage, created = await s.createWorkspace('다른 익명 작업공간'); await s.setActive(active); return created.workspaceId; }, f.workspaceId);
      await page.goto(base + '/index.html?section=records'); await ready(page);
      await page.evaluate(() => { window.__homeHoldRead = true; window.__homeReadEntered = false; });
      await nav(page, 'home'); await page.waitForFunction(() => __homeReadEntered);
      await nav(page, 'manage'); await page.getByRole('button', { name: '현재 자료공간', exact: true }).click();
      await page.locator('#lifeWorkspace').selectOption(other); await settle(page);
      await awaitCondition(page, id => HaedoLife.Shell.storage.getActive().then(active => active === id), other, { timeout: 10000, label: 'selected workspace becomes active' });
      const completed = await page.evaluate(() => window.__homeReadFinished || 0);
      await page.evaluate(() => __homeReleaseRead()); await page.waitForFunction(n => __homeReadFinished > n, completed);
      await home(page);
      assert(!(await page.locator('#lifeHome').textContent()).includes('이전작업공간의페이지'));
      assert.equal((await current(page)).bundle.workspaceId, other);
      assert.equal(await page.evaluate(async id => (await HaedoLife.Shell.storage.readWorkbench(id)).page.title, f.workspaceId), '이전작업공간의페이지');
    });
    await check('late home composition cannot reveal data after signout and another account login', async ({ page, server, device }) => {
      const f = await fixture(page); await seedComposition(page, f.refs);
      await setPage(page, `w.page.title='A전용개인페이지';`); const before = await current(page);
      await page.evaluate(() => { window.__homeHoldRead = true; window.__homeReadEntered = false; });
      await nav(page, 'home'); await page.waitForFunction(() => __homeReadEntered);
      await page.evaluate(() => { window.__homeSignout = HaedoAuth.client.auth.signOut({ scope: 'local' }); });
      await page.waitForFunction(() => document.querySelector('#lifeApp').hidden && !HaedoLife.Shell.storage);
      await page.evaluate(() => __homeReleaseRead());
      await page.waitForFunction(() => HaedoAuth.user === null); assert(!(await page.locator('body').innerText()).includes('A전용개인페이지'));
      server.oauthAccounts.set(device, accounts.b); await page.locator('[data-life-login]').click(); await page.locator('#googleLogin').click();
      await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page); await home(page);
      assert.equal((await current(page)).bundle.sources.length, 0); assert(!(await page.locator('body').innerText()).includes('A전용개인페이지'));
      assert.equal(await page.evaluate(async id => { try { await HaedoLife.Shell.storage.read(id); return false; } catch (_) { return true; } }, before.bundle.workspaceId), true);
    });
    await check('composition read failure keeps original records usable and retry recovers', async ({ page }) => {
      const f = await fixture(page); await seedComposition(page, f.refs); const before = await current(page);
      await page.evaluate(() => { window.__homeFailRead = true; }); await home(page);
      await page.locator('#homePosts .home-load-error').waitFor();
      assert.equal(await page.locator('#homePage').count(), 0);
      await page.evaluate(() => { window.__homeFailRead = false; }); await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
      await page.locator('#homeComposition[aria-busy="false"]').waitFor(); assert.deepEqual(await current(page), before);
      // 2026-11-08 S3: 글쓰기 is the global one (the list's own button is gone).
      await page.locator('[data-haedo-compose]:visible').focus();
      await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      assert(await page.evaluate(() => document.activeElement.matches('[data-haedo-compose]')));
      const focus = await page.evaluate(() => ({ visible: document.activeElement.matches(':focus-visible'), outline: getComputedStyle(document.activeElement).outlineWidth }));
      assert(focus.visible); assert(parseFloat(focus.outline) >= 3); await page.keyboard.press('Enter');
      await page.locator('#photoTitle').waitFor();
    });
    await check('records many notes, duplicate references and collapsed fourth quote keep exact return context at three widths', async ({ page }) => {
      const f = await fixture(page, { many: true });
      await page.evaluate(async ({ ref, raw }) => {
        const s = HaedoLife.Shell.storage, c = HaedoLife.Core; let b = await s.read(await s.getActive());
        const p = await c.prepareImport({ origin: 'other', title: '같은 문장을 함께 참조하는 다른 기록', text: raw, forceSeparate: true }, b);
        await s.commitLocal({ workspaceId: b.workspaceId, baseRevision: b.revision, operationId: c.id(), changes: c.buildImportChanges(b, p, []) }); b = await s.read(b.workspaceId);
        const record = structuredClone(b.records[0]); record.revision += 1; record.sourceRefs.push({ sourceId: p.source.id, sourceVersionId: p.version.id, locator: record.sourceRefs[0].locator });
        const records = [record];
        for (let i = 1; i <= 7; i++) { const text = ['작품 사이', '산책과 공간', '처음 받은 본문'][i % 3], start = raw.indexOf(text), now = new Date().toISOString(); records.push({ id: c.id(), kind: 'excerpt', text, topic: '긴 기록 다시 읽기', note: `여러 문장 안에서 찾을 익명 메모 ${i} — 책을 읽다가 떠오른 생각도 같은 기록 안에서 다시 찾아봅니다.`, sourceRefs: [{ sourceId: ref.sourceId, sourceVersionId: ref.versionId, locator: { start, end: start + text.length } }], provenance: { kind: 'user' }, revision: 1, createdAt: now, updatedAt: now }); }
        const result = await s.commitLocal({ workspaceId: b.workspaceId, baseRevision: b.revision, operationId: c.id(), changes: { put: { records } } }); if (result.status !== 'stored') throw new Error('Many-note fixture rejected');
      }, { ref: f.refs[0], raw: oldBody });
      await page.goto(base + '/index.html?section=records'); await ready(page); const before = await current(page);
      const source = page.locator(`.life-source-card[data-source-id="${f.refs[0].sourceId}"]`), more = source.locator('.life-record-more');
      assert.equal(await source.locator('.life-record-notes > .life-excerpt-card').count(), 3); assert.equal(await more.locator('.life-excerpt-card').count(), 5);
      await more.locator('summary').click(); const fourth = more.locator('.life-excerpt-open').first(), key = await fourth.getAttribute('data-focus-key'), recordId = await fourth.evaluate(el => el.closest('[data-record-id]').dataset.recordId), quote = before.bundle.records.find(record => record.id === recordId).text;
      await fourth.click(); await settle(page); assert.equal(await page.locator('#lifeSourceText').textContent(), oldBody); await page.waitForFunction(text => getSelection().toString() === text, quote);
      await page.locator('#lifeSearchReturn').click(); await settle(page); await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, key);
      assert.equal(await more.evaluate(el => el.open), true);
      assert.match(await source.locator('.life-record-notes').textContent(), /이전 버전에 저장한 문장/);
      for (const size of [{ width: 1440, height: 1000 }, { width: 820, height: 1000 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(size); await page.locator('#lifeSearch').fill(''); await snapshot(page, 'records-many', size, '#lifeMain');
        const duplicates = await page.evaluate(() => { const seen = new Set(), duplicates = []; document.querySelectorAll('[id]').forEach(el => { if (seen.has(el.id)) duplicates.push(el.id); seen.add(el.id); }); return duplicates; }); assert.deepEqual(duplicates, []);
        await page.locator('#lifeSearch').fill('여러 문장 안에서 찾을 익명 메모 7'); assert.equal(await page.locator('.life-source-card').count(), 1); assert.equal(await page.locator('.life-record-notes .life-excerpt-card').count(), 1); assert.equal(await page.locator('.life-source-card').getAttribute('data-version-id'), f.refs[0].versionId);
        await snapshot(page, 'records-note-search', size, '#lifeMain');
      }
      assert.deepEqual(await current(page), before);
    });
    for (const size of [{ width: 1440, height: 1000 }, { width: 820, height: 1000 }, { width: 390, height: 844 }]) await check('home shortcuts preserve drafts and reach timeline, tools and management ' + size.width, async ({ page }) => {
      await freshHome(page);
      // 2026-11-08 S3: 가져오기 is 자료's (the list keeps only its empty-state 첫 글 쓰기).
      assert.equal(await page.getByRole('button', { name: '자료 가져오기', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: '첫 글 쓰기', exact: true }).count(), 1);
      await nav(page, 'records'); await page.locator('#lifeMain[data-mode="sources"]').waitFor();
      const start = page.getByRole('button', { name: '가져오기', exact: true });
      if (size.width <= 820) await start.tap(); else { await start.focus(); await page.keyboard.press('Enter'); }
      await page.locator('#lifeMain[data-mode="import"]').waitFor();
      await page.locator('#lifeImportTitle').fill('옮겨 적는 중인 산책 기록');
      await page.locator('#lifeImportText').fill('아직 저장을 확정하지 않은 원문과 출처를 그대로 둡니다.');
      await home(page); await openImport(page);
      assert.equal(await page.locator('#lifeImportTitle').inputValue(), '옮겨 적는 중인 산책 기록');
      assert.equal(await page.locator('#lifeImportText').inputValue(), '아직 저장을 확정하지 않은 원문과 출처를 그대로 둡니다.');
      await home(page); await recordWrite(page);
      await page.locator('#lifeWritingTitle').fill('오늘 다시 생각한 일');
      await page.locator('#lifeWritingBody').fill('내가 쓰던 초안은 홈에 다녀와도 이어 쓸 수 있어야 한다.');
      await home(page); await recordWrite(page);
      assert.equal(await page.locator('#lifeWritingTitle').inputValue(), '오늘 다시 생각한 일');
      assert.equal(await page.locator('#lifeWritingBody').inputValue(), '내가 쓰던 초안은 홈에 다녀와도 이어 쓸 수 있어야 한다.');
      // 2026-11-08 S4·S8: Y's link line opens the 연표 목록 directly.
      await home(page); await nav(page, 'tools'); await page.locator('#lifeMain .schedule-plan-links').getByRole('link', { name: '연표', exact: true }).click();
      await page.waitForURL(url => url.pathname.endsWith('/workspace.html'));
      await page.locator('[data-haedo-navigation] a[data-haedo-section="schedule"]').click(); await ready(page);
      await page.locator('#homePosts[aria-busy="false"]').waitFor();
      await nav(page, 'tools'); assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'tools');
      await nav(page, 'manage'); assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'manage');
      await home(page);
      assert.equal((await current(page)).bundle.sources.length, 0, 'Opening areas must not commit an import or writing draft');
      await openImport(page);
      // A full document navigation starts a fresh capture. Resume explicitly,
      // rather than guessing which saved draft should replace the new input.
      if (size.width === 390) {
        await page.evaluate(() => { window.__homeFailStage = true; });
        await page.locator('#lifeImportTitle').fill('실패해도 남아야 할 두 번째 검토');
        await page.locator('#lifeImportText').fill('원래 검토를 열기 전에 이 입력도 보관합니다.');
        await page.getByRole('button', { name: '보관한 검토 이어서 열기', exact: true }).click(); await settle(page);
        assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'import');
        assert.equal(await page.locator('#lifeImportText').inputValue(), '원래 검토를 열기 전에 이 입력도 보관합니다.');
        await page.evaluate(() => { window.__homeFailStage = false; });
        await page.getByRole('button', { name: '검토 내용 보관', exact: true }).click(); await settle(page);
      }
      await page.getByRole('button', { name: '보관한 검토 이어서 열기', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#lifeImportDrafts')?.open === true);
      assert.equal(await page.locator('#lifeImportDrafts').evaluate(el => el.open), true);
      if (size.width === 390) assert.equal(await page.getByRole('button', { name: '실패해도 남아야 할 두 번째 검토', exact: true }).count(), 1);
      await page.getByRole('button', { name: '옮겨 적는 중인 산책 기록', exact: true }).click();
      assert.equal(await page.locator('#lifeImportTitle').inputValue(), '옮겨 적는 중인 산책 기록');
      await home(page); await recordWrite(page);
      assert.equal(await page.locator('#lifeWritingBody').inputValue(), '내가 쓰던 초안은 홈에 다녀와도 이어 쓸 수 있어야 한다.');
    }, { viewport: size, hasTouch: size.width <= 820 });
    for (const size of [{ width: 1440, height: 1000 }, { width: 820, height: 1000 }, { width: 390, height: 844 }]) await check('visual home empty populated loading error ' + size.width, async ({ page }) => {
      await freshHome(page); await snapshot(page, 'empty', size);
      const f = await fixture(page, { many: true }); await seedComposition(page, f.refs); await home(page); await snapshot(page, 'populated', size);
      const placement = await page.evaluate(() => {
        const write = [...document.querySelectorAll('[data-haedo-compose]')].find(node => node.checkVisibility());
        return { writeBottom: write.getBoundingClientRect().bottom, library: document.querySelectorAll('.home-library, #homeRecent').length };
      });
      assert(placement.writeBottom < size.height - 96, 'The global 글쓰기 must appear above the mobile dock on first entry');
      assert.equal(placement.library, 0, '2026-11-08 S3: the list is the blog feed only');
      await nav(page, 'tools'); await page.evaluate(() => { window.__homeHoldRead = true; window.__homeReadEntered = false; });
      await nav(page, 'home'); await page.waitForFunction(() => __homeReadEntered); await snapshot(page, 'loading', size);
      await page.evaluate(() => __homeReleaseRead()); await page.locator('#homeComposition[aria-busy="false"]').waitFor();
      await nav(page, 'tools'); await page.evaluate(() => { window.__homeFailRead = true; }); await home(page); await snapshot(page, 'error', size);
      await page.evaluate(() => { window.__homeFailRead = false; }); await page.locator('.home-posts-error').getByRole('button', { name: '다시 불러오기', exact: true }).click(); await page.locator('#homeComposition[aria-busy="false"]').waitFor();
    }, { viewport: size, hasTouch: size.width <= 820 });
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []);
  } finally {
    await browser.close();
    const serialized = JSON.stringify(report, null, 2) + '\n';
    await fs.writeFile(path.join(out, process.env.ENTRY_TEST_MATCH ? 'recheck-report.json' : 'browser-report.json'), serialized);
    await fs.writeFile(path.join(out, 'run-' + report.createdAt.replace(/[:.]/g, '-') + '.json'), serialized);
  }
  console.log(`Personal home: ${report.checks.filter(c => c.pass).length}/${report.checks.length} journeys; ${report.visual.length} visual states; console ${report.consoleErrors.length}; page ${report.pageErrors.length}. Anonymous intercepted Auth only.`);
  if (report.checks.some(c => !c.pass) || report.consoleErrors.length || report.pageErrors.length || report.external.length) process.exitCode = 1;
}
module.exports = { instrumentStorage, inspectHome };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

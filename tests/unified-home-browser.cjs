/* Unified entry journeys: real app/SDK/IDB, anonymous intercepted Auth only.
 * npm run dev; node tests/unified-home-browser.cjs
 * Never uses real Google, production Supabase or Apple-device claims.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { openRecordsMenu } = require('./helpers/feature-menus.cjs');
const { FakeCloud, platformContext, accounts, cloud, base, openManagement, openAccount, openBackupCenter } = require('./life-sync-browser.cjs');
function playwright() {
  for (const name of [process.env.PW_MODULE_PATH, 'playwright', 'playwright-core', '/opt/codex/cua_node/lib/node_modules/playwright'].filter(Boolean)) {
    try { return require(name); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Set PW_MODULE_PATH to the installed Playwright module.');
}
const settle = page => page.waitForFunction(() => !document.querySelector('.life-app[aria-busy="true"]'));
async function ready(page) {
  await page.waitForFunction(() => globalThis.HaedoLife?.Shell?.storage && !document.querySelector('#lifeApp').hidden);
  await page.evaluate(() => HaedoLife.Shell.ready);
}
async function shellReady(page) { await page.waitForFunction(() => globalThis.HaedoLife?.Shell); await page.evaluate(() => HaedoLife.Shell.ready); }
// 2026-11-02 menu 뉴스·일정·자료·설정: the former home is 일정's list and the former
// tools (계획) its plan view, opened from the list's 보기 단위 switch as a person does.
async function nav(page, section) {
  const control = page.locator('[data-haedo-navigation] [data-haedo-section="' + (section === 'home' || section === 'tools' ? 'schedule' : section) + '"]');
  const planSwitch = page.locator('#lifeApp [data-schedule-view="tools"]');
  if (section !== 'tools' || !await planSwitch.isVisible()) { await control.click(); await settle(page); }
  if (section === 'tools') { await planSwitch.click(); await settle(page); await page.locator('#lifeMain[data-mode="tools"]').waitFor(); }
  assert.equal(await control.getAttribute('aria-current'), 'page');
}
async function button(page, name) { await page.getByRole('button', { name, exact: true }).click(); await settle(page); }
async function assertCommonNavigation(page) {
  // The brand is another link to the first screen, separate from the four section
  // controls (2026-11-02: 뉴스·일정·자료·설정); 글쓰기 is its own control above them.
  assert.deepEqual(await page.locator('[data-haedo-navigation] a[data-haedo-section]').evaluateAll(links => links.map(link => ({
    section: link.dataset.haedoSection, href: link.getAttribute('href'), label: link.getAttribute('aria-label')
  }))), [
    { section: 'news', href: 'index.html?section=news', label: '뉴스' },
    { section: 'schedule', href: 'index.html', label: '일정' },
    { section: 'records', href: 'index.html?section=records', label: '자료' },
    { section: 'manage', href: 'index.html?section=manage', label: '설정' }
  ]);
  const write = page.locator('[data-haedo-navigation] a[data-haedo-compose]');
  assert.equal(await write.count(), 1); assert.equal(await write.getAttribute('href'), 'index.html?compose=1');
  assert.equal(await write.getAttribute('aria-label'), '글쓰기'); assert.equal(await write.getAttribute('data-haedo-section'), null);
  const brand = page.locator('[data-haedo-navigation] .haedo-brand');
  assert.equal(await brand.count(), 1); assert.equal(await brand.getAttribute('href'), 'index.html');
  assert.equal(await brand.getAttribute('aria-label'), '해도 홈');
}
const stored = page => page.evaluate(async () => HaedoLife.Shell.storage.read(await HaedoLife.Shell.storage.getActive()));
async function logoutToPublicHome(page) {
  await openAccount(page);
  const previousDocument = await page.evaluate(() => __homeInstance);
  await button(page, '로그아웃');
  // Both the private view and the redirect use index.html. Matching pathname
  // can resolve on the old document, before location.replace commits.
  await page.waitForFunction(previous => window.__homeInstance && __homeInstance !== previous, previousDocument);
  await shellReady(page);
  assert.equal(new URL(page.url()).pathname, '/index.html');
}

async function makeContext(browser, server, device, seed = accounts.a, options = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true, viewport: { width: 820, height: 1000 }, ...options });
  await platformContext(context, server, device, seed);
  // Existing goal/habit/workspace screens read their own platform tables.
  // Return empty anonymous collections; writes still fail the FakeCloud contract.
  await context.route(`${cloud}/rest/v1/**`, route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && ['/rest/v1/haedo_documents', '/rest/v1/haedo_items', '/rest/v1/charts'].includes(url.pathname))
      return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' });
    return route.fallback();
  });
  await context.addInitScript(() => {
    window.__homeDbOpens = []; window.__homeInstance = Math.random().toString(36);
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) { __homeDbOpens.push({ verified: !!globalThis.HaedoAuth?.user }); return open.apply(this, args); };
  });
  return context;
}
function observe(page, report, name) {
  page.on('console', event => {
    if (event.type() !== 'error') return;
    if (page.expectedAuthFailure && event.location().url.startsWith(cloud) && /Failed to load resource:.*ERR_INTERNET_DISCONNECTED/.test(event.text())) report.expectedErrors++;
    else report.consoleErrors.push({ check: name, message: event.text() });
  });
  page.on('pageerror', error => report.pageErrors.push({ check: name, message: error.message }));
}
async function importExcerpt(page, title, raw, quote) {
  await nav(page, 'records'); await button(page, '가져오기');
  await page.locator('#lifeImportTitle').fill(title); await page.locator('#lifeImportText').fill(raw);
  await button(page, '원문·출처 확인');
  await page.locator('#lifeReviewText').evaluate((el, text) => {
    const start = el.value.indexOf(text); if (start < 0) throw new Error('Fixture quote missing');
    el.focus(); el.setSelectionRange(start, start + text.length); el.dispatchEvent(new Event('select', { bubbles: true }));
  }, quote);
  await page.locator('#lifeExcerptTopic').fill('다시 읽기'); await page.locator('#lifeExcerptNote').fill('출처를 기억할 익명 메모');
  await button(page, '발췌 후보 추가'); await button(page, '선택한 발췌 모음에 반영');
}
function annotation(message) {
  if (process.env.GITHUB_ACTIONS) console.error('::error title=Unified home::' + String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'));
}
async function main() {
  await fs.mkdir('.local/unified-home', { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { checks: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, realRemoteWrites: 0 };
  async function check(name, run, seed = accounts.a) {
    if (process.env.HOME_TEST_MATCH && !new RegExp(process.env.HOME_TEST_MATCH).test(name)) return;
    const server = new FakeCloud(), device = 'home-' + report.checks.length;
    const context = await makeContext(browser, server, device, seed), page = await context.newPage(); page.setDefaultTimeout(15000); observe(page, report, name);
    try { await run({ page, context, server, device }); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) {
      report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); annotation(name + '\n' + error.stack);
      await page.screenshot({ path: '.local/unified-home/failure-' + report.checks.length + '.png', fullPage: true }).catch(() => {});
    }
    finally { await context.close(); }
  }
  try {
    await check('anonymous common home is usable in all sections without redirect or private IDB', async ({ page }) => {
      for (const suffix of ['', '?section=news', '?section=tools', '?section=manage']) {
        await page.goto(base + '/index.html' + suffix); await shellReady(page);
        assert.equal(new URL(page.url()).pathname, '/index.html'); assert.equal(await page.locator('#lifeWelcome').isVisible(), true);
        assert.equal(await page.locator('#lifeApp').isHidden(), true); assert.deepEqual(await page.evaluate(() => __homeDbOpens), []);
        await assertCommonNavigation(page);
        assert.equal(await page.locator('[data-life-login=compose]').isVisible(), true);
        assert.equal(await page.locator('[data-life-return-login]').isVisible(), true);
        assert.match(await page.locator('[data-life-login=compose]').getAttribute('href'), /compose%3D1/);
      }
    }, null);
    await check('public readonly home does not mount even an authenticated account', async ({ page }) => {
      await page.goto(base + '/index.html?view-only=1'); await shellReady(page);
      assert.equal(await page.locator('#lifeApp').isHidden(), true); assert.deepEqual(await page.evaluate(() => __homeDbOpens), []);
      assert.equal(await page.evaluate(() => HaedoLife.Shell.storage), null);
    });
    await check('server verification completes before any account storage opens', async ({ page, context }) => {
      let release, entered; const gate = new Promise(resolve => { release = resolve; }), arrived = new Promise(resolve => { entered = resolve; });
      await context.route(`${cloud}/auth/v1/user`, async route => { entered(); await gate; return route.fallback(); });
      try {
        await page.goto(base + '/index.html?section=tools', { waitUntil: 'domcontentloaded' }); await arrived;
        assert.equal(await page.locator('#lifeApp').isHidden(), true); assert.deepEqual(await page.evaluate(() => __homeDbOpens), []);
      } finally { release(); }
      await ready(page); assert.equal(await page.locator('[data-haedo-navigation] a[data-haedo-section="schedule"]').getAttribute('aria-current'), 'page');
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'tools');
      assert.ok((await page.evaluate(() => __homeDbOpens)).length > 0);
      assert.ok((await page.evaluate(() => __homeDbOpens)).every(item => item.verified));
    });
    await check('Google PKCE fixture returns to selected home section with only allowed query state', async ({ page, server, device }) => {
      server.oauthAccounts.set(device, accounts.a);
      await page.goto(base + '/index.html?section=manage&view=transfer&unknown=drop'); await shellReady(page);
      // General login preserves the destination; the first-write CTA has its own compose intent.
      await page.locator('[data-life-return-login]').click(); await page.locator('#googleLogin').click();
      await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page);
      const url = new URL(page.url()); assert.equal(url.searchParams.get('section'), 'manage'); assert.equal(url.searchParams.get('view'), 'transfer');
      assert.equal(url.searchParams.has('unknown'), false); assert.equal(url.searchParams.has('code'), false);
      assert.equal(await page.locator('#lifeRestoreFile').isVisible(), true);
      assert.equal(await page.evaluate(() => HaedoAuth.safeNext('https://outside.invalid/steal')), 'index.html');
      assert.equal(await page.evaluate(() => HaedoAuth.safeNext('index.html?section=bad&view=bad&doc=secret')), 'index.html');
    }, null);
    await check('Google PKCE default return opens personal home without inventing a records selection', async ({ page, context, server, device }) => {
      server.oauthAccounts.set(device, accounts.a);
      await page.goto(base + '/index.html'); await shellReady(page);
      // The HTML can render before the login handler arrives on a slow link.
      // Do not offer an enabled button which silently ignores that first click.
      let release;
      const handlerReady = new Promise(resolve => { release = resolve; });
      await context.route('**/assets/platform-ui.js', async route => { await handlerReady; await route.fallback(); });
      const navigation = page.locator('[data-life-return-login]').click();
      try {
        await page.locator('#googleLogin').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#googleLogin').isDisabled(), true);
      } finally { release(); await navigation; }
      await page.locator('#googleLogin').click();
      await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page);
      await page.locator('#lifeHome').waitFor();
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'home');
      assert.equal(await page.locator('a[data-haedo-section="schedule"]').getAttribute('aria-current'), 'page');
      assert.equal(new URL(page.url()).searchParams.has('code'), false);
    }, null);
    await check('import draft and reviewed exact excerpt survive tools/manage switching without page reload', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page); const instance = await page.evaluate(() => __homeInstance);
      const raw = '통합 홈에서 보관할 본문\r\n다시 읽을 문장🌱\r\n끝 문장', quote = '다시 읽을 문장🌱';
      await page.locator('.home-library > summary').click();
      await button(page, '자료 가져오기'); await page.locator('#lifeImportTitle').fill('전환 중 보존할 익명 초안'); await page.locator('#lifeImportText').fill(raw);
      await nav(page, 'tools'); await nav(page, 'manage'); await nav(page, 'records'); await button(page, '가져오기');
      assert.equal(await page.locator('#lifeImportTitle').inputValue(), '전환 중 보존할 익명 초안');
      assert.equal(await page.locator('#lifeImportText').inputValue(), raw.replaceAll('\r\n', '\n'));
      await button(page, '원문·출처 확인'); await page.locator('#lifeReviewText').evaluate((el, quote) => {
        const start = el.value.indexOf(quote); el.focus(); el.setSelectionRange(start, start + quote.length); el.dispatchEvent(new Event('select', { bubbles: true }));
      }, quote);
      await page.locator('#lifeExcerptTopic').fill('남길 질문'); await page.locator('#lifeExcerptNote').fill('검토 도중 보존할 메모'); await button(page, '발췌 후보 추가');
      await nav(page, 'tools'); await nav(page, 'manage'); await nav(page, 'records'); await button(page, '가져오기');
      assert.match(await page.locator('#lifeDraftExcerpts').innerText(), /검토 도중 보존할 메모/);
      assert.equal((await stored(page)).records.length, 0); await button(page, '선택한 발췌 모음에 반영');
      const b = await stored(page); assert.equal(b.records[0].text, quote);
      assert.equal(b.sourceVersions[0].contentText.slice(b.records[0].sourceRefs[0].locator.start, b.records[0].sourceRefs[0].locator.end), quote);
      assert.equal(await page.evaluate(() => __homeInstance), instance, 'section navigation reloaded the page');
    });
    await check('reader quote/search context and backup scope remain exact through common navigation', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page);
      const raw = '앞 문장\n보존할 구절🌱\n끝 문장', quote = '보존할 구절🌱';
      await importExcerpt(page, '통합 홈 익명 원문', raw, quote);
      await page.locator('#lifeSearch').fill('출처를 기억할'); const open = page.locator('.life-excerpt-open').first();
      const key = await open.getAttribute('data-focus-key'); await open.click(); await settle(page);
      await page.waitForFunction(text => getSelection().toString() === text, quote);
      await nav(page, 'tools'); await nav(page, 'manage'); await nav(page, 'records');
      assert.equal(await page.locator('#lifeSourceText').textContent(), raw);
      await page.waitForFunction(text => getSelection().toString() === text, quote);
      await page.locator('#lifeSearchReturn').click(); await settle(page);
      assert.equal(await page.locator('#lifeSearch').inputValue(), '출처를 기억할');
      await page.waitForFunction(value => document.activeElement?.dataset.focusKey === value, key);
      await openBackupCenter(page); await button(page, '내보내기·사본 복원');
      await page.locator('#lifeTransferScope summary').focus(); await page.keyboard.press('Enter');
      const scope = await page.locator('#lifeTransferScope').innerText();
      assert.match(scope, /연표·목표·습관.*포함하지 않습니다/);
      assert.match(scope, /묶음·내 페이지·회고·책.*포함하지 않습니다/);
      const download = page.waitForEvent('download'); await button(page, 'JSON 백업');
      const backup = JSON.parse(await fs.readFile(await (await download).path(), 'utf8'));
      assert.equal(backup.format, 'life-tools-backup-v1'); assert.equal(backup.manifest.stagingIncluded, false);
      assert.equal(backup.workspace.sourceVersions[0].contentText, raw); assert.equal(backup.workspace.records[0].text, quote);
      assert.deepEqual(backup.workspace.records[0].sourceRefs[0].locator, { start: raw.indexOf(quote), end: raw.indexOf(quote) + quote.length });
    });
    await check('a home with originals and no excerpts shows real text and opens the complete original', async ({ page }) => {
      await page.goto(base + '/index.html'); await ready(page);
      const raw = '아직 발췌하지 않은 원문도 첫 화면에서 다시 읽는다. '.repeat(14);
      await nav(page, 'records'); await button(page, '가져오기'); await page.locator('#lifeImportTitle').fill('발췌 전 보관한 익명 자료'); await page.locator('#lifeImportText').fill(raw);
      await button(page, '원문·출처 확인'); await button(page, '자료만 보관'); await button(page, '자료로 돌아가기');
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'sources');
      const card = page.locator('#lifeSearchResults .life-source-card'); assert.equal(await card.count(), 1);
      assert((await card.locator('.life-search-context').textContent()).startsWith(raw.slice(0, 100))); // Unified list still shows the stored original, even without saved quotes.
      assert.equal((await stored(page)).records.length, 0);
      await card.locator('h3 .life-source-open').click(); await settle(page);
      assert.equal(await page.locator('#lifeSourceText').textContent(), raw);
      await page.locator('#lifeSearchReturn').click(); await settle(page); assert.equal(await card.count(), 1);
      await nav(page, 'home'); await page.locator('.home-library > summary').click();
      const recent = page.locator('#homeRecent'); assert((await recent.innerText()).includes(raw.slice(0, 100)));
      await recent.getByRole('button', { name: '발췌 전 보관한 익명 자료', exact: true }).click(); await settle(page);
      assert.equal(await page.locator('#lifeSourceText').textContent(), raw);
    });
    await check('tools lead to existing goal/habit editors and account timeline list with the same five-way navigation', async ({ page }) => {
      await page.goto(base + '/index.html?section=tools'); await ready(page);
      for (const target of ['goals', 'habits']) {
        await page.locator('#lifeMain a[href="' + target + '.html"]').click();
        await page.waitForFunction(target => document.body.dataset.page === target && !document.querySelector('[data-private]').hidden, target);
        await assertCommonNavigation(page);
        assert.equal(await page.locator('[data-haedo-navigation] a[data-haedo-section="schedule"]').getAttribute('aria-current'), 'page');
        await page.locator('#addItem').click(); assert.equal(await page.locator('#itemDialog').isVisible(), true);
        await page.keyboard.press('Escape'); await nav(page, 'tools'); await ready(page);
      }
      await nav(page, 'tools'); await button(page, '연표'); // 2026-11-02: 연표 is in 일정's 계획
      await page.locator('#lifeMain a[href="workspace.html"]').click();
      await page.waitForFunction(() => document.body.dataset.page === 'workspace' && !document.querySelector('[data-private]').hidden);
      await assertCommonNavigation(page);
      await page.locator('#newTimeline').click(); assert.equal(await page.locator('#timelineDialog').isVisible(), true); await page.keyboard.press('Escape');
    });
    await check('old section addresses and standalone pages open the new 뉴스·일정·자료·설정 screens', async ({ page }) => {
      // 2026-11-02: home/tools are aliases of 일정 and addresses are normalized to the new IDs.
      // The old home links to the public cover/pages (now 설정 views) are covered by feature-flow-browser.
      const cases = [
        ['index.html', 'schedule', 'home', '/index.html'],
        ['index.html?section=home', 'schedule', 'home', '/index.html'],
        ['index.html?section=schedule', 'schedule', 'home', '/index.html'],
        ['index.html?section=tools', 'schedule', 'tools', '/index.html?section=schedule&view=tools'],
        ['index.html?section=tools&view=annual-plan', 'schedule', 'annual-plan', '/index.html?section=schedule&view=annual-plan'],
        ['index.html?section=records', 'records', 'sources', '/index.html?section=records'],
        ['index.html?section=manage', 'manage', 'manage', '/index.html?section=manage'],
        ['index.html?section=manage&view=backup', 'manage', 'backup', '/index.html?section=manage&view=backup'],
        ['index.html?section=news', 'news', 'external-discovery', '/index.html?section=news'],
        ['life.html', 'records', 'sources', '/life.html?section=records'],
        ['life.html?section=tools', 'schedule', 'tools', '/life.html?section=schedule&view=tools']
      ];
      for (const [suffix, section, mode, address] of cases) {
        await page.goto(base + '/' + suffix); await ready(page); await settle(page);
        await page.locator('#lifeMain[data-mode="' + mode + '"]').waitFor();
        assert.equal(await page.locator('[data-haedo-navigation] a[aria-current="page"]').evaluateAll(links => links.map(link => link.dataset.haedoSection)).then(list => list.join()), section, suffix);
        assert.equal(await page.evaluate(() => document.body.dataset.haedoSection), section, suffix);
        assert.equal(await page.evaluate(() => location.pathname + location.search), address, suffix);
        await assertCommonNavigation(page);
      }
      for (const [file, pageName] of [['timeline.html', 'workspace'], ['workspace.html', 'workspace'], ['goals.html', 'goals'], ['habits.html', 'habits']]) {
        await page.goto(base + '/' + file);
        await page.waitForFunction(name => document.body.dataset.page === name && !document.querySelector('[data-private]').hidden, pageName);
        assert.equal(await page.locator('[data-haedo-navigation] a[data-haedo-section="schedule"]').getAttribute('aria-current'), 'page', file);
        await assertCommonNavigation(page);
      }
      // The former 계획 back link of goals/habits still lands on 일정's plan view.
      await page.locator('[data-section-back]').click(); await ready(page); await page.locator('#lifeMain[data-mode="tools"]').waitFor();
      assert.equal(await page.locator('#lifeApp [data-schedule-view="tools"]').getAttribute('aria-current'), 'true');
    });
    await check('phone pencil scrolls with the heading on pages whose heading does not stick and never covers their controls', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      for (const [file, name] of [['goals.html', 'goals'], ['habits.html', 'habits'], ['workspace.html', 'workspace'], ['privacy.html', 'privacy']]) {
        await page.goto(base + '/' + file);
        await page.waitForFunction(name => document.body.dataset.page === name && !document.querySelector('[data-private]')?.hidden, name);
        const fixedPencil = page.locator('[data-haedo-navigation] a[data-haedo-compose]');
        const pencil = page.locator('.haedo-page-heading a[data-haedo-compose="heading"]');
        assert.equal(await fixedPencil.isVisible(), false, file + ': no floating pencil');
        assert.equal(await pencil.isVisible(), true, file + ': pencil in the heading');
        assert.equal(await pencil.getAttribute('aria-label'), '글쓰기'); assert.equal(await pencil.getAttribute('href'), 'index.html?compose=1');
        // A taller page (spacer added by the check only) shows the pencil leaving with its heading.
        await page.evaluate(() => { const spacer = document.createElement('div'); spacer.style.height = '2000px'; document.querySelector('.p-main').append(spacer); });
        const before = await pencil.evaluate(node => node.getBoundingClientRect().top);
        await page.evaluate(() => scrollTo({ top: 300, behavior: 'instant' }));
        const after = await pencil.evaluate(node => node.getBoundingClientRect().top);
        assert(Math.abs(before - after - 300) < 2, file + ': pencil scrolls with the heading');
        await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
        const overlaps = await pencil.evaluate(node => {
          const p = node.getBoundingClientRect();
          return [...document.querySelectorAll('.p-main a, .p-main button, .p-main summary, .p-main input')].filter(other => other !== node && !other.contains(node) && other.checkVisibility()).map(other => [other, other.getBoundingClientRect()])
            .filter(([, r]) => Math.min(p.right, r.right) - Math.max(p.left, r.left) > 0.5 && Math.min(p.bottom, r.bottom) - Math.max(p.top, r.top) > 0.5).map(([other]) => other.getAttribute('aria-label') || other.textContent.trim());
        });
        assert.deepEqual(overlaps, [], file + ': pencil overlaps');
      }
      // The app pages keep their sticky heading row and the pencil beside it.
      await page.goto(base + '/index.html'); await ready(page); await settle(page);
      assert.equal(await page.locator('[data-haedo-navigation] a[data-haedo-compose]').isVisible(), true);
      assert.equal(await page.locator('a[data-haedo-compose="heading"]').count(), 0);
    });
    await check('글쓰기 keeps one place, marks the writing screen current and the 일정 views switch with history', async ({ page }) => {
      await page.goto(base + '/index.html?section=records'); await ready(page); await settle(page);
      const write = page.locator('[data-haedo-navigation] a[data-haedo-compose]');
      await write.click(); await settle(page); await page.locator('#lifeMain[data-mode="page"]').waitFor(); await page.locator('.ql-editor').waitFor();
      assert.equal(await write.getAttribute('aria-current'), 'page');
      assert.equal(await page.locator('[data-haedo-navigation] a[data-haedo-section][aria-current]').count(), 0);
      // A second press on the current 글쓰기 neither opens another post nor moves.
      await page.waitForFunction(() => new URLSearchParams(location.search).has('blog'));
      const url = page.url(), posts = await page.evaluate(() => document.querySelectorAll('.ql-editor').length);
      await write.click(); await settle(page); assert.equal(page.url(), url); assert.equal(await page.evaluate(() => document.querySelectorAll('.ql-editor').length), posts);
      // A reload keeps a never-saved new post as the 글쓰기 screen, and 글쓰기 still opens no second post.
      await page.locator('#photoTitle').fill('새로고침 뒤에도 쓰는 중인 글');
      const stored = () => page.evaluate(async () => { const s = HaedoLife.Shell.storage; return (await s.listPhotoPosts(await s.getActive())).map(post => post.status); });
      // Poll the awaited IDB read (a pending Promise is truthy inside waitForFunction).
      for (const deadline = Date.now() + 10000; (await stored()).length !== 1;) { assert(Date.now() < deadline, 'draft stored'); await new Promise(resolve => setTimeout(resolve, 50)); }
      await page.reload(); await ready(page); await settle(page); await page.locator('#lifeMain[data-mode="page"]').waitFor(); await page.locator('#photoTitle').waitFor();
      assert.equal(await page.locator('#photoTitle').inputValue(), '새로고침 뒤에도 쓰는 중인 글');
      assert.equal(await write.getAttribute('aria-current'), 'page');
      const reloaded = page.url(); await write.click(); await settle(page);
      assert.equal(page.url(), reloaded); assert.deepEqual(await stored(), ['draft']);
      await page.goBack(); await settle(page); await page.locator('#lifeMain[data-mode="sources"]').waitFor();
      assert.equal(await write.getAttribute('aria-current'), null);
      assert.equal(await page.locator('[data-haedo-navigation] a[data-haedo-section="records"]').getAttribute('aria-current'), 'page');
      await nav(page, 'home'); await page.locator('#lifeHome').waitFor();
      // The 보기 단위 switch keeps one place in both views (review M1).
      const switchX = () => page.locator('#lifeApp nav[aria-label="보기 단위"]').evaluate(node => Math.round(node.getBoundingClientRect().left));
      for (const width of [1440, 820, 390]) {
        await page.setViewportSize({ width, height: 900 }); await page.locator('[data-schedule-view="home"]').click(); await settle(page); await page.locator('#lifeHome').waitFor();
        const list = await switchX();
        await page.locator('[data-schedule-view="tools"]').click(); await settle(page); await page.locator('#lifeMain[data-mode="tools"]').waitFor();
        assert.equal(await switchX(), list, 'switch x at ' + width);
        assert.equal(await page.locator('#lifeApp .life-toolbar [role="toolbar"][aria-label="화면 동작"]').count(), 1);
      }
      await page.setViewportSize({ width: 820, height: 1000 }); await page.locator('[data-schedule-view="home"]').click(); await settle(page); await page.locator('#lifeHome').waitFor();
      const views = page.locator('#lifeApp nav[aria-label="보기 단위"] a');
      assert.deepEqual(await views.evaluateAll(links => links.map(link => [link.textContent, link.getAttribute('aria-current')])), [['목록', 'true'], ['계획', null]]);
      await page.locator('[data-schedule-view="tools"]').click(); await settle(page); await page.locator('#lifeMain[data-mode="tools"]').waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.scheduleView), 'tools');
      assert.equal(await page.evaluate(() => location.search), '?section=schedule&view=tools');
      await page.goBack(); await settle(page); await page.locator('#lifeMain[data-mode="home"]').waitFor();
      await page.goForward(); await settle(page); await page.locator('#lifeMain[data-mode="tools"]').waitFor();
      assert.equal(await page.locator('[aria-current="page"]').count(), 1, 'one current page per document');
      await page.locator('[data-schedule-view="home"]').focus(); await page.keyboard.press('Enter'); await settle(page); await page.locator('#lifeHome').waitFor();
      assert.equal(await page.locator('[data-haedo-navigation] a[data-haedo-section="schedule"]').getAttribute('aria-current'), 'page');
    });
    await check('history keeps a management subview and a legacy life sync link keeps its destination', async ({ page }) => {
      await page.goto(base + '/index.html?section=manage&view=transfer'); await ready(page);
      assert.equal(await page.locator('#lifeRestoreFile').isVisible(), true);
      await nav(page, 'records'); await page.goBack(); await settle(page);
      await page.locator('#lifeRestoreFile').waitFor({ state: 'visible' });
      assert.equal(new URL(page.url()).searchParams.get('view'), 'transfer');
      assert.equal(await page.locator('[data-haedo-navigation] a[data-haedo-section="manage"]').getAttribute('aria-current'), 'page');
      await page.goto(base + '/life.html?view=sync'); await ready(page);
      assert.equal(await page.locator('#lifeSyncState').isVisible(), true);
      assert.equal(await page.locator('[data-haedo-navigation] a[data-haedo-section="manage"]').getAttribute('aria-current'), 'page');
    });
    await check('account change cannot reveal previous home content and returning account recovers its own data', async ({ page, server, device }) => {
      await page.goto(base + '/index.html'); await ready(page); await importExcerpt(page, '익명 A 기록', 'A만 읽을 구절', 'A만 읽을 구절');
      const id = (await stored(page)).workspaceId;
      await logoutToPublicHome(page);
      assert.equal(await page.locator('#lifeApp').isHidden(), true); assert.doesNotMatch(await page.locator('body').innerText(), /A만 읽을 구절/);
      server.oauthAccounts.set(device, accounts.b); await page.locator('[data-life-return-login]').click(); await page.locator('#googleLogin').click(); await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page);
      assert.equal((await stored(page)).sources.length, 0);
      assert.equal(await page.evaluate(async id => { try { await HaedoLife.Shell.storage.read(id); return false; } catch (_) { return true; } }, id), true);
      assert.doesNotMatch(await page.locator('body').innerText(), /A만 읽을 구절/);
      await logoutToPublicHome(page);
      server.oauthAccounts.set(device, accounts.a); await page.locator('[data-life-return-login]').click(); await page.locator('#googleLogin').click(); await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page);
      assert.equal((await stored(page)).workspaceId, id); assert.equal((await stored(page)).records[0].text, 'A만 읽을 구절');
    });
    await check('a late verification response after signout cannot remount the previous private home', async ({ page, context }) => {
      await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' }); await ready(page);
      await importExcerpt(page, '지연 검증 익명 원문', '늦은 응답 비공개 구절', '늦은 응답 비공개 구절');
      let release, entered; const gate = new Promise(resolve => { release = resolve; }), arrived = new Promise(resolve => { entered = resolve; });
      await context.route(`${cloud}/auth/v1/user`, async route => { entered(); await gate; return route.fallback(); });
      try {
        await page.evaluate(() => { window.__lateVerify = HaedoAuth.verify().then(() => null, error => error.code); }); await arrived;
        // signOut ends with location.replace('index.html'). The public state below
        // already holds on the page being replaced, so mark that document and wait
        // for the one that replaces it; evaluating on the old one races the navigation.
        await page.evaluate(() => { window.__signedOutDocument = true; window.__lateSignOut = HaedoAuth.signOut().catch(error => error.code); });
        await page.waitForFunction(() => document.querySelector('#lifeApp').hidden);
      } finally { release(); }
      await page.waitForFunction(() => !window.__signedOutDocument && globalThis.HaedoLife?.Shell && !document.querySelector('#lifeWelcome').hidden && HaedoAuth.user === null);
      assert.equal(await page.evaluate(() => HaedoAuth.user), null); assert.equal(await page.evaluate(() => HaedoLife.Shell.storage), null);
      assert.equal(await page.locator('#lifeApp').isHidden(), true);
      assert.doesNotMatch(await page.locator('body').innerText(), /늦은 응답 비공개 구절/);
    });
    await check('failed server verification shows recoverable error without opening private storage', async ({ page, server, device }) => {
      server.offline.add(device); page.expectedAuthFailure = true;
      await page.goto(base + '/index.html'); await shellReady(page);
      assert.deepEqual(await page.evaluate(() => __homeDbOpens), []); assert.equal(await page.locator('#lifeApp').isHidden(), true);
      assert.equal(await page.getByRole('button', { name: '다시 확인', exact: true }).isVisible(), true);
      server.offline.delete(device); await button(page, '다시 확인'); await ready(page); page.expectedAuthFailure = false;
      assert.ok((await page.evaluate(() => __homeDbOpens)).every(item => item.verified));
    });
  } finally {
    report.capturedAt = new Date().toISOString(); report.browser = browser.version(); await browser.close();
    await fs.writeFile(process.env.HOME_TEST_MATCH ? '.local/unified-home/recheck-report.json' : '.local/unified-home/browser-report.json', JSON.stringify(report, null, 2) + '\n');
  }
  const failed = report.checks.filter(item => !item.pass).length;
  console.log(JSON.stringify({ passed: report.checks.length - failed, failed, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, expectedErrors: report.expectedErrors, realRemoteWrites: 0 }));
  for (const error of [...report.consoleErrors, ...report.pageErrors]) annotation(JSON.stringify(error));
  if (failed || report.consoleErrors.length || report.pageErrors.length) process.exitCode = 1;
}
module.exports = { playwright, ready, shellReady, settle, nav, makeContext, observe, importExcerpt };
if (require.main === module) main().catch(error => { console.error(error.stack); annotation(error.stack); process.exitCode = 1; });

/* Existing feature entry/return integration: actual app, SDK and scoped IDB.
 * Anonymous HTTP Auth/catalogues only; no live user data or publication. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4193';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, ready, shellReady, settle, nav } = require('./unified-home-browser.cjs');
const { context: makeFixture, sizes } = require('./integrated-release-entry-browser.cjs');
const { fixture, current, seedComposition, abortWorkbenchWrites } = require('./life-workbench-browser.cjs');
const { inspectHome } = require('./home-entry-browser.cjs');
const { accounts, base } = require('./life-sync-browser.cjs');
const { openRecordsMenu, openBlogMenu, openNewsSettings } = require('./helpers/feature-menus.cjs');
const output = path.resolve(process.env.FEATURE_INTEGRATION_OUTPUT || '.local/feature-flow');
const report = { createdAt: new Date().toISOString(), scope: 'Actual UI/SDK/IndexedDB with anonymous HTTP Auth/catalogues. Chromium viewport, keyboard and touch simulation; not Google login or physical device verification.', checks: [], visual: [], pageErrors: [], consoleErrors: [], external: [], writes: [], closedContexts: 0, browserClosed: false };

async function mode(page, value) {
  await settle(page);
  await page.locator('#lifeMain[data-mode="' + value + '"]').waitFor();
}
async function back(page, value) {
  await page.locator('[data-subview-return]:visible').click();
  await mode(page, value);
}
async function capture(page, scene, size) {
  await page.evaluate(async () => { await document.fonts.ready; scrollTo({ top: 0, behavior: 'instant' }); });
  await page.mouse.move(0, 0);
  const metrics = await page.evaluate(inspectHome, '#lifeApp');
  const file = scene + '-' + size.width + '.png';
  await page.screenshot({ path: path.join(output, file) });
  report.visual.push({ scene, file, ...metrics });
  assert.equal(metrics.horizontalOverflow, false);
  assert.deepEqual(metrics.overflow, []);
  assert.deepEqual(metrics.smallTargets, []);
  assert.deepEqual(metrics.unnamed, []);
  assert.deepEqual(metrics.contrastFailures, []);
}
async function expectFocus(page, label) {
  await page.waitForFunction(label => (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent)?.trim() === label, label);
}

const sourceFiles = ['assets/haedo-navigation.js', 'assets/haedo-shell.css', 'assets/life/home.js', 'assets/life/workbench-ui.js', 'assets/life/icons.js', 'assets/life/ui.css', 'assets/life/ui.js', 'assets/platform-auth.js', 'goals.html', 'habits.html', 'sw.js'];
async function sourceHashes() {
  return Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await fs.readFile(path.join(__dirname, '..', file))).digest('hex')])));
}

async function main() {
  report.sourcesBefore = await sourceHashes();
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  async function check(name, run, size = sizes[1], account = accounts.a) {
    if (process.env.FEATURE_INTEGRATION_MATCH && !new RegExp(process.env.FEATURE_INTEGRATION_MATCH).test(name)) return;
    const f = await makeFixture(browser, 'feature-flow-' + report.checks.length, size, account, null, report);
    try {
      await run({ ...f, size });
      assert.equal(f.server.writes().length, 0, 'Navigation must not write remote material or publication');
      report.checks.push({ name, pass: true }); console.log('PASS ' + name);
    } catch (error) {
      const state = await f.page.evaluate(() => ({ mode: document.querySelector('#lifeMain')?.dataset.mode, path: location.pathname, query: location.search, active: document.activeElement?.getAttribute('aria-label'), recordsMenu: document.querySelector('#lifeRecordsMenu')?.open, blogMenu: document.querySelector('#lifeBlogMenu')?.open })).catch(() => null);
      report.checks.push({ name, pass: false, error: error.stack, state }); console.error('FAIL ' + name + '\n' + error.stack);
      await f.page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png') }).catch(() => {});
    } finally { await f.context.close(); report.closedContexts += 1; }
  }
  try {
    for (const size of sizes) await check('context menus preserve source filters, exact data and return focus ' + size.width, async ({ page }) => {
      const f = await fixture(page, { many: true }); await seedComposition(page, f.refs);
      await openRecordsMenu(page);
      await page.locator('#lifeRecordsMenu > summary').click();
      await page.locator('#lifeSearch').fill('산책');
      const before = await current(page);
      const resultIds = await page.locator('#lifeSearchResults .life-source-open').evaluateAll(nodes => nodes.map(node => node.dataset.versionId));
      const recordsMenu = await openRecordsMenu(page);
      for (const label of ['다시 찾기', '회고', '책 만들기', '네이버 블로그 연결', 'Obsidian 갱신', '원본 첨부 보관', '자료 휴지통']) assert.equal(await recordsMenu.getByRole('button', { name: label, exact: true }).isVisible(), true, label);
      await capture(page, 'records-menu', size);
      await page.keyboard.press('Escape');
      assert.equal(await recordsMenu.evaluate(node => node.open), false);
      await expectFocus(page, '자료 메뉴');
      await page.keyboard.press('Enter');
      assert.equal(await recordsMenu.evaluate(node => node.open), true);
      const discover = recordsMenu.getByRole('button', { name: '다시 찾기', exact: true });
      if (size.width === 1440) { await discover.focus(); await page.keyboard.press('Enter'); } else await discover.tap();
      await mode(page, 'discover'); await page.locator('#wbDiscoverQuery').waitFor();
      assert.equal(await page.locator('[data-haedo-section="records"][aria-current="page"]').count(), 1);
      await back(page, 'sources'); await expectFocus(page, '다시 찾기');
      assert.equal(await page.locator('#lifeRecordsMenu').evaluate(node => node.open), true);
      assert.equal(await page.locator('#lifeSearch').inputValue(), '산책');
      assert.deepEqual(await page.locator('#lifeSearchResults .life-source-open').evaluateAll(nodes => nodes.map(node => node.dataset.versionId)), resultIds);
      await page.getByRole('button', { name: '회고', exact: true }).click(); await mode(page, 'reflection'); await page.locator('#wbReflectionNote').waitFor();
      await back(page, 'sources'); await expectFocus(page, '회고');
      assert.deepEqual(await current(page), before, 'Opening features does not rewrite source versions, excerpts or saved composition');

      const blogMenu = await openBlogMenu(page);
      for (const label of ['글 관리', '공개 표지', '공개 페이지 관리']) assert.equal(await blogMenu.getByRole('button', { name: label, exact: true }).isVisible(), true, label);
      assert.equal(await page.getByRole('button', { name: '글 관리', exact: true }).count(), 1, 'Home exposes one manager entry');
      await capture(page, 'blog-menu', size);
      await blogMenu.getByRole('button', { name: '글 관리', exact: true }).click(); await mode(page, 'blog'); await page.locator('.blog-manager-list[data-state="ready"]').waitFor();
      await back(page, 'home'); await expectFocus(page, '글 관리');
      assert.equal(await page.locator('#lifeBlogMenu').evaluate(node => node.open), true);
      await page.getByRole('button', { name: '공개 표지', exact: true }).click(); await mode(page, 'public-cover'); await page.locator('#publicCoverEditor').waitFor();
      await back(page, 'home'); await expectFocus(page, '공개 표지');
      await page.getByRole('button', { name: '공개 페이지 관리', exact: true }).click(); await mode(page, 'public-pages');
      await back(page, 'home'); await expectFocus(page, '공개 페이지 관리');

      await nav(page, 'tools'); await mode(page, 'tools');
      assert.deepEqual(await page.locator('#lifeMain .life-destination').evaluateAll(nodes => nodes.map(node => node.querySelector('strong')?.textContent)), ['연간 계획', '목표', '습관']);
      await capture(page, 'tools', size);
      await nav(page, 'manage'); await mode(page, 'manage');
      for (const label of ['글 관리', '공개 표지', '공개 페이지 관리', 'Obsidian 갱신', '원본 첨부 보관', '자료 휴지통']) assert.equal(await page.getByRole('button', { name: label, exact: true }).count(), 0, 'Settings does not duplicate ' + label);
      for (const label of ['자료 관리', '자료·구성 백업', '내보내기·사본 복원', '컬렉션 백업·복구']) assert.equal(await page.getByRole('button', { name: label, exact: true }).isVisible(), true, label);
      await capture(page, 'settings', size);
      await page.getByRole('button', { name: '자료·구성 백업', exact: true }).click(); await mode(page, 'workbench-backup'); await page.locator('#wbBackupDownload').waitFor();
      await back(page, 'manage'); await expectFocus(page, '자료·구성 백업');
      await openNewsSettings(page); await page.getByRole('button', { name: '관심 확인', exact: true }).click(); await mode(page, 'interests'); await page.locator('#interestManual').waitFor();
      assert.equal(await page.locator('[data-haedo-section="news"][aria-current="page"]').count(), 1);
      await back(page, 'external-discovery'); await page.locator('#discoveryNewsSettingsPanel').waitFor({ state: 'visible' });
      await expectFocus(page, '관심 확인');
      assert.deepEqual(await current(page), before);
    }, size);

    await check('legacy and canonical URLs reopen their feature under the current section', async ({ page }) => {
      const cases = [
        ['tools', 'records', 'discover'], ['tools', 'records', 'reflection'], ['tools', 'records', 'books'],
        ['manage', 'records', 'obsidian-update'], ['manage', 'records', 'source-trash'],
        ['tools', 'news', 'interests'], ['manage', 'home', 'blog'],
        ['manage', 'home', 'public-cover'], ['manage', 'home', 'public-pages']
      ];
      for (const file of ['index.html', 'life.html']) for (const [legacy, canonical, view] of cases) {
        for (const section of new Set([legacy, canonical])) {
          await page.goto(base + '/' + file + '?section=' + section + '&view=' + view); await ready(page); await mode(page, view);
          assert.equal(await page.locator('[data-haedo-section="' + canonical + '"][aria-current="page"]').count(), 1, file + ':' + section + ':' + view);
          assert.equal(new URL(page.url()).searchParams.get('view'), view);
          assert.equal(new URL(page.url()).searchParams.get('section'), canonical === 'home' && file === 'index.html' ? null : canonical);
        }
      }
    });

    await check('failed reflection save protects the current input, URL and menu selection', async ({ page }) => {
      const f = await fixture(page); await seedComposition(page, f.refs); await openRecordsMenu(page);
      await page.getByRole('button', { name: '회고', exact: true }).click(); await page.locator('#wbReflectionNote').waitFor();
      const before = await current(page), url = page.url();
      await abortWorkbenchWrites(page, true); await page.locator('#wbReflectionNote').fill('저장 실패 뒤에도 같은 화면에 남아야 하는 회고');
      await page.locator('#wbError').waitFor({ state: 'visible' });
      await page.locator('[data-subview-return]:visible').click(); await page.locator('#lifeError').waitFor({ state: 'visible' });
      await mode(page, 'reflection'); assert.equal(page.url(), url);
      assert.equal(await page.locator('#wbReflectionNote').inputValue(), '저장 실패 뒤에도 같은 화면에 남아야 하는 회고');
      assert.deepEqual(await current(page), before);
      assert.equal(await page.locator('[data-haedo-section="records"][aria-current="page"]').count(), 1);
      await abortWorkbenchWrites(page, false); await page.locator('#wbError').getByRole('button', { name: '다시 저장', exact: true }).click();
      await page.locator('#wbStatus[data-state="saved"]').waitFor();
      await back(page, 'sources'); await expectFocus(page, '회고');
      assert.equal((await current(page)).workbench.reflection.note, '저장 실패 뒤에도 같은 화면에 남아야 하는 회고');
    });

    await check('accepted material update preserves an open menu and its focused action', async ({ page }) => {
      await fixture(page); await openRecordsMenu(page);
      await page.getByRole('button', { name: '회고', exact: true }).focus();
      const result = await page.evaluate(async () => {
        const storage = HaedoLife.Shell.storage, C = HaedoLife.Core, bundle = await storage.read(await storage.getActive());
        const oldFocus = document.activeElement, focusKey = oldFocus.dataset.focusKey, events = [];
        const stop = storage.subscribe(bundle.workspaceId, event => { if (event.type === 'changed') events.push(event.revision); });
        const source = { ...bundle.sources[0], title: bundle.sources[0].title + ' · 갱신 검토', revision: bundle.sources[0].revision + 1, updatedAt: new Date().toISOString() };
        try {
          const write = await storage.commitLocal({ operationId: C.id(), workspaceId: bundle.workspaceId, baseRevision: bundle.revision, changes: { put: { sources: [source] } } });
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return { status: write.status, events, focusKey, currentFocusKey: document.activeElement?.dataset.focusKey, oldFocusConnected: oldFocus.isConnected, menuOpen: document.querySelector('#lifeRecordsMenu')?.open, sourceRevision: (await storage.read(bundle.workspaceId)).sources.find(row => row.id === source.id).revision, expectedRevision: source.revision };
        } finally { stop(); }
      });
      assert.equal(result.status, 'stored'); assert.ok(result.events.length > 0, 'A rejected transaction is not an update regression');
      assert.equal(result.sourceRevision, result.expectedRevision); assert.equal(result.oldFocusConnected, false, 'The header really refreshed');
      assert.equal(result.currentFocusKey, result.focusKey); assert.equal(result.menuOpen, true);
      await expectFocus(page, '회고');
      report.menuRefresh = result;
    }, sizes[2]);

    await check('planning links keep annual input while moving through goals and habits', async ({ page }) => {
      await page.goto(base + '/index.html?section=tools'); await ready(page);
      await page.getByRole('button', { name: '연간 계획', exact: true }).click(); await page.locator('#apGrid').waitFor();
      const input = page.locator('[data-ap-annual]').first(); await input.fill('한 해의 방향을 보관하고 실행 화면으로 이동');
      const year = await input.getAttribute('data-ap-annual');
      await page.getByRole('navigation', { name: '계획과 실천', exact: true }).getByRole('link', { name: '목표', exact: true }).click();
      await page.waitForFunction(() => document.body.dataset.page === 'goals' && !document.querySelector('[data-private]').hidden);
      await page.getByRole('link', { name: '습관', exact: true }).click();
      await page.waitForFunction(() => document.body.dataset.page === 'habits' && !document.querySelector('[data-private]').hidden);
      await page.getByRole('link', { name: '연간 계획', exact: true }).click(); await ready(page); await page.locator('#apGrid').waitFor();
      assert.equal(await page.locator('[data-ap-annual="' + year + '"]').inputValue(), '한 해의 방향을 보관하고 실행 화면으로 이동');
    });

    await check('planning keeps inputs locked through a later flush and recovers from its failure', async ({ page, context }) => {
      const modulePath = '/assets/life/workbench-ui.js';
      const hook = `\n;(()=>{const original=HaedoLife.WorkbenchUI;HaedoLife.WorkbenchUI=Object.freeze({...original,create(...args){const actual=original.create(...args);return Object.freeze({...actual,async flush(...values){const result=await actual.flush(...values);if(window.__featureHoldLaterFlush&&document.querySelector('#lifeMain')?.dataset.mode==='annual-plan'){window.__featureLaterFlushEntered=true;await new Promise((resolve,reject)=>{window.__featureReleaseLaterFlush=fail=>{window.__featureHoldLaterFlush=false;fail?reject(new Error('검사용 후속 저장 실패')):resolve();};});}return result;}});}});})();`;
      await context.route(base + modulePath, async route => {
        const response = await route.fetch(), original = await response.text();
        const disk = await fs.readFile(path.join(__dirname, '..', modulePath.slice(1)), 'utf8');
        assert.equal(original, disk, 'The test appends a barrier to the actual unchanged module');
        report.planningFlushProbe = { module: modulePath, originalSHA256: createHash('sha256').update(original).digest('hex'), hookSHA256: createHash('sha256').update(hook).digest('hex'), actualFlushDelegatedFirst: true, originalPrefixUnchanged: true };
        await route.fulfill({ response, body: original + hook });
      });
      await page.goto(base + '/index.html?section=tools&view=annual-plan'); await ready(page); await page.locator('#apGrid').waitFor();
      const input = page.locator('[data-ap-annual]').first(), year = await input.getAttribute('data-ap-annual'), beforeURL = page.url();
      await input.fill('저장 중에도 보존할 계획');
      await page.evaluate(() => { window.__featureHoldLaterFlush = true; });
      const planning = page.getByRole('navigation', { name: '계획과 실천', exact: true });
      await planning.getByRole('link', { name: '목표', exact: true }).click();
      await page.waitForFunction(() => window.__featureLaterFlushEntered);
      assert.equal(await page.locator('.life-app').getAttribute('aria-busy'), 'true');
      assert.equal(await input.isDisabled(), true, 'Inputs must stay locked after annual flush while later flushes are pending');
      assert.equal(page.url(), beforeURL);
      const committed = await page.evaluate(async year => { const s = HaedoLife.Shell.storage; return (await s.readAnnualPlan(await s.getActive())).rows.find(row => row.year === Number(year))?.text; }, year);
      assert.equal(committed, '저장 중에도 보존할 계획', 'The delayed stage is after the real annual commit');
      await planning.getByRole('link', { name: '습관', exact: true }).click();
      assert.equal(page.url(), beforeURL, 'Repeated outgoing links cannot bypass the pending flush');
      await page.evaluate(() => window.__featureReleaseLaterFlush(true));
      await page.locator('#lifeError').waitFor({ state: 'visible' }); await settle(page);
      assert.equal(page.url(), beforeURL); assert.equal(await input.isEnabled(), true);
      assert.equal(await input.inputValue(), '저장 중에도 보존할 계획');
      assert.match(await page.locator('#lifeError').textContent(), /검사용 후속 저장 실패/);
      await input.fill('실패 복구 뒤 이어 쓴 계획');
      await planning.getByRole('link', { name: '목표', exact: true }).click();
      await page.waitForFunction(() => document.body.dataset.page === 'goals' && !document.querySelector('[data-private]').hidden);
      await page.getByRole('link', { name: '연간 계획', exact: true }).click(); await ready(page); await page.locator('#apGrid').waitFor();
      assert.equal(await page.locator('[data-ap-annual="' + year + '"]').inputValue(), '실패 복구 뒤 이어 쓴 계획');
      Object.assign(report.planningFlushProbe, { annualCommitObservedBeforeGate: true, inputsDisabledDuringGate: true, failurePreservedInputAndURL: true, retryReopenedExactText: true });
    });

    for (const [view, section] of [['books', 'records'], ['source-trash', 'records'], ['public-pages', 'home']]) await check('signed-out exact feature return ' + view, async ({ page, server }) => {
      const device = 'feature-flow-' + report.checks.length; server.oauthAccounts.set(device, accounts.a);
      await page.goto(base + '/index.html?section=' + section + '&view=' + view + '&token=discarded#discarded-fragment');
      await shellReady(page); assert.deepEqual(await page.evaluate(() => __homeDbOpens), []);
      await page.locator('[data-life-return-login]').click(); await page.locator('#googleLogin').click();
      await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page); await mode(page, view);
      assert.equal(new URL(page.url()).hash, ''); assert.equal(new URL(page.url()).searchParams.has('token'), false);
      assert.equal(await page.locator('[data-haedo-section="' + section + '"][aria-current="page"]').count(), 1);
      assert.equal(await page.evaluate(() => __homeDbOpens.every(row => row.verified)), true);
    }, sizes[1], null);
  } finally {
    await browser.close(); report.browserClosed = true;
    report.sourcesAfter = await sourceHashes(); report.sourcesUnchanged = JSON.stringify(report.sourcesBefore) === JSON.stringify(report.sourcesAfter);
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log('Feature integration: ' + report.checks.filter(row => row.pass).length + '/' + report.checks.length + '; console ' + report.consoleErrors.length + '; page ' + report.pageErrors.length);
  if (!report.sourcesUnchanged || report.checks.some(row => !row.pass) || report.pageErrors.length || report.consoleErrors.length || report.external.length || report.writes.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

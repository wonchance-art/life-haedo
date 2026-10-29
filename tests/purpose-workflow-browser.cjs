/* Purpose-oriented navigation and visual preservation. Actual app, bundled SDK,
 * account-scoped IndexedDB, capability-1 synthetic account HTTP. No production
 * data, module replacement, field-performance or physical-device claim.
 * Baseline captures are observations; candidate checks enforce acceptance. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4198';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sourceRoot = path.resolve(process.env.PURPOSE_SOURCE_ROOT || path.join(__dirname, '..'));
const { CompositionCloud } = require(path.join(sourceRoot, 'tests/composition-sync-browser.cjs'));
const { accounts, cloud, base } = require(path.join(sourceRoot, 'tests/life-sync-browser.cjs'));
const { playwright, makeContext, ready, settle, nav } = require(path.join(sourceRoot, 'tests/unified-home-browser.cjs'));
const { inspectHome } = require(path.join(sourceRoot, 'tests/home-entry-browser.cjs'));
const { openRecordsMenu } = require(path.join(sourceRoot, 'tests/helpers/feature-menus.cjs'));
const Core = require(path.join(sourceRoot, 'assets/life/core.js'));
const Workbench = require(path.join(sourceRoot, 'assets/life/workbench.js'));
const Metadata = require(path.join(sourceRoot, 'assets/life/library-meta.js'));
const Folders = require(path.join(sourceRoot, 'assets/life/source-folders.js'));
const PhotoPost = require(path.join(sourceRoot, 'assets/life/photo-post.js'));
const baseline = process.env.PURPOSE_BASELINE === '1';
const output = path.resolve(process.env.PURPOSE_OUTPUT || '.local/purpose-workflow-browser');
const datasetFile = path.resolve(process.env.PURPOSE_DATASET_FILE || '.local/purpose-workflow-dataset.json');
const match = process.env.PURPOSE_MATCH && new RegExp(process.env.PURPOSE_MATCH);
const sizes = [{ width: 1440, height: 1000 }, { width: 820, height: 1000 }, { width: 390, height: 844 }];
const sha = value => createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value);
const id = '30000000-0000-4000-8000-000000000001';
const sourceFiles = ['index.html', 'life.html', 'sw.js', 'assets/haedo-navigation.js', 'assets/haedo-shell.css', 'assets/platform-auth.js', 'assets/platform-ui.js', 'assets/life/shell.js', 'assets/life/ui.js', 'assets/life/ui.css', 'assets/life/home.js', 'assets/life/home.css', 'assets/life/blog-manager.js', 'assets/life/photo-post-ui.js', 'assets/life/account-library.js', 'assets/life/storage.js', 'assets/life/source-folders-ui.js', 'assets/life/discovery-ui.js', 'assets/life/discovery.css', 'assets/life/interest-ui.js', 'assets/life/preservation-ui.js', 'assets/life/obsidian-link-candidates.js', 'assets/life/obsidian-link-candidates-ui.js', 'assets/life/obsidian-link-commit.js', 'assets/life/collection-ui.js', 'assets/life/workbench-ui.js', 'assets/life/core.js', 'assets/life/workbench.js', 'assets/life/library-meta.js', 'assets/life/source-folders.js', 'assets/life/photo-post.js', 'goals.html', 'habits.html', 'workspace.html'];
const fixtureFiles = ['tests/composition-sync-browser.cjs', 'tests/life-sync-browser.cjs', 'tests/unified-home-browser.cjs', 'tests/home-entry-browser.cjs', 'tests/helpers/feature-menus.cjs', 'tests/helpers/library-cloud.cjs', 'tests/helpers/blog-cloud.cjs'];
const report = { createdAt: new Date().toISOString(), scope: 'Exact static server bytes are SHA-verified before forwarding the same status, headers and body; bundled SDK and IndexedDB with anonymous capability-1 HTTP. The platform-config fixture retains its existing mock route. Viewports and simulated input only; no real login, device or production account writes.', baseline, base, sourceRoot, checks: [], visual: [], observations: [], pageErrors: [], consoleErrors: [], expectedConsoleErrors: [], external: [], staticErrors: [], staticResponses: [], privateRequests: [], forbiddenPrivateRequests: [], contexts: [], browserClosed: false };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function hashes(files) { return Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await fs.readFile(path.join(sourceRoot, file)))]))); }
async function wait(read, predicate, label) { const end = Date.now() + 20000; let value; do { value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 25)); } while (Date.now() < end); throw Error(label + ': ' + JSON.stringify(value)); }
async function dataset() {
  try { return JSON.parse(await fs.readFile(datasetFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let bundle = Core.createWorkspace({ workspaceId: id, title: '익명 워크플로 자료공간' }); const refs = [];
  const specs = [
    ['obsidian', '외국어 학습과 독서 — 긴 제목에서도 같은 자료를 다시 찾는 흐름', '\ufeff# 언어 학습과 독서\r\n\r\n보존할 구절🌱: Cafe\u0301에서 다시 읽는다.\r\n\r\n' + '외국어 학습과 독서는 충분한 집중과 반복을 필요로 한다.\r\n'.repeat(18)],
    ['apple_notes', '산책 뒤 집중력을 돌아본 메모', '산책 후에 읽은 문장과 집중력에 관한 짧은 생각을 남긴다.'],
    ['other', '지속하는 연습과 Grit', '반복하는 일과 그릿을 생각하며 이번 주의 읽기를 정리한다.'],
    ['obsidian', '학습 방법 비교 기록', '외국어 학습에서 간격을 둔 복습과 읽기 방법을 비교한다.'],
    ['apple_notes', '다음에 읽을 책', '읽을 책을 선택하고, 마음에 남은 문장을 다시 찾는다.'],
    ['other', '본문 없이 보관한 참고 링크', null]
  ];
  for (const [origin, title, text] of specs) {
    const p = await Core.prepareImport({ origin, title, text, authorRelation: 'self', forceSeparate: true, ...(text === null ? { url: 'https://example.invalid/reference', coverage: { status: 'link_only', omissions: ['본문 미확보'] } } : {}) }, bundle);
    bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, p)); refs.push({ sourceId: p.source.id, versionId: p.version.id, title: p.source.title });
  }
  const wb = Workbench.empty(id); wb.groups.push({ id: Core.id(), title: '언어와 독서', versionIds: refs.slice(0, 3).map(r => r.versionId) });
  wb.page.title = '고른 자료로 만든 페이지'; wb.page.entries.push({ id: Core.id(), title: refs[0].title, parts: [{ versionId: refs[0].versionId, enabled: true }], note: '직접 남긴 생각', pinned: true, enabled: true, showBody: true, showNote: true });
  wb.reflection.versionIds = [refs[0].versionId];
  const meta = Metadata.empty(id); meta.sourceFolders = Folders.createFolder(meta.sourceFolders, { name: '언어와 독서', parentId: null });
  const folderId = meta.sourceFolders.folders[0].id;
  meta.sourceFolders = Folders.assignSources(meta.sourceFolders, refs.slice(0, 4).map(r => r.sourceId), folderId);
  const post = PhotoPost.create(() => 'purpose-saved-post', '2026-10-24T00:00:00.000Z'); post.status = 'saved'; post.title = '독서 뒤 남긴 생각'; post.ops = [{ insert: '읽은 자료를 바탕으로 직접 쓴 익명 글입니다.\n다음 읽기에 이어갈 질문을 남깁니다.\n' }];
  Core.validateWorkspace(bundle); Metadata.validateReferences(bundle, meta); PhotoPost.validate(post);
  const value = { bundle, wb, meta, refs, post, folderId }; await fs.mkdir(path.dirname(datasetFile), { recursive: true }); await fs.writeFile(datasetFile, JSON.stringify(value) + '\n', { flag: 'wx' }); return value;
}
function cloudFixture(data) {
  const server = new CompositionCloud().enableAccountLibrary(), key = server.key(accounts.a.id, id);
  server.rows.set(key, { owner_id: accounts.a.id, id, title: data.bundle.title, revision: 1, data: copy(data.bundle), updated_at: data.bundle.updatedAt });
  server.compositions.set(key, { workspace_id: id, revision: 1, source_revision: 1, data: copy(data.wb), updated_at: data.bundle.updatedAt });
  server.libraryMetadata.set(key, { workspace_id: id, revision: 1, source_revision: 1, data: copy(data.meta), updated_at: data.bundle.updatedAt });
  server.libraryDefaults.set(accounts.a.id, { workspaceId: id, defaultRevision: 1, initialHash: null, initialRevision: null }); return server;
}
async function mode(page, value) { await settle(page); await page.locator('#lifeMain[data-mode="' + value + '"]').waitFor(); }
async function back(page, value) { await page.locator('[data-subview-return]:visible').click(); await mode(page, value); }
async function focused(page, label) { await page.waitForFunction(label => (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent)?.trim() === label, label); }
async function reveal(control) { const ancestors = control.locator('xpath=ancestor::details'); for (let n = await ancestors.count(); n > 0; n--) { const detail = control.locator('xpath=ancestor::details[' + n + ']'); if (!await detail.evaluate(el => el.open)) await detail.locator(':scope > summary').click(); } }
const exact = page => page.evaluate(async id => { const s = HaedoLife.Shell.storage; return { bundle: await s.read(id), workbench: await s.readWorkbench(id), folders: await s.readSourceFolders(id) }; }, id);
async function synced(page) { return wait(() => page.evaluate(id => HaedoLife.Shell.accountLibrary.getState(id), id), state => state.mode === 'account' && state.status === 'synced', 'Account library synced'); }
async function advanceSource(server, suffix) {
  const row = server.row(accounts.a.id, id), old = copy(row.data), source = old.sources[0], previous = old.sourceVersions.filter(v => v.sourceId === source.id).at(-1);
  const prepared = await Core.prepareImport({ origin: source.origin, title: source.title, existingSourceId: source.id, text: previous.contentText + '\r\n' + suffix, authorRelation: 'self' }, old, { forceNewVersion: true });
  row.data = Core.applyChanges(old, Core.buildImportChanges(old, prepared)); row.revision++; row.updated_at = new Date().toISOString();
  return { previous, next: prepared.version, source, expected: copy(row.data) };
}
async function holdCatalog(context) {
  const entered = deferred(), release = deferred();
  const handler = async route => { if (route.request().method() === 'POST' && new URL(route.request().url()).pathname === '/rest/v1/rpc/life_library_catalog') { entered.resolve(); await release.promise; } return route.fallback(); };
  await context.route(cloud + '/**', handler);
  return { async reached() { let timer; try { await Promise.race([entered.promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(Error('Held account catalog was not requested')), 20000); })]); } finally { clearTimeout(timer); } }, async close() { release.resolve(); await context.unroute(cloud + '/**', handler); }, release };
}
async function capture(page, scene, size) {
  await page.evaluate(async () => { await document.fonts.ready; scrollTo({ top: 0, behavior: 'instant' }); }); await page.mouse.move(0, 0);
  const metrics = await page.evaluate(inspectHome, '#lifeApp');
  const layout = await page.evaluate(() => {
    const visible = el => el.checkVisibility({ checkVisibilityCSS: true }) && el.getBoundingClientRect().width > 0 && !el.closest('[hidden]');
    const first = document.querySelector('#lifeSearchResults .life-source-open');
    return { firstMaterialY: first?.getBoundingClientRect().top ?? null, materialButtons: document.querySelectorAll('#lifeSearchResults .life-source-open').length, auxiliaryRowVisible: [...document.querySelectorAll('.life-record-actions')].some(visible), auxiliaryVisibleLabels: [...document.querySelectorAll('.life-record-actions button')].filter(visible).map(el => el.textContent.trim()), smallInputs: [...document.querySelectorAll('#lifeApp input:not([type=checkbox]):not([type=radio]),#lifeApp select,#lifeApp textarea')].filter(visible).filter(el => parseFloat(getComputedStyle(el).fontSize) < 16).map(el => ({ id: el.id, fontSize: getComputedStyle(el).fontSize })), heading: document.querySelector('.life-page-title')?.textContent, navLabels: [...document.querySelectorAll('[data-haedo-navigation] [data-haedo-section]')].map(el => el.getAttribute('aria-label')) };
  });
  const file = scene + '-' + size.width + '.png'; await page.screenshot({ path: path.join(output, file) });
  report.visual.push({ scene, file, sha256: sha(await fs.readFile(path.join(output, file))), ...metrics, ...layout });
  if (!baseline) { assert.equal(metrics.horizontalOverflow, false); assert.deepEqual(metrics.overflow, []); assert.deepEqual(metrics.smallTargets, []); assert.deepEqual(metrics.unnamed, []); assert.deepEqual(metrics.contrastFailures, []); assert.deepEqual(layout.smallInputs, []); }
}
async function main() {
  await assert.rejects(fs.access(output), 'Use a fresh evidence directory'); await fs.mkdir(output, { recursive: true });
  const data = await dataset(); report.datasetSHA256 = sha(await fs.readFile(datasetFile)); report.sourcesBefore = await hashes(sourceFiles); report.fixturesBefore = await hashes(fixtureFiles); report.runnerSHA256 = sha(await fs.readFile(__filename));
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] }); report.browser = browser.version();
  async function check(name, action, size = sizes[1]) {
    if (match && !match.test(name)) return;
    const server = cloudFixture(data), device = 'purpose-' + report.checks.length, context = await makeContext(browser, server, device, accounts.a, { viewport: size, hasTouch: true, reducedMotion: 'reduce' }), pending = new Set();
    const receipt = { device, closed: false, capability: server.libraryCapabilities, staticObserved: 0, staticForwarded: 0 }; report.contexts.push(receipt);
    const forwarded = new Map(), observed = new Set();
    const staticURL = url => url.origin === new URL(base).origin && (/\.(html|js|css|woff2?|json|svg)$/.test(url.pathname) || url.pathname.endsWith('/'));
    function trackStatic(task, url) {
      pending.add(task);
      return task.catch(error => report.staticErrors.push({ device, path: url.pathname, message: error.message })).finally(() => pending.delete(task));
    }
    context.on('request', request => {
      const url = new URL(request.url()), method = request.method(); if (url.origin !== cloud || method === 'OPTIONS') return;
      const row = { device, method, path: url.pathname }; report.privateRequests.push(row);
      const reads = method === 'GET' && ['/auth/v1/user', '/auth/v1/settings', '/rest/v1/life_workspaces', '/rest/v1/life_account_materials', '/rest/v1/haedo_documents', '/rest/v1/haedo_items', '/rest/v1/charts'].includes(url.pathname);
      const auth = method === 'POST' && ['/auth/v1/token', '/auth/v1/logout'].includes(url.pathname);
      const rpc = method === 'POST' && ['life_library_capabilities', 'life_library_open', 'life_library_catalog', 'life_library_meta_get', 'life_library_meta_put', 'life_library_originals_list', 'life_library_original_get', 'life_composition_get', 'life_composition_put', 'life_sync_put', 'life_blog_list', 'life_blog_read'].some(name => url.pathname === '/rest/v1/rpc/' + name);
      if (!(reads || auth || rpc)) report.forbiddenPrivateRequests.push(row);
    });
    await context.route('**/*', route => {
      const request = route.request(), u = new URL(request.url());
      if (staticURL(u) && u.pathname !== '/assets/platform-config.js') {
        // Renderer-owned response bodies disappear on hard navigation, including
        // favicons whose request starts after load. Read the actual server body
        // independently, then forward those exact bytes without a second fetch.
        const task = (async () => {
          const upstream = await route.fetch({ maxRedirects: 0 }), bytes = await upstream.body(), file = u.pathname.slice(1) || 'index.html';
          const row = { device, file, status: upstream.status(), sha256: sha(bytes), bytes: bytes.length, configFixture: false, transport: 'verified-upstream-forward' };
          assert.equal(row.sha256, sha(await fs.readFile(path.join(sourceRoot, file))), 'Actual response differs: ' + file);
          assert(!forwarded.has(request), 'Static request was forwarded twice: ' + file); forwarded.set(request, row);
          await route.fulfill({ response: upstream, body: bytes }); receipt.staticForwarded++;
        })();
        return trackStatic(task, u);
      }
      if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback();
      report.external.push({ device, origin: u.origin, path: u.pathname }); return route.abort('blockedbyclient');
    });
    context.on('response', response => { const u = new URL(response.url()); if (!staticURL(u)) return;
      receipt.staticObserved++;
      const task = (async () => {
        const request = response.request(); assert(!observed.has(request), 'Static response observed twice: ' + u.pathname); observed.add(request);
        if (u.pathname === '/assets/platform-config.js') {
          const bytes = await response.body(); report.staticResponses.push({ device, file: u.pathname.slice(1), status: response.status(), sha256: sha(bytes), bytes: bytes.length, configFixture: true, transport: 'existing-config-fixture' }); return;
        }
        const row = forwarded.get(request); assert(row, 'Static response has no verified forwarded bytes: ' + u.pathname);
        assert.equal(response.status(), row.status, 'Forwarded response status differs: ' + row.file); report.staticResponses.push(row);
      })(); trackStatic(task, u);
    });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => report.pageErrors.push({ device, message: error.message })); page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ device, message: event.text(), path: event.location().url }); });
    console.log('RUN ' + name);
    try {
      await page.goto(base + '/index.html?section=records'); await ready(page); await mode(page, 'sources'); await synced(page);
      assert.equal(await page.evaluate(() => HaedoLife.Shell.storage.getActive()), id); assert((await page.evaluate(() => __homeDbOpens)).every(v => v.verified));
      await page.evaluate(async post => { const s = HaedoLife.Shell.storage; const saved = await s.savePhotoPost(await s.getActive(), post, 0); if (saved.status !== 'saved') throw Error('Real anonymous post seed did not save'); }, data.post);
      await action({ page, context, server, device, data, size, drainStatic: async () => { await page.waitForLoadState('load'); while (pending.size) await Promise.all([...pending]); } });
      assert.deepEqual(server.libraryRouteErrors, []); assert.deepEqual(report.forbiddenPrivateRequests.filter(row => row.device === device), []);
      assert(server.blogCalls.every(call => ['life_blog_list', 'life_blog_read'].includes(call.rpc)), 'Navigation must not save or publish a blog post'); assert.equal(server.saves().length, 0); assert.equal(server.assetCalls.filter(call => call.method !== 'GET').length, 0, 'Navigation must not upload blog originals');
      assert(server.libraryRequests.some(row => row.rpc === 'life_library_capabilities')); receipt.privateRequests = server.requests.length; receipt.libraryRequests = server.libraryRequests.length; receipt.blogReadRPCs = server.blogCalls.map(call => call.rpc); receipt.blogSaves = server.saves().length; receipt.blogAssetWrites = server.assetCalls.filter(call => call.method !== 'GET').length;
      report.checks.push({ name, pass: true }); console.log('PASS ' + name);
    } catch (error) {
      report.checks.push({ name, pass: false, error: error.stack, state: await page.evaluate(() => ({ mode: document.querySelector('#lifeMain')?.dataset.mode, url: location.pathname + location.search, focus: document.activeElement?.getAttribute('aria-label'), error: document.querySelector('#lifeError')?.textContent })).catch(() => null) }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png') }).catch(() => {});
    } finally {
      while (pending.size) await Promise.allSettled([...pending]);
      assert.equal(report.staticResponses.filter(row => row.device === device).length, receipt.staticObserved, 'Every observed static response must have one byte/hash receipt');
      await context.close(); receipt.closed = true;
    }
  }
  try {
    for (const size of sizes) await check('purpose surfaces and preserved exact graph ' + size.width, async ({ page }) => {
      const before = await exact(page); await capture(page, 'records', size);
      await openRecordsMenu(page); await capture(page, 'records-menu', size); await page.keyboard.press('Escape'); await focused(page, '자료 메뉴');
      await nav(page, 'home'); await mode(page, 'home'); await page.waitForFunction(() => document.querySelector('#homeComposition')?.getAttribute('aria-busy') === 'false'); await capture(page, 'home', size);
      await nav(page, 'news'); await mode(page, 'external-discovery'); await page.locator('#discoveryReview').waitFor(); await page.locator('#discoveryNewsSettings').click(); await page.locator('#discoveryNewsSettingsPanel').waitFor({ state: 'visible' }); await capture(page, 'news-settings', size);
      await nav(page, 'tools'); await mode(page, 'tools'); await capture(page, 'planning', size);
      await nav(page, 'manage'); await mode(page, 'manage'); await capture(page, 'settings', size);
      const backup = page.locator('button[aria-label="자료·구성 백업"]'); await reveal(backup); await capture(page, 'settings-files', size);
      assert.deepEqual(await exact(page), before, 'Navigation leaves source versions, saved composition and folders exact');
      if (!baseline) { assert.equal(await page.locator('[data-haedo-navigation] [data-haedo-section="tools"]').getAttribute('aria-label'), '계획'); assert.equal(report.visual.find(row => row.scene === 'records' && row.width === size.width).auxiliaryRowVisible, false); }
    }, size);

    if (!baseline) await check('three material lists preserve filtered origin, keyboard and native back', async ({ page }) => {
      await page.locator('#lifeFolderFilter').selectOption(data.folderId); await page.locator('#lifeSearch').fill('학습');
      const before = await exact(page), results = await page.locator('#lifeSearchResults .life-source-open').evaluateAll(nodes => nodes.map(el => el.dataset.versionId));
      const destinations = [['collection', '컬렉션'], ['activities', '묶음'], ['page', '선택 자료 페이지']];
      for (const [destination, label] of destinations) {
        const menu = await openRecordsMenu(page); const button = menu.locator('[data-focus-key="records:menu:' + destination + '"]'); assert.equal(await button.getAttribute('aria-label'), label); await button.focus(); await page.keyboard.press('Enter'); await mode(page, destination);
        assert.equal(await page.locator('[data-haedo-navigation] [data-haedo-section="records"]').getAttribute('aria-current'), 'page');
        await back(page, 'sources'); await focused(page, label); assert.equal(await page.locator('#lifeRecordsMenu').evaluate(el => el.open), true);
        assert.equal(await page.locator('#lifeFolderFilter').inputValue(), data.folderId); assert.equal(await page.locator('#lifeSearch').inputValue(), '학습'); assert.deepEqual(await page.locator('#lifeSearchResults .life-source-open').evaluateAll(nodes => nodes.map(el => el.dataset.versionId)), results);
      }
      await page.keyboard.press('Escape'); await focused(page, '자료 메뉴');
      await page.locator('#lifeSearchResults .life-source-open').first().click(); await mode(page, 'source'); await page.locator('#lifeSourceText').waitFor(); await page.locator('#lifeSearchReturn').click(); await mode(page, 'sources');
      await nav(page, 'home'); await mode(page, 'home'); await page.goBack(); await mode(page, 'sources');
      assert.equal(await page.locator('#lifeSearch').inputValue(), '학습'); assert.deepEqual(await exact(page), before);
    });

    if (!baseline) await check('six file destinations open their actual controls and return to settings', async ({ page, drainStatic }) => {
      const before = await exact(page); await nav(page, 'manage'); await mode(page, 'manage');
      const cases = [['자료·구성 백업', 'workbench-backup', '#wbBackupDownload'], ['내보내기·사본 복원', 'transfer', 'button[aria-label="JSON 백업"]'], ['컬렉션 백업·복구', 'collection', '.cl-files[open]'], ['보관 범위·근거 파일', 'preservation', '#lifePreservation'], ['연간 계획 파일', 'annual-plan', '#apSettings[open]']];
      for (const [label, destination, actualControl] of cases) {
        const button = page.locator('button[aria-label="' + label + '"]'); await reveal(button); await button.click(); await mode(page, destination); await page.locator(actualControl).waitFor({ state: 'visible' }); await back(page, 'manage'); await focused(page, label);
      }
      const platform = page.locator('a[href="workspace.html?section=manage#backupAll"]'); await reveal(platform); await drainStatic(); await platform.click(); await page.waitForURL(url => url.pathname.endsWith('/workspace.html') && url.hash === '#backupAll'); await page.locator('#backupAll').waitFor({ state: 'visible' }); await drainStatic(); await page.goBack(); await ready(page); await mode(page, 'manage');
      assert.deepEqual(await exact(page), before);
      report.observations.push({ name: 'six-file-destinations', controlsOpened: cases.map(row => row[2]).concat('#backupAll'), browserBackFromExternalPage: true });
    });

    if (!baseline) await check('accepted remote version preserves an open material menu and exact focused action', async ({ page, context, server }) => {
      const changed = await advanceSource(server, '다른 기기에서 보관한 새 원문'), gate = await holdCatalog(context);
      try {
        await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await gate.reached();
        const menu = await openRecordsMenu(page), action = menu.locator('[data-focus-key="records:menu:collection"]'); await action.focus();
        await page.evaluate(() => { window.__purposeFocusedAction = document.activeElement; });
        gate.release.resolve(); await wait(() => exact(page), state => state.bundle.sourceVersions.some(v => v.id === changed.next.id), 'Remote exact version received'); await synced(page);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await menu.evaluate(el => el.open), true); await focused(page, '컬렉션');
        assert.deepEqual((await exact(page)).bundle.sourceVersions, changed.expected.sourceVersions);
        await page.keyboard.press('Enter'); await mode(page, 'collection'); await back(page, 'sources'); await focused(page, '컬렉션');
        report.observations.push({ name: 'remote-menu-update', exactVersionArrived: true, menuAndFocusedActionPreserved: true, realActionAndReturn: true });
      } finally { await gate.close(); }
    }, sizes[2]);

    if (!baseline) await check('background receive preserves composing search value, caret and input identity', async ({ page, context, server }) => {
      const changed = await advanceSource(server, '조합 입력 중 도착하는 새 판'), gate = await holdCatalog(context), text = '외국어 학습';
      try {
        await page.reload({ waitUntil: 'domcontentloaded' }); await gate.reached(); await ready(page); await mode(page, 'sources'); await page.locator('#lifeSearch').focus();
        await page.locator('#lifeSearch').evaluate((el, text) => { window.__purposeSearchInput = el; el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); el.value = text; el.setSelectionRange(1, 4); el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: text })); }, text);
        gate.release.resolve(); await wait(() => exact(page), state => state.bundle.sourceVersions.some(v => v.id === changed.next.id), 'Version arrived during composition');
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.deepEqual(await page.locator('#lifeSearch').evaluate(el => ({ same: el === __purposeSearchInput, value: el.value, start: el.selectionStart, end: el.selectionEnd, focused: el === document.activeElement })), { same: true, value: text, start: 1, end: 4, focused: true });
        await page.locator('#lifeSearch').dispatchEvent('compositionend', { data: text }); await synced(page);
        assert.deepEqual((await exact(page)).bundle.sourceVersions, changed.expected.sourceVersions);
        report.observations.push({ name: 'composing-search', sameInput: true, exactValueCaretFocus: true, incomingExactVersion: true });
      } finally { await gate.close(); }
    });

    if (!baseline) await check('exact reader and selected original text survive incoming version and reader return', async ({ page, context, server }) => {
      const changed = await advanceSource(server, '읽던 판을 대체해서는 안 되는 새 버전'), gate = await holdCatalog(context);
      try {
        await page.reload({ waitUntil: 'domcontentloaded' }); await gate.reached(); await ready(page); await mode(page, 'sources');
        await page.locator('#lifeSearch').fill('외국어'); await page.locator('.life-source-open[data-version-id="' + changed.previous.id + '"]').click(); await mode(page, 'source'); await page.locator('#lifeSourceText').waitFor();
        const raw = page.locator('#lifeExcerptToggle'); if (await raw.count()) await raw.click(); await page.waitForFunction(() => document.querySelector('#lifeSourceText')?.dataset.readingMode === 'raw');
        assert.equal(await page.locator('#lifeSourceText').textContent(), changed.previous.contentText);
        const selection = await page.locator('#lifeSourceText').evaluate(el => { const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), term = '보존할 구절🌱'; let node; while (walker.nextNode()) { if (walker.currentNode.textContent.includes(term)) { node = walker.currentNode; break; } } if (!node) throw Error('Exact original selection text missing'); const start = node.textContent.indexOf(term), range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + term.length); const selected = getSelection(); selected.removeAllRanges(); selected.addRange(range); window.__purposeSelectedTextNode = node; return { text: selected.toString(), start, end: start + term.length }; });
        gate.release.resolve(); await wait(() => exact(page), state => state.bundle.sourceVersions.some(v => v.id === changed.next.id), 'New version behind reader'); await synced(page);
        assert.equal(await page.locator('#lifeSourceText').textContent(), changed.previous.contentText);
        assert.deepEqual(await page.evaluate(() => { const selected = getSelection(); return { text: selected.toString(), start: selected.anchorOffset, end: selected.focusOffset, same: selected.anchorNode === __purposeSelectedTextNode && selected.focusNode === __purposeSelectedTextNode }; }), { ...selection, same: true });
        await page.locator('#lifeSearchReturn').click(); await mode(page, 'sources'); assert.equal(await page.locator('#lifeSearch').inputValue(), '외국어');
        await page.waitForFunction(versionId => document.activeElement?.dataset.versionId === versionId, changed.previous.id);
        assert.deepEqual((await exact(page)).bundle.sourceVersions, changed.expected.sourceVersions);
        report.observations.push({ name: 'exact-reader', oldTextAndSelectionNodePreserved: true, readerReturnPreservedSearchAndExactVersionFocus: true, incomingVersionPreservedSeparately: true });
      } finally { await gate.close(); }
    });
  } finally {
    await browser.close(); report.browserClosed = true; report.sourcesAfter = await hashes(sourceFiles); report.fixturesAfter = await hashes(fixtureFiles); report.runnerSHA256After = sha(await fs.readFile(__filename));
    report.sourcesUnchanged = JSON.stringify(report.sourcesBefore) === JSON.stringify(report.sourcesAfter); report.fixturesUnchanged = JSON.stringify(report.fixturesBefore) === JSON.stringify(report.fixturesAfter); report.runnerUnchanged = report.runnerSHA256 === report.runnerSHA256After;
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  assert(report.sourcesUnchanged && report.fixturesUnchanged && report.runnerUnchanged, 'Source and runner pins must stay unchanged during execution');
  for (const key of ['pageErrors', 'consoleErrors', 'external', 'staticErrors', 'forbiddenPrivateRequests']) assert.deepEqual(report[key], [], key);
  assert(report.checks.length > 0 && report.checks.every(row => row.pass), 'All selected checks must pass');
  console.log('Purpose workflow: ' + report.checks.length + ' checks, ' + report.visual.length + ' captures; all contexts and browser closed.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

/* Exact v162/v163/v166/v167 -> v168 SW, cached public catalog and private local reactions.
 * Prior SW script only is old; app modules are current. Real SDK/IDB/SW with
 * anonymous Auth HTTP. No real account, source-site fetch or model download. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), http = require('node:http');
const { createHash } = require('node:crypto');
const project = path.resolve(__dirname, '..'), output = path.resolve(process.env.EXTERNAL_DISCOVERY_PWA_OUTPUT || path.join(project, '.local/external-discovery-pwa'));
const feedPath = '/assets/life/discovery-feed.json', feedCache = 'haedo-discovery-feed-v2';
// Fixed historical Git objects only; callers cannot substitute worker paths or hashes.
const previousWorkers = Object.freeze({
  '167': Object.freeze({ file: 'fixtures/external-discovery/sw-discovery-v167.js', commit: 'e270c0db0f47604e833dec3c0e1c819f23cb1053', sha256: '7433b221e0182fa725e9c7c5f79b360a2a723006746a5d156512fe9424c9bf4c' }),
  '166': Object.freeze({ file: 'fixtures/external-discovery/sw-discovery-v166.js', commit: '55a74ae47e400261b6f3469f9bc3f4a8f76d7898', sha256: '0114abb8ec31ffba1f04335a11ae49b6927292a8ffa822a548e96e566f415f8c' }),
  '162': Object.freeze({ file: 'fixtures/external-discovery/sw-discovery-v162.js', commit: 'c9c21ef21cda138f1a81bacc808199dedf49b3a3', sha256: 'a6de8d7cfabdb8ae37e234c1d79e38f05aba68587df3225acfd9de01bf5825ee' }),
  '163': Object.freeze({ file: 'fixtures/external-discovery/sw-discovery-v163.js', commit: '6126123c12af12daeca6b9679ce1201095c89367', sha256: '186a65617f0fc05a3dfb38cd7c011c33d20410dc25e773d8ecdd844ee85567de' })
});
const previousVersion = process.env.EXTERNAL_DISCOVERY_PWA_PREVIOUS_VERSION === undefined ? '167' : process.env.EXTERNAL_DISCOVERY_PWA_PREVIOUS_VERSION;
assert.ok(Object.hasOwn(previousWorkers, previousVersion), 'Previous worker must be the fixed version 162, 163, 166 or 167');
const previousWorker = previousWorkers[previousVersion];
const assets = ['library-meta.js','library-remote.js','library-meta-sync.js','library-originals-remote.js','account-library.js','source-folders.js', 'source-folders-ui.js', 'source-folders.css', 'annual-plan.js', 'annual-plan-ui.js', 'annual-plan.css', 'source-markdown.js', 'source-markdown.css', 'discovery.js', 'discovery-profile.js', 'discovery-settings.js', 'discovery-language-settings.js', 'discovery-actions.js', 'discovery-recommendations.js', 'discovery-reading.js', 'discovery-reading-ui.js', 'discovery-private-remote.js', 'discovery-reader-ui.js', 'discovery-ui.js', 'discovery.css'].map(file => 'assets/life/' + file).concat('vendor/js-yaml/js-yaml.umd.min.js', 'assets/platform-auth.js', 'assets/life/ui.js', 'assets/life/shell.js', 'assets/haedo-navigation.js', 'assets/life/blog-manager.js', 'assets/life/home.css', 'assets/life/home.js', 'assets/life/photo-post-ui.js', 'assets/life/preservation-ui.js', 'assets/life/ui.css', 'assets/life/workbench-ui.js', 'assets/platform-ui.js', 'goals.html', 'habits.html', 'workspace.html', 'assets/life/obsidian-link-candidates.js', 'assets/life/obsidian-link-commit.js', 'assets/life/obsidian-link-candidates-ui.js', 'assets/life/photo-post.js');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// Follow the actual settings/back buttons before opening native disclosures.
async function newsView(control) {
  const page = control.page(), panel = page.locator('#discoveryNewsSettingsPanel');
  if (!await panel.count()) return;
  // Resolve the stable containing view before a redraw can detach its button.
  const view = await control.locator('xpath=ancestor-or-self::*[@id="discoveryNewsSettingsPanel" or @id="discoveryReview"][1]').getAttribute('id');
  assert(['discoveryNewsSettingsPanel', 'discoveryReview'].includes(view));
  const settingsTarget = view === 'discoveryNewsSettingsPanel';
  if (settingsTarget && !await panel.isVisible()) await page.locator('#discoveryNewsSettings').click();
  else if (!settingsTarget && await panel.isVisible()) await page.locator('#discoveryNewsSettingsBack').click();
}
async function selectNewsMode(page, value) {
  await newsView(page.locator('#discoveryDiscover'));
  if (await page.locator('#discoverySort').isHidden()) await page.locator('#discoveryDiscover').click();
  await page.locator('#discoverySort').selectOption(value);
}
// Open actual native disclosures, outermost first, before using a moved control.
async function revealControl(control) {
  await newsView(control);
  const depth = await control.locator('xpath=ancestor::details').count();
  for (let index = depth; index > 0; index--) {
    const details = control.locator('xpath=ancestor::details[' + index + ']');
    if (!await control.isVisible() && !await details.evaluate(element => element.open)) await details.locator(':scope > summary').click();
  }
  return control;
}
const report = { createdAt: new Date().toISOString(), checks: [], consoleErrors: [], pageErrors: [], expectedTransportErrors: [], modelRequests: [], unexpectedExternal: [], catalogRequests: [], blockedProbes: [],
  previousWorker: { version: previousVersion, ...previousWorker },
  scope: 'Real Chromium SDK/IndexedDB/Service Worker. Only the selected exact v' + previousVersion + ' sw.js is prior code; all app modules and approved-source policy are current. Virtual folders, annual plans, reactions and five-language settings are seeded through the current real scoped storage API before the worker update; an actual a0eac63 v3 historical reading row is seeded unchanged into synthetic local metadata under its original workspace ID. This isolates worker/cache migration rather than reconstructing the entire previous app. Real prepared public catalog served by an anonymous local fixture; synthetic title/build-time update for freshness tests. Mocked Auth response during cached-shell reload is separate from strict offline Auth refusal. No production, Apple device, upstream collection or model validation.' };
async function wait(page, fn, arg) {
  const end = Date.now() + 45000;
  while (Date.now() < end) { if (await page.evaluate(fn, arg)) return; await new Promise(resolve => setTimeout(resolve, 80)); }
  throw Error('Discovery PWA state did not settle');
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const oldSw = await fs.readFile(path.join(__dirname, previousWorker.file));
  const newSw = await fs.readFile(path.join(project, 'sw.js'));
  const historicalBytes = await fs.readFile(path.join(__dirname, 'fixtures/discovery-reading-v3.json'));
  assert.equal(sha(historicalBytes), '356402734efb25d79acf9fbf217a90bd7baed7ca601ff52dced71ad3711df3da', 'Historical v3 reading fixture must retain its original bytes');
  const historicalReading = JSON.parse(historicalBytes);
  const cacheName = data => data.toString().match(/const CACHE\s*=\s*['"]([^'"]+)/)[1];
  report.oldCache = cacheName(oldSw); report.newCache = cacheName(newSw);
  assert.equal(report.oldCache, 'haedo-v' + previousVersion); assert.equal(report.newCache, 'haedo-v168');
  report.oldSwSHA256 = sha(oldSw); report.newSwSHA256 = sha(newSw);
  assert.equal(report.oldSwSHA256, previousWorker.sha256, 'Prior worker must be the exact ' + previousWorker.commit + ' v' + previousVersion + ' source');
  let old = true, failCatalog = false, strictOffline = false, transportProbe = false, probing = false;
  const originalFeed = JSON.parse(await fs.readFile(path.join(project, feedPath.slice(1)), 'utf8'));
  let feed = structuredClone(originalFeed);
  assert.ok(feed.articles.length > 0, 'Prepared public catalog is required');
  const mime = { '.js': 'application/javascript', '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
  const host = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://fixture.invalid');
      if (url.pathname === feedPath) {
        report.catalogRequests.push({ method: request.method, queryCount: [...url.searchParams.keys()].length, hasCookie: !!request.headers.cookie, hasAuthorization: !!request.headers.authorization, hasBody: Number(request.headers['content-length'] || 0) > 0, referer: request.headers.referer || null });
        response.writeHead(failCatalog ? 503 : 200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(failCatalog ? '{"error":"synthetic catalog failure"}' : JSON.stringify(feed)); return;
      }
      const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const target = path.resolve(project, relative);
      if (!target.startsWith(project + path.sep)) { response.writeHead(404); response.end(); return; }
      const body = relative === 'sw.js' ? old ? oldSw : newSw : relative === 'assets/platform-config.js'
        ? 'window.HAEDO_CONFIG=Object.freeze({url:"https://life-sync-test.supabase.co",key:"sb_publishable_anonymous_browser_test_only"});'
        : await fs.readFile(target);
      response.writeHead(200, { 'content-type': mime[path.extname(relative)] || 'application/octet-stream', 'cache-control': 'no-store', 'service-worker-allowed': '/' }); response.end(body);
    } catch (_) { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => host.listen(0, '127.0.0.1', resolve));
  process.env.BASE_URL = 'http://127.0.0.1:' + host.address().port;
  const { FakeCloud, platformContext, accounts, cloud, base } = require('./life-sync-browser.cjs');
  const { playwright, ready } = require('./unified-home-browser.cjs');
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 820, height: 1000 } }), fake = new FakeCloud(), device = 'discovery-pwa-anonymous';
  await platformContext(context, fake, device, accounts.a);
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (/huggingface|xethub|onnxruntime|transformers|\.wasm(?:$|\?)/i.test(url.href)) report.modelRequests.push(url.origin + url.pathname);
    if ([base, cloud].includes(url.origin)) return route.fallback();
    report.unexpectedExternal.push({ origin: url.origin, path: url.pathname, method: request.method(), hasBody: !!request.postData() }); return route.abort('blockedbyclient');
  });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') (strictOffline || transportProbe || probing || failCatalog ? report.expectedTransportErrors : report.consoleErrors).push(message.text()); });
  const open = async view => { await page.goto(base + '/index.html?section=tools&view=' + view); await ready(page); await page.locator(view === 'interests' ? '#interestManual' : '#discoveryReview').waitFor(); };
  const idle = () => wait(page, () => document.querySelector('#discoveryRefresh') && !document.querySelector('#discoveryRefresh').disabled);
  const state = () => page.evaluate(async () => { const s = HaedoLife.Shell.storage, workspace = await s.getActive(); return { bundle: await s.read(workspace), workbench: await s.readWorkbench(workspace), manual: await s.readInterestProfile(workspace), discovery: await s.readDiscoveryProfile(workspace), settings: await s.readDiscoverySettings(workspace), languageSettings: await s.readDiscoveryLanguageSettings(workspace), actions: await s.readDiscoveryActions(workspace), reading: await s.readDiscoveryReading(workspace), annualPlan: await s.readAnnualPlan(workspace), sourceFolders: await s.readSourceFolders(workspace) }; });
  const catalog = () => page.evaluate(async () => {
    const response = await fetch('assets/life/discovery-feed.json', { method: 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    return { ok: response.ok, cache: response.headers.get('X-Haedo-Discovery-Cache'), browserFetchedAt: response.headers.get('X-Haedo-Discovery-Fetched-At'), feed: await response.json() };
  });
  const check = async (name, action) => { await action(); report.checks.push(name); console.log('PASS ' + name); };
  try {
    await open('interests');
    await check('actual v' + previousVersion + ' installs without fetching catalog, original sites or model assets', async () => {
      await wait(page, async name => (await caches.keys()).includes(name) && !!navigator.serviceWorker.controller && (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated', report.oldCache);
      assert.equal(report.catalogRequests.length, 0); assert.deepEqual(report.modelRequests, []); assert.deepEqual(report.unexpectedExternal, []);
    });
    await page.evaluate(async ({ historical, account }) => {
      const storage = HaedoLife.Shell.storage, bundle = HaedoLife.Core.createWorkspace({ title: '합성 v3 역사행 보존', workspaceId: historical.workspaceId });
      await storage.installWorkspace(bundle);
      HaedoLife.DiscoveryReading.validate(historical);
      // Simulate the exact row committed by v3, without rebuilding it with the
      // current ranker or stepping its historical revision through the new API.
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('life-tools-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try {
        await new Promise((resolve, reject) => {
          const transaction = db.transaction('meta', 'readwrite');
          transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error || Error('Historical reading seed aborted'));
          transaction.objectStore('meta').put({ key: `discoveryReading:${JSON.stringify([account.projectUrl, account.userId])}:${historical.workspaceId}`, value: historical });
        });
      } finally { db.close(); }
    }, { historical: historicalReading, account: { projectUrl: cloud, userId: accounts.a.id } });
    await open('interests');
    await page.evaluate(async publicFeed => {
      const s = HaedoLife.Shell.storage, core = HaedoLife.Core, id = await s.getActive(); const bundle = await s.read(id);
      const prepared = await core.prepareImport({ origin: 'other', title: '발견 갱신 보존용 합성 원문', format: 'text/markdown', text: '\ufeff---\r\ntitle: 익명 학습 계획\r\ndate: 2026-01-02\r\ntags: [learning, reading]\r\nrelated: [\"[[참고 기록]]\"]\r\n---\r\n\r\n# 한글 😀 원문\r\nCafe\u0301 · 원본 줄바꿈과 작성자 정보를 유지합니다.', authorRelation: 'self', forceSeparate: true }, bundle);
      const result = await s.commitLocal({ workspaceId: id, baseRevision: bundle.revision, operationId: core.id(), changes: core.buildImportChanges(bundle, prepared, []) });
      if (result.status !== 'stored') throw Error('Anonymous source fixture failed');
      const foldersModel = HaedoLife.SourceFolders, initialFolders = await s.readSourceFolders(id);
      let folders = foldersModel.createFolder(initialFolders, { name: '합성 보존 폴더', parentId: null });
      folders = foldersModel.createFolder(folders, { name: '합성 하위 폴더', parentId: folders.folders[0].id });
      folders = foldersModel.assignSources(folders, [prepared.source.id], folders.folders[1].id);
      await s.saveSourceFolders(id, folders, initialFolders.revision);
      const manual = await s.readInterestProfile(id), next = HaedoLife.InterestProfile.setManual(manual, [{ id: 'manual-pwa', label: '개발과 문화' }], { expectedRevision: manual.revision });
      if ((await s.saveInterestProfile(id, next, manual.revision)).status !== 'stored') throw Error('Anonymous manual fixture failed');
      const profile = await s.readDiscoveryProfile(id), feedback = HaedoLife.DiscoveryProfile.setFeedback(profile, { id: 'pwa-public-article', canonicalUrl: 'https://example.org/article?id=1' }, 'already_read', { expectedRevision: profile.revision });
      if ((await s.saveDiscoveryProfile(id, feedback, profile.revision)).status !== 'stored') throw Error('Anonymous feedback fixture failed');
      const settings = await s.readDiscoverySettings(id), changedSettings = HaedoLife.DiscoverySettings.update(settings, { disabledSourceIds: ['naver-d2'] }, { expectedRevision: settings.revision });
      if ((await s.saveDiscoverySettings(id, changedSettings, settings.revision)).status !== 'stored') throw Error('Anonymous settings fixture failed');
      const language = await s.readDiscoveryLanguageSettings(id), changedLanguage = HaedoLife.DiscoveryLanguageSettings.update(language, { contentLanguages: ['ko', 'en', 'ja', 'zh', 'fr'], translationTarget: 'ko' }, { expectedRevision: language.revision });
      if ((await s.saveDiscoveryLanguageSettings(id, changedLanguage, language.revision)).status !== 'stored') throw Error('Anonymous language settings fixture failed');
      const annual = await s.readAnnualPlan(id), changedAnnual = HaedoLife.AnnualPlan.update(annual, { birthDate: '2000-02-29', basis: 'birthday', ageMode: 'both', rows: [{year:2026,text:'합성 연간 계획'}], entries:[{id:'pwa-plan',date:'2026-05-15',text:'합성 월 계획'}] }, { expectedRevision: annual.revision });
      if ((await s.saveAnnualPlan(id, changedAnnual, annual.revision)).status !== 'stored') throw Error('Anonymous annual plan fixture failed');
      const actionsModel = HaedoLife.DiscoveryActions;
      const normalized = HaedoLife.Discovery.validateFeed(publicFeed), unique = [...new Map(normalized.articles.map(article => [article.canonicalUrl, article])).values()];
      if (unique.length < 2) throw Error('Two distinct allowlisted public articles are required for active and cancelled reaction fixtures');
      const snapshots = unique.slice(0, 2).map(article => actionsModel.capture(article, normalized.sources.find(source => source.id === article.sourceId)));
      let actions = await s.readDiscoveryActions(id);
      const saveActions = async candidate => {
        const saved = await s.saveDiscoveryActions(id, candidate, actions.revision);
        if (saved.status !== 'stored') throw Error('Anonymous reactions fixture failed');
        actions = saved.profile;
      };
      await saveActions(actionsModel.setReaction(actions, snapshots[0], 'liked', true, { expectedRevision: actions.revision }));
      await saveActions(actionsModel.setReaction(actions, snapshots[0], 'bookmarked', true, { expectedRevision: actions.revision }));
      await saveActions(actionsModel.setReaction(actions, snapshots[1], 'bookmarked', true, { expectedRevision: actions.revision }));
      await saveActions(actionsModel.setReaction(actions, snapshots[1], 'bookmarked', false, { expectedRevision: actions.revision }));
      await saveActions(actionsModel.setPersonalization(actions, true, { expectedRevision: actions.revision }));
    }, originalFeed);
    const before = await state();
    assert.deepEqual(before.reading, historicalReading);
    assert.equal(before.sourceFolders.folders.length, 2); assert.equal(before.sourceFolders.assignments.length, 1);
    assert.equal(before.sourceFolders.assignments[0].sourceId, before.bundle.sources.find(source => source.title === '발견 갱신 보존용 합성 원문').id);
    report.privateFoldersFixture = { revision: before.sourceFolders.revision, folders: 2, assignments: 1, sha256: sha(Buffer.from(JSON.stringify(before.sourceFolders))) };
    assert.equal(before.annualPlan.entries[0].date, '2026-05-15'); assert.equal(before.annualPlan.rows[0].text, '합성 연간 계획');
    assert.deepEqual(before.languageSettings.contentLanguages, ['ko', 'en', 'ja', 'zh', 'fr']); assert.equal(before.languageSettings.translationTarget, 'ko');
    assert.equal(before.actions.personalizationEnabled, true);
    assert.equal(before.actions.entries.length, 2);
    assert.ok(before.actions.entries.some(entry => entry.liked && entry.bookmarked));
    assert.ok(before.actions.entries.some(entry => !entry.liked && !entry.bookmarked && entry.likedAt === null && entry.bookmarkedAt === null));
    report.privateActionsFixture = { revision: before.actions.revision, entries: before.actions.entries.length, activeBoth: 1, cancelled: 1, personalizationEnabled: true, sha256: sha(Buffer.from(JSON.stringify(before.actions))) };
    await page.evaluate(async () => { const old = await caches.open('haedo-discovery-feed-v1'); await old.put(new URL('assets/life/discovery-feed.json', location.href), new Response(JSON.stringify({ privateBody: 'synthetic previous body', images: ['synthetic image'] }))); });
    await check('v' + previousVersion + ' -> v168 worker preserves exact originals, workbench, manual interests, feedback, old settings, five language preferences, private reactions, virtual folders, annual plans and historical v3 reading', async () => {
      old = false; await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
      await wait(page, async ({ oldCache, newCache }) => { const keys = await caches.keys(), r = await navigator.serviceWorker.getRegistration(); return !keys.includes(oldCache) && keys.includes(newCache) && r?.active?.state === 'activated' && navigator.serviceWorker.controller === r.active; }, { oldCache: report.oldCache, newCache: report.newCache });
      assert.equal(await page.evaluate(async () => (await caches.keys()).includes('haedo-discovery-feed-v1')), false, 'Old article cache must be removed before takeover');
      await page.reload(); await ready(page); assert.deepEqual(await state(), before);
      assert.equal(report.catalogRequests.length, 0);
    });
    await check('new local modules match installed hashes; public feed and model weights stay outside app SHELL', async () => {
      const installed = await page.evaluate(async ({ name, assets }) => { const cache = await caches.open(name); return { urls: (await cache.keys()).map(r => r.url), hashes: await Promise.all(assets.map(async file => { const response = await cache.match(new URL(file, location.href)); return { file, sha256: response ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('') : null }; })) }; }, { name: report.newCache, assets });
      assert.deepEqual(installed.hashes, await Promise.all(assets.map(async file => ({ file, sha256: sha(await fs.readFile(path.join(project, file))) }))));
      assert.ok(installed.urls.every(url => new URL(url).origin === base)); assert.ok(!installed.urls.some(url => /discovery-feed\.json|\.onnx|\.wasm|huggingface|onnxruntime/.test(url)));
      report.installed = installed.hashes; report.shellAssets = installed.urls.length;
    });
    let first, fresh;
    await check('explicit catalog load uses one fixed public URL and separates browser receipt from collection time', async () => {
      await context.addCookies([{ name: 'anonymous-private-canary', value: 'synthetic', url: base }]);
      await open('external-discovery'); await idle(); await selectNewsMode(page, 'latest');
      await page.locator('article[data-discovery-id]').first().waitFor();
      first = await catalog(); assert.equal(first.cache, 'network'); assert.equal(first.feed.generatedAt, feed.generatedAt); assert.ok(Number.isFinite(Date.parse(first.browserFetchedAt)));
      const comparison = page.locator('#discoveryReadingComparison');
      if (!await comparison.evaluate(element => element.open)) await (await revealControl(page.locator('#discoveryReadingSummary'))).click();
      const answered = historicalReading.session.reviews.find(row => row.reading === 'full'), article = page.locator('article[data-reading-url=' + JSON.stringify(answered.canonicalUrl) + ']');
      await article.waitFor();
      for (const field of ['intent', 'reading', 'helpful', 'reason']) assert.equal(await article.locator('[data-reading-field=' + JSON.stringify(field) + ']').inputValue(), answered[field]);
      assert.equal(await page.locator('#discoveryReadingPreference').inputValue(), historicalReading.session.preference);
      await (await revealControl(page.locator('#discoveryReadingConditions > summary'))).click();
      assert.match(await page.locator('#discoveryReadingConditions').innerText(), /public-title-tag-expressions-v3/);
      assert.deepEqual((await state()).reading, historicalReading);
      report.historicalReadingFixture = { sha256: sha(historicalBytes), workspaceId: historicalReading.workspaceId, policy: historicalReading.session.personal.policy, revision: historicalReading.revision, exactRowPreserved: true, actualUIReopened: true, scope: 'Synthetic frozen v3 judgments; not actual user reading or usefulness.' };
      await page.locator('#discoveryReadingSummary').click();
      await (await revealControl(page.locator('.discovery-sources summary'))).click();
      assert.match(await page.locator('.discovery-sources').innerText(), /출처 사이트의 새 글 수집을 실행하지 않습니다/);
      assert.deepEqual(report.unexpectedExternal, []);
    });
    await check('a newer published catalog is fetched without worker update and failed refresh returns explicitly stale data', async () => {
      feed = structuredClone(originalFeed); feed.generatedAt = new Date(Date.now() + 1000).toISOString(); feed.articles[0].title = 'PWA 갱신 확인 · ' + feed.articles[0].title;
      await (await revealControl(page.locator('#discoveryRefresh'))).click(); await idle(); fresh = await catalog();
      assert.equal(fresh.cache, 'network'); assert.equal(fresh.feed.generatedAt, feed.generatedAt); assert.equal(fresh.feed.articles[0].title, feed.articles[0].title);
      failCatalog = true;
      await (await revealControl(page.locator('#discoveryRefresh'))).click(); await idle(); const stale = await catalog();
      assert.equal(stale.cache, 'stale'); assert.equal(stale.browserFetchedAt, fresh.browserFetchedAt); assert.equal(stale.feed.generatedAt, fresh.feed.generatedAt);
      await revealControl(page.locator('.discovery-feed-notice')); assert.match(await page.locator('.discovery-feed-notice').innerText(), /일부 출처 갱신 지연/);
      report.catalogFreshness = { firstGeneratedAt: first.feed.generatedAt, updatedGeneratedAt: fresh.feed.generatedAt, browserFetchedAt: fresh.browserFetchedAt, fallbackPreservedBrowserFetchedAt: stale.browserFetchedAt };
      failCatalog = false;
    });
    let changed;
    await check('verified offline session saves private feedback and cached-shell reload preserves it', async () => {
      await context.setOffline(true); await (await revealControl(page.locator('#discoveryRefresh'))).click(); await idle();
      const article = page.locator('article[data-discovery-id]').first();
      await (await revealControl(article.locator('button[data-discovery-feedback="already_read"]'))).click();
      await wait(page, async length => { const s = HaedoLife.Shell.storage; return (await s.readDiscoveryProfile(await s.getActive())).feedback.length === length; }, before.discovery.feedback.length + 1);
      changed = await state(); assert.deepEqual(changed.bundle, before.bundle); assert.deepEqual(changed.manual, before.manual); assert.deepEqual(changed.workbench, before.workbench); assert.deepEqual(changed.actions, before.actions); assert.deepEqual(changed.reading, before.reading);
      const response = await page.reload(); assert.equal(response.fromServiceWorker(), true); await ready(page); await page.locator('#discoveryReview').waitFor(); await idle();
      assert.deepEqual(await state(), changed); await revealControl(page.locator('.discovery-feed-notice')); assert.match(await page.locator('.discovery-feed-notice').innerText(), /일부 출처 갱신 지연/);
      transportProbe = true; assert.equal(await page.evaluate(async () => { try { await fetch('non-shell-offline-probe', { cache: 'no-store' }); return false; } catch (_) { return true; } }), true); await page.waitForTimeout(50); transportProbe = false;
    });
    await check('excluded feedback can be restored after reload without mutating source data or manual interests', async () => {
      const added = changed.discovery.feedback.find(row => !before.discovery.feedback.some(old => old.canonicalUrl === row.canonicalUrl));
      await (await revealControl(page.locator('.discovery-excluded summary'))).click();
      await page.locator('[data-discovery-undo="' + added.articleId + '"]').click();
      await wait(page, async length => { const s = HaedoLife.Shell.storage; return (await s.readDiscoveryProfile(await s.getActive())).feedback.length === length; }, before.discovery.feedback.length);
      const after = await state(); assert.deepEqual(after.discovery.feedback, before.discovery.feedback); assert.ok(after.discovery.revision > changed.discovery.revision);
      assert.deepEqual(after.bundle, before.bundle); assert.deepEqual(after.manual, before.manual); assert.deepEqual(after.workbench, before.workbench); assert.deepEqual(after.actions, before.actions); assert.deepEqual(after.reading, before.reading);
    });
    await check('catalog with no previous cache fails visibly; strict offline Auth still blocks private boot and recovery preserves data', async () => {
      transportProbe = true; await page.evaluate(async key => caches.delete(key), feedCache); await page.reload(); await ready(page); await page.locator('#discoveryError').waitFor({ state: 'visible' });
      assert.equal(await page.locator('article[data-discovery-id]').count(), 0); transportProbe = false;
      strictOffline = true; fake.offline.add(device); await page.reload();
      await wait(page, () => document.querySelector('#lifeApp')?.hidden && /인터넷 연결|로그인/.test(document.body.innerText));
      assert.equal(await page.locator('#discoveryReview').count(), 0);
      fake.offline.delete(device); await context.setOffline(false); strictOffline = false;
      await open('external-discovery'); await idle(); const after = await state(); assert.deepEqual(after.bundle, before.bundle); assert.deepEqual(after.manual, before.manual); assert.deepEqual(after.discovery.feedback, before.discovery.feedback); assert.deepEqual(after.settings, before.settings); assert.deepEqual(after.languageSettings, before.languageSettings); assert.deepEqual(after.actions, before.actions); assert.deepEqual(after.reading, before.reading);
    });
    await check('catalog query, authorization and body probes fail before reaching the static host', async () => {
      const count = report.catalogRequests.length; probing = true;
      report.blockedProbes = await page.evaluate(async () => { const base = 'assets/life/discovery-feed.json'; const rows = [];
        for (const [url, init] of [[base + '?private=synthetic', {}], [base, { headers: { authorization: 'Bearer anonymous-synthetic' } }], [base, { method: 'POST', body: 'anonymous synthetic marker' }]]) {
          let rejected = false; try { await fetch(url, init); } catch (_) { rejected = true; } rows.push({ rejected });
        } return rows;
      }); await page.waitForTimeout(50); probing = false;
      assert.ok(report.blockedProbes.every(row => row.rejected)); assert.equal(report.catalogRequests.length, count);
    });
    assert.ok(report.catalogRequests.length > 2);
    assert.ok(report.catalogRequests.every(row => row.method === 'GET' && !row.queryCount && !row.hasCookie && !row.hasAuthorization && !row.hasBody && !row.referer));
    assert.deepEqual(report.modelRequests, []); assert.deepEqual(report.unexpectedExternal, []); assert.equal(fake.writes().length, 0); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []);
    report.realRemoteWrites = 0; report.pass = true;
  } catch (error) { report.failure = { message: error.message, stack: error.stack }; throw error; }
  finally { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); await context.close(); await browser.close(); await new Promise(resolve => host.close(resolve)); }
  console.log('External discovery PWA: ' + report.checks.length + ' passed; model/original-site requests 0.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

/* Actual v134 -> current SW, cached public catalog and private local feedback.
 * Prior SW script only is old; app modules are current. Real SDK/IDB/SW with
 * anonymous Auth HTTP. No real account, source-site fetch or model download. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), http = require('node:http');
const { createHash } = require('node:crypto');
const project = path.resolve(__dirname, '..'), output = path.resolve(process.env.EXTERNAL_DISCOVERY_PWA_OUTPUT || path.join(project, '.local/external-discovery-pwa'));
const feedPath = '/assets/life/discovery-feed.json', feedCache = 'haedo-discovery-feed-v1';
const assets = ['discovery.js', 'discovery-profile.js', 'discovery-settings.js', 'discovery-ui.js', 'discovery.css'].map(file => 'assets/life/' + file);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { createdAt: new Date().toISOString(), checks: [], consoleErrors: [], pageErrors: [], expectedTransportErrors: [], modelRequests: [], unexpectedExternal: [], catalogRequests: [], blockedProbes: [],
  scope: 'Real Chromium SDK/IndexedDB/Service Worker. Only v134 sw.js is prior code; all app modules are current. Real prepared public catalog served by an anonymous local fixture; synthetic title/build-time update for freshness tests. Mocked Auth response during cached-shell reload is separate from strict offline Auth refusal. No production, Apple device, upstream collection or model validation.' };
async function wait(page, fn, arg) {
  const end = Date.now() + 45000;
  while (Date.now() < end) { if (await page.evaluate(fn, arg)) return; await new Promise(resolve => setTimeout(resolve, 80)); }
  throw Error('Discovery PWA state did not settle');
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const oldSw = await fs.readFile(path.join(__dirname, 'fixtures/external-discovery/sw-pre-catalog-v134.js'));
  const newSw = await fs.readFile(path.join(project, 'sw.js'));
  const cacheName = data => data.toString().match(/const CACHE\s*=\s*['"]([^'"]+)/)[1];
  report.oldCache = cacheName(oldSw); report.newCache = cacheName(newSw);
  assert.equal(report.oldCache, 'haedo-v134'); assert.ok(Number(report.newCache.match(/^haedo-v(\d+)$/)?.[1]) > 134);
  report.oldSwSHA256 = sha(oldSw); report.newSwSHA256 = sha(newSw);
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
  const state = () => page.evaluate(async () => { const s = HaedoLife.Shell.storage, workspace = await s.getActive(); return { bundle: await s.read(workspace), workbench: await s.readWorkbench(workspace), manual: await s.readInterestProfile(workspace), discovery: await s.readDiscoveryProfile(workspace), settings: await s.readDiscoverySettings(workspace) }; });
  const catalog = () => page.evaluate(async () => {
    const response = await fetch('assets/life/discovery-feed.json', { method: 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    return { ok: response.ok, cache: response.headers.get('X-Haedo-Discovery-Cache'), browserFetchedAt: response.headers.get('X-Haedo-Discovery-Fetched-At'), feed: await response.json() };
  });
  const check = async (name, action) => { await action(); report.checks.push(name); console.log('PASS ' + name); };
  try {
    await open('interests');
    await check('actual v134 installs without fetching catalog, original sites or model assets', async () => {
      await wait(page, async name => (await caches.keys()).includes(name) && !!navigator.serviceWorker.controller && (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated', report.oldCache);
      assert.equal(report.catalogRequests.length, 0); assert.deepEqual(report.modelRequests, []); assert.deepEqual(report.unexpectedExternal, []);
    });
    await page.evaluate(async () => {
      const s = HaedoLife.Shell.storage, core = HaedoLife.Core, id = await s.getActive(); const bundle = await s.read(id);
      const prepared = await core.prepareImport({ origin: 'other', title: '발견 갱신 보존용 합성 원문', text: '\ufeff한글 😀 원문\r\nCafe\u0301 · 원본 줄바꿈과 작성자 정보를 유지합니다.', authorRelation: 'self', forceSeparate: true }, bundle);
      const result = await s.commitLocal({ workspaceId: id, baseRevision: bundle.revision, operationId: core.id(), changes: core.buildImportChanges(bundle, prepared, []) });
      if (result.status !== 'stored') throw Error('Anonymous source fixture failed');
      const manual = await s.readInterestProfile(id), next = HaedoLife.InterestProfile.setManual(manual, [{ id: 'manual-pwa', label: '개발과 문화' }], { expectedRevision: manual.revision });
      if ((await s.saveInterestProfile(id, next, manual.revision)).status !== 'stored') throw Error('Anonymous manual fixture failed');
      const profile = await s.readDiscoveryProfile(id), feedback = HaedoLife.DiscoveryProfile.setFeedback(profile, { id: 'pwa-public-article', canonicalUrl: 'https://example.org/article?id=1' }, 'already_read', { expectedRevision: profile.revision });
      if ((await s.saveDiscoveryProfile(id, feedback, profile.revision)).status !== 'stored') throw Error('Anonymous feedback fixture failed');
      const settings = await s.readDiscoverySettings(id), changedSettings = HaedoLife.DiscoverySettings.update(settings, { disabledSourceIds: ['naver-d2'] }, { expectedRevision: settings.revision });
      if ((await s.saveDiscoverySettings(id, changedSettings, settings.revision)).status !== 'stored') throw Error('Anonymous settings fixture failed');
    });
    const before = await state();
    await check('v134 -> current worker preserves exact originals, workbench, manual interests, feedback and settings', async () => {
      old = false; await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
      await wait(page, async ({ oldCache, newCache }) => { const keys = await caches.keys(), r = await navigator.serviceWorker.getRegistration(); return !keys.includes(oldCache) && keys.includes(newCache) && r?.active?.state === 'activated' && navigator.serviceWorker.controller === r.active; }, { oldCache: report.oldCache, newCache: report.newCache });
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
      await open('external-discovery'); await idle(); await page.locator('#discoveryLatest').click();
      await page.locator('article[data-discovery-id]').first().waitFor();
      first = await catalog(); assert.equal(first.cache, 'network'); assert.equal(first.feed.generatedAt, feed.generatedAt); assert.ok(Number.isFinite(Date.parse(first.browserFetchedAt)));
      await page.locator('.discovery-sources summary').click();
      assert.match(await page.locator('.discovery-sources').innerText(), /출처 사이트의 새 글 수집을 실행하지 않습니다/);
      assert.deepEqual(report.unexpectedExternal, []);
    });
    await check('a newer published catalog is fetched without worker update and failed refresh returns explicitly stale data', async () => {
      feed = structuredClone(originalFeed); feed.generatedAt = new Date(Date.now() + 1000).toISOString(); feed.articles[0].title = 'PWA 갱신 확인 · ' + feed.articles[0].title;
      await page.locator('#discoveryRefresh').click(); await idle(); fresh = await catalog();
      assert.equal(fresh.cache, 'network'); assert.equal(fresh.feed.generatedAt, feed.generatedAt); assert.equal(fresh.feed.articles[0].title, feed.articles[0].title);
      failCatalog = true;
      await page.locator('#discoveryRefresh').click(); await idle(); const stale = await catalog();
      assert.equal(stale.cache, 'stale'); assert.equal(stale.browserFetchedAt, fresh.browserFetchedAt); assert.equal(stale.feed.generatedAt, fresh.feed.generatedAt);
      assert.match(await page.locator('#discoveryReview').innerText(), /최신 상태를 확인하지 못한 출처/);
      report.catalogFreshness = { firstGeneratedAt: first.feed.generatedAt, updatedGeneratedAt: fresh.feed.generatedAt, browserFetchedAt: fresh.browserFetchedAt, fallbackPreservedBrowserFetchedAt: stale.browserFetchedAt };
      failCatalog = false;
    });
    let changed;
    await check('verified offline session saves private feedback and cached-shell reload preserves it', async () => {
      await context.setOffline(true); await page.locator('#discoveryRefresh').click(); await idle();
      const article = page.locator('article[data-discovery-id]').first();
      await article.locator('button[data-discovery-feedback="already_read"]').click();
      await wait(page, async length => { const s = HaedoLife.Shell.storage; return (await s.readDiscoveryProfile(await s.getActive())).feedback.length === length; }, before.discovery.feedback.length + 1);
      changed = await state(); assert.deepEqual(changed.bundle, before.bundle); assert.deepEqual(changed.manual, before.manual); assert.deepEqual(changed.workbench, before.workbench);
      const response = await page.reload(); assert.equal(response.fromServiceWorker(), true); await ready(page); await page.locator('#discoveryReview').waitFor(); await idle();
      assert.deepEqual(await state(), changed); assert.match(await page.locator('#discoveryReview').innerText(), /최신 상태를 확인하지 못한 출처/);
      transportProbe = true; assert.equal(await page.evaluate(async () => { try { await fetch('non-shell-offline-probe', { cache: 'no-store' }); return false; } catch (_) { return true; } }), true); await page.waitForTimeout(50); transportProbe = false;
    });
    await check('excluded feedback can be restored after reload without mutating source data or manual interests', async () => {
      const added = changed.discovery.feedback.find(row => !before.discovery.feedback.some(old => old.canonicalUrl === row.canonicalUrl));
      await page.locator('.discovery-excluded summary').click();
      await page.locator('[data-discovery-undo="' + added.articleId + '"]').click();
      await wait(page, async length => { const s = HaedoLife.Shell.storage; return (await s.readDiscoveryProfile(await s.getActive())).feedback.length === length; }, before.discovery.feedback.length);
      const after = await state(); assert.deepEqual(after.discovery.feedback, before.discovery.feedback); assert.ok(after.discovery.revision > changed.discovery.revision);
      assert.deepEqual(after.bundle, before.bundle); assert.deepEqual(after.manual, before.manual); assert.deepEqual(after.workbench, before.workbench);
    });
    await check('catalog with no previous cache fails visibly; strict offline Auth still blocks private boot and recovery preserves data', async () => {
      transportProbe = true; await page.evaluate(async key => caches.delete(key), feedCache); await page.reload(); await ready(page); await page.locator('#discoveryError').waitFor({ state: 'visible' });
      assert.equal(await page.locator('article[data-discovery-id]').count(), 0); transportProbe = false;
      strictOffline = true; fake.offline.add(device); await page.reload();
      await wait(page, () => document.querySelector('#lifeApp')?.hidden && /인터넷 연결|로그인/.test(document.body.innerText));
      assert.equal(await page.locator('#discoveryReview').count(), 0);
      fake.offline.delete(device); await context.setOffline(false); strictOffline = false;
      await open('external-discovery'); await idle(); const after = await state(); assert.deepEqual(after.bundle, before.bundle); assert.deepEqual(after.manual, before.manual); assert.deepEqual(after.discovery.feedback, before.discovery.feedback); assert.deepEqual(after.settings, before.settings);
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

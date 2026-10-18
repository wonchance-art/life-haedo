/* Actual v126 -> current SW lifecycle and real IDB/SDK, anonymous Auth only.
 * Only the old SW script is served from the prior release; app bytes are new.
 * Runs its own local HTTP fixture host; never touches a real account. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const project = path.resolve(__dirname, '..');
const out = path.resolve(process.env.INTEREST_PWA_OUTPUT || path.join(project, '.local/interest-pwa'));
const previousSw = process.env.INTEREST_PREVIOUS_SW || path.join(__dirname, 'fixtures/interest/sw-v126.js');
const digest = data => createHash('sha256').update(data).digest('hex');
const files = ['interest-model-loader.js', 'interest-model-worker.js', 'interest-analysis.js', 'interest-profile.js', 'interest-policy.js', 'interest-ui.js', 'interest.css'].map(name => 'assets/life/' + name);
const report = { createdAt: new Date().toISOString(), checks: [], consoleErrors: [], pageErrors: [], expectedOfflineErrors: [], unexpectedRequests: [], modelRequests: [],
  scope: 'Actual Chromium SW/SDK/IDB. Only prior sw.js is v126; all other fixture-host app files are current clone. Synthetic Auth HTTP only. Offline cached-shell reload with mocked Auth is separate from strict offline Auth denial. No real account, deployment, or Apple-device validation.' };
async function until(page, fn, value) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) { if (await page.evaluate(fn, value)) return; await new Promise(resolve => setTimeout(resolve, 80)); }
  throw Error('Browser state did not settle');
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const oldSw = await fs.readFile(previousSw), newSw = await fs.readFile(path.join(project, 'sw.js'));
  const name = bytes => bytes.toString().match(/const CACHE\s*=\s*['"]([^'"]+)/)[1];
  report.oldCache = name(oldSw); report.newCache = name(newSw);
  assert.equal(report.oldCache, 'haedo-v126'); assert.ok(Number(report.newCache.match(/^haedo-v(\d+)$/)?.[1]) > 126);
  report.previousSwSHA256 = digest(oldSw); report.newSwSHA256 = digest(newSw);
  let old = true; report.swServed = [];
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
  const host = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://fixture.invalid');
      const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const target = path.resolve(project, relative);
      if (!target.startsWith(project + path.sep)) { res.writeHead(404); res.end(); return; }
      let body;
      if (relative === 'sw.js') { body = old ? oldSw : newSw; report.swServed.push({name: old ? report.oldCache : report.newCache, sha256:digest(body)}); }
      else if (relative === 'assets/platform-config.js') body = 'window.HAEDO_CONFIG=Object.freeze({url:"https://life-sync-test.supabase.co",key:"sb_publishable_anonymous_browser_test_only"});';
      else body = await fs.readFile(target);
      res.writeHead(200, { 'content-type': mime[path.extname(relative)] || 'application/octet-stream', 'cache-control': 'no-store', 'service-worker-allowed': '/' }); res.end(body);
    } catch (_) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => host.listen(0, '127.0.0.1', resolve));
  process.env.BASE_URL = 'http://127.0.0.1:' + host.address().port;
  const { FakeCloud, platformContext, accounts, cloud, base } = require('./life-sync-browser.cjs');
  const { playwright, ready } = require('./unified-home-browser.cjs');
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 820, height: 1000 } });
  const fake = new FakeCloud(), device = 'interest-pwa-anonymous'; let strictOffline = false, offlineProbe = false;
  await platformContext(context, fake, device, accounts.a);
  await context.route('**/*', route => {
    const req = route.request(), url = new URL(req.url());
    if (/huggingface|xethub|onnxruntime|transformers|\.wasm(?:$|\?)/.test(url.href)) report.modelRequests.push({ path: url.origin + url.pathname, method: req.method() });
    if ([base, cloud].includes(url.origin)) return route.fallback();
    report.unexpectedRequests.push(url.origin + url.pathname); return route.abort('blockedbyclient');
  });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', e => report.pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') (strictOffline || offlineProbe ? report.expectedOfflineErrors : report.consoleErrors).push(m.text()); });
  const open = async () => { await page.goto(base + '/index.html?section=tools&view=interests'); await ready(page); await page.locator('#interestManual').waitFor(); };
  const stored = () => page.evaluate(async () => { const s = HaedoLife.Shell.storage, id = await s.getActive(); return { bundle: await s.read(id), profile: await s.readInterestProfile(id) }; });
  const saved = async text => { await page.locator('#interestManual').fill(text); await page.locator('#interestSaveManual').click(); await until(page, () => document.querySelector('#interestReview')?.getAttribute('aria-busy') === 'false'); };
  const check = async (label, fn) => { await fn(); report.checks.push(label); console.log('PASS ' + label); };
  try {
    await open();
    await check('actual v126 worker activates and controls the anonymous app', async () => {
      await until(page, async key => (await caches.keys()).includes(key) && !!navigator.serviceWorker.controller && (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated', report.oldCache);
    });
    await page.evaluate(async () => {
      const s = HaedoLife.Shell.storage, c = HaedoLife.Core; const b = await s.read(await s.getActive());
      const p = await c.prepareImport({ origin: 'other', title: 'SW 갱신 보존 검증', text: '\ufeff한글 😀 원문\r\nCafe\u0301 띄어쓰기와 줄바꿈을 보존합니다.\r\n책을 읽고 문장을 비교한 익명 합성 기록입니다.', authorRelation: 'self', forceSeparate: true }, b);
      const result = await s.commitLocal({ workspaceId: b.workspaceId, baseRevision: b.revision, operationId: c.id(), changes: c.buildImportChanges(b, p, []) });
      if (result.status !== 'stored') throw Error('Synthetic fixture commit failed');
    });
    await open(); await saved('갱신 전에 보관한 관심\n한글 원문 읽기');
    const before = await stored();
    assert.equal(before.bundle.sourceVersions.length, 1); assert.equal(before.profile.manual.length, 2);
    await check('v126 -> current activation preserves exact Core bundle and manual interest profile', async () => {
      old = false; await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
      await until(page, async ({ previous, current }) => { const keys = await caches.keys(), registration = await navigator.serviceWorker.getRegistration(); return keys.includes(current) && !keys.includes(previous) && registration?.active?.state === 'activated' && navigator.serviceWorker.controller === registration.active; }, { previous: report.oldCache, current: report.newCache });
      await page.reload(); await ready(page); await page.locator('#interestManual').waitFor();
      assert.deepEqual(await stored(), before);
      report.preserved = { bundleSHA256: digest(JSON.stringify(before.bundle)), profileSHA256: digest(JSON.stringify(before.profile)), sourceVersions: before.bundle.sourceVersions.length, manualItems: before.profile.manual.length };
    });
    await check('all seven new local assets match current bytes and model assets are outside the shell', async () => {
      const cached = await page.evaluate(async ({ cacheName, files }) => {
        const cache = await caches.open(cacheName); const rows = [];
        for (const file of files) { const r = await cache.match(new URL(file, location.href)); rows.push({ file, sha256: r ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await r.arrayBuffer())), n => n.toString(16).padStart(2, '0')).join('') : null }); }
        return { rows, urls: (await cache.keys()).map(r => r.url) };
      }, { cacheName: report.newCache, files });
      assert.deepEqual(cached.rows, await Promise.all(files.map(async file => ({ file, sha256: digest(await fs.readFile(path.join(project, file))) }))));
      assert.ok(cached.urls.every(u => new URL(u).origin === base));
      assert.ok(!cached.urls.some(u => /\.onnx|\.wasm|huggingface|onnxruntime|cdn.jsdelivr/.test(u)));
      report.installed = cached.rows; report.shellAssetCount = cached.urls.length;
    });
    await check('offline verified session saves manual interests without changing original Core data', async () => {
      await context.setOffline(true);
      await saved('오프라인에서 보관한 관심\n기존 원문을 다시 읽기');
      const after = await stored(); assert.deepEqual(after.bundle, before.bundle);
      assert.deepEqual(after.profile.manual.map(x => x.label), ['오프라인에서 보관한 관심', '기존 원문을 다시 읽기']);
      report.offlineProfileSHA256 = digest(JSON.stringify(after.profile));
    });
    await check('offline cached tools/interests reload preserves manual data with anonymous Auth HTTP fulfilled by fixture', async () => {
      const response = await page.reload(); assert.equal(response.fromServiceWorker(), true);
      await ready(page); await page.locator('#interestManual').waitFor();
      report.navigatorOnlineAfterOfflineReload = await page.evaluate(() => navigator.onLine);
      offlineProbe = true;
      report.nonShellNetworkDenied = await page.evaluate(async () => { try { await fetch('offline-transport-probe-not-shell', { cache: 'no-store' }); return false; } catch (_) { return true; } });
      await page.waitForTimeout(50); offlineProbe = false;
      assert.equal(report.nonShellNetworkDenied, true);
      assert.equal(await page.locator('#interestManual').inputValue(), '오프라인에서 보관한 관심\n기존 원문을 다시 읽기');
      const after = await stored(); assert.deepEqual(after.bundle, before.bundle); assert.equal(digest(JSON.stringify(after.profile)), report.offlineProfileSHA256);
      assert.equal(await page.evaluate(async files => (await Promise.all(files.map(async file => (await fetch(file)).ok))).every(Boolean), files), true);
      report.offlineReloadAuthScope = 'BrowserContext offline mode and denied non-shell network probe; static navigation from actual SW cache; Auth GET is intercepted synthetic HTTP, not evidence of production authentication while offline.';
    });
    await check('strict offline Auth refusal blocks private boot while saved local data survives recovery', async () => {
      strictOffline = true; fake.offline.add(device);
      await page.reload(); await until(page, () => document.querySelector('#lifeApp')?.hidden && /인터넷 연결|로그인/.test(document.body.innerText));
      assert.equal(await page.locator('#interestManual').count(), 0);
      fake.offline.delete(device); await context.setOffline(false); strictOffline = false;
      await open(); const after = await stored(); assert.deepEqual(after.bundle, before.bundle); assert.equal(digest(JSON.stringify(after.profile)), report.offlineProfileSHA256);
    });
    assert.equal(fake.writes().length, 0); assert.deepEqual(report.modelRequests, []); assert.deepEqual(report.unexpectedRequests, []);
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []);
    report.realRemoteWrites = 0; report.pass = true;
  } catch (error) { report.failure = { message: error.message, stack: error.stack }; throw error; }
  finally { await fs.writeFile(path.join(out, 'interest-pwa-browser.json'), JSON.stringify(report, null, 2) + '\n'); await context.close(); await browser.close(); await new Promise(resolve => host.close(resolve)); }
  console.log('Interest PWA: ' + report.checks.length + ' checks; no automatic model requests.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

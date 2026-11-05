/* Current news reading: real application, SDK, IndexedDB and Service Worker.
 * HTTP Auth/Edge/account documents and publisher pages are anonymous fixtures.
 * No real account, deployed SQL/RLS, publisher success or Apple-device claim.
 * node tests/life-personal-discovery-browser.cjs (starts its own local server). */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { gunzipSync } = require('node:zlib');
const project = path.resolve(__dirname, '..');
const out = path.resolve(process.env.PERSONAL_DISCOVERY_OUTPUT || '.local/personal-news-integration-browser');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const oldCommit = '2eebd27cbde54f697c9de3a09382f2e21b39a743';
const legacyFixture = require('./fixtures/private-news-legacy-shell.json');
const old = file => {
  assert.equal(legacyFixture.sourceCommit, oldCommit);
  const pinned = legacyFixture.files[file], bytes = gunzipSync(Buffer.from(pinned.gzipBase64, 'base64'));
  assert.equal(bytes.length, pinned.bytes); assert.equal(sha(bytes), pinned.sha256, 'Pinned old shell has its original bytes'); return bytes;
};
const report = { createdAt: new Date().toISOString(), scope: 'Synthetic Auth/owner cache/account-document HTTP, actual application/SDK/independent IndexedDB and actual Service Worker; publisher iframe responses synthetic. One explicitly injected abort-uncooperative privateReader isolates the actual DiscoveryUI request guard. No operating accounts, SQL/RLS, publisher acquisition, Apple-device or recommendation-usefulness claim.', checks: [], captures: [], consoleErrors: [], pageErrors: [], unexpectedExternal: [], publisherRequests: [], closedContexts: 0 };
const now = new Date().toISOString(), license = { label: '합성 출처', url: 'https://creativecommons.org/licenses/by/4.0/' };
let png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ZkAAAAASUVORK5CYII=';
function fixture() {
  const source = (id, name, url, feedUrl) => ({ id, name, url, feedUrl, language: 'ko', rights: { ...license, mode: 'metadata_only' }, status: 'ok', stale: false, error: null, lastSuccessAt: now, lastAttemptAt: now });
  const sources = [source('frontiers-psychology', 'Frontiers 합성 연구', 'https://www.frontiersin.org/journals/psychology', 'https://www.frontiersin.org/journals/psychology/rss'),
    source('mit-linguistics', 'MIT 합성 기사', 'https://news.mit.edu/', 'https://news.mit.edu/topic/mitlinguistics-rss.xml'),
    source('llt-journal', 'LLT 합성 초록', 'https://www.lltjournal.org/', 'https://www.lltjournal.org/feedlet/'),
    source('readersnews-books', '독서신문 합성 기사', 'https://www.readersnews.com/', 'https://www.readersnews.com/rss/allArticle.xml'),
    source('seoul-culture', '서울 문화 합성 안내', 'https://news.seoul.go.kr/culture/', 'https://news.seoul.go.kr/culture/feed')];
  // The real discover tab intentionally shows five candidates. Keep their
  // order deterministic instead of letting an iteration cross a millisecond.
  const article = (id, sourceId, url, title, patch = {}) => ({ id, sourceId, url, title, author: '익명 저자', language: 'ko', tags: ['언어', '독서'], publishedAt: new Date(Date.parse(now) - 60000 * (1 + ['alpha', 'beta', 'mit', 'llt', 'link', 'frame'].indexOf(id))).toISOString(), fetchedAt: now,
    summary: '', coverage: 'link_only', rights: { ...license, mode: 'metadata_only' }, ...patch });
  const alphaURL = 'https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.9900001/full';
  const body = '\ufeff개인 본문 ALPHA 🌱\r\n첫 문단의 줄바꿈과 <script>window.__unsafeReader=true</script>를 글자 그대로 보존합니다.\r\n\r\n' + Array.from({ length: 14 }, (_, i) => (i + 2) + '번째 문단. 언어와 독서에 관한 합성 본문이며 실제 연구 결과가 아닙니다. 읽었다는 이유로 이해도나 동의를 추정하지 않습니다.').join('\r\n\r\n');
  return { schemaVersion: 1, generatedAt: now, sources, articles: [
    article('alpha', sources[0].id, alphaURL, '언어와 독서: 한국어로 읽는 개인 연구 자료', { coverage: 'full_text', bodyText: body, images: [1, 2].map(n => ({ mimeType: 'image/png', dataBase64: png, alt: '합성 연구 그림 ' + n, caption: '그림 ' + n + '. 검사용 도식', credit: '익명 저자', license, sourceUrl: 'https://www.frontiersin.org/files/Articles/9900001/xml-images/fpsyg-99-9900001-g00' + n + '.webp', afterParagraph: n })) }),
    article('beta', sources[0].id, alphaURL.replace('9900001', '9900002'), '집중력과 외국어 학습: 두 번째 개인 자료', { coverage: 'full_text', bodyText: '개인 본문 BETA\n이 글은 앞서 연 글과 다른 정확한 판입니다.' }),
    article('mit', sources[1].id, 'https://news.mit.edu/2026/synthetic-language-study-1105', 'MIT 언어 학습 기사', { coverage: 'full_text', bodyText: '개인 본문 MIT\n이미지를 확보했다고 표시하지 않는 합성 기사입니다.' }),
    article('llt', sources[2].id, 'https://www.lltjournal.org/item/10125-990001/', 'LLT 외국어 독서 연구 초록', { coverage: 'summary', summary: '개인 초록 LLT. 전체 논문과 PDF는 확보하지 않았습니다.' }),
    article('frame', sources[3].id, 'https://www.readersnews.com/news/articleView.html?idxno=990001', '독서신문 앱 안 대체 읽기'),
    article('link', sources[4].id, 'https://news.seoul.go.kr/culture/archives/990001', '서울 문화 원문 링크 대체 읽기') ] };
}
const metadata = value => ({ ...structuredClone(value), articles: value.articles.map(item => { const { bodyText, images, ...rest } = structuredClone(item); return { ...rest, summary: '', coverage: 'link_only', rights: { ...rest.rights, mode: 'metadata_only' } }; }) });
let catalog = fixture(), legacyHTML = false, legacyWorker = false, site = project;
const pinnedLegacy = { 'index.html': old('index.html'), 'life.html': old('life.html'), 'sw.js': old('sw.js') };
// An explicit source-file replacement is only for the separately reported
// mutation runs. It never edits the shared implementation or browser APIs.
const uiMutation = process.env.PERSONAL_DISCOVERY_UI_OVERRIDE ? path.resolve(process.env.PERSONAL_DISCOVERY_UI_OVERRIDE) : null;
const mime = { '.js': 'application/javascript', '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const host = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://fixture.invalid'), relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(site, relative); if (!file.startsWith(site + path.sep)) { response.writeHead(404); response.end(); return; }
    const bytes = relative === 'assets/platform-config.js' ? 'window.HAEDO_CONFIG=Object.freeze({url:"https://life-sync-test.supabase.co",key:"sb_publishable_anonymous_browser_test_only"});'
      : relative === 'assets/life/discovery-feed.json' ? JSON.stringify(metadata(catalog))
        : legacyHTML && ['index.html', 'life.html'].includes(relative) || legacyWorker && relative === 'sw.js' ? pinnedLegacy[relative]
          : uiMutation && relative === 'assets/life/discovery-ui.js' ? await fs.readFile(uiMutation) : await fs.readFile(file);
    response.writeHead(200, { 'content-type': mime[path.extname(relative)] || 'application/octet-stream', 'cache-control': 'no-store', 'service-worker-allowed': '/' }); response.end(bytes);
  } catch (_) { response.writeHead(404); response.end(); }
});
async function main() {
  report.runnerSHA256 = sha(await fs.readFile(__filename));
  report.helperSHA256 = sha(await fs.readFile(path.join(__dirname, 'helpers/discovery-private-cloud.cjs')));
  await fs.mkdir(out, { recursive: true });
  site = path.join(out, 'prepared-site');
  execFileSync(process.execPath, ['scripts/prepare-site.mjs', site], { cwd: project, env: { ...process.env, HAEDO_SUPABASE_URL: 'https://life-sync-test.supabase.co', HAEDO_SUPABASE_KEY: 'sb_publishable_anonymous_browser_test_only' } });
  const modules = ['assets/life/discovery-private-remote.js', 'assets/life/discovery-reader-ui.js'];
  report.preparedArtifact = { files: {}, html: [], syntheticPlatformConfiguration: true };
  for (const file of [...modules, 'assets/life/discovery-ui.js', 'assets/life/discovery.css', 'assets/life/ui.js']) {
    const source = await fs.readFile(path.join(project, file)), prepared = await fs.readFile(path.join(site, file));
    assert.deepEqual(prepared, source, 'Prepared deployment contains exact module bytes: ' + file); report.preparedArtifact.files[file] = sha(prepared);
  }
  for (const file of ['index.html', 'life.html']) {
    const html = await fs.readFile(path.join(site, file), 'utf8');
    for (const module of modules) { assert.equal(html.split('src="' + module + '"').length - 1, 1); assert(html.indexOf('src="' + module + '"') < html.indexOf('src="assets/life/discovery-ui.js"')); }
    report.preparedArtifact.html.push({ file, sha256: sha(html) });
  }
  const worker = await fs.readFile(path.join(site, 'sw.js'), 'utf8');
  for (const module of modules) assert(new RegExp("['\"](?:\\./)?" + module.replaceAll('.', '\\.') + "['\"]").test(worker), 'Actual worker SHELL contains ' + module);
  for (const excluded of ['supabase/functions/haedo-discovery-private', 'supabase/migrations/20261029084145_discovery_private_reader.sql', 'tests', '.local']) await assert.rejects(fs.access(path.join(site, excluded)));
  report.preparedArtifact.workerSHA256 = sha(worker); report.preparedArtifact.cache = worker.match(/const CACHE\s*=\s*['"]([^'"]+)/)[1];
  await new Promise(resolve => host.listen(0, '127.0.0.1', resolve));
  if (uiMutation) report.mutation = { file: path.relative(project, uiMutation), sha256: sha(await fs.readFile(uiMutation)), target: 'assets/life/discovery-ui.js' };
  process.env.BASE_URL = 'http://127.0.0.1:' + host.address().port;
  const { accounts, session, cloud, base } = require('./life-sync-browser.cjs');
  const { playwright, makeContext, ready, nav, settle } = require('./unified-home-browser.cjs');
  const { DiscoveryPrivateCloud } = require('./helpers/discovery-private-cloud.cjs');
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  const paint = await browser.newPage(); png = await paint.evaluate(() => { const c = document.createElement('canvas'); c.width = 640; c.height = 280; const x = c.getContext('2d'); x.fillStyle = '#eef4f2'; x.fillRect(0, 0, 640, 280); x.fillStyle = '#245c53'; x.fillRect(70, 130, 100, 100); x.fillRect(270, 70, 100, 160); x.font = '18px sans-serif'; x.fillText('Synthetic fixture', 60, 35); return c.toDataURL('image/png').split(',')[1]; }); await paint.close();
  const row = (page, id) => page.locator('#discoveryList [data-discovery-id="' + id + '"]');
  const idle = page => page.waitForFunction(() => document.querySelector('#discoveryReview')?.getAttribute('aria-busy') === 'false');
  const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const readText = page => page.locator('#discoveryReaderContent .discovery-reader-text').evaluate(el => [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(''));
  const state = page => page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(); return { bundle: await s.read(w), actions: await s.readDiscoveryActions(w), feedback: await s.readDiscoveryProfile(w), reading: await s.readDiscoveryReading(w) }; });
  const until = async (fn, label) => { const end = Date.now() + 15000; while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50)); } throw Error('Condition did not settle: ' + label); };
  const arrived = hold => Promise.race([hold.entered, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('Private request did not arrive')), 15000); hold.entered.finally(() => clearTimeout(timer)); })]);
  async function closeReader(page) { const back = page.locator('#discoveryReaderBack'); if (await back.count() && await back.isVisible()) { await back.click(); await idle(page); } }
  async function open(page, id, expected = 'ready') { await closeReader(page); await row(page, id).locator('[data-discovery-select]').click(); await page.locator('#discoveryReader[data-reader-state="' + expected + '"]').waitFor(); await idle(page); }
  async function reveal(control) { const n = await control.locator('xpath=ancestor::details').count(); for (let i = n; i; i--) { const details = control.locator('xpath=ancestor::details[' + i + ']'); if (!await control.isVisible() && !await details.evaluate(el => el.open)) await details.locator(':scope > summary').click(); } return control; }
  async function capture(page, name) { await frames(page); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false); const file = name + '.png'; await page.screenshot({ path: path.join(out, file) }); report.captures.push(file); }
  async function privateCacheAbsent(page) {
    const found = await page.evaluate(async () => { const found = []; for (const key of await caches.keys()) { const cache = await caches.open(key); for (const request of await cache.keys()) { if (/haedo-discovery-private/.test(request.url)) found.push(request.url); const response = await cache.match(request); if (response && /json|text|javascript/.test(response.headers.get('content-type') || '')) { const text = await response.text(); if (/개인 본문 ALPHA|개인 본문 BETA|개인 본문 MIT|개인 초록 LLT/.test(text)) found.push(request.url); } } } return found; }); assert.deepEqual(found, []);
  }
  async function check(name, run) {
    if (process.env.PERSONAL_DISCOVERY_MATCH && !new RegExp(process.env.PERSONAL_DISCOVERY_MATCH).test(name)) return;
    catalog = fixture(); legacyHTML = legacyWorker = false;
    const server = new DiscoveryPrivateCloud().enableAccountLibrary(), devices = [], holds = [], initialErrors = [report.pageErrors.length, report.consoleErrors.length, report.unexpectedExternal.length];
    server.setArticles(accounts.a.id, catalog.articles);
    async function device(label, account = accounts.a, viewport = { width: 1440, height: 960 }) {
      const context = await makeContext(browser, server, label, account, { viewport, serviceWorkers: 'allow', reducedMotion: 'reduce' });
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback();
        if (['www.frontiersin.org', 'www.readersnews.com'].includes(url.hostname) && request.resourceType() === 'document') { report.publisherRequests.push({ name, device: label, url: url.href, referer: request.headers().referer || null }); return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>합성 출판사</title><p>출판사 대체 읽기 검사용 본문</p>' }); }
        report.unexpectedExternal.push({ name, origin: url.origin, path: url.pathname }); return route.abort('blockedbyclient');
      });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', error => report.pageErrors.push({ name, device: label, message: error.message }));
      page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ name, device: label, message: message.text() }); });
      devices.push({ context, page, label });
      await page.goto(base + '/index.html?section=news'); if (account) { await ready(page); await idle(page); } else { await page.waitForFunction(() => globalThis.HaedoLife?.Shell); await page.evaluate(() => HaedoLife.Shell.ready); }
      return { context, page, label };
    }
    const hold = match => { const held = server.holdPrivate(match); holds.push(held); return held; };
    try {
      console.log('RUN ' + name); await run({ server, device, hold });
      assert.deepEqual(server.privateRouteErrors, []); assert.deepEqual(server.libraryRouteErrors, []);
      for (const entry of server.accountDocWrites()) assert(!/개인 본문 ALPHA|개인 본문 BETA|개인 본문 MIT|개인 초록 LLT|privateReceipt|privateReader|dataBase64/.test(JSON.stringify(entry.body)), 'Private captures never enter account documents or reaction snapshots');
      assert.deepEqual([report.pageErrors.length, report.consoleErrors.length, report.unexpectedExternal.length], initialErrors, 'No console/page/unexpected external errors');
      report.checks.push({ name, pass: true, privateRequests: server.privateRequests, accountDocumentWrites: server.accountDocWrites().length }); console.log('PASS ' + name);
    } catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); for (const d of devices) await d.page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '-' + d.label + '.png') }).catch(() => {}); }
    finally { holds.forEach(h => h.release()); for (const d of devices) { await d.context.close(); report.closedContexts++; } }
  }
  try {
    await check('anonymous and metadata browsing do not prefetch private text', async ({ device, server }) => {
      const guest = await device('guest', null); assert.equal(await guest.page.locator('#lifeApp').isHidden(), true); assert.deepEqual(await guest.page.evaluate(() => __homeDbOpens), []);
      const a = await device('owner'); await row(a.page, 'alpha').waitFor(); assert.equal(server.privateRequests.length, 0); assert.equal(await a.page.locator('#discoveryReader').count(), 0);
      const feed = await a.page.evaluate(async () => (await fetch('assets/life/discovery-feed.json')).json());
      for (const item of feed.articles) { assert.equal(item.summary, ''); assert.equal(item.coverage, 'link_only'); assert(!['bodyText', 'images', 'acquisition', 'privateReceipt'].some(key => Object.hasOwn(item, key))); }
    });
    await check('three supported sources expose exact coverage and two safe images at 1440 and 390', async ({ device, server }) => {
      const { page } = await device('sources'); const before = await state(page);
      for (const id of ['alpha', 'mit', 'llt']) {
        await open(page, id); const article = catalog.articles.find(a => a.id === id);
        assert.equal(await readText(page), article.bodyText || article.summary); assert.equal(await page.locator('#discoveryReaderCoverage').getAttribute('data-coverage'), article.coverage);
        assert.equal(await page.locator('#discoveryReaderContent script').count(), 0); assert.equal(await page.evaluate(() => window.__unsafeReader), undefined);
        assert.equal(await page.locator('.discovery-reader-image').count(), id === 'alpha' ? 2 : 0);
        if (id === 'alpha') { await page.waitForFunction(() => [...document.querySelectorAll('.discovery-reader-image')].every(img => img.complete && img.naturalWidth === 640)); await capture(page, 'private-body-1440'); }
      }
      assert.deepEqual(await state(page), before, 'Read-only opening creates no material or judgment');
      await page.setViewportSize({ width: 390, height: 844 }); await open(page, 'alpha'); await capture(page, 'private-body-390');
      assert.equal(await page.evaluate(() => document.body.dataset.haedoImmersive), 'news'); await page.goBack(); await idle(page); await frames(page);
      assert.equal(await page.locator('#discoveryReader').count(), 0); assert.equal(await page.evaluate(() => document.activeElement.closest('[data-discovery-id]')?.dataset.discoveryId), 'alpha');
      assert.equal(report.publisherRequests.filter(r => r.name.startsWith('three supported')).length, 0); await privateCacheAbsent(page); assert.equal(server.privateRequests.length, 4);
    });
    await check('independent account devices share judgments but private response never leaks to another owner', async ({ device, server }) => {
      const a = await device('account-a'); await open(a.page, 'alpha'); await a.page.locator('#discoveryReader [data-discovery-reaction="liked"]').click(); await idle(a.page);
      await until(() => server.accountDocWrites().some(r => r.body.p_doc_key.startsWith('discoveryActions:')), 'reaction upload');
      const second = await device('account-a-second', accounts.a, { width: 390, height: 844 }); await open(second.page, 'alpha');
      assert.equal(await readText(second.page), catalog.articles[0].bodyText); await second.page.locator('#discoveryReader [data-discovery-reaction="liked"][aria-pressed="true"]').waitFor();
      assert.equal((await state(a.page)).bundle.workspaceId, (await state(second.page)).bundle.workspaceId);
      const b = await device('account-b', accounts.b); await open(b.page, 'alpha', 'unavailable'); assert.equal(await b.page.locator('.discovery-reader-text').count(), 0);
      assert.equal(await b.page.locator('#discoveryReader [data-discovery-reaction="liked"]').getAttribute('aria-pressed'), 'false'); assert.deepEqual((await state(b.page)).actions.entries, []);
      assert.deepEqual(server.privateRequests.map(r => r.owner), [accounts.a.id, accounts.a.id, accounts.b.id]); await privateCacheAbsent(a.page); await privateCacheAbsent(second.page);
    });
    await check('late closed article cannot replace the next exact snapshot or import', async ({ device, hold }) => {
      const { page } = await device('late-close', accounts.a, { width: 390, height: 844 }), waiting = hold(entry => entry.url === catalog.articles[0].url);
      await row(page, 'alpha').locator('[data-discovery-select]').click(); await arrived(waiting); assert.equal(await page.locator('#discoveryReader').getAttribute('data-reader-state'), 'loading');
      await closeReader(page); await open(page, 'beta'); waiting.release(); await waiting.responded; await frames(page);
      assert.equal(await readText(page), catalog.articles[1].bodyText);
      await (await reveal(page.locator('#discoveryReader [data-discovery-import]'))).click(); await page.locator('#lifeImportText').waitFor();
      assert((await page.locator('#lifeImportText').inputValue()).startsWith(catalog.articles[1].bodyText)); assert.equal(await page.locator('#lifeImportUrl').inputValue(), catalog.articles[1].url);
    });
    await check('late owner reply is discarded through account change', async ({ device, hold }) => {
      const { page } = await device('late-owner'), waiting = hold(entry => entry.owner === accounts.a.id);
      await row(page, 'alpha').locator('[data-discovery-select]').click(); await arrived(waiting);
      await page.evaluate(value => HaedoAuth.client.auth.setSession(value), session(accounts.b));
      await page.waitForFunction(() => !HaedoAuth.user && !HaedoLife.Shell.storage); assert.equal(await page.locator('#lifeApp').isHidden(), true);
      waiting.release(); await waiting.responded; await frames(page); assert.equal(await page.locator('.discovery-reader-text').count(), 0);
      await page.evaluate(() => HaedoLife.Shell.start()); await ready(page); await idle(page); await page.waitForFunction(id => HaedoAuth.user?.id === id, accounts.b.id);
      await open(page, 'alpha', 'unavailable'); assert.equal(await page.locator('.discovery-reader-text').count(), 0);
    });
    await check('busy unavailable and empty source retain fallback and keyboard retry recovers exact stale snapshot', async ({ device, server, hold }) => {
      const key = server.articleKey(accounts.a.id, catalog.articles[0].sourceId, catalog.articles[0].url); server.privateReplies.set(key, { status: 'busy' });
      const { page } = await device('retry'); await open(page, 'alpha', 'error'); assert.equal(await page.locator('#discoveryReaderRetry').isVisible(), true); assert.equal(await page.locator('#discoveryReaderFrame').count(), 1);
      server.privateReplies.set(key, { status: 'unavailable' }); await page.locator('#discoveryReaderRetry').click();
      await page.locator('#discoveryReader[data-reader-state="unavailable"]').waitFor(); assert.equal(await page.locator('.discovery-reader-text').count(), 0); assert.equal(await page.locator('#discoveryReader [data-discovery-import]').isEnabled(), true);
      server.privateReplies.set(key, { ...structuredClone(server.privateArticles.get(key)), content: { ...structuredClone(server.privateArticles.get(key).content), bodyText: '' } });
      await page.locator('#discoveryReaderRetry').click(); await page.locator('#discoveryReader[data-reader-state="error"]').waitFor(); assert.equal(await page.locator('.discovery-reader-text').count(), 0);
      server.privateReplies.delete(key); server.privateArticles.get(key).cached = true; server.privateArticles.get(key).stale = true;
      const waiting = hold(); await page.locator('#discoveryReaderRetry').focus(); await page.locator('#discoveryReaderRetry').press('Enter'); await arrived(waiting);
      assert.equal(await page.locator('#discoveryReader').getAttribute('data-reader-state'), 'loading'); assert.equal(await page.evaluate(() => document.activeElement.id), 'discoveryReaderStatus'); waiting.release(); await waiting.responded;
      await page.locator('#discoveryReader[data-reader-state="ready"]').waitFor(); assert.equal(await readText(page), catalog.articles[0].bodyText); assert.equal(await page.locator('#discoveryReaderFrame').count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'discoveryReaderContent');
      assert.equal(await page.locator('.discovery-reader-stale time').getAttribute('datetime'), now); await capture(page, 'private-retry-1440');
    });
    await check('unsupported source preserves existing iframe and original-link paths without private request', async ({ device, server }) => {
      catalog.articles = catalog.articles.filter(article => ['frame', 'link'].includes(article.id));
      const { page } = await device('fallback'); await open(page, 'frame', 'fallback'); assert.equal(await page.locator('#discoveryReaderFrame').getAttribute('sandbox'), 'allow-scripts allow-popups');
      await open(page, 'link', 'fallback'); assert.equal(await page.locator('#discoveryReaderFrame').count(), 0); assert.equal(await page.locator('#discoveryReader [data-discovery-open]').getAttribute('href'), catalog.articles.at(-1).url);
      assert.equal(server.privateRequests.length, 0); assert(report.publisherRequests.filter(r => r.name.startsWith('unsupported')).every(r => r.referer === null));
    });
    await check('feed refresh keeps received text and exact body import is deduplicated', async ({ device, server }) => {
      const { page } = await device('import'); await open(page, 'mit'); const original = structuredClone(catalog.articles.find(a => a.id === 'mit'));
      await page.locator('#discoveryReader [data-discovery-reaction="bookmarked"]').click(); await idle(page);
      catalog.articles.find(a => a.id === 'mit').title = '변경된 목록 제목'; catalog.generatedAt = new Date(Date.now() + 1000).toISOString();
      await page.locator('#discoveryFilterToggle').click(); await page.locator('#discoveryRefreshNow').click(); await idle(page); assert.equal(await readText(page), original.bodyText);
      const exactInput = async () => { await (await reveal(page.locator('#discoveryReader [data-discovery-import]'))).click(); await page.locator('#lifeImportText').waitFor(); const value = await page.locator('#lifeImportText').inputValue(); assert(value.startsWith(original.bodyText)); assert.match(value, /\[해도 출처 정보\]/); assert.match(value, /사진·영상은 보관하지 않았습니다/); return value; };
      const imported = await exactInput(); await page.getByRole('button', { name: '원문·출처 확인', exact: true }).click(); await page.getByRole('button', { name: '자료만 보관', exact: true }).click(); await page.locator('#lifeSourceText').waitFor();
      assert.equal(await page.locator('#lifeSourceText').textContent(), imported); const saved = await state(page); assert.equal(saved.bundle.sources.length, 1);
      catalog.articles.find(a => a.id === 'mit').title = original.title; catalog.generatedAt = new Date(Date.now() + 2000).toISOString();
      await nav(page, 'news'); await idle(page); await page.locator('#discoveryFilterToggle').click(); await page.locator('#discoveryRefreshNow').click(); await idle(page);
      await page.locator('#discoveryBookmarked').click(); await idle(page); await open(page, 'mit'); assert.equal(await exactInput(), imported); assert.equal(await page.locator('#lifeImportTitle').inputValue(), original.title);
      await page.getByRole('button', { name: '원문·출처 확인', exact: true }).click(); await page.locator('.life-review').waitFor();
      assert.equal((await state(page)).bundle.sources.length, 1, 'Repeated review does not duplicate source');
      assert.match(await page.locator('.life-review').innerText(), /같은|중복|이미/);
      await page.getByRole('button', { name: '같은 자료로 확인 · 버전 비교', exact: true }).click();
      await page.getByRole('button', { name: '자료만 보관', exact: true }).click(); await page.locator('#lifeSourceText').waitFor();
      assert.equal(await page.locator('#lifeSourceText').textContent(), imported); const repeated = await state(page);
      assert.equal(repeated.bundle.sources.length, 1, 'Repeated commit reuses the source'); assert.equal(repeated.bundle.sourceVersions.length, saved.bundle.sourceVersions.length, 'Repeated commit reuses the exact original version');
      assert.equal(server.privateRequests.length, 2);
    });
    await check('BOM and CRLF received body survives actual material commit without text normalization', async ({ device }) => {
      const { page } = await device('exact-crlf'); await open(page, 'alpha'); const exactBody = catalog.articles[0].bodyText;
      await (await reveal(page.locator('#discoveryReader [data-discovery-import]'))).click(); await page.locator('#lifeImportText').waitFor();
      // A browser textarea displays CRLF as LF. The accepted input model must
      // still preserve the received original when the user has not edited it.
      assert((await page.locator('#lifeImportText').inputValue()).startsWith(exactBody.replace(/\r\n/g, '\n')));
      await page.getByRole('button', { name: '원문·출처 확인', exact: true }).click(); await page.getByRole('button', { name: '자료만 보관', exact: true }).click(); await page.locator('#lifeSourceText').waitFor();
      const stored = (await state(page)).bundle.sourceVersions; assert.equal(stored.length, 1);
      assert.equal(stored[0].contentText.slice(0, exactBody.length), exactBody); assert(stored[0].contentText.slice(exactBody.length).startsWith('\n\n[해도 출처 정보]'));
      assert.equal((await page.locator('#lifeSourceText').textContent()).slice(0, exactBody.length), exactBody);
    });
    await check('pending import is disabled and leaving news protects destination and typed draft', async ({ device, hold }) => {
      const { page } = await device('pending'); const waiting = hold(); await row(page, 'alpha').locator('[data-discovery-select]').click(); await arrived(waiting);
      assert.equal(await page.locator('#discoveryReader [data-discovery-import]').isDisabled(), true);
      await nav(page, 'records'); waiting.release(); await waiting.responded; await frames(page);
      assert.equal(await page.locator('#discoveryReader').count(), 0); assert.equal(await page.locator('.discovery-reader-text').count(), 0);
      await nav(page, 'news'); await idle(page); await open(page, 'link', 'fallback');
      await (await reveal(page.locator('#discoveryReader [data-discovery-import]'))).click(); await page.locator('#lifeImportText').waitFor({ state: 'attached' }); assert.equal(await page.locator('#lifeImportText').inputValue(), '');
      await page.locator('#lifeImportMethodText').click(); await page.locator('#lifeImportText').fill('직접 쓰는 미완료 문장 🌱'); await frames(page);
      assert.equal(await page.locator('#lifeImportText').inputValue(), '직접 쓰는 미완료 문장 🌱');
    });
    await check('page suspend discards late reply and resume exposes an enabled retry', async ({ device, hold }) => {
      const { page } = await device('suspend'), waiting = hold(); await row(page, 'alpha').locator('[data-discovery-select]').click(); await arrived(waiting);
      assert.equal(await page.locator('#discoveryReader').getAttribute('data-reader-state'), 'loading');
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))); waiting.release(); await waiting.responded; await frames(page);
      assert.equal(await page.locator('.discovery-reader-text').count(), 0);
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))); await ready(page);
      await page.locator('#discoveryReader[data-reader-state="error"]').waitFor(); assert.equal(await page.locator('#discoveryReaderRetry').isEnabled(), true);
      const retry = hold(); await page.locator('#discoveryReaderRetry').click(); await arrived(retry);
      await page.locator('#discoveryReader [data-discovery-reaction="liked"]').focus(); retry.release(); await retry.responded;
      await page.locator('#discoveryReader[data-reader-state="ready"]').waitFor(); assert.equal(await readText(page), catalog.articles[0].bodyText);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.discoveryReaction), 'liked', 'Response must not steal user-moved focus');
    });
    await check('same selected article retry keeps the newer import when an aborted reader resolves late', async ({ device, server }) => {
      const { page } = await device('same-selection-retry');
      // The HTTP client has its own abort guard. Inject through the existing
      // public factory seam to test the UI guard without that guard masking it.
      // Keep the real UI module, storage, events and buttons; expose only this
      // test's deferred requests and the public onImport output, no UI state.
      await nav(page, 'schedule'); assert.equal(await page.locator('#discoveryReader').count(), 0);
      const before = await state(page);
      await page.evaluate(async () => {
        const storage = HaedoLife.Shell.storage, bundle = await storage.read(await storage.getActive());
        const container = document.createElement('section'); container.id = 'privateReaderRacePanel'; document.querySelector('#lifeMain').append(container);
        const harness = { requests: [], imports: [] };
        const privateReader = { loadPrivateArticle(metadata, { workspaceId, signal }) {
          let resolve; const promise = new Promise(done => { resolve = done; });
          harness.requests.push({ metadata, workspaceId, signal, promise, resolve });
          // Deliberately ignore signal: an already queued completion may still arrive.
          return promise;
        } };
        const ui = HaedoLife.DiscoveryUI.create({ container, storage, getBundle: () => bundle,
          isCurrent: () => HaedoLife.Shell.storage === storage, privateReader,
          onImport: article => { harness.imports.push(structuredClone(article)); } });
        harness.dispose = () => { ui.dispose(); container.remove(); delete window.__privateReaderRaceHarness; };
        window.__privateReaderRaceHarness = harness; await ui.render();
      });
      try {
        await idle(page); await row(page, 'alpha').locator('[data-discovery-select]').click();
        await page.waitForFunction(() => __privateReaderRaceHarness.requests.length === 1);
        assert.equal(await page.locator('#discoveryReader').getAttribute('data-reader-state'), 'loading');
        await page.locator('#discoveryNewsSettings').click(); await page.locator('#discoveryNewsSettingsBack').click();
        await page.locator('#discoveryReader[data-reader-state="error"]').waitFor();
        await page.locator('#discoveryReaderRetry').click();
        await page.waitForFunction(() => __privateReaderRaceHarness.requests.length === 2);
        const fence = await page.evaluate(() => {
          const [first, retry] = __privateReaderRaceHarness.requests;
          return { sameMetadataObject: first.metadata === retry.metadata, sameWorkspace: first.workspaceId === retry.workspaceId,
            firstAborted: first.signal.aborted, retryAborted: retry.signal.aborted };
        });
        assert.equal(fence.sameMetadataObject, true, 'Settings and retry retain the same selected metadata object');
        assert.equal(fence.sameWorkspace, true); assert.equal(fence.firstAborted, true, 'UI forwards cancellation to the older request'); assert.equal(fence.retryAborted, false);
        const key = server.articleKey(accounts.a.id, catalog.articles[0].sourceId, catalog.articles[0].url);
        const response = (bodyText, digit) => { const result = structuredClone(server.privateArticles.get(key)); result.content.bodyText = bodyText; delete result.content.images; result.contentHash = digit.repeat(64); return result; };
        const oldReply = response('UI OLD REQUEST A\r\n이전 요청의 본문입니다.', '1'), newReply = response('UI CURRENT RETRY B\r\n재시도에서 읽은 정확한 본문입니다.', '2');
        async function complete(index, reply) {
          await page.evaluate(async ({ index, reply }) => {
            const request = __privateReaderRaceHarness.requests[index];
            request.resolve(HaedoLife.DiscoveryPrivateRemote.project(request.metadata, reply));
            await request.promise; // UI continuation was registered before this completion barrier.
          }, { index, reply });
        }
        await complete(1, newReply); await page.locator('#discoveryReader[data-reader-state="ready"]').waitFor();
        assert.equal(await readText(page), newReply.content.bodyText);
        await complete(0, oldReply);
        assert.equal(await readText(page), newReply.content.bodyText, 'An older completion cannot replace the visible retry result');
        // ready→ready DOM preservation could hide a stale privateArticle. Check
        // the actual public callback used to start a material import as well.
        await (await reveal(page.locator('#discoveryReader [data-discovery-import]'))).click();
        await page.waitForFunction(() => __privateReaderRaceHarness.imports.length === 1);
        const imported = await page.evaluate(() => __privateReaderRaceHarness.imports[0]);
        assert.equal(imported.bodyText, newReply.content.bodyText, 'The import must keep the newer retry body after the older completion');
        assert.equal(imported.privateReceipt.contentHash, newReply.contentHash, 'The import receipt belongs to the newer retry');
        assert.equal(imported.url, newReply.url); assert.equal(imported.sourceId, newReply.sourceId);
        assert.deepEqual(await state(page), before, 'The injected import callback and reading race do not write material or judgment');
        assert.equal(server.privateRequests.length, 0, 'This isolated UI race bypasses only the transport, using the explicit privateReader seam');
        report.sameSelectionRetry = { ...fence, transport: 'injected deferred privateReader; abort deliberately ignored',
          completionOrder: ['retry B', 'older A'], importedBodySHA256: sha(Buffer.from(imported.bodyText)), importedContentHash: imported.privateReceipt.contentHash };
      } finally { await page.evaluate(() => window.__privateReaderRaceHarness?.dispose()); }
    });
    await check('private response preserves a pressed bookmark control and applies the gesture once', async ({ device, hold }) => {
      const { page } = await device('pointer'), waiting = hold(); await row(page, 'alpha').locator('[data-discovery-select]').click(); await arrived(waiting);
      const control = page.locator('#discoveryReader [data-discovery-reaction="bookmarked"]'), handle = await control.elementHandle(), box = await control.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      waiting.release(); await waiting.responded; await page.locator('#discoveryReader[data-reader-state="ready"]').waitFor();
      assert.equal(await handle.evaluate(el => el.isConnected), true, 'Async body completion must keep the pressed toolbar node');
      await page.mouse.up(); await idle(page);
      await page.locator('#discoveryReader [data-discovery-reaction="bookmarked"][aria-pressed="true"]').waitFor();
      const actions = (await state(page)).actions.entries; assert.equal(actions.length, 1); assert.equal(actions[0].bookmarked, true);
    });
    await check('actual previous worker and old HTML fall back then update without caching private response or losing judgment', async ({ device, server }) => {
      legacyHTML = legacyWorker = true;
      const { page } = await device('mixed-worker', accounts.a, { width: 390, height: 844 });
      await open(page, 'alpha', 'fallback'); assert.equal(server.privateRequests.length, 0); assert.equal(await page.locator('#discoveryReaderFrame').count(), 1);
      await page.locator('#discoveryReader [data-discovery-reaction="liked"]').click(); await idle(page); const saved = (await state(page)).actions;
      await until(() => page.evaluate(async () => !!navigator.serviceWorker.controller && (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated'), 'old worker activation');
      legacyHTML = legacyWorker = false;
      const previous = await page.evaluate(() => navigator.serviceWorker.controller.scriptURL);
      await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update(); });
      await until(() => page.evaluate(async () => { const response = await caches.match('index.html'); return !!response && (await response.text()).includes('discovery-private-remote.js'); }), 'current shell installed');
      await page.reload(); await ready(page); await idle(page); await open(page, 'alpha'); assert.equal(await readText(page), catalog.articles[0].bodyText); assert.equal(await page.locator('#discoveryReader [data-discovery-reaction="liked"]').getAttribute('aria-pressed'), 'true');
      assert.deepEqual((await state(page)).actions, saved); await privateCacheAbsent(page);
      const newWorker = await fs.readFile(path.join(project, 'sw.js')), cache = data => data.toString().match(/const CACHE\s*=\s*['"]([^'"]+)/)[1];
      // The orchestrator bumps CACHE at merge; the update must install that current cache (not merely reuse the old one).
      assert.ok((await page.evaluate(() => caches.keys())).includes(cache(newWorker)), 'updated worker installed the current CACHE');
      report.mixedWorker = { oldCommit, oldWorkerSHA256: sha(pinnedLegacy['sw.js']), currentWorkerSHA256: sha(newWorker), oldHTMLSHA256: sha(pinnedLegacy['index.html']), previousScriptURL: previous, cacheVersionChangedByWorker: cache(newWorker) !== cache(pinnedLegacy['sw.js']) };
      await capture(page, 'private-after-worker-update-390');
    });
  } finally {
    await browser.close(); await new Promise(resolve => host.close(resolve));
    report.finishedAt = new Date().toISOString();
    report.limitations = ['Auth and private owner cache are synthetic HTTP fixtures; deployed provider acquisition and production SQL/RLS are unverified.', 'Viewport checks use headless Chromium 153, not physical phones or Apple WebKit.', 'Mixed-worker test uses pinned old shell bytes and a local explicit registration.update() to install the current source CACHE; actual deployed updates remain unverified.', 'Same-selection retry isolates the actual UI with an explicitly injected deferred privateReader; it does not test transport cancellation or deployed Edge behavior.', 'No real account, production write, provider network, or recommendation-usefulness evaluation.'];
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  assert(report.checks.length, 'At least one check must run'); assert(report.checks.every(check => check.pass), 'Private news browser failures are in report.json');
}
main().catch(async error => { console.error(error.stack); host.close(); process.exitCode = 1; });

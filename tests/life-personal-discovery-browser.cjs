/* Personal reader boundaries through the real app, bundled SDK and separate
 * IndexedDB contexts. All accounts, publisher text and Edge responses are
 * synthetic. This does not establish live RLS, actual devices or usefulness. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { accounts, session, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, nav } = require('./unified-home-browser.cjs');
const { openReader, closeReader, assertImportedText } = require('./helpers/discovery-reader.cjs');
const { DiscoveryPrivateCloud, publicMetadata } = require('./helpers/discovery-private-cloud.cjs');
const out = path.resolve(process.env.PERSONAL_DISCOVERY_OUTPUT || '.local/personal-news-browser');
const report = { createdAt: new Date().toISOString(), scope: 'Synthetic owner API/metadata/text, real application/SDK and isolated Chromium contexts. Not operating SQL/RLS, physical devices, Apple or recommendation usefulness.', checks: [], errors: [], externalRequests: [] };
const now = new Date().toISOString();
const rights = { mode: 'full_text_allowed', label: '합성 출처 표기', url: 'https://creativecommons.org/licenses/by/4.0/' };
const source = { id: 'frontiers-psychology', name: '합성 개인 연구 출처', url: 'https://www.frontiersin.org/journals/psychology', feedUrl: 'https://www.frontiersin.org/journals/psychology/rss', language: 'ko', rights, status: 'ok', stale: false, error: null, lastSuccessAt: now, lastAttemptAt: now };
const fixture = { schemaVersion: 1, generatedAt: now, sources: [source], articles: ['alpha', 'beta'].map((id, index) => ({ id, sourceId: source.id,
  title: id === 'alpha' ? '독서와 외국어 학습: 첫 번째 개인 자료' : '집중력과 언어: 두 번째 개인 자료',
  url: 'https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.' + (9900001 + index) + '/full', author: '합성 저자', language: 'ko', tags: ['독서', '언어'],
  publishedAt: new Date(Date.now() - index * 60000).toISOString(), updatedAt: null, dateStatus: 'valid', coverage: 'full_text', summary: '',
  bodyText: '\ufeff' + id + '의 개인 본문\r\n🌱 원문 첫 줄과 줄바꿈을 보존합니다.\r\n\r\n둘째 문단: 사용자 평가는 덧붙이지 않습니다.', fetchedAt: now, rights })) };
const row = (page, id) => page.locator('#discoveryList [data-discovery-id="' + id + '"]');
const idle = page => page.waitForFunction(() => document.querySelector('#discoveryReview')?.getAttribute('aria-busy') === 'false');
const text = page => page.locator('#discoveryReaderContent .discovery-reader-text').evaluate(el => [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join(''));
const state = page => page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(); return { bundle: await s.read(w), actions: await s.readDiscoveryActions(w), feedback: await s.readDiscoveryProfile(w), reading: await s.readDiscoveryReading(w) }; });
async function arrived(hold) {
  let timer;
  try { return await Promise.race([hold.entered, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Private HTTP request did not arrive')), 15000); })]); }
  finally { clearTimeout(timer); }
}
async function flushFrames(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function reveal(control) {
  const count = await control.locator('xpath=ancestor::details').count();
  for (let i = count; i > 0; i--) { const details = control.locator('xpath=ancestor::details[' + i + ']'); if (!await control.isVisible() && !await details.evaluate(el => el.open)) await details.locator(':scope > summary').click(); }
  return control;
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  async function check(name, run) {
    if (process.env.PERSONAL_DISCOVERY_MATCH && !new RegExp(process.env.PERSONAL_DISCOVERY_MATCH).test(name)) return;
    const server = new DiscoveryPrivateCloud(), devices = [], holds = [];
    server.setArticles(accounts.a.id, fixture.articles);
    const device = async (name, account = accounts.a) => {
      const context = await makeContext(browser, server, name, account), page = await context.newPage(); page.setDefaultTimeout(15000);
      await context.route(base + '/assets/life/discovery-feed.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(publicMetadata(fixture)) }));
      await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.externalRequests.push({ name, url: url.href }); return route.abort('blockedbyclient'); });
      page.on('pageerror', error => report.errors.push({ name, kind: 'page', message: error.message }));
      page.on('console', message => { if (message.type() === 'error') report.errors.push({ name, kind: 'console', message: message.text() }); });
      const result = { context, page, name }; devices.push(result);
      await page.goto(base + '/index.html?section=news');
      if (account) { await ready(page); await idle(page); }
      else { await page.waitForFunction(() => globalThis.HaedoLife?.Shell); await page.evaluate(() => HaedoLife.Shell.ready); }
      return result;
    };
    const hold = match => { const value = server.holdPrivate(match); holds.push(value); return value; };
    try { console.log('RUN ' + name); await run({ server, device, hold }); assert.deepEqual(server.privateRouteErrors, []); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true, privateRequests: server.privateRequests }); console.log('PASS ' + name); }
    catch (error) { console.error('FAIL ' + name + '\n' + error.stack); report.checks.push({ name, pass: false, error: error.stack }); for (const d of devices) await d.page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '-' + d.name + '.png'), fullPage: true }).catch(() => {}); }
    finally { holds.forEach(value => value.release()); await Promise.all(devices.map(d => d.context.close())); }
  }
  try {
    await check('anonymous startup and authenticated browsing never prefetch private content', async ({ server, device }) => {
      const guest = await device('guest', null);
      assert.equal(await guest.page.locator('#lifeApp').isHidden(), true); assert.deepEqual(await guest.page.evaluate(() => __homeDbOpens), []);
      assert.equal(server.privateRequests.length, 0);
      const owner = await device('owner'); await row(owner.page, 'alpha').waitFor();
      assert.equal(server.privateRequests.length, 0); assert.equal(await owner.page.locator('#discoveryReader').count(), 0);
      await owner.page.locator('#discoveryNewsSettings').click(); await (await reveal(owner.page.locator('#discoveryPersonalize'))).uncheck(); await idle(owner.page);
      await (await reveal(owner.page.locator('#discoveryAutoRefresh'))).uncheck(); await idle(owner.page);
      await (await reveal(owner.page.locator('#discoveryRefresh'))).click(); await idle(owner.page);
      assert.equal(server.privateRequests.length, 0, 'Recommendation/refresh options do not authorize private article prefetch');
      const metadata = await owner.page.evaluate(async () => (await fetch('assets/life/discovery-feed.json')).json());
      for (const article of metadata.articles) { assert.equal(article.summary, ''); assert.equal(article.coverage, 'link_only'); for (const key of ['bodyText', 'images', 'acquisition']) assert.equal(Object.hasOwn(article, key), false); }
    });
    await check('same account in independent contexts reads its private snapshot while another account cannot receive it', async ({ server, device }) => {
      const a = await device('owner-a'), second = await device('owner-a-second'), b = await device('owner-b', accounts.b);
      const before = await state(a.page);
      await openReader(a.page, row(a.page, 'alpha')); await openReader(second.page, row(second.page, 'alpha'));
      assert.equal(await text(a.page), fixture.articles[0].bodyText); assert.equal(await text(second.page), fixture.articles[0].bodyText);
      await openReader(b.page, row(b.page, 'alpha')); assert.equal(await b.page.locator('#discoveryReader').getAttribute('data-reader-state'), 'ready'); assert.equal(await b.page.locator('.discovery-reader-text').count(), 0);
      assert.equal(await b.page.locator('[data-discovery-original]').getAttribute('href'), fixture.articles[0].url);
      assert.deepEqual(server.privateRequests.map(r => r.owner), [accounts.a.id, accounts.a.id, accounts.b.id]);
      assert.deepEqual(await state(a.page), before, 'Opening text never creates a record or recommendation reaction');
      const privateBytes = await a.page.evaluate(async () => { const keys = await caches.keys(); return Promise.all(keys.map(async key => { const cache = await caches.open(key); return { key, urls: (await cache.keys()).map(r => r.url) }; })); });
      assert(privateBytes.every(cache => cache.urls.every(url => !url.includes('/functions/v1/haedo-discovery-private'))));
    });
    await check('late article reply after close cannot replace the next article or its import', async ({ server, device, hold }) => {
      const { page } = await device('late-close'), before = await state(page), waiting = hold(entry => entry.url === fixture.articles[0].url);
      await row(page, 'alpha').locator('[data-discovery-read]').click(); await arrived(waiting);
      assert.equal(await page.locator('#discoveryReader').getAttribute('data-reader-state'), 'loading'); assert.equal(await page.locator('.discovery-reader-text').count(), 0);
      await closeReader(page); await openReader(page, row(page, 'beta')); assert.equal(await text(page), fixture.articles[1].bodyText);
      waiting.release(); await waiting.responded; await flushFrames(page);
      assert.equal(await page.locator('#discoveryReader').getAttribute('data-discovery-id'), 'beta'); assert.equal(await text(page), fixture.articles[1].bodyText);
      assert.deepEqual(await state(page), before);
      await (await reveal(page.locator('#discoveryReader [data-discovery-import]'))).click(); await page.locator('#lifeImportText').waitFor();
      assertImportedText(await page.locator('#lifeImportText').inputValue(), fixture.articles[1], { textarea: true, privateReading: true }); assert.equal(await page.locator('#lifeImportUrl').inputValue(), fixture.articles[1].url);
      assert.equal(server.privateRequests.length, 2);
    });
    await check('late owner A reply is discarded during account B transition', async ({ device, hold }) => {
      const { page } = await device('late-account'), waiting = hold(entry => entry.owner === accounts.a.id);
      await row(page, 'alpha').locator('[data-discovery-read]').click(); await arrived(waiting);
      await page.evaluate(value => HaedoAuth.client.auth.setSession(value), session(accounts.b));
      await page.waitForFunction(() => !HaedoAuth.user && !HaedoLife.Shell.storage);
      assert.equal(await page.locator('#lifeApp').isHidden(), true);
      waiting.release(); await waiting.responded; await flushFrames(page);
      assert.equal(await page.locator('.discovery-reader-text').count(), 0);
      await page.evaluate(() => HaedoLife.Shell.start()); await ready(page); await idle(page);
      await page.waitForFunction(id => HaedoAuth.user?.id === id, accounts.b.id);
      assert.equal(await page.locator('#discoveryReader').count(), 0);
      await openReader(page, row(page, 'alpha')); assert.equal(await page.locator('#discoveryReader').getAttribute('data-reader-state'), 'ready');
      assert.equal(await page.locator('.discovery-reader-text').count(), 0); assert.match(await page.locator('#discoveryReaderContent').textContent(), /본문이 없습니다/); assert.deepEqual((await state(page)).actions.entries, []);
    });
    await check('temporary acquisition failure keeps source and link-only import; keyboard retry recovers exact text', async ({ server, device, hold }) => {
      const key = server.articleKey(accounts.a.id, source.id, fixture.articles[0].url);
      server.privateReplies.set(key, { status: 'busy' });
      const { page } = await device('retry'); await openReader(page, row(page, 'alpha'));
      assert.equal(await page.locator('#discoveryReader').getAttribute('data-reader-state'), 'error'); assert.equal(await page.locator('#discoveryReaderRetry').isVisible(), true);
      assert.equal(await page.locator('[data-discovery-original]').getAttribute('href'), fixture.articles[0].url); assert.equal(await page.locator('.discovery-reader-text').count(), 0);
      await (await reveal(page.locator('#discoveryReader [data-discovery-import]'))).click(); await page.locator('#lifeImportTitle').waitFor(); assert.equal(await page.locator('#lifeImportMethodLink').getAttribute('aria-pressed'), 'true'); assert.equal(await page.locator('#lifeImportText').inputValue(), '');
      await nav(page, 'news'); await idle(page); await openReader(page, row(page, 'alpha')); assert.equal(await page.locator('#discoveryReader').getAttribute('data-reader-state'), 'error');
      server.privateReplies.delete(key); const cached = server.privateArticles.get(key); cached.cached = true; cached.stale = true;
      const waiting = hold(); await page.locator('#discoveryReaderRetry').focus(); await page.locator('#discoveryReaderRetry').press('Enter'); await arrived(waiting);
      assert.equal(await page.locator('#discoveryReaderRetry').isDisabled(), true); assert.equal(await page.locator('#discoveryReader').getAttribute('data-reader-state'), 'loading');
      waiting.release(); await waiting.responded; await page.locator('#discoveryReader[data-reader-state="ready"]').waitFor();
      assert.equal(await text(page), fixture.articles[0].bodyText); assert.equal(server.privateRequests.length, 3);
      assert.equal(await page.locator('#discoveryReaderTitle').evaluate(el => el === document.activeElement), true);
      assert.equal(await page.locator('.discovery-reader-stale time').getAttribute('datetime'), fixture.articles[0].fetchedAt);
    });
    await check('leaving the news section aborts a pending article without resurrecting it', async ({ device, hold }) => {
      const { page } = await device('late-section'), waiting = hold();
      await row(page, 'alpha').locator('[data-discovery-read]').click(); await arrived(waiting); await nav(page, 'records');
      waiting.release(); await waiting.responded; await flushFrames(page); assert.equal(await page.locator('#discoveryReader').count(), 0);
      await nav(page, 'news'); await idle(page); assert.equal(await page.locator('#discoveryReader').count(), 0); assert.equal(await page.locator('.discovery-reader-text').count(), 0);
    });
    await check('importing while pending keeps a link-only draft and late content cannot overwrite typing', async ({ device, hold }) => {
      const { page } = await device('pending-import'), before = await state(page), waiting = hold();
      await row(page, 'alpha').locator('[data-discovery-read]').click(); await arrived(waiting);
      await (await reveal(page.locator('#discoveryReader [data-discovery-import]'))).click(); await page.locator('#lifeImportTitle').waitFor();
      assert.equal(await page.locator('#lifeImportMethodLink').getAttribute('aria-pressed'), 'true'); assert.equal(await page.locator('#lifeImportText').inputValue(), ''); assert.equal(await page.locator('#lifeImportUrl').inputValue(), fixture.articles[0].url);
      const draft = '직접 입력 중인 미완료 문장 🌱'; await page.locator('#lifeImportMethodText').click(); await page.locator('#lifeImportText').fill(draft);
      waiting.release(); await waiting.responded; await flushFrames(page);
      assert.equal(await page.locator('#lifeImportText').inputValue(), draft); assert.equal(await page.locator('#discoveryReader').count(), 0);
      assert.deepEqual((await state(page)).bundle, before.bundle);
    });
  } finally { await browser.close(); await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []); assert(report.checks.every(c => c.pass), 'Private reader browser failures are in report.json');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

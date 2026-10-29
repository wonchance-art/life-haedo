/* Internal news reading against the real app, bundled SDK and isolated IndexedDB.
 * Synthetic Auth/public metadata/private content/images only. Publisher navigation is intercepted after
 * its explicit click; no production account, real publisher or Apple device. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { accounts, session, cloud, base } = require('./life-sync-browser.cjs');
const { DiscoveryPrivateCloud, publicMetadata } = require('./helpers/discovery-private-cloud.cjs');
const { playwright, makeContext, ready, nav } = require('./unified-home-browser.cjs');
const { openReader, closeReader, assertImportedText } = require('./helpers/discovery-reader.cjs');
const out = path.resolve(process.env.DISCOVERY_READER_OUTPUT || '.local/discovery-reader-browser');
const report = { createdAt: new Date().toISOString(), scope: 'Local Chromium, real UI/SDK/scoped IndexedDB; synthetic Auth/feed/PNG and intercepted explicit original popup. No production data, publisher fetch, Apple device or usefulness claim.', checks: [], visual: [], consoleErrors: [], pageErrors: [], unexpectedExternal: [], originalRequests: [] };
let imageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ZkAAAAASUVORK5CYII=';
const sourceUrl = 'https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.9999999/full';
const body = ['함께 읽는 언어 연구', '첫 번째 문단: 독서와 집중력의 관계를 정확한 문장으로 읽습니다. <script>window.__unsafeReader = true</script>', ...Array.from({ length: 12 }, (_, i) => (i + 2) + '번째 문단: 외국어를 읽으며 기억과 학습을 살펴봅니다. 출처가 제공한 내용이며 자동 요약이나 사용자 평가가 아닙니다. 같은 제목의 후속 갱신이 이 본문을 바꾸어서는 안 됩니다.')].join('\n\n');
function fixture() {
  const now = new Date().toISOString(), license = { label: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }, rights = { ...license, mode: 'full_text_allowed' };
  const source = { id: 'frontiers-psychology', name: '합성 연구 출처', url: 'https://www.frontiersin.org/journals/psychology', feedUrl: 'https://www.frontiersin.org/journals/psychology/rss', language: 'ko', rights, status: 'ok', stale: false, error: null, lastSuccessAt: now, lastAttemptAt: now };
  const article = (id, title, minutes, patch) => ({ id, sourceId: source.id, title, url: sourceUrl.replace('9999999', String(9999999 - minutes)), author: '익명 연구자', language: 'ko', tags: ['독서', '언어'], publishedAt: new Date(Date.now() - minutes * 60000).toISOString(), updatedAt: null, dateStatus: 'valid', coverage: 'link_only', summary: '', fetchedAt: now, rights: { ...license, mode: 'metadata_only' }, ...patch });
  return { schemaVersion: 1, generatedAt: now, sources: [source], articles: [
    article('full', '한국어로 읽는 연구: 독서·집중력·외국어 학습을 함께 살펴보는 긴 제목', 0, { coverage: 'full_text', bodyText: body, rights, images: [{ mimeType: 'image/png', dataBase64: imageData, alt: '익명 합성 연구 그림', caption: '그림 1. 이미지 재현 검수용 합성 도식', credit: '익명 연구자', license, sourceUrl: 'https://www.frontiersin.org/files/Articles/9999999/xml-images/fpsyg-99-9999999-g001.webp', afterParagraph: 1 }] }),
    article('summary', '짧은 요약만 확보한 언어 학습 자료', 1, { coverage: 'summary', summary: '출처가 제공한 초록입니다. 전문과 이미지가 확보되었다고 표시하지 않습니다.', rights: { ...license, mode: 'summary_allowed' } }),
    article('link', '링크만 확보한 집중력 자료', 2),
    article('last', '목록 위치를 보존하는 마지막 자료', 3)
  ] };
}
const row = (page, id) => page.locator('#discoveryList [data-discovery-id="' + id + '"]');
const readerText = page => page.locator('#discoveryReaderContent .discovery-reader-text').evaluate(element => [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(''));
const idle = page => page.waitForFunction(() => document.querySelector('#discoveryReview')?.getAttribute('aria-busy') === 'false');
const state = page => page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(); return { bundle: await s.read(w), actions: await s.readDiscoveryActions(w), feedback: await s.readDiscoveryProfile(w), reading: await s.readDiscoveryReading(w) }; });
async function reveal(control) {
  const depth = await control.locator('xpath=ancestor::details').count();
  for (let i = depth; i > 0; i--) { const d = control.locator('xpath=ancestor::details[' + i + ']'); if (!await control.isVisible() && !await d.evaluate(e => e.open)) await d.locator(':scope > summary').click(); }
  return control;
}
async function open(page, file = 'index.html') { await page.goto(base + '/' + file + '?section=news'); await ready(page); await idle(page); }
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] }); report.browser = browser.version();
  const imagePage = await browser.newPage();
  imageData = await imagePage.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 280; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f0f4f3'; ctx.fillRect(0, 0, 640, 280); ctx.fillStyle = '#245c53'; ctx.fillRect(64, 160, 100, 60); ctx.fillRect(232, 100, 100, 120); ctx.fillRect(400, 60, 100, 160); ctx.fillStyle = '#263733'; ctx.font = '18px sans-serif'; ctx.fillText('Synthetic image fixture', 64, 35); return canvas.toDataURL('image/png').split(',')[1]; });
  await imagePage.close();
  async function check(name, run) {
    if (process.env.DISCOVERY_READER_MATCH && !new RegExp(process.env.DISCOVERY_READER_MATCH).test(name)) return;
    const server = new DiscoveryPrivateCloud(), context = await makeContext(browser, server, 'reader-' + report.checks.length, accounts.a, { viewport: { width: 820, height: 1000 }, reducedMotion: 'reduce' });
    const feed = { value: fixture(), requests: 0 }; let expectedOriginal = null;
    server.setArticles(accounts.a.id, feed.value.articles);
    await context.route(base + '/assets/life/discovery-feed.json', route => { feed.requests++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify(publicMetadata(feed.value)) }); });
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback();
      if (request.isNavigationRequest() && request.url() === expectedOriginal) { expectedOriginal = null; report.originalRequests.push({ url: request.url(), referrer: request.headers().referer || null }); assert.equal(request.headers().referer, undefined); return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>합성 원문</title>' }); }
      report.unexpectedExternal.push({ name, url: request.url() }); return route.abort('blockedbyclient');
    });
    await context.addInitScript(() => {
      window.__readerBlobCreated = []; window.__readerBlobRevoked = [];
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = create(blob); __readerBlobCreated.push(url); return url; };
      URL.revokeObjectURL = url => { __readerBlobRevoked.push(url); revoke(url); };
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.pageErrors.push({ name, message: error.message }));
    page.on('console', error => { if (error.type() === 'error') report.consoleErrors.push({ name, message: error.text() }); });
    try { console.log('RUN ' + name); await run({ page, context, feed, server, arm: url => { expectedOriginal = url; } }); assert.equal(server.writes().length, 0); assert.deepEqual(server.privateRouteErrors, []); report.checks.push({ name, pass: true, privateRequests: server.privateRequests }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    await check('internal body, safe image, explicit source, reactions and exact list return at three widths', async ({ page, context, arm }) => {
      await open(page); const before = await state(page), initialPages = context.pages().length;
      assert.equal(await page.locator('#discoveryList a[data-discovery-open]').count(), 0, 'Titles use internal read controls');
      for (const width of [1440, 820, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        const control = row(page, 'full').locator('[data-discovery-read]'); await control.focus(); await control.press('Enter'); await page.locator('#discoveryReader').waitFor();
        await page.locator('#discoveryReader[data-reader-state="ready"]').waitFor();
        assert.equal(context.pages().length, initialPages); assert.equal(await page.locator('#discoveryList').isVisible(), false);
        assert.equal(await readerText(page), body);
        assert.equal(await page.evaluate(() => !!window.__unsafeReader), false);
        const img = page.locator('#discoveryReader img'); await img.waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('#discoveryReader img')].every(img => img.complete && img.naturalWidth > 0));
        assert.match(await img.getAttribute('src'), /^blob:/); assert.equal(await img.getAttribute('alt'), '익명 합성 연구 그림');
        assert.match(await page.locator('#discoveryReader').textContent(), /그림 1\.|CC BY 4\.0/);
        const audit = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, titleFocused: document.activeElement?.id === 'discoveryReaderTitle', controls: [...document.querySelectorAll('#discoveryReader button, #discoveryReader > .discovery-reader-navigation a')].filter(e => e.checkVisibility()).map(e => ({ label: e.getAttribute('aria-label') || e.textContent, width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height })) }));
        assert(audit.documentWidth <= width); assert.equal(audit.titleFocused, true); assert(audit.controls.every(x => x.width >= 44 && x.height >= 44));
        const file = 'reader-' + width + '.png'; await page.screenshot({ path: path.join(out, file), fullPage: false }); report.visual.push({ width, file, audit });
        await closeReader(page); await page.waitForFunction(() => document.activeElement?.matches('[data-discovery-read]'));
        assert.deepEqual(await state(page), before, 'Reading does not record reactions or reading judgements');
      }
      await openReader(page, row(page, 'full'));
      const original = page.locator('[data-discovery-original]'); assert.equal(await original.getAttribute('href'), sourceUrl); assert.equal(await original.getAttribute('target'), '_blank'); assert.match(await original.getAttribute('rel'), /noopener.*noreferrer/);
      const opened = context.waitForEvent('page'); arm(sourceUrl); await original.click(); const popup = await opened; await popup.waitForLoadState('domcontentloaded'); assert.deepEqual(await popup.evaluate(() => ({ referrer: document.referrer, noOpener: opener === null })), { referrer: '', noOpener: true }); await popup.close(); await page.bringToFront();
      for (const kind of ['liked', 'bookmarked']) { await page.locator('#discoveryReader [data-discovery-reaction="' + kind + '"]').click(); await idle(page); assert.equal(await page.locator('#discoveryReader [data-discovery-reaction="' + kind + '"]').getAttribute('aria-pressed'), 'true'); assert.equal(await readerText(page), body); }
      const reacted = await state(page), saved = reacted.actions.entries[0]; assert.equal(saved.liked, true); assert.equal(saved.bookmarked, true); assert.equal(saved.snapshot.coverage, 'link_only'); for (const key of ['images', 'bodyText', 'summary']) assert.equal(Object.hasOwn(saved.snapshot, key), false); assert.deepEqual(reacted.feedback, before.feedback); assert.deepEqual(reacted.reading, before.reading); assert.deepEqual(reacted.bundle, before.bundle);
      await closeReader(page);
      await row(page, 'last').locator('[data-discovery-read]').scrollIntoViewIfNeeded(); const returnY = await page.evaluate(() => scrollY); await openReader(page, row(page, 'last')); await closeReader(page); try { await page.waitForFunction(y => Math.abs(scrollY - y) < 2, returnY); } catch (error) { report.scrollFailure = await page.evaluate(before => ({ before, after: scrollY, focus: document.activeElement?.dataset.focusKey, doc: document.documentElement.scrollHeight, state: history.state, titleRect: document.querySelector('#discoveryList [data-discovery-id=last] [data-discovery-read]')?.getBoundingClientRect().toJSON() }), returnY); throw error; } assert.equal(await row(page, 'last').locator('[data-discovery-read]').evaluate(e => e === document.activeElement), true);
      const blobs = await page.evaluate(() => ({ made: __readerBlobCreated, revoked: __readerBlobRevoked })); assert(blobs.made.length >= 4); assert(blobs.made.every(url => blobs.revoked.includes(url)));
    });
    await check('summary, link-only and failed image remain honest and readable', async ({ page }) => {
      await open(page, 'life.html'); const before = await state(page);
      await openReader(page, row(page, 'summary')); assert.match(await page.locator('#discoveryReaderContent').textContent(), /요약/); assert.equal(await page.locator('#discoveryReader img').count(), 0); assert.equal(await readerText(page), fixture().articles[1].summary); await closeReader(page);
      await openReader(page, row(page, 'link')); assert.match(await page.locator('#discoveryReaderContent').textContent(), /본문.*없|미확보/); assert.equal(await page.locator('#discoveryReader img').count(), 0); assert.equal(await page.locator('[data-discovery-original]').isVisible(), true); await closeReader(page);
      await openReader(page, row(page, 'full')); const img = page.locator('#discoveryReader img'); await img.dispatchEvent('error'); assert.equal(await readerText(page), body); assert.match(await page.locator('#discoveryReaderContent').textContent(), /이미지|그림/); await closeReader(page); assert.deepEqual(await state(page), before);
    });
    await check('background catalogue update preserves opened text and explicit import snapshot', async ({ page, feed }) => {
      await open(page); await page.clock.install({ time: new Date() }); await page.locator('#discoveryNewsSettings').click(); await (await reveal(page.locator('#discoveryAutoRefresh'))).check(); await idle(page); await page.locator('#discoveryNewsSettingsBack').click();
      const initial = await state(page); await openReader(page, row(page, 'full')); const originalNode = await page.locator('#discoveryReaderContent').elementHandle(); const originalCount = feed.requests;
      feed.value = fixture(); feed.value.articles[0].bodyText = '뒤늦게 도착한 다른 본문으로 읽던 판을 바꾸지 않습니다.'; feed.value.articles[0].title = '갱신된 제목';
      await page.clock.fastForward(15 * 60000 + 1000); await idle(page); assert.equal(feed.requests, originalCount + 1); assert.equal(await readerText(page), body); assert.equal(await originalNode.evaluate(e => e === document.querySelector('#discoveryReaderContent')), true);
      await (await reveal(page.locator('#discoveryReader [data-discovery-import]'))).click(); await page.locator('#lifeImportText').waitFor(); assertImportedText(await page.locator('#lifeImportText').inputValue(), fixture().articles[0], { textarea: true, privateReading: true }); assert.equal(await page.locator('#lifeImportUrl').inputValue(), sourceUrl); assert.deepEqual((await state(page)).bundle, initial.bundle);
      await page.getByRole('button', { name: '원문·출처 확인', exact: true }).click(); await page.locator('.life-review').waitFor(); await page.getByRole('button', { name: '자료만 보관', exact: true }).click(); await page.locator('.life-reader').waitFor();
      const after = await state(page), source = after.bundle.sources.find(s => s.url === sourceUrl); assert(source); const version = after.bundle.sourceVersions.find(v => v.sourceId === source.id); assertImportedText(version.contentText, fixture().articles[0], { privateReading: true }); assert.equal(version.coverage.status, 'full_text'); assert.equal(Object.hasOwn(version, 'images'), false); assert.deepEqual(after.actions, initial.actions); assert.deepEqual(after.feedback, initial.feedback);
      await page.getByRole('button', { name: '새 글 찾기로 돌아가기', exact: true }).click(); await idle(page); assert.equal(await row(page, 'full').count(), 0, 'Imported source is excluded using exact URL');
    });
    await check('browser back, section leave, workspace and account transition clear reader and image resources', async ({ page }) => {
      await open(page); await openReader(page, row(page, 'full')); await page.goBack(); await page.locator('#discoveryReader').waitFor({ state: 'detached' }); assert.equal(await page.locator('#discoveryList').isVisible(), true); assert.equal(new URL(page.url()).searchParams.get('section'), 'news');
      await nav(page, 'records'); const priorRoute = page.url(); await nav(page, 'news'); await idle(page);
      await openReader(page, row(page, 'full')); await nav(page, 'home'); assert.equal(await page.locator('#discoveryReader').count(), 0);
      await page.goBack(); await page.locator('#discoveryList').waitFor({ state: 'visible' }); await idle(page);
      assert.equal(new URL(page.url()).searchParams.get('section'), 'news'); assert.equal(await page.locator('#discoveryReader').count(), 0); assert.equal(await page.evaluate(() => history.state?.haedoNewsReader === true), false);
      await page.goBack(); await page.waitForURL(priorRoute); await page.waitForFunction(() => document.querySelector('#lifeMain')?.dataset.mode === 'sources');
      assert.equal(page.url(), priorRoute, 'Leaving the reader does not add a duplicate news-list history entry'); await nav(page, 'news'); await idle(page);
      await openReader(page, row(page, 'full')); await nav(page, 'records'); assert.equal(await page.locator('#discoveryReader').count(), 0); await nav(page, 'news'); await idle(page); assert.equal(await page.locator('#discoveryReader').count(), 0);
      const other = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, original = await s.getActive(), other = await s.createWorkspace('익명 reader 두 번째 공간'); await s.setActive(original); return other.workspaceId; });
      assert(await page.evaluate(() => __readerBlobCreated.every(url => __readerBlobRevoked.includes(url)))); await page.reload(); await ready(page); await idle(page);
      await openReader(page, row(page, 'full')); await nav(page, 'manage'); await page.locator('#lifeCurrentWorkspace').click(); await page.locator('#lifeWorkspace').selectOption(other); await page.waitForFunction(async id => await HaedoLife.Shell.storage.getActive() === id, other); await nav(page, 'news'); await idle(page); assert.equal(await page.locator('#discoveryReader').count(), 0); assert.deepEqual((await state(page)).actions.entries, []);
      await openReader(page, row(page, 'full')); await page.evaluate(value => HaedoAuth.client.auth.setSession(value), session(accounts.b)); await page.waitForFunction(() => !HaedoAuth.user && !HaedoLife.Shell.storage); assert.equal(await page.locator('#lifeApp').isHidden(), true); await page.evaluate(() => HaedoLife.Shell.start()); await ready(page); await page.waitForFunction(id => HaedoAuth.user?.id === id, accounts.b.id); assert.equal(await page.locator('#discoveryReader').count(), 0); assert.deepEqual((await state(page)).actions.entries, []);
      const blobs = await page.evaluate(() => ({ made: __readerBlobCreated, revoked: __readerBlobRevoked })); assert(blobs.made.length >= 2); assert(blobs.made.every(url => blobs.revoked.includes(url)));
    });
  } finally {
    await browser.close(); await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.unexpectedExternal, []); assert(report.checks.every(c => c.pass), 'Reader flow failures are recorded in report.json');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

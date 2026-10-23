/* News feed hierarchy and explicit reaction semantics. Actual local UI, bundled
 * SDK and scoped IndexedDB; mocked Auth and synthetic Korean public metadata.
 * No production/publisher requests, actual reading, Apple or usefulness claim. */
'use strict';
const { isLegacyLibraryCapabilityRead } = require('./helpers/library-cloud.cjs');
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, nav } = require('./unified-home-browser.cjs');
const repo = path.resolve(__dirname, '..');
const output = path.resolve(process.env.NEWS_SOCIAL_OUTPUT || path.join(repo, '.local/news-social-redesign-20261021/qa'));
const entry = base + '/index.html?section=news', feedPath = '/assets/life/discovery-feed.json';
const PRIVATE = '뉴스UI검수_비공개합성입력_외부전송금지';
const report = { createdAt: new Date().toISOString(), scope: 'Focused local news hierarchy/reaction UI with actual bundled SDK and account-scoped IndexedDB. Auth and public feed metadata are synthetic fixtures; IME and viewport changes are simulated. No production Auth/DB, live publisher/Google response, Apple device, reading or usefulness claim.', checks: [], visual: [], consoleErrors: [], pageErrors: [], externalRequests: [], privacyViolations: [], modelRequests: [], libraryCapabilityReads: [], remoteWrites: [], catalogRequests: [] };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const products = ['assets/life/discovery-ui.js', 'assets/life/discovery.css', 'assets/life/discovery.js', 'assets/life/discovery-actions.js', 'assets/life/discovery-recommendations.js', 'assets/life/discovery-reading.js', 'assets/life/discovery-reading-ui.js', 'assets/life/storage.js', 'assets/life/ui.js', 'assets/life/shell.js', 'assets/haedo-shell.css'];
const hashes = async () => Object.fromEntries(await Promise.all(products.map(async file => [file, sha(await fs.readFile(path.join(repo, file)))])));
const url = id => 'https://d2.naver.com/news-social-qa/' + id;
function fixture() {
  const now = new Date().toISOString(), rights = { mode: 'metadata_only', label: '합성 공개 제목·태그·URL만 제공', url: 'https://d2.naver.com/' };
  const source = { id: 'naver-d2', name: '합성 공개 기술 소식', url: 'https://d2.naver.com/', feedUrl: 'https://d2.naver.com/news-social-feed', language: 'ko', rights,
    status: 'ok', stale: false, lastSuccessAt: now, lastAttemptAt: now, error: null };
  const rows = [['first', '인공지능과 언어 연구를 읽고 기록하는 방법: 제목이 긴 뉴스의 실제 줄바꿈과 출처를 확인합니다', 'ko'],
    ['negative', '도시 공연장의 접근성을 살펴본 공개 소식', 'ko'], ['english', 'Language research notes and practical reading advice', 'en'],
    ['fourth', '책과 전시에서 발견한 표현을 비교하는 기록', 'ko'], ['fifth', '새로운 도구를 읽고 직접 고른 자료만 보관하기', 'ko']];
  return { schemaVersion: 1, generatedAt: now, sources: [source], articles: rows.map(([id, title, language], index) => ({ id, sourceId: source.id, url: url(id),
    title, language, tags: index === 0 ? ['인공지능', '언어'] : [], author: null, publishedAt: new Date(Date.now() - index * 86400000).toISOString(),
    fetchedAt: now, summary: '', coverage: 'link_only', rights })) };
}
const row = (page, id) => page.locator('#discoveryList [data-discovery-id="' + id + '"]');
async function idle(page) { await page.waitForFunction(() => document.querySelector('#discoveryReview')?.getAttribute('aria-busy') === 'false'); }
// Follow the actual settings/back buttons before opening native disclosures.
async function newsView(control) {
  const page = control.page(), panel = page.locator('#discoveryNewsSettingsPanel');
  if (!await panel.count()) return;
  const settingsTarget = await control.evaluate(element => !!element.closest('#discoveryNewsSettingsPanel'));
  if (settingsTarget && !await panel.isVisible()) await page.locator('#discoveryNewsSettings').click();
  else if (!settingsTarget && await panel.isVisible()) await page.locator('#discoveryNewsSettingsBack').click();
}
async function selectNewsMode(page, value) {
  if (value === 'personal' && await page.locator('#discoverySort option[value="personal"]').isDisabled()) {
    const optIn = await revealControl(page.locator('#discoveryPersonalize'));
    await optIn.check();
    await page.waitForFunction(() => document.querySelector('#discoveryReview')?.getAttribute('aria-busy') === 'false');
  }
  await newsView(page.locator('#discoveryDiscover'));
  if (await page.locator('#discoverySort').isHidden()) await page.locator('#discoveryDiscover').click();
  await page.locator('#discoverySort').selectOption(value);
}
async function disclose(details) { await newsView(details); if (!await details.evaluate(element => element.open)) await details.locator(':scope > summary').click(); }
async function revealControl(control) {
  await newsView(control);
  const count = await control.locator('xpath=ancestor::details').count();
  for (let index = count; index > 0; index--) if (!await control.isVisible()) await disclose(control.locator('xpath=ancestor::details[' + index + ']'));
  return control;
}
async function click(page, selector) { const mode = { '#discoveryLatest': 'latest', '#discoveryRecommended': 'related', '#discoveryPersonalized': 'personal' }[selector]; if (mode) await selectNewsMode(page, mode); else await (await revealControl(page.locator(selector))).click(); await idle(page); }
async function state(page) {
  return page.evaluate(async () => {
    const storage = HaedoLife.Shell.storage, workspaceId = await storage.getActive();
    return { workspaceId, bundle: await storage.read(workspaceId), workbench: await storage.readWorkbench(workspaceId),
      interest: await storage.readInterestProfile(workspaceId), feedback: await storage.readDiscoveryProfile(workspaceId), actions: await storage.readDiscoveryActions(workspaceId),
      settings: await storage.readDiscoverySettings(workspaceId), language: await storage.readDiscoveryLanguageSettings(workspaceId), reading: await storage.readDiscoveryReading(workspaceId) };
  });
}
async function reaction(page, id, kind, target) {
  const control = row(page, id).locator('[data-discovery-reaction="' + kind + '"]');
  await newsView(control); assert.equal(await control.isVisible(), true); if ((await control.getAttribute('aria-pressed') === 'true') !== target) await control.click();
  await idle(page); await page.waitForFunction(async ({ address, kind, target }) => {
    const s = HaedoLife.Shell.storage, profile = await s.readDiscoveryActions(await s.getActive()); return profile.entries.some(entry => entry.canonicalUrl === address && entry[kind] === target);
  }, { address: url(id), kind, target });
}
async function main() {
  await fs.mkdir(output, { recursive: true }); report.productsBefore = await hashes(); report.runnerSHA256 = sha(await fs.readFile(__filename));
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version(); const fake = new FakeCloud();
  const context = await makeContext(browser, fake, 'news-social-focused', accounts.a, { viewport: { width: 820, height: 1000 }, reducedMotion: 'reduce' });
  const publicFeed = fixture();
  await context.route(base + feedPath, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(publicFeed) }));
  await context.route(base + '/assets/life/storage.js', async route => {
    const response = await route.fetch();
    const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,async saveInterestProfile(...values){if(window.__newsSocialFailTopic){window.__newsSocialFailTopic=false;throw Error('Synthetic local topic save failure');}return actual.saveInterestProfile(...values);}});}});})();`;
    await route.fulfill({ response, body: await response.text() + hook });
  });
  context.on('request', request => {
    const address = new URL(request.url()), body = request.postData() || '', headers = request.headers();
    if ([PRIVATE, encodeURIComponent(PRIVATE), JSON.stringify(PRIVATE).slice(1, -1)].some(value => address.href.includes(value) || body.includes(value))) report.privacyViolations.push({ destination: address.origin + address.pathname });
    if (/huggingface|xethub|transformers|onnxruntime|\.onnx(?:$|\?)|\.wasm(?:$|\?)/i.test(address.href)) report.modelRequests.push(address.origin + address.pathname);
    if (isLegacyLibraryCapabilityRead(request, { cloud, server: fake })) report.libraryCapabilityReads.push({ owner: fake.libraryOwner(request), method: request.method(), path: address.pathname, parameterCount: 0 });
    else if (address.origin === cloud && address.pathname.startsWith('/rest/') && !['GET', 'OPTIONS'].includes(request.method())) report.remoteWrites.push(address.pathname);
    if (address.origin === new URL(base).origin && address.pathname === feedPath) {
      const boundary = { method: request.method(), query: !!address.search, body: !!request.postData(), auth: !!headers.authorization, cookie: !!headers.cookie, referrer: !!headers.referer };
      report.catalogRequests.push(boundary); if (boundary.method !== 'GET' || Object.entries(boundary).some(([key, value]) => key !== 'method' && value)) report.privacyViolations.push({ reason: 'Fixed public catalog boundary' });
    }
  });
  await context.route('**/*', route => {
    const address = new URL(route.request().url());
    if ([new URL(base).origin, cloud].includes(address.origin)) return route.fallback();
    report.externalRequests.push(address.origin + address.pathname); return route.abort('blockedbyclient');
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); }); page.on('pageerror', error => report.pageErrors.push(error.message));
  async function check(name, run) {
    console.log('RUN ' + name);
    try { await run(); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); throw error; }
  }
  try {
    await page.goto(entry); await ready(page); await idle(page); const original = await state(page);
    await check('icon-only primary lists keep neutral history and personalization in the separate settings view', async () => {
      assert.equal(await page.locator('.discovery-collection-tabs #discoveryCancelled').count(), 0);
      assert.deepEqual(await page.locator('.discovery-collection-tabs button').evaluateAll(nodes => nodes.map(node => node.id)), ['discoveryDiscover', 'discoveryLiked', 'discoveryBookmarked']);
      for (const id of ['discoveryDiscover', 'discoveryLiked', 'discoveryBookmarked']) { const control = page.locator('#' + id); assert.equal(await control.isVisible(), true); assert.equal((await control.innerText()).trim(), ''); assert(await control.getAttribute('aria-label')); assert(await control.getAttribute('title')); }
      assert.equal(await page.locator('#discoveryNewsSettingsPanel').isVisible(), false); assert.equal(await page.locator('#discoverySort').inputValue(), 'latest'); assert.equal(await page.locator('#discoverySort option[value="personal"]').isDisabled(), true);
      assert.equal(await page.locator('#discoveryNewsPreferences').evaluate(details => details.open), false);
      assert.equal(await page.locator('#discoveryCancelled').isVisible(), false); assert.equal(await page.locator('#discoveryPersonalize').isVisible(), false);
      await disclose(page.locator('#discoveryNewsPreferences'));
      assert.equal(await page.locator('.discovery-feed-body').isVisible(), false);
      assert.equal(await page.locator('#discoveryNewsSettingsBack').isVisible(), true);
      assert.match(await page.locator('#discoveryCancelled').innerText(), /반응 해제 기록/);
      assert.match(await page.locator('#discoveryNewsPreferences').innerText(), /부정 평가가 아니|관련 없음과는 다/);
      assert.equal(await page.locator('#discoveryPersonalize').isChecked(), false);
      await (await revealControl(page.locator('#discoveryNewsPreferences > summary'))).click(); await newsView(page.locator('#discoveryList')); assert.equal(await page.locator('#discoveryNewsSettingsPanel').isVisible(), false); assert.deepEqual(await state(page), original);
    });
    await check('native keyboard article options and information open explicitly and Escape restores their summary focus', async () => {
      const article = row(page, 'first'), more = article.locator('details.discovery-more'), summary = more.locator(':scope > summary');
      assert.equal(await more.evaluate(element => element.open), false); assert.equal(await article.locator('[data-discovery-import]').isVisible(), false);
      assert.equal(await article.locator('[data-discovery-feedback="not_relevant"]').isVisible(), false);
      for (const kind of ['liked', 'bookmarked']) { const control = article.locator('[data-discovery-reaction="' + kind + '"]'); assert.equal(await control.isVisible(), true); assert.equal((await control.innerText()).trim(), ''); assert(await control.getAttribute('aria-label')); assert(await control.getAttribute('title')); }
      await summary.focus(); await page.keyboard.press('Enter'); assert.equal(await more.evaluate(element => element.open), true);
      await article.locator('[data-discovery-feedback="already_read"]').focus(); await page.keyboard.press('Escape');
      assert.equal(await more.evaluate(element => element.open), false); assert.equal(await summary.evaluate(element => document.activeElement === element), true);
      await summary.focus(); await page.keyboard.press('Enter');
      const info = article.locator('details.discovery-article-info'), infoSummary = info.locator(':scope > summary');
      assert.equal(await info.evaluate(element => element.open), false); assert.equal(await info.locator('.discovery-coverage').isVisible(), false);
      await infoSummary.focus(); await page.keyboard.press('Enter'); assert.match(await info.innerText(), /본문 미확보/); await page.keyboard.press('Escape');
      assert.equal(await info.evaluate(element => element.open), false); assert.equal(await infoSummary.evaluate(element => document.activeElement === element), true); await summary.focus(); await page.keyboard.press('Escape');
      assert.deepEqual(await state(page), original);
    });
    await check('unlike and unbookmark produce a neutral retained record and independent restoration never creates negative feedback', async () => {
      await reaction(page, 'first', 'liked', true); await reaction(page, 'first', 'bookmarked', true); await reaction(page, 'first', 'liked', false);
      let after = await state(page), retained = after.actions.entries.find(entry => entry.canonicalUrl === url('first'));
      assert.equal(retained.liked, false); assert.equal(retained.bookmarked, true); assert.equal(retained.excludedFromRecommendations, false);
      assert.deepEqual(after.feedback, original.feedback); await click(page, '#discoveryBookmarked'); await reaction(page, 'first', 'bookmarked', false);
      await click(page, '#discoveryCancelled'); assert.equal(await row(page, 'first').count(), 1);
      assert.match(await page.locator('#discoveryReview').innerText(), /반응 해제 기록/);
      after = await state(page); assert.deepEqual(after.feedback, original.feedback); assert.deepEqual(after.reading, original.reading);
      assert.equal(after.actions.entries[0].excludedFromRecommendations, false); assert.equal(after.actions.personalizationEnabled, false);
      await reaction(page, 'first', 'liked', true); after = await state(page); retained = after.actions.entries[0];
      assert.equal(retained.liked, true); assert.equal(retained.bookmarked, false);
      await click(page, '#discoveryLiked'); assert.equal(await row(page, 'first').count(), 1);
      await page.reload(); await ready(page); await idle(page); await click(page, '#discoveryLiked'); assert.equal(await row(page, 'first').count(), 1);
      assert.deepEqual((await state(page)).actions, after.actions);
    });
    await check('explicit unrelated feedback hides a feed article and undo remains distinct from reaction-removal history', async () => {
      await click(page, '#discoveryDiscover'); await click(page, '#discoveryLatest');
      await (await revealControl(row(page, 'negative').locator('[data-discovery-feedback="not_relevant"]'))).click(); await idle(page);
      const after = await state(page); assert(after.feedback.feedback.some(entry => entry.canonicalUrl === url('negative') && entry.kind === 'not_relevant'));
      assert.equal(after.actions.entries.some(entry => entry.canonicalUrl === url('negative')), false); assert.equal(await row(page, 'negative').count(), 0);
      await click(page, '#discoveryCancelled'); assert.equal(await row(page, 'negative').count(), 0);
      await click(page, '#discoveryDiscover'); await (await revealControl(page.locator('[data-discovery-undo="negative"]'))).click(); await idle(page);
      assert.deepEqual((await state(page)).feedback.feedback, []); assert.equal(await row(page, 'negative').count(), 1);
      assert.equal((await state(page)).actions.entries.some(entry => entry.canonicalUrl === url('negative')), false);
    });
    await check('topic IME redraw and failed local save preserve the same input and retry through the actual form', async () => {
      await disclose(page.locator('#discoveryTopics')); const input = page.locator('#discoveryTopicInput');
      await input.focus(); await input.evaluate((element, value) => { window.__socialTopicInput = element; element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); element.value = value; element.setSelectionRange(2, 6); element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: value })); }, PRIVATE);
      await (await revealControl(page.locator('#discoveryRefresh'))).click(); await idle(page);
      assert.deepEqual(await input.evaluate(element => ({ same: element === __socialTopicInput, value: element.value, start: element.selectionStart, end: element.selectionEnd })), { same: true, value: PRIVATE, start: 2, end: 6 });
      await input.dispatchEvent('compositionend', { data: PRIVATE }); await page.evaluate(() => { window.__newsSocialFailTopic = true; }); const before = await state(page);
      await (await revealControl(page.locator('#discoveryTopicAdd'))).click(); await page.locator('#discoveryTopicRetry').waitFor(); await idle(page);
      assert.equal(await input.inputValue(), PRIVATE); assert.equal(await input.evaluate(element => element === __socialTopicInput), true); assert.deepEqual((await state(page)).interest, before.interest);
      await (await revealControl(page.locator('#discoveryTopicRetry'))).click(); await idle(page); await page.waitForFunction(async term => { const s = HaedoLife.Shell.storage; return (await s.readInterestProfile(await s.getActive())).manual.some(item => item.label === term); }, PRIVATE);
      assert.equal(await input.inputValue(), '');
      const topics = page.locator('#discoveryTopics'); if (await topics.evaluate(element => element.open)) await topics.locator(':scope > summary').click();
    });
    await check('three viewport feed hierarchy keeps real headlines ahead of secondary information without overflow or undersized controls', async () => {
      await click(page, '#discoveryDiscover'); await click(page, '#discoveryLatest');
      await disclose(page.locator('#discoveryLanguageOptions')); await (await revealControl(page.locator('#discoveryTranslationLanguage'))).selectOption('ko'); await idle(page);
      await page.waitForFunction(async () => { const s = HaedoLife.Shell.storage; return (await s.readDiscoveryLanguageSettings(await s.getActive())).translationTarget === 'ko'; });
      for (const selector of ['#discoveryTopics', '#discoveryLanguageOptions', '#discoveryNewsPreferences']) { const details = page.locator(selector); if (await details.evaluate(element => element.open)) await details.locator(':scope > summary').click(); }
      await newsView(page.locator('#discoveryList'));
      for (const width of [390, 820, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await page.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); });
        const article = row(page, 'first'); assert.equal(await article.locator('[data-discovery-translate]').isVisible(), true);
        assert.equal(await article.locator('[data-discovery-import]').isVisible(), false);
        assert.equal(await article.locator('.discovery-article-info').evaluate(element => element.open), false);
        const more = article.locator('.discovery-more'), trigger = more.locator(':scope > summary');
        async function assertReactionHitTests(open) {
          const results = [];
          for (const kind of ['liked', 'bookmarked']) {
            const prior = await article.locator('[data-discovery-reaction="' + kind + '"]').getAttribute('aria-pressed') === 'true';
            await reaction(page, 'first', kind, !prior); assert.equal(await more.evaluate(element => element.open), open);
            await reaction(page, 'first', kind, prior); assert.equal(await more.evaluate(element => element.open), open);
            results.push({ kind, restored: prior, actualClicks: 2 });
          }
          return results;
        }
        await trigger.focus(); const closedRect = await trigger.boundingBox(); await page.keyboard.press('Enter');
        assert.equal(await more.evaluate(element => element.open), true); const openRect = await trigger.boundingBox();
        assert(Math.abs(openRect.x - closedRect.x) <= 1 && Math.abs(openRect.y - closedRect.y) <= 1, 'Article option trigger stays in place when opened');
        assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
        const openHitTests = await assertReactionHitTests(true); await trigger.focus();
        await page.keyboard.press('Escape'); assert.equal(await more.evaluate(element => element.open), false);
        assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
        const closedHitTests = await assertReactionHitTests(false);
        let translationOffHitTests = null;
        if (width === 390) {
          await disclose(page.locator('#discoveryLanguageOptions')); await (await revealControl(page.locator('#discoveryTranslationLanguage'))).selectOption('original'); await idle(page);
          await page.waitForFunction(async () => { const s = HaedoLife.Shell.storage; return (await s.readDiscoveryLanguageSettings(await s.getActive())).translationTarget === 'original'; });
          assert.equal(await article.locator('[data-discovery-translate]').count(), 0);
          translationOffHitTests = await assertReactionHitTests(false);
          await (await revealControl(page.locator('#discoveryTranslationLanguage'))).selectOption('ko'); await idle(page);
          await page.waitForFunction(async () => { const s = HaedoLife.Shell.storage; return (await s.readDiscoveryLanguageSettings(await s.getActive())).translationTarget === 'ko'; });
          await (await revealControl(page.locator('#discoveryLanguageOptions > summary'))).click(); await newsView(article);
        }
        await page.evaluate(() => scrollTo(0, 0));
        const audit = await page.evaluate(() => {
          const article = document.querySelector('#discoveryList [data-discovery-id]'), title = article.querySelector('.discovery-title'), meta = article.querySelector('.discovery-meta');
          const rect = title.getBoundingClientRect(), navigation = document.querySelector('[data-haedo-navigation]').getBoundingClientRect();
          return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, title: { top: rect.top, bottom: rect.bottom }, navigationTop: navigation.top,
            titleFont: parseFloat(getComputedStyle(title).fontSize), metaFont: parseFloat(getComputedStyle(meta).fontSize),
            controls: [...document.querySelectorAll('#discoveryReview button,#discoveryReview summary,#discoveryReview .discovery-translation-link')].filter(element => element.checkVisibility()).map(element => { const r = element.getBoundingClientRect(); return { name: element.id || element.getAttribute('aria-label') || element.textContent.trim(), width: r.width, height: r.height }; }),
            inputs: [...document.querySelectorAll('#discoveryReview input[type="text"]')].filter(element => element.checkVisibility()).map(element => parseFloat(getComputedStyle(element).fontSize)) };
        });
        audit.moreTrigger = { closed: closedRect, open: openRect };
        audit.reactionHitTests = { open: openHitTests, closed: closedHitTests, translationOff: translationOffHitTests };
        assert(audit.documentWidth <= width, 'No horizontal overflow'); assert(audit.title.top >= 60 && audit.title.bottom < (width <= 760 ? audit.navigationTop : 1000), 'First headline remains in the fresh reading viewport');
        assert(audit.titleFont > audit.metaFont, 'Headline hierarchy above secondary metadata'); assert(audit.controls.every(item => item.width >= 44 && item.height >= 44), '44px visible controls'); assert(audit.inputs.every(size => size >= 16), '16px text inputs');
        const file = 'news-social-' + width + '.png'; await page.screenshot({ path: path.join(output, file), fullPage: false }); report.visual.push({ width, file, audit });
      }
      const after = await state(page); for (const key of ['bundle', 'workbench', 'settings', 'reading']) assert.deepEqual(after[key], original[key]);
      await nav(page, 'home'); await nav(page, 'news'); await idle(page); assert.equal(await page.locator('#discoveryLatest').getAttribute('aria-pressed'), 'true');
    });
    assert.equal(fake.writes().length, 0); for (const key of ['consoleErrors', 'pageErrors', 'externalRequests', 'privacyViolations', 'modelRequests', 'remoteWrites']) assert.deepEqual(report[key], [], key);
    report.pass = true;
  } finally {
    report.productsAfter = await hashes(); report.productsUnchangedDuringRun = JSON.stringify(report.productsBefore) === JSON.stringify(report.productsAfter);
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); await context.close(); await browser.close();
  }
  assert.equal(report.productsUnchangedDuringRun, true); assert.equal(report.pass, true); console.log('News social focused: ' + report.checks.length + ' passed.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

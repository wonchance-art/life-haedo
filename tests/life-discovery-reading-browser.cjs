/* Explicit local reading comparison with actual public metadata and isolated
 * mocked Auth/FakeCloud + real SDK/IndexedDB. No live account, original page,
 * translation service, actual reading, device or user usefulness claim. */
'use strict';
const { openReader, closeReader, originalUrl } = require('./helpers/discovery-reader.cjs');
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { FakeCloud, accounts, session, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, nav } = require('./unified-home-browser.cjs');
const repo = path.resolve(__dirname, '..');
const output = path.resolve(process.env.DISCOVERY_READING_OUTPUT || path.join(repo, '.local/discovery-reading-browser'));
const feedFile = path.resolve(process.env.DISCOVERY_READING_FEED || path.join(repo, 'assets/life/discovery-feed.json'));
const entry = base + '/index.html?section=news', feedPath = '/assets/life/discovery-feed.json';
const PRIVATE_TEXT = '\ufeff읽기비교_비공개합성원문😀\r\nCafe\u0301 원문보존', PRIVATE_TOPIC = '읽기비교익명비공개주제표식';
const PUBLIC_MARKUP = '<svg onload="window.__readingMarkupExecuted=true">';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const productFiles = ['index.html', 'assets/life/discovery-reading.js', 'assets/life/discovery-reading-ui.js', 'assets/life/discovery-ui.js', 'assets/life/discovery.css', 'assets/life/discovery.js', 'assets/life/discovery-recommendations.js', 'assets/life/discovery-actions.js', 'assets/life/discovery-settings.js', 'assets/life/discovery-language-settings.js', 'assets/life/discovery-profile.js', 'assets/life/storage.js', 'assets/life/ui.js', 'assets/life/shell.js', 'assets/platform-auth.js'];
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
const report = { createdAt: new Date().toISOString(), scope: 'Actual public feed metadata, anonymous mocked Auth/FakeCloud, actual bundled SDK and scoped IndexedDB/CAS. All reading answers, preferences and failures are synthetic test inputs; none are actual user opinions or quality scores. Publisher/Google popups are intercepted after explicit click; service workers blocked. No real account/DB, model, Apple device or usefulness evidence.', checks: [], visual: [], consoleErrors: [], pageErrors: [], externalRequests: [], privateLeaks: [], modelRequests: [], catalogRequests: [], localWrites: [], popupRequests: [] };
const hashes = async () => Object.fromEntries(await Promise.all(productFiles.map(async file => [file, sha(await fs.readFile(path.join(repo, file)))])));
async function wait(page, predicate, argument, label = 'state') {
  const end = Date.now() + 20000;
  while (Date.now() < end) { if (await page.evaluate(predicate, argument)) return; await page.waitForTimeout(40); }
  throw Error('Reading comparison did not settle: ' + label);
}
const idle = page => wait(page, () => document.querySelector('#discoveryReview')?.getAttribute('aria-busy') === 'false', null, 'news idle');
async function open(page) { await page.goto(entry); await ready(page); await idle(page); }
async function reveal(page) { await revealControl(page.locator('#discoveryReadingSummary')); const details = page.locator('#discoveryReadingComparison'); if (!await details.evaluate(element => element.open)) await (await revealControl(page.locator('#discoveryReadingSummary'))).click(); }
async function state(page) {
  return page.evaluate(async () => {
    const storage = HaedoLife.Shell.storage, workspace = await storage.getActive();
    return { workspace, bundle: await storage.read(workspace), workbench: await storage.readWorkbench(workspace), interest: await storage.readInterestProfile(workspace), feedback: await storage.readDiscoveryProfile(workspace), settings: await storage.readDiscoverySettings(workspace), language: await storage.readDiscoveryLanguageSettings(workspace), actions: await storage.readDiscoveryActions(workspace), reading: await storage.readDiscoveryReading(workspace) };
  });
}
async function preserved(page, before, except = []) {
  const after = await state(page);
  for (const key of ['workspace', 'bundle', 'workbench', 'interest', 'feedback', 'settings', 'language', 'actions']) if (!except.includes(key)) assert.deepEqual(after[key], before[key], key + ' preserved');
  return after;
}
const card = (page, url) => page.locator('article[data-reading-url]').filter({ has: page.locator('[data-reading-save=' + JSON.stringify(url) + ']') });
const reviewFor = (profile, url) => profile.session.reviews.find(row => row.canonicalUrl === url);
function frozen(profile) { const copy = structuredClone(profile.session); delete copy.reviews; delete copy.preference; delete copy.updatedAt; return copy; }
async function inspectFrozenEvidence(page, session) {
  const conditions = page.locator('#discoveryReadingConditions'), summary = conditions.locator(':scope > summary');
  await revealControl(summary); await summary.focus();
  if (!await conditions.evaluate(element => element.open)) await page.keyboard.press('Enter');
  assert.equal(await summary.evaluate(element => document.activeElement === element), true, 'Native conditions summary keeps keyboard focus');
  assert.match(await summary.innerText(), /비교 조건·근거/);
  const entries = conditions.locator('[data-reading-evidence-url]'); assert.equal(await entries.count(), session.articles.length); assert(await entries.count() <= 6);
  for (const entry of session.articles) {
    const row = conditions.locator('[data-reading-evidence-url=' + JSON.stringify(entry.snapshot.canonicalUrl) + ']');
    assert((await row.innerText()).includes(entry.snapshot.title));
    for (const [mode, list] of Object.entries(session.lists)) if (list?.includes(entry.snapshot.canonicalUrl)) {
      assert((await row.innerText()).includes({ latest: '최신순', related: '관심순', personal: '개인 추천' }[mode] + ' ' + (list.indexOf(entry.snapshot.canonicalUrl) + 1)));
    }
    assert(await row.locator('blockquote').count() <= 5);
    const manual = await row.locator('[data-reading-evidence-kind="manual"]').allTextContents();
    if (entry.reasons.length) assert(manual.length > 0);
    for (const quote of manual) assert(entry.reasons.some(ref => ref.quote === quote), 'Manual quote is exact frozen evidence');
    const pairs = await row.locator('[data-reading-evidence-kind="personal"]').evaluateAll(nodes => nodes.map(node => ({ original: node.querySelector('[data-reading-quote="original"]').textContent, candidate: node.querySelector('[data-reading-quote="candidate"]').textContent })));
    if (entry.personal?.evidence.length) { assert(pairs.length > 0); assert((await row.innerText()).includes(entry.personal.sourceSnapshot.title)); }
    for (const pair of pairs) assert(entry.personal.evidence.some(ref => ref.quote === pair.original && ref.candidateQuote === pair.candidate), 'Personal pair is exact frozen source/candidate metadata');
  }
  assert.equal(await conditions.locator('script,img,svg,iframe').count(), 0, 'Public strings never become markup');
  assert.equal(await page.evaluate(() => !!window.__readingMarkupExecuted), false);
  return conditions.innerText();
}
async function saved(page, previousRevision) { await wait(page, async revision => { const s = HaedoLife.Shell.storage; return (await s.readDiscoveryReading(await s.getActive())).revision > revision; }, previousRevision, 'explicit reading save'); }
async function seed(page) {
  await page.goto(base + '/index.html?section=tools&view=interests'); await ready(page);
  await page.locator('#interestManual').fill('언어학\n' + PRIVATE_TOPIC); await page.locator('#interestSaveManual').click();
  await wait(page, async term => { const s = HaedoLife.Shell.storage; return (await s.readInterestProfile(await s.getActive())).manual.some(row => row.label === term); }, PRIVATE_TOPIC, 'manual synthetic topics');
  await page.evaluate(async text => { const s = HaedoLife.Shell.storage, c = HaedoLife.Core, w = await s.getActive(), b = await s.read(w), prepared = await c.prepareImport({ origin: 'other', title: '읽기 비교 보존용 합성 원문', text, authorRelation: 'self', forceSeparate: true }, b); const result = await s.commitLocal({ workspaceId: w, baseRevision: b.revision, operationId: c.id(), changes: c.buildImportChanges(b, prepared, []) }); if (result.status !== 'stored') throw Error('Preservation fixture could not commit'); }, PRIVATE_TEXT);
  // Re-enter through the actual UI so its bundle revision matches this fixture.
  await open(page); return state(page);
}
async function start(page) {
  await reveal(page); const before = await state(page); assert.equal(before.reading.session, null);
  await (await revealControl(page.locator('#discoveryReadingStart'))).click(); await saved(page, before.reading.revision);
  await page.locator('article[data-reading-url]').first().waitFor();
  const after = await state(page); assert(after.reading.session); return after;
}
async function answer(page, url, values) {
  const article = card(page, url);
  for (const [field, value] of Object.entries(values)) await article.locator('[data-reading-field="' + field + '"]').selectOption(value);
}
async function saveAnswer(page, url) { const before = (await state(page)).reading.revision; await card(page, url).locator('[data-reading-save]').click(); await saved(page, before); }
async function gate(context) {
  await context.route(base + '/assets/life/storage.js', async route => {
    const response = await route.fetch();
    const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,async saveDiscoveryReading(...values){if(window.__readingHold){window.__readingEntered=true;await new Promise(resolve=>window.__readingRelease=()=>{window.__readingHold=false;resolve();});}if(window.__readingFail){window.__readingFail=false;throw Object.assign(new Error('Synthetic local reading save failure'),{code:'reading_test_failure'});}return actual.saveDiscoveryReading(...values);}});}});})();`;
    await route.fulfill({ response, body: await response.text() + hook });
  });
}
async function popup(page, context, url, selector, kind, holder = card(page, url)) {
  const link = holder.locator(selector), destination = await link.getAttribute('href'); assert(destination);
  assert.equal(await link.getAttribute('target'), '_blank'); assert.match(await link.getAttribute('rel'), /noreferrer/);
  if (kind === 'translation') { const translated = new URL(destination); assert.equal(translated.origin, 'https://translate.google.com'); assert.equal(translated.searchParams.get('u'), url); }
  let count = 0;
  const intercept = route => { const r = route.request(); count++; assert.equal(r.method(), 'GET'); assert.equal(r.postData(), null); assert.equal(r.headers().referer, undefined); report.popupRequests.push({ kind, method: r.method(), noReferrer: true, syntheticResponse: true }); return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>명시 클릭 합성 응답</title><p>No real source or translation service was fetched.</p>' }); };
  await context.route(destination, intercept);
  try { await link.focus(); const opening = page.waitForEvent('popup'); await link.click(); const opened = await opening; await opened.waitForLoadState('domcontentloaded'); assert.deepEqual(await opened.evaluate(() => ({ referrer: document.referrer, opener: window.opener === null })), { referrer: '', opener: true }); await opened.close(); await page.bringToFront(); assert.equal(count, 1); assert.equal(await link.evaluate(element => document.activeElement === element), true); }
  finally { await context.unroute(destination, intercept); }
}
async function capture(page, scene, selector) {
  const original = page.viewportSize(), position = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  try { for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await page.evaluate(() => document.fonts.ready);
    if (selector) await page.locator(selector).first().scrollIntoViewIfNeeded(); else await page.evaluate(() => scrollTo(0, 0));
    const audit = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollY, documentWidth: document.documentElement.scrollWidth, comparisonOpen: document.querySelector('#discoveryReadingComparison')?.open, firstTitle: (() => { const rect = document.querySelector('#discoveryList .discovery-title [data-discovery-read]')?.getBoundingClientRect(); return rect && { top: rect.top, bottom: rect.bottom }; })(), navTop: document.querySelector('[data-haedo-navigation]')?.getBoundingClientRect().top, controls: [...document.querySelectorAll('#discoveryReadingComparison button,#discoveryReadingComparison select,#discoveryReadingComparison summary')].filter(element => element.checkVisibility()).map(element => { const r = element.getBoundingClientRect(); return { id: element.id || element.dataset.readingField || element.textContent, width: r.width, height: r.height }; }) }));
    assert(audit.documentWidth <= width, 'No horizontal overflow');
    if (scene === 'first-fold') { assert.equal(audit.comparisonOpen, false); assert.equal(audit.scrollY, 0); assert(audit.firstTitle && audit.firstTitle.top >= 60 && audit.firstTitle.bottom < (width === 390 ? audit.navTop : 1000), 'First article remains in the fresh viewport'); }
    assert(audit.controls.every(row => row.width >= 44 && row.height >= 44), 'Reading controls minimum 44px');
    const filename = 'reading-' + scene + '-' + width + '.png'; await page.screenshot({ path: path.join(output, filename), fullPage: false }); report.visual.push({ scene, width, file: filename, audit });
  } } finally { await page.setViewportSize(original); await page.evaluate(pos => scrollTo({ left: pos.x, top: pos.y, behavior: 'instant' }), position); }
}

async function main() {
  await fs.mkdir(output, { recursive: true }); report.runnerSHA256 = sha(await fs.readFile(__filename)); report.productsBefore = await hashes();
  const bytes = await fs.readFile(feedFile), actualFeed = JSON.parse(bytes); report.feed = { sha256: sha(bytes), generatedAt: actualFeed.generatedAt, articles: actualFeed.articles.length, sources: actualFeed.sources.length, fixture: 'actual public metadata, source file never rewritten' };
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] }); report.browser = browser.version(); report.node = process.version;
  async function check(name, action) {
    if (process.env.DISCOVERY_READING_MATCH && !new RegExp(process.env.DISCOVERY_READING_MATCH).test(name)) return;
    report.stage = name; const fake = new FakeCloud(), context = await makeContext(browser, fake, 'reading-' + report.checks.length, accounts.a, { viewport: { width: 1440, height: 1000 } });
    const control = { body: bytes, count: 0 };
    await context.route(base + feedPath, route => { control.count++; return route.fulfill({ contentType: 'application/json', body: control.body }); });
    await gate(context);
    context.on('request', request => {
      const u = new URL(request.url()), body = request.postData() || '', h = request.headers();
      if ([PRIVATE_TEXT, PRIVATE_TOPIC].some(text => u.href.includes(text) || u.href.includes(encodeURIComponent(text)) || body.includes(text) || body.includes(JSON.stringify(text).slice(1, -1)))) report.privateLeaks.push({ stage: name, origin: u.origin, path: u.pathname });
      if (/huggingface|xethub|transformers|onnxruntime|\.onnx(?:$|\?)|\.wasm(?:$|\?)/i.test(u.href)) report.modelRequests.push({ stage: name, origin: u.origin, path: u.pathname });
      if (u.origin === new URL(base).origin && request.method() !== 'GET') report.localWrites.push({ stage: name, path: u.pathname, method: request.method() });
      if (u.origin === new URL(base).origin && u.pathname === feedPath) report.catalogRequests.push({ stage: name, method: request.method(), query: !!u.search, body: !!body, authorization: !!h.authorization, referrer: h.referer || null });
    });
    await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback(); report.externalRequests.push({ stage: name, origin: u.origin, path: u.pathname }); return route.abort('blockedbyclient'); });
    context.on('page', page => { page.setDefaultTimeout(20000); page.on('pageerror', error => report.pageErrors.push({ stage: name, message: error.message })); page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ stage: name, message: message.text() }); }); });
    const page = await context.newPage();
    try { await action({ page, context, fake, control }); assert.equal(fake.writes().length, 0); assert.equal(fake.saves().length, 0); assert.equal(fake.blogCalls.filter(call => /publish|unpublish/.test(call.rpc)).length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); try { await fs.writeFile(path.join(output, 'failure-' + report.checks.length + '.html'), await page.content()); await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: false }); } catch (captureError) { report.captureError = captureError.message; } throw error; }
    finally { for (const p of context.pages()) if (!p.isClosed()) await p.evaluate(() => window.__readingRelease?.()).catch(() => {}); await context.close(); }
  }
  try {
    // Contract-specific scenarios below use the same context/SDK/IDB and no real private service.
    await check('news first fold stays clear and explicit comparison preserves exact snapshots, answers and preference across refresh', async ({ page, context, control }) => {
      await open(page); const fresh = await state(page);
      assert.equal(await page.locator('#discoveryReadingComparison').evaluate(element => element.open), false);
      assert.equal(fresh.reading.session, null); assert.equal(fresh.reading.revision, 0);
      await capture(page, 'first-fold');
      await reveal(page); assert.deepEqual((await state(page)).reading, fresh.reading, 'Opening disclosure never starts or saves a comparison');
      await seed(page);
      const language = page.locator('#discoveryLanguageOptions'); await newsView(language); if (!await language.evaluate(element => element.open)) await language.locator(':scope > summary').click();
      await (await revealControl(page.locator('#discoveryTranslationLanguage'))).selectOption('ko'); await idle(page);
      const before = await state(page), started = await start(page), initial = structuredClone(started.reading);
      await preserved(page, before); assert.equal(initial.session.preference, null); assert.equal(initial.session.lists.personal, null);
      assert.match(initial.session.rankInputSHA256, /^[a-f0-9]{64}$/);
      assert(initial.session.lists.latest.length > 0 && initial.session.lists.latest.length <= 2);
      assert(initial.session.lists.related.length > 0 && initial.session.lists.related.length <= 2);
      const urls = initial.session.articles.map(row => row.snapshot.canonicalUrl);
      assert.equal(new Set(urls).size, urls.length); assert.equal(await page.locator('article[data-reading-url]').count(), urls.length);
      assert(initial.session.reviews.every(row => ['intent', 'reading', 'helpful', 'reason'].every(key => row[key] === null)));
      const initialEvidence = await inspectFrozenEvidence(page, initial.session);
      assert.deepEqual((await state(page)).reading, initial, 'Viewing frozen evidence does not write judgments');
      const personalChoice = page.locator('#discoveryReadingPreference option[value="personal"]');
      assert(await personalChoice.count() === 0 || await personalChoice.evaluate(option => option.disabled && option.matches(':disabled')), 'Unavailable personal arm cannot be chosen');
      const url = urls[0], first = card(page, url);
      await popup(page, context, url, '[data-reading-open]', 'original');
      await popup(page, context, url, '[data-reading-translate]', 'translation');
      assert.deepEqual((await state(page)).reading, initial, 'Opening a URL never marks an article read or helpful');
      assert.equal(await first.locator('[data-reading-field="helpful"]').isDisabled(), true);
      assert.equal(await first.locator('[data-reading-field="reason"]').isDisabled(), true);
      await answer(page, url, { intent: 'yes', reading: 'not_read' });
      const draftControl = first.locator('[data-reading-field="intent"]'); await draftControl.evaluate(element => { window.__frozenEvidenceDraftControl = element; });
      await inspectFrozenEvidence(page, initial.session);
      assert.equal(await draftControl.evaluate(element => element === __frozenEvidenceDraftControl), true); assert.equal(await draftControl.inputValue(), 'yes');
      assert.equal(await first.locator('[data-reading-field="helpful"]').isDisabled(), true);
      assert.equal(await first.locator('[data-reading-field="helpful"]').inputValue(), '');
      assert.deepEqual((await state(page)).reading, initial, 'Edits remain drafts until explicit save');
      await saveAnswer(page, url); let stored = (await state(page)).reading;
      assert.deepEqual(reviewFor(stored, url), { canonicalUrl: url, intent: 'yes', reading: 'not_read', helpful: null, reason: null });
      await answer(page, url, { reading: 'partial', helpful: 'yes', reason: 'other' }); await saveAnswer(page, url);
      const preferenceRevision = (await state(page)).reading.revision;
      await (await revealControl(page.locator('#discoveryReadingPreference'))).selectOption('tie'); await (await revealControl(page.locator('#discoveryReadingPreferenceSave'))).click(); await saved(page, preferenceRevision);
      stored = (await state(page)).reading; assert.equal(stored.session.preference, 'tie'); assert.deepEqual(frozen(stored), frozen(initial));
      await capture(page, 'answered', 'article[data-reading-url]');
      await page.reload(); await ready(page); await idle(page); await reveal(page);
      assert.deepEqual((await state(page)).reading, stored); assert.equal(await card(page, url).locator('[data-reading-field="helpful"]').inputValue(), 'yes');
      assert.equal(await inspectFrozenEvidence(page, stored.session), initialEvidence, 'Reload retains the original explanation');
      // Deliberate synthetic current-feed change; frozen comparison retains the actual starting metadata.
      const changed = structuredClone(actualFeed); changed.generatedAt = new Date().toISOString(); changed.articles[0].title = '합성 현재 피드 갱신: ' + changed.articles[0].title; control.body = Buffer.from(JSON.stringify(changed));
      await (await revealControl(page.locator('#discoveryRefresh'))).click(); await idle(page);
      assert.deepEqual((await state(page)).reading, stored);
      assert.equal(await inspectFrozenEvidence(page, stored.session), initialEvidence, 'Changed current feed never rewrites frozen quotes');
      const languageOptions = page.locator('#discoveryLanguageOptions'); await newsView(languageOptions); if (!await languageOptions.evaluate(element => element.open)) await languageOptions.locator(':scope > summary').click();
      await page.locator('[data-discovery-content-language="en"]').check(); await idle(page);
      const topics = page.locator('#discoveryTopics'); await newsView(topics); if (!await topics.evaluate(element => element.open)) await (await revealControl(page.locator('#discoveryTopicsSummary'))).click();
      const settings = page.locator('#discoveryOptions'); await newsView(settings); if (!await settings.evaluate(element => element.open)) await settings.locator(':scope > summary').click();
      await page.locator('[data-discovery-source=' + JSON.stringify(initial.session.articles[0].snapshot.sourceId) + ']').uncheck(); await idle(page);
      if (!await languageOptions.evaluate(element => element.open)) await languageOptions.locator(':scope > summary').click();
      await (await revealControl(page.locator('#discoveryTranslationLanguage'))).selectOption('original'); await idle(page);
      const previousTranslation = card(page, url).locator('[data-reading-translate]'); assert(!await previousTranslation.isVisible(), 'Current explicit translation off withdraws the old comparison translation action');
      assert.equal(await card(page, url).locator('[data-reading-open]').isVisible(), true, 'Frozen original URL remains available independently of current source filtering');
      const afterChange = await preserved(page, before, ['settings', 'language']); assert.deepEqual(afterChange.reading, stored, 'Changed live feed/settings never rewrite the saved comparison or answers');
      // The actual LLT rows have no publication date; keep unknown dates honest through opening and review.
      if (actualFeed.sources.some(source => source.id === 'llt-journal')) {
        for (const source of actualFeed.sources) {
          const options = page.locator('#discoveryOptions'); await newsView(options); if (!await options.evaluate(element => element.open)) await options.locator(':scope > summary').click();
          const toggle = page.locator('[data-discovery-source=' + JSON.stringify(source.id) + ']');
          if (await toggle.isChecked() !== (source.id === 'llt-journal')) { await toggle.setChecked(source.id === 'llt-journal'); await idle(page); }
        }
        if (!await languageOptions.evaluate(element => element.open)) await languageOptions.locator(':scope > summary').click();
        await (await revealControl(page.locator('#discoveryTranslationLanguage'))).selectOption('ko'); await idle(page);
        await selectNewsMode(page, 'latest'); await idle(page);
        const llt = page.locator('#discoveryList [data-discovery-id]').first(), id = await llt.getAttribute('data-discovery-id');
        const sourceRow = actualFeed.articles.find(row => row.id === id); assert.equal(sourceRow.sourceId, 'llt-journal'); assert.equal(sourceRow.publishedAt, null); assert.equal(sourceRow.author, null); assert.deepEqual(sourceRow.tags, []); assert.equal(sourceRow.summary, ''); assert.equal(sourceRow.coverage, 'link_only');
        await (await revealControl(llt.locator('.discovery-article-info > summary'))).click();
        assert((await llt.innerText()).includes(sourceRow.title)); assert((await llt.innerText()).includes('발행일 미확인')); assert.equal(await llt.locator('time').count(), 0);
        await openReader(page, llt); const original = await page.locator('[data-discovery-original]').getAttribute('href');
        await popup(page, context, original, '[data-discovery-original]', 'original', page.locator('#discoveryReader'));
        await closeReader(page);
        await popup(page, context, original, '[data-discovery-translate]', 'translation', llt);
        const priorReview = await state(page); await (await revealControl(llt.locator('[data-discovery-import]'))).click(); await page.locator('#lifeImportTitle').waitFor();
        assert.equal(await page.locator('#lifeImportTitle').inputValue(), sourceRow.title); assert.equal(await page.locator('#lifeImportText').inputValue(), ''); assert.equal(await page.locator('#lifeImportDate').inputValue(), ''); assert.equal(await page.locator('#lifeImportAuthor').inputValue(), '');
        await page.getByRole('button', { name: '원문·출처 확인', exact: true }).click(); await page.locator('.life-review').waitFor();
        assert.deepEqual((await state(page)).bundle, priorReview.bundle, 'Review does not automatically import the LLT article');
        page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '이 검토 취소', exact: true }).click(); await idle(page);
        assert.deepEqual((await state(page)).reading, stored); assert.deepEqual((await state(page)).bundle, priorReview.bundle);
        report.actualLLT = { articleId: id, title: sourceRow.title, dateUnknown: true, noInventedTimeElement: true, originalAndTranslationMocked: true, explicitReviewWithoutBodyOrDate: true, reviewCancelledWithoutImport: true, noActualReadingClaim: true };
      }
      report.snapshot = { sessionId: stored.session.id, rankInputSHA256: stored.session.rankInputSHA256, uniqueArticles: urls.length, readingAndPreferenceExplicitlySaved: true, currentFeedAndSettingsChangedSynthetically: true, frozenAfterChange: true, actualUserJudgments: false };
    });
    await check('two real tabs preserve independent reviews and reapply a draft only to the same comparison after CAS', async ({ page, context, control }) => {
      const timestamp = new Date(Date.now() - 86400000).toISOString(), source = { ...actualFeed.sources.find(value => value.id === 'naver-d2'), status: 'ok', stale: false, error: null, lastSuccessAt: timestamp, lastAttemptAt: timestamp };
      const feed = { schemaVersion: 1, generatedAt: timestamp, sources: [source], articles: ['first', 'second'].map((id, index) => ({ id: 'reading-evidence-' + id, sourceId: source.id, url: 'https://d2.naver.com/reading-evidence/' + id,
        title: 'Linguistics Language learning ' + (index ? 'second' : '<b>public</b>'), tags: [PUBLIC_MARKUP], language: 'en', author: null, publishedAt: timestamp, fetchedAt: timestamp, summary: '', coverage: 'link_only', rights: source.rights })) };
      control.body = Buffer.from(JSON.stringify(feed)); await seed(page);
      await (await revealControl(page.locator('#discoveryTopicInput'))).fill('Language'); await (await revealControl(page.locator('#discoveryTopicAdd'))).click(); await idle(page);
      await page.evaluate(async ({ feed, timestamp }) => {
        const storage = HaedoLife.Shell.storage, workspaceId = await storage.getActive(), A = HaedoLife.DiscoveryActions, current = await storage.readDiscoveryActions(workspaceId);
        const snapshot = A.capture({ ...feed.articles[0], id: 'reading-evidence-prototype', url: 'https://d2.naver.com/reading-evidence/prototype', title: 'Language learning' }, feed.sources[0]);
        const next = A.setReaction(current, snapshot, 'liked', true, { expectedRevision: current.revision, now: timestamp });
        if ((await storage.saveDiscoveryActions(workspaceId, next, current.revision)).status !== 'stored') throw Error('Synthetic metadata-like setup failed');
      }, { feed, timestamp });
      await page.reload(); await ready(page); await idle(page);
      await (await revealControl(page.locator('#discoveryPersonalize'))).check(); await idle(page);
      const before = await state(page), first = await start(page), urls = first.reading.session.articles.map(row => row.snapshot.canonicalUrl); assert(urls.length >= 2);
      assert.equal(first.reading.session.personal.applied, true);
      const evidence = await inspectFrozenEvidence(page, first.reading.session);
      assert(evidence.includes(PUBLIC_MARKUP)); assert.match(evidence, /직접 일치/); assert.match(evidence, /연결 표현/); assert(evidence.includes(first.reading.session.personal.policy));
      await capture(page, 'frozen-evidence', '#discoveryReadingConditions');
      report.frozenEvidence = { syntheticPublicMetadataAndLike: true, explicitOptIn: true, exactManualAndPersonalQuotes: true, markupRemainsText: true, articles: first.reading.session.articles.length };
      const peer = await context.newPage(); await open(peer); await reveal(peer);
      await answer(page, urls[0], { intent: 'yes', reading: 'partial', helpful: 'no', reason: 'too_technical' });
      await page.evaluate(() => { window.__readingHold = true; }); await card(page, urls[0]).locator('[data-reading-save]').click(); await wait(page, () => window.__readingEntered);
      await answer(peer, urls[1], { intent: 'no', reading: 'not_read' }); await saveAnswer(peer, urls[1]);
      const competing = (await state(peer)).reading; await page.evaluate(() => __readingRelease());
      await page.locator('#discoveryReadingReload').waitFor(); assert.equal(await card(page, urls[0]).locator('[data-reading-field="helpful"]').inputValue(), 'no');
      await (await revealControl(page.locator('#discoveryReadingReload'))).click();
      assert.equal(await card(page, urls[0]).locator('[data-reading-field="reason"]').inputValue(), 'too_technical');
      const retryRevision = (await state(page)).reading.revision; await (await revealControl(page.locator('#discoveryReadingRetry'))).click(); await saved(page, retryRevision);
      const merged = (await preserved(page, before)).reading; assert.equal(merged.session.id, first.reading.session.id); assert.deepEqual(frozen(merged), frozen(first.reading));
      assert.deepEqual(reviewFor(merged, urls[1]), reviewFor(competing, urls[1])); assert.equal(reviewFor(merged, urls[0]).helpful, 'no');
      report.sameSessionCAS = { realIndexedDB: true, sessionId: merged.session.id, peerReviewPreserved: true, explicitReloadAndRetry: true }; await peer.close();
    });
    await check('failed reading save retains exact inputs and blocks navigation until explicit recovery', async ({ page }) => {
      const before = await seed(page), first = await start(page), url = first.reading.session.articles[0].snapshot.canonicalUrl;
      await answer(page, url, { intent: 'yes', reading: 'full', helpful: 'no', reason: 'off_topic' });
      await page.evaluate(() => { window.__readingFail = true; }); await card(page, url).locator('[data-reading-save]').click();
      await page.locator('#discoveryReadingError').waitFor({ state: 'visible' });
      assert.deepEqual((await state(page)).reading, first.reading); assert.equal(await card(page, url).locator('[data-reading-field="reason"]').inputValue(), 'off_topic');
      const location = page.url(); await page.locator('[data-haedo-navigation] [data-haedo-section="home"]').first().click(); await page.locator('#lifeError').waitFor({ state: 'visible' });
      assert.equal(page.url(), location); assert.equal(await card(page, url).locator('[data-reading-field="helpful"]').inputValue(), 'no');
      const revision = (await state(page)).reading.revision; await (await revealControl(page.locator('#discoveryReadingRetry'))).click(); await saved(page, revision);
      const after = await preserved(page, before); assert.equal(reviewFor(after.reading, url).reason, 'off_topic');
      report.saveFailure = { injectedBeforeRealTransaction: true, persistedProfileUnchangedOnFailure: true, exactDraftRetained: true, navigationProtected: true, explicitRetryStored: true };
    });
    await check('a tombstone from another tab defeats a delayed save and prevents old-session resurrection', async ({ page, context }) => {
      const before = await seed(page), first = await start(page), url = first.reading.session.articles[0].snapshot.canonicalUrl;
      const peer = await context.newPage(); await open(peer); await reveal(peer);
      await answer(page, url, { intent: 'yes', reading: 'partial', helpful: 'yes', reason: 'other' });
      await page.evaluate(() => { window.__readingHold = true; }); await card(page, url).locator('[data-reading-save]').click(); await wait(page, () => window.__readingEntered);
      await peer.locator('#discoveryReadingClear').click(); await peer.locator('#discoveryReadingClearConfirm').click();
      await wait(peer, async () => { const s = HaedoLife.Shell.storage; return (await s.readDiscoveryReading(await s.getActive())).deleted; });
      const deleted = (await state(peer)).reading; assert.equal(deleted.session, null); assert(deleted.revision > first.reading.revision);
      await page.evaluate(() => __readingRelease()); await page.locator('#discoveryReadingReload').waitFor();
      assert.equal(await card(page, url).locator('[data-reading-field="helpful"]').inputValue(), 'yes');
      await (await revealControl(page.locator('#discoveryReadingReload'))).click(); assert.deepEqual((await state(page)).reading, deleted);
      const retry = page.locator('#discoveryReadingRetry'); assert(!await retry.isVisible() || await retry.isDisabled(), 'Deleted session cannot be retried into existence');
      await (await revealControl(page.locator('#discoveryReadingDiscard'))).click(); assert.deepEqual((await preserved(page, before)).reading, deleted);
      await page.reload(); await ready(page); await idle(page); await reveal(page); assert.equal(await page.locator('article[data-reading-url]').count(), 0); assert.deepEqual((await state(page)).reading, deleted); assert.equal(await page.locator('#discoveryReadingStart').isEnabled(), true, 'A new comparison requires a new explicit start');
      report.tombstone = { oldSessionId: first.reading.session.id, revision: deleted.revision, lateSaveConflict: true, noResurrection: true }; await peer.close();
    });
    await check('workspace and account boundaries do not reuse a comparison or install a delayed old-account save', async ({ page }) => {
      const before = await seed(page), first = await start(page), oldWorkspace = first.workspace;
      const other = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, old = await s.getActive(), next = await s.createWorkspace('읽기 비교 합성 두 번째 공간'); await s.setActive(old); return next.workspaceId; });
      await page.reload(); await ready(page); await idle(page);
      async function selectWorkspace(id) { await nav(page, 'manage'); await page.locator('#lifeCurrentWorkspace').click(); await page.locator('#lifeWorkspace').selectOption(id); await wait(page, async target => (await HaedoLife.Shell.storage.getActive()) === target, id); await page.locator('[data-haedo-navigation] [data-haedo-section="news"]').click(); await idle(page); }
      await selectWorkspace(other); assert.equal((await state(page)).reading.session, null);
      const own = await start(page); assert.notEqual(own.reading.session.id, first.reading.session.id);
      await selectWorkspace(oldWorkspace); assert.deepEqual((await state(page)).reading, first.reading); await preserved(page, before);
      await reveal(page); const url = first.reading.session.articles[0].snapshot.canonicalUrl; await answer(page, url, { intent: 'yes' });
      await page.evaluate(() => { window.__oldReadingStorage = HaedoLife.Shell.storage; window.__readingHold = true; }); await card(page, url).locator('[data-reading-save]').click(); await wait(page, () => window.__readingEntered);
      await page.evaluate(value => HaedoAuth.client.auth.setSession(value), session(accounts.b));
      await wait(page, () => !HaedoAuth.user && !HaedoLife.Shell.storage, null, 'old account scope invalidated');
      assert.equal(await page.locator('#lifeApp').isHidden(), true); await page.evaluate(() => __readingRelease());
      await page.evaluate(() => HaedoLife.Shell.start()); await wait(page, id => HaedoAuth.user?.id === id && HaedoLife.Shell.storage?.account?.userId === id, accounts.b.id, 'new account storage owner'); await ready(page);
      await page.locator('[data-haedo-navigation] [data-haedo-section="news"]').click(); await idle(page); const accountB = await state(page); assert.equal(accountB.reading.session, null); assert.equal(accountB.reading.revision, 0); assert.equal(accountB.bundle.sources.some(row => row.title === '읽기 비교 보존용 합성 원문'), false);
      assert.equal(await page.evaluate(async id => { try { await __oldReadingStorage.readDiscoveryReading(id); return null; } catch (error) { return error.code; } }, oldWorkspace), 'storage_scope_closed');
      assert.equal(await page.evaluate(async id => { try { await HaedoLife.Shell.storage.readDiscoveryReading(id); return false; } catch (_) { return true; } }, oldWorkspace), true);
      report.scopeIsolation = { workspaceA: oldWorkspace, workspaceB: other, accountSwitchSimulated: true, oldStorageClosed: true, pendingOldAccountSaveCannotInstall: true, freshNewAccountProfile: true };
    });
    for (const key of ['consoleErrors', 'pageErrors', 'externalRequests', 'privateLeaks', 'modelRequests', 'localWrites']) assert.deepEqual(report[key], [], key);
    assert(report.catalogRequests.length > 0); assert(report.catalogRequests.every(row => row.method === 'GET' && !row.query && !row.body && !row.authorization && !row.referrer));
    report.pass = true;
  } finally {
    await browser.close(); report.browserClosed = true;
    report.productsAfter = await hashes(); report.productsUnchangedDuringRun = JSON.stringify(report.productsBefore) === JSON.stringify(report.productsAfter);
    if (!report.productsUnchangedDuringRun) { report.pass = false; process.exitCode = 1; }
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
main().catch(async error => { report.pass = false; report.error = { message: error.message, stack: error.stack }; console.error(report.stage + '\n' + error.stack); await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); process.exitCode = 1; });

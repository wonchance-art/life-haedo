/* Real local UI/Core/SDK/IndexedDB with anonymous intercepted Auth.
 * The checked-in public catalogue smoke and synthetic edge cases are separate.
 * Publisher popups are intercepted: no live account, publisher fetch, model,
 * Apple hardware or user usefulness claims.
 * BASE_URL=http://127.0.0.1:4173 node tests/life-external-discovery-browser.cjs */
'use strict';
const { openReader, closeReader, originalUrl, assertImportedText } = require('./helpers/discovery-reader.cjs');
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Discovery = require('../assets/life/discovery.js');
const { FakeCloud, accounts, cloud, base, openAccount } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, nav } = require('./unified-home-browser.cjs');
const out = path.resolve(process.env.EXTERNAL_DISCOVERY_OUTPUT || path.join(__dirname, '../.local/external-discovery-browser'));
const feedPath = '/assets/life/discovery-feed.json';
const entry = base + '/index.html?section=tools&view=external-discovery';
const privateText = '익명검사용비공개본문_외부전송금지';
const privateInterest = '독서';
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
const report = { createdAt: new Date().toISOString(), scope: 'Real local app/Core/SDK/IndexedDB and checked-in public catalogue; synthetic edge HTTP and publisher popup interception identified per check. No live OAuth/account/publisher, model inference, Apple hardware or user usefulness validation.', checks: [], publicSourceJourneys: [], visual: [], consoleErrors: [], pageErrors: [], expectedErrors: [], external: [], modelRequests: [], privacyViolations: [], catalogueRequests: [], popupRequests: [], realRemoteWrites: 0 };
const escapeId = id => String(id).replace(/"/g, '\\"');
const card = (page, id) => page.locator('[data-discovery-id="' + escapeId(id) + '"]');
async function idle(page) { await page.waitForFunction(() => document.querySelector('#discoveryReview')?.getAttribute('aria-busy') !== 'true'); }
// These existing recommendation checks select related order explicitly; the
// news entry's default latest order is covered by its dedicated entry journey.
async function related(page) { await selectNewsMode(page, 'related'); await idle(page); assert.equal(await page.locator('#discoverySort').inputValue(), 'related'); }
async function topics(page) { const details = page.locator('#discoveryTopics'); await newsView(details); if (!await details.evaluate(el => el.open)) await details.locator(':scope > summary').click(); }
async function open(page, file = 'index.html') { await page.goto(base + '/' + file + '?section=tools&view=external-discovery'); await ready(page); await page.locator('#discoveryReview').waitFor(); await idle(page); await related(page); }
async function state(page) { return page.evaluate(async () => { const s = HaedoLife.Shell.storage, id = await s.getActive(); return { bundle: await s.read(id), workbench: await s.readWorkbench(id), interest: await s.readInterestProfile(id), feedback: await s.readDiscoveryProfile(id) }; }); }
async function interests(page, text = privateInterest) {
  await page.goto(base + '/index.html?section=tools&view=interests'); await ready(page); await page.locator('#interestManual').waitFor();
  await page.locator('#interestManual').fill(text); await page.locator('#interestSaveManual').click(); await page.waitForFunction(() => document.querySelector('#interestReview')?.getAttribute('aria-busy') !== 'true');
}
async function seed(page, manualText = privateInterest) {
  await interests(page, manualText);
  return page.evaluate(async text => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core, b = await s.read(await s.getActive());
    const p = await c.prepareImport({ origin: 'other', title: '익명 원문 보존 검사용', text, authorRelation: 'unknown' }, b);
    const saved = await s.commitLocal({ workspaceId: b.workspaceId, baseRevision: b.revision, operationId: c.id(), changes: c.buildImportChanges(b, p, []) });
    if (saved.status !== 'stored') throw new Error('Anonymous fixture commit failed');
    return { workspaceId: b.workspaceId, sourceId: p.source.id, versionId: p.version.id };
  }, privateText);
}
function fixture({ empty = false, stale = false } = {}) {
  const now = new Date().toISOString(), rights = { label: '합성 검사 메타데이터', url: 'https://d2.naver.com/synthetic-qa-terms', mode: 'metadata_only' };
  const source = { id: 'naver-d2', name: '합성 공개 출처', url: 'https://d2.naver.com', feedUrl: 'https://d2.naver.com/synthetic-qa-feed.xml', language: 'ko', rights, status: stale ? 'error' : 'ok', lastSuccessAt: now, lastAttemptAt: now, error: stale ? '합성 공급 갱신 실패' : null, stale };
  const article = (id, title, days, patch = {}) => ({ id, sourceId: source.id, url: 'https://d2.naver.com/synthetic-qa-read/' + id, title, publishedAt: new Date(Date.now() - days * 86400000).toISOString(), dateStatus: 'valid', author: null, language: 'ko', tags: [], summary: '', coverage: 'link_only', rights: { ...rights }, fetchedAt: now, ...patch });
  return { schemaVersion: 1, generatedAt: now, sources: [source], articles: empty ? [] : [
    article('related-link', '독서 기록에서 문장을 고르는 방법', 3),
    article('related-summary', '독서와 글쓰기의 표현을 비교한 글', 2, { summary: '공급자가 제공한 짧은 소개입니다. 전체 본문은 확보하지 않았습니다.', coverage: 'summary', rights: { ...rights, label: '합성 요약 재이용 허용', mode: 'summary_allowed' } }),
    article('related-full', '독서 경험을 글로 남기는 연습', 1, { coverage: 'full_text', summary: '', bodyText: '합성으로 제공한 본문 전체입니다.\r\n책을 읽고 문장을 쓰며 서로 다른 표현을 비교합니다. 😀', rights: { ...rights, label: '합성 본문 재이용 허용', mode: 'full_text_allowed' } }),
    article('latest-other', '관측 장비의 전류 측정과 과학 실험', 0),
    article('older-other', '강변 보행로와 도시 공간 관찰', 4)
  ] };
}
async function feedRoute(context, initial = fixture()) {
  const control = { value: initial, fail: false, hold: false, entered: 0, releases: [], arrivals: [] };
  await context.route(base + feedPath, async route => {
    control.entered++; control.arrivals.splice(0).forEach(resolve => resolve());
    if (control.hold) await new Promise(resolve => control.releases.push(resolve));
    if (control.fail) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic temporary acquisition failure"}' });
    return route.fulfill({ contentType: 'application/json', headers: { 'X-Haedo-Discovery-Cache': 'network', 'X-Haedo-Discovery-Fetched-At': new Date().toISOString() }, body: JSON.stringify(control.value) });
  });
  control.release = () => { control.hold = false; control.releases.splice(0).forEach(resolve => resolve()); };
  control.nextRequest = () => new Promise(resolve => control.arrivals.push(resolve));
  return control;
}
async function abortFeedback(page, enabled) {
  await page.evaluate(enabled => {
    window.__discoveryOriginalPut ||= IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = enabled ? function (...args) { const request = __discoveryOriginalPut.apply(this, args); if (this.name === 'meta' && args[0]?.key?.startsWith('discoveryProfile:')) this.transaction.abort(); return request; } : __discoveryOriginalPut;
  }, enabled);
}
async function controllableFeedbackSave(context) {
  await context.route(base + '/assets/life/storage.js', async route => {
    const response = await route.fetch(), source = await response.text();
    const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,async commitLocal(...values){window.__discoveryCommitCalls=(window.__discoveryCommitCalls||0)+1;const result=await actual.commitLocal(...values);if(window.__discoveryFailPostCommitRead&&result.status==='stored'){window.__discoveryFailPostCommitRead=false;window.__discoveryFailNextRead=true;}return result;},async read(...values){if(window.__discoveryFailNextRead){window.__discoveryFailNextRead=false;throw new Error('Synthetic read failure after committed source');}return actual.read(...values);},async saveDiscoveryProfile(...values){if(window.__discoveryHoldSave){window.__discoverySaveEntered=true;await new Promise(resolve=>{window.__discoveryReleaseSave=()=>{window.__discoveryHoldSave=false;resolve();};});}return actual.saveDiscoveryProfile(...values);}});}});})();`;
    await route.fulfill({ response, body: source + hook });
  });
}
async function returnToDiscovery(page) {
  await nav(page, 'news'); await page.locator('#discoveryReview').waitFor(); await idle(page);
  await related(page);
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const publicFeedPath = path.resolve(__dirname, '../assets/life/discovery-feed.json'), corePath = path.resolve(__dirname, '../assets/life/discovery.js');
  const sha = value => createHash('sha256').update(value).digest('hex');
  const feedBytes = await fs.readFile(publicFeedPath), coreBytes = await fs.readFile(corePath), publicFeed = JSON.parse(feedBytes);
  report.catalogue = { sha256: sha(feedBytes), coreSHA256: sha(coreBytes), generatedAt: publicFeed.generatedAt, articles: publicFeed.articles.length };
  if (process.env.EXTERNAL_DISCOVERY_FEED_SHA) assert.equal(report.catalogue.sha256, process.env.EXTERNAL_DISCOVERY_FEED_SHA);
  if (process.env.EXTERNAL_DISCOVERY_CORE_SHA) assert.equal(report.catalogue.coreSHA256, process.env.EXTERNAL_DISCOVERY_CORE_SHA);
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  async function check(name, run, { synthetic = true, width = 820, strictPublisher = false } = {}) {
    if (process.env.EXTERNAL_DISCOVERY_MATCH && !new RegExp(process.env.EXTERNAL_DISCOVERY_MATCH).test(name)) return;
    const server = new FakeCloud(), device = 'external-' + report.checks.length, context = await makeContext(browser, server, device, accounts.a, { viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width <= 820, reducedMotion: 'reduce' });
    let expectedFeedFailure = false, expectedPublisher = null;
    // Observe independently of route handlers: fulfilled synthetic feed routes
    // must receive the same privacy checks as real static catalogue requests.
    context.on('request', request => {
      const url = new URL(request.url()), body = request.postData() || '';
      if (url.href.includes(encodeURIComponent(privateText)) || body.includes(privateText)) report.privacyViolations.push({ check: name, destination: url.origin + url.pathname });
      if (/huggingface|xethub|transformers|\.onnx(?:$|\?)|\.wasm(?:$|\?)/i.test(url.href)) report.modelRequests.push({ check: name, destination: url.origin + url.pathname });
      if (url.origin === new URL(base).origin && url.pathname === feedPath) {
        report.catalogueRequests.push({ check: name, method: request.method(), search: url.search, hasBody: !!request.postData(), referrer: request.headers().referer || null });
        if (url.search || request.method() !== 'GET' || request.postData()) report.privacyViolations.push({ check: name, reason: 'Catalogue request must be fixed same-origin GET without private query/body' });
      }
    });
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === new URL(base).origin) return route.fallback();
      if (url.origin === cloud) return route.fallback();
      if (request.isNavigationRequest()) {
        if (strictPublisher && request.url() !== expectedPublisher) { report.external.push({ check: name, origin: url.origin, reason: 'Unexpected publisher navigation without the exact explicit-click URL' }); return route.abort('blockedbyclient'); }
        expectedPublisher = null;
        report.popupRequests.push({ check: name, destination: url.origin + url.pathname, url: request.url(), method: request.method(), referrer: request.headers().referer || null, hasBody: !!request.postData() });
        if (request.method() !== 'GET' || request.headers().referer || request.postData() || url.href.includes(encodeURIComponent(privateInterest))) report.privacyViolations.push({ check: name, reason: 'Publisher navigation leaked referrer/private data' });
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><title>검사용 원문 새 탭</title><p>원문 새 탭 연결의 합성 응답</p></html>' });
      }
      report.external.push({ check: name, origin: url.origin }); return route.abort('blockedbyclient');
    });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const observe = (target, label) => {
      target.on('pageerror', error => report.pageErrors.push({ check: label, message: error.message }));
      target.on('console', message => { if (message.type() !== 'error') return; const row = { check: label, message: message.text() }; if (expectedFeedFailure && message.location().url.includes(feedPath) && /503|ERR_FAILED/.test(message.text())) report.expectedErrors.push(row); else report.consoleErrors.push(row); });
    }; observe(page, name);
    try { await run({ page, context, server, device, observe, armPublisher: url => { expectedPublisher = url; }, expectFeedFailure: value => { expectedFeedFailure = value; } }); assert.equal(server.writes().length, 0); report.checks.push({ name, syntheticFeed: synthetic, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, syntheticFeed: synthetic, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    await check('checked-in public catalogue smoke uses explicitly saved interests without automatic source writes', async ({ page }) => {
      await seed(page, '전시'); await page.reload(); await ready(page); const before = await state(page); await nav(page, 'news'); await page.locator('#discoveryReview').waitFor(); await idle(page); await related(page);
      const count = await page.locator('#discoveryList [data-discovery-id]').count(); assert(count > 0 && count <= 5); assert.equal(new URL(page.url()).searchParams.get('section'), 'news'); assert.equal(new URL(page.url()).searchParams.get('view'), null);
      if (count < 3) assert.match(await page.locator('#discoveryReview').textContent(), /관련|없|부족|적|관심/);
      await selectNewsMode(page, 'latest'); await idle(page); assert.equal(await page.locator('#discoverySort').inputValue(), 'latest');
      assert.deepEqual((await state(page)).bundle, before.bundle); assert.deepEqual((await state(page)).workbench, before.workbench); assert.deepEqual((await state(page)).feedback, before.feedback);
      await selectNewsMode(page, 'related'); await idle(page); const first = page.locator('#discoveryList [data-discovery-id]').first(), articleId = await first.getAttribute('data-discovery-id'), articleUrl = await originalUrl(page, first);
      await (await revealControl(first.locator('[data-discovery-import]'))).click(); await page.locator('#lifeImportTitle').waitFor(); assert.equal(await page.locator('#lifeImportUrl').inputValue(), articleUrl); assert.deepEqual((await state(page)).bundle, before.bundle);
      await page.getByRole('button', { name: '원문·출처 확인', exact: true }).click(); await page.locator('.life-review').waitFor(); await page.getByRole('button', { name: '자료만 보관', exact: true }).click(); await page.locator('.life-reader').waitFor();
      const imported = await state(page); assert.equal(imported.bundle.sources.length, before.bundle.sources.length + 1); const source = imported.bundle.sources.find(x => x.url === articleUrl); assert(source); assert.equal(imported.bundle.sourceVersions.find(x => x.sourceId === source.id).contentText, null);
      await page.getByRole('button', { name: '새 글 찾기로 돌아가기', exact: true }).click(); await page.locator('#discoveryReview').waitFor(); await idle(page); assert.equal(await card(page, articleId).count(), 0);
      await open(page, 'life.html'); assert.equal(await page.locator('#discoveryReview').count(), 1); assert.equal(await card(page, articleId).count(), 0);
    }, { synthetic: false });
    // Keep the two established outer checks. Each additionally covers one newly
    // approved source against actual frozen catalog bytes, never inserted rows.
    const sourceGroups = [
      { legacy: { interest: '신간', sourceId: 'readersnews-books' }, field: { interest: '언어', sourceId: 'arxiv-cs-cl', hosts: ['arxiv.org', 'rss.arxiv.org'] } },
      { legacy: { interest: '공연', sourceId: 'seoul-environment' }, field: { interest: '언어', sourceId: 'mit-linguistics', hosts: ['news.mit.edu'] } }
    ];
    for (const group of sourceGroups) await check('checked-in expanded source ' + group.legacy.sourceId + ' explicit link import, original return, duplicate exclusion and prior feedback preservation', async ({ page, context, armPublisher }) => {
      await seed(page, '전시'); await open(page);
      const oldArticle = publicFeed.articles.find(article => article.sourceId === 'seoul-culture' && Discovery.rank(publicFeed, { profile: { manual: [{ id: 'qa', label: '전시' }] }, mode: 'related' }).items.some(item => item.article.id === article.id));
      assert(oldArticle, 'Existing culture article remains supplied');
      await (await revealControl(card(page, oldArticle.id).locator('[data-discovery-feedback="not_relevant"]'))).click(); await idle(page);
      const feedbackBefore = (await state(page)).feedback; assert(feedbackBefore.feedback.some(row => row.canonicalUrl === Discovery.canonicalUrl(oldArticle.url)));
      const actions = () => page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.readDiscoveryActions(await s.getActive()); });
      for (const target of [group.legacy, group.field]) {
        const { interest, sourceId, hosts } = target, journey = { sourceId, syntheticFeed: false, publisherResponse: 'intercepted synthetic HTML after explicit click', pass: false };
        report.publicSourceJourneys.push(journey);
        const supplied = publicFeed.sources.find(source => source.id === sourceId);
        journey.sourceStatus = supplied?.status ?? 'missing'; journey.sourceStale = supplied?.stale ?? null;
        journey.suppliedArticles = publicFeed.articles.filter(article => article.sourceId === sourceId).length;
        assert(supplied, 'Approved source is present in the actual catalog: ' + sourceId);
        assert(journey.suppliedArticles > 0, 'No actual public article supplied; do not replace with a synthetic success: ' + sourceId);
        if (hosts) assert.deepEqual([...Discovery.ALLOWED_SOURCES[sourceId]].sort(), [...hosts].sort());
        await interests(page, interest); await open(page);
        journey.relatedVisibleIds = await page.locator('#discoveryList [data-discovery-id]').evaluateAll(nodes => nodes.map(node => node.dataset.discoveryId));
        if (hosts) {
          // Explicit UI source choice/latest checks availability independently of
          // Korean/English lexical match quality. No runtime/feed rank override.
          await topics(page);
          await (await revealControl(page.locator('#discoveryOptions > summary'))).click();
          const sourceIds = await page.locator('[data-discovery-source]').evaluateAll(nodes => nodes.map(node => node.dataset.discoverySource));
          assert(sourceIds.includes(sourceId));
          for (const id of sourceIds) { await page.locator('[data-discovery-source="' + escapeId(id) + '"]').setChecked(id === sourceId); await idle(page); }
          await (await revealControl(page.locator('#discoveryOptions > summary'))).click();
          await selectNewsMode(page, 'latest'); await idle(page);
          journey.selection = 'Explicit source-only UI setting and latest order; availability test, not recommendation usefulness';
        } else journey.selection = 'Existing explicit interest and related order';
        const before = await state(page), actionsBefore = await actions();
        const ids = await page.locator('#discoveryList [data-discovery-id]').evaluateAll(nodes => nodes.map(node => node.dataset.discoveryId));
        const article = publicFeed.articles.find(row => row.sourceId === sourceId && ids.includes(row.id));
        assert(article, 'The actual approved source has a visible article: ' + sourceId);
        journey.articleId = article.id; journey.url = article.url; journey.canonicalUrl = Discovery.canonicalUrl(article.url);
        assert(Discovery.ALLOWED_SOURCES[sourceId].includes(new URL(article.url).hostname));
        assert.equal(article.coverage, 'link_only'); assert.equal(article.rights.mode, 'metadata_only');
        if (interest === '신간') for (const width of [390, 1440]) {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
          const audit = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth })); assert(audit.documentWidth <= audit.viewport, 'Actual new-source horizontal overflow');
          const file = 'actual-new-books-' + width + '.png'; await page.screenshot({ path: path.join(out, file), fullPage: true });
          report.visual.push({ width, syntheticFeed: false, sourceId, interest, file, audit });
        }
        if (sourceId === 'arxiv-cs-cl') {
          await page.setViewportSize({ width: 390, height: 844 });
          await card(page, article.id).scrollIntoViewIfNeeded();
          const audit = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth })); assert(audit.documentWidth <= audit.viewport, 'Actual arXiv title has no horizontal overflow');
          const file = 'actual-arxiv-candidate-390.png'; await page.screenshot({ path: path.join(out, file), fullPage: false });
          report.visual.push({ width: 390, syntheticFeed: false, sourceId, file, audit });
        }
        await openReader(page, card(page, article.id)); const original = page.locator('[data-discovery-original]'); assert.equal(await original.getAttribute('href'), article.url); assert.equal(await original.getAttribute('target'), '_blank'); assert.match(await original.getAttribute('rel'), /noreferrer/);
        await original.focus(); const navigationUrl = new URL(article.url).href, popupCount = report.popupRequests.length, popupPromise = context.waitForEvent('page'); armPublisher(navigationUrl); await original.click(); const popup = await popupPromise; await popup.waitForLoadState('domcontentloaded');
        assert.equal(popup.url(), navigationUrl); assert.equal(report.popupRequests.length, popupCount + 1); assert.equal(report.popupRequests.at(-1).url, navigationUrl); assert.equal(report.popupRequests.at(-1).method, 'GET');
        assert.deepEqual(await popup.evaluate(() => ({ referrer: document.referrer, opener: window.opener === null })), { referrer: '', opener: true }); await popup.close(); await page.bringToFront();
        assert.deepEqual(await page.locator('#discoveryList [data-discovery-id]').evaluateAll(nodes => nodes.map(node => node.dataset.discoveryId)), ids); assert.equal(await original.evaluate(node => node === document.activeElement), true); assert.deepEqual(await state(page), before); assert.deepEqual(await actions(), actionsBefore);
        await closeReader(page); journey.explicitOriginalPopup = true; journey.popupDoesNotReactOrSave = true;
        for (const kind of ['liked', 'bookmarked']) {
          await card(page, article.id).locator('[data-discovery-reaction="' + kind + '"]').click(); await idle(page);
          await page.waitForFunction(async ({ canonicalUrl, kind }) => { const s = HaedoLife.Shell.storage, p = await s.readDiscoveryActions(await s.getActive()); return p.entries.some(entry => entry.canonicalUrl === canonicalUrl && entry[kind]); }, { canonicalUrl: journey.canonicalUrl, kind });
          assert.equal(await card(page, article.id).locator('[data-discovery-reaction="' + kind + '"]').getAttribute('aria-pressed'), 'true');
          assert.deepEqual(await page.locator('#discoveryList [data-discovery-id]').evaluateAll(nodes => nodes.map(node => node.dataset.discoveryId)), ids);
        }
        const reacted = await actions(), saved = reacted.entries.find(entry => entry.canonicalUrl === journey.canonicalUrl);
        assert.equal(saved.liked, true); assert.equal(saved.bookmarked, true); assert.equal(reacted.personalizationEnabled, false);
        assert.equal(saved.snapshot.sourceId, sourceId); assert.equal(saved.snapshot.sourceName, supplied.name); assert.equal(saved.snapshot.title, article.title); assert.equal(saved.snapshot.url, article.url); assert.equal(saved.snapshot.coverage, 'link_only'); assert.equal(saved.snapshot.rights.mode, 'metadata_only');
        for (const key of ['bodyText', 'contentText', 'summary', 'memo']) assert.equal(Object.hasOwn(saved.snapshot, key), false);
        assert.deepEqual(await state(page), before); journey.independentLikeAndBookmark = true;
        await (await revealControl(card(page, article.id).locator('[data-discovery-import]'))).click(); await page.locator('#lifeImportTitle').waitFor(); assert.equal(await page.locator('#lifeImportTitle').inputValue(), article.title); assert.equal(await page.locator('#lifeImportUrl').inputValue(), article.url); assert.equal(await page.locator('#lifeImportText').inputValue(), ''); assert.deepEqual(await state(page), before);
        await page.getByRole('button', { name: '원문·출처 확인', exact: true }).click(); await page.locator('.life-review').waitFor(); assert.match(await page.locator('.life-review').textContent(), /본문 미확보|링크/); assert.deepEqual(await state(page), before);
        await page.getByRole('button', { name: '자료만 보관', exact: true }).click(); await page.locator('.life-reader').waitFor();
        const after = await state(page), stored = after.bundle.sources.find(row => row.url === article.url); assert(stored); assert.equal(after.bundle.sources.length, before.bundle.sources.length + 1);
        const version = after.bundle.sourceVersions.find(row => row.sourceId === stored.id); assert.equal(version.contentText, null); assert.equal(version.coverage.status, 'link_only');
        for (const source of before.bundle.sources) assert.deepEqual(after.bundle.sources.find(row => row.id === source.id), source);
        for (const version of before.bundle.sourceVersions) assert.deepEqual(after.bundle.sourceVersions.find(row => row.id === version.id), version);
        assert.deepEqual(after.workbench, before.workbench); assert.deepEqual(after.interest, before.interest); assert.deepEqual(after.feedback, feedbackBefore); assert.deepEqual(await actions(), reacted);
        await page.getByRole('button', { name: '새 글 찾기로 돌아가기', exact: true }).click(); await page.locator('#discoveryReview').waitFor(); await idle(page); assert.equal(await card(page, article.id).count(), 0);
        await page.reload(); await ready(page); await page.locator('#discoveryReview').waitFor(); await idle(page); assert.equal(await card(page, article.id).count(), 0); assert.deepEqual((await state(page)).feedback, feedbackBefore);
        for (const selector of ['#discoveryLiked', '#discoveryBookmarked']) {
          await page.locator(selector).click(); await idle(page); const retained = card(page, article.id); assert.equal(await retained.count(), 1);
          assert.equal(await originalUrl(page, retained), article.url); assert.match(await retained.textContent(), /본문 미확보/);
          assert.equal(await retained.locator('[data-discovery-reaction="liked"]').getAttribute('aria-pressed'), 'true'); assert.equal(await retained.locator('[data-discovery-reaction="bookmarked"]').getAttribute('aria-pressed'), 'true');
        }
        if (sourceId === 'mit-linguistics') {
          await page.setViewportSize({ width: 1440, height: 1000 }); await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
          const audit = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth })); assert(audit.documentWidth <= audit.viewport, 'Actual MIT saved title has no horizontal overflow');
          const file = 'actual-mit-saved-1440.png'; await page.screenshot({ path: path.join(out, file), fullPage: true }); report.visual.push({ width: 1440, syntheticFeed: false, sourceId, file, audit });
        }
        assert.deepEqual(await actions(), reacted); journey.linkOnlySourceStored = true; journey.returnAndKnownUrlExclusion = true; journey.bothSavedListsReopenAfterReload = true;
        await (await revealControl(page.locator('#discoveryDiscover'))).click(); await idle(page); assert.equal(await card(page, article.id).count(), 0);
        await interests(page, '전시'); await open(page); assert.equal(await card(page, oldArticle.id).count(), 0); assert.deepEqual((await state(page)).feedback, feedbackBefore); assert.equal((await state(page)).bundle.sources.length, before.bundle.sources.length + 1);
        journey.priorOriginalsAndFeedbackPreserved = true; journey.pass = true;
      }
    }, { synthetic: false, strictPublisher: true });
    await check('synthetic related versus same-source latest, noreferrer popup return and exact list focus', async ({ page, context }) => {
      await feedRoute(context); await seed(page); await open(page); const before = await state(page);
      assert.equal(await page.locator('#discoveryList [data-discovery-id]').count(), 3); assert.equal(await card(page, 'latest-other').count(), 0);
      const order = await page.locator('#discoveryList [data-discovery-id]').evaluateAll(nodes => nodes.map(n => n.dataset.discoveryId)); await openReader(page, card(page, order[0])); const first = page.locator('[data-discovery-original]');
      assert.equal(await first.getAttribute('target'), '_blank'); assert.match(await first.getAttribute('rel'), /noreferrer/);
      await first.focus(); const popupPromise = context.waitForEvent('page'); await first.click(); const popup = await popupPromise; await popup.waitForLoadState('domcontentloaded');
      assert.deepEqual(await popup.evaluate(() => ({ referrer: document.referrer, opener: window.opener === null })), { referrer: '', opener: true }); await popup.close(); await page.bringToFront();
      assert.deepEqual(await page.locator('#discoveryList [data-discovery-id]').evaluateAll(nodes => nodes.map(n => n.dataset.discoveryId)), order); assert.equal(await first.evaluate(el => document.activeElement === el), true);
      assert.deepEqual(await state(page), before); await closeReader(page); await selectNewsMode(page, 'latest'); await idle(page); assert.equal(await page.locator('#discoveryList [data-discovery-id]').first().getAttribute('data-discovery-id'), 'latest-other');
    });
    for (const [id, coverage] of [['related-link', 'link_only'], ['related-summary', 'summary'], ['related-full', 'full_text']]) await check('synthetic catalogue ' + coverage + ' preserves acquired content through explicit import and excludes saved URL', async ({ page, context }) => {
      const feed = fixture(); await feedRoute(context, feed); await seed(page); await open(page); const before = await state(page), article = feed.articles.find(x => x.id === id);
      await (await revealControl(card(page, id).locator('[data-discovery-import]'))).click(); await page.locator('#lifeImportTitle').waitFor(); assert.equal(await page.locator('#lifeImportTitle').inputValue(), article.title); assert.equal(await page.locator('#lifeImportUrl').inputValue(), article.url); assertImportedText(await page.locator('#lifeImportText').inputValue(), article, { textarea: true }); assert.deepEqual((await state(page)).bundle, before.bundle); await page.getByRole('button', { name: '원문·출처 확인', exact: true }).click(); await page.locator('.life-review').waitFor();
      const reviewText = await page.locator('.life-review').textContent(); assert.match(reviewText, coverage === 'link_only' ? /본문 미확보|링크/ : coverage === 'summary' ? /선택한 본문 일부|요약/ : /전체|전문|본문/);
      await page.getByRole('button', { name: '자료만 보관', exact: true }).click(); await page.locator('#lifeSourceText,.life-reader').first().waitFor();
      const after = await state(page); assert.equal(after.bundle.sources.length, before.bundle.sources.length + 1);
      const source = after.bundle.sources.find(x => x.url === article.url); assert(source); const version = after.bundle.sourceVersions.find(x => x.sourceId === source.id);
      assert.equal(version.originalAuthor.relation, article.author ? 'other' : 'unknown'); assert.equal(version.coverage.status, coverage === 'summary' ? 'partial' : coverage);
      assertImportedText(version.contentText, article);
      assert.deepEqual(after.workbench, before.workbench); assert.deepEqual(after.interest, before.interest); assert.deepEqual(after.feedback, before.feedback);
      await returnToDiscovery(page); assert.equal(await card(page, id).count(), 0); assert.equal((await state(page)).bundle.sources.length, after.bundle.sources.length);
    });
    await check('synthetic explicit feedback and undo preserve all originals across reload', async ({ page, context }) => {
      await feedRoute(context); await seed(page); await open(page); const before = await state(page);
      await (await revealControl(card(page, 'related-link').locator('[data-discovery-feedback="not_relevant"]'))).click(); await idle(page); assert.equal(await card(page, 'related-link').count(), 0);
      let next = await state(page); assert.equal(next.feedback.feedback.length, 1); assert.equal(next.feedback.feedback[0].kind, 'not_relevant'); assert.deepEqual(next.bundle, before.bundle);
      await (await revealControl(page.locator('#discoveryUndo'))).click(); await idle(page); assert.equal(await card(page, 'related-link').count(), 1); assert.equal((await state(page)).feedback.feedback.length, 0);
      await (await revealControl(card(page, 'related-summary').locator('[data-discovery-feedback="already_read"]'))).click(); await idle(page); await page.reload(); await ready(page); await page.locator('#discoveryReview').waitFor(); await idle(page);
      next = await state(page); assert.equal(await card(page, 'related-summary').count(), 0); assert.deepEqual(next.bundle, before.bundle); assert.deepEqual(next.workbench, before.workbench); assert.deepEqual(next.interest, before.interest);
    });
    await check('synthetic committed import survives refresh failure and opens receipt without duplicate commit', async ({ page, context }) => {
      await controllableFeedbackSave(context); await feedRoute(context); await seed(page); await open(page); const before = await state(page);
      await (await revealControl(card(page, 'related-link').locator('[data-discovery-import]'))).click(); await page.locator('#lifeImportTitle').waitFor(); await page.getByRole('button', { name: '원문·출처 확인', exact: true }).click(); await page.locator('.life-review').waitFor();
      await page.evaluate(() => { window.__discoveryCommitCalls = 0; window.__discoveryFailPostCommitRead = true; });
      await page.getByRole('button', { name: '자료만 보관', exact: true }).click(); await page.locator('#lifeDiscoveryStoredRetry').waitFor();
      assert.equal(await page.getByRole('button', { name: '자료만 보관', exact: true }).count(), 0); assert.equal((await state(page)).bundle.sources.length, before.bundle.sources.length + 1); assert.equal(await page.evaluate(() => window.__discoveryCommitCalls), 1);
      await page.locator('#lifeDiscoveryStoredRetry').click(); await page.locator('.life-reader').waitFor(); await page.getByRole('button', { name: '새 글 찾기로 돌아가기', exact: true }).click(); await page.locator('#discoveryReview').waitFor(); await idle(page);
      assert.equal(await card(page, 'related-link').count(), 0); assert.equal((await state(page)).bundle.sources.length, before.bundle.sources.length + 1); assert.equal(await page.evaluate(() => window.__discoveryCommitCalls), 1);
    });
    await check('synthetic recycled provider ID cannot redirect undo to a different canonical URL', async ({ page, context }) => {
      const feed = await feedRoute(context); await seed(page); await open(page);
      await (await revealControl(card(page, 'related-link').locator('[data-discovery-feedback="not_relevant"]'))).click(); await idle(page);
      feed.value = fixture(); const changed = feed.value.articles.find(x => x.id === 'related-link'); changed.url += '?edition=new'; changed.title = '독서 · 같은 공급 ID지만 다른 주소인 새 글';
      await (await revealControl(page.locator('#discoveryRefresh'))).click(); await idle(page); assert.equal(await card(page, 'related-link').count(), 1);
      const undo = page.locator('[data-discovery-undo="related-link"]'); await (await revealControl(undo)).click(); await idle(page);
      assert.equal((await state(page)).feedback.feedback.length, 0);
    });
    await check('synthetic failed feedback retains intent and explicit retry without changing sources', async ({ page, context }) => {
      await feedRoute(context); await seed(page); await open(page); const before = await state(page); await abortFeedback(page, true);
      await (await revealControl(card(page, 'related-link').locator('[data-discovery-feedback="not_relevant"]'))).click(); await page.locator('#discoveryError').waitFor({ state: 'visible' }); assert.deepEqual((await state(page)).feedback, before.feedback);
      await abortFeedback(page, false); await (await revealControl(page.locator('#discoveryFeedbackRetry'))).click(); await idle(page); assert.equal((await state(page)).feedback.feedback.length, 1); assert.deepEqual((await state(page)).bundle, before.bundle);
    });
    await check('synthetic two-tab feedback CAS keeps intent until latest reload and explicit retry', async ({ page, context, observe }) => {
      await controllableFeedbackSave(context); await feedRoute(context); await seed(page); await open(page); const second = await context.newPage(); observe(second, 'feedback CAS second tab'); await open(second);
      await second.evaluate(() => { window.__discoveryHoldSave = true; }); await (await revealControl(card(second, 'related-summary').locator('[data-discovery-feedback="already_read"]'))).click(); await second.waitForFunction(() => window.__discoverySaveEntered);
      await (await revealControl(card(page, 'related-link').locator('[data-discovery-feedback="not_relevant"]'))).click(); await idle(page); await second.evaluate(() => window.__discoveryReleaseSave()); await second.locator('#discoveryError').waitFor({ state: 'visible' });
      assert.equal((await state(second)).feedback.feedback.length, 1); await (await revealControl(second.locator('#discoveryFeedbackReload'))).click(); await idle(second); await (await revealControl(second.locator('#discoveryFeedbackRetry'))).click(); await idle(second);
      const saved = (await state(second)).feedback; assert.equal(saved.feedback.length, 2); assert.deepEqual(new Set(saved.feedback.map(x => x.kind)), new Set(['not_relevant', 'already_read'])); await second.close();
    });
    await check('synthetic empty catalogue, no relevant matches and failed refresh with stale recovery stay distinct', async ({ page, context, expectFeedFailure }) => {
      const feed = await feedRoute(context, fixture({ empty: true })); await seed(page); await open(page); assert.equal(await page.locator('#discoveryList [data-discovery-id]').count(), 0); assert.match(await page.locator('#discoveryReview').textContent(), /공개|목록|없/);
      feed.value = fixture(); await (await revealControl(page.locator('#discoveryRefresh'))).click(); await idle(page); assert.equal(await page.locator('#discoveryList [data-discovery-id]').count(), 3);
      await interests(page, '합성목록에없는매우특이한관심'); await open(page); assert.equal(await page.locator('#discoveryList [data-discovery-id]').count(), 0); assert.match(await page.locator('#discoveryList').textContent(), /주제와 맞는 글이 없습니다\./); await selectNewsMode(page, 'latest'); await idle(page); assert.equal(await page.locator('#discoveryList [data-discovery-id]').count(), 5);
      await interests(page); await open(page);
      feed.value = fixture({ stale: true }); await (await revealControl(page.locator('#discoveryRefresh'))).click(); await idle(page); assert.match(await page.locator('#discoveryReview').textContent(), /이전|갱신|실패/);
      expectFeedFailure(true); feed.fail = true; await (await revealControl(page.locator('#discoveryRefresh'))).click(); await idle(page); assert.match(await page.locator('#discoveryReview').textContent(), /이전|실패|확인/); assert.equal(await page.locator('#discoveryList [data-discovery-id]').count(), 3);
      await page.reload(); await ready(page); await page.locator('#discoveryReview').waitFor(); await idle(page); assert.equal(await page.locator('#discoveryList [data-discovery-id]').count(), 0); assert.match(await page.locator('#discoveryError').textContent(), /불러오지 못|확인|실패/);
    });
    await check('synthetic delayed feed response cannot restore prior workspace interests or list', async ({ page, context }) => {
      const feed = await feedRoute(context), data = await seed(page);
      const otherId = await page.evaluate(async id => { const s = HaedoLife.Shell.storage, other = await s.createWorkspace('늦은 응답 검사 공간'); await s.setActive(id); return other.workspaceId; }, data.workspaceId);
      await open(page); const before = await state(page), arrived = feed.nextRequest(); feed.hold = true; await (await revealControl(page.locator('#discoveryRefresh'))).click(); await arrived;
      try {
        await nav(page, 'manage'); await page.locator('#lifeCurrentWorkspace').click(); await page.locator('#lifeWorkspace').selectOption(otherId); await page.waitForFunction(id => HaedoLife.Shell.storage.getActive().then(value => value === id), otherId);
      } finally { feed.release(); }
      await returnToDiscovery(page); assert.equal((await state(page)).bundle.workspaceId, otherId); assert.deepEqual((await state(page)).interest.manual, []); assert.equal(await page.locator('#discoveryList [data-discovery-id]').count(), 0);
      assert.deepEqual(await page.evaluate(async id => HaedoLife.Shell.storage.read(id), data.workspaceId), before.bundle);
    });
    await check('synthetic late feed response after actual logout cannot reveal prior account feedback', async ({ page, context, server, device }) => {
      const feed = await feedRoute(context), data = await seed(page); await open(page);
      await (await revealControl(card(page, 'related-link').locator('[data-discovery-feedback="already_read"]'))).click(); await idle(page);
      const previousDocument = await page.evaluate(() => __homeInstance);
      const arrived = feed.nextRequest(); feed.hold = true; await (await revealControl(page.locator('#discoveryRefresh'))).click(); await arrived;
      try { await nav(page, 'manage'); await openAccount(page); await page.locator('#lifeLogout').click(); await page.waitForFunction(() => globalThis.HaedoLife?.Shell && document.querySelector('#lifeApp')?.hidden && !globalThis.HaedoLife.Shell.storage); }
      finally { feed.release(); }
      // Invalidation hides private data before SDK sign-out finishes and replaces
      // this document with index.html. Starting a new goto during that interval
      // races the pending replacement. Verify the new public document first;
      // pathname alone also matches the private document we just left.
      await page.waitForFunction(previous => window.__homeInstance && __homeInstance !== previous, previousDocument);
      await page.locator('#lifeWelcome').waitFor({ state: 'visible' });
      assert.equal(new URL(page.url()).pathname, '/index.html');
      assert.equal(await page.evaluate(() => HaedoAuth.user), null); server.oauthAccounts.set(device, accounts.b);
      await page.goto(base + '/login.html?next=' + encodeURIComponent('index.html?section=tools&view=external-discovery')); await page.locator('#googleLogin').click(); await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page); await page.locator('#discoveryReview').waitFor(); await idle(page);
      const after = await state(page); assert.deepEqual(after.interest.manual, []); assert.deepEqual(after.feedback.feedback, []); assert.equal(after.bundle.sources.length, 0);
      assert.equal(await page.evaluate(async id => { try { await HaedoLife.Shell.storage.readDiscoveryProfile(id); return false; } catch (_) { return true; } }, data.workspaceId), true);
    });
    await check('synthetic unsaved feedback failure blocks leaving review until explicit discard', async ({ page, context }) => {
      await feedRoute(context); const data = await seed(page);
      const otherId = await page.evaluate(async id => { const s = HaedoLife.Shell.storage, other = await s.createWorkspace('실패 입력 보존 검사 공간'); await s.setActive(id); return other.workspaceId; }, data.workspaceId);
      await open(page); const before = await state(page); await abortFeedback(page, true); await (await revealControl(card(page, 'related-link').locator('[data-discovery-feedback="not_relevant"]'))).click(); await page.locator('#discoveryError').waitFor({ state: 'visible' }); await idle(page); await page.locator('#discoveryFeedbackRetry').waitFor(); await abortFeedback(page, false);
      await page.locator('[data-haedo-navigation] [data-haedo-section="manage"]').click(); await page.locator('#lifeError').waitFor({ state: 'visible' }); assert.equal(await page.locator('#discoveryReview').isVisible(), true); assert.equal((await state(page)).bundle.workspaceId, data.workspaceId); assert.equal(await page.evaluate(() => HaedoAuth.user.id), accounts.a.id);
      await (await revealControl(page.locator('#discoveryFeedbackDiscard'))).click(); await idle(page); assert.deepEqual((await state(page)).feedback, before.feedback);
      await nav(page, 'manage'); await page.locator('#lifeCurrentWorkspace').click(); await page.locator('#lifeWorkspace').selectOption(otherId); await page.waitForFunction(id => HaedoLife.Shell.storage.getActive().then(value => value === id), otherId);
    });
    for (const width of [390, 820, 1440]) await check('synthetic discovery visual long Korean titles and controls ' + width, async ({ page, context }) => {
      await feedRoute(context); await seed(page); await open(page); const audit = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, controls: [...document.querySelectorAll('#discoveryReview button,#discoveryReview a')].filter(el => el.checkVisibility()).map(el => ({ label: (el.getAttribute('aria-label') || el.textContent).slice(0,80), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })) }));
      assert(audit.documentWidth <= audit.viewport, 'Horizontal overflow'); for (const c of audit.controls) { assert(c.width >= 44, c.label + ' control width'); assert(c.height >= 44, c.label + ' control height'); }
      const file = 'discovery-' + width + '.png'; await page.screenshot({ path: path.join(out, file), fullPage: true }); report.visual.push({ width, syntheticFeed: true, file, audit });
    }, { width });
  } finally { await browser.close(); report.catalogue.unchanged = sha(await fs.readFile(publicFeedPath)) === report.catalogue.sha256 && sha(await fs.readFile(corePath)) === report.catalogue.coreSHA256; await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(`External discovery: ${report.checks.filter(x => x.pass).length}/${report.checks.length}; console ${report.consoleErrors.length}; page ${report.pageErrors.length}; privacy ${report.privacyViolations.length}; external ${report.external.length}.`);
  if (report.checks.some(x => !x.pass) || report.consoleErrors.length || report.pageErrors.length || report.privacyViolations.length || report.external.length || report.modelRequests.length || !report.catalogue.unchanged) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

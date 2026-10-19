/* Discovery controls and visible-page refresh: real UI/Core/SDK/IndexedDB;
 * synthetic fixed public catalogue, anonymous intercepted Auth, Playwright clock.
 * No production account, live publisher, model, user usefulness or Apple-device claim. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { FakeCloud, accounts, cloud, base, openAccount } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, nav } = require('./unified-home-browser.cjs');
const output = path.resolve(process.env.DISCOVERY_AUTOMATION_OUTPUT || path.join(__dirname, '../.local/discovery-automation-browser'));
const feedPath = '/assets/life/discovery-feed.json', entry = base + '/index.html?section=tools&view=external-discovery';
const PRIVATE_TERM = '익명비공개관심표식_외부전송금지', PRIVATE_BODY = '\ufeff익명 비공개 원문 😀\r\nCafe\u0301 정확 버전 보존';
const INTEREST = '언어 학습', MINUTE = 60000;
const report = { createdAt: new Date().toISOString(), scope: 'Real local UI/Core/SDK/IndexedDB; synthetic metadata-only public catalogue and anonymous mocked Auth only. Playwright browser clock tests visible 15-minute refresh. Synthetic visibility events are identified explicitly. No live collection/deployment, account, publisher request, model inference, Apple hardware or user usefulness validation.', checks: [], visual: [], consoleErrors: [], pageErrors: [], privacyViolations: [], externalRequests: [], modelRequests: [], catalogueRequests: [], sourceRequests: [], expectedErrors: [] };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function wait(page, fn, arg, label = 'state') {
  const end = Date.now() + 20000;
  while (Date.now() < end) { if (await page.evaluate(fn, arg)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Discovery automation did not settle: ' + label);
}
const idle = page => wait(page, () => document.querySelector('#discoveryReview')?.getAttribute('aria-busy') === 'false', null, 'idle');
async function open(page) { await page.goto(entry); await ready(page); await page.locator('#discoveryReview').waitFor(); await idle(page); }
async function snapshot(page) { return page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(); return { bundle: await s.read(w), workbench: await s.readWorkbench(w), profile: await s.readInterestProfile(w), feedback: await s.readDiscoveryProfile(w), settings: await s.readDiscoverySettings(w) }; }); }
async function preserve(page, before) { const after = await snapshot(page); for (const key of ['bundle', 'workbench', 'feedback']) assert.deepEqual(after[key], before[key], key + ' remains exact'); return after; }
async function seed(page) {
  await page.goto(base + '/index.html?section=tools&view=interests'); await ready(page); await page.locator('#interestManual').fill(INTEREST); await page.locator('#interestSaveManual').click();
  await wait(page, async () => { const s = HaedoLife.Shell.storage; return (await s.readInterestProfile(await s.getActive())).manual.some(x => x.label === '언어 학습'); });
  await page.evaluate(async text => { const s = HaedoLife.Shell.storage, c = HaedoLife.Core, w = await s.getActive(), b = await s.read(w); const p = await c.prepareImport({ origin: 'other', title: '자동 갱신 보존용 합성 원문', text, authorRelation: 'self', forceSeparate: true }, b); const result = await s.commitLocal({ workspaceId: w, baseRevision: b.revision, operationId: c.id(), changes: c.buildImportChanges(b, p, []) }); if (result.status !== 'stored') throw Error('Synthetic fixture commit failed'); }, PRIVATE_BODY);
  await open(page); return snapshot(page);
}
function fixture(tag = 'baseline') {
  const now = new Date().toISOString(), rights = { mode: 'metadata_only', label: '합성 공개 메타데이터 · 본문 미확보', url: 'https://d2.naver.com/home' };
  const source = (id, host, name) => ({ id, name, url: 'https://' + host + '/', feedUrl: 'https://' + host + '/synthetic-feed', language: 'ko', rights, status: 'ok', stale: false, error: null, lastSuccessAt: now, lastAttemptAt: now });
  const sources = [source('naver-d2', 'd2.naver.com', '합성 기술 출처'), source('seoul-culture', 'news.seoul.go.kr', '합성 문화 출처')];
  const articles = sources.flatMap((s, index) => [0, 1].map(n => ({ id: tag + '-' + index + '-' + n, sourceId: s.id, url: s.url + 'synthetic/' + tag + '-' + n, title: (n ? '다른 관심의 문화 소식' : INTEREST + '의 실제 연습과 표현을 비교하는 합성 글') + ' · ' + tag + ' · ' + index, publishedAt: new Date(Date.now() - (index * 2 + n) * 86400000).toISOString(), dateStatus: 'valid', updatedAt: null, author: null, language: 'ko', tags: [], summary: '', coverage: 'link_only', rights, fetchedAt: now })));
  return { schemaVersion: 1, generatedAt: now, sources, articles };
}
async function feedRoute(context) {
  const control = { count: 0, value: fixture(), hold: false, fail: false, gates: [], arrivals: [], aborted: 0 };
  await context.route(base + feedPath, async route => {
    control.count++; const body = JSON.stringify(control.value), fail = control.fail;
    control.arrivals.splice(0).forEach(resolve => resolve());
    if (control.hold) await new Promise(resolve => control.gates.push(resolve));
    try { await route.fulfill({ status: fail ? 503 : 200, contentType: 'application/json', headers: { 'X-Haedo-Discovery-Cache': 'network', 'X-Haedo-Discovery-Fetched-At': new Date().toISOString() }, body: fail ? '{"error":"synthetic failure"}' : body }); } catch (error) { if (/already handled|closed|cancel|abort/i.test(error.message)) control.aborted++; else throw error; }
  });
  control.next = () => new Promise(resolve => control.arrivals.push(resolve));
  control.release = () => { control.hold = false; control.gates.splice(0).forEach(resolve => resolve()); };
  return control;
}
async function options(page) { const d = page.locator('#discoveryOptions'); if (!await d.getAttribute('open').then(x => x !== null)) await d.locator('summary').click(); }
async function auto(page, checked) { await options(page); await page.locator('#discoveryAutoRefresh').setChecked(checked); await wait(page, async value => { const s = HaedoLife.Shell.storage; return (await s.readDiscoverySettings(await s.getActive())).autoRefresh === value; }, checked, 'stored automatic option'); await idle(page); }
async function clock(page) { await page.clock.install({ time: new Date() }); }
async function advance(page, ms) { await page.clock.fastForward(ms); await page.waitForTimeout(80); }
async function visibility(page, hidden) {
  // Browser event path, with an explicitly synthetic hidden-state getter.
  // This is not an operating-system tab/background lifecycle claim.
  await page.evaluate(value => { if (!window.__discoveryVisibilityInstalled) { Object.defineProperty(document, 'hidden', { configurable: true, get: () => !!window.__discoveryHidden }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__discoveryHidden ? 'hidden' : 'visible' }); window.__discoveryVisibilityInstalled = true; } window.__discoveryHidden = value; document.dispatchEvent(new Event('visibilitychange')); }, hidden);
}
async function saveHooks(context) {
  await context.route(base + '/assets/life/storage.js', async route => {
    const response = await route.fetch(); const source = await response.text();
    const hook = `\n;(()=>{const old=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...old,forAccount(...a){const actual=old.forAccount(...a),extra={};for(const [kind,name]of [['Topic','saveInterestProfile'],['Settings','saveDiscoverySettings']])extra[name]=async function(...v){if(window['__hold'+kind]){window['__entered'+kind]=true;await new Promise(resolve=>{window['__release'+kind]=()=>{window['__hold'+kind]=false;resolve();};});}return actual[name](...v);};return Object.freeze({...actual,...extra});}});})();`;
    await route.fulfill({ response, body: source + hook });
  });
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const products = ['discovery-ui.js', 'discovery-settings.js', 'discovery.js', 'storage.js', 'discovery.css', 'shell.js', 'ui.js', '../platform-auth.js'];
  report.productHashesBefore = Object.fromEntries(await Promise.all(products.map(async name => [name, sha(await fs.readFile(path.resolve(__dirname, '../assets/life', name)))])));
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] }); report.browser = browser.version();
  async function check(name, action, width = 820) {
    if (process.env.DISCOVERY_AUTOMATION_MATCH && !new RegExp(process.env.DISCOVERY_AUTOMATION_MATCH).test(name)) return;
    const server = new FakeCloud(), device = 'automation-' + report.checks.length, context = await makeContext(browser, server, device, accounts.a, { viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width <= 820, reducedMotion: 'reduce' });
    const control = await feedRoute(context); await saveHooks(context);
    context.on('request', request => {
      const u = new URL(request.url()), body = request.postData() || '', headers = request.headers();
      if ([PRIVATE_TERM, PRIVATE_BODY].some(value => u.href.includes(value) || u.href.includes(encodeURIComponent(value)) || body.includes(value) || body.includes(JSON.stringify(value).slice(1, -1)))) report.privacyViolations.push({ check: name, destination: u.origin + u.pathname });
      if (/huggingface|xethub|transformers|onnxruntime|\.onnx(?:$|\?)|\.wasm(?:$|\?)/i.test(u.href)) report.modelRequests.push({ check: name, destination: u.origin + u.pathname });
      if (u.origin === new URL(base).origin && u.pathname === feedPath) { report.catalogueRequests.push({ check: name, method: request.method(), hasQuery: !!u.search, hasBody: !!request.postData(), hasAuthorization: !!headers.authorization, referrer: headers.referer || null }); if (request.method() !== 'GET' || u.search || request.postData() || headers.authorization || headers.referer) report.privacyViolations.push({ check: name, reason: 'Catalog GET boundary' }); }
    });
    await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback(); report.externalRequests.push({ check: name, destination: u.origin + u.pathname }); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.pageErrors.push({ check: name, message: error.message }));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ check: name, message: message.text() }); });
    console.log('RUN ' + name);
    try { await action({ page, context, server, device, control }); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { control.release(); await context.close(); }
  }
  try {
    await check('default automatic refresh is off and does not run after fifteen visible minutes', async ({ page, control }) => {
      const before = await seed(page); assert.equal(before.settings.autoRefresh, false); await options(page); assert.equal(await page.locator('#discoveryAutoRefresh').isChecked(), false);
      const count = control.count; await clock(page); await advance(page, 16 * MINUTE); assert.equal(control.count, count); await preserve(page, before);
    });
    await check('explicit topic input and selection survive reload without editing source originals', async ({ page }) => {
      const before = await seed(page); await page.locator('#discoveryTopicInput').fill(PRIVATE_TERM); await page.locator('#discoveryTopicAdd').click(); await idle(page);
      await wait(page, async term => { const s = HaedoLife.Shell.storage; return (await s.readInterestProfile(await s.getActive())).manual.some(x => x.label === term); }, PRIVATE_TERM);
      let current = await snapshot(page); const item = current.profile.manual.find(x => x.label === PRIVATE_TERM), selector = '[data-discovery-interest="' + item.id + '"]';
      await page.locator(selector).uncheck(); await idle(page); await wait(page, async id => { const s = HaedoLife.Shell.storage; return (await s.readDiscoverySettings(await s.getActive())).disabledInterestIds.includes(id); }, item.id);
      await page.reload(); await ready(page); await idle(page); assert.equal(await page.locator(selector).isChecked(), false); assert.equal((await snapshot(page)).profile.manual.find(x => x.id === item.id).label, PRIVATE_TERM); await preserve(page, before);
      await page.locator(selector).check(); await idle(page); assert.ok(!(await snapshot(page)).settings.disabledInterestIds.includes(item.id));
    });
    await check('turning off every source is preserved as zero sources in both list orders', async ({ page }) => {
      const before = await seed(page); await options(page); const ids = await page.locator('[data-discovery-source]').evaluateAll(nodes => nodes.map(x => x.dataset.discoverySource)); assert.ok(ids.length >= 2);
      for (const id of ids) { await options(page); await page.locator('[data-discovery-source="' + id + '"]').uncheck(); await idle(page); }
      assert.equal(await page.locator('[data-discovery-id]').count(), 0); await page.locator('#discoveryLatest').click(); assert.equal(await page.locator('[data-discovery-id]').count(), 0);
      await page.reload(); await ready(page); await idle(page); await options(page); assert.equal(await page.locator('[data-discovery-source]:checked').count(), 0); assert.equal(await page.locator('[data-discovery-id]').count(), 0); assert.deepEqual(new Set((await snapshot(page)).settings.disabledSourceIds), new Set(ids)); await preserve(page, before);
    });
    await check('forty stale disabled topic IDs do not block selecting a replacement topic after profile reset', async ({ page }) => {
      const before = await seed(page);
      await page.evaluate(async () => {
        const s = HaedoLife.Shell.storage, w = await s.getActive(), P = HaedoLife.InterestProfile, S = HaedoLife.DiscoverySettings;
        let p = await s.readInterestProfile(w); const old = Array.from({ length: 40 }, (_, n) => ({ id: 'retired-topic-' + n, label: '이전 합성 주제 ' + n }));
        let result = await s.saveInterestProfile(w, P.setManual(p, old, { expectedRevision: p.revision }), p.revision); if (result.status !== 'stored') throw Error('Old-topic fixture failed');
        const settings = await s.readDiscoverySettings(w), next = S.update(settings, { disabledInterestIds: old.map(x => x.id) }, { expectedRevision: settings.revision }); if ((await s.saveDiscoverySettings(w, next, settings.revision)).status !== 'stored') throw Error('Disabled-topic fixture failed');
        p = result.profile; result = await s.saveInterestProfile(w, P.clear(p, { expectedRevision: p.revision }), p.revision); if (result.status !== 'stored') throw Error('Profile reset fixture failed');
        p = result.profile; const fresh = Array.from({ length: 40 }, (_, n) => ({ id: 'replacement-topic-' + n, label: '새 합성 주제 ' + n })); if ((await s.saveInterestProfile(w, P.setManual(p, fresh, { expectedRevision: p.revision }), p.revision)).status !== 'stored') throw Error('Replacement-topic fixture failed');
      });
      await page.reload(); await ready(page); await idle(page); const unchanged = await snapshot(page); assert.equal(unchanged.settings.disabledInterestIds.length, 40); assert.ok(unchanged.settings.disabledInterestIds.every(id => id.startsWith('retired-'))); assert.equal(unchanged.profile.manual.length, 40);
      await page.locator('[data-discovery-interest="replacement-topic-0"]').uncheck(); await idle(page); await wait(page, async () => { const s = HaedoLife.Shell.storage, value = await s.readDiscoverySettings(await s.getActive()); return value.disabledInterestIds.length === 1 && value.disabledInterestIds[0] === 'replacement-topic-0'; }, null, 'explicit replacement-topic selection');
      const after = await preserve(page, before); assert.equal(after.settings.revision, unchanged.settings.revision + 1); assert.equal(after.profile.manual.length, 40); await page.reload(); await ready(page); await idle(page); assert.equal(await page.locator('[data-discovery-interest="replacement-topic-0"]').isChecked(), false);
    });
    for (const enabled of [true, false]) await check('initial catalogue pending automatic ' + (enabled ? 'on restarts the initial request and shows the recovered list' : 'off stops without automatic restart and offers explicit reload'), async ({ page, control }) => {
      const before = await seed(page); if (!enabled) await auto(page, true);
      control.hold = true; control.value = fixture('initial-late'); const firstCount = control.count, initial = control.next(); await page.reload({ waitUntil: 'domcontentloaded' }); await initial;
      await wait(page, () => !!globalThis.HaedoLife?.Shell?.storage && !!document.querySelector('#discoveryAutoRefresh') && !document.querySelector('#discoveryAutoRefresh').disabled, null, 'initial pending editor');
      await options(page); control.value = fixture('initial-recovered'); const restarted = enabled ? control.next() : null; await page.locator('#discoveryAutoRefresh').setChecked(enabled);
      await wait(page, async enabled => { const s = HaedoLife.Shell.storage; return (await s.readDiscoverySettings(await s.getActive())).autoRefresh === enabled; }, enabled, 'initial-pending automatic preference');
      if (enabled) { await restarted; assert.equal(control.count, firstCount + 2); control.release(); await idle(page); assert.ok(await page.locator('[data-discovery-id^="initial-recovered-"]').count() > 0); assert.equal(await page.locator('[data-discovery-id^="initial-late-"]').count(), 0); }
      else { await idle(page); const stoppedCount = control.count; assert.equal(stoppedCount, firstCount + 1); control.release(); await page.waitForTimeout(120); await clock(page); await advance(page, 16 * MINUTE); assert.equal(control.count, stoppedCount); assert.equal(await page.locator('[data-discovery-id]').count(), 0); assert.match(await page.locator('#discoveryStatus').textContent(), /목록 다시 불러오기/); await page.locator('#discoveryRefresh').click(); await idle(page); assert.equal(control.count, stoppedCount + 1); assert.ok(await page.locator('[data-discovery-id^="initial-recovered-"]').count() > 0); }
      await preserve(page, before);
    });
    await check('saved automatic refresh requests once when fifteen visible minutes become due', async ({ page, control }) => {
      const before = await seed(page); await clock(page); await auto(page, true); const count = control.count; await advance(page, 14 * MINUTE + 59000); assert.equal(control.count, count); const arrived = control.next(); await advance(page, 2000); await arrived; await idle(page); assert.equal(control.count, count + 1); await preserve(page, before); assert.equal((await snapshot(page)).profile.manual.length, before.profile.manual.length);
    });
    for (const stop of ['off', 'leave', 'hidden']) await check('pending automatic response is discarded after ' + stop, async ({ page, control }) => {
      const before = await seed(page); await clock(page); await auto(page, true); control.value = fixture('late-' + stop); control.hold = true; const arrived = control.next(); await advance(page, 15 * MINUTE + 100); await arrived;
      if (stop === 'off') { await options(page); await page.locator('#discoveryAutoRefresh').uncheck(); await wait(page, async () => { const s = HaedoLife.Shell.storage; return !(await s.readDiscoverySettings(await s.getActive())).autoRefresh; }); }
      if (stop === 'leave') await nav(page, 'home');
      if (stop === 'hidden') await visibility(page, true);
      control.release(); await page.waitForTimeout(120); assert.equal(await page.locator('[data-discovery-id^="late-"]').count(), 0);
      const count = control.count; await advance(page, 16 * MINUTE); assert.equal(control.count, count);
      if (stop === 'leave') { assert.equal(await page.locator('#discoveryReview').count(), 0); }
      else { await preserve(page, before); if (stop === 'hidden') { control.value = fixture('resumed'); await visibility(page, false); await idle(page); assert.ok(control.count <= count + 1); } }
    });
    await check('manual pending refresh resumes consistent controls and retained inputs after history without visibility events', async ({ page, context, control }) => {
      await context.addInitScript(() => { const original = fetch; window.fetch = function(input, init) { if (new URL(typeof input === 'string' ? input : input.url, location.href).pathname === '/assets/life/discovery-feed.json') window.__manualLifecycleSignal = init?.signal; return original.apply(this, arguments); }; });
      const before = await seed(page); assert.equal(before.settings.autoRefresh, false); control.hold = true; control.value = fixture('manual-history-late'); const pending = control.next(); await page.locator('#discoveryRefresh').click(); await pending;
      await page.evaluate(() => { window.__manualLifecycleNodes = { checkbox: document.querySelector('#discoveryAutoRefresh'), input: document.querySelector('#discoveryTopicInput'), surface: document.querySelector('#discoveryReview') }; });
      const held = await page.evaluate(() => ({ refreshDisabled: document.querySelector('#discoveryRefresh').disabled, busy: document.querySelector('#discoveryReview').getAttribute('aria-busy'), hidden: document.hidden })); assert.equal(held.refreshDisabled, true); assert.equal(held.busy, 'true');
      // Deliberately omit visibilitychange: retained shell/Auth lifecycle must
      // reconcile cancelled work even when no visibility event is delivered.
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))); assert.equal(await page.locator('#lifeApp').isHidden(), true); control.release();
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))); await ready(page); await page.waitForTimeout(100);
      const actual = await page.evaluate(() => ({ requestSignalAborted: window.__manualLifecycleSignal?.aborted, refreshDisabled: document.querySelector('#discoveryRefresh').disabled, busy: document.querySelector('#discoveryReview').getAttribute('aria-busy'), checkboxSame: __manualLifecycleNodes.checkbox === document.querySelector('#discoveryAutoRefresh'), inputSame: __manualLifecycleNodes.input === document.querySelector('#discoveryTopicInput'), surfaceSame: __manualLifecycleNodes.surface === document.querySelector('#discoveryReview'), automaticChecked: document.querySelector('#discoveryAutoRefresh').checked, appVisible: !document.querySelector('#lifeApp').hidden }));
      assert.deepEqual(actual, { requestSignalAborted: true, refreshDisabled: false, busy: 'false', checkboxSame: true, inputSame: true, surfaceSame: true, automaticChecked: false, appVisible: true }); assert.equal(await page.locator('[data-discovery-id^="manual-history-late-"]').count(), 0);
      const stopped = control.count; control.value = fixture('manual-history-recovered'); await page.locator('#discoveryRefresh').click(); await idle(page); assert.equal(control.count, stopped + 1); assert.ok(await page.locator('[data-discovery-id^="manual-history-recovered-"]').count() > 0); assert.equal(await page.locator('[data-discovery-id^="manual-history-late-"]').count(), 0);
      const after = await preserve(page, before); assert.deepEqual(after.profile, before.profile); assert.equal(after.settings.autoRefresh, false);
      report.manualHistoryLifecycle = { simulatedPersistedPagehidePageshow: true, actualBFCache: false, visibilityEventsDispatched: 0, cancelledControls: actual, explicitRecoveryCatalogGETs: 1, lateOldResponseIgnored: true };
    });
    await check('persisted history lifecycle stops old work and resumes saved automatic refresh only after fresh Auth', async ({ page, context, control }) => {
      const before = await seed(page); await clock(page); await auto(page, true);
      const critical = ['assets/platform-auth.js', 'assets/life/shell.js', 'assets/life/ui.js', 'assets/life/discovery-ui.js'];
      const servedHashes = await page.evaluate(async files => Object.fromEntries(await Promise.all(files.map(async file => { const response = await fetch(file, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' }); if (!response.ok) throw Error('Critical runtime response failed'); const bytes = await crypto.subtle.digest('SHA-256', await response.arrayBuffer()); return [file, Array.from(new Uint8Array(bytes), v => v.toString(16).padStart(2, '0')).join('')]; }))), critical);
      for (const file of critical) assert.equal(servedHashes[file], sha(await fs.readFile(path.resolve(__dirname, '..', file))), 'Served runtime must equal this checkout: ' + file);
      await page.evaluate(() => { window.__discoveryRetainedSurface = document.querySelector('#discoveryReview'); window.__discoveryRetainedStorage = HaedoLife.Shell.storage; });
      control.hold = true; control.value = fixture('history-late'); const pending = control.next(); await advance(page, 15 * MINUTE + 100); await pending;
      await visibility(page, true); await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      assert.equal(await page.locator('#lifeApp').isHidden(), true); control.release(); control.value = fixture('history-resumed'); await page.waitForTimeout(100); assert.equal(await page.locator('[data-discovery-id^="history-late-"]').count(), 0);
      const stopped = control.count; await advance(page, 16 * MINUTE); assert.equal(control.count, stopped);
      let authEntered, releaseAuth; const arrived = new Promise(resolve => { authEntered = resolve; }), gate = new Promise(resolve => { releaseAuth = resolve; }); let authCalls = 0;
      await context.route(cloud + '/auth/v1/user', async route => { if (route.request().method() === 'OPTIONS') return route.fallback(); authCalls++; authEntered(); await gate; return route.fallback(); });
      try {
        await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))); await arrived;
        await visibility(page, false); await advance(page, 100); assert.equal(await page.locator('#lifeApp').isHidden(), true); assert.equal(control.count, stopped, 'No old timer or catalogue fetch may resume while fresh Auth is pending'); assert.equal(await page.locator('[data-discovery-id^="history-late-"]').count(), 0);
      } finally { releaseAuth(); }
      await ready(page); await advance(page, 100); await idle(page); assert.equal(authCalls, 1); assert.equal(control.count, stopped + 1, 'One refresh resumes after verified history return');
      const retained = await page.evaluate(() => ({ surface: __discoveryRetainedSurface === document.querySelector('#discoveryReview'), storage: __discoveryRetainedStorage === HaedoLife.Shell.storage })); assert.deepEqual(retained, { surface: true, storage: true }); assert.equal((await snapshot(page)).settings.autoRefresh, true); assert.ok(await page.locator('[data-discovery-id^="history-resumed-"]').count() > 0);
      await advance(page, 15 * MINUTE + 100); await idle(page); assert.equal(control.count, stopped + 2, 'Only one periodic refresh remains after resume'); await preserve(page, before);
      report.historyLifecycle = { servedHashes, simulatedPersistedPagehidePageshow: true, actualBFCache: false, freshAuthCalls: authCalls, pendingAuthCatalogGETs: 0, resumedCatalogGETs: 1, followingPeriodCatalogGETs: 1, retained, savedAutomaticPreference: true };
    });
    await check('workspace switch while response is pending keeps the new scope default and source data exact', async ({ page, control }) => {
      const before = await seed(page); const other = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(), next = await s.createWorkspace('자동 갱신 합성 두 번째 공간'); await s.setActive(w); return next.workspaceId; });
      await page.reload(); await ready(page); await idle(page);
      await clock(page); await auto(page, true); control.hold = true; control.value = fixture('late-scope'); const arrived = control.next(); await advance(page, 15 * MINUTE + 100); await arrived;
      await nav(page, 'manage'); await page.locator('#lifeCurrentWorkspace').click(); await page.locator('#lifeWorkspace').selectOption(other); await wait(page, async id => (await HaedoLife.Shell.storage.getActive()) === id, other); control.release(); control.value = fixture('new-scope');
      await nav(page, 'tools'); await page.getByRole('button', { name: '새 글 찾기', exact: true }).click(); await idle(page); const next = await snapshot(page); assert.equal(next.bundle.workspaceId, other); assert.deepEqual(next.profile.manual, []); assert.equal(next.settings.autoRefresh, false); assert.equal(await page.locator('[data-discovery-id^="late-"]').count(), 0);
      assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), before.bundle.workspaceId), before.bundle);
    });
    await check('actual logout and new account do not reuse topics or automatic preferences', async ({ page, server, device, control }) => {
      await seed(page); await clock(page); await auto(page, true); control.hold = true; control.value = fixture('late-account'); const arrived = control.next(); await advance(page, 15 * MINUTE + 100); await arrived; const old = (await snapshot(page)).bundle.workspaceId;
      await nav(page, 'manage'); await openAccount(page); const instance = await page.evaluate(() => __homeInstance);
      // Register the native navigation wait before logout: SDK revocation can
      // finish after the old private DOM is hidden and destroy that context.
      await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.locator('#lifeLogout').click()]);
      await page.waitForFunction(previous => !!window.__homeInstance && window.__homeInstance !== previous && !!globalThis.HaedoLife?.Shell, instance);
      await page.evaluate(() => HaedoLife.Shell.ready); control.release(); control.value = fixture('new-account'); assert.equal(await page.evaluate(() => HaedoAuth.user), null);
      server.oauthAccounts.set(device, accounts.b); await page.goto(base + '/login.html?next=' + encodeURIComponent('index.html?section=tools&view=external-discovery')); await page.locator('#googleLogin').click(); await page.waitForURL(u => u.pathname.endsWith('/index.html')); await ready(page); await idle(page); const next = await snapshot(page); assert.deepEqual(next.profile.manual, []); assert.equal(next.settings.autoRefresh, false); assert.deepEqual(next.settings.disabledSourceIds, []);
      assert.equal(await page.evaluate(async id => { try { await HaedoLife.Shell.storage.readDiscoverySettings(id); return false; } catch (_) { return true; } }, old), true);
    });
    await check('topic CAS conflict preserves the typed input until explicit latest-state recovery', async ({ page, context }) => {
      const before = await seed(page); const second = await context.newPage(); await open(second); await page.locator('#discoveryTopicInput').fill(PRIVATE_TERM); await page.evaluate(() => { window.__holdTopic = true; }); await page.locator('#discoveryTopicAdd').click(); await wait(page, () => window.__enteredTopic);
      await second.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(), p = await s.readInterestProfile(w), next = HaedoLife.InterestProfile.setManual(p, [...p.manual, { id: 'concurrent-topic', label: '다른 탭 합성 관심' }], { expectedRevision: p.revision }); if ((await s.saveInterestProfile(w, next, p.revision)).status !== 'stored') throw Error('Concurrent topic fixture failed'); });
      await page.evaluate(() => __releaseTopic()); await page.locator('#discoveryTopicReload').waitFor(); assert.equal(await page.locator('#discoveryTopicInput').inputValue(), PRIVATE_TERM); await page.locator('#discoveryTopicReload').click(); await page.locator('#discoveryTopicRetry').waitFor(); assert.equal(await page.locator('#discoveryTopicInput').inputValue(), PRIVATE_TERM); await page.locator('#discoveryTopicRetry').click(); await idle(page); const after = await preserve(page, before); assert.ok(after.profile.manual.some(x => x.label === PRIVATE_TERM)); assert.ok(after.profile.manual.some(x => x.id === 'concurrent-topic')); await second.close();
    });
    await check('settings CAS conflict preserves the requested choice and independent concurrent source selection', async ({ page, context }) => {
      const before = await seed(page); const second = await context.newPage(); await open(second); await options(page); await page.evaluate(() => { window.__holdSettings = true; }); await page.locator('#discoveryAutoRefresh').check(); await wait(page, () => window.__enteredSettings);
      await second.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(), value = await s.readDiscoverySettings(w), next = HaedoLife.DiscoverySettings.update(value, { disabledSourceIds: ['seoul-culture'] }, { expectedRevision: value.revision }); if ((await s.saveDiscoverySettings(w, next, value.revision)).status !== 'stored') throw Error('Concurrent settings fixture failed'); });
      await page.evaluate(() => __releaseSettings()); await page.locator('#discoverySettingsReload').waitFor(); assert.equal(await page.locator('#discoveryAutoRefresh').isChecked(), true); await page.locator('#discoverySettingsReload').click(); assert.equal(await page.locator('#discoveryAutoRefresh').isChecked(), true); await page.locator('#discoverySettingsRetry').click(); await idle(page); const after = await preserve(page, before); assert.equal(after.settings.autoRefresh, true); assert.deepEqual(after.settings.disabledSourceIds, ['seoul-culture']); await second.close();
    });
    for (const action of ['off', 'clear']) await check('another tab ' + action + ' stops refresh during a pending settings save and conflict discard', async ({ page, context, control }) => {
      const before = await seed(page); await clock(page); await auto(page, true); const second = await context.newPage(); await open(second);
      await options(page); await page.evaluate(() => { window.__holdSettings = true; }); await page.locator('[data-discovery-source="seoul-culture"]').uncheck(); await wait(page, () => window.__enteredSettings);
      await page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(); s.subscribe(w, event => { if (event.type === 'discovery_settings_changed') window.__observedSettingsRevision = event.revision; }); });
      const revision = await second.evaluate(async action => { const s = HaedoLife.Shell.storage, w = await s.getActive(), old = await s.readDiscoverySettings(w), next = action === 'clear' ? HaedoLife.DiscoverySettings.clear(old, { expectedRevision: old.revision }) : HaedoLife.DiscoverySettings.update(old, { autoRefresh: false }, { expectedRevision: old.revision }); const result = await s.saveDiscoverySettings(w, next, old.revision); if (result.status !== 'stored') throw Error('Concurrent stop fixture failed'); return result.settings.revision; }, action);
      await wait(page, revision => window.__observedSettingsRevision >= revision, revision); const count = control.count; await advance(page, 16 * MINUTE); assert.equal(control.count, count);
      await page.evaluate(() => __releaseSettings()); await page.locator('#discoverySettingsReload').waitFor(); await advance(page, 16 * MINUTE); assert.equal(control.count, count);
      await page.locator('#discoverySettingsDiscard').click(); await idle(page); assert.equal((await snapshot(page)).settings.autoRefresh, false); await advance(page, 16 * MINUTE); assert.equal(control.count, count); await preserve(page, before); await second.close();
    });
    await check('turning automatic refresh off aborts pending work even when its preference save fails', async ({ page, control }) => {
      const before = await seed(page); await clock(page); await auto(page, true); control.hold = true; control.value = fixture('late-failed-off'); const arrived = control.next(); await advance(page, 15 * MINUTE + 100); await arrived;
      await page.evaluate(() => { window.__originalAutomationPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { const result = __originalAutomationPut.apply(this, args); if (this.name === 'meta' && args[0]?.key?.startsWith('discoverySettings:')) this.transaction.abort(); return result; }; });
      await options(page); await page.locator('#discoveryAutoRefresh').uncheck(); await page.locator('#discoverySettingsRetry').waitFor(); assert.equal(await page.locator('#discoveryAutoRefresh').isChecked(), false); assert.equal((await snapshot(page)).settings.autoRefresh, true);
      control.release(); await page.waitForTimeout(120); assert.equal(await page.locator('[data-discovery-id^="late-"]').count(), 0); const count = control.count; await advance(page, 16 * MINUTE); assert.equal(control.count, count);
      await page.evaluate(() => { IDBObjectStore.prototype.put = __originalAutomationPut; }); await page.locator('#discoverySettingsRetry').click(); await idle(page); assert.equal((await snapshot(page)).settings.autoRefresh, false); await preserve(page, before);
    });
    await check('automatic catalogue redraw preserves composing text caret and keyboard focus', async ({ page, control }) => {
      const before = await seed(page); await clock(page); await auto(page, true); await page.locator('#discoveryTopicInput').focus();
      await page.locator('#discoveryTopicInput').evaluate((input, term) => { window.__composingInput = input; input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); input.value = term; input.setSelectionRange(3, 7); input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: term, isComposing: true })); }, PRIVATE_TERM);
      const count = control.count; await advance(page, 15 * MINUTE + 100); await idle(page); assert.equal(control.count, count + 1);
      const actual = await page.locator('#discoveryTopicInput').evaluate(input => ({ same: input === window.__composingInput, value: input.value, start: input.selectionStart, end: input.selectionEnd, focused: document.activeElement === input })); assert.deepEqual(actual, { same: true, value: PRIVATE_TERM, start: 3, end: 7, focused: true });
      await page.locator('#discoveryTopicInput').dispatchEvent('compositionend', { data: PRIVATE_TERM }); await page.locator('#discoveryTopicDiscard').click(); await idle(page); await preserve(page, before); assert.deepEqual((await snapshot(page)).profile, before.profile);
    });
    for (const width of [1440, 820, 390]) await check('synthetic Korean controls overflow focus and visual ' + width, async ({ page }) => {
      await seed(page); await options(page); await page.locator('#discoveryTopicInput').fill('아주 긴 한국어 관심 표현을 직접 적고 명시적으로 선택하는 합성 검수 문장');
      await page.locator('#discoveryTopicInput').focus(); const audit = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, focus: document.activeElement?.id, fontSize: getComputedStyle(document.querySelector('#discoveryTopicInput')).fontSize, controls: [...document.querySelectorAll('#discoveryReview button, #discoveryReview input, #discoveryReview summary')].filter(el => el.checkVisibility()).map(el => { const target = el.matches('input[type="checkbox"]') ? el.closest('label') || el : el; const r = target.getBoundingClientRect(); return { name: el.id || el.dataset.discoveryInterest || el.dataset.discoverySource || el.tagName, width: r.width, height: r.height }; }) }));
      assert.ok(audit.documentWidth <= width, 'No horizontal overflow'); assert.equal(audit.focus, 'discoveryTopicInput'); assert.ok(parseFloat(audit.fontSize) >= 16); for (const item of audit.controls) { assert.ok(item.width >= 44 && item.height >= 44, item.name + ' has a 44px hit area'); }
      await page.keyboard.press('Tab'); const next = await page.evaluate(() => ({ id: document.activeElement?.id, visible: document.activeElement?.checkVisibility(), outline: getComputedStyle(document.activeElement).outlineStyle })); assert.equal(next.visible, true); assert.ok(next.id); const file = 'discovery-automation-' + width + '.png'; await page.screenshot({ path: path.join(output, file), fullPage: true }); report.visual.push({ width, file, audit, nextFocus: next });
    }, width);
  } finally {
    await browser.close(); report.productHashesAfter = Object.fromEntries(await Promise.all(products.map(async name => [name, sha(await fs.readFile(path.resolve(__dirname, '../assets/life', name)))]))); report.productsUnchangedDuringRun = JSON.stringify(report.productHashesBefore) === JSON.stringify(report.productHashesAfter); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  assert.deepEqual(report.privacyViolations, []); assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.modelRequests, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.equal(report.productsUnchangedDuringRun, true); assert.ok(report.checks.length > 0); assert.ok(report.checks.every(x => x.pass));
  console.log('Discovery automation: ' + report.checks.length + ' passed; private uploads, model/publisher requests and remote writes 0.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

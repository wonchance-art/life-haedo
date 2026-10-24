/* Startup measurements and progressive-loading regressions. Actual application,
 * bundled SDK and scoped IndexedDB; explicitly synthetic capability-1 HTTP.
 * No production account, real device, or field-performance claim.
 * BASE_URL=http://127.0.0.1:4195 STARTUP_SOURCE_ROOT=<frozen site> node this-file
 */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4196';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sourceRoot = path.resolve(process.env.STARTUP_SOURCE_ROOT || path.join(__dirname, '..'));
const { CompositionCloud } = require(path.join(sourceRoot, 'tests/composition-sync-browser.cjs'));
const { accounts, cloud, base, session } = require(path.join(sourceRoot, 'tests/life-sync-browser.cjs'));
const { playwright, makeContext } = require(path.join(sourceRoot, 'tests/unified-home-browser.cjs'));
const { openRecordsMenu } = require(path.join(sourceRoot, 'tests/helpers/feature-menus.cjs'));
const Core = require(path.join(sourceRoot, 'assets/life/core.js'));
const Workbench = require(path.join(sourceRoot, 'assets/life/workbench.js'));
const Metadata = require(path.join(sourceRoot, 'assets/life/library-meta.js'));
const output = path.resolve(process.env.STARTUP_OUTPUT || '.local/startup-performance-browser');
const latency = Number(process.env.STARTUP_HTTP_LATENCY || 100);
const samples = Number(process.env.STARTUP_SAMPLES || 3);
const primaryCount = Number(process.env.STARTUP_SOURCE_COUNT || 200);
const progressive = process.env.STARTUP_EXPECT_PROGRESSIVE === '1';
const regressionOnly = process.env.STARTUP_REGRESSION_ONLY === '1';
const only = process.env.STARTUP_MATCH ? new RegExp(process.env.STARTUP_MATCH) : null;
const sha = value => createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'];
const report = { createdAt: new Date().toISOString(), scope: 'Frozen or current app bytes, real bundled SDK and scoped IDB; anonymous capability-1 private HTTP with fixed per-request latency; static loopback responses are not delayed. Playwright routing disables HTTP cache; warm means retained account data, not warm static HTTP cache. Synthetic lab timings, not production/physical-device/Core-Web-Vitals field measurements. CompositionEvent cases simulate input only; no application modules or state machines are replaced.', sourceRoot, base, latency, samples, primaryCount, progressive, checks: [], measurements: [], snapshots: [], consoleErrors: [], expectedConsoleErrors: [], pageErrors: [], external: [], staticErrors: [], staticResponses: [], privateRequests: [], closedContexts: 0, browserClosed: false };
async function wait(read, condition, label, timeout = 20000) { const deadline = Date.now() + timeout; let value; do { value = await read(); if (condition(value)) return value; await sleep(25); } while (Date.now() < deadline); throw Error(label + ' did not finish: ' + JSON.stringify(value)); }
async function dataset() {
  const rows = [];
  for (let w = 0; w < ids.length; w++) {
    let bundle = Core.createWorkspace({ workspaceId: ids[w], title: '익명 성능 자료공간 ' + (w + 1) });
    const count = w === 0 ? primaryCount : 20;
    for (let n = 0; n < count; n++) {
      const text = '\ufeff# 익명 자료 ' + w + ':' + n + '\r\n\r\n' + ('언어 학습과 읽기, 정확한 원문 보존을 확인합니다. 🌱 Cafe\u0301\r\n').repeat(8) + '고유찾기' + String(n).padStart(3, '0');
      const prepared = await Core.prepareImport({ origin: 'obsidian', title: '익명 언어 읽기 ' + String(n).padStart(3, '0'), text, authorRelation: 'self', forceSeparate: true }, bundle);
      bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, prepared));
    }
    Core.validateWorkspace(bundle); rows.push(bundle);
  }
  return rows;
}
function seedCloud(bundles) {
  const server = new CompositionCloud().enableAccountLibrary();
  for (const bundle of bundles) {
    const id = bundle.workspaceId, key = server.key(accounts.a.id, id);
    server.rows.set(key, { owner_id: accounts.a.id, id, title: bundle.title, revision: 1, data: copy(bundle), updated_at: bundle.updatedAt });
    server.compositions.set(key, { workspace_id: id, revision: 1, source_revision: 1, data: Workbench.empty(id), updated_at: bundle.updatedAt });
    server.libraryMetadata.set(key, { workspace_id: id, revision: 1, source_revision: 1, data: Metadata.empty(id), updated_at: bundle.updatedAt });
  }
  server.libraryDefaults.set(accounts.a.id, { workspaceId: ids[0], defaultRevision: 1, initialHash: null, initialRevision: null });
  return server;
}
async function hashes() {
  const files = ['index.html', 'life.html', 'sw.js', 'assets/platform-auth.js', 'assets/life/shell.js', 'assets/life/account-library.js', 'assets/life/sync.js', 'assets/life/storage.js', 'assets/life/ui.js', 'assets/life/ui.css', 'assets/life/source-folders-ui.js', 'assets/life/core.js'];
  return Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await fs.readFile(path.join(sourceRoot, file)))])));
}
async function main() {
  assert(Number.isInteger(latency) && latency >= 0 && latency <= 1000); assert(Number.isInteger(samples) && samples >= 1 && samples <= 5);
  await assert.rejects(fs.access(output), 'Fresh evidence directory required'); await fs.mkdir(output, { recursive: true });
  report.sourcesBefore = await hashes(); report.runnerSHA256 = sha(await fs.readFile(__filename));
  const datasetPath = process.env.STARTUP_DATASET_FILE ? path.resolve(process.env.STARTUP_DATASET_FILE) : null; let bundles;
  if (datasetPath) { try { bundles = JSON.parse(await fs.readFile(datasetPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; bundles = await dataset(); await fs.writeFile(datasetPath, JSON.stringify(bundles) + '\n', { flag: 'wx' }); } } else bundles = await dataset();
  bundles.forEach(Core.validateWorkspace); assert.equal(bundles[0].sources.length, primaryCount); report.datasetPath = datasetPath;
  report.dataset = bundles.map(bundle => ({ id: bundle.workspaceId, sources: bundle.sources.length, sourceVersions: bundle.sourceVersions.length, bytes: Buffer.byteLength(JSON.stringify(bundle)), sha256: sha(JSON.stringify(bundle)) }));
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] }); report.browser = browser.version();
  let deviceCounter = 0;
  async function device(server, label) {
    const name = label + '-' + (++deviceCounter), context = await makeContext(browser, server, name, accounts.a, { viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const pending = new Set(), controls = { hold: null, fail: null, expectedFailure: false }, requests = [], responses = [];
    await context.addInitScript(() => {
      window.__startupMeasure = { firstUsable: null, privateBeforeVerification: [], longTasks: [], longTaskSupported: PerformanceObserver.supportedEntryTypes.includes('longtask'), paint: [] };
      try { new PerformanceObserver(list => { for (const e of list.getEntries()) __startupMeasure.longTasks.push({ startTime: e.startTime, duration: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch (_) { __startupMeasure.longTaskSupported = false; }
      try { new PerformanceObserver(list => { for (const e of list.getEntries()) __startupMeasure.paint.push({ name: e.name, startTime: e.startTime }); }).observe({ type: 'paint', buffered: true }); } catch (_) {}
      let queued = false;
      const scan = () => { queued = false; const app = document.querySelector('#lifeApp'); if (!app || app.hidden) return;
        const cards = app.querySelectorAll('.life-source-open'); if (cards.length && !globalThis.HaedoAuth?.user) __startupMeasure.privateBeforeVerification.push(performance.now());
        if (__startupMeasure.firstUsable === null && globalThis.HaedoAuth?.user && cards.length && !app.matches('[aria-busy="true"]') && document.querySelector('#lifeSearch')) __startupMeasure.firstUsable = performance.now();
      };
      new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(scan); } }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'aria-busy'] });
    });
    context.on('request', request => { const u = new URL(request.url()); if (u.origin === cloud) { const row = { path: u.pathname, query: u.search, method: request.method(), start: Date.now(), done: null }; requests.push(row); request.__startupRow = row; request.__startupTerminal = deferred(); } });
    context.on('requestfinished', request => { if (request.__startupRow) { request.__startupRow.done = Date.now(); request.__startupRow.outcome = 'finished'; request.__startupTerminal.resolve('finished'); } });
    context.on('requestfailed', request => { if (request.__startupRow) { request.__startupRow.done = Date.now(); request.__startupRow.outcome = 'failed'; request.__startupRow.failure = request.failure()?.errorText || null; request.__startupTerminal.resolve('failed'); } });
    await context.route(cloud + '/**', async route => { const request = route.request(), u = new URL(request.url()); if (request.method() === 'OPTIONS') return route.fallback(); const control = controls.hold;
      const held = control?.matches(request, u) ? control : null;
      if (held) { held.requests.push(request); held.entered.resolve(); await held.release.promise; }
      try { if (controls.fail?.matches(request, u)) return await route.abort('internetdisconnected');
        await sleep(latency); return await route.fallback();
      } finally { held?.delivered.resolve(); }
    });
    await context.route('**/*', route => { const u = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(u.origin)) return route.fallback(); report.external.push({ name, path: u.origin + u.pathname }); return route.abort('blockedbyclient'); });
    context.on('response', response => { const u = new URL(response.url()); if (u.origin !== new URL(base).origin || !/\.(?:html|js|css|woff2?|json|svg)$/.test(u.pathname) && !u.pathname.endsWith('/')) return;
      const task = (async () => { const bytes = await response.body(); const file = u.pathname.replace(/^\//, '') || 'index.html'; const item = { device: name, file, status: response.status(), bytes: bytes.length, sha256: sha(bytes), configFixture: file === 'assets/platform-config.js' };
        if (!item.configFixture) { const expected = await fs.readFile(path.join(sourceRoot, file)); assert.equal(item.sha256, sha(expected), file + ': actual static response matches measured source'); }
        responses.push(item); report.staticResponses.push(item);
      })(); pending.add(task); task.catch(error => report.staticErrors.push({ device: name, path: u.pathname, message: error.message })).finally(() => pending.delete(task));
    });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => report.pageErrors.push({ name, message: error.message }));
    page.on('console', event => { if (event.type() !== 'error') return; const row = { name, message: event.text(), path: event.location().url }; const expected = controls.expectedFailure && row.path.startsWith(cloud) && /^Failed to load resource:/.test(row.message) && /net::ERR_(FAILED|INTERNET_DISCONNECTED|ABORTED)/.test(row.message); (expected ? report.expectedConsoleErrors : report.consoleErrors).push(row); });
    const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable');
    const value = { name, context, page, cdp, controls, requests, responses, async close() { controls.hold?.release.resolve(); try { await Promise.allSettled([...pending]); } finally { await context.close(); report.closedContexts++; } } };
    return value;
  }
  async function open(d, warm, label) {
    const start = Date.now(), requestStart = d.requests.length, responseStart = d.responses.length;
    if (warm) await d.page.reload({ waitUntil: 'domcontentloaded' }); else await d.page.goto(base + '/index.html?section=records&view=sources', { waitUntil: 'domcontentloaded' });
    await d.page.waitForFunction(() => window.__startupMeasure?.firstUsable !== null && window.__startupMeasure?.firstUsable !== undefined);
    const visibleAt = Date.now(), observed = await d.page.evaluate(() => ({ ...__startupMeasure, dbOpens: __homeDbOpens, sourceCount: document.querySelectorAll('.life-source-open').length, active: HaedoAuth.user.id }));
    assert.deepEqual(observed.privateBeforeVerification, []); assert(observed.dbOpens.every(item => item.verified)); assert.equal(observed.active, accounts.a.id);
    const beforeSearch = await d.page.evaluate(() => performance.now()), query = '고유찾기' + String(primaryCount - 1).padStart(3, '0'); await d.page.locator('#lifeSearch').fill(query);
    await d.page.waitForFunction(query => document.querySelector('#lifeSearch')?.value === query && document.querySelectorAll('.life-source-open').length === 1, query);
    const searchMs = await d.page.evaluate(before => performance.now() - before, beforeSearch); await d.page.locator('#lifeSearch').fill('');
    await d.page.waitForFunction(() => document.querySelectorAll('.life-source-open').length >= 40);
    const metrics = (await d.cdp.send('Performance.getMetrics')).metrics;
    await fullySynced(d.page);
    const completedAt = Date.now(), exact = await d.page.evaluate(async id => { const s = HaedoLife.Shell.storage, b = await s.read(id); return { id: await s.getActive(), count: b.sources.length, versions: b.sourceVersions.map(v => ({ id: v.id, hash: v.contentHash, text: v.contentText })) }; }, ids[0]);
    assert.equal(exact.id, ids[0]); assert.equal(exact.count, primaryCount); assert.deepEqual(exact.versions, bundles[0].sourceVersions.map(v => ({ id: v.id, hash: v.contentHash, text: v.contentText })));
    const row = { label, warm, navigationToVisibleMs: visibleAt - start, firstUsableMs: observed.firstUsable, syncCompleteMs: completedAt - start, searchMs, sourceCount: observed.sourceCount, paints: observed.paint, longTasks: observed.longTasks, longTaskSupported: observed.longTaskSupported, beforeVisibleRequests: d.requests.slice(requestStart).filter(r => r.start <= visibleAt).map(r => ({ ...r, start: r.start - start, done: r.done === null ? null : r.done - start })), requests: d.requests.slice(requestStart).map(r => ({ ...r, start: r.start - start, done: r.done === null ? null : r.done - start })), staticResponses: d.responses.length - responseStart, metrics: Object.fromEntries(metrics.filter(r => ['ScriptDuration', 'TaskDuration', 'LayoutDuration', 'RecalcStyleDuration', 'JSHeapUsedSize', 'Nodes'].includes(r.name)).map(r => [r.name, r.value])), exactGraph: true };
    report.measurements.push(row); console.log(JSON.stringify({ label, firstUsableMs: row.firstUsableMs, syncCompleteMs: row.syncCompleteMs, searchMs: row.searchMs })); return row;
  }
  async function fullySynced(page) { return wait(() => page.evaluate(async ids => { const h = HaedoLife.Shell; if (!h?.accountLibrary || !h.storage) return []; return Promise.all(ids.map(id => h.accountLibrary.getState(id))); }, ids), rows => rows.length === ids.length && rows.every(r => r.mode === 'account' && r.status === 'synced'), 'All synthetic workspaces acknowledged'); }
  const gate = matches => ({ matches, entered: deferred(), release: deferred(), delivered: deferred(), requests: [] });
  const catalogGate = () => gate((_request, url) => url.pathname === '/rest/v1/rpc/life_library_catalog');
  async function entered(value, label) { let timer; try { await Promise.race([value.entered.promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(Error(label + ' request was not reached')), 20000); })]); } finally { clearTimeout(timer); } }
  async function terminal(value) { let timer; try { return await Promise.race([Promise.all(value.requests.map(request => request.__startupTerminal.promise)), new Promise((_resolve, reject) => { timer = setTimeout(() => reject(Error('Held request did not reach a browser terminal outcome')), 20000); })]); } finally { clearTimeout(timer); } }
  const usable = page => page.waitForFunction(() => window.__startupMeasure?.firstUsable !== null && window.__startupMeasure?.firstUsable !== undefined);
  const load = async d => { await d.page.goto(base + '/index.html?section=records&view=sources', { waitUntil: 'domcontentloaded' }); await usable(d.page); await fullySynced(d.page); };
  const primary = page => page.evaluate(async id => HaedoLife.Shell.storage.read(id), ids[0]);
  async function remoteVersion(server, suffix) {
    const row = server.row(accounts.a.id, ids[0]), before = copy(row.data), source = before.sources[0], previous = before.sourceVersions.filter(v => v.sourceId === source.id).at(-1);
    const prepared = await Core.prepareImport({ origin: source.origin, title: source.title, existingSourceId: source.id, text: previous.contentText + '\r\n' + suffix, authorRelation: 'self' }, before, { forceNewVersion: true });
    row.data = Core.applyChanges(before, Core.buildImportChanges(before, prepared)); row.revision++; row.updated_at = new Date().toISOString();
    return { source, previous, next: prepared.version, expected: copy(row.data) };
  }
  async function check(name, run) { if (only && !only.test(name)) return; console.log('RUN ' + name); try { await run(); report.checks.push({ name, pass: true }); console.log('PASS ' + name); } catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); } }
  try {
    if (!regressionOnly) await check('cold and warm startup with three exact account workspaces and whole-source search', async () => {
      for (let n = 0; n < samples; n++) {
        const server = seedCloud(bundles), d = await device(server, 'measure-' + n);
        try { await open(d, false, 'cold-' + n); await open(d, true, 'warm-' + n); assert.deepEqual(server.libraryRouteErrors, []); report.privateRequests.push({ name: d.name, requests: copy(server.requests), libraryRequests: copy(server.libraryRequests) }); if (n === 0) { await d.page.screenshot({ path: path.join(output, 'records-1440.png'), fullPage: false }); await d.page.setViewportSize({ width: 390, height: 844 }); await d.page.screenshot({ path: path.join(output, 'records-390.png'), fullPage: false }); } }
        finally { await d.close(); }
      }
    });
    if (progressive) {
      await check('cold shared originals can be opened and closed while the background catalog is held', async () => {
        const server = seedCloud(bundles), d = await device(server, 'foreground-originals');
        try {
          const refresh = catalogGate(); d.controls.hold = refresh;
          await d.page.goto(base + '/index.html?section=records&view=sources', { waitUntil: 'domcontentloaded' }); await entered(refresh, 'Held account catalog'); await usable(d.page);
          const before = await primary(d.page);
          const initial = await d.page.evaluate(() => { window.__startupSharedOriginals = HaedoLife.Shell.originals; return __startupSharedOriginals?.getState() || null; });
          assert(initial, 'Foreground shell must own the shared originals service before opening its UI');
          assert.equal(initial.mode, 'local', 'Constructing the shared service must not start remote originals work');
          assert.equal(d.requests.filter(row => row.path === '/rest/v1/rpc/life_library_originals_list').length, 0);
          for (let opened = 0; opened < 2; opened++) {
            await openRecordsMenu(d.page); await d.page.locator('#lifeOriginalAttachmentsOpen').click(); await d.page.locator('#lifeOriginalAttachments').waitFor();
            await d.page.locator('#originalAttachmentsCopies').getByRole('heading', { name: '이 계정의 원본 사본', exact: true }).waitFor();
            assert.deepEqual(await d.page.evaluate(() => ({ same: HaedoLife.Shell.originals === __startupSharedOriginals, mode: __startupSharedOriginals.getState().mode, error: __startupSharedOriginals.getState().error, uiErrorHidden: document.querySelector('#originalAttachmentsError').hidden })), { same: true, mode: 'account', error: null, uiErrorHidden: true });
            await d.page.locator('#lifeOriginalAttachments').getByRole('button', { name: '닫기', exact: true }).click(); await d.page.locator('#lifeOriginalAttachments').waitFor({ state: 'detached' });
            assert.equal(await d.page.evaluate(() => HaedoLife.Shell.originals === __startupSharedOriginals), true, 'Closing originals UI must retain the shell-owned service');
          }
          assert(d.requests.some(row => row.path === '/rest/v1/rpc/life_library_originals_list' && row.outcome === 'finished'), 'Explicit UI list must complete through the real shared service');
          assert(refresh.requests.length > 0 && refresh.requests.every(request => request.__startupRow.done === null), 'Main catalog stays held throughout open, close and reopen');
          assert.deepEqual(await primary(d.page), before);
          refresh.release.resolve(); d.controls.hold = null; await fullySynced(d.page);
          assert.equal(await d.page.evaluate(() => HaedoLife.Shell.originals === __startupSharedOriginals), true, 'Background completion must keep the same service');
          report.snapshots.push({ name: 'foreground-originals', sharedBeforeOpen: true, noRemoteOriginalsBeforeExplicitOpen: true, explicitUIListUsedSharedService: true, closeAndReopenRetainedService: true, catalogHeldThroughReopen: true, exactSourcesPreserved: true });
        } finally { await d.close(); }
      });
      await check('cached data remains private until verified and usable while refresh is held; incoming data preserves composing search', async () => {
        const server = seedCloud(bundles), d = await device(server, 'cached-refresh');
        try {
          await load(d); const changed = await remoteVersion(server, '다른 기기의 새 판');
          const auth = gate((_request, url) => url.pathname === '/auth/v1/user'); d.controls.hold = auth;
          await d.page.reload({ waitUntil: 'domcontentloaded' }); await entered(auth, 'Held Auth');
          const hidden = await d.page.evaluate(() => ({ hidden: document.querySelector('#lifeApp')?.hidden, dbOpens: __homeDbOpens, privateTextVisible: !document.querySelector('#lifeApp')?.hidden && document.body.textContent.includes('익명 언어 읽기') }));
          assert.equal(hidden.hidden, true); assert.equal(hidden.privateTextVisible, false); assert.deepEqual(hidden.dbOpens, []);
          const refresh = catalogGate(); d.controls.hold = refresh; auth.release.resolve(); await entered(refresh, 'Held account catalog'); await usable(d.page);
          assert.equal((await primary(d.page)).sourceVersions.length, primaryCount, 'Old exact cache is visible before refresh completes');
          assert.notEqual(await d.page.locator('#lifeAccountStorage').getAttribute('data-state'), 'synced', 'Held refresh cannot be reported as complete');
          await d.page.locator('#lifeSearch').focus();
          const text = '고유찾기' + String(primaryCount - 1).padStart(3, '0');
          await d.page.locator('#lifeSearch').evaluate((el, text) => { window.__startupInput = el; el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); el.value = text; el.setSelectionRange(2, 5); el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: text })); }, text);
          refresh.release.resolve(); d.controls.hold = null;
          await wait(() => primary(d.page), b => b.sourceVersions.some(v => v.id === changed.next.id), 'Incoming exact source version');
          await d.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          assert.deepEqual(await d.page.locator('#lifeSearch').evaluate(el => ({ same: el === __startupInput, value: el.value, start: el.selectionStart, end: el.selectionEnd, focus: el === document.activeElement })), { same: true, value: text, start: 2, end: 5, focus: true });
          await d.page.locator('#lifeSearch').dispatchEvent('compositionend', { data: text });
          await fullySynced(d.page); const after = await primary(d.page); assert.deepEqual(after.sourceVersions, changed.expected.sourceVersions);
          assert.deepEqual(await d.page.evaluate(() => __startupMeasure.privateBeforeVerification), []);
          report.snapshots.push({ name: 'cached-refresh', hidden, incomingVersionRetained: true, composingSearchPreserved: true });
        } finally { await d.close(); }
      });
      await check('cold primary is readable before secondary download and old account responses cannot enter the next account', async () => {
        const server = seedCloud(bundles), d = await device(server, 'cold-priority');
        try {
          const secondary = gate((_request, url) => url.pathname === '/rest/v1/life_workspaces' && url.searchParams.get('id') === 'eq.' + ids[1] && url.searchParams.get('select')?.split(',').includes('data'));
          d.controls.hold = secondary; await d.page.goto(base + '/index.html?section=records&view=sources', { waitUntil: 'domcontentloaded' }); await entered(secondary, 'Held secondary workspace'); await usable(d.page);
          assert.equal((await primary(d.page)).sources.length, primaryCount);
          const spaces = await d.page.evaluate(() => HaedoLife.Shell.storage.listWorkspaces()); assert(!spaces.some(row => row.workspaceId === ids[1]), 'Held secondary has not been installed');
          await d.page.locator('[data-haedo-navigation] [data-haedo-section="manage"]').click(); await d.page.locator('#lifeCurrentWorkspace').click(); await d.page.locator('#lifeWorkspace').focus();
          await d.page.locator('#lifeWorkspace').evaluate(el => { window.__startupWorkspaceSelect = el; });
          assert.equal(await d.page.locator('#lifeWorkspace').inputValue(), ids[0]);
          assert(!await d.page.locator('#lifeWorkspace option').evaluateAll((options, id) => options.some(option => option.value === id), ids[1]));
          secondary.release.resolve(); d.controls.hold = null; await fullySynced(d.page);
          assert.deepEqual(await d.page.locator('#lifeWorkspace').evaluate(el => ({ same: el === __startupWorkspaceSelect, value: el.value, focus: el === document.activeElement })), { same: true, value: ids[0], focus: true });
          assert(!await d.page.locator('#lifeWorkspace option').evaluateAll((options, id) => options.some(option => option.value === id), ids[1]), 'Focused native select options are not replaced during remote receive');
          await d.page.keyboard.press('Tab');
          await d.page.waitForFunction(ids => ids.every(id => [...document.querySelectorAll('#lifeWorkspace option')].some(option => option.value === id)), ids);
          assert.deepEqual(await d.page.locator('#lifeWorkspace').evaluate(el => ({ same: el === __startupWorkspaceSelect, value: el.value })), { same: true, value: ids[0] });
          assert.equal(await d.page.evaluate(() => HaedoLife.Shell.storage.getActive()), ids[0], 'Background secondary receive cannot change active workspace');
          await remoteVersion(server, '계정 전환 뒤 도착하면 안 되는 새 판');
          const oldAccount = gate((_request, url) => url.pathname === '/rest/v1/life_workspaces' && url.searchParams.get('id') === 'eq.' + ids[0] && url.searchParams.get('select')?.split(',').includes('data'));
          d.controls.hold = oldAccount; await d.page.evaluate(() => window.dispatchEvent(new Event('focus'))); await entered(oldAccount, 'Old account authoritative read');
          await d.page.evaluate(() => { window.__startupOldStorage = HaedoLife.Shell.storage; }); d.controls.expectedFailure = true;
          await d.page.evaluate(async value => { await HaedoAuth.client.auth.setSession(value); await HaedoAuth.verify(); }, session(accounts.b));
          await wait(() => d.page.evaluate(async owner => { const h = HaedoLife.Shell, s = h?.storage; if (HaedoAuth.user?.id !== owner || s?.account?.userId !== owner || document.querySelector('#lifeApp')?.hidden !== false) return null; const id = await s.getActive(); return id && h.storage === s ? { id, sources: (await s.read(id)).sources.length } : null; }, accounts.b.id), value => value && value.sources === 0, 'Verified B workspace');
          oldAccount.release.resolve(); d.controls.hold = null; const terminalOutcomes = await terminal(oldAccount); await d.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          assert(!await d.page.locator('body').innerText().then(text => text.includes('익명 언어 읽기') || text.includes('익명 성능 자료공간')));
          assert.equal(await d.page.evaluate(async id => { try { await __startupOldStorage.read(id); return null; } catch (error) { return error.code; } }, ids[0]), 'storage_scope_closed');
          const current = await d.page.evaluate(async () => { const s = HaedoLife.Shell.storage; return { owner: s.account.userId, spaces: await s.listWorkspaces() }; }); assert.equal(current.owner, accounts.b.id); assert(current.spaces.every(row => !ids.includes(row.workspaceId)));
          report.snapshots.push({ name: 'cold-priority', primaryBeforeSecondary: true, secondaryNotInstalledBeforeRelease: true, secondaryOptionsArrivedWithoutChangingSelectionOrFocus: true, staleAccountResponseRejected: true, oldAccountBrowserTerminalOutcomes: terminalOutcomes });
        } finally { await d.close(); }
      });
      await check('cached exact old version remains readable when a newer version arrives in background', async () => {
        const server = seedCloud(bundles), d = await device(server, 'exact-reader');
        try {
          await load(d); const changed = await remoteVersion(server, '새 판만 가지는 문장'); const refresh = catalogGate(); d.controls.hold = refresh;
          await d.page.reload({ waitUntil: 'domcontentloaded' }); await entered(refresh, 'Held account catalog'); await usable(d.page);
          await d.page.locator('#lifeSearch').fill('고유찾기000'); await d.page.locator('.life-source-open[data-version-id="' + changed.previous.id + '"]').click();
          await d.page.locator('#lifeSourceText').waitFor(); const raw = d.page.locator('#lifeExcerptToggle'); if (await raw.count()) await raw.click();
          await d.page.waitForFunction(() => document.querySelector('#lifeSourceText')?.dataset.readingMode === 'raw');
          const before = await d.page.locator('#lifeSourceText').textContent(); assert.equal(before, changed.previous.contentText);
          refresh.release.resolve(); d.controls.hold = null; await wait(() => primary(d.page), b => b.sourceVersions.some(v => v.id === changed.next.id), 'New version behind exact reader'); await fullySynced(d.page);
          assert.equal(await d.page.locator('#lifeSourceText').textContent(), changed.previous.contentText, 'Historical exact reader must not jump to latest');
          assert.deepEqual((await primary(d.page)).sourceVersions, changed.expected.sourceVersions);
          report.snapshots.push({ name: 'exact-reader', olderBodyExact: true, newerVersionPreserved: true });
        } finally { await d.close(); }
      });
      await check('cached material survives failed background refresh and explicit retry completes account state', async () => {
        const server = seedCloud(bundles), d = await device(server, 'refresh-retry');
        try {
          await load(d); const before = await primary(d.page); d.controls.expectedFailure = true; d.controls.fail = { matches: (_request, url) => url.pathname === '/rest/v1/rpc/life_library_catalog' };
          await d.page.reload({ waitUntil: 'domcontentloaded' }); await usable(d.page);
          await d.page.locator('#lifeAccountStorage[data-state="error"]').waitFor(); assert.deepEqual(await primary(d.page), before);
          await d.page.locator('#lifeSearch').fill('고유찾기000'); await d.page.waitForFunction(() => document.querySelectorAll('.life-source-open').length === 1);
          d.controls.fail = null; await d.page.locator('#lifeAccountStorageRetry').click(); await fullySynced(d.page);
          assert.deepEqual(await primary(d.page), before); assert.equal(await d.page.locator('#lifeSearch').inputValue(), '고유찾기000');
          report.snapshots.push({ name: 'refresh-retry', exactCachePreserved: true, explicitRetrySynced: true, searchPreserved: true });
        } finally { await d.close(); }
      });
    }
  } finally {
    await browser.close(); report.browserClosed = true; report.sourcesAfter = await hashes(); report.sourcesUnchanged = JSON.stringify(report.sourcesBefore) === JSON.stringify(report.sourcesAfter); report.runnerSHA256After = sha(await fs.readFile(__filename)); report.runnerUnchanged = report.runnerSHA256After === report.runnerSHA256;
    const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)]; report.summary = {};
    for (const warm of [false, true]) { const rows = report.measurements.filter(row => row.warm === warm); if (rows.length) report.summary[warm ? 'warm' : 'cold'] = { n: rows.length, firstUsableMsMedian: median(rows.map(row => row.firstUsableMs)), syncCompleteMsMedian: median(rows.map(row => row.syncCompleteMs)), searchMsMedian: median(rows.map(row => row.searchMs)), authBeforeVisibleMedian: median(rows.map(row => row.beforeVisibleRequests.filter(r => r.path === '/auth/v1/user').length)) }; }
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  assert(report.sourcesUnchanged); assert(report.runnerUnchanged); for (const key of ['consoleErrors', 'pageErrors', 'external', 'staticErrors']) assert.deepEqual(report[key], [], key); assert(report.checks.length && report.checks.every(c => c.pass)); console.log(JSON.stringify({ checks: report.checks.length, summary: report.summary, closedContexts: report.closedContexts, browserClosed: report.browserClosed }));
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

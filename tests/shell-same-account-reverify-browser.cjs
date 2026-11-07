/* C2: real shell, bundled SDK, HTTP Auth fixture and account-scoped IndexedDB.
 * A one-read gate lets BlogSync's real Auth request start before a deliberately
 * damaged fixture fails validation. The original read/validator still runs.
 * No real account, publisher, deployment, physical IME or operating DB claim.
 * Starts its own local server. SHELL_REVERIFY_SHELL_OVERRIDE serves an isolated
 * baseline/mutation file without changing the application source tree. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const project = path.resolve(__dirname, '..');
const output = path.resolve(process.env.SHELL_REVERIFY_OUTPUT || '.local/shell-same-account-reverify/current');
const override = process.env.SHELL_REVERIFY_SHELL_OVERRIDE && path.resolve(process.env.SHELL_REVERIFY_SHELL_OVERRIDE);
const uiOverride = process.env.SHELL_REVERIFY_UI_OVERRIDE && path.resolve(process.env.SHELL_REVERIFY_UI_OVERRIDE);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { scope: 'Actual shell/UI/SDK/IndexedDB; synthetic account A/B and HTTP only. The startup failure uses one deferred original storage.read through UI.mount; no validator or Auth implementation is replaced. IME and page lifecycle are event simulations.', checks: [], pageErrors: [], consoleErrors: [], external: [], closedContexts: 0 };
let site;
const mountProbe = `
/* C2 test-only observation and one-read scheduling boundary. */
window.__c2OwnedEngines = [];
for (const name of ['DiscoveryUI', 'DiscoveryPrivateRemote']) {
  const original = HaedoLife[name];
  if (original?.create) HaedoLife[name] = { ...original, create(...args) {
    const api = original.create(...args), record = { name, disposeCalls: 0 }; __c2OwnedEngines.push(record);
    return { ...api, dispose(...values) { record.disposeCalls++; return api.dispose(...values); } };
  } };
}
{ const original = HaedoLife.BlogSync;
  window.__c2BlogEngines = [];
  HaedoLife.BlogSync = { ...original, create(options) {
    const record = { timers: new Set(), listeners: [], disposeCalls: 0 };
    __c2BlogEngines.push(record);
    const timers = {
      setTimeout(handler, delay, ...args) { const id = window.setTimeout(() => { record.timers.delete(id); handler(...args); }, delay); record.timers.add(id); return id; },
      clearTimeout(id) { record.timers.delete(id); window.clearTimeout(id); }
    };
    const target = host => ({
      addEventListener(type, handler, options) { record.listeners.push({ host, type, handler }); host.addEventListener(type, handler, options); },
      removeEventListener(type, handler, options) { record.listeners = record.listeners.filter(item => item.host !== host || item.type !== type || item.handler !== handler); host.removeEventListener(type, handler, options); }
    });
    const events = { ...target(window), document: { ...target(document), get visibilityState() { return document.visibilityState; } } };
    const api = original.create({ ...options, timers, events });
    record.api = api;
    return { ...api, dispose() { record.disposeCalls++; return api.dispose(); } };
  } };
}
{ const original = HaedoLife.UI;
  HaedoLife.UI = { ...original, mount(container, options) {
    window.__c2Mounts = (window.__c2Mounts || 0) + 1;
    window.__c2LastMountOptions = options;
    const gate = window.__c2ReadGate;
    if (!gate || gate.used) return original.mount(container, options);
    const storage = { ...options.storage, async read(workspaceId) {
      if (!gate.used && workspaceId === gate.workspaceId) {
        gate.used = true; gate.entered = true; await gate.promise;
      }
      const value = await options.storage.read(workspaceId);
      if (gate.failureCode && !gate.failed) { gate.failed = true; throw Object.assign(new Error('Synthetic one-time storage failure'), { code: gate.failureCode }); }
      return value;
    } };
    return original.mount(container, { ...options, storage });
  } };
}
`;
const mime = { '.js': 'application/javascript', '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer(async (request, response) => {
  try {
    const name = new URL(request.url, 'http://fixture.invalid').pathname.slice(1) || 'index.html';
    const file = path.resolve(site, name); if (!file.startsWith(site + path.sep)) throw Error('Outside fixture');
    let bytes = await fs.readFile(override && name === 'assets/life/shell.js' ? override : uiOverride && name === 'assets/life/ui.js' ? uiOverride : file);
    if (name === 'assets/life/ui.js') bytes = Buffer.concat([bytes, Buffer.from(mountProbe)]);
    response.writeHead(200, { 'content-type': mime[path.extname(name)] || 'application/octet-stream', 'cache-control': 'no-store' }); response.end(bytes);
  } catch (_) { response.writeHead(404); response.end(); }
});
const firstBody = '\ufeff합성 계정 A의 이전 원문 🌱\r\n읽던 정확한 판을 유지합니다.';
const newerBody = '합성 계정 A의 최신 원문. 이전 판과 다릅니다.';
async function main() {
  await fs.mkdir(output, { recursive: true });
  report.headSHA = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim();
  report.regressionBase = '5811afded921b888a85034af1d93a65160310900'; report.createdAt = new Date().toISOString();
  report.runnerSHA256 = digest(await fs.readFile(__filename));
  report.originalShellSHA256 = digest(await fs.readFile(path.join(project, 'assets/life/shell.js')));
  report.servedShellSHA256 = digest(await fs.readFile(override || path.join(project, 'assets/life/shell.js')));
  report.override = override ? path.relative(project, override) : null; report.mountProbeSHA256 = digest(mountProbe);
  report.uiOverride = uiOverride ? path.relative(project, uiOverride) : null;
  report.servedUISHA256 = digest(await fs.readFile(uiOverride || path.join(project, 'assets/life/ui.js')));
  report.recoveryRows = {
    'initial-auth-offline': 'recovery after first auth network failure uses the next real verify without clicking retry',
    'initial-bootstrap-offline': 'recovery after first bootstrap network failure uses the next real verify without clicking retry',
    'mounted-real-auth-failure': 'recovery from mounted real Auth failure preserves the current view',
    'mounted-direct-auth-unavailable': 'recovery after an artificial auth-unavailable boundary remounts the same account',
    'retained-healthy-resume': 'same-account verification and retained resume preserve unsaved Korean composition',
    'retained-offline-resume-then-verify': 'recovery from retained offline resume requires explicit retry and keeps its DOM'
  };
  site = path.join(output, 'prepared-site');
  execFileSync(process.execPath, ['scripts/prepare-site.mjs', site], { cwd: project, env: { ...process.env, HAEDO_SUPABASE_URL: 'https://life-sync-test.supabase.co', HAEDO_SUPABASE_KEY: 'sb_publishable_anonymous_browser_test_only' } });
  report.preparedSHA256 = {};
  for (const name of ['assets/life/shell.js', 'assets/life/ui.js', 'assets/platform-auth.js', 'index.html', 'sw.js']) {
    const bytes = await fs.readFile(path.join(site, name)); assert.deepEqual(bytes, await fs.readFile(path.join(project, name)));
    report.preparedSHA256[name] = digest(bytes);
  }
  report.servedUIWithProbeSHA256 = digest(Buffer.concat([await fs.readFile(uiOverride || path.join(site, 'assets/life/ui.js')), Buffer.from(mountProbe)]));
  report.cache = (await fs.readFile(path.join(site, 'sw.js'), 'utf8')).match(/const CACHE\s*=\s*['"]([^'"]+)/)[1];
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.BASE_URL = 'http://127.0.0.1:' + server.address().port; report.localServer = process.env.BASE_URL;
  const { FakeCloud, accounts, session, cloud, base } = require('./life-sync-browser.cjs');
  const { playwright, makeContext, ready, nav, settle } = require('./unified-home-browser.cjs');
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function arrived(hold) {
    let timer; try { return await Promise.race([hold.entered, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Expected real Auth HTTP request did not reach the gate')), 15000); })]); }
    finally { clearTimeout(timer); }
  }
  async function seed(page) {
    return page.evaluate(async ({ firstBody, newerBody }) => {
      const storage = HaedoLife.Shell.storage, core = HaedoLife.Core;
      let bundle = await storage.read(await storage.getActive());
      const put = async input => {
        const prepared = await core.prepareImport(input, bundle);
        const result = await storage.commitLocal({ workspaceId: bundle.workspaceId, baseRevision: bundle.revision, operationId: core.id(), changes: core.buildImportChanges(bundle, prepared) });
        if (result.status !== 'stored') throw Error('Synthetic source was not stored');
        bundle = await storage.read(bundle.workspaceId); return prepared;
      };
      const first = await put({ origin: 'apple_notes', title: '계정 재검증 합성 원문', text: firstBody, authorRelation: 'self', forceSeparate: true });
      const latest = await put({ origin: 'apple_notes', title: '계정 재검증 합성 원문', text: newerBody, authorRelation: 'self', existingSourceId: first.source.id });
      return { workspaceId: bundle.workspaceId, sourceId: first.source.id, oldVersion: first.version.id, newVersion: latest.version.id, originalBundle: bundle };
    }, { firstBody, newerBody });
  }
  async function rawBundle(page, workspaceId, replacement) {
    return page.evaluate(async ({ workspaceId, replacement }) => {
      const open = indexedDB.open('life-tools-v1'), db = await new Promise((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
      try { return await new Promise((resolve, reject) => {
        const tx = db.transaction('bundles', replacement ? 'readwrite' : 'readonly'), store = tx.objectStore('bundles'), request = replacement ? store.put(replacement) : store.get(workspaceId);
        let result; request.onsuccess = () => { result = request.result; }; tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(tx.error || Error('Fixture transaction failed'));
      }); } finally { db.close(); }
    }, { workspaceId, replacement });
  }
  async function activePointer(page, workspaceId, restore) {
    return page.evaluate(async ({ workspaceId, restore }) => {
      const request = indexedDB.open('life-tools-v1');
      const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try { return await new Promise((resolve, reject) => {
        const tx = db.transaction('meta', 'readwrite'), store = tx.objectStore('meta'); let entry;
        tx.oncomplete = () => resolve(entry); tx.onerror = tx.onabort = () => reject(tx.error || Error('Fixture active pointer transaction failed'));
        if (restore) { entry = restore; store.put(restore); return; }
        const rows = store.getAll(); rows.onsuccess = () => {
          const matches = rows.result.filter(row => row.key.startsWith('activeWorkspace:') && row.value === workspaceId);
          if (matches.length !== 1) { tx.abort(); return; }
          entry = matches[0]; store.delete(entry.key);
        };
      }); } finally { db.close(); }
    }, { workspaceId, restore });
  }
  async function observeError(page) {
    await page.evaluate(() => {
      const box = document.querySelector('#lifeStartup');
      const probe = window.__c2Error = { box, text: box.textContent, paragraph: box.querySelector('p'), retry: box.querySelector('button'), transitions: [], notifications: 0 };
      const seen = new WeakSet();
      probe.stopAuth = HaedoAuth.onAccountChange(account => { if (account) probe.notifications++; });
      probe.observer = new MutationObserver(records => {
        // Count each inserted loading paragraph once, including one removed
        // again before observer delivery. Initial bootstrap is outside this scope.
        for (const node of records.flatMap(record => [...record.addedNodes])) {
          if (node.nodeType === 1 && node.tagName === 'P' && !seen.has(node) && /계정 자료를 확인하고 있습니다|로그인을 확인하고 있습니다/.test(node.textContent)) {
            seen.add(node); probe.transitions.push(node.textContent);
          }
        }
      });
      probe.observer.observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ['role', 'hidden'] });
    });
  }
  async function errorState(page) {
    return page.evaluate(() => { const probe = __c2Error, box = document.querySelector('#lifeStartup'); return { loadingTransitions: probe.transitions.length, transitions: probe.transitions,
      notifications: probe.notifications, sameBox: box === probe.box, sameParagraph: box.querySelector('p') === probe.paragraph, sameRetry: box.querySelector('button') === probe.retry,
      text: box.textContent, originalText: probe.text, role: box.getAttribute('role'), retryEnabled: !!box.querySelector('button') && !box.querySelector('button').disabled, mounts: window.__c2Mounts }; });
  }
  const blogResources = page => page.evaluate(() => __c2BlogEngines.map(engine => ({ disposeCalls: engine.disposeCalls, listeners: engine.listeners.length, timers: engine.timers.size })));
  async function markView(page) {
    await page.evaluate(() => { window.__c2View = { child: document.querySelector('#lifeApp').firstElementChild, storage: HaedoLife.Shell.storage, title: document.querySelector('#photoTitle') }; });
  }
  const viewState = page => page.evaluate(() => ({ hidden: document.querySelector('#lifeApp').hidden, sameChild: __c2View.child === document.querySelector('#lifeApp').firstElementChild,
    sameStorage: __c2View.storage === HaedoLife.Shell.storage, sameTitle: __c2View.title === document.querySelector('#photoTitle'), mounts: window.__c2Mounts, unavailable: window.__c2Unavailable }));
  async function gatedVerify(page, gate, whileHeld = async () => {}) {
    const held = gate();
    await page.evaluate(() => { window.__c2Verified = { done: false }; HaedoAuth.verify().then(user => { __c2Verified.userId = user?.id; }, error => { __c2Verified.error = error.code; }).finally(() => { __c2Verified.done = true; }); });
    await arrived(held); await whileHeld(); held.release(); await held.finished;
    await page.waitForFunction(() => __c2Verified.done); await frames(page);
    assert.deepEqual(await page.evaluate(() => __c2Verified), { done: true, userId: accounts.a.id });
  }
  async function check(name, run, width = 1440, options = {}) {
    if (process.env.SHELL_REVERIFY_MATCH && !new RegExp(process.env.SHELL_REVERIFY_MATCH).test(name)) return;
    const fake = new FakeCloud(), authRequests = [], gates = [], device = 'c2-' + report.checks.length;
    const context = await makeContext(browser, fake, device, accounts.a, { viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => { window.__c2Unavailable = 0; document.addEventListener('haedo:auth-unavailable', () => { __c2Unavailable++; }); });
    const initialErrors = [report.pageErrors.length, report.consoleErrors.length, report.external.length];
    const gate = (skip = 0, owner = accounts.a.id) => {
      let enter, release, finish;
      const value = { skip, owner, used: false, entered: new Promise(resolve => { enter = resolve; }), released: new Promise(resolve => { release = resolve; }), finished: new Promise(resolve => { finish = resolve; }), enter, release, finish };
      gates.push(value); return value;
    };
    let rssHeld;
    const holdRssAuth = outcome => {
      assert(options.rssIsolation && !rssHeld);
      let enter, release, finish;
      rssHeld = { outcome, used: false, entered: new Promise(resolve => { enter = resolve; }), released: new Promise(resolve => { release = resolve; }), finished: new Promise(resolve => { finish = resolve; }), enter, release, finish };
      return rssHeld;
    };
    if (options.rssIsolation) await context.route('**/assets/life/rss-connection.js', async route => {
      const response = await route.fetch(); let source = await response.text(); const originalSHA256 = digest(source);
      const call = 'result = await verifier.auth.getUser(context.accessToken);';
      assert.equal(source.split(call).length, 2, 'Observe exactly one actual RSS SDK verification boundary');
      source = source.replace(call, "const c2Call = root.__c2RssSdkCalls = (root.__c2RssSdkCalls || 0) + 1; " + call + " (root.__c2RssSdkResults ||= []).push({ owner: owner.userId, call: c2Call, errorName: result?.error?.name || null, sessionMissing: !!root.supabase.isAuthSessionMissingError(result?.error) });");
      if (process.env.SHELL_REVERIFY_RSS_MUTATION === 'shared-verifier') source = source.replace(call, 'result = await client.auth.getUser(context.accessToken);');
      // Only this regression schedules the real reflector explicitly; the
      // original eighteen scenarios retain their normal automatic startup.
      source += `\n;(()=>{const api=HaedoLife.RssConnection;HaedoLife.RssConnection=Object.freeze({...api,createReflection(options){const instance=api.createReflection(options);globalThis.__c2RssReflector=instance;return Object.freeze({...instance,start(){}});}});})();`;
      (report.rssScriptLoads ||= []).push({ originalSHA256, servedSHA256: digest(source), mutation: process.env.SHELL_REVERIFY_RSS_MUTATION || null });
      await route.fulfill({ response, body: source });
    });
    await context.route('**/*', route => { const origin = new URL(route.request().url()).origin;
      if ([new URL(base).origin, cloud].includes(origin)) return route.fallback(); report.external.push({ name, origin }); return route.abort('blockedbyclient'); });
    let releaseOpeningFailure;
    const openingLoaded = new Promise(resolve => { releaseOpeningFailure = resolve; });
    const network = { capabilities: [], aborted: [], failedRequests: [], failurePath: options.initialFailure || null, alwaysFailure: options.repeatFailure || null };
    // Record each deliberately aborted HTTP request and its exact browser error.
    // Existing zero-error cases keep their original strict assertion below.
    await context.route(cloud + '/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      if (pathname === '/rest/v1/rpc/life_library_capabilities') network.capabilities.push({ method: request.method(), url: request.url() });
      if (pathname === network.failurePath || pathname === network.alwaysFailure) {
        // Complete the initial page load before failing its first HTTP request.
        // Otherwise native initial pageshow could legitimately retry this error
        // before the test has selected its separate recovery trigger.
        if (options.initialFailure && !network.aborted.length) await openingLoaded;
        network.failurePath = null;
        network.aborted.push({ method: request.method(), url: request.url() }); return route.abort('internetdisconnected');
      }
      return route.fallback();
    });
    await context.route(cloud + '/auth/v1/user', async route => {
      const owner = fake.libraryOwner(route.request()), request = { owner, completed: false }; authRequests.push(request);
      if (rssHeld && !rssHeld.used && owner === accounts.a.id) {
        request.rssOutcome = rssHeld.outcome; request.clientInfo = route.request().headers()['x-client-info'];
        const held = rssHeld; held.used = true; held.enter(request); await held.released;
        try {
          // The real SDK recognizes session_not_found only with this API
          // version exposed over CORS; an ordinary AuthApiError is insufficient.
          await route.fulfill({ status: held.outcome === 'success' ? 200 : 401, contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'X-Supabase-Api-Version', 'x-supabase-api-version': '2024-01-01' },
            body: JSON.stringify(held.outcome === 'success' ? session(accounts.a).user : { code: 'session_not_found', message: 'Synthetic old session no longer exists' }) });
          request.completed = true;
        } finally { rssHeld = null; held.finish(); }
        return;
      }
      const held = gates.find(value => !value.used && value.owner === owner && route.request().headers()['x-client-info'] === 'haedo-platform');
      let holding = null;
      if (held && held.skip-- <= 0) { holding = held; held.used = true; held.enter(request); await held.released; }
      try { await route.fallback(); request.completed = true; } finally { holding?.finish(); }
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.pageErrors.push({ name, message: error.message }));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ name, message: message.text(), location: message.location().url }); });
    page.on('requestfailed', request => network.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
    try {
      console.log('RUN ' + name); await page.goto(base + '/index.html?section=records'); releaseOpeningFailure(); if (!options.initialFailure) await ready(page); await run({ page, context, fake, gate, authRequests, network, holdRssAuth });
      const expectedFailure = options.initialFailure || options.expectedFailure;
      if (options.rssIsolation) {
        assert.deepEqual([report.pageErrors.length, report.external.length], [initialErrors[0], initialErrors[2]]);
        const errors = report.consoleErrors.slice(initialErrors[1]); assert.equal(errors.length, 1);
        assert.deepEqual({ name: errors[0].name, location: errors[0].location }, { name, location: cloud + '/auth/v1/user' });
        assert.match(errors[0].message, /^Failed to load resource:.*status of 401/);
        assert.deepEqual(network.failedRequests, []);
      } else if (!expectedFailure) {
        assert.deepEqual([report.pageErrors.length, report.consoleErrors.length, report.external.length], initialErrors, 'No filtered console/page/external errors');
      } else {
        assert.deepEqual([report.pageErrors.length, report.external.length], [initialErrors[0], initialErrors[2]]);
        assert.deepEqual(report.consoleErrors.slice(initialErrors[1]), Array.from({ length: options.expectedFailureCount || 1 }, () => ({ name, message: 'Failed to load resource: net::ERR_INTERNET_DISCONNECTED', location: cloud + expectedFailure })));
        assert.deepEqual(network.failedRequests, Array.from({ length: options.expectedFailureCount || 1 }, () => ({ url: cloud + expectedFailure, error: 'net::ERR_INTERNET_DISCONNECTED' })));
      }
      report.checks.push({ name, pass: true, authRequests, network, mountProbe: 'delegates original UI.mount and optional one original storage.read' }); console.log('PASS ' + name);
    } catch (error) {
      report.checks.push({ name, pass: false, error: error.stack, authRequests, network }); console.error('FAIL ' + name + '\n' + error.stack);
      await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png') }).catch(() => {});
    } finally { releaseOpeningFailure(); rssHeld?.release(); gates.forEach(value => value.release()); await context.close(); report.closedContexts++; }
  }
  try {
    for (const width of [1440, 390]) await check('completed startup error survives a late same-account verify and explicit retry recovers at ' + width, async ({ page, context, fake, gate, authRequests }) => {
      const fixture = await seed(page), corrupt = structuredClone(fixture.originalBundle); corrupt.sourceVersions[0].contentHash = 'broken-hash';
      await rawBundle(page, fixture.workspaceId, corrupt);
      await context.addInitScript(workspaceId => {
        let release; const promise = new Promise(resolve => { release = resolve; });
        window.__c2ReadGate = { workspaceId, entered: false, used: false, promise, release };
      }, fixture.workspaceId);
      const delayed = gate(1); // First opening Auth succeeds; background verification is held.
      await page.reload(); await page.waitForFunction(() => window.__c2ReadGate?.entered); await arrived(delayed);
      await page.evaluate(() => __c2ReadGate.release());
      await page.locator('#lifeStartup[role="alert"]').getByRole('button', { name: '다시 확인', exact: true }).waitFor();
      await page.evaluate(() => HaedoLife.Shell.ready); await frames(page);
      await observeError(page);
      const initialMounts = await page.evaluate(() => window.__c2Mounts), initialBootstraps = fake.libraryRequests.filter(row => row.rpc === 'life_library_capabilities').length;
      delayed.release(); await delayed.finished; await page.waitForFunction(() => __c2Error.notifications > 0); await frames(page);
      const observed = await errorState(page); observed.mountDelta = observed.mounts - initialMounts; observed.bootstrapDelta = fake.libraryRequests.filter(row => row.rpc === 'life_library_capabilities').length - initialBootstraps;
      (report.errorRace ||= []).push({ width, ...observed });
      assert.equal(observed.loadingTransitions, 0, 'A completed error must not transition back to loading after same-account Auth completion');
      assert.equal(observed.mountDelta, 0); assert.equal(observed.bootstrapDelta, 0);
      assert(observed.sameBox && observed.sameParagraph && observed.sameRetry && observed.retryEnabled); assert.equal(observed.text, observed.originalText); assert.equal(observed.role, 'alert');
      const requestsBefore = authRequests.length; await page.evaluate(() => HaedoAuth.verify()); await frames(page);
      assert(authRequests.length > requestsBefore, 'Same-account verify still performs actual HTTP Auth');
      assert.equal((await errorState(page)).loadingTransitions, 0); assert.equal((await errorState(page)).sameRetry, true);
      assert.deepEqual(await rawBundle(page, fixture.workspaceId), corrupt, 'Failed opening and repeated verification preserve damaged bytes and exact originals');
      await page.screenshot({ path: path.join(output, 'stable-error-' + width + '.png') });
      // Repair only the deliberately damaged synthetic bytes. The real retry
      // button must then verify Auth and mount this same exact workspace.
      await rawBundle(page, fixture.workspaceId, fixture.originalBundle);
      const beforeRetry = authRequests.length;
      await page.locator('#lifeStartup').getByRole('button', { name: '다시 확인', exact: true }).click(); await ready(page);
      assert(authRequests.length > beforeRetry); assert.equal(await page.evaluate(() => HaedoLife.Shell.storage.getActive()), fixture.workspaceId);
      assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), fixture.workspaceId), fixture.originalBundle);
      assert.equal(await page.locator('#lifeStartup').isHidden(), true);
    }, width);
    await check('same-account verification and retained resume preserve unsaved Korean composition', async ({ page, gate, authRequests }) => {
      await page.locator('[data-haedo-compose]').click(); await page.locator('#photoTitle').waitFor();
      await page.locator('.ql-editor').fill('아직 글 저장을 하지 않은 합성 본문 🌱');
      await page.locator('#photoTitle').fill('미저장 제목 ');
      await page.locator('#photoTitle').evaluate(element => { window.__c2Title = element; element.focus(); element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'ㅎ' })); element.value += '한글 조합 중'; element.setSelectionRange(4, 7); element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '한글 조합 중', isComposing: true })); });
      const before = await page.locator('#photoTitle').inputValue(), requestsBefore = authRequests.length;
      await page.evaluate(() => HaedoAuth.verify()); await frames(page); assert(authRequests.length > requestsBefore);
      assert.equal(await page.locator('#photoTitle').inputValue(), before);
      assert.deepEqual(await page.locator('#photoTitle').evaluate(element => ({ same: element === __c2Title, focused: document.activeElement === element, start: element.selectionStart, end: element.selectionEnd })), { same: true, focused: true, start: 4, end: 7 });
      await page.locator('#photoTitle').dispatchEvent('compositionend', { data: '한글 조합 중' });
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      assert.equal(await page.locator('#lifeApp').isHidden(), true);
      const returning = gate(); await page.evaluate(() => { window.__c2ResumeNotifies = []; HaedoAuth.onAccountChange(account => { if (account) __c2ResumeNotifies.push(document.querySelector('#lifeApp').hidden); }); dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
      await arrived(returning); assert.equal(await page.locator('#lifeApp').isHidden(), true);
      returning.release(); await returning.finished; await ready(page); await frames(page);
      assert.equal(await page.locator('#photoTitle').inputValue(), before); assert.equal(await page.locator('#photoTitle').evaluate(element => element === __c2Title), true);
      assert.equal(await page.locator('.ql-editor').innerText(), '아직 글 저장을 하지 않은 합성 본문 🌱');
      assert.equal(await page.evaluate(() => __c2ResumeNotifies[0]), true, 'Notification alone cannot expose the retained private view before its resume verification completes');
    }, 390);
    await check('same-account verify preserves the exact older reader and focused search result', async ({ page, authRequests }) => {
      const fixture = await seed(page); await page.reload(); await ready(page);
      await page.locator('#lifeFindOpen').click(); await page.locator('#lifeFind[aria-busy="false"]').waitFor();
      await page.locator('#lifeFindQuery').fill('읽던 정확한 판');
      const result = page.locator('[data-focus-key="find:source:' + fixture.oldVersion + '"]'); await result.focus();
      await result.evaluate(element => { window.__c2Result = element; });
      let requestsBefore = authRequests.length; await page.evaluate(() => HaedoAuth.verify()); await frames(page); assert(authRequests.length > requestsBefore);
      assert.equal(await result.evaluate(element => element === __c2Result && document.activeElement === element), true); assert.equal(await page.locator('#lifeFindQuery').inputValue(), '읽던 정확한 판');
      await page.keyboard.press('Enter'); await page.locator('#lifeSourceText').waitFor(); assert.equal(await page.locator('#lifeSourceText').textContent(), firstBody);
      await page.locator('#lifeSourceText').evaluate(element => { window.__c2Reader = element; });
      requestsBefore = authRequests.length; await page.evaluate(() => HaedoAuth.verify()); await frames(page); assert(authRequests.length > requestsBefore);
      assert.equal(await page.locator('#lifeSourceText').evaluate(element => element === __c2Reader), true); assert.equal(await page.locator('#lifeSourceText').textContent(), firstBody);
      await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeFind[aria-busy="false"]').waitFor(); await frames(page);
      assert.equal(await result.evaluate(element => document.activeElement === element), true); assert.equal(await page.locator('#lifeFindQuery').inputValue(), '읽던 정확한 판');
      assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), fixture.workspaceId), fixture.originalBundle);
    });
    await check('account B replaces A and late A verification cannot expose or replace B', async ({ page, gate }) => {
      const fixture = await seed(page), held = gate();
      await page.evaluate(() => { window.__c2OldStorage = HaedoLife.Shell.storage; window.__c2Late = { done: false }; HaedoAuth.verify().then(user => { __c2Late.user = user?.id; }, error => { __c2Late.error = error.code; }).finally(() => { __c2Late.done = true; }); });
      await arrived(held);
      const bVerify = gate(1, accounts.b.id); // SDK setSession verifies B first; gate the app's following verification.
      await page.evaluate(value => HaedoAuth.client.auth.setSession(value), session(accounts.b));
      await page.evaluate(() => { window.__c2B = { done: false }; HaedoAuth.verify().then(user => { __c2B.user = user?.id; }, error => { __c2B.error = error.code; }).finally(() => { __c2B.done = true; }); });
      await arrived(bVerify); assert.equal(await page.locator('#lifeApp').isHidden(), true); assert.equal(await page.evaluate(() => HaedoLife.Shell.storage), null);
      assert.equal(await page.evaluate(async id => { try { await __c2OldStorage.read(id); return false; } catch (_) { return true; } }, fixture.workspaceId), true, 'A storage is invalidated before B verification completes');
      held.release(); await held.finished; await page.waitForFunction(() => __c2Late.done); await frames(page);
      assert.equal(await page.locator('#lifeApp').isHidden(), true); assert.equal(await page.evaluate(() => HaedoLife.Shell.storage), null);
      bVerify.release(); await bVerify.finished; await ready(page); await page.waitForFunction(id => HaedoLife.Shell.storage.account.userId === id, accounts.b.id);
      const bWorkspace = await page.evaluate(() => HaedoLife.Shell.storage.getActive()); assert.notEqual(bWorkspace, fixture.workspaceId);
      await frames(page);
      assert.equal(await page.evaluate(() => HaedoLife.Shell.storage.account.userId), accounts.b.id); assert.equal(await page.evaluate(() => HaedoLife.Shell.storage.getActive()), bWorkspace);
      assert.equal(await page.evaluate(() => __c2Late.user), undefined); assert.equal(await page.locator('#lifeApp').innerText().then(text => text.includes(firstBody)), false);
      const state = await page.evaluate(async () => { const s = HaedoLife.Shell.storage; return { same: s === __c2OldStorage, bundle: await s.read(await s.getActive()) }; });
      assert.equal(state.same, false); assert.equal(state.bundle.sources.length, 0);
    });
    await check('same-document SDK logout blocks late A and explicit A login mounts again', async ({ page, gate }) => {
      const fixture = await seed(page), held = gate(), documentId = await page.evaluate(() => __homeInstance);
      await page.evaluate(() => { window.__c2OldStorage = HaedoLife.Shell.storage; window.__c2Late = { done: false }; HaedoAuth.verify().then(user => { __c2Late.user = user?.id; }, error => { __c2Late.error = error.code; }).finally(() => { __c2Late.done = true; }); });
      await arrived(held); await page.evaluate(() => HaedoAuth.client.auth.signOut({ scope: 'local' }));
      await page.waitForFunction(() => !HaedoAuth.user && !HaedoLife.Shell.storage); assert.equal(await page.locator('#lifeApp').isHidden(), true);
      held.release(); await held.finished; await page.waitForFunction(() => __c2Late.done); await frames(page);
      assert.equal(await page.evaluate(() => HaedoLife.Shell.storage), null); assert.equal(await page.evaluate(() => __c2Late.user), undefined); assert.equal(await page.locator('#lifeWelcome').isVisible(), true);
      await page.evaluate(async email => { const result = await HaedoAuth.client.auth.signInWithPassword({ email, password: 'anonymous-browser-password' }); if (result.error) throw result.error; await HaedoAuth.verify(); }, accounts.a.email);
      await ready(page); assert.equal(await page.evaluate(() => __homeInstance), documentId, 'A new document must not hide a missing logout reset');
      assert.equal(await page.evaluate(() => HaedoLife.Shell.storage === __c2OldStorage), false); assert.equal(await page.evaluate(() => HaedoLife.Shell.storage.account.userId), accounts.a.id);
      assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), fixture.workspaceId), fixture.originalBundle);
    });
    await check('late isolated RSS Auth success and missing session preserve the current shell account', async ({ page, holdRssAuth, authRequests }) => {
      const fixture = await seed(page), transport = [];
      await page.waitForFunction(() => !!window.__c2RssReflector);
      page.on('response', response => {
        if (response.url() === cloud + '/auth/v1/user' && response.status() === 401) transport.push({ status: response.status(), method: response.request().method(), apiVersion: response.headers()['x-supabase-api-version'] });
      });
      for (const outcome of ['success', 'session_not_found']) {
        const held = holdRssAuth(outcome), requestsBefore = authRequests.length, call = outcome === 'success' ? 1 : 2;
        await page.evaluate(workspaceId => {
          window.__c2RssBefore = { epoch: HaedoAuth.epoch, user: HaedoAuth.user, storage: HaedoLife.Shell.storage };
          window.__c2RssWork = { done: false };
          __c2RssReflector.syncNow(workspaceId).then(status => { __c2RssWork.status = status.state; }, error => { __c2RssWork.error = error.code; }).finally(() => { __c2RssWork.done = true; });
        }, fixture.workspaceId);
        await arrived(held);
        assert.equal(await page.evaluate(() => __c2RssWork.done), false, 'The actual RSS Auth response is still held');
        assert.deepEqual(await page.evaluate(() => ({ calls: __c2RssSdkCalls, completed: (window.__c2RssSdkResults || []).length })), { calls: call, completed: call - 1 });
        held.release(); await held.finished; await page.waitForFunction(() => __c2RssWork.done); await frames(page);
        const results = await page.evaluate(() => __c2RssSdkResults); assert.equal(results.length, call); const sdk = results.at(-1);
        assert.deepEqual(sdk, { owner: accounts.a.id, call, errorName: outcome === 'success' ? null : 'AuthSessionMissingError', sessionMissing: outcome !== 'success' }, 'The bundled SDK must take the actual missing-session branch');
        const state = await page.evaluate(() => ({ epoch: HaedoAuth.epoch, previousEpoch: __c2RssBefore.epoch, sameUser: HaedoAuth.user === __c2RssBefore.user,
          userId: HaedoAuth.user?.id || null, sameStorage: HaedoLife.Shell.storage === __c2RssBefore.storage, storageOwner: HaedoLife.Shell.storage?.account?.userId || null }));
        (report.rssIsolation ||= []).push({ outcome, sdk, state, work: await page.evaluate(() => __c2RssWork) });
        assert.equal(state.epoch, state.previousEpoch, 'Late RSS verification must not change the shared Auth epoch');
        assert.equal(state.sameUser, true, 'Late RSS verification must retain the exact shared Auth user');
        assert.equal(state.userId, accounts.a.id); assert.equal(state.sameStorage, true); assert.equal(state.storageOwner, accounts.a.id);
        assert(authRequests.length > requestsBefore, 'RSS verification remains in the complete Auth request ledger');
        assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), fixture.workspaceId), fixture.originalBundle);
      }
      assert.deepEqual(transport, [{ status: 401, method: 'GET', apiVersion: '2024-01-01' }]);
    }, 1440, { rssIsolation: true });
    await check(report.recoveryRows['mounted-real-auth-failure'], async ({ page, gate, authRequests, network }) => {
      await page.locator('[data-haedo-compose]').click(); await page.locator('#photoTitle').fill('네트워크 확인 중 미저장 제목');
      await page.locator('.ql-editor').fill('네트워크 확인 중 보존할 본문 🌱'); await markView(page);
      const before = authRequests.length; network.failurePath = '/auth/v1/user';
      const failed = await page.evaluate(async () => { try { await HaedoAuth.verify(); return null; } catch (error) { return error.code; } });
      assert.equal(failed, 'network_error'); assert(authRequests.length > before); await frames(page);
      const stable = { hidden: false, sameChild: true, sameStorage: true, sameTitle: true, mounts: 1, unavailable: 0 };
      assert.deepEqual(await viewState(page), stable);
      await gatedVerify(page, gate, async () => assert.deepEqual(await viewState(page), stable));
      assert.deepEqual(await viewState(page), stable);
      assert.equal(await page.locator('#photoTitle').inputValue(), '네트워크 확인 중 미저장 제목');
      assert.equal(await page.locator('.ql-editor').innerText(), '네트워크 확인 중 보존할 본문 🌱');
      (report.recoveryBoundaries ||= []).push({ row: 'mounted-real-auth-failure', realAuthFailure: failed, final: await viewState(page) });
    }, 390, { expectedFailure: '/auth/v1/user' });
    await check(report.recoveryRows['mounted-direct-auth-unavailable'], async ({ page, gate }) => {
      const fixture = await seed(page); await markView(page);
      // This deliberately dispatched boundary proves the listener behavior only.
      // A mounted real Auth failure above does NOT emit this event (count zero).
      await page.evaluate(() => { const event = new Event('haedo:auth-unavailable'); event.code = 'network_error'; document.dispatchEvent(event); });
      await page.locator('#lifeStartup[role="alert"] button').waitFor(); await observeError(page);
      assert.equal(await page.evaluate(() => __c2Unavailable), 1);
      assert.equal(await page.locator('#lifeApp').isHidden(), true); assert.equal(await page.evaluate(() => HaedoLife.Shell.storage), null);
      assert.equal(await page.evaluate(async id => { try { await __c2View.storage.read(id); return false; } catch (_) { return true; } }, fixture.workspaceId), true);
      await gatedVerify(page, gate, async () => assert.equal((await errorState(page)).sameRetry, true));
      await ready(page); await frames(page);
      assert.deepEqual(await viewState(page), { hidden: false, sameChild: false, sameStorage: false, sameTitle: true, mounts: 2, unavailable: 1 });
      assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), fixture.workspaceId), fixture.originalBundle);
      (report.recoveryBoundaries ||= []).push({ row: 'mounted-direct-auth-unavailable', artificialEvent: true, productionDispatchReachabilityClaimed: false, final: await viewState(page) });
    });
    await check(report.recoveryRows['retained-offline-resume-then-verify'], async ({ page, gate, network, authRequests }) => {
      await page.locator('[data-haedo-compose]').click(); await page.locator('#photoTitle').fill('복귀 검증 중 그대로 남을 제목');
      await page.locator('.ql-editor').fill('복귀 검증 중 그대로 남을 본문 🌱');
      await page.locator('#photoTitle').evaluate(input => { input.focus(); input.setSelectionRange(4, 8); }); await markView(page);
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      network.failurePath = '/auth/v1/user'; const before = authRequests.length;
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await page.locator('#lifeStartup[role="alert"] button').waitFor(); await frames(page); await observeError(page);
      assert(authRequests.length > before);
      const retained = { hidden: true, sameChild: true, sameStorage: true, sameTitle: true, mounts: 1, unavailable: 0 };
      assert.deepEqual(await viewState(page), retained);
      await page.evaluate(() => {
        const app = document.querySelector('#lifeApp'); window.__c2UnexpectedReveal = 0;
        window.__c2RevealObserver = new MutationObserver(records => { if (!app.hidden || records.some(record => record.oldValue === null)) __c2UnexpectedReveal++; });
        __c2RevealObserver.observe(app, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });
      });
      await gatedVerify(page, gate, async () => assert.deepEqual(await viewState(page), retained));
      assert.deepEqual(await viewState(page), retained);
      const error = await errorState(page); assert.equal(error.sameParagraph, true); assert.equal(error.sameRetry, true); assert.equal(error.loadingTransitions, 0);
      assert.equal(await page.evaluate(() => __c2UnexpectedReveal), 0);
      await page.evaluate(() => __c2RevealObserver.disconnect());
      const retry = gate(), beforeRetry = authRequests.length;
      await page.locator('#lifeStartup').getByRole('button', { name: '다시 확인', exact: true }).click();
      await arrived(retry); assert.equal(await page.locator('#lifeApp').isHidden(), true);
      retry.release(); await retry.finished; await ready(page); await frames(page); assert(authRequests.length > beforeRetry);
      assert.deepEqual(await viewState(page), { ...retained, hidden: false });
      assert.equal(await page.locator('#photoTitle').inputValue(), '복귀 검증 중 그대로 남을 제목');
      assert.equal(await page.locator('.ql-editor').innerText(), '복귀 검증 중 그대로 남을 본문 🌱');
      assert.deepEqual(await page.locator('#photoTitle').evaluate(input => ({ start: input.selectionStart, end: input.selectionEnd })), { start: 4, end: 8 });
      (report.recoveryBoundaries ||= []).push({ row: 'retained-offline-resume-then-verify', ordinaryVerifyStayedHidden: true, unexpectedReveal: 0, final: await viewState(page) });
    }, 390, { expectedFailure: '/auth/v1/user' });
    await check('one transient original read failure recovers on online without a retry click', async ({ page, context, gate }) => {
      const fixture = await seed(page);
      await context.addInitScript(workspaceId => {
        let release; const promise = new Promise(resolve => { release = resolve; });
        window.__c2ReadGate = { workspaceId, entered: false, used: false, promise, release, failureCode: 'storage_unavailable' };
      }, fixture.workspaceId);
      const background = gate(1); await page.reload(); await page.waitForFunction(() => __c2ReadGate.entered); await arrived(background);
      await page.evaluate(() => __c2ReadGate.release()); await page.locator('#lifeStartup[role="alert"] button').waitFor();
      await page.evaluate(() => HaedoLife.Shell.ready); await frames(page); await observeError(page);
      const failedResources = await blogResources(page); assert.equal(failedResources.length, 1);
      assert(failedResources[0].disposeCalls > 0); assert.equal(failedResources[0].listeners, 0); assert.equal(failedResources[0].timers, 0);
      assert.equal(await page.evaluate(() => __c2ReadGate.failed), true);
      // The original background Auth is still held: the visible transition here
      // must come from shell's explicit lifecycle retry, not its late completion.
      await page.evaluate(() => dispatchEvent(new Event('online')));
      await page.locator('#lifeStartup[role="status"]').waitFor(); await frames(page);
      assert((await errorState(page)).loadingTransitions > 0);
      background.release(); await background.finished; await ready(page); await frames(page);
      assert.equal(await page.evaluate(() => __c2Mounts), 2);
      assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), fixture.workspaceId), fixture.originalBundle);
      const resources = await blogResources(page); assert.equal(resources.length, 2);
      assert.equal(resources[0].listeners, 0); assert.equal(resources[0].timers, 0); assert.equal(resources[1].disposeCalls, 0);
      (report.mountRecovery ||= []).push({ trigger: 'online-before-held-Auth-completion', injectedReads: 1, mounts: 2, resources });
    });
    await check('failed direct UI mount cleans its engines after async and constructor failures without caller abort', async ({ page }) => {
      const fixture = await seed(page);
      await page.evaluate(() => { window.__c2DirectOptions = __c2LastMountOptions; });
      for (const stage of ['read', 'constructor']) {
        const result = await page.evaluate(async stage => {
          const options = __c2DirectOptions, controller = new AbortController(), container = document.createElement('div');
          const before = __c2BlogEngines.length, ownedBefore = __c2OwnedEngines.length; let reads = 0, failure;
          const injected = Object.assign(new Error('Synthetic mount failure at ' + stage), { code: 'storage_unavailable' });
          const storage = { ...options.storage, async read(id) { const result = await options.storage.read(id); reads++; if (stage === 'read') throw injected; return result; } };
          const search = HaedoLife.UnifiedSearchUI;
          if (stage === 'constructor') HaedoLife.UnifiedSearchUI = { ...search, create() { throw injected; } };
          try { await HaedoLife.UI.mount(container, { ...options, storage, signal: controller.signal, sync: null, compositionSync: null, writingSync: null, libraryMetaSync: null, accountLibrary: null, bootstrap: { legacy: true } }); }
          catch (error) { failure = { code: error.code, sameError: error === injected }; }
          finally { HaedoLife.UnifiedSearchUI = search; }
          return { stage, before, after: __c2BlogEngines.length, reads, failure, signalAborted: controller.signal.aborted, owned: __c2OwnedEngines.slice(ownedBefore) };
        }, stage);
        const resources = await blogResources(page), failed = resources[result.before];
        (report.directMountCleanup ||= []).push({ ...result, resources });
        assert.deepEqual(result.failure, { code: 'storage_unavailable', sameError: true }); assert.equal(result.reads, stage === 'read' ? 1 : 0); assert.equal(result.signalAborted, false);
        assert.equal(result.after, result.before + 1);
        assert(failed.disposeCalls > 0, 'UI.mount must dispose its own failed instance before rejecting, without relying on shell abort');
        assert.equal(failed.listeners, 0, 'Failed BlogSync must retain zero native event listeners');
        assert.equal(failed.timers, 0, 'Failed BlogSync must retain zero native timers');
        assert.equal(resources[0].disposeCalls, 0, 'Healthy shell instance must remain independent');
        assert.deepEqual(result.owned.map(item => item.name).sort(), ['DiscoveryPrivateRemote', 'DiscoveryUI']);
        assert(result.owned.every(item => item.disposeCalls > 0));
        assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), fixture.workspaceId), fixture.originalBundle);
      }
    });
    await check('automatic retry coalesces lifecycle events and stops after three consecutive attempts', async ({ page, gate, network }) => {
      await page.locator('#lifeStartup[role="alert"] button').waitFor(); await page.evaluate(() => HaedoLife.Shell.ready); await frames(page);
      assert.equal(network.capabilities.length, 1);
      for (let attempt = 1; attempt <= 3; attempt++) {
        const request = gate();
        await page.evaluate(persisted => { if (persisted) dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); dispatchEvent(new PageTransitionEvent('pageshow', { persisted })); dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); dispatchEvent(new Event('online')); }, attempt === 2);
        await arrived(request); assert.equal(network.capabilities.length, attempt);
        request.release(); await request.finished; await page.locator('#lifeStartup[role="alert"] button').waitFor(); await frames(page);
        assert.equal(network.capabilities.length, attempt + 1, 'One event burst must produce exactly one bounded attempt');
      }
      await observeError(page);
      await page.evaluate(() => { dispatchEvent(new Event('online')); dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })); document.dispatchEvent(new Event('visibilitychange')); });
      await frames(page); assert.equal(network.capabilities.length, 4); assert.equal((await errorState(page)).loadingTransitions, 0);
      await page.evaluate(() => { dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
      await frames(page); assert.equal(network.capabilities.length, 4); assert.equal((await errorState(page)).loadingTransitions, 0);
      await gatedVerify(page, gate); assert.equal(network.capabilities.length, 4); assert.equal((await errorState(page)).sameRetry, true);
      network.alwaysFailure = null;
      await page.locator('#lifeStartup').getByRole('button', { name: '다시 확인', exact: true }).click(); await ready(page); await frames(page);
      assert.equal(network.capabilities.length, 5); report.retryLimit = { automaticAttempts: 3, eventBurstCoalesced: true, explicitRetryRecovered: true };
    }, 390, { initialFailure: '/rest/v1/rpc/life_library_capabilities', repeatFailure: '/rest/v1/rpc/life_library_capabilities', expectedFailureCount: 4 });
    // These two fresh contexts have no workspace/cache to fall back to. A real
    // HTTP failure completes the first startup. A separately gated real verify
    // must recover without a retry click; lifecycle retry is exercised separately.
    for (const failure of ['auth', 'bootstrap']) await check('recovery after first ' + failure + ' network failure uses the next real verify without clicking retry', async ({ page, gate, authRequests, network }) => {
      await page.locator('#lifeStartup[role="alert"]').getByRole('button', { name: '다시 확인', exact: true }).waitFor();
      await page.evaluate(() => HaedoLife.Shell.ready); await frames(page); await observeError(page);
      assert.equal(network.aborted.length, 1); assert.equal(await page.evaluate(() => window.__c2Mounts || 0), 0);
      assert.equal(await page.evaluate(() => HaedoLife.Shell.storage), null);
      assert.equal(await page.evaluate(() => !!HaedoAuth.getAccount()), failure === 'bootstrap');
      assert.equal(network.capabilities.length, failure === 'bootstrap' ? 1 : 0);
      const cachedBundles = await page.evaluate(async () => {
        if (!(await indexedDB.databases()).some(db => db.name === 'life-tools-v1')) return 0;
        const request = indexedDB.open('life-tools-v1');
        const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        try {
          if (!db.objectStoreNames.contains('bundles')) return 0;
          return await new Promise((resolve, reject) => { const request = db.transaction('bundles').objectStore('bundles').count(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        } finally { db.close(); }
      });
      assert.equal(cachedBundles, 0, 'A cached workspace must not conceal the initial bootstrap failure');
      const row = { failure, cachedBundles, beforeVerify: await errorState(page), authBeforeVerify: authRequests.length, capabilitiesBeforeVerify: network.capabilities.length };
      (report.recovery ||= []).push(row);
      // The positive recovery criterion is a completed HTTP verify followed by
      // visible, mounted real UI. No fixed observation sleep or retry click.
      const verification = gate(), beforeVerify = authRequests.length;
      await page.evaluate(() => {
        window.__c2Recovery = { done: false };
        HaedoAuth.verify().then(user => { __c2Recovery.userId = user?.id; }, error => { __c2Recovery.error = error.code || error.name; }).finally(() => { __c2Recovery.done = true; });
      });
      await arrived(verification); assert(authRequests.length > beforeVerify);
      assert.equal(await page.locator('#lifeApp').isHidden(), true); assert.equal((await errorState(page)).sameRetry, true);
      verification.release(); await verification.finished; await page.waitForFunction(() => __c2Recovery.done); await frames(page);
      row.afterVerify = await errorState(page); row.verify = await page.evaluate(() => __c2Recovery);
      assert.equal(row.verify.userId, accounts.a.id); assert.equal(row.verify.error, undefined);
      await ready(page); await frames(page);
      assert.equal(await page.locator('#lifeStartup').isHidden(), true);
      assert.equal(await page.evaluate(() => HaedoLife.Shell.storage.account.userId), accounts.a.id);
      assert.equal(await page.evaluate(() => window.__c2Mounts), 1);
      assert.equal(network.capabilities.length, failure === 'bootstrap' ? 2 : 1);
      row.recoveredWithoutClick = true; row.authAfterRecovery = authRequests.length; row.capabilitiesAfterRecovery = network.capabilities.length;
    }, 390, { initialFailure: failure === 'auth' ? '/auth/v1/user' : '/rest/v1/rpc/life_library_capabilities' });
    for (const variant of ['limit', 'offline']) await check('interrupted automatic retry restores the last failure and one button on ' + variant + ' resume', async ({ page, context, gate, network, authRequests }) => {
      const fixture = await seed(page);
      // Remove only this synthetic owner's active pointer so a capabilities
      // outage cannot fall back to the existing workspace. Original bytes and
      // ownership stay intact, and the exact pointer is restored before retry.
      const pointer = await activePointer(page, fixture.workspaceId);
      network.alwaysFailure = '/rest/v1/rpc/life_library_capabilities';
      // Initial pageshow must finish before the first failure is delivered; it
      // must not consume an automatic attempt intended for the gated sequence.
      let releaseInitialFailure; const loaded = new Promise(resolve => { releaseInitialFailure = resolve; });
      await context.route(cloud + '/rest/v1/rpc/life_library_capabilities', async route => { await loaded; return route.fallback(); });
      try { await page.reload(); await frames(page); } finally { releaseInitialFailure(); }
      await page.locator('#lifeStartup[role="alert"] button').waitFor();
      await page.evaluate(() => HaedoLife.Shell.ready); await frames(page);
      const lastMessage = await page.locator('#lifeStartup p').textContent();
      const completedRetries = variant === 'limit' ? 2 : 0;
      for (let index = 0; index < completedRetries; index++) {
        const request = gate(); await page.evaluate(() => dispatchEvent(new Event('online'))); await arrived(request);
        request.release(); await request.finished; await page.locator('#lifeStartup[role="alert"] button').waitFor(); await frames(page);
        assert.equal(await page.locator('#lifeStartup p').textContent(), lastMessage);
      }
      const pending = gate(); await page.evaluate(() => dispatchEvent(new Event('online'))); await arrived(pending);
      assert.equal(await page.locator('#lifeStartup').getAttribute('role'), 'status');
      assert.equal(await page.locator('#lifeStartup button').count(), 0);
      const capabilitiesBeforeSuspend = network.capabilities.length;
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      if (variant === 'offline') { await context.setOffline(true); assert.equal(await page.evaluate(() => navigator.onLine), false); }
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))); await frames(page);
      const snapshot = async () => ({ role: await page.locator('#lifeStartup').getAttribute('role'), message: await page.locator('#lifeStartup p').textContent(),
        retryCount: await page.locator('#lifeStartup').getByRole('button', { name: '다시 확인', exact: true }).count(), allButtons: await page.locator('#lifeStartup button').count(),
        appHidden: await page.locator('#lifeApp').isHidden(), storageMissing: await page.evaluate(() => HaedoLife.Shell.storage === null), capabilities: network.capabilities.length });
      const expected = { role: 'alert', message: lastMessage, retryCount: 1, allButtons: 1, appHidden: true, storageMissing: true, capabilities: capabilitiesBeforeSuspend };
      const row = { variant, completedRetries, pendingAttempt: completedRetries + 1, lastMessage, afterResume: await snapshot() };
      (report.interruptedRetries ||= []).push(row);
      assert.deepEqual(row.afterResume, expected);
      assert.equal(await page.locator('#lifeStartup button').isEnabled(), true);
      assert.doesNotMatch(await page.locator('body').innerText(), /계정 재검증 합성 원문|읽던 정확한 판/);
      assert.deepEqual(await rawBundle(page, fixture.workspaceId), fixture.originalBundle);
      pending.release(); await pending.finished; await frames(page);
      row.afterLateResponse = await snapshot(); assert.deepEqual(row.afterLateResponse, expected);
      assert.equal(await page.evaluate(() => HaedoAuth.getAccount()?.userId), accounts.a.id);
      assert.deepEqual(await rawBundle(page, fixture.workspaceId), fixture.originalBundle);
      await activePointer(page, fixture.workspaceId, pointer); network.alwaysFailure = null;
      const manual = gate(), authBeforeManual = authRequests.length;
      await page.locator('#lifeStartup').getByRole('button', { name: '다시 확인', exact: true }).click(); await arrived(manual);
      // While offline, the real retry has already started and is held at HTTP.
      // Restoring connectivity now cannot replace it with a separate auto retry.
      if (variant === 'offline') await context.setOffline(false);
      manual.release(); await manual.finished; await ready(page); await frames(page);
      assert(authRequests.length > authBeforeManual); assert.equal(await page.evaluate(() => HaedoLife.Shell.storage.account.userId), accounts.a.id);
      assert.equal(await page.evaluate(() => HaedoLife.Shell.storage.getActive()), fixture.workspaceId);
      assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), fixture.workspaceId), fixture.originalBundle);
      row.manualRecovered = true; row.originalBundlePreserved = true;
    }, 390, { expectedFailure: '/rest/v1/rpc/life_library_capabilities', expectedFailureCount: variant === 'limit' ? 3 : 1 });
    for (const code of ['duplicate_excerpt', 'immutable_source_version']) await check('permanent data code ' + code + ' preserves the error without automatic rebuild', async ({ page, context, gate, authRequests, network }) => {
      const fixture = await seed(page);
      await context.addInitScript(({ workspaceId, code }) => {
        let release; const promise = new Promise(resolve => { release = resolve; });
        window.__c2ReadGate = { workspaceId, entered: false, used: false, promise, release, failureCode: code };
      }, { workspaceId: fixture.workspaceId, code });
      const background = gate(1); await page.reload(); await page.waitForFunction(() => __c2ReadGate.entered); await arrived(background);
      await page.evaluate(() => __c2ReadGate.release()); await page.locator('#lifeStartup[role="alert"] button').waitFor();
      await page.evaluate(() => HaedoLife.Shell.ready); await frames(page); await observeError(page);
      const mounts = await page.evaluate(() => __c2Mounts), capabilities = network.capabilities.length;
      background.release(); await background.finished; await page.waitForFunction(() => __c2Error.notifications > 0); await frames(page);
      const authBeforeVerify = authRequests.length; await page.evaluate(() => HaedoAuth.verify()); await frames(page); assert(authRequests.length > authBeforeVerify);
      const authAfterVerify = authRequests.length;
      await page.evaluate(() => { dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); }); await frames(page);
      const state = await errorState(page); (report.permanentCodes ||= []).push({ code, ...state, mountDelta: state.mounts - mounts, capabilitiesDelta: network.capabilities.length - capabilities });
      assert.equal(state.loadingTransitions, 0); assert.equal(state.mounts, mounts); assert.equal(network.capabilities.length, capabilities);
      assert.equal(authRequests.length, authAfterVerify); assert.equal(state.sameParagraph, true); assert.equal(state.sameRetry, true); assert.equal(state.retryEnabled, true);
      assert.equal(state.role, 'alert'); assert.equal(state.text, state.originalText); assert.equal(await page.locator('#lifeApp').isHidden(), true);
      assert.deepEqual(await rawBundle(page, fixture.workspaceId), fixture.originalBundle);
    });
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve)); report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  assert(report.checks.length > 0); assert(report.checks.every(check => check.pass), 'Shell re-verification failures are recorded in report.json');
}
main().catch(error => { console.error(error.stack); server.close(); process.exitCode = 1; });

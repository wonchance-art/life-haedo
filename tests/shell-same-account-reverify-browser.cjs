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
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { scope: 'Actual shell/UI/SDK/IndexedDB; synthetic account A/B and HTTP only. The startup failure uses one deferred original storage.read through UI.mount; no validator or Auth implementation is replaced. IME and page lifecycle are event simulations.', checks: [], pageErrors: [], consoleErrors: [], external: [], closedContexts: 0 };
let site;
const mountProbe = `
/* C2 test-only observation and one-read scheduling boundary. */
{ const original = HaedoLife.UI;
  HaedoLife.UI = { ...original, mount(container, options) {
    window.__c2Mounts = (window.__c2Mounts || 0) + 1;
    const gate = window.__c2ReadGate;
    if (!gate || gate.used) return original.mount(container, options);
    const storage = { ...options.storage, async read(workspaceId) {
      if (!gate.used && workspaceId === gate.workspaceId) {
        gate.used = true; gate.entered = true; await gate.promise;
      }
      return options.storage.read(workspaceId);
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
    let bytes = await fs.readFile(override && name === 'assets/life/shell.js' ? override : file);
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
  site = path.join(output, 'prepared-site');
  execFileSync(process.execPath, ['scripts/prepare-site.mjs', site], { cwd: project, env: { ...process.env, HAEDO_SUPABASE_URL: 'https://life-sync-test.supabase.co', HAEDO_SUPABASE_KEY: 'sb_publishable_anonymous_browser_test_only' } });
  report.preparedSHA256 = {};
  for (const name of ['assets/life/shell.js', 'assets/life/ui.js', 'assets/platform-auth.js', 'index.html', 'sw.js']) {
    const bytes = await fs.readFile(path.join(site, name)); assert.deepEqual(bytes, await fs.readFile(path.join(project, name)));
    report.preparedSHA256[name] = digest(bytes);
  }
  report.servedUIWithProbeSHA256 = digest(Buffer.concat([await fs.readFile(path.join(site, 'assets/life/ui.js')), Buffer.from(mountProbe)]));
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
  async function check(name, run, width = 1440) {
    if (process.env.SHELL_REVERIFY_MATCH && !new RegExp(process.env.SHELL_REVERIFY_MATCH).test(name)) return;
    const fake = new FakeCloud(), authRequests = [], gates = [], device = 'c2-' + report.checks.length;
    const context = await makeContext(browser, fake, device, accounts.a, { viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    const initialErrors = [report.pageErrors.length, report.consoleErrors.length, report.external.length];
    const gate = (skip = 0, owner = accounts.a.id) => {
      let enter, release, finish;
      const value = { skip, owner, used: false, entered: new Promise(resolve => { enter = resolve; }), released: new Promise(resolve => { release = resolve; }), finished: new Promise(resolve => { finish = resolve; }), enter, release, finish };
      gates.push(value); return value;
    };
    await context.route('**/*', route => { const origin = new URL(route.request().url()).origin;
      if ([new URL(base).origin, cloud].includes(origin)) return route.fallback(); report.external.push({ name, origin }); return route.abort('blockedbyclient'); });
    await context.route(cloud + '/auth/v1/user', async route => {
      const owner = fake.libraryOwner(route.request()), request = { owner, completed: false }; authRequests.push(request);
      const held = gates.find(value => !value.used && value.owner === owner);
      let holding = null;
      if (held && held.skip-- <= 0) { holding = held; held.used = true; held.enter(request); await held.released; }
      try { await route.fallback(); request.completed = true; } finally { holding?.finish(); }
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.pageErrors.push({ name, message: error.message }));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ name, message: message.text() }); });
    try {
      console.log('RUN ' + name); await page.goto(base + '/index.html?section=records'); await ready(page); await run({ page, context, fake, gate, authRequests });
      assert.deepEqual([report.pageErrors.length, report.consoleErrors.length, report.external.length], initialErrors, 'No filtered console/page/external errors');
      report.checks.push({ name, pass: true, authRequests, mountProbe: 'delegates original UI.mount and optional one original storage.read' }); console.log('PASS ' + name);
    } catch (error) {
      report.checks.push({ name, pass: false, error: error.stack, authRequests }); console.error('FAIL ' + name + '\n' + error.stack);
      await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png') }).catch(() => {});
    } finally { gates.forEach(value => value.release()); await context.close(); report.closedContexts++; }
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
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve)); report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  assert(report.checks.length > 0); assert(report.checks.every(check => check.pass), 'Shell re-verification failures are recorded in report.json');
}
main().catch(error => { console.error(error.stack); server.close(); process.exitCode = 1; });

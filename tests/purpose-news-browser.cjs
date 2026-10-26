/* Purpose-based news settings and explicit handoff. Actual application bytes,
 * bundled SDK and account-scoped IndexedDB; only config, account HTTP and public
 * feed HTTP are anonymous fixtures. One targeted native IDB transaction abort
 * exercises failure/retry. IME events are simulated, not physical-device input. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { CompositionCloud } = require('./composition-sync-browser.cjs');
const { accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const Core = require('../assets/life/core.js');
const Workbench = require('../assets/life/workbench.js');
const Metadata = require('../assets/life/library-meta.js');
const repo = path.resolve(__dirname, '..');
const output = path.resolve(process.env.PURPOSE_NEWS_OUTPUT || '.local/purpose-news');
const sha = value => createHash('sha256').update(value).digest('hex');
const workspaceId = 'a1000000-0000-4000-8000-000000000001';
const privateTopic = '뉴스목적검수_개인관심_전송금지';
const raw = '\ufeff# 보존할 정확 자료\r\nCafe\u0301 😀 원문은 바꾸지 않습니다.\r\n';
const products = ['assets/life/discovery-ui.js', 'assets/life/discovery.css', 'assets/life/ui.js', 'assets/life/storage.js', 'assets/life/shell.js', 'assets/life/account-library.js', 'assets/platform-auth.js', 'assets/haedo-navigation.js'];
const hashes = async () => Object.fromEntries(await Promise.all(products.map(async file => [file, sha(await fs.readFile(path.join(repo, file)))])));
const report = { createdAt: new Date().toISOString(), scope: 'Unmodified product modules, real bundled SDK/IndexedDB, synthetic capability-1 account and metadata feed HTTP; no real account, production SQL/RLS, publisher, physical device or usefulness claim.', checks: [], consoleErrors: [], pageErrors: [], externalRequests: [], privateLeaks: [], staticResponses: [], staticErrors: [], feedRequests: [], nativeIDBAborts: 0, closedContexts: 0, browserClosed: false };
function fixture() {
  const now = new Date().toISOString(), rights = { mode: 'metadata_only', label: '합성 제목·링크', url: 'https://d2.naver.com/' };
  const source = { id: 'naver-d2', name: '합성 공개 출처', url: 'https://d2.naver.com/', feedUrl: 'https://d2.naver.com/purpose-feed', language: 'ko', rights, status: 'ok', stale: false, error: null, lastSuccessAt: now, lastAttemptAt: now };
  return { schemaVersion: 1, generatedAt: now, sources: [source], articles: [
    ['first', '언어 연구와 읽기 기록', 'ko', ['언어', '연구']],
    ['second', 'Language research and reading advice', 'en', ['language', 'research']],
    ['third', '도시와 독서 공간 이야기', 'ko', ['도시']]
  ].map(([id, title, language, tags], index) => ({ id, title, language, tags, sourceId: source.id, url: 'https://d2.naver.com/purpose-news/' + id, author: null, publishedAt: new Date(Date.now() - index * 86400000).toISOString(), fetchedAt: now, summary: '', coverage: 'link_only', rights })) };
}
// This installed Playwright resolves async waitForFunction promises without
// polling their fulfilled boolean. Await page.evaluate in Node instead.
async function waitForState(page, predicate, value, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const result = await page.evaluate(predicate, value);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Purpose news state did not settle within 15000ms: ' + label);
}
const idle = page => page.waitForFunction(() => document.querySelector('#discoveryReview')?.getAttribute('aria-busy') === 'false');
async function reveal(control) {
  const page = control.page(), inSettings = await control.evaluate(element => !!element.closest('#discoveryNewsSettingsPanel'));
  const settings = page.locator('#discoveryNewsSettingsPanel');
  if (inSettings && !await settings.isVisible()) await page.locator('#discoveryNewsSettings').click();
  else if (!inSettings && await settings.isVisible()) await page.locator('#discoveryNewsSettingsBack').click();
  const count = await control.locator('xpath=ancestor::details').count();
  for (let index = count; index > 0; index--) {
    const details = control.locator('xpath=ancestor::details[' + index + ']');
    if (!await details.evaluate(element => element.open)) await details.locator(':scope > summary').click();
  }
  return control;
}
async function snapshot(page) {
  return page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.getActive(); return { bundle: await s.read(w), interest: await s.readInterestProfile(w), actions: await s.readDiscoveryActions(w), feedback: await s.readDiscoveryProfile(w), language: await s.readDiscoveryLanguageSettings(w) }; });
}
async function syncReceipt(page, server) {
  const local = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, active = await s.getActive(); return { active, owner: s.account, bundle: await s.read(active), sync: await s.getSyncState(active), library: await HaedoLife.Shell.accountLibrary.getState(active) }; });
  return { local, remoteRows: [...server.rows.entries()], sourceRequests: structuredClone(server.requests), libraryRequests: structuredClone(server.libraryRequests) };
}
async function main() {
  await assert.rejects(fs.access(output), 'Evidence directory must be fresh'); await fs.mkdir(output, { recursive: true });
  report.productsBefore = await hashes(); report.runnerSHA256 = sha(await fs.readFile(__filename));
  let bundle = Core.createWorkspace({ workspaceId, title: '뉴스 목적 검수 자료공간' });
  const prepared = await Core.prepareImport({ origin: 'obsidian', title: '정확 원문 보존', text: raw, authorRelation: 'self', forceSeparate: true }, bundle);
  bundle = Core.applyChanges(bundle, Core.buildImportChanges(bundle, prepared));
  const server = new CompositionCloud().enableAccountLibrary(), key = server.key(accounts.a.id, workspaceId);
  server.rows.set(key, { owner_id: accounts.a.id, id: workspaceId, title: bundle.title, revision: 1, data: structuredClone(bundle), updated_at: bundle.updatedAt });
  server.compositions.set(key, { workspace_id: workspaceId, revision: 1, source_revision: 1, data: Workbench.empty(workspaceId), updated_at: bundle.updatedAt });
  server.libraryMetadata.set(key, { workspace_id: workspaceId, revision: 1, source_revision: 1, data: Metadata.empty(workspaceId), updated_at: bundle.updatedAt });
  server.libraryDefaults.set(accounts.a.id, { workspaceId, defaultRevision: 1, initialHash: null, initialRevision: null });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] }); report.browser = browser.version();
  const context = await makeContext(browser, server, 'purpose-news', accounts.a, { viewport: { width: 820, height: 1000 }, reducedMotion: 'reduce' });
  const feed = fixture(), pendingResponses = new Set();
  await context.route(base + '/assets/life/discovery-feed.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }));
  await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.externalRequests.push(url.origin + url.pathname); return route.abort('blockedbyclient'); });
  context.on('request', request => {
    const url = new URL(request.url()), body = request.postData() || '';
    if ([privateTopic, encodeURIComponent(privateTopic), JSON.stringify(privateTopic).slice(1, -1)].some(value => request.url().includes(value) || body.includes(value))) report.privateLeaks.push(url.origin + url.pathname);
    if (url.origin === new URL(base).origin && url.pathname === '/assets/life/discovery-feed.json') report.feedRequests.push({ method: request.method(), query: url.search, body: request.postData(), auth: request.headers().authorization || null });
  });
  context.on('response', response => {
    const url = new URL(response.url()); if (url.origin !== new URL(base).origin || !/\.(js|css|html)$/.test(url.pathname) || url.pathname === '/assets/platform-config.js') return;
    const work = (async () => { try { const bytes = await response.body(), file = url.pathname.slice(1), expected = await fs.readFile(path.join(repo, file)); assert.equal(sha(bytes), sha(expected), file + ' actual response'); report.staticResponses.push({ file, sha256: sha(bytes), bytes: bytes.length }); } catch (error) { report.staticErrors.push({ path: url.pathname, message: error.message }); } })();
    pendingResponses.add(work); work.finally(() => pendingResponses.delete(work));
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push(event.text()); }); page.on('pageerror', error => report.pageErrors.push(error.message));
  async function check(name, run) { console.log('RUN ' + name); try { await run(); report.checks.push({ name, pass: true }); console.log('PASS ' + name); } catch (error) { report.checks.push({ name, pass: false, error: error.stack }); await page.screenshot({ path: path.join(output, 'first-failure.png'), fullPage: true }).catch(() => {}); throw error; } }
  try {
    await page.goto(base + '/index.html?section=news'); await ready(page); await idle(page);
    report.initialSync = await syncReceipt(page, server);
    const initial = await snapshot(page); assert.equal(initial.bundle.sourceVersions[0].contentText, raw);
    await check('purpose settings keep one real sort control, preserve composing input and recover an actual aborted save', async () => {
      await page.locator('#discoveryNewsSettings').click();
      assert.deepEqual(await page.locator('#discoveryNewsSettingsPanel details').evaluateAll(nodes => nodes.filter(node => !node.parentElement.closest('details')).map(node => node.id)), ['discoveryTopics', 'discoveryLanguageOptions', 'discoveryNewsPreferences', 'discoveryOptions', 'discoveryRecords']);
      assert.equal(await page.locator('#discoveryNewsSettingsPanel [data-discovery-mode]').count(), 0); assert.equal(await page.locator('#discoverySort').count(), 1);
      const input = await reveal(page.locator('#discoveryTopicInput')); await input.focus();
      await input.evaluate((element, value) => { window.__purposeTopicNode = element; element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); element.value = value; element.setSelectionRange(2, 6); element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: value })); }, privateTopic);
      await (await reveal(page.locator('#discoveryRefresh'))).click(); await idle(page);
      assert.deepEqual(await input.evaluate(element => ({ same: element === __purposeTopicNode, value: element.value, start: element.selectionStart, end: element.selectionEnd })), { same: true, value: privateTopic, start: 2, end: 6 });
      await input.dispatchEvent('compositionend', { data: privateTopic });
      await page.evaluate(() => { const original = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { const result = original.apply(this, args); if (this.name === 'meta' && args[0]?.key?.startsWith('interestProfile:')) { IDBObjectStore.prototype.put = original; window.__purposeIDBAborts = (window.__purposeIDBAborts || 0) + 1; this.transaction.abort(); } return result; }; });
      await (await reveal(page.locator('#discoveryTopicAdd'))).click(); await page.locator('#discoveryTopicRetry').waitFor({ state: 'visible' }); await idle(page);
      assert.equal(await input.inputValue(), privateTopic); assert.equal(await input.evaluate(element => element === __purposeTopicNode), true); assert.deepEqual((await snapshot(page)).interest, initial.interest);
      await page.locator('#discoveryTopicRetry').click(); await idle(page);
      await waitForState(page, async value => { const s = HaedoLife.Shell.storage; return (await s.readInterestProfile(await s.getActive())).manual.some(row => row.label === value); }, privateTopic, 'manual topic committed');
      report.nativeIDBAborts = await page.evaluate(() => __purposeIDBAborts); assert.equal(report.nativeIDBAborts, 1); assert.deepEqual((await snapshot(page)).bundle, initial.bundle);
      await page.locator('#discoveryTopicRelated').click(); await idle(page); assert.equal(await page.locator('#discoveryNewsSettingsPanel').isVisible(), false); assert.equal(await page.locator('#discoverySort').inputValue(), 'related'); assert.equal(await page.evaluate(() => document.activeElement.id), 'discoverySort');
      await page.locator('#discoverySort').selectOption('latest'); await idle(page);
    });
    await check('language and record management preserve feed order, explicit reaction semantics and translation off', async () => {
      const before = await snapshot(page), order = await page.locator('#discoveryList [data-discovery-id]').evaluateAll(nodes => nodes.map(node => node.dataset.discoveryId));
      await (await reveal(page.locator('#discoveryTranslationLanguage'))).selectOption('ko'); await idle(page);
      await page.locator('#discoveryNewsSettingsBack').click(); assert.equal(await page.locator('#discoveryList [data-discovery-translate]').count(), 3);
      const first = page.locator('#discoveryList [data-discovery-id="first"]'); await first.locator('[data-discovery-reaction="bookmarked"]').click(); await idle(page);
      let after = await snapshot(page); assert.equal(after.actions.entries[0].bookmarked, true); assert.equal(after.actions.entries[0].liked, false); assert.equal(after.actions.personalizationEnabled, false); assert.deepEqual(after.bundle, before.bundle);
      assert.deepEqual(await page.locator('#discoveryList [data-discovery-id]').evaluateAll(nodes => nodes.map(node => node.dataset.discoveryId)), order);
      await first.locator('[data-discovery-reaction="bookmarked"]').click(); await idle(page); await (await reveal(page.locator('#discoveryCancelled'))).click(); await idle(page);
      assert.equal(await page.locator('#discoveryList [data-discovery-id="first"]').count(), 1); after = await snapshot(page); assert.deepEqual(after.feedback, before.feedback);
      await page.locator('#discoveryDiscover').click(); await idle(page);
      await (await reveal(page.locator('#discoveryTranslationLanguage'))).selectOption('original'); await idle(page);
      assert.equal(await page.locator('[data-discovery-translate]').count(), 0); await page.locator('#discoveryNewsSettingsBack').click();
      assert.deepEqual((await snapshot(page)).bundle, initial.bundle); assert.equal(await page.evaluate(() => document.activeElement.id), 'discoveryNewsSettings');
    });
    await check('article handoff requires review and explicit storage, preserves exact originals and returns to news', async () => {
      const before = await snapshot(page), first = page.locator('#discoveryList [data-discovery-id="first"]');
      const action = await reveal(first.locator('[data-discovery-import]')); assert.equal(await action.innerText(), '링크를 자료실에 보관'); await action.click();
      await page.locator('#lifeImportTitle').waitFor(); assert.equal(await page.locator('#lifeImportText').inputValue(), ''); assert.deepEqual((await snapshot(page)).bundle, before.bundle);
      await page.getByRole('button', { name: '원문·출처 확인', exact: true }).click(); await page.locator('.life-review').waitFor(); assert.deepEqual((await snapshot(page)).bundle, before.bundle);
      await page.getByRole('button', { name: '자료만 보관', exact: true }).click(); await page.locator('.life-reader').waitFor();
      report.afterSaveSync = await syncReceipt(page, server);
      const after = await snapshot(page), added = after.bundle.sources.find(source => source.url === feed.articles[0].url); assert(added);
      assert.equal(after.bundle.sources.length, before.bundle.sources.length + 1); const version = after.bundle.sourceVersions.find(value => value.sourceId === added.id); assert.equal(version.contentText, null); assert.equal(version.coverage.status, 'link_only');
      for (const old of before.bundle.sourceVersions) assert.deepEqual(after.bundle.sourceVersions.find(value => value.id === old.id), old);
      for (const key of ['interest', 'actions', 'feedback', 'language']) assert.deepEqual(after[key], before[key]);
      await page.getByRole('button', { name: /뉴스로 돌아가기|새 글 찾기로 돌아가기/ }).click(); await idle(page);
      assert.equal(new URL(page.url()).searchParams.get('section'), 'news'); assert.equal(await page.locator('#discoverySort').inputValue(), 'latest');
      assert.equal(await page.locator('#discoveryList [data-discovery-id="first"]').count(), 0, 'Stored URL excluded from the discover pool');
      report.ack = await waitForState(page, async ({ id, revision, remoteRevision }) => {
        const state = await HaedoLife.Shell.accountLibrary.getState(id), sources = state.domains.sources;
        return state.status === 'synced' && sources?.binding?.remoteId === id && sources.syncedLocalRevision >= revision && sources.remoteRevision > remoteRevision ? state : false;
      }, { id: workspaceId, revision: after.bundle.revision, remoteRevision: report.initialSync.local.sync.remoteRevision }, 'exact committed source revision acknowledged');
      report.beforeRemoteAssertionSync = await syncReceipt(page, server);
      const remote = server.row(accounts.a.id, workspaceId); assert(remote.data.sources.some(source => source.id === added.id));
      for (const old of before.bundle.sourceVersions) assert.deepEqual(remote.data.sourceVersions.find(value => value.id === old.id), old);
    });
    await Promise.all([...pendingResponses]);
    for (const key of ['consoleErrors', 'pageErrors', 'externalRequests', 'privateLeaks', 'staticErrors']) assert.deepEqual(report[key], [], key);
    assert.deepEqual(server.libraryRouteErrors, []); assert(report.staticResponses.some(row => row.file === 'assets/life/discovery-ui.js'));
    assert(report.feedRequests.every(row => row.method === 'GET' && !row.query && row.body === null && row.auth === null)); report.pass = true;
  } finally {
    await Promise.allSettled([...pendingResponses]); await context.close(); report.closedContexts++; await browser.close(); report.browserClosed = true;
    report.productsAfter = await hashes(); report.productsUnchangedDuringRun = JSON.stringify(report.productsBefore) === JSON.stringify(report.productsAfter); report.runnerUnchanged = report.runnerSHA256 === sha(await fs.readFile(__filename));
    report.syntheticHTTP = { accountCapability: server.libraryCapabilities, sourceRequests: server.requests.length, libraryRequests: server.libraryRequests.length, libraryRouteErrors: server.libraryRouteErrors };
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  assert.equal(report.productsUnchangedDuringRun, true, 'Product freeze during run'); assert.equal(report.runnerUnchanged, true); assert.equal(report.pass, true); console.log('Purpose news: ' + report.checks.length + ' passed.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

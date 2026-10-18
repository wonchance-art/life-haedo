/* Actual app/SDK/IndexedDB with anonymous generated vaults and intercepted Auth.
 * No private vaults, screenshots, source fetches or production writes.
 * BASE_URL=http://127.0.0.1:4173 PW_MODULE_PATH=/existing/playwright node tests/source-classification-browser.cjs
 */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4173';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixture } = require('./fixtures/source-classification.cjs');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, shellReady, settle, nav, observe } = require('./unified-home-browser.cjs');
const out = path.resolve('.local/source-classification');
const report = { createdAt: new Date().toISOString(), scope: 'Generated anonymous Obsidian Markdown only; actual app/SDK/IndexedDB and two tabs, intercepted Auth HTTP. No private notes, screenshots, operating SQL, source fetches, Apple hardware or native IME.', checks: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0, realRemoteWrites: 0 };
const cards = page => page.locator('#lifeSearchResults .life-source-card');
const classState = page => page.evaluate(async () => { const s = HaedoLife.Shell.storage; return s.readSourceClassification(await s.getActive()); });
async function fingerprint(page) {
  return page.evaluate(async () => { const s = HaedoLife.Shell.storage, bundle = await s.read(await s.getActive()); const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(bundle))); return { hash: [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join(''), sources: bundle.sources.length, versions: bundle.sourceVersions.length, records: bundle.records.length }; });
}
async function instrument(context) {
  await context.addInitScript(() => {
    window.__classificationReads = []; window.__classificationHoldRead = false; window.__classificationReadPending = 0; window.__classificationReadReleases = [];
    window.__classificationHoldDigest = false; window.__classificationDigestPending = 0; window.__classificationDigestReleases = [];
    window.__classificationHoldPostSaveDigest = false;
    const digest = SubtleCrypto.prototype.digest;
    SubtleCrypto.prototype.digest = async function (...args) { const value = await digest.apply(this, args); if (__classificationHoldDigest) { __classificationDigestPending++; await new Promise(resolve => __classificationDigestReleases.push(resolve)); } return value; };
    window.__classificationReleaseReads = () => { __classificationHoldRead = false; __classificationReadReleases.splice(0).forEach(resolve => resolve()); };
    window.__classificationReleaseDigests = () => { __classificationHoldDigest = false; __classificationDigestReleases.splice(0).forEach(resolve => resolve()); };
  });
  await context.route('**/assets/life/storage.js', async route => {
    const response = await route.fetch();
    const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,async readSourceClassification(...values){__classificationReads.push({workspaceId:values[0],userId:actual.account.userId});const result=await actual.readSourceClassification(...values);if(__classificationHoldRead){__classificationReadPending++;await new Promise(resolve=>__classificationReadReleases.push(resolve));}return result;},async saveSourceClassification(...values){const result=await actual.saveSourceClassification(...values);if(__classificationHoldPostSaveDigest&&result.status==='stored')__classificationHoldDigest=true;return result;}});}});})();`;
    await route.fulfill({ response, body: await response.text() + hook });
  });
}
async function manager(page) {
  await page.locator('#sourceClassification').waitFor();
  if (!await page.locator('#sourceClassification').evaluate(element => element.open)) await page.locator('#sourceClassification > summary').click();
  await page.locator('#sourceClassificationFile').waitFor();
  await page.locator('#sourceClassification .sc-panel-content[aria-busy="false"]').waitFor();
}
async function upload(page, value) {
  await manager(page);
  await page.locator('#sourceClassificationFile').setInputFiles({ name: 'anonymous-classification.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await page.locator('#sourceClassificationApply').waitFor();
}
async function applied(page, previous = 0) {
  await page.waitForFunction(async previous => { const s = HaedoLife.Shell.storage, state = await s.readSourceClassification(await s.getActive()); return state.revision > previous && !!state.manifest; }, previous);
  await settle(page);
}
async function apply(page, full, previous = 0) { await upload(page, full); await page.locator('#sourceClassificationApply').click(); await applied(page, previous); }
async function resetFilters(page) { for (const key of ['Source', 'Topic', 'Kind', 'Review']) await page.locator('#sourceClassification' + key).selectOption(''); }
async function failWrites(page, enabled) {
  await page.evaluate(enabled => {
    window.__classificationPut ||= IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = enabled ? function (value, ...args) { const request = __classificationPut.call(this, value, ...args); if (this.name === 'meta' && String(value?.key).startsWith('sourceClassification:')) this.transaction.abort(); return request; } : __classificationPut;
  }, enabled);
}
async function seed(page, f, { oldVersion = true } = {}) {
  await page.goto(base + '/index.html?section=records'); await ready(page);
  const result = await page.evaluate(async ({ backup, oldVersion }) => {
    const s = HaedoLife.Shell.storage, c = HaedoLife.Core;
    const first = await c.restoreBackup(backup), second = await c.restoreBackup(backup); await s.installWorkspaces([first, second]);
    let bundle = await s.read(first.workspaceId), latestVersion = null;
    const refs = bundle.sources.map(source => ({ path: source.sourceKey, sourceId: source.id, versionId: bundle.sourceVersions.find(version => version.sourceId === source.id).id }));
    if (oldVersion) {
      const source = bundle.sources.find(source => source.sourceKey === 'notes/이전 버전.md');
      const prepared = await c.prepareImport({ origin: 'obsidian', title: source.title, fileName: source.sourceKey, url: source.url, existingSourceId: source.id, text: '합성공통 새 버전은 이전 원문과 다른 문장입니다. 🌱', authorRelation: 'unknown', format: 'text/markdown' }, bundle);
      const saved = await s.commitLocal({ workspaceId: bundle.workspaceId, baseRevision: bundle.revision, operationId: c.id(), changes: c.buildImportChanges(bundle, prepared) }); if (saved.status !== 'stored') throw Error('Synthetic immutable version fixture failed'); latestVersion = prepared.version.id;
    }
    return { workspaceId: first.workspaceId, otherWorkspaceId: second.workspaceId, refs, latestVersion };
  }, { backup: f.backup, oldVersion });
  await page.reload(); await ready(page); await page.locator('#lifeSearch').waitFor(); await page.locator('#sourceClassification').waitFor();
  return result;
}
async function directSave(page, full, revision = 0) {
  return page.evaluate(async ({ full, revision }) => { const s = HaedoLife.Shell.storage, m = HaedoLife.SourceClassification.parse(full); return s.saveSourceClassification(await s.getActive(), m, revision); }, { full, revision });
}

async function main() {
  await fs.mkdir(out, { recursive: true });
  const f = await fixture();
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] }); report.browser = browser.version();
  async function check(name, run, { width = 1440, account = accounts.a } = {}) {
    if (process.env.CLASSIFICATION_TEST_MATCH && !new RegExp(process.env.CLASSIFICATION_TEST_MATCH).test(name)) return;
    const server = new FakeCloud(), device = 'classification-' + report.checks.length;
    const context = await makeContext(browser, server, device, account, { viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width <= 820, reducedMotion: 'reduce' });
    await instrument(context);
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push(url.origin); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(15000); observe(page, report, name);
    try { const evidence = await run({ page, context, server, device }); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true, evidence }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
    finally { await context.close(); }
  }
  try {
    for (const width of [1440, 390]) await check('explicit review/apply, four intersecting filters, exact old reader/back, sanitized export and reload ' + width, async ({ page }) => {
      const refs = await seed(page, f), before = await fingerprint(page);
      await upload(page, f.full); assert.deepEqual(await classState(page), { revision: 0, manifest: null });
      assert.equal((await fingerprint(page)).hash, before.hash); await page.locator('#sourceClassificationApply').click(); await applied(page);
      const saved = await classState(page); assert.equal(saved.revision, 1); assert.equal(saved.manifest.format, 'life-source-classification-v1'); assert(!JSON.stringify(saved).includes(f.rawMarker));
      await page.locator('#lifeSearch').fill('합성공통'); await page.waitForFunction(() => document.querySelectorAll('#lifeSearchResults .life-source-card').length === 40); await page.locator('#lifeSearchMore').click(); assert.equal(await cards(page).count(), 80);
      await page.locator('#sourceClassificationSource').selectOption('source-0'); await page.locator('#sourceClassificationKind').selectOption('note'); await page.locator('#sourceClassificationTopic').selectOption('reading'); await page.locator('#sourceClassificationReview').selectOption('needs_review');
      const expected = f.full.records.filter(row => row.source.id === 'source-0' && row.kind.id === 'note' && row.primaryTopic === 'reading' && row.reviewReasons.length);
      assert.equal(await cards(page).count(), expected.length); await page.locator('#lifeSearch').fill('찾을표식'); assert.equal(await cards(page).count(), expected.filter(row => f.refs.find(ref => ref.path === row.path).text.includes('찾을표식')).length);
      await resetFilters(page); await page.locator('#lifeSearch').fill('합성공통'); await page.locator('#sourceClassificationReview').selectOption('unclassified');
      const unclassified = refs.refs.find(ref => ref.path === f.full.records.find(row => row.isContent && row.primaryTopic === 'unclassified').path);
      assert.equal(await cards(page).count(), 1); assert.equal(await cards(page).first().getAttribute('data-version-id'), unclassified.versionId);
      await resetFilters(page); await page.locator('#lifeSearch').fill('이전원문의끝표식🌱');
      await page.locator('#sourceClassificationSource').selectOption('source-0'); await page.locator('#sourceClassificationKind').selectOption('saved-text'); await page.locator('#sourceClassificationTopic').selectOption('reading');
      const old = refs.refs.find(ref => ref.path === 'notes/이전 버전.md'), entry = page.locator(`.life-source-open[data-version-id="${old.versionId}"]`); await entry.waitFor(); await entry.scrollIntoViewIfNeeded(); await entry.focus();
      await entry.evaluate(element => element.addEventListener('click', () => { const box = element.getBoundingClientRect(); window.__classificationReturnOrigin = { key: element.dataset.focusKey, y: scrollY, documentHeight: document.documentElement.scrollHeight, rowHeight: box.height, managerOpen: document.querySelector('#sourceClassification').open }; }, { capture: true, once: true }));
      await entry.click(); const origin = await page.evaluate(() => __classificationReturnOrigin); await page.locator('#lifeSourceText').waitFor();
      assert.equal(await page.locator('#lifeSourceText').textContent(), f.refs[2].text); assert.equal(await page.locator('#lifeVersion').inputValue(), old.versionId);
      await page.locator('#lifeSourceInfoToggle').click(); assert.match(await page.locator('#lifeSourceDetails').innerText(), /익명 출처 1/);
      await page.locator('#lifeSearchReturn').click(); await page.locator('#lifeSearch').waitFor();
      try { await page.waitForFunction(origin => document.activeElement?.dataset.focusKey === origin.key && Math.abs(scrollY - origin.y) < 2, origin); }
      catch (_) { const returned = await page.evaluate(() => ({ key: document.activeElement?.dataset.focusKey, y: scrollY, maxY: document.documentElement.scrollHeight-innerHeight, managerOpen: document.querySelector('#sourceClassification').open })); throw Error('Exact return mismatch: ' + JSON.stringify({ origin, returned })); }
      assert.equal(await page.locator('#lifeSearch').inputValue(), '이전원문의끝표식🌱');
      assert.equal(await page.locator('#sourceClassificationSource').inputValue(), 'source-0'); assert.equal(await page.locator('#sourceClassificationKind').inputValue(), 'saved-text'); assert.equal(await page.locator('#sourceClassificationTopic').inputValue(), 'reading');
      await manager(page); const download = page.waitForEvent('download'); await page.locator('#sourceClassificationExport').click(); const text = await fs.readFile(await (await download).path(), 'utf8'), exported = JSON.parse(text);
      assert.equal(exported.format, 'life-source-classification-v1'); assert(!text.includes(f.rawMarker)); assert(!text.includes('contentText')); assert(!text.includes('preview')); assert(!text.includes('copyPath')); assert(!text.includes('authorship')); assert.deepEqual(exported, saved.manifest);
      await page.reload(); await ready(page); await manager(page); assert.deepEqual(await classState(page), saved); assert.deepEqual(await fingerprint(page), before);
      assert.equal(await page.evaluate(() => !!window.__classificationSourceExecuted), false);
      return { generatedContentNotes: 96, generatedSupportingMetadata: 1, originalVersions: 98, explicitSave: true, intersectingResults: expected.length, unclassifiedFilterExcludedSupportingMetadata: true, exactReturnScrollY: origin.y, priorVersionsUnchanged: true, exportedOnlyNormalizedMetadata: true };
    }, { width });

    await check('wrong commit/path/hash and changed actual bytes never match by title; another workspace has no automatic classification', async ({ page }) => {
      const refs = await seed(page, f, { oldVersion: false }), before = await fingerprint(page);
      const result = await page.evaluate(async ({ full, otherCommit }) => {
        const s = HaedoLife.Shell.storage, c = HaedoLife.SourceClassification, b = await s.read(await s.getActive()), variants = [];
        for (const mode of ['commit', 'path', 'hash', 'actualBytes']) {
          const input = structuredClone(full), bundle = structuredClone(b);
          if (mode === 'commit') input.sourceCommit = otherCommit;
          if (mode === 'path') input.records.forEach(row => { row.path = 'different/' + row.path; });
          if (mode === 'hash') input.records.forEach(row => { row.sha256 = '0'.repeat(64); });
          if (mode === 'actualBytes') bundle.sourceVersions.forEach(row => { row.contentText += ' 変更された合成本文'; });
          const p = await c.project(bundle, c.parse(input)); variants.push({ mode, matched: p.matched, mappedVersions: p.byVersion.size, stale: p.stale, unmatched: p.unmatched });
        }
        return variants;
      }, { full: f.full, otherCommit: f.otherCommit });
      for (const variant of result) { assert.equal(variant.matched, 0, variant.mode); assert.equal(variant.mappedVersions, 0, variant.mode); }
      await apply(page, f.full); await nav(page, 'manage'); await page.locator('#lifeCurrentWorkspace').click(); await page.locator('#lifeWorkspace').selectOption(refs.otherWorkspaceId); await settle(page); await nav(page, 'records');
      assert.deepEqual(await classState(page), { revision: 0, manifest: null }); assert.equal(await page.locator('#sourceClassificationSource option[value="source-0"]').count(), 0);
      await nav(page, 'manage'); await page.locator('#lifeCurrentWorkspace').click(); await page.locator('#lifeWorkspace').selectOption(refs.workspaceId); await settle(page); await nav(page, 'records'); assert.deepEqual(await fingerprint(page), before);
      return { rejectedIdentityVariants: result, sameTitledDistinctPaths: true, workspaceAutomaticCarryover: false };
    });

    await check('failed metadata writes preserve review and originals; explicit clear leaves a tombstone rejecting delayed saves', async ({ page }) => {
      await seed(page, f); const before = await fingerprint(page); await upload(page, f.full); await failWrites(page, true); await page.locator('#sourceClassificationApply').click(); await page.locator('#sourceClassificationError:not([hidden])').waitFor();
      assert.deepEqual(await classState(page), { revision: 0, manifest: null }); assert.deepEqual(await fingerprint(page), before); assert(await page.locator('#sourceClassificationPreview').isVisible());
      await failWrites(page, false); await page.locator('#sourceClassificationApply').click(); await applied(page); const saved = await classState(page);
      await manager(page); await page.locator('#sourceClassificationClear').click(); assert.deepEqual(await classState(page), saved); await page.locator('#sourceClassificationClearConfirm').click();
      await page.waitForFunction(async () => { const s = HaedoLife.Shell.storage, state = await s.readSourceClassification(await s.getActive()); return state.revision === 2 && state.manifest === null; });
      const stale = await page.evaluate(async saved => { const s = HaedoLife.Shell.storage; return s.saveSourceClassification(await s.getActive(), saved.manifest, saved.revision); }, saved);
      assert.equal(stale.status, 'conflict'); assert.deepEqual(stale.state, { revision: 2, manifest: null }); assert.deepEqual(await fingerprint(page), before);
      return { abortedWritePreservedInput: true, clearRequiredSeparateConfirmation: true, clearRevision: 2, delayedSaveStatus: stale.status };
    }, { width: 390 });

    await check('two real tabs race one CAS revision and cannot overwrite a later clear', async ({ page, context }) => {
      const refs = await seed(page, f), before = await fingerprint(page), second = await context.newPage(); observe(second, report, 'second classification tab'); await second.goto(base + '/index.html?section=records'); await ready(second);
      const manifest = await page.evaluate(full => HaedoLife.SourceClassification.parse(full), f.full);
      const previous = await Promise.all([page, second].map(p => p.evaluate(id => HaedoLife.Shell.storage.readSourceClassification(id), refs.workspaceId))); assert.deepEqual(previous.map(row => row.revision), [0, 0]);
      const results = await Promise.all([page, second].map((p, index) => p.evaluate(async ({ id, manifest, index }) => { const input = structuredClone(manifest); input.records[0].kind.label = '익명 경쟁 후보 ' + index; return HaedoLife.Shell.storage.saveSourceClassification(id, input, 0); }, { id: refs.workspaceId, manifest, index })));
      assert.equal(results.filter(row => row.status === 'stored').length, 1); assert.equal(results.filter(row => row.status === 'conflict').length, 1);
      const winner = results.find(row => row.status === 'stored').state;
      const cleared = await second.evaluate(id => HaedoLife.Shell.storage.clearSourceClassification(id, 1), refs.workspaceId); assert.equal(cleared.status, 'stored');
      const stale = await page.evaluate(async ({ id, manifest }) => HaedoLife.Shell.storage.saveSourceClassification(id, manifest, 1), { id: refs.workspaceId, manifest: winner.manifest }); assert.equal(stale.status, 'conflict'); assert.deepEqual(stale.state, cleared.state);
      await page.reload(); await ready(page); assert.deepEqual(await classState(page), cleared.state);
      await upload(page, f.full);
      await page.evaluate(id => { __classificationHoldPostSaveDigest = true; __classificationDigestPending = 0; window.__classificationPeerRevision = 0; HaedoLife.Shell.storage.subscribe(id, event => { if (event.type === 'source_classification_changed') __classificationPeerRevision = event.revision; }); }, refs.workspaceId);
      await page.locator('#sourceClassificationApply').click(); await page.waitForFunction(() => __classificationDigestPending > 0);
      assert.equal((await classState(page)).revision, 3);
      const latest = await second.evaluate(async ({ id, manifest }) => { const changed = structuredClone(manifest); changed.records.forEach(row => { row.kind = { id: 'peer-latest', label: '익명 다른 탭 최신 유형' }; }); return HaedoLife.Shell.storage.saveSourceClassification(id, changed, 3); }, { id: refs.workspaceId, manifest }); assert.equal(latest.status, 'stored');
      await page.waitForFunction(() => __classificationPeerRevision >= 4); await page.evaluate(() => { __classificationHoldPostSaveDigest = false; __classificationReleaseDigests(); });
      await page.locator('#sourceClassification .sc-panel-content[aria-busy="false"]').waitFor();
      assert.equal(await page.locator('#sourceClassificationKind option[value="note"]').count(), 0, 'A delayed post-save projection must not publish revision 3 over peer revision 4');
      await page.locator('#sourceClassificationRefresh').click(); await page.waitForFunction(() => !!document.querySelector('#sourceClassificationKind option[value="peer-latest"]'));
      assert.equal(await page.locator('#sourceClassificationKind option[value="note"]').count(), 0); assert.deepEqual(await classState(page), latest.state); assert.deepEqual(await fingerprint(page), before); await second.close();
      return { winningConcurrentWrites: 1, conflicts: 1, clearRevision: cleared.state.revision, staleRev1Rejected: true, delayedPostSaveRevision3SuppressedAfterPeerRevision4: true };
    });

    await check('late metadata reads and in-flight hashes cannot repaint newer metadata, navigation or workspace', async ({ page, context }) => {
      const refs = await seed(page, f); await directSave(page, f.full); await nav(page, 'tools');
      await page.evaluate(id => { window.__classificationPeerRevision = 0; HaedoLife.Shell.storage.subscribe(id, event => { if (event.type === 'source_classification_changed') __classificationPeerRevision = event.revision; }); }, refs.workspaceId);
      await page.evaluate(() => { __classificationHoldRead = true; }); await nav(page, 'records'); await page.waitForFunction(() => __classificationReadPending > 0);
      const peer = await context.newPage(); observe(peer, report, 'classification delayed-read peer'); await peer.goto(base + '/index.html?section=tools'); await ready(peer);
      await peer.evaluate(id => HaedoLife.Shell.storage.clearSourceClassification(id, 1), refs.workspaceId); await page.waitForFunction(() => __classificationPeerRevision >= 2); await page.evaluate(() => __classificationReleaseReads());
      await page.locator('#sourceClassification .sc-panel-content[aria-busy="false"]').waitFor({ state: 'attached' }); assert.equal(await page.locator('#sourceClassificationSource option[value="source-0"]').count(), 0, 'A held revision 1 read must not repaint after peer revision 2 clear');
      assert.deepEqual(await classState(page), { revision: 2, manifest: null }); await peer.close(); await directSave(page, f.full, 2); await nav(page, 'tools');
      await page.evaluate(() => { __classificationReadPending = 0; });
      await page.evaluate(() => { __classificationHoldRead = true; }); await nav(page, 'records'); await page.waitForFunction(() => __classificationReadPending > 0); await nav(page, 'tools'); await page.evaluate(() => __classificationReleaseReads()); await settle(page);
      assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'tools'); assert.equal(await page.locator('#sourceClassification').count(), 0);
      await nav(page, 'records'); await manager(page); await page.evaluate(() => { __classificationHoldDigest = true; });
      await page.locator('#sourceClassificationFile').setInputFiles({ name: 'held-synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(f.full)) });
      await page.waitForFunction(() => __classificationDigestPending > 0); await nav(page, 'tools'); await page.evaluate(() => __classificationReleaseDigests()); await settle(page); assert.equal(await page.locator('#sourceClassification').count(), 0);
      await page.evaluate(() => { __classificationHoldRead = true; __classificationReadPending = 0; }); await nav(page, 'records'); await page.waitForFunction(() => __classificationReadPending > 0);
      await nav(page, 'manage'); await page.locator('#lifeCurrentWorkspace').click(); await page.locator('#lifeWorkspace').selectOption(refs.otherWorkspaceId); await settle(page);
      await page.evaluate(() => { __classificationHoldRead = false; }); await nav(page, 'records'); await page.locator('#sourceClassification').waitFor(); await page.evaluate(() => __classificationReleaseReads()); await settle(page);
      assert.deepEqual(await classState(page), { revision: 0, manifest: null }); assert.equal(await page.locator('#sourceClassificationSource option[value="source-0"]').count(), 0); assert.equal(await page.locator('#sourceClassificationPreview:visible').count(), 0);
      return { staleReadAfterPeerClearBlocked: true, staleReadNavigationBlocked: true, staleHashNavigationBlocked: true, staleWorkspaceReadBlocked: true };
    });

    await check('signout during actual hashing clears private candidates and the next account cannot read them', async ({ page, server, device }) => {
      const refs = await seed(page, f); await directSave(page, f.full); await nav(page, 'tools'); await page.evaluate(() => { __classificationHoldDigest = true; }); await nav(page, 'records'); await page.waitForFunction(() => __classificationDigestPending > 0);
      await page.evaluate(() => { window.__classificationSignout = HaedoAuth.client.auth.signOut({ scope: 'local' }); }); await page.waitForFunction(() => document.querySelector('#lifeApp').hidden && !HaedoLife.Shell.storage);
      await page.evaluate(() => __classificationReleaseDigests()); await page.waitForFunction(() => !HaedoAuth.user); assert.doesNotMatch(await page.locator('body').innerText(), /익명 출처 1|익명 분류 자료실/);
      server.oauthAccounts.set(device, accounts.b); await page.locator('[data-life-return-login]').click(); await page.locator('#googleLogin').click(); await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page); await nav(page, 'records');
      assert.deepEqual(await classState(page), { revision: 0, manifest: null }); assert.equal(await page.locator('#sourceClassificationSource option[value="source-0"]').count(), 0);
      assert(await page.evaluate(async id => { try { await HaedoLife.Shell.storage.readSourceClassification(id); return false; } catch (_) { return true; } }, refs.workspaceId));
      return { sameContextAccountSwitch: true, inFlightHashDisposed: true, previousWorkspaceOwnerDenied: true };
    });

    await check('anonymous entry never opens account storage or reads a private classification', async ({ page }) => {
      await page.goto(base + '/index.html?section=records'); await shellReady(page); assert.equal(await page.locator('#lifeApp').isHidden(), true); assert.deepEqual(await page.evaluate(() => __homeDbOpens), []); assert.deepEqual(await page.evaluate(() => __classificationReads), []); assert.equal(await page.locator('#sourceClassification').count(), 0);
      return { privateIdbOpens: 0, classificationReads: 0 };
    }, { account: null });
  } finally { await browser.close(); report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(out, process.env.CLASSIFICATION_TEST_MATCH ? 'recheck-report.json' : 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); }
  const failed = report.checks.filter(check => !check.pass).length;
  console.log(JSON.stringify({ passed: report.checks.length - failed, failed, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length, realRemoteWrites: 0 }));
  if (failed || report.consoleErrors.length || report.pageErrors.length || report.external.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

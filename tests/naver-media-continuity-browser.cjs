/* Exact version/media continuity. Synthetic owner HTTP and independent IDB;
 * actual account-default managers, SDK, reader, photo validation and ZIP.
 * No real Naver, hosted account, physical second device or Apple claim. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, makeContext, ready, shellReady, settle } = require('./unified-home-browser.cjs');
const { accounts, session, base, cloud } = require('./life-sync-browser.cjs');
const { NaverMediaCloud } = require('./helpers/naver-media-cloud.cjs');
const { capturedRow, seedCapture, storedMedia, gate, arrived } = require('./life-naver-capture-browser.cjs');
const output = path.resolve(process.env.NAVER_MEDIA_CONTINUITY_OUTPUT || '.local/naver-media-continuity');
const sha = value => createHash('sha256').update(value).digest('hex');
const runtime = ['index.html', 'life.html', 'sw.js', 'assets/life/storage.js', 'assets/life/naver-capture-sync.js', 'assets/life/naver-media-receipt.js', 'assets/life/naver-media.js', 'assets/life/account-library.js', 'assets/life/ui.js'];
async function until(read, predicate, label) {
  const deadline = Date.now() + 20000; let value;
  do { value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 35)); } while (Date.now() < deadline);
  throw Error(label + ' did not become ready: ' + JSON.stringify(value));
}
const bundle = (page, ws) => page.evaluate(ws => HaedoLife.Shell.storage.read(ws), ws);
const acknowledged = (page, ws) => until(() => page.evaluate(ws => HaedoLife.Shell.accountLibrary.getState(ws), ws), state => state.status === 'synced' && ['sources', 'composition', 'metadata'].every(key => state.domains[key]?.status === 'synced'), 'Account library server ACK');
async function coreReady(page, ws, count) {
  return until(() => page.evaluate(async ws => { const s = HaedoLife.Shell.storage, b = await s.read(ws), state = await s.getSyncState(ws); return { b, state }; }, ws), value => value.b.sourceVersions.length >= count && value.state.status === 'synced' && value.state.binding?.remoteId === ws && value.state.syncedLocalRevision === value.b.revision, 'Exact core source ACK');
}
async function reader(page, ws, sourceId, versionId) {
  await page.goto(base + '/index.html?section=records&view=sources', { waitUntil: 'domcontentloaded' }); await ready(page); await settle(page);
  assert.equal(await page.evaluate(() => HaedoLife.Shell.storage.getActive()), ws);
  await page.locator('.life-source-open[data-source-id="' + sourceId + '"]').first().click(); await page.locator('#lifeSourceText').waitFor();
  const version = page.locator('#lifeVersion');
  if (await version.count() && await version.inputValue() !== versionId) await version.selectOption(versionId);
  await page.locator('#lifeSourceText').waitFor();
}
async function retrySpacing(page, selector) {
  const control = page.locator(selector); await control.scrollIntoViewIfNeeded();
  const retry = await control.boundingBox(), next = await page.locator('#lifeReaderRelatedEnd').boundingBox();
  assert(retry && next && next.y >= retry.y + retry.height + 8, 'Retry and following reader action must have an actual 8px gap');
  assert.equal(await control.evaluate(el => { const box = el.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return hit === el || el.contains(hit); }), true, 'Retry button must be reachable by a real pointer');
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const report = { pass: false, scope: 'Synthetic verified owner HTTP, independent account IDB contexts and actual SDK/account managers/reader/PNG/ZIP. No real Naver, production data or physical-device proof.', checks: [], screenshots: [], pageErrors: [], consoleErrors: [], expectedConsoleErrors: [], externalRequests: [] };
  const hashes = async () => Object.fromEntries(await Promise.all([...runtime, 'tests/naver-media-continuity-browser.cjs', 'tests/helpers/naver-media-cloud.cjs', 'tests/life-naver-capture-browser.cjs', 'tests/composition-sync-browser.cjs', 'tests/helpers/library-cloud.cjs'].map(async name => [name, sha(await fs.readFile(path.resolve(name)))])));
  report.hashesBefore = await hashes();
  for (const name of runtime) { const response = await fetch(base + '/' + name); assert(response.ok); assert.equal(sha(Buffer.from(await response.arrayBuffer())), report.hashesBefore[name], 'Served product bytes ' + name); }
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const server = new NaverMediaCloud(), contexts = []; let held;
  async function device(name, account = accounts.a) {
    const context = await makeContext(browser, server, name, null, { viewport: { width: 820, height: 1000 }, reducedMotion: 'reduce' }); contexts.push(context);
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.externalRequests.push(url.origin + url.pathname); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => report.pageErrors.push({ name, message: error.message }));
    page.on('console', message => { if (message.type() !== 'error') return; const value = { name, message: message.text(), url: message.location().url }; const mediaFailure = server.expectedHttpErrors && value.url.includes('/haedo-naver-originals/'), receiptFailure = server.failedReceiptWrites.has(name) && value.url === cloud + '/rest/v1/rpc/life_naver_media_receipt_put'; const expected = (mediaFailure || receiptFailure) && /status of 503/.test(value.message); (expected ? report.expectedConsoleErrors : report.consoleErrors).push(value); });
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' }); await shellReady(page); assert.deepEqual(await page.evaluate(() => __homeDbOpens), []);
    server.oauthAccounts.set(name, account); await page.goto(base + '/login.html?next=' + encodeURIComponent('index.html?section=records'), { waitUntil: 'domcontentloaded' }); await page.locator('#googleLogin').click(); await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page); await settle(page);
    assert.equal(await page.evaluate(() => HaedoAuth.user.id), account.id); assert((await page.evaluate(() => __homeDbOpens)).every(value => value.verified));
    await until(() => page.evaluate(() => HaedoLife.Shell.accountLibrary.getState()), value => value.mode === 'account' && value.status === 'synced', 'Default library automatically opens');
    return page;
  }
  const check = async (name, action) => { console.log('RUN ' + name); await action(); report.checks.push(name); console.log('PASS ' + name); };
  try {
    const a = await device('media-a'), initial = await seedCapture(a), ws = initial.workspaceId; server.setup(ws);
    const first = await capturedRow(initial.photoFiles), secondPhotos = initial.photoFiles.slice().reverse(), second = await capturedRow(secondPhotos, { title: first.payload.title }); second.id = 'eeeeeeee-eeee-4eee-8eee-000000900002';
    assert.equal(first.payload.bodyHash, second.payload.bodyHash); assert.notEqual(first.capture_hash, second.capture_hash);
    server.addCapture(first, initial.photoFiles); server.addCapture(second, secondPhotos);
    const adopt = captureId => a.evaluate(async ({ ws, captureId }) => { const h = HaedoLife, service = h.NaverCaptureSync.create({ storage: h.Shell.storage }); try { return await service.receiveCapture(ws, captureId); } finally { service.dispose(); } }, { ws, captureId });
    let one, two, expected;
    await check('A receives two identical-body different-photo versions and publishes immutable receipts only after exact source ACK', async () => {
      one = await adopt(first.id); two = await adopt(second.id); assert.equal(one.sourceId, two.sourceId); assert.notEqual(one.sourceVersionId, two.sourceVersionId);
      expected = await bundle(a, ws); await coreReady(a, ws, expected.sourceVersions.length); await acknowledged(a, ws);
      await until(() => server.mediaReceipts.size, count => count === 2, 'Automatic source-version receipt publication');
      assert.equal((await storedMedia(a, ws, one.sourceVersionId)).capture.capture_hash, first.capture_hash);
      assert.equal((await storedMedia(a, ws, two.sourceVersionId)).capture.capture_hash, second.capture_hash);
      assert.deepEqual(server.receiptErrors, []); report.versions = { first: one.sourceVersionId, second: two.sourceVersionId, identicalBodyHash: first.payload.bodyHash };
    });
    const b = await device('media-b'); await coreReady(b, ws, expected.sourceVersions.length);
    await check('Fresh B automatically receives the same source graph and lazily restores each exact photo version through the reader', async () => {
      const received = await bundle(b, ws); assert.deepEqual(received.sourceVersions, expected.sourceVersions); assert.deepEqual(received.records, expected.records); assert.deepEqual(received.links, expected.links);
      assert.equal(await b.evaluate(({ ws, version }) => HaedoLife.Shell.storage.readNaverCapture(ws, version), { ws, version: one.sourceVersionId }), null, 'Core arrival alone does not install media');
      await reader(b, ws, one.sourceId, one.sourceVersionId); await b.locator('#lifeNaverSourceMedia[data-state=ready]').waitFor();
      const original = await storedMedia(b, ws, one.sourceVersionId); assert.equal(original.capture.capture_hash, first.capture_hash); assert.deepEqual(original.photos.map(p => p.sha256), initial.photoFiles.map(p => p.digest));
      await b.waitForFunction(() => document.querySelector('#lifeNaverSourceMedia img')?.naturalWidth === 4032);
      await b.locator('#lifeVersion').selectOption(two.sourceVersionId); await b.locator('#lifeNaverSourceMedia[data-state=ready]').waitFor();
      const revised = await storedMedia(b, ws, two.sourceVersionId); assert.equal(revised.capture.capture_hash, second.capture_hash); assert.deepEqual(revised.photos.map(p => p.sha256), secondPhotos.map(p => p.digest));
      assert.equal((await storedMedia(b, ws, one.sourceVersionId)).capture.capture_hash, first.capture_hash);
      assert.deepEqual((await bundle(b, ws)).records, expected.records); assert.deepEqual((await bundle(b, ws)).sourceVersions, expected.sourceVersions);
      for (const width of [1440, 390]) { await b.setViewportSize({ width, height: 1000 }); assert(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); const name = 'reader-' + width + '.png'; await b.screenshot({ path: path.join(output, name), fullPage: true }); report.screenshots.push(name); }
    });
    const replay = await device('media-replay'); await coreReady(replay, ws, expected.sourceVersions.length);
    await check('Fresh same-account capture review reuses its exact existing version and never creates a duplicate body version', async () => {
      const before = await bundle(replay, ws);
      assert.equal(await replay.evaluate(({ ws, version }) => HaedoLife.Shell.storage.readNaverCapture(ws, version), { ws, version: two.sourceVersionId }), null);
      await replay.goto(base + '/index.html?section=records&view=naver-blog', { waitUntil: 'domcontentloaded' }); await ready(replay); await settle(replay);
      await replay.locator('.nv-connection [data-action=public-list]').first().click();
      await replay.locator('.nv-capture-row[data-capture-id="' + second.id + '"] [data-action=review-capture]').click(); await replay.locator('#naverCaptureReview').waitFor();
      await replay.locator('#naverCaptureApply').click(); await replay.locator('#naverCaptureStatus[data-state=stored]').waitFor();
      assert.deepEqual(await bundle(replay, ws), before, 'Existing source graph and revision remain exactly unchanged');
      const media = await storedMedia(replay, ws, two.sourceVersionId); assert.equal(media.capture.capture_hash, second.capture_hash); assert.deepEqual(media.photos.map(photo => photo.sha256), secondPhotos.map(photo => photo.digest));
      assert.equal(await replay.evaluate(({ ws, version }) => HaedoLife.Shell.storage.readNaverCapture(ws, version), { ws, version: one.sourceVersionId }), null, 'Receiving one capture does not attach the other photo version');
      const once = await replay.evaluate(ws => HaedoLife.Shell.storage.listNaverMediaReceipts(ws), ws);
      await replay.locator('#naverCaptureApply').click(); await replay.locator('#naverCaptureStatus[data-state=stored]').waitFor();
      assert.deepEqual(await bundle(replay, ws), before); assert.deepEqual(await replay.evaluate(ws => HaedoLife.Shell.storage.listNaverMediaReceipts(ws), ws), once);
    });
    const c = await device('media-failure'); await coreReady(c, ws, expected.sourceVersions.length);
    await check('Partial media failure installs no sidecar and retry restores exact originals without modifying source or old quotations', async () => {
      const failed = second.payload.photos.filter(photo => photo.status === 'stored').at(-1).storagePath; server.failedMedia.add(failed);
      await reader(c, ws, two.sourceId, two.sourceVersionId); await c.locator('#lifeNaverSourceMedia[data-state=error]').waitFor();
      assert.equal(await c.evaluate(({ ws, version }) => HaedoLife.Shell.storage.readNaverCapture(ws, version), { ws, version: two.sourceVersionId }), null);
      assert.deepEqual((await bundle(c, ws)).sourceVersions, expected.sourceVersions); assert.deepEqual((await bundle(c, ws)).records, expected.records);
      for (const width of [1440, 390]) { await c.setViewportSize({ width, height: 1000 }); assert(await c.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await retrySpacing(c, '#lifeNaverSourceMediaRetry'); const name = 'media-error-' + width + '.png'; await c.screenshot({ path: path.join(output, name), fullPage: true }); report.screenshots.push(name); }
      server.failedMedia.delete(failed); await c.locator('#lifeNaverSourceMediaRetry').click(); await c.locator('#lifeNaverSourceMedia[data-state=ready]').waitFor();
      assert.equal((await storedMedia(c, ws, two.sourceVersionId)).capture.capture_hash, second.capture_hash);
      const beforeCalls = server.captureCalls.filter(value => value.rpc === 'media').length; await c.reload({ waitUntil: 'domcontentloaded' }); await ready(c); await reader(c, ws, two.sourceId, two.sourceVersionId); await c.locator('#lifeNaverSourceMedia[data-state=ready]').waitFor(); assert.equal(server.captureCalls.filter(value => value.rpc === 'media').length, beforeCalls, 'Verified local media is reused');
    });
    await check('Legacy version without a receipt remains unverified and is never matched by body or latest capture', async () => {
      const calls = server.captureCalls.filter(value => value.rpc === 'media').length;
      await reader(c, ws, initial.original.sourceId, initial.original.versionId); await c.locator('#lifeNaverSourceMedia[data-state=unverified]').waitFor();
      assert.equal(await c.evaluate(({ ws, version }) => HaedoLife.Shell.storage.readNaverCapture(ws, version), { ws, version: initial.original.versionId }), null);
      assert.equal(server.captureCalls.filter(value => value.rpc === 'media').length, calls);
      await c.locator('#lifeNaverMediaReview').click(); await c.locator('#lifeNaverBlog').waitFor();
      held = gate(); server.receiptHold = { device: 'media-failure', write: false, gate: held };
      await c.locator('#lifeSubviewReturn').click(); await arrived(held); await c.locator('#lifeNaverSourceMedia[data-state=loading]').waitFor();
      await c.locator('#lifeSourceInfoToggle').click(); await c.mouse.wheel(0, 160);
      await c.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const intervened = await c.evaluate(() => ({ focus: document.activeElement?.id, y: scrollY }));
      assert.equal(intervened.focus, 'lifeSourceInfoToggle');
      held.release(); await c.locator('#lifeNaverSourceMedia[data-state=unverified]').waitFor();
      await c.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await c.evaluate(() => document.activeElement?.id), intervened.focus, 'Delayed recovery cannot steal the explicitly changed focus');
      assert(Math.abs((await c.evaluate(() => scrollY)) - intervened.y) <= 2, 'Delayed recovery cannot reset user scroll');
      await c.locator('#lifeNaverMediaReview').click(); await c.locator('#lifeNaverBlog').waitFor();
      held = gate(); server.receiptHold = { device: 'media-failure', write: false, gate: held };
      await c.locator('#naverBlogReturn').click(); await arrived(held); await c.locator('#lifeNaverSourceMedia[data-state=loading]').waitFor();
      await c.keyboard.press('Tab'); const keyboardFocus = await c.evaluate(() => document.activeElement?.id);
      assert(keyboardFocus && keyboardFocus !== 'lifeNaverMediaReview', 'Keyboard user moved focus to a different actual control');
      held.release(); await c.locator('#lifeNaverSourceMedia[data-state=unverified]').waitFor();
      await c.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await c.evaluate(() => document.activeElement?.id), keyboardFocus, 'Delayed recovery cannot steal keyboard-only focus');
    });
    await check('Dedicated photo ZIP restores new local-only IDs and cannot create or inherit a server receipt', async () => {
      const count = server.mediaReceipts.size;
      const restored = await b.evaluate(async ({ ws, version }) => { const h = HaedoLife, s = h.Shell.storage, before = await s.read(ws), attachment = await s.readNaverCapture(ws, version), blob = await h.NaverMedia.pack({ bundle: before, attachment }); const read = await h.NaverMedia.read(blob), copy = await h.NaverMedia.copy(read); const result = await s.installNaverCaptureCopy(copy); const pending = await s.listNaverMediaReceipts(result.bundle.workspaceId); return { ws: result.bundle.workspaceId, source: result.bundle.sources[0].id, version: result.bundle.sourceVersions[0].id, body: result.bundle.sourceVersions[0].contentText, localOnly: result.attachment.localOnly, pending, capture: result.attachment.capture }; }, { ws, version: one.sourceVersionId });
      assert.notEqual(restored.ws, ws); assert.notEqual(restored.version, one.sourceVersionId); assert.equal(restored.body, first.payload.body); assert.equal(restored.localOnly, true); assert.deepEqual(restored.pending, []); assert.deepEqual(Object.keys(restored.capture).sort(), ['capture_hash', 'payload']); assert(restored.capture.payload.photos.every(photo => photo.storagePath === null)); assert.equal(server.mediaReceipts.size, count);
      assert.deepEqual((await storedMedia(b, restored.ws, restored.version)).photos.map(photo => photo.sha256), initial.photoFiles.map(photo => photo.digest));
    });
    const d = await device('media-late'); await coreReady(d, ws, expected.sourceVersions.length);
    await check('A delayed old-account receipt cannot install media after switching to another account', async () => {
      held = gate(); server.receiptHold = { device: 'media-late', write: false, gate: held };
      await d.evaluate(({ ws, source, version }) => { const h = HaedoLife; window.__lateDone = false; window.__lateService = h.NaverCaptureSync.create({ storage: h.Shell.storage }); window.__lateResult = __lateService.restoreForVersion(ws, source, version).then(value => ({ value }), error => ({ code: error.code })).then(value => { window.__lateDone = true; return value; }); }, { ws, source: one.sourceId, version: one.sourceVersionId });
      await arrived(held); await d.evaluate(async value => { await HaedoAuth.client.auth.setSession(value); await HaedoAuth.verify(); }, session(accounts.b)); await d.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell.storage?.account?.userId === id, accounts.b.id); held.release(); await d.waitForFunction(() => __lateDone); const result = await d.evaluate(() => __lateResult); assert.equal(result.code, 'naver_cancelled');
      const priorMedia = await d.evaluate(({ ws, version }) => new Promise((resolve, reject) => { const request = indexedDB.open('life-tools-v1'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, tx = db.transaction('meta', 'readonly'), get = tx.objectStore('meta').get('naver-capture:' + ws + ':' + version); get.onsuccess = () => { const value = get.result || null; db.close(); resolve(value); }; get.onerror = () => { db.close(); reject(get.error); }; }; }), { ws, version: one.sourceVersionId }); assert.equal(priorMedia, null);
      await d.evaluate(() => __lateService.dispose());
      await until(() => d.evaluate(() => HaedoLife.Shell.accountLibrary.getState()), value => value.mode === 'account' && value.status === 'synced', 'New account default library after switch');
      assert.equal((await d.evaluate(async () => HaedoLife.Shell.storage.read(await HaedoLife.Shell.storage.getActive()))).sourceVersions.length, 0);
    });
    await check('Receipt publication failure keeps local verified photos and exact originals usable, then explicit retry confirms the same mapping', async () => {
      const added = await capturedRow(initial.photoFiles, { logNo: '100004', failedPhoto: false }); server.addCapture(added, initial.photoFiles); server.failedReceiptWrites.add('media-a');
      const local = await adopt(added.id), before = await bundle(a, ws); await coreReady(a, ws, before.sourceVersions.length);
      await reader(a, ws, local.sourceId, local.sourceVersionId); await a.locator('#lifeNaverSourceMedia[data-state=ready]').waitFor();
      await a.locator('#lifeNaverMediaSyncRetry').waitFor();
      await a.locator('#lifeNaverMediaSyncRetry').click(); await a.locator('#lifeNaverMediaSyncStatus[data-state=error]').waitFor();
      assert.match(await a.locator('#lifeNaverMediaSyncStatus').innerText(), /이 기기의 사진은 그대로 사용할 수 있습니다/);
      assert.equal((await storedMedia(a, ws, local.sourceVersionId)).capture.capture_hash, added.capture_hash); assert.deepEqual(await bundle(a, ws), before);
      for (const width of [1440, 390]) { await a.setViewportSize({ width, height: 1000 }); assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await retrySpacing(a, '#lifeNaverMediaSyncRetry'); const name = 'receipt-error-' + width + '.png'; await a.screenshot({ path: path.join(output, name), fullPage: true }); report.screenshots.push(name); }
      server.failedReceiptWrites.delete('media-a'); await a.locator('#lifeNaverMediaSyncRetry').click();
      await a.waitForFunction(() => document.querySelector('#lifeNaverMediaSyncStatus')?.dataset.state === 'confirmed' && document.querySelector('#lifeNaverMediaSyncStatus').hidden);
      const saved = await a.evaluate(ws => HaedoLife.Shell.storage.listNaverMediaReceipts(ws), ws); assert.equal(saved.find(value => value.receipt.sourceVersionId === local.sourceVersionId).pending, false); assert.deepEqual(await bundle(a, ws), before);
    });
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.externalRequests, []); assert.deepEqual(server.receiptErrors, []); assert.deepEqual(server.libraryRouteErrors, []); assert.equal(server.blogCalls.filter(value => /publish|unpublish/.test(value.rpc)).length, 0);
    report.hashesAfter = await hashes(); assert.deepEqual(report.hashesAfter, report.hashesBefore); report.pass = true;
  } catch (error) {
    report.failure = error.stack;
    for (const [index, context] of contexts.entries()) for (const page of context.pages()) {
      await page.screenshot({ path: path.join(output, 'failure-' + index + '.png'), fullPage: true }).catch(() => {});
    }
    throw error;
  }
  finally { held?.release(); report.receiptRequests = server.receiptRequests; report.receipts = [...server.mediaReceipts.values()]; report.captureRequests = server.captureCalls; for (const context of contexts) await context.close(); await browser.close(); report.closedContexts = contexts.length; await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log('PASS ' + report.checks.length + ' exact Naver media continuity journeys');
}
main().catch(error => { console.error(error.stack); if (process.env.GITHUB_ACTIONS) console.error('::error title=Naver media continuity::' + String(error.stack || error).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')); process.exitCode = 1; });

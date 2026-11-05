/* Current Naver UI journey against the existing anonymous transport fixture.
 * Actual SDK, app, IDB and image decoding; no live Naver, production, cron or
 * physical-device claim. BASE_URL=http://127.0.0.1:4188 node this-file */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, makeContext, ready, settle, shellReady } = require('./unified-home-browser.cjs');
const { accounts, base, cloud } = require('./life-sync-browser.cjs');
const { NaverMediaCloud } = require('./helpers/naver-media-cloud.cjs');
const { capturedRow, originals, storedMedia, fullText, gate, arrived } = require('./life-naver-capture-browser.cjs');
const { blogId, existingNaver } = require('./naver-blog-browser.cjs');
const output = path.resolve(process.env.NAVER_UI_OUTPUT || '.local/naver-ui-continuity');
const sha = data => createHash('sha256').update(data).digest('hex');
const runtime = ['assets/life/naver-blog-ui.js', 'assets/life/naver-capture-sync.js', 'assets/life/naver-capture-ui.js', 'assets/life/naver-media-receipt.js', 'assets/life/ui.js', 'assets/life/storage.js'];
const until = async (action, accept, label) => { const end = Date.now() + 20000; while (Date.now() < end) { const value = await action(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 40)); } throw Error('Timed out waiting for ' + label); };
const row = (page, sub) => page.locator('.nv-connection[data-connection-id="' + sub.id + '"]');
const idle = page => page.waitForFunction(() => document.querySelector('#lifeNaverBlog')?.getAttribute('aria-busy') === 'false');
async function open(page) { await page.goto(base + '/index.html?section=records&view=naver-blog', { waitUntil: 'domcontentloaded' }); await ready(page); await settle(page); await page.locator('#lifeNaverBlog').waitFor(); await idle(page); }
class JourneyCloud extends NaverMediaCloud {
  constructor() { super(); this.collectionReady = true; this.failScoped = null; this.failureResponses = 0; this.expectedErrorUrls = []; }
  subscription(ws, owner = accounts.a.id, enabled = false) {
    const sub = super.subscription(ws, owner, enabled);
    this.inventories.set(sub.id, { subscription_id: sub.id, revision: 1, status: 'partial', baseline_completed_at: null, baseline_count: null, baseline_method: null, page: 1, seen_count: 2, total_start: 2, last_error: null });
    this.inventoryRows.set(sub.id, ['100001', '100002'].map(logNo => ({ blogId, logNo, title: '과거 합성 글 ' + logNo, publishedAt: null, firstSeenAt: '2026-11-05T00:00:00Z', baseline: true, captureId: null, job: null })));
    return sub;
  }
  async handle(route, device) {
    const request = route.request(), url = new URL(request.url()), rpc = url.pathname.split('/').at(-1);
    if (request.method() === 'POST' && this.failScoped && rpc === this.failScoped.rpc && request.postDataJSON().p_subscription_id === this.failScoped.subscriptionId) {
      this.failScoped = null; this.failureResponses++; this.expectedErrorUrls.push(request.url());
      return route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ code: 'XX000', message: 'Synthetic selected connection read failure' }) });
    }
    if (url.pathname.includes('/haedo-naver-originals/') && request.method() === 'GET' && this.failedMedia.has(decodeURIComponent(url.pathname.split('/haedo-naver-originals/')[1]))) { this.failureResponses++; this.expectedErrorUrls.push(request.url()); }
    return super.handle(route, device);
  }
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const report = { pass: false, scope: 'Real app/SDK/IDB and independent browser contexts; synthetic HTTP plus explicit fake scheduled completion, no live Naver/production/cron/physical device proof.', checks: [], screenshots: [], consoleErrors: [], expectedConsoleErrors: [], pageErrors: [], externalRequests: [] };
  const hashes = async () => Object.fromEntries(await Promise.all(runtime.map(async file => [file, sha(await fs.readFile(file))])));
  report.hashesBefore = await hashes(); report.testHash = sha(await fs.readFile(__filename));
  for (const file of runtime) { const response = await fetch(base + '/' + file); assert(response.ok); assert.equal(sha(Buffer.from(await response.arrayBuffer())), report.hashesBefore[file]); }
  const mutant = process.env.NAVER_UI_MUTANT ? await fs.readFile(process.env.NAVER_UI_MUTANT) : null;
  if (mutant) report.mutation = { runtime: 'assets/life/naver-blog-ui.js', sha256: sha(mutant), isolatedBrowserRoute: true };
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); const contexts = [];
  async function device(server, name) {
    const context = await makeContext(browser, server, name, null, { viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }); contexts.push(context);
    await context.route('**/*', route => { const origin = new URL(route.request().url()).origin; if ([new URL(base).origin, cloud].includes(origin)) return route.fallback(); report.externalRequests.push(origin); return route.abort(); });
    if (mutant) await context.route(base + '/assets/life/naver-blog-ui.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: mutant }));
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', e => report.pageErrors.push(e.message));
    page.on('console', e => { if (e.type() !== 'error') return; const index = server.expectedErrorUrls.indexOf(e.location().url), known = index >= 0 && /status of 503/.test(e.text()); if (known) server.expectedErrorUrls.splice(index, 1); (known ? report.expectedConsoleErrors : report.consoleErrors).push(e.text()); });
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' }); await shellReady(page); assert.deepEqual(await page.evaluate(() => __homeDbOpens), []);
    server.oauthAccounts.set(name, accounts.a); await page.goto(base + '/login.html?next=' + encodeURIComponent('index.html?section=records'), { waitUntil: 'domcontentloaded' }); await page.locator('#googleLogin').click(); await page.waitForURL(url => url.pathname.endsWith('/index.html')); await ready(page); await settle(page);
    await until(() => page.evaluate(() => HaedoLife.Shell.accountLibrary.getState()), v => v.mode === 'account' && v.status === 'synced', 'account library');
    return page;
  }
  async function screenshot(page, scene) {
    for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => scrollTo({ top: 0, left: 0, behavior: 'instant' })); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); const file = scene + '-' + width + '.png'; await page.screenshot({ path: path.join(output, file), fullPage: false }); report.screenshots.push(file); }
  }
  async function check(name, action) {
    if (process.env.NAVER_UI_MATCH && !new RegExp(process.env.NAVER_UI_MATCH).test(name)) return;
    console.log('RUN ' + name); try { await action(); report.checks.push({ name, pass: true }); console.log('PASS ' + name); } catch (error) { report.checks.push({ name, pass: false, error: error.stack }); throw error; }
  }
  try {
    await check('Switching inventory connection clears the previous selection; failed connection reads restore its exact scope', async () => {
      const server = new JourneyCloud(), page = await device(server, 'scope-a'), ws = await page.evaluate(() => HaedoLife.Shell.storage.getActive());
      const a = server.subscription(ws), b = server.subscription('99999999-1111-4111-8111-111111111111');
      server.inventoryRows.set(b.id, [{ blogId, logNo: '300001', title: '다른 연결의 합성 글', publishedAt: null, firstSeenAt: '2026-11-05T00:00:00Z', baseline: true, captureId: null, job: null }]);
      await open(page); await row(page, a).locator('[data-action=public-list]').click(); await idle(page);
      await page.locator('.nv-public-item input[data-log-no="100001"]').check();
      await page.locator('#naverBlogId').fill('unsaved_synthetic_blog');
      await row(page, b).locator('[data-action=inventory]').click(); await idle(page);
      assert.equal(await page.locator('.nv-public-item input:checked').count(), 0);
      assert.equal(await page.locator('#naverCaptureQueue').isDisabled(), true, 'Changing connections must clear A selection before B can queue');
      assert.equal(await page.locator('#naverBlogId').inputValue(), 'unsaved_synthetic_blog');
      for (const failure of ['life_naver_inventory_list', 'life_naver_capture_list']) {
        await row(page, a).locator('[data-action=public-list]').click(); await idle(page); await page.locator('.nv-public-item input[data-log-no="100001"]').check();
        server.failScoped = { rpc: failure, subscriptionId: b.id };
        await row(page, b).locator('[data-action=public-list]').click(); await idle(page); await page.locator('#naverCaptureIntakeError:not([hidden])').waitFor();
        assert.equal(await row(page, a).locator('[data-action=public-list]').getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('.nv-public-item input[data-log-no="100001"]').isChecked(), true, failure + ' must preserve selected A row');
        assert.equal(await page.locator('.nv-public-item input[data-log-no="300001"]').count(), 0);
        const prior = server.captureCalls.length; await page.locator('#naverCaptureQueue').click(); await idle(page);
        const requests = server.captureCalls.slice(prior).filter(c => c.rpc === 'life_naver_capture_request'); assert.equal(requests.length, 1); assert.equal(requests[0].body.p_subscription_id, a.id); assert.equal(requests[0].body.p_log_no, '100001');
      }
      // The address-input save path also opens an already known connection.
      b.blog_id = 'second_haedo'; for (const item of server.inventoryRows.get(b.id)) item.blogId = b.blog_id;
      await open(page); await row(page, a).locator('[data-action=public-list]').click(); await idle(page);
      await page.locator('.nv-public-item input[data-log-no="100001"]').check();
      const statusBefore = await page.locator('#naverCaptureIntakeStatus').evaluate(el => ({ text: el.textContent, state: el.dataset.state }));
      assert.equal(statusBefore.state, 'partial');
      server.failScoped = { rpc: 'life_naver_capture_list', subscriptionId: b.id };
      await page.locator('#naverBlogId').fill(b.blog_id); await page.locator('#naverBlogSave').click(); await idle(page);
      await page.locator('#naverBlogError:not([hidden])').waitFor();
      assert.deepEqual(await page.locator('#naverCaptureIntakeStatus').evaluate(el => ({ text: el.textContent, state: el.dataset.state })), statusBefore, 'Known connection failure must restore the previous inventory status, not claim the new baseline completed');
      assert.equal(await row(page, a).locator('[data-action=public-list]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.nv-public-item input[data-log-no="100001"]').isChecked(), true);
      assert.equal(await page.locator('#naverBlogId').inputValue(), b.blog_id);
      await row(page, a).locator('[data-action=public-list]').click(); await idle(page);
      assert.equal(await page.locator('.nv-public-item input[data-log-no="100001"]').isChecked(), true, 'Refreshing the same connection keeps its selection');
      assert.equal(await page.locator('#naverBlogId').inputValue(), b.blog_id);
      assert.equal(server.failureResponses, 3); assert.deepEqual(server.expectedErrorUrls, []); await screenshot(page, 'connection-scope'); await page.context().close();
    });
    await check('Connection, observed inventory, synthetic scheduled capture and exact two-context restoration preserve originals and input', async () => {
      const server = new JourneyCloud(), a = await device(server, 'journey-a');
      const existing = await existingNaver(a), ws = existing.workspaceId, previousGraph = existing.bundle, photoFiles = await originals(a);
      await open(a); await a.locator('#naverBlogId').fill(blogId); await a.locator('#naverBlogSave').click(); await idle(a);
      const sub = server.subscriptions.get(accounts.a.id + ':' + ws); assert(sub); assert.equal(sub.enabled, false);
      assert.equal(await row(a, sub).locator('[data-action=new-posts]').count(), 0, 'Incomplete baseline cannot enable new-post collection');
      await row(a, sub).locator('[data-action=inventory]').click(); await idle(a);
      assert.equal(server.inventories.get(sub.id).status, 'complete');
      // The count mismatch/observed result is a server fixture response, never a
      // claim that this test ran SQL probes or observed an actual Naver post.
      server.inventories.set(sub.id, { ...server.inventories.get(sub.id), baseline_method: 'observed_set', seen_count: 2, total_start: 1, baseline_count: 2 });
      await a.locator('#naverCaptureRefresh').click(); await idle(a);
      assert.match(await a.locator('#naverCaptureIntakeStatus').textContent(), /전체 공개 글 수는 미확정/);
      assert.equal(await a.locator('#naverBlogAuto').isChecked(), false);
      await screenshot(a, 'observed-inventory');
      await row(a, sub).locator('[data-action=new-posts]').click(); await idle(a);
      assert.equal(server.subscriptions.get(accounts.a.id + ':' + ws).enabled, true);
      const captured = await capturedRow(photoFiles, { logNo: '100003', failedPhoto: false, title: '예약으로 보관된 합성 새 글' });
      await a.close();
      assert.equal(a.isClosed(), true, 'Scheduled fixture is advanced only after the application page closes');
      // Explicit fake scheduled tick: transport state only. No Core/source ACK,
      // client receipt, IDB capture or final UI success is injected here.
      assert.equal(server.subscriptions.get(accounts.a.id + ':' + ws).enabled, true);
      const newRow = { blogId, logNo: '100003', title: captured.payload.title, publishedAt: '2026-11-05T01:00:00Z', firstSeenAt: '2026-11-05T01:01:00Z', baseline: false, captureId: captured.id, job: null };
      server.inventoryRows.get(sub.id).unshift(newRow); server.addCapture(captured, photoFiles);
      const job = { id: 'ffffffff-ffff-4fff-8fff-000000100003', subscription_id: sub.id, blog_id: blogId, log_no: '100003', revision: 1, status: 'complete', last_error: null, capture_id: captured.id };
      server.jobs.set(accounts.a.id + ':100003', job);
      report.syntheticScheduled = { appClosed: true, newRows: 1, captureJobs: 1, captures: 1, realCron: false };
      const resumed = await a.context().newPage(); resumed.setDefaultTimeout(20000);
      resumed.on('pageerror', e => report.pageErrors.push(e.message)); resumed.on('console', e => { if (e.type() === 'error') report.consoleErrors.push(e.text()); });
      await open(resumed); await row(resumed, sub).locator('[data-action=public-list]').click(); await idle(resumed);
      assert.equal(await resumed.locator('.nv-public-item[data-log-no="100003"]').count(), 1);
      await resumed.locator('.nv-capture-row[data-capture-id="' + captured.id + '"] [data-action=review-capture]').click();
      await resumed.locator('#naverCaptureReview').waitFor();
      assert.equal(await resumed.locator('#naverCaptureBody').textContent(), fullText);
      assert.deepEqual(await resumed.locator('.nv-capture-photo input').evaluateAll(nodes => nodes.map(n => n.checked)), [false, false]);
      await resumed.locator('#naverCaptureApply').click(); await resumed.locator('#naverCaptureStatus[data-state=stored]').waitFor();
      const bundle = () => resumed.evaluate(ws => HaedoLife.Shell.storage.read(ws), ws);
      const received = await bundle(), source = received.sources.find(s => s.sourceKey?.endsWith('/100003') || s.url?.endsWith('/100003'));
      assert(source); const version = received.sourceVersions.find(v => v.sourceId === source.id);
      assert.equal(version.contentText, fullText); assert.equal(version.contentHash, captured.payload.bodyHash); assert.equal(version.coverage.status, 'partial');
      for (const key of ['sources', 'sourceVersions', 'records', 'links']) assert.deepEqual(received[key].filter(r => previousGraph[key].some(old => old.id === r.id)), previousGraph[key]);
      const exact = await storedMedia(resumed, ws, version.id); assert.equal(exact.capture.capture_hash, captured.capture_hash); assert.deepEqual(exact.photos.map(p => p.sha256), photoFiles.map(p => p.digest));
      await resumed.locator('#naverCaptureApply').click(); await resumed.locator('#naverCaptureStatus[data-state=stored]').waitFor();
      for (const key of ['sources', 'sourceVersions', 'records', 'links']) assert.deepEqual((await bundle())[key], received[key]);
      await until(() => server.mediaReceipts.size, n => n === 1, 'real source ACK and immutable media receipt');
      await resumed.locator('#naverCaptureOpen').click(); await resumed.locator('#lifeNaverSourceMedia[data-state=ready]').waitFor();
      const pixels = async page => page.locator('#lifeNaverSourceMedia img').evaluateAll(async images => Promise.all(images.map(async img => { await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); const bytes = ctx.getImageData(0, 0, c.width, c.height).data; return { width: c.width, height: c.height, pixels: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('') }; })));
      const originalPixels = await pixels(resumed); assert.deepEqual(originalPixels.map(p => [p.width, p.height]), [[4032, 3024], [1200, 1800]]);
      await screenshot(resumed, 'received-exact-reader');
      const b = await device(server, 'journey-b');
      await until(() => b.evaluate(ws => HaedoLife.Shell.storage.read(ws), ws), value => value.sourceVersions.some(v => v.id === version.id), 'fresh context automatic original receipt');
      assert.equal(await b.evaluate(({ ws, version }) => HaedoLife.Shell.storage.readNaverCapture(ws, version), { ws, version: version.id }), null);
      const failedPath = captured.payload.photos[1].storagePath; server.failedMedia.add(failedPath);
      await b.goto(base + '/index.html?section=records&view=sources', { waitUntil: 'domcontentloaded' }); await ready(b); await settle(b);
      await b.locator('.life-source-open[data-source-id="' + source.id + '"]').first().click(); await b.locator('#lifeNaverSourceMedia[data-state=error]').waitFor();
      assert.equal(await b.evaluate(({ ws, version }) => HaedoLife.Shell.storage.readNaverCapture(ws, version), { ws, version: version.id }), null, 'A partial photo download installs no sidecar');
      server.failedMedia.delete(failedPath);
      const held = gate(); const handler = async route => { held.enter(); await held.released; return route.fallback(); };
      const mediaMatch = url => url.origin === cloud && decodeURIComponent(url.pathname).endsWith('/haedo-naver-originals/' + failedPath);
      await b.context().route(mediaMatch, handler);
      try {
        await b.locator('#lifeNaverSourceMediaRetry').click(); await arrived(held);
        await b.locator('#lifeExcerptToggle').click(); await b.locator('#lifeSourceNote').fill('사진을 기다리는 동안 쓴 미저장 생각');
        held.release(); await b.locator('#lifeNaverSourceMedia[data-state=ready]').waitFor();
        assert.equal(await b.locator('#lifeSourceNote').inputValue(), '사진을 기다리는 동안 쓴 미저장 생각');
      } finally { held.release(); await b.context().unroute(mediaMatch, handler); }
      const restored = await storedMedia(b, ws, version.id); assert.equal(restored.capture.capture_hash, captured.capture_hash); assert.deepEqual(restored.photos.map(p => p.sha256), photoFiles.map(p => p.digest)); assert.deepEqual(await pixels(b), originalPixels);
      const bGraph = await b.evaluate(ws => HaedoLife.Shell.storage.read(ws), ws); for (const key of ['sourceVersions', 'records', 'links']) assert.deepEqual(bGraph[key], received[key]);
      await screenshot(b, 'second-context-exact-reader');
      await open(resumed); await row(resumed, sub).locator('[data-action=new-posts]').click(); await idle(resumed);
      assert.equal(server.subscriptions.get(accounts.a.id + ':' + ws).enabled, false); assert.equal(server.jobs.size, 1); assert.equal(server.captureRows.size, 1);
      assert.deepEqual(server.receiptErrors, []); assert.deepEqual(server.libraryRouteErrors, []); assert.deepEqual(server.expectedErrorUrls, []);
      assert.equal(server.blogCalls.filter(c => /publish|unpublish/.test(c.rpc)).length, 0);
      report.restoration = { bodyHash: version.contentHash, captureHash: captured.capture_hash, photos: restored.photos.map(p => p.sha256), nativePixels: originalPixels, oldQuotesPreserved: true, inputPreserved: true, duplicateVersions: 0 };
      await resumed.context().close(); await b.context().close();
    });
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.externalRequests, []);
    report.hashesAfter = await hashes(); assert.deepEqual(report.hashesAfter, report.hashesBefore, 'Product source must stay fixed during verification'); assert.equal(sha(await fs.readFile(__filename)), report.testHash, 'Running test source must stay fixed'); report.pass = true;
  } catch (error) { report.failure = error.stack; for (const [i, context] of contexts.entries()) for (const page of context.pages()) await page.screenshot({ path: path.join(output, 'failure-' + i + '.png'), fullPage: true }).catch(() => {}); throw error; }
  finally { for (const context of contexts) await context.close(); await browser.close(); report.resourcesClosed = true; await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

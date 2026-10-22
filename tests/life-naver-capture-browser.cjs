/* Naver capture completion: real application, bundled SDK and independent
 * IndexedDB stores, synthetic authenticated owner API and image HTTP only.
 * No actual Naver requests, production credentials, scheduled collection,
 * physical second-device or Apple-device proof is provided by this runner.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, makeContext, ready, settle, nav } = require('./unified-home-browser.cjs');
const { accounts, session, base, cloud } = require('./life-sync-browser.cjs');
const { NaverCloud, blogId, postUrl, existingNaver } = require('./naver-blog-browser.cjs');
const { seed, preserved } = require('./account-materials-browser.cjs');
const { databaseSnapshot } = require('./local-post-finder-browser.cjs');
const ZIP = require('../vendor/fflate/fflate.js');
const CaptureModel = require('../assets/life/naver-capture.js');
const output = path.resolve('.local/naver-capture');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value);
const fullText = '\ufeff# 보완한 합성 기록\r\n🌱 첫 문단을 정확히 보관한다.\r\n\r\n## 이어지는 생각\r\n링크와 사진 사이의 마지막 문장';
const selectedQuote = '🌱 첫 문단을 정확히 보관한다.';
const previousText = '\ufeff🌱 기존의 일부 본문\r\n👨‍👩‍👧‍👦 옛 버전에 고정된 구절\r\n기존 마지막 줄';
const previousQuote = '👨‍👩‍👧‍👦 옛 버전에 고정된 구절\r\n기존 마지막 줄';

function gate() {
  let notify, release;
  return { entered: new Promise(resolve => { notify = resolve; }), released: new Promise(resolve => { release = resolve; }),
    enter: () => notify(), release: () => release() };
}
async function arrived(hold) {
  let timer;
  try { await Promise.race([hold.entered, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Synthetic capture request did not arrive within 20000ms')), 20000); })]); }
  finally { clearTimeout(timer); }
}
async function waitStorage(page, action, argument, label = 'storage result') {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const result = await page.evaluate(action, argument); if (result) return result;
    await page.waitForTimeout(40);
  }
  throw Error('Timed out waiting for ' + label);
}
async function originals(page) {
  const rows = await page.evaluate(async () => {
    const P = HaedoLife.PhotoPost, C = HaedoLife.Core, result = [];
    for (const [width, height, color] of [[4032, 3024, '#3d6155'], [1200, 1800, '#b8c9be']]) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const paint = canvas.getContext('2d'); paint.fillStyle = color; paint.fillRect(0, 0, width, height);
      paint.fillStyle = '#ffffff'; paint.fillRect(15, 20, 90, 40);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const photo = await P.readPhoto(new File([blob], 'anonymous-capture-' + result.length + '.png', { type: 'image/png' }), C.id);
      const dataURL = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
      const { blob: discarded, ...metadata } = photo;
      result.push({ ...metadata, base64: dataURL.split(',')[1] });
    }
    return result;
  });
  for (const row of rows) { row.bytes = Buffer.from(row.base64, 'base64'); assert.equal(hash(row.bytes), row.digest); delete row.base64; }
  assert.deepEqual(rows.map(row => [row.width, row.height]), [[4032, 3024], [1200, 1800]]);
  return rows;
}
async function seedCapture(page) {
  const baseline = await seed(page), old = await existingNaver(page);
  const original = await page.evaluate(async ({ sourceId, previousText, previousQuote }) => {
    const C = HaedoLife.Core, s = HaedoLife.Shell.storage, workspaceId = await s.getActive(), bundle = await s.read(workspaceId);
    const source = bundle.sources.find(source => source.id === sourceId);
    const prepared = await C.prepareImport({ origin: source.origin, existingSourceId: source.id, title: source.title,
      url: source.url, text: previousText, coverage: 'partial', authorRelation: 'other' }, bundle);
    const locator = { start: previousText.indexOf(previousQuote), end: previousText.indexOf(previousQuote) + previousQuote.length };
    const changes = C.buildImportChanges(bundle, prepared, [{ ...locator, topic: '정확히 보존할 옛 버전', note: '자동 수집이나 본문 보완으로 바꾸지 않을 개인 메모' }]);
    const result = await s.commitLocal({ workspaceId, baseRevision: bundle.revision, operationId: C.id(), changes });
    if (result.status !== 'stored') throw Error('Synthetic previous-version commit failed');
    const fresh = await s.read(workspaceId);
    const reference = await HaedoLife.SourceReference.build({ bundle: fresh, sourceId: source.id, versionId: prepared.version.id, locator });
    return { workspaceId, sourceId: source.id, versionId: prepared.version.id, locator, reference, bundle: fresh };
  }, { sourceId: old.refs['100002'].sourceId, previousText, previousQuote });
  const photoFiles = await originals(page);
  return { ...baseline, old, original, photoFiles };
}
// Private entry is ready when its scripts/DOM and verified Shell are usable.
// Whole-document load also waits on unrelated resources; the runner separately
// verifies actual selected images, SHA, errors and viewport output.
async function loadDocument(page, url) {
  try { await page.goto(url, { waitUntil: 'domcontentloaded' }); }
  catch (error) {
    error.message += '\nCapture entry state: ' + JSON.stringify(await page.evaluate(() => ({ state: document.readyState,
      appHidden: document.querySelector('#lifeApp')?.hidden, naver: !!document.querySelector('#lifeNaverBlog'),
      status: document.querySelector('#naverBlogStatus')?.dataset.state })).catch(() => null)) +
      '\nPending request paths: ' + JSON.stringify([...(page.__capturePending?.values() || [])].slice(0, 20));
    throw error;
  }
}
function trackRequests(page) {
  page.__capturePending = new Map();
  page.on('request', request => page.__capturePending.set(request, { method: request.method(), path: new URL(request.url()).pathname }));
  page.on('requestfinished', request => page.__capturePending.delete(request)); page.on('requestfailed', request => page.__capturePending.delete(request));
}
async function enter(page) {
  await loadDocument(page, base + '/index.html?section=tools&view=naver-blog'); await ready(page); await settle(page);
  await page.locator('#lifeNaverBlog').waitFor();
}
async function sourceBundle(page, workspaceId) {
  return page.evaluate(async requested => { const s = HaedoLife.Shell.storage; return s.read(requested || await s.getActive()); }, workspaceId);
}
async function assertOriginalGraph(page, before, workspaceId, supplementedSourceIds = []) {
  const after = await sourceBundle(page, workspaceId);
  const stableSources = before.sources.filter(source => !supplementedSourceIds.includes(source.id));
  assert.deepEqual(after.sources.filter(source => stableSources.some(old => old.id === source.id)), stableSources);
  for (const id of supplementedSourceIds) {
    const old = before.sources.find(source => source.id === id), current = after.sources.find(source => source.id === id);
    assert.ok(old && current, 'Supplement must keep the same source');
    for (const key of ['id', 'origin', 'url', 'sourceKey', 'createdAt']) assert.equal(current[key], old[key], 'Supplement rewrote source identity ' + key);
  }
  for (const name of ['sourceVersions', 'records', 'links', 'resumeHints', 'tombstones']) {
    assert.deepEqual(after[name].filter(row => before[name].some(old => old.id === row.id)), before[name], 'Previously accepted ' + name + ' changed');
  }
}
async function capture(page, report, scene) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 1, 'Capture flow must remain inside the viewport');
    const filename = scene + '-' + width + '.png'; await page.screenshot({ path: path.join(output, filename), fullPage: true });
    report.visual.push({ filename, width, overflow });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

async function capturedRow(photoFiles, { logNo = '100002', owner = accounts.a.id, failedPhoto = true, title = '본문과 사진을 보완한 합성 기록' } = {}) {
  const photos = photoFiles.map((photo, index) => ({ index, url: 'https://blogfiles.pstatic.net/anonymous-' + index + '.png',
    storagePath: owner + '/naver/' + blogId + '/' + logNo + '/' + photo.digest,
    sha256: photo.digest, mimeType: photo.type, width: photo.width, height: photo.height, bytes: photo.size,
    alt: '합성 색면 ' + (index + 1), caption: '사진 설명 ' + (index + 1), status: 'stored', error: null, originalStatus: 'unverified' }));
  if (failedPhoto) photos.push({ index: photos.length, url: 'https://blogfiles.pstatic.net/anonymous-failed.png',
    storagePath: null, sha256: null, mimeType: null, width: null, height: null, bytes: null,
    alt: '보관되지 않은 사진', caption: '실패한 원본을 성공이라고 표시하지 않음', status: 'failed', error: 'download_failed', originalStatus: 'unverified' });
  const payload = { version: 1, blogId, logNo, url: postUrl(logNo), title, format: 'text/markdown', body: fullText,
    bodyHash: hash(Buffer.from(fullText)), htmlHash: hash(Buffer.from('<article>anonymous fixture</article>')), coverage: 'partial',
    omissions: failedPhoto ? ['사진 1장을 보관하지 못했습니다. 원문 전체 여부는 확인하지 않았습니다.'] : ['원문 전체 여부는 확인하지 않았습니다.'],
    publishedAt: null, author: '', extractedAt: '2026-10-21T10:00:00.000Z', extractor: 'anonymous-browser-fixture/1', photos };
  const row = { id: 'eeeeeeee-eeee-4eee-8eee-' + logNo.padStart(12, '0'), owner_id: owner,
    blog_id: blogId, log_no: logNo, capture_hash: await CaptureModel.fingerprint(payload), created_at: '2026-10-21T10:00:00.000Z', payload };
  await CaptureModel.validateCaptureRow(row, { ownerId: owner }); return row;
}

// Only the added owner RPCs and private image bytes are simulated. The actual
// bundled SDK, projection, CAS transaction, image decoder and ZIP codec run.
class CaptureCloud extends NaverCloud {
  constructor() { super(); this.captureCalls = []; this.captureRows = new Map(); this.media = new Map(); this.inventories = new Map(); this.inventoryRows = new Map(); this.jobs = new Map(); this.holds = new Map(); this.failInventory = false; }
  addCapture(row, photoFiles) {
    this.captureRows.set(row.id, clone(row));
    for (const photo of row.payload.photos.filter(photo => photo.status === 'stored')) {
      const bytes = photoFiles.find(value => value.digest === photo.sha256)?.bytes; assert.ok(bytes);
      this.media.set(photo.storagePath, { bytes, type: photo.mimeType, owner: row.owner_id });
    }
  }
  setup(workspaceId, owner = accounts.a.id) {
    this.collectionReady = true; const sub = this.subscription(workspaceId, owner, false);
    this.inventories.set(sub.id, { subscription_id: sub.id, revision: 1, status: 'partial', baseline_completed_at: null, baseline_scan_id: null, baseline_count: null,
      page: 2, seen_count: 20, last_error: 'upstream_failed' });
    this.inventoryRows.set(sub.id, Array.from({ length: 20 }, (_, index) => ({ blogId, logNo: String(200020 - index),
      title: '과거 공개 목록 ' + (index + 1), publishedAt: null, firstSeenAt: '2026-10-21T09:00:00.000Z', baseline: true, captureId: null, job: null }))
      .concat({ blogId, logNo: '100002', title: '본문과 사진을 보완한 합성 기록', publishedAt: null,
        firstSeenAt: '2026-10-21T09:00:00.000Z', baseline: true, captureId: null, job: null }));
    return sub;
  }
  holdCaptureNext(rpc, hold) { this.holds.set(rpc, hold); }
  async handle(route, device) {
    const request = route.request(), url = new URL(request.url());
    const names = ['life_naver_account_list', 'life_naver_inventory_state', 'life_naver_inventory_start', 'life_naver_inventory_list',
      'life_naver_capture_request', 'life_naver_capture_list', 'life_naver_capture_read'];
    const rpc = url.pathname.split('/').at(-1), mediaRequest = url.pathname.includes('/haedo-naver-originals/');
    const captureWorker = url.pathname === '/functions/v1/haedo-naver-blog' && request.method() === 'POST' && !!request.postDataJSON()?.action;
    if (!names.includes(rpc) && !mediaRequest && !captureWorker) return super.handle(route, device);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'content-type': 'application/json', 'cache-control': 'no-store' };
    const send = async (value, status = 200) => {
      try { return await route.fulfill({ status, headers, body: JSON.stringify(value) }); }
      catch (error) { if (!/closed|disposed|handled|Target page/i.test(error.message)) throw error; }
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const owner = this.owner(request); assert.ok(Object.values(accounts).some(account => account.id === owner));
    if (mediaRequest) {
      const key = decodeURIComponent(url.pathname.split('/haedo-naver-originals/')[1]);
      this.captureCalls.push({ rpc: 'media', device, owner, key }); const value = this.media.get(key);
      if (!value || value.owner !== owner) return send({ error: 'owner_required' }, 403);
      return route.fulfill({ status: 200, headers: { ...headers, 'content-type': value.type }, body: value.bytes });
    }
    const body = request.postDataJSON(); this.captureCalls.push({ rpc: captureWorker ? 'worker' : rpc, device, owner, body: clone(body) });
    if (this.holds.has(rpc)) { const hold = this.holds.get(rpc); this.holds.delete(rpc); hold.enter(); await hold.released; }
    const owned = [...this.subscriptions.entries()].filter(([key]) => key.startsWith(owner + ':')).map(([, row]) => row);
    if (rpc === 'life_naver_account_list') return send({ subscriptions: owned.map(row => ({ ...row, inventory: clone(this.inventories.get(row.id) || null) })), ready: true, hasMore: false, nextCursor: null });
    if (rpc === 'life_naver_capture_read') { const row = this.captureRows.get(body.p_capture_id); return send(row?.owner_id === owner ? row : null); }
    const sub = owned.find(row => row.id === body.p_subscription_id || row.id === body.subscriptionId);
    if (!sub && !captureWorker) return send({ code: '42501', message: 'Synthetic owner scope rejected' }, 403);
    if (rpc === 'life_naver_inventory_state') return send(this.inventories.get(sub.id));
    if (rpc === 'life_naver_inventory_start') {
      assert.equal(body.p_expected_revision, sub.revision, 'Owner UI pins the subscription revision');
      const old = this.inventories.get(sub.id); this.inventories.set(sub.id, { ...old, status: 'pending', last_error: null }); return send(this.inventories.get(sub.id));
    }
    if (rpc === 'life_naver_inventory_list') {
      if (this.failInventory) { this.failInventory = false; this.expectedHttpErrors++; return send({ code: 'XX000', message: 'Synthetic inventory failure' }, 503); }
      assert.equal(body.p_limit, 100); return send({ inventory: clone(this.inventories.get(sub.id)), items: clone(this.inventoryRows.get(sub.id) || []), hasMore: false, nextCursor: null });
    }
    if (rpc === 'life_naver_capture_request') {
      assert.equal(body.p_expected_revision, sub.revision); assert.ok(this.inventoryRows.get(sub.id).some(row => row.logNo === body.p_log_no));
      const key = owner + ':' + body.p_log_no, old = this.jobs.get(key);
      const job = { id: old?.id || 'ffffffff-ffff-4fff-8fff-' + body.p_log_no.padStart(12, '0'), subscription_id: sub.id, blog_id: blogId,
        log_no: body.p_log_no, revision: (old?.revision || 0) + 1, status: 'pending', last_error: null, error: null, progress: null, capture_id: null };
      this.jobs.set(key, job); return send(job);
    }
    if (rpc === 'life_naver_capture_list') { assert.equal(body.p_limit, 10); return send({ captures: [...this.captureRows.values()].filter(row => row.owner_id === owner && row.blog_id === sub.blog_id), jobs: [...this.jobs.entries()].filter(([key]) => key.startsWith(owner + ':')).map(([, row]) => clone(row)), hasMore: false, nextCursor: null }); }
    assert.equal(captureWorker, true);
    const target = owned.find(row => row.id === body.subscriptionId || [...this.jobs.values()].some(job => job.subscription_id === row.id && job.id === body.jobId));
    if (!target) return send({ error: 'owner_required' }, 403);
    const inventory = this.inventories.get(target.id);
    if (inventory?.status === 'pending') this.inventories.set(target.id, { ...inventory, status: 'complete', page: 2, last_error: null, baseline_completed_at: '2026-10-21T10:00:00.000Z', baseline_count: 21, baseline_scan_id: '99999999-9999-4999-8999-999999999999' });
    for (const [key, job] of this.jobs) if (job.subscription_id === target.id) {
      const capture = [...this.captureRows.values()].find(row => row.owner_id === owner && row.log_no === job.log_no);
      if (capture) this.jobs.set(key, { ...job, status: 'complete', capture_id: capture.id });
    }
    return send({ status: 'checked' });
  }
}

async function seedPagination(page, workspaceId) {
  // Twenty earlier partial originals make the real twenty-first-row and filter
  // return boundary observable; they are the exact historical inventory page.
  await page.evaluate(async ws => {
    const C = HaedoLife.Core, storage = HaedoLife.Shell.storage; let bundle = await storage.read(ws);
    for (let i = 0; i < 20; i++) {
      const log = String(200020 - i), prepared = await C.prepareImport({ origin: 'naver_blog', title: '과거 공개 목록 ' + (i + 1),
        url: 'https://blog.naver.com/example_haedo/' + log, text: '일부만 보관한 과거 합성 본문 ' + log, coverage: 'partial' }, bundle);
      const result = await storage.commitLocal({ workspaceId: ws, baseRevision: bundle.revision, operationId: C.id(), changes: C.buildImportChanges(bundle, prepared) });
      if (result.status !== 'stored') throw Error('Historical-page fixture failed'); bundle = await storage.read(ws);
    }
  }, workspaceId);
}
async function idle(page) {
  await page.waitForFunction(() => document.querySelector('#lifeNaverBlog')?.getAttribute('aria-busy') !== 'true' &&
    ['ready', 'setup-required', 'partial', 'error'].includes(document.querySelector('#naverBlogStatus')?.dataset.state));
}
async function captureIdle(page) {
  await page.waitForFunction(() => document.querySelector('#naverCaptureReview')?.getAttribute('aria-busy') === 'false');
}
async function storedMedia(page, workspaceId, versionId) {
  return page.evaluate(async ({ workspaceId, versionId }) => {
    const value = await HaedoLife.Shell.storage.readNaverCapture(workspaceId, versionId); if (!value) return null;
    const photos = await Promise.all(value.photos.map(async photo => ({ index: photo.index, type: photo.blob.type, size: photo.blob.size,
      sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await photo.blob.arrayBuffer()))].map(v => v.toString(16).padStart(2, '0')).join('') })));
    return { ...value, photos };
  }, { workspaceId, versionId });
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const rootDir = path.resolve(__dirname, '..');
  const files = ['assets/life/naver-capture.js', 'assets/life/naver-capture-sync.js', 'assets/life/naver-capture-ui.js', 'assets/life/naver-media.js',
    'assets/life/naver-blog-ui.js', 'assets/life/naver-blog-sync.js', 'assets/life/naver-blog.css', 'assets/life/storage.js', 'assets/life/ui.js',
    'assets/life/photo-post-ui.js', 'assets/life/core.js', 'assets/life/ui.css', 'index.html', 'life.html', 'assets/platform-auth.js', 'sw.js'];
  async function hashes() {
    const result = {};
    for (const file of files) {
      const disk = hash(await fs.readFile(path.join(rootDir, file))), response = await fetch(base + '/' + file);
      assert.equal(response.status, 200); assert.equal(hash(Buffer.from(await response.arrayBuffer())), disk, 'Served source differs: ' + file); result[file] = disk;
    }
    return result;
  }
  const sourceHashes = await hashes();
  const report = { navigationReadiness: 'DOMContentLoaded plus verified Shell/settle, explicit visible DOM and decoded-original pixel/SHA assertions; unchanged 20000ms bounds. Whole load-event failure remains unclassified; no font/network errors are suppressed.', scope: 'Actual application, bundled SDK, IndexedDB, PNG decoder and portable ZIP. Synthetic verified owner API and private Storage HTTP only; no actual Naver fetch, deployed SQL/RLS, cron, physical second device or Apple proof.',
    checks: [], visual: [], consoleErrors: [], expectedConsoleErrors: [], pageErrors: [], externalRequests: [], sourceHashes, testHash: hash(await fs.readFile(__filename)) };
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version(); const contexts = [], server = new CaptureCloud(); let page;
  async function device(name, account = accounts.a) {
    const context = await makeContext(browser, server, name, account, { viewport: { width: 1440, height: 1000 } }); contexts.push(context);
    // Observe completion without altering the service results or auth guards.
    await context.addInitScript(() => {
      window.__captureActiveReads = 0;
      const life = window.HaedoLife ||= {};
      Object.defineProperty(life, 'PhotoPost', { configurable: true, set(api) {
        Object.defineProperty(life, 'PhotoPost', { configurable: true, writable: true, value: Object.freeze({ ...api, async readPhoto(...args) {
          const trace = window.__captureApplyTrace, phase = trace && { start: performance.now(), bytes: args[0]?.size };
          if (trace) trace.photos.push(phase);
          try { return await api.readPhoto(...args); } catch (error) { if (phase) phase.error = error.code || error.name; throw error; }
          finally { if (phase) phase.end = performance.now(); }
        } }) });
      } });
      Object.defineProperty(life, 'NaverCaptureSync', { configurable: true, set(api) {
        Object.defineProperty(life, 'NaverCaptureSync', { configurable: true, writable: true, value: { ...api, create(options) {
          const actual = api.create(options), wrapped = { ...actual };
          for (const method of ['readCapture', 'receiveCapture']) wrapped[method] = async (...args) => {
            window.__captureActiveReads++;
            const trace = method === 'receiveCapture' && window.__captureApplyTrace, phase = trace && { start: performance.now() };
            if (trace) trace.receives.push(phase);
            try { return await actual[method](...args); } catch (error) { if (phase) phase.error = error.code || error.name; throw error; }
            finally { if (phase) phase.end = performance.now(); window.__captureActiveReads--; }
          };
          return Object.freeze(wrapped);
        } } });
      } });
    });
    await context.route('**/*', route => {
      const origin = new URL(route.request().url()).origin;
      if ([new URL(base).origin, cloud].includes(origin)) return route.fallback();
      report.externalRequests.push(origin); return route.abort();
    });
    const p = await context.newPage(); p.setDefaultTimeout(20000); trackRequests(p);
    p.on('pageerror', error => report.pageErrors.push({ device: name, message: error.message }));
    p.on('console', message => { if (message.type() === 'error') {
      const expected = /Failed to load resource.*(?:503|403)/.test(message.text()) && server.expectedHttpErrors;
      (expected ? report.expectedConsoleErrors : report.consoleErrors).push({ device: name, message: message.text() });
    } });
    await loadDocument(p, base + '/index.html'); await ready(p); await settle(p); return p;
  }
  async function check(name, action) {
    console.log('START ' + name);
    try {
      const details = await action();
      if (seeded && original) {
        const after = await preserved(page, seeded);
        assert.deepEqual(after.doc, original.doc, 'Existing saved original photo and body changed');
        assert.deepEqual(after.old, original.old, 'Existing six sources, private notes or exact links changed');
        assert.deepEqual(after.posts.filter(row => original.posts.some(old => old.id === row.id)), original.posts, 'Existing draft/saved summaries changed');
        assert.deepEqual(after.stages.filter(row => original.stages.some(old => old.stageId === row.stageId)), original.stages);
      }
      report.checks.push({ name, pass: true, existingBodyPhotoAndDraftsPreserved: true, ...details }); console.log('PASS ' + name);
    }
    catch (error) {
      report.checks.push({ name, pass: false, error: error.stack });
      report.failureBeforeScreenshot = await page?.evaluate(() => {
        const status = document.querySelector('#naverCaptureStatus'), rect = status?.getBoundingClientRect(), css = status && getComputedStyle(status);
        return { now: performance.now(), trace: window.__captureApplyTrace, state: status?.dataset.state,
          rect: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, hidden: status?.hidden,
          display: css?.display, visibility: css?.visibility, opacity: css?.opacity, busy: document.querySelector('#naverCaptureReview')?.getAttribute('aria-busy') };
      }).catch(() => null);
      await page?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
      report.failureSurface = await page?.evaluate(() => ({ pathname: location.pathname, search: location.search,
        status: document.querySelector('#naverBlogStatus')?.dataset.state,
        captureStatus: document.querySelector('#naverCaptureStatus')?.dataset.state,
        error: document.querySelector('#naverCaptureError')?.textContent,
        visibleButtons: [...document.querySelectorAll('button')].filter(n => n.getClientRects().length).map(n => n.textContent) })).catch(() => null);
      throw error;
    } finally { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
  }
  let seeded, sub, row, original, initialGraph, received, archive, postId, capturePhotoFiles;
  const publicRow = log => page.locator('.nv-public-item[data-log-no="' + log + '"]');
  const reviewButton = () => page.locator('.nv-capture-row[data-capture-id="' + row.id + '"] [data-action=review-capture]');
  try {
    page = await device('capture-a'); seeded = await seedCapture(page); await seedPagination(page, seeded.workspaceId);
    original = await preserved(page, seeded); initialGraph = await sourceBundle(page); sub = server.setup(seeded.workspaceId);
    capturePhotoFiles = seeded.photoFiles; row = await capturedRow(capturePhotoFiles); server.addCapture(row, capturePhotoFiles);
    await check('Account connection discovery, truthful failed historical inventory, explicit resume and twenty-first selected request', async () => {
      await enter(page); await idle(page); await page.locator('.nv-connection[data-connection-id="' + sub.id + '"]').waitFor();
      assert.equal(await page.locator('#naverBlogAuto').isChecked(), false);
      const connection = page.locator('.nv-connection[data-connection-id="' + sub.id + '"]');
      server.failInventory = true; await connection.locator('[data-action=public-list]').click();
      await page.locator('#naverCaptureIntakeError:not([hidden])').waitFor();
      assert.equal((await sourceBundle(page)).sourceVersions.length, initialGraph.sourceVersions.length);
      await connection.locator('[data-action=inventory]').click();
      await page.waitForFunction(() => document.querySelector('#naverCaptureIntakeStatus')?.dataset.state === 'ready');
      assert.equal(server.inventories.get(sub.id).status, 'complete');
      await page.locator('#naverPublicFilter').selectOption('needs_content');
      assert.equal(await page.locator('.nv-public-item').count(), 20);
      assert.equal(await publicRow('100002').count(), 0); await page.locator('#naverPublicMore').click(); await publicRow('100002').waitFor();
      assert.equal(await page.locator('.nv-public-item').count(), 21);
      await publicRow('100002').locator('input[data-log-no]').check();
      await page.locator('#naverCaptureQueue').click(); await reviewButton().waitFor(); await idle(page);
      const calls = server.captureCalls.filter(call => call.rpc === 'life_naver_capture_request'); assert.equal(calls.length, 1);
      assert.equal(calls[0].body.p_log_no, '100002'); assert.equal(calls[0].body.p_expected_revision, sub.revision);
      assert.equal((await sourceBundle(page)).sourceVersions.length, initialGraph.sourceVersions.length);
      await capture(page, report, 'selected-historical-page'); return { requestedOnlySelected: true, inventoryResume: true, twentyFirstRow: true };
    });
    await check('Capture review verifies real originals, discloses failed photos and atomically supplements the same source without changing old exact quotations', async () => {
      await reviewButton().click(); await page.locator('#naverCaptureReview').waitFor();
      assert.equal(await page.locator('#naverCaptureBody').textContent(), fullText);
      const cacheCheck = await page.evaluate(async ({ ws, id }) => {
        const service = HaedoLife.NaverCaptureSync.create({ storage: HaedoLife.Shell.storage, auth: HaedoAuth });
        try {
          const first = await service.readCapture(ws, id), title = first.capture.payload.title;
          first.capture.payload.title = '호출자에서 바꾼 값'; first.capture.payload.body = '바뀌면 안 되는 캐시'; first.photos.pop();
          const second = await service.readCapture(ws, id);
          return { changedReturnedObject: first.capture.payload.title !== title, title: second.capture.payload.title,
            body: second.capture.payload.body, captureHash: second.capture.capture_hash, photos: second.photos.length };
        } finally { service.dispose(); }
      }, { ws: seeded.workspaceId, id: row.id });
      assert.equal(cacheCheck.changedReturnedObject, true); assert.equal(cacheCheck.title, row.payload.title); assert.equal(cacheCheck.body, fullText); assert.equal(cacheCheck.captureHash, row.capture_hash); assert.equal(cacheCheck.photos, 2);

      await page.waitForFunction(() => [...document.querySelectorAll('.nv-capture-photo img')].every(img => img.naturalWidth > 0));
      assert.deepEqual(await page.locator('.nv-capture-photo img').evaluateAll(images => images.map(img => [img.naturalWidth, img.naturalHeight])), [[4032, 3024], [1200, 1800]]);
      assert.equal(await page.locator('.nv-capture-photo[data-state=failed] input').count(), 0);
      assert.equal(await page.locator('.nv-capture-photo[data-photo-index="0"] figcaption').textContent(), row.payload.photos[0].caption);
      assert.match(await page.locator('.nv-capture-photo[data-state=failed]').textContent(), /보관하지 못/);
      assert.equal(await page.locator('#naverCaptureWritePhotos').isDisabled(), true);
      assert.deepEqual(await page.locator('.nv-capture-photo input').evaluateAll(nodes => nodes.map(n => n.checked)), [false, false]);
      await capture(page, report, 'truthful-capture-review');
      const before = await databaseSnapshot(page);
      await page.evaluate(() => {
        window.__captureApplyTrace = { start: performance.now(), aborts: [], photos: [], receives: [], statuses: [] };
        const surface = document.querySelector('#naverCaptureReview');
        window.__captureApplyObserver = new MutationObserver(() => { const trace = window.__captureApplyTrace; if (trace) trace.statuses.push({ at: performance.now(), state: document.querySelector('#naverCaptureStatus')?.dataset.state, busy: surface.getAttribute('aria-busy') }); });
        window.__captureApplyObserver.observe(surface, { attributes: true, childList: true, characterData: true, subtree: true });
        window.__captureAdd = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function (...args) { const result = window.__captureAdd.apply(this, args);
          if (String(args[0]?.key || args[1] || '').startsWith('naver-capture:')) { window.__captureApplyTrace.aborts.push(performance.now()); this.transaction.abort(); } return result; };
      });
      await page.locator('#naverCaptureApply').click(); await page.locator('#naverCaptureStatus[data-state=error]').waitFor();
      const abortTrace = await page.evaluate(() => structuredClone(window.__captureApplyTrace));
      assert.equal(abortTrace.aborts.length, 1, 'The intended final sidecar transaction must actually abort once');
      assert.equal(abortTrace.receives.length, 1); assert.ok(abortTrace.receives[0].end - abortTrace.receives[0].start < 20000);
      report.atomicAbortTrace = abortTrace;
      assert.deepEqual(await databaseSnapshot(page), before, 'The final capture-sidecar abort must roll back every source and operation');
      await page.evaluate(() => { IDBObjectStore.prototype.add = window.__captureAdd; window.__captureApplyObserver.disconnect(); window.__captureApplyTrace = null; });
      await page.locator('#naverCaptureApply').click(); await page.locator('#naverCaptureStatus[data-state=stored]').waitFor(); await captureIdle(page);
      const bundle = await sourceBundle(page); const source = bundle.sources.find(value => value.id === seeded.original.sourceId);
      const version = bundle.sourceVersions.filter(value => value.sourceId === source.id).at(-1);
      received = { sourceId: source.id, sourceVersionId: version.id };
      assert.notEqual(version.id, seeded.original.versionId); assert.equal(version.contentText, fullText); assert.equal(version.contentHash, hash(Buffer.from(fullText)));
      await assertOriginalGraph(page, initialGraph, seeded.workspaceId, [source.id]);
      const resolved = await page.evaluate(async reference => { const b = await HaedoLife.Shell.storage.read(reference.workspaceId); const target = await HaedoLife.SourceReference.resolve(b, reference); const v = b.sourceVersions.find(v => v.id === target.sourceVersionId); return { target, quote: v.contentText.slice(target.locator.start, target.locator.end) }; }, seeded.original.reference);
      assert.equal(resolved.target.sourceVersionId, seeded.original.versionId); assert.equal(resolved.quote, previousQuote);
      const media = await storedMedia(page, seeded.workspaceId, version.id);
      assert.deepEqual(media.photos.map(photo => [photo.sha256, photo.size]), seeded.photoFiles.map(photo => [photo.digest, photo.size]));
      assert.equal(media.capture.capture_hash, row.capture_hash);
      const once = await databaseSnapshot(page); await page.locator('#naverCaptureApply').click(); await page.locator('#naverCaptureStatus[data-state=stored]').waitFor(); await captureIdle(page);
      assert.deepEqual(await databaseSnapshot(page), once, 'Receiving the same immutable capture is a no-write operation');
      const firstCapture = clone(row), firstVersion = received.sourceVersionId;
      capturePhotoFiles = seeded.photoFiles.slice().reverse();
      const nextCapture = await capturedRow(capturePhotoFiles, { title: row.payload.title }); nextCapture.id = 'eeeeeeee-eeee-4eee-8eee-000000900002';
      assert.equal(nextCapture.payload.bodyHash, firstCapture.payload.bodyHash); assert.notEqual(nextCapture.capture_hash, firstCapture.capture_hash);
      server.addCapture(nextCapture, capturePhotoFiles); row = nextCapture;
      await page.locator('#naverCaptureReturn').click(); await idle(page); await reviewButton().click(); await page.locator('#naverCaptureReview').waitFor();
      await page.locator('.nv-capture-photo input[data-photo-index="0"]').check();
      assert.equal(await page.locator('#naverCaptureWritePhotos').isDisabled(), true, 'A newly reviewed capture cannot write photos from an older attached version');
      assert.equal(await page.locator('#naverCaptureDownload').isDisabled(), true, 'A newly reviewed capture cannot export an older attached capture');
      assert.equal((await storedMedia(page, seeded.workspaceId, firstVersion)).capture.capture_hash, firstCapture.capture_hash);
      const beforeSecond = await sourceBundle(page); await page.locator('#naverCaptureApply').click(); await page.locator('#naverCaptureStatus[data-state=stored]').waitFor(); await captureIdle(page);
      const afterSecond = await sourceBundle(page), latest = afterSecond.sourceVersions.filter(v => v.sourceId === received.sourceId).at(-1);
      assert.equal(afterSecond.sourceVersions.length, beforeSecond.sourceVersions.length + 1); assert.notEqual(latest.id, firstVersion);
      assert.equal(latest.contentHash, firstCapture.payload.bodyHash); assert.equal(latest.contentText, fullText);
      received = { sourceId: received.sourceId, sourceVersionId: latest.id };
      const newestMedia = await storedMedia(page, seeded.workspaceId, latest.id);
      assert.equal(newestMedia.capture.capture_hash, row.capture_hash); assert.deepEqual(newestMedia.photos.map(p => p.sha256), capturePhotoFiles.map(p => p.digest));
      assert.equal((await storedMedia(page, seeded.workspaceId, firstVersion)).capture.capture_hash, firstCapture.capture_hash);
      await assertOriginalGraph(page, initialGraph, seeded.workspaceId, [received.sourceId]);
      await page.locator('#naverCaptureOpen').click(); await page.locator('#lifeSourceText').waitFor();
      assert.equal(await page.locator('#lifeSourceText').getAttribute('data-reading-mode'), 'formatted');
      assert.equal(await page.locator('#lifeSourceText h1').textContent(), '보완한 합성 기록');
      assert.equal(await page.locator('#lifeSourceText h2').textContent(), '이어지는 생각');
      await page.locator('#lifeSourceInfoToggle').click();
      await page.getByRole('button', { name: '원문 텍스트 보기', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#lifeSourceText')?.dataset.readingMode === 'raw');
      assert.equal(await page.locator('#lifeSourceText').textContent(), fullText);
      await page.getByRole('button', { name: '출처 정보 닫기', exact: true }).click();
      await page.locator('.nv-capture-photo img').first().waitFor();
      const download = page.waitForEvent('download'); await page.getByRole('button', { name: '글·사진 ZIP 저장', exact: true }).click();
      archive = await fs.readFile(await (await download).path());
      assert.ok(archive.length > seeded.photoFiles.reduce((n, photo) => n + photo.size, 0));
      await capture(page, report, 'source-originals-reader');
      return { oldSourceIdPreserved: true, oldQuotePreserved: true, atomicAbort: true, consumerCacheMutationIsolated: true, sameBodyDifferentCaptureExplicitlyAdopted: true, originalPhotos: seeded.photoFiles.map(photo => ({ sha256: photo.digest, width: photo.width, height: photo.height, bytes: photo.size })) };
    });
    await check('Selected capture photo becomes a saved and reopened ordinary blog post and returns to the same historical filter and row', async () => {
      const selectors = page.locator('.nv-capture-photo input[data-photo-index]');
      const chosenIndex = capturePhotoFiles.findIndex(photo => photo.width === 4032);
      assert.deepEqual(await selectors.evaluateAll(nodes => nodes.map(node => node.checked)), [false, false], 'Opening the source does not choose photos for a new post');
      await page.locator('.nv-capture-photo input[data-photo-index=\"' + chosenIndex + '\"]').check();
      assert.deepEqual(await selectors.evaluateAll(nodes => nodes.map(node => node.checked)), capturePhotoFiles.map((_, index) => index === chosenIndex));
      await page.getByRole('button', { name: '선택 사진으로 글쓰기', exact: true }).click(); await page.locator('#photoTitle').waitFor();
      assert.equal(await page.locator('.photo-block').count(), 1);
      await page.locator('#photoTitle').fill('선택한 네이버 사진으로 쓴 합성 글');
      await page.locator('.ql-editor').evaluate(node => { const quill = Quill.find(node.closest('.ql-container')); quill.insertText(0, '직접 쓴 생각과 선택한 사진\n', 'user'); });
      await page.getByRole('button', { name: '글 저장', exact: true }).click(); await page.locator('.photo-article').waitFor();
      postId = await waitStorage(page, async () => {
        const s = HaedoLife.Shell.storage, ws = await s.getActive(), rows = await s.listPhotoPosts(ws);
        const row = rows.find(value => value.title === '선택한 네이버 사진으로 쓴 합성 글' && value.status === 'saved');
        return row && (await s.readBlogSyncState(ws, row.id))?.status === 'synced' ? row.id : null;
      }, undefined, 'explicit saved post and confirmed private server storage');
      const doc = await page.evaluate(async ({ ws, id }) => {
        const d = await HaedoLife.Shell.storage.readPhotoPost(ws, id);
        const photos = await Promise.all(d.photos.map(async p => { const actual = await HaedoLife.PhotoPost.readPhoto(p.blob, () => p.id); const { blob, ...metadata } = actual; return metadata; }));
        return { ...d, photos };
      }, { ws: seeded.workspaceId, id: postId });
      assert.equal(doc.photos.length, 1); assert.equal(doc.photos[0].digest, seeded.photoFiles[0].digest); assert.equal(doc.photos[0].size, seeded.photoFiles[0].size); assert.equal(doc.photos[0].width, 4032); assert.equal(doc.photos[0].height, 3024);
      const selectedEmbed = doc.ops.find(op => op.insert?.photo)?.insert.photo;
      assert.equal(selectedEmbed.caption, row.payload.photos[chosenIndex].caption); assert.equal(selectedEmbed.alt, row.payload.photos[chosenIndex].alt);
      const storedPost = [...server.posts.values()].find(value => value.owner === accounts.a.id && value.data.title === doc.title);
      assert.ok(storedPost); assert.equal(storedPost.data.photos.length, 1); assert.equal(storedPost.data.photos[0].digest, seeded.photoFiles[0].digest); assert.equal(storedPost.publication, null);
      assert.equal(JSON.stringify(storedPost.data).includes(previousQuote), false); assert.equal(JSON.stringify(storedPost.data).includes('자동 수집이나 본문 보완으로 바꾸지 않을 개인 메모'), false);


      assert.match(await page.locator('.photo-article').innerText(), /직접 쓴 생각/); await capture(page, report, 'selected-photo-saved-post');
      const reopened = await page.context().newPage(); reopened.setDefaultTimeout(20000); trackRequests(reopened);
      reopened.on('pageerror', error => report.pageErrors.push({ device: 'capture-a-reopen', message: error.message }));
      reopened.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ device: 'capture-a-reopen', message: message.text() }); });
      const saveCount = server.saves().length;
      try {
        await loadDocument(reopened, base + '/index.html'); await ready(reopened); await settle(reopened);
        await reopened.locator('#homePostList [data-photo-post-id=\"' + postId + '\"] .home-post-read').click();
        await reopened.locator('.photo-article').waitFor();
        assert.match(await reopened.locator('.photo-article').innerText(), /직접 쓴 생각/);
        await reopened.waitForFunction(() => document.querySelector('.photo-read-image img')?.naturalWidth === 4032);
        assert.equal(await reopened.locator('.photo-read-image').count(), 1); assert.equal(server.saves().length, saveCount, 'Reopening must not retransmit the saved post');
      } finally { await reopened.close(); }

      await page.locator('#lifeSubviewReturn').click(); await page.locator('#lifeNaverBlog').waitFor(); await idle(page);
      assert.equal(await page.locator('#naverPublicFilter').inputValue(), 'needs_content');
      await reviewButton().waitFor(); await page.waitForFunction(id => document.activeElement?.dataset.focusKey === 'naver-blog:capture:' + id, row.id);
      await reviewButton().click(); await page.locator('#naverCaptureReview').waitFor();
      const reDownload = page.waitForEvent('download'); await page.locator('#naverCaptureDownload').click();
      assert.deepEqual(ZIP.unzipSync(await fs.readFile(await (await reDownload).path())), ZIP.unzipSync(archive));
      return { savedPostId: postId, exactSelectedOriginalOnly: true, savedPostReopenedThroughHome: true, privateStorageConfirmed: true, historicalFilterAndExactFocus: true };
    });
    await check('Dedicated capture ZIP restores a new private workspace with exact body and originals while a fresh same-owner context independently discovers and receives the server capture', async () => {
      const zipFiles = ZIP.unzipSync(archive), manifest = JSON.parse(Buffer.from(zipFiles['manifest.json']).toString('utf8'));
      assert.deepEqual(Object.keys(zipFiles).sort(), ['manifest.json', 'photos/0', 'photos/1']);
      assert.equal(manifest.format, 'haedo.naver.capture.v1'); assert.equal(manifest.bundle.sourceVersions.length, 1); assert.equal(manifest.bundle.records.length, 0);
      assert.equal(manifest.bundle.sourceVersions[0].contentText, fullText);
      assert.equal(manifest.attachment.localOnly, true); assert.deepEqual(Object.keys(manifest.attachment.capture).sort(), ['capture_hash', 'payload']); assert.equal(JSON.stringify(manifest).includes(accounts.a.id), false, 'A portable capture must not contain the owner account UUID'); assert.ok(manifest.attachment.capture.payload.photos.every(photo => photo.storagePath === null));
      for (const [index, photo] of capturePhotoFiles.entries()) assert.equal(hash(zipFiles['photos/' + index]), photo.digest);
      await page.locator('#naverCaptureReturn').click(); await idle(page);
      const oldSpaces = await page.evaluate(async () => (await HaedoLife.Shell.storage.listWorkspaces()).map(value => value.workspaceId));
      await page.locator('#naverCaptureImportFile').setInputFiles({ name: 'anonymous-capture.zip', mimeType: 'application/zip', buffer: archive });
      const restored = await waitStorage(page, async old => {
        const s = HaedoLife.Shell.storage, ws = await s.getActive(); if (old.includes(ws)) return null;
        const b = await s.read(ws); return b.sources.length === 1 ? b : null;
      }, oldSpaces, 'new workspace capture file copy');
      assert.notEqual(restored.sources[0].id, received.sourceId); assert.notEqual(restored.sourceVersions[0].id, received.sourceVersionId);
      assert.equal(restored.sourceVersions[0].contentText, fullText); assert.equal(restored.sourceVersions[0].contentHash, hash(Buffer.from(fullText)));
      const restoredMedia = await storedMedia(page, restored.workspaceId, restored.sourceVersions[0].id);
      assert.equal(restoredMedia.localOnly, true); assert.deepEqual(restoredMedia.photos.map(photo => photo.sha256), capturePhotoFiles.map(photo => photo.digest));
      await assertOriginalGraph(page, initialGraph, seeded.workspaceId, [seeded.original.sourceId]);
      const fresh = await device('capture-fresh-a'); const freshWs = await fresh.evaluate(() => HaedoLife.Shell.storage.getActive());
      assert.notEqual(freshWs, seeded.workspaceId); await enter(fresh); await idle(fresh);
      const discovered = fresh.locator('.nv-connection[data-connection-id="' + sub.id + '"]'); await discovered.waitFor();
      assert.equal(await discovered.locator('[data-action=connect-here]').count(), 0, 'An account connection is directly usable without duplicate registration');
      assert.equal(server.subscriptions.has(accounts.a.id + ':' + freshWs), false);
      await discovered.locator('[data-action=public-list]').click();
      await fresh.locator('.nv-capture-row[data-capture-id="' + row.id + '"] [data-action=review-capture]').click();
      await fresh.locator('#naverCaptureApply').click(); await fresh.locator('#naverCaptureStatus[data-state=stored]').waitFor(); await captureIdle(fresh);
      const b = await sourceBundle(fresh), version = b.sourceVersions.find(value => value.contentHash === row.payload.bodyHash); assert.ok(version); assert.equal(version.contentText, fullText); assert.notEqual(version.id, received.sourceVersionId); assert.notEqual(version.sourceId, received.sourceId);
      const media = await storedMedia(fresh, freshWs, version.id); assert.deepEqual(media.photos.map(photo => photo.sha256), capturePhotoFiles.map(photo => photo.digest));
      const before = await databaseSnapshot(fresh); await fresh.locator('#naverCaptureApply').click(); await fresh.locator('#naverCaptureStatus[data-state=stored]').waitFor(); await captureIdle(fresh); assert.deepEqual(await databaseSnapshot(fresh), before);
      await capture(fresh, report, 'fresh-account-received-originals');
      return { dedicatedFileBytes: archive.length, newWorkspaceAndIds: true, freshIndependentIDB: true, exactBodyAndOriginals: true, repeatedReceiveWrites: 0 };
    });
    await check('Other-account discovery is empty and delayed capture replies cannot install after leaving the active screen', async () => {
      const foreign = await device('capture-b', accounts.b); await enter(foreign); await idle(foreign);
      assert.equal(await foreign.locator('.nv-connection').count(), 0); assert.equal(await foreign.locator('.nv-capture-row').count(), 0);
      const foreignBefore = await databaseSnapshot(foreign);
      const result = await foreign.evaluate(async id => {
        const ws = await HaedoLife.Shell.storage.getActive(), m = HaedoLife.NaverCaptureSync.create({ storage: HaedoLife.Shell.storage, auth: HaedoAuth });
        try { await m.readCapture(ws, id); return false; } catch (error) { return { code: error.code }; } finally { m.dispose(); }
      }, row.id);
      assert.ok(result.code); assert.deepEqual(await databaseSnapshot(foreign), foreignBefore);
      // Use a fresh service/view so no previously verified snapshot can hide the
      // real delayed capture-read boundary.
      await enter(page); await idle(page);
      await page.locator('.nv-connection[data-connection-id=\"' + sub.id + '\"] [data-action=public-list]').click();
      const before = await databaseSnapshot(page), hold = gate(); server.holdCaptureNext('life_naver_capture_read', hold);
      await reviewButton().click(); await arrived(hold);
      try {
        await nav(page, 'home'); hold.release(); await page.waitForFunction(() => window.__captureActiveReads === 0);
        assert.equal(await page.locator('#naverCaptureReview').count(), 0); assert.deepEqual(await databaseSnapshot(page), before);
      } finally { hold.release(); }
      await foreign.evaluate(async value => { await HaedoAuth.client.auth.setSession(value); await HaedoAuth.verify(); }, session(accounts.a));
      await foreign.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell.storage?.account?.userId === id, accounts.a.id);
      await enter(foreign); await idle(foreign);
      await foreign.locator('.nv-connection[data-connection-id="' + sub.id + '"] [data-action=public-list]').click();
      const lateAccount = gate(); server.holdCaptureNext('life_naver_capture_read', lateAccount);
      await foreign.locator('.nv-capture-row[data-capture-id="' + row.id + '"] [data-action=review-capture]').click(); await arrived(lateAccount);
      try {
        await foreign.evaluate(async value => { await HaedoAuth.client.auth.setSession(value); await HaedoAuth.verify(); }, session(accounts.b));
        await foreign.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell.storage?.account?.userId === id, accounts.b.id);
        await ready(foreign); await settle(foreign); const beforeB = await databaseSnapshot(foreign);
        lateAccount.release(); await foreign.waitForFunction(() => window.__captureActiveReads === 0);
        assert.deepEqual(await databaseSnapshot(foreign), beforeB, 'A former account reply cannot install text, images, owner or active metadata');
        assert.equal(await foreign.locator('#naverCaptureReview').count(), 0);
      } finally { lateAccount.release(); }
      // A photo-bearing link-only capture must keep the gallery even though
      // the source reader has no text node or selectable textual quotation.
      const linkOnly = await capturedRow(seeded.photoFiles, { logNo: '100003', title: '본문 없이 사진을 보관한 합성 사본' });
      linkOnly.payload.body = null; linkOnly.payload.bodyHash = null; linkOnly.payload.coverage = 'link_only';
      linkOnly.payload.omissions = ['본문을 확보하지 못했습니다. 사진 1장도 보관하지 못했습니다.'];
      linkOnly.capture_hash = await CaptureModel.fingerprint(linkOnly.payload); await CaptureModel.validateCaptureRow(linkOnly);
      server.addCapture(linkOnly, seeded.photoFiles);
      server.inventoryRows.get(sub.id).push({ blogId, logNo: '100003', title: linkOnly.payload.title, publishedAt: null, firstSeenAt: '2026-10-21T10:00:00.000Z', baseline: true, captureId: linkOnly.id, job: null });
      await enter(page); await idle(page);
      await page.locator('.nv-connection[data-connection-id=\"' + sub.id + '\"] [data-action=public-list]').click();
      await page.locator('.nv-capture-row[data-capture-id=\"' + linkOnly.id + '\"] [data-action=review-capture]').click();
      await page.locator('#naverCaptureReview').waitFor();
      assert.match(await page.locator('#naverCaptureBody').textContent(), /본문은 확보하지 못/);
      await page.locator('#naverCaptureApply').click(); await page.locator('#naverCaptureStatus[data-state=stored]').waitFor(); await captureIdle(page);
      await page.locator('#naverCaptureOpen').click(); await page.locator('#lifeNaverSourceMedia[data-state=ready]').waitFor();
      assert.equal(await page.locator('#lifeSourceText').count(), 0, 'A missing body must not be synthesized');
      assert.match(await page.locator('article.life-reader').textContent(), /본문 미확보/);
      await page.waitForFunction(() => [...document.querySelectorAll('#lifeNaverSourceMedia .nv-capture-photo img')].length === 2 && [...document.querySelectorAll('#lifeNaverSourceMedia .nv-capture-photo img')].every(img => img.naturalWidth > 0));
      assert.deepEqual(await page.locator('#lifeNaverSourceMedia .nv-capture-photo img').evaluateAll(images => images.map(img => [img.naturalWidth, img.naturalHeight])), [[4032, 3024], [1200, 1800]]);
      const linkBundle = await sourceBundle(page), linkSource = linkBundle.sources.find(source => source.url === postUrl('100003'));
      const linkVersion = linkBundle.sourceVersions.find(version => version.sourceId === linkSource.id);
      assert.equal(linkVersion.contentText, null); assert.equal(linkVersion.contentHash, null); assert.equal(linkVersion.coverage.status, 'link_only');
      assert.deepEqual((await storedMedia(page, linkBundle.workspaceId, linkVersion.id)).photos.map(photo => photo.sha256), seeded.photoFiles.map(photo => photo.digest));
      await capture(page, report, 'link-only-original-gallery');
      assert.equal(server.writes().length, 0, 'The selected captures do not upload private workspaces');
      assert.equal(server.blogCalls.filter(call => /publish|unpublish/.test(call.rpc)).length, 0, 'Receiving or writing selected photos never auto-publishes');
      return { otherAccountDenied: true, lateReplyInstallWrites: 0, noAutomaticPublication: true, linkOnlyBodyAbsentAndOriginalGalleryVerified: true };
    });
    assert.equal(report.pageErrors.length, 0); assert.equal(report.consoleErrors.length, 0); assert.equal(report.externalRequests.length, 0);
    report.finalSourceHashes = await hashes(); assert.deepEqual(report.finalSourceHashes, sourceHashes, 'Source changed during the integrated run'); assert.equal(hash(await fs.readFile(__filename)), report.testHash, 'The running test source changed'); report.pass = true;
  } finally {
    await Promise.allSettled(contexts.map(context => context.close())); await browser.close(); report.resourcesClosed = true;
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
}
if (require.main === module) main().catch(error => {
  console.error(error);
  if (process.env.GITHUB_ACTIONS === 'true') {
    const message = String(error.message || error).slice(0, 4000).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.error('::error title=Naver capture verification::' + message);
  }
  process.exitCode = 1;
});

module.exports = { CaptureCloud, capturedRow, seedPagination, storedMedia, blogId, postUrl, fullText, selectedQuote, previousText, previousQuote, originals, seedCapture, gate, arrived, enter, capture };

/* First screen after sign-in (일정 목록, home mode): when the shell, the first
 * row of 내 글, the settled list and the entrance motion appear. Actual app,
 * bundled SDK and scoped IndexedDB; anonymous synthetic Auth and FakeCloud
 * with a synthetic per-request latency. Not a production, real-device or
 * field measurement.
 * BASE_URL=http://127.0.0.1:4373 HOME_PERF_SOURCE_ROOT=<site> node this-file
 * HOME_PERF_SAMPLES (3), HOME_PERF_THROTTLE (1 or 4), HOME_PERF_OUTPUT (fresh dir). */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4373';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const sourceRoot = path.resolve(process.env.HOME_PERF_SOURCE_ROOT || path.join(__dirname, '..'));
const { CompositionCloud } = require(path.join(sourceRoot, 'tests/composition-sync-browser.cjs'));
const { accounts, cloud, base } = require(path.join(sourceRoot, 'tests/life-sync-browser.cjs'));
const { playwright, makeContext } = require(path.join(sourceRoot, 'tests/unified-home-browser.cjs'));
const Core = require(path.join(sourceRoot, 'assets/life/core.js'));
const Workbench = require(path.join(sourceRoot, 'assets/life/workbench.js'));
const Metadata = require(path.join(sourceRoot, 'assets/life/library-meta.js'));
const output = path.resolve(process.env.HOME_PERF_OUTPUT || '.local/home-startup-performance');
const samples = Number(process.env.HOME_PERF_SAMPLES || 3);
const throttle = Number(process.env.HOME_PERF_THROTTLE || 1);
// Synthetic Supabase round trip: deterministic 150–300 ms per private request.
const latencyMin = Number(process.env.HOME_PERF_LATENCY_MIN || 150), latencyMax = Number(process.env.HOME_PERF_LATENCY_MAX || 300);
const ids = ['20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003'];
const sourceCounts = [300, 60, 40];
// Saved photo posts and drafts per library; 1–3 photos each.
const postPlan = [{ saved: 20, drafts: 2 }, { saved: 6, drafts: 1 }, { saved: 4, drafts: 1 }];
const totalPosts = postPlan.reduce((sum, row) => sum + row.saved + row.drafts, 0);
const savedPosts = postPlan.reduce((sum, row) => sum + row.saved, 0);
const copy = value => structuredClone(value);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(read, condition, label, timeout = 120000) { const deadline = Date.now() + timeout; let value; do { value = await read(); if (condition(value)) return value; await sleep(50); } while (Date.now() < deadline); throw Error(label + ' did not finish: ' + JSON.stringify(value)?.slice(0, 600)); }
async function dataset() {
  const rows = [];
  for (let w = 0; w < ids.length; w++) {
    let bundle = Core.createWorkspace({ workspaceId: ids[w], title: '익명 계측 자료공간 ' + (w + 1) });
    for (let n = 0; n < sourceCounts[w]; n++) {
      const text = '# 익명 자료 ' + w + ':' + n + '\n\n' + ('정확한 원문 보존과 읽기 흐름을 확인하는 합성 문장입니다. 🌱\n').repeat(12);
      const prepared = await Core.prepareImport({ origin: 'obsidian', title: '익명 계측 자료 ' + w + '-' + String(n).padStart(3, '0'), text, authorRelation: 'self', forceSeparate: true }, bundle);
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
const report = { createdAt: new Date().toISOString(), sourceRoot, base, samples, throttle, latency: [latencyMin, latencyMax], sourceCounts, postPlan,
  scope: 'Synthetic anonymous Auth/FakeCloud; deterministic per-request latency on private HTTP only; Playwright routing disables HTTP cache. Not production or Apple hardware.',
  measurements: [], consoleErrors: [], pageErrors: [] };
async function main() {
  await assert.rejects(fs.access(output), 'Fresh evidence directory required'); await fs.mkdir(output, { recursive: true });
  const datasetPath = process.env.HOME_PERF_DATASET ? path.resolve(process.env.HOME_PERF_DATASET) : null; let bundles;
  if (datasetPath) { try { bundles = JSON.parse(await fs.readFile(datasetPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; bundles = await dataset(); await fs.writeFile(datasetPath, JSON.stringify(bundles)); } }
  else bundles = await dataset();
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  let counter = 0, requestNo = 0;
  async function device(server, name, { latency = true } = {}) {
    const context = await makeContext(browser, server, name, accounts.a, { viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
      const m = window.__homePerf = { auth: null, shell: null, firstRow: null, listReady: null, rows20: null, motionEnd: null, animationsSeen: 0, longTasks: [] };
      try { new PerformanceObserver(list => { for (const e of list.getEntries()) m.longTasks.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch (_) {}
      const tick = () => {
        const now = performance.now(), app = document.getElementById('lifeApp');
        if (m.auth === null && globalThis.HaedoAuth?.user) m.auth = now;
        if (m.shell === null && app && !app.hidden && globalThis.HaedoAuth?.user) m.shell = now;
        const list = document.getElementById('homePostList');
        const rows = list ? list.querySelectorAll('.home-post,.home-draft').length : 0;
        if (m.shell !== null && m.firstRow === null && rows) m.firstRow = now;
        if (m.shell !== null && m.listReady === null && document.querySelector('#homePosts[aria-busy="false"]') && document.querySelector('#homeComposition[aria-busy="false"]')) m.listReady = now;
        if (m.shell !== null && m.rows20 === null && rows >= 20) m.rows20 = now;
        const running = app && !app.hidden ? document.getAnimations().filter(a => a.playState === 'running').length : 0;
        m.animationsSeen = Math.max(m.animationsSeen, running);
        if (m.listReady !== null && m.motionEnd === null && running === 0) m.motionEnd = now;
        if (m.motionEnd === null || m.rows20 === null) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const requests = [];
    if (latency) await context.route(cloud + '/**', async route => {
      const request = route.request(); if (request.method() === 'OPTIONS') return route.fallback();
      const n = ++requestNo, delay = latencyMin + (n * 7919) % (latencyMax - latencyMin + 1), u = new URL(request.url());
      requests.push({ path: u.pathname, at: Date.now() }); await sleep(delay); return route.fallback();
    });
    const page = await context.newPage(); page.setDefaultTimeout(120000);
    page.on('pageerror', error => report.pageErrors.push({ name, message: error.message }));
    page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ name, message: event.text() }); });
    const cdp = await context.newCDPSession(page);
    if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    return { name, context, page, cdp, requests };
  }
  const localPosts = page => page.evaluate(async () => {
    const s = HaedoLife.Shell?.storage; if (!s) return -1; let n = 0;
    try { for (const library of await s.listAccountLibraries()) if (library.eligible) n += (await s.listPhotoPosts(library.workspaceId)).length; } catch (_) { return -1; }
    return n;
  });
  const librariesSynced = page => page.evaluate(async ids => { const h = HaedoLife.Shell; if (!h?.accountLibrary) return false; const rows = await Promise.all(ids.map(id => h.accountLibrary.getState(id))); return rows.every(r => r.mode === 'account' && r.status === 'synced'); }, ids);
  async function settled(page) {
    await wait(() => localPosts(page), n => n === totalPosts, 'All posts on this device');
    await wait(() => librariesSynced(page), Boolean, 'All libraries synced');
  }
  async function measure(d, label, warm) {
    const start = Date.now(), before = d.requests.length;
    if (warm) await d.page.reload({ waitUntil: 'domcontentloaded' }); else await d.page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    await d.page.waitForFunction(() => window.__homePerf?.motionEnd !== null && window.__homePerf?.listReady !== null, null, { timeout: 120000 });
    const firstScreen = await d.page.evaluate(() => ({ ...__homePerf, rows: document.querySelectorAll('#homePostList .home-post,#homePostList .home-draft').length }));
    const firstReady = Date.now();
    await d.page.waitForFunction(() => window.__homePerf?.rows20 !== null, null, { timeout: 120000 }).catch(() => {});
    const m = await d.page.evaluate(() => ({ ...__homePerf }));
    const row = { label, warm, throttle, shellMs: m.shell, firstRowMs: m.firstRow, listReadyMs: m.listReady, motionEndMs: m.motionEnd, rows20Ms: m.rows20, rowsAtListReady: firstScreen.rows, authMs: m.auth,
      animationsSeen: m.animationsSeen, longTasks: m.longTasks.filter(([s]) => s <= (m.motionEnd || 0)), privateRequestsBeforeReady: d.requests.slice(before).filter(r => r.at <= firstReady).map(r => ({ path: r.path, at: r.at - start })) };
    report.measurements.push(row);
    console.log(JSON.stringify({ label, shell: Math.round(row.shellMs), firstRow: row.firstRowMs && Math.round(row.firstRowMs), listReady: Math.round(row.listReadyMs), motionEnd: Math.round(row.motionEndMs), rows20: row.rows20Ms && Math.round(row.rows20Ms), rowsAtListReady: row.rowsAtListReady, reqBeforeReady: row.privateRequestsBeforeReady.length }));
    return row;
  }
  try {
    // One seeding device writes the posts through the app's own storage; BlogSync uploads them.
    const server = seedCloud(bundles), seed = await device(server, 'seed', { latency: false });
    await seed.page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    await seed.page.waitForFunction(() => globalThis.HaedoLife?.Shell?.storage && !document.querySelector('#lifeApp').hidden);
    await wait(() => librariesSynced(seed.page), Boolean, 'Seed libraries synced');
    await seed.page.evaluate(async ({ ids, postPlan }) => {
      const L = HaedoLife, s = L.Shell.storage, C = L.Core; let seedValue = 7;
      const random = () => (seedValue = (seedValue * 1103515245 + 12345) % 2147483648) / 2147483648;
      async function photo(index) {
        const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 1200;
        const ctx = canvas.getContext('2d'), image = ctx.createImageData(canvas.width, canvas.height);
        for (let i = 0; i < image.data.length; i += 4) { const x = (i / 4) % canvas.width, y = Math.floor(i / 4 / canvas.width); image.data[i] = (x + index * 37) % 256; image.data[i + 1] = (y + index * 11) % 256; image.data[i + 2] = Math.floor(random() * 64) + 96; image.data[i + 3] = 255; }
        ctx.putImageData(image, 0, 0);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
        return L.PhotoPost.readPhoto(new File([blob], 'synthetic-' + index + '.jpg', { type: 'image/jpeg' }), C.id);
      }
      let photoIndex = 0;
      for (let w = 0; w < ids.length; w++) {
        for (let n = 0; n < postPlan[w].saved + postPlan[w].drafts; n++) {
          const draft = n >= postPlan[w].saved, doc = L.PhotoPost.create(C.id), photos = [];
          for (let p = 0; p < 1 + (n % 3); p++) photos.push(await photo(photoIndex++));
          const ops = [{ insert: '익명 계측 글 본문 ' + w + '-' + n + '. 하루의 장면과 생각을 적었다.\n' }];
          photos.forEach(item => ops.push({ insert: { photo: { id: item.id, caption: '합성 사진', alt: '합성 색면' } } }, { insert: '\n' }));
          Object.assign(doc, { status: draft ? 'draft' : 'saved', title: '익명 계측 글 ' + w + '-' + String(n).padStart(2, '0'), photos, ops });
          await s.savePhotoPost(ids[w], doc, 0);
        }
      }
    }, { ids, postPlan });
    await wait(() => server.posts.size, n => n === totalPosts, 'Seed posts uploaded');
    await sleep(2000); await seed.context.close();
    report.seed = { posts: server.posts.size, originals: server.originals.size, originalBytes: [...server.originals.values()].reduce((sum, item) => sum + item.bytes.length, 0) };
    console.log(JSON.stringify({ seed: report.seed }));
    for (let n = 0; n < samples; n++) {
      const d = await device(server, 'measure-' + (++counter));
      try {
        await measure(d, 'cold-' + n, false);
        await settled(d.page); await sleep(1500);
        await measure(d, 'warm-' + n, true);
        await settled(d.page);
        if (n === 0) await d.page.screenshot({ path: path.join(output, 'home-1440.png') });
      } finally { await d.context.close(); }
    }
  } finally {
    await browser.close();
    const median = values => { const sorted = values.filter(v => typeof v === 'number').sort((a, b) => a - b); return sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : null; };
    report.summary = {};
    for (const warm of [false, true]) { const rows = report.measurements.filter(row => row.warm === warm); if (rows.length) report.summary[warm ? 'warm' : 'cold'] = Object.fromEntries(['shellMs', 'firstRowMs', 'listReadyMs', 'motionEndMs', 'rows20Ms'].map(key => [key, median(rows.map(row => row[key]))])); }
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ throttle, summary: report.summary, pageErrors: report.pageErrors.length, consoleErrors: report.consoleErrors.length }));
  assert.deepEqual(report.pageErrors, []);
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

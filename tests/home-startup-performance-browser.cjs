/* First screen after sign-in (일정 목록, home mode): when the shell, the first
 * row of 내 글, the settled list and the entrance motion appear. Actual app,
 * bundled SDK and scoped IndexedDB; anonymous synthetic Auth and FakeCloud
 * with a synthetic per-request latency. Not a production, real-device or
 * field measurement.
 * BASE_URL=http://127.0.0.1:4373 HOME_PERF_SOURCE_ROOT=<site> node this-file
 * HOME_PERF_SAMPLES (3), HOME_PERF_THROTTLE (1 or 4), HOME_PERF_OUTPUT (fresh dir),
 * HOME_PERF_STATIC_LATENCY (40 ms per static file), HOME_PERF_TRACE=1 (request initiators before the shell),
 * HOME_PERF_PROFILE=1 (off by default and in CI: a Chromium trace of each cold open, summarised as main-thread
 * time by kind before the shell and from the shell to 20 rows; tracing itself adds overhead, so its timings are
 * not comparable with an unprofiled run), HOME_PERF_STORAGE=1 (off by default and in CI: counts account storage
 * calls by name and IndexedDB transactions before the shell and from the shell to 20 rows). */
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
const staticLatency = Number(process.env.HOME_PERF_STATIC_LATENCY ?? 40);
const trace = process.env.HOME_PERF_TRACE === '1';
const profile = process.env.HOME_PERF_PROFILE === '1';
const storageCount = process.env.HOME_PERF_STORAGE === '1';
// Trace event names grouped by what the main thread was doing. First-level children of each task are
// counted, so nested work is attributed to the kind that started it.
const KINDS = [
  ['script load (compile + top-level run)', /^(EvaluateScript|v8\.compile|v8\.compileModule|CompileScript|v8\.produceCache|v8\.evaluateModule|ScriptCompile)$/],
  ['IPC replies (IndexedDB, fetch) and their JS', /^(Receive mojo reply|Receive mojo message|SimpleWatcher::OnHandleReady)$/],
  ['callbacks (timers, events, promises)', /^(FunctionCall|TimerFire|EventDispatch|FireAnimationFrame|RunMicrotasks|v8\.callFunction|V8\.Execute|FireIdleCallback|XHRReadyStateChange|BlinkScheduler_PerformMicrotaskCheckpoint|v8\.run)$/],
  ['HTML parse', /^ParseHTML$/],
  ['style, layout, paint', /^(UpdateLayoutTree|RecalculateStyles|Layout|PrePaint|Paint|Layerize|UpdateLayer|UpdateLayerTree|CompositeLayers|Commit|ScrollLayer|IntersectionObserverController::computeIntersections|HitTest)$/],
  ['garbage collection', /(GC|gc)/],
  ['image decode', /(Decode Image|ImageDecodeTask|Decode LazyPixelRef)/],
];
function summariseTrace(buffer, origin, shell, rows20) {
  const events = JSON.parse(buffer.toString('utf8')).traceEvents || [];
  // The page's renderer main thread: the one that ran navigationStart for index.html.
  const nav = events.find(e => e.name === 'navigationStart' && String(e.args?.data?.documentLoaderURL || '').includes('index.html'));
  if (!nav) return { error: 'navigationStart not found' };
  const pid = nav.pid, tid = nav.tid, zero = nav.ts / 1000; // ms on the trace clock at timeOrigin
  const main = events.filter(e => e.pid === pid && e.tid === tid && e.ph === 'X' && typeof e.dur === 'number').sort((x, y) => x.ts - y.ts || y.dur - x.dur);
  const isTask = e => e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask';
  // Outermost tasks only (a nested RunTask belongs to its outer task).
  const tasks = []; let taskEnd = -Infinity;
  for (const e of main) if (isTask(e) && e.ts >= taskEnd) { tasks.push(e); taskEnd = e.ts + e.dur; }
  const firstAt = ts => { let lo = 0, hi = main.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (main[mid].ts < ts) lo = mid + 1; else hi = mid; } return lo; };
  // First-level children of a task: events inside it that no earlier child contains.
  function firstLevel(task) {
    const out = [], end = task.ts + task.dur; let edge = -Infinity;
    for (let i = firstAt(task.ts); i < main.length && main[i].ts < end; i++) {
      const e = main[i]; if (e === task || isTask(e) || e.ts + e.dur > end) continue;
      if (e.ts >= edge) { out.push(e); edge = e.ts + e.dur; }
    }
    return out;
  }
  const windows = [['beforeShell', 0, shell], ['shellToRows20', shell, rows20]];
  const result = {};
  for (const [key, from, to] of windows) {
    const length = to - from, kinds = Object.fromEntries(KINDS.map(([name]) => [name, 0])), scripts = new Map();
    let busy = 0, other = 0;
    for (const task of tasks) {
      const start = task.ts / 1000 - zero, end = start + task.dur / 1000;
      const a = Math.max(start, from), b = Math.min(end, to); if (b <= a) continue;
      const share = (b - a) / (end - start || 1); busy += b - a;
      const first = firstLevel(task);
      let covered = 0;
      for (const c of first) {
        const kind = KINDS.find(([, test]) => test.test(c.name));
        const ms = c.dur / 1000 * share; covered += ms;
        if (kind) kinds[kind[0]] += ms; else other += ms;
        const url = c.args?.data?.url || c.args?.data?.stackTrace?.[0]?.url || '';
        if (url && /\/assets\/|\.html/.test(url)) { const k = url.replace(/^.*\/(assets\/|)/, '$1').replace(/\?.*$/, ''); scripts.set(k, (scripts.get(k) || 0) + ms); }
      }
      other += Math.max(0, (b - a) - covered);
    }
    const round = v => Math.round(v);
    result[key] = { lengthMs: round(length), busyMs: round(busy), idleMs: round(length - busy),
      kinds: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, round(v)]).concat([['other task work', round(other)]]).sort((x, y) => y[1] - x[1])),
      topScripts: [...scripts].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => [k, round(v)]) };
  }
  return result;
}
const TRACE_CATEGORIES = ['devtools.timeline', 'v8.execute', 'v8', 'blink.user_timing', 'loading', 'toplevel', 'disabled-by-default-devtools.timeline', 'disabled-by-default-v8.cpu_profiler'];
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
const report = { createdAt: new Date().toISOString(), sourceRoot, base, samples, throttle, latency: [latencyMin, latencyMax], staticLatency, sourceCounts, postPlan,
  scope: 'Synthetic anonymous Auth/FakeCloud; deterministic per-request latency on private HTTP and a fixed latency per static file; Playwright routing disables HTTP cache and the service worker. Not production or Apple hardware.',
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
    if (storageCount) await context.addInitScript(() => {
      // Counting only: every call and transaction goes through unchanged.
      const calls = window.__storageCalls = [], transactions = window.__idbTransactions = [];
      const proto = IDBDatabase.prototype, open = proto.transaction;
      proto.transaction = function (...args) { transactions.push(Math.round(performance.now())); return open.apply(this, args); };
      const wrap = scoped => { const out = {}; for (const key of Object.keys(scoped)) { const value = scoped[key];
        out[key] = typeof value === 'function' ? function (...args) { calls.push([Math.round(performance.now()), key]); return value.apply(scoped, args); } : value; } return out; };
      let stored; const life = window.HaedoLife ||= {};
      Object.defineProperty(life, 'Storage', { configurable: true, get() { return stored; }, set(value) {
        stored = value?.forAccount ? { ...value, forAccount: (...args) => wrap(value.forAccount.apply(value, args)) } : value; } });
    });
    await context.addInitScript(() => {
      const m = window.__homePerf = { auth: null, shell: null, firstRow: null, listReady: null, rows20: null, viewportPhotos: null, motionEnd: null, animationsSeen: 0, longTasks: [] };
      try { new PerformanceObserver(list => { for (const e of list.getEntries()) m.longTasks.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch (_) {}
      const tick = () => {
        const now = performance.now(), app = document.getElementById('lifeApp');
        if (m.auth === null && globalThis.HaedoAuth?.user) m.auth = now;
        if (m.shell === null && app && !app.hidden && globalThis.HaedoAuth?.user) m.shell = now;
        const list = document.getElementById('homePostList');
        const rows = list ? list.querySelectorAll('.home-post,.home-draft').length : 0;
        if (m.shell !== null && m.firstRow === null && rows) m.firstRow = now;
        // A settled list that shows rows: an empty list waiting for the first receive is not usable.
        if (m.shell !== null && m.listReady === null && rows && document.querySelector('#homePosts[aria-busy="false"]') && document.querySelector('#homeComposition[aria-busy="false"]')) m.listReady = now;
        if (m.shell !== null && m.rows20 === null && rows >= 20) m.rows20 = now;
        // Every photo frame of the first screen shows its picture.
        if (m.rows20 !== null && m.viewportPhotos === null) {
          const frames = [...list.querySelectorAll('.home-post-media')].filter(frame => { const r = frame.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
          if (frames.length && frames.every(frame => frame.getAttribute('aria-busy') === 'false' && frame.querySelector('img')?.complete)) m.viewportPhotos = now;
        }
        // Only once the list is ready (motionEnd): calling getAnimations() every frame from the start was
        // itself ~12% of the throttled main thread before 20 rows (2026-11-04 profile), slowing what is measured.
        if (m.listReady !== null && m.motionEnd === null) {
          const running = app && !app.hidden ? document.getAnimations().filter(a => a.playState === 'running').length : 0;
          m.animationsSeen = Math.max(m.animationsSeen, running);
          if (running === 0) m.motionEnd = now;
        }
        if (m.motionEnd === null || m.rows20 === null || m.viewportPhotos === null) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const requests = [];
    if (latency) {
      // Static files: a fixed round trip, like a deployed site without a warm cache.
      if (staticLatency) await context.route(base + '/**', async route => { await sleep(staticLatency); return route.fallback(); });
      await context.route(cloud + '/**', async route => {
        const request = route.request(); if (request.method() === 'OPTIONS') return route.fallback();
        const n = ++requestNo, delay = latencyMin + (n * 7919) % (latencyMax - latencyMin + 1);
        await sleep(delay); return route.fallback();
      });
    }
    context.on('request', request => { const u = new URL(request.url()); if (u.origin !== cloud || request.method() === 'OPTIONS') return; const row = { path: u.pathname, start: Date.now(), end: null }; requests.push(row); request.__homeRow = row; });
    const finish = request => { if (request.__homeRow) request.__homeRow.end = Date.now(); };
    context.on('requestfinished', finish); context.on('requestfailed', finish);
    const page = await context.newPage(); page.setDefaultTimeout(120000);
    page.on('pageerror', error => report.pageErrors.push({ name, message: error.message }));
    page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ name, message: event.text() }); });
    const cdp = await context.newCDPSession(page);
    if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    const initiators = [];
    if (trace) {
      await cdp.send('Network.enable');
      cdp.on('Network.requestWillBeSent', event => {
        if (!event.request.url.startsWith(cloud) || event.request.method === 'OPTIONS') return;
        const frames = [];
        for (let stack = event.initiator?.stack; stack && frames.length < 8; stack = stack.parent)
          for (const f of stack.callFrames) if (/\/assets\//.test(f.url) && frames.length < 8) frames.push(f.functionName + '@' + f.url.replace(/^.*\/assets\//, '') + ':' + (f.lineNumber + 1));
        initiators.push({ path: new URL(event.request.url).pathname, at: Date.now(), frames });
      });
    }
    return { name, context, page, cdp, requests, initiators };
  }
  // Requests that finished before `until`, and how many non-overlapping waves they form (one after another).
  function waves(rows, until) {
    const done = rows.filter(r => r.end !== null && r.end <= until).sort((a, b) => a.start - b.start);
    let count = 0, edge = -Infinity;
    for (const r of done) { if (r.start >= edge) { count++; edge = r.end; } else edge = Math.max(edge, r.end); }
    return { requests: done.length, waves: count, auth: done.filter(r => r.path === '/auth/v1/user').length };
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
    const before = d.requests.length, traced = d.initiators.length;
    const tracing = profile && !warm;
    if (tracing) await browser.startTracing(d.page, { categories: TRACE_CATEGORIES });
    if (warm) await d.page.reload({ waitUntil: 'domcontentloaded' }); else await d.page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    await d.page.waitForFunction(() => ['motionEnd', 'listReady', 'rows20', 'viewportPhotos'].every(key => window.__homePerf?.[key] !== null && window.__homePerf?.[key] !== undefined), null, { timeout: 180000 });
    const m = await d.page.evaluate(() => ({ ...__homePerf, origin: performance.timeOrigin }));
    let storageReads;
    if (storageCount) {
      const raw = await d.page.evaluate(() => ({ calls: window.__storageCalls || [], transactions: window.__idbTransactions || [] }));
      const phase = (from, to) => {
        const calls = raw.calls.filter(([t]) => t >= from && t < to), byName = {};
        for (const [, name] of calls) byName[name] = (byName[name] || 0) + 1;
        const status = ['getSyncState', 'getCompositionState', 'getLibraryMetaState'].reduce((sum, name) => sum + (byName[name] || 0), 0);
        return { calls: calls.length, transactions: raw.transactions.filter(t => t >= from && t < to).length, statusReads: status,
          top: Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 10) };
      };
      storageReads = { beforeShell: phase(0, m.shell), shellToRows20: phase(m.shell, m.rows20) };
    }
    let mainThread;
    if (tracing) {
      const buffer = await browser.stopTracing();
      // HOME_PERF_PROFILE_SAVE=1 keeps the raw trace (gzip) beside the report for a closer look.
      if (process.env.HOME_PERF_PROFILE_SAVE === '1') await fs.writeFile(path.join(output, label + '.trace.json.gz'), require('node:zlib').gzipSync(buffer));
      mainThread = summariseTrace(buffer, m.origin, m.shell, m.rows20);
      mainThread.marks = { shellMs: Math.round(m.shell), rows20Ms: Math.round(m.rows20) };
    }
    const rows = d.requests.slice(before), at = value => m.origin + value;
    const row = { label, warm, throttle, shellMs: m.shell, firstRowMs: m.firstRow, listReadyMs: m.listReady, rows20Ms: m.rows20, viewportPhotosMs: m.viewportPhotos, motionEndMs: m.motionEnd, authMs: m.auth,
      beforeShell: waves(rows, at(m.shell)), beforeRows20: waves(rows, at(m.rows20)), animationsSeen: m.animationsSeen, longTasks: m.longTasks.filter(([s]) => s <= (m.rows20 || 0)),
      requests: rows.map(r => ({ path: r.path, start: Math.round(r.start - m.origin), end: r.end === null ? null : Math.round(r.end - m.origin) })),
      initiators: trace ? d.initiators.slice(traced).filter(r => r.at <= at(m.rows20)).map(r => ({ ...r, at: Math.round(r.at - m.origin) })) : undefined, mainThread, storageReads };
    report.measurements.push(row);
    const r = value => value === null || value === undefined ? null : Math.round(value);
    console.log(JSON.stringify({ label, shell: r(row.shellMs), firstRow: r(row.firstRowMs), listReady: r(row.listReadyMs), rows20: r(row.rows20Ms), viewportPhotos: r(row.viewportPhotosMs), beforeShell: row.beforeShell, beforeRows20: row.beforeRows20 }));
    if (mainThread) console.log(JSON.stringify({ label, mainThread }));
    if (storageReads) console.log(JSON.stringify({ label, storageReads: { beforeShell: { ...storageReads.beforeShell, top: undefined }, shellToRows20: { ...storageReads.shellToRows20, top: undefined } } }));
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
    for (const warm of [false, true]) { const rows = report.measurements.filter(row => row.warm === warm); if (rows.length) report.summary[warm ? 'warm' : 'cold'] = { ...Object.fromEntries(['shellMs', 'firstRowMs', 'listReadyMs', 'rows20Ms', 'viewportPhotosMs', 'motionEndMs'].map(key => [key, median(rows.map(row => row[key]))])),
      requestsBeforeShell: median(rows.map(row => row.beforeShell.requests)), wavesBeforeShell: median(rows.map(row => row.beforeShell.waves)), authBeforeShell: median(rows.map(row => row.beforeShell.auth)),
      requestsBeforeRows20: median(rows.map(row => row.beforeRows20.requests)), wavesBeforeRows20: median(rows.map(row => row.beforeRows20.waves)) }; }
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ throttle, summary: report.summary, pageErrors: report.pageErrors.length, consoleErrors: report.consoleErrors.length }));
  assert.deepEqual(report.pageErrors, []);
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

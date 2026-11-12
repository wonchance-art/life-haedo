/* How long one read of the originals' sync state takes for a large library, in Chromium with real
 * IndexedDB (storage.js on a page of its own, no network, no account). For each library size the
 * state is put in the forms that carry a snapshot (a request waiting to be sent; a recorded
 * difference with the server's copy; both), and each read is timed SYNC_PERF_SAMPLES times under
 * CDP Emulation.setCPUThrottlingRate (SYNC_PERF_THROTTLE, default 4: a slow device simulated, no
 * artificial CPU load):
 *   full        storage.getSyncState + the copy of the difference sync.getState returns: the status
 *               read before 2026-11-12 (status lines, the account library's band, engine decisions),
 *   summary     storage.getSyncSummary: sync.getState({ light: true }) and the engine's decisions now,
 *   band before / band now   the account library's status read (originals + composition + metadata).
 * Fails when a summary read of a library of SYNC_PERF_BUDGET_LIMIT_MIB (4) or less takes longer than
 * SYNC_PERF_BUDGET_MS (500) at its median, is not faster than the full read, or differs from the full
 * state without its snapshots. Synthetic libraries and an emulated slowdown on this machine: not a
 * measurement on Apple hardware.
 *   python3 scripts/dev-server.py --port 4861 &
 *   BASE_URL=http://127.0.0.1:4861 CHROMIUM_PATH=... PW_MODULE_PATH=... node tests/sync-state-read-performance-browser.cjs
 * SYNC_PERF_SIZES (MiB of originals, "1,4,15"). Report: .local/sync-state-read-performance/report.json. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { playwright } = require('./unified-home-browser.cjs');
const base = process.env.BASE_URL || 'http://127.0.0.1:4861';
const out = path.resolve(__dirname, '../.local/sync-state-read-performance');
const sizes = (process.env.SYNC_PERF_SIZES || '1,4,15').split(',').map(Number).filter(value => value > 0);
const throttle = Number(process.env.SYNC_PERF_THROTTLE || 4), samples = Number(process.env.SYNC_PERF_SAMPLES || 5);
const budget = Number(process.env.SYNC_PERF_BUDGET_MS || 500), budgetLimit = Number(process.env.SYNC_PERF_BUDGET_LIMIT_MIB || 4);
// The modules storage.js uses, as life.html loads them (every script before storage.js, without the
// SDK) and the two it reads that load after it.
const lifePage = fs.readFileSync(path.join(__dirname, '../life.html'), 'utf8'), listed = [...lifePage.matchAll(/<script src="([^"?]+)/g)].map(match => match[1]);
const scripts = [...listed.slice(0, listed.indexOf('assets/life/storage.js')).filter(src => !src.includes('supabase')),
  'assets/life/source-folders.js', 'assets/life/sync-common.js', 'assets/life/storage.js'];
const STATES = { 'request waiting': { outbox: true }, 'difference': { conflict: true }, 'request + diff.': { outbox: true, conflict: true } };
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// A fresh page with a library of `size` MiB of originals (one commit), in the given sync state.
async function library(browser, errors, size, shape) {
  const context = await browser.newContext(), page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route(base + '/__sync-state-perf.html', route => route.fulfill({ contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><meta charset="utf-8"><title>상태 읽기 측정</title>' + scripts.map(src => '<script src="' + src + '"></script>').join('') }));
  await page.goto(base + '/__sync-state-perf.html');
  const bytes = await page.evaluate(async ({ size, shape }) => {
    const s = HaedoLife.Storage, c = HaedoLife.Core;
    const ws = (await s.createWorkspace('익명 측정 자료')).workspaceId;
    let bundle = await s.read(ws); const put = {};
    // About 1 MiB of UTF-8 per original (three bytes per syllable).
    for (let index = 0; index < size; index++) {
      const prepared = await c.prepareImport({ origin: 'other', title: '측정 자료 ' + index, text: ('측정 ' + index + ' ').padEnd(349525, '가'), authorRelation: 'self', coverage: 'full_text', forceSeparate: true }, bundle);
      for (const [name, items] of Object.entries(c.buildImportChanges(bundle, prepared, []).put)) put[name] = (put[name] || []).concat(items);
    }
    const result = await s.commitLocal({ workspaceId: ws, baseRevision: bundle.revision, operationId: c.id(), changes: { put } });
    if (result.status !== 'stored') throw new Error('import ' + result.status + ' ' + (result.error?.code || ''));
    bundle = await s.read(ws);
    const binding = { projectUrl: 'https://sync-perf.example.invalid', userId: 'perf-owner', remoteId: ws };
    await s.bindSync(ws, binding);
    if (shape.outbox && !(await s.prepareSyncUpload(ws, binding))) throw new Error('no request');
    if (shape.conflict) await s.setSyncConflict(ws, binding, { id: ws, title: bundle.title, revision: 1, data: bundle, updated_at: '2026-11-12T00:00:00Z' });
    window.__perf = { ws };
    return new TextEncoder().encode(JSON.stringify(bundle)).length;
  }, { size, shape });
  return { context, page, bytes, cdp: await context.newCDPSession(page) };
}
async function measure({ page, cdp }) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  try {
    return await page.evaluate(async samples => {
      const s = HaedoLife.Storage, { ws } = window.__perf, run = async action => { const started = performance.now(); await action(); return performance.now() - started; };
      const times = { full: [], summary: [], bandBefore: [], band: [] };
      for (let index = 0; index < samples; index++) {
        times.full.push(await run(async () => { const state = await s.getSyncState(ws); structuredClone(state.conflict); }));
        times.summary.push(await run(() => s.getSyncSummary(ws)));
        times.bandBefore.push(await run(async () => { const [state] = await Promise.all([s.getSyncState(ws), s.getCompositionState(ws), s.getLibraryMetaState(ws)]); structuredClone(state.conflict); }));
        times.band.push(await run(() => Promise.all([s.getSyncSummary(ws), s.getCompositionState(ws), s.getLibraryMetaState(ws)])));
      }
      const whole = await s.getSyncState(ws), light = await s.getSyncSummary(ws);
      const projected = { ...whole, outbox: whole.outbox && { operationId: whole.outbox.operationId, expectedRevision: whole.outbox.expectedRevision, localRevision: whole.outbox.localRevision },
        conflict: whole.conflict && { missing: whole.conflict.missing, remoteRevision: whole.conflict.remoteRevision, localRevision: whole.conflict.localRevision } };
      return { times, equal: JSON.stringify(light) === JSON.stringify(projected), status: whole.status, outbox: !!whole.outbox, conflict: !!whole.conflict };
    }, samples);
  } finally { await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); }
}

async function main() {
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const errors = [], failures = [], report = { throttle, samples, budget, budgetLimit, chromium: browser.version(), results: [] };
  try {
    for (const size of sizes) for (const [label, shape] of Object.entries(STATES)) {
      const opened = await library(browser, errors, size, shape);
      try {
        const result = await measure(opened);
        const ms = Object.fromEntries(Object.entries(result.times).map(([key, values]) => [key, { median: Math.round(median(values)), max: Math.round(Math.max(...values)) }]));
        const row = { size, bytes: opened.bytes, state: label, status: result.status, outbox: result.outbox, conflict: result.conflict, equal: result.equal, ms };
        report.results.push(row);
        console.log(`${String(size).padStart(2)} MiB (${(opened.bytes / 1048576).toFixed(1)} MiB JSON) ${label.padEnd(16)} full ${ms.full.median} ms (max ${ms.full.max}) · summary ${ms.summary.median} ms (max ${ms.summary.max}) · band ${ms.bandBefore.median} → ${ms.band.median} ms`);
        if (!result.equal) failures.push(`${size} MiB ${label}: the summary differs from the full state without its snapshots`);
        if (result.outbox !== !!shape.outbox || result.conflict !== !!shape.conflict) failures.push(`${size} MiB ${label}: the state was not set up`);
        if (!(ms.summary.median < ms.full.median)) failures.push(`${size} MiB ${label}: the summary is not faster than the full read`);
        if (size <= budgetLimit && ms.summary.median > budget) failures.push(`${size} MiB ${label}: summary ${ms.summary.median} ms > ${budget} ms`);
      } finally { await opened.context.close(); }
    }
    assert.deepEqual(errors, [], 'no page or console errors');
    assert.deepEqual(failures, []);
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ ...report, errors, failures }, null, 2));
    await browser.close();
  }
}
main().then(() => console.log('sync state read performance: ok'), error => { console.error(error); process.exitCode = 1; });

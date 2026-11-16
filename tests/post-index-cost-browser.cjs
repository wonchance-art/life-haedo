/* What a save and a list cost beside 250 posts, before (haedo-v220: one whole-list row rewritten with
 * every post's whole text on each save) and after (2026-11-16: per-post rows; the whole-list row kept
 * for earlier versions with each text cut to 300 characters). Real Chromium IndexedDB, the real
 * storage.js of each version (the earlier one from tests/fixtures/post-index), anonymous synthetic posts
 * of 1,500 characters each. A page holding only the storage modules; no app screen, Auth or network.
 * Bytes are the JSON size (UTF-8) of every value put during the call; times are wall-clock medians of
 * five calls after one warm-up, at full speed and with CDP CPU throttling ×4. Each autosave is followed by
 * the read the open editor makes (before: the whole list; after: two summaries, readPostSummaries). Prints the numbers; asserts
 * only that a save after the change writes fewer bytes than before and that both lists hold every post.
 *   python3 scripts/dev-server.py --port 4862 &
 *   BASE_URL=http://127.0.0.1:4862 CHROMIUM_PATH=... PW_MODULE_PATH=... node tests/post-index-cost-browser.cjs
 * Report: .local/post-index-cost/report.json */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { previousFile } = require('./helpers/post-index-previous.cjs');
const base = process.env.BASE_URL || 'http://127.0.0.1:4862';
const out = path.resolve(__dirname, '../.local/post-index-cost');
function playwright() {
  for (const name of [process.env.PW_MODULE_PATH, 'playwright', 'playwright-core'].filter(Boolean)) {
    try { return require(name); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Set PW_MODULE_PATH to the installed Playwright module.');
}
const PAGE = '<!doctype html><meta charset="utf-8"><title>cost</title>' +
  ['vendor/idb/idb.js', 'assets/life/core.js', 'assets/life/page-posts.js', 'assets/life/photo-post.js', 'assets/life/storage.js'].map(src => `<script src="${src}"></script>`).join('');
const median = values => { const sorted = values.slice().sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };

async function measure(browser, version, throttle) {
  const context = await browser.newContext({ serviceWorkers: 'block' }), page = await context.newPage();
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.fallback() : route.abort('blockedbyclient'));
  await page.route(`${base}/__post-index-cost.html`, route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE }));
  if (version === 'before') await page.route(`${base}/assets/life/storage.js`, route => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: previousFile('storage.js') }));
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/__post-index-cost.html`);
  if (throttle > 1) { const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
  const result = await page.evaluate(async () => {
    const put = IDBObjectStore.prototype.put, encoder = new TextEncoder(); let bytes = 0;
    IDBObjectStore.prototype.put = function (value, ...rest) { try { bytes += encoder.encode(JSON.stringify(value)).length; } catch (_) {} return put.call(this, value, ...rest); };
    const s = HaedoLife.Storage.forAccount({ projectUrl: 'https://cost.supabase.co', userId: '11111111-2222-4333-8444-555555555555' });
    const M = HaedoLife.PhotoPost, C = HaedoLife.Core, ws = (await s.createWorkspace('비용 측정')).workspaceId;
    const text = n => ('익명 표본 문장이 이어지는 긴 본문입니다 ' + n + '. ').repeat(60).slice(0, 1500);
    // 250 posts stored as either version finds them after earlier saves: documents and the whole-list row
    // with every whole text (the earlier version's own form), written in one raw transaction.
    const docs = [];
    for (let n = 0; n < 250; n++) { const doc = M.create(C.id, new Date(Date.UTC(2026, 0, 1) + n * 60000).toISOString()); doc.title = '표본 ' + n; doc.status = n === 249 ? 'draft' : 'saved'; doc.ops = [{ insert: text(n) + '\n' }]; doc.revision = 1; docs.push(doc); }
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('life-tools-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite'), meta = tx.objectStore('meta');
      for (const doc of docs) meta.put({ key: `photo-post:${ws}:${doc.id}`, value: doc });
      meta.put({ key: `photo-posts:${ws}`, value: docs.map(doc => ({ id: doc.id, title: doc.title, status: doc.status, revision: 1, updatedAt: doc.updatedAt, body: M.plainText(doc), photos: 0, attachments: 0, archived: false })) });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
    const timed = async run => { bytes = 0; const start = performance.now(); const value = await run(); return { ms: performance.now() - start, bytes, value }; };
    const first = await timed(() => s.listPhotoPosts(ws));
    const lists = []; for (let n = 0; n < 6; n++) lists.push(await timed(() => s.listPhotoPosts(ws)));
    // The draft among them autosaved six times (the first is the warm-up). The earlier version refuses a
    // new post or draft at 250, so both versions save one that is already there.
    let draft = await s.readPhotoPost(ws, docs[249].id);
    const saves = [];
    // After each autosave the open editor reads the list rows it checks (photo-post-ui refreshEdit): before,
    // the whole list; after, its own post and the post it revises (two summaries).
    const editorRead = () => typeof s.readPostSummaries === 'function' ? s.readPostSummaries(ws, [draft.id, docs[0].id]) : s.listPhotoPosts(ws);
    const reads = [];
    for (let n = 0; n < 6; n++) {
      const current = draft; const result = await timed(() => s.savePhotoPost(ws, { ...current, ops: [{ insert: text(1000 + n) + '\n' }] }, current.revision));
      draft = result.value; saves.push(result); reads.push(await timed(editorRead));
    }
    const rest = list => list.slice(1);
    return { firstList: { ms: first.ms, bytes: first.bytes, count: first.value.length },
      list: { ms: rest(lists).map(item => item.ms), bytes: rest(lists).map(item => item.bytes), count: lists[0].value.length },
      save: { ms: rest(saves).map(item => item.ms), bytes: rest(saves).map(item => item.bytes) },
      editorRead: { ms: rest(reads).map(item => item.ms) }, saveAndRead: { ms: rest(saves).map((item, n) => item.ms + rest(reads)[n].ms) } };
  });
  await context.close();
  assert.deepEqual(errors, [], version);
  return { version, throttle, firstList: result.firstList, listCount: result.list.count,
    listMs: median(result.list.ms), listBytes: median(result.list.bytes), saveMs: median(result.save.ms), saveBytes: median(result.save.bytes),
    editorReadMs: median(result.editorRead.ms), saveAndReadMs: median(result.saveAndRead.ms), raw: result };
}

async function main() {
  await fs.rm(out, { recursive: true, force: true }); await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const rows = [];
  try {
    for (const throttle of [1, 4]) for (const version of ['before', 'after']) rows.push(await measure(browser, version, throttle));
  } finally { await browser.close(); }
  const report = { browser: 'Chromium (headless)', posts: 250, textCharacters: 1500, rows: rows.map(({ raw, ...row }) => row), raw: rows.map(row => row.raw) };
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  for (const row of report.rows) console.log(JSON.stringify(row));
  for (const throttle of [1, 4]) {
    const before = rows.find(row => row.version === 'before' && row.throttle === throttle), after = rows.find(row => row.version === 'after' && row.throttle === throttle);
    assert.equal(before.listCount, 250); assert.equal(after.listCount, 250);
    assert.ok(after.saveBytes < before.saveBytes, 'a save after the change writes fewer bytes');
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

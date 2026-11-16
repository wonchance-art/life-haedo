/* The legacy sync screen (설정 → 동기화) reads the originals' state in its light form (2026-11-12).
 * A sync record ahead of the workspace this page holds (damaged, or written by something else) is
 * never shown as "서버와 동기화됨": the screen reads it in full and shows the read failure, as before
 * the light read; 연결 중지 on it writes nothing. Review 2026-11-12 MINOR 1·2. Actual app, SDK and
 * IndexedDB with the tests' FakeCloud and synthetic Auth; anonymous data.
 *   python3 scripts/dev-server.py --port 4864 &
 *   BASE_URL=http://127.0.0.1:4864 CHROMIUM_PATH=... PW_MODULE_PATH=... node tests/sync-state-display-browser.cjs */
'use strict';
const assert = require('node:assert/strict');
const { FakeCloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, observe } = require('./unified-home-browser.cjs');
const { fixture, syncing, enable } = require('./life-management-browser.cjs');

// Rewrites this workspace's sync record in place, the way a damaged record would read.
const ahead = (page, by) => page.evaluate(async by => {
  const id = await HaedoLife.Shell.storage.getActive();
  const db = await new Promise((resolve, reject) => { const request = indexedDB.open('life-tools-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const tx = db.transaction('meta', 'readwrite'), store = tx.objectStore('meta');
  const row = await new Promise(resolve => { const request = store.get('sync:' + id); request.onsuccess = () => resolve(request.result); });
  row.value.syncedLocalRevision += by; store.put(row);
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
  return row.value;
}, by);

async function main() {
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { checks: [], consoleErrors: [], pageErrors: [], expectedErrors: 0 };
  const server = new FakeCloud(), context = await makeContext(browser, server, 'display-0');
  // Records the options of each state read the screen asks the engine for (the engine itself unchanged).
  await context.route(base + '/assets/life/sync.js', async route => {
    const response = await route.fetch(), source = await response.text();
    const hook = `\n;(()=>{const api=HaedoLife.Sync,create=api.create;HaedoLife.Sync=Object.freeze({...api,create(...args){const manager=create(...args);` +
      `return Object.freeze({...manager,getState(id,options){if(options&&options.localRevision!==undefined)(window.__screenReads||=[]).push(options.localRevision);return manager.getState(id,options);}});}});})();`;
    await route.fulfill({ response, body: source + hook });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000); observe(page, report, 'display');
  try {
    await fixture(page); await syncing(page); await enable(page);
    await page.waitForFunction(() => /서버와 동기화됨/.test(document.querySelector('#lifeSyncStatus')?.textContent || ''));
    // Another save (here, straight to storage, as another tab's would be) while the screen keeps its
    // copy: the screen reads with the revision storage announced, so a consistent record needs no full read.
    const saved = await page.evaluate(async () => {
      const s = HaedoLife.Shell.storage, c = HaedoLife.Core, id = await s.getActive(), current = await s.read(id);
      const prepared = await c.prepareImport({ origin: 'other', title: '다른 탭이 저장한 자료', text: '다른 탭 본문' }, current);
      const result = await s.commitLocal({ operationId: c.id(), workspaceId: id, baseRevision: current.revision, changes: c.buildImportChanges(current, prepared, []) });
      return result.revision;
    });
    await page.waitForFunction(revision => (window.__screenReads || []).includes(revision), saved);
    assert.equal(Math.max(...await page.evaluate(() => window.__screenReads)), saved, 'the screen passes the revision storage announced, not its older copy\'s');
    await page.evaluate(async () => { await HaedoLife.Shell.sync.syncNow(await HaedoLife.Shell.storage.getActive()); });
    await page.waitForFunction(() => /서버와 동기화됨/.test(document.querySelector('#lifeSyncStatus')?.textContent || ''));
    const stored = await ahead(page, 5);
    // A run (as the page's own focus and timer runs do) makes the screen read the state again.
    const run = await page.evaluate(async () => { try { await HaedoLife.Shell.sync.syncNow(await HaedoLife.Shell.storage.getActive()); return 'ran'; } catch (error) { return error.code; } });
    assert.equal(run, 'invalid_sync_metadata', 'the run stops on the record');
    await page.waitForFunction(() => !/서버와 동기화됨/.test(document.querySelector('#lifeSyncStatus')?.textContent || '') && /확인 실패|실패|오류/.test(document.querySelector('#lifeSyncState')?.textContent || ''));
    assert.doesNotMatch(await page.locator('#lifeSyncState').innerText(), /서버와 동기화됨/);
    // 연결 중지 is refused before anything is written (the light read would have let it pause).
    const paused = await page.evaluate(async () => { try { await HaedoLife.Shell.sync.pause(await HaedoLife.Shell.storage.getActive()); return 'paused'; } catch (error) { return error.code; } });
    assert.equal(paused, 'invalid_sync_metadata');
    const after = await page.evaluate(async () => {
      const id = await HaedoLife.Shell.storage.getActive();
      const db = await new Promise(resolve => { const request = indexedDB.open('life-tools-v1'); request.onsuccess = () => resolve(request.result); });
      const value = await new Promise(resolve => { const request = db.transaction('meta').objectStore('meta').get('sync:' + id); request.onsuccess = () => resolve(request.result.value); });
      db.close(); return value;
    });
    assert.deepEqual(after, stored, 'the record is as it was: nothing paused');
    report.checks.push({ name: 'a record ahead of the workspace reads as a failure, never synced; pausing writes nothing', pass: true });
    console.log('PASS a record ahead of the workspace reads as a failure, never synced; pausing writes nothing');
  } catch (error) {
    report.checks.push({ name: 'display', pass: false }); console.error('FAIL ' + error.stack);
    await page.screenshot({ path: '.local/sync-state-display-failure.png', fullPage: true }).catch(() => {});
  } finally {
    await context.close(); await browser.close();
    console.log(JSON.stringify({ checks: report.checks, consoleErrors: report.consoleErrors, pageErrors: report.pageErrors }, null, 2));
    if (!report.checks.every(item => item.pass) || report.pageErrors.length || report.consoleErrors.length) process.exitCode = 1;
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

/* Native IndexedDB upgrade with unchanged historical PhotoPostUI/model/storage.
 * Current app shell + remaining current modules, synthetic Auth HTTP: this is a
 * mixed-shell compatibility check, not a full historical app or native Apple IME.
 * No production requests; node tests/post-markdown-old-tab-input-browser.cjs. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, base, cloud } = require('./life-sync-browser.cjs');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.POST_MARKDOWN_OLD_INPUT_OUTPUT || path.join(root, '.local/post-markdown-old-tab-input', new Date().toISOString().replace(/[:.]/g, '-')));
const report = { scope: 'Linux Chromium; unchanged 2eebd27 PhotoPostUI/model/storage in current app shell; real IndexedDB, synthetic Auth HTTP and CompositionEvent; no full historical shell, production account, provider or native Apple IME', checks: [], consoleErrors: [], pageErrors: [], externalRequests: [] };
const fixtureRoot = path.join(__dirname, 'fixtures/post-markdown-old-client');
const snapshot = page => page.evaluate(() => {
  const title = document.querySelector('#photoTitle'), body = document.querySelector('.ql-editor');
  return { title: title?.value, body: body?.innerHTML, ops: body ? Quill.find(document.querySelector('.photo-quill')).getContents().ops : null,
    titleSame: title === window.inputNodes?.title, bodySame: body === window.inputNodes?.body,
    status: document.querySelector('.photo-status-text')?.textContent, error: document.querySelector('#lifeError')?.textContent };
});
async function main() {
  await fs.mkdir(output, { recursive: true });
  const pinned = new Map(); report.provenance = [];
  for (const metadata of ['provenance.json', 'ui-provenance.json']) {
    const provenance = JSON.parse(await fs.readFile(path.join(fixtureRoot, metadata), 'utf8'));
    assert.equal(provenance.commit, '2eebd27cbde54f697c9de3a09382f2e21b39a743');
    for (const entry of provenance.files) {
      const raw = zlib.gunzipSync(await fs.readFile(path.join(fixtureRoot, entry.fixture)));
      assert.equal(raw.byteLength, entry.bytes);
      assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), entry.sha256);
      pinned.set('/' + entry.source, raw);
    }
    report.provenance.push(provenance);
  }
  const currentFiles = ['vendor/idb/idb.js', 'assets/life/core.js', 'assets/life/storage.js'];
  const currentScripts = new Map(await Promise.all(currentFiles.map(async file => ['/upgrade/' + path.basename(file), await fs.readFile(path.join(root, file))])));
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  async function scenario(saving) {
    const name = saving ? 'native upgrade aborts an in-flight old UI save, rolls back the row and preserves newer input' : 'native upgrade preserves unsaved old editor title/body and active composition DOM';
    const result = { name, pass: false }; report.checks.push(result);
    const context = await makeContext(browser, new FakeCloud(), 'old-input-' + saving, accounts.a, { viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(base).origin) {
        if (pinned.has(url.pathname)) return route.fulfill({ contentType: 'text/javascript', body: pinned.get(url.pathname) });
        if (currentScripts.has(url.pathname)) return route.fulfill({ contentType: 'text/javascript', body: currentScripts.get(url.pathname) });
        if (url.pathname === '/upgrade.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>Native upgrade</title>' + currentFiles.map(file => '<script src="/upgrade/' + path.basename(file) + '"></script>').join('') });
        return route.fallback();
      }
      if (url.origin === cloud || ['blob:', 'data:'].includes(url.protocol)) return route.fallback();
      report.externalRequests.push(url.origin); return route.abort();
    });
    const old = await context.newPage(), current = await context.newPage();
    for (const page of [old, current]) {
      page.setDefaultTimeout(15000);
      page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ name, message: message.text() }); });
      page.on('pageerror', error => report.pageErrors.push({ name, message: error.message }));
    }
    try {
      await current.goto(base + '/upgrade.html');
      await old.goto(base + '/index.html'); await ready(old); await settle(old);
      await old.locator('[data-haedo-compose]:visible, [data-home-destination="write"]:visible, #homeFirstWrite:visible').first().click();
      await old.locator('#photoTitle').fill('업그레이드 전 저장한 제목');
      await old.locator('.ql-editor').fill('정확하게 남길 이전 본문 한글 🌳');
      await old.waitForFunction(() => document.querySelector('.photo-status-text')?.textContent === '자동 저장됨');
      const before = await old.evaluate(async () => {
        window.oldEvents = []; HaedoLife.Shell.storage.subscribeAll(event => { if (event.type === 'error') oldEvents.push(event.error); });
        window.inputNodes = { title: document.querySelector('#photoTitle'), body: document.querySelector('.ql-editor') };
        const db = await idb.openDB('life-tools-v1', 1);
        try { return { version: db.version, rows: (await db.getAll('meta')).filter(row => row.key.startsWith('photo-post:')) }; }
        finally { db.close(); }
      });
      assert.equal(before.rows.length, 1);
      if (saving) {
        await old.evaluate(() => {
          window.txEvidence = { putSucceeded: false, aborted: false, completed: false };
          const put = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function (value, ...args) {
            const request = put.call(this, value, ...args);
            if (value?.key?.startsWith('photo-post:') && value.value?.title === '저장 중 입력 제목') {
              const tx = this.transaction, store = this;
              tx.addEventListener('abort', () => { txEvidence.aborted = true; });
              tx.addEventListener('complete', () => { txEvidence.completed = true; });
              // Keep a real native transaction alive after its real put succeeds.
              // No storage method or upgrade callback is replaced: versionchange
              // must invoke the historical store's own tracked transaction abort.
              request.addEventListener('success', () => {
                txEvidence.putSucceeded = true;
                const keepAlive = () => { try { store.get(value.key).addEventListener('success', keepAlive); } catch (_) {} };
                keepAlive();
              });
            }
            return request;
          };
        });
        await old.locator('#photoTitle').fill('저장 중 입력 제목');
        await old.waitForFunction(() => window.txEvidence?.putSucceeded);
        await old.locator('#photoTitle').fill('저장 시작 뒤 추가한 미저장 제목');
        await old.locator('.ql-editor').fill('저장 시작 뒤 추가한 미저장 본문 🌳');
      } else {
        await old.locator('#photoTitle').fill('업그레이드 직전 미저장 제목');
        await old.locator('.ql-editor').fill('업그레이드 직전 미저장 본문 🌳');
      }
      await old.evaluate(() => {
        const input = document.querySelector('#photoTitle');
        input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'ㅎ' }));
        input.value += ' 조합중ㅎ';
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: 'ㅎ', isComposing: true }));
      });
      const pending = await snapshot(old);
      const upgrade = await current.evaluate(async () => {
        const store = HaedoLife.Storage.forAccount({ projectUrl: 'https://life-sync-test.supabase.co', userId: '11111111-1111-4111-8111-111111111111' });
        await store.open();
        const db = await idb.openDB('life-tools-v1');
        try { return { version: db.version, rows: (await db.getAll('meta')).filter(row => row.key.startsWith('photo-post:')) }; }
        finally { db.close(); }
      });
      await old.waitForFunction(() => oldEvents.some(event => event.code === 'storage_version_changed'));
      await old.waitForFunction(() => /새로고침|저장이 중단되었습니다/.test(document.querySelector('.photo-status-text')?.textContent || ''));
      const after = await snapshot(old);
      const evidence = await old.evaluate(() => ({ events: oldEvents, tx: window.txEvidence || null }));
      result.evidence = { before, pending, upgrade, after, ...evidence };
      await old.screenshot({ path: path.join(output, saving ? 'saving-after-upgrade.png' : 'unsaved-after-upgrade.png'), fullPage: true });
      assert.equal(upgrade.version, 2);
      assert.deepEqual(upgrade.rows, before.rows, 'upgrade and interrupted old save preserve the exact committed row');
      for (const key of ['title', 'body', 'ops']) assert.deepEqual(after[key], pending[key], 'old editor preserves ' + key);
      assert.equal(after.titleSame, true); assert.equal(after.bodySame, true);
      assert.ok(evidence.events.some(event => event.code === 'storage_version_changed'));
      if (saving) { assert.equal(evidence.tx.putSucceeded, true); assert.equal(evidence.tx.aborted, true); assert.equal(evidence.tx.completed, false); }
      // Composition completion permits retry of the remaining accepted input;
      // the stale store must display its reload instruction without clearing it.
      await old.evaluate(() => document.querySelector('#photoTitle').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ㅎ' })));
      await old.waitForFunction(() => /새로고침/.test(document.querySelector('.photo-status-text')?.textContent || ''));
      assert.equal(await old.locator('#photoTitle').inputValue(), pending.title);
      result.evidence.retryStatus = await old.locator('.photo-status-text').innerText();
      result.pass = true; console.log('PASS ' + name);
    } catch (error) {
      result.error = error.stack; result.observed = await snapshot(old).catch(() => null);
      result.failureEvents = await old.evaluate(() => ({ events: window.oldEvents || [], tx: window.txEvidence || null })).catch(() => null);
      await old.screenshot({ path: path.join(output, 'failure-' + saving + '.png'), fullPage: true }).catch(() => {});
      console.error('FAIL ' + name + '\n' + error.stack);
    } finally { await context.close(); }
  }
  try { await scenario(false); await scenario(true); }
  finally {
    await browser.close();
    report.pass = report.checks.length === 2 && report.checks.every(check => check.pass) && !report.consoleErrors.length && !report.pageErrors.length && !report.externalRequests.length;
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('Report: ' + path.join(output, 'report.json'));
  }
  assert.equal(report.pass, true, 'old UI input preservation checks failed; original evidence retained');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

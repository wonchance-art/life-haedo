/* Actual local autosave and renderer-crash recovery with synthetic SDK Auth.
 * Chromium/Linux timing and synthetic composition/visibility events; no Apple
 * device, native IME, OS eviction or production-server claim. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto');
const { playwright, makeContext, ready, settle } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, session, base, cloud } = require('./life-sync-browser.cjs');
const { databaseSnapshot } = require('./local-post-finder-browser.cjs');
const PhotoPost = require('../assets/life/photo-post.js');
const output = path.resolve('.local/blog-autosave');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const records = page => page.evaluate(async () => { const s = HaedoLife.Shell.storage, workspaceId = await s.getActive(); return { workspaceId, docs: await Promise.all((await s.listPhotoPosts(workspaceId)).map(p => s.readPhotoPost(workspaceId, p.id))) }; });
async function home(page) { await page.goto(base + '/index.html'); await ready(page); await settle(page); await page.locator('#homeComposition[aria-busy="false"]').waitFor(); }
async function writer(page) { await page.locator('[data-home-destination="write"]:visible, #homeFirstWrite:visible').first().click(); await page.locator('#photoTitle').waitFor(); await page.locator('.ql-editor').waitFor(); }
async function accepted(page, title, body) {
  return page.evaluate(({ title, body }) => {
    const input = document.querySelector('#photoTitle'); input.value = title; input.dispatchEvent(new Event('input', { bubbles: true }));
    Quill.find(document.querySelector('.ql-container')).setText(body, 'user');
    window.__autosaveLastInput = performance.now(); return __autosaveLastInput;
  }, { title, body });
}
async function durable(page, title, body) {
  // Playwright's predicate is synchronous: a Promise is truthy even when it
  // resolves to false. Poll awaited IDB reads rather than accepting that handle.
  const deadline = Date.now() + 15000; let all, doc;
  do {
    all = await records(page); doc = all.docs.find(d => d.title === title && PhotoPost.plainText(d) === body);
    if (doc) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  assert(doc, JSON.stringify({ expectedTitle: title, actual: all.docs.map(d => ({ id: d.id, title: d.title, revision: d.revision, body: d.ops })), observed: await page.evaluate(() => __autosaveWrites), currentTitle: await page.locator('#photoTitle').inputValue() })); assert.equal(doc.status, 'draft'); assert.equal(doc.replaces, null); return { workspaceId: all.workspaceId, doc };
}
async function resumeDraft(page, id) {
  await page.locator('#homeTab-drafts').click();
  const row = page.locator('.home-draft[data-draft-id="' + id + '"]'); await row.waitFor();
  await row.locator('.home-draft-open').click(); await page.locator('#photoTitle').waitFor();
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  const report = { scope: 'Actual SDK/IndexedDB and Chromium renderer Page.crash with no graceful lifecycle flush. Composition and visibility events are synthetic, not native IME/Apple or OS crash durability.', checks: [], timings: [], visual: [], consoleErrors: [], pageErrors: [], external: [], remoteWrites: [], lifecycle: [], sourceHashes: {} };
  for (const file of ['assets/life/photo-post-ui.js', 'assets/life/workbench-ui.js', 'assets/life/ui.js', 'assets/life/home.js', 'sw.js']) {
    const response = await fetch(base + '/' + file); assert(response.ok); const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(sha(bytes), sha(await fs.readFile(path.resolve(__dirname, '..', file)))); report.sourceHashes[file] = sha(bytes);
  }
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] }); report.browser = browser.version(); report.node = process.version;
  async function fixture(name) {
    const server = new FakeCloud(), context = await makeContext(browser, server, 'autosave-' + name, accounts.a, { viewport: { width: 1440, height: 1000 } });
    await context.exposeBinding('__autosaveLifecycle', (_source, event) => report.lifecycle.push({ name, ...event }));
    await context.addInitScript(() => {
      window.__autosaveWrites = []; window.__autosaveAbort = false;
      for (const kind of ['beforeunload', 'pagehide']) addEventListener(kind, event => { void window.__autosaveLifecycle({ kind, trusted: event.isTrusted }); }, { capture: true });
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, ...args) { const result = original.call(this, value, ...args); if (__autosaveAbort && this.name === 'meta' && value?.key?.startsWith('photo-post:') && value.value?.status === 'draft') { window.__autosaveAbortCount = (window.__autosaveAbortCount || 0) + 1; this.transaction.abort(); } return result; };
    });
    // Observe real writes and, only when armed, hold BEFORE the original API so
    // its real scope guard/transaction must reject an old-account late write.
    await context.route(base + '/assets/life/storage.js', async route => {
      const response = await route.fetch(); const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage={...original,forAccount(...args){const s=original.forAccount(...args);return Object.freeze({...s,async savePhotoPost(...input){const value=input[1],r={id:value.id,title:value.title,body:HaedoLife.PhotoPost.plainText(value),startedAt:performance.now(),lastInput:window.__autosaveLastInput};__autosaveWrites.push(r);if(window.__autosaveHold){window.__autosaveHold=false;r.held=true;window.__autosaveHeld=true;await new Promise(resolve=>window.__autosaveRelease=resolve);}try{const saved=await s.savePhotoPost(...input);r.revision=saved.revision;r.completedAt=performance.now();return saved;}catch(e){r.error=e.code||e.name;window.__autosaveHeldResult=r.error;throw e;}}});}};})();`;
      await route.fulfill({ response, body: await response.text() + hook });
    });
    await context.route('**/*', route => { const origin = new URL(route.request().url()).origin; if ([new URL(base).origin, cloud].includes(origin)) return route.fallback(); report.external.push(origin); return route.abort(); });
    context.on('request', request => { const url = new URL(request.url()); if (url.origin === cloud && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && (/\/storage\/v1\/object/.test(url.pathname) || /\/rest\/v1\/rpc\/life_(?:blog_(?:save|publish|unpublish|prepare_asset)|sync_put|writing_draft_put|material_put|composition_put)$/.test(url.pathname))) report.remoteWrites.push(url.pathname); });
    context.on('page', page => { page.setDefaultTimeout(15000); page.on('console', e => { if (e.type() === 'error') report.consoleErrors.push(e.text()); }); page.on('pageerror', e => report.pageErrors.push(e.message)); });
    const page = await context.newPage(); await home(page); await writer(page); return { context, page, server };
  }
  async function check(name, run) {
    if (process.env.BLOG_AUTOSAVE_MATCH && !new RegExp(process.env.BLOG_AUTOSAVE_MATCH).test(name)) return;
    const f = await fixture(name); console.log('START ' + name);
    try { await run(f); assert.equal(f.server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (e) { report.checks.push({ name, pass: false, error: e.stack }); await f.context.pages().at(-1)?.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); throw e; }
    finally { await f.context.close(); }
  }
  async function crashAndResume(f, saved) {
    const lifecycle = report.lifecycle.length, page = f.page;
    const client = await f.context.newCDPSession(page), crashed = page.waitForEvent('crash');
    void client.send('Page.crash').catch(() => {}); await crashed;
    assert.equal(report.lifecycle.length, lifecycle, 'Renderer termination must not rely on beforeunload/pagehide flush');
    await page.close({ runBeforeUnload: false });
    const next = await f.context.newPage(); f.page = next; await home(next);
    const all = await records(next); assert.equal(all.workspaceId, saved.workspaceId); assert.equal(all.docs.length, 1); assert.deepEqual(all.docs[0], saved.doc);
    await resumeDraft(next, saved.doc.id); assert.equal(await next.locator('#photoTitle').inputValue(), saved.doc.title);
    assert.equal(await next.evaluate(() => Quill.find(document.querySelector('.ql-container')).getText()), saved.doc.ops.map(o => typeof o.insert === 'string' ? o.insert : '').join(''));
    return next;
  }
  try {
    await check('idle draft survives abrupt renderer termination and reopens from the home draft list without graceful flush', async f => {
      const title = '자동 보관할 합성 여행 초안', body = '한글과 emoji 🌱를 그대로 남긴다.\n마지막 입력까지 보존한다.\n';
      const start = await accepted(f.page, title, body); const saved = await durable(f.page, title, body);
      const timing = await f.page.evaluate(t => { const r = __autosaveWrites.find(r => r.title === t && r.completedAt); return { idleMs: r.startedAt - r.lastInput, completedMs: r.completedAt - r.lastInput }; }, title);
      assert(timing.idleMs >= 250 && timing.idleMs <= 450, 'Idle autosave should start near 300ms, not the former 500ms'); report.timings.push({ name: 'idle', ...timing, inputAt: start });
      await f.page.locator('.photo-status[data-state="draft"]').waitFor();
      const next = await crashAndResume(f, saved);
      for (const width of [1440, 820, 390]) { await next.setViewportSize({ width, height: 1000 }); const file = 'crash-recovered-' + width + '.png'; await next.screenshot({ path: path.join(output, file), fullPage: true }); report.visual.push(file); }
    });
    await check('continuous input commits before typing stops and accepted title/body snapshots survive composition and hidden flush', async f => {
      const p = f.page;
      const stream = await p.evaluate(async () => {
        const title = document.querySelector('#photoTitle'); title.value = '연속 입력 합성 초안';
        const q = Quill.find(document.querySelector('.ql-container')), start = performance.now(); window.__autosaveWrites.length = 0;
        let count = 0; do { title.dispatchEvent(new Event('input', { bubbles: true })); q.insertText(q.getLength() - 1, '가', 'user'); __autosaveLastInput = performance.now(); count++; await new Promise(r => setTimeout(r, 70)); } while (performance.now() - start < 2700);
        return { start, end: performance.now(), count, body: q.getText() };
      });
      await durable(p, '연속 입력 합성 초안', stream.body);
      const first = await p.evaluate(() => __autosaveWrites.find(r => r.completedAt));
      assert(first.startedAt < stream.end, 'Continuous typing must not postpone all writes until idle');
      assert(first.startedAt - stream.start <= 2300, 'Maximum autosave deadline is 2000ms plus foreground scheduling tolerance');
      report.timings.push({ name: 'continuous', firstWriteMs: first.startedAt - stream.start, typingMs: stream.end - stream.start, inputCount: stream.count });
      await p.locator('#photoTitle').dispatchEvent('compositionstart');
      await p.locator('#photoTitle').evaluate(el => { window.__autosaveComposingTitle = el; });
      await accepted(p, '조합 중인 합성 제목 한글', '조합 중에도 받아들인 본문 👨‍👩‍👧\n');
      const composing = await durable(p, '조합 중인 합성 제목 한글', '조합 중에도 받아들인 본문 👨‍👩‍👧\n');
      assert.equal(await p.locator('#photoTitle').evaluate(el => el === __autosaveComposingTitle), true);
      assert.equal(await p.locator('.photo-status').getAttribute('data-state'), 'pending', 'An IME snapshot must not be reported as finalized input');
      await p.setViewportSize({ width: 390, height: 1000 }); await p.screenshot({ path: path.join(output, 'autosave-ime-390.png'), fullPage: true }); report.visual.push('autosave-ime-390.png');
      await p.locator('#photoTitle').dispatchEvent('compositionend');
      await p.locator('.ql-editor').dispatchEvent('compositionstart');
      await accepted(p, '숨김 전 마지막 합성 제목', '숨김 직전 마지막 합성 본문 🌊\n');
      await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      const hidden = await durable(p, '숨김 전 마지막 합성 제목', '숨김 직전 마지막 합성 본문 🌊\n');
      assert(hidden.doc.revision > composing.doc.revision); const write = await p.evaluate(() => __autosaveWrites.at(-1));
      assert(write.startedAt - write.lastInput < 250, 'Hidden checkpoint must start before the idle deadline');
      await p.evaluate(() => { delete document.hidden; });
      await crashAndResume(f, hidden);
    });
    await check('a real IndexedDB abort retains the last durable revision and shows failure until the original input is retried', async f => {
      const p = f.page; await accepted(p, '보관된 합성 기준', '저장된 기준 본문\n'); const baseline = await durable(p, '보관된 합성 기준', '저장된 기준 본문\n');
      await p.evaluate(() => { __autosaveAbort = true; }); await accepted(p, '실패 뒤에도 남길 합성 입력', '실패 뒤에도 편집기에 남길 한글 본문🌱\n');
      await p.locator('.photo-status[data-state="error"][role="alert"]').waitFor();
      assert.equal(await p.evaluate(() => __autosaveAbortCount), 1); assert.deepEqual((await records(p)).docs, [baseline.doc]);
      assert.equal(await p.locator('#photoTitle').inputValue(), '실패 뒤에도 남길 합성 입력'); assert.match(await p.locator('.ql-editor').innerText(), /실패 뒤에도 편집기에 남길/);
      assert.notEqual(await p.locator('.photo-status').getAttribute('data-state'), 'draft');
      const screenshot = 'autosave-error-390.png'; await p.setViewportSize({ width: 390, height: 1000 }); await p.screenshot({ path: path.join(output, screenshot), fullPage: true }); report.visual.push(screenshot);
      await p.evaluate(() => { __autosaveAbort = false; document.querySelector('#photoTitle').dispatchEvent(new Event('input', { bubbles: true })); window.__autosaveLastInput = performance.now(); });
      const retried = await durable(p, '실패 뒤에도 남길 합성 입력', '실패 뒤에도 편집기에 남길 한글 본문🌱\n'); assert.equal(retried.doc.id, baseline.doc.id); assert(retried.doc.revision > baseline.doc.revision);
      await p.locator('.photo-status[data-state="draft"]').waitFor();
    });
    await check('an old-account delayed write is rejected and independent workspaces retain their own exact draft IDs and contents', async f => {
      const p = f.page; await accepted(p, 'A의 합성 기준 초안', 'A의 기준 본문\n'); const baseline = await durable(p, 'A의 합성 기준 초안', 'A의 기준 본문\n');
      await p.evaluate(() => { window.__autosaveHold = true; window.__autosaveHeld = false; window.__autosaveHeldResult = null; window.__autosaveOldStorage = HaedoLife.Shell.storage; });
      await accepted(p, '전환 뒤 쓰면 안 되는 입력', '이 입력은 이전 계정의 지연 작업\n'); await p.waitForFunction(() => window.__autosaveHeld === true);
      await p.evaluate(async value => { await HaedoAuth.client.auth.setSession(value); await HaedoAuth.verify(); }, session(accounts.b));
      await p.waitForFunction(id => HaedoLife.Shell.storage?.account?.userId === id, accounts.b.id); await ready(p); await settle(p);
      const bBefore = await databaseSnapshot(p); await p.evaluate(() => __autosaveRelease()); await p.waitForFunction(() => !!window.__autosaveHeldResult);
      assert.equal(await p.evaluate(() => __autosaveHeldResult), 'storage_scope_closed'); assert.deepEqual(await databaseSnapshot(p), bBefore);
      assert(!(await p.locator('#lifeApp').innerText()).includes('전환 뒤 쓰면 안 되는 입력'));
      const denied = await p.evaluate(async ws => { try { await HaedoLife.Shell.storage.read(ws); return null; } catch (e) { return e.code; } }, baseline.workspaceId); assert.equal(denied, 'workspace_access_denied');
      await p.evaluate(async value => { await HaedoAuth.client.auth.setSession(value); await HaedoAuth.verify(); }, session(accounts.a));
      await p.waitForFunction(id => HaedoLife.Shell.storage?.account?.userId === id, accounts.a.id); await home(p);
      assert.deepEqual((await records(p)).docs, [baseline.doc]);
      const second = await p.evaluate(() => HaedoLife.Shell.storage.createWorkspace('별도 합성 자료 공간')); await home(p); await writer(p);
      await accepted(p, '두 번째 공간의 합성 초안', '다른 공간의 별도 본문\n'); const other = await durable(p, '두 번째 공간의 합성 초안', '다른 공간의 별도 본문\n');
      assert.equal(other.workspaceId, second.workspaceId); assert.notEqual(other.doc.id, baseline.doc.id);
      await p.evaluate(ws => HaedoLife.Shell.storage.setActive(ws), baseline.workspaceId); await home(p); assert.deepEqual((await records(p)).docs, [baseline.doc]);
      await resumeDraft(p, baseline.doc.id); assert.equal(await p.locator('#photoTitle').inputValue(), baseline.doc.title);
    });
    assert.deepEqual(report.remoteWrites, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } finally { await browser.close(); report.cleanup = { browserClosed: true }; await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
}
if (require.main === module) main().catch(e => { console.error(e.stack); process.exitCode = 1; });

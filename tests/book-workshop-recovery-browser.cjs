/* First-book recovery boundaries, using the actual local UI/SDK/IndexedDB.
 * Anonymous intercepted Auth and local transaction faults only. No production. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { playwright, makeContext, ready, settle, nav, observe } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, password, cloud, base } = require('./life-sync-browser.cjs');
const { fixture, current, go, openBook, oldBody } = require('./book-projects-browser.cjs');
const { abortWorkbenchWrites } = require('./life-workbench-browser.cjs');
const out = path.resolve('.local/book-workshop-recovery');
const title = '선택의 이유를 다시 묻는 첫 책', question = '그때의 선택과 지금의 해석은 어디서 달라졌을까?';
async function plan(page) {
  await go(page, 'reflection'); await page.locator('#wbReflectionPlan').click();
  await page.locator('#wbPlanTitle').fill(title); await page.locator('#wbPlanQuestion').fill(question);
}
async function draftJSON(page) {
  const waiting = page.waitForEvent('download'); await page.locator('#wbError').getByRole('button', { name: '초안 JSON 받기', exact: true }).click();
  const file = await waiting; return JSON.parse(await fs.readFile(await file.path(), 'utf8'));
}
async function authenticate(page, account) {
  await page.evaluate(async ({ email, password }) => { const result = await HaedoAuth.client.auth.signInWithPassword({ email, password }); if (result.error) throw result.error; await HaedoAuth.verify(); }, { email: account.email, password });
  await page.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell?.storage && HaedoLife.Shell.sync?.getAccount()?.userId === id, account.id); await ready(page); await settle(page);
}
async function saveGate(context) {
  await context.route(`${base}/assets/life/storage.js`, async route => {
    const response = await route.fetch(), source = await response.text();
    // The real transaction commits before its response is held. A late successful
    // response must not steer a different account into the old account's book.
    const hook = `\n;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage=Object.freeze({...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,async saveWorkbench(...args){const result=await actual.saveWorkbench(...args);if(window.__workshopHoldSave){window.__workshopSaveEntered=true;await new Promise(resolve=>{const timer=setTimeout(resolve,12000);window.__workshopReleaseSave=()=>{clearTimeout(timer);window.__workshopHoldSave=false;resolve();};});}window.__workshopSaveFinished=true;return result;}});}});})();`;
    await route.fulfill({ response, body: source + hook });
  });
}
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), browser: browser.version(), scope: 'Actual first-book UI, bundled SDK and isolated IndexedDB, with anonymous Auth HTTP and local fault/delay injection. Chromium viewports only; no real Google, production writes, Apple hardware or native IME.', checks: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0, operatingRemoteWrites: 0 };
  async function check(name, width, run, gate = false) {
    if (process.env.BOOK_WORKSHOP_RECOVERY_MATCH && !new RegExp(process.env.BOOK_WORKSHOP_RECOVERY_MATCH).test(name)) return;
    const server = new FakeCloud(), context = await makeContext(browser, server, 'workshop-recovery-' + report.checks.length, accounts.a, { viewport: { width, height: 1000 }, hasTouch: width <= 820 });
    try {
      if (gate) await saveGate(context);
      await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push(url.origin); return route.abort('blockedbyclient'); });
      const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
      await run(page); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name);
    } catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
    finally { await context.close(); }
  }
  try {
    await check('record selection enables reflection intake and a failed write consumes selection only after successful retry', 390, async page => {
      const f = await fixture(page), before = await current(page); await nav(page, 'records');
      await page.locator('#lifeSelectionToggle').click(); assert.equal(await page.locator('#lifeArrangeReflection').isDisabled(), true);
      await page.locator(`.life-source-select[data-version-id="${f.refs.pause.versionId}"]`).click();
      assert.equal(await page.locator('#lifeArrangeReflection').isEnabled(), true, 'Reflection destination must follow selection changes');
      await page.locator('#lifeArrangeReflection').click(); await page.locator('#wbIncomingApply').waitFor();
      await abortWorkbenchWrites(page, true); await page.locator('#wbIncomingApply').click(); await page.locator('#wbError').waitFor({ state: 'visible' });
      assert((await page.evaluate(() => __wbAborted)) > 0); assert.deepEqual(await current(page), before);
      await abortWorkbenchWrites(page, false); await page.locator('#wbError').getByRole('button', { name: '다시 저장', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#wbStatus')?.dataset.state === 'saved');
      const saved = await current(page); assert.deepEqual(saved.workbench.reflection.versionIds, [...f.legacy.versionIds, f.refs.pause.versionId]); assert.equal(saved.workbench.reflection.note, f.legacy.note); assert.deepEqual(saved.bundle, before.bundle);
      await nav(page, 'records'); assert.equal(await page.locator('#lifeSelectionToggle').getAttribute('aria-pressed'), 'false'); assert.equal(await page.locator('.life-source-select[aria-pressed="true"]').count(), 0);
      await page.locator('#lifeSelectionToggle').click(); assert.equal(await page.locator('#lifeArrangeReflection').isDisabled(), true);
    });
    await check('a reload banner from before editing cannot discard a newly created book after a CAS conflict; explicit comparison retries the same book', 820, async page => {
      const f = await fixture(page); await plan(page);
      await page.evaluate(async () => { const s = HaedoLife.Shell.storage, w = await s.readWorkbench(await s.getActive()); w.reflection.note = '다른 탭에서 먼저 저장한 회고'; await s.saveWorkbench(w.workspaceId, w, w.revision); });
      await page.locator('#wbReloadSaved').waitFor(); const other = await current(page);
      await page.locator('#wbPlanCreate').click(); await page.locator('#wbError').getByRole('button', { name: '저장본과 비교', exact: true }).waitFor();
      const before = await draftJSON(page); assert.equal(before.workbench.books.length, 1); const bookId = before.workbench.books[0].id;
      await page.locator('#wbReloadSaved').click(); await page.locator('#wbError').getByRole('button', { name: '저장본과 비교', exact: true }).waitFor();
      assert.equal(await page.locator('#wbPlanTitle').inputValue(), title); assert.equal(await page.locator('#wbPlanQuestion').inputValue(), question);
      const after = await draftJSON(page); assert.deepEqual(after.workbench, before.workbench); assert.deepEqual(await current(page), other);
      await page.locator('#wbError').getByRole('button', { name: '저장본과 비교', exact: true }).click(); const compare = page.locator('.wb-conflict');
      assert((await compare.textContent()).includes(title)); assert((await compare.textContent()).includes('다른 탭에서 먼저 저장한 회고'));
      await compare.getByRole('button', { name: '비교한 저장본에 내 초안 적용', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#wbStatus')?.dataset.state === 'saved');
      await page.locator('#wbPlanCreate').click(); await page.locator('#wbBookHeading').waitFor(); const saved = await current(page);
      assert.equal(saved.workbench.books.length, 1); assert.equal(saved.workbench.books[0].id, bookId); assert.equal(saved.workbench.books[0].question, question);
      assert.deepEqual(saved.workbench.reflection, f.legacy); assert(saved.workbench.books[0].chapters.every(chapter => chapter.note === ''));
      assert(saved.workbench.books[0].chapters.flatMap(chapter => chapter.versionIds).includes(f.refs.work.versionId));
      assert(!saved.workbench.books[0].chapters.flatMap(chapter => chapter.versionIds).includes(f.refs.latest.versionId));
      await fs.writeFile(path.join(out, 'conflict-draft.json'), JSON.stringify(before, null, 2));
    });
    await check('a delayed successful book creation cannot navigate or expose the book after an account switch', 820, async page => {
      const f = await fixture(page); await plan(page);
      await page.evaluate(() => { window.__workshopHoldSave = true; window.__workshopSaveEntered = false; window.__workshopSaveFinished = false; });
      await page.locator('#wbPlanCreate').click(); await page.waitForFunction(() => __workshopSaveEntered);
      const completed = await current(page), bookId = completed.workbench.books[0].id; assert.equal(completed.workbench.books.length, 1);
      await authenticate(page, accounts.b); await page.evaluate(() => __workshopReleaseSave()); await page.waitForFunction(() => __workshopSaveFinished);
      assert.equal(await page.evaluate(() => HaedoAuth.user.id), accounts.b.id); assert.equal(await page.locator('#wbBookHeading').count(), 0); assert.equal(await page.locator('#wbBookPlan').count(), 0);
      assert.equal(await page.evaluate(async id => { try { await HaedoLife.Shell.storage.read(id); return false; } catch (_) { return true; } }, f.workspaceId), true);
      assert.equal((await current(page)).workbench.books, undefined);
      await authenticate(page, accounts.a); await go(page); await openBook(page, bookId); const saved = await current(page);
      assert.equal(saved.workbench.books.length, 1); assert.equal(await page.locator('#wbBookHeading').textContent(), title); assert.equal(saved.workbench.books[0].question, question);
      assert.deepEqual(saved.workbench.reflection, f.legacy); assert.equal(saved.bundle.sourceVersions.find(version => version.id === f.refs.work.versionId).contentText, oldBody);
    }, true);
    assert(report.checks.length); report.pass = report.checks.every(check => check.pass) && !report.consoleErrors.length && !report.pageErrors.length && !report.external.length;
  } finally { await browser.close(); report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify({ checks: report.checks.length, passed: report.checks.filter(check => check.pass).length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length, report: path.join(out, 'browser-report.json') })); if (!report.pass) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

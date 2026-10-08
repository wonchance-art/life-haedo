/* Restore an actual anonymous book backup through the UI, then resume a chosen
 * chapter. HTTP Auth is simulated; IndexedDB and all restore transactions are real.
 * BASE_URL, PW_MODULE_PATH/PLAYWRIGHT_MODULE, CHROMIUM_PATH; BOOK_RESTORE_MATCH. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
if (!process.env.PW_MODULE_PATH && process.env.PLAYWRIGHT_MODULE) process.env.PW_MODULE_PATH = process.env.PLAYWRIGHT_MODULE;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { FakeCloud, accounts, password, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, observe, nav } = require('./unified-home-browser.cjs');
const { current, save, download } = require('./book-projects-browser.cjs');
const { chapterFrom } = require('./book-completion-browser.cjs');
const { expand } = require('./book-insights-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const out = path.resolve('.local/book-restore-entry/after');
const fixturePath = path.resolve('docs/design-review/evidence/book-edition/reader-book-backup.json');
const clone = value => JSON.parse(JSON.stringify(value));
function annotation(error) { if (process.env.GITHUB_ACTIONS) console.error('::error title=Book restore entry::' + String(error.stack || error).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')); }

async function instrument(context) {
  await context.route(base + '/assets/life/storage.js', async route => {
    const response = await route.fetch(), source = await response.text();
    const hook = `\n;(()=>{
      const original=HaedoLife.Storage;
      HaedoLife.Storage=Object.freeze({...original,forAccount(...args){
        const actual=original.forAccount(...args);
        const fail=(kind)=>{window.__restoreFaults.push(kind);throw Object.assign(new Error('익명 복원 검사: '+kind),{code:'restore_probe'});};
        const gate=async(kind)=>{window.__restoreGateEntered=kind;await new Promise(resolve=>window.__restoreGateRelease=resolve);window.__restoreGateFinished=kind;};
        return Object.freeze({...actual,
          async installWorkbenchCopy(...args){
            window.__restoreCopies ||= [];window.__restoreFaults ||= [];
            if(window.__restoreBeforeFailure){window.__restoreBeforeFailure=false;fail('install');}
            const result=await actual.installWorkbenchCopy(...args);
            window.__restoreCopies.push(result.bundle.workspaceId);
            if(window.__restoreAfterFailure){window.__restoreFailNext=window.__restoreAfterFailure;window.__restoreAfterFailure=null;}
            if(window.__restoreHold==='install'){window.__restoreHold=null;await gate('install');}
            return result;
          },
          async readWorkbench(...args){
            if(window.__restoreCopies?.includes(args[0])&&window.__restoreFailNext==='workbench'){window.__restoreFailNext=null;fail('workbench');}
            const held=window.__restoreCopies?.includes(args[0])&&window.__restoreHold==='workbench';
            if(held){window.__restoreHold=null;await gate('workbench');}
            const result=await actual.readWorkbench(...args);if(held)window.__restoreReadReturned='workbench';return result;
          },
          async listWorkspaces(...args){
            if(window.__restoreFailNext==='list'){window.__restoreFailNext=null;fail('list');}
            const held=window.__restoreCopies?.length&&window.__restoreHold==='list';
            if(held){window.__restoreHold=null;await gate('list');}
            const result=await actual.listWorkspaces(...args);if(held)window.__restoreReadReturned='list';return result;
          }
        });
      }});
    })();`;
    await route.fulfill({ response, body: source + hook });
  });
}

async function prepare(page, data) {
  await page.goto(base + '/index.html'); await ready(page); await settle(page);
  const previous = await current(page);
  await nav(page, 'manage'); await page.getByRole('button', { name: '자료·구성 백업', exact: true }).click();
  await page.locator('#wbRestoreFile').setInputFiles({ name: '익명-독자용-책-백업.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await page.getByRole('heading', { name: '복원 전 확인', exact: true }).waitFor();
  return previous;
}
async function installed(page, previous, mode = 'books') {
  await page.locator(`.life-workbench[data-mode="${mode}"][aria-busy="false"]`).waitFor();
  await page.locator('#lifeRestoreResult').waitFor();
  await page.waitForFunction(() => document.activeElement === document.querySelector('#lifeRestoreResult h3'));
  const result = await current(page); assert.notEqual(result.bundle.workspaceId, previous.bundle.workspaceId);
  assert.equal(await page.locator('#wbRestoreInstall').count(), 0);
  assert.match(await page.locator('#lifeRestoreResult').textContent(), /이전 작업공간은 그대로/);
  assert.match(await page.locator('#lifeRestoreResult').textContent(), /자동 동기화는 연결하지 않았/);
  return result;
}
async function apply(page, previous, mode = 'books') {
  await page.locator('#wbRestoreInstall').click(); return installed(page, previous, mode);
}
function assertRemapped(data, restored) {
  const source = data.sourceBackup.workspace, bundle = restored.bundle;
  assert.notEqual(bundle.workspaceId, source.workspaceId);
  assert.deepEqual(bundle.sourceVersions.map(v => v.contentText), source.sourceVersions.map(v => v.contentText));
  const versionMap = new Map(bundle.sourceVersions.map((v, i) => [v.id, source.sourceVersions[i].id]));
  function semantic(value, remapped) {
    if (Array.isArray(value)) return value.map(item => semantic(item, remapped));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'id' ? '<composition-id>' : /VersionIds$|^versionIds$/.test(key) ? item.map(id => remapped ? versionMap.get(id) || id : id) : semantic(item, remapped)]));
    return value;
  }
  assert.deepEqual(semantic(restored.workbench.books || [], true), semantic(data.workbench.books || [], false));
  if (data.workbench.books?.length) assert.notEqual(restored.workbench.books[0].id, data.workbench.books[0].id);
  for (const record of bundle.records) for (const ref of record.sourceRefs) {
    const version = bundle.sourceVersions.find(item => item.id === ref.sourceVersionId);
    if (record.kind === 'excerpt' && ref.locator) assert.equal(version.contentText.slice(ref.locator.start, ref.locator.end), record.text);
  }
}
async function untouched(page, previous) {
  assert.deepEqual(await page.evaluate(async id => ({ bundle: await HaedoLife.Shell.storage.read(id), workbench: await HaedoLife.Shell.storage.readWorkbench(id) }), previous.bundle.workspaceId), previous);
}
async function capture(page, report, scene, width) {
  await page.mouse.move(width - 2, 2);
  await page.evaluate(async () => { document.activeElement?.blur(); scrollTo(0, 0); await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const metrics = await page.evaluate(inspect), screenshot = scene + '-' + width + '.png';
  await page.screenshot({ path: path.join(out, screenshot), fullPage: true });
  if (width === 390) await page.screenshot({ path: path.join(out, scene + '-' + width + '-viewport.png') });
  const position = await page.evaluate(() => ({ receiptTop: document.querySelector('#lifeRestoreResult')?.getBoundingClientRect().top ?? null, firstBookTop: document.querySelector('#wbBookList [data-book-id]')?.getBoundingClientRect().top ?? null, scrollY }));
  report.visual.push({ scene, width, screenshot, ...position, ...metrics });
  assert.equal(metrics.horizontalOverflow, false);
  for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ': ' + key);
}
async function authenticate(page, account) {
  await page.evaluate(async ({ email, password }) => { const result = await HaedoAuth.client.auth.signInWithPassword({ email, password }); if (result.error) throw result.error; await HaedoAuth.verify(); }, { email: account.email, password });
  await page.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell?.storage && HaedoLife.Shell.sync?.getAccount()?.userId === id, account.id); await ready(page);
}

async function main() {
  await fs.mkdir(out, { recursive: true }); const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), browser: browser.version(), scope: 'Actual anonymous backup upload/restore and local transaction recovery. CSS viewport/touch simulation; not Apple devices, personal records or live services.', checks: [], visual: [], observations: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0, operatingRemoteWrites: 0 };
  async function check(name, width, run) {
    if (process.env.BOOK_RESTORE_MATCH && !new RegExp(process.env.BOOK_RESTORE_MATCH).test(name)) return;
    const server = new FakeCloud(), context = await makeContext(browser, server, 'book-restore-' + report.checks.length, accounts.a, { viewport: { width, height: 1000 }, hasTouch: width < 1000, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name); await instrument(context);
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push({ origin: url.origin, path: url.pathname }); return route.abort('blockedbyclient'); });
    try { await run({ page, context }); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); annotation(error); await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    for (const width of [1440, 820, 390]) await check('restored book list, exact chapter editing and reader output at ' + width, width, async ({ page }) => {
      const previous = await prepare(page, fixture), restored = await apply(page, previous), book = restored.workbench.books[0], chapter = book.chapters[1];
      assertRemapped(fixture, restored); await untouched(page, previous);
      assert.equal(await page.locator('#wbChapterNote').count(), 0, 'Restoration must not choose a chapter automatically');
      assert.equal(await page.locator('.wb-content > #lifeRestoreResult').count(), 1);
      assert.equal(await page.locator('#wbBookList [data-book-id]').count(), 1);
      await capture(page, report, 'restored-books', width);
      const row = page.locator(`#wbBookList [data-book-id="${book.id}"]`);
      await chapterFrom(page, row, chapter); assert.equal(await page.locator('#lifeRestoreResult').count(), 0, 'Receipt ends when editing begins');
      const revised = chapter.note + '\n\n복원한 사본에서 다시 읽고 덧붙인 문장: 예전의 질문도 현재의 원고와 함께 남겨 둔다.';
      await page.locator('#wbChapterNote').fill(revised); await save(page);
      await expand(page, '#wbChapterEvidence');
      const exactId = chapter.versionIds[0], exact = restored.bundle.sourceVersions.find(v => v.id === exactId), open = page.locator(`#wbChapterSources [data-version-id="${exactId}"]`).getByRole('button', { name: '이 원문 버전 열기', exact: true });
      const focus = await open.getAttribute('data-focus-key'); await open.focus(); await page.keyboard.press('Enter');
      await page.getByRole('document', { name: '보관한 원문', exact: true }).waitFor(); assert.equal(await page.getByRole('document', { name: '보관한 원문', exact: true }).textContent(), exact.contentText);
      await page.getByRole('button', { name: '책으로 돌아가기', exact: true }).click(); await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, focus);
      assert.equal(await page.locator('#wbChapterNote').inputValue(), revised);
      await page.locator('#wbBookEditionOpen').click(); await page.waitForFunction(() => document.querySelector('#wbEditionStatus')?.textContent.startsWith('책자 준비됨'));
      const html = (await download(page, '#wbEditionHTML')).text; assert(html.includes('복원한 사본에서 다시 읽고 덧붙인 문장')); assert(html.includes(exactId)); assert(!html.includes(exact.contentText));
      const excluded = book.chapters.flatMap(c => c.insights || []).find(i => i.excluded); assert(excluded); assert(!html.includes(excluded.statement));
      if (width === 820) {
        await fs.writeFile(path.join(out, 'restored-edited-book.html'), html);
        const standalone = await page.context().newPage(), url = base + '/__qa_restored_book__.html';
        await standalone.route(url, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
        await standalone.goto(url); await standalone.evaluate(() => document.fonts.ready);
        const pdf = path.join(out, 'restored-edited-book.pdf'); await standalone.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true }); await standalone.close();
        const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' }).replace(/\s/g, '');
        assert(text.includes(revised.replace(/\s/g, ''))); assert(!text.includes(excluded.statement.replace(/\s/g, '')));
        report.observations.push({ PDF: 'restored-edited-book.pdf', actualDownloadedHTML: true, completeEditedKoreanText: true, nativeOSSave: false });
      }
      const after = await current(page); assert.deepEqual(after.bundle, restored.bundle); assert.deepEqual(after.workbench.books[0].editions, book.editions); await untouched(page, previous);
      await page.reload(); await ready(page); await page.locator('#wbBookList').waitFor(); await chapterFrom(page, page.locator(`#wbBookList [data-book-id="${book.id}"]`), chapter); assert.equal(await page.locator('#wbChapterNote').inputValue(), revised);
      report.observations.push({ width, previousPreserved: true, exactVersionAndExcerpt: true, editionAndExclusionPreserved: true, explicitChapterChoice: true, keyboardReaderReturn: true, localEditSurvivesReload: true });
    });

    await check('multiple books, archived-only and no-books choose explicit truthful destinations', 390, async ({ page }) => {
      for (const variant of ['multiple', 'archived', 'none']) {
        const data = clone(fixture);
        if (variant === 'multiple') { const extra = clone(data.workbench.books[0]); const remap = value => { if (Array.isArray(value)) value.forEach(remap); else if (value && typeof value === 'object') { if ('id' in value) value.id = randomUUID(); Object.values(value).forEach(remap); } }; remap(extra); extra.title = '공간을 걸으며 오래 남긴 취향'; data.workbench.books.push(extra); }
        if (variant === 'archived') data.workbench.books[0].archived = true;
        if (variant === 'none') delete data.workbench.books;
        const previous = await prepare(page, data), restored = await apply(page, previous, variant === 'none' ? 'page' : 'books'); assertRemapped(data, restored);
        assert.equal(await page.locator('#wbChapterNote').count(), 0);
        if (variant === 'multiple') assert.equal(await page.locator('#wbBookList [data-book-id]').count(), 2);
        if (variant === 'archived') {
          assert.equal(await page.locator('#wbArchivedBooks').evaluate(el => el.open), true); assert.equal(await page.locator('#wbBookCreateBox').evaluate(el => el.open), false);
          assert.equal(await page.locator('[data-book-restore]').count(), 1); assert.equal(restored.workbench.books[0].archived, true);
          assert(!/첫 책|책이 없습니다/.test(await page.locator('.wb-content').textContent()), 'Archived books are not described as absent');
        }
        await capture(page, report, 'restored-' + variant, 390); await untouched(page, previous);
        if (variant !== 'none') await page.locator('#lifeRestoreResult summary').click();
        await page.getByRole('button', { name: '이전 작업공간으로 돌아가기', exact: true }).click(); await settle(page);
        assert.deepEqual(await current(page), previous); assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), restored.bundle.workspaceId), restored.bundle);
      }
    });

    await check('before-install failure keeps the review and retry creates one copy', 390, async ({ page }) => {
      const previous = await prepare(page, fixture); await page.evaluate(() => { window.__restoreBeforeFailure = true; });
      await page.locator('#wbRestoreInstall').click(); await page.locator('#wbError').waitFor({ state: 'visible' });
      assert.deepEqual(await current(page), previous); assert.equal((await page.evaluate(() => HaedoLife.Shell.storage.listWorkspaces())).length, 1); assert.equal(await page.locator('#wbRestoreInstall').isEnabled(), true);
      assert.equal(await page.locator('#wbRestoreFile').inputValue().then(value => value.endsWith('익명-독자용-책-백업.json')), true);
      await capture(page, report, 'restore-save-error', 390); const restored = await apply(page, previous); assertRemapped(fixture, restored); assert.equal(await page.evaluate(() => __restoreCopies.length), 1);
    });

    await check('postcommit configuration or list read failure preserves the committed copy without duplicate install', 820, async ({ page }) => {
      for (const fault of ['workbench', 'list']) {
        const previous = await prepare(page, fixture); await page.evaluate(fault => { window.__restoreAfterFailure = fault; }, fault); await page.locator('#wbRestoreInstall').click();
        await page.waitForFunction(fault => window.__restoreFaults?.includes(fault), fault);
        if (fault === 'workbench') {
          await page.locator('#wbError').waitFor({ state: 'visible' }); assert.equal(await page.locator('#wbRestoreInstall').count(), 0); await capture(page, report, 'restore-read-error', 820);
          await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
        }
        await page.locator('#wbBookList').waitFor(); const restored = await current(page); assert.notEqual(restored.bundle.workspaceId, previous.bundle.workspaceId); assertRemapped(fixture, restored); await untouched(page, previous);
        assert.equal(await page.evaluate(() => __restoreCopies.length), 1); assert.equal(await page.locator('#wbRestoreInstall').count(), 0);
      }
    });

    await check('delayed committed restore cannot take over another view or another account', 820, async ({ page }) => {
      for (const delayed of ['workbench', 'list']) {
        const previous = await prepare(page, fixture); await page.evaluate(delayed => { window.__restoreHold = delayed; }, delayed);
        const click = page.locator('#wbRestoreInstall').click(); await page.waitForFunction(delayed => window.__restoreGateEntered === delayed, delayed);
        await nav(page, 'home'); await page.locator('#homeBooks').waitFor();
        const nextFocus = page.locator('#homeBooks article[data-book-id] > button').first(); await nextFocus.focus(); const focusId = await nextFocus.locator('..').getAttribute('data-book-id');
        await page.evaluate(() => window.__restoreGateRelease()); await click;
        await page.waitForFunction(delayed => window.__restoreReadReturned === delayed, delayed); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.locator('#lifeMain').getAttribute('data-mode'), 'home'); assert.equal(await page.locator('#lifeRestoreResult').count(), 0);
        assert.equal(await page.evaluate(() => document.activeElement?.parentElement?.dataset.bookId), focusId, 'Late restore refresh must not steal keyboard focus');
        const first = await current(page); assertRemapped(fixture, first); await untouched(page, previous);
      }
      const beforeAccount = await prepare(page, fixture); await page.evaluate(() => { window.__restoreHold = 'install'; window.__restoreGateEntered = null; window.__restoreGateFinished = null; });
      const pending = page.locator('#wbRestoreInstall').click(); await page.waitForFunction(() => window.__restoreGateEntered === 'install'); const installedId = await page.evaluate(() => __restoreCopies.at(-1));
      await authenticate(page, accounts.b); await page.evaluate(() => window.__restoreGateRelease()); await pending; await page.waitForFunction(() => window.__restoreGateFinished === 'install');
      assert.equal(await page.locator('#lifeRestoreResult').count(), 0); const other = await current(page); assert.equal(other.bundle.sources.length, 0); assert.equal(other.workbench.books, undefined);
      assert.equal(await page.evaluate(async id => { try { await HaedoLife.Shell.storage.read(id); return false; } catch (_) { return true; } }, installedId), true);
      await authenticate(page, accounts.a); const returned = await current(page); assert.equal(returned.bundle.workspaceId, installedId); assertRemapped(fixture, returned); await untouched(page, beforeAccount);
    });
    assert(report.checks.length); report.pass = report.checks.every(check => check.pass) && !report.consoleErrors.length && !report.pageErrors.length && !report.external.length;
  } finally { await browser.close(); report.finishedAt = new Date().toISOString(); const json = JSON.stringify(report, null, 2); await fs.writeFile(path.join(out, 'run-' + report.createdAt.replace(/[:.]/g, '-') + '.json'), json); await fs.writeFile(path.join(out, 'browser-report.json'), json); }
  console.log(JSON.stringify({ checks: report.checks.length, passed: report.checks.filter(check => check.pass).length, visual: report.visual.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length, report: path.join(out, 'browser-report.json') })); if (!report.pass) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); annotation(error); process.exitCode = 1; });

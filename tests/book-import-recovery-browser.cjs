/* Chapter import recovery: actual local app/SDK/IndexedDB with anonymous Auth HTTP.
 * BASE_URL=http://127.0.0.1:4184 node tests/book-import-recovery-browser.cjs
 * Faults and delays are injected only in this isolated browser's script responses.
 * No production data, SQL, source service or actual Apple-device access. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, observe, nav } = require('./unified-home-browser.cjs');
const { fixture, seedBooks, openBook, evidence, current } = require('./book-projects-browser.cjs');
const out = path.resolve(process.env.OUTPUT_DIR || '.local/book-import-recovery');
const report = { createdAt: new Date().toISOString(), scope: 'Actual local app/SDK/IDB, synthetic Auth HTTP and injected local faults; not Apple-device verification',
  checks: [], consoleErrors: [], pageErrors: [], expectedErrors: 0, external: [] };

async function instrument(context) {
  // A confirmed source commit is followed by one failed bundle read. Ownership,
  // atomic commits and all subsequent reads still use the real scoped Storage.
  await context.route(base + '/assets/life/storage.js', async route => {
    const response = await route.fetch(), source = await response.text();
    const hook = `\n;(()=>{
      const base=HaedoLife.Storage;
      HaedoLife.Storage=Object.freeze({...base,forAccount(...args){
        const actual=base.forAccount(...args);
        return Object.freeze({...actual,
          async commitLocal(...input){
            const result=await actual.commitLocal(...input);
            if(window.__probeCountCommits&&result.status==='stored'){
              window.__probeCommits=(window.__probeCommits||0)+1;
              if(window.__probeFailAfterCommit){window.__probeFailNextRead=true;window.__probeFailAfterCommit=false;}
            }
            return result;
          },
          async read(...args){
            if(window.__probeFailNextRead){
              window.__probeFailNextRead=false;window.__probeReadFailed=true;
              throw Object.assign(new Error('익명 검사에서 보관 직후 목록 읽기를 중단했습니다.'),{code:'probe_read'});
            }
            return actual.read(...args);
          }
        });
      }});
    })();`;
    await route.fulfill({ response, body: source + hook });
  });
  // Delay completion of the begin operation after persistence. Its real mode,
  // navigation/workspace generation and isCurrent guards remain unchanged.
  await context.route(base + '/assets/life/ui.js', async route => {
    const response = await route.fetch(); let source = await response.text();
    const boundary = 'async function beginChapterImport(target, { isCurrent = () => true } = {}) {\n      const generation = workspaceGeneration, navigation = navigationGeneration;\n      await persistDrafts();';
    assert(source.includes(boundary), 'Chapter import persistence boundary is present');
    source = source.replace(boundary, boundary + `\n
      if(window.__probeHoldBegin){
        window.__probeBeginEntered=true;
        await new Promise(resolve=>window.__probeReleaseBegin=()=>{window.__probeHoldBegin=false;resolve();});
        window.__probeBeginReleased=true;
      }`);
    await route.fulfill({ response, body: source });
  });
}

async function prepareImport(page, title) {
  await page.locator('#wbChapterImport').click(); await page.locator('#lifeImportText').waitFor();
  await page.locator('#lifeImportTitle').fill(title);
  await page.locator('#lifeImportText').fill('익명 검사 원문: 보관과 장 연결은 서로 별개의 명시 저장이다.');
  await page.getByRole('button', { name: '원문·출처 확인', exact: true }).click();
}

async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  async function check(name, run) {
    if (process.env.BOOK_IMPORT_RECOVERY_MATCH && !new RegExp(process.env.BOOK_IMPORT_RECOVERY_MATCH).test(name)) return;
    const server = new FakeCloud(), context = await makeContext(browser, server, 'import-recovery-' + report.checks.length, accounts.a), page = await context.newPage();
    page.setDefaultTimeout(10000); observe(page, report, name); await instrument(context);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback();
      report.external.push({ origin: url.origin, path: url.pathname }); return route.abort('blockedbyclient');
    });
    try {
      const f = await fixture(page), seed = await seedBooks(page, f);
      await openBook(page, seed.books[0].id); await evidence(page);
      await run({ page, f, seed });
      assert.equal(server.writes().length, 0, 'Recovery must not upload a workspace');
      report.checks.push({ name, pass: true }); console.log('PASS ' + name);
    } catch (error) {
      report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack);
      if (process.env.GITHUB_ACTIONS) console.error('::error title=Chapter import recovery::' + String(error.stack || error).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'));
      await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {});
    } finally { await context.close(); }
  }
  try {
    await check('postcommit read failure keeps one exact source and explicit return connects without replay', async ({ page }) => {
      const before = await current(page);
      await prepareImport(page, '원문 저장 후 읽기 실패 검사');
      await page.evaluate(() => { window.__probeCountCommits = true; window.__probeFailAfterCommit = true; });
      await page.getByRole('button', { name: '자료만 보관', exact: true }).click();
      await page.waitForFunction(() => window.__probeReadFailed); await page.locator('#lifeError').waitFor();
      assert.equal(await page.locator('#lifeChapterImportReturn').textContent(), '보관한 자료 확인');
      const stored = await current(page);
      assert.equal(stored.bundle.sourceVersions.length, before.bundle.sourceVersions.length + 1);
      assert.deepEqual(stored.workbench.books, before.workbench.books);
      assert.equal(await page.evaluate(() => window.__probeCommits), 1);
      await page.locator('#lifeChapterImportReturn').click();
      const candidate = page.locator('#wbChapterImportReview input[type=checkbox]'); await candidate.waitFor();
      assert.equal(await candidate.count(), 1); assert.equal(await candidate.isChecked(), false);
      const id = await candidate.getAttribute('data-version-id');
      assert(stored.bundle.sourceVersions.some(version => version.id === id), 'Candidate must identify the committed exact version');
      await candidate.check(); await page.locator('#wbChapterImportApply').click();
      await page.locator('#wbChapterImportReview').waitFor({ state: 'detached' });
      const after = await current(page);
      assert.deepEqual(after.bundle, stored.bundle, 'Recovering the configuration must not replay the source commit');
      assert.equal(after.workbench.books[0].chapters[0].versionIds.filter(ref => ref === id).length, 1);
      assert.equal(after.workbench.books[0].chapters[0].note, before.workbench.books[0].chapters[0].note);
      assert.equal(await page.evaluate(() => window.__probeCommits), 1);
    });

    for (const destination of ['home', 'chapter', 'signout']) {
      await check('late begin after ' + destination + ' cannot open an import or create a draft', async ({ page }) => {
        const before = await current(page);
        await page.evaluate(() => { window.__probeHoldBegin = true; window.__probeBeginEntered = false; });
        await page.locator('#wbChapterImport').click(); await page.waitForFunction(() => window.__probeBeginEntered);
        if (destination === 'home') {
          await nav(page, 'home'); await page.waitForFunction(() => document.querySelector('#lifeMain')?.dataset.mode === 'home');
        } else if (destination === 'chapter') {
          await page.locator('#wbChapterNext').click();
          await page.waitForFunction(() => document.querySelector('#wbChapterTitle')?.value === '쉬는 시간을 다시 이해하기');
        } else {
          await page.evaluate(() => { window.__probeSignout = HaedoAuth.client.auth.signOut({ scope: 'local' }); });
          await page.waitForFunction(() => HaedoAuth.user === null && !HaedoLife.Shell.storage);
          assert.equal(await page.locator('#lifeApp').isHidden(), true);
        }
        await page.evaluate(() => window.__probeReleaseBegin());
        await page.waitForFunction(() => window.__probeBeginReleased);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.locator('#lifeChapterImportContext').count(), 0);
        assert.equal(await page.locator('#lifeImportText').count(), 0);
        if (destination !== 'signout') {
          assert.deepEqual((await current(page)).workbench, before.workbench);
          assert.equal(await page.evaluate(async () => {
            const s = HaedoLife.Shell.storage;
            return (await s.listStages(await s.getActive())).filter(stage => stage.state === 'draft').length;
          }), 0);
        } else assert.equal(await page.locator('#lifeApp').isHidden(), true);
      });
    }

    await check('archived target returns to the list without selecting another chapter or losing the source', async ({ page, seed }) => {
      const before = await current(page);
      await prepareImport(page, '보관한 장 목적지 검사');
      await page.evaluate(async ({ bookId, chapterId }) => {
        const s = HaedoLife.Shell.storage, w = await s.readWorkbench(await s.getActive());
        w.books.find(book => book.id === bookId).chapters.find(chapter => chapter.id === chapterId).archived = true;
        await s.saveWorkbench(w.workspaceId, w, w.revision);
      }, { bookId: seed.books[0].id, chapterId: seed.books[0].chapters[0].id });
      await page.getByRole('button', { name: '자료만 보관', exact: true }).click(); await page.locator('#wbBookList').waitFor();
      assert.equal(await page.locator('#wbChapterNote').count(), 0); assert.equal(await page.locator('#wbChapterImportReview').count(), 0);
      const after = await current(page);
      assert.equal(after.bundle.sourceVersions.length, before.bundle.sourceVersions.length + 1);
      assert.deepEqual(after.workbench.books[0].chapters[1], before.workbench.books[0].chapters[1]);
      assert.equal(after.workbench.books[0].chapters[0].archived, true);
    });

    await check('CAS conflict keeps the source and pending link for explicit comparison and exact retry', async ({ page }) => {
      const before = await current(page);
      await prepareImport(page, '구성 CAS 충돌 검사');
      await page.getByRole('button', { name: '자료만 보관', exact: true }).click();
      const candidate = page.locator('#wbChapterImportReview input[type=checkbox]'); await candidate.waitFor();
      const id = await candidate.getAttribute('data-version-id'); await candidate.check();
      await page.evaluate(async () => {
        const s = HaedoLife.Shell.storage, w = await s.readWorkbench(await s.getActive());
        w.books[0].chapters[0].note = '다른 탭의 익명 원고'; await s.saveWorkbench(w.workspaceId, w, w.revision);
      });
      await page.locator('#wbChapterImportApply').click();
      await page.getByRole('button', { name: '저장본과 비교', exact: true }).waitFor();
      assert.equal(await candidate.isDisabled(), true); assert.equal(await candidate.isChecked(), true);
      assert.equal(await page.locator('#wbChapterImportCancel').isDisabled(), true);
      assert.equal(await page.locator('#wbChapterNote').inputValue(), before.workbench.books[0].chapters[0].note);
      const conflict = await current(page);
      assert(conflict.bundle.sourceVersions.some(version => version.id === id));
      assert.equal(conflict.workbench.books[0].chapters[0].versionIds.includes(id), false);
      assert.equal(conflict.workbench.books[0].chapters[0].note, '다른 탭의 익명 원고');
      await page.getByRole('button', { name: '저장본과 비교', exact: true }).click();
      await page.getByRole('button', { name: '비교한 저장본에 내 초안 적용', exact: true }).click();
      await page.locator('#wbStatus[data-state=saved]').waitFor();
      await page.locator('#wbChapterImportApply').click(); await page.locator('#wbChapterImportReview').waitFor({ state: 'detached' });
      const resolved = await current(page);
      assert.equal(resolved.workbench.books[0].chapters[0].versionIds.filter(ref => ref === id).length, 1);
      assert.equal(resolved.workbench.books[0].chapters[0].note, before.workbench.books[0].chapters[0].note);
      assert.deepEqual(resolved.bundle, conflict.bundle);
    });
  } finally {
    await browser.close(); await fs.writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log('Chapter import recovery: ' + report.checks.filter(check => check.pass).length + '/' + report.checks.length + '; console ' + report.consoleErrors.length + '; page ' + report.pageErrors.length + '. Anonymous intercepted Auth only.');
  if (report.checks.some(check => !check.pass) || report.consoleErrors.length || report.pageErrors.length || report.external.length) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });

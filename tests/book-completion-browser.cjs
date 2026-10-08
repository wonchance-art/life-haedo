/* Existing-book return journey: actual anonymous JSON restore, home/outline navigation,
 * edits, exact evidence and reader output. No production services or fixture IDB writes.
 * BASE_URL, PW_MODULE_PATH/PLAYWRIGHT_MODULE, CHROMIUM_PATH; BOOK_COMPLETION_MATCH. */
'use strict';
process.env.BASE_URL ||= 'http://127.0.0.1:4184';
if (!process.env.PW_MODULE_PATH && process.env.PLAYWRIGHT_MODULE) process.env.PW_MODULE_PATH = process.env.PLAYWRIGHT_MODULE;
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { FakeCloud, accounts, password, cloud, base } = require('./life-sync-browser.cjs');
const { playwright, makeContext, ready, settle, observe, nav } = require('./unified-home-browser.cjs');
const { current, save, details, download, openBook, createBook } = require('./book-projects-browser.cjs');
const { expand } = require('./book-insights-browser.cjs');
const { inspect } = require('../scripts/check-site-design.cjs');
const out = path.resolve('.local/book-completion/after');
const fixturePath = path.resolve('docs/design-review/evidence/book-edition/reader-book-backup.json');
function annotation(error) { if (process.env.GITHUB_ACTIONS) console.error('::error title=Book completion::' + String(error.stack || error).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')); }
async function restore(page) {
  await page.goto(base + '/index.html'); await ready(page); await settle(page); const original = await current(page);
  await nav(page, 'manage'); await page.getByRole('button', { name: '자료·구성 백업', exact: true }).click();
  await page.getByLabel('통합 구성 JSON으로 새 사본 복원', { exact: true }).setInputFiles(fixturePath);
  await page.getByRole('heading', { name: '복원 전 확인', exact: true }).waitFor();
  assert.match(await page.locator('#wbRestoreBookSummary').textContent(), /책 1권 · 활성 장 4개 · 보관한 책 0권 · 보관한 장 0개 · 개정본 1개/);
  return { original, install: async () => {
    await page.getByRole('button', { name: '새 사본으로 복원', exact: true }).click();
    await page.locator('.life-workbench[data-mode="books"][aria-busy="false"]').waitFor(); assert.notEqual(await page.evaluate(() => HaedoLife.Shell.storage.getActive()), original.bundle.workspaceId); return current(page);
  } };
}
async function home(page) { await nav(page, 'home'); await page.locator('#homeBooks').waitFor(); }
async function chapterFrom(page, container, chapter) {
  const outline = container.locator('details'); if (!await outline.evaluate(el => el.open)) await outline.locator(':scope > summary').click();
  await outline.locator(`button[data-chapter-id="${chapter.id}"]`).click();
  await page.waitForFunction(title => document.querySelector('#wbChapterTitle')?.value === title, chapter.title);
}
async function capture(page, report, scene, width) {
  await page.mouse.move(width - 2, 2); await page.evaluate(async () => { document.activeElement?.blur(); scrollTo(0, 0); await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const metrics = await page.evaluate(inspect), screenshot = `${scene}-${width}.png`; await page.screenshot({ path: path.join(out, screenshot), fullPage: true });
  if (width === 390) await page.screenshot({ path: path.join(out, `${scene}-${width}-viewport.png`) });
  const positions = await page.evaluate(() => ({ booksTop: document.querySelector('#homeBooks')?.getBoundingClientRect().top ?? null, chapterInputTop: document.querySelector('#wbChapterNote')?.getBoundingClientRect().top ?? null }));
  report.visual.push({ scene, width, screenshot, ...positions, ...metrics }); assert.equal(metrics.horizontalOverflow, false);
  for (const key of ['smallTargets', 'smallInputs', 'unnamed', 'contrastFailures']) assert.deepEqual(metrics[key], [], scene + ': ' + key);
}
async function account(page, who) {
  await page.evaluate(async ({ email, password }) => { const result = await HaedoAuth.client.auth.signInWithPassword({ email, password }); if (result.error) throw result.error; await HaedoAuth.verify(); }, { email: who.email, password });
  await page.waitForFunction(id => HaedoAuth.user?.id === id && HaedoLife.Shell?.storage && HaedoLife.Shell.sync?.getAccount()?.userId === id, who.id); await ready(page);
}
async function main() {
  await fs.mkdir(out, { recursive: true }); const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8')), originalBook = fixture.workbench.books[0];
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const report = { createdAt: new Date().toISOString(), browser: browser.version(), scope: 'Anonymous actual JSON restore and existing-book return flow. CSS viewport/touch simulation, not Apple devices or native Save PDF. No production, real Auth or remote writes.', checks: [], visual: [], observations: [], consoleErrors: [], pageErrors: [], external: [], expectedErrors: 0, operatingRemoteWrites: 0 };
  async function check(name, width, run) {
    if (process.env.BOOK_COMPLETION_MATCH && !new RegExp(process.env.BOOK_COMPLETION_MATCH).test(name)) return;
    const server = new FakeCloud(), context = await makeContext(browser, server, 'book-completion-' + report.checks.length, accounts.a, { viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width <= 820, reducedMotion: 'reduce' });
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([new URL(base).origin, cloud].includes(url.origin)) return route.fallback(); report.external.push(url.origin); return route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, report, name);
    try { await run({ page, context }); assert.equal(server.writes().length, 0); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); annotation(error); await page.screenshot({ path: path.join(out, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {}); }
    finally { await context.close(); }
  }
  try {
    for (const width of [1440, 820, 390]) await check(`restore, find chapter, edit, reload and exact evidence/output at ${width}`, width, async ({ page, context }) => {
      const pending = await restore(page); await capture(page, report, 'restore-review', width); const restored = await pending.install(), book = restored.workbench.books[0], chapter = book.chapters[1];
      assert.notEqual(book.id, originalBook.id); assert.deepEqual(book.chapters.map(ch => ch.note), originalBook.chapters.map(ch => ch.note)); assert.equal(book.editions.length, 1); assert.notEqual(book.editions[0].id, originalBook.editions[0].id);
      const record = restored.bundle.records[0], old = restored.bundle.sourceVersions.find(v => v.id === record.sourceRefs[0].sourceVersionId), ref = record.sourceRefs[0]; assert.equal(old.contentText.slice(ref.locator.start, ref.locator.end), record.text); assert.equal(book.chapters[0].versionIds[0], old.id);
      await home(page); const row = page.locator(`#homeBooks article[data-book-id="${book.id}"]`); assert.equal(await row.count(), 1); assert((await row.textContent()).includes(book.title)); await capture(page, report, 'home-books', width);
      await row.locator('summary').focus(); await page.keyboard.press('Enter'); assert.equal(await row.locator('details').evaluate(el => el.open), true); assert.equal(await row.locator('button[data-chapter-id]').count(), 4);
      await row.locator(`button[data-chapter-id="${chapter.id}"]`).focus(); await page.keyboard.press('Enter'); await page.waitForFunction(title => document.querySelector('#wbChapterTitle')?.value === title, chapter.title);
      const revised = chapter.note + '\n\n다시 읽으며 남긴 문장: 쉬는 동안 정한 하루의 순서를 일을 다시 시작한 뒤에도 이어 가고 싶다.'; await page.getByRole('textbox', { name: '이 장의 원고', exact: true }).fill(revised); await save(page);
      await page.reload(); await ready(page); await page.locator('#wbBookList').waitFor(); const savedRow = page.locator(`#wbBookList [data-book-id="${book.id}"]`); await savedRow.locator('summary').click(); await capture(page, report, 'book-list-outline', width); await chapterFrom(page, savedRow, chapter); assert.equal(await page.getByRole('textbox', { name: '이 장의 원고', exact: true }).inputValue(), revised);
      await expand(page, '#wbChapterEvidence'); const versionId = chapter.versionIds[0], version = restored.bundle.sourceVersions.find(v => v.id === versionId); const source = page.locator(`#wbChapterSources [data-version-id="${versionId}"]`), open = source.getByRole('button', { name: '이 원문 버전 열기', exact: true }); const focusKey = await open.getAttribute('data-focus-key'); await open.click(); await page.getByRole('document', { name: '보관한 원문', exact: true }).waitFor(); assert.equal(await page.getByRole('document', { name: '보관한 원문', exact: true }).textContent(), version.contentText); await page.getByRole('button', { name: '책으로 돌아가기', exact: true }).click(); await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, focusKey); assert.equal(await page.getByRole('textbox', { name: '이 장의 원고', exact: true }).inputValue(), revised); await capture(page, report, 'chapter-return', width);
      await page.getByRole('button', { name: '전체 원고 읽기', exact: true }).click(); await page.locator('#wbBookPreview').waitFor(); assert((await page.locator('#wbBookPreview').textContent()).includes(revised)); await page.getByRole('button', { name: '책자 만들기', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#wbEditionStatus')?.textContent.startsWith('책자 준비됨'));
      const raw = await download(page, '#wbEditionHTML'); assert(raw.text.includes('다시 읽으며 남긴 문장')); assert(!raw.text.includes(old.contentText), 'Default booklet excludes original source bodies'); assert(!raw.text.includes(originalBook.chapters[0].insights[1].statement), 'Excluded interpretation stays excluded'); assert(raw.text.includes(old.id), 'Appendix preserves the restored exact prior version');
      if (width === 820) {
        await fs.writeFile(path.join(out, 'reopened-edited-book.html'), raw.text); const standalone = await context.newPage(), url = base + '/__qa_completion_book__.html'; await standalone.route(url, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: raw.text })); await standalone.goto(url); await standalone.evaluate(() => document.fonts.ready); const pdf = path.join(out, 'reopened-edited-book.pdf'); await standalone.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true }); await standalone.close(); const pdfText = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' }).replace(/\s/g, ''); assert(pdfText.includes(revised.replace(/\s/g, ''))); report.observations.push({ PDF: 'reopened-edited-book.pdf', generatedFromActualDownloadedHTML: true, nativePrintDialog: false });
      }
      const final = await current(page); assert.deepEqual(final.bundle, restored.bundle); assert.deepEqual(final.workbench.books[0].editions, book.editions); assert.deepEqual(final.workbench.reflection, restored.workbench.reflection); assert.deepEqual(await page.evaluate(id => HaedoLife.Shell.storage.read(id), pending.original.bundle.workspaceId), pending.original.bundle);
      report.observations.push({ width, exactChapterChosenFromHomeAndList: true, keyboardChapterChoice: true, readerReturnFocusPreserved: true, restoredOldVersionAndExcerptPreserved: true, originalWorkspaceUnchanged: true });
    });
    await check('active-book limit, archived chapter/book, empty-book outline and account isolation', 390, async ({ page }) => {
      const pending = await restore(page), restored = await pending.install(), book = restored.workbench.books[0]; await home(page); await chapterFrom(page, page.locator(`#homeBooks [data-book-id="${book.id}"]`), book.chapters[3]); page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '이 장 보관', exact: true }).click(); await page.waitForFunction(({ workspace, id }) => HaedoLife.Shell.storage.readWorkbench(workspace).then(state => state.books[0].chapters.find(ch => ch.id === id).archived === true), { workspace: restored.bundle.workspaceId, id: book.chapters[3].id });
      const empty = await createBook(page, '짧은 산문을 모으는 다음 책'); await createBook(page, '나중에 다듬을 독서 기록'); const fourth = await createBook(page, '아직 목차를 만들지 않은 여행 기록');
      await home(page); assert.equal(await page.locator('#homeBooks article[data-book-id]').count(), 3); assert.equal(await page.locator(`#homeBooks [data-book-id="${fourth.id}"]`).count(), 0); const first = page.locator(`#homeBooks [data-book-id="${book.id}"]`); await first.locator('summary').click(); assert.equal(await first.locator('button[data-chapter-id]').count(), 3); assert.equal(await first.locator(`[data-chapter-id="${book.chapters[3].id}"]`).count(), 0); assert.equal(await page.locator(`#homeBooks [data-book-id="${empty.id}"] details`).count(), 0); await capture(page, report, 'home-active-books', 390);
      await page.getByRole('button', { name: '내 책 모두 보기', exact: true }).click(); await page.locator('#wbBookList').waitFor(); assert.equal(await page.locator('#wbBookList [data-book-id]').count(), 4); await openBook(page, book.id); await details(page, '책 설정'); page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '책 보관', exact: true }).click(); await page.waitForFunction(({ workspace, id }) => HaedoLife.Shell.storage.readWorkbench(workspace).then(state => state.books.find(book => book.id === id).archived === true), { workspace: restored.bundle.workspaceId, id: book.id }); await home(page); assert.equal(await page.locator('#homeBooks article[data-book-id]').count(), 3); assert.equal(await page.locator(`#homeBooks [data-book-id="${book.id}"]`).count(), 0); assert.equal(await page.locator(`#homeBooks [data-book-id="${fourth.id}"]`).count(), 1);
      await account(page, accounts.b); await home(page); assert.equal(await page.locator('#homeBooks article[data-book-id]').count(), 0); assert.equal(await page.locator('#homeBooks').getByRole('button', { name: '책 만들기', exact: true }).count(), 1); await account(page, accounts.a); await home(page); assert.equal(await page.locator('#homeBooks article[data-book-id]').count(), 3); assert.deepEqual((await current(page)).bundle, restored.bundle);
    });
    assert(report.checks.length); report.pass = report.checks.every(c => c.pass) && !report.consoleErrors.length && !report.pageErrors.length && !report.external.length;
  } finally { await browser.close(); report.finishedAt = new Date().toISOString(); const json = JSON.stringify(report, null, 2); await fs.writeFile(path.join(out, 'run-' + report.createdAt.replace(/[:.]/g, '-') + '.json'), json); await fs.writeFile(path.join(out, 'browser-report.json'), json); }
  console.log(JSON.stringify({ checks: report.checks.length, passed: report.checks.filter(c => c.pass).length, visual: report.visual.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, external: report.external.length, report: path.join(out, 'browser-report.json') })); if (!report.pass) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); annotation(error); process.exitCode = 1; });

module.exports = { restore, chapterFrom };
